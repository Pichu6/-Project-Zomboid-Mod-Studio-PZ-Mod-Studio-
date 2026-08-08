import React from 'react';
import { ShieldCheck, Play, Save, RefreshCw } from 'lucide-react';

interface StudioHeaderProps {
  conflictCount: number;
  polyfillCount: number;
  onOptimizeAndResolve: () => void;
  onRunSandbox: () => void;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  conflictCount,
  polyfillCount,
  onOptimizeAndResolve,
  onRunSandbox,
}) => {
  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between select-none">
      {/* App Branding */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-950/50">
          <ShieldCheck className="w-6 h-6 text-slate-950 stroke-[2.5]" />
        </div>
        <div>
          <h1 className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-cyan-300 bg-clip-text text-transparent leading-none">
            PZ Mod Studio
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Project Zomboid • Build 42+ Suite
          </p>
        </div>
      </div>

      {/* Center Status Pill */}
      <div className="flex items-center gap-3 bg-slate-950/80 border border-slate-800 rounded-full px-4 py-1.5 text-xs text-slate-300">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <strong className="text-slate-100 font-semibold">{conflictCount}</strong> Conflicts
        </span>
        <span className="text-slate-700">|</span>
        <span className="flex items-center gap-1.5">
          <strong className="text-cyan-400 font-semibold">{polyfillCount}</strong> Active Polyfills
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOptimizeAndResolve}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs px-4 py-2 rounded-lg shadow-md shadow-emerald-950/40 transition-all duration-200 cursor-pointer active:scale-95"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Optimize & Resolve All
        </button>

        <button
          onClick={onRunSandbox}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-xs px-4 py-2 rounded-lg border border-slate-700 transition-all duration-200 cursor-pointer active:scale-95"
        >
          <Play className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400" />
          Launch Sandbox Lab
        </button>

        <button
          title="Save Patch Mod"
          className="flex items-center justify-center w-9 h-9 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition-all cursor-pointer"
        >
          <Save className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
