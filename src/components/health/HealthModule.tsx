import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, HeartPulse, Info, Loader2, RefreshCw, Wand2, XCircle } from 'lucide-react';
import { HealthFix, HealthIssue, HealthReport, HealthSeverity, ModInfo } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService } from '../../services/tauri';

interface HealthModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  /** Latest report from useModHealth (shared with the Mod List and the sidebar badge). */
  report: HealthReport | null;
  checking: boolean;
  onRecheck: () => void;
  /** Replaces the whole list (order + enabled flags) and persists it. */
  onApplyModList: (mods: ModInfo[]) => void;
}

/** Fixes the "fix all" button may apply without asking: they only enable or reorder. */
const SAFE_FIX_ACTIONS = new Set<HealthFix['action']>(['enable_mod', 'move_before']);

const isStudioDraftPackage = (m: ModInfo) =>
  m.mod_id.startsWith('Z_PZModStudio_') && m.mod_id !== 'Z_PZModStudio_Bridge' && m.is_packaged === false;

/** Applies one fix to a copy of the list; returns null when it does not apply. */
export function applyFix(mods: ModInfo[], fix: HealthFix): ModInfo[] | null {
  switch (fix.action) {
    case 'enable_mod':
    case 'disable_mod': {
      const enable = fix.action === 'enable_mod';
      const target = mods.find((m) => m.mod_id === fix.mod_id);
      if (!target || target.enabled === enable || (enable && isStudioDraftPackage(target))) return null;
      return mods.map((m) => (m.mod_id === fix.mod_id ? { ...m, enabled: enable } : m));
    }
    case 'move_before': {
      const from = mods.findIndex((m) => m.mod_id === fix.mod_id);
      const anchor = mods.findIndex((m) => m.mod_id === fix.before);
      if (from < 0 || anchor < 0 || from < anchor) return null;
      const next = [...mods];
      const [moved] = next.splice(from, 1);
      next.splice(anchor, 0, moved);
      return next;
    }
    default:
      return null;
  }
}

const fixLabel = (fix: HealthFix): string => {
  switch (fix.action) {
    case 'enable_mod':
      return `Enable ${fix.mod_id}`;
    case 'disable_mod':
      return `Disable ${fix.mod_id}`;
    case 'move_before':
      return `Move ${fix.mod_id} before ${fix.before}`;
    case 'remove_from_list':
      return `Remove ${fix.entry}`;
    case 'subscribe_workshop':
      return `Search Workshop for "${fix.hint}"`;
    case 'open_in_steam':
      return 'Open in Steam';
  }
};

const SEVERITY_STYLE: Record<HealthSeverity, { icon: React.ElementType; row: string; iconColor: string; label: string }> = {
  error: { icon: XCircle, row: 'border-red-500/40 bg-red-950/30', iconColor: 'text-red-400', label: 'Errors' },
  warning: { icon: AlertTriangle, row: 'border-amber-500/40 bg-amber-950/20', iconColor: 'text-amber-400', label: 'Warnings' },
  info: { icon: Info, row: 'border-slate-700 bg-slate-900/50', iconColor: 'text-slate-400', label: 'Info' },
};

export const HealthModule: React.FC<HealthModuleProps> = ({ paths, mods, report, checking, onRecheck, onApplyModList }) => {
  const handleFix = (fix: HealthFix) => {
    if (fix.action === 'open_in_steam') {
      TauriService.openExternalUrl(`steam://url/CommunityFilePage/${fix.workshop_id}`);
      return;
    }
    if (fix.action === 'subscribe_workshop') {
      TauriService.openExternalUrl(
        `https://steamcommunity.com/workshop/browse/?appid=108600&searchtext=${encodeURIComponent(fix.hint)}`
      );
      return;
    }
    const next = applyFix(mods, fix);
    if (next) onApplyModList(next);
  };

  const handleFixes = (list: HealthFix[]) => {
    let next = mods;
    for (const fix of list) next = applyFix(next, fix) ?? next;
    if (next !== mods) onApplyModList(next);
  };

  const safeFixes = useMemo(() => {
    if (!report) return [] as HealthFix[];
    return report.issues.flatMap((i) => i.fixes.filter((f) => SAFE_FIX_ACTIONS.has(f.action)));
  }, [report]);

  const handleFixAllSafe = () => handleFixes(safeFixes);
  const safeIssueCount = report?.issues.filter((i) => i.fixes.some((f) => SAFE_FIX_ACTIONS.has(f.action))).length ?? 0;

  const grouped = useMemo(() => {
    const groups: Record<HealthSeverity, HealthIssue[]> = { error: [], warning: [], info: [] };
    report?.issues.forEach((i) => groups[i.severity].push(i));
    return groups;
  }, [report]);

  if (!paths.is_valid) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-400 p-6">
        Configure your game and Zomboid folders in App Settings to check your mods.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 gap-4 font-sans">
      <div className="flex items-start justify-between gap-4 p-5 rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex items-start gap-3">
          <HeartPulse className="w-6 h-6 text-emerald-400 mt-0.5" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-bold text-slate-100">Mod Health</h1>
            <p className="text-xs text-slate-400 max-w-2xl">
              Checks your active load order the way the game reads it: mods your build cannot load, missing or
              disabled requirements, libraries loading too late, incompatible mods enabled together.
            </p>
            {report && (
              <div className="flex flex-wrap gap-2 mt-3 text-[11px] font-mono">
                <span className="px-2 py-0.5 rounded border border-slate-700 text-slate-300">
                  Game build {report.game_version ?? 'unknown'}
                </span>
                <span className="px-2 py-0.5 rounded border border-slate-700 text-slate-300">{report.active_count} active</span>
                <span className={`px-2 py-0.5 rounded border ${report.errors ? 'border-red-500/50 text-red-300' : 'border-slate-700 text-slate-400'}`}>
                  {report.errors} errors
                </span>
                <span className={`px-2 py-0.5 rounded border ${report.warnings ? 'border-amber-500/50 text-amber-300' : 'border-slate-700 text-slate-400'}`}>
                  {report.warnings} warnings
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {safeFixes.length > 0 && (
            <button
              type="button"
              onClick={handleFixAllSafe}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
              title="Enables missing requirements and moves libraries before the mods that need them"
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              Fix {safeIssueCount} {safeIssueCount === 1 ? 'problem' : 'problems'} automatically
            </button>
          )}
          <button
            type="button"
            onClick={onRecheck}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-60"
          >
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
            Check again
          </button>
        </div>
      </div>

      {report && report.issues.length === 0 && (
        <div className="flex items-center gap-3 p-5 rounded-xl border border-emerald-800/60 bg-emerald-950/30 text-emerald-200 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          No problems found in your {report.active_count} active mods.
        </div>
      )}

      {(['error', 'warning', 'info'] as HealthSeverity[]).map((sev) =>
        grouped[sev].length === 0 ? null : (
          <section key={sev} className="flex flex-col gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 font-mono">
              {SEVERITY_STYLE[sev].label} ({grouped[sev].length})
            </h2>
            {grouped[sev].map((issue, idx) => {
              const style = SEVERITY_STYLE[sev];
              const Icon = style.icon;
              // "Enable X" + "Move X before Y" for the same issue are shown as one button doing both.
              const applicable = issue.fixes.filter((f) => f.action === 'subscribe_workshop' || f.action === 'open_in_steam' || applyFix(mods, f) !== null);
              const enableThenMove = applicable.length === 2 && applicable[0].action === 'enable_mod' && applicable[1].action === 'move_before';
              const fixes = enableThenMove ? [applicable[0]] : applicable;
              return (
                <div key={`${issue.code}-${issue.mod_id}-${idx}`} className={`flex items-start gap-3 p-3 rounded-lg border ${style.row}`}>
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.iconColor}`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-200 break-words">{issue.message}</div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">{issue.code}</div>
                  </div>
                  {fixes.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5 shrink-0 max-w-[45%]">
                      {fixes.map((fix, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => (enableThenMove ? handleFixes(applicable) : handleFix(fix))}
                          className="px-2 py-1 rounded text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 cursor-pointer"
                        >
                          {fixLabel(fix)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )
      )}
    </div>
  );
};
