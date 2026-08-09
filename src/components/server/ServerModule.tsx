import React, { useState, useEffect } from 'react';
import { Server, RefreshCw, Plus, Globe, Shield, Terminal, Zap, FileText } from 'lucide-react';
import { ModInfo, StudioPathsUI, PZServerConfig } from '../../types';
import { TauriService } from '../../services/tauri';

interface ServerModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
}

export const ServerModule: React.FC<ServerModuleProps> = ({ paths, mods }) => {
  const [servers, setServers] = useState<PZServerConfig[]>([]);
  const [selectedServer, setSelectedServer] = useState<PZServerConfig | null>(null);
  const [newServerName, setNewServerName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const activeMods = mods.filter((m) => m.enabled);
  const activeWorkshopIds = Array.from(
    new Set(activeMods.map((m) => m.workshop_id).filter((id): id is string => Boolean(id)))
  );

  const loadServerConfigs = async () => {
    setIsLoading(true);
    try {
      const list: PZServerConfig[] = await TauriService.listServerConfigs(paths.user_zomboid_dir);
      setServers(list);
      if (list.length > 0 && !selectedServer) {
        setSelectedServer(list[0]);
      }
    } catch (err) {
      console.error('Error al listar servidores:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadServerConfigs();
  }, [paths.user_zomboid_dir]);

  const handleCreateServer = async () => {
    if (!newServerName.trim()) {
      alert('Ingresa un nombre para la configuración de servidor.');
      return;
    }
    try {
      const created: PZServerConfig = await TauriService.createNewServerConfig(
        paths.user_zomboid_dir,
        newServerName.trim()
      );
      setNewServerName('');
      setStatusMessage(`✨ Servidor '${created.name}.ini' creado con éxito.`);
      await loadServerConfigs();
      setSelectedServer(created);
    } catch (err: any) {
      alert(`Error al crear servidor: ${err}`);
    }
  };

  const handleSyncToServer = async () => {
    if (!selectedServer) return;
    try {
      const activeModIds = activeMods.map((m) => m.mod_id);
      await TauriService.syncClientToServer(selectedServer.file_path, activeModIds, activeWorkshopIds);
      setStatusMessage(`🚀 ¡Servidor '${selectedServer.name}.ini' sincronizado con éxito! Mods: ${activeModIds.length}, WorkshopItems: ${activeWorkshopIds.length}`);
      await loadServerConfigs();
    } catch (err: any) {
      alert(`Error al sincronizar servidor: ${err}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-5 bg-gradient-to-r from-purple-950/80 via-slate-900 to-indigo-950/80 border border-purple-800/60 rounded-2xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Server className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              Gestor de Servidores & Multijugador
            </h2>
          </div>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            Sincroniza en 1-clic el orden de carga y los Workshop IDs de tu cliente directamente con tus archivos de servidor (<code className="text-purple-300">Zomboid/Server/*.ini</code>) para evitar desincronizaciones.
          </p>
        </div>

        <button
          onClick={loadServerConfigs}
          className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition cursor-pointer"
          title="Recargar archivos de servidor"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {statusMessage && (
        <div className="p-3 bg-purple-950/80 border border-purple-700/80 rounded-xl text-xs text-purple-200 font-bold flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-purple-400 hover:underline">
            Cerrar
          </button>
        </div>
      )}

      {/* Main Grid: Server List & Sync Actions */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: List of Servers */}
        <div className="col-span-12 lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-400" />
              <span>Servidores (.ini)</span>
            </h3>
            <span className="text-[10px] font-mono text-slate-400 font-bold">
              {servers.length} Encontrados
            </span>
          </div>

          {/* New Server Config Form */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="ej. Servidor_Coop_B42"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-medium"
            />
            <button
              onClick={handleCreateServer}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow"
            >
              <Plus className="w-4 h-4" />
              <span>Crear</span>
            </button>
          </div>

          {/* Server List Cards */}
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {servers.length > 0 ? (
              servers.map((srv, idx) => {
                const isSelected = selectedServer?.file_path === srv.file_path;
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedServer(srv)}
                    className={`p-3.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-purple-950/70 border-purple-500 text-purple-200 shadow-md font-bold'
                        : 'bg-slate-950/80 hover:bg-slate-800/80 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="text-xs flex items-center gap-2">
                        <Server className="w-3.5 h-3.5 text-purple-400" />
                        <span>{srv.name}.ini</span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 flex items-center gap-2">
                        <span>Mods: {srv.mods.length}</span>
                        <span>•</span>
                        <span>Workshop: {srv.workshop_items.length}</span>
                      </div>
                    </div>

                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                    )}
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center text-xs text-slate-500 italic border border-dashed border-slate-800 rounded-xl">
                No se encontraron configuraciones .ini de servidor en Zomboid/Server. Crea una arriba para comenzar.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Active Selected Server Config & 1-Click Sync */}
        <div className="col-span-12 lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-5 shadow-lg flex flex-col justify-between">
          {selectedServer ? (
            <div className="space-y-5 flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="border-b border-slate-800 pb-3 flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-purple-300 flex items-center gap-2">
                      <Globe className="w-4 h-4 text-purple-400" />
                      <span>Configuración: {selectedServer.name}.ini</span>
                    </h3>
                    <div className="text-[10px] font-mono text-slate-400 mt-1 truncate max-w-lg">
                      {selectedServer.file_path}
                    </div>
                  </div>

                  <span className="text-[10px] font-mono bg-purple-950 text-purple-300 px-2 py-0.5 rounded border border-purple-800 font-bold">
                    PZ Dedicated Server
                  </span>
                </div>

                {/* Direct Sync Comparison Card */}
                <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-[10px] text-slate-400 font-bold uppercase">Estado Actual en Cliente</div>
                    <div className="text-emerald-400 font-bold text-sm">{activeMods.length} Mods Activos</div>
                    <div className="text-cyan-400 text-[11px]">{activeWorkshopIds.length} IDs de Workshop</div>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-[10px] text-slate-400 font-bold uppercase">Configurado en Servidor .ini</div>
                    <div className="text-purple-300 font-bold text-sm">{selectedServer.mods.length} Mods Registrados</div>
                    <div className="text-purple-400 text-[11px]">{selectedServer.workshop_items.length} WorkshopItems</div>
                  </div>
                </div>

                {/* Warning / Master Patch Inclusion */}
                <div className="p-3 bg-indigo-950/50 border border-indigo-700/60 rounded-xl text-xs text-indigo-300 flex items-center gap-2.5">
                  <Shield className="w-5 h-5 text-indigo-400 shrink-0" />
                  <div className="text-[11px] leading-relaxed">
                    La sincronización incluirá automáticamente <b className="text-emerald-300">PZModStudioCarrier</b> y <b className="text-emerald-300">Z_PZModStudio_MergedPatch</b> para garantizar que los jugadores del servidor usen los parches 3-Way unificados.
                  </div>
                </div>
              </div>

              {/* 1-Click Sync Button */}
              <button
                onClick={handleSyncToServer}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-lg flex items-center justify-center gap-2 mt-4"
              >
                <Zap className="w-4 h-4 fill-white" />
                <span>Sincronizar Cliente ➔ Servidor (1-Clic)</span>
              </button>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shadow">
                <Terminal className="w-7 h-7 text-purple-400" />
              </div>
              <div className="space-y-1 max-w-md">
                <h3 className="text-sm font-bold text-slate-200">Selecciona un Servidor</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Elige un servidor de la lista izquierda para sincronizar tus mods activos y Workshop IDs.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
