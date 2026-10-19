import React, { useState, useRef, useMemo } from 'react';
import { ModInfo, HealthIssue, CatalogModSummary, AppInstance, ModErrorStat } from '../../types';
import { sourceOf } from '../common/SourceBadge';
import { MenuItem, useContextMenu } from '../common/ContextMenu';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService } from '../../services/tauri';
import { findInstalledDependencyInMods, normalizeModId } from './modLookup';
import { ModPresets } from './ModPresets';
import { ModListHistory } from './ModListHistory';
import { ModInspector } from './ModInspector';
import { ModRowBody } from './ModRow';
import { useKeepActions } from '../common/keep';
import { KeptVersions } from './KeptVersions';
import { LoadRules } from './LoadRules';
import { draftRegistry, knownIssues, proposeUrl } from '../../utils/communityIndex';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Archive,
  ArrowDownCircle,
  ArrowUpCircle,
  BookOpen,
  Check,
  CheckSquare,
  ChevronsDown,
  ChevronsUp,
  Copy,
  EyeOff,
  FolderOpen,
  FolderX,
  Globe,
  HelpCircle,
  ListOrdered,
  MapPin,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Wand2,
  X,
} from 'lucide-react';

interface LoadOrderModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  onReorder: (newOrder: ModInfo[]) => void;
  onToggleMod: (modId: string) => void;
  onRefreshMods: () => void;
  onGoToSettings: () => void;
  onLoadMockups: (mockMods: ModInfo[]) => void;
  onApplyPresetLoadOrder?: (presetLoadOrder: string[], activeIds: string[]) => void;
  openedPackageFolder?: string | null;
  /** Issues from the shared health check (useModHealth); null until the first check. */
  healthIssues?: HealthIssue[] | null;
  /** Installed mods as the game sees them (source, origin), from useModHealth. */
  catalogById?: Map<string, CatalogModSummary>;
  /** What each mod did to the last session's log, by the name the game writes. */
  errorStats?: Map<string, ModErrorStat>;
  /** Mod id -> how long its files took to load last session, in ms (the game's DebugLog). */
  loadTimes?: Map<string, number>;
  /** The game build installed now, named in a rule proposed to the community. */
  installedBuild?: string | null;
  /** Opens this Workshop item's page in Browse Mods (where the Workshop link lives). */
  onOpenInBrowser?: (workshopId: string) => void;
  /** Opens the Mod Merger on this conflicting file (a row chip's fix). */
  onOpenMerger?: (relativePath: string) => void;
  /** Opens Mod Health, for a fix a row cannot apply by itself. */
  onGoToHealth?: (issue?: HealthIssue) => void;
  /** The player's load-order rules changed: the health check reads them again. */
  onRulesChanged?: () => void;
  /** Every saved profile, so the list can show which of them a mod belongs to. */
  profiles?: AppInstance[];
  activeProfileId?: string | null;
  /** After "Add to a profile…": the profiles are read again. */
  onProfilesChanged?: () => void;
}

const PACKAGE_COLOR_PALETTES = [
  { border: 'border-l-cyan-400', bgMatch: 'bg-cyan-950/25 hover:bg-cyan-950/40 border-cyan-900/40', badge: 'bg-cyan-950/90 text-cyan-300 border-cyan-700/60' },
  { border: 'border-l-emerald-400', bgMatch: 'bg-emerald-950/25 hover:bg-emerald-950/40 border-emerald-900/40', badge: 'bg-emerald-950/90 text-emerald-300 border-emerald-700/60' },
  { border: 'border-l-amber-400', bgMatch: 'bg-amber-950/25 hover:bg-amber-950/40 border-amber-900/40', badge: 'bg-amber-950/90 text-amber-300 border-amber-700/60' },
  { border: 'border-l-purple-400', bgMatch: 'bg-purple-950/25 hover:bg-purple-950/40 border-purple-900/40', badge: 'bg-purple-950/90 text-purple-300 border-purple-700/60' },
  { border: 'border-l-pink-400', bgMatch: 'bg-pink-950/25 hover:bg-pink-950/40 border-pink-900/40', badge: 'bg-pink-950/90 text-pink-300 border-pink-700/60' },
  { border: 'border-l-indigo-400', bgMatch: 'bg-indigo-950/25 hover:bg-indigo-950/40 border-indigo-900/40', badge: 'bg-indigo-950/90 text-indigo-300 border-indigo-700/60' },
  { border: 'border-l-rose-400', bgMatch: 'bg-rose-950/25 hover:bg-rose-950/40 border-rose-900/40', badge: 'bg-rose-950/90 text-rose-300 border-rose-700/60' },
  { border: 'border-l-teal-400', bgMatch: 'bg-teal-950/25 hover:bg-teal-950/40 border-teal-900/40', badge: 'bg-teal-950/90 text-teal-300 border-teal-700/60' },
];

/** The questions worth asking of a long mod list. */
const MOD_FILTERS = ['all', 'enabled', 'disabled', 'problems', 'maps', 'libraries', 'unloadable', 'updated'] as const;

type ModFilterId = (typeof MOD_FILTERS)[number];


export const LoadOrderModule: React.FC<LoadOrderModuleProps> = ({
  paths,
  mods,
  onReorder,
  onToggleMod,
  onRefreshMods,
  onGoToSettings,
  onApplyPresetLoadOrder,
  openedPackageFolder,
  healthIssues = null,
  catalogById,
  errorStats,
  loadTimes,
  installedBuild = null,
  onOpenInBrowser,
  onOpenMerger,
  onGoToHealth,
  onRulesChanged,
  profiles = [],
  activeProfileId = null,
  onProfilesChanged,
}) => {
  const showContextMenu = useContextMenu();
  const [selectedModId, setSelectedModId] = useState<string | null>(mods.length > 0 ? mods[0].mod_id : null);
  const [highlightedModId, setHighlightedModId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const { t } = useTranslation();
  const [assigningModId, setAssigningModId] = useState<string | null>(null);
  const [targetPosInput, setTargetPosInput] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [showAutoSortNotice, setShowAutoSortNotice] = useState<boolean>(false);
  const [dontShowNoticeChecked, setDontShowNoticeChecked] = useState<boolean>(false);


  const modRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** The mod whose kept versions are open in the dialog. */
  const [keptVersionsOf, setKeptVersionsOf] = useState<ModInfo | null>(null);
  /** The mod whose load-order rules are open in the dialog. */
  const [rulesOf, setRulesOf] = useState<ModInfo | null>(null);

  const triggerReorder = (newOrder: ModInfo[]) => {
    onReorder(newOrder);
  };

  const triggerToggleMod = (modId: string) => {
    onToggleMod(modId);
  };

  /** The green note at the top right, gone again after a moment. */
  const showToast = (message: string, ms = 3000) => {
    setSaveToast(message);
    setTimeout(() => setSaveToast(null), ms);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefreshMods();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const selectedMod = mods.find((m) => m.mod_id === selectedModId) || (mods.length > 0 ? mods[0] : null);

  const { multiModPackageMap, workshopColorMap, uniqueWorkshopIds } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of mods) {
      if (m.workshop_id && m.workshop_id !== '9999999999' && !m.mod_id.startsWith('Z_PZModStudio_')) {
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

  // Dependency, order and compatibility problems come from the Rust health check (game-exact
  // rules: case-sensitive ids, require/loadModAfter/loadModBefore/incompatible from mod.info).
  // The maps below keep the shapes this screen's badges and buttons already use.
  // Position of each mod in the full list (rows use it instead of scanning the list each time).
  const modIndexById = useMemo(() => new Map(mods.map((m, idx) => [m.mod_id, idx])), [mods]);

  /** The health check's issues by mod, for the row chips; an incompatible pair is on both rows. */
  const issuesByMod = useMemo(() => {
    const map = new Map<string, HealthIssue[]>();
    const add = (id: string, issue: HealthIssue) => {
      const list = map.get(id) ?? [];
      list.push(issue);
      map.set(id, list);
    };
    for (const issue of healthIssues ?? []) {
      if (issue.mod_id) add(issue.mod_id, issue);
      if (issue.code === 'incompatible') issue.related.forEach((other) => add(other, issue));
    }
    return map;
  }, [healthIssues]);

  const {
    activeConflictsMap,
    missingActiveDependenciesMap,
    missingUninstalledDependenciesMap,
    loadOrderViolationsMap,
  } = useMemo(() => {
    const conflicts: Record<string, { conflictingModId: string; conflictingModName: string }[]> = {};
    const disabledDeps: Record<string, ModInfo[]> = {};
    const uninstalledDeps: Record<string, string[]> = {};
    const violations: Record<string, { requiredModId: string; requiredModName: string; requiredModIndex: number }[]> = {};
    const byId = new Map(mods.map((m, idx) => [m.mod_id, { mod: m, idx }]));
    const nameOf = (id: string) => byId.get(id)?.mod.name ?? id;
    const addViolation = (modId: string, requiredId: string) => {
      const list = (violations[modId] ??= []);
      if (!list.some((v) => v.requiredModId === requiredId)) {
        list.push({ requiredModId: requiredId, requiredModName: nameOf(requiredId), requiredModIndex: byId.get(requiredId)?.idx ?? -1 });
      }
    };

    for (const issue of healthIssues ?? []) {
      const modId = issue.mod_id;
      if (!modId) continue;
      switch (issue.code) {
        case 'incompatible':
          for (const other of issue.related) {
            (conflicts[modId] ??= []).push({ conflictingModId: other, conflictingModName: nameOf(other) });
            (conflicts[other] ??= []).push({ conflictingModId: modId, conflictingModName: nameOf(modId) });
          }
          break;
        case 'dependency_not_enabled':
          disabledDeps[modId] = issue.related.map((id) => byId.get(id)?.mod).filter((m): m is ModInfo => !!m);
          break;
        case 'missing_dependency':
          (uninstalledDeps[modId] ??= []).push(...issue.related);
          break;
        case 'dependency_after':
        case 'load_after_order':
          issue.related.forEach((req) => addViolation(modId, req));
          break;
        case 'load_before_order':
          // modId must load before the related mod: the related mod is the one out of place.
          issue.related.forEach((other) => addViolation(other, modId));
          break;
      }
    }
    return {
      activeConflictsMap: conflicts,
      missingActiveDependenciesMap: disabledDeps,
      missingUninstalledDependenciesMap: uninstalledDeps,
      loadOrderViolationsMap: violations,
    };
  }, [healthIssues, mods]);

  const [orderViolationCycleIdx, setOrderViolationCycleIdx] = useState(0);
  const [conflictCycleIdx, setConflictCycleIdx] = useState(0);
  const [missingDepCycleIdx, setMissingDepCycleIdx] = useState(0);
  const [missingUninstalledCycleIdx, setMissingUninstalledCycleIdx] = useState(0);

  const orderViolationModIds = useMemo(() => Object.keys(loadOrderViolationsMap), [loadOrderViolationsMap]);
  const conflictModIds = useMemo(() => Object.keys(activeConflictsMap), [activeConflictsMap]);
  const missingDepModIds = useMemo(() => Object.keys(missingActiveDependenciesMap), [missingActiveDependenciesMap]);
  const missingUninstalledModIds = useMemo(() => Object.keys(missingUninstalledDependenciesMap), [missingUninstalledDependenciesMap]);

  const handleCycleOrderViolations = () => {
    if (orderViolationModIds.length === 0) return;
    const nextIdx = (orderViolationCycleIdx + 1) % orderViolationModIds.length;
    setOrderViolationCycleIdx(nextIdx);
    handleJumpToMod(orderViolationModIds[nextIdx]);
  };

  const handleCycleConflicts = () => {
    if (conflictModIds.length === 0) return;
    const nextIdx = (conflictCycleIdx + 1) % conflictModIds.length;
    setConflictCycleIdx(nextIdx);
    handleJumpToMod(conflictModIds[nextIdx]);
  };

  const handleCycleMissingDeps = () => {
    if (missingDepModIds.length === 0) return;
    const nextIdx = (missingDepCycleIdx + 1) % missingDepModIds.length;
    setMissingDepCycleIdx(nextIdx);
    handleJumpToMod(missingDepModIds[nextIdx]);
  };

  const handleCycleMissingUninstalled = () => {
    if (missingUninstalledModIds.length === 0) return;
    const nextIdx = (missingUninstalledCycleIdx + 1) % missingUninstalledModIds.length;
    setMissingUninstalledCycleIdx(nextIdx);
    handleJumpToMod(missingUninstalledModIds[nextIdx]);
  };

  const handleFixLoadOrderViolation = (modId: string, requiredModId: string) => {
    const currentIdx = mods.findIndex((m) => m.mod_id === modId);
    const reqMod = findInstalledDependencyInMods(requiredModId, mods);
    if (currentIdx === -1 || !reqMod) return;

    const requiredIdx = mods.findIndex((m) => m.mod_id === reqMod.mod_id);
    if (requiredIdx === -1) return;

    // Move requiredModId (library/framework) BEFORE modId so it loads first!
    const newOrder = [...mods];
    const [movedReq] = newOrder.splice(requiredIdx, 1);
    const newCurrentIdx = newOrder.findIndex((m) => m.mod_id === modId);
    newOrder.splice(newCurrentIdx, 0, movedReq);

    triggerReorder(newOrder);
    handleJumpToMod(modId);
  };

  const [sourceFilter, setSourceFilter] = useState<string>('all');
  /** What you are looking for in a list of a hundred mods. See MOD_FILTERS. */
  const [stateFilter, setStateFilter] = useState<ModFilterId>('all');
  /**
   * With a profile active the list is about that profile, so the rest of the library is out of
   * the way until asked for. "Show everything" then labels each mod with the profiles using it,
   * which is how you add one to the profile you are in.
   */
  const [showEveryMod, setShowEveryMod] = useState<boolean>(false);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;
  const keep = useKeepActions(paths, profiles, onProfilesChanged, showToast);
  const inActiveProfile = useMemo(
    () => new Set(activeProfile ? activeProfile.active_mod_ids : []),
    [activeProfile]
  );
  /** mod id -> the profiles that have it switched on. */
  const profilesByMod = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of profiles) {
      for (const id of p.active_mod_ids) {
        map.set(id, [...(map.get(id) ?? []), p.name]);
      }
    }
    return map;
  }, [profiles]);
  /**
   * Whether a mod belongs in each filter. The answers come from what the game and the health
   * check already told us, so a filter never claims more than the Studio knows.
   */
  const matchesFilter = (m: ModInfo, id: ModFilterId): boolean => {
    const catalog = catalogById?.get(m.mod_id);
    switch (id) {
      case 'all':
        return true;
      case 'enabled':
        return m.enabled;
      case 'disabled':
        return !m.enabled;
      case 'problems':
        return Boolean(
          missingActiveDependenciesMap[m.mod_id] ||
            missingUninstalledDependenciesMap[m.mod_id] ||
            loadOrderViolationsMap[m.mod_id] ||
            activeConflictsMap[m.mod_id]
        );
      case 'maps':
        return Boolean(m.is_map_mod);
      case 'libraries':
        return Boolean(m.is_library);
      case 'unloadable':
        return (
          m.loadable_on_installed_build === false ||
          (catalog ? catalog.loadability.status !== 'loadable' : false)
        );
      case 'updated':
        return Boolean(
          catalog?.workshop_state?.updated_since_last_play || catalog?.workshop_state?.update_pending
        );
    }
  };

  /** How many mods each filter would show, so an empty filter is visibly empty before you click. */
  const filterCounts = useMemo(() => {
    const counts = {} as Record<ModFilterId, number>;
    for (const id of MOD_FILTERS) counts[id] = 0;
    for (const m of mods) {
      for (const id of MOD_FILTERS) if (matchesFilter(m, id)) counts[id] += 1;
    }
    return counts;
  }, [
    mods,
    catalogById,
    missingActiveDependenciesMap,
    missingUninstalledDependenciesMap,
    loadOrderViolationsMap,
    activeConflictsMap,
  ]);

  const filteredMods = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return mods.filter((m) => {
      if (activeProfile && !showEveryMod && !inActiveProfile.has(m.mod_id) && !m.enabled) return false;
      if (sourceFilter !== 'all' && sourceOf(m.mod_id, catalogById?.get(m.mod_id)).kind !== sourceFilter) return false;
      if (!matchesFilter(m, stateFilter)) return false;
      if (!query) return true;
      return (
        m.name.toLowerCase().includes(query) ||
        m.mod_id.toLowerCase().includes(query) ||
        (m.workshop_id && m.workshop_id.toLowerCase().includes(query))
      );
    });
  }, [
    mods,
    searchQuery,
    sourceFilter,
    stateFilter,
    catalogById,
    activeProfile,
    showEveryMod,
    inActiveProfile,
    filterCounts,
  ]);

  /**
   * Dragging a mod to where it should load. The position is read from the full list, not the
   * filtered one, so a mod dropped between two visible rows lands between those two mods even
   * when the rows in between are hidden.
   */
  const [dragModId, setDragModId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ modId: string; after: boolean } | null>(null);

  const handleDropOnMod = (targetModId: string, after: boolean) => {
    const dragged = dragModId;
    setDragModId(null);
    setDropTarget(null);
    if (!dragged || dragged === targetModId) return;

    const from = mods.findIndex((m) => m.mod_id === dragged);
    if (from === -1) return;
    const next = [...mods];
    const [moved] = next.splice(from, 1);
    const at = next.findIndex((m) => m.mod_id === targetModId);
    if (at === -1) return;
    next.splice(after ? at + 1 : at, 0, moved);
    triggerReorder(next);
    setHighlightedModId(dragged);
    setTimeout(() => setHighlightedModId(null), 1200);
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...mods];
    const temp = newOrder[index];
    newOrder[index] = newOrder[index - 1];
    newOrder[index - 1] = temp;
    triggerReorder(newOrder);
  };

  const moveDown = (index: number) => {
    if (index >= mods.length - 1) return;
    const newOrder = [...mods];
    const temp = newOrder[index];
    newOrder[index] = newOrder[index + 1];
    newOrder[index + 1] = temp;
    triggerReorder(newOrder);
  };

  const moveToTop = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...mods];
    const item = newOrder.splice(index, 1)[0];
    newOrder.unshift(item);
    triggerReorder(newOrder);
  };

  const moveToBottom = (index: number) => {
    if (index >= mods.length - 1) return;
    const newOrder = [...mods];
    const item = newOrder.splice(index, 1)[0];
    newOrder.push(item);
    triggerReorder(newOrder);
  };

  /** What right-clicking a mod offers: the things people reach for most. */
  const modRowMenu = (mod: ModInfo, index: number): MenuItem[] => [
    {
      label: mod.enabled ? 'Switch off' : 'Switch on',
      icon: mod.enabled ? EyeOff : Check,
      onSelect: () => onToggleMod(mod.mod_id),
    },
    { label: t('modList.menu.toTop'), icon: ChevronsUp, onSelect: () => moveToTop(index), disabled: index === 0,
      disabledReason: t('modList.menu.alreadyFirst') },
    { label: t('modList.menu.toBottom'), icon: ChevronsDown, onSelect: () => moveToBottom(index),
      disabled: index === mods.length - 1, disabledReason: t('modList.menu.alreadyLast') },
    {
      label: t('modList.menu.openBrowser'),
      icon: BookOpen,
      separatorBefore: true,
      onSelect: () => mod.workshop_id && onOpenInBrowser?.(mod.workshop_id),
      disabled: !mod.workshop_id || !onOpenInBrowser,
      disabledReason: t('modList.menu.notWorkshop'),
    },
    {
      label: t('modList.menu.openFolder'),
      icon: FolderOpen,
      onSelect: () => TauriService.openModFolder(paths, catalogById?.get(mod.mod_id)?.root_dir ?? ''),
      disabled: !catalogById?.get(mod.mod_id)?.root_dir,
      disabledReason: t('modList.menu.noFolder'),
    },
    {
      label: t('modList.menu.rules'),
      icon: ListOrdered,
      separatorBefore: true,
      onSelect: () => setRulesOf(mod),
    },
    {
      label: t('modList.menu.keepVersion'),
      icon: Archive,
      separatorBefore: true,
      onSelect: () => {
        void TauriService.keepModVersion(paths, mod.mod_id).then((kept) =>
          showToast(t('modList.menu.kept', { name: kept.mod_name, when: kept.kept_at }))
        );
      },
      disabled: !catalogById?.get(mod.mod_id)?.root_dir,
      disabledReason: t('modList.menu.noFolder'),
    },
    {
      label: t('modList.menu.keptVersions'),
      icon: Archive,
      onSelect: () => setKeptVersionsOf(mod),
    },
    ...(mod.mod_id.startsWith('Z_PZModStudio_') ? [] : keep.menuItems({ workshop_id: mod.workshop_id ?? null, mod_id: mod.workshop_id ? null : mod.mod_id, name: mod.name, installedModIds: [mod.mod_id] })),
    {
      label: t('modList.menu.share'),
      icon: Globe,
      onSelect: () => {
        void (async () => {
          const registry = draftRegistry(mod, catalogById?.get(mod.mod_id), installedBuild, knownIssues(catalogById?.get(mod.mod_id), errorStats?.get(mod.name), installedBuild));
          if (await TauriService.githubTokenStatus()) {
            // With a token: the Studio forks, writes the file on a branch and opens the pull request.
            showToast(t('modList.menu.openingPr', { name: mod.name }), 20000);
            try {
              const r = await TauriService.proposeRegistry(mod.mod_id, JSON.stringify(registry, null, 2));
              showToast(t('modList.menu.prOpened', { url: r.pr_url }), 10000);
              TauriService.openExternalUrl(r.pr_url);
            } catch {
              // Already shown by TauriService.
            }
            return;
          }
          // Without one: GitHub's new-file page, with the registry the Studio can fill in already
          // there; the person adds what they tested and GitHub opens the pull request. Nothing is sent from here.
          void navigator.clipboard.writeText(JSON.stringify(registry, null, 2));
          showToast(t('modList.menu.openingGithub', { name: mod.name }), 8000);
          TauriService.openExternalUrl(proposeUrl(registry));
        })();
      },
      disabled: mod.mod_id.startsWith('Z_PZModStudio_') || knownIssues(catalogById?.get(mod.mod_id), errorStats?.get(mod.name), installedBuild).length === 0,
      disabledReason: mod.mod_id.startsWith('Z_PZModStudio_') ? t('modList.menu.notCommunity') : t('modList.menu.nothingSeen'),
      title: t('modList.menu.shareTitle', { facts: knownIssues(catalogById?.get(mod.mod_id), errorStats?.get(mod.name), installedBuild).map((f) => f.title.toLowerCase()).join('; ') }),
    },
    {
      label: t('modList.menu.copyId'),
      icon: Copy,
      separatorBefore: true,
      onSelect: () => navigator.clipboard.writeText(mod.mod_id),
    },
  ];

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

    triggerReorder(newOrder);
    setAssigningModId(null);
    setTargetPosInput('');
  };

  const handleToggleSingleMod = (modId: string) => {
    if (openedPackageFolder && modId === openedPackageFolder) {
      return;
    }

    const targetMod = mods.find((m) => m.mod_id === modId);
    if (!targetMod) return;

    const targetWillBeEnabled = !targetMod.enabled;

    if (targetWillBeEnabled && targetMod.workshop_id) {
      const updated = mods.map((m) => {
        if (m.mod_id === modId) {
          return { ...m, enabled: true };
        }

        // Variants in the same Workshop item that declare each other incompatible (exact ids,
        // backslashes removed, like the game) cannot run together: switch the other one off.
        if (m.enabled && m.workshop_id === targetMod.workshop_id && m.mod_id !== modId) {
          const clean = (ids?: string[]) => (ids ?? []).map((i) => i.replace(/\\/g, '').trim());
          if (clean(targetMod.incompatible).includes(m.mod_id) || clean(m.incompatible).includes(targetMod.mod_id)) {
            return { ...m, enabled: false };
          }
        }
        return m;
      });
      triggerReorder(updated);
    } else {
      triggerToggleMod(modId);
    }
  };

  const handleEnableAllWithoutDiscrimination = (enable: boolean) => {
    const updated = mods.map((m) => {
      if (enable && openedPackageFolder && m.mod_id === openedPackageFolder) {
        return { ...m, enabled: false };
      }
      return { ...m, enabled: enable };
    });
    triggerReorder(updated);
  };

  // Game-exact sort in Rust: moves only what require / loadModAfter / loadModBefore force and keeps
  // the user's order everywhere else (Studio packages last). The previous order can be restored.
  const [orderBeforeSort, setOrderBeforeSort] = useState<ModInfo[] | null>(null);
  const [lastSortMoved, setLastSortMoved] = useState<number>(0);
  const handleAutoSortDependencies = async () => {
    let result;
    try {
      result = await TauriService.sortLoadOrder(paths, mods.map((m) => m.mod_id));
    } catch {
      return; // already shown by TauriService
    }
    const byId = new Map(mods.map((m) => [m.mod_id, m]));
    const sorted = result.order.map((id) => byId.get(id)).filter((m): m is ModInfo => !!m);
    if (sorted.length !== mods.length) return; // list changed meanwhile; do nothing
    setLastSortMoved(result.moved.length);
    if (result.moved.length > 0) {
      setOrderBeforeSort(mods);
      triggerReorder(sorted);
    }
    const isSilenced = localStorage.getItem('pz_hide_autosort_notice') === 'true';
    if (!isSilenced) {
      setShowAutoSortNotice(true);
    }
  };

  const handleUndoSort = () => {
    if (orderBeforeSort) {
      triggerReorder(orderBeforeSort);
      setOrderBeforeSort(null);
    }
  };

  const findInstalledDependency = (reqRaw: string): ModInfo | undefined => {
    return findInstalledDependencyInMods(reqRaw, mods);
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
            <h3 className="text-base font-bold text-slate-100">Point the Studio at your game first</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Set your Project Zomboid folder and your Zomboid folder in App Settings, and your mods appear here.
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
              No mods were found in your Workshop folder or in <code className="text-emerald-400 font-mono">Zomboid/mods</code>.
              Subscribe to some on the Workshop, or install one from Browse Mods, then press Refresh.
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
            {t('modList.title')} (<code className="text-emerald-400">Zomboid/mods/default.txt</code>)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            <span>{t('modList.subscriptions')} <b className="text-cyan-400">{t('modList.items', { count: uniqueWorkshopIds })}</b></span>

            <span>•</span>
            <span>{t('modList.totalSubmods')} <b className="text-slate-200">{mods.length}</b></span>
            <span>•</span>
            <span>{t('modList.active')} <b className="text-emerald-400">{activeCount}</b></span>
            {/* Grave 1: Dependencies missing (Red) */}
            {missingUninstalledModIds.length > 0 && (
              <>
                <span>•</span>
                <button
                  onClick={handleCycleMissingUninstalled}
                  className="flex items-center gap-1.5 text-red-400 font-bold bg-red-500/10 hover:bg-red-500/20 px-2 py-0.5 rounded border border-red-500/40 transition cursor-pointer shadow-sm group text-[11px]"
                  title={t('modList.cycleMissing')}
                >
                  <AlertTriangle className="w-3 h-3 text-red-400 group-hover:scale-110 transition shrink-0" />
                  <span>{t('modList.missing')}</span>
                  <AlertTriangle className="w-3 h-3 text-red-400 group-hover:scale-110 transition shrink-0" />
                  <span className="text-[10px] text-red-300 font-mono bg-red-950/80 px-1 py-0.5 rounded border border-red-700/50 ml-0.5">
                    {missingUninstalledCycleIdx + 1}/{missingUninstalledModIds.length} ⚙️
                  </span>
                </button>
              </>
            )}

            {/* Grave 2: Dependencies off (Red) */}
            {missingDepModIds.length > 0 && (
              <>
                <span>•</span>
                <button
                  onClick={handleCycleMissingDeps}
                  className="flex items-center gap-1.5 text-red-400 font-bold bg-red-500/10 hover:bg-red-500/20 px-2 py-0.5 rounded border border-red-500/40 transition cursor-pointer shadow-sm group text-[11px]"
                  title={t('modList.cycleOff')}
                >
                  <AlertTriangle className="w-3 h-3 text-red-400 group-hover:scale-110 transition shrink-0" />
                  <span>{t('modList.depsOff')}</span>
                  <AlertTriangle className="w-3 h-3 text-red-400 group-hover:scale-110 transition shrink-0" />
                  <span className="text-[10px] text-red-300 font-mono bg-red-950/80 px-1 py-0.5 rounded border border-red-700/50 ml-0.5">
                    {missingDepCycleIdx + 1}/{missingDepModIds.length} ⚙️
                  </span>
                </button>
              </>
            )}

            {/* Medio 1: Incompatibility (Yellow) */}
            {conflictModIds.length > 0 && (
              <>
                <span>•</span>
                <button
                  onClick={handleCycleConflicts}
                  className="flex items-center gap-1.5 text-amber-400 font-bold bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/40 transition cursor-pointer shadow-sm group text-[11px]"
                  title={t('modList.cycleIncompatible')}
                >
                  <AlertTriangle className="w-3 h-3 text-amber-400 group-hover:scale-110 transition shrink-0" />
                  <span>{t('modList.incompatibility')}</span>
                  <AlertTriangle className="w-3 h-3 text-amber-400 group-hover:scale-110 transition shrink-0" />
                  <span className="text-[10px] text-amber-300 font-mono bg-amber-950/80 px-1 py-0.5 rounded border border-amber-700/50 ml-0.5">
                    {conflictCycleIdx + 1}/{conflictModIds.length} ⚙️
                  </span>
                </button>
              </>
            )}

            {/* Medio 2: List Order (Yellow) */}
            {orderViolationModIds.length > 0 && (
              <>
                <span>•</span>
                <button
                  onClick={handleCycleOrderViolations}
                  className="flex items-center gap-1.5 text-amber-400 font-bold bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/40 transition cursor-pointer shadow-sm group text-[11px]"
                  title={t('modList.cycleOrder')}
                >
                  <AlertTriangle className="w-3 h-3 text-amber-400 group-hover:scale-110 transition shrink-0" />
                  <span>{t('modList.listOrder')}</span>
                  <AlertTriangle className="w-3 h-3 text-amber-400 group-hover:scale-110 transition shrink-0" />
                  <span className="text-[10px] text-amber-300 font-mono bg-amber-950/80 px-1 py-0.5 rounded border border-amber-700/50 ml-0.5">
                    {orderViolationCycleIdx + 1}/{orderViolationModIds.length} ⚙️
                  </span>
                </button>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ModPresets
            paths={paths}
            mods={mods}
            onApplyPresetLoadOrder={onApplyPresetLoadOrder}
            onReorder={triggerReorder}
            onOpenInBrowser={onOpenInBrowser}
            toast={showToast}
          />

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg text-xs font-medium transition cursor-pointer shrink-0"
            title={t('modList.refreshTitle')}
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{t('modList.refresh')}</span>
          </button>

          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 pointer-events-none" />
            <input
              type="text"
              placeholder={t('modList.searchPlaceholder')}
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

          {activeProfile && (
            <button
              type="button"
              onClick={() => setShowEveryMod((v) => !v)}
              aria-pressed={showEveryMod}
              title={showEveryMod ? t('modList.onlyProfileTitle', { name: activeProfile.name }) : t('modList.everythingTitle')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition ${
                showEveryMod
                  ? 'bg-slate-800 text-slate-200 border-slate-700'
                  : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/70'
              }`}
            >
              {showEveryMod ? t('modList.showingEverything') : t('modList.onlyProfile', { name: activeProfile.name })}
            </button>
          )}

          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as ModFilterId)}
            aria-label={t('modList.filterLabel')}
            title={t('modList.filterTitle')}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 cursor-pointer"
          >
            {MOD_FILTERS.map((id) => (
              <option key={id} value={id} title={t(`modList.filters.${id}.hint`)}>
                {t(`modList.filters.${id}.label`)} ({filterCounts[id] ?? 0})
              </option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label={t('modList.sourceLabel')}
            title={t('modList.sourceTitle')}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 cursor-pointer"
          >
            {(['all', 'steam', 'nexus', 'manual', 'local', 'studio', 'compat'] as const).map((id) => (
              <option key={id} value={id}>{t(`modList.sources.${id}`)}</option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
            <button
              onClick={() => handleEnableAllWithoutDiscrimination(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded hover:bg-slate-800 text-emerald-400 font-medium transition cursor-pointer"
              title={t('modList.enableAllTitle')}
            >
              <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t('modList.enableAll')}</span>
            </button>

            <button
              onClick={() => handleEnableAllWithoutDiscrimination(false)}
              className="flex items-center gap-1 px-2.5 py-1 rounded hover:bg-slate-800 text-slate-400 font-medium transition cursor-pointer"
              title={t('modList.disableAllTitle')}
            >
              <Square className="w-3.5 h-3.5 text-slate-500" />
              <span>{t('modList.disableAll')}</span>
            </button>
          </div>

          <ModListHistory paths={paths} mods={mods} onRefreshMods={onRefreshMods} toast={showToast} />
          <KeptVersions paths={paths} mod={keptVersionsOf} onClose={() => setKeptVersionsOf(null)} onModsChanged={onRefreshMods} toast={showToast} />
          {keep.node}
          <LoadRules paths={paths} mod={rulesOf} mods={mods} installedBuild={installedBuild} onClose={() => setRulesOf(null)} onRulesChanged={() => onRulesChanged?.()} toast={showToast} />

          <button
            onClick={handleAutoSortDependencies}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow transition cursor-pointer"
          >
            <Wand2 className="w-4 h-4" />
            {t('modList.autoSort')}
          </button>
        </div>
      </div>

      {/* Save Notification Toast */}
      {saveToast && (
        <div className="fixed top-16 right-8 bg-emerald-950/90 border border-emerald-500/80 text-emerald-200 px-4 py-2 rounded-xl text-xs font-bold shadow-2xl z-50 flex items-center gap-2 animate-fade-in">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{saveToast}</span>
        </div>
      )}

      {/* Icon Legend Bar */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2 mb-4 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-1.5 font-bold text-slate-300">
          <HelpCircle className="w-4 h-4 text-cyan-400" />
          <span>{t('modList.legend')}</span>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2" title={t('modList.mapTitle')}>
            <div className="w-5 h-5 rounded bg-slate-950 border border-slate-800 flex items-center justify-center">
              <MapPin className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <span>{t('modList.map')} (<b className="text-amber-400">{modCategoryCounts.mapCount}</b>)</span>
          </div>

          <div className="flex items-center gap-2" title={t('modList.libraryTitle')}>
            <div className="w-5 h-5 rounded bg-slate-950 border border-slate-800 flex items-center justify-center">
              <Package className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <span>{t('modList.library')} (<b className="text-purple-400">{modCategoryCounts.libCount}</b>)</span>
          </div>

          <div className="flex items-center gap-2" title={t('modList.scriptTitle')}>
            <div className="w-5 h-5 rounded bg-slate-950 border border-slate-800 flex items-center justify-center">
              <ListOrdered className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <span>{t('modList.script')} (<b className="text-cyan-400">{modCategoryCounts.scriptCount}</b>)</span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Grid: Left Column Reorderable List / Right Column Mod Inspector */}
      <div className="flex-1 grid grid-cols-12 gap-6 min-h-0">
        {/* Left Column (7 cols): Reorderable Mod List */}
        <div className="col-span-12 lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-900 text-slate-400 font-bold text-[11px] uppercase tracking-wider border-b border-slate-800 items-center">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-1 text-center">{t('modList.colActive')}</div>
            <div className="col-span-6 flex items-center gap-2 min-w-0">
              <span className="shrink-0">{t('modList.colName')}</span>
              <div className="relative flex-1 max-w-[260px] normal-case font-normal text-xs">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder={t('modList.searchList')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-cyan-500/80 rounded-lg pl-8 pr-7 py-1 text-xs text-slate-200 placeholder-slate-500 transition shadow-inner font-sans outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
                    title={t('modList.clearSearch')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="col-span-4 text-right">{t('modList.colActions')}</div>
          </div>

          <div className="bg-emerald-950/40 border-b border-emerald-800/40 px-4 py-1.5 flex items-center justify-between text-[11px] font-mono text-emerald-400">
            <span className="flex items-center gap-1.5 font-bold">
              <ArrowUpCircle className="w-3.5 h-3.5" />
              LOADS FIRST — libraries other mods build on
            </span>
            <span className="text-[10px] text-emerald-500/80">Position #1</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-1">
            {filteredMods.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                {searchQuery ? (
                  <>No mod matches "<b className="text-slate-400">{searchQuery}</b>"</>
                ) : (
                  <>
                    No mod is{' '}
                    <b className="text-slate-400">
                      {t(`modList.filters.${stateFilter}.label`).toLowerCase()}
                    </b>
                  </>
                )}
                {(stateFilter !== 'all' || sourceFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setStateFilter('all');
                      setSourceFilter('all');
                      setSearchQuery('');
                    }}
                    className="ml-2 underline text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    show everything
                  </button>
                )}
              </div>
            ) : (
              filteredMods.map((mod) => {
                // The row's colour follows the worst thing the health check found for it.
                const rowIssues = issuesByMod.get(mod.mod_id) ?? [];
                const worstIssue = rowIssues.some((i) => i.severity === 'error') ? 'error' : rowIssues.some((i) => i.severity === 'warning') ? 'warning' : null;
                const originalIndex = modIndexById.get(mod.mod_id) ?? -1;
                const isSelected = mod.mod_id === selectedModId;
                const isHighlighted = mod.mod_id === highlightedModId;
                const isAssigningThis = assigningModId === mod.mod_id;

                const isMultiPackage = (!mod.mod_id.startsWith("Z_PZModStudio_") && mod.workshop_id) ? multiModPackageMap[mod.workshop_id] : false;
                const packageColor = (!mod.mod_id.startsWith("Z_PZModStudio_") && mod.workshop_id) ? workshopColorMap[mod.workshop_id] : null;


                const isConflictPartner =
                  selectedMod &&
                  activeConflictsMap[selectedMod.mod_id] &&
                  activeConflictsMap[selectedMod.mod_id].some((c) => c.conflictingModId === mod.mod_id);

                const isSyntheticFusion = mod.mod_id.startsWith("Z_PZModStudio_") && !mod.mod_id.includes("Carrier");
                const isBridge = mod.mod_id === "Z_PZModStudio_Bridge";
                const isOpenedPackage = Boolean(isSyntheticFusion && !isBridge && mod.is_packaged === false);
                const isClosedPackage = Boolean(isSyntheticFusion && !isBridge && mod.is_packaged === true);

                const isDragging = dragModId === mod.mod_id;
                const dropEdge = dropTarget?.modId === mod.mod_id ? dropTarget.after : null;

                return (
                  <div
                    key={mod.mod_id}
                    ref={(el) => {
                      modRowRefs.current[mod.mod_id] = el;
                    }}
                    draggable={!isAssigningThis}
                    onDragStart={(e) => {
                      setDragModId(mod.mod_id);
                      e.dataTransfer.effectAllowed = 'move';
                      // Firefox refuses to start a drag without data on it.
                      e.dataTransfer.setData('text/plain', mod.mod_id);
                    }}
                    onDragEnd={() => {
                      setDragModId(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragModId || dragModId === mod.mod_id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const box = e.currentTarget.getBoundingClientRect();
                      const after = e.clientY > box.top + box.height / 2;
                      if (dropTarget?.modId !== mod.mod_id || dropTarget.after !== after) {
                        setDropTarget({ modId: mod.mod_id, after });
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const box = e.currentTarget.getBoundingClientRect();
                      handleDropOnMod(mod.mod_id, e.clientY > box.top + box.height / 2);
                    }}
                    title={isAssigningThis ? undefined : t('modList.dragTitle')}
                    onClick={() => setSelectedModId(mod.mod_id)}
                    onContextMenu={(e) => {
                      setSelectedModId(mod.mod_id);
                      showContextMenu(e, modRowMenu(mod, originalIndex));
                    }}
                    className={`grid grid-cols-12 gap-2 px-3 py-2 items-center rounded-lg text-xs cursor-pointer transition ${
                      isOpenedPackage
                        ? 'border-2 border-amber-500/80 bg-amber-950/25 shadow-md shadow-amber-950/30'
                        : worstIssue === 'error'
                        ? 'border-2 border-red-500 bg-red-950/40 shadow-md shadow-red-950/40'
                        : isConflictPartner
                        ? 'border-2 border-amber-400 bg-amber-950/90 shadow-xl shadow-amber-900/60 ring-2 ring-amber-400/50 animate-pulse'
                        : worstIssue === 'warning'
                        ? 'border-2 border-amber-500 bg-amber-950/40 shadow-md shadow-amber-950/30'
                        : isMultiPackage && packageColor
                        ? `border-l-4 ${packageColor.border}`
                        : 'border-l border-l-transparent'
                    } ${isDragging ? 'opacity-40' : ''} ${
                      dropEdge === false
                        ? 'border-t-2 border-t-emerald-400'
                        : dropEdge === true
                        ? 'border-b-2 border-b-emerald-400'
                        : ''
                    } ${
                      isHighlighted
                        ? 'bg-cyan-950/90 border-2 border-cyan-400 shadow-lg shadow-cyan-900/50 animate-pulse'
                        : isSelected
                        ? 'bg-slate-800/90 border border-emerald-500/60 shadow-lg'
                        : isMultiPackage && packageColor
                        ? packageColor.bgMatch
                        : isOpenedPackage
                        ? 'bg-amber-950/20 hover:bg-amber-950/30 border border-amber-800/60'
                        : mod.enabled
                        ? 'bg-slate-900/90 hover:bg-slate-800/80 border border-slate-800'
                        : 'bg-slate-950/40 opacity-60 hover:opacity-100 border border-slate-900/60'
                    }`}
                  >
                    <ModRowBody
                      paths={paths}
                      mod={mod}
                      originalIndex={originalIndex}
                      mods={mods}
                      isOpenedPackage={isOpenedPackage}
                      isClosedPackage={isClosedPackage}
                      isBridge={isBridge}
                      catalogById={catalogById}
                      errorStats={errorStats}
                      loadTimes={loadTimes}
                      isFavorite={keep.isFavorite({ workshop_id: mod.workshop_id ?? null, mod_id: mod.workshop_id ? null : mod.mod_id, name: mod.name, installedModIds: [mod.mod_id] })}
                      showEveryMod={showEveryMod}
                      activeProfile={activeProfile}
                      profilesByMod={profilesByMod}
                      inActiveProfile={inActiveProfile}
                      rowIssues={rowIssues}
                      isAssigningThis={isAssigningThis}
                      targetPosInput={targetPosInput}
                      setTargetPosInput={setTargetPosInput}
                      setAssigningModId={setAssigningModId}
                      handleToggleSingleMod={handleToggleSingleMod}
                      showToast={showToast}
                      triggerReorder={triggerReorder}
                      handleJumpToMod={handleJumpToMod}
                      onOpenMerger={onOpenMerger}
                      onGoToHealth={onGoToHealth}
                      moveToTop={moveToTop}
                      moveUp={moveUp}
                      moveDown={moveDown}
                      moveToBottom={moveToBottom}
                      handleAssignPosition={handleAssignPosition}
                    />
                  </div>
                );
              })
            )}
          </div>

          <div className="bg-amber-950/40 border-t border-amber-800/40 px-4 py-1.5 flex items-center justify-between text-[11px] font-mono text-amber-400">
            <span className="flex items-center gap-1.5 font-bold">
              <ArrowDownCircle className="w-3.5 h-3.5" />
              LOADS LAST — wins any file two mods share
            </span>
            <span className="text-[10px] text-amber-500/80">Position #{mods.length}</span>
          </div>
        </div>

        {/* Right Column (5 cols): the selected mod, its problems and what it needs. */}
        <ModInspector
          paths={paths}
          mod={selectedMod}
          mods={mods}
          position={selectedMod ? modIndexById.get(selectedMod.mod_id) ?? -1 : -1}
          problems={
            selectedMod
              ? {
                  orderViolation: loadOrderViolationsMap[selectedMod.mod_id]?.[0],
                  disabledDependency: missingActiveDependenciesMap[selectedMod.mod_id]?.[0],
                  incompatibility: activeConflictsMap[selectedMod.mod_id]?.[0],
                }
              : {}
          }
          packageBadgeClass={
            selectedMod?.workshop_id && multiModPackageMap[selectedMod.workshop_id]
              ? workshopColorMap[selectedMod.workshop_id]?.badge
              : undefined
          }
          onJumpToMod={handleJumpToMod}
          onJumpToDependency={handleJumpToDependency}
          onFixLoadOrder={handleFixLoadOrderViolation}
          onToggleMod={handleToggleSingleMod}
          onOpenInBrowser={onOpenInBrowser}
        />
      </div>

      {/* In-App Auto-Sort Notice Modal */}
      {showAutoSortNotice && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-emerald-500/50 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <Wand2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">{t('modList.sortDone')}</h3>
                <p className="text-xs text-slate-400">
                  {lastSortMoved === 0 ? t('modList.sortNothing') : t('modList.sortMoved', { count: lastSortMoved })}
                </p>
              </div>
            </div>

            <ul className="text-xs text-slate-300 space-y-2 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 font-sans leading-relaxed">
              <li dangerouslySetInnerHTML={{ __html: t('modList.sortRule1') }} />
              <li>{t('modList.sortRule2')}</li>
              <li className="text-amber-300">{t('modList.sortRule3')}</li>
            </ul>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dontShowNoticeChecked}
                  onChange={(e) => setDontShowNoticeChecked(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus-visible:outline-2 focus-visible:outline-emerald-400 focus-visible:outline-offset-2 w-4 h-4 cursor-pointer"
                />
                <span>{t('modList.dontShowAgain')}</span>
              </label>

              {orderBeforeSort && (
                <button
                  onClick={() => {
                    handleUndoSort();
                    setShowAutoSortNotice(false);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition cursor-pointer shrink-0"
                >
                  {t('modList.undo')}
                </button>
              )}
              <button
                onClick={() => {
                  if (dontShowNoticeChecked) {
                    localStorage.setItem('pz_hide_autosort_notice', 'true');
                  }
                  setShowAutoSortNotice(false);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow transition cursor-pointer shrink-0"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
