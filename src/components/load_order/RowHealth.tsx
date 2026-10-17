import React from 'react';
import { AlertTriangle, Info, Wrench, XCircle } from 'lucide-react';
import { HealthFix, HealthIssue, HealthSeverity, ModInfo } from '../../types';
import { TauriService } from '../../services/tauri';
import { applyFix } from '../../utils/healthFix';

/** What a row says for each code the health check can raise. Short: the row is narrow. */
const LABELS: Record<string, string> = {
  missing_dependency: 'Needs a mod you do not have',
  dependency_not_enabled: 'Needs a mod that is off',
  dependency_unavailable: 'Needs a mod this build cannot load',
  dependency_after: 'Loads before what it needs',
  load_after_order: 'Loads too early',
  load_before_order: 'Loads too late',
  incompatible: 'Incompatible',
  not_for_build: 'Not for this build',
  outside_version_range: 'Outside its version range',
  invalid_mod_info: 'Broken mod.info',
  missing_mod: 'Not installed',
  duplicate_entry: 'Listed twice',
  shadowed_copy: 'Another copy wins',
  compatible_copy: 'Compatible copy',
  workshop_update_pending: 'Update waiting',
  updated_since_last_play: 'Updated since you last played',
  script_definition_conflict: 'Same definition as another mod',
  script_definition_conflict_more: 'Same definition as other mods',
  script_definition_stale: 'Merge out of date',
};

const labelFor = (issue: HealthIssue) => LABELS[issue.code] ?? issue.code.replace(/_/g, ' ');

const STYLE: Record<HealthSeverity, { chip: string; icon: React.ElementType; iconColor: string }> = {
  error: { chip: 'bg-red-500/20 hover:bg-red-500/35 text-red-200 border-red-500/60', icon: XCircle, iconColor: 'text-red-400' },
  warning: { chip: 'bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 border-amber-500/60', icon: AlertTriangle, iconColor: 'text-amber-400' },
  info: { chip: 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-600', icon: Info, iconColor: 'text-slate-400' },
};

const ORDER: Record<HealthSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Fixes the row can apply by rewriting the list, the way Mod Health does. */
const LIST_FIX_ACTIONS = new Set<HealthFix['action']>(['enable_mod', 'disable_mod', 'move_before', 'remove_from_list']);

const fixLabel = (fix: HealthFix, nameOf: (id: string) => string): string => {
  switch (fix.action) {
    case 'enable_mod':
      return `Switch on ${nameOf(fix.mod_id)}`;
    case 'disable_mod':
      return `Switch off ${nameOf(fix.mod_id)}`;
    case 'move_before':
      return `Move before ${nameOf(fix.before)}`;
    case 'remove_from_list':
      return 'Remove from the list';
    case 'subscribe_workshop':
      return 'Search the Workshop';
    case 'open_workshop_page':
      return 'Open Workshop page';
    case 'open_in_merger':
      return 'Open in the Merger';
    case 'merge_files':
    case 'make_compatible_copy':
    case 'remove_compatible_copy':
      return 'Fix in Mod Health';
  }
};

interface RowHealthChipsProps {
  issues: HealthIssue[];
  mods: ModInfo[];
  /** Replaces the list (order + switches) and persists it. */
  onApplyList: (mods: ModInfo[]) => void;
  onJumpToMod: (modId: string) => void;
  onOpenMerger?: (relativePath: string) => void;
  onGoToHealth?: () => void;
}

/**
 * The health check's findings for one mod, on its row: one chip per problem, worst first, with
 * the fix beside it when the row can apply it. The chip itself goes to the other mod involved,
 * or to Mod Health when there is none.
 */
export const RowHealthChips: React.FC<RowHealthChipsProps> = ({ issues, mods, onApplyList, onJumpToMod, onOpenMerger, onGoToHealth }) => {
  if (issues.length === 0) return null;
  const nameOf = (id: string) => mods.find((m) => m.mod_id === id)?.name ?? id;

  // One chip per kind of problem; the message of the first is the tooltip.
  const seen = new Set<string>();
  const shown = [...issues]
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
    .filter((i) => (seen.has(i.code) ? false : (seen.add(i.code), true)));

  const runFix = (fix: HealthFix) => {
    switch (fix.action) {
      case 'subscribe_workshop':
        TauriService.openExternalUrl(`https://steamcommunity.com/workshop/browse/?appid=108600&searchtext=${encodeURIComponent(fix.hint)}`);
        return;
      case 'open_workshop_page':
        TauriService.openExternalUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${fix.workshop_id}`);
        return;
      case 'open_in_merger':
        if (onOpenMerger) onOpenMerger(fix.relative_path);
        else onGoToHealth?.();
        return;
      case 'merge_files':
      case 'make_compatible_copy':
      case 'remove_compatible_copy':
        onGoToHealth?.();
        return;
      case 'disable_mod':
        if (!confirm(`Switch off ${nameOf(fix.mod_id)}?\n\nIt stays installed, and you can switch it back on here.`)) return;
        break;
      default:
        break;
    }
    const next = applyFix(mods, fix);
    if (next) onApplyList(next);
  };

  return (
    <>
      {shown.map((issue) => {
        const style = STYLE[issue.severity];
        const Icon = style.icon;
        const other = issue.related.find((id) => mods.some((m) => m.mod_id === id));
        const fix = issue.fixes[0];
        return (
          <span key={issue.code} className="flex items-center shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (other) onJumpToMod(other);
                else onGoToHealth?.();
              }}
              className={`flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 border transition cursor-pointer shadow-sm ${style.chip} ${
                fix ? 'rounded-l' : 'rounded'
              }`}
              title={`${issue.message}${other ? `\n\nClick: go to ${nameOf(other)}` : '\n\nClick: open Mod Health'}`}
            >
              <Icon className={`w-3 h-3 shrink-0 ${style.iconColor}`} aria-hidden="true" />
              <span>{labelFor(issue)}</span>
            </button>
            {fix && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  runFix(fix);
                }}
                className={`flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded-r border border-l-0 transition cursor-pointer shadow-sm ${style.chip}`}
                title={
                  LIST_FIX_ACTIONS.has(fix.action)
                    ? `${fixLabel(fix, nameOf)} — changes your list; Earlier lists can undo it`
                    : fixLabel(fix, nameOf)
                }
              >
                <Wrench className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span>{fixLabel(fix, nameOf)}</span>
              </button>
            )}
          </span>
        );
      })}
    </>
  );
};
