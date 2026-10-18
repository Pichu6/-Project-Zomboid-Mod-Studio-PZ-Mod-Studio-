import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, HeartPulse, Info, Loader2, RefreshCw, Wand2, XCircle } from 'lucide-react';
import { AutoMergeResult, CompatResult, HealthFix, HealthIssue, HealthReport, HealthSeverity, ModInfo } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, reportBackendError } from '../../services/tauri';
import { applyFix } from '../../utils/healthFix';

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
}

/** Fixes handled here (not by rewriting the mod list). */
const ACTION_FIXES = new Set<HealthFix['action']>([
  'subscribe_workshop', 'open_workshop_page', 'make_compatible_copy', 'keep_version', 'remove_compatible_copy', 'merge_files', 'open_in_merger',
]);

/** Fixes the "fix all" button may apply without asking: they only enable or reorder. */
const SAFE_FIX_ACTIONS = new Set<HealthFix['action']>(['enable_mod', 'move_before']);

/**
 * Issues whose fix is a matter of taste, not of the game's rules: two mods defining the same item
 * is not broken, and which version you want is nobody's call but yours. Their fix stays on its own
 * row and is kept out of the one-click button, which is for what the game itself would complain
 * about.
 */
const YOUR_CALL_CODES = new Set(['script_definition_conflict', 'script_definition_stale']);


const fixLabel = (fix: HealthFix): string => {
  switch (fix.action) {
    case 'enable_mod':
      return `Enable ${fix.mod_id}`;
    case 'disable_mod':
      return `Disable ${fix.mod_id}`;
    case 'move_before':
      return `Move ${fix.mod_id} before ${fix.before}`;
    case 'remove_from_list':
      return `Remove ${fix.entry} from the list`;
    case 'subscribe_workshop':
      return `Search Workshop for "${fix.hint}"`;
    case 'open_workshop_page':
      return 'Open Workshop page';
    case 'make_compatible_copy':
      return 'Make compatible copy';
    case 'keep_version':
      return 'Keep the version you have';
    case 'remove_compatible_copy':
      return 'Remove compatible copy';
    case 'merge_files':
      return 'Merge automatically';
    case 'open_in_merger':
      return 'Open in Merger';
  }
};

const SEVERITY_STYLE: Record<HealthSeverity, { icon: React.ElementType; row: string; iconColor: string; label: string }> = {
  error: { icon: XCircle, row: 'border-red-500/40 bg-red-950/30', iconColor: 'text-red-400', label: 'Errors' },
  warning: { icon: AlertTriangle, row: 'border-amber-500/40 bg-amber-950/20', iconColor: 'text-amber-400', label: 'Warnings' },
  info: { icon: Info, row: 'border-slate-700 bg-slate-900/50', iconColor: 'text-slate-400', label: 'Info' },
};

export const HealthModule: React.FC<HealthModuleProps> = ({ paths, mods, report, checking, onRecheck, onApplyModList, onModsChanged, onOpenMerger }) => {
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
        if (!confirm(`${modId} already has a compatible copy. Make a fresh one? The current copy is moved to Zomboid/PZModStudio_Backups/mods.`)) return;
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
    if (!confirm(`Remove the compatible copy of ${folder}? The game goes back to the original (which your build may not load). The copy is moved to Zomboid/PZModStudio_Backups/mods.`)) return;
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
    if (fix.action === 'keep_version') {
      void (async () => {
        try {
          const kept = await TauriService.keepModVersion(paths, fix.mod_id);
          say(`${kept.mod_name} as it is today is kept (${kept.kept_at}). If the update breaks a save: Mod List, right-click, Kept versions.`);
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
      if (!confirm(`Switch off ${name}?\n\nIt stays installed, and you can switch it back on in the Mod List.`)) return;
    }
    const next = applyFix(mods, fix);
    if (!next) return;
    onApplyModList(next);
    if (fix.action === 'move_before') {
      const moved = nameOf(fix.mod_id);
      const anchor = nameOf(fix.before);
      say(
        issue && YOUR_CALL_CODES.has(issue.code)
          ? `The game will now use ${anchor}'s version: ${moved} loads before it.`
          : `${moved} now loads before ${anchor}.`
      );
    } else if (fix.action === 'enable_mod') {
      say(`${nameOf(fix.mod_id)} is switched on.`);
    } else if (fix.action === 'disable_mod') {
      say(`${nameOf(fix.mod_id)} is switched off.`);
    } else if (fix.action === 'remove_from_list') {
      say(`${fix.entry} is out of the list.`);
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
      say('Nothing changed: those fixes are already in place.');
      return;
    }
    onApplyModList(next);
    say(`${applied} change${applied === 1 ? '' : 's'} made to your mod list.`);
  };

  /** The name the Mod List shows for a mod id. */
  const nameOf = (id: string) => mods.find((m) => m.mod_id === id)?.name ?? id;

  const safeFixes = useMemo(() => {
    if (!report) return [] as HealthFix[];
    return report.issues
      .filter((i) => !YOUR_CALL_CODES.has(i.code))
      .flatMap((i) => i.fixes.filter((f) => SAFE_FIX_ACTIONS.has(f.action)));
  }, [report]);

  const handleFixAllSafe = () => {
    const enabling = safeFixes.filter((f) => f.action === 'enable_mod').length;
    const moving = safeFixes.filter((f) => f.action === 'move_before').length;
    const parts = [
      enabling > 0 && `switch on ${enabling} ${enabling === 1 ? 'mod' : 'mods'} that others need`,
      moving > 0 && `move ${moving} ${moving === 1 ? 'mod' : 'mods'} earlier in the load order`,
    ].filter(Boolean);
    if (!confirm(`This will ${parts.join(' and ')}.\n\nNothing is switched off, and the Mod List can undo it.`)) return;
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
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        const c = await TauriService.refreshCommunityRules(paths);
                        say(`Community rules fetched: ${c.rules} load-order rule${c.rules === 1 ? '' : 's'}, ${c.pairs} incompatible pair${c.pairs === 1 ? '' : 's'}${c.updated ? `, updated ${c.updated}` : ''}.`);
                        onRecheck();
                      } catch {
                        // Already shown by TauriService.
                      }
                    })();
                  }}
                  className="px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                  title={
                    report.community
                      ? `Community rules in use: ${report.community.rules} load-order, ${report.community.pairs} incompatible pairs${report.community.updated ? `, updated ${report.community.updated}` : ''}. Fetched once a day from the Studio's repository (community/rules.json); click to fetch now.`
                      : 'No community rules at hand yet (fetched once a day from the Studio\'s repository, community/rules.json). Click to fetch now.'
                  }
                >
                  community rules: {report.community ? `${report.community.rules + report.community.pairs}` : 'none yet'} ↻
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
              title="Merges every conflicting file that has no overlapping changes into your patch package"
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              Merge {mergeablePaths.length} files automatically
            </button>
          )}
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

      {compatBusy && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 bg-slate-900/60 text-xs text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Making a compatible copy...
        </div>
      )}
      {mergeBusy && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 bg-slate-900/60 text-xs text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Merging conflicting files...
        </div>
      )}
      {mergeResult && (
        <div className="flex flex-col gap-2 p-4 rounded-xl border border-indigo-800/60 bg-indigo-950/20 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-indigo-200 font-bold">
              <CheckCircle2 className="w-4 h-4 text-indigo-300" aria-hidden="true" />
              {mergeResult.merged.length} {mergeResult.merged.length === 1 ? 'file' : 'files'} merged into {mergeResult.package_folder}
            </div>
            <button type="button" onClick={() => setMergeResult(null)} className="text-slate-500 hover:text-slate-300 cursor-pointer text-[11px]">Close</button>
          </div>
          {mergeResult.merged.length > 0 && (
            <ul className="list-disc pl-5 text-slate-300 space-y-0.5 font-mono">
              {mergeResult.merged.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {mergeResult.skipped.length > 0 && (
            <>
              <div className="text-amber-300 font-bold mt-1">These need your decision (two mods change the same lines):</div>
              <ul className="list-disc pl-5 text-amber-200/90 space-y-0.5 font-mono">
                {mergeResult.skipped.map((p) => (
                  <li key={p}>
                    {p}{' '}
                    <button type="button" onClick={() => onOpenMerger(p)} className="underline text-amber-100 cursor-pointer">Open in Merger</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="text-slate-400">
            The package is enabled at the end of your load order, so its merged files win. Check again after you add or update mods.
          </div>
        </div>
      )}
      {compatResult && (
        <div className="flex flex-col gap-2 p-4 rounded-xl border border-emerald-800/60 bg-emerald-950/20 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-200 font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              Compatible copy of {compatResult.mod_id} ready in Zomboid/mods/{compatResult.folder}
            </div>
            <button type="button" onClick={() => setCompatResult(null)} className="text-slate-500 hover:text-slate-300 cursor-pointer text-[11px]">Close</button>
          </div>
          <ul className="list-disc pl-5 text-slate-300 space-y-0.5">
            {compatResult.changes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
          {compatResult.warnings.length > 0 ? (
            <>
              <div className="text-amber-300 font-bold mt-1">May still break in game:</div>
              <ul className="list-disc pl-5 text-amber-200/90 space-y-0.5">
                {compatResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </>
          ) : (
            <div className="text-slate-400">No known Build 41 leftovers were found in it.</div>
          )}
          <div className="text-slate-400">
            Start the game from PZ Mod Studio so it uses the copy (from Steam, add the launch option
            <code className="mx-1">-modfolders mods,workshop,steam</code>). Test it in a new or backed-up save first.
          </div>
        </div>
      )}

      {done && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 text-emerald-200 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{done}</span>
          <span className="text-emerald-500/70">Saved to your mod list.</span>
        </div>
      )}

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
              const applicable = issue.fixes.filter((f) => ACTION_FIXES.has(f.action) || applyFix(mods, f) !== null);
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
                          onClick={() => (enableThenMove ? handleFixes(applicable) : handleFix(fix, issue))}
                          disabled={fix.action === 'merge_files' && mergeBusy}
                          className="px-2 py-1 rounded text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 cursor-pointer"
                        >
                          {YOUR_CALL_CODES.has(issue.code) && fix.action === 'move_before'
                            ? `Use ${nameOf(fix.before)}'s version instead`
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
