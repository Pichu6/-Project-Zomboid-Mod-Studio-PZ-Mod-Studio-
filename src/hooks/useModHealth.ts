import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatalogModSummary, HealthReport, ModInfo } from '../types';
import { StudioPathsUI } from '../components/settings/SettingsModule';
import { TauriService, reportBackendError } from '../services/tauri';

/**
 * Runs the Rust health check (game-exact rules) for the enabled mods, in order, shortly after
 * the list changes. The single source of truth for dependency, order and compatibility problems.
 */
export function useModHealth(paths: StudioPathsUI, mods: ModInfo[]) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [catalog, setCatalog] = useState<CatalogModSummary[]>([]);
  const [checking, setChecking] = useState(false);
  const requestId = useRef(0);

  const activeIds = useMemo(() => mods.filter((m) => m.enabled).map((m) => m.mod_id), [mods]);
  // Re-check only when the active list really changes (not on unrelated re-renders).
  const activeKey = activeIds.join('\n');

  const recheck = useCallback(async () => {
    if (!paths.is_valid || mods.length === 0) return;
    const id = ++requestId.current;
    setChecking(true);
    try {
      const health = await TauriService.getModHealth(paths, activeKey ? activeKey.split('\n') : []);
      if (id === requestId.current) {
        setReport(health.report);
        setCatalog(health.catalog.mods);
      }
    } catch (err) {
      if (id === requestId.current) reportBackendError('Checking mod health', err);
    } finally {
      if (id === requestId.current) setChecking(false);
    }
  }, [paths, activeKey, mods.length]);

  useEffect(() => {
    const t = setTimeout(recheck, 300); // toggles come in bursts
    return () => clearTimeout(t);
  }, [recheck]);

  // Mod id -> the copy the game uses (source, origin), for source tags in the UI.
  const catalogById = useMemo(() => {
    const map = new Map<string, CatalogModSummary>();
    for (const m of catalog) if (!m.shadowed_by) map.set(m.id, m);
    return map;
  }, [catalog]);

  return { report, checking, recheck, catalog, catalogById };
}
