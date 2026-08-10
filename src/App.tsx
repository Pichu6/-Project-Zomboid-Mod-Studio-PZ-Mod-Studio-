import React, { useState, useEffect, useCallback } from 'react';
import { ActiveTab, VfsConflict, PolyfillRule, ModInfo, TranslatedErrorCard } from './types';
import { DEFAULT_POLYFILL_RULES } from './data/default_rules';
import { StudioHeader } from './components/layout/StudioHeader';
import { StudioSidebar } from './components/layout/StudioSidebar';
import { MergerModule } from './components/merger/MergerModule';
import { LoadOrderModule } from './components/load_order/LoadOrderModule';
import { SandboxModule } from './components/sandbox/SandboxModule';
import { SettingsModule, StudioPathsUI } from './components/settings/SettingsModule';
import { TauriService } from './services/tauri';

import { PresetModule } from './components/presets/PresetModule';
import { ServerModule } from './components/server/ServerModule';
import { InstanceModule } from './components/instances/InstanceModule';
import { InitialInstanceModal } from './components/instances/InitialInstanceModal';
import { AppInstance } from './types';

import { Sparkles, CheckCircle2 } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('MOD_LIST');
  const [conflicts, setConflicts] = useState<VfsConflict[]>([]);
  const [rules, setRules] = useState<PolyfillRule[]>(DEFAULT_POLYFILL_RULES);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [errorCards, setErrorCards] = useState<TranslatedErrorCard[]>([]);
  const [isInstanceModalOpen, setIsInstanceModalOpen] = useState(false);
  const [isInitialLaunchModal, setIsInitialLaunchModal] = useState(true);
  const [autoMergeResultModal, setAutoMergeResultModal] = useState<{
    patch_mod_dir: string;
    total_conflicts: number;
    files_written: number;
    polyfills_injected: number;
  } | null>(null);
  const [draftPackageCount, setDraftPackageCount] = useState<number>(0);

  // Studio Directory Paths State (Persistent Profile)
  const [paths, setPaths] = useState<StudioPathsUI>({
    pz_install_dir: '',
    workshop_dir: '',
    user_zomboid_dir: '',
    mod_list_ini_path: '',
    is_valid: false,
  });

  const refreshDraftPackageCount = useCallback(async () => {
    if (paths.is_valid && paths.user_zomboid_dir) {
      try {
        const pkgs = await TauriService.listMergedPackages(paths.user_zomboid_dir, paths.mod_list_ini_path);
        const openDrafts = pkgs.filter((p) => !p.is_packaged).length;
        setDraftPackageCount(openDrafts);
      } catch (e) {
        console.error("Failed to list merged packages for draft count:", e);
      }
    }
  }, [paths.is_valid, paths.user_zomboid_dir, paths.mod_list_ini_path]);

  useEffect(() => {
    refreshDraftPackageCount();
  }, [refreshDraftPackageCount, mods]);

  // Load saved profile or auto-detect paths from Rust backend on initial load
  useEffect(() => {
    const initPaths = async () => {
      const savedProfile = await TauriService.loadSavedPathsProfile();
      setPaths(savedProfile);

      if (savedProfile.is_valid) {
        const scannedConflicts = await TauriService.scanConflicts(savedProfile);
        setConflicts(scannedConflicts);

        // Scan all subscribed Workshop & local mods on disk
        const allSubscribedMods = await TauriService.scanAllInstalledMods(savedProfile);
        if (allSubscribedMods.length > 0) {
          setMods([...allSubscribedMods]);
        }

        // Open Instance Selector if saved instances exist
        const existingInstances = await TauriService.listInstances(savedProfile.user_zomboid_dir);
        if (existingInstances.length > 0) {
          setIsInitialLaunchModal(true);
          setIsInstanceModalOpen(true);
        }
      }
    };
    initPaths();
  }, []);

  const handleSelectInstance = async (inst: AppInstance) => {
    try {
      await TauriService.activateInstance(paths.user_zomboid_dir, inst.id);
      handleApplyPresetLoadOrder(inst.load_order, inst.active_mod_ids);
    } catch (err) {
      console.error('Failed to activate instance:', err);
    }
  };

  // Listen to realtime sandbox logs & error cards from Rust watcher
  useEffect(() => {
    let unlistenErrorCards: (() => void) | undefined;

    TauriService.listenSandboxErrorCards((card) => {
      setErrorCards((prev) => {
        // If suggested polyfill rule is ALREADY active, skip card creation!
        if (card.polyfill_rule_id_suggestion && rules.some((r) => r.id === card.polyfill_rule_id_suggestion && r.enabled)) {
          return prev;
        }
        // Deduplicate cards by title or rule suggestion so 32 identical cards never stack!
        const isDuplicate = prev.some((c) => c.title === card.title || (c.polyfill_rule_id_suggestion && c.polyfill_rule_id_suggestion === card.polyfill_rule_id_suggestion));
        if (isDuplicate) return prev;

        return [card, ...prev];
      });
    }).then((unlisten) => {
      unlistenErrorCards = unlisten;
    });

    return () => {
      if (unlistenErrorCards) unlistenErrorCards();
    };
  }, [rules]);



  const handleRescan = async () => {
    if (paths.is_valid) {
      const scannedConflicts = await TauriService.scanConflicts(paths);
      setConflicts(scannedConflicts);
      const allSubscribedMods = await TauriService.scanAllInstalledMods(paths);
      if (allSubscribedMods.length > 0) {
        setMods([...allSubscribedMods]);
      }
    }
  };

  const handleRefreshMods = async () => {
    if (paths.is_valid) {
      const allSubscribedMods = await TauriService.scanAllInstalledMods(paths);
      if (allSubscribedMods.length > 0) {
        const scannedMap = new Map<string, ModInfo>();
        allSubscribedMods.forEach((m) => scannedMap.set(m.mod_id, m));

        const updatedMods: ModInfo[] = [];

        // 1. Maintain existing load order and enabled states, refreshing metadata from disk
        for (const existing of mods) {
          const scanned = scannedMap.get(existing.mod_id);
          if (scanned) {
            updatedMods.push({
              ...scanned,
              enabled: existing.enabled, // Preserve user's toggled ON/OFF state!
            });
            scannedMap.delete(existing.mod_id);
          }
        }

        // 2. Append newly subscribed mods to the bottom of the list (disabled by default)
        for (const [_, newMod] of scannedMap) {
          updatedMods.push({
            ...newMod,
            enabled: false,
          });
        }

        setMods(updatedMods);
      }
    }
  };

  const handleLoadMockups = (mockups: VfsConflict[]) => {
    setConflicts(mockups);
  };

  const handleLoadModMockups = (mockMods: ModInfo[]) => {
    setMods(mockMods);
  };

  // Magic Button: Auto-Merge & Generate Master Patch on Disk!
  const handleOptimizeAndResolve = async (packageFolderName?: string) => {
    const totalCount = conflicts.length;

    const updatedRules = rules.map((r) => ({
      ...r,
      enabled: true,
    }));
    setRules(updatedRules);

    // Call Rust to generate synthetic Master Patch mod on disk
    if (paths.is_valid && paths.user_zomboid_dir) {
      const mergedFilesPayload = conflicts.map((c) => ({
        relative_path: c.relative_path,
        content: c.merged_output || c.base_content,
      }));

      const activePolyfillIds = updatedRules.filter((r) => r.enabled).map((r) => r.id);

      const result = await TauriService.generateMasterPatch({
        workshop_dir: paths.workshop_dir,
        pz_install_dir: paths.pz_install_dir,
        user_zomboid_dir: paths.user_zomboid_dir,
        mod_list_ini_path: paths.mod_list_ini_path,
        merged_files: mergedFilesPayload,
        active_polyfill_ids: activePolyfillIds,
        package_folder_name: packageFolderName,
      });

      // Clear conflicts from list since they are now resolved into Master Patch on disk!
      setConflicts([]);

      if (result.success) {
        setAutoMergeResultModal({
          patch_mod_dir: result.patch_mod_dir,
          total_conflicts: totalCount,
          files_written: result.files_written,
          polyfills_injected: result.polyfills_injected,
        });
      }
    }
  };

  const handleRunSandbox = () => {
    setActiveTab('MONITOR');
    if (paths.is_valid) {
      TauriService.launchSandbox({
        pz_install_dir: paths.pz_install_dir,
        user_zomboid_dir: paths.user_zomboid_dir,
        test_mode: 'WINDOWED_DEEP',
      });
    }
  };

  const handleResolveConflict = (conflictId: string, _resolvedCode: string) => {
    setConflicts((prev) =>
      prev.filter((c) => c.id !== conflictId)
    );
  };

  const handleToggleRule = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleReorderMods = (newOrder: ModInfo[]) => {
    setMods([...newOrder]);
    const activeModIds = newOrder.filter((m) => m.enabled).map((m) => m.mod_id);
    TauriService.writeModListIni(paths.mod_list_ini_path, activeModIds);
  };

  const handleToggleMod = (modId: string) => {
    setMods((prev) => {
      const updated = prev.map((m) => (m.mod_id === modId ? { ...m, enabled: !m.enabled } : m));
      const activeModIds = updated.filter((m) => m.enabled).map((m) => m.mod_id);
      TauriService.writeModListIni(paths.mod_list_ini_path, activeModIds);
      return [...updated];
    });
  };

  const handleApplyPresetLoadOrder = (presetLoadOrder: string[], activeIds: string[]) => {
    setMods((prev) => {
      const modMap = new Map(prev.map((m) => [m.mod_id, m]));
      const activeSet = new Set(activeIds);

      const reordered: ModInfo[] = [];
      presetLoadOrder.forEach((id) => {
        const found = modMap.get(id);
        if (found) {
          reordered.push({ ...found, enabled: activeSet.has(id) });
          modMap.delete(id);
        }
      });

      // Append remaining mods
      modMap.forEach((m) => {
        reordered.push({ ...m, enabled: activeSet.has(m.mod_id) });
      });

      TauriService.writeModListIni(paths.mod_list_ini_path, activeIds);
      return reordered;
    });
  };

  const handleApplyFix = async (polyfillRuleId: string) => {
    const updatedRules = rules.map((r) => (r.id === polyfillRuleId ? { ...r, enabled: true } : r));
    setRules(updatedRules);
    setErrorCards((prev) => prev.filter((card) => card.polyfill_rule_id_suggestion !== polyfillRuleId));

    if (paths.is_valid && paths.user_zomboid_dir) {
      await TauriService.generateMasterPatch({
        workshop_dir: paths.workshop_dir,
        pz_install_dir: paths.pz_install_dir,
        user_zomboid_dir: paths.user_zomboid_dir,
        mod_list_ini_path: paths.mod_list_ini_path,
        merged_files: conflicts.map((c) => ({ relative_path: c.relative_path, content: c.merged_output || c.base_content })),
        active_polyfill_ids: updatedRules.filter((r) => r.enabled).map((r) => r.id),
      });
    }
  };

  const handleClearErrorCards = () => {
    setErrorCards([]);
  };

  const handleSavePaths = async (updatedPaths: StudioPathsUI) => {
    const saved = await TauriService.savePathsProfile(updatedPaths);
    setPaths(saved);
    if (saved.is_valid) {
      const scannedConflicts = await TauriService.scanConflicts(saved);
      setConflicts(scannedConflicts);

      const allSubscribedMods = await TauriService.scanAllInstalledMods(saved);
      if (allSubscribedMods.length > 0) {
        setMods([...allSubscribedMods]);
      }
    }
  };

  const handleAutoDetect = async () => {
    const autoPaths = await TauriService.getAutoPaths();
    const saved = await TauriService.savePathsProfile(autoPaths);
    setPaths(saved);
    if (saved.is_valid) {
      const scannedConflicts = await TauriService.scanConflicts(saved);
      setConflicts(scannedConflicts);

      const allSubscribedMods = await TauriService.scanAllInstalledMods(saved);
      if (allSubscribedMods.length > 0) {
        setMods([...allSubscribedMods]);
      }
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Studio Header */}
      <StudioHeader
        conflictCount={conflicts.length}
        polyfillCount={rules.filter((r) => r.enabled).length}
        onRunSandbox={handleRunSandbox}
        onOpenInstanceSelector={() => {
          setIsInitialLaunchModal(false);
          setIsInstanceModalOpen(true);
        }}
      />

      {/* Main Studio Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* StudioSidebar */}
        <StudioSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          conflictCount={conflicts.length}
          errorCardCount={errorCards.length}
          draftPackageCount={draftPackageCount}
        />

        {/* Tab Modules */}
        <main className="flex-1 flex flex-col overflow-y-auto p-6">
          {activeTab === 'MOD_LIST' && (
            <LoadOrderModule
              paths={paths}
              mods={mods}
              onReorder={handleReorderMods}
              onToggleMod={handleToggleMod}
              onRefreshMods={handleRefreshMods}
              onGoToSettings={() => setActiveTab('SETTINGS')}
              onLoadMockups={handleLoadModMockups}
            />
          )}

          {activeTab === 'PRESETS' && (
            <PresetModule
              paths={paths}
              mods={mods}
              onApplyPresetLoadOrder={handleApplyPresetLoadOrder}
            />
          )}

          {activeTab === 'SERVERS' && (
            <ServerModule
              paths={paths}
              mods={mods}
            />
          )}

          {activeTab === 'INSTANCES' && (
            <InstanceModule
              paths={paths}
              mods={mods}
              onApplyInstanceLoadOrder={handleApplyPresetLoadOrder}
            />
          )}

          {activeTab === 'MERGER' && (
            <MergerModule
              conflicts={conflicts}
              paths={paths}
              onResolveConflict={handleResolveConflict}
              onOptimizeAndResolve={handleOptimizeAndResolve}
              onGoToSettings={() => setActiveTab('SETTINGS')}
              onRescan={handleRescan}
              onLoadMockups={handleLoadMockups}
            />
          )}

          {activeTab === 'MONITOR' && (
            <SandboxModule
              paths={paths}
              errorCards={errorCards}
              onApplyFix={handleApplyFix}
              onClearErrorCards={handleClearErrorCards}
              onGoToSettings={() => setActiveTab('SETTINGS')}
            />
          )}

          {activeTab === 'SETTINGS' && (
            <SettingsModule
              paths={paths}
              rules={rules}
              onSavePaths={handleSavePaths}
              onToggleRule={handleToggleRule}
              onAutoDetect={handleAutoDetect}
            />
          )}
        </main>
      </div>

      {/* Initial Instance Selection Modal */}
      <InitialInstanceModal
        isOpen={isInstanceModalOpen}
        onClose={() => setIsInstanceModalOpen(false)}
        paths={paths}
        onSelectInstance={handleSelectInstance}
        onCreateNewInstanceClick={() => setActiveTab('INSTANCES')}
        isInitialLaunch={isInitialLaunchModal}
      />

      {/* Sleek Native Auto-Merge Completion Modal */}
      {autoMergeResultModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl animate-fade-in text-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>✨ Auto-Merge Completado con Éxito</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Todos los conflictos de scripts fueron resueltos en el parche de fusión.</p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5 text-xs font-mono">
              <div className="text-emerald-400 font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Parche Generado en Disco:</span>
              </div>
              <div className="p-2 bg-slate-900 rounded border border-slate-800 text-[11px] text-slate-300 break-all select-all font-mono">
                {autoMergeResultModal.patch_mod_dir}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 text-slate-300">
                <div className="p-2 bg-slate-900/60 rounded border border-slate-800/80">
                  <span className="text-slate-400 text-[10px] block">Conflictos Resueltos</span>
                  <b className="text-emerald-400 text-sm">{autoMergeResultModal.total_conflicts}</b>
                </div>
                <div className="p-2 bg-slate-900/60 rounded border border-slate-800/80">
                  <span className="text-slate-400 text-[10px] block">Archivos Fusionados</span>
                  <b className="text-emerald-400 text-sm">{autoMergeResultModal.files_written}</b>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2">
              <button
                onClick={() => setAutoMergeResultModal(null)}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg cursor-pointer shadow-lg transition"
              >
                Aceptar y Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
