import React, { useState } from 'react';
import { FolderOpen, CheckCircle, AlertTriangle, RefreshCw, Save, HardDrive, Wrench, Plus, Bell } from 'lucide-react';
import { PolyfillRule } from '../../types';
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
  rules: PolyfillRule[];
  onSavePaths: (updatedPaths: StudioPathsUI) => void;
  onToggleRule: (ruleId: string) => void;
  onAutoDetect: () => void;
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  paths,
  rules,
  onSavePaths,
  onToggleRule,
  onAutoDetect,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'PATHS' | 'POLYFILLS'>('PATHS');
  const [formData, setFormData] = useState<StudioPathsUI>(paths);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [noticeSilenced, setNoticeSilenced] = useState<boolean>(
    localStorage.getItem('pz_hide_autosort_notice') === 'true'
  );

  const handleRestoreNotice = () => {
    localStorage.removeItem('pz_hide_autosort_notice');
    setNoticeSilenced(false);
  };

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
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Settings Header & Sub-Tab Navigation */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-emerald-400" />
              App Settings & Compatibility Rules
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure local game paths and enable/disable B42+ runtime polyfill rules.
            </p>
          </div>

          {/* Sub-Tab Selector Buttons */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-1 flex gap-1 text-xs">
            <button
              onClick={() => setActiveSubTab('PATHS')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'PATHS'
                  ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              Directory Paths
            </button>
            <button
              onClick={() => setActiveSubTab('POLYFILLS')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'POLYFILLS'
                  ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              Polyfill Rules ({rules.filter((r) => r.enabled).length})
            </button>
          </div>
        </div>

        {savedSuccess && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-500/40 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            Settings saved and validated successfully!
          </div>
        )}

        {/* SUB-TAB 1: Directory Paths */}
        {activeSubTab === 'PATHS' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                System Directory Paths
              </span>

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
                  Save Paths
                </button>
              </div>
            </div>

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

            {/* Card 5: App Notification Preferences */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Bell className="w-4 h-4 text-cyan-400" />
                  Notificaciones de la Aplicación
                </label>
                <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded ${noticeSilenced ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'}`}>
                  {noticeSilenced ? 'Auto-Sort Silenciado' : 'Notificaciones Activas'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Controla la visibilidad de la ventana modal emergente al presionar "Auto-Sort Dependencies".
              </p>
              <div className="pt-1 flex items-center justify-between">
                <span className="text-xs text-slate-300">
                  {noticeSilenced ? 'Has marcado "No volver a mostrar este mensaje".' : 'El mensaje informativo de auto-sort se mostrará al ordenar.'}
                </span>
                {noticeSilenced ? (
                  <button
                    onClick={handleRestoreNotice}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition cursor-pointer shadow"
                  >
                    Restaurar Notificación de Auto-Sort
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      localStorage.setItem('pz_hide_autosort_notice', 'true');
                      setNoticeSilenced(true);
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition cursor-pointer"
                  >
                    Silenciar Notificación
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 2: Polyfill & Compatibility Rules Matrix */}
        {activeSubTab === 'POLYFILLS' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Build 42+ Polyfill Rules Matrix
              </span>

              <button
                onClick={() => alert('Community Rule Importer: Select a poly_rules.json file to import extra rules.')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 rounded-lg shadow transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Import Community Rule (.json)
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`bg-slate-900/80 border rounded-xl p-4 flex flex-col justify-between space-y-3 transition ${
                    rule.enabled
                      ? 'border-emerald-500/40 shadow-sm'
                      : 'border-slate-800 opacity-60'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800 font-semibold">
                        {rule.category}
                      </span>
                      <button
                        onClick={() => onToggleRule(rule.id)}
                        className={`w-10 h-5 rounded-full p-0.5 transition cursor-pointer ${
                          rule.enabled ? 'bg-emerald-500 justify-end' : 'bg-slate-800 justify-start'
                        } flex items-center`}
                      >
                        <div className="w-4 h-4 rounded-full bg-white shadow-md"></div>
                      </button>
                    </div>

                    <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      {rule.name}
                    </h4>

                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {rule.description}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>Rule ID: {rule.id}</span>
                    <span className={rule.enabled ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                      {rule.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
