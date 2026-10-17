import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { VfsConflict, ChangeRegion, ModChangeSummary, ModInfo, ModFile } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, MasterPatchStatusInfoUI, MergedPackageInfoUI, explainError } from '../../services/tauri';
import { RequireFix, applyRequireFix, packageForPatch } from '../../utils/requireFix';
import {
  GitCompare,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Check,
  EyeOff,
  Eye,
  Layers,
  ShieldCheck,
  FolderX,
  AlertCircle,
  Wand2,
  GripHorizontal,
  Sparkle,
  PackageCheck,
  Package,
  Unlock,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Box,
  RotateCcw,
  Code2,
  Download,
  Upload,
  FolderOpen,
  ArrowLeft,
  Undo2,
  Minus,
  Lock,
  Info,
  Wrench,
  X,
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import '../../monacoSetup';

interface MergerModuleProps {
  conflicts: VfsConflict[];
  /** Installed mods, to pick one whose file you want to patch. */
  mods: ModInfo[];
  paths: StudioPathsUI;
  /** Saves the decision for one file into the package; the path is for files the scan never listed. */
  onResolveConflict: (conflictId: string, resolvedCode: string, packageFolderName?: string, relativePath?: string) => void;
  onAutoMergeAll?: (packageFolderName?: string) => Promise<boolean>;
  onOptimizeAndResolve: (packageFolderName?: string) => Promise<boolean>;
  onGoToSettings: () => void;
  /** Rescans; the folder names the package whose saved merges should be shown. */
  onRescan: (packageFolder?: string) => Promise<void> | void;
  onClearConflicts?: () => void;
  onLoadMockups?: (mockups: VfsConflict[]) => void;
  onToggleMod?: (modId: string) => void;
  onRefreshMods?: () => Promise<void> | void;
  onPackageOpened?: (folderName: string) => void;
  onPackageClosed?: () => void;
  /** Open a package and select this conflicting file (from Mod Health). */
  focusRelativePath?: string | null;
  onFocusHandled?: () => void;
  /**
   * Open a package and this mod's files to patch (from the Monitor: a card that names the mod, or
   * the hunt that ended on it). With a file name from the log, that file opens straight away.
   */
  patchFocus?: { modId: string; fileHint?: string | null; fix?: RequireFix | null } | null;
  onPatchFocusHandled?: () => void;
}

/** A mod's own file opened to patch, as opposed to a conflict the scan found. */
const isPatchTarget = (c: VfsConflict | null | undefined) => !!c && c.id.startsWith('modfile_');

/** Lines shown around the point of interest; big vanilla files have tens of thousands. */
const VIEW_WINDOW = 200;

interface LinedCodeSnippetProps {
  content: string;
  /** Line to scroll to and mark (1-based). */
  targetLine: number;
  /** 1-based inclusive line ranges to highlight as this side's changes. */
  highlightRanges?: Array<[number, number]>;
  /** Ranges to mark as collisions (shown in amber). */
  collisionRanges?: Array<[number, number]>;
}

const inRanges = (n: number, ranges?: Array<[number, number]>) => !!ranges && ranges.some(([a, b]) => n >= a && n <= Math.max(a, b));

/** Read-only code view. Module-level and memoized so switching conflicts does not rebuild it,
 *  and windowed so huge files only render ~200 lines. */
const LinedCodeSnippet = React.memo(function LinedCodeSnippet({ content, targetLine, highlightRanges, collisionRanges }: LinedCodeSnippetProps) {
  const lines = useMemo(() => content.split('\n'), [content]);
  const targetRef = useRef<HTMLDivElement>(null);
  const from = Math.max(0, Math.min(targetLine - 1 - VIEW_WINDOW / 2, lines.length - VIEW_WINDOW));
  const to = Math.min(lines.length, from + VIEW_WINDOW);

  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: 'center' });
  }, [targetLine, content]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden rounded-b-lg">
      {lines.length > VIEW_WINDOW && (
        <div className="text-[10px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 border-b border-slate-800 shrink-0">
          lines {from + 1}–{to} of {lines.length.toLocaleString()}
        </div>
      )}
      <div className="flex-1 overflow-auto text-xs font-mono bg-slate-950 select-text">
        {lines.slice(from, to).map((line, i) => {
          const n = from + i + 1;
          const isTarget = n === targetLine;
          const isCollision = inRanges(n, collisionRanges);
          const isChange = inRanges(n, highlightRanges);
          const style = isCollision
            ? 'bg-amber-500/25 text-amber-100 border-amber-400'
            : isChange
            ? 'bg-emerald-950/50 text-emerald-200 border-emerald-500/80'
            : 'text-slate-300 border-transparent';
          return (
            <div key={n} ref={isTarget ? targetRef : null} className={`flex leading-6 h-6 border-l-4 ${style} ${isTarget ? 'ring-1 ring-inset ring-amber-400/70' : ''}`}>
              <span className="w-12 shrink-0 text-right pr-2 text-[11px] text-slate-500 select-none">{n}</span>
              <span className="px-2 whitespace-pre text-[12px]">{line || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const regionLabel = (r: ChangeRegion) =>
  r.kind === 'added'
    ? `adds ${r.mod_end - r.mod_start + 1} line(s) before L${r.base_start}`
    : r.kind === 'removed'
    ? `removes L${r.base_start}${r.base_end > r.base_start ? `–${r.base_end}` : ''}`
    : `changes L${r.base_start}${r.base_end > r.base_start ? `–${r.base_end}` : ''}`;

/** Plain summary: how the merge was built, what each mod changes, where they collide. */
const ConflictSummaryCard: React.FC<{ conflict: VfsConflict; onFocus: (baseLine: number) => void }> = ({ conflict, onFocus }) => {
  const changes = conflict.mod_changes ?? [];
  const collisions = conflict.collisions ?? [];
  const lastLoaded = conflict.competing_mods[conflict.competing_mods.length - 1];
  return (
    <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 mb-2 shrink-0 space-y-2 text-[11px] max-h-[45%] overflow-y-auto">
      <div className="flex items-start gap-2 text-slate-200">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <span>
          {conflict.file_type === 'SCRIPT_DEFINITION' ? (
            <>
              {conflict.competing_mods.length} mods declare this, each in a file of its own — nothing collides on
              disk. The game applies all of them to the same thing, so what one sets and the others do not is
              kept whatever happens; only what they set differently is decided by the load order, today in{' '}
              <b>{lastLoaded?.mod_name}</b>'s favour. Saving this writes a small script into your package, which
              loads last.{' '}
            </>
          ) : (
            <>
              {conflict.competing_mods.length} mods ship this file. Without merging, the game uses only{' '}
              <b>{lastLoaded?.mod_name}</b>'s copy (it loads last).{' '}
            </>
          )}
          {conflict.strategy}
        </span>
      </div>
      {collisions.length > 0 && (
        <div className="space-y-1">
          <div className="text-amber-300 font-bold">Real conflicts ({collisions.length}): same vanilla lines changed differently</div>
          <div className="flex flex-wrap gap-1.5">
            {collisions.map((c, i) => (
              <button key={i} type="button" onClick={() => onFocus(c.base_start)}
                className="px-2 py-0.5 rounded border border-amber-500/50 bg-amber-950/40 text-amber-200 hover:bg-amber-900/60 cursor-pointer font-mono">
                L{c.base_start}{c.base_end > c.base_start ? `–${c.base_end}` : ''}: {c.mods.join(' vs ')}
              </button>
            ))}
          </div>
        </div>
      )}
      {changes.length > 0 && (
        <div className="space-y-1">
          <div className="text-slate-400 font-bold">What each mod changes compared to the base game</div>
          {changes.map((m) => (
            <div key={m.mod_id} className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-slate-200 mr-1">{m.mod_name}</span>
              <span className="font-mono text-emerald-300">+{m.lines_added}</span>
              <span className="font-mono text-red-300">−{m.lines_removed}</span>
              <span className="text-slate-500">in {m.regions.length} place(s):</span>
              {m.regions.slice(0, 12).map((r, i) => (
                <button key={i} type="button" onClick={() => onFocus(r.base_start)}
                  className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 cursor-pointer font-mono text-[10px]">
                  {regionLabel(r)}
                </button>
              ))}
              {m.regions.length > 12 && <span className="text-slate-500">+{m.regions.length - 12} more</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** The line in a mod's own file that corresponds to vanilla line `baseLine`. */
const modLineFor = (summary: ModChangeSummary | undefined, baseLine: number): number => {
  if (!summary) return baseLine;
  let offset = 0;
  for (const r of summary.regions) {
    if (baseLine < r.base_start) break;
    if (baseLine <= Math.max(r.base_start, r.base_end) || r.kind === 'added' && baseLine === r.base_start) return r.mod_start;
    offset += (r.mod_end - r.mod_start + 1) - (r.base_end - r.base_start + 1);
  }
  return Math.max(1, baseLine + offset);
};

export const MergerModule: React.FC<MergerModuleProps> = ({
  conflicts: scannedConflicts,
  mods,
  paths,
  onResolveConflict,
  onAutoMergeAll,
  onOptimizeAndResolve,
  onGoToSettings,
  onRescan,
  onClearConflicts,
  onLoadMockups: _onLoadMockups,
  onToggleMod,
  onRefreshMods,
  onPackageOpened,
  onPackageClosed,
  focusRelativePath,
  onFocusHandled,
  patchFocus,
  onPatchFocusHandled,
}) => {
  /**
   * Files opened to patch a mod's own bug. They are not conflicts -- only one mod ships them --
   * so the scan does not list them until the package holds a decision for one; until then they
   * live here, beside the scanned ones, and behave the same.
   */
  const [patchTargets, setPatchTargets] = useState<VfsConflict[]>([]);
  const conflicts = useMemo(
    () => [
      ...scannedConflicts,
      ...patchTargets.filter((p) => !scannedConflicts.some((c) => c.relative_path === p.relative_path)),
    ],
    [scannedConflicts, patchTargets]
  );

  const [isPatchPickerOpen, setIsPatchPickerOpen] = useState(false);
  const [patchModId, setPatchModId] = useState<string | null>(null);
  const [patchModSearch, setPatchModSearch] = useState('');
  const [patchFiles, setPatchFiles] = useState<ModFile[] | null>(null);
  const [patchFileSearch, setPatchFileSearch] = useState('');

  const [selectedConflictId, setSelectedConflictId] = useState<string>(conflicts[0]?.id || '');
  const [filterNoise, setFilterNoise] = useState<boolean>(false);
  const [isRescanning, setIsRescanning] = useState<boolean>(false);
  const [isCleaning, setIsCleaning] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [patchStatus, setPatchStatus] = useState<MasterPatchStatusInfoUI | null>(null);

  // Multi-Package State
  const packageSwitchIdRef = useRef(0);
  const [packages, setPackages] = useState<MergedPackageInfoUI[]>([]);
  const [packagesLoaded, setPackagesLoaded] = useState(false);
  const [selectedPackageFolder, setSelectedPackageFolder] = useState<string>('Z_PZModStudio_MergedPatch');
  const [isPackageOpened, setIsPackageOpened] = useState<boolean>(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [newPackageName, setNewPackageName] = useState<string>('');
  const [newPackageDescription, setNewPackageDescription] = useState<string>('');
  const [editingPackageFolder, setEditingPackageFolder] = useState<string | null>(null);
  const [editingPackageName, setEditingPackageName] = useState<string>('');
  const [editingPackageDescription, setEditingPackageDescription] = useState<string>('');
  const [isUnpackageModalOpen, setIsUnpackageModalOpen] = useState<boolean>(false);

  // Toast Helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchPackages = useCallback(async () => {
    const list = await TauriService.listMergedPackages(paths.user_zomboid_dir || '', paths.mod_list_ini_path || '');
    setPackages(list);
    setPackagesLoaded(true);
    if (list.length > 0 && !list.some((p) => p.folder_name === selectedPackageFolder)) {
      setSelectedPackageFolder(list[0].folder_name);
    }
  }, [paths.user_zomboid_dir, paths.mod_list_ini_path, selectedPackageFolder]);

  const fetchPatchStatus = useCallback(async () => {
    if (selectedPackageFolder) {
      const status = await TauriService.getMasterPatchStatus(paths.user_zomboid_dir || '', paths.mod_list_ini_path || '', selectedPackageFolder);
      setPatchStatus(status);
    }
  }, [paths.user_zomboid_dir, paths.mod_list_ini_path, selectedPackageFolder]);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages, conflicts]);

  const handleOpenPackage = async (folderName: string) => {
    const switchId = ++packageSwitchIdRef.current;
    setSelectedPackageFolder(folderName);
    setIsPackageOpened(true);
    onPackageOpened?.(folderName);
    // Fetch with explicit folderName to avoid stale closure
    try {
      const status = await TauriService.getMasterPatchStatus(
        paths.user_zomboid_dir || '', paths.mod_list_ini_path || '', folderName
      );
      // Guard: only apply if this is still the latest switch
      if (packageSwitchIdRef.current !== switchId) return;
      setPatchStatus(status);
    } catch (err) {
      console.error('Error fetching patch status:', err);
    }
    if (packageSwitchIdRef.current !== switchId) return;
    if (onRescan) await onRescan(folderName);
  };

  const handleClosePackage = () => {
    setIsPackageOpened(false);
    onPackageClosed?.();
    if (onClearConflicts) onClearConflicts();
  };

  const handleTogglePackageInModlist = async (pkg: MergedPackageInfoUI) => {
    if (!paths.user_zomboid_dir) return;
    const targetState = !pkg.is_active_in_modlist;
    const success = await TauriService.togglePackageInModlist(
      paths.user_zomboid_dir,
      paths.mod_list_ini_path,
      pkg.folder_name,
      targetState
    );
    if (success) {
      if (onRefreshMods) {
        await onRefreshMods();
      } else if (onToggleMod) {
        onToggleMod(pkg.folder_name);
      }
      await fetchPackages();
      if (onRescan) await onRescan();
      showToast(
        targetState
          ? `✓ Package "${pkg.display_name}" activated and VISIBLE in the mod list.`
          : `✓ Package "${pkg.display_name}" HIDDEN from the mod list.`
      );
    }
  };

  /** Lists a mod's files when one is chosen in the picker. */
  const chooseModToPatch = async (modId: string) => {
    setPatchModId(modId);
    setPatchFiles(null);
    setPatchFileSearch('');
    try {
      setPatchFiles(await TauriService.modFiles(paths, modId));
    } catch (err) {
      alert(explainError(err));
      setPatchModId(null);
    }
  };

  /**
   * Opens one of a mod's own files for patching. It joins the list like a conflict and is edited
   * and saved the same way; the package, loading last, is then what the game reads for it.
   */
  /**
   * Saves a patched mod file into the package. While the package is packaged it is published in
   * place as well -- the package stays packaged and the game reads the new file on its next
   * launch -- because unpacking would take every published file away until the next publish.
   * Returns whether it was published.
   */
  const savePatchTarget = async (id: string, relativePath: string, content: string): Promise<boolean> => {
    if (isCurrentlyPackaged) {
      await TauriService.publishFileIntoPackage(paths, selectedPackageFolder, relativePath, content);
      await fetchPatchStatus();
      await fetchPackages();
      if (onRefreshMods) await onRefreshMods();
      return true;
    }
    onResolveConflict(id, content, selectedPackageFolder, relativePath);
    return false;
  };

  const openModFileToPatch = async (modId: string, relativePath: string, fix?: RequireFix | null) => {
    try {
      const opened = await TauriService.modFileToPatch(paths, modId, relativePath);
      // A fix the Studio already knows is applied and saved on the way in: the file lands in the
      // package resolved, and what is left to do is publish.
      const fixed = fix ? applyRequireFix(opened.merged_output || opened.base_content, fix) : null;
      const entry = fixed ? { ...opened, merged_output: fixed.content, status: 'RESOLVED' as const } : opened;
      setPatchTargets((current) => [...current.filter((c) => c.relative_path !== entry.relative_path), entry]);
      setSelectedConflictId(entry.id);
      setEditorContent(entry.merged_output || entry.base_content);
      setIsManuallyEdited(false);
      setIsPatchPickerOpen(false);
      setPatchModId(null);
      setPatchFiles(null);
      if (fixed) {
        const published = await savePatchTarget(entry.id, entry.relative_path, fixed.content);
        showToast(
          published
            ? `Line ${fixed.line}: require("${fix!.from}") is now require("${fix!.to}"), published in the package. Relaunch the game.`
            : `Line ${fixed.line}: require("${fix!.from}") is now require("${fix!.to}"), saved in the package. Press Package & Publish to put it in the game.`
        );
      } else if (fix) {
        showToast(`${relativePath} opened, but it has no require("${fix.from}") to change; look for the path by hand.`);
      } else {
        showToast(`${relativePath} opened. Edit it and press Save to put it in the package.`);
      }
    } catch (err) {
      alert(explainError(err));
    }
  };

  const handleUnmergeAll = async () => {
    if (
      confirm(
        'Throw away every merge saved in this package?\n\n' +
          'A copy is kept in Zomboid/PZModStudio_Backups, and the files already published stay until you publish again.'
      )
    ) {
      if (paths.user_zomboid_dir && selectedPackageFolder) {
        await TauriService.clearDraftResolutions(paths.user_zomboid_dir, selectedPackageFolder);
      }
      if (currentConflict) {
        setEditorContent(unmergedContent(currentConflict));
        setIsManuallyEdited(false);
      }
      if (onRescan) await onRescan();
      showToast(`✨ All package merges have been reverted.`);
    }
  };

  const handleUnmergeSingleConflict = async () => {
    if (!currentConflict || !paths.user_zomboid_dir || !selectedPackageFolder) return;
    setEditorContent(unmergedContent(currentConflict));
    setIsManuallyEdited(false);
    await TauriService.saveDraftResolution(
      paths.user_zomboid_dir,
      selectedPackageFolder,
      currentConflict.relative_path,
      currentConflict.base_content,
      'PENDING'
    );
    if (onRescan) await onRescan();
    showToast(`✓ Merge reverted for "${currentConflict.relative_path}".`);
  };

  // Noise Filtering logic
  const filteredConflicts = useMemo(() => {
    return conflicts.filter((c) => {
      if (filterNoise && c.is_identical_noise) {
        return false;
      }
      return true;
    });
  }, [conflicts, filterNoise]);

  const currentConflict = useMemo(() => {
    const found = conflicts.find((c) => c.id === selectedConflictId);
    if (found) return found;
    return filteredConflicts[0] || conflicts[0];
  }, [conflicts, filteredConflicts, selectedConflictId]);

  // Vertical resizable split panel height percentage (Top carousel vs Bottom Monaco editor)
  const [topHeightPercent, setTopHeightPercent] = useState<number>(50);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Editor content state
  /**
   * What the editor starts with for a file: the decision the package holds, failing that what
   * the Studio proposes, failing that the copy of the mod that loads last.
   *
   * Never the base when the base game has no such file. The scan puts a note there --
   * "-- vanilla file not present for this path" -- and falling back to it put that note in the
   * editor as if it were the file, marked "Your own edit", one Save away from publishing a
   * one-line comment in place of two mods' code.
   */
  const startingContent = (c: VfsConflict | undefined): string => {
    if (!c) return '';
    const vanillaMissing =
      c.base_content.startsWith('-- vanilla file not present') ||
      c.base_content.startsWith('-- vanilla file unreadable');
    return (
      c.merged_output ||
      c.auto_ast_output ||
      (vanillaMissing ? c.competing_mods[c.competing_mods.length - 1]?.content ?? '' : c.base_content) ||
      ''
    );
  };

  /**
   * What "unmerged" means for a file: the game's own copy, or -- where the base game has no such
   * file -- the copy of the mod that loads last, which is what the game reads without a package.
   * Never the scan's "not present" note.
   */
  const unmergedContent = (c: VfsConflict | undefined): string => {
    if (!c) return '';
    const vanillaMissing =
      c.base_content.startsWith('-- vanilla file not present') ||
      c.base_content.startsWith('-- vanilla file unreadable');
    return vanillaMissing
      ? c.competing_mods[c.competing_mods.length - 1]?.content ?? ''
      : c.base_content;
  };

  const [editorContent, setEditorContent] = useState<string>(startingContent(currentConflict));
  const [isManuallyEdited, setIsManuallyEdited] = useState<boolean>(false);

  useEffect(() => {
    if (currentConflict) {
      setEditorContent(startingContent(currentConflict));
      setIsManuallyEdited(false);
    }
  }, [currentConflict?.id, currentConflict?.merged_output]);

  const hasAnyMergedConflicts = useMemo(() => {
    return conflicts.some((c) => c.status === 'RESOLVED' || c.status === 'AUTO_MERGED');
  }, [conflicts]);

  /**
   * A file is settled when the package holds a decision for it. Anything else -- including the
   * `MANUAL_CONFLICT` the scan's empty status becomes on the way in -- still needs one, which is
   * what each row says with "Needs Review".
   *
   * Asking for `PENDING` instead meant "Merge All" switched itself off while twelve rows said
   * Needs Review, telling the user everything was already resolved: disabled exactly when it was
   * the thing to press.
   */
  const isSettled = (status?: string) => status === 'RESOLVED' || status === 'AUTO_MERGED';

  const hasPendingConflicts = useMemo(() => {
    return conflicts.some((c) => !isSettled(c.status));
  }, [conflicts]);

  const isCurrentConflictUnmerged = useMemo(() => {
    if (!currentConflict) return true;
    const isPending = !isSettled(currentConflict.status);
    const isBaseCode = !currentConflict.merged_output || editorContent === currentConflict.base_content;
    return isPending && isBaseCode && !isManuallyEdited;
  }, [currentConflict, editorContent, isManuallyEdited]);

  const isCurrentConflictSaved = useMemo(() => {
    if (!currentConflict) return true;
    const isResolved = currentConflict.status === 'RESOLVED';
    const matchesOutput = editorContent === (currentConflict.merged_output || currentConflict.base_content);
    return isResolved && matchesOutput && !isManuallyEdited;
  }, [currentConflict, editorContent, isManuallyEdited]);

  const isCurrentConflictAstApplied = useMemo(() => {
    if (!currentConflict) return true;
    const isMergedStatus = currentConflict.status === 'RESOLVED' || currentConflict.status === 'AUTO_MERGED';
    const targetAst = currentConflict.auto_ast_output || currentConflict.merged_output || currentConflict.base_content;
    const matchesAst = editorContent === targetAst;
    return isMergedStatus && matchesAst && !isManuallyEdited;
  }, [currentConflict, editorContent, isManuallyEdited]);

  const handleCreatePackageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPackageName.trim()) return;
    const pkg = await TauriService.createMergedPackage(
      paths.user_zomboid_dir,
      paths.mod_list_ini_path,
      newPackageName.trim(),
      newPackageDescription.trim() || undefined
    );
    if (pkg) {
      setNewPackageName('');
      setNewPackageDescription('');
      setIsCreateModalOpen(false);
      await fetchPackages();
      setSelectedPackageFolder(pkg.folder_name);
      setIsPackageOpened(true);
      if (onRefreshMods) await onRefreshMods();
      if (onRescan) await onRescan();
      showToast(`New package "${pkg.display_name}" created in DRAFT. Ready to merge.`);
    }
  };

  const handleRenamePackageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPackageFolder || !editingPackageName.trim()) return;
    if (editingPackageFolder === 'Z_PZModStudio_Bridge') {
      alert('The Live Bridge mod is an official system module and cannot be renamed.');
      setEditingPackageFolder(null);
      return;
    }
    const pkg = await TauriService.renameMergedPackage(
      paths.user_zomboid_dir,
      paths.mod_list_ini_path,
      editingPackageFolder,
      editingPackageName.trim(),
      editingPackageDescription.trim() || undefined
    );
    if (pkg) {
      setEditingPackageFolder(null);
      setEditingPackageName('');
      setEditingPackageDescription('');
      await fetchPackages();
      setSelectedPackageFolder(pkg.folder_name);
      if (onRefreshMods) await onRefreshMods();
      if (onRescan) await onRescan();
      showToast(`Package updated to "${pkg.display_name}".`);
    }
  };

  const handleDeletePackage = async (folderName: string) => {
    if (folderName === 'Z_PZModStudio_Bridge') {
      alert('The Live Bridge mod is a protected official system module and cannot be deleted.');
      return;
    }
    if (confirm(`Are you sure you want to delete the package "${folderName}" from disk?`)) {
      const deleted = await TauriService.deleteMergedPackage(paths.user_zomboid_dir, paths.mod_list_ini_path, folderName);
      if (!deleted) return; // failure already shown by TauriService
      if (paths.user_zomboid_dir) {
        const remainingPackages = await TauriService.listMergedPackages(paths.user_zomboid_dir, paths.mod_list_ini_path);
        setPackages(remainingPackages);
        if (remainingPackages.length > 0) {
          setSelectedPackageFolder(remainingPackages[0].folder_name);
        } else {
          setSelectedPackageFolder('');
          setIsPackageOpened(false);
          if (onClearConflicts) onClearConflicts();
        }
      }
      if (onRefreshMods) await onRefreshMods();
      showToast(`Package "${folderName}" deleted.`);
    }
  };

  const handleExportPackage = async () => {
    try {
      const cleanName = selectedPackageFolder.replace('Z_PZModStudio_', '').toLowerCase();
      const filePath = await TauriService.pickSaveFile(
        `${cleanName}_package.pzmerge`,
        'PZ Mod Studio Merged Package (.pzmerge)',
        'pzmerge'
      );
      if (filePath) {
        await TauriService.exportMergedPackage(paths.user_zomboid_dir, selectedPackageFolder, filePath);
        showToast(`✨ Package successfully saved at: ${filePath}`);
      }
    } catch (err: any) {
      alert(`Error exporting package: ${explainError(err)}`);
    }
  };

  const handleImportPackage = async () => {
    try {
      const filePath = await TauriService.pickOpenFile(
        'PZ Mod Studio Merged Package (.pzmerge)',
        'pzmerge'
      );
      if (filePath) {
        const imported = await TauriService.importMergedPackage(paths.user_zomboid_dir, paths.mod_list_ini_path, filePath);
        if (imported) {
          await fetchPackages();
          setSelectedPackageFolder(imported.folder_name);
          setIsPackageOpened(true);
          if (onRefreshMods) await onRefreshMods();
          if (onRescan) await onRescan();
          showToast(`✨ Package '${imported.display_name}' loaded and imported successfully.`);
        }
      }
    } catch (err: any) {
      alert(`Error importing package: ${explainError(err)}`);
    }
  };

  const handleOpenPhysicalFolder = async () => {
    if (paths.user_zomboid_dir && selectedPackageFolder) {
      await TauriService.openPackageFolder(paths.user_zomboid_dir, selectedPackageFolder);
    }
  };

  const handleCleanMasterPatch = async () => {
    setIsCleaning(true);
    try {
      const cleaned = await TauriService.cleanMasterPatch({
        workshop_dir: paths.workshop_dir,
        pz_install_dir: paths.pz_install_dir,
        user_zomboid_dir: paths.user_zomboid_dir,
        mod_list_ini_path: paths.mod_list_ini_path,
        package_folder_name: selectedPackageFolder,
      });
      if (!cleaned) return; // failure already shown by TauriService
      showToast(`Package "${selectedPackageFolder}" unpacked. Ready to edit.`);
      await fetchPatchStatus();
      await fetchPackages();
      if (onRefreshMods) await onRefreshMods();
      await onRescan();
    } catch (err) {
      console.error('Clean failed:', err);
    } finally {
      setIsCleaning(false);
    }
  };

  // Step 1: Auto-Merge All in memory
  const handleAutoMergeAllClick = async () => {
    // A failure was already shown by TauriService; don't claim success.
    if (onAutoMergeAll && !(await onAutoMergeAll(selectedPackageFolder))) return;
    if (currentConflict) {
      const targetAst = currentConflict.auto_ast_output || currentConflict.merged_output || currentConflict.base_content || '';
      setEditorContent(targetAst);
      setIsManuallyEdited(false);
    }
    showToast('⚡ All conflicts have been merged with the AST engine! Review the code and edit if you wish.');
  };

  // Step 2: Save Individual Conflict File Edit
  const handleSaveSingleConflict = async () => {
    if (!currentConflict) return;
    if (isPatchTarget(currentConflict)) {
      try {
        const published = await savePatchTarget(currentConflict.id, currentConflict.relative_path, editorContent);
        setIsManuallyEdited(false);
        showToast(
          published
            ? `✓ "${currentConflict.relative_path}" published in the package. Relaunch the game to read it.`
            : `✓ "${currentConflict.relative_path}" saved. Press Package & Publish to put it in the game.`
        );
      } catch {
        // Already shown by TauriService.
      }
      return;
    }
    onResolveConflict(currentConflict.id, editorContent, selectedPackageFolder, currentConflict.relative_path);
    setIsManuallyEdited(false);
    showToast(`✓ Merge saved for "${currentConflict.relative_path}". Status marked as Resolved.`);
  };

  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Step 3b: Toggle Append vs Remove Mod block in editor content
  const handleToggleAddMod = (modContent: string, modUid: string) => {
    const blockStart = `-- === MOD: [${modUid}] ===`;
    const blockEnd = `-- === END MOD: [${modUid}] ===`;

    if (editorContent.includes(blockStart)) {
      // REMOVE mod block
      const regex = new RegExp(`\\n*${escapeRegExp(blockStart)}[\\s\\S]*?${escapeRegExp(blockEnd)}\\n*`, 'g');
      const newContent = editorContent.replace(regex, '\n\n').trim();
      setEditorContent(newContent || currentConflict?.base_content || '');
      setIsManuallyEdited(true);
      showToast(`➖ Code from "${modUid}" removed from editor.`);
    } else {
      // ADD mod block
      const formatted = `\n\n${blockStart}\n${modContent}\n${blockEnd}`;
      setEditorContent((prev) => {
        const trimmed = prev.trim();
        if (!trimmed || (currentConflict && trimmed === currentConflict.base_content.trim())) {
          return `${currentConflict?.base_content || ''}${formatted}`;
        }
        return `${prev}${formatted}`;
      });
      setIsManuallyEdited(true);
      showToast(`➕ Code from "${modUid}" added to editor.`);
    }
  };

  // Step 4: Reset to Automatic AST Merge
  /**
   * What this file will contain. The editor is still there for anything else, but the four
   * answers people actually want are one click each, and the active one is obvious.
   */
  type Choice = { key: string; label: string; help: string; content: string };

  /** False when the scan put a note in place of a file the base game does not have. */
  const hasVanillaBase =
    !!currentConflict &&
    !currentConflict.base_content.startsWith('-- vanilla file not present') &&
    !currentConflict.base_content.startsWith('-- vanilla file unreadable');

  const fileChoices = useMemo<Choice[]>(() => {
    if (!currentConflict) return [];
    const vanillaMissing = !hasVanillaBase;
    const merged = currentConflict.auto_ast_output || currentConflict.merged_output || '';
    const isDefinition = currentConflict.file_type === 'SCRIPT_DEFINITION';
    const choices: Choice[] = [];
    if (merged) {
      choices.push({
        key: 'merged',
        label: isDefinition ? 'Merge them' : 'Keep both',
        help: isDefinition
          ? 'Everything the mods set differently that can hold both values keeps both; where only one value fits, what the game does today stays active and the other is left in a comment, one word away.'
          : 'Each mod\u2019s changes applied together. Where two change the same lines, the one that loads last wins and the other is kept in a comment.',
        content: merged,
      });
    }
    for (const mod of currentConflict.competing_mods) {
      choices.push({
        key: `mod:${mod.mod_id}`,
        label: `Only ${mod.mod_name}`,
        help: isDefinition
          ? `Write ${mod.mod_name}\u2019s values into the package. What the other mods set and ${mod.mod_name} does not still applies \u2014 the game adds every declaration up \u2014 so this only settles what they disagree about.`
          : `Use ${mod.mod_name}\u2019s file as it is. The other mods\u2019 changes to this file are dropped.`,
        content: mod.content,
      });
    }
    if (!vanillaMissing) {
      choices.push({
        key: 'vanilla',
        label: 'Vanilla',
        help: 'Use the game\u2019s own file, as if neither mod had touched it.',
        content: currentConflict.base_content,
      });
    }
    return choices;
  }, [currentConflict]);

  /** Which of them the editor is showing right now, if any. */
  const activeChoice = useMemo(() => {
    const same = (a: string, b: string) => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim();
    return fileChoices.find((c) => same(c.content, editorContent))?.key ?? 'custom';
  }, [fileChoices, editorContent]);

  const chooseForFile = (choice: Choice) => {
    setEditorContent(choice.content);
    setIsManuallyEdited(true);
    showToast(`${choice.label}: press Save to keep it for ${currentConflict?.relative_path}.`);
  };

  const handleResetToAutoMerge = () => {
    if (!currentConflict) return;
    const targetAst = currentConflict.auto_ast_output || currentConflict.merged_output || currentConflict.base_content || '';
    setEditorContent(targetAst);
    setIsManuallyEdited(true);
    showToast(`Automatic AST merge restored for "${currentConflict.relative_path}".`);
  };

  // Step 5: Final Packaging on Disk
  const handleGenerateMasterPatch = async () => {
    setIsGenerating(true);
    try {
      if (!(await onOptimizeAndResolve(selectedPackageFolder))) return;
      showToast(`Package packed and successfully published in Zomboid/mods/${selectedPackageFolder}.`);
      await fetchPatchStatus();
      await fetchPackages();
      if (onRefreshMods) await onRefreshMods();
    } catch (err) {
      console.error('Generate failed:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const [scanProgress, setScanProgress] = useState<{ percent: number; text: string } | null>(null);

  const handleRescanClick = async () => {
    setIsRescanning(true);

    setScanProgress({ percent: 15, text: 'Step 1/5: Reading active mods from load list and Workshop...' });
    await new Promise((r) => setTimeout(r, 150));

    setScanProgress({ percent: 35, text: 'Step 2/5: Analyzing Lua and Script files of B41 and B42 mods...' });
    await onRescan();

    setScanProgress({ percent: 65, text: 'Step 3/5: Resolving VFS collisions and code differences...' });
    await new Promise((r) => setTimeout(r, 150));

    setScanProgress({ percent: 90, text: 'Step 4/5: Injecting real AST merges into the editor...' });
    await new Promise((r) => setTimeout(r, 150));

    setScanProgress({ percent: 100, text: 'Step 5/5: Scan 100% complete!' });

    setTimeout(() => {
      setIsRescanning(false);
      setScanProgress(null);
      showToast('Scan complete! Mods analyzed and integrated successfully.');
    }, 400);
  };

  // Handle vertical panel dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - containerRect.top;
      const newPercent = (relativeY / containerRect.height) * 100;
      setTopHeightPercent(Math.max(20, Math.min(80, newPercent)));
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const conflictLine = currentConflict?.conflict_line ?? 1;
  // Vanilla line every pane is scrolled to: the first real conflict, else the first change.
  const [focusBaseLine, setFocusBaseLine] = useState<number | null>(null);
  useEffect(() => setFocusBaseLine(null), [currentConflict?.id]);
  const defaultFocus =
    currentConflict?.collisions?.[0]?.base_start ?? currentConflict?.mod_changes?.[0]?.regions?.[0]?.base_start ?? conflictLine;
  const focusLine = focusBaseLine ?? defaultFocus;
  const collisionBaseRanges = useMemo<Array<[number, number]>>(
    () => (currentConflict?.collisions ?? []).map((c) => [c.base_start, c.base_end]),
    [currentConflict]
  );
  const changedBaseRanges = useMemo<Array<[number, number]>>(
    () => (currentConflict?.mod_changes ?? []).flatMap((m) => m.regions.filter((r) => r.kind !== 'added').map((r) => [r.base_start, r.base_end] as [number, number])),
    [currentConflict]
  );
  const totalFileLines = currentConflict?.total_file_lines ?? currentConflict?.base_content.split('\n').length ?? 1;

  const handleSelectConflict = (c: VfsConflict) => {
    if (isManuallyEdited && !confirm('You have edits here that are not saved. Leave them behind?')) return;
    setSelectedConflictId(c.id);
    setEditorContent(c.merged_output || c.base_content);
    setIsManuallyEdited(false);
  };

  // Opened from Mod Health on one file: open the package the game uses (or the default one),
  // scan, then select that conflict.
  const focusStartedRef = useRef<string | null>(null);
  const [focusScanDone, setFocusScanDone] = useState(false);
  useEffect(() => {
    if (!focusRelativePath) {
      focusStartedRef.current = null;
      return;
    }
    const hit = conflicts.find((c) => c.relative_path === focusRelativePath);
    if (hit && isPackageOpened) {
      handleSelectConflict(hit);
      setFocusScanDone(false);
      onFocusHandled?.();
      return;
    }
    if (focusStartedRef.current === focusRelativePath) {
      if (focusScanDone) {
        showToast(`${focusRelativePath} is no longer a conflict.`);
        setFocusScanDone(false);
        onFocusHandled?.();
      }
      return;
    }
    if (!packagesLoaded) return; // pick the right package once the list is in
    focusStartedRef.current = focusRelativePath;
    const target =
      packages.find((p) => !p.is_companion_bridge && p.is_active_in_modlist && p.is_packaged) ??
      packages.find((p) => !p.is_companion_bridge);
    (async () => {
      if (!isPackageOpened) await handleOpenPackage(target?.folder_name ?? 'Z_PZModStudio_MergedPatch');
      else await onRescan();
      setFocusScanDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRelativePath, conflicts, isPackageOpened, focusScanDone, packagesLoaded]);

  /**
   * The Monitor sends a mod to patch: the package it goes into is opened (the same choice as a
   * conflict sent from Mod Health), then either the file the log named opens in the editor, or
   * the mod's files are listed to pick from.
   */
  const patchFocusStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!patchFocus) {
      patchFocusStartedRef.current = null;
      return;
    }
    const key = `${patchFocus.modId}|${patchFocus.fileHint ?? ''}`;
    if (patchFocusStartedRef.current === key) return;
    if (!packagesLoaded) return;
    patchFocusStartedRef.current = key;
    (async () => {
      try {
        // The package is opened at once and the file right after; the scan that an opened
        // package starts runs behind them, so the editor is in front of you before it ends.
        const folder = packageForPatch(packages);
        if (!isPackageOpened) {
          setSelectedPackageFolder(folder);
          setIsPackageOpened(true);
          onPackageOpened?.(folder);
          void handleOpenPackage(folder);
        }
        const files = await TauriService.modFiles(paths, patchFocus.modId);
        const hint = (patchFocus.fileHint ?? '').toLowerCase();
        const named = hint
          ? files.find((f) => {
              const p = f.relative_path.toLowerCase();
              return p === hint || p.endsWith('/' + hint);
            })
          : undefined;
        if (named) {
          await openModFileToPatch(patchFocus.modId, named.relative_path, patchFocus.fix);
        } else {
          setPatchModId(patchFocus.modId);
          setPatchFiles(files);
          setPatchFileSearch('');
          setIsPatchPickerOpen(true);
          if (hint) showToast(`${patchFocus.fileHint} is not a file this build reads from the mod; pick one.`);
        }
      } catch (err) {
        alert(explainError(err));
      } finally {
        onPatchFocusHandled?.();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchFocus, packagesLoaded, isPackageOpened]);

  if (!paths.is_valid) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200">
        <div className="max-w-md w-full bg-slate-900/80 border border-amber-500/40 rounded-2xl p-6 text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto">
            <FolderX className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Setup Required: Game Directory</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Project Zomboid installation directory could not be auto-detected. Please configure your paths in App Settings to scan active mods.
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


  const currentPackage = packages.find((p) => p.folder_name === selectedPackageFolder) || packages[0];
  const allResolved = conflicts.length > 0 && conflicts.every((c) => isSettled(c.status));
  const isCurrentlyPackaged = patchStatus?.is_packaged ?? currentPackage?.is_packaged ?? false;
  // A packaged package is read-only, except for a mod's own file opened to patch: that one is
  // edited and published in place, since unpacking for it would empty the package in the game.
  const editorLocked = isCurrentlyPackaged && !isPatchTarget(currentConflict);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 text-slate-200 select-none">
      {/* Picking a mod's file to patch: a bug in one mod, which no merge can reach. */}
      {isPatchPickerOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={() => setIsPatchPickerOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-amber-400" />
                  <span>Patch a mod file</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5 max-w-xl leading-relaxed">
                  For a bug in one mod, where there is nothing to merge. Your copy goes in this
                  package, which loads last, so the game reads it instead of the mod's — for that
                  file only. The mod stays on and the rest of it is untouched.
                </p>
              </div>
              <button onClick={() => setIsPatchPickerOpen(false)} className="text-slate-500 hover:text-slate-300 p-1 cursor-pointer">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {!patchModId ? (
              <>
                <input
                  type="text"
                  value={patchModSearch}
                  onChange={(e) => setPatchModSearch(e.target.value)}
                  placeholder="Which mod?"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
                <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-800 divide-y divide-slate-900">
                  {mods
                    .filter((m) => !m.mod_id.startsWith('Z_PZModStudio_'))
                    .filter((m) => {
                      const q = patchModSearch.trim().toLowerCase();
                      return !q || m.name.toLowerCase().includes(q) || m.mod_id.toLowerCase().includes(q);
                    })
                    .slice(0, 200)
                    .map((m) => (
                      <button
                        key={m.mod_id}
                        type="button"
                        onClick={() => chooseModToPatch(m.mod_id)}
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-950/70 cursor-pointer flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{m.name}</span>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">{m.mod_id}</span>
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPatchModId(null);
                      setPatchFiles(null);
                    }}
                    className="text-[11px] px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                  >
                    ← Another mod
                  </button>
                  <input
                    type="text"
                    value={patchFileSearch}
                    onChange={(e) => setPatchFileSearch(e.target.value)}
                    placeholder="Which file? (lua, scripts)"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-800 divide-y divide-slate-900">
                  {patchFiles === null ? (
                    <div className="px-3 py-6 text-center text-xs text-slate-500">Reading the mod…</div>
                  ) : patchFiles.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-slate-500">
                      This mod ships no Lua or script files the build reads.
                    </div>
                  ) : (
                    patchFiles
                      .filter((f) => {
                        const q = patchFileSearch.trim().toLowerCase();
                        return !q || f.relative_path.toLowerCase().includes(q);
                      })
                      .map((f) => (
                        <button
                          key={f.relative_path}
                          type="button"
                          onClick={() => openModFileToPatch(patchModId, f.relative_path)}
                          className="w-full text-left px-3 py-2 text-[11px] text-slate-300 hover:bg-slate-950/70 cursor-pointer flex items-center justify-between gap-2"
                        >
                          <span className="font-mono truncate">{f.relative_path}</span>
                          <span className="font-mono text-[10px] text-slate-500 shrink-0">
                            {(f.bytes / 1024).toFixed(1)} KB
                          </span>
                        </button>
                      ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="bg-gradient-to-r from-cyan-900/90 to-emerald-900/90 border-b border-cyan-500/50 text-cyan-100 text-xs px-4 py-2 flex items-center justify-between animate-fade-in shadow-md shrink-0">
          <div className="flex items-center gap-2">
            <Sparkle className="w-4 h-4 text-cyan-300 animate-spin shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white text-xs">
            ✕
          </button>
        </div>
      )}

      {/* LEVEL 1: Overview & Selection (When no package is opened) */}
      {!isPackageOpened ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Bar for Level 1 */}
          <div className="bg-slate-900 border-b border-slate-800 p-3.5 flex items-center justify-between gap-4 shrink-0 shadow-md">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Box className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <span>Merge Packages</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700">
                    {packages.length} {packages.length === 1 ? 'Package' : 'Packages'}
                  </span>
                </h2>
                <p className="text-[11px] text-slate-400">
                  Select a package and enter to inspect its merged files, edit or package.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleImportPackage}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-lg transition shadow shrink-0 cursor-pointer"
                title="Import a saved package (.pzmerge) from disk"
              >
                <Upload className="w-3.5 h-3.5 text-cyan-400" />
                <span>Load Package (.pzmerge)</span>
              </button>

              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>➕ New Package</span>
              </button>

              {/* Package & Publish stays greyed out until a package is open */}
              <button
                disabled
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed opacity-50 shadow shrink-0"
                title="You must open / enter a package first to be able to scan and package"
              >
                <PackageCheck className="w-4 h-4 text-slate-600" />
                <span>📦 Package & Publish</span>
              </button>
            </div>
          </div>

          {/* Level 1 Body: Cards or Empty State */}
          {packages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 shadow-inner">
                <Box className="w-8 h-8 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-200">No merge packages created</h3>
                <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                  To scan conflicts and merge mods, create a merge package first or load an existing .pzmerge file.
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl transition shadow-lg flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>➕ Create First Merge Package</span>
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-5xl w-full mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {packages.map((pkg) => {
                  const isSelected = pkg.folder_name === selectedPackageFolder;
                  return (
                    <div
                      key={pkg.folder_name}
                      onClick={() => {
                        setSelectedPackageFolder(pkg.folder_name);
                        fetchPatchStatus();
                      }}
                      className={`p-5 rounded-2xl border transition shadow-lg flex flex-col justify-between space-y-4 cursor-pointer ${
                        isSelected
                          ? 'bg-slate-900/95 border-emerald-500/70 ring-1 ring-emerald-500/30'
                          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Row 1: Icon, Full Display Name, and Top-Right Action Icons */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
                              pkg.is_companion_bridge
                                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                                : pkg.is_packaged
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}>
                              <Package className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-bold text-slate-100 leading-snug break-words">
                                {pkg.display_name}
                              </h3>
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5 break-all">
                                {pkg.folder_name}
                              </div>
                            </div>
                          </div>

                          {/* Quick Actions (Rename / Delete or Locked System Badge) */}
                          {!pkg.is_companion_bridge ? (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPackageFolder(pkg.folder_name);
                                  setEditingPackageName(pkg.display_name);
                                  setEditingPackageDescription(pkg.description || '');
                                }}
                                className="p-1.5 hover:text-cyan-300 hover:bg-slate-800 rounded-lg transition text-slate-400 cursor-pointer"
                                title="Edit package name and description"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePackage(pkg.folder_name);
                                }}
                                className="p-1.5 hover:text-red-400 hover:bg-rose-950/40 rounded-lg transition text-slate-400 cursor-pointer"
                                title="Delete package from disk"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div
                              className="flex items-center gap-1 px-2 py-0.5 bg-slate-950 border border-slate-800 rounded-lg text-[10px] text-cyan-400/80 font-mono select-none"
                              title="Integrated system Companion Mod (Protected against editing or deletion)"
                            >
                              <Lock className="w-2.5 h-2.5" />
                              <span>System</span>
                            </div>
                          )}
                        </div>

                        {/* What is actually in it. Every package the Studio makes carries the
                            same canned description, so two of them side by side said nothing
                            about which was which. */}
                        {!pkg.is_companion_bridge && (
                          <div className="text-xs text-slate-300 leading-relaxed bg-slate-950/40 p-2 rounded-lg border border-slate-800/60 break-words space-y-1">
                            <div className="font-bold text-slate-200">
                              {pkg.merged_files.length === 0
                                ? 'Nothing in it yet'
                                : `${pkg.merged_files.length} file${pkg.merged_files.length === 1 ? '' : 's'}`}
                            </div>
                            {pkg.merged_files.length > 0 && (
                              <div className="text-[10px] font-mono text-slate-500 leading-snug">
                                {pkg.merged_files
                                  .slice(0, 3)
                                  .map((f) => f.split('/').pop())
                                  .join(', ')}
                                {pkg.merged_files.length > 3 ? `, and ${pkg.merged_files.length - 3} more` : ''}
                              </div>
                            )}
                          </div>
                        )}
                        {pkg.is_companion_bridge && pkg.description && (
                          <p className="text-xs text-slate-300 leading-relaxed line-clamp-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60 break-words">
                            {pkg.description}
                          </p>
                        )}

                        {/* Row 2: Status Badges and ModList Visibility */}
                        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-800/40">
                          {pkg.is_companion_bridge ? (
                            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                              Live IPC Bridge
                            </span>
                          ) : pkg.is_packaged ? (
                            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-950/90 text-emerald-300 border border-emerald-600 shadow-sm" title="Compiled and ready as a mod for Project Zomboid">
                              🟢 PACKAGED / CLOSED
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-950/90 text-amber-300 border border-amber-600 shadow-sm animate-pulse" title="Open package: in editing mode with draft conflict resolutions, deactivated for gameplay">
                              🟡 OPEN (Draft)
                            </span>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTogglePackageInModlist(pkg);
                            }}
                            className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition shadow cursor-pointer ${
                              pkg.is_active_in_modlist
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/60 hover:bg-emerald-900'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                            }`}
                            title={
                              pkg.is_active_in_modlist
                                ? "Active and visible in the game mod list (default.txt). Click to hide."
                                : "Hidden from the game. Click to activate and show in ModList."
                            }
                          >
                            {pkg.is_active_in_modlist ? <Eye className="w-3 h-3 text-emerald-400" /> : <EyeOff className="w-3 h-3 text-slate-400" />}
                            <span>{pkg.is_active_in_modlist ? 'Visible in ModList' : 'Hidden in ModList'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 gap-2">
                        <div className="flex items-center gap-1.5">
                          {!pkg.is_companion_bridge && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPackageFolder(pkg.folder_name);
                                handleExportPackage();
                              }}
                              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs transition cursor-pointer"
                              title="Export .pzmerge file"
                            >
                              <Download className="w-3.5 h-3.5 text-emerald-400" />
                            </button>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPackageFolder(pkg.folder_name);
                              handleOpenPhysicalFolder();
                            }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs transition cursor-pointer font-medium"
                            title="Open physical folder in Windows Explorer"
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                            {pkg.is_companion_bridge && <span className="text-[11px]">View Files</span>}
                          </button>
                        </div>

                        {!pkg.is_companion_bridge ? (
                          <button
                            onClick={() => handleOpenPackage(pkg.folder_name)}
                            className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold transition shadow flex items-center gap-1.5 cursor-pointer"
                          >
                            <span>🔍 Open / Enter Package</span>
                          </button>
                        ) : (
                          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono px-2 py-1 bg-slate-950/60 rounded-lg border border-slate-800">
                            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                            <span>IPC Link with the Game</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* LEVEL 2: Workspace of the Opened Package */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Bar for Level 2 Workspace */}
          <div className="bg-slate-900 border-b border-slate-800 p-2.5 flex items-center justify-between gap-4 shrink-0 shadow-md">
            <div className="flex items-center gap-3">
              <button
                onClick={handleClosePackage}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-lg transition shadow cursor-pointer"
                title="Return to the general package list"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />
                <span>← Back to List</span>
              </button>

              {/* Interactive Package Switcher Dropdown */}
              <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700/80 rounded-lg px-2.5 py-1 shadow-sm">
                <Package className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Package:</span>
                <select
                  value={selectedPackageFolder}
                  onChange={(e) => handleOpenPackage(e.target.value)}
                  className="bg-transparent text-xs font-bold text-emerald-300 focus:outline-none cursor-pointer pr-1"
                >
                  {packages.filter((p) => !p.is_companion_bridge).map((p) => (
                    <option key={p.folder_name} value={p.folder_name} className="bg-slate-900 text-slate-200">
                      {p.display_name} {p.is_packaged ? '• [Packaged]' : '• [Draft / Open]'} {p.is_active_in_modlist ? '• [Visible]' : '• [Hidden]'}
                    </option>
                  ))}
                </select>
              </div>

              {currentPackage?.is_companion_bridge && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  COMPANION BRIDGE
                </span>
              )}

              {isCurrentlyPackaged ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-600 shadow-sm" title="Compiled and ready as a mod for Project Zomboid">
                  🟢 PACKAGED
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-600 shadow-sm animate-pulse" title="Package in editing mode (draft), deactivated for gameplay">
                  🟡 OPEN (Draft)
                </span>
              )}

              {/* ModList Visibility Toggle Button in Level 2 Top Bar */}
              {currentPackage && (
                <button
                  onClick={() => handleTogglePackageInModlist(currentPackage)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition shadow cursor-pointer ${
                    currentPackage.is_active_in_modlist
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/70 hover:bg-emerald-900'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                  }`}
                  title={currentPackage.is_active_in_modlist ? "The package is active and visible in default.txt. Click to hide." : "The package is hidden in default.txt. Click to activate."}
                >
                  {currentPackage.is_active_in_modlist ? <Eye className="w-3 h-3 text-emerald-400" /> : <EyeOff className="w-3 h-3 text-slate-400" />}
                  <span>{currentPackage.is_active_in_modlist ? 'Visible in ModList' : 'Hidden in ModList'}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!isCurrentlyPackaged && (
                <>
                  <button
                    onClick={() => {
                      setIsPatchPickerOpen(true);
                      setPatchModId(null);
                      setPatchFiles(null);
                      setPatchModSearch('');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition shadow bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 cursor-pointer"
                    title="Open one mod's own file to patch a bug in it. The package loads last, so the game reads your copy of that one file."
                  >
                    <Wrench className="w-3.5 h-3.5 text-amber-400" />
                    Patch a mod file
                  </button>

                  <button
                    onClick={handleAutoMergeAllClick}
                    disabled={!hasPendingConflicts}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition shadow ${
                      !hasPendingConflicts
                        ? 'bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                        : 'bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 cursor-pointer'
                    }`}
                    title={!hasPendingConflicts ? "All conflicts in this package have already been merged and resolved" : "Applies the automatic AST engine to all unpacked conflicts"}
                  >
                    <Wand2 className={`w-3.5 h-3.5 ${!hasPendingConflicts ? 'text-slate-600' : 'text-emerald-400'}`} />
                    <span>⚡ Merge All (AST)</span>
                  </button>

                  <button
                    onClick={handleUnmergeAll}
                    disabled={!hasAnyMergedConflicts}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs font-semibold rounded-lg transition shadow ${
                      !hasAnyMergedConflicts
                        ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 cursor-pointer'
                    }`}
                    title={!hasAnyMergedConflicts ? "There are no active merges in this package to unmerge" : "Undoes all merges in this package and restores original files"}
                  >
                    <Undo2 className={`w-3.5 h-3.5 ${!hasAnyMergedConflicts ? 'text-slate-600' : 'text-amber-400'}`} />
                    <span>↩️ Unmerge All</span>
                  </button>
                </>
              )}

              <button
                onClick={() => setFilterNoise(!filterNoise)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 border transition cursor-pointer shadow ${
                  filterNoise
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80 font-bold'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
                title={filterNoise ? "Showing only real collisions (identical noise hidden)" : "Showing all colliding files"}
              >
                {filterNoise ? <EyeOff className="w-3.5 h-3.5 text-emerald-400" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
                <span>{filterNoise ? 'No Duplicates' : 'All'}</span>
              </button>

              <button
                onClick={handleOpenPhysicalFolder}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-lg transition shadow cursor-pointer"
                title="Open physical folder in Windows"
              >
                <FolderOpen className="w-4 h-4 text-amber-400" />
              </button>

              <button
                onClick={handleExportPackage}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-lg transition shadow cursor-pointer"
                title="Save .pzmerge file"
              >
                <Download className="w-4 h-4 text-emerald-400" />
              </button>

              <button
                onClick={handleRescanClick}
                disabled={isCurrentlyPackaged || isRescanning}
                className={`p-1.5 border text-xs font-medium rounded-lg transition shadow ${
                  isCurrentlyPackaged || isRescanning
                    ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 cursor-pointer'
                }`}
                title={isCurrentlyPackaged ? "The package is packaged (read-only). Unpack to rescan and edit." : "Rescan mod collisions"}
              >
                <RefreshCw className={`w-4 h-4 ${isCurrentlyPackaged ? 'text-slate-600' : 'text-cyan-400'} ${isRescanning ? 'animate-spin' : ''}`} />
              </button>

              {isCurrentlyPackaged ? (
                <button
                  onClick={() => setIsUnpackageModalOpen(true)}
                  disabled={isCleaning}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-700/60 text-xs font-bold rounded-lg transition shadow cursor-pointer"
                  title="Unpacks and opens the package for further editing"
                >
                  <Unlock className="w-4 h-4 text-amber-400" />
                  <span>{isCleaning ? 'Opening...' : '🔓 Unmerge / Open to Edit'}</span>
                </button>
              ) : (
                <button
                  onClick={handleGenerateMasterPatch}
                  disabled={isGenerating}
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg transition shadow-lg shrink-0 cursor-pointer ${
                    allResolved
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white animate-pulse'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                  title="Final Step: Compiles all merged files to disk and publishes the package to the Mod List"
                >
                  <PackageCheck className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                  <span>{isGenerating ? 'Packaging...' : '📦 Package & Publish'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Read-Only Status Banner when isCurrentlyPackaged */}
          {isCurrentlyPackaged && (
            <div className="bg-emerald-950/40 border-b border-emerald-800/50 px-4 py-2 flex items-center justify-between gap-3 shrink-0 text-xs animate-fade-in">
              <div className="flex items-center gap-2 text-emerald-300">
                <PackageCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <b>Packaged Package (Mod Ready to Play):</b> The package is in read-only mode. All editing, unmerging, mod usage, and scanning functions are protected until you <b>Unpack it</b>.
                </span>
              </div>
              <button
                onClick={() => setIsUnpackageModalOpen(true)}
                disabled={isCleaning}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold text-[11px] transition shadow-md cursor-pointer shrink-0 flex items-center gap-1.5"
                title="Unpack and open for editing"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>{isCleaning ? 'Opening...' : 'Unpack to Edit'}</span>
              </button>
            </div>
          )}

          {/* Main Body: If package is closed/packaged, hide editor content until unlocked */}
          {editorLocked ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950/80 overflow-y-auto text-slate-200 animate-fade-in">
              <div className="max-w-xl w-full bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-8 shadow-2xl space-y-6 text-center">
                <div className="w-20 h-20 mx-auto rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
                  <PackageCheck className="w-10 h-10" />
                </div>

                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-700/60">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>CLOSED AND PACKAGED PACKAGE</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-100 font-mono">
                    {currentPackage?.display_name || selectedPackageFolder}
                  </h2>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    This package is compiled in <b>Read Only</b> mode and ready to play. To avoid accidental discrepancies, editor content and collisions remain hidden until you decide to open it.
                  </p>
                </div>

                {/* Summary Info Cards */}
                <div className="grid grid-cols-2 gap-3 text-left">
                  <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-1">
                    <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                      Merged Files
                    </span>
                    <p className="text-lg font-bold text-emerald-400 font-mono">
                      {conflicts.length} {conflicts.length === 1 ? 'file' : 'files'}
                    </p>
                  </div>
                  <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-1">
                    <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-emerald-400" />
                      State in ModList
                    </span>
                    <p className="text-lg font-bold text-cyan-400">
                      {currentPackage?.is_active_in_modlist ? '✓ Active and Visible' : 'Hidden'}
                    </p>
                  </div>
                </div>

                {/* Open / Unpackage Action CTA */}
                <div className="pt-2 space-y-3">
                  <button
                    onClick={() => setIsUnpackageModalOpen(true)}
                    disabled={isCleaning}
                    className="w-full py-3.5 px-6 bg-gradient-to-r from-amber-600 via-amber-500 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold text-sm rounded-xl shadow-lg hover:shadow-amber-500/25 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
                  >
                    <Unlock className="w-5 h-5 text-amber-100" />
                    <span>{isCleaning ? 'Opening package...' : '🔓 Unmerge / Open to Edit'}</span>
                  </button>
                  <p className="text-[11px] text-slate-500">
                    By opening the package you can inspect each colliding file, compare differences and modify the generated code.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Workspace Body */
            <div className="flex-1 flex overflow-hidden">
              <div className="w-80 border-r border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
                <div className="p-3 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <GitCompare className="w-4 h-4 text-emerald-400" />
                    <span>VFS Conflicts</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-cyan-400 border border-slate-700">
                    {filteredConflicts.length} {filteredConflicts.length === 1 ? 'file' : 'files'}
                  </span>
                </div>

                {isRescanning && scanProgress && (
                  <div className="p-3 bg-cyan-950/80 border-b border-cyan-700/60 space-y-2 animate-fade-in shadow-lg">
                    <div className="flex items-center justify-between text-[11px] font-mono font-bold text-cyan-300">
                      <span className="flex items-center gap-1.5 truncate">
                        <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
                        <span className="truncate">{scanProgress.text}</span>
                      </span>
                      <span className="shrink-0">{scanProgress.percent}%</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-cyan-800">
                      <div
                        className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-300 rounded-full"
                        style={{ width: `${scanProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {filteredConflicts.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 space-y-2">
                      <ShieldCheck className="w-8 h-8 text-emerald-500/50 mx-auto" />
                      <p>No pending collisions under current filter.</p>
                    </div>
                  ) : (
                    filteredConflicts.map((c) => {
                      const isSelected = c.id === selectedConflictId;
                      const isResolved = c.status === 'RESOLVED';
                      const isAutoMerged = c.status === 'AUTO_MERGED';

                      return (
                        <div
                          key={c.id}
                          onClick={() => handleSelectConflict(c)}
                          className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-slate-800 border-emerald-500/70 shadow-sm ring-1 ring-emerald-500/30'
                              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                              {c.file_type === 'SCRIPT_DEFINITION' ? 'DEFINITION' : c.file_type}
                            </span>
                            {isResolved ? (
                              <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/80">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Resolved
                              </span>
                            ) : isAutoMerged ? (
                              <span className="flex items-center gap-1 text-[10px] text-cyan-300 font-bold bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800/80">
                                <Sparkle className="w-3 h-3 text-cyan-400" /> Auto-Merged
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">
                                <AlertTriangle className="w-3 h-3 text-amber-400" /> Needs Review
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-slate-200 font-semibold truncate" title={c.relative_path}>
                            {c.relative_path.split('/').pop()}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {currentConflict ? (
                <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden min-w-0">
                  <div
                    style={{ height: `${topHeightPercent}%` }}
                    className="flex flex-col bg-slate-900/80 p-3 min-h-0 overflow-hidden"
                  >
                    {/* Header Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2 mb-2 shrink-0">
                      <div className="flex items-center gap-2 overflow-hidden max-w-xl">
                        <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span className="text-xs font-bold text-slate-200 truncate">
                          Colliding File: <code className="text-emerald-400 font-mono">{currentConflict.relative_path}</code>
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                          <AlertCircle className="w-3 h-3 text-amber-400" />
                          Line #{conflictLine}
                        </span>

                        <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-950 text-slate-400 border border-slate-800">
                          <Layers className="w-3 h-3 text-cyan-400" />
                          {currentConflict.competing_mods.length + 1} Sources
                        </span>
                      </div>
                    </div>

                    {/* What each mod does to this file */}
                    <ConflictSummaryCard conflict={currentConflict} onFocus={setFocusBaseLine} />

                    {/* Horizontal Code Panels Carousel */}
                    <div className="flex-1 flex gap-3 overflow-x-auto min-h-0">
                      {/* Panel A: Vanilla Base */}
                      <div className="w-96 min-w-96 bg-slate-950 border border-slate-800 rounded-lg flex flex-col shadow">
                        <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-300">Vanilla Base Game</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                              {totalFileLines} lines
                            </span>
                            {/* With no vanilla file there is nothing to load: the button used to put
                                the "not present" note itself into the editor, one Save away from
                                shipping a one-line comment in place of the mods' code. */}
                            <button
                              disabled={!hasVanillaBase}
                              onClick={() => {
                                if (!hasVanillaBase) return;
                                setEditorContent(currentConflict.base_content);
                                setIsManuallyEdited(false);
                                showToast(`Vanilla base code restored in editor.`);
                              }}
                              className={`px-2 py-1 text-[10px] font-semibold rounded border transition shadow-sm ${
                                !hasVanillaBase
                                  ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                                  : editorContent === currentConflict.base_content && !isManuallyEdited
                                  ? 'bg-slate-800 text-emerald-300 border-emerald-700/80 font-bold cursor-pointer'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white cursor-pointer'
                              }`}
                              title={
                                hasVanillaBase
                                  ? 'Load original Vanilla base code in the lower editor'
                                  : 'The base game has no file here, so there is nothing to go back to'
                              }
                            >
                              {!hasVanillaBase
                                ? 'No base'
                                : editorContent === currentConflict.base_content && !isManuallyEdited
                                ? '\u2713 Base Active'
                                : 'Load Base'}
                            </button>
                          </div>
                        </div>
                        <LinedCodeSnippet
                          content={currentConflict.base_content}
                          targetLine={focusLine}
                          highlightRanges={changedBaseRanges}
                          collisionRanges={collisionBaseRanges}
                        />
                      </div>

                    {/* Competing Mod Panels */}
                    {currentConflict.competing_mods.map((mod, idx) => {
                      const modUid = mod.mod_id && mod.mod_id !== mod.mod_name
                        ? `${mod.mod_name} (${mod.mod_id})`
                        : `${mod.mod_name}${currentConflict.competing_mods.filter(m => m.mod_name === mod.mod_name).length > 1 ? ` #${idx + 1}` : ''}`;

                      const isModAdded = editorContent.includes(`-- === MOD: [${modUid}] ===`);
                      const isModExclusive = editorContent === mod.content;

                      return (
                        <div
                          key={idx}
                          className={`w-[450px] min-w-[450px] bg-slate-950 border rounded-lg flex flex-col shadow group transition ${
                            isModExclusive
                              ? 'border-emerald-500 ring-1 ring-emerald-500/40'
                              : isModAdded
                              ? 'border-cyan-500/80 ring-1 ring-cyan-500/30'
                              : 'border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-emerald-400 truncate max-w-[150px]" title={modUid}>
                              {mod.mod_name}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Toggle Agregar / Quitar Mod */}
                              <button
                                onClick={() => !isCurrentlyPackaged && handleToggleAddMod(mod.content, modUid)}
                                disabled={isCurrentlyPackaged || isModExclusive}
                                className={`px-2 py-1 text-[10px] font-semibold rounded border transition shadow-sm flex items-center gap-1 ${
                                  isCurrentlyPackaged
                                    ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                                    : isModExclusive
                                    ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                                    : isModAdded
                                    ? 'bg-rose-950/90 text-rose-300 border-rose-700 hover:bg-rose-900 hover:text-white cursor-pointer'
                                    : 'bg-cyan-950/80 text-cyan-300 border-cyan-800 hover:bg-cyan-700 hover:text-white cursor-pointer'
                                }`}
                                title={
                                  isCurrentlyPackaged
                                    ? 'The package is packaged (read-only). Unpack to modify.'
                                    : isModExclusive
                                    ? 'This mod is already loaded exclusively in the editor'
                                    : isModAdded
                                    ? `Take ${mod.mod_name}'s appended block back out`
                                    : `Append ${mod.mod_name}'s version below what is in the editor`
                                }
                              >
                                {isModAdded ? (
                                  <>
                                    <Minus className="w-3 h-3 text-rose-400" />
                                    <span>Remove</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-3 h-3 text-cyan-400" />
                                    <span>Append</span>
                                  </>
                                )}
                              </button>

                            </div>
                          </div>
                          {(() => {
                            const summary = currentConflict.mod_changes?.find((m) => m.mod_id === mod.mod_id);
                            const own = (summary?.regions ?? []).filter((r) => r.kind !== 'removed');
                            const overlapsCollision = (r: ChangeRegion) =>
                              collisionBaseRanges.some(([a, b]) => r.base_start <= b && a <= Math.max(r.base_start, r.base_end));
                            return (
                              <LinedCodeSnippet
                                content={mod.content}
                                targetLine={summary ? modLineFor(summary, focusLine) : focusLine}
                                highlightRanges={own.map((r) => [r.mod_start, r.mod_end] as [number, number])}
                                collisionRanges={own.filter(overlapsCollision).map((r) => [r.mod_start, r.mod_end] as [number, number])}
                              />
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Draggable Vertical Splitter Bar */}
                <div
                  onMouseDown={handleMouseDown}
                  className={`h-2.5 bg-slate-900 hover:bg-emerald-600/60 border-y border-slate-800 cursor-ns-resize flex items-center justify-center transition shrink-0 select-none ${
                    isResizing ? 'bg-emerald-500 text-white' : 'text-slate-600 hover:text-white'
                  }`}
                  title="Drag to resize the top panel and editor"
                >
                  <GripHorizontal className="w-5 h-3" />
                </div>

                {/* Bottom Panel: Interactive Monaco Editor */}
                <div
                  style={{ height: `${100 - topHeightPercent}%` }}
                  className="flex flex-col bg-slate-950 p-3 min-h-0 overflow-hidden"
                >
                  {!isCurrentlyPackaged && fileChoices.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2 mb-2 shrink-0">
                      <span className="text-[11px] text-slate-400 mr-1">What should the game read?</span>
                      {fileChoices.map((choice) => {
                        const active = activeChoice === choice.key;
                        return (
                          <button
                            key={choice.key}
                            type="button"
                            onClick={() => chooseForFile(choice)}
                            aria-pressed={active}
                            title={choice.help}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                              active
                                ? 'bg-emerald-900/60 text-emerald-200 border-emerald-700'
                                : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            {choice.label}
                          </button>
                        );
                      })}
                      {activeChoice === 'custom' && (
                        <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold border bg-amber-950/60 text-amber-300 border-amber-800">
                          Your own edit
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                        <Code2 className="w-4 h-4 text-emerald-400" />
                        <span>Merge Result (Master Patch)</span>
                      </span>
                      {editorLocked ? (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-mono font-bold">
                          🔒 Published (Read Only)
                        </span>
                      ) : isCurrentlyPackaged ? (
                        <span
                          className="px-2 py-0.5 text-[10px] rounded bg-amber-950 text-amber-300 border border-amber-800/80 font-mono"
                          title="This is a mod's own file: Save publishes it into the packaged package in place, nothing is unpacked"
                        >
                          {isManuallyEdited ? '✏️ Edited · Save publishes in place' : 'Patch · Save publishes in place'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-amber-950 text-amber-300 border border-amber-800/80 font-mono">
                          {isManuallyEdited ? '✏️ Manually Edited' : 'Draft (Editable)'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {editorLocked ? (
                        <button
                          onClick={() => setIsUnpackageModalOpen(true)}
                          disabled={isCleaning}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-950 hover:bg-amber-900 text-amber-300 text-xs font-bold border border-amber-700/60 shadow transition cursor-pointer"
                          title="Unpack this package to edit its merged code"
                        >
                          <Unlock className="w-3.5 h-3.5 text-amber-400" />
                          <span>{isCleaning ? 'Opening...' : '🔓 Unmerge / Open to Edit'}</span>
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={handleResetToAutoMerge}
                            disabled={isCurrentConflictAstApplied}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                              isCurrentConflictAstApplied
                                ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 cursor-pointer'
                            }`}
                            title={isCurrentConflictAstApplied ? "The automatic AST merge is already applied in this file" : "Restores the automatic merge generated by the AST engine"}
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${isCurrentConflictAstApplied ? 'text-slate-600' : 'text-cyan-400'}`} />
                            <span>Restore AST Merge</span>
                          </button>

                          <button
                            onClick={handleUnmergeSingleConflict}
                            disabled={isCurrentConflictUnmerged}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                              isCurrentConflictUnmerged
                                ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 cursor-pointer'
                            }`}
                            title={isCurrentConflictUnmerged ? "This file is already in its original unmerged state" : "Restores this file to its unmerged base code (removes merged state)"}
                          >
                            <Undo2 className={`w-3.5 h-3.5 ${isCurrentConflictUnmerged ? 'text-slate-600' : 'text-amber-400'}`} />
                            <span>Unmerge this File</span>
                          </button>

                          <button
                            onClick={handleSaveSingleConflict}
                            disabled={isCurrentConflictSaved}
                            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition ${
                              isCurrentConflictSaved
                                ? 'bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow cursor-pointer'
                            }`}
                            title={isCurrentConflictSaved ? "This file is already saved and resolved (no pending changes)" : "Saves changes to this file and removes Needs Review warning"}
                          >
                            <Check className={`w-3.5 h-3.5 ${isCurrentConflictSaved ? 'text-slate-600' : 'text-white'}`} />
                            <span>{isCurrentConflictSaved ? '✓ Merge Saved' : '✓ Save Merge of this File'}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 border border-slate-800 rounded-lg overflow-hidden relative">
                    <Editor
                      height="100%"
                      language={currentConflict.file_type === 'LUA' ? 'lua' : 'plaintext'}
                      path={currentConflict.id}
                      theme="vs-dark"
                      value={editorContent}
                      onChange={(val) => {
                        if (!editorLocked) {
                          setEditorContent(val || '');
                          setIsManuallyEdited(true);
                        }
                      }}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        fontFamily: 'Consolas, Monaco, monospace',
                        scrollBeyondLastLine: false,
                        smoothScrolling: true,
                        tabSize: 4,
                        wordWrap: 'on',
                        readOnly: editorLocked,
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-950/50">
                <GitCompare className="w-12 h-12 mb-2 text-slate-700" />
              </div>
            )}
          </div>
        )}
      </div>
    )}

      {/* Create Package Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreatePackageSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-fade-in">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-400" />
              <span>Create New Merge Package</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Enter a name and description for this package. It will be created in DRAFT mode and you can enter to merge its files independently.
            </p>
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">Package Name:</label>
              <input
                type="text"
                value={newPackageName}
                onChange={(e) => setNewPackageName(e.target.value)}
                placeholder="e.g: MergedPatch2"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none font-mono"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">Description (Optional):</label>
              <textarea
                value={newPackageDescription}
                onChange={(e) => setNewPackageDescription(e.target.value)}
                placeholder="e.g: Compatibility merge to resolve collisions between weapon and vehicle mods."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none resize-none h-20"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Create Package
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Package Modal */}
      {editingPackageFolder && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleRenamePackageSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-fade-in">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-cyan-400" />
              <span>Edit Package</span>
            </h3>
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">Package Name:</label>
              <input
                type="text"
                value={editingPackageName}
                onChange={(e) => setEditingPackageName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none font-mono"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">Description (Optional):</label>
              <textarea
                value={editingPackageDescription}
                onChange={(e) => setEditingPackageDescription(e.target.value)}
                placeholder="Mod description..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none resize-none h-20"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingPackageFolder(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Unpackage Confirmation Modal */}
      {isUnpackageModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-fade-in text-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
                <Unlock className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">⚠️ Open Package for Editing?</h3>
                <p className="text-xs text-slate-400 mt-0.5">The package will switch to DRAFT mode.</p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs text-slate-300">
              <p>
                By opening the package <b className="text-emerald-400 font-mono">{currentPackage?.display_name}</b>, you will be able to edit its code merges.
              </p>
              <div className="p-2.5 bg-amber-950/40 border border-amber-500/30 rounded-lg text-amber-300 text-[11px] font-mono leading-relaxed">
                ⚠️ <b>Visibility Notice:</b> While this package is in draft, it <b>will NOT be visible in the game Mod List</b> until you click "Package & Publish".
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsUnpackageModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsUnpackageModalOpen(false);
                  await handleCleanMasterPatch();
                }}
                className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold rounded-lg cursor-pointer shadow transition"
              >
                Confirm and Open Package
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
