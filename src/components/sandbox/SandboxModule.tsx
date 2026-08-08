import React, { useState, useEffect, useMemo } from 'react';
import { TranslatedErrorCard } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService } from '../../services/tauri';
import { Play, AlertCircle, Wrench, CheckCircle, Terminal, RefreshCw, FolderX, Activity, Filter, Info } from 'lucide-react';

interface SandboxModuleProps {
  paths: StudioPathsUI;
  errorCards: TranslatedErrorCard[];
  onApplyFix: (polyfillRuleId: string) => void;
  onGoToSettings: () => void;
}

/**
 * Robustly detects translator and translation missing log spam lines in Project Zomboid logs.
 */
const isTranslationSpamLine = (line: string): boolean => {
  const lower = line.toLowerCase();
  return (
    lower.includes('translator') ||
    lower.includes('translation') ||
    lower.includes('missing "') ||
    lower.includes("missing '") ||
    lower.includes('missing:') ||
    lower.includes('missing arguments') ||
    lower.includes('language') ||
    (lower.includes('log') && lower.includes('missing'))
  );
};

export const SandboxModule: React.FC<SandboxModuleProps> = ({
  paths,
  errorCards,
  onApplyFix,
  onGoToSettings,
}) => {
  const [testMode] = useState<'BACKGROUND_QUICK' | 'WINDOWED_DEEP'>('WINDOWED_DEEP');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [filterSpam, setFilterSpam] = useState<boolean>(true);
  const [pid, setPid] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([
    '[PZ Monitor Center] Realtime session monitor ready.',
    '[PZ Monitor Center] Click "Launch Game (Monitored)" to start ProjectZomboid64.exe (-cachedir, -debug) and capture crashes.',
  ]);

  // Dynamically filter displayed logs in real time based on filterSpam toggle state
  const displayedLogs = useMemo(() => {
    if (!filterSpam) return logs;
    return logs.filter((line) => !isTranslationSpamLine(line));
  }, [logs, filterSpam]);

  // Subscribe to real log streaming from Rust backend
  useEffect(() => {
    let unlistenLogs: (() => void) | undefined;

    TauriService.listenSandboxLogs((payload) => {
      const line = payload.line;
      setLogs((prev) => [...prev.slice(-600), line]);
    }).then((unlisten) => {
      unlistenLogs = unlisten;
    });

    return () => {
      if (unlistenLogs) unlistenLogs();
    };
  }, []);

  const handleStartTest = async () => {
    if (!paths.is_valid || !paths.pz_install_dir) {
      alert('Please configure your Project Zomboid installation directory in App Settings first.');
      return;
    }

    setIsRunning(true);
    setLogs([
      '[PZ Monitor Center] Spawning ProjectZomboid64.exe wrapper process...',
      `[PZ Monitor Center] Command: ProjectZomboid64.exe -cachedir "${paths.user_zomboid_dir}\\temp_sandbox_cache" -debug`,
      '[PZ Monitor Center] Streaming live console.txt events...',
    ]);

    const processId = await TauriService.launchSandbox({
      pz_install_dir: paths.pz_install_dir,
      user_zomboid_dir: paths.user_zomboid_dir,
      test_mode: testMode,
    });

    if (processId > 0) {
      setPid(processId);
      setLogs((prev) => [
        ...prev,
        `[PZ Monitor Center] Active game session PID: ${processId}`,
        '[PZ Monitor Center] Monitoring active game session for Lua/Java crashes. Check Task Manager!',
      ]);
    } else {
      setIsRunning(false);
      setLogs((prev) => [
        ...prev,
        '[PZ Monitor Center ERROR] Could not spawn ProjectZomboid64.exe. Check install folder path in Settings.',
      ]);
    }
  };

  // State 1: Invalid paths guard
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
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden p-6 font-sans">
      {/* Module Header & Controls */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            Monitor Center & Crash Diagnostics (<code className="text-emerald-400">console.txt</code>)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Monitors active game sessions in real time and translates Java/Lua exceptions into 1-click repair cards.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Toggle Filter Button */}
          <button
            onClick={() => setFilterSpam(!filterSpam)}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg border transition cursor-pointer flex items-center gap-2 shadow ${
              filterSpam
                ? 'bg-emerald-950 text-emerald-300 border-emerald-700 shadow-emerald-950/40'
                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
            title="Click to toggle filtering of noisy Translator and missing translation lines"
          >
            <Filter className={`w-4 h-4 ${filterSpam ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span>{filterSpam ? 'Translator Spam: FILTERED (HIDE)' : 'Translator Spam: SHOW ALL'}</span>
          </button>

          <button
            onClick={handleStartTest}
            disabled={isRunning}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold shadow transition cursor-pointer ${
              isRunning
                ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                Session Running (PID: {pid || '...'})
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                Launch Monitored Game Session
              </>
            )}
          </button>
        </div>
      </div>

      {/* Developer Debug Mode Notice Banner */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 mb-4 flex items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            <b>Developer Debug Mode Active (<code className="text-cyan-300">-debug</code>):</b> The game menu displays the <code className="text-amber-300 font-bold">SCENARIOS</code> button, red <code className="text-red-400 font-bold">!</code> error box, and <code className="text-cyan-300">Reset Lua</code> tool so you can monitor and reload scripts live while testing!
          </span>
        </div>
      </div>

      {/* Main Grid: Console Terminal Watcher (Left) vs Actionable Cards (Right) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        {/* Left Column: Realtime Terminal Log Inspector */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow">
          <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              Live Console Output (<code className="text-emerald-400">console.txt</code>)
              <span className="text-[10px] text-slate-500 font-normal">
                ({displayedLogs.length} / {logs.length} lines)
              </span>
            </span>

            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400">
              Status: {isRunning ? <b className="text-emerald-400">ACTIVE (PID: {pid})</b> : <b className="text-slate-500">IDLE</b>}
            </span>
          </div>

          <div className="flex-1 p-4 font-mono text-xs bg-slate-950 overflow-y-auto space-y-1 select-text">
            {displayedLogs.map((log, idx) => {
              const isErr = log.includes('JVM ERROR') || log.includes('Exception') || log.includes('Crash') || log.includes('ERROR');
              return (
                <div
                  key={idx}
                  className={`leading-relaxed ${
                    isErr ? 'text-red-400 font-bold bg-red-950/30 px-2 py-0.5 rounded border-l-2 border-red-500' : 'text-slate-400'
                  }`}
                >
                  {log}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Actionable Repair Cards */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold text-slate-200">
              CRASH DIAGNOSTICS & REPAIR CARDS ({errorCards.length})
            </h3>
            {errorCards.length === 0 && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                <CheckCircle className="w-3 h-3" /> Zero Crash Exceptions
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {errorCards.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
                <CheckCircle className="w-10 h-10 text-emerald-500/40" />
                <p className="text-xs font-medium text-slate-400">Zero Critical Crashes Detected</p>
                <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                  When a mod causes a Java or Lua crash during game execution, Monitor Center intercepts it and generates a 1-click repair card here.
                </p>
              </div>
            ) : (
              errorCards.map((card) => (
                <div
                  key={card.id}
                  className="bg-slate-950 border border-red-500/40 rounded-xl p-4 space-y-3 shadow-md hover:border-red-500/70 transition"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">{card.title}</h4>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        {card.explanation}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-900 p-2.5 rounded-lg font-mono text-[11px] text-red-300 border border-slate-800">
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Captured Log Snippet</div>
                    <div className="truncate">{card.raw_error}</div>
                  </div>

                  {card.polyfill_rule_id_suggestion && (
                    <button
                      onClick={() => onApplyFix(card.polyfill_rule_id_suggestion!)}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow transition cursor-pointer"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      1-Click Fix: Enable Polyfill Rule
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
