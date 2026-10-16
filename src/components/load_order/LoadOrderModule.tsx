import React, { useState, useRef, useMemo, useEffect } from 'react';
import { ModInfo, ModPreset, MissingModsReport, HealthIssue, CatalogModSummary, AppInstance } from '../../types';
import { SourceBadge, sourceOf } from '../common/SourceBadge';
import { MenuItem, useContextMenu } from '../common/ContextMenu';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, explainError } from '../../services/tauri';
import {
  BookOpen,
  Copy,
  EyeOff,
  FolderOpen,
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
  Layers,
  FolderX,
  ShieldCheck,
  HelpCircle,
  AlertTriangle,
  X,
  ShieldAlert,
  Link2,
  Save,
  Download,
  Upload,
  Bookmark,
  Sparkles,
  Trash2,
  Plus,
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
  /** Opens this Workshop item's page in Browse Mods (where the Workshop link lives). */
  onOpenInBrowser?: (workshopId: string) => void;
  /** Every saved profile, so the list can show which of them a mod belongs to. */
  profiles?: AppInstance[];
  activeProfileId?: string | null;
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

const normalizeModId = (id: string): string => {
  return id
    .trim()
    .toLowerCase()
    .replace(/^[\\/]+/, '')
    .replace(/[\\'"]/g, '')
    .trim();
};

const findInstalledDependencyInMods = (reqRaw: string, mods: ModInfo[]): ModInfo | undefined => {
  if (!reqRaw || !reqRaw.trim()) return undefined;
  const cleanReq = reqRaw.trim();
  const normReq = normalizeModId(cleanReq);
  const alphaReq = normReq.replace(/[^a-z0-9]/g, '');

  // 1. Pass 1: Exact match on Mod ID, Workshop ID, or exact Mod Name FIRST!
  const exactMatch = mods.find((m) => {
    const normM = normalizeModId(m.mod_id);
    const normName = normalizeModId(m.name);
    if (normM === normReq) return true;
    if (m.workshop_id && m.workshop_id.trim() === cleanReq) return true;
    if (normName === normReq) return true;
    return false;
  });
  if (exactMatch) return exactMatch;

  // 2. Pass 2: Full Alphanumeric Match (ignores punctuation/dashes/brackets)
  const alphaMatches = mods.filter((m) => {
    const alphaM = normalizeModId(m.mod_id).replace(/[^a-z0-9]/g, '');
    const alphaName = normalizeModId(m.name).replace(/[^a-z0-9]/g, '');
    return (alphaM.length > 0 && alphaM === alphaReq) || (alphaName.length > 0 && alphaName === alphaReq);
  });
  if (alphaMatches.length === 1) return alphaMatches[0];
  if (alphaMatches.length > 1) {
    const enabled = alphaMatches.find((c) => c.enabled);
    if (enabled) return enabled;
    return alphaMatches[0];
  }

  // 3. Pass 3: Prefix match (only if no exact or full alphanumeric match exists)
  const prefixMatches = mods.filter((m) => {
    const normM = normalizeModId(m.mod_id);
    return normM.startsWith(normReq + "_") || normM.startsWith(normReq + "-");
  });
  if (prefixMatches.length > 0) {
    const enabled = prefixMatches.find((c) => c.enabled);
    if (enabled) return enabled;
    return prefixMatches[0];
  }

  return undefined;
};

const renderPZRichText = (text?: string): React.ReactNode => {
  if (!text) return <span className="text-slate-500 italic">No description provided in mod.info manifest.</span>;

  let cleanText = text.replace(/<LINE>/gi, '\n');
  const parts = cleanText.split(/(<[^>]+>)/g);

  let currentSize = 'small';
  let currentColor = 'inherit';
  let currentAlign = 'left';

  const elements: React.ReactNode[] = [];

  parts.forEach((part, index) => {
    if (!part) return;

    if (part.startsWith('<') && part.endsWith('>')) {
      const tagContent = part.slice(1, -1).trim();
      const upperTag = tagContent.toUpperCase();

      if (upperTag.startsWith('SIZE:')) {
        const sizeVal = upperTag.split(':')[1].toLowerCase();
        currentSize = sizeVal;
      } else if (upperTag.startsWith('RGB:')) {
        const rgbStr = tagContent.slice(4).trim();
        const rgbVals = rgbStr.split(',').map((v) => parseFloat(v.trim()));
        if (rgbVals.length >= 3 && !isNaN(rgbVals[0])) {
          const r = rgbVals[0] <= 1.0 ? Math.round(rgbVals[0] * 255) : Math.round(rgbVals[0]);
          const g = rgbVals[1] <= 1.0 ? Math.round(rgbVals[1] * 255) : Math.round(rgbVals[1]);
          const b = rgbVals[2] <= 1.0 ? Math.round(rgbVals[2] * 255) : Math.round(rgbVals[2]);
          const a = rgbVals.length >= 4 ? rgbVals[3] : 1;
          currentColor = `rgba(${r}, ${g}, ${b}, ${a})`;
        }
      } else if (upperTag === 'LEFT') {
        currentAlign = 'left';
      } else if (upperTag === 'CENTRE' || upperTag === 'CENTER') {
        currentAlign = 'center';
      } else if (upperTag === 'RIGHT') {
        currentAlign = 'right';
      }
    } else {
      const fontSizeClass =
        currentSize === 'large'
          ? 'text-sm font-bold tracking-wide block my-1'
          : currentSize === 'medium'
          ? 'text-xs font-bold tracking-wide block my-0.5'
          : 'text-[11px] leading-relaxed';

      const lines = part.split('\n');
      lines.forEach((line, lIdx) => {
        if (line) {
          elements.push(
            <span
              key={`${index}-${lIdx}`}
              className={`${fontSizeClass} inline-block`}
              style={{ color: currentColor === 'inherit' ? undefined : currentColor, textAlign: currentAlign as any }}
            >
              {line}
            </span>
          );
        }
        if (lIdx < lines.length - 1) {
          elements.push(<br key={`${index}-br-${lIdx}`} />);
        }
      });
    }
  });

  return <div className="space-y-0.5 font-sans leading-relaxed text-slate-200 select-text whitespace-pre-wrap">{elements}</div>;
};

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
  onOpenInBrowser,
  profiles = [],
  activeProfileId = null,
}) => {
  const showContextMenu = useContextMenu();
  const [selectedModId, setSelectedModId] = useState<string | null>(mods.length > 0 ? mods[0].mod_id : null);
  const [highlightedModId, setHighlightedModId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [assigningModId, setAssigningModId] = useState<string | null>(null);
  const [targetPosInput, setTargetPosInput] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [showAutoSortNotice, setShowAutoSortNotice] = useState<boolean>(false);
  const [dontShowNoticeChecked, setDontShowNoticeChecked] = useState<boolean>(false);
  const [imageError, setImageError] = useState<boolean>(false);
  /** The selected mod's poster, read from disk as a data URL (the webview cannot open files). */
  const [posterSrc, setPosterSrc] = useState<string | null>(null);
  /** Workshop id -> the picture on its Workshop page, for the mods that ship none. */
  const [workshopPreviews, setWorkshopPreviews] = useState<Map<string, string>>(new Map());

  // Preset & Profile Management State
  const [savedPresets, setSavedPresets] = useState<ModPreset[]>(() => {
    try {
      const stored = localStorage.getItem('pz_mod_studio_saved_presets');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState<boolean>(false);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState<boolean>(false);
  const [isSavePresetModalOpen, setIsSavePresetModalOpen] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [newPresetDesc, setNewPresetDesc] = useState<string>('');
  const [importedPreset, setImportedPreset] = useState<ModPreset | null>(null);
  const [missingReport, setMissingReport] = useState<MissingModsReport | null>(null);
  const [_isExportingPreset, setIsExportingPreset] = useState<boolean>(false);

  const modRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleSaveCurrentAsPreset = () => {
    if (!newPresetName.trim()) {
      alert('Please enter a name for the preset.');
      return;
    }
    const newPreset: ModPreset = {
      id: `preset_${Date.now()}`,
      name: newPresetName.trim(),
      description: newPresetDesc.trim() || undefined,
      author: undefined,
      created_at: new Date().toISOString(),
      mods: mods.filter((m) => m.enabled).map((m) => ({
        mod_id: m.mod_id,
        name: m.name,
        workshop_id: m.workshop_id,
        enabled: true,
      })),
      // Only the mods this preset is about: the full list would hand the other player every
      // mod the exporter happens to own, plus packages that exist on no other machine.
      load_order: mods.filter((m) => m.enabled).map((m) => m.mod_id),
    };

    const updated = [newPreset, ...savedPresets.filter((p) => p.name !== newPreset.name)];
    setSavedPresets(updated);
    localStorage.setItem('pz_mod_studio_saved_presets', JSON.stringify(updated));
    setActivePresetName(newPreset.name);
    setIsSavePresetModalOpen(false);
    setNewPresetName('');
    setNewPresetDesc('');
    setSaveToast(`✨ Preset '${newPreset.name}' saved successfully.`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const handleApplyPreset = (preset: ModPreset) => {
    const activeIds = preset.mods.filter((m) => m.enabled).map((m) => m.mod_id);
    if (onApplyPresetLoadOrder) {
      onApplyPresetLoadOrder(preset.load_order, activeIds);
    } else {
      const activeSet = new Set(activeIds);
      const modMap = new Map(mods.map((m) => [m.mod_id, m]));
      const reordered: ModInfo[] = [];

      preset.load_order.forEach((id) => {
        const found = modMap.get(id);
        if (found) {
          reordered.push({ ...found, enabled: activeSet.has(id) });
          modMap.delete(id);
        }
      });

      modMap.forEach((m) => {
        reordered.push({ ...m, enabled: activeSet.has(m.mod_id) });
      });

      triggerReorder(reordered);
    }
    setActivePresetName(preset.name);
    setIsPresetDropdownOpen(false);
    setIsPresetModalOpen(false);
    setSaveToast(`✨ Preset '${preset.name}' applied to the game.`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const handleDeletePreset = (presetId: string) => {
    const target = savedPresets.find((p) => p.id === presetId);
    if (confirm(`Delete preset '${target?.name || ''}'?`)) {
      const updated = savedPresets.filter((p) => p.id !== presetId);
      setSavedPresets(updated);
      localStorage.setItem('pz_mod_studio_saved_presets', JSON.stringify(updated));
      if (activePresetName === target?.name) {
        setActivePresetName(null);
      }
      setSaveToast(`Preset deleted.`);
      setTimeout(() => setSaveToast(null), 2500);
    }
  };

  const handleExportPresetFile = async (targetPreset?: ModPreset) => {
    const presetToExport: ModPreset = targetPreset || {
      id: `preset_${Date.now()}`,
      name: activePresetName || 'ModList_Preset',
      description: 'Exported from PZ Mod Studio',
      author: undefined,
      created_at: new Date().toISOString(),
      mods: mods.filter((m) => m.enabled).map((m) => ({
        mod_id: m.mod_id,
        name: m.name,
        workshop_id: m.workshop_id,
        enabled: true,
      })),
      // Only the mods this preset is about: the full list would hand the other player every
      // mod the exporter happens to own, plus packages that exist on no other machine.
      load_order: mods.filter((m) => m.enabled).map((m) => m.mod_id),
    };

    setIsExportingPreset(true);
    try {
      const defaultFileName = `${presetToExport.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.pzpack`;
      const filePath = await TauriService.pickSaveFile(defaultFileName, 'PZ Mod Studio Preset (.pzpack)', 'pzpack');
      if (filePath) {
        await TauriService.exportPresetFile(presetToExport, filePath);
        setSaveToast(`✨ Collection exported to: ${filePath}`);
        setTimeout(() => setSaveToast(null), 4000);
      }
    } catch (err: any) {
      alert(`Error exporting preset: ${explainError(err)}`);
    } finally {
      setIsExportingPreset(false);
    }
  };

  const handleImportPresetFile = async () => {
    try {
      const filePath = await TauriService.pickOpenFile('PZ Mod Studio Preset (.pzpack)', 'pzpack');
      if (filePath) {
        const preset: ModPreset = await TauriService.importPresetFile(filePath);
        setImportedPreset(preset);

        const report: MissingModsReport = await TauriService.checkMissingPresetMods(
          preset,
          paths.user_zomboid_dir,
          paths.workshop_dir
        );
        setMissingReport(report);
        setIsPresetModalOpen(true);
        setIsPresetDropdownOpen(false);
      }
    } catch (err: any) {
      alert(`Error importing .pzpack file: ${explainError(err)}`);
    }
  };

  const handleApplyImportedPreset = () => {
    if (!importedPreset) return;
    handleApplyPreset(importedPreset);
    const exists = savedPresets.some((p) => p.name === importedPreset.name);
    if (!exists) {
      const updated = [importedPreset, ...savedPresets];
      setSavedPresets(updated);
      localStorage.setItem('pz_mod_studio_saved_presets', JSON.stringify(updated));
    }
    setImportedPreset(null);
    setMissingReport(null);
  };

  const triggerReorder = (newOrder: ModInfo[]) => {
    onReorder(newOrder);
  };

  const triggerToggleMod = (modId: string) => {
    onToggleMod(modId);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefreshMods();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const selectedMod = mods.find((m) => m.mod_id === selectedModId) || (mods.length > 0 ? mods[0] : null);

  // Most mods ship no picture of their own, so ask Steam once for all of them instead of
  // waiting for a request every time the user picks a different mod.
  const workshopIdsKey = useMemo(
    () => [...new Set(mods.map((m) => m.workshop_id).filter((id): id is string => !!id))].sort().join(','),
    [mods]
  );
  useEffect(() => {
    if (!workshopIdsKey) return;
    let cancelled = false;
    TauriService.workshopDetails(workshopIdsKey.split(','))
      .then((items) => {
        if (cancelled) return;
        setWorkshopPreviews(new Map(items.filter((i) => i.preview_url).map((i) => [i.workshop_id, i.preview_url!])));
      })
      .catch(() => undefined); // offline: the mods that ship a poster still show one
    return () => {
      cancelled = true;
    };
  }, [workshopIdsKey]);

  // The selected mod's picture: its own poster read from disk, else the Workshop one.
  useEffect(() => {
    setImageError(false);
    setPosterSrc(null);
    const file = selectedMod?.poster_url;
    const workshopId = selectedMod?.workshop_id;
    if (!selectedMod || !paths.is_valid) return;
    let cancelled = false;

    const fromWorkshop = async () => {
      const url = workshopId ? workshopPreviews.get(workshopId) : undefined;
      if (!url) throw new Error('no picture for this mod');
      return url;
    };

    (file ? TauriService.readModImage(paths, file).catch(fromWorkshop) : fromWorkshop())
      .then((src) => !cancelled && setPosterSrc(src))
      .catch(() => !cancelled && setImageError(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModId, selectedMod?.poster_url, selectedMod?.workshop_id, paths.is_valid, workshopPreviews]);

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
  /**
   * With a profile active the list is about that profile, so the rest of the library is out of
   * the way until asked for. "Show everything" then labels each mod with the profiles using it,
   * which is how you add one to the profile you are in.
   */
  const [showEveryMod, setShowEveryMod] = useState<boolean>(false);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;
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
  const filteredMods = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return mods.filter((m) => {
      if (activeProfile && !showEveryMod && !inActiveProfile.has(m.mod_id) && !m.enabled) return false;
      if (sourceFilter !== 'all' && sourceOf(m.mod_id, catalogById?.get(m.mod_id)).kind !== sourceFilter) return false;
      if (!query) return true;
      return (
        m.name.toLowerCase().includes(query) ||
        m.mod_id.toLowerCase().includes(query) ||
        (m.workshop_id && m.workshop_id.toLowerCase().includes(query))
      );
    });
  }, [mods, searchQuery, sourceFilter, catalogById, activeProfile, showEveryMod, inActiveProfile]);

  const reverseDependents = useMemo(() => {
    if (!selectedMod) return [];
    return mods.filter(
      (m) =>
        m.mod_id !== selectedMod.mod_id &&
        m.dependencies.some((dep) => {
          const matched = findInstalledDependencyInMods(dep, [selectedMod]);
          return matched !== undefined;
        })
    );
  }, [selectedMod, mods]);

  const parentLibraries = useMemo(() => {
    if (!selectedMod) return [];

    const list: { raw: string; matchedMod?: ModInfo }[] = [];
    const seenIds = new Set<string>();

    if (selectedMod.dependencies && selectedMod.dependencies.length > 0) {
      for (const reqRaw of selectedMod.dependencies) {
        const matched = findInstalledDependencyInMods(reqRaw, mods);
        if (matched) {
          seenIds.add(matched.mod_id);
        }
        list.push({ raw: reqRaw, matchedMod: matched });
      }
    }

    return list;
  }, [selectedMod, mods]);

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
    { label: 'Move to the top', icon: ChevronsUp, onSelect: () => moveToTop(index), disabled: index === 0,
      disabledReason: 'Already first' },
    { label: 'Move to the bottom', icon: ChevronsDown, onSelect: () => moveToBottom(index),
      disabled: index === mods.length - 1, disabledReason: 'Already last' },
    {
      label: 'Open in Mod Browser',
      icon: BookOpen,
      separatorBefore: true,
      onSelect: () => mod.workshop_id && onOpenInBrowser?.(mod.workshop_id),
      disabled: !mod.workshop_id || !onOpenInBrowser,
      disabledReason: 'This mod did not come from the Workshop',
    },
    {
      label: 'Open its folder',
      icon: FolderOpen,
      onSelect: () => TauriService.openModFolder(paths, catalogById?.get(mod.mod_id)?.root_dir ?? ''),
      disabled: !catalogById?.get(mod.mod_id)?.root_dir,
      disabledReason: 'The Studio does not know where this mod lives',
    },
    {
      label: 'Copy the mod id',
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
            Mod List &amp; Load Order (<code className="text-emerald-400">Zomboid/mods/default.txt</code>)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            <span>Steam Subscriptions: <b className="text-cyan-400">{uniqueWorkshopIds} items</b></span>

            <span>•</span>
            <span>Total Sub-mods: <b className="text-slate-200">{mods.length}</b></span>
            <span>•</span>
            <span>Active: <b className="text-emerald-400">{activeCount}</b></span>
            {/* Grave 1: Dependencies missing (Red) */}
            {missingUninstalledModIds.length > 0 && (
              <>
                <span>•</span>
                <button
                  onClick={handleCycleMissingUninstalled}
                  className="flex items-center gap-1.5 text-red-400 font-bold bg-red-500/10 hover:bg-red-500/20 px-2 py-0.5 rounded border border-red-500/40 transition cursor-pointer shadow-sm group text-[11px]"
                  title="Click to cycle through mods with missing dependencies (not installed)"
                >
                  <AlertTriangle className="w-3 h-3 text-red-400 group-hover:scale-110 transition shrink-0" />
                  <span>Dependencies missing</span>
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
                  title="Click to cycle through mods with disabled libraries"
                >
                  <AlertTriangle className="w-3 h-3 text-red-400 group-hover:scale-110 transition shrink-0" />
                  <span>Dependencies off</span>
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
                  title="Click to cycle through mods with exclusive incompatibilities"
                >
                  <AlertTriangle className="w-3 h-3 text-amber-400 group-hover:scale-110 transition shrink-0" />
                  <span>Incompatibility</span>
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
                  title="Click to cycle through mods with incorrect load order"
                >
                  <AlertTriangle className="w-3 h-3 text-amber-400 group-hover:scale-110 transition shrink-0" />
                  <span>List Order</span>
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
          {/* Presets & Mod Lists Dropdown & Actions */}
          <div className="relative">
            <button
              onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg text-xs font-medium transition cursor-pointer shrink-0"
              title="Preset Management & Collections (.pzpack)"
            >
              <Bookmark className="w-3.5 h-3.5 text-cyan-400" />
              <span>{activePresetName ? `Preset: ${activePresetName}` : `Presets (${savedPresets.length})`}</span>
            </button>

            {isPresetDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 p-2 space-y-2">
                <div className="text-[11px] font-bold text-slate-400 px-2 py-1 uppercase tracking-wider border-b border-slate-800 flex items-center justify-between">
                  <span>Mod Presets</span>
                  <span className="text-cyan-400 font-mono text-[10px]">{savedPresets.length} Saved</span>
                </div>

                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setIsSavePresetModalOpen(true);
                      setIsPresetDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-950/40 rounded-lg transition text-left cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Save Current List as Preset</span>
                  </button>

                  <button
                    onClick={handleImportPresetFile}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-cyan-300 hover:bg-cyan-950/40 rounded-lg transition text-left cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Import .pzpack File</span>
                  </button>

                  <button
                    onClick={() => {
                      handleExportPresetFile();
                      setIsPresetDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition text-left cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                    <span>Export Current List (.pzpack)</span>
                  </button>
                </div>

                {savedPresets.length > 0 && (
                  <>
                    <div className="text-[10px] font-bold text-slate-500 px-2 pt-1 uppercase border-t border-slate-800">
                      Load Saved Preset
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                      {savedPresets.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-1.5 bg-slate-950 hover:bg-slate-800/80 rounded-lg border border-slate-800/80 text-xs group"
                        >
                          <button
                            onClick={() => handleApplyPreset(p)}
                            className="flex-1 text-left truncate pr-2 text-slate-200 hover:text-cyan-300 font-medium text-xs cursor-pointer"
                            title={`Load ${p.name} (${p.mods.length} mods)`}
                          >
                            <div className="truncate font-semibold">{p.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{p.mods.filter((m) => m.enabled).length} active mods</div>
                          </button>
                          <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100">
                            <button
                              onClick={() => handleExportPresetFile(p)}
                              className="p-1 hover:text-cyan-400 transition cursor-pointer"
                              title="Export as .pzpack"
                            >
                              <Download className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeletePreset(p.id)}
                              className="p-1 hover:text-red-400 transition cursor-pointer"
                              title="Delete preset"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg text-xs font-medium transition cursor-pointer shrink-0"
            title="Re-scan Workshop directory for newly subscribed/unsubscribed mods"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
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

          {activeProfile && (
            <button
              type="button"
              onClick={() => setShowEveryMod((v) => !v)}
              aria-pressed={showEveryMod}
              title={
                showEveryMod
                  ? `Show only what the profile ${activeProfile.name} uses`
                  : 'Show every installed mod, so you can add one to this profile'
              }
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition ${
                showEveryMod
                  ? 'bg-slate-800 text-slate-200 border-slate-700'
                  : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/70'
              }`}
            >
              {showEveryMod ? 'Showing everything' : `Only ${activeProfile.name}`}
            </button>
          )}

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label="Filter by source"
            title="Show only mods from one source"
            className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 cursor-pointer"
          >
            <option value="all">All sources</option>
            <option value="steam">Steam Workshop</option>
            <option value="nexus">Nexus Mods</option>
            <option value="manual">Installed by hand</option>
            <option value="local">Local (other)</option>
            <option value="studio">PZ Mod Studio</option>
            <option value="compat">Compatible copies</option>
          </select>

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
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-900 text-slate-400 font-bold text-[11px] uppercase tracking-wider border-b border-slate-800 items-center">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-1 text-center">Active</div>
            <div className="col-span-6 flex items-center gap-2 min-w-0">
              <span className="shrink-0">Mod Name & ID</span>
              <div className="relative flex-1 max-w-[260px] normal-case font-normal text-xs">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search the list..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-cyan-500/80 rounded-lg pl-8 pr-7 py-1 text-xs text-slate-200 placeholder-slate-500 transition shadow-inner font-sans outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="col-span-4 text-right">Actions</div>
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
                No mods match your search query "<b className="text-slate-400">{searchQuery}</b>".
              </div>
            ) : (
              filteredMods.map((mod) => {
                const originalIndex = modIndexById.get(mod.mod_id) ?? -1;
                const isSelected = mod.mod_id === selectedModId;
                const isHighlighted = mod.mod_id === highlightedModId;
                const isAssigningThis = assigningModId === mod.mod_id;

                const isMultiPackage = (!mod.mod_id.startsWith("Z_PZModStudio_") && mod.workshop_id) ? multiModPackageMap[mod.workshop_id] : false;
                const packageColor = (!mod.mod_id.startsWith("Z_PZModStudio_") && mod.workshop_id) ? workshopColorMap[mod.workshop_id] : null;

                const disabledDependencies = missingActiveDependenciesMap[mod.mod_id];
                const hasDisabledDependency = disabledDependencies && disabledDependencies.length > 0;

                const uninstalledDependencies = missingUninstalledDependenciesMap[mod.mod_id];
                const hasMissingUninstalledDep = uninstalledDependencies && uninstalledDependencies.length > 0;

                const orderViolationsForThisMod = loadOrderViolationsMap[mod.mod_id];
                const hasOrderViolation = orderViolationsForThisMod && orderViolationsForThisMod.length > 0;

                const conflictsForThisMod = activeConflictsMap[mod.mod_id];
                const hasExclusivityConflict = conflictsForThisMod && conflictsForThisMod.length > 0;

                const isConflictPartner =
                  selectedMod &&
                  activeConflictsMap[selectedMod.mod_id] &&
                  activeConflictsMap[selectedMod.mod_id].some((c) => c.conflictingModId === mod.mod_id);

                const isSyntheticFusion = mod.mod_id.startsWith("Z_PZModStudio_") && !mod.mod_id.includes("Carrier");
                const isBridge = mod.mod_id === "Z_PZModStudio_Bridge";
                const isOpenedPackage = Boolean(isSyntheticFusion && !isBridge && mod.is_packaged === false);
                const isClosedPackage = Boolean(isSyntheticFusion && !isBridge && mod.is_packaged === true);

                return (
                  <div
                    key={mod.mod_id}
                    ref={(el) => {
                      modRowRefs.current[mod.mod_id] = el;
                    }}
                    onClick={() => setSelectedModId(mod.mod_id)}
                    onContextMenu={(e) => {
                      setSelectedModId(mod.mod_id);
                      showContextMenu(e, modRowMenu(mod, originalIndex));
                    }}
                    className={`grid grid-cols-12 gap-2 px-3 py-2 items-center rounded-lg text-xs cursor-pointer transition ${
                      isOpenedPackage
                        ? 'border-2 border-amber-500/80 bg-amber-950/25 shadow-md shadow-amber-950/30'
                        : hasMissingUninstalledDep || hasDisabledDependency
                        ? 'border-2 border-red-500 bg-red-950/40 shadow-md shadow-red-950/40'
                        : isConflictPartner
                        ? 'border-2 border-amber-400 bg-amber-950/90 shadow-xl shadow-amber-900/60 ring-2 ring-amber-400/50 animate-pulse'
                        : hasExclusivityConflict || hasOrderViolation
                        ? 'border-2 border-amber-500 bg-amber-950/40 shadow-md shadow-amber-950/30'
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
                        : isOpenedPackage
                        ? 'bg-amber-950/20 hover:bg-amber-950/30 border border-amber-800/60'
                        : mod.enabled
                        ? 'bg-slate-900/90 hover:bg-slate-800/80 border border-slate-800'
                        : 'bg-slate-950/40 opacity-60 hover:opacity-100 border border-slate-900/60'
                    }`}
                  >
                    {/* Fixed Line Number (Original Load Order Index) */}
                    <div className={`col-span-1 text-center font-mono text-[11px] ${isOpenedPackage ? 'text-amber-400 font-bold' : mod.enabled ? 'text-emerald-400 font-extrabold' : 'text-slate-600 font-medium'}`}>
                      #{originalIndex + 1}
                    </div>

                    {/* Enable/Disable Toggle Checkbox */}
                    <div className="col-span-1 flex justify-center">
                      <button
                        disabled={isOpenedPackage}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isOpenedPackage) {
                            handleToggleSingleMod(mod.mod_id);
                          }
                        }}
                        className={`w-5 h-5 rounded-md flex items-center justify-center transition ${
                          isOpenedPackage
                            ? 'cursor-not-allowed opacity-40 bg-slate-900 text-slate-600 border border-amber-800/50'
                            : 'cursor-pointer'
                        } ${
                          mod.enabled && !isOpenedPackage
                            ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30 border border-emerald-400 font-bold'
                            : !isOpenedPackage
                            ? 'bg-slate-950 text-slate-700 border border-slate-700 hover:border-slate-500'
                            : ''
                        }`}
                        title={
                          isOpenedPackage
                            ? 'This package is open in draft mode and deactivated. It cannot be enabled until it is packaged/published in Mod Merger.'
                            : mod.enabled
                            ? 'Click to disable mod'
                            : 'Click to enable mod'
                        }
                      >
                        {mod.enabled && !isOpenedPackage && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>
                    </div>

                    {/* Mod Title, Type Icon & Compact Dual Warning Badges */}
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

                      <div className="overflow-hidden flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <span className={`truncate min-w-0 flex-1 ${mod.enabled ? 'font-bold text-slate-100' : 'font-medium text-slate-400/80'}`}>
                            {mod.name}
                          </span>

                          {isBridge && (
                            <span
                              className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-700 shrink-0 shadow-sm"
                              title="PZ Mod Studio Live Bridge Companion Mod"
                            >
                              <Package className="w-3 h-3 text-cyan-400" />
                              <span>COMPANION BRIDGE</span>
                            </span>
                          )}

                          {isOpenedPackage && (
                            <span
                              className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-600 shrink-0 shadow-sm cursor-help animate-pulse"
                              title={`Open Package (Draft): ${mod.mod_id}\nThis package is in editing mode and deactivated. Package / publish it in Mod Merger to use it in-game.`}
                            >
                              <Package className="w-3 h-3 text-amber-400" />
                              <span>OPEN (Draft)</span>
                            </span>
                          )}

                          {isClosedPackage && (
                            <span
                              className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-600 shrink-0 shadow-sm cursor-help"
                              title={`Packaged Mod (Closed): ${mod.mod_id}\nContains compiled compatibility patches ready for Project Zomboid.`}
                            >
                              <Package className="w-3 h-3 text-emerald-400" />
                              <span>PACKAGED</span>
                            </span>
                          )}

                          <SourceBadge modId={mod.mod_id} entry={catalogById?.get(mod.mod_id)} />

                          {/* Showing everything: say which profiles each mod belongs to. */}
                          {showEveryMod && activeProfile && (() => {
                            const usedBy = profilesByMod.get(mod.mod_id) ?? [];
                            const others = usedBy.filter((name) => name !== activeProfile.name);
                            if (inActiveProfile.has(mod.mod_id)) {
                              return (
                                <span
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-emerald-700/60 text-emerald-300 shrink-0"
                                  title={`In this profile${others.length ? `, and in ${others.join(', ')}` : ''}`}
                                >
                                  in {activeProfile.name}
                                </span>
                              );
                            }
                            return (
                              <span
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 shrink-0"
                                title={others.length ? `Used by: ${others.join(', ')}` : 'Not in any profile yet'}
                              >
                                {others.length ? `in ${others.join(', ')}` : 'no profile'}
                              </span>
                            );
                          })()}

                          {!mod.enabled && (
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-900 text-slate-600 border border-slate-800 shrink-0">
                              OFF
                            </span>
                          )}

                          {mod.loadable_on_installed_build === false && (
                            <span
                              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/50 shrink-0"
                              title="This mod has no mod.info the installed game build reads (B41-only, or only folders for newer builds). The game will not load it."
                            >
                              NOT FOR THIS BUILD
                            </span>
                          )}

                          {/* Grave 1: Dependencies missing (Red) */}
                          {hasMissingUninstalledDep && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToDependency(uninstalledDependencies[0]);
                              }}
                              className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-red-500/20 hover:bg-red-500/40 text-red-300 border border-red-500/60 shrink-0 transition cursor-pointer shadow-sm"
                              title={`⚠️ MISSING DEPENDENCIES\n\nThis mod requires [${uninstalledDependencies[0]}], which is not installed.`}
                            >
                              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                              <span>Dependencies missing</span>
                              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                            </button>
                          )}

                          {/* Grave 2: Dependencies off (Red) */}
                          {hasDisabledDependency && !hasMissingUninstalledDep && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToMod(disabledDependencies[0].mod_id);
                              }}
                              className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-red-500/20 hover:bg-red-500/40 text-red-300 border border-red-500/60 shrink-0 transition cursor-pointer shadow-sm"
                              title={`⚠️ DISABLED DEPENDENCIES\n\nThis mod requires [${disabledDependencies[0].name}], which is disabled.`}
                            >
                              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                              <span>Dependencies off</span>
                              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                            </button>
                          )}

                          {/* Medio 1: Incompatibility (Yellow) */}
                          {hasExclusivityConflict && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToMod(conflictsForThisMod[0].conflictingModId);
                              }}
                              className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-500/60 shrink-0 transition cursor-pointer shadow-sm"
                              title={`⚠️ INCOMPATIBILITY DETECTED\n\nMutually exclusive with: [${conflictsForThisMod[0].conflictingModName}].`}
                            >
                              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                              <span>Incompatibility</span>
                              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                            </button>
                          )}

                          {/* Medio 2: List Order (Yellow) */}
                          {hasOrderViolation && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToMod(orderViolationsForThisMod[0].requiredModId);
                              }}
                              className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-500/60 shrink-0 transition cursor-pointer shadow-sm"
                              title={`⚠️ INCORRECT LOAD ORDER\n\nLoads before [${orderViolationsForThisMod[0].requiredModName}]. Must go AFTER.`}
                            >
                              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                              <span>List Order</span>
                              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                            </button>
                          )}
                        </div>
                        <div className={`text-[10px] font-mono truncate ${mod.enabled ? 'text-emerald-500/80' : 'text-slate-600'}`}>
                          ID: {mod.mod_id}
                        </div>
                      </div>
                    </div>

                    <div className="col-span-5 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {isAssigningThis ? (
                        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded border border-emerald-500">
                          <input
                            type="number"
                            placeholder="#"
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
              LOADS LAST — wins any file two mods share
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

                  {selectedMod.workshop_id && onOpenInBrowser && (
                    <button
                      onClick={() => onOpenInBrowser(selectedMod.workshop_id!)}
                      className="flex items-center gap-1 text-[10px] text-cyan-400 hover:underline font-mono bg-transparent border-0 cursor-pointer"
                      title="Opens this mod in Browse Mods: description, images and the Workshop page"
                    >
                      <span>Open in Mod Browser (#{selectedMod.workshop_id})</span>
                      <BookOpen className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <h3
                  onClick={() => handleJumpToMod(selectedMod.mod_id)}
                  className="text-base font-bold text-slate-100 hover:text-emerald-400 transition cursor-pointer flex items-center gap-1.5"
                  title="Click to center and highlight this mod in the left list"
                >
                  <span>{selectedMod.name}</span>
                </h3>
                <div className="text-xs font-mono text-slate-400">ID: <code className="text-emerald-400">{selectedMod.mod_id}</code></div>
              </div>

              {/* Load Order Violation Warning Card */}
              {loadOrderViolationsMap[selectedMod.mod_id] && loadOrderViolationsMap[selectedMod.mod_id].length > 0 && (
                <div className="p-3 bg-orange-950/70 border-2 border-orange-500 rounded-xl space-y-2 text-xs shadow-lg">
                  <div className="flex items-center justify-between font-bold text-orange-300">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-orange-400 shrink-0" />
                      <span>Warning: Incorrect Load Order</span>
                    </div>
                    <span className="text-[10px] font-mono bg-orange-900/80 text-orange-200 px-2 py-0.5 rounded border border-orange-600">
                      Position #{mods.findIndex((m) => m.mod_id === selectedMod.mod_id) + 1}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-200 leading-relaxed">
                    This mod is loading <b>BEFORE</b> its required dependency{' '}
                    <b className="text-orange-300">[{loadOrderViolationsMap[selectedMod.mod_id][0].requiredModName}]</b> (Position #{loadOrderViolationsMap[selectedMod.mod_id][0].requiredModIndex + 1}). Must be placed <b>AFTER</b> in the list to avoid errors.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleFixLoadOrderViolation(selectedMod.mod_id, loadOrderViolationsMap[selectedMod.mod_id][0].requiredModId)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-lg text-xs font-bold transition cursor-pointer shadow"
                    >
                      <Wand2 className="w-4 h-4" />
                      <span>Move After {loadOrderViolationsMap[selectedMod.mod_id][0].requiredModName}</span>
                    </button>
                    <button
                      onClick={() => handleJumpToMod(loadOrderViolationsMap[selectedMod.mod_id][0].requiredModId)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-orange-300 border border-orange-800 rounded-lg text-xs font-bold transition cursor-pointer"
                      title="Jump to required dependency"
                    >
                      <span>Ver Dep</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Disabled Dependency Warning Card */}
              {missingActiveDependenciesMap[selectedMod.mod_id] && missingActiveDependenciesMap[selectedMod.mod_id].length > 0 && (
                <div className="p-3 bg-rose-950/60 border-2 border-rose-500/80 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-rose-300">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>Warning: Base Library Disabled</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    This mod is active but requires the library{' '}
                    <b className="text-rose-300">[{missingActiveDependenciesMap[selectedMod.mod_id][0].name}]</b> which is DISABLED.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleToggleSingleMod(missingActiveDependenciesMap[selectedMod.mod_id][0].mod_id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition cursor-pointer shadow"
                    >
                      <Check className="w-4 h-4" />
                      <span>Activate Library</span>
                    </button>
                    <button
                      onClick={() => handleJumpToMod(missingActiveDependenciesMap[selectedMod.mod_id][0].mod_id)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-800 rounded-lg text-xs font-bold transition cursor-pointer"
                      title="Jump to library in list"
                    >
                      <span>View Mod</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Active Incompatibility Warning Card in Inspector */}
              {activeConflictsMap[selectedMod.mod_id] && activeConflictsMap[selectedMod.mod_id].length > 0 && (
                <div className="p-3 bg-amber-950/60 border-2 border-amber-500/80 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-300">
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Warning: Incompatibility Detected</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Mutually exclusive with:{' '}
                    <b className="text-amber-300">[{activeConflictsMap[selectedMod.mod_id][0].conflictingModName}]</b>.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleJumpToMod(activeConflictsMap[selectedMod.mod_id][0].conflictingModId)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-500/50 rounded-lg text-xs font-bold transition cursor-pointer"
                    >
                      <span>View Conflicting Mod</span>
                    </button>
                    <button
                      onClick={() => handleToggleSingleMod(activeConflictsMap[selectedMod.mod_id][0].conflictingModId)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-lg text-xs font-bold transition cursor-pointer"
                      title="Deactivate conflicting variant"
                    >
                      <span>Deactivate</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Top Section: Split Description (Left) + Poster Thumbnail Frame (Right) */}
              <div className="grid grid-cols-12 gap-3 items-start">
                {/* Left Description Box with Parsed RichText */}
                <div className="col-span-12 sm:col-span-7 space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Mod Overview & Description
                  </label>
                  <div className="p-3 bg-slate-950/90 rounded-xl text-xs text-slate-300 leading-relaxed font-sans border border-slate-800 h-48 overflow-y-auto select-text shadow-inner">
                    {renderPZRichText(selectedMod.description)}
                  </div>
                </div>

                {/* Right Poster Image Frame (256x256 image with fallback) */}
                <div className="col-span-12 sm:col-span-5 space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Mod Poster
                  </label>
                  <div className="h-48 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-center overflow-hidden relative shadow-inner">
                    {posterSrc && !imageError ? (
                      <img
                        src={posterSrc}
                        alt={selectedMod.name}
                        className="w-full h-full object-cover rounded-xl"
                        onError={() => setImageError(true)}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border border-slate-800 rounded-xl flex flex-col items-center justify-center p-3 text-center space-y-2">
                        <div className="w-10 h-10 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shadow">
                          {selectedMod.is_map_mod ? (
                            <MapPin className="w-5 h-5 text-amber-400" />
                          ) : selectedMod.is_library ? (
                            <Package className="w-5 h-5 text-purple-400" />
                          ) : (
                            <ListOrdered className="w-5 h-5 text-cyan-400" />
                          )}
                        </div>
                        <span className="text-[11px] font-bold text-slate-200 line-clamp-1 max-w-[150px]">
                          {selectedMod.name}
                        </span>
                        <div className="text-[10px] text-slate-400 font-mono">
                          <span>{selectedMod.is_map_mod ? 'Map Tile' : selectedMod.is_library ? 'Framework' : 'Script Mod'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Section: In-Game Style Metadata Table Grid */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden text-xs shadow-md">
                <div className="bg-slate-900/90 px-3.5 py-2 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                  <span>Mod Metadata Details</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-normal">PZ Build 42 Manifest</span>
                </div>
                <div className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  <div className="grid grid-cols-12 px-3.5 py-1.5 items-center">
                    <div className="col-span-4 text-slate-400">Status</div>
                    <div className={`col-span-8 font-bold ${selectedMod.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {selectedMod.enabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>

                  <div className="grid grid-cols-12 px-3.5 py-1.5 items-center">
                    <div className="col-span-4 text-slate-400">Version</div>
                    <div className="col-span-8 text-slate-200">{selectedMod.version || '1.0'}</div>
                  </div>

                  <div className="grid grid-cols-12 px-3.5 py-1.5 items-center">
                    <div className="col-span-4 text-slate-400">Author</div>
                    <div className="col-span-8 text-cyan-300 font-bold">{selectedMod.author || 'Unknown'}</div>
                  </div>

                  {selectedMod.url && (
                    <div className="grid grid-cols-12 px-3.5 py-1.5 items-center">
                      <div className="col-span-4 text-slate-400">Homepage</div>
                      <div className="col-span-8">
                        <button
                          onClick={() => TauriService.openExternalUrl(selectedMod.url!)}
                          className="text-cyan-400 hover:underline font-mono truncate max-w-full text-left"
                        >
                          {selectedMod.url}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-12 px-3.5 py-1.5 items-center">
                    <div className="col-span-4 text-slate-400">Mod ID</div>
                    <div className="col-span-8 text-emerald-400 font-bold">{selectedMod.mod_id}</div>
                  </div>

                  <div className="grid grid-cols-12 px-3.5 py-1.5 items-center">
                    <div className="col-span-4 text-slate-400">Workshop ID</div>
                    <div className="col-span-8 text-slate-300">{selectedMod.workshop_id || 'Built-in / Local'}</div>
                  </div>

                  <div className="grid grid-cols-12 px-3.5 py-1.5 items-center">
                    <div className="col-span-4 text-slate-400">Source</div>
                    <div className="col-span-8 text-slate-300">{selectedMod.workshop_id ? 'Steam Workshop' : 'Local Directory'}</div>
                  </div>

                  <div className="grid grid-cols-12 px-3.5 py-1.5 items-center">
                    <div className="col-span-4 text-slate-400">Zomboid Version</div>
                    <div className="col-span-8 text-slate-300">{selectedMod.pzversion || '42.0+'}</div>
                  </div>

                  <div className="grid grid-cols-12 px-3.5 py-1.5 items-start">
                    <div className="col-span-4 text-slate-400 pt-0.5">Incompatible With</div>
                    <div className="col-span-8">
                      {selectedMod.incompatible && selectedMod.incompatible.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {selectedMod.incompatible.map((incRaw, idx) => (
                            <span key={idx} className="text-amber-400 font-bold">{incRaw}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-600 italic">-</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 1: Base Libraries (Library Required by this Mod) */}
              <div className="space-y-1 border-t border-slate-800 pt-3">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                    <Package className="w-3.5 h-3.5 text-emerald-400" />
                    Library Required by this Mod ({parentLibraries.length})
                  </span>
                </label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {parentLibraries.length > 0 ? (
                    parentLibraries.map((item, idx) => {
                      const matched = item.matchedMod;
                      const isDepDisabled = matched && !matched.enabled;
                      return (
                        <button
                          key={idx}
                          onClick={() => handleJumpToDependency(item.raw)}
                          className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg border transition cursor-pointer flex items-center gap-2 shadow-sm ${
                            isDepDisabled
                              ? 'bg-rose-950/80 border-rose-700 text-rose-200 hover:border-rose-400 shadow'
                              : matched
                              ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200 hover:border-emerald-400 shadow'
                              : 'bg-red-950/80 border-red-700 text-red-200 hover:border-red-400 shadow'
                          }`}
                          title={
                            matched
                              ? `Click to center and go to parent library [${matched.name}] (${matched.enabled ? 'ACTIVE' : 'DISABLED'})`
                              : `Library not installed: ${item.raw} (Click to search on Steam Workshop)`
                          }
                        >
                          <span className={`w-2 h-2 rounded-full ${isDepDisabled ? 'bg-rose-400 animate-pulse' : matched ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <span>{matched ? matched.name : item.raw}</span>
                          <ExternalLink className="w-3 h-3 text-emerald-400 shrink-0 ml-0.5" />
                        </button>
                      );
                    })
                  ) : (
                    <span className="text-xs text-slate-500 italic">No base library required by this mod</span>
                  )}
                </div>
              </div>

              {/* SECTION 2: Reverse Dependents (Mods Requiring This Library) */}
              <div className="space-y-1 border-t border-slate-800 pt-3">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-purple-400 font-bold">
                    <Link2 className="w-3.5 h-3.5 text-purple-400" />
                    Mods Requiring This Library ({reverseDependents.length})
                  </span>
                </label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {reverseDependents.length > 0 ? (
                    reverseDependents.map((depMod) => (
                      <button
                        key={depMod.mod_id}
                        onClick={() => handleJumpToMod(depMod.mod_id)}
                        className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg border transition cursor-pointer flex items-center gap-2 shadow-sm ${
                          depMod.enabled
                            ? 'bg-purple-950/80 border-purple-700 text-purple-200 hover:border-purple-400 shadow'
                            : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
                        }`}
                        title={`Click to center and go to child mod [${depMod.name}] (${depMod.enabled ? 'ACTIVE' : 'DISABLED'})`}
                      >
                        <span className={`w-2 h-2 rounded-full ${depMod.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        <span>{depMod.name}</span>
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

      {/* In-App Auto-Sort Notice Modal */}
      {showAutoSortNotice && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-emerald-500/50 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <Wand2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Auto-sort completed</h3>
                <p className="text-xs text-slate-400">
                  {lastSortMoved === 0 ? 'Your load order already follows every rule: nothing moved.' : `${lastSortMoved} mods moved.`}
                </p>
              </div>
            </div>

            <ul className="text-xs text-slate-300 space-y-2 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 font-sans leading-relaxed">
              <li>Mods load after the mods they require and their <code>loadModAfter</code> mods, and before their <code>loadModBefore</code> mods (read from mod.info exactly like the game does).</li>
              <li>Everything else keeps the order you chose.</li>
              <li className="text-amber-300">PZ Mod Studio merge packages are placed last.</li>
            </ul>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dontShowNoticeChecked}
                  onChange={(e) => setDontShowNoticeChecked(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus-visible:outline-2 focus-visible:outline-emerald-400 focus-visible:outline-offset-2 w-4 h-4 cursor-pointer"
                />
                <span>Do not show this message again</span>
              </label>

              {orderBeforeSort && (
                <button
                  onClick={() => {
                    handleUndoSort();
                    setShowAutoSortNotice(false);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition cursor-pointer shrink-0"
                >
                  Undo
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

      {/* Save Preset Dialog Modal */}
      {isSavePresetModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Bookmark className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-slate-100">Save Current List as Preset</h3>
              </div>
              <button onClick={() => setIsSavePresetModalOpen(false)} className="text-slate-500 hover:text-slate-300 p-1">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Save the current configuration of <b className="text-emerald-400">{activeCount} active mods</b> and its load order so you can restore it at any time.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Preset Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Hardcore Survival 1993, Vanilla Plus..."
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Optimized collection with weapon and UI mods"
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsSavePresetModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCurrentAsPreset}
                disabled={!newPresetName.trim()}
                className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow transition cursor-pointer flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Preset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Imported Preset & Missing Mods Diagnostic Modal */}
      {isPresetModalOpen && importedPreset && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="text-base font-bold text-slate-100">Collection: {importedPreset.name}</h3>
                  <p className="text-[11px] text-slate-400">{importedPreset.description || 'Imported from .pzpack file'}</p>
                </div>
              </div>
              <button onClick={() => { setIsPresetModalOpen(false); setImportedPreset(null); setMissingReport(null); }} className="text-slate-500 hover:text-slate-300 p-1">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Diagnostic Report */}
            {missingReport && (
              <div className="space-y-2">
                {missingReport.missing_mods.length > 0 ? (
                  <div className="p-3.5 bg-amber-950/70 border-2 border-amber-500/80 rounded-xl space-y-2 text-xs shadow-md">
                    <div className="flex items-center justify-between font-bold text-amber-300">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Mods Not Installed on your PC ({missingReport.missing_mods.length})</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      To fully enjoy this preset, subscribe to these mods on Steam Workshop:
                    </p>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {missingReport.missing_mods.map((m, idx) => (
                        <div key={idx} className="flex items-center justify-between p-1.5 bg-slate-950/80 rounded border border-slate-800 text-[11px] font-mono">
                          <span className="text-slate-200 truncate max-w-[240px]">{m.name}</span>
                          {m.workshop_id ? (
                            <button
                              onClick={() => (onOpenInBrowser ? onOpenInBrowser(m.workshop_id!) : TauriService.openExternalUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshop_id}`))}
                              className="text-cyan-400 hover:underline flex items-center gap-1 text-[10px]"
                            >
                              <span>Steam (#{m.workshop_id})</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          ) : (
                            <span className="text-slate-500 text-[10px]">Local Mod</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 bg-emerald-950/60 border border-emerald-700/80 rounded-xl flex items-center gap-3 text-xs text-emerald-300">
                    <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div>
                      <div className="font-bold">All mods in the collection are installed!</div>
                      <div className="text-[11px] text-slate-300">You can apply the order and activation immediately.</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => { setIsPresetModalOpen(false); setImportedPreset(null); setMissingReport(null); }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyImportedPreset}
                className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow transition cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Apply Preset to my Game</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
