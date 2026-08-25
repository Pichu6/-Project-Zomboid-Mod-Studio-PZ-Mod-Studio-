import React, { useState, useEffect } from 'react';
import { Layers, Check, Plus, X, FolderArchive, ArrowRight, ShieldCheck, RefreshCw, Trash2 } from 'lucide-react';
import { AppInstance, StudioPathsUI } from '../../types';
import { TauriService } from '../../services/tauri';

interface InitialInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  paths: StudioPathsUI;
  onSelectInstance: (instance: AppInstance) => void;
  onCreateNewInstanceClick: () => void;
  isInitialLaunch?: boolean;
}

export const InitialInstanceModal: React.FC<InitialInstanceModalProps> = ({
  isOpen,
  onClose,
  paths,
  onSelectInstance,
  onCreateNewInstanceClick,
  isInitialLaunch = true,
}) => {
  const [instances, setInstances] = useState<AppInstance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadInstancesList = async () => {
    if (paths.user_zomboid_dir) {
      setIsLoading(true);
      try {
        const list = await TauriService.listInstances(paths.user_zomboid_dir);
        setInstances(list);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (isOpen && paths.user_zomboid_dir) {
      loadInstancesList();
    }
  }, [isOpen, paths.user_zomboid_dir]);

  const handleDeleteInstance = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete the instance profile "${name}"?`)) {
      try {
        await TauriService.deleteInstance(paths.user_zomboid_dir, id);
        await loadInstancesList();
      } catch (err) {
        console.error('Error deleting instance:', err);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 space-y-6 shadow-2xl animate-in fade-in zoom-in-95 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-950 border border-emerald-700/80 flex items-center justify-center">
                <Layers className="w-4 h-4 text-emerald-400" />
              </div>
              <h2 className="text-lg font-bold text-slate-100 tracking-tight">
                Select your Project Zomboid Instance
              </h2>
              {isLoading && <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin ml-2" />}
            </div>
            <p className="text-xs text-slate-400">
              Choose the mod profile you want to work with in this session.
            </p>
          </div>

          {!isInitialLaunch && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content Body: Instances Grid */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          {instances.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {instances.map((inst) => (
                <div
                  key={inst.id}
                  onClick={() => {
                    onSelectInstance(inst);
                    onClose();
                  }}
                  className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between space-y-3 shadow-md group ${
                    inst.is_active
                      ? 'bg-emerald-950/60 hover:bg-emerald-950/80 border-emerald-500/80 ring-1 ring-emerald-500/40'
                      : 'bg-slate-950/90 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FolderArchive className={`w-4 h-4 ${inst.is_active ? 'text-emerald-400' : 'text-slate-400'}`} />
                        <h4 className="text-xs font-bold text-slate-100 group-hover:text-emerald-300 transition truncate max-w-[150px]">
                          {inst.name}
                        </h4>
                      </div>

                      {inst.is_active && (
                        <span className="text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                          <Check className="w-3 h-3" /> Active
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                      {inst.description || 'Configured instance profile.'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[10px] font-mono">
                    <span className="text-emerald-400 font-bold">{inst.active_mod_ids.length} Mods</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteInstance(inst.id, inst.name);
                        }}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-red-950 hover:text-red-400 text-slate-400 transition cursor-pointer border border-slate-800"
                        title="Delete this instance"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          onSelectInstance(inst);
                          onClose();
                        }}
                        className="px-3 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                      >
                        <span>Load</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center space-y-3 bg-slate-950/60 rounded-2xl border border-dashed border-slate-800">
              <Layers className="w-8 h-8 text-slate-500 mx-auto" />
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-slate-300">No saved instances yet</h4>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Create your first instance to organize your isolated mod profiles.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={() => {
              onClose();
              onCreateNewInstanceClick();
            }}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer border border-slate-700"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>Create New Instance</span>
          </button>

          {!isInitialLaunch && (
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition shadow-lg flex items-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Continue with Current Configuration</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
