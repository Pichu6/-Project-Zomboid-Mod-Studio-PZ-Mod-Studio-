import React, { useState } from 'react';
import { ModInfo, ModPreset, MissingModsReport } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, explainError } from '../../services/tauri';
import {
  AlertTriangle,
  Bookmark,
  Check,
  Download,
  ExternalLink,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

const STORAGE_KEY = 'pz_mod_studio_saved_presets';

interface ModPresetsProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  /** Applies a preset's order and switches; without it the list is rebuilt here and handed to onReorder. */
  onApplyPresetLoadOrder?: (presetLoadOrder: string[], activeIds: string[]) => void;
  onReorder: (newOrder: ModInfo[]) => void;
  /** Opens this Workshop item's page in Browse Mods, for a mod the pack needs and you do not have. */
  onOpenInBrowser?: (workshopId: string) => void;
  toast: (message: string, ms?: number) => void;
}

/**
 * Presets: a named copy of the list -- which mods are on and in what order -- kept in the
 * browser store, and the `.pzpack` files they travel in. The dropdown button, its menu and the
 * two dialogs (save, import) live here; the dialogs are fixed overlays, so where this sits in the
 * page makes no difference.
 */
export const ModPresets: React.FC<ModPresetsProps> = ({
  paths,
  mods,
  onApplyPresetLoadOrder,
  onReorder,
  onOpenInBrowser,
  toast,
}) => {
  const [savedPresets, setSavedPresets] = useState<ModPreset[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [newPresetDesc, setNewPresetDesc] = useState<string>('');
  const [importedPreset, setImportedPreset] = useState<ModPreset | null>(null);
  const [missingReport, setMissingReport] = useState<MissingModsReport | null>(null);

  const activeCount = mods.filter((m) => m.enabled).length;

  const persist = (updated: ModPreset[]) => {
    setSavedPresets(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  /** The list as it is now, as a preset: only the mods switched on, in their order. */
  const currentAsPreset = (name: string, description?: string): ModPreset => ({
    id: `preset_${Date.now()}`,
    name,
    description,
    author: undefined,
    created_at: new Date().toISOString(),
    mods: mods.filter((m) => m.enabled).map((m) => ({
      mod_id: m.mod_id,
      name: m.name,
      workshop_id: m.workshop_id,
      enabled: true,
    })),
    // Only the mods this preset is about: the full list would hand the other player every
    // mod the exporter happens to own, plus packages that exist on no other machine.
    load_order: mods.filter((m) => m.enabled).map((m) => m.mod_id),
  });

  const handleSaveCurrentAsPreset = () => {
    if (!newPresetName.trim()) {
      alert('Please enter a name for the preset.');
      return;
    }
    const newPreset = currentAsPreset(newPresetName.trim(), newPresetDesc.trim() || undefined);
    persist([newPreset, ...savedPresets.filter((p) => p.name !== newPreset.name)]);
    setActivePresetName(newPreset.name);
    setIsSaveModalOpen(false);
    setNewPresetName('');
    setNewPresetDesc('');
    toast(`✨ Preset '${newPreset.name}' saved successfully.`);
  };

  const handleApplyPreset = (preset: ModPreset) => {
    const activeIds = preset.mods.filter((m) => m.enabled).map((m) => m.mod_id);
    if (onApplyPresetLoadOrder) {
      onApplyPresetLoadOrder(preset.load_order, activeIds);
    } else {
      const activeSet = new Set(activeIds);
      const modMap = new Map(mods.map((m) => [m.mod_id, m]));
      const reordered: ModInfo[] = [];

      preset.load_order.forEach((id) => {
        const found = modMap.get(id);
        if (found) {
          reordered.push({ ...found, enabled: activeSet.has(id) });
          modMap.delete(id);
        }
      });

      modMap.forEach((m) => {
        reordered.push({ ...m, enabled: activeSet.has(m.mod_id) });
      });

      onReorder(reordered);
    }
    setActivePresetName(preset.name);
    setIsDropdownOpen(false);
    setIsImportModalOpen(false);
    toast(`✨ Preset '${preset.name}' applied to the game.`);
  };

  const handleDeletePreset = (presetId: string) => {
    const target = savedPresets.find((p) => p.id === presetId);
    if (confirm(`Delete preset '${target?.name || ''}'?`)) {
      persist(savedPresets.filter((p) => p.id !== presetId));
      if (activePresetName === target?.name) {
        setActivePresetName(null);
      }
      toast('Preset deleted.', 2500);
    }
  };

  const handleExportPresetFile = async (targetPreset?: ModPreset) => {
    const presetToExport: ModPreset =
      targetPreset || currentAsPreset(activePresetName || 'ModList_Preset', 'Exported from PZ Mod Studio');

    // The same list under different sandbox settings is a different game, so they can travel
    // with it. Asked for before the save dialog, and only when there is something to offer.
    let sandboxName: string | null = null;
    const mine = await TauriService.sandboxPresets(paths.user_zomboid_dir);
    if (mine.length === 1) {
      const only = mine[0];
      if (
        confirm(
          `Include your sandbox settings "${only.name}" (${only.settings} settings, ` +
            `${only.mod_settings} of them from mods)?\n\nWhoever opens the pack can save them as a preset ` +
            `and pick them when starting a game.`
        )
      ) {
        sandboxName = only.name;
      }
    } else if (mine.length > 1) {
      const answer = prompt(
        `Include sandbox settings in the pack? Type the name, or leave it empty for none.\n\n` +
          mine.map((p) => `- ${p.name} (${p.settings} settings, ${p.mod_settings} from mods)`).join('\n')
      );
      const match = mine.find((p) => p.name.toLowerCase() === (answer ?? '').trim().toLowerCase());
      if (answer && answer.trim() && !match) {
        alert(`There is no sandbox preset called "${answer.trim()}". The pack will have no settings in it.`);
      }
      sandboxName = match?.name ?? null;
    }

    try {
      const defaultFileName = `${presetToExport.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.pzpack`;
      const filePath = await TauriService.pickSaveFile(defaultFileName, 'PZ Mod Studio Preset (.pzpack)', 'pzpack');
      if (filePath) {
        await TauriService.exportPresetFile(paths, presetToExport, filePath, sandboxName);
        toast(`✨ Collection exported to: ${filePath}`, 4000);
      }
    } catch (err: any) {
      alert(`Error exporting preset: ${explainError(err)}`);
    }
  };

  const handleImportPresetFile = async () => {
    try {
      const filePath = await TauriService.pickOpenFile('PZ Mod Studio Preset (.pzpack)', 'pzpack');
      if (filePath) {
        const preset: ModPreset = await TauriService.importPresetFile(filePath);
        setImportedPreset(preset);

        const report: MissingModsReport = await TauriService.checkMissingPresetMods(
          preset,
          paths.user_zomboid_dir,
          paths.workshop_dir
        );
        setMissingReport(report);
        setIsImportModalOpen(true);
        setIsDropdownOpen(false);
      }
    } catch (err: any) {
      alert(`Error importing .pzpack file: ${explainError(err)}`);
    }
  };

  const handleApplyImportedPreset = () => {
    if (!importedPreset) return;
    handleApplyPreset(importedPreset);
    if (!savedPresets.some((p) => p.name === importedPreset.name)) {
      persist([importedPreset, ...savedPresets]);
    }
    setImportedPreset(null);
    setMissingReport(null);
  };

  const closeImport = () => {
    setIsImportModalOpen(false);
    setImportedPreset(null);
    setMissingReport(null);
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg text-xs font-medium transition cursor-pointer shrink-0"
          title="Preset Management & Collections (.pzpack)"
        >
          <Bookmark className="w-3.5 h-3.5 text-cyan-400" />
          <span>{activePresetName ? `Preset: ${activePresetName}` : `Presets (${savedPresets.length})`}</span>
        </button>

        {isDropdownOpen && (
          <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 p-2 space-y-2">
            <div className="text-[11px] font-bold text-slate-400 px-2 py-1 uppercase tracking-wider border-b border-slate-800 flex items-center justify-between">
              <span>Mod Presets</span>
              <span className="text-cyan-400 font-mono text-[10px]">{savedPresets.length} Saved</span>
            </div>

            <div className="space-y-1">
              <button
                onClick={() => {
                  setIsSaveModalOpen(true);
                  setIsDropdownOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-950/40 rounded-lg transition text-left cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Save Current List as Preset</span>
              </button>

              <button
                onClick={handleImportPresetFile}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-cyan-300 hover:bg-cyan-950/40 rounded-lg transition text-left cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-cyan-400" />
                <span>Import .pzpack File</span>
              </button>

              <button
                onClick={() => {
                  handleExportPresetFile();
                  setIsDropdownOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition text-left cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                <span>Export Current List (.pzpack)</span>
              </button>
            </div>

            {savedPresets.length > 0 && (
              <>
                <div className="text-[10px] font-bold text-slate-500 px-2 pt-1 uppercase border-t border-slate-800">
                  Load Saved Preset
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {savedPresets.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-1.5 bg-slate-950 hover:bg-slate-800/80 rounded-lg border border-slate-800/80 text-xs group"
                    >
                      <button
                        onClick={() => handleApplyPreset(p)}
                        className="flex-1 text-left truncate pr-2 text-slate-200 hover:text-cyan-300 font-medium text-xs cursor-pointer"
                        title={`Load ${p.name} (${p.mods.length} mods)`}
                      >
                        <div className="truncate font-semibold">{p.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{p.mods.filter((m) => m.enabled).length} active mods</div>
                      </button>
                      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100">
                        <button
                          onClick={() => handleExportPresetFile(p)}
                          className="p-1 hover:text-cyan-400 transition cursor-pointer"
                          title="Export as .pzpack"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeletePreset(p.id)}
                          className="p-1 hover:text-red-400 transition cursor-pointer"
                          title="Delete preset"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Save Preset Dialog Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Bookmark className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-slate-100">Save Current List as Preset</h3>
              </div>
              <button onClick={() => setIsSaveModalOpen(false)} className="text-slate-500 hover:text-slate-300 p-1">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Save the current configuration of <b className="text-emerald-400">{activeCount} active mods</b> and its load order so you can restore it at any time.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Preset Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Hardcore Survival 1993, Vanilla Plus..."
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Optimized collection with weapon and UI mods"
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsSaveModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCurrentAsPreset}
                disabled={!newPresetName.trim()}
                className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow transition cursor-pointer flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Preset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Imported Preset & Missing Mods Diagnostic Modal */}
      {isImportModalOpen && importedPreset && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="text-base font-bold text-slate-100">Collection: {importedPreset.name}</h3>
                  <p className="text-[11px] text-slate-400">{importedPreset.description || 'Imported from .pzpack file'}</p>
                </div>
              </div>
              <button onClick={closeImport} className="text-slate-500 hover:text-slate-300 p-1">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Diagnostic Report */}
            {missingReport && (
              <div className="space-y-2">
                {missingReport.missing_mods.length > 0 ? (
                  <div className="p-3.5 bg-amber-950/70 border-2 border-amber-500/80 rounded-xl space-y-2 text-xs shadow-md">
                    <div className="flex items-center justify-between font-bold text-amber-300">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Mods Not Installed on your PC ({missingReport.missing_mods.length})</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      To fully enjoy this preset, subscribe to these mods on Steam Workshop:
                    </p>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {missingReport.missing_mods.map((m, idx) => (
                        <div key={idx} className="flex items-center justify-between p-1.5 bg-slate-950/80 rounded border border-slate-800 text-[11px] font-mono">
                          <span className="text-slate-200 truncate max-w-[240px]">{m.name}</span>
                          {m.workshop_id ? (
                            <button
                              onClick={() => (onOpenInBrowser ? onOpenInBrowser(m.workshop_id!) : TauriService.openExternalUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshop_id}`))}
                              className="text-cyan-400 hover:underline flex items-center gap-1 text-[10px]"
                            >
                              <span>Steam (#{m.workshop_id})</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          ) : (
                            <span className="text-slate-500 text-[10px]">Local Mod</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 bg-emerald-950/60 border border-emerald-700/80 rounded-xl flex items-center gap-3 text-xs text-emerald-300">
                    <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div>
                      <div className="font-bold">All mods in the collection are installed!</div>
                      <div className="text-[11px] text-slate-300">You can apply the order and activation immediately.</div>
                    </div>
                  </div>
                )}

                {/* Settings that came with the pack: saved only if the player wants them. */}
                {importedPreset?.sandbox && (
                  <div className="p-3 bg-slate-900 border border-slate-700 rounded-xl space-y-2">
                    <div className="text-[11px] text-slate-200">
                      This pack also carries the sandbox settings{' '}
                      <b className="text-slate-100">{importedPreset.sandbox.name}</b> —{' '}
                      {importedPreset.sandbox.settings} settings,{' '}
                      {importedPreset.sandbox.mod_settings} of them from mods.
                    </div>
                    <button
                      onClick={async () => {
                        if (!importedPreset?.sandbox) return;
                        try {
                          const name = await TauriService.writeSandboxPreset(paths.user_zomboid_dir, importedPreset.sandbox);
                          toast(`Saved as the sandbox preset "${name}". Pick it when you start a game.`, 5000);
                        } catch (err) {
                          alert(explainError(err));
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer transition"
                      title="Writes them into Zomboid/Sandbox Presets without touching any preset of your own"
                    >
                      Save these settings as a preset
                    </button>
                  </div>
                )}

                {/* The same list on a different build is a different game. */}
                {missingReport.pack_game_version &&
                  missingReport.your_game_version &&
                  missingReport.pack_game_version !== missingReport.your_game_version && (
                    <div className="p-3 bg-slate-900 border border-slate-700 rounded-xl text-[11px] text-slate-300">
                      This list was put together on build <b className="text-slate-100">{missingReport.pack_game_version}</b>;
                      yours is <b className="text-slate-100">{missingReport.your_game_version}</b>. Mods made for one build do
                      not always work on the other, and saves never cross them.
                    </div>
                  )}

                {/* Installed, but not the copy the pack was made with. */}
                {missingReport.drift && missingReport.drift.length > 0 && (
                  <div className="p-3 bg-slate-900 border border-slate-700 rounded-xl space-y-2">
                    <div className="text-[11px] font-bold text-slate-200">
                      {missingReport.drift.length} mod{missingReport.drift.length === 1 ? '' : 's'} differ from the copy this
                      list was made with
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      Steam only ever gives you the newest copy, so there is nothing to fix here. It is worth knowing when a
                      recipe or an item is not where the sender said it was.
                    </p>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {missingReport.drift.map((d) => (
                        <div key={d.mod_id} className="flex items-center justify-between gap-2 p-1.5 bg-slate-950/80 rounded border border-slate-800 text-[11px]">
                          <span className="text-slate-200 truncate">{d.name}</span>
                          <span className="font-mono text-[10px] text-slate-400 shrink-0">
                            {d.direction === 'older'
                              ? 'yours is older'
                              : d.direction === 'newer'
                              ? 'yours is newer'
                              : 'version differs'}
                            {d.pack_version || d.your_version ? ` (${d.pack_version ?? '?'} → ${d.your_version ?? '?'})` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={closeImport}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyImportedPreset}
                className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow transition cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Apply Preset to my Game</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
