import React, { useState } from 'react';
import { TranslatedErrorCard, SandboxStatus } from '../../types';
import { FlaskConical, Play, Square, AlertOctagon, Wrench, Terminal } from 'lucide-react';

interface SandboxModuleProps {
  errorCards: TranslatedErrorCard[];
  onApplyFix: (polyfillRuleId: string) => void;
}

export const SandboxModule: React.FC<SandboxModuleProps> = ({ errorCards, onApplyFix }) => {
  const [status, setStatus] = useState<SandboxStatus>('IDLE');
  const [testMode, setTestMode] = useState<'BACKGROUND_QUICK' | 'WINDOWED_DEEP'>('BACKGROUND_QUICK');

  const startTest = () => {
    setStatus('BOOTING');
    setTimeout(() => {
      setStatus('RUNNING');
      setTimeout(() => {
        setStatus('CRASHED');
      }, 2000);
    }, 1500);
  };

  const stopTest = () => {
    setStatus('IDLE');
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 text-slate-200 p-6">
      {/* Header Info */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-emerald-400" />
            Sandbox Test Lab & Log Inspector (`console.txt`)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Test builds in an isolated environment (`-cachedir`, `-debug`) and translate crashes into 1-click solutions.
          </p>
        </div>

        {/* Test Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-900 rounded-lg p-1 border border-slate-800 text-xs">
            <button
              onClick={() => setTestMode('BACKGROUND_QUICK')}
              className={`px-3 py-1.5 rounded-md transition cursor-pointer ${
                testMode === 'BACKGROUND_QUICK' ? 'bg-slate-800 text-emerald-400 font-semibold shadow' : 'text-slate-400'
              }`}
            >
              Background Quick Test
            </button>
            <button
              onClick={() => setTestMode('WINDOWED_DEEP')}
              className={`px-3 py-1.5 rounded-md transition cursor-pointer ${
                testMode === 'WINDOWED_DEEP' ? 'bg-slate-800 text-emerald-400 font-semibold shadow' : 'text-slate-400'
              }`}
            >
              Windowed Deep Test
            </button>
          </div>

          {status === 'IDLE' || status === 'CRASHED' || status === 'SUCCESS' ? (
            <button
              onClick={startTest}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 py-2 rounded-lg shadow transition cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              Start Isolated Test
            </button>
          ) : (
            <button
              onClick={stopTest}
              className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs px-4 py-2 rounded-lg shadow transition cursor-pointer animate-pulse"
            >
              <Square className="w-4 h-4 fill-white" />
              Stop Test
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Status & Error Cards */}
      <div className="flex-1 grid grid-cols-12 gap-6 overflow-hidden">
        {/* Left Column: Live Terminal Log Watcher */}
        <div className="col-span-7 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between text-xs font-semibold text-slate-400">
            <span className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>Realtime Log Watcher (`console.txt`)</span>
            </span>
            <span className="font-mono text-[10px] text-slate-500">Status: {status}</span>
          </div>

          <div className="flex-1 p-3 font-mono text-[11px] text-slate-400 overflow-y-auto space-y-1 bg-slate-950">
            <div className="text-slate-600">[PZ Mod Studio] Initializing Sandbox test run...</div>
            <div className="text-slate-600">[PZ Mod Studio] Command: ProjectZomboid64.exe -cachedir "temp_sandbox" -debug</div>
            {status === 'BOOTING' && (
              <div className="text-cyan-400 animate-pulse">[PZ Engine] Loading PZ Lua state and mod manifests...</div>
            )}
            {status === 'RUNNING' && (
              <div className="text-emerald-400">[PZ Engine] Main menu reached successfully.</div>
            )}
            {status === 'CRASHED' && (
              <>
                <div className="text-rose-400 font-bold">[JVM ERROR] java.lang.UnknownFormatConversionException: Conversion = "%"</div>
                <div className="text-rose-400/80">    at zombie.core.Translator.getText(Translator.java:142)</div>
                <div className="text-rose-400/80">    at ISInventoryPane.renderDetails(ISInventoryPane.lua:58)</div>
                <div className="text-amber-400">[PZ Mod Studio] Crash intercepted! Interceptor generated 2 actionable cards.</div>
              </>
            )}
          </div>
        </div>

        {/* Right Column: Actionable Error Cards */}
        <div className="col-span-5 flex flex-col space-y-4 overflow-y-auto">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Translated Actionable Cards ({errorCards.length})
          </h3>

          {errorCards.map((card) => (
            <div
              key={card.id}
              className="p-4 rounded-xl bg-slate-900/90 border border-rose-500/40 shadow-lg flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs mb-1">
                  <AlertOctagon className="w-4 h-4 shrink-0" />
                  <span>{card.title}</span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed mb-3">
                  {card.explanation}
                </p>

                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400 mb-3">
                  <div className="text-slate-500 text-[10px] uppercase font-semibold mb-0.5">Raw Stacktrace Snippet</div>
                  <div className="text-rose-300 truncate">{card.raw_error}</div>
                </div>
              </div>

              {card.polyfill_rule_id_suggestion && (
                <button
                  onClick={() => onApplyFix(card.polyfill_rule_id_suggestion!)}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs px-3 py-2 rounded-lg transition shadow cursor-pointer"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  1-Click Fix: Apply Polyfill Rule
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
