import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, HeartPulse, Info, Loader2, MessageSquare, RefreshCw, Wand2, XCircle } from 'lucide-react';
import { AutoMergeResult, CompatResult, HealthFix, HealthIssue, HealthReport, HealthSeverity, ModInfo } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, reportBackendError } from '../../services/tauri';
import { COMMUNITY_SITE } from '../../utils/communityIndex';
import { applyFix } from '../../utils/healthFix';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { issueText } from '../../i18n/backendText';
import { RichText } from '../common/RichText';
import { tHtml } from '../../i18n/html';

interface HealthModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  /** Latest report from useModHealth (shared with the Mod List and the sidebar badge). */
  report: HealthReport | null;
  checking: boolean;
  onRecheck: () => void;
  /** Replaces the whole list (order + enabled flags) and persists it. */
  onApplyModList: (mods: ModInfo[]) => void;
  /** Mods were added/removed on disk (compatible copies, patch packages): rescan the list. */
  onModsChanged: () => void;
  /** Opens the Mod Merger on this conflicting file. */
  onOpenMerger: (relativePath: string) => void;
  /** The issue a Mod List chip pointed at: scrolled to and lit up once. */
  focusIssue?: HealthIssue | null;
  onFocusHandled?: () => void;
}

/** Fixes handled here (not by rewriting the mod list). */
const ACTION_FIXES = new Set<HealthFix['action']>([
  'subscribe_workshop', 'open_workshop_page', 'make_compatible_copy', 'keep_version', 'remove_compatible_copy', 'merge_files', 'open_in_merger',
  'enable_shim_patch',
]);

/** Fixes the "fix all" button may apply without asking: they only enable or reorder. */
const SAFE_FIX_ACTIONS = new Set<HealthFix['action']>(['enable_mod', 'move_before']);

/**
 * Issues whose fix is a matter of taste, not of the game's rules: two mods defining the same item
 * is not broken, and which version you want is nobody's call but yours. Their fix stays on its own
 * row and is kept out of the one-click button, which is for what the game itself would complain
 * about.
 */
const YOUR_CALL_CODES = new Set(['script_definition_conflict', 'script_definition_stale', 'script_definition_settled', 'translation_conflict', 'translation_stale', 'translation_settled', 'package_built_for_other_list']);


const fixLabel = (fix: HealthFix): string => {
  const t = i18next.t;
  switch (fix.action) {
    case 'enable_mod':
      return t('health.fix.enable', { id: fix.mod_id });
    case 'disable_mod':
      return t('health.fix.disable', { id: fix.mod_id });
    case 'move_before':
      return t('health.fix.moveBefore', { id: fix.mod_id, before: fix.before });
    case 'remove_from_list':
      return t('health.fix.remove', { entry: fix.entry });
    case 'subscribe_workshop':
      return t('health.fix.searchWorkshop', { hint: fix.hint });
    case 'open_workshop_page':
      return t('health.fix.openWorkshop');
    case 'make_compatible_copy':
      return t('health.fix.makeCopy');
    case 'keep_version':
      return t('health.fix.keepVersion');
    case 'remove_compatible_copy':
      return t('health.fix.removeCopy');
    case 'merge_files':
      return t('health.fix.mergeAuto');
    case 'open_in_merger':
      return t('health.fix.openMerger');
    case 'enable_shim_patch':
      return t('health.fix.shimOn', { name: fix.name });
  }
};

const SEVERITY_STYLE: Record<HealthSeverity, { icon: React.ElementType; row: string; iconColor: string }> = {
  error: { icon: XCircle, row: 'border-red-500/40 bg-red-950/30', iconColor: 'text-red-400' },
  warning: { icon: AlertTriangle, row: 'border-amber-500/40 bg-amber-950/20', iconColor: 'text-amber-400' },
  info: { icon: Info, row: 'border-slate-700 bg-slate-900/50', iconColor: 'text-slate-400' },
};

export const HealthModule: React.FC<HealthModuleProps> = ({ paths, mods, report, checking, onRecheck, onApplyModList, onModsChanged, onOpenMerger, focusIssue = null, onFocusHandled }) => {
  const { t } = useTranslation();
  const [litKey, setLitKey] = useState<string | null>(null);
  const issueKey = (i: HealthIssue) => `${i.code}|${i.mod_id ?? ''}|${i.message}`;
  // Opening this screen checks again, and the check lands in two steps (the rules, then the
  // script conflicts), each moving the issues around. Scrolling on every step made the page jump;
  // so it waits until the check is done and the page has kept still a moment, then scrolls once.
  const scrolledFor = useRef<HealthIssue | null>(null);
  const unlight = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(unlight.current), []);
  useEffect(() => {
    if (!focusIssue) {
      scrolledFor.current = null;
      return;
    }
    if (!report || checking || scrolledFor.current === focusIssue) return;
    const settle = window.setTimeout(() => {
      const key = issueKey(focusIssue);
      const el =
        document.querySelector<HTMLElement>(`[data-issue-key="${CSS.escape(key)}"]`) ??
        document.querySelector<HTMLElement>(`[data-issue-code="${CSS.escape(`${focusIssue.code}|${focusIssue.mod_id ?? ''}`)}"]`);
      scrolledFor.current = focusIssue;
      if (!el) {
        onFocusHandled?.();
        return;
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setLitKey(el.dataset.issueKey ?? key);
      window.clearTimeout(unlight.current);
      unlight.current = window.setTimeout(() => {
        setLitKey(null);
        onFocusHandled?.();
      }, 4000);
    }, 250);
    return () => window.clearTimeout(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIssue, report, checking]);
  const [compatBusy, setCompatBusy] = useState(false);
  const [compatResult, setCompatResult] = useState<CompatResult | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeResult, setMergeResult] = useState<AutoMergeResult | null>(null);

  const mergeFiles = async (relativePaths: string[]) => {
    if (relativePaths.length === 0) return;
    setMergeBusy(true);
    try {
      const result = await TauriService.autoMergeConflicts(paths, relativePaths);
      setMergeResult(result);
      onModsChanged(); // the package may be new or re-enabled
      onRecheck();
    } catch (err) {
      reportBackendError('Merging conflicting files', err);
    } finally {
      setMergeBusy(false);
    }
  };

  const makeCompatibleCopy = async (modId: string) => {
    setCompatBusy(true);
    try {
      let result: CompatResult;
      try {
        result = await TauriService.makeCompatibleCopy(paths, modId, false);
      } catch (err) {
        if (!String(err).includes('earlier compatible copy')) throw err;
        if (!confirm(t('health.freshCopy', { mod: modId }))) return;
        result = await TauriService.makeCompatibleCopy(paths, modId, true);
      }
      setCompatResult(result);
      onModsChanged();
      onRecheck(); // same mod id, so the list length may not change: check again explicitly
    } catch (err) {
      reportBackendError('Making a compatible copy', err);
    } finally {
      setCompatBusy(false);
    }
  };

  const removeCompatibleCopy = async (folder: string) => {
    if (!confirm(t('health.removeCopyConfirm', { folder }))) return;
    try {
      await TauriService.removeCompatibleCopy(paths, folder);
      setCompatResult(null);
      onModsChanged();
      onRecheck();
    } catch (err) {
      reportBackendError('Removing the compatible copy', err);
    }
  };

  /**
   * What the last button did, in words. A load-order change is invisible from this screen -- the
   * row stays, because two mods still define the same thing -- so without this the app looks
   * like it did nothing.
   */
  const [done, setDone] = useState<string | null>(null);
  const say = (what: string) => {
    setDone(what);
    window.setTimeout(() => setDone((current) => (current === what ? null : current)), 6000);
  };

  const handleFix = (fix: HealthFix, issue?: HealthIssue) => {
    if (fix.action === 'merge_files') {
      mergeFiles(fix.relative_paths);
      return;
    }
    if (fix.action === 'open_in_merger') {
      onOpenMerger(fix.relative_path);
      return;
    }
    if (fix.action === 'make_compatible_copy') {
      makeCompatibleCopy(fix.mod_id);
      return;
    }
    if (fix.action === 'remove_compatible_copy') {
      removeCompatibleCopy(fix.folder);
      return;
    }
    if (fix.action === 'enable_shim_patch') {
      void (async () => {
        try {
          const written = await TauriService.setShimPatch(paths.user_zomboid_dir, fix.name, true);
          say(t('health.shimOnDone', { name: fix.name, count: written }));
          onRecheck();
        } catch {
          // Already shown by TauriService.
        }
      })();
      return;
    }
    if (fix.action === 'keep_version') {
      void (async () => {
        try {
          const kept = await TauriService.keepModVersion(paths, fix.mod_id);
          say(t('health.keptDone', { name: kept.mod_name, when: kept.kept_at }));
        } catch {
          // Already shown by TauriService.
        }
      })();
      return;
    }
    if (fix.action === 'open_workshop_page') {
      TauriService.openExternalUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${fix.workshop_id}`);
      return;
    }
    if (fix.action === 'subscribe_workshop') {
      TauriService.openExternalUrl(
        `https://steamcommunity.com/workshop/browse/?appid=108600&searchtext=${encodeURIComponent(fix.hint)}`
      );
      return;
    }
    if (fix.action === 'disable_mod') {
      const name = mods.find((m) => m.mod_id === fix.mod_id)?.name ?? fix.mod_id;
      if (!confirm(t('health.confirmDisable', { name }))) return;
    }
    const next = applyFix(mods, fix);
    if (!next) return;
    onApplyModList(next);
    if (fix.action === 'move_before') {
      const moved = nameOf(fix.mod_id);
      const anchor = nameOf(fix.before);
      say(issue && YOUR_CALL_CODES.has(issue.code) ? t('health.nowUsesVersion', { anchor, moved }) : t('health.nowLoadsBefore', { moved, anchor }));
    } else if (fix.action === 'enable_mod') {
      say(t('health.switchedOn', { name: nameOf(fix.mod_id) }));
    } else if (fix.action === 'disable_mod') {
      say(t('health.switchedOff', { name: nameOf(fix.mod_id) }));
    } else if (fix.action === 'remove_from_list') {
      say(t('health.outOfList', { entry: fix.entry }));
    }
  };

  const handleFixes = (list: HealthFix[]) => {
    let next = mods;
    let applied = 0;
    for (const fix of list) {
      const after = applyFix(next, fix);
      if (after) {
        next = after;
        applied += 1;
      }
    }
    if (next === mods) {
      say(t('health.nothingChanged'));
      return;
    }
    onApplyModList(next);
    say(t('health.changesMade', { count: applied }));
  };

  /** The name the Mod List shows for a mod id. */
  const nameOf = (id: string) => mods.find((m) => m.mod_id === id)?.name ?? id;

  /** One warning, with what to ask, for any chat assistant (pasted; no key needed). */
  const copyForAssistant = async (issue: HealthIssue) => {
    const describe = (id: string) => {
      const m = mods.find((x) => x.mod_id === id);
      if (!m) return id;
      const bits = [`${m.name} (id ${m.mod_id}`];
      if (m.version) bits.push(`version ${m.version}`);
      if (m.workshop_id) bits.push(`Workshop ${m.workshop_id}`);
      return bits.join(', ') + ')';
    };
    const lines = [
      t('assistant.healthAsk'),
      '',
      `Project Zomboid ${report?.game_version ?? ''}, ${report?.active_count ?? '?'} mods on`.trim(),
      `Mod Health: ${issue.severity} ${issue.code}`,
      issue.mod_id ? `Mod: ${describe(issue.mod_id)}` : '',
      issue.related.length ? `Also involved: ${issue.related.map(describe).join('; ')}` : '',
      '',
      issue.message,
      issueText(issue) !== issue.message ? `(${issueText(issue)})` : '',
      issue.fixes.length ? `\nPZ Mod Studio offers: ${issue.fixes.map((f) => f.action).join(', ')}` : '',
    ].filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''));
    await navigator.clipboard.writeText(lines.join('\n'));
    say(t('assistant.copied'));
  };
  /** Names and ids a message may mention, set in bold. */
  const modWords = useMemo(() => mods.flatMap((m) => [m.name, m.mod_id]), [mods]);

  const safeFixes = useMemo(() => {
    if (!report) return [] as HealthFix[];
    return report.issues
      .filter((i) => !YOUR_CALL_CODES.has(i.code))
      .flatMap((i) => i.fixes.filter((f) => SAFE_FIX_ACTIONS.has(f.action)));
  }, [report]);

  const handleFixAllSafe = () => {
    const enabling = safeFixes.filter((f) => f.action === 'enable_mod').length;
    const moving = safeFixes.filter((f) => f.action === 'move_before').length;
    const parts = [enabling > 0 && t('health.willEnable', { count: enabling }), moving > 0 && t('health.willMove', { count: moving })].filter(Boolean);
    if (!confirm(t('health.confirmFixAll', { what: parts.join(t('health.and')) }))) return;
    handleFixes(safeFixes);
  };

  // Kept apart from the list fixes: merging rewrites the mod list on its own (enables the package).
  const mergeablePaths = useMemo(() => {
    if (!report) return [] as string[];
    const all = report.issues.flatMap((i) => i.fixes.flatMap((f) => (f.action === 'merge_files' ? f.relative_paths : [])));
    return Array.from(new Set(all));
  }, [report]);
  const safeIssueCount =
    report?.issues.filter(
      (i) => !YOUR_CALL_CODES.has(i.code) && i.fixes.some((f) => SAFE_FIX_ACTIONS.has(f.action))
    ).length ?? 0;

  const grouped = useMemo(() => {
    const groups: Record<HealthSeverity, HealthIssue[]> = { error: [], warning: [], info: [] };
    report?.issues.forEach((i) => groups[i.severity].push(i));
    return groups;
  }, [report]);

  if (!paths.is_valid) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-400 p-6">
        {t('health.configureFirst')}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 gap-4 font-sans">
      <div className="flex items-start justify-between gap-4 p-5 rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex items-start gap-3">
          <HeartPulse className="w-6 h-6 text-emerald-400 mt-0.5" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-bold text-slate-100">{t('health.title')}</h1>
            <p className="text-xs text-slate-400 max-w-2xl">
              {t('health.blurb')}
            </p>
            {report && (
              <div className="flex flex-wrap gap-2 mt-3 text-[11px] font-mono">
                <span className="px-2 py-0.5 rounded border border-slate-700 text-slate-300">
                  {t('health.gameBuild', { build: report.game_version ?? t('health.unknown') })}
                </span>
                <span className="px-2 py-0.5 rounded border border-slate-700 text-slate-300">{t('health.activeCount', { count: report.active_count })}</span>
                <span className={`px-2 py-0.5 rounded border ${report.errors ? 'border-red-500/50 text-red-300' : 'border-slate-700 text-slate-400'}`}>
                  {t('health.errorsCount', { count: report.errors })}
                </span>
                <span className={`px-2 py-0.5 rounded border ${report.warnings ? 'border-amber-500/50 text-amber-300' : 'border-slate-700 text-slate-400'}`}>
                  {t('health.warningsCount', { count: report.warnings })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        const c = await TauriService.refreshCommunity(paths);
                        say(t('health.communityFetched', { rules: c.rules, pairs: c.pairs, mods: c.mods, updated: c.index_updated ? t('health.indexUpdated', { date: c.index_updated }) : '' }));
                        onRecheck();
                      } catch {
                        // Already shown by TauriService.
                      }
                    })();
                  }}
                  className="px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                  title={
                    report.community
                      ? t('health.communityTitle', { rules: report.community.rules, pairs: report.community.pairs, mods: report.community.mods, updated: report.community.index_updated ? t('health.indexUpdated', { date: report.community.index_updated }) : '', off: report.community.downloads ? '' : t('health.communityOff') })
                      : t('health.communityNone')
                  }
                >
                  {report.community ? t('health.community', { rules: report.community.rules + report.community.pairs, mods: report.community.mods }) : t('health.communityNoneShort')} ↻
                </button>
                <button
                  type="button"
                  onClick={() => TauriService.openExternalUrl(COMMUNITY_SITE)}
                  title={t('health.communitySiteTitle')}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" aria-hidden="true" /> {t('health.communitySite')}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {mergeablePaths.length > 1 && (
            <button
              type="button"
              onClick={() => mergeFiles(mergeablePaths)}
              disabled={mergeBusy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer disabled:opacity-60"
              title={t('health.mergeAllTitle')}
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              {t('health.mergeAll', { count: mergeablePaths.length })}
            </button>
          )}
          {safeFixes.length > 0 && (
            <button
              type="button"
              onClick={handleFixAllSafe}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
              title={t('health.fixAllTitle')}
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              {t('health.fixAll', { count: safeIssueCount })}
            </button>
          )}
          <button
            type="button"
            onClick={onRecheck}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-60"
          >
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
            {t('health.checkAgain')}
          </button>
        </div>
      </div>

      {compatBusy && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 bg-slate-900/60 text-xs text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> {t('health.makingCopy')}
        </div>
      )}
      {mergeBusy && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 bg-slate-900/60 text-xs text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> {t('health.merging')}
        </div>
      )}
      {mergeResult && (
        <div className="flex flex-col gap-2 p-4 rounded-xl border border-indigo-800/60 bg-indigo-950/20 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-indigo-200 font-bold">
              <CheckCircle2 className="w-4 h-4 text-indigo-300" aria-hidden="true" />
              {t('health.mergedInto', { count: mergeResult.merged.length, package: mergeResult.package_folder })}
            </div>
            <button type="button" onClick={() => setMergeResult(null)} className="text-slate-500 hover:text-slate-300 cursor-pointer text-[11px]">{t('health.close')}</button>
          </div>
          {mergeResult.merged.length > 0 && (
            <ul className="list-disc pl-5 text-slate-300 space-y-0.5 font-mono">
              {mergeResult.merged.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {mergeResult.skipped.length > 0 && (
            <>
              <div className="text-amber-300 font-bold mt-1">{t('health.needDecision')}</div>
              <ul className="list-disc pl-5 text-amber-200/90 space-y-0.5 font-mono">
                {mergeResult.skipped.map((p) => (
                  <li key={p}>
                    {p}{' '}
                    <button type="button" onClick={() => onOpenMerger(p)} className="underline text-amber-100 cursor-pointer">{t('health.openInMerger')}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="text-slate-400">
            {t('health.packageWins')}
          </div>
        </div>
      )}
      {compatResult && (
        <div className="flex flex-col gap-2 p-4 rounded-xl border border-emerald-800/60 bg-emerald-950/20 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-200 font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              {t('health.copyReady', { mod: compatResult.mod_id, folder: compatResult.folder })}
            </div>
            <button type="button" onClick={() => setCompatResult(null)} className="text-slate-500 hover:text-slate-300 cursor-pointer text-[11px]">{t('health.close')}</button>
          </div>
          <ul className="list-disc pl-5 text-slate-300 space-y-0.5">
            {compatResult.changes.map((c, i) => <li key={i}><RichText text={c} foldAt={240} /></li>)}
          </ul>
          {compatResult.warnings.length > 0 ? (
            <>
              <div className="text-amber-300 font-bold mt-1">{t('health.mayBreak')}</div>
              <ul className="list-disc pl-5 text-amber-200/90 space-y-0.5">
                {compatResult.warnings.map((w, i) => <li key={i}><RichText text={w} foldAt={240} /></li>)}
              </ul>
            </>
          ) : (
            <div className="text-slate-400">{t('health.noLeftovers')}</div>
          )}
          <div className="text-slate-400" dangerouslySetInnerHTML={{ __html: tHtml('health.startFromStudio') }} />
        </div>
      )}

      {done && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 text-emerald-200 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{done}</span>
          <span className="text-emerald-500/70">{t('health.savedToList')}</span>
        </div>
      )}

      {report && report.issues.length === 0 && (
        <div className="flex items-center gap-3 p-5 rounded-xl border border-emerald-800/60 bg-emerald-950/30 text-emerald-200 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          {t('health.noProblems', { count: report.active_count })}
        </div>
      )}

      {(['error', 'warning', 'info'] as HealthSeverity[]).map((sev) =>
        grouped[sev].length === 0 ? null : (
          <section key={sev} className="flex flex-col gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 font-mono">
              {t(`health.severity.${sev}`)} ({grouped[sev].length})
            </h2>
            {grouped[sev].map((issue, idx) => {
              const style = SEVERITY_STYLE[sev];
              const Icon = style.icon;
              // "Enable X" + "Move X before Y" for the same issue are shown as one button doing both.
              const applicable = issue.fixes.filter((f) => ACTION_FIXES.has(f.action) || applyFix(mods, f) !== null);
              const enableThenMove = applicable.length === 2 && applicable[0].action === 'enable_mod' && applicable[1].action === 'move_before';
              const fixes = enableThenMove ? [applicable[0]] : applicable;
              return (
                <div
                  key={`${issue.code}-${issue.mod_id}-${idx}`}
                  data-issue-key={issueKey(issue)}
                  data-issue-code={`${issue.code}|${issue.mod_id ?? ''}`}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${style.row} ${litKey === issueKey(issue) ? 'ring-2 ring-cyan-400 shadow-lg shadow-cyan-900/50' : ''}`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.iconColor}`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    {issue.mod_id && (
                      <div className="text-[12.5px] font-bold text-slate-100 truncate">
                        {nameOf(issue.mod_id)}
                        {nameOf(issue.mod_id) !== issue.mod_id && <span className="ml-1.5 text-[10px] font-mono font-normal text-slate-500">{issue.mod_id}</span>}
                      </div>
                    )}
                    <RichText text={issueText(issue)} mods={modWords} foldAt={320} className="text-xs text-slate-300 leading-relaxed" />
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-slate-600">{issue.code}</span>
                      <button
                        type="button"
                        onClick={() => void copyForAssistant(issue)}
                        className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-200 cursor-pointer"
                        title={t('assistant.copyTitle')}
                      >
                        <MessageSquare className="w-3 h-3" aria-hidden="true" /> {t('assistant.copy')}
                      </button>
                    </div>
                    {issue.details && issue.details.length > 0 && (
                      <details className="mt-1.5">
                        <summary className="text-[11px] text-sky-300 cursor-pointer select-none">
                          {t('health.byFile', { count: issue.details.length })}
                        </summary>
                        <div className="mt-1.5 flex flex-col gap-1.5">
                          {issue.details.map((d) => (
                            <div key={`${d.mod_id}:${d.file}`} className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5">
                              <div className="text-[11px] text-slate-300">
                                <b className="text-slate-100">{d.mod_name}</b> <span className="font-mono text-slate-400">{d.file}</span>
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {d.declares.map((thing) => (
                                  <button
                                    key={thing.definition}
                                    type="button"
                                    onClick={() => onOpenMerger(thing.merged_path)}
                                    title={`${thing.definition}: ${thing.state === 'merged' ? t('health.thingMerged') : thing.state === 'stale' ? t('health.thingStale') : t('health.thingPending')}${t('health.thingClick')}`}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer ${
                                      thing.state === 'merged'
                                        ? 'border-emerald-800 text-emerald-300 bg-emerald-950/40'
                                        : thing.state === 'stale'
                                        ? 'border-amber-800 text-amber-300 bg-amber-950/40'
                                        : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                                    }`}
                                  >
                                    {thing.definition}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  {fixes.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5 shrink-0 max-w-[45%]">
                      {fixes.map((fix, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => (enableThenMove ? handleFixes(applicable) : handleFix(fix, issue))}
                          disabled={fix.action === 'merge_files' && mergeBusy}
                          className="px-2 py-1 rounded text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 cursor-pointer"
                        >
                          {YOUR_CALL_CODES.has(issue.code) && fix.action === 'move_before'
                            ? t('health.useVersionInstead', { name: nameOf(fix.before) })
                            : fixLabel(fix)}
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
