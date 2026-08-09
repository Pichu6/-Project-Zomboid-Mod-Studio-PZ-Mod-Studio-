import React, { useState, useRef, useMemo } from 'react';
import { ModInfo } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService } from '../../services/tauri';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  ListOrdered,
  RefreshCw,
  Search,
  Wand2,
  CheckSquare,
  Square,
  ArrowUpCircle,
  ArrowDownCircle,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Hash,
  Check,
  Package,
  MapPin,
  ExternalLink,
  BookOpen,
  Layers,
  FolderX,
  ShieldCheck,
  HelpCircle,
  AlertTriangle,
  X,
  ShieldAlert,
  Link2,
} from 'lucide-react';

interface LoadOrderModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  onReorder: (newOrder: ModInfo[]) => void;
  onToggleMod: (modId: string) => void;
  onRefreshMods: () => void;
  onGoToSettings: () => void;
  onLoadMockups: (mockMods: ModInfo[]) => void;
}

const PACKAGE_COLOR_PALETTES = [
  { border: 'border-l-cyan-400', bgMatch: 'bg-cyan-950/25 hover:bg-cyan-950/40 border-cyan-900/40', badge: 'bg-cyan-950/90 text-cyan-300 border-cyan-700/60' },
  { border: 'border-l-purple-400', bgMatch: 'bg-purple-950/25 hover:bg-purple-950/40 border-purple-900/40', badge: 'bg-purple-950/90 text-purple-300 border-purple-700/60' },
  { border: 'border-l-emerald-400', bgMatch: 'bg-emerald-950/25 hover:bg-emerald-950/40 border-emerald-900/40', badge: 'bg-emerald-950/90 text-emerald-300 border-emerald-700/60' },
  { border: 'border-l-amber-400', bgMatch: 'bg-amber-950/25 hover:bg-amber-950/40 border-amber-900/40', badge: 'bg-amber-950/90 text-amber-300 border-amber-700/60' },
  { border: 'border-l-pink-400', bgMatch: 'bg-pink-950/25 hover:bg-pink-950/40 border-pink-900/40', badge: 'bg-pink-950/90 text-pink-300 border-pink-700/60' },
  { border: 'border-l-indigo-400', bgMatch: 'bg-indigo-950/25 hover:bg-indigo-950/40 border-indigo-900/40', badge: 'bg-indigo-950/90 text-indigo-300 border-indigo-700/60' },
  { border: 'border-l-rose-400', bgMatch: 'bg-rose-950/25 hover:bg-rose-950/40 border-rose-900/40', badge: 'bg-rose-950/90 text-rose-300 border-rose-700/60' },
  { border: 'border-l-teal-400', bgMatch: 'bg-teal-950/25 hover:bg-teal-950/40 border-teal-900/40', badge: 'bg-teal-950/90 text-teal-300 border-teal-700/60' },
];

const normalizeModId = (id: string): string => {
  return id
    .trim()
    .toLowerCase()
    .replace(/^[\\/]+/, '')
    .replace(/[\\'"]/g, '')
    .trim();
};

export const LoadOrderModule: React.FC<LoadOrderModuleProps> = ({
  paths,
  mods,
  onReorder,
  onToggleMod,
  onRefreshMods,
  onGoToSettings,
}) => {
  const [selectedModId, setSelectedModId] = useState<string | null>(mods.length > 0 ? mods[0].mod_id : null);
  const [highlightedModId, setHighlightedModId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [assigningModId, setAssigningModId] = useState<string | null>(null);
  const [targetPosInput, setTargetPosInput] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const modRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefreshMods();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const { multiModPackageMap, workshopColorMap, uniqueWorkshopIds } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of mods) {
      if (m.workshop_id) {
        counts[m.workshop_id] = (counts[m.workshop_id] || 0) + 1;
      }
    }

    const multiMap: Record<string, boolean> = {};
    const colorMap: Record<string, typeof PACKAGE_COLOR_PALETTES[0]> = {};
    let colorIdx = 0;

    for (const [wId, count] of Object.entries(counts)) {
      if (count > 1) {
        multiMap[wId] = true;
        colorMap[wId] = PACKAGE_COLOR_PALETTES[colorIdx % PACKAGE_COLOR_PALETTES.length];
        colorIdx++;
      }
    }

    const uniqueWorkshopCount = Object.keys(counts).length;

    return { multiModPackageMap: multiMap, workshopColorMap: colorMap, uniqueWorkshopIds: uniqueWorkshopCount };
  }, [mods]);

  const modCategoryCounts = useMemo(() => {
    let mapCount = 0;
    let libCount = 0;
    let scriptCount = 0;

    for (const m of mods) {
      if (m.is_map_mod) mapCount++;
      else if (m.is_library) libCount++;
      else scriptCount++;
    }

    return { mapCount, libCount, scriptCount };
  }, [mods]);

  const activeConflictsMap = useMemo(() => {
    const map: Record<string, { conflictingModId: string; conflictingModName: string }[]> = {};

    const activeMods = mods.filter((m) => m.enabled);
    const activeByPackage: Record<string, ModInfo[]> = {};

    for (const m of activeMods) {
      if (m.workshop_id) {
        if (!activeByPackage[m.workshop_id]) activeByPackage[m.workshop_id] = [];
        activeByPackage[m.workshop_id].push(m);
      }
    }

    for (const pkgMods of Object.values(activeByPackage)) {
      if (pkgMods.length > 1) {
        for (let i = 0; i < pkgMods.length; i++) {
          for (let j = i + 1; j < pkgMods.length; j++) {
            const modA = pkgMods[i];
            const modB = pkgMods[j];

            const nameA = modA.name.toLowerCase();
            const nameB = modB.name.toLowerCase();
            const isVariantA = nameA.includes('ui only') || nameA.includes('lite') || nameA.includes('base');
            const isVariantB = nameB.includes('ui only') || nameB.includes('lite') || nameB.includes('base');

            if (isVariantA || isVariantB) {
              if (!map[modA.mod_id]) map[modA.mod_id] = [];
              map[modA.mod_id].push({ conflictingModId: modB.mod_id, conflictingModName: modB.name });

              if (!map[modB.mod_id]) map[modB.mod_id] = [];
              map[modB.mod_id].push({ conflictingModId: modA.mod_id, conflictingModName: modA.name });
            }
          }
        }
      }
    }

    return map;
  }, [mods]);

  const missingActiveDependenciesMap = useMemo(() => {
    const map: Record<string, ModInfo[]> = {};

    for (const m of mods) {
      if (m.enabled && m.dependencies && m.dependencies.length > 0) {
        const disabledDeps: ModInfo[] = [];
        for (const depRaw of m.dependencies) {
          const normReq = normalizeModId(depRaw);
          const matched = mods.find((target) => normalizeModId(target.mod_id) === normReq);
          if (matched && !matched.enabled) {
            disabledDeps.push(matched);
          }
        }
        if (disabledDeps.length > 0) {
          map[m.mod_id] = disabledDeps;
        }
      }
    }

    return map;
  }, [mods]);

  const filteredMods = useMemo(() => {
    if (!searchQuery.trim()) return mods;
    const query = searchQuery.toLowerCase().trim();
    return mods.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.mod_id.toLowerCase().includes(query) ||
        (m.workshop_id && m.workshop_id.toLowerCase().includes(query))
    );
  }, [mods, searchQuery]);

  const selectedMod = mods.find((m) => m.mod_id === selectedModId) || (mods.length > 0 ? mods[0] : null);

  const reverseDependents = useMemo(() => {
    if (!selectedMod) return [];
    const selNorm = normalizeModId(selectedMod.mod_id);
    return mods.filter(
      (m) => m.mod_id !== selectedMod.mod_id && m.dependencies.some((dep) => normalizeModId(dep) === selNorm)
    );
  }, [selectedMod, mods]);

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...mods];
    const temp = newOrder[index];
    newOrder[index] = newOrder[index - 1];
    newOrder[index - 1] = temp;
    onReorder(newOrder);
  };

  const moveDown = (index: number) => {
    if (index >= mods.length - 1) return;
    const newOrder = [...mods];
    const temp = newOrder[index];
    newOrder[index] = newOrder[index + 1];
    newOrder[index + 1] = temp;
    onReorder(newOrder);
  };

  const moveToTop = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...mods];
    const item = newOrder.splice(index, 1)[0];
    newOrder.unshift(item);
    onReorder(newOrder);
  };

  const moveToBottom = (index: number) => {
    if (index >= mods.length - 1) return;
    const newOrder = [...mods];
    const item = newOrder.splice(index, 1)[0];
    newOrder.push(item);
    onReorder(newOrder);
  };

  const handleAssignPosition = (modId: string, targetPos: number) => {
    const currentIndex = mods.findIndex((m) => m.mod_id === modId);
    if (currentIndex === -1) return;

    let targetIndex = Math.max(1, Math.min(targetPos, mods.length)) - 1;
    if (currentIndex === targetIndex) {
      setAssigningModId(null);
      return;
    }

    const newOrder = [...mods];
    const [movedMod] = newOrder.splice(currentIndex, 1);
    newOrder.splice(targetIndex, 0, movedMod);

    onReorder(newOrder);
    setAssigningModId(null);
    setTargetPosInput('');
  };

  const handleToggleSingleMod = (modId: string) => {
    const targetMod = mods.find((m) => m.mod_id === modId);
    if (!targetMod) return;

    const targetWillBeEnabled = !targetMod.enabled;

    if (targetWillBeEnabled && targetMod.workshop_id) {
      const updated = mods.map((m) => {
        if (m.mod_id === modId) {
          return { ...m, enabled: true };
        }

        if (m.enabled && m.workshop_id === targetMod.workshop_id && m.mod_id !== modId) {
          const nameA = targetMod.name.toLowerCase();
          const nameB = m.name.toLowerCase();
          const isVariantA = nameA.includes('ui only') || nameA.includes('lite') || nameA.includes('base');
          const isVariantB = nameB.includes('ui only') || nameB.includes('lite') || nameB.includes('base');

          if (isVariantA || isVariantB) {
            return { ...m, enabled: false };
          }
        }
        return m;
      });
      onReorder(updated);
    } else {
      onToggleMod(modId);
    }
  };

  const handleEnableAllWithoutDiscrimination = (enable: boolean) => {
    const updated = mods.map((m) => ({ ...m, enabled: enable }));
    onReorder(updated);
  };

  const handleAutoSortDependencies = () => {
    const isMasterPatch = (id: string) => id === 'Z_PZModStudio_MergedPatch' || id.includes('MergedPatch');

    const sorted = [...mods].sort((a, b) => {
      if (isMasterPatch(a.mod_id)) return 1;
      if (isMasterPatch(b.mod_id)) return -1;

      if (a.is_library && !b.is_library) return -1;
      if (!a.is_library && b.is_library) return 1;

      if (a.is_map_mod && !b.is_map_mod) return 1;
      if (!a.is_map_mod && b.is_map_mod) return -1;

      const normA = normalizeModId(a.mod_id);
      const normB = normalizeModId(b.mod_id);

      if (b.dependencies.some((dep) => normalizeModId(dep) === normA)) return -1;
      if (a.dependencies.some((dep) => normalizeModId(dep) === normB)) return 1;

      if (a.workshop_id && b.workshop_id && a.workshop_id === b.workshop_id) {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }

      if (a.workshop_id && b.workshop_id) {
        return a.workshop_id.localeCompare(b.workshop_id);
      }

      return 0;
    });

    onReorder(sorted);
    alert('✨ Auto-Sort & Package Grouping Complete!\n- Sub-mods of the same Workshop Package grouped TOGETHER.\n- Base libraries moved to TOP.\n- Required dependencies placed BEFORE dependent mods.\n- Map mods placed NEAR BOTTOM.\n- PZ Mod Studio Master Patch placed LAST at bottom for final override!');
  };

  const findInstalledDependency = (reqRaw: string): ModInfo | undefined => {
    const normReq = normalizeModId(reqRaw);
    const alphaReq = normReq.replace(/[^a-z0-9]/g, '');

    return mods.find((m) => {
      const normM = normalizeModId(m.mod_id);
      const alphaM = normM.replace(/[^a-z0-9]/g, '');

      return (
        normM === normReq ||
        alphaM === alphaReq ||
        (alphaReq.length > 3 && alphaM.includes(alphaReq)) ||
        (alphaM.length > 3 && alphaReq.includes(alphaM))
      );
    });
  };

  /**
   * Helper to jump to any mod in the list: clears search query, selects it, highlights row with cyan glow, and scrolls smoothly to it!
   */
  const handleJumpToMod = (targetModId: string) => {
    const targetMod = mods.find((m) => m.mod_id === targetModId || normalizeModId(m.mod_id) === normalizeModId(targetModId));
    const finalId = targetMod ? targetMod.mod_id : targetModId;

    setSearchQuery(''); // Clear search query so target mod is guaranteed visible in DOM
    setSelectedModId(finalId);
    setHighlightedModId(finalId);

    setTimeout(() => {
      const targetElem = modRowRefs.current[finalId];
      if (targetElem) {
        targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);

    setTimeout(() => {
      setHighlightedModId(null);
    }, 3000);
  };

  const handleJumpToDependency = (depModIdRaw: string) => {
    const targetMod = findInstalledDependency(depModIdRaw);

    if (!targetMod) {
      const cleanSearch = normalizeModId(depModIdRaw);
      const searchUrl = `https://steamcommunity.com/workshop/browse/?appid=108600&searchtext=${encodeURIComponent(cleanSearch)}`;
      TauriService.openExternalUrl(searchUrl);
      return;
    }

    handleJumpToMod(targetMod.mod_id);
  };

  // State 1: Invalid paths guard
  if (!paths.is_valid || !paths.mod_list_ini_path) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200 font-sans">
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
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200 font-sans">
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
  const activeConflictsCount = Object.keys(activeConflictsMap).length;
  const missingDepsCount = Object.keys(missingActiveDependenciesMap).length;

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
            {activeConflictsCount > 0 && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1 text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  {activeConflictsCount} Exclusivity Warnings
                </span>
              </>
            )}
            {missingDepsCount > 0 && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1 text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30">
                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                  {missingDepsCount} Missing Library Warnings
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg text-xs font-medium transition cursor-pointer"
            title="Re-scan Workshop directory for newly subscribed/unsubscribed mods"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Subscribed</span>
          </button>

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

          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
            <button
              onClick={() => handleEnableAllWithoutDiscrimination(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded hover:bg-slate-800 text-emerald-400 font-medium transition cursor-pointer"
              title="Enable ALL Mods 100% Without Discrimination"
            >
              <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
              <span>Enable All</span>
            </button>

            <button
              onClick={() => handleEnableAllWithoutDiscrimination(false)}
              className="flex items-center gap-1 px-2.5 py-1 rounded hover:bg-slate-800 text-slate-400 font-medium transition cursor-pointer"
              title="Disable All Mods"
            >
              <Square className="w-3.5 h-3.5 text-slate-500" />
              <span>Disable All</span>
            </button>
          </div>

          <button
            onClick={handleAutoSortDependencies}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow transition cursor-pointer"
          >
            <Wand2 className="w-4 h-4" />
            Auto-Sort Dependencies
          </button>
        </div>
      </div>

      {/* Icon Legend Bar */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2 mb-4 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-1.5 font-bold text-slate-300">
          <HelpCircle className="w-4 h-4 text-cyan-400" />
          <span>Mod Type Legend:</span>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2" title="Map Mod - Adds new towns, roads or custom map tiles">
            <div className="w-5 h-5 rounded bg-slate-950 border border-slate-800 flex items-center justify-center">
              <MapPin className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <span>Map Mod (<b className="text-amber-400">{modCategoryCounts.mapCount}</b>)</span>
          </div>

          <div className="flex items-center gap-2" title="Base Library / Framework - Required by other mods">
            <div className="w-5 h-5 rounded bg-slate-950 border border-slate-800 flex items-center justify-center">
              <Package className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <span>Base Library (<b className="text-purple-400">{modCategoryCounts.libCount}</b>)</span>
          </div>

          <div className="flex items-center gap-2" title="Script / Feature Mod - Gameplay tweaks, items, clothing, etc.">
            <div className="w-5 h-5 rounded bg-slate-950 border border-slate-800 flex items-center justify-center">
              <ListOrdered className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <span>Script Mod (<b className="text-cyan-400">{modCategoryCounts.scriptCount}</b>)</span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Grid: Left Column Reorderable List / Right Column Mod Inspector */}
      <div className="flex-1 grid grid-cols-12 gap-6 min-h-0">
        {/* Left Column (7 cols): Reorderable Mod List */}
        <div className="col-span-12 lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow">
          <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-900 text-slate-400 font-bold text-[11px] uppercase tracking-wider border-b border-slate-800">
            <div className="col-span-1 text-center">Nº</div>
            <div className="col-span-1 text-center">Active</div>
            <div className="col-span-5">Mod Name & ID</div>
            <div className="col-span-5 text-right">Actions</div>
          </div>

          <div className="bg-emerald-950/40 border-b border-emerald-800/40 px-4 py-1.5 flex items-center justify-between text-[11px] font-mono text-emerald-400">
            <span className="flex items-center gap-1.5 font-bold">
              <ArrowUpCircle className="w-3.5 h-3.5" />
              LOAD FIRST (Lowest Overriding Priority / Base Libraries)
            </span>
            <span className="text-[10px] text-emerald-500/80">Position #1</span>
          </div>

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

                const conflictsForThisMod = activeConflictsMap[mod.mod_id];
                const hasExclusivityConflict = conflictsForThisMod && conflictsForThisMod.length > 0;

                const disabledDependencies = missingActiveDependenciesMap[mod.mod_id];
                const hasDisabledDependency = disabledDependencies && disabledDependencies.length > 0;

                const isConflictPartner =
                  selectedMod &&
                  activeConflictsMap[selectedMod.mod_id] &&
                  activeConflictsMap[selectedMod.mod_id].some((c) => c.conflictingModId === mod.mod_id);

                return (
                  <div
                    key={mod.mod_id}
                    ref={(el) => {
                      modRowRefs.current[mod.mod_id] = el;
                    }}
                    onClick={() => setSelectedModId(mod.mod_id)}
                    className={`grid grid-cols-12 gap-2 px-3 py-2 items-center rounded-lg text-xs cursor-pointer transition ${
                      hasDisabledDependency
                        ? 'border-2 border-rose-500/80 bg-rose-950/30 shadow-md shadow-rose-950/30'
                        : isConflictPartner
                        ? 'border-2 border-amber-400 bg-amber-950/90 shadow-xl shadow-amber-900/60 ring-2 ring-amber-400/50 animate-pulse'
                        : hasExclusivityConflict
                        ? 'border-2 border-amber-500 bg-amber-950/50 shadow-lg shadow-amber-950/50'
                        : isMultiPackage && packageColor
                        ? `border-l-4 ${packageColor.border}`
                        : 'border-l border-l-transparent'
                    } ${
                      isHighlighted
                        ? 'bg-cyan-950/90 border-2 border-cyan-400 shadow-lg shadow-cyan-900/50 animate-pulse'
                        : isSelected
                        ? 'bg-slate-800/90 border border-emerald-500/60 shadow-lg'
                        : isMultiPackage && packageColor
                        ? packageColor.bgMatch
                        : mod.enabled
                        ? 'bg-slate-900/90 hover:bg-slate-800/80 border border-slate-800'
                        : 'bg-slate-950/40 opacity-60 hover:opacity-100 border border-slate-900/60'
                    }`}
                  >
                    {/* Fixed Line Number (Original Load Order Index) */}
                    <div className={`col-span-1 text-center font-mono text-[11px] ${mod.enabled ? 'text-emerald-400 font-extrabold' : 'text-slate-600 font-medium'}`}>
                      #{originalIndex + 1}
                    </div>

                    {/* Enable/Disable Toggle Checkbox */}
                    <div className="col-span-1 flex justify-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSingleMod(mod.mod_id);
                        }}
                        className={`w-5 h-5 rounded-md flex items-center justify-center transition cursor-pointer ${
                          mod.enabled
                            ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30 border border-emerald-400 font-bold'
                            : 'bg-slate-950 text-slate-700 border border-slate-700 hover:border-slate-500'
                        }`}
                        title={mod.enabled ? 'Click to disable mod' : 'Click to enable mod'}
                      >
                        {mod.enabled && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>
                    </div>

                    {/* Mod Title, Type Icon & Warning Badges */}
                    <div className="col-span-5 flex items-center gap-2.5 overflow-hidden">
                      <div
                        className={`w-6 h-6 rounded border flex items-center justify-center shrink-0 ${
                          mod.enabled
                            ? 'bg-slate-900 border-slate-800'
                            : 'bg-slate-950/80 border-slate-900 opacity-60'
                        }`}
                        title={
                          mod.is_map_mod
                            ? 'Map Mod (Adds custom tiles/towns)'
                            : mod.is_library
                            ? 'Base Library / Framework'
                            : 'Script / Feature Mod'
                        }
                      >
                        {mod.is_map_mod ? (
                          <MapPin className={`w-3.5 h-3.5 ${mod.enabled ? 'text-amber-400' : 'text-amber-700'}`} />
                        ) : mod.is_library ? (
                          <Package className={`w-3.5 h-3.5 ${mod.enabled ? 'text-purple-400' : 'text-purple-700'}`} />
                        ) : (
                          <ListOrdered className={`w-3.5 h-3.5 ${mod.enabled ? 'text-cyan-400' : 'text-cyan-700'}`} />
                        )}
                      </div>

                      <div className="overflow-hidden">
                        <div className="flex items-center gap-1.5">
                          <span className={`truncate ${mod.enabled ? 'font-bold text-slate-100' : 'font-medium text-slate-400/80'}`}>
                            {mod.name}
                          </span>

                          {isMultiPackage && packageColor && (
                            <span
                              className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${packageColor.badge} shrink-0`}
                              title={`Multi-mod Workshop package #${mod.workshop_id}`}
                            >
                              Pkg #{mod.workshop_id}
                            </span>
                          )}

                          {!mod.enabled && (
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-slate-900 text-slate-600 border border-slate-800 shrink-0">
                              OFF
                            </span>
                          )}

                          {hasDisabledDependency && (
                            <span
                              className="flex items-center gap-0.5 text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 shrink-0 cursor-help"
                              title={`⚠️ REQ LIBRARY DISABLED!\nThis mod is active, but required library [${disabledDependencies[0].name}] is currently DISABLED.`}
                            >
                              <AlertTriangle className="w-3 h-3 text-rose-400" />
                              <span>REQ OFF: {disabledDependencies[0].name}</span>
                            </span>
                          )}

                          {hasExclusivityConflict && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToMod(conflictsForThisMod[0].conflictingModId);
                              }}
                              className="flex items-center gap-0.5 text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-500/50 shrink-0 transition cursor-pointer"
                              title={`⚠️ INCOMPATIBILITY WARNING!\nClick to jump, highlight & scroll to conflicting mod: [${conflictsForThisMod[0].conflictingModName}]`}
                            >
                              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                              <span>INCOMPATIBLE (↗ {conflictsForThisMod[0].conflictingModName})</span>
                            </button>
                          )}
                        </div>
                        <div className={`text-[9px] font-mono truncate ${mod.enabled ? 'text-emerald-500/80' : 'text-slate-600'}`}>
                          ID: {mod.mod_id}
                        </div>
                      </div>
                    </div>

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

              {/* Disabled Dependency Warning Card */}
              {missingActiveDependenciesMap[selectedMod.mod_id] && missingActiveDependenciesMap[selectedMod.mod_id].length > 0 && (
                <div className="p-3 bg-rose-950/60 border-2 border-rose-500/80 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-rose-300">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>Missing Base Library Warning</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    This mod is currently active, but required library{' '}
                    <b className="text-rose-300">[{missingActiveDependenciesMap[selectedMod.mod_id][0].name}]</b> is DISABLED!
                  </p>
                  <button
                    onClick={() => handleToggleSingleMod(missingActiveDependenciesMap[selectedMod.mod_id][0].mod_id)}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition cursor-pointer shadow"
                  >
                    <Check className="w-4 h-4" />
                    <span>1-Click Enable Required Library: [{missingActiveDependenciesMap[selectedMod.mod_id][0].name}]</span>
                  </button>
                </div>
              )}

              {/* Active Incompatibility Warning Card in Inspector */}
              {activeConflictsMap[selectedMod.mod_id] && activeConflictsMap[selectedMod.mod_id].length > 0 && (
                <div className="p-3 bg-amber-950/60 border-2 border-amber-500/80 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-300">
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Incompatibility Warning Detected</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    This mod is currently active alongside mutually exclusive sub-mod:{' '}
                    <b className="text-amber-300">[{activeConflictsMap[selectedMod.mod_id][0].conflictingModName}]</b>.
                  </p>
                  <button
                    onClick={() => handleToggleSingleMod(activeConflictsMap[selectedMod.mod_id][0].conflictingModId)}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/50 rounded-lg text-xs font-bold transition cursor-pointer"
                  >
                    <span>Disable Conflicting Sibling Mod</span>
                  </button>
                </div>
              )}

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
                <div className="p-3 bg-slate-950 rounded-lg text-xs text-slate-300 leading-relaxed font-sans border border-slate-800 max-h-48 overflow-y-auto select-text whitespace-pre-wrap">
                  {selectedMod.description || 'No description provided in mod.info manifest.'}
                </div>
              </div>

              {/* Clickable Dependencies (Sanitized matching against installed mods) */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Required Dependencies (<code className="text-emerald-400">require=</code>)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {selectedMod.dependencies && selectedMod.dependencies.length > 0 ? (
                    selectedMod.dependencies.map((reqRaw, rIdx) => {
                      const matchedInstalledMod = findInstalledDependency(reqRaw);
                      const cleanReqId = normalizeModId(reqRaw);
                      const isDepDisabled = matchedInstalledMod && !matchedInstalledMod.enabled;

                      return (
                        <button
                          key={rIdx}
                          onClick={() => handleJumpToDependency(reqRaw)}
                          className={`px-2.5 py-1 text-xs font-mono rounded-md border font-medium transition cursor-pointer flex items-center gap-1 ${
                            isDepDisabled
                              ? 'bg-rose-950/80 border-rose-700 text-rose-300 hover:border-rose-500 font-bold'
                              : matchedInstalledMod
                              ? 'bg-slate-950 hover:bg-slate-800 border-cyan-800 text-cyan-300 hover:border-cyan-500'
                              : 'bg-red-950/40 hover:bg-red-900/60 border-red-800 text-red-400 hover:text-red-300'
                          }`}
                          title={
                            isDepDisabled
                              ? `⚠️ DISABLED: [${matchedInstalledMod.name}] - Click to jump & enable!`
                              : matchedInstalledMod
                              ? `Installed: [${matchedInstalledMod.name}] - Click to highlight & scroll`
                              : 'Missing dependency! Click to search on Steam Workshop'
                          }
                        >
                          {isDepDisabled ? (
                            <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                          ) : !matchedInstalledMod ? (
                            <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                          ) : null}
                          <span>{cleanReqId}</span>
                          {matchedInstalledMod ? (
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

              {/* NEW SECTION: Reverse Dependents (Mods that require this library) with working jump & scroll */}
              <div className="space-y-1 border-t border-slate-800 pt-3">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-purple-400">
                    <Link2 className="w-3.5 h-3.5" />
                    Dependents (Mods requiring this library) ({reverseDependents.length})
                  </span>
                </label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {reverseDependents.length > 0 ? (
                    reverseDependents.map((depMod) => (
                      <button
                        key={depMod.mod_id}
                        onClick={() => handleJumpToMod(depMod.mod_id)}
                        className={`px-2.5 py-1 text-xs font-mono rounded-md border transition cursor-pointer flex items-center gap-1 ${
                          depMod.enabled
                            ? 'bg-purple-950/60 border-purple-700 text-purple-200 hover:border-purple-400 font-bold shadow'
                            : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
                        }`}
                        title={`Click to jump, highlight & scroll to [${depMod.name}] (${depMod.enabled ? 'ACTIVE' : 'DISABLED'})`}
                      >
                        <span className={`w-2 h-2 rounded-full ${depMod.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        <span>{depMod.name}</span>
                        <span className="text-[9px] text-purple-400 font-bold">↗</span>
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500 italic">No installed mods require this library</span>
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
