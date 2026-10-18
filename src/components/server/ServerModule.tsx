import React, { useState, useEffect, useCallback } from 'react';
import {
  Server,
  RefreshCw,
  Plus,
  Globe,
  Shield,
  Terminal,
  Zap,
  FileText,
  Play,
  Square,
  RotateCw,
  Users,
  Check,
  Cpu,
  Sliders,
  Share2,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  ModInfo,
  StudioPathsUI,
  PZServerConfig,
  DedicatedServerStatus,
  ConnectedPlayer,
  ServerQuickSettings,
  ServerModReport,
} from '../../types';
import { TauriService, explainError } from '../../services/tauri';
import { MpCheckPanel } from '../common/MpCheckPanel';
import { MpModReport } from '../../types';

interface ServerModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
}

type ServerSubTab = 'HOST' | 'MODS' | 'PLAYERS' | 'SETTINGS';

export const ServerModule: React.FC<ServerModuleProps> = ({ paths, mods }) => {
  const [servers, setServers] = useState<PZServerConfig[]>([]);
  const [selectedServer, setSelectedServer] = useState<PZServerConfig | null>(null);
  const [newServerName, setNewServerName] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<ServerSubTab>('HOST');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Dedicated Server Running State
  const [serverStatus, setServerStatus] = useState<DedicatedServerStatus>({ is_running: false });
  const [selectedRam, setSelectedRam] = useState<number>(4);
  const [isNoSteam, setIsNoSteam] = useState<boolean>(false);
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  // Not kept between sessions on purpose: a server password does not belong in the browser
  // storage this window runs on. It is typed when the server is started.
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [showAdminPassword, setShowAdminPassword] = useState<boolean>(false);
  const [showServerPassword, setShowServerPassword] = useState<boolean>(false);

  const handleAdminPasswordChange = (val: string) => setAdminPassword(val);

  useEffect(() => {
    // An older build stored this here; clear it out.
    localStorage.removeItem('pz_server_admin_password');
  }, []);

  // Live Players & Moderation State
  const [players, setPlayers] = useState<ConnectedPlayer[]>([]);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Quick Settings State
  const [quickSettings, setQuickSettings] = useState<ServerQuickSettings | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  /** What the selected .ini says about mods, and what does not add up. */
  const [modReport, setModReport] = useState<ServerModReport | null>(null);
  /** The multiplayer check over the active list: what client code does that only the server should. */
  const [mpReports, setMpReports] = useState<MpModReport[] | null>(null);
  const [mpBusy, setMpBusy] = useState(false);

  const activeMods = mods.filter((m) => m.enabled);
  const activeWorkshopIds = Array.from(
    new Set(activeMods.map((m) => m.workshop_id).filter((id): id is string => Boolean(id)))
  );

  const loadServerConfigs = useCallback(
    async (isManual = false) => {
      setIsLoading(true);
      try {
        const list: PZServerConfig[] = await TauriService.listServerConfigs(paths.user_zomboid_dir);
        setServers(list);
        if (list.length > 0) {
          setSelectedServer((prev) => {
            if (!prev) return list[0];
            const matching = list.find((s) => s.file_path === prev.file_path || s.name === prev.name);
            return matching || list[0];
          });
        } else {
          setSelectedServer(null);
        }
        if (isManual) {
          setStatusMessage(`✅ Found ${list.length} server configuration(s).`);
        }
      } catch (err: any) {
        console.error('Error loading server configs:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [paths.user_zomboid_dir]
  );

  const refreshServerStatusAndPlayers = useCallback(async () => {
    try {
      const status: DedicatedServerStatus = await TauriService.getDedicatedServerStatus(
        paths.user_zomboid_dir || ''
      );
      setServerStatus(status);

      if (status.is_running) {
        const playerList = await TauriService.getConnectedPlayers(paths.user_zomboid_dir || '');
        setPlayers(playerList);
      } else {
        setPlayers([]);
      }
    } catch (err: any) {
      console.error('Error polling server status:', err);
    }
  }, [paths.user_zomboid_dir]);

  const loadQuickSettings = useCallback(async (filePath: string) => {
    try {
      const s = await TauriService.getServerQuickSettings(filePath);
      setQuickSettings(s);
    } catch (err: any) {
      console.error('Error loading server quick settings:', err);
    }
  }, []);

  useEffect(() => {
    loadServerConfigs(false);
  }, [loadServerConfigs]);

  useEffect(() => {
    refreshServerStatusAndPlayers();
    const interval = setInterval(refreshServerStatusAndPlayers, 3500);
    return () => clearInterval(interval);
  }, [refreshServerStatusAndPlayers]);

  useEffect(() => {
    if (selectedServer) {
      loadQuickSettings(selectedServer.file_path);
    }
  }, [selectedServer, loadQuickSettings]);

  const handleCreateServer = async () => {
    if (!newServerName.trim()) {
      alert('Enter a name for the server configuration.');
      return;
    }
    try {
      const created: PZServerConfig = await TauriService.createNewServerConfig(
        paths.user_zomboid_dir,
        newServerName.trim()
      );
      setNewServerName('');
      setStatusMessage(`✨ Server '${created.name}.ini' created successfully.`);
      await loadServerConfigs();
      setSelectedServer(created);
      await loadQuickSettings(created.file_path);
    } catch (err: any) {
      alert(`Error creating server: ${explainError(err)}`);
    }
  };

  const handleDeleteServer = async (e: React.MouseEvent, srv: PZServerConfig) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to permanently delete '${srv.name}.ini' from your hard drive?`)) {
      return;
    }
    try {
      await TauriService.deleteServerConfig(paths.user_zomboid_dir, srv.file_path, srv.name);
      setStatusMessage(`🗑️ Server '${srv.name}.ini' deleted from disk.`);
      const list = await TauriService.listServerConfigs(paths.user_zomboid_dir);
      setServers(list);
      if (selectedServer?.file_path === srv.file_path) {
        setSelectedServer(list.length > 0 ? list[0] : null);
      }
    } catch (err: any) {
      alert(`Error deleting server: ${explainError(err)}`);
    }
  };

  const checkSelectedServer = useCallback(async () => {
    if (!selectedServer) {
      setModReport(null);
      return;
    }
    setModReport(await TauriService.checkServerMods(paths, selectedServer.file_path));
  }, [paths, selectedServer]);

  // The three lines are only right together, so they are checked whenever the file or the list
  // changes rather than only after a sync.
  useEffect(() => {
    void checkSelectedServer();
  }, [checkSelectedServer, mods]);

  const handleSyncToServer = async () => {
    if (!selectedServer) return;
    try {
      const written = await TauriService.syncClientToServer(
        paths,
        selectedServer.file_path,
        activeMods.map((m) => m.mod_id)
      );
      setStatusMessage(
        `${selectedServer.name}.ini now has ${written.mods.length} mods, ` +
          `${written.workshop_items.length} Workshop items and ${written.maps.length} maps ` +
          `(${written.maps.join(', ')}). The previous file is in Zomboid/PZModStudio_Backups.`
      );
      await loadServerConfigs();
      await checkSelectedServer();
    } catch (err: any) {
      alert(`Error synchronizing: ${explainError(err)}`);
    }
  };

  const handleLaunchDedicatedServer = async () => {
    if (!selectedServer) return;
    if (!paths.pz_install_dir) {
      alert('Please configure the Project Zomboid installation path in Settings.');
      return;
    }
    setIsLaunching(true);
    try {
      const pid = await TauriService.launchDedicatedServer(
        paths.pz_install_dir,
        paths.user_zomboid_dir,
        selectedServer.name,
        selectedRam,
        isNoSteam,
        adminPassword || undefined
      );
      setStatusMessage(`🎮 Dedicated server started successfully in interactive console! PID: ${pid}`);
      await refreshServerStatusAndPlayers();
    } catch (err: any) {
      alert(`Error starting dedicated server: ${explainError(err)}`);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleStopDedicatedServer = async () => {
    if (!paths.user_zomboid_dir) return;
    try {
      await TauriService.stopDedicatedServer(paths.user_zomboid_dir, serverStatus.pid || undefined);
      setStatusMessage(`⏹️ Shutdown signal sent to dedicated server.`);
      await refreshServerStatusAndPlayers();
    } catch (err: any) {
      alert(`Error stopping server: ${explainError(err)}`);
    }
  };

  const handleRestartDedicatedServer = async () => {
    await handleStopDedicatedServer();
    setTimeout(async () => {
      await handleLaunchDedicatedServer();
    }, 1500);
  };


  const handleSaveSettings = async () => {
    if (!selectedServer || !quickSettings) return;
    setIsSavingSettings(true);
    try {
      await TauriService.saveServerQuickSettings(selectedServer.file_path, quickSettings);
      setStatusMessage(`💾 Settings saved successfully to '${selectedServer.name}.ini'.`);
    } catch (err: any) {
      alert(`Error saving settings: ${explainError(err)}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCopyInviteLink = () => {
    if (!selectedServer) return;
    const port = quickSettings?.port || 16261;
    const srvName = quickSettings?.public_name || selectedServer.name;
    const pwd = quickSettings?.password ? `\nPassword: ${quickSettings.password}` : '';

    // Your public address is not something this app can know: the invite leaves a blank for it,
    // rather than handing friends 127.0.0.1, which only ever reaches their own PC.
    const inviteText = `Project Zomboid server: ${srvName}
Address: <your public IP>:${port}  (find it at https://whatismyip.com, and forward the port)
Max players: ${quickSettings?.max_players || 16}${pwd}
Mods: ${selectedServer.mods.length}
Invite made with Project Zomboid Mod Studio`;

    navigator.clipboard.writeText(inviteText);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Top Suite Banner */}
      <div className="p-5 bg-gradient-to-r from-purple-950/90 via-slate-900 to-indigo-950/90 border border-purple-800/60 rounded-2xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center">
              <Server className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-100 tracking-tight">
                  Server & Dedicated Suite
                </h2>
                {serverStatus.is_running ? (
                  <span className="flex items-center gap-1.5 text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-600/60 px-2.5 py-0.5 rounded-full shadow">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>ONLINE (PID: {serverStatus.pid})</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[11px] font-mono font-bold bg-slate-900 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                    <span>OFFLINE</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                Host dedicated servers, monitor live players, execute admin actions, and synchronize mod load orders with 1-click.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedServer && (
            <button
              onClick={handleCopyInviteLink}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-800/50 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow"
              title="Copy Steam invite and server card"
            >
              {copiedInvite ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4 text-purple-400" />
                  <span>Share Invite</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={() => loadServerConfigs(true)}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition cursor-pointer"
            title="Reload server files"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 bg-purple-950/80 border border-purple-700/80 rounded-xl text-xs text-purple-200 font-bold flex items-center justify-between animate-fade-in shadow-lg">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-purple-400 hover:underline cursor-pointer">
            Close
          </button>
        </div>
      )}

      {/* Main Grid: Server Explorer & Control Center */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: Server (.ini) Files */}
        <div className="col-span-12 lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg flex flex-col">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-400" />
              <span>Server Configs (.ini)</span>
            </h3>
            <span className="text-[10px] font-mono text-slate-400 font-bold">
              {servers.length} Found
            </span>
          </div>

          {/* New Server Config Form */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. servertest o Coop_B42"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-medium"
            />
            <button
              onClick={handleCreateServer}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow"
            >
              <Plus className="w-4 h-4" />
              <span>Create</span>
            </button>
          </div>

          {/* Server List Cards */}
          <div className="space-y-2 flex-1 max-h-[500px] overflow-y-auto pr-1">
            {servers.length > 0 ? (
              servers.map((srv, idx) => {
                const isSelected = selectedServer?.file_path === srv.file_path;
                const isRunning = serverStatus.is_running && serverStatus.server_name === srv.name;
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
                      {isRunning && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-[10px] font-bold text-emerald-400 uppercase">Running</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                      )}
                      <button
                        onClick={(e) => handleDeleteServer(e, srv)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                        title={`Delete ${srv.name}.ini from disk`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center space-y-3 border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
                <p className="text-xs text-slate-400">
                  No <code className="text-purple-300">.ini</code> configuration files found in <code className="text-purple-300">Zomboid/Server</code>.
                </p>
                <button
                  onClick={async () => {
                    setNewServerName('servertest');
                    try {
                      const created = await TauriService.createNewServerConfig(paths.user_zomboid_dir, 'servertest');
                      setStatusMessage(`✨ Server 'servertest.ini' created successfully.`);
                      await loadServerConfigs(false);
                      setSelectedServer(created);
                    } catch (err: any) {
                      alert(`Error: ${explainError(err)}`);
                    }
                  }}
                  className="px-3 py-1.5 bg-purple-900/60 hover:bg-purple-800/80 border border-purple-600/50 text-purple-200 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  ⚡ Create default configuration (servertest.ini)
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Multi-tab Dedicated Control Center */}
        <div className="col-span-12 lg:col-span-8 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-5 shadow-lg flex flex-col">
          {selectedServer ? (
            <div className="space-y-4 flex-1 flex flex-col">
              {/* Navigation Sub-Tabs */}
              <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-2">
                <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    onClick={() => setActiveSubTab('HOST')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      activeSubTab === 'HOST'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Host & Launcher</span>
                  </button>

                  <button
                    onClick={() => setActiveSubTab('MODS')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      activeSubTab === 'MODS'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Mods & Sync</span>
                  </button>

                  <button
                    onClick={() => setActiveSubTab('PLAYERS')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      activeSubTab === 'PLAYERS'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Players</span>
                    <span className="text-[10px] bg-slate-800 text-purple-300 px-1.5 py-0.5 rounded-full font-mono">
                      {players.length}
                    </span>
                  </button>



                  <button
                    onClick={() => setActiveSubTab('SETTINGS')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      activeSubTab === 'SETTINGS'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Quick .ini</span>
                  </button>
                </div>

                <div className="text-[11px] font-mono text-purple-300 font-bold bg-purple-950/60 px-2.5 py-1 rounded-lg border border-purple-800/40">
                  {selectedServer.name}.ini
                </div>
              </div>

              {/* Sub-Tab 1: Host & Dedicated Launcher */}
              {activeSubTab === 'HOST' && (
                <div className="space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-4">
                    {/* Launch Options Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* RAM Allocation Selector */}
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                            <Cpu className="w-4 h-4 text-purple-400" />
                            <span>Memory (-Xmx)</span>
                          </label>
                          <span className="text-xs font-mono font-bold text-purple-400">{selectedRam} GB</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1 pt-1">
                          {[4, 8, 12, 16].map((ram) => (
                            <button
                              key={ram}
                              onClick={() => setSelectedRam(ram)}
                              className={`py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                                selectedRam === ram
                                  ? 'bg-purple-600 text-white shadow'
                                  : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
                              }`}
                            >
                              {ram}G
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Admin Password Input */}
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                        <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <Shield className="w-4 h-4 text-purple-400" />
                          <span>Admin Password</span>
                        </label>
                        <div className="relative">
                          <input
                            type={showAdminPassword ? 'text' : 'password'}
                            placeholder="Create admin pass..."
                            value={adminPassword}
                            onChange={(e) => handleAdminPasswordChange(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-2.5 pr-8 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                            title="Sets the password for the 'admin' superuser account on startup automatically"
                          />
                          <button
                            type="button"
                            onClick={() => setShowAdminPassword(!showAdminPassword)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-300 cursor-pointer p-0.5"
                            title={showAdminPassword ? 'Hide password' : 'Show password'}
                          >
                            {showAdminPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Network & Steam Mode */}
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                        <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <Globe className="w-4 h-4 text-purple-400" />
                          <span>Auth & Network</span>
                        </label>
                        <div className="flex items-center justify-between pt-0.5 text-xs text-slate-300">
                          <button
                            onClick={() => setIsNoSteam(!isNoSteam)}
                            className={`w-full py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                              !isNoSteam
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/50'
                                : 'bg-amber-950 text-amber-300 border border-amber-600/50'
                            }`}
                          >
                            {!isNoSteam ? 'Steam Enabled' : 'NoSteam (LAN)'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Server Info Card */}
                    <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Public Name:</span>
                        <b className="text-slate-200">{quickSettings?.public_name || selectedServer.name}</b>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Port:</span>
                        <b className="text-purple-300 font-mono">{quickSettings?.port || 16261}</b>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>PVP Mode:</span>
                        <b className={quickSettings?.pvp ? 'text-rose-400' : 'text-emerald-400'}>
                          {quickSettings?.pvp ? 'Enabled' : 'Disabled'}
                        </b>
                      </div>
                    </div>
                  </div>

                  {/* Launch / Stop Action Controls */}
                  <div className="pt-3 border-t border-slate-800 flex flex-col md:flex-row items-center gap-3">
                    {!serverStatus.is_running ? (
                      <button
                        onClick={handleLaunchDedicatedServer}
                        disabled={isLaunching}
                        className="flex-1 w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-lg flex items-center justify-center gap-2"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        <span>Launch Dedicated Server ({selectedServer.name})</span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleStopDedicatedServer}
                          className="flex-1 w-full py-3.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-lg flex items-center justify-center gap-2"
                        >
                          <Square className="w-4 h-4 fill-white" />
                          <span>Stop Dedicated Server</span>
                        </button>
                        <button
                          onClick={handleRestartDedicatedServer}
                          className="px-5 py-3.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-lg flex items-center justify-center gap-2"
                        >
                          <RotateCw className="w-4 h-4" />
                          <span>Restart</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Sub-Tab 2: Mods & Sync */}
              {activeSubTab === 'MODS' && (
                <div className="space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-4">
                    {/* Direct Sync Comparison Card */}
                    <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                      <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                        <div className="text-[10px] text-slate-400 font-bold uppercase">Current Client State</div>
                        <div className="text-emerald-400 font-bold text-sm">{activeMods.length} Active Mods</div>
                        <div className="text-cyan-400 text-[11px]">{activeWorkshopIds.length} Workshop IDs</div>
                      </div>

                      <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                        <div className="text-[10px] text-slate-400 font-bold uppercase">Configured in .ini Server</div>
                        <div className="text-purple-300 font-bold text-sm">{selectedServer.mods.length} Registered Mods</div>
                        <div className="text-purple-400 text-[11px]">{selectedServer.workshop_items.length} WorkshopItems</div>
                      </div>
                    </div>

                    {/* What the .ini gets wrong: the three lines only work together. */}
                    {modReport && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                        <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-300">
                            This .ini: {modReport.mods.length} Mods, {modReport.workshop_items.length} WorkshopItems,{' '}
                            {modReport.maps.length} Map
                          </span>
                          {modReport.issues.length === 0 ? (
                            <span className="text-[10px] text-emerald-400 font-mono">nothing to fix</span>
                          ) : (
                            <span className="text-[10px] text-amber-300 font-mono">
                              {modReport.issues.length} thing(s) to look at
                            </span>
                          )}
                        </div>
                        {modReport.issues.length > 0 && (
                          <div className="divide-y divide-slate-800 max-h-56 overflow-y-auto">
                            {modReport.issues.map((issue, i) => (
                              <div key={i} className="px-3 py-2 flex items-start gap-2 text-[11px] leading-relaxed">
                                <span
                                  className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                                    issue.severity === 'error'
                                      ? 'bg-red-400'
                                      : issue.severity === 'warning'
                                      ? 'bg-amber-400'
                                      : 'bg-slate-500'
                                  }`}
                                  aria-hidden="true"
                                />
                                <span className="text-slate-300">{issue.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {modReport.maps.length > 0 && (
                          <div className="px-3 py-2 border-t border-slate-800 text-[10px] font-mono text-slate-500">
                            Map= {modReport.maps.join(' ; ')}
                          </div>
                        )}
                      </div>
                    )}

                    {/* What the active mods' client code does that only the server should, in multiplayer. */}
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-bold text-slate-300">Multiplayer check of the active mods</div>
                        <button
                          type="button"
                          disabled={mpBusy}
                          onClick={() => {
                            setMpBusy(true);
                            void TauriService.mpCheckMods(paths, activeMods.map((m) => m.mod_id))
                              .then((r) => setMpReports(r.filter((x) => x.report.findings.length > 0)))
                              .finally(() => setMpBusy(false));
                          }}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-50"
                          title="Lists the calls the game routes through the server (server/ClientCommands.lua, VehicleCommands.lua) that a mod's client or shared Lua makes directly: in multiplayer they change only that client's world, or are refused. The Developer screen opens each at its line."
                        >
                          {mpBusy ? 'Checking…' : mpReports ? 'Check again' : 'Check'}
                        </button>
                      </div>
                      {mpReports && (
                        mpReports.length === 0
                          ? <div className="text-[11px] text-slate-500">Nothing the game keeps server-side is called directly by any active mod's client code. (It checks only those calls.)</div>
                          : <MpCheckPanel reports={mpReports} />
                      )}
                    </div>

                    {/* Warning / Master Patch Inclusion */}
                    <div className="p-3 bg-indigo-950/50 border border-indigo-700/60 rounded-xl text-xs text-indigo-300 flex items-center gap-2.5">
                      <Shield className="w-5 h-5 text-indigo-400 shrink-0" />
                      <div className="text-[11px] leading-relaxed">
                        The sync will automatically include your published synthetic package <b className="text-emerald-300">Z_PZModStudio_*</b> to ensure server players use the unified 3-Way patches without checksum mismatches.
                      </div>
                    </div>
                  </div>

                  {/* 1-Click Sync Button */}
                  <button
                    onClick={handleSyncToServer}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-lg flex items-center justify-center gap-2 mt-4"
                  >
                    <Zap className="w-4 h-4 fill-white" />
                    <span>Write my list into this server (Mods, WorkshopItems and Map)</span>
                  </button>
                </div>
              )}

              {/* Sub-Tab 3: Players & Moderation */}
              {activeSubTab === 'PLAYERS' && (
                <div className="space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-slate-800 bg-slate-900/60 text-[11px] text-slate-400">
                      <Users className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-500" aria-hidden="true" />
                      <span>
                        Who is connected, read from the server's own log. Kicking, banning and messaging players
                        needs RCON, which the Studio does not speak yet — use the server console for those.
                      </span>
                    </div>

                    {/* Connected Players Table */}
                    <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                      <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs font-bold text-slate-300">
                        <span className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-purple-400" />
                          <span>Connected Players ({players.length})</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-normal">Read from the server log</span>
                      </div>

                      <div className="divide-y divide-slate-800 max-h-64 overflow-y-auto">
                        {players.length > 0 ? (
                          players.map((p, i) => (
                            <div key={i} className="p-3 flex items-center justify-between text-xs hover:bg-slate-900/60 transition">
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2 font-bold text-slate-200">
                                  <span>{p.username}</span>
                                  {p.role.toLowerCase() === 'admin' ? (
                                    <span className="text-[10px] bg-rose-950 text-rose-300 border border-rose-800 px-1.5 py-0.5 rounded font-mono font-bold">
                                      ADMIN
                                    </span>
                                  ) : (
                                    <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                                      PLAYER
                                    </span>
                                  )}
                                  {p.is_godmode && (
                                    <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800 px-1.5 py-0.5 rounded font-mono font-bold">
                                      GOD
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] font-mono text-slate-400 flex items-center gap-3">
                                  <span>Ping: {p.ping}ms</span>
                                  <span>•</span>
                                  <span>Health: {Math.round(p.health * 100)}%</span>
                                  {p.x !== 0 && (
                                    <>
                                      <span>•</span>
                                      <span>Coords: ({p.x}, {p.y}, {p.z})</span>
                                    </>
                                  )}
                                </div>
                              </div>

                            </div>
                          ))
                        ) : (
                          <div className="p-8 text-center text-xs text-slate-500 space-y-1">
                            <div>No players connected currently.</div>
                            <div className="text-[10px] text-slate-600">
                              {serverStatus.is_running
                                ? 'Server is listening for connections.'
                                : 'Start the dedicated server to manage live players.'}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-Tab 5: Quick Settings Editor */}
              {activeSubTab === 'SETTINGS' && quickSettings && (
                <div className="space-y-4 flex-1 flex flex-col justify-between">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-300">Public Server Name</label>
                      <input
                        type="text"
                        value={quickSettings.public_name}
                        onChange={(e) => setQuickSettings({ ...quickSettings, public_name: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-300">Server Password (Join)</label>
                      <div className="relative">
                        <input
                          type={showServerPassword ? 'text' : 'password'}
                          placeholder="Leave blank for open server"
                          value={quickSettings.password}
                          onChange={(e) => setQuickSettings({ ...quickSettings, password: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-3 pr-8 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowServerPassword(!showServerPassword)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-300 cursor-pointer p-0.5"
                          title={showServerPassword ? 'Hide password' : 'Show password'}
                        >
                          {showServerPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-300">Admin Password (-adminpassword)</label>
                      <div className="relative">
                        <input
                          type={showAdminPassword ? 'text' : 'password'}
                          placeholder="Superuser admin password..."
                          value={adminPassword}
                          onChange={(e) => handleAdminPasswordChange(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-3 pr-8 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAdminPassword(!showAdminPassword)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-300 cursor-pointer p-0.5"
                          title={showAdminPassword ? 'Hide password' : 'Show password'}
                        >
                          {showAdminPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-300">Max Players</label>
                      <input
                        type="number"
                        min="1"
                        max="128"
                        value={quickSettings.max_players}
                        onChange={(e) =>
                          setQuickSettings({ ...quickSettings, max_players: parseInt(e.target.value) || 16 })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-300">Default Port</label>
                      <input
                        type="number"
                        value={quickSettings.port}
                        onChange={(e) =>
                          setQuickSettings({ ...quickSettings, port: parseInt(e.target.value) || 16261 })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>

                    <div className="col-span-2 space-y-1">
                      <label className="text-[11px] font-bold text-slate-300">Public Description</label>
                      <input
                        type="text"
                        value={quickSettings.public_description}
                        onChange={(e) => setQuickSettings({ ...quickSettings, public_description: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="font-bold text-slate-300">PVP Combat:</span>
                      <input
                        type="checkbox"
                        checked={quickSettings.pvp}
                        onChange={(e) => setQuickSettings({ ...quickSettings, pvp: e.target.checked })}
                        className="rounded border-slate-700 text-purple-600 bg-slate-900 cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="font-bold text-slate-300">Pause When Empty:</span>
                      <input
                        type="checkbox"
                        checked={quickSettings.pause_empty}
                        onChange={(e) => setQuickSettings({ ...quickSettings, pause_empty: e.target.checked })}
                        className="rounded border-slate-700 text-purple-600 bg-slate-900 cursor-pointer"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-lg flex items-center justify-center gap-2 mt-4"
                  >
                    <Sliders className="w-4 h-4" />
                    <span>Save Settings to .ini</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shadow">
                <Terminal className="w-7 h-7 text-purple-400" />
              </div>
              <div className="space-y-1 max-w-md">
                <h3 className="text-sm font-bold text-slate-200">Select a Server Configuration</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Choose a server from the left list to launch the dedicated host, manage online players, or synchronize mods.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Kick Player Modal */}
    </div>
  );
};

