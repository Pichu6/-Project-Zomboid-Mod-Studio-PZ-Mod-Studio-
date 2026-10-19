import React from 'react';
import { AppInstance, CatalogModSummary, HealthIssue, ModErrorStat, ModInfo } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { SourceBadge } from '../common/SourceBadge';
import { RowHealthChips } from './RowHealth';
import { ArrowDown, ArrowUp, Check, ChevronsDown, ChevronsUp, Hash, ListOrdered, MapPin, Package, Star } from 'lucide-react';

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
}) => (
  <>
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
          {isFavorite && <Star className="w-3 h-3 shrink-0 text-amber-400 fill-amber-400" aria-label="In Favorites" />}

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

          {/* What the game laid at this mod's door last session, counted from console.txt. */}
          {(() => {
            const stat = errorStats?.get(mod.name);
            if (!stat || (stat.exceptions === 0 && stat.warnings === 0)) return null;
            const threw = stat.exceptions > 0;
            return (
              <span
                className={`text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                  threw ? 'bg-red-950/60 text-red-300 border-red-800/70' : 'bg-slate-900 text-slate-400 border-slate-700'
                }`}
                title={
                  (threw
                    ? `Last session the game logged ${stat.exceptions} error${stat.exceptions === 1 ? '' : 's'} from this mod: something in its code threw, and whatever it was doing at that moment did not finish.`
                    : `Last session the game logged ${stat.warnings} warning${stat.warnings === 1 ? '' : 's'} about this mod: the game noticed something odd and carried on, so nothing broke by itself.`) +
                  (threw && stat.warnings > 0 ? ` Also ${stat.warnings} warning${stat.warnings === 1 ? '' : 's'}.` : '') +
                  `\n\nThe last line:\n${stat.last_exception ?? stat.last_warning ?? ''}` +
                  ((stat.last_exception ?? stat.last_warning ?? '').includes('require(') ? '\n\n(require(...) failed: the mod asked for a file the game could not find at that path. Harmless unless a feature is missing; the Monitor Center can fix the path.)' : '') +
                  `\n\nFrom console.txt as it is now; the Monitor Center has the full cards.`
                }
              >
                {threw ? `${stat.exceptions}× threw` : `${stat.warnings} warn`}
              </span>
            );
          })()}

          {/* Its files' share of the loading screen last session, when it is worth a word. */}
        {(() => {
          const ms = loadTimes?.get(mod.mod_id);
          if (ms === undefined || ms < 250) return null;
          const slow = ms >= 1000;
          return (
            <span
              className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                slow ? 'bg-amber-950/50 text-amber-300 border-amber-800/70' : 'bg-slate-900 text-slate-400 border-slate-700'
              }`}
              title={`Loading time: of the time the game spent on the loading screen last session, ${ms >= 1000 ? `${(ms / 1000).toFixed(1)} seconds` : `${ms} milliseconds`} went to reading this mod's files.\n\nMost mods take a few milliseconds; tile and model packs take seconds. It says nothing about how the mod runs once loaded.\n\nMeasured from the game's own DebugLog (Zomboid/Logs), from this mod's "loading" line to the next mod's; the Lua phase after that is one pass and is not timed per mod.`}
            >
              {ms >= 1000 ? `loads in ${(ms / 1000).toFixed(1)} s` : `loads in ${ms} ms`}
            </span>
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

          {mod.loadable_on_installed_build === false && !mod.enabled && (
            <span
              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/50 shrink-0"
              title="This mod has no mod.info the installed game build reads (B41-only, or only folders for newer builds). The game will not load it."
            >
              NOT FOR THIS BUILD
            </span>
          )}

          {/* Every problem the health check found for this mod, with its fix. */}
          <RowHealthChips
            paths={paths}
            issues={rowIssues}
            onNote={showToast}
            mods={mods}
            onApplyList={triggerReorder}
            onJumpToMod={handleJumpToMod}
            onOpenMerger={onOpenMerger}
            onGoToHealth={onGoToHealth}
          />
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
  </>
);
