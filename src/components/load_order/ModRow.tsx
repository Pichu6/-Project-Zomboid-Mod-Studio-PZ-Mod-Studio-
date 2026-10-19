import React from 'react';
import { AppInstance, CatalogModSummary, HealthIssue, ModErrorStat, ModInfo } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { useTranslation } from 'react-i18next';
import { SourceBadge, sourceOf } from '../common/SourceBadge';
import { Tip, TipBody } from '../common/Tip';
import { RichText } from '../common/RichText';
import { RowHealthChips } from './RowHealth';
import { ArrowDown, ArrowUp, Check, ChevronsDown, ChevronsUp, Hash, ListOrdered, MapPin, Package, Star } from 'lucide-react';

/** Below this a mod's loading time is a few milliseconds of mod.info and translations: not worth a tag. */
export const SLOW_LOAD_MS = 250;

export interface ModRowBodyProps {
  paths: StudioPathsUI;
  mod: ModInfo;
  /** The mod's place in the whole list (not the filtered one). */
  originalIndex: number;
  mods: ModInfo[];
  isOpenedPackage: boolean;
  isClosedPackage: boolean;
  isBridge: boolean;
  catalogById?: Map<string, CatalogModSummary>;
  errorStats?: Map<string, ModErrorStat>;
  loadTimes?: Map<string, number>;
  /** In the player's Favorites list. */
  isFavorite?: boolean;
  /** Showing everything: say which profiles each mod belongs to. */
  showEveryMod: boolean;
  activeProfile: AppInstance | null;
  profilesByMod: Map<string, string[]>;
  inActiveProfile: Set<string>;
  rowIssues: HealthIssue[];
  /** The "Pos #" box, when it is open on this row. */
  isAssigningThis: boolean;
  targetPosInput: string;
  setTargetPosInput: (value: string) => void;
  setAssigningModId: (modId: string | null) => void;
  handleToggleSingleMod: (modId: string) => void;
  showToast: (message: string, ms?: number) => void;
  triggerReorder: (mods: ModInfo[]) => void;
  handleJumpToMod: (modId: string) => void;
  onOpenMerger?: (relativePath: string) => void;
  onGoToHealth?: (issue?: HealthIssue) => void;
  moveToTop: (index: number) => void;
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
  moveToBottom: (index: number) => void;
  handleAssignPosition: (modId: string, targetPos: number) => void;
}

/**
 * What one row of the Mod List shows: its number, its switch, its name with the badges (kind,
 * package state, source, last session's errors, profiles, build, the health check's chips) and
 * the position buttons. The row's frame -- drag and drop, selection, colour -- stays with the
 * list, which owns that state.
 */
export const ModRowBody: React.FC<ModRowBodyProps> = ({
  paths,
  mod,
  originalIndex,
  mods,
  isOpenedPackage,
  isClosedPackage,
  isBridge,
  catalogById,
  errorStats,
  loadTimes,
  isFavorite = false,
  showEveryMod,
  activeProfile,
  profilesByMod,
  inActiveProfile,
  rowIssues,
  isAssigningThis,
  targetPosInput,
  setTargetPosInput,
  setAssigningModId,
  handleToggleSingleMod,
  showToast,
  triggerReorder,
  handleJumpToMod,
  onOpenMerger,
  onGoToHealth,
  moveToTop,
  moveUp,
  moveDown,
  moveToBottom,
  handleAssignPosition,
}) => {
  const { t } = useTranslation();
  const entry = catalogById?.get(mod.mod_id);
  const source = sourceOf(mod.mod_id, entry);
  // A compatible copy is meant to win over the Workshop original it was made from; its source
  // tag says so, so "another copy is ignored" is no news on its row.
  const shownIssues = source.kind === 'compat' ? rowIssues.filter((i) => i.code !== 'shadowed_copy') : rowIssues;
  return (
  <>
    {/* Fixed Line Number (Original Load Order Index) */}
    <div title={t('modList.dragTitle')} className={`w-9 shrink-0 text-right font-mono text-[11px] cursor-grab ${isOpenedPackage ? 'text-amber-400 font-bold' : mod.enabled ? 'text-emerald-400 font-extrabold' : 'text-slate-600 font-medium'}`}>
      #{originalIndex + 1}
    </div>

    {/* Enable/Disable Toggle Checkbox */}
    <div className="w-8 shrink-0 flex justify-center">
      <button
        disabled={isOpenedPackage}
        onClick={(e) => {
          e.stopPropagation();
          if (!isOpenedPackage) {
            handleToggleSingleMod(mod.mod_id);
          }
        }}
        className={`w-5 h-5 rounded-md flex items-center justify-center transition border ${
          isOpenedPackage
            ? 'cursor-not-allowed opacity-40 bg-slate-900 text-slate-600 border-amber-800/50'
            : 'cursor-pointer'
        } ${
          mod.enabled && !isOpenedPackage
            ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30 border-emerald-400 font-bold'
            : !isOpenedPackage
            ? 'bg-slate-950 text-slate-700 border-slate-700 hover:border-slate-500'
            : ''
        }`}
        title={isOpenedPackage ? t('modList.row.draftLocked') : mod.enabled ? t('modList.row.clickDisable') : t('modList.row.clickEnable')}
      >
        {mod.enabled && !isOpenedPackage && <Check className="w-3.5 h-3.5 stroke-[3]" />}
      </button>
    </div>

    {/* Kind icon, then the name on a line of its own and the tags under it, on the right. */}
    <div
      className={`w-6 h-6 rounded border flex items-center justify-center shrink-0 ${
        mod.enabled
          ? 'bg-slate-900 border-slate-800'
          : 'bg-slate-950/80 border-slate-900 opacity-60'
      }`}
      title={mod.is_map_mod ? t('modList.row.mapMod') : mod.is_library ? t('modList.row.libraryMod') : t('modList.row.scriptMod')}
    >
      {mod.is_map_mod ? (
        <MapPin className={`w-3.5 h-3.5 ${mod.enabled ? 'text-amber-400' : 'text-amber-700'}`} />
      ) : mod.is_library ? (
        <Package className={`w-3.5 h-3.5 ${mod.enabled ? 'text-purple-400' : 'text-purple-700'}`} />
      ) : (
        <ListOrdered className={`w-3.5 h-3.5 ${mod.enabled ? 'text-cyan-400' : 'text-cyan-700'}`} />
      )}
    </div>

    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`truncate min-w-0 ${mod.enabled ? 'font-bold text-slate-100' : 'font-medium text-slate-400/80'}`}
          title={mod.name}
        >
          {mod.name}
        </span>
        {isFavorite && <Star className="w-3 h-3 shrink-0 text-amber-400 fill-amber-400" aria-label="In Favorites" />}
      </div>

      <div className="flex items-start gap-2 min-w-0">
        <div className={`text-[10px] font-mono truncate min-w-[4rem] flex-1 pt-0.5 ${mod.enabled ? 'text-emerald-500/80' : 'text-slate-600'}`} title={mod.mod_id}>
          ID: {mod.mod_id}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1 max-w-[78%]">
          {isBridge && (
            <Tip content={<TipBody title={t('modList.row.bridge')} tone="cyan">{t('modList.row.bridgeTitle')}</TipBody>}>
              <span className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-700 shrink-0 shadow-sm">
                <Package className="w-3 h-3 text-cyan-400" />
                <span>{t('modList.row.bridge')}</span>
              </span>
            </Tip>
          )}

          {isOpenedPackage && (
            <Tip content={<TipBody title={t('modList.row.openDraftHead', { id: mod.mod_id })} tone="amber"><RichText text={t('modList.row.openDraftBody')} /></TipBody>}>
              <span className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-600 shrink-0 shadow-sm cursor-help animate-pulse">
                <Package className="w-3 h-3 text-amber-400" />
                <span>{t('modList.row.openDraft')}</span>
              </span>
            </Tip>
          )}

          {isClosedPackage && (
            <Tip content={<TipBody title={t('modList.row.packagedHead', { id: mod.mod_id })} tone="emerald">{t('modList.row.packagedBody')}</TipBody>}>
              <span className="flex items-center gap-1 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-600 shrink-0 shadow-sm cursor-help">
                <Package className="w-3 h-3 text-emerald-400" />
                <span>{t('modList.row.packaged')}</span>
              </span>
            </Tip>
          )}

          {!mod.enabled && (
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-900 text-slate-600 border border-slate-800 shrink-0">
              {t('modList.row.off')}
            </span>
          )}

          {mod.not_installed && (
            <Tip content={<TipBody title={t('modList.row.notInstalled')} tone="red"><RichText text={t('modList.row.notInstalledBody')} /></TipBody>}>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/50 shrink-0">
                {t('modList.row.notInstalled')}
              </span>
            </Tip>
          )}

          {mod.loadable_on_installed_build === false && !mod.enabled && (
            <Tip content={<TipBody title={t('modList.row.notForBuild')} tone="amber"><RichText text={t('modList.row.notForBuildTitle')} /></TipBody>}>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/50 shrink-0">
                {t('modList.row.notForBuild')}
              </span>
            </Tip>
          )}

          <SourceBadge modId={mod.mod_id} entry={entry} />

          {/* What the game laid at this mod's door last session, counted from console.txt. */}
          {(() => {
            const stat = errorStats?.get(mod.name);
            if (!stat || (stat.exceptions === 0 && stat.warnings === 0)) return null;
            const threw = stat.exceptions > 0;
            const line = stat.last_exception ?? stat.last_warning ?? '';
            return (
              <Tip
                content={
                  <TipBody
                    title={threw ? t('modList.row.errorsHead', { count: stat.exceptions }) : t('modList.row.warningsHead', { count: stat.warnings })}
                    tone={threw ? 'red' : 'amber'}
                    footnote={t('modList.row.fromConsoleNote')}
                  >
                    <div className="flex flex-col gap-1.5">
                      <div>
                        {threw ? t('modList.row.errorsTitle', { count: stat.exceptions }) : t('modList.row.warningsTitle', { count: stat.warnings })}
                        {threw && stat.warnings > 0 ? t('modList.row.alsoWarnings', { count: stat.warnings }) : ''}
                      </div>
                      {line && (
                        <div>
                          <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500">{t('modList.row.lastLineLabel')}</div>
                          <div className="font-mono text-[10.5px] text-red-200/90 bg-slate-900 border border-slate-800 rounded px-1.5 py-1 break-all">{line}</div>
                        </div>
                      )}
                      {line.includes('require(') && <RichText text={t('modList.row.requireHint')} />}
                    </div>
                  </TipBody>
                }
              >
                <span
                  className={`text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                    threw ? 'bg-red-950/60 text-red-300 border-red-800/70' : 'bg-slate-900 text-slate-400 border-slate-700'
                  }`}
                >
                  {threw ? t('modList.row.threw', { count: stat.exceptions }) : t('modList.row.warn', { count: stat.warnings })}
                </span>
              </Tip>
            );
          })()}

          {/* Its files' share of the loading screen last session, when it is worth a word. */}
          {(() => {
            const ms = loadTimes?.get(mod.mod_id);
            if (ms === undefined || ms < SLOW_LOAD_MS) return null;
            const slow = ms >= 1000;
            const time = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
            return (
              <Tip
                content={
                  <TipBody
                    title={t('modList.row.loadsInHead', { time })}
                    tone={slow ? 'amber' : 'slate'}
                    footnote={<RichText text={t('modList.row.loadTimeHow', { min: SLOW_LOAD_MS })} foldAt={140} />}
                  >
                    <RichText text={t('modList.row.loadTimeBody', { time: ms >= 1000 ? t('modList.row.seconds', { n: (ms / 1000).toFixed(1) }) : t('modList.row.millis', { n: ms }) })} />
                  </TipBody>
                }
              >
                <span
                  className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                    slow ? 'bg-amber-950/50 text-amber-300 border-amber-800/70' : 'bg-slate-900 text-slate-400 border-slate-700'
                  }`}
                >
                  {t('modList.row.loadsIn', { time })}
                </span>
              </Tip>
            );
          })()}

          {/* Showing everything: say which profiles each mod belongs to. */}
          {showEveryMod && activeProfile && (() => {
            const usedBy = profilesByMod.get(mod.mod_id) ?? [];
            const others = usedBy.filter((name) => name !== activeProfile.name);
            if (inActiveProfile.has(mod.mod_id)) {
              return (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-emerald-700/60 text-emerald-300 shrink-0"
                  title={t('modList.row.inThisProfile') + (others.length ? t('modList.row.andIn', { names: others.join(', ') }) : '')}
                >
                  {t('modList.row.inProfile', { name: activeProfile.name })}
                </span>
              );
            }
            return (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 shrink-0"
                title={others.length ? t('modList.row.usedBy', { names: others.join(', ') }) : t('modList.row.noProfileYet')}
              >
                {others.length ? t('modList.row.inProfile', { name: others.join(', ') }) : t('modList.row.noProfile')}
              </span>
            );
          })()}

          {/* Every problem the health check found for this mod, with its fix. */}
          <RowHealthChips
            paths={paths}
            issues={shownIssues}
            onNote={showToast}
            mods={mods}
            onApplyList={triggerReorder}
            onJumpToMod={handleJumpToMod}
            onOpenMerger={onOpenMerger}
            onGoToHealth={onGoToHealth}
          />
        </div>
      </div>
    </div>

    <div className="min-w-[150px] shrink-0 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
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
          title={t('modList.row.assignPosition')}
        >
          <Hash className="w-3 h-3 text-emerald-400" />
          <span>{t('modList.row.pos')}</span>
        </button>
      )}

      <button
        onClick={() => moveToTop(originalIndex)}
        disabled={originalIndex === 0}
        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
        title={t('modList.row.toTop')}
      >
        <ChevronsUp className="w-3.5 h-3.5 text-emerald-400" />
      </button>
      <button
        onClick={() => moveUp(originalIndex)}
        disabled={originalIndex === 0}
        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
        title={t('modList.row.up')}
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => moveDown(originalIndex)}
        disabled={originalIndex === mods.length - 1}
        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
        title={t('modList.row.down')}
      >
        <ArrowDown className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => moveToBottom(originalIndex)}
        disabled={originalIndex === mods.length - 1}
        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition cursor-pointer"
        title={t('modList.row.toBottom')}
      >
        <ChevronsDown className="w-3.5 h-3.5 text-amber-400" />
      </button>
    </div>
  </>
  );
};
