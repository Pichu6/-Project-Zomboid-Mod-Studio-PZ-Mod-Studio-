import React, { useState, useEffect } from 'react';
import { Layers, Plus, Check, Trash2, Zap, FolderArchive, RefreshCw, Edit3, Share2, X, Save } from 'lucide-react';
import { ModInfo, StudioPathsUI, AppInstance } from '../../types';
import { TauriService, explainError } from '../../services/tauri';

interface InstanceModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  onApplyInstanceLoadOrder: (loadOrder: string[], activeIds: string[]) => void;
  onProfileActivated?: (inst: AppInstance) => void;
  /** The active profile was deleted, so nothing is active any more. */
  onProfileDeleted?: () => void;
  /** Takes the user to Browse Mods, for a profile that starts with nothing in it. */
  onGoToBrowse?: () => void;
}

/** What a new profile starts with. */
type NewProfileMods = 'current' | 'all' | 'none' | 'pick';

export const InstanceModule: React.FC<InstanceModuleProps> = ({
  paths,
  mods,
  onApplyInstanceLoadOrder,
  onProfileActivated,
  onProfileDeleted,
  onGoToBrowse,
}) => {
  const [instances, setInstances] = useState<AppInstance[]>([]);
  const [newInstanceName, setNewInstanceName] = useState('');
  /**
   * A profile is a mod list, so making one asks which mods. The old form took whatever happened
   * to be switched on, which is right often enough to stay the default and wrong whenever the
   * point of the new profile is to be different from the one you are in.
   */
  const [newProfileMods, setNewProfileMods] = useState<NewProfileMods>('current');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickSearch, setPickSearch] = useState('');
  const [newInstanceDesc, setNewInstanceDesc] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Edit Modal State
  const [editingInstance, setEditingInstance] = useState<AppInstance | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const activeMods = mods.filter((m) => m.enabled);

  const loadInstances = async () => {
    setIsLoading(true);
    try {
      const list: AppInstance[] = await TauriService.listInstances(paths.user_zomboid_dir);
      setInstances(list);
    } catch (err) {
      console.error('Error loading profiles:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInstances();
  }, [paths.user_zomboid_dir]);

  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) {
      alert('Please enter a name for the profile.');
      return;
    }

    // Creating a profile writes the mod list the game reads. With nothing scanned — the game
    // folder is not set yet, or the scan failed — that would switch every mod off and say it
    // worked. Better to send the user to Settings.
    if (mods.length === 0) {
      alert(
        'No mods found yet, so a profile saved now would switch all your mods off.\n\n' +
          'Set your game and Zomboid folders in App Settings first; the Studio will find your mods, ' +
          'and then a profile will remember them.'
      );
      return;
    }

    const chosen: string[] =
      newProfileMods === 'all'
        ? mods.map((m) => m.mod_id)
        : newProfileMods === 'none'
        ? []
        : newProfileMods === 'pick'
        ? mods.filter((m) => picked.has(m.mod_id)).map((m) => m.mod_id)
        : activeMods.map((m) => m.mod_id);

    if (newProfileMods === 'pick' && chosen.length === 0) {
      alert('Nothing is ticked, so this profile would switch every mod off. Tick the mods you want, or choose "Nothing yet".');
      return;
    }
    if (newProfileMods === 'none' && !confirm(
      'Create an empty profile?\n\nSwitching to it turns every mod off, which is what you want ' +
        'before subscribing to a new set. Your other profiles keep their mods.'
    )) {
      return;
    }

    try {
      const activeModIds = chosen;
      // The order the list already has, so a profile does not reshuffle what you sorted.
      const loadOrder = mods.map((m) => m.mod_id);

      const created: AppInstance = await TauriService.createInstance(
        paths.user_zomboid_dir || '',
        newInstanceName.trim(),
        newInstanceDesc.trim() || undefined,
        activeModIds,
        loadOrder
      );

      setNewInstanceName('');
      setNewInstanceDesc('');
      setPicked(new Set());
      setPickSearch('');
      await loadInstances();

      // Activate it so the rest of the app unlocks, and only then say so.
      await handleActivateInstance(created);
      setStatusMessage(`Profile '${created.name}' created and activated.`);
    } catch (err: any) {
      alert(`Error creating profile: ${explainError(err)}`);
    }
  };

  const handleOpenEdit = (inst: AppInstance) => {
    setEditingInstance(inst);
    setEditName(inst.name);
    setEditDesc(inst.description || '');
  };

  const handleSaveEdit = async () => {
    if (!editingInstance || !editName.trim()) return;

    try {
      const updated: AppInstance = {
        ...editingInstance,
        name: editName.trim(),
        description: editDesc.trim() || undefined,
      };

      await TauriService.updateInstance(paths.user_zomboid_dir, updated);
      setStatusMessage(`✨ Profile '${updated.name}' updated successfully.`);
      setEditingInstance(null);
      await loadInstances();
    } catch (err: any) {
      alert(`Error updating profile: ${explainError(err)}`);
    }
  };

  const handleActivateInstance = async (inst: AppInstance) => {
    try {
      await TauriService.activateInstance(paths.user_zomboid_dir, inst.id);
      onApplyInstanceLoadOrder(inst.load_order, inst.active_mod_ids);
      if (onProfileActivated) {
        onProfileActivated(inst);
      }
      setStatusMessage(`⚡ Profile '${inst.name}' activated successfully. Mods applied to the game!`);
      await loadInstances();
    } catch (err: any) {
      alert(`Error activating profile: ${explainError(err)}`);
    }
  };

  /**
   * A profile is a named mod list, which is exactly what a .pzpack holds, so sharing one reuses
   * that format: the other player gets the mod ids with their Workshop ids and can subscribe.
   */
  const handleShareInstance = async (inst: AppInstance) => {
    const byId = new Map(mods.map((m) => [m.mod_id, m]));
    const active = new Set(inst.active_mod_ids);
    const preset = {
      id: `profile_${inst.id}`,
      name: inst.name,
      description: inst.description || `Mod profile shared from PZ Mod Studio`,
      author: undefined,
      created_at: new Date().toISOString(),
      mods: inst.load_order
        .filter((id) => active.has(id))
        .map((id) => ({
          mod_id: id,
          name: byId.get(id)?.name ?? id,
          workshop_id: byId.get(id)?.workshop_id,
          enabled: true,
        })),
      load_order: inst.load_order.filter((id) => active.has(id)),
    };
    if (preset.mods.length === 0) {
      alert('This profile has no mods switched on, so there would be nothing to share.');
      return;
    }
    try {
      const fileName = `${inst.name.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'profile'}.pzpack`;
      const filePath = await TauriService.pickSaveFile(fileName, 'PZ Mod Studio profile (.pzpack)', 'pzpack');
      if (!filePath) return;
      await TauriService.exportPresetFile(paths, preset as never, filePath);
      setStatusMessage(`Profile '${inst.name}' saved to ${filePath}. Send that file to anyone.`);
    } catch (err) {
      alert(`The profile could not be saved: ${explainError(err)}`);
    }
  };

  const handleDeleteInstance = async (inst: AppInstance) => {
    // A patch package is made for the mods of the profile it was built in: its merges are about
    // those versions of those files. Left behind, it goes on loading last for every other
    // profile, which is how a merge for mods you no longer use ends up in a list that never
    // asked for it.
    const itsPackages = inst.active_mod_ids.filter(
      (id) => id.startsWith('Z_PZModStudio_') && id !== 'Z_PZModStudio_Bridge'
    );
    if (!confirm(`Delete profile '${inst.name}'?`)) return;
    let alsoPackages = false;
    if (itsPackages.length > 0) {
      alsoPackages = confirm(
        `Delete the ${itsPackages.length} patch package${itsPackages.length === 1 ? '' : 's'} this profile uses as well?\n\n` +
          `${itsPackages.join(', ')}\n\n` +
          `They hold merges made for this profile's mods. If you pick the same mods again later, ` +
          `the Studio works the compatibility out again from what is installed then.\n\n` +
          `Cancel keeps them.`
      );
    }
    try {
      await TauriService.deleteInstance(paths.user_zomboid_dir, inst.id);
      if (alsoPackages) {
        for (const folder of itsPackages) {
          try {
            await TauriService.deleteMergedPackage(paths.user_zomboid_dir, paths.mod_list_ini_path, folder);
          } catch (err) {
            alert(`${folder} could not be deleted: ${explainError(err)}`);
          }
        }
      }
      setStatusMessage(
        alsoPackages
          ? `Profile '${inst.name}' and its ${itsPackages.length} patch package(s) deleted.`
          : `Profile '${inst.name}' deleted.`
      );
      await loadInstances();
      // The header and the sidebar were still showing it as active until a restart.
      if (inst.is_active) onProfileDeleted?.();
    } catch (err: any) {
      alert(`Error deleting profile: ${explainError(err)}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-5 bg-gradient-to-r from-emerald-950/80 via-slate-900 to-teal-950/80 border border-emerald-800/60 rounded-2xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Layers className="w-6 h-6 text-emerald-400" />
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              Mod Profiles
            </h2>
            {isLoading && <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin ml-2" />}
          </div>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            Create and save custom mod combinations (e.g., <i>Vanilla Plus B42</i>, <i>Brita + Weapons</i>, <i>Co-op Server</i>) and switch between them with 1 click without losing your load order.
          </p>
        </div>

        <span className="text-xs font-mono bg-emerald-950 text-emerald-300 border border-emerald-800 px-3 py-1.5 rounded-xl font-bold">
          {instances.length} Saved Profiles
        </span>
      </div>

      {statusMessage && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-700/80 rounded-xl text-xs text-emerald-300 font-bold flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-emerald-400 hover:underline">
            Close
          </button>
        </div>
      )}

      {/* Main Grid: Create Profile & Instance Cards */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: Create New Profile */}
        <div className="col-span-12 lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
          <div className="border-b border-slate-800 pb-3 space-y-1">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>Create New Profile</span>
            </h3>
            <p className="text-xs text-slate-400">
              Create an independent profile to organize and save a mod combination.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Profile Name
              </label>
              <input
                type="text"
                placeholder="e.g., B42 Brita & GunFighter"
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-medium"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Description (Optional)
              </label>
              <textarea
                rows={3}
                placeholder="Notes for the mods included in this profile..."
                value={newInstanceDesc}
                onChange={(e) => setNewInstanceDesc(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Which mods
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: 'current', label: 'What is on now', count: activeMods.length },
                  { id: 'all', label: 'Everything installed', count: mods.length },
                  { id: 'pick', label: 'Pick them', count: picked.size },
                  { id: 'none', label: 'Nothing yet', count: 0 },
                ] as { id: NewProfileMods; label: string; count: number }[]).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setNewProfileMods(option.id)}
                    aria-pressed={newProfileMods === option.id}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border transition cursor-pointer text-left ${
                      newProfileMods === option.id
                        ? 'bg-emerald-950/70 text-emerald-200 border-emerald-700'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {option.label}
                    <span className="block text-[10px] font-mono opacity-70">
                      {option.id === 'none' ? 'start empty' : `${option.count} mods`}
                    </span>
                  </button>
                ))}
              </div>

              {newProfileMods === 'pick' && (
                <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                  <div className="flex items-center gap-2 p-2 border-b border-slate-800">
                    <input
                      type="text"
                      value={pickSearch}
                      onChange={(e) => setPickSearch(e.target.value)}
                      placeholder="Search your mods..."
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setPicked(new Set(mods.map((m) => m.mod_id)))}
                      className="text-[10px] px-1.5 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setPicked(new Set())}
                      className="text-[10px] px-1.5 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                    >
                      None
                    </button>
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-900">
                    {mods
                      .filter((m) => {
                        const q = pickSearch.trim().toLowerCase();
                        return !q || m.name.toLowerCase().includes(q) || m.mod_id.toLowerCase().includes(q);
                      })
                      .map((m) => (
                        <label
                          key={m.mod_id}
                          className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-900/80 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={picked.has(m.mod_id)}
                            onChange={(e) => {
                              const next = new Set(picked);
                              if (e.target.checked) next.add(m.mod_id);
                              else next.delete(m.mod_id);
                              setPicked(next);
                            }}
                            className="accent-emerald-500"
                          />
                          <span className="truncate">{m.name}</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}

              {newProfileMods === 'none' && onGoToBrowse && (
                <button
                  type="button"
                  onClick={onGoToBrowse}
                  className="mt-2 w-full py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer"
                  title="Subscribe to what you want, then come back and make the profile"
                >
                  Find mods in Browse Mods
                </button>
              )}
            </div>

            <button
              onClick={handleCreateInstance}
              disabled={!newInstanceName.trim()}
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-lg flex items-center justify-center gap-2 mt-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Profile</span>
            </button>
          </div>
        </div>

        {/* Right Column: Display Cards of All Saved Profiles */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {instances.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {instances.map((inst) => (
                <div
                  key={inst.id}
                  className={`p-4 rounded-2xl border transition flex flex-col justify-between space-y-4 shadow-lg ${
                    inst.is_active
                      ? 'bg-gradient-to-br from-emerald-950/80 via-slate-900 to-slate-900 border-emerald-500/90 ring-1 ring-emerald-500/50'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <FolderArchive className={`w-5 h-5 ${inst.is_active ? 'text-emerald-400' : 'text-slate-400'}`} />
                        <h4 className="text-sm font-bold text-slate-100">{inst.name}</h4>
                      </div>

                      {inst.is_active ? (
                        <span className="text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Check className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-500">Inactive</span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                      {inst.description || 'Mod profile for Project Zomboid.'}
                    </p>

                    <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 pt-1">
                      <span className="text-emerald-400 font-bold">{inst.active_mod_ids.length} Active Mods</span>
                      <span>•</span>
                      <span>Total: {inst.load_order.length}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    {!inst.is_active && (
                      <button
                        onClick={() => handleActivateInstance(inst)}
                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow"
                      >
                        <Zap className="w-3.5 h-3.5 fill-white" />
                        <span>Activate (1-Click)</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleShareInstance(inst)}
                      className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition cursor-pointer"
                      title="Save this profile to a file you can send to someone else"
                      aria-label={`Share the profile ${inst.name}`}
                    >
                      <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>

                    <button
                      onClick={() => handleOpenEdit(inst)}
                      className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition cursor-pointer"
                      title="Rename this profile"
                      aria-label={`Rename the profile ${inst.name}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleDeleteInstance(inst)}
                      className="p-2 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-700 rounded-xl transition cursor-pointer"
                      title="Delete this profile"
                      aria-label={`Delete the profile ${inst.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-64 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col items-center justify-center p-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shadow">
                <Layers className="w-7 h-7 text-emerald-400" />
              </div>
              <div className="space-y-1 max-w-md">
                <h3 className="text-sm font-bold text-slate-200">No profiles created</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Create your first profile in the left panel to save the current mod combination.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Profile Modal */}
      {editingInstance && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-emerald-400" />
                <span>Edit Mod Profile</span>
              </h3>
              <button
                onClick={() => setEditingInstance(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Profile Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-medium"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow"
              >
                <Save className="w-4 h-4" />
                <span>Save Changes</span>
              </button>
              <button
                onClick={() => setEditingInstance(null)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

