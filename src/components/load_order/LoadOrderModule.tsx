import React from 'react';
import { ModInfo } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { ListOrdered, ArrowUp, ArrowDown, Check, ShieldCheck, MapPin, Package, FolderX, Sparkles } from 'lucide-react';
import { MOCK_MODS } from '../../data/mock_data';

interface LoadOrderModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  onReorder: (newOrder: ModInfo[]) => void;
  onToggleMod: (modId: string) => void;
  onGoToSettings: () => void;
  onLoadMockups: (mockups: ModInfo[]) => void;
}

export const LoadOrderModule: React.FC<LoadOrderModuleProps> = ({
  paths,
  mods,
  onReorder,
  onToggleMod,
  onGoToSettings,
  onLoadMockups,
}) => {
  const moveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...mods];
    const temp = updated[index - 1];
    updated[index - 1] = updated[index];
    updated[index] = temp;
    onReorder(updated);
  };

  const moveDown = (index: number) => {
    if (index === mods.length - 1) return;
    const updated = [...mods];
    const temp = updated[index + 1];
    updated[index + 1] = updated[index];
    updated[index] = temp;
    onReorder(updated);
  };

  // State 1: Invalid paths guard
  if (!paths.is_valid || !paths.mod_list_ini_path) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200">
        <div className="max-w-md w-full bg-slate-900/80 border border-amber-500/40 rounded-2xl p-6 text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto">
            <FolderX className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Setup Required: ModListData.ini</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              ModListData.ini path must be configured in App Settings to load and sort your active Project Zomboid mods.
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

  // State 2: Valid paths, but 0 active mods in ModListData.ini
  if (mods.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200">
        <div className="max-w-lg w-full bg-slate-900/80 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-5 shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">No Active Mods Found</h3>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Your <code className="text-emerald-400 font-mono">ModListData.ini</code> currently has zero active mods listed. Activate mods in-game or load sample data below.
            </p>
          </div>

          <div className="pt-2 flex justify-center">
            <button
              onClick={() => onLoadMockups(MOCK_MODS)}
              className="flex items-center justify-center gap-2 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-xs font-medium px-4 py-2.5 rounded-lg border border-emerald-800 transition cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Load Sample Active Mods (Preview Demo)
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeCount = mods.filter((m) => m.enabled).length;

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden p-6">
      {/* Header & Controls */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-emerald-400" />
            Mod Load Order Manager (<code className="text-emerald-400">ModListData.ini</code>)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Topological dependency validation. Map mods and base libraries are automatically prioritized.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 font-mono">
            Active Mods: <b className="text-emerald-400">{activeCount}</b> / {mods.length}
          </span>
        </div>
      </div>

      {/* Main Drag-and-Drop Mod List Table */}
      <div className="flex-1 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-slate-900 text-slate-400 font-bold text-[11px] uppercase tracking-wider border-b border-slate-800">
          <div className="col-span-1 text-center">Order</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-5">Mod Name & ID</div>
          <div className="col-span-3">Dependencies (<code className="text-emerald-400">require=</code>)</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {/* Table Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-1">
          {mods.map((mod, idx) => (
            <div
              key={mod.mod_id}
              className={`grid grid-cols-12 gap-4 px-4 py-3 items-center rounded-lg text-xs transition ${
                mod.enabled
                  ? 'bg-slate-950/80 hover:bg-slate-900/90 border border-slate-800'
                  : 'bg-slate-950/30 opacity-50 border border-transparent'
              }`}
            >
              {/* Order Number */}
              <div className="col-span-1 text-center font-mono text-slate-500 font-bold">
                #{idx + 1}
              </div>

              {/* Status Toggle */}
              <div className="col-span-1 flex justify-center">
                <button
                  onClick={() => onToggleMod(mod.mod_id)}
                  className={`w-6 h-6 rounded flex items-center justify-center transition cursor-pointer ${
                    mod.enabled
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-slate-800 text-slate-600 border border-slate-700'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Mod Title & ID with Type Badge */}
              <div className="col-span-5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                  {mod.is_map_mod ? (
                    <MapPin className="w-4 h-4 text-amber-400" />
                  ) : mod.is_library ? (
                    <Package className="w-4 h-4 text-purple-400" />
                  ) : (
                    <ListOrdered className="w-4 h-4 text-cyan-400" />
                  )}
                </div>

                <div className="overflow-hidden">
                  <div className="font-bold text-slate-200 truncate">{mod.name}</div>
                  <div className="text-[10px] font-mono text-slate-500 truncate">ID: {mod.mod_id}</div>
                </div>
              </div>

              {/* Required Dependencies */}
              <div className="col-span-3 flex flex-wrap gap-1">
                {mod.dependencies && mod.dependencies.length > 0 ? (
                  mod.dependencies.map((req: string, rIdx: number) => (
                    <span
                      key={rIdx}
                      className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-900 border border-slate-800 text-cyan-400"
                    >
                      {req}
                    </span>
                  ))
                ) : (
                  <span className="text-[10px] text-slate-600 italic">None</span>
                )}
              </div>

              {/* Move Up/Down Action Buttons */}
              <div className="col-span-2 flex items-center justify-end gap-1">
                <button
                  onClick={() => moveUp(idx)}
                  disabled={idx === 0}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 transition cursor-pointer"
                  title="Move Up"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => moveDown(idx)}
                  disabled={idx === mods.length - 1}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 transition cursor-pointer"
                  title="Move Down"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
