import React from 'react';
import { ActiveTab } from '../../types';
import { GitCompare, ListOrdered, Settings, Activity, Server, Layers, Lock } from 'lucide-react';

interface StudioSidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  hasActiveProfile?: boolean;
  conflictCount: number;
  errorCardCount: number;
}

export const StudioSidebar: React.FC<StudioSidebarProps> = ({
  activeTab,
  setActiveTab,
  hasActiveProfile = true,
  conflictCount: _conflictCount,
  errorCardCount,
}) => {
  const navItems = [
    {
      id: 'PROFILES' as ActiveTab,
      label: 'Profiles',
      icon: Layers,
      badge: null,
      badgeColor: '',
      requiresProfile: false,
    },
    {
      id: 'MONITOR' as ActiveTab,
      label: 'Monitor Center',
      icon: Activity,
      badge: errorCardCount > 0 ? errorCardCount : null,
      badgeColor: 'bg-red-500/20 text-red-300 border-red-500/40',
      requiresProfile: true,
    },
    {
      id: 'MOD_LIST' as ActiveTab,
      label: 'Mod List',
      icon: ListOrdered,
      badge: null,
      badgeColor: '',
      requiresProfile: true,
    },
    {
      id: 'MERGER' as ActiveTab,
      label: 'Mod Merger',
      icon: GitCompare,
      badge: null,
      badgeColor: '',
      requiresProfile: true,
    },
    {
      id: 'SERVERS' as ActiveTab,
      label: 'Servers',
      icon: Server,
      badge: null,
      badgeColor: '',
      requiresProfile: true,
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
            const isLocked = item.requiresProfile && !hasActiveProfile;

            return (
              <button
                key={item.id}
                onClick={() => {
                  if (!isLocked) {
                    setActiveTab(item.id);
                  }
                }}
                disabled={isLocked}
                title={isLocked ? 'You must activate or create a profile first' : item.label}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition ${
                  isLocked
                    ? 'text-slate-600 opacity-40 cursor-not-allowed border border-transparent select-none'
                    : isActive
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-bold shadow cursor-pointer'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : isLocked ? 'text-slate-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>

                {isLocked ? (
                  <Lock className="w-3 h-3 text-slate-600" />
                ) : item.badge !== null ? (
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full border ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                ) : null}
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
