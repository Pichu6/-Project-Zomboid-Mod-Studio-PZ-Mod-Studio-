import React, { useState } from 'react';
import { ModInfo } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { ListOrdered, ArrowUp, ArrowDown, Check, ShieldCheck, MapPin, Package, FolderX, Sparkles, ExternalLink, Hash, BookOpen } from 'lucide-react';
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
  const [selectedModId, setSelectedModId] = useState<string>(mods[0]?.mod_id || '');
  const [targetPosInput, setTargetPosInput] = useState<string>('');
  const [assigningModId, setAssigningModId] = useState<string | null>(null);

  const selectedMod = mods.find((m) => m.mod_id === selectedModId) || mods[0];

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

  const handleAssignPosition = (modId: string, newPosOneBased: number) => {
    const currentIndex = mods.findIndex((m) => m.mod_id === modId);
    if (currentIndex === -1) return;

    let targetIndex = Math.max(0, Math.min(mods.length - 1, newPosOneBased - 1));
    const updated = [...mods];
    const [movedMod] = updated.splice(currentIndex, 1);
    updated.splice(targetIndex, 0, movedMod);
    onReorder(updated);
    setAssigningModId(null);
    setTargetPosInput('');
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
      {/* Module Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-emerald-400" />
            Mod List & Load Order Manager (<code className="text-emerald-400">ModListData.ini</code>)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            View subscribed mods, assign position numbers, and inspect Workshop metadata details.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 font-mono">
            Active Mods: <b className="text-emerald-400">{activeCount}</b> / {mods.length}
          </span>
        </div>
      </div>

      {/* Main 2-Column Grid: Left Column Reorderable List / Right Column Mod Inspector */}
      <div className="flex-1 grid grid-cols-12 gap-6 min-h-0">
        {/* Left Column (7 cols): Reorderable Mod List */}
        <div className="col-span-12 lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-900 text-slate-400 font-bold text-[11px] uppercase tracking-wider border-b border-slate-800">
            <div className="col-span-1 text-center">Nº</div>
            <div className="col-span-1 text-center">Active</div>
            <div className="col-span-6">Mod Name & ID</div>
            <div className="col-span-4 text-right">Actions</div>
          </div>

          {/* Table Rows */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-1">
            {mods.map((mod, idx) => {
              const isSelected = mod.mod_id === selectedModId;
              const isAssigningThis = assigningModId === mod.mod_id;

              return (
                <div
                  key={mod.mod_id}
                  onClick={() => setSelectedModId(mod.mod_id)}
                  className={`grid grid-cols-12 gap-2 px-3 py-2.5 items-center rounded-lg text-xs cursor-pointer transition ${
                    isSelected
                      ? 'bg-slate-800/90 border border-emerald-500/50 shadow'
                      : 'bg-slate-950/60 hover:bg-slate-900/90 border border-slate-800/50'
                  }`}
                >
                  {/* Fixed Line Number */}
                  <div className="col-span-1 text-center font-mono text-slate-400 font-bold text-[11px]">
                    #{idx + 1}
                  </div>

                  {/* Enable/Disable Toggle */}
                  <div className="col-span-1 flex justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMod(mod.mod_id);
                      }}
                      className={`w-5 h-5 rounded flex items-center justify-center transition cursor-pointer ${
                        mod.enabled
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-600 border border-slate-700'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Mod Title & Type Icon */}
                  <div className="col-span-6 flex items-center gap-2.5 overflow-hidden">
                    <div className="w-6 h-6 rounded bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                      {mod.is_map_mod ? (
                        <MapPin className="w-3.5 h-3.5 text-amber-400" />
                      ) : mod.is_library ? (
                        <Package className="w-3.5 h-3.5 text-purple-400" />
                      ) : (
                        <ListOrdered className="w-3.5 h-3.5 text-cyan-400" />
                      )}
                    </div>

                    <div className="overflow-hidden">
                      <div className="font-bold text-slate-200 truncate">{mod.name}</div>
                      <div className="text-[9px] font-mono text-slate-500 truncate">ID: {mod.mod_id}</div>
                    </div>
                  </div>

                  {/* Quick Actions: Assign Position & Up/Down */}
                  <div className="col-span-4 flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {isAssigningThis ? (
                      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded border border-emerald-500">
                        <input
                          type="number"
                          placeholder="Nº"
                          value={targetPosInput}
                          onChange={(e) => setTargetPosInput(e.target.value)}
                          className="w-12 bg-slate-900 border border-slate-700 px-1 py-0.5 text-xs text-emerald-300 font-mono text-center rounded"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleAssignPosition(mod.mod_id, parseInt(targetPosInput) || 1);
                            }
                          }}
                        />
                        <button
                          onClick={() => handleAssignPosition(mod.mod_id, parseInt(targetPosInput) || 1)}
                          className="px-1.5 py-0.5 bg-emerald-600 text-white rounded text-[10px] font-bold"
                        >
                          Go
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setAssigningModId(mod.mod_id);
                          setTargetPosInput(String(idx + 1));
                        }}
                        className="px-2 py-1 text-[10px] font-mono font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer flex items-center gap-1"
                        title="Assign Position #"
                      >
                        <Hash className="w-3 h-3 text-emerald-400" />
                        <span>Pos #</span>
                      </button>
                    )}

                    <button
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
                      title="Move Up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => moveDown(idx)}
                      disabled={idx === mods.length - 1}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
                      title="Move Down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column (5 cols): Selected Mod Workshop Inspector */}
        <div className="col-span-12 lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow p-4">
          {selectedMod ? (
            <div className="flex-1 flex flex-col overflow-y-auto space-y-4 pr-1">
              {/* Mod Title & Header Badge */}
              <div className="border-b border-slate-800 pb-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                    {selectedMod.is_map_mod ? 'MAP MOD' : selectedMod.is_library ? 'BASE LIBRARY' : 'SCRIPT MOD'}
                  </span>

                  {selectedMod.workshop_id && (
                    <a
                      href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${selectedMod.workshop_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-cyan-400 hover:underline font-mono"
                    >
                      <span>Steam Workshop</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <h3 className="text-base font-bold text-slate-100">{selectedMod.name}</h3>
                <div className="text-xs font-mono text-slate-400">ID: <code className="text-emerald-400">{selectedMod.mod_id}</code></div>
              </div>

              {/* Poster / Workshop Thumbnail Placeholder */}
              <div className="h-40 bg-slate-950 rounded-lg border border-slate-800 flex flex-col items-center justify-center text-slate-500 space-y-2 relative overflow-hidden">
                <BookOpen className="w-10 h-10 text-slate-700" />
                <span className="text-xs font-mono text-slate-500">Workshop Preview Poster</span>
              </div>

              {/* Mod Description */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Description
                </label>
                <div className="p-3 bg-slate-950 rounded-lg text-xs text-slate-300 leading-relaxed font-sans border border-slate-800 max-h-48 overflow-y-auto">
                  {selectedMod.description || 'No description provided in mod.info manifest.'}
                </div>
              </div>

              {/* Dependencies */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Required Dependencies (<code className="text-emerald-400">require=</code>)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {selectedMod.dependencies && selectedMod.dependencies.length > 0 ? (
                    selectedMod.dependencies.map((req, rIdx) => (
                      <span
                        key={rIdx}
                        className="px-2.5 py-1 text-xs font-mono rounded-md bg-slate-950 border border-slate-800 text-cyan-400 font-medium"
                      >
                        {req}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500 italic">No dependencies required</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
              Select a mod from the left list to view Workshop metadata details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
