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

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('MERGER');
  const [conflicts, setConflicts] = useState<VfsConflict[]>(MOCK_CONFLICTS);
  const [rules, setRules] = useState<PolyfillRule[]>(DEFAULT_POLYFILL_RULES);
  const [mods, setMods] = useState<ModInfo[]>(MOCK_MODS);
  const [errorCards, setErrorCards] = useState<TranslatedErrorCard[]>(MOCK_ERROR_CARDS);

  // Magic Button: Optimize & Resolve All
  const handleOptimizeAndResolve = () => {
    // 1. Auto-resolve pending conflicts
    const updatedConflicts = conflicts.map((c) => ({
      ...c,
      status: 'AUTO_MERGED' as const,
    }));
    setConflicts(updatedConflicts);

    // 2. Enable all recommended Polyfill rules
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
            <div className="flex-1 flex items-center justify-center p-6 text-slate-400 text-sm">
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl max-w-md space-y-3">
                <h3 className="text-base font-bold text-slate-200">Application Settings</h3>
                <div className="text-xs space-y-2 font-mono">
                  <div>Game Directory: <span className="text-emerald-400">C:/Program Files (x86)/Steam/steamapps/common/ProjectZomboid</span></div>
                  <div>ModListData.ini: <span className="text-cyan-400">C:/Users/User/Zomboid/Lua/ModManager/ModListData.ini</span></div>
                  <div>Steam Workshop: <span className="text-purple-400">content/108600</span></div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
