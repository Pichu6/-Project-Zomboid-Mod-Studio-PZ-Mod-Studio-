import React from 'react';
import { AlertTriangle, Info, Wrench, XCircle } from 'lucide-react';
import { HealthFix, HealthIssue, HealthSeverity, ModInfo } from '../../types';
import { TauriService } from '../../services/tauri';
import { StudioPathsUI } from '../settings/SettingsModule';
import { applyFix } from '../../utils/healthFix';
import i18next from 'i18next';

/** What a row says for each code the health check can raise. Short: the row is narrow. */
/** Settled things are Mod Health's record, not a row's problem. */
const SETTLED_CODES = new Set(['script_definition_settled', 'translation_settled', 'compatible_copy']);
/** A row has room for this many chips; the rest fold into one that opens Mod Health. */
const MAX_CHIPS = 2;
/** Issues about a group of files and mods, which only Mod Health shows whole. */
const HEALTH_ONLY_CODES = new Set(['script_definition_conflict', 'script_definition_stale', 'script_definition_settled', 'script_definition_conflict_more', 'translation_conflict', 'translation_stale', 'translation_settled']);

const labelFor = (issue: HealthIssue) => i18next.t(`modList.health.labels.${issue.code}`, { defaultValue: issue.code.replace(/_/g, ' ') });

const STYLE: Record<HealthSeverity, { chip: string; icon: React.ElementType; iconColor: string }> = {
  error: { chip: 'bg-red-500/20 hover:bg-red-500/35 text-red-200 border-red-500/60', icon: XCircle, iconColor: 'text-red-400' },
  warning: { chip: 'bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 border-amber-500/60', icon: AlertTriangle, iconColor: 'text-amber-400' },
  info: { chip: 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-600', icon: Info, iconColor: 'text-slate-400' },
};

const ORDER: Record<HealthSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Fixes the row can apply by rewriting the list, the way Mod Health does. */
const LIST_FIX_ACTIONS = new Set<HealthFix['action']>(['enable_mod', 'disable_mod', 'move_before', 'remove_from_list']);

const fixLabel = (fix: HealthFix, nameOf: (id: string) => string): string => {
  const t = i18next.t;
  switch (fix.action) {
    case 'enable_mod':
      return t('modList.health.fix.enable', { name: nameOf(fix.mod_id) });
    case 'disable_mod':
      return t('modList.health.fix.disable', { name: nameOf(fix.mod_id) });
    case 'move_before':
      return t('modList.health.fix.moveBefore', { name: nameOf(fix.before) });
    case 'remove_from_list':
      return t('modList.health.fix.remove');
    case 'subscribe_workshop':
      return t('modList.health.fix.searchWorkshop');
    case 'open_workshop_page':
      return t('modList.health.fix.openWorkshop');
    case 'open_in_merger':
      return t('modList.health.fix.openMerger');
    case 'keep_version':
      return t('modList.health.fix.keepVersion');
    case 'enable_shim_patch':
      return t('modList.health.fix.shimOn');
    case 'merge_files':
    case 'make_compatible_copy':
    case 'remove_compatible_copy':
      return t('modList.health.fix.inHealth');
  }
};

interface RowHealthChipsProps {
  paths: StudioPathsUI;
  issues: HealthIssue[];
  mods: ModInfo[];
  /** Replaces the list (order + switches) and persists it. */
  onApplyList: (mods: ModInfo[]) => void;
  onJumpToMod: (modId: string) => void;
  onOpenMerger?: (relativePath: string) => void;
  /** Opens Mod Health, scrolled to the issue when one is given. */
  onGoToHealth?: (issue?: HealthIssue) => void;
  /** A line for the list's toast, for a fix that happened on disk. */
  onNote?: (message: string) => void;
}

/**
 * The health check's findings for one mod, on its row: one chip per problem, worst first, with
 * the fix beside it when the row can apply it. The chip itself goes to the other mod involved,
 * or to Mod Health when there is none.
 */
export const RowHealthChips: React.FC<RowHealthChipsProps> = ({ paths, issues, mods, onApplyList, onJumpToMod, onOpenMerger, onGoToHealth, onNote }) => {
  if (issues.length === 0) return null;
  const nameOf = (id: string) => mods.find((m) => m.mod_id === id)?.name ?? id;

  // One chip per kind of problem, worst first; the message of the first is the tooltip. What is
  // already settled stays off the row, and past two chips the rest fold into one, so the mod's
  // name stays readable.
  const seen = new Set<string>();
  const all = [...issues]
    .filter((i) => !SETTLED_CODES.has(i.code))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
    .filter((i) => (seen.has(i.code) ? false : (seen.add(i.code), true)));
  if (all.length === 0) return null;
  const shown = all.slice(0, MAX_CHIPS);
  const folded = all.slice(MAX_CHIPS);

  const runFix = (fix: HealthFix, issue: HealthIssue) => {
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
      case 'keep_version':
        void TauriService.keepModVersion(paths, fix.mod_id).then((kept) =>
          onNote?.(i18next.t('modList.health.kept', { name: kept.mod_name, when: kept.kept_at }))
        );
        return;
      case 'enable_shim_patch':
        void TauriService.setShimPatch(paths.user_zomboid_dir, fix.name, true).then((written) =>
          onNote?.(i18next.t('modList.health.shimOn', { name: fix.name, count: written }))
        );
        return;
      case 'merge_files':
      case 'make_compatible_copy':
      case 'remove_compatible_copy':
        onGoToHealth?.(issue);
        return;
      case 'disable_mod':
        if (!confirm(i18next.t('modList.health.confirmDisable', { name: nameOf(fix.mod_id) }))) return;
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
        // The chip goes to the other mod only when there is exactly one (a dependency, an order
        // pair); a group of mods and files is Mod Health's to show whole.
        const others = issue.related.filter((id) => mods.some((m) => m.mod_id === id));
        const other = others.length === 1 && !HEALTH_ONLY_CODES.has(issue.code) ? others[0] : undefined;
        const fix = issue.fixes[0];
        return (
          <span key={issue.code} className="flex items-center shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (other) onJumpToMod(other);
                else onGoToHealth?.(issue);
              }}
              className={`flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 border transition cursor-pointer shadow-sm ${style.chip} ${
                fix ? 'rounded-l' : 'rounded'
              }`}
              title={`${issue.message}${
                other
                  ? i18next.t('modList.health.clickGoTo', { name: nameOf(other) })
                  : others.length > 1
                    ? i18next.t('modList.health.clickHealthAll', { count: others.length + 1 })
                    : i18next.t('modList.health.clickHealth')
              }`}
            >
              <Icon className={`w-3 h-3 shrink-0 ${style.iconColor}`} aria-hidden="true" />
              <span>{labelFor(issue)}</span>
            </button>
            {fix && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  runFix(fix, issue);
                }}
                className={`flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded-r border border-l-0 transition cursor-pointer shadow-sm ${style.chip}`}
                title={
                  LIST_FIX_ACTIONS.has(fix.action)
                    ? i18next.t('modList.health.listFix', { fix: fixLabel(fix, nameOf) })
                    : fix.action === 'open_in_merger'
                    ? i18next.t('modList.health.mergerFix', { path: fix.relative_path })
                    : fix.action === 'merge_files' || fix.action === 'make_compatible_copy' || fix.action === 'remove_compatible_copy'
                    ? i18next.t('modList.health.healthFix', { fix: fixLabel(fix, nameOf) })
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
      {folded.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onGoToHealth?.(folded[0]);
          }}
          className="flex items-center text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded border transition cursor-pointer shadow-sm bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-600 shrink-0"
          title={i18next.t('modList.health.more', { count: folded.length, labels: folded.map(labelFor).join('; ') })}
        >
          +{folded.length}
        </button>
      )}
    </>
  );
};
