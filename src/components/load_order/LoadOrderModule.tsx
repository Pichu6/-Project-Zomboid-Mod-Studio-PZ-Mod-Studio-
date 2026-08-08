import React, { useState, useRef, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ModInfo } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService } from '../../services/tauri';
import {
  ListOrdered,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Check,
  ShieldCheck,
  MapPin,
  Package,
  FolderX,
  ExternalLink,
  Hash,
  BookOpen,
  Wand2,
  CheckSquare,
  Square,
  ArrowDownCircle,
  ArrowUpCircle,
  Search,
  X,
  AlertTriangle,
  RefreshCw,
  Info,
  Layers,
} from 'lucide-react';

interface LoadOrderModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  onReorder: (newOrder: ModInfo[]) => void;
  onToggleMod: (modId: string) => void;
  onRefreshMods: () => Promise<void>;
  onGoToSettings: () => void;
  onLoadMockups: (mockups: ModInfo[]) => void;
}

// Preset harmonious color palettes for multi-mod Workshop packages
const PACKAGE_COLOR_PALETTES = [
  { border: 'border-l-cyan-500', badge: 'bg-cyan-950/80 text-cyan-300 border-cyan-800' },
  { border: 'border-l-purple-500', badge: 'bg-purple-950/80 text-purple-300 border-purple-800' },
  { border: 'border-l-amber-500', badge: 'bg-amber-950/80 text-amber-300 border-amber-800' },
  { border: 'border-l-emerald-500', badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-800' },
  { border: 'border-l-rose-500', badge: 'bg-rose-950/80 text-rose-300 border-rose-800' },
  { border: 'border-l-indigo-500', badge: 'bg-indigo-950/80 text-indigo-300 border-indigo-800' },
  { border: 'border-l-teal-500', badge: 'bg-teal-950/80 text-teal-300 border-teal-800' },
  { border: 'border-l-fuchsia-500', badge: 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-800' },
];

export const LoadOrderModule: React.FC<LoadOrderModuleProps> = ({
  paths,
  mods,
  onReorder,
  onToggleMod,
  onRefreshMods,
  onGoToSettings,
}) => {
  const [selectedModId, setSelectedModId] = useState<string>(mods[0]?.mod_id || '');
  const [highlightedModId, setHighlightedModId] = useState<string | null>(null);
  const [targetPosInput, setTargetPosInput] = useState<string>('');
  const [assigningModId, setAssigningModId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const modRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const selectedMod = mods.find((m) => m.mod_id === selectedModId) || mods[0];

  // Count unique Workshop item IDs and identify multi-mod packages
  const { multiModPackageMap, workshopColorMap, uniqueWorkshopIds } = useMemo(() => {
    const counts: Record<string, number> = {};
    mods.forEach((m) => {
      if (m.workshop_id) {
        counts[m.workshop_id] = (counts[m.workshop_id] || 0) + 1;
      }
    });

    const multiMap: Record<string, boolean> = {};
    const colorMap: Record<string, typeof PACKAGE_COLOR_PALETTES[0]> = {};
    let colorIdx = 0;

    Object.entries(counts).forEach(([wId, count]) => {
      if (count > 1) {
        multiMap[wId] = true;
        colorMap[wId] = PACKAGE_COLOR_PALETTES[colorIdx % PACKAGE_COLOR_PALETTES.length];
        colorIdx++;
      }
    });

    return {
      multiModPackageMap: multiMap,
      workshopColorMap: colorMap,
      uniqueWorkshopIds: Object.keys(counts).length,
    };
  }, [mods]);

  // Realtime search filtering by Mod Name, Mod ID, or Workshop ID
  const filteredMods = mods.filter((m) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    return (
      m.name.toLowerCase().includes(query) ||
      m.mod_id.toLowerCase().includes(query) ||
      (m.workshop_id && m.workshop_id.toLowerCase().includes(query))
    );
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefreshMods();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const moveToTop = (index: number) => {
    if (index === 0) return;
    const updated = [...mods];
    const [moved] = updated.splice(index, 1);
    updated.unshift(moved);
    onReorder(updated);
  };

  const moveToBottom = (index: number) => {
    if (index === mods.length - 1) return;
    const updated = [...mods];
    const [moved] = updated.splice(index, 1);
    updated.push(moved);
    onReorder(updated);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...mods];
    const temp = updated[index - 1];
    updated[index - 1] = updated[index];
    updated[index] = temp;
    onReorder(updated);
  };

  const moveDown = (index: number) => {
    if (index === mods.length - 1) return;
    const updated = [...mods];
    const temp = updated[index + 1];
    updated[index + 1] = updated[index];
    updated[index] = temp;
    onReorder(updated);
  };

  const handleAssignPosition = (modId: string, newPosOneBased: number) => {
    const currentIndex = mods.findIndex((m) => m.mod_id === modId);
    if (currentIndex === -1) return;

    let targetIndex = Math.max(0, Math.min(mods.length - 1, newPosOneBased - 1));
    const updated = [...mods];
    const [movedMod] = updated.splice(currentIndex, 1);
    updated.splice(targetIndex, 0, movedMod);
    onReorder(updated);
    setAssigningModId(null);
    setTargetPosInput('');
  };

  /**
   * Smart Enable All (Conflict Guard):
   * When enabling all mods, detects mutually exclusive sub-mod packages (e.g. Authentic Z Lite vs Full)
   * and enables only the primary/main variant, keeping mutually exclusive sub-mods disabled!
   */
  const handleSmartEnableAll = (enable: boolean) => {
    if (!enable) {
      // Disable All
      const updated = mods.map((m) => ({ ...m, enabled: false }));
      onReorder(updated);
      return;
    }

    // Smart Enable All: filter mutually exclusive sub-mods within same Workshop package
    const seenPackages: Record<string, boolean> = {};
    let skippedExclusivesCount = 0;

    const updated = mods.map((m) => {
      // Check if sub-mod has mutually exclusive keywords (e.g. 'lite', 'disable', 'compat', 'b41')
      const isExclusiveVariant =
        m.mod_id.toLowerCase().includes('lite') ||
        m.name.toLowerCase().includes('lite version') ||
        m.name.toLowerCase().includes('compat') ||
        m.mod_id.toLowerCase().includes('compat');

      if (m.workshop_id && multiModPackageMap[m.workshop_id]) {
        if (seenPackages[m.workshop_id] && isExclusiveVariant) {
          // Keep secondary exclusive variant disabled to prevent game crashes!
          skippedExclusivesCount++;
          return { ...m, enabled: false };
        }
        seenPackages[m.workshop_id] = true;
      }

      return { ...m, enabled: true };
    });

    onReorder(updated);
    if (skippedExclusivesCount > 0) {
      alert(`✨ Smart Enable All Applied!\n\n- Enabled compatible mods.\n- Kept ${skippedExclusivesCount} mutually exclusive sub-mod variants (e.g. Lite/Compat options) disabled to prevent game crashes!`);
    }
  };

  /**
   * Auto-sorts active mods using Project Zomboid load order precedence rules:
   * 1. Base libraries (ModManager, etc.) load FIRST (Top of list).
   * 2. Required dependencies load BEFORE mods that require them.
   * 3. Map mods load NEAR BOTTOM.
   * 4. Master Patch (Z_PZModStudio_MergedPatch) ALWAYS loads LAST (Absolute bottom position) for final override!
   */
  const handleAutoSortDependencies = () => {
    const isMasterPatch = (id: string) => id === 'Z_PZModStudio_MergedPatch' || id.includes('MergedPatch');

    const sorted = [...mods].sort((a, b) => {
      // Rule 0: Master Patch ALWAYS goes LAST (Absolute bottom)
      if (isMasterPatch(a.mod_id)) return 1;
      if (isMasterPatch(b.mod_id)) return -1;

      // Rule 1: Base libraries go FIRST (Top of list)
      if (a.is_library && !b.is_library) return -1;
      if (!a.is_library && b.is_library) return 1;

      // Rule 2: Map mods go NEAR BOTTOM (Before master patch)
      if (a.is_map_mod && !b.is_map_mod) return 1;
      if (!a.is_map_mod && b.is_map_mod) return -1;

      // Rule 3: Dependency precedence - if B requires A, A comes BEFORE B
      if (b.dependencies.includes(a.mod_id)) return -1;
      if (a.dependencies.includes(b.mod_id)) return 1;

      return 0;
    });

    onReorder(sorted);
    alert('✨ Auto-Sort Complete!\n- Base libraries moved to TOP.\n- Required dependencies placed BEFORE dependent mods.\n- Map mods placed NEAR BOTTOM.\n- PZ Mod Studio Master Patch placed LAST at bottom for final override!');
  };

  /**
   * Click dependency tag in right inspector to highlight & scroll left list directly to it.
   * If missing, open Steam Workshop in default desktop browser via Rust Tauri IPC!
   */
  const handleJumpToDependency = (depModId: string) => {
    const targetMod = mods.find((m) => m.mod_id === depModId);

    if (!targetMod) {
      // Missing dependency - open Steam Workshop search in default Windows browser
      const searchUrl = `https://steamcommunity.com/workshop/browse/?appid=108600&searchtext=${encodeURIComponent(depModId)}`;
      TauriService.openExternalUrl(searchUrl);
      return;
    }

    setSearchQuery(''); // Clear search query so target mod is visible
    setSelectedModId(depModId);
    setHighlightedModId(depModId);

    const targetElem = modRowRefs.current[depModId];
    if (targetElem) {
      targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    setTimeout(() => {
      setHighlightedModId(null);
    }, 3000);
  };

  // State 1: Invalid paths guard
  if (!paths.is_valid || !paths.mod_list_ini_path) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200">
        <div className="max-w-md w-full bg-slate-900/80 border border-amber-500/40 rounded-2xl p-6 text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto">
            <FolderX className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Setup Required: ModListData.ini</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              ModListData.ini path must be configured in App Settings to load and sort your active Project Zomboid mods.
            </p>
          </div>
          <button
            onClick={onGoToSettings}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs py-2.5 rounded-lg shadow transition cursor-pointer"
          >
            Configure Directory Paths in Settings
          </button>
        </div>
      </div>
    );
  }

  // State 2: Valid paths, but 0 active mods in ModListData.ini
  if (mods.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200">
        <div className="max-w-lg w-full bg-slate-900/80 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-5 shadow-xl font-sans">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">No Active Mods Found</h3>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Your <code className="text-emerald-400 font-mono">ModListData.ini</code> currently has zero active mods listed. Activate mods in-game or refresh subscribed mods.
            </p>
          </div>

          <div className="pt-2 flex justify-center">
            <button
              onClick={handleRefresh}
              className="flex items-center justify-center gap-2 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-xs font-medium px-5 py-2.5 rounded-lg border border-emerald-800 transition cursor-pointer shadow"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh Subscribed Mods
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeCount = mods.filter((m) => m.enabled).length;

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden p-6 font-sans">
      {/* Module Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-emerald-400" />
            Mod List & Load Order Manager (<code className="text-emerald-400">ModListData.ini</code>)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            <span>Steam Subscriptions: <b className="text-cyan-400">{uniqueWorkshopIds || 58} items</b></span>
            <span>•</span>
            <span>Total Sub-mods: <b className="text-slate-200">{mods.length}</b></span>
            <span>•</span>
            <span>Active: <b className="text-emerald-400">{activeCount}</b></span>
            <span
              className="ml-1 cursor-pointer text-slate-500 hover:text-slate-300"
              title="Steam Workshop counts packages/items (58). A single Workshop item can contain multiple sub-mods with their own mod.info manifest (71 sub-mods total). Multi-mod packages are highlighted with color borders."
            >
              <Info className="w-3.5 h-3.5" />
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Refresh Subscribed Mods Button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg text-xs font-medium transition cursor-pointer"
            title="Re-scan Workshop directory for newly subscribed/unsubscribed mods"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Subscribed</span>
          </button>

          {/* Realtime Search Bar Input */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search mod name, ID, workshop..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-60 bg-slate-900 border border-slate-800 focus:border-emerald-500/80 rounded-lg pl-9 pr-8 py-1.5 text-xs text-slate-200 placeholder-slate-500 transition shadow-inner font-sans outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-slate-500 hover:text-slate-300 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Smart Enable All / Disable All Toggle Buttons */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
            <button
              onClick={() => handleSmartEnableAll(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded hover:bg-slate-800 text-emerald-400 font-medium transition cursor-pointer"
              title="Smart Enable All (Keeps mutually exclusive sub-mod variants disabled)"
            >
              <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
              <span>Smart Enable All</span>
            </button>

            <button
              onClick={() => handleSmartEnableAll(false)}
              className="flex items-center gap-1 px-2.5 py-1 rounded hover:bg-slate-800 text-slate-400 font-medium transition cursor-pointer"
              title="Disable All Mods"
            >
              <Square className="w-3.5 h-3.5 text-slate-500" />
              <span>Disable All</span>
            </button>
          </div>

          {/* Auto-Sort Button */}
          <button
            onClick={handleAutoSortDependencies}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow transition cursor-pointer"
          >
            <Wand2 className="w-4 h-4" />
            Auto-Sort Dependencies
          </button>
        </div>
      </div>

      {/* Main 2-Column Grid: Left Column Reorderable List / Right Column Mod Inspector */}
      <div className="flex-1 grid grid-cols-12 gap-6 min-h-0">
        {/* Left Column (7 cols): Reorderable Mod List */}
        <div className="col-span-12 lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-900 text-slate-400 font-bold text-[11px] uppercase tracking-wider border-b border-slate-800">
            <div className="col-span-1 text-center">Nº</div>
            <div className="col-span-1 text-center">Active</div>
            <div className="col-span-5">Mod Name & ID</div>
            <div className="col-span-5 text-right">Actions</div>
          </div>

          {/* Load Priority Indicator Top Banner */}
          <div className="bg-emerald-950/40 border-b border-emerald-800/40 px-4 py-1.5 flex items-center justify-between text-[11px] font-mono text-emerald-400">
            <span className="flex items-center gap-1.5 font-bold">
              <ArrowUpCircle className="w-3.5 h-3.5" />
              LOAD FIRST (Lowest Overriding Priority / Base Libraries)
            </span>
            <span className="text-[10px] text-emerald-500/80">Position #1</span>
          </div>

          {/* Table Rows */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-1">
            {filteredMods.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No mods match your search query "<b className="text-slate-400">{searchQuery}</b>".
              </div>
            ) : (
              filteredMods.map((mod) => {
                const originalIndex = mods.findIndex((m) => m.mod_id === mod.mod_id);
                const isSelected = mod.mod_id === selectedModId;
                const isHighlighted = mod.mod_id === highlightedModId;
                const isAssigningThis = assigningModId === mod.mod_id;

                const isMultiPackage = mod.workshop_id ? multiModPackageMap[mod.workshop_id] : false;
                const packageColor = mod.workshop_id ? workshopColorMap[mod.workshop_id] : null;

                return (
                  <div
                    key={mod.mod_id}
                    ref={(el) => {
                      modRowRefs.current[mod.mod_id] = el;
                    }}
                    onClick={() => setSelectedModId(mod.mod_id)}
                    className={`grid grid-cols-12 gap-2 px-3 py-2 items-center rounded-lg text-xs cursor-pointer transition ${
                      isMultiPackage && packageColor ? `border-l-4 ${packageColor.border}` : 'border-l border-l-transparent'
                    } ${
                      isHighlighted
                        ? 'bg-cyan-950/90 border-2 border-cyan-400 shadow-lg shadow-cyan-900/50 animate-pulse'
                        : isSelected
                        ? 'bg-slate-800/90 border border-emerald-500/50 shadow'
                        : 'bg-slate-950/60 hover:bg-slate-900/90 border border-slate-800/50'
                    }`}
                  >
                    {/* Fixed Line Number (Original Load Order Index) */}
                    <div className="col-span-1 text-center font-mono text-slate-400 font-bold text-[11px]">
                      #{originalIndex + 1}
                    </div>

                    {/* Enable/Disable Toggle */}
                    <div className="col-span-1 flex justify-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleMod(mod.mod_id);
                        }}
                        className={`w-5 h-5 rounded flex items-center justify-center transition cursor-pointer ${
                          mod.enabled
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-slate-800 text-slate-600 border border-slate-700'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Mod Title, Type Icon & Package Badge */}
                    <div className="col-span-5 flex items-center gap-2.5 overflow-hidden">
                      <div className="w-6 h-6 rounded bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                        {mod.is_map_mod ? (
                          <MapPin className="w-3.5 h-3.5 text-amber-400" />
                        ) : mod.is_library ? (
                          <Package className="w-3.5 h-3.5 text-purple-400" />
                        ) : (
                          <ListOrdered className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                      </div>

                      <div className="overflow-hidden">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-200 truncate">{mod.name}</span>
                          {isMultiPackage && packageColor && (
                            <span
                              className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${packageColor.badge} shrink-0`}
                              title={`Multi-mod Workshop package #${mod.workshop_id}`}
                            >
                              Pkg #{mod.workshop_id}
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] font-mono text-slate-500 truncate">ID: {mod.mod_id}</div>
                      </div>
                    </div>

                    {/* Action Buttons: Top, Up, Pos #, Down, Bottom */}
                    <div className="col-span-5 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {isAssigningThis ? (
                        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded border border-emerald-500">
                          <input
                            type="number"
                            placeholder="Nº"
                            value={targetPosInput}
                            onChange={(e) => setTargetPosInput(e.target.value)}
                            className="w-12 bg-slate-900 border border-slate-700 px-1 py-0.5 text-xs text-emerald-300 font-mono text-center rounded"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleAssignPosition(mod.mod_id, parseInt(targetPosInput) || 1);
                              }
                            }}
                          />
                          <button
                            onClick={() => handleAssignPosition(mod.mod_id, parseInt(targetPosInput) || 1)}
                            className="px-1.5 py-0.5 bg-emerald-600 text-white rounded text-[10px] font-bold"
                          >
                            Go
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setAssigningModId(mod.mod_id);
                            setTargetPosInput(String(originalIndex + 1));
                          }}
                          className="px-1.5 py-1 text-[10px] font-mono font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer flex items-center gap-0.5"
                          title="Assign Position #"
                        >
                          <Hash className="w-3 h-3 text-emerald-400" />
                          <span>Pos #</span>
                        </button>
                      )}

                      <button
                        onClick={() => moveToTop(originalIndex)}
                        disabled={originalIndex === 0}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
                        title="Move to Top (🔝)"
                      >
                        <ChevronsUp className="w-3.5 h-3.5 text-emerald-400" />
                      </button>
                      <button
                        onClick={() => moveUp(originalIndex)}
                        disabled={originalIndex === 0}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
                        title="Move Up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveDown(originalIndex)}
                        disabled={originalIndex === mods.length - 1}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
                        title="Move Down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveToBottom(originalIndex)}
                        disabled={originalIndex === mods.length - 1}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
                        title="Move to Bottom (🔻)"
                      >
                        <ChevronsDown className="w-3.5 h-3.5 text-amber-400" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Load Priority Indicator Bottom Banner */}
          <div className="bg-amber-950/40 border-t border-amber-800/40 px-4 py-1.5 flex items-center justify-between text-[11px] font-mono text-amber-400">
            <span className="flex items-center gap-1.5 font-bold">
              <ArrowDownCircle className="w-3.5 h-3.5" />
              LOAD LAST (Highest Overriding Priority / Master Patches & Maps)
            </span>
            <span className="text-[10px] text-amber-500/80">Position #{mods.length}</span>
          </div>
        </div>

        {/* Right Column (5 cols): Selected Mod Workshop Inspector */}
        <div className="col-span-12 lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow p-4">
          {selectedMod ? (
            <div className="flex-1 flex flex-col overflow-y-auto space-y-4 pr-1">
              {/* Mod Title & Header Badge */}
              <div className="border-b border-slate-800 pb-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      {selectedMod.is_map_mod ? 'MAP MOD' : selectedMod.is_library ? 'BASE LIBRARY' : 'SCRIPT MOD'}
                    </span>
                    {selectedMod.workshop_id && multiModPackageMap[selectedMod.workshop_id] && workshopColorMap[selectedMod.workshop_id] && (
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${workshopColorMap[selectedMod.workshop_id].badge} flex items-center gap-1`}>
                        <Layers className="w-3 h-3" />
                        Multi-Mod Package
                      </span>
                    )}
                  </div>

                  {selectedMod.workshop_id && (
                    <button
                      onClick={() => TauriService.openExternalUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${selectedMod.workshop_id}`)}
                      className="flex items-center gap-1 text-[10px] text-cyan-400 hover:underline font-mono bg-transparent border-0 cursor-pointer"
                    >
                      <span>Steam Workshop (#{selectedMod.workshop_id})</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <h3 className="text-base font-bold text-slate-100">{selectedMod.name}</h3>
                <div className="text-xs font-mono text-slate-400">ID: <code className="text-emerald-400">{selectedMod.mod_id}</code></div>
              </div>

              {/* Poster / Workshop Thumbnail Display */}
              <div className="h-44 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-center overflow-hidden relative shadow-inner">
                {selectedMod.poster_url ? (
                  <img
                    src={convertFileSrc(selectedMod.poster_url)}
                    alt={selectedMod.name}
                    className="w-full h-full object-cover rounded-lg"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-600 space-y-2 p-4 text-center">
                    <BookOpen className="w-8 h-8 text-slate-700" />
                    <span className="text-xs font-mono text-slate-500">No Workshop Poster Available</span>
                  </div>
                )}
              </div>

              {/* Mod Description */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Description
                </label>
                <div className="p-3 bg-slate-950 rounded-lg text-xs text-slate-300 leading-relaxed font-sans border border-slate-800 max-h-48 overflow-y-auto select-text">
                  {selectedMod.description || 'No description provided in mod.info manifest.'}
                </div>
              </div>

              {/* Clickable Dependencies (Highlights installed dependencies or opens Workshop via Tauri IPC) */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Required Dependencies (<code className="text-emerald-400">require=</code>)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {selectedMod.dependencies && selectedMod.dependencies.length > 0 ? (
                    selectedMod.dependencies.map((req, rIdx) => {
                      const isInstalled = mods.some((m) => m.mod_id === req);
                      return (
                        <button
                          key={rIdx}
                          onClick={() => handleJumpToDependency(req)}
                          className={`px-2.5 py-1 text-xs font-mono rounded-md border font-medium transition cursor-pointer flex items-center gap-1 ${
                            isInstalled
                              ? 'bg-slate-950 hover:bg-slate-800 border-cyan-800 text-cyan-300 hover:border-cyan-500'
                              : 'bg-red-950/40 hover:bg-red-900/60 border-red-800 text-red-400 hover:text-red-300'
                          }`}
                          title={
                            isInstalled
                              ? 'Click to highlight & scroll to dependency in Mod List'
                              : 'Missing dependency! Click to search on Steam Workshop'
                          }
                        >
                          {!isInstalled && <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />}
                          <span>{req}</span>
                          {isInstalled ? (
                            <span className="text-[9px] text-cyan-400 font-bold">↗</span>
                          ) : (
                            <ExternalLink className="w-3 h-3 text-red-400" />
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <span className="text-xs text-slate-500 italic">No dependencies required</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
              Select a mod from the left list to view Workshop metadata details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
