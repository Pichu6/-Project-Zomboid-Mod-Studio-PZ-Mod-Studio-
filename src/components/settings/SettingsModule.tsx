import React, { useState } from 'react';
import { FolderOpen, CheckCircle, AlertTriangle, RefreshCw, Save, HardDrive } from 'lucide-react';
import { TauriService } from '../../services/tauri';

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
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const handlePickFolder = async (field: keyof StudioPathsUI, currentVal: string) => {
    const selectedFolder = await TauriService.pickFolder(currentVal);
    if (selectedFolder) {
      setFormData((prev) => ({
        ...prev,
        [field]: selectedFolder,
      }));
    }
  };

  const handleSave = () => {
    onSavePaths(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-y-auto p-6">
      {/* Settings Header */}
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-emerald-400" />
              Project Zomboid Studio Directory Settings
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure local and Workshop paths for Virtual File System overlay conflict scanning.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onAutoDetect}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
              Auto-Detect Paths
            </button>

            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow transition cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Save Settings
            </button>
          </div>
        </div>

        {savedSuccess && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-500/40 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            Paths saved and validated successfully!
          </div>
        )}

        {/* Directory Input Form Cards */}
        <div className="space-y-4">
          {/* Card 1: PZ Installation Path */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200">
                Project Zomboid Installation Path
              </label>
              {formData.pz_install_dir ? (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Valid Path
                </span>
              ) : (
                <span className="text-[10px] text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Path Missing
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Root directory of Project Zomboid containing ProjectZomboid64.exe and base media files.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={formData.pz_install_dir}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 cursor-not-allowed"
              />
              <button
                onClick={() => handlePickFolder('pz_install_dir', formData.pz_install_dir)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-emerald-400" />
                Browse...
              </button>
            </div>
          </div>

          {/* Card 2: Steam Workshop Path */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200">
                Steam Workshop Content Path
              </label>
              <span className="text-[10px] text-slate-400 font-mono">App ID: 108600</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Steam Workshop directory where downloaded mods are stored. (Steam App ID: 108600)
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={formData.workshop_dir}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 cursor-not-allowed"
              />
              <button
                onClick={() => handlePickFolder('workshop_dir', formData.workshop_dir)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-emerald-400" />
                Browse...
              </button>
            </div>
          </div>

          {/* Card 3: User Zomboid Directory */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
            <label className="text-xs font-bold text-slate-200">
              User Zomboid Directory
            </label>
            <p className="text-[11px] text-slate-400">
              User folder containing console.txt logs, saved games, and local mods directory.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={formData.user_zomboid_dir}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 cursor-not-allowed"
              />
              <button
                onClick={() => handlePickFolder('user_zomboid_dir', formData.user_zomboid_dir)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-emerald-400" />
                Browse...
              </button>
            </div>
          </div>

          {/* Card 4: ModListData.ini Path */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
            <label className="text-xs font-bold text-slate-200">
              ModListData.ini Configuration Path
            </label>
            <p className="text-[11px] text-slate-400">
              Active mod list load order file used by Project Zomboid Mod Manager.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={formData.mod_list_ini_path}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 cursor-not-allowed"
              />
              <button
                onClick={() => handlePickFolder('mod_list_ini_path', formData.mod_list_ini_path)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-emerald-400" />
                Browse...
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
