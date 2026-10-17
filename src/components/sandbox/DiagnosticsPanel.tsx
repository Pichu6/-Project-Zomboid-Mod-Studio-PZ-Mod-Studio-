import React, { useEffect, useMemo, useState } from 'react';
import { TranslatedErrorCard, ModInfo, RequireAnswer } from '../../types';
import { BisectPanel } from './BisectPanel';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, explainError, reportBackendError } from '../../services/tauri';
import { applyRequireFix, packageForPatch } from '../../utils/requireFix';
import { errorShape } from '../../utils/errorShape';
import { AlertCircle, AlertTriangle, Check, CheckCircle, Copy, Download, Search, Trash2, Wrench, X } from 'lucide-react';

/** The game names a Studio package when it read the package's patched copy of a mod's file. */
const STUDIO_PACKAGE_PREFIX = 'PZ Mod Studio Patch: ';

interface DiagnosticsPanelProps {
  paths: StudioPathsUI;
  /** The installed mods: to find a mod the log named, and for the hunt. */
  mods: ModInfo[];
  errorCards: TranslatedErrorCard[];
  /** The lines of the log in front of the user, for counts and for the stack under an error. */
  logLines: string[];
  /** The live console's lines, which go into a report as the context around the error. */
  reportLines: string[];
  /** Re-reads the Mod List after a fix has written to disk. */
  onRefreshMods: () => void;
  /** The Build 42 shim travels inside a merge package, so repairs start in the Merger. */
  onOpenMerger: () => void;
  /** Switches a mod off by name, for when the game blames it for an error. */
  onSwitchOffMod?: (modName: string) => void;
  /** Opens the Merger on this mod's files to patch one; with a file name from the log, that file. */
  onPatchMod?: (modId: string, fileHint?: string | null, fix?: { from: string; to: string } | null) => void;
  onClearErrorCards?: () => void;
  /** Removes one card, once what it reported has been fixed. */
  onDismissErrorCard?: (cardId: string) => void;
  /** Puts a term in the console search on the left. */
  onInspect: (term: string) => void;
  /** A short note for the console's status badge ("Saved to ..."). */
  onStatus: (message: string) => void;
}

/**
 * The right column of the Monitor: what the game threw and what it warned about, one card each,
 * with what can be done from here -- a known require fix published into the package, a copy taken
 * out of it, a file opened in the Merger, a mod switched off -- and the hunt for what the log
 * cannot name.
 */
export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  paths,
  mods,
  errorCards,
  logLines,
  reportLines,
  onRefreshMods,
  onOpenMerger,
  onSwitchOffMod,
  onPatchMod,
  onClearErrorCards,
  onDismissErrorCard,
  onInspect,
  onStatus,
}) => {
  const [copiedCardId, setCopiedCardId] = useState<string | null>(null);

  /**
   * Gathers everything about one error into a file. The log the Monitor already holds goes in as
   * context, so whoever reads it can see what led up to the error.
   */
  const buildReportFor = async (card: TranslatedErrorCard): Promise<string | null> => {
    const lines = reportLines;
    const at = lines.findIndex((l) => l === card.raw_error);
    const from = at >= 0 ? Math.max(0, at - 15) : Math.max(0, lines.length - 20);
    const to = at >= 0 ? Math.min(lines.length, at + 10) : lines.length;
    try {
      return await TauriService.buildErrorReport(paths, {
        rawError: card.raw_error,
        title: card.title,
        explanation: card.explanation,
        modName: card.mod_name ?? null,
        sourceFile: card.source_file ?? null,
        logContext: lines.slice(from, to),
      });
    } catch (err) {
      reportBackendError('Writing the error report', err);
      return null;
    }
  };

  const handleSaveReport = async (card: TranslatedErrorCard) => {
    const report = await buildReportFor(card);
    if (!report) return;
    const slug = (card.mod_name ?? 'error').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const path = await TauriService.pickSaveFile(`pz-error-${slug || 'report'}.md`, 'Markdown (.md)', 'md');
    if (!path) return;
    try {
      await TauriService.saveTextFile(path, report);
      onStatus(`Saved to ${path}`);
    } catch (err) {
      reportBackendError('Saving the error report', err);
    }
  };

  const handleCopyReport = async (card: TranslatedErrorCard) => {
    const report = await buildReportFor(card);
    if (!report) return;
    await navigator.clipboard.writeText(report);
    onStatus('Report copied to the clipboard');
  };

  const handleInspectInConsole = (card: TranslatedErrorCard) => {
    let term = '';
    if (card.source_file) {
      term = card.source_file.split(/[/|\\]/).pop() || '';
    } else if (card.raw_error) {
      const match = card.raw_error.match(/([a-zA-Z0-9_]+\.lua|[a-zA-Z0-9_]+Exception|[a-zA-Z0-9_]+State|isLocalPlayer|ToggleDoor|BWORoomPrograms)/);
      term = match ? match[1] : card.raw_error.slice(0, 25);
    }
    onInspect(term);
  };

  const handleCopyCardSnippet = (cardId: string, snippet: string) => {
    navigator.clipboard.writeText(snippet);
    setCopiedCardId(cardId);
    setTimeout(() => setCopiedCardId(null), 2000);
  };

  /**
   * How many error lines of each shape the log in front of you holds, so a card can say whether
   * it happened once or six hundred times. Counted from the log itself rather than remembered as
   * cards arrive, so it is the same for a live session and a log loaded from disk.
   */
  const errorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const line of logLines) {
      if (!line.startsWith('ERROR')) continue;
      total += 1;
      const shape = errorShape(line);
      counts.set(shape, (counts.get(shape) ?? 0) + 1);
    }
    return { counts, total, distinct: counts.size };
  }, [logLines]);

  const timesSeen = (card: TranslatedErrorCard) => errorCounts.counts.get(errorShape(card.raw_error)) ?? 0;

  /**
   * What threw and what merely complained, kept apart: seven `require` warnings under a red
   * "Action Required" made a list that played fine look broken. The level the game wrote the
   * line at is the measure, and the cards that threw come first.
   */
  const isWarning = (card: TranslatedErrorCard) => card.severity === 'WARNING';

  /** The log names a mod by its display name; the Merger needs its id. */
  const modIdNamed = (name: string | null | undefined): string | null => {
    if (!name) return null;
    const hit = mods.find((m) => m.name === name || m.mod_id === name);
    return hit ? hit.mod_id : null;
  };
  /** `ZombiesAmputation.lua` from a card's source file, for the Merger to find in the mod. */
  const fileNamed = (card: TranslatedErrorCard): string | null =>
    card.source_file ? card.source_file.split(/[/\\]/).pop() || null : null;
  const exceptionCards = useMemo(() => errorCards.filter((c) => !isWarning(c)), [errorCards]);
  const warningCards = useMemo(() => errorCards.filter(isWarning), [errorCards]);
  const orderedCards = useMemo(() => [...exceptionCards, ...warningCards], [exceptionCards, warningCards]);

  /**
   * `require("X") failed` is the commonest complaint in a Build 42 log and says nothing you can
   * act on by itself. The module is usually still there under another path, sometimes in another
   * mod, sometimes nowhere at all -- and which of the three it is decides what to do about it.
   * Looked up for every such card at once, since the index costs the same for one or twenty.
   */
  const [requireAnswers, setRequireAnswers] = useState<Record<string, RequireAnswer>>({});

  const moduleWanted = (card: TranslatedErrorCard): string | null => {
    const found = card.raw_error.match(/require\(\s*["']([^"']+)["']\s*\)/);
    return found ? found[1] : null;
  };
  /**
   * "Fix the path" from the card, with no trip to the Merger: the file is read from the mod, the
   * require rewritten, and the result published into the package in place -- the package stays
   * packaged, nothing is unpacked. What the card then says is what happened, and what is left
   * (relaunch the game) is the only step the Studio cannot take.
   */
  const [fixNotes, setFixNotes] = useState<Record<string, string>>({});
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixedBanner, setFixedBanner] = useState<string | null>(null);
  const handleFixPath = async (card: TranslatedErrorCard, fix: { from: string; to: string }) => {
    setFixing(card.id);
    try {
      // The files that ask for the module, in every active mod. The log names the file on some
      // lines and on others (`KahluaThread.call > require(...)`) nobody -- and then the mod the
      // card names is a guess from the lines above, which is wrong when two mods' files load one
      // after the other. The module is the one thing the line says for certain.
      const asking = await TauriService.activeModsFilesRequiring(paths, fix.from);
      if (asking.length === 0) {
        setFixNotes((prev) => ({
          ...prev,
          [card.id]: `No file of any active mod asks for ${fix.from} in a way the Studio can rewrite, so there is nothing to change.`,
        }));
        return;
      }
      const packages = await TauriService.listMergedPackages(paths.user_zomboid_dir || '', paths.mod_list_ini_path || '');
      const folder = packageForPatch(packages);
      const display = packages.find((p) => p.folder_name === folder)?.display_name ?? folder;
      const done: string[] = [];
      for (const { mod_id, mod_name, file } of asking) {
        const opened = await TauriService.modFileToPatch(paths, mod_id, file.relative_path);
        const fixed = applyRequireFix(opened.merged_output || opened.base_content, fix);
        if (!fixed) continue;
        await TauriService.publishFileIntoPackage(paths, folder, opened.relative_path, fixed.content);
        done.push(`${file.relative_path.split('/').pop()} of ${mod_name} (line ${fixed.line})`);
      }
      if (done.length === 0) {
        setFixNotes((prev) => ({ ...prev, [card.id]: `Nothing to rewrite for ${fix.from}.` }));
        return;
      }
      // Done: the card goes, and one line above the list says what happened and what is left.
      setFixedBanner(
        `${done.join(', ')} now ${done.length === 1 ? 'asks' : 'ask'} for ${fix.to}, published in ${display}. Relaunch the game; this warning should not come back.`
      );
      onDismissErrorCard?.(card.id);
      onRefreshMods();
    } catch (err) {
      setFixNotes((prev) => ({ ...prev, [card.id]: explainError(err) }));
    } finally {
      setFixing(null);
    }
  };

  /**
   * Takes the package's copy of a mod file out, from the card. A copy that changed nothing only
   * freezes the file and gets the package blamed for the mod's own lines; a copy that did change
   * something is the player's, so they are asked first.
   */
  const handleRemoveCopy = async (card: TranslatedErrorCard) => {
    const file = fileNamed(card);
    const display = (card.mod_name ?? '').slice(STUDIO_PACKAGE_PREFIX.length);
    if (!file || !display) return;
    if (
      !window.confirm(
        `Take ${file} out of ${display}?\n\nThe package is published again without it, and the game reads the mod's own ${file} on its next launch. If you edited the copy, those edits go.`
      )
    )
      return;
    setFixing(card.id);
    try {
      const packages = await TauriService.listMergedPackages(paths.user_zomboid_dir || '', paths.mod_list_ini_path || '');
      const folder = packages.find((p) => p.display_name === display)?.folder_name ?? `Z_PZModStudio_${display.replace(/ /g, '_')}`;
      const result = await TauriService.removeFileFromPackage(paths, folder, file);
      setFixedBanner(
        `${file} is out of ${display} (${result.files_written} files left). Relaunch the game; it reads the mod's own copy again, and if the mod's line still warns, the card names the mod.`
      );
      onDismissErrorCard?.(card.id);
      onRefreshMods();
    } catch (err) {
      setFixNotes((prev) => ({ ...prev, [card.id]: explainError(err) }));
    } finally {
      setFixing(null);
    }
  };

  /** A `require` the Studio found at another path: the fix is known before the file is opened. */
  const knownFix = (card: TranslatedErrorCard): { from: string; to: string } | null => {
    const wanted = moduleWanted(card);
    const best = wanted ? requireAnswers[wanted]?.candidates[0] : undefined;
    return wanted && best && !best.same_path ? { from: wanted, to: best.module_path } : null;
  };

  useEffect(() => {
    const wanted = Array.from(
      new Set(errorCards.map(moduleWanted).filter((w): w is string => !!w))
    ).filter((w) => !(w in requireAnswers));
    if (wanted.length === 0 || !paths.is_valid) return;
    let alive = true;
    void (async () => {
      const answers = await TauriService.resolveFailedRequires(paths, wanted);
      if (!alive) return;
      setRequireAnswers((current) => {
        const next = { ...current };
        for (const a of answers) next[a.wanted] = a;
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [errorCards, paths.is_valid]);

  /**
   * The mod a card belongs to when the error line itself does not say.
   *
   * The game writes `ERROR ... Exception thrown` first and the stack trace after it, and it is
   * the frames that carry `Lua((MOD:Name))`. The backend only sees one line at a time, so it
   * cannot look ahead; here the whole log is in front of us, so the frames just below the error
   * are read for the name.
   */
  const modFromStack = (card: TranslatedErrorCard): string | null => {
    const at = logLines.findIndex((l) => l.includes(card.raw_error.trim()));
    if (at < 0) return null;
    for (const line of logLines.slice(at, at + 30)) {
      const found = line.match(/Lua\(\(MOD:(.+?)\)\)/);
      if (found) return found[1];
    }
    return null;
  };

  return (
    <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow p-4 space-y-3 min-h-0">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div>
          <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
            <span>DIAGNOSTICS</span>
            {exceptionCards.length > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-mono"
                title="Something threw: the game wrote these at ERROR level or as a stack trace"
              >
                {exceptionCards.length} {exceptionCards.length === 1 ? 'exception' : 'exceptions'} · Action Required
              </span>
            )}
            {warningCards.length > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono"
                title="The game noticed and carried on: WARN lines that name a mod"
              >
                {warningCards.length} {warningCards.length === 1 ? 'warning' : 'warnings'}
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {exceptionCards.length > 0 ? (
              <>
                {errorCounts.total.toLocaleString()} error lines in this log are{' '}
                {errorCounts.distinct} different problems: the game writes the same failure
                again every time it happens.
              </>
            ) : warningCards.length > 0 ? (
              <>
                Nothing threw in this log: the game carried on past every line below.
                {errorCounts.total > 0 && (
                  <>
                    {' '}It also wrote {errorCounts.total.toLocaleString()} ERROR lines of{' '}
                    {errorCounts.distinct} {errorCounts.distinct === 1 ? 'shape' : 'shapes'} that
                    name no mod and match no rule here; the Errors filter on the left shows them.
                  </>
                )}
              </>
            ) : errorCounts.total > 0 ? (
              <>
                {errorCounts.total.toLocaleString()} ERROR lines of {errorCounts.distinct}{' '}
                {errorCounts.distinct === 1 ? 'shape' : 'shapes'}, none naming a mod or matching a
                rule here; the Errors filter on the left shows them.
              </>
            ) : (
              <>Exceptions the game throws and warnings it names a mod on, as they happen.</>
            )}
          </p>
        </div>

        {errorCards.length > 0 ? (
          <button
            onClick={onClearErrorCards}
            className="text-[10px] text-slate-400 hover:text-slate-200 font-mono bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2 py-1 rounded transition cursor-pointer flex items-center gap-1"
            title="Discard all cards"
          >
            <Trash2 className="w-3 h-3 text-slate-400" />
            <span>Discard</span>
          </button>
        ) : (
          <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
            <CheckCircle className="w-3.5 h-3.5" /> Nothing threw
          </span>
        )}
      </div>

      {fixedBanner && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-950/50 border border-emerald-700/60 text-[11px] text-emerald-200 leading-relaxed shrink-0">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="flex-1">{fixedBanner}</span>
          <button
            type="button"
            onClick={() => setFixedBanner(null)}
            className="text-emerald-400 hover:text-emerald-200 cursor-pointer"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* For what the log cannot name: halve the list until one mod is left. */}
      <BisectPanel
        paths={paths}
        mods={mods}
        onRefreshMods={onRefreshMods}
        cards={errorCards}
        onInspect={onInspect}
        onPatchMod={onPatchMod}
      />

      <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
        {errorCards.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2.5">
            <div className="w-12 h-12 rounded-xl bg-emerald-950/40 border border-emerald-800/40 flex items-center justify-center text-emerald-400">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-300">Nothing to report</p>
              <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
                A card appears when the game throws, or when it writes a warning and names the
                mod. Everything else in the console stays on the left.
              </p>
            </div>
          </div>
        ) : (
          orderedCards.map((card) => (
            <div
              key={card.id}
              className={
                isWarning(card)
                  ? 'bg-slate-950 border border-amber-500/30 rounded-xl p-4 space-y-3 shadow-md hover:border-amber-500/60 transition'
                  : 'bg-slate-950 border border-red-500/40 rounded-xl p-4 space-y-3 shadow-md hover:border-red-500/70 transition'
              }
            >
              <div className="flex items-start gap-2.5">
                {isWarning(card) ? (
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-100">
                      {card.title}
                      {isWarning(card) && (
                        <span
                          className="ml-2 align-middle text-[10px] font-mono font-normal px-1.5 py-0.5 rounded border border-amber-700/60 bg-amber-950/40 text-amber-300"
                          title="The game wrote this at WARN level: it noticed and carried on"
                        >
                          warning · the game carried on
                        </span>
                      )}
                    </h4>
                    {timesSeen(card) > 1 && (
                      <span
                        className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-red-800/70 bg-red-950/50 text-red-300"
                        title={`This error is in the log ${timesSeen(card)} times${
                          errorCounts.total > 0
                            ? ` — ${Math.round((timesSeen(card) / errorCounts.total) * 100)}% of every error line`
                            : ''
                        }. The ones that repeat are the ones worth fixing first.`}
                      >
                        {timesSeen(card).toLocaleString()}×
                      </span>
                    )}
                  </div>
                  {(card.mod_name ?? modFromStack(card)) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-700/60 text-amber-300"
                        title={
                          card.mod_name
                            ? 'The game named this mod on the log line'
                            : 'The game named this mod in the stack trace under the error'
                        }
                      >
                        {card.mod_name ?? modFromStack(card)}
                      </span>
                      {(card.mod_name ?? '').startsWith(STUDIO_PACKAGE_PREFIX) ? (
                        /* The package's patched copy of a mod file. Taking it out is done from
                           here; the game then reads the mod's own file again. */
                        fileNamed(card) && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveCopy(card)}
                            disabled={fixing === card.id}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-amber-700/60 text-amber-200 hover:bg-amber-950/40 cursor-pointer flex items-center gap-1 disabled:opacity-50"
                            title={`Take ${fileNamed(card)} out of ${card.mod_name!.slice(STUDIO_PACKAGE_PREFIX.length)}, published in place. The game reads the mod's own copy again on its next launch. Any edit you made to the copy goes with it.`}
                          >
                            <Wrench className="w-3 h-3" aria-hidden="true" />
                            {fixing === card.id ? 'Removing…' : `Remove the copy of ${fileNamed(card)}`}
                          </button>
                        )
                      ) : onPatchMod &&
                        modIdNamed(card.mod_name ?? modFromStack(card)) &&
                        /* A warning the Studio has no fix for gets no button: pressing one
                           led to saving an unchanged copy, which fixes nothing. */
                        (!isWarning(card) || knownFix(card)) && (
                        <button
                          type="button"
                          onClick={() => {
                            const modId = modIdNamed(card.mod_name ?? modFromStack(card))!;
                            const fix = knownFix(card);
                            // A known fix is done from here, whether or not the log named the
                            // file; only an exception with no known fix goes to the Merger.
                            if (fix) void handleFixPath(card, fix);
                            else onPatchMod(modId, fileNamed(card), null);
                          }}
                          disabled={fixing === card.id}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-amber-700/60 text-amber-200 hover:bg-amber-950/40 cursor-pointer flex items-center gap-1 disabled:opacity-50"
                          title={
                            knownFix(card)
                              ? `Rewrite the require in every file of this mod that asks for ${knownFix(card)!.from}, to the path the module has now, and publish them into the package in place. The mod stays on; relaunch the game afterwards.`
                              : fileNamed(card)
                              ? `Open ${fileNamed(card)} from this mod in the Merger and patch it. The mod stays on; the package loads last, so the game reads your copy of that one file.`
                              : 'Open this mod in the Merger and pick a file to patch. The mod stays on; the package loads last.'
                          }
                        >
                          <Wrench className="w-3 h-3" aria-hidden="true" />
                          {fixing === card.id
                            ? 'Fixing…'
                            : knownFix(card)
                            ? fileNamed(card)
                              ? `Fix the path in ${fileNamed(card)}`
                              : 'Fix the path'
                            : fileNamed(card)
                            ? `Patch ${fileNamed(card)}`
                            : 'Patch a file of it'}
                        </button>
                      )}
                      {fixNotes[card.id] && (
                        <div className="basis-full text-[10px] text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded px-2 py-1 leading-relaxed">
                          {fixNotes[card.id]}
                        </div>
                      )}
                      {onSwitchOffMod && !(card.mod_name ?? '').startsWith(STUDIO_PACKAGE_PREFIX) && (
                        <button
                          type="button"
                          onClick={() => onSwitchOffMod((card.mod_name ?? modFromStack(card))!)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                          title={`Switch ${card.mod_name ?? modFromStack(card)} off in the Mod List, to see whether it is the cause`}
                        >
                          Switch it off
                        </button>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    {card.explanation}
                  </p>
                </div>
              </div>

              <div className="bg-slate-900 p-2.5 rounded-lg font-mono text-[11px] text-red-300 border border-slate-800 select-text">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Log Snippet</div>
                <div className="truncate">{card.raw_error}</div>
              </div>

              {/* Where the module it asked for actually is. */}
              {(() => {
                const wanted = moduleWanted(card);
                const answer = wanted ? requireAnswers[wanted] : undefined;
                if (!answer) return null;
                const best = answer.candidates[0];
                return (
                  <div className="px-2.5 py-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 leading-relaxed space-y-1">
                    <div>{answer.summary}</div>
                    {best && !best.same_path && (
                      <div className="font-mono text-[10px] text-emerald-300">
                        {answer.wanted} &rarr; {best.module_path}
                      </div>
                    )}
                  </div>
                );
              })()}

              {card.polyfill_rule_id_suggestion ? (
                <button
                  onClick={onOpenMerger}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
                  title="The Build 42 shim ships inside a merge package: build one in the Mod Merger"
                >
                  <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>A merge package may fix this — open the Mod Merger</span>
                </button>
              ) : card.mod_name ? (
                /* The game named a mod: say what to do about that, not what the shim covers. */
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                  {card.recommended_action}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-[11px] text-emerald-300">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                  <span>The Build 42 shim already covers this</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  onClick={() => handleSaveReport(card)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium transition cursor-pointer"
                  title="Writes a file with the error, your game build, the mod and the code, ready to hand to someone or to an AI assistant"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Save report</span>
                </button>
                <button
                  onClick={() => handleCopyReport(card)}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium transition cursor-pointer"
                  title="Copies the same report to the clipboard"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Copy report</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  onClick={() => handleInspectInConsole(card)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium transition cursor-pointer"
                  title="Jump to this error in the console logs"
                >
                  <Search className="w-3 h-3 text-cyan-400" />
                  <span>🔍 Inspect in Logs</span>
                </button>
                <button
                  onClick={() => handleCopyCardSnippet(card.id, card.raw_error)}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 text-[11px] font-medium transition cursor-pointer"
                  title="Copy error snippet to clipboard"
                >
                  {copiedCardId === card.id ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-slate-400" />
                      <span>Copy the line</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
