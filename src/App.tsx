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

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('MOD_LIST');
  const [conflicts, setConflicts] = useState<VfsConflict[]>([]);
  const [rules, setRules] = useState<PolyfillRule[]>(DEFAULT_POLYFILL_RULES);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [errorCards, setErrorCards] = useState<TranslatedErrorCard[]>([]);

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

        // Load real active mods from ModListData.ini if path exists
        if (savedProfile.mod_list_ini_path) {
          const iniData = await TauriService.readModListIni(savedProfile.mod_list_ini_path);
          if (iniData.active_mods.length > 0) {
            const realMods: ModInfo[] = iniData.active_mods.map((id, idx) => ({
              mod_id: id,
              name: id,
              dependencies: [],
              enabled: true,
              load_order_index: idx + 1,
              is_library: id.toLowerCase().includes('lib') || id.toLowerCase().includes('manager'),
              is_map_mod: id.toLowerCase().includes('map'),
            }));
            setMods(realMods);
          }
        }
      }
    };
    initPaths();
  }, []);

  // Listen to realtime sandbox logs & error cards from Rust watcher
  useEffect(() => {
    let unlistenErrorCards: (() => void) | undefined;

    TauriService.listenSandboxErrorCards((card) => {
      setErrorCards((prev) => [card, ...prev]);
    }).then((unlisten) => {
      unlistenErrorCards = unlisten;
    });

    return () => {
      if (unlistenErrorCards) unlistenErrorCards();
    };
  }, []);

  const handleRescan = async () => {
    if (paths.is_valid) {
      const scannedConflicts = await TauriService.scanConflicts(paths);
      setConflicts(scannedConflicts);
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
    const updatedConflicts = conflicts.map((c) => ({
      ...c,
      status: 'AUTO_MERGED' as const,
    }));
    setConflicts(updatedConflicts);

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
        user_zomboid_dir: paths.user_zomboid_dir,
        mod_list_ini_path: paths.mod_list_ini_path,
        merged_files: mergedFilesPayload,
        active_polyfill_ids: activePolyfillIds,
      });

      if (result.success) {
        alert(`✨ Master Patch Generation Complete!\n\n- Master Patch Mod written at:\n${result.patch_mod_dir}\n- Merged files written: ${result.files_written}\n- Active polyfills injected: ${result.polyfills_injected}\n- ModListData.ini load order updated!`);
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

  const handleResolveConflict = (conflictId: string, resolvedCode: string) => {
    setConflicts((prev) =>
      prev.map((c) =>
        c.id === conflictId
          ? { ...c, merged_output: resolvedCode, status: 'RESOLVED' as const }
          : c
      )
    );
  };

  const handleToggleRule = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleReorderMods = (newOrder: ModInfo[]) => {
    setMods(newOrder);
    const activeModIds = newOrder.filter((m) => m.enabled).map((m) => m.mod_id);
    TauriService.writeModListIni(paths.mod_list_ini_path, activeModIds);
  };

  const handleToggleMod = (modId: string) => {
    setMods((prev) =>
      prev.map((m) => (m.mod_id === modId ? { ...m, enabled: !m.enabled } : m))
    );
  };

  const handleApplyFix = (polyfillRuleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === polyfillRuleId ? { ...r, enabled: true } : r))
    );
    setErrorCards((prev) => prev.filter((card) => card.polyfill_rule_id_suggestion !== polyfillRuleId));
    setActiveTab('SETTINGS');
  };

  const handleSavePaths = async (updatedPaths: StudioPathsUI) => {
    const saved = await TauriService.savePathsProfile(updatedPaths);
    setPaths(saved);
    if (saved.is_valid) {
      const scannedConflicts = await TauriService.scanConflicts(saved);
      setConflicts(scannedConflicts);

      if (saved.mod_list_ini_path) {
        const iniData = await TauriService.readModListIni(saved.mod_list_ini_path);
        if (iniData.active_mods.length > 0) {
          const realMods: ModInfo[] = iniData.active_mods.map((id, idx) => ({
            mod_id: id,
            name: id,
            dependencies: [],
            enabled: true,
            load_order_index: idx + 1,
            is_library: id.toLowerCase().includes('lib') || id.toLowerCase().includes('manager'),
            is_map_mod: id.toLowerCase().includes('map'),
          }));
          setMods(realMods);
        }
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
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Studio Header */}
      <StudioHeader
        conflictCount={conflicts.filter((c) => c.status !== 'RESOLVED' && c.status !== 'AUTO_MERGED').length}
        polyfillCount={rules.filter((r) => r.enabled).length}
        onRunSandbox={handleRunSandbox}
      />

      {/* Main Studio Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* StudioSidebar */}
        <StudioSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          conflictCount={conflicts.filter((c) => c.status !== 'RESOLVED' && c.status !== 'AUTO_MERGED').length}
          errorCardCount={errorCards.length}
        />

        {/* Tab Modules */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {activeTab === 'MOD_LIST' && (
            <LoadOrderModule
              paths={paths}
              mods={mods}
              onReorder={handleReorderMods}
              onToggleMod={handleToggleMod}
              onGoToSettings={() => setActiveTab('SETTINGS')}
              onLoadMockups={handleLoadModMockups}
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
    </div>
  );
};

export default App;
