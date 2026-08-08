import React from 'react';
import { Shield, Play, Activity } from 'lucide-react';

interface StudioHeaderProps {
  conflictCount: number;
  polyfillCount: number;
  onRunSandbox: () => void;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  conflictCount,
  polyfillCount,
  onRunSandbox,
}) => {
  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between select-none shrink-0 shadow-md">
      {/* App Branding & Logo */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-slate-100 leading-none flex items-center gap-2">
            PZ Mod Studio
            <span className="text-[10px] font-normal text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-1.5 py-0.5 rounded font-mono">
              v1.0.0
            </span>
          </h1>
          <p className="text-[11px] text-slate-400 leading-tight mt-0.5 font-mono">
            Project Zomboid • Build 42+ Suite
          </p>
        </div>
      </div>

      {/* Center Status Indicators */}
      <div className="hidden md:flex items-center gap-4 text-xs">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          <span className="text-slate-400 font-mono">Virtual Conflicts:</span>
          <span className="font-bold font-mono text-amber-400">{conflictCount}</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span className="text-slate-400 font-mono">Active Polyfills:</span>
          <span className="font-bold font-mono text-emerald-400">{polyfillCount}</span>
        </div>
      </div>

      {/* Right Primary Action Button: Launch Game (Monitored) */}
      <div className="flex items-center gap-2">
        <button
          onClick={onRunSandbox}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow-lg hover:shadow-emerald-900/30 transition cursor-pointer"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>Launch Game (Monitored)</span>
          <Activity className="w-3.5 h-3.5 text-emerald-200 animate-pulse" />
        </button>
      </div>
    </header>
  );
};
