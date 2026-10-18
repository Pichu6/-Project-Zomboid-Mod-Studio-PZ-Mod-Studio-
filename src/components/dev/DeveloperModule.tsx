import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, ExternalLink, FolderOpen, Loader2, Play, RefreshCw, RotateCcw, Wrench } from 'lucide-react';
import { CatalogModSummary, FileProblem, ModInfo, ModValidation } from '../../types';
import { TauriService } from '../../services/tauri';
import { StudioPathsUI } from '../settings/SettingsModule';

interface DeveloperModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  catalogById?: Map<string, CatalogModSummary>;
  /** Starts the game in debug with only this mod (and what it requires) on; the list comes back when the game closes. */
  onLaunchOnly: (modId: string) => void;
  /** The list set aside by such a launch, when one is; and the way to put it back now. */
  devLaunch: { modId: string; since: string } | null;
  onRestoreList: () => void;
}

/**
 * For the people who make the mods. Pick a mod you are working on (a local one, usually), check
 * every Lua and script file of it before the game does, open the wrong line in your editor, and
 * start the game with only that mod on.
 */
export const DeveloperModule: React.FC<DeveloperModuleProps> = ({ paths, mods, catalogById, onLaunchOnly, devLaunch, onRestoreList }) => {
  const [modId, setModId] = useState<string>(() => localStorage.getItem('pz_dev_mod') ?? '');
  const [validation, setValidation] = useState<ModValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Local mods first: those are the ones being worked on; Workshop ones after, for a look.
  const choices = useMemo(() => {
    const own = (m: ModInfo) => !m.mod_id.startsWith('Z_PZModStudio_');
    const local = mods.filter((m) => own(m) && catalogById?.get(m.mod_id)?.source.kind !== 'workshop');
    const workshop = mods.filter((m) => own(m) && catalogById?.get(m.mod_id)?.source.kind === 'workshop');
    return { local, workshop };
  }, [mods, catalogById]);
  const mod = mods.find((m) => m.mod_id === modId) ?? null;
  const root = mod ? catalogById?.get(mod.mod_id)?.root_dir ?? null : null;

  const pick = (id: string) => {
    setModId(id);
    localStorage.setItem('pz_dev_mod', id);
    setValidation(null);
  };

  const validate = async () => {
    if (!root) return;
    setBusy(true);
    try {
      setValidation(await TauriService.validateMod(paths, root));
    } catch {
      // Already shown by TauriService.
    } finally {
      setBusy(false);
    }
  };

  const openProblem = async (p: FileProblem) => {
    if (!root) return;
    try {
      const where = await TauriService.openInEditor(paths, `${root}/${p.path}`, p.line, p.col);
      setNote(`Opened in ${where}.`);
      setTimeout(() => setNote(null), 3000);
    } catch {
      // Already shown by TauriService.
    }
  };

  /**
   * Reload in the game while it runs: the bridge hands the game `reloadLuaFile` for each file
   * that changed, and the game writes back what happened. Watching looks every two seconds.
   */
  const [watching, setWatching] = useState(false);
  const [reloadLog, setReloadLog] = useState<string[]>([]);
  const [reloading, setReloading] = useState(false);
  const lastCheck = useRef<number>(Date.now());
  const log = (line: string) => setReloadLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 40));

  const reloadFiles = async (files: string[]) => {
    if (files.length === 0) return;
    if ((await TauriService.gameStatus()) === null) {
      log('The game is not running: nothing to reload into. Start it (with the bridge on) first.');
      return;
    }
    setReloading(true);
    try {
      const id = await TauriService.reloadLuaInGame(paths, files);
      log(`Asked the game to reload ${files.length} file${files.length === 1 ? '' : 's'}…`);
      // The bridge looks at its queue about twice a second; give it a few seconds.
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const result = await TauriService.reloadResult(paths);
        if (result && result.id === id) {
          result.results.forEach((r) => log(r));
          return;
        }
      }
      log('No answer from the game in 8 s: is the bridge mod (Z_PZModStudio_Bridge) on, and are you past the main menu? The Monitor shows the console.');
    } catch {
      // Already shown by TauriService.
    } finally {
      setReloading(false);
    }
  };

  useEffect(() => {
    if (!watching || !root) return;
    lastCheck.current = Date.now();
    const t = setInterval(() => {
      void (async () => {
        const since = lastCheck.current;
        const changed = await TauriService.changedLuaFiles(root, since);
        if (changed.length === 0) return;
        lastCheck.current = Math.max(...changed.map((c) => c.modified_ms)) + 1;
        changed.forEach((c) => log(`changed: ${c.path}`));
        await reloadFiles(changed.map((c) => c.absolute));
      })();
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, root]);

  const reloadAllNow = async () => {
    if (!root) return;
    const all = await TauriService.changedLuaFiles(root, 0);
    await reloadFiles(all.map((c) => c.absolute));
  };

  const byFile = useMemo(() => {
    const map = new Map<string, FileProblem[]>();
    for (const p of validation?.problems ?? []) map.set(p.path, [...(map.get(p.path) ?? []), p]);
    return [...map.entries()];
  }, [validation]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto font-sans">
      <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-3">
        <Code2 className="w-5 h-5 text-emerald-400" aria-hidden="true" />
        <div>
          <h1 className="text-sm font-bold text-slate-100">Developer</h1>
          <p className="text-[11px] text-slate-400">Check a mod before the game does; start the game with only it on.</p>
        </div>
      </div>

      <div className="p-6 flex flex-col gap-4 max-w-5xl">
        {devLaunch && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-amber-700/60 bg-amber-950/30 text-xs text-amber-200">
            <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              The game was started with only <b>{mods.find((m) => m.mod_id === devLaunch.modId)?.name ?? devLaunch.modId}</b> on ({devLaunch.since}); your list is set aside and comes back when the game closes.
            </span>
            <button type="button" onClick={onRestoreList} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-700 hover:bg-amber-600 text-white cursor-pointer">
              <RotateCcw className="w-3 h-3" aria-hidden="true" /> Put my list back now
            </button>
          </div>
        )}

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="text-xs font-bold text-slate-200">The mod you are working on</div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={modId}
              onChange={(e) => pick(e.target.value)}
              aria-label="Mod to work on"
              className="min-w-[280px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 cursor-pointer"
            >
              <option value="">Pick a mod…</option>
              {choices.local.length > 0 && (
                <optgroup label="In Zomboid/mods (yours)">
                  {choices.local.map((m) => <option key={m.mod_id} value={m.mod_id}>{m.name} — {m.mod_id}</option>)}
                </optgroup>
              )}
              {choices.workshop.length > 0 && (
                <optgroup label="From the Workshop">
                  {choices.workshop.map((m) => <option key={m.mod_id} value={m.mod_id}>{m.name} — {m.mod_id}</option>)}
                </optgroup>
              )}
            </select>
            {root && (
              <button type="button" onClick={() => TauriService.openModFolder(paths, root)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer" title={root}>
                <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" /> Open its folder
              </button>
            )}
          </div>
          {root && <div className="text-[10px] font-mono text-slate-500 break-all">{root}</div>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={!root || busy}
              onClick={() => void validate()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer disabled:opacity-50"
              title="Every .lua through the parser the Merger uses, every media/scripts/*.txt through a brace check"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Wrench className="w-3.5 h-3.5" aria-hidden="true" />} Check every file
            </button>
            <button
              type="button"
              disabled={!mod || !!devLaunch}
              onClick={() => mod && onLaunchOnly(mod.mod_id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer disabled:opacity-50"
              title="Debug (Windowed), with only this mod, what it requires and the Studio's bridge on. Your list is set aside and comes back when the game closes; Earlier lists has it too."
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" /> Start the game with only this mod
            </button>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> Reload in the game while it runs
              </div>
              <p className="text-[11px] text-slate-400 max-w-2xl">
                Save a Lua file of this mod and the game reloads it without restarting: the Studio's bridge hands the game
                <code className="mx-1">reloadLuaFile</code> for each file that changed (what the game's own debug windows do),
                and what happened shows here and in the console. The bridge mod must be on and the game past the main menu.
                A file's top-level code runs again; tables it rebuilds are rebuilt, hooks it adds are added again.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={watching}
              aria-label="Watch this mod's Lua files and reload them in the game when they change"
              disabled={!root}
              onClick={() => setWatching((w) => !w)}
              className={`w-10 h-5 shrink-0 rounded-full p-0.5 flex items-center transition cursor-pointer disabled:opacity-50 ${
                watching ? 'bg-emerald-500 justify-end' : 'bg-slate-700 justify-start'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white shadow-md" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!root || reloading}
              onClick={() => void reloadAllNow()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-50"
              title="Every .lua of this mod, now"
            >
              {reloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />} Reload every Lua of this mod now
            </button>
            {watching && <span className="text-[11px] text-emerald-300 self-center">Watching {mod?.name}: a saved .lua is reloaded within two seconds.</span>}
          </div>
          {reloadLog.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2 max-h-48 overflow-y-auto font-mono text-[10.5px] text-slate-300 flex flex-col gap-0.5">
              {reloadLog.map((l, i) => (
                <div key={i} className={l.includes('  failed ') ? 'text-red-300' : l.includes('  ok ') ? 'text-emerald-300' : ''}>{l}</div>
              ))}
            </div>
          )}
        </div>

        {validation && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold text-slate-200">
                {validation.problems.length === 0 ? 'Every file reads' : `${validation.problems.length} problem${validation.problems.length === 1 ? '' : 's'} in ${byFile.length} file${byFile.length === 1 ? '' : 's'}`}
              </div>
              <div className="text-[11px] font-mono text-slate-500">{validation.lua_files} Lua, {validation.script_files} script files checked</div>
            </div>
            {validation.problems.length === 0 && (
              <p className="text-[11px] text-slate-400">No syntax errors in the Lua, no unbalanced block in the scripts. What the game does with them is the Monitor's to say.</p>
            )}
            {byFile.map(([file, problems]) => (
              <div key={file} className="rounded-lg border border-slate-800 bg-slate-950/60">
                <div className="px-3 py-1.5 text-[11px] font-mono text-slate-300 border-b border-slate-900 flex items-center justify-between gap-2">
                  <span className="truncate">{file}</span>
                  <span className={`shrink-0 px-1.5 rounded text-[10px] ${problems[0].kind === 'lua' ? 'bg-sky-950 text-sky-300' : 'bg-violet-950 text-violet-300'}`}>{problems[0].kind}</span>
                </div>
                {problems.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => void openProblem(p)}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-900 cursor-pointer flex items-start gap-2"
                    title="Opens the file at this line in VS Code when it is installed, else in the file's own program"
                  >
                    <span className="font-mono text-amber-300 shrink-0 w-16">{p.line ? `${p.line}${p.col ? `:${p.col}` : ''}` : '—'}</span>
                    <span className="flex-1">{p.message}</span>
                    <ExternalLink className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {note && <div className="text-[11px] text-emerald-300">{note}</div>}
      </div>
    </div>
  );
};
