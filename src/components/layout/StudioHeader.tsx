import React, { useState, useRef, useEffect } from 'react';
import { Shield, Play, Activity, ChevronDown, Layout, Zap, Check, Layers } from 'lucide-react';
import { GameLaunchMode } from '../../types';

interface StudioHeaderProps {
  conflictCount: number;
  polyfillCount: number;
  activeProfileName?: string;
  onNavigateToProfiles?: () => void;
  onRunSandbox: (mode: GameLaunchMode) => void;
}

const LAUNCH_MODES: {
  id: GameLaunchMode;
  title: string;
  badge: string;
  badgeColor: string;
  description: string;
  buttonLabel: string;
  category: 'DEBUG' | 'NORMAL';
}[] = [
  {
    id: 'DEBUG_FULLSCREEN',
    title: 'Debug Mode (Fullscreen)',
    badge: 'Recommended',
    badgeColor: 'bg-emerald-950 text-emerald-300 border-emerald-800/80',
    description: 'Launches in fullscreen with debugging (-debug), captures live logs and detects crashes.',
    buttonLabel: 'Launch Debug (Fullscreen)',
    category: 'DEBUG',
  },
  {
    id: 'DEBUG_WINDOWED',
    title: 'Debug Mode (Windowed)',
    badge: 'Multitasking',
    badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-800/80',
    description: 'Same live debugging (-debug), but in windowed mode to view the app and game in parallel.',
    buttonLabel: 'Launch Debug (Windowed)',
    category: 'DEBUG',
  },
  {
    id: 'NORMAL_FULLSCREEN',
    title: 'Normal Game (Fullscreen)',
    badge: 'Standard',
    badgeColor: 'bg-amber-950 text-amber-300 border-amber-800/80',
    description: 'Standard native game in full screen (without -debug flag) for regular gameplay.',
    buttonLabel: 'Launch Normal (Fullscreen)',
    category: 'NORMAL',
  },
  {
    id: 'NORMAL_WINDOWED',
    title: 'Normal Game (Windowed)',
    badge: 'Windowed',
    badgeColor: 'bg-purple-950 text-purple-300 border-purple-800/80',
    description: 'Standard native game in windowed mode (without -debug flag) for regular gameplay.',
    buttonLabel: 'Launch Normal (Windowed)',
    category: 'NORMAL',
  },
];

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  conflictCount,
  polyfillCount,
  activeProfileName,
  onNavigateToProfiles,
  onRunSandbox,
}) => {
  const [selectedMode, setSelectedMode] = useState<GameLaunchMode>('DEBUG_FULLSCREEN');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isDropdownOpen]);

  const activeModeConfig = LAUNCH_MODES.find((m) => m.id === selectedMode) || LAUNCH_MODES[0];

  const handleSelectMode = (mode: GameLaunchMode, executeImmediately = false) => {
    setSelectedMode(mode);
    setIsDropdownOpen(false);
    if (executeImmediately) {
      onRunSandbox(mode);
    }
  };

  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between select-none shrink-0 shadow-md relative z-40">
      {/* App Branding & Logo */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-slate-100 leading-none flex items-center gap-2">
            PZ Mod Studio
            <span className="text-[10px] font-normal text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-1.5 py-0.5 rounded font-mono">
              v1.0.0
            </span>
          </h1>
          <p className="text-[11px] text-slate-400 leading-tight mt-0.5 font-mono">
            Project Zomboid • Build 42+ Suite
          </p>
        </div>
      </div>

      {/* Center Status Indicators */}
      <div className="hidden md:flex items-center gap-3 text-xs">
        {/* Active Profile Badge */}
        <button
          onClick={onNavigateToProfiles}
          className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800 hover:border-emerald-600/60 transition cursor-pointer group shadow-inner"
          title="Click to view or change Mod Profiles"
        >
          <Layers className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
          <span className="text-slate-400 font-mono text-[11px]">Profile:</span>
          <span className="font-bold font-mono text-emerald-300 group-hover:text-emerald-200 truncate max-w-[150px]">
            {activeProfileName || 'None'}
          </span>
        </button>

        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          <span className="text-slate-400 font-mono">Virtual Conflicts:</span>
          <span className="font-bold font-mono text-amber-400">{conflictCount}</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span className="text-slate-400 font-mono">Active Polyfills:</span>
          <span className="font-bold font-mono text-emerald-400">{polyfillCount}</span>
        </div>
      </div>

      {/* Right Actions: Launch Sandbox */}
      <div className="flex items-center gap-2.5">
        {/* Launch Game with Dropdown */}
        <div ref={dropdownRef} className="relative flex items-center">
          <div className="flex items-center shadow-lg rounded-lg overflow-hidden border border-emerald-600/40">
            {/* Main Action Button */}
            <button
              onClick={() => onRunSandbox(selectedMode)}
              className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition cursor-pointer"
              title={`Execute in ${activeModeConfig.title}`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{activeModeConfig.buttonLabel}</span>
              {(selectedMode === 'DEBUG_FULLSCREEN' || selectedMode === 'MONITORED') && (
                <Activity className="w-3.5 h-3.5 text-emerald-200 animate-pulse" />
              )}
              {(selectedMode === 'DEBUG_WINDOWED' || selectedMode === 'WINDOWED') && (
                <Layout className="w-3.5 h-3.5 text-cyan-200" />
              )}
              {selectedMode === 'NORMAL_FULLSCREEN' && (
                <Zap className="w-3.5 h-3.5 text-amber-200" />
              )}
              {(selectedMode === 'NORMAL_WINDOWED' || selectedMode === 'NORMAL') && (
                <Layout className="w-3.5 h-3.5 text-purple-200" />
              )}
            </button>

            {/* Dropdown Chevron Button */}
            <button
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              className="px-2 py-2 bg-teal-700 hover:bg-teal-600 text-teal-100 transition cursor-pointer border-l border-teal-600/50 flex items-center justify-center"
              title="Select launch mode"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Dropdown Menu Popup */}
          {isDropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-88 bg-slate-900/95 border border-slate-700/80 rounded-xl shadow-2xl p-1.5 z-50 backdrop-blur-md space-y-1 animate-fade-in">
              <div className="px-2.5 py-1.5 text-[11px] font-bold text-slate-400 border-b border-slate-800 flex items-center justify-between">
                <span>Launch Modes</span>
                <span className="text-[10px] font-mono text-slate-500">Project Zomboid</span>
              </div>

              <div className="px-2.5 pt-1 text-[10px] font-bold text-emerald-400 uppercase tracking-wider font-mono">
                🐞 Debug & Monitored Modes
              </div>

              {LAUNCH_MODES.filter((m) => m.category === 'DEBUG').map((mode) => {
                const isSelected = selectedMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => handleSelectMode(mode.id)}
                    className={`w-full text-left p-2.5 rounded-lg transition cursor-pointer flex items-start gap-2.5 ${
                      isSelected
                        ? 'bg-slate-800/90 border border-emerald-500/40 text-slate-100 shadow-inner'
                        : 'hover:bg-slate-800/50 text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {mode.id === 'DEBUG_FULLSCREEN' && (
                        <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                          <Activity className="w-3.5 h-3.5" />
                        </div>
                      )}
                      {mode.id === 'DEBUG_WINDOWED' && (
                        <div className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                          <Layout className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-xs font-bold text-slate-200 truncate">{mode.title}</span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border shrink-0 ${mode.badgeColor}`}>
                          {mode.badge}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight">{mode.description}</p>
                    </div>

                    {isSelected && <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-1" />}
                  </button>
                );
              })}

              <div className="px-2.5 pt-2 text-[10px] font-bold text-amber-400 uppercase tracking-wider font-mono border-t border-slate-800/80">
                ⚡ Normal Gameplay (No Debug)
              </div>

              {LAUNCH_MODES.filter((m) => m.category === 'NORMAL').map((mode) => {
                const isSelected = selectedMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => handleSelectMode(mode.id)}
                    className={`w-full text-left p-2.5 rounded-lg transition cursor-pointer flex items-start gap-2.5 ${
                      isSelected
                        ? 'bg-slate-800/90 border border-emerald-500/40 text-slate-100 shadow-inner'
                        : 'hover:bg-slate-800/50 text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {mode.id === 'NORMAL_FULLSCREEN' && (
                        <div className="w-6 h-6 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                          <Zap className="w-3.5 h-3.5" />
                        </div>
                      )}
                      {mode.id === 'NORMAL_WINDOWED' && (
                        <div className="w-6 h-6 rounded-md bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                          <Layout className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-xs font-bold text-slate-200 truncate">{mode.title}</span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border shrink-0 ${mode.badgeColor}`}>
                          {mode.badge}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight">{mode.description}</p>
                    </div>

                    {isSelected && <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-1" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
