import React, { useState } from 'react';
import { Folder, RefreshCw, CheckCircle2, AlertCircle, Save, FolderOpen, Lock, Unlock } from 'lucide-react';

export interface StudioPathsUI {
  pz_install_dir: string;
  workshop_dir: string;
  user_zomboid_dir: string;
  mod_list_ini_path: string;
  is_valid: boolean;
}

interface SettingsModuleProps {
  paths: StudioPathsUI;
  onSavePaths: (updatedPaths: StudioPathsUI) => void;
  onAutoDetect: () => void;
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  paths,
  onSavePaths,
  onAutoDetect,
}) => {
  const [formData, setFormData] = useState<StudioPathsUI>(paths);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSaved, setIsSaved] = useState<boolean>(false);

  const handleBrowsePath = (field: keyof StudioPathsUI, fieldName: string) => {
    const currentVal = formData[field] as string;
    const newVal = window.prompt(`Select/Enter path for ${fieldName}:`, currentVal);
    if (newVal !== null && newVal.trim() !== '') {
      setFormData((prev) => ({
        ...prev,
        [field]: newVal.trim(),
      }));
      setIsSaved(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSavePaths(formData);
    setIsEditing(false);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-slate-950 text-slate-200 p-6">
      <div className="max-w-3xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Folder className="w-5 h-5 text-emerald-400" />
              Studio Directory Configuration
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Auto-detect paths or use buttons to manually select custom directories.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition cursor-pointer ${
                isEditing
                  ? 'bg-amber-950/80 text-amber-300 border-amber-700/80'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              {isEditing ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-slate-400" />}
              <span>{isEditing ? 'Editing Enabled' : 'Unlock Paths'}</span>
            </button>

            <button
              onClick={onAutoDetect}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg border border-slate-700 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
              Auto-Detect Paths
            </button>
          </div>
        </div>

        {/* Validation Alert */}
        <div
          className={`p-3.5 rounded-xl border mb-6 flex items-center justify-between text-xs font-mono ${
            formData.is_valid
              ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
              : 'bg-amber-950/40 border-amber-800/80 text-amber-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {formData.is_valid ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>
              {formData.is_valid
                ? 'Valid Project Zomboid installation detected.'
                : 'Project Zomboid installation directory not found or invalid. Please select a custom path.'}
            </span>
          </div>
        </div>

        {/* Read-Only Form with Dedicated Browse Buttons */}
        <form onSubmit={handleSave} className="space-y-5 bg-slate-900/60 p-6 rounded-xl border border-slate-800">
          {/* Field 1: PZ Install Directory */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Project Zomboid Installation Path ({'<PZ_Install>'})
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly={!isEditing}
                value={formData.pz_install_dir}
                onChange={(e) => setFormData({ ...formData, pz_install_dir: e.target.value })}
                className={`flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono transition ${
                  isEditing
                    ? 'text-slate-100 border-amber-500/50 focus:outline-none'
                    : 'text-slate-400 cursor-not-allowed select-all'
                }`}
              />
              <button
                type="button"
                onClick={() => handleBrowsePath('pz_install_dir', 'PZ Installation Directory')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                <span>Browse...</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Location containing `ProjectZomboid64.exe` and `media/lua`.
            </p>
          </div>

          {/* Field 2: Steam Workshop Directory */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Steam Workshop Content Path (`content/108600`)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly={!isEditing}
                value={formData.workshop_dir}
                onChange={(e) => setFormData({ ...formData, workshop_dir: e.target.value })}
                className={`flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono transition ${
                  isEditing
                    ? 'text-slate-100 border-amber-500/50 focus:outline-none'
                    : 'text-slate-400 cursor-not-allowed select-all'
                }`}
              />
              <button
                type="button"
                onClick={() => handleBrowsePath('workshop_dir', 'Steam Workshop Content Directory')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                <span>Browse...</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Steam Workshop directory where downloaded mods are stored.
            </p>
          </div>

          {/* Field 3: User Zomboid Directory */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              User Zomboid User Directory (`Zomboid`)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly={!isEditing}
                value={formData.user_zomboid_dir}
                onChange={(e) => setFormData({ ...formData, user_zomboid_dir: e.target.value })}
                className={`flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono transition ${
                  isEditing
                    ? 'text-slate-100 border-amber-500/50 focus:outline-none'
                    : 'text-slate-400 cursor-not-allowed select-all'
                }`}
              />
              <button
                type="button"
                onClick={() => handleBrowsePath('user_zomboid_dir', 'User Zomboid Directory')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                <span>Browse...</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Contains save games, `console.txt`, and local mods folder.
            </p>
          </div>

          {/* Field 4: ModListData.ini Path */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              ModListData.ini Configuration Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly={!isEditing}
                value={formData.mod_list_ini_path}
                onChange={(e) => setFormData({ ...formData, mod_list_ini_path: e.target.value })}
                className={`flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono transition ${
                  isEditing
                    ? 'text-slate-100 border-amber-500/50 focus:outline-none'
                    : 'text-slate-400 cursor-not-allowed select-all'
                }`}
              />
              <button
                type="button"
                onClick={() => handleBrowsePath('mod_list_ini_path', 'ModListData.ini Path')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                <span>Browse...</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Configuration file modified by PZ Mod Studio to manage active load order.
            </p>
          </div>

          {/* Save Button */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            {isSaved && (
              <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Paths saved successfully!
              </span>
            )}

            <button
              type="submit"
              className="ml-auto flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-5 py-2.5 rounded-lg shadow transition cursor-pointer"
            >
              <Save className="w-4 h-4" />
              Save & Apply Paths
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
