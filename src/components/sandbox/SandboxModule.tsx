import React, { useState } from 'react';
import { TranslatedErrorCard } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { Play, AlertCircle, Wrench, CheckCircle, Terminal, RefreshCw, FolderX } from 'lucide-react';

interface SandboxModuleProps {
  paths: StudioPathsUI;
  errorCards: TranslatedErrorCard[];
  onApplyFix: (polyfillRuleId: string) => void;
  onGoToSettings: () => void;
}

export const SandboxModule: React.FC<SandboxModuleProps> = ({
  paths,
  errorCards,
  onApplyFix,
  onGoToSettings,
}) => {
  const [testMode, setTestMode] = useState<'BACKGROUND_QUICK' | 'WINDOWED_DEEP'>('BACKGROUND_QUICK');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([
    '[PZ Mod Studio] Sandbox Test Environment Ready.',
    '[PZ Mod Studio] Click "Start Isolated Test" to launch Project Zomboid (-cachedir, -debug) and stream console.txt in real time.',
  ]);

  const handleStartTest = () => {
    if (!paths.is_valid) {
      alert('Please configure your Project Zomboid installation directory in App Settings first.');
      return;
    }

    setIsRunning(true);
    setLogs([
      '[PZ Mod Studio] Initializing Sandbox test run...',
      `[PZ Mod Studio] Command: ProjectZomboid64.exe -cachedir "temp_sandbox" -debug (${testMode})`,
      '[PZ Mod Studio] Watching console.txt for JVM & Lua exceptions...',
    ]);

    setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        '[PZ Engine] Loading base game media...',
        '[PZ Engine] Main window reached.',
        '[PZ Mod Studio] Monitoring active game session...',
      ]);
    }, 2000);
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
              Project Zomboid installation directory must be configured in App Settings before launching an isolated Sandbox Test.
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
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden p-6">
      {/* Module Header & Control Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            Sandbox Test Lab & Log Inspector (<code className="text-emerald-400">console.txt</code>)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Test builds in an isolated environment (<code className="text-slate-300">-cachedir</code>, <code className="text-slate-300">-debug</code>) and translate crashes into 1-click solutions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Test Mode Selector */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-1 flex gap-1 text-xs">
            <button
              onClick={() => setTestMode('BACKGROUND_QUICK')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                testMode === 'BACKGROUND_QUICK'
                  ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Background Quick Test
            </button>
            <button
              onClick={() => setTestMode('WINDOWED_DEEP')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                testMode === 'WINDOWED_DEEP'
                  ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Windowed Deep Test
            </button>
          </div>

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
                Running Test...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                Start Isolated Test
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Grid: Console Log Watcher (Left) vs Translated Error Cards (Right) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        {/* Left Column: Realtime Console.txt Terminal */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow">
          <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              Realtime Log Watcher (<code className="text-emerald-400">console.txt</code>)
            </span>

            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400">
              Status: {isRunning ? <b className="text-emerald-400">RUNNING</b> : <b className="text-slate-500">IDLE</b>}
            </span>
          </div>

          <div className="flex-1 p-4 font-mono text-xs bg-slate-950 overflow-y-auto space-y-1 select-text">
            {logs.map((log, idx) => {
              const isErr = log.includes('JVM ERROR') || log.includes('Exception') || log.includes('Crash');
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

        {/* Right Column: Translated Actionable Repair Cards */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold text-slate-200">
              TRANSLATED ACTIONABLE CARDS ({errorCards.length})
            </h3>
            {errorCards.length === 0 && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                <CheckCircle className="w-3 h-3" /> No Crashes Detected
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {errorCards.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
                <CheckCircle className="w-10 h-10 text-emerald-500/40" />
                <p className="text-xs font-medium text-slate-400">Zero Crash Exceptions Captured</p>
                <p className="text-[11px] text-slate-500 max-w-xs">
                  Run an isolated test to monitor runtime crashes and receive 1-click repair suggestions.
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
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Raw Stacktrace Snippet</div>
                    <div className="truncate">{card.raw_error}</div>
                  </div>

                  {card.polyfill_rule_id_suggestion && (
                    <button
                      onClick={() => onApplyFix(card.polyfill_rule_id_suggestion!)}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow transition cursor-pointer"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      1-Click Fix: Apply Polyfill Rule
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
