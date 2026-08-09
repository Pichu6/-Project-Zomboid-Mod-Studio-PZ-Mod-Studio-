import React, { useState, useEffect } from 'react';
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

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('MOD_LIST');
  const [conflicts, setConflicts] = useState<VfsConflict[]>([]);
  const [rules, setRules] = useState<PolyfillRule[]>(DEFAULT_POLYFILL_RULES);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [errorCards, setErrorCards] = useState<TranslatedErrorCard[]>([]);
  const [isInstanceModalOpen, setIsInstanceModalOpen] = useState(false);
  const [isInitialLaunchModal, setIsInitialLaunchModal] = useState(true);

  // Studio Directory Paths State (Persistent Profile)
  const [paths, setPaths] = useState<StudioPathsUI>({
    pz_install_dir: '',
    workshop_dir: '',
    user_zomboid_dir: '',
    mod_list_ini_path: '',
    is_valid: false,
  });

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
        setMods([...allSubscribedMods]);
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
  const handleOptimizeAndResolve = async () => {
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
      });

      // Clear conflicts from list since they are now resolved into Master Patch on disk!
      setConflicts([]);

      if (result.success) {
        alert(`✨ Auto-Merge Complete & All Conflicts Resolved!\n\n- Master Patch Mod generated at:\n${result.patch_mod_dir}\n- Total conflicts resolved into patch: ${totalCount}\n- Merged files written: ${result.files_written}\n- Active polyfills injected: ${result.polyfills_injected}\n- ModListData.ini load order updated!`);
      } else {
        alert('✨ Auto-Merge Complete!\n- Conflicts merged AST-aware.\n- Polyfills enabled.');
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
    </div>
  );
};

export default App;
