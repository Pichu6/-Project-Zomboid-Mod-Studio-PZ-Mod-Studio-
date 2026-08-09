import React, { useState, useEffect } from 'react';
import { Layers, Plus, Check, Trash2, Zap, FolderArchive, RefreshCw } from 'lucide-react';
import { ModInfo, StudioPathsUI, AppInstance } from '../../types';
import { TauriService } from '../../services/tauri';

interface InstanceModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  onApplyInstanceLoadOrder: (loadOrder: string[], activeIds: string[]) => void;
}

export const InstanceModule: React.FC<InstanceModuleProps> = ({
  paths,
  mods,
  onApplyInstanceLoadOrder,
}) => {
  const [instances, setInstances] = useState<AppInstance[]>([]);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [newInstanceDesc, setNewInstanceDesc] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const activeMods = mods.filter((m) => m.enabled);

  const loadInstances = async () => {
    setIsLoading(true);
    try {
      const list: AppInstance[] = await TauriService.listInstances(paths.user_zomboid_dir);
      setInstances(list);
    } catch (err) {
      console.error('Error al cargar instancias:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInstances();
  }, [paths.user_zomboid_dir]);

  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) {
      alert('Ingresa un nombre para el perfil de instancia.');
      return;
    }

    try {
      const activeModIds = activeMods.map((m) => m.mod_id);
      const loadOrder = mods.map((m) => m.mod_id);

      const created: AppInstance = await TauriService.createInstance(
        paths.user_zomboid_dir,
        newInstanceName.trim(),
        newInstanceDesc.trim() || undefined,
        activeModIds,
        loadOrder
      );

      setNewInstanceName('');
      setNewInstanceDesc('');
      setStatusMessage(`✨ Perfil de Instancia '${created.name}' creado con éxito.`);
      await loadInstances();
    } catch (err: any) {
      alert(`Error al crear instancia: ${err}`);
    }
  };

  const handleActivateInstance = async (inst: AppInstance) => {
    try {
      await TauriService.activateInstance(paths.user_zomboid_dir, inst.id);
      onApplyInstanceLoadOrder(inst.load_order, inst.active_mod_ids);
      setStatusMessage(`⚡ Instancia '${inst.name}' activada con éxito. ¡Mods aplicados al juego!`);
      await loadInstances();
    } catch (err: any) {
      alert(`Error al activar la instancia: ${err}`);
    }
  };

  const handleDeleteInstance = async (inst: AppInstance) => {
    if (!confirm(`¿Eliminar la instancia '${inst.name}'?`)) return;
    try {
      await TauriService.deleteInstance(paths.user_zomboid_dir, inst.id);
      setStatusMessage(`Instancia '${inst.name}' eliminada.`);
      await loadInstances();
    } catch (err: any) {
      alert(`Error al eliminar la instancia: ${err}`);
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
              Instancias y Perfiles (Estilo Modrinth)
            </h2>
            {isLoading && <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin ml-2" />}
          </div>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            Crea perfiles aislados de mods (ej. <i>Vanilla Plus B42</i>, <i>RP Multiplayer</i>, <i>Hardcore Overhaul</i>) y alterna entre ellos en 1 segundo sin tocar menús in-game.
          </p>
        </div>

        <span className="text-xs font-mono bg-emerald-950 text-emerald-300 border border-emerald-800 px-3 py-1.5 rounded-xl font-bold">
          {instances.length} Perfiles Guardados
        </span>
      </div>

      {statusMessage && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-700/80 rounded-xl text-xs text-emerald-300 font-bold flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-emerald-400 hover:underline">
            Cerrar
          </button>
        </div>
      )}

      {/* Main Grid: Create Profile & Instance Cards */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: Create New Instance */}
        <div className="col-span-12 lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
          <div className="border-b border-slate-800 pb-3 space-y-1">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>Guardar Perfil de Instancia</span>
            </h3>
            <p className="text-xs text-slate-400">
              Guarda el estado actual ({activeMods.length} mods activos) como una nueva instancia independiente.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Nombre de la Instancia
              </label>
              <input
                type="text"
                placeholder="ej. Instancia B42 Hardcore"
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-medium"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Descripción (Opcional)
              </label>
              <textarea
                rows={3}
                placeholder="Notas de los mods incluidos en este perfil..."
                value={newInstanceDesc}
                onChange={(e) => setNewInstanceDesc(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
              />
            </div>

            <button
              onClick={handleCreateInstance}
              disabled={activeMods.length === 0}
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-lg flex items-center justify-center gap-2 mt-2"
            >
              <Plus className="w-4 h-4" />
              <span>Crear Nueva Instancia</span>
            </button>
          </div>
        </div>

        {/* Right Column: Display Cards of All Saved Instances */}
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
                          <Check className="w-3 h-3" /> Activo
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-500">Inactivo</span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                      {inst.description || 'Perfil de instancia de mods para Project Zomboid.'}
                    </p>

                    <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 pt-1">
                      <span className="text-emerald-400 font-bold">{inst.active_mod_ids.length} Mods Activos</span>
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
                        <span>Activar (1-Clic)</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleDeleteInstance(inst)}
                      className="p-2 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-700 rounded-xl transition cursor-pointer"
                      title="Eliminar instancia"
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
                <h3 className="text-sm font-bold text-slate-200">No hay instancias creadas</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Crea tu primera instancia en el panel izquierdo para guardar la combinación actual de mods.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
