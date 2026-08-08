import React from 'react';
import { PolyfillRule } from '../../types';
import { ShieldCheck, ShieldAlert, Zap, Layers, Plus } from 'lucide-react';

interface PolyfillsModuleProps {
  rules: PolyfillRule[];
  onToggleRule: (ruleId: string) => void;
}

export const PolyfillsModule: React.FC<PolyfillsModuleProps> = ({ rules, onToggleRule }) => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 text-slate-200 p-6">
      {/* Header Info */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Polyfill & Compatibility Engine (B42+)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            JSON-driven compatibility matrix that automatically bridges API breaks between B41 and B42.
          </p>
        </div>

        <button className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3.5 py-2 rounded-lg border border-slate-700 transition cursor-pointer">
          <Plus className="w-4 h-4 text-emerald-400" />
          Import Community Rule (.json)
        </button>
      </div>

      {/* Rules Grid */}
      <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-4 pr-2">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
              rule.enabled
                ? 'bg-slate-900/90 border-slate-700 shadow-md'
                : 'bg-slate-950/60 border-slate-800/80 opacity-60'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-950 text-cyan-400 border border-slate-800 font-semibold">
                  {rule.category}
                </span>

                {/* Toggle Switch */}
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => onToggleRule(rule.id)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2 mb-1">
                {rule.severity === 'CRITICAL' && <ShieldAlert className="w-4 h-4 text-rose-400" />}
                {rule.severity === 'HIGH' && <Zap className="w-4 h-4 text-amber-400" />}
                {rule.severity === 'MEDIUM' && <Layers className="w-4 h-4 text-cyan-400" />}
                {rule.name}
              </h3>

              <p className="text-xs text-slate-400 leading-relaxed mb-3">
                {rule.description}
              </p>
            </div>

            <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-500">
              <span>Rule ID: <code className="text-slate-400">{rule.id}</code></span>
              <span className={`px-2 py-0.5 rounded text-[10px] ${rule.enabled ? 'text-emerald-400 bg-emerald-950/60' : 'text-slate-500'}`}>
                {rule.enabled ? 'Active' : 'Disabled'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
