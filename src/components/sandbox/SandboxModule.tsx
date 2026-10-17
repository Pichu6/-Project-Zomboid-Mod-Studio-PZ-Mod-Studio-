import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TranslatedErrorCard, LogFileInfoUI, ModInfo, RequireAnswer } from '../../types';
import { BisectPanel } from './BisectPanel';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, explainError, reportBackendError } from '../../services/tauri';
import { liveConsoleLines, startLiveConsole, subscribeLiveConsole } from '../../services/liveConsole';
import { applyRequireFix, packageForPatch } from '../../utils/requireFix';
import { errorShape } from '../../utils/errorShape';

/** The game names a Studio package when it read the package's patched copy of a mod's file. */
const STUDIO_PACKAGE_PREFIX = 'PZ Mod Studio Patch: ';

const LIVE_CONSOLE_HEADER = [
  '[PZ Monitor Center] Realtime client session monitor ready.',
  '[PZ Monitor Center] Click "Launch Game (Monitored)" to start ProjectZomboid64.exe (-debug) and stream live output here.',
];
import {
  AlertCircle,
  AlertTriangle,
  Wrench,
  CheckCircle,
  FolderX,
  Activity,
  Filter,
  Trash2,
  FolderOpen,
  Plus,
  X,
  Search,
  Copy,
  Download,
  Check,
  FileText,
  ChevronDown,
  Save,
} from 'lucide-react';

interface SandboxModuleProps {
  paths: StudioPathsUI;
  /** The installed mods, for the hunt: its suspects and their requirements. */
  mods: ModInfo[];
  /** Re-reads the Mod List after the hunt has written a trial to disk. */
  onRefreshMods: () => void;
  errorCards: TranslatedErrorCard[];
  /** The Build 42 shim travels inside a merge package, so repairs start in the Merger. */
  onOpenMerger: () => void;
  /** Switches a mod off by name, for when the game blames it for an error. */
  onSwitchOffMod?: (modName: string) => void;
  /**
   * Opens the Merger on this mod's files to patch one; with a file name from the log, that file.
   * The mod stays on: the package loads last and the game reads the patched copy.
   */
  onPatchMod?: (modId: string, fileHint?: string | null, fix?: { from: string; to: string } | null) => void;
  onClearErrorCards?: () => void;
  /** Removes one card, once what it reported has been fixed. */
  onDismissErrorCard?: (cardId: string) => void;
  onGoToSettings: () => void;
}

interface LogTab {
  id: string;
  title: string;
  isLive: boolean;
  filePath?: string;
  lines: string[];
}

type LogSeverityFilter = 'ALL' | 'ERRORS' | 'LUA' | 'JAVA' | 'BRIDGE';

const isTranslationSpamLine = (line: string): boolean => {
  const lower = line.toLowerCase();
  return (
    lower.includes('translator') ||
    lower.includes('translation') ||
    lower.includes('missing') ||
    lower.includes('language') ||
    lower.includes('igui_') ||
    lower.includes('itemname_') ||
    lower.includes('contextmenu_') ||
    lower.includes('sandbox_') ||
    lower.includes('tooltip_') ||
    lower.includes('recipe_') ||
    lower.includes('ui_modexporter') ||
    lower.includes('text_')
  );
};

export const formatLogDisplayName = (file: LogFileInfoUI): string => {
  if (file.is_active_console || file.file_name.toLowerCase().startsWith('console.txt')) {
    if (file.modified_timestamp) {
      const d = new Date(file.modified_timestamp * 1000);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return `console.txt (${dateStr})`;
    }
    return 'console.txt (On Disk)';
  }
  return file.file_name;
};

export const SandboxModule: React.FC<SandboxModuleProps> = ({
  paths,
  mods,
  onRefreshMods,
  errorCards,
  onOpenMerger,
  onSwitchOffMod,
  onPatchMod,
  onClearErrorCards,
  onDismissErrorCard,
  onGoToSettings,
}) => {
  // The companion bridge is a developer feature; its log filter follows the same switch.
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => localStorage.getItem('pz_show_advanced') === 'true');
  useEffect(() => {
    const onChange = (e: Event) => setShowAdvanced(Boolean((e as CustomEvent).detail));
    window.addEventListener('pzms-advanced-changed', onChange);
    return () => window.removeEventListener('pzms-advanced-changed', onChange);
  }, []);

  const [filterSpam, setFilterSpam] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<LogSeverityFilter>('ALL');
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedCardId, setCopiedCardId] = useState<string | null>(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState<boolean>(false);
  const [availableLogs, setAvailableLogs] = useState<LogFileInfoUI[]>([]);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  /**
   * Gathers everything about one error into a file. The log the Monitor already holds goes in as
   * context, so whoever reads it can see what led up to the error.
   */
  const buildReportFor = async (card: TranslatedErrorCard): Promise<string | null> => {
    const lines = (tabs.find((t) => t.isLive) ?? tabs[0])?.lines ?? [];
    const at = lines.findIndex((l) => l === card.raw_error);
    const from = at >= 0 ? Math.max(0, at - 15) : Math.max(0, lines.length - 20);
    const to = at >= 0 ? Math.min(lines.length, at + 10) : lines.length;
    try {
      return await TauriService.buildErrorReport(paths, {
        rawError: card.raw_error,
        title: card.title,
        explanation: card.explanation,
        modName: card.mod_name ?? null,
        sourceFile: card.source_file ?? null,
        logContext: lines.slice(from, to),
      });
    } catch (err) {
      reportBackendError('Writing the error report', err);
      return null;
    }
  };

  const handleSaveReport = async (card: TranslatedErrorCard) => {
    const report = await buildReportFor(card);
    if (!report) return;
    const slug = (card.mod_name ?? 'error').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const path = await TauriService.pickSaveFile(`pz-error-${slug || 'report'}.md`, 'Markdown (.md)', 'md');
    if (!path) return;
    try {
      await TauriService.saveTextFile(path, report);
      setSaveStatus(`Saved to ${path}`);
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (err) {
      reportBackendError('Saving the error report', err);
    }
  };

  const handleCopyReport = async (card: TranslatedErrorCard) => {
    const report = await buildReportFor(card);
    if (!report) return;
    await navigator.clipboard.writeText(report);
    setSaveStatus('Report copied to the clipboard');
    setTimeout(() => setSaveStatus(null), 4000);
  };

  const handleInspectInConsole = (card: TranslatedErrorCard) => {
    let term = '';
    if (card.source_file) {
      term = card.source_file.split(/[/|\\]/).pop() || '';
    } else if (card.raw_error) {
      const match = card.raw_error.match(/([a-zA-Z0-9_]+\.lua|[a-zA-Z0-9_]+Exception|[a-zA-Z0-9_]+State|isLocalPlayer|ToggleDoor|BWORoomPrograms)/);
      term = match ? match[1] : card.raw_error.slice(0, 25);
    }
    setSearchQuery(term);
    setSeverityFilter('ALL');
  };

  const handleCopyCardSnippet = (cardId: string, snippet: string) => {
    navigator.clipboard.writeText(snippet);
    setCopiedCardId(cardId);
    setTimeout(() => setCopiedCardId(null), 2000);
  };

  // Tabs state with permanent Client and Dedicated Server tabs
  const [tabs, setTabs] = useState<LogTab[]>([
    {
      id: 'live_console',
      title: '🔴 console.txt (Client)',
      isLive: true,
      // What the app has streamed so far: leaving this tab and coming back loses nothing.
      lines: [...LIVE_CONSOLE_HEADER, ...liveConsoleLines()],
    },
    {
      id: 'live_server',
      title: '🖥️ Dedicated Server (Live)',
      isLive: true,
      lines: [
        '[PZ Monitor Center] Dedicated server monitor ready.',
        '[PZ Monitor Center] Dedicated server is currently offline. Start the server in "SERVERS" tab to begin live monitoring.',
      ],
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('live_console');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [clearedOffsets, setClearedOffsets] = useState<Record<string, number>>({});

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    if (isAddMenuOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isAddMenuOpen]);

  // Dedicated Server live log polling (only streams when server is running)
  useEffect(() => {
    if (!paths.user_zomboid_dir) return;

    let isMounted = true;
    const fetchServerLogs = async () => {
      try {
        const srvStatus = await TauriService.getDedicatedServerStatus(paths.user_zomboid_dir);
        if (!isMounted) return;

        if (srvStatus.is_running) {
          const srvLines = await TauriService.getDedicatedServerLogs(paths.user_zomboid_dir, 1500);
          if (srvLines && srvLines.length > 0 && isMounted) {
            const cleaned = srvLines.map((l) =>
              l.replace(/^\[\d{2}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/, '')
            );
            setTabs((prev) =>
              prev.map((t) => (t.id === 'live_server' ? { ...t, lines: cleaned } : t))
            );
          }
        } else {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === 'live_server' && t.lines.length > 2
                ? {
                    ...t,
                    lines: [
                      '[PZ Monitor Center] Dedicated server monitor ready.',
                      '[PZ Monitor Center] Dedicated server is currently offline. Start the server in "SERVERS" tab to begin live monitoring.',
                    ],
                  }
                : t
            )
          );
        }
      } catch (err) {
        console.warn('Dedicated server log poll error:', err);
      }
    };

    fetchServerLogs();
    const interval = setInterval(fetchServerLogs, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [paths.user_zomboid_dir]);

  // The live tab mirrors the app-wide console store, which keeps streaming while this tab is away.
  useEffect(() => {
    startLiveConsole();
    return subscribeLiveConsole(() => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === 'live_console' ? { ...t, lines: [...LIVE_CONSOLE_HEADER, ...liveConsoleLines()] } : t
        )
      );
    });
  }, []);

  // Fetch available log files when opening dropdown
  const handleOpenAddMenu = async () => {
    setIsAddMenuOpen((prev) => !prev);
    if (!isAddMenuOpen && paths.user_zomboid_dir) {
      const files = await TauriService.listAvailableLogFiles(paths.user_zomboid_dir);
      setAvailableLogs(files);
    }
  };

  const handleOpenLogFile = async (logFile: LogFileInfoUI) => {
    setIsAddMenuOpen(false);
    // Check if already open
    const existing = tabs.find((t) => t.filePath === logFile.absolute_path);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    const displayName = formatLogDisplayName(logFile);
    const lines = await TauriService.readLogFile(logFile.absolute_path, 2000);
    const newTab: LogTab = {
      id: `log_${Date.now()}`,
      title: displayName,
      isLive: false,
      filePath: logFile.absolute_path,
      lines: lines.length > 0 ? lines : ['(The log file is empty)'],
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const handlePickCustomLog = async () => {
    setIsAddMenuOpen(false);
    const filePath = await TauriService.pickOpenFile('PZ Log File', 'txt');
    if (!filePath) return;

    const fileName = filePath.split(/[/\\]/).pop() || 'External Log';
    const lines = await TauriService.readLogFile(filePath, 2000);
    const newTab: LogTab = {
      id: `custom_${Date.now()}`,
      title: fileName,
      isLive: false,
      filePath,
      lines: lines.length > 0 ? lines : ['(The log file is empty)'],
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const isPermanentTab = (tabId: string) => tabId === 'live_console' || tabId === 'live_server';

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPermanentTab(tabId)) return;
    const remaining = tabs.filter((t) => t.id !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining[remaining.length - 1].id);
    }
  };

  const handleSaveSnapshot = async () => {
    if (!paths.user_zomboid_dir) return;
    try {
      const serverName = activeTab.id === 'live_server' ? 'servertest' : 'console_snapshot';
      const savedPath = await TauriService.saveServerLogSnapshot(
        paths.user_zomboid_dir,
        serverName,
        activeTab.lines
      );
      const filename = savedPath.split(/[/\\]/).pop() || savedPath;
      setSaveStatus(filename);
      setTimeout(() => setSaveStatus(null), 3500);
      const files = await TauriService.listAvailableLogFiles(paths.user_zomboid_dir);
      setAvailableLogs(files);
    } catch (err: any) {
      alert(`Error saving log snapshot: ${explainError(err)}`);
    }
  };

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  /**
   * How many error lines of each shape the log in front of you holds, so a card can say whether
   * it happened once or six hundred times. Counted from the log itself rather than remembered as
   * cards arrive, so it is the same for a live session and a log loaded from disk.
   */
  const errorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const line of activeTab?.lines ?? []) {
      if (!line.startsWith('ERROR')) continue;
      total += 1;
      const shape = errorShape(line);
      counts.set(shape, (counts.get(shape) ?? 0) + 1);
    }
    return { counts, total, distinct: counts.size };
  }, [activeTab?.lines]);

  const timesSeen = (card: TranslatedErrorCard) => errorCounts.counts.get(errorShape(card.raw_error)) ?? 0;

  /**
   * What threw and what merely complained, kept apart: seven `require` warnings under a red
   * "Action Required" made a list that played fine look broken. The level the game wrote the
   * line at is the measure, and the cards that threw come first.
   */
  const isWarning = (card: TranslatedErrorCard) => card.severity === 'WARNING';

  /** The log names a mod by its display name; the Merger needs its id. */
  const modIdNamed = (name: string | null | undefined): string | null => {
    if (!name) return null;
    const hit = mods.find((m) => m.name === name || m.mod_id === name);
    return hit ? hit.mod_id : null;
  };
  /** `ZombiesAmputation.lua` from a card's source file, for the Merger to find in the mod. */
  const fileNamed = (card: TranslatedErrorCard): string | null =>
    card.source_file ? card.source_file.split(/[/\\]/).pop() || null : null;
  const exceptionCards = useMemo(() => errorCards.filter((c) => !isWarning(c)), [errorCards]);
  const warningCards = useMemo(() => errorCards.filter(isWarning), [errorCards]);
  const orderedCards = useMemo(() => [...exceptionCards, ...warningCards], [exceptionCards, warningCards]);

  /**
   * `require("X") failed` is the commonest complaint in a Build 42 log and says nothing you can
   * act on by itself. The module is usually still there under another path, sometimes in another
   * mod, sometimes nowhere at all -- and which of the three it is decides what to do about it.
   * Looked up for every such card at once, since the index costs the same for one or twenty.
   */
  const [requireAnswers, setRequireAnswers] = useState<Record<string, RequireAnswer>>({});

  const moduleWanted = (card: TranslatedErrorCard): string | null => {
    const found = card.raw_error.match(/require\(\s*["']([^"']+)["']\s*\)/);
    return found ? found[1] : null;
  };
  /**
   * "Fix the path" from the card, with no trip to the Merger: the file is read from the mod, the
   * require rewritten, and the result published into the package in place -- the package stays
   * packaged, nothing is unpacked. What the card then says is what happened, and what is left
   * (relaunch the game) is the only step the Studio cannot take.
   */
  const [fixNotes, setFixNotes] = useState<Record<string, string>>({});
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixedBanner, setFixedBanner] = useState<string | null>(null);
  const handleFixPath = async (card: TranslatedErrorCard, modId: string, fileHint: string, fix: { from: string; to: string }) => {
    setFixing(card.id);
    try {
      const files = await TauriService.modFiles(paths, modId);
      const hint = fileHint.toLowerCase();
      const named = files.find((f) => {
        const p = f.relative_path.toLowerCase();
        return p === hint || p.endsWith('/' + hint);
      });
      if (!named) {
        // Not a file this build reads from the mod: the Merger's picker is the place to look.
        onPatchMod?.(modId, fileHint, fix);
        return;
      }
      const opened = await TauriService.modFileToPatch(paths, modId, named.relative_path);
      const fixed = applyRequireFix(opened.merged_output || opened.base_content, fix);
      if (!fixed) {
        onPatchMod?.(modId, fileHint, fix);
        return;
      }
      const packages = await TauriService.listMergedPackages(paths.user_zomboid_dir || '', paths.mod_list_ini_path || '');
      const folder = packageForPatch(packages);
      const result = await TauriService.publishFileIntoPackage(paths, folder, opened.relative_path, fixed.content);
      const display = packages.find((p) => p.folder_name === folder)?.display_name ?? folder;
      // Done: the card goes, and one line above the list says what happened and what is left.
      setFixedBanner(
        `${fileHint} fixed — line ${fixed.line} now asks for ${fix.to} — and published in ${display} (${result.files_written} files). Relaunch the game; this warning should not come back.`
      );
      onDismissErrorCard?.(card.id);
      onRefreshMods();
    } catch (err) {
      setFixNotes((prev) => ({ ...prev, [card.id]: explainError(err) }));
    } finally {
      setFixing(null);
    }
  };

  /** A `require` the Studio found at another path: the fix is known before the file is opened. */
  const knownFix = (card: TranslatedErrorCard): { from: string; to: string } | null => {
    const wanted = moduleWanted(card);
    const best = wanted ? requireAnswers[wanted]?.candidates[0] : undefined;
    return wanted && best && !best.same_path ? { from: wanted, to: best.module_path } : null;
  };

  useEffect(() => {
    const wanted = Array.from(
      new Set(errorCards.map(moduleWanted).filter((w): w is string => !!w))
    ).filter((w) => !(w in requireAnswers));
    if (wanted.length === 0 || !paths.is_valid) return;
    let alive = true;
    void (async () => {
      const answers = await TauriService.resolveFailedRequires(paths, wanted);
      if (!alive) return;
      setRequireAnswers((current) => {
        const next = { ...current };
        for (const a of answers) next[a.wanted] = a;
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [errorCards, paths.is_valid]);

  /**
   * The mod a card belongs to when the error line itself does not say.
   *
   * The game writes `ERROR ... Exception thrown` first and the stack trace after it, and it is
   * the frames that carry `Lua((MOD:Name))`. The backend only sees one line at a time, so it
   * cannot look ahead; here the whole log is in front of us, so the frames just below the error
   * are read for the name.
   */
  const modFromStack = (card: TranslatedErrorCard): string | null => {
    const lines = activeTab?.lines ?? [];
    const at = lines.findIndex((l) => l.includes(card.raw_error.trim()));
    if (at < 0) return null;
    for (const line of lines.slice(at, at + 30)) {
      const found = line.match(/Lua\(\(MOD:(.+?)\)\)/);
      if (found) return found[1];
    }
    return null;
  };

  // Filter lines dynamically
  const filteredLines = useMemo(() => {
    if (!activeTab) return [];
    const raw = activeTab.lines;
    const offset = clearedOffsets[activeTab.id] || 0;
    let list = offset > 0 ? (offset >= raw.length ? [] : raw.slice(offset)) : raw;

    // 1. Spam filter
    if (filterSpam) {
      list = list.filter((line) => !isTranslationSpamLine(line));
    }

    // 2. Severity filter
    if (severityFilter === 'ERRORS') {
      list = list.filter((l) =>
        /exception|error|stack trace|crash|nullpointer|failed|kahlua/i.test(l)
      );
    } else if (severityFilter === 'LUA') {
      list = list.filter((l) => /lua|function|require|script/i.test(l));
    } else if (severityFilter === 'JAVA') {
      list = list.filter((l) => /java|\.java|jvm|kahlua|zombie\./i.test(l));
    } else if (severityFilter === 'BRIDGE') {
      list = list.filter((l) => /pzmodstudio|bridge|companion/i.test(l));
    }

    // 3. Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((l) => l.toLowerCase().includes(q));
    }

    return list;
  }, [activeTab, filterSpam, severityFilter, searchQuery, clearedOffsets]);

  const handleClearActiveTab = () => {
    if (!activeTab) return;
    setClearedOffsets((prev) => ({
      ...prev,
      [activeTabId]: activeTab.lines.length,
    }));
  };

  const handleCopyLogs = () => {
    const text = filteredLines.join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-scroll terminal to bottom when new lines arrive in live mode
  useEffect(() => {
    if (activeTab?.isLive && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [filteredLines.length, activeTabId]);

  if (!paths.is_valid) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200 font-sans">
        <div className="max-w-md w-full bg-slate-900/80 border border-amber-500/40 rounded-2xl p-6 text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto">
            <FolderX className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Setup Required: Game Directory</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Project Zomboid installation directory must be configured in App Settings before launching a Monitored Game Session.
            </p>
          </div>
          <button
            onClick={onGoToSettings}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs py-2.5 rounded-lg shadow transition cursor-pointer"
          >
            Configure Directory Paths in Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden p-6 font-sans min-h-0">
      {/* Module Header & Controls */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-3 shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <span>Monitor Center & Crash Diagnostics</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time monitoring, multi-tab log viewer, and automated repair of Java/Lua exceptions.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Open Real Logs Folder */}
          <button
            onClick={() => TauriService.openLogsFolder(paths.user_zomboid_dir)}
            className="px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow"
            title="Open the physical logs folder (console.txt and Logs/ subfolder) in Windows Explorer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>📁 Logs Folder</span>
          </button>

          {/* Spam Filter Toggle */}
          <button
            onClick={() => setFilterSpam(!filterSpam)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition cursor-pointer flex items-center gap-1.5 shadow ${
              filterSpam
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700 shadow-emerald-950/40'
                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
            title="Filter or hide missing translation spam"
          >
            <Filter className={`w-3.5 h-3.5 ${filterSpam ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span>{filterSpam ? 'Spam Filter: ACTIVE' : 'Filter: SHOW ALL'}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Console Terminal Watcher (Left) vs Actionable Cards (Right) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-0 overflow-hidden">
        {/* Left Column (7 cols): Realtime & Historical Multi-Tab Log Inspector */}
        <div className="lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col shadow relative min-h-0 overflow-hidden">
          {/* Top Tabs Bar */}
          <div className="bg-slate-950 border-b border-slate-800 flex items-center justify-between px-2 pt-1.5 shrink-0 gap-2 relative z-30">
            {/* Tabs List (Only the tabs scroll horizontally if there are many) */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 min-w-0">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTabId(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium border-t border-x transition cursor-pointer shrink-0 max-w-[200px] truncate ${
                      isActive
                        ? 'bg-slate-900 text-emerald-400 border-slate-700 font-bold shadow'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/50'
                    }`}
                  >
                    <span className="truncate">{tab.title}</span>
                    {!isPermanentTab(tab.id) && (
                      <span
                        onClick={(e) => handleCloseTab(tab.id, e)}
                        className="text-slate-500 hover:text-red-400 rounded-full p-0.5"
                        title="Close tab"
                      >
                        <X className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Fixed Right Actions (Add Log Button + Menu + Save Snapshot + Copy + Clear) */}
            <div className="flex items-center gap-1.5 pb-1 shrink-0 relative">
              {saveStatus && (
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-1 rounded border border-emerald-700/60 animate-fade-in truncate max-w-[130px]" title={`Saved: ${saveStatus}`}>
                  ✅ Saved
                </span>
              )}

              {/* Add New Tab Dropdown Button */}
              <div className="relative" ref={addMenuRef}>
                <button
                  onClick={handleOpenAddMenu}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md transition cursor-pointer"
                  title="Open or load another log file"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Load Log</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {isAddMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 p-2 space-y-1 animate-fade-in text-xs select-none">
                    <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                      Available Logs in Zomboid/
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1">
                      {availableLogs.length === 0 ? (
                        <div className="p-2 text-slate-500 text-center">Searching for logs on disk...</div>
                      ) : (
                        availableLogs.map((item) => (
                          <button
                            key={item.absolute_path}
                            onClick={() => handleOpenLogFile(item)}
                            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-800 text-slate-200 text-left transition cursor-pointer group"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span className="truncate">{formatLogDisplayName(item)}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono shrink-0 ml-2">
                              {(item.size_bytes / 1024).toFixed(0)} KB
                            </span>
                          </button>
                        ))
                      )}
                    </div>

                    <div className="border-t border-slate-800 pt-1">
                      <button
                        onClick={handlePickCustomLog}
                        className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-emerald-950/60 text-emerald-300 font-medium transition cursor-pointer text-left"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>📂 Browse another file (.txt)...</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Save Snapshot to Zomboid/Logs */}
              <button
                onClick={handleSaveSnapshot}
                className="p-1.5 text-slate-400 hover:text-emerald-400 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition cursor-pointer"
                title="Save current log snapshot to Zomboid/Logs/ as 'servertest - YYYY-MM-DD_HH-mm-ss.txt'"
              >
                <Save className="w-3.5 h-3.5 text-emerald-400" />
              </button>

              {/* Copy logs */}
              <button
                onClick={handleCopyLogs}
                className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition cursor-pointer"
                title="Copy visible log to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              {/* Clear logs */}
              <button
                onClick={handleClearActiveTab}
                className="p-1.5 text-slate-400 hover:text-red-400 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition cursor-pointer"
                title="Clear viewer for this tab"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Search & Severity Filters Bar */}
          <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search keyword (e.g., isCorpse, NullPointer, M4, GunFighter)..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-7 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Severity Filter Chips */}
            <div className="flex items-center gap-1 font-mono text-[11px]">
              <button
                onClick={() => setSeverityFilter('ALL')}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  severityFilter === 'ALL'
                    ? 'bg-slate-700 text-slate-100 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setSeverityFilter('ERRORS')}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  severityFilter === 'ERRORS'
                    ? 'bg-red-950 text-red-300 border border-red-800 font-bold'
                    : 'text-slate-400 hover:text-red-400'
                }`}
              >
                🚨 Errors
              </button>
              <button
                onClick={() => setSeverityFilter('LUA')}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  severityFilter === 'LUA'
                    ? 'bg-blue-950 text-blue-300 border border-blue-800 font-bold'
                    : 'text-slate-400 hover:text-blue-400'
                }`}
              >
                🌙 Lua
              </button>
              <button
                onClick={() => setSeverityFilter('JAVA')}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  severityFilter === 'JAVA'
                    ? 'bg-amber-950 text-amber-300 border border-amber-800 font-bold'
                    : 'text-slate-400 hover:text-amber-400'
                }`}
              >
                ☕ Java
              </button>
              {showAdvanced && (
              <button
                onClick={() => setSeverityFilter('BRIDGE')}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  severityFilter === 'BRIDGE'
                    ? 'bg-purple-950 text-purple-300 border border-purple-800 font-bold'
                    : 'text-slate-400 hover:text-purple-400'
                }`}
              >
                ⚡ Bridge
              </button>
              )}
            </div>
          </div>

          {/* Log Lines Terminal Area */}
          <div ref={terminalContainerRef} className="flex-1 p-3 font-mono text-xs bg-slate-950 overflow-y-auto space-y-1 select-text min-h-0">
            {filteredLines.length === 0 ? (
              <div className="p-6 text-center text-slate-500 space-y-1">
                <Search className="w-6 h-6 mx-auto text-slate-600 mb-1" />
                <p>No lines found matching the filters.</p>
                {searchQuery && (
                  <p className="text-[11px] text-slate-600">
                    Try changing or clearing the search term: "{searchQuery}"
                  </p>
                )}
              </div>
            ) : (
              filteredLines.map((log, idx) => {
                const isErr = /exception|error|stack trace|crash|nullpointer|failed/i.test(log);
                const isWarn = /warning|warn/i.test(log);
                const isBridge = /pzmodstudio|bridge/i.test(log);

                return (
                  <div
                    key={idx}
                    className={`leading-relaxed px-2 py-0.5 rounded text-[11px] ${
                      isErr
                        ? 'text-red-400 font-bold bg-red-950/30 border-l-2 border-red-500'
                        : isWarn
                        ? 'text-amber-300 bg-amber-950/20 border-l-2 border-amber-500'
                        : isBridge
                        ? 'text-purple-300 bg-purple-950/20 border-l-2 border-purple-500'
                        : 'text-slate-300 hover:bg-slate-900/60'
                    }`}
                  >
                    {log}
                  </div>
                );
              })
            )}
          </div>

          {/* Terminal Footer Bar */}
          <div className="bg-slate-900 px-3 py-1.5 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono shrink-0">
            <span>
              Lines: {filteredLines.length} / {activeTab.lines.length}
            </span>
            {searchQuery && (
              <span className="text-emerald-400">
                Active filter: "{searchQuery}"
              </span>
            )}
            {activeTab.filePath && (
              <span className="truncate max-w-xs text-slate-500" title={activeTab.filePath}>
                {activeTab.filePath}
              </span>
            )}
          </div>
        </div>

        {/* Right Column (5 cols): Actionable Crash Diagnostics Cards */}
        <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow p-4 space-y-3 min-h-0">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div>
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <span>DIAGNOSTICS</span>
                {exceptionCards.length > 0 && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-mono"
                    title="Something threw: the game wrote these at ERROR level or as a stack trace"
                  >
                    {exceptionCards.length} {exceptionCards.length === 1 ? 'exception' : 'exceptions'} · Action Required
                  </span>
                )}
                {warningCards.length > 0 && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono"
                    title="The game noticed and carried on: WARN lines that name a mod"
                  >
                    {warningCards.length} {warningCards.length === 1 ? 'warning' : 'warnings'}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {exceptionCards.length > 0 ? (
                  <>
                    {errorCounts.total.toLocaleString()} error lines in this log are{' '}
                    {errorCounts.distinct} different problems: the game writes the same failure
                    again every time it happens.
                  </>
                ) : warningCards.length > 0 ? (
                  <>
                    Nothing threw in this log: the game carried on past every line below.
                    {errorCounts.total > 0 && (
                      <>
                        {' '}It also wrote {errorCounts.total.toLocaleString()} ERROR lines of{' '}
                        {errorCounts.distinct} {errorCounts.distinct === 1 ? 'shape' : 'shapes'} that
                        name no mod and match no rule here; the Errors filter on the left shows them.
                      </>
                    )}
                  </>
                ) : errorCounts.total > 0 ? (
                  <>
                    {errorCounts.total.toLocaleString()} ERROR lines of {errorCounts.distinct}{' '}
                    {errorCounts.distinct === 1 ? 'shape' : 'shapes'}, none naming a mod or matching a
                    rule here; the Errors filter on the left shows them.
                  </>
                ) : (
                  <>Exceptions the game throws and warnings it names a mod on, as they happen.</>
                )}
              </p>
            </div>

            {errorCards.length > 0 ? (
              <button
                onClick={onClearErrorCards}
                className="text-[10px] text-slate-400 hover:text-slate-200 font-mono bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2 py-1 rounded transition cursor-pointer flex items-center gap-1"
                title="Discard all cards"
              >
                <Trash2 className="w-3 h-3 text-slate-400" />
                <span>Discard</span>
              </button>
            ) : (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                <CheckCircle className="w-3.5 h-3.5" /> Nothing threw
              </span>
            )}
          </div>

          {fixedBanner && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-950/50 border border-emerald-700/60 text-[11px] text-emerald-200 leading-relaxed shrink-0">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="flex-1">{fixedBanner}</span>
              <button
                type="button"
                onClick={() => setFixedBanner(null)}
                className="text-emerald-400 hover:text-emerald-200 cursor-pointer"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* For what the log cannot name: halve the list until one mod is left. */}
          <BisectPanel
            paths={paths}
            mods={mods}
            onRefreshMods={onRefreshMods}
            cards={errorCards}
            onInspect={(term) => {
              setSearchQuery(term);
              setSeverityFilter('ALL');
            }}
            onPatchMod={onPatchMod}
          />

          <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
            {errorCards.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2.5">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/40 border border-emerald-800/40 flex items-center justify-center text-emerald-400">
                  <CheckCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-slate-300">Nothing to report</p>
                  <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
                    A card appears when the game throws, or when it writes a warning and names the
                    mod. Everything else in the console stays on the left.
                  </p>
                </div>
              </div>
            ) : (
              orderedCards.map((card) => (
                <div
                  key={card.id}
                  className={
                    isWarning(card)
                      ? 'bg-slate-950 border border-amber-500/30 rounded-xl p-4 space-y-3 shadow-md hover:border-amber-500/60 transition'
                      : 'bg-slate-950 border border-red-500/40 rounded-xl p-4 space-y-3 shadow-md hover:border-red-500/70 transition'
                  }
                >
                  <div className="flex items-start gap-2.5">
                    {isWarning(card) ? (
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-bold text-slate-100">
                          {card.title}
                          {isWarning(card) && (
                            <span
                              className="ml-2 align-middle text-[10px] font-mono font-normal px-1.5 py-0.5 rounded border border-amber-700/60 bg-amber-950/40 text-amber-300"
                              title="The game wrote this at WARN level: it noticed and carried on"
                            >
                              warning · the game carried on
                            </span>
                          )}
                        </h4>
                        {timesSeen(card) > 1 && (
                          <span
                            className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-red-800/70 bg-red-950/50 text-red-300"
                            title={`This error is in the log ${timesSeen(card)} times${
                              errorCounts.total > 0
                                ? ` \u2014 ${Math.round((timesSeen(card) / errorCounts.total) * 100)}% of every error line`
                                : ''
                            }. The ones that repeat are the ones worth fixing first.`}
                          >
                            {timesSeen(card).toLocaleString()}\u00d7
                          </span>
                        )}
                      </div>
                      {(card.mod_name ?? modFromStack(card)) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-700/60 text-amber-300"
                            title={
                              card.mod_name
                                ? 'The game named this mod on the log line'
                                : 'The game named this mod in the stack trace under the error'
                            }
                          >
                            {card.mod_name ?? modFromStack(card)}
                          </span>
                          {(card.mod_name ?? '').startsWith(STUDIO_PACKAGE_PREFIX) ? (
                            /* The package's patched copy of a mod file: the Merger is where it lives. */
                            <button
                              type="button"
                              onClick={onOpenMerger}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-amber-700/60 text-amber-200 hover:bg-amber-950/40 cursor-pointer flex items-center gap-1"
                              title="This line comes from the package's copy of the file. Open the Merger to change the patch or unmerge it."
                            >
                              <Wrench className="w-3 h-3" aria-hidden="true" />
                              Open in the Merger
                            </button>
                          ) : onPatchMod &&
                            modIdNamed(card.mod_name ?? modFromStack(card)) &&
                            /* A warning the Studio has no fix for gets no button: pressing one
                               led to saving an unchanged copy, which fixes nothing. */
                            (!isWarning(card) || knownFix(card)) && (
                            <button
                              type="button"
                              onClick={() => {
                                const modId = modIdNamed(card.mod_name ?? modFromStack(card))!;
                                const file = fileNamed(card);
                                const fix = file ? knownFix(card) : null;
                                if (file && fix) void handleFixPath(card, modId, file, fix);
                                else onPatchMod(modId, file, null);
                              }}
                              disabled={fixing === card.id}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-amber-700/60 text-amber-200 hover:bg-amber-950/40 cursor-pointer flex items-center gap-1 disabled:opacity-50"
                              title={
                                fileNamed(card) && knownFix(card)
                                  ? `Change the require in ${fileNamed(card)} to the path the module has now and publish it into the package, in place. The mod stays on; relaunch the game afterwards.`
                                  : fileNamed(card)
                                  ? `Open ${fileNamed(card)} from this mod in the Merger and patch it. The mod stays on; the package loads last, so the game reads your copy of that one file.`
                                  : 'Open this mod in the Merger and pick a file to patch. The mod stays on; the package loads last.'
                              }
                            >
                              <Wrench className="w-3 h-3" aria-hidden="true" />
                              {fixing === card.id
                                ? 'Fixing…'
                                : fileNamed(card) && knownFix(card)
                                ? `Fix the path in ${fileNamed(card)}`
                                : fileNamed(card)
                                ? `Patch ${fileNamed(card)}`
                                : 'Patch a file of it'}
                            </button>
                          )}
                          {fixNotes[card.id] && (
                            <div className="basis-full text-[10px] text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded px-2 py-1 leading-relaxed">
                              {fixNotes[card.id]}
                            </div>
                          )}
                          {onSwitchOffMod && !(card.mod_name ?? '').startsWith(STUDIO_PACKAGE_PREFIX) && (
                            <button
                              type="button"
                              onClick={() => onSwitchOffMod((card.mod_name ?? modFromStack(card))!)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                              title={`Switch ${card.mod_name ?? modFromStack(card)} off in the Mod List, to see whether it is the cause`}
                            >
                              Switch it off
                            </button>
                          )}
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        {card.explanation}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-900 p-2.5 rounded-lg font-mono text-[11px] text-red-300 border border-slate-800 select-text">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Log Snippet</div>
                    <div className="truncate">{card.raw_error}</div>
                  </div>

                  {/* Where the module it asked for actually is. */}
                  {(() => {
                    const wanted = moduleWanted(card);
                    const answer = wanted ? requireAnswers[wanted] : undefined;
                    if (!answer) return null;
                    const best = answer.candidates[0];
                    return (
                      <div className="px-2.5 py-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 leading-relaxed space-y-1">
                        <div>{answer.summary}</div>
                        {best && !best.same_path && (
                          <div className="font-mono text-[10px] text-emerald-300">
                            {answer.wanted} &rarr; {best.module_path}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {card.polyfill_rule_id_suggestion ? (
                    <button
                      onClick={onOpenMerger}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
                      title="The Build 42 shim ships inside a merge package: build one in the Mod Merger"
                    >
                      <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>A merge package may fix this — open the Mod Merger</span>
                    </button>
                  ) : card.mod_name ? (
                    /* The game named a mod: say what to do about that, not what the shim covers. */
                    <div className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                      {card.recommended_action}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-[11px] text-emerald-300">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                      <span>The Build 42 shim already covers this</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      onClick={() => handleSaveReport(card)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium transition cursor-pointer"
                      title="Writes a file with the error, your game build, the mod and the code, ready to hand to someone or to an AI assistant"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Save report</span>
                    </button>
                    <button
                      onClick={() => handleCopyReport(card)}
                      className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium transition cursor-pointer"
                      title="Copies the same report to the clipboard"
                    >
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Copy report</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      onClick={() => handleInspectInConsole(card)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium transition cursor-pointer"
                      title="Jump to this error in the console logs"
                    >
                      <Search className="w-3 h-3 text-cyan-400" />
                      <span>🔍 Inspect in Logs</span>
                    </button>
                    <button
                      onClick={() => handleCopyCardSnippet(card.id, card.raw_error)}
                      className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 text-[11px] font-medium transition cursor-pointer"
                      title="Copy error snippet to clipboard"
                    >
                      {copiedCardId === card.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-slate-400" />
                          <span>Copy the line</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
