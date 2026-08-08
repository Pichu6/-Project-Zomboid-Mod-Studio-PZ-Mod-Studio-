import React from 'react';
import { ModInfo } from '../../types';
import { ListOrdered, MoveUp, MoveDown, MapPin, Library } from 'lucide-react';

interface LoadOrderModuleProps {
  mods: ModInfo[];
  onReorder: (newOrder: ModInfo[]) => void;
  onToggleMod: (modId: string) => void;
}

export const LoadOrderModule: React.FC<LoadOrderModuleProps> = ({ mods, onReorder, onToggleMod }) => {
  const moveMod = (index: number, direction: 'UP' | 'DOWN') => {
    const newMods = [...mods];
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newMods.length) return;

    const temp = newMods[index];
    newMods[index] = newMods[targetIndex];
    newMods[targetIndex] = temp;
    onReorder(newMods);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 text-slate-200 p-6">
      {/* Header Info */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-cyan-400" />
            Mod Load Order Manager (`ModListData.ini`)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Topological dependency validation. Map mods and base libraries are automatically prioritized.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
            Active Mods: <strong className="text-emerald-400">{mods.filter((m) => m.enabled).length}</strong> / {mods.length}
          </span>
        </div>
      </div>

      {/* Mod List Table */}
      <div className="flex-1 overflow-y-auto bg-slate-900/60 border border-slate-800 rounded-xl">
        <div className="p-3 bg-slate-900 border-b border-slate-800 grid grid-cols-12 text-xs font-semibold text-slate-400 uppercase tracking-wider select-none">
          <div className="col-span-1 text-center">Order</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-5">Mod Name & ID</div>
          <div className="col-span-3">Dependencies (require=)</div>
          <div className="col-span-2 text-right pr-3">Actions</div>
        </div>

        <div className="divide-y divide-slate-800/60">
          {mods.map((mod, idx) => (
            <div
              key={mod.mod_id}
              className={`grid grid-cols-12 items-center p-3 text-xs transition ${
                mod.enabled ? 'hover:bg-slate-800/40 text-slate-200' : 'opacity-50 bg-slate-950/40 text-slate-500'
              }`}
            >
              <div className="col-span-1 text-center font-mono font-semibold text-slate-400">
                #{idx + 1}
              </div>

              <div className="col-span-1 flex justify-center">
                <input
                  type="checkbox"
                  checked={mod.enabled}
                  onChange={() => onToggleMod(mod.mod_id)}
                  className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                />
              </div>

              <div className="col-span-5 flex items-center gap-2.5">
                {mod.is_library && (
                  <span title="Base Library Mod" className="p-1 rounded bg-purple-950/80 text-purple-300 border border-purple-800">
                    <Library className="w-3.5 h-3.5" />
                  </span>
                )}
                {mod.is_map_mod && (
                  <span title="Map Mod" className="p-1 rounded bg-amber-950/80 text-amber-300 border border-amber-800">
                    <MapPin className="w-3.5 h-3.5" />
                  </span>
                )}
                <div>
                  <div className="font-semibold text-slate-100">{mod.name}</div>
                  <div className="text-[10px] font-mono text-slate-500">ID: {mod.mod_id}</div>
                </div>
              </div>

              <div className="col-span-3 font-mono text-[11px]">
                {mod.dependencies.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {mod.dependencies.map((dep) => (
                      <span key={dep} className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 text-[10px]">
                        {dep}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-600">None</span>
                )}
              </div>

              <div className="col-span-2 flex justify-end gap-1 pr-1">
                <button
                  disabled={idx === 0}
                  onClick={() => moveMod(idx, 'UP')}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 cursor-pointer border border-slate-700"
                >
                  <MoveUp className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={idx === mods.length - 1}
                  onClick={() => moveMod(idx, 'DOWN')}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 cursor-pointer border border-slate-700"
                >
                  <MoveDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
