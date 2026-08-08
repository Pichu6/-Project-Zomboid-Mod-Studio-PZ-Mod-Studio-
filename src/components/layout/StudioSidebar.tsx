import React from 'react';
import { ActiveTab } from '../../types';
import { GitCompare, Wrench, ListOrdered, Settings, Activity } from 'lucide-react';

interface StudioSidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  conflictCount: number;
  errorCardCount: number;
}

export const StudioSidebar: React.FC<StudioSidebarProps> = ({
  activeTab,
  setActiveTab,
  conflictCount,
  errorCardCount,
}) => {
  const navItems = [
    {
      id: 'MOD_LIST' as ActiveTab,
      label: 'Mod List',
      icon: ListOrdered,
      badge: null,
      badgeColor: '',
    },
    {
      id: 'MERGER' as ActiveTab,
      label: 'Script Merger',
      icon: GitCompare,
      badge: conflictCount > 0 ? conflictCount : null,
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    },
    {
      id: 'POLYFILLS' as ActiveTab,
      label: 'Polyfill Rules',
      icon: Wrench,
      badge: null,
      badgeColor: '',
    },
    {
      id: 'MONITOR' as ActiveTab,
      label: 'Monitor Center',
      icon: Activity,
      badge: errorCardCount > 0 ? errorCardCount : null,
      badgeColor: 'bg-red-500/20 text-red-300 border-red-500/40',
    },
  ];

  return (
    <aside className="w-56 bg-slate-900/60 border-r border-slate-800 flex flex-col justify-between select-none shrink-0 p-3">
      {/* Top Nav List */}
      <div className="space-y-4">
        <div className="px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">
          Studio Modules
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  isActive
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-bold shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>

                {item.badge !== null && (
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full border ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom App Settings */}
      <div className="pt-3 border-t border-slate-800">
        <button
          onClick={() => setActiveTab('SETTINGS')}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
            activeTab === 'SETTINGS'
              ? 'bg-slate-800 text-slate-100 font-bold border border-slate-700'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <Settings className="w-4 h-4 text-slate-400" />
          <span>App Settings</span>
        </button>
      </div>
    </aside>
  );
};
