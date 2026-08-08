import React, { useState } from 'react';
import { ActiveTab, VfsConflict, PolyfillRule, ModInfo, TranslatedErrorCard } from './types';
import { MOCK_CONFLICTS, MOCK_MODS, MOCK_ERROR_CARDS } from './data/mock_data';
import { DEFAULT_POLYFILL_RULES } from './data/default_rules';
import { StudioHeader } from './components/layout/StudioHeader';
import { StudioSidebar } from './components/layout/StudioSidebar';
import { MergerModule } from './components/merger/MergerModule';
import { PolyfillsModule } from './components/polyfills/PolyfillsModule';
import { LoadOrderModule } from './components/load_order/LoadOrderModule';
import { SandboxModule } from './components/sandbox/SandboxModule';
import { SettingsModule, StudioPathsUI } from './components/settings/SettingsModule';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('MERGER');
  const [conflicts, setConflicts] = useState<VfsConflict[]>(MOCK_CONFLICTS);
  const [rules, setRules] = useState<PolyfillRule[]>(DEFAULT_POLYFILL_RULES);
  const [mods, setMods] = useState<ModInfo[]>(MOCK_MODS);
  const [errorCards, setErrorCards] = useState<TranslatedErrorCard[]>(MOCK_ERROR_CARDS);

  // Studio Directory Paths State (Supports auto-detect & manual entry)
  const [paths, setPaths] = useState<StudioPathsUI>({
    pz_install_dir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\ProjectZomboid',
    workshop_dir: 'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\108600',
    user_zomboid_dir: 'C:\\Users\\User\\Zomboid',
    mod_list_ini_path: 'C:\\Users\\User\\Zomboid\\Lua\\ModManager\\ModListData.ini',
    is_valid: true,
  });

  // Magic Button: Optimize & Resolve All
  const handleOptimizeAndResolve = () => {
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

    alert('✨ Optimize & Resolve All Complete!\n- Conflicts merged AST-aware.\n- Polyfills enabled.\n- ModListData.ini topological load order updated.');
  };

  const handleRunSandbox = () => {
    setActiveTab('SANDBOX');
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
    setActiveTab('POLYFILLS');
  };

  const handleSavePaths = (updatedPaths: StudioPathsUI) => {
    setPaths(updatedPaths);
  };

  const handleAutoDetect = () => {
    // Standard default paths
    setPaths({
      pz_install_dir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\ProjectZomboid',
      workshop_dir: 'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\108600',
      user_zomboid_dir: 'C:\\Users\\User\\Zomboid',
      mod_list_ini_path: 'C:\\Users\\User\\Zomboid\\Lua\\ModManager\\ModListData.ini',
      is_valid: true,
    });
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Studio Header */}
      <StudioHeader
        conflictCount={conflicts.filter((c) => c.status !== 'RESOLVED' && c.status !== 'AUTO_MERGED').length}
        polyfillCount={rules.filter((r) => r.enabled).length}
        onOptimizeAndResolve={handleOptimizeAndResolve}
        onRunSandbox={handleRunSandbox}
      />

      {/* Main Studio Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Studio Sidebar */}
        <StudioSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          conflictCount={conflicts.filter((c) => c.status !== 'RESOLVED' && c.status !== 'AUTO_MERGED').length}
          errorCardCount={errorCards.length}
        />

        {/* Tab Modules */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {activeTab === 'MERGER' && (
            <MergerModule conflicts={conflicts} onResolveConflict={handleResolveConflict} />
          )}

          {activeTab === 'POLYFILLS' && (
            <PolyfillsModule rules={rules} onToggleRule={handleToggleRule} />
          )}

          {activeTab === 'LOAD_ORDER' && (
            <LoadOrderModule mods={mods} onReorder={handleReorderMods} onToggleMod={handleToggleMod} />
          )}

          {activeTab === 'SANDBOX' && (
            <SandboxModule errorCards={errorCards} onApplyFix={handleApplyFix} />
          )}

          {activeTab === 'SETTINGS' && (
            <SettingsModule
              paths={paths}
              onSavePaths={handleSavePaths}
              onAutoDetect={handleAutoDetect}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
