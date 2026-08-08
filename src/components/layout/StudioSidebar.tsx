import React from 'react';
import { ActiveTab } from '../../types';
import { GitMerge, ShieldAlert, ListOrdered, FlaskConical, Settings } from 'lucide-react';

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
  const navItems: { id: ActiveTab; label: string; icon: React.ReactNode; badge?: number; color?: string }[] = [
    {
      id: 'MERGER',
      label: 'Script Merger',
      icon: <GitMerge className="w-4 h-4" />,
      badge: conflictCount,
      color: conflictCount > 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : undefined,
    },
    {
      id: 'POLYFILLS',
      label: 'Polyfill Rules',
      icon: <ShieldAlert className="w-4 h-4" />,
    },
    {
      id: 'LOAD_ORDER',
      label: 'Load Order Manager',
      icon: <ListOrdered className="w-4 h-4" />,
    },
    {
      id: 'SANDBOX',
      label: 'Sandbox Lab',
      icon: <FlaskConical className="w-4 h-4" />,
      badge: errorCardCount,
      color: errorCardCount > 0 ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' : undefined,
    },
  ];

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between select-none">
      {/* Navigation Links */}
      <div className="p-3 space-y-1">
        <p className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Studio Modules
        </p>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer ${
                isActive
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/80 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={isActive ? 'text-emerald-400' : 'text-slate-500'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`px-2 py-0.5 text-[10px] rounded-full border font-mono font-bold ${
                    item.color || 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Settings Link */}
      <div className="p-3 border-t border-slate-900">
        <button
          onClick={() => setActiveTab('SETTINGS')}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'SETTINGS'
              ? 'bg-slate-800 text-emerald-400 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Settings className="w-4 h-4 text-slate-500" />
          <span>App Settings</span>
        </button>
      </div>
    </aside>
  );
};
