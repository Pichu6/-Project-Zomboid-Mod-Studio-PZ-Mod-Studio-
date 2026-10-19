import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { Code2, ExternalLink, FolderOpen, FolderPlus, Loader2, Map as MapIcon, Play, RefreshCw, RotateCcw, Users, Wrench } from 'lucide-react';
import { CatalogModSummary, FileProblem, MapTools, ModInfo, ModValidation, MpReport } from '../../types';
import { MpCheckPanel } from '../common/MpCheckPanel';
import { TauriService } from '../../services/tauri';
import { problemText } from '../../i18n/backendText';
import { StudioPathsUI } from '../settings/SettingsModule';
import { tHtml } from '../../i18n/html';

interface DeveloperModuleProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  catalogById?: Map<string, CatalogModSummary>;
  /** Starts the game in debug with only this mod (and what it requires) on; the list comes back when the game closes. */
  onLaunchOnly: (modId: string) => void;
  /** The list set aside by such a launch, when one is; and the way to put it back now. */
  devLaunch: { modId: string; since: string } | null;
  onRestoreList: () => void;
  /** After a new mod is made: the installed mods are read again, so it can be picked. */
  onRefreshMods: () => void;
}

/**
 * For the people who make the mods. Pick a mod you are working on (a local one, usually), check
 * every Lua and script file of it before the game does, open the wrong line in your editor, and
 * start the game with only that mod on.
 */
export const DeveloperModule: React.FC<DeveloperModuleProps> = ({ paths, mods, catalogById, onLaunchOnly, devLaunch, onRestoreList, onRefreshMods }) => {
  const { t } = useTranslation();
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
      setNote(i18next.t('developer.note.opened', { where }));
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
      log(i18next.t('developer.reload.notRunning'));
      return;
    }
    setReloading(true);
    try {
      const id = await TauriService.reloadLuaInGame(paths, files);
      log(i18next.t('developer.reload.asked', { count: files.length }));
      // The bridge looks at its queue about twice a second; give it a few seconds.
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const result = await TauriService.reloadResult(paths);
        if (result && result.id === id) {
          result.results.forEach((r) => log(r));
          return;
        }
      }
      log(i18next.t('developer.reload.noAnswer'));
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
        changed.forEach((c) => log(i18next.t('developer.reload.changed', { path: c.path })));
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

  /** A new mod: the form, and what came of it. */
  const [newMod, setNewMod] = useState<{ id: string; name: string; author: string; description: string; also41: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ folder: string; files: string[]; id: string } | null>(null);
  const idFromName = (name: string) => name.replace(/[^A-Za-z0-9_-]+/g, '');
  const createMod = async () => {
    if (!newMod) return;
    setCreating(true);
    try {
      const made = await TauriService.createMod(paths.user_zomboid_dir, {
        id: newMod.id.trim(),
        name: newMod.name.trim(),
        author: newMod.author.trim(),
        description: newMod.description,
        builds: newMod.also41 ? ['41', '42'] : ['42'],
      });
      setCreated({ ...made, id: newMod.id.trim() });
      setNewMod(null);
      onRefreshMods();
      pick(newMod.id.trim());
    } catch {
      // Already shown by TauriService.
    } finally {
      setCreating(false);
    }
  };

  /** TileZed and WorldEd: where each is, and a folder of the player's for each to look in. */
  const [tilezedDir, setTilezedDir] = useState<string>(() => localStorage.getItem('pz_tilezed_dir') ?? localStorage.getItem('pz_map_tools_dir') ?? '');
  const [worldedDir, setWorldedDir] = useState<string>(() => localStorage.getItem('pz_worlded_dir') ?? localStorage.getItem('pz_map_tools_dir') ?? '');
  const [mapTools, setMapTools] = useState<MapTools | null>(null);
  useEffect(() => {
    let live = true;
    void TauriService.mapTools([tilezedDir, worldedDir]).then((t) => live && setMapTools(t));
    return () => {
      live = false;
    };
  }, [tilezedDir, worldedDir]);
  const setTilezed = (dir: string) => {
    setTilezedDir(dir);
    localStorage.setItem('pz_tilezed_dir', dir);
  };
  const setWorlded = (dir: string) => {
    setWorldedDir(dir);
    localStorage.setItem('pz_worlded_dir', dir);
  };

  /** The multiplayer check of the chosen mod. */
  const [mp, setMp] = useState<MpReport | null>(null);
  const [mpBusy, setMpBusy] = useState(false);
  const checkMp = async () => {
    if (!root) return;
    setMpBusy(true);
    try {
      setMp(await TauriService.mpCheckMod(paths, root));
    } catch {
      // Already shown by TauriService.
    } finally {
      setMpBusy(false);
    }
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
          <h1 className="text-sm font-bold text-slate-100">{t('developer.header.title')}</h1>
          <p className="text-[11px] text-slate-400">{t('developer.header.subtitle')}</p>
        </div>
      </div>

      <div className="p-6 flex flex-col gap-4 max-w-5xl">
        {devLaunch && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-amber-700/60 bg-amber-950/30 text-xs text-amber-200">
            <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1" dangerouslySetInnerHTML={{ __html: tHtml('developer.devLaunch.banner', { name: mods.find((m) => m.mod_id === devLaunch.modId)?.name ?? devLaunch.modId, since: devLaunch.since }) }} />
            <button type="button" onClick={onRestoreList} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-700 hover:bg-amber-600 text-white cursor-pointer">
              <RotateCcw className="w-3 h-3" aria-hidden="true" /> {t('developer.devLaunch.restore')}
            </button>
          </div>
        )}

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <FolderPlus className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> {t('developer.newMod.title')}
              </div>
              <p className="text-[11px] text-slate-400 max-w-2xl" dangerouslySetInnerHTML={{ __html: tHtml('developer.newMod.intro') }} />
            </div>
            {!newMod && (
              <button type="button" onClick={() => setNewMod({ id: '', name: '', author: '', description: '', also41: false })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shrink-0">
                <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" /> {t('developer.newMod.button')}
              </button>
            )}
          </div>
          {newMod && (
            <form
              className="grid grid-cols-1 md:grid-cols-2 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void createMod();
              }}
            >
              <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                {t('developer.newMod.name')}
                <input type="text" value={newMod.name} autoFocus
                  onChange={(e) => setNewMod({ ...newMod, name: e.target.value, id: newMod.id === idFromName(newMod.name) ? idFromName(e.target.value) : newMod.id })}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                {t('developer.newMod.id')}
                <input type="text" value={newMod.id} onChange={(e) => setNewMod({ ...newMod, id: e.target.value })} spellCheck={false}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                {t('developer.newMod.author')}
                <input type="text" value={newMod.author} onChange={(e) => setNewMod({ ...newMod, author: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                {t('developer.newMod.description')}
                <textarea rows={2} value={newMod.description} onChange={(e) => setNewMod({ ...newMod, description: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500" />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-slate-300 md:col-span-2">
                <input type="checkbox" checked={newMod.also41} onChange={(e) => setNewMod({ ...newMod, also41: e.target.checked })} />
                {t('developer.newMod.also41')}
              </label>
              <div className="flex gap-2 md:col-span-2">
                <button type="submit" disabled={creating || !newMod.name.trim() || !newMod.id.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer disabled:opacity-50">
                  {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />} {t('developer.newMod.make')}
                </button>
                <button type="button" onClick={() => setNewMod(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer">
                  {t('developer.newMod.cancel')}
                </button>
              </div>
            </form>
          )}
          {created && (
            <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-200 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span dangerouslySetInnerHTML={{ __html: tHtml('developer.newMod.made', { id: created.id, folder: created.folder }) }} />
                <button type="button" onClick={() => TauriService.openModFolder(paths, created.folder)} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer shrink-0">
                  <FolderOpen className="w-3 h-3" aria-hidden="true" /> {t('developer.newMod.openFolder')}
                </button>
              </div>
              <div className="font-mono text-[10px] text-emerald-300/80">{created.files.join(' · ')}</div>
              <div className="text-emerald-300/80">{t('developer.newMod.next')}</div>
            </div>
          )}
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="text-xs font-bold text-slate-200">{t('developer.pick.title')}</div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={modId}
              onChange={(e) => pick(e.target.value)}
              aria-label={t('developer.pick.aria')}
              className="min-w-[280px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 cursor-pointer"
            >
              <option value="">{t('developer.pick.placeholder')}</option>
              {choices.local.length > 0 && (
                <optgroup label={t('developer.pick.local')}>
                  {choices.local.map((m) => <option key={m.mod_id} value={m.mod_id}>{m.name} — {m.mod_id}</option>)}
                </optgroup>
              )}
              {choices.workshop.length > 0 && (
                <optgroup label={t('developer.pick.workshop')}>
                  {choices.workshop.map((m) => <option key={m.mod_id} value={m.mod_id}>{m.name} — {m.mod_id}</option>)}
                </optgroup>
              )}
            </select>
            {root && (
              <button type="button" onClick={() => TauriService.openModFolder(paths, root)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer" title={root}>
                <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" /> {t('developer.pick.openFolder')}
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
              title={t('developer.pick.checkTitle')}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Wrench className="w-3.5 h-3.5" aria-hidden="true" />} {t('developer.pick.check')}
            </button>
            <button
              type="button"
              disabled={!mod || !!devLaunch}
              onClick={() => mod && onLaunchOnly(mod.mod_id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer disabled:opacity-50"
              title={t('developer.pick.launchTitle')}
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" /> {t('developer.pick.launch')}
            </button>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> {t('developer.reload.title')}
              </div>
              <p className="text-[11px] text-slate-400 max-w-2xl" dangerouslySetInnerHTML={{ __html: tHtml('developer.reload.intro') }} />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={watching}
              aria-label={t('developer.reload.watchAria')}
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
              title={t('developer.reload.allTitle')}
            >
              {reloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />} {t('developer.reload.all')}
            </button>
            {watching && <span className="text-[11px] text-emerald-300 self-center">{t('developer.reload.watching', { name: mod?.name })}</span>}
          </div>
          {reloadLog.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2 max-h-48 overflow-y-auto font-mono text-[10.5px] text-slate-300 flex flex-col gap-0.5">
              {reloadLog.map((l, i) => (
                <div key={i} className={l.includes('  failed ') ? 'text-red-300' : l.includes('  ok ') ? 'text-emerald-300' : ''}>{l}</div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="space-y-1">
            <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> {t('developer.mp.title')}
            </div>
            <p className="text-[11px] text-slate-400 max-w-2xl" dangerouslySetInnerHTML={{ __html: tHtml('developer.mp.intro') }} />
          </div>
          <div>
            <button
              type="button"
              disabled={!root || mpBusy}
              onClick={() => void checkMp()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-50"
            >
              {mpBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Users className="w-3.5 h-3.5" aria-hidden="true" />} {t('developer.mp.check')}
            </button>
          </div>
          {mp && mod && (
            <>
              <div className="text-[11px] text-slate-500">{t('developer.mp.summary', { count: mp.files_checked, server: mp.has_server_lua ? t('developer.mp.alsoServer') : '' })}</div>
              <MpCheckPanel
                reports={[{ mod_id: mod.mod_id, name: mod.name, report: mp }]}
                onOpen={(r, f) => void TauriService.openInEditor(paths, `${r}/${f.path}`, f.line, null).catch(() => undefined)}
              />
            </>
          )}
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="space-y-1">
            <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <MapIcon className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> {t('developer.mapTools.title')}
            </div>
            <p className="text-[11px] text-slate-400 max-w-2xl" dangerouslySetInnerHTML={{ __html: tHtml('developer.mapTools.intro') }} />
          </div>
          {[
            {
              key: 'tilezed',
              name: 'TileZed',
              what: t('developer.mapTools.tilezedWhat'),
              dir: tilezedDir,
              setDir: setTilezed,
              exe: mapTools?.tilezed ?? null,
            },
            {
              key: 'worlded',
              name: 'WorldEd',
              what: t('developer.mapTools.worldedWhat'),
              dir: worldedDir,
              setDir: setWorlded,
              exe: mapTools?.worlded ?? null,
            },
          ].map((tool) => (
            <div key={tool.key} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-slate-200">{tool.name}</div>
                  <p className="text-[11px] text-slate-400 max-w-2xl">{tool.what}</p>
                </div>
                <button
                  type="button"
                  disabled={!tool.exe}
                  onClick={() => tool.exe && void TauriService.launchMapTool(tool.exe).catch(() => undefined)}
                  title={tool.exe ?? t('developer.mapTools.notFoundTitle', { name: tool.name })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" /> {t('developer.mapTools.start', { name: tool.name })}
                </button>
              </div>
              <input
                type="text"
                value={tool.dir}
                onChange={(e) => tool.setDir(e.target.value)}
                placeholder={t('developer.mapTools.folderPlaceholder', { name: tool.name })}
                spellCheck={false}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
              />
              <div className={`text-[10px] font-mono break-all ${tool.exe ? 'text-emerald-400/80' : 'text-slate-500'}`}>
                {tool.exe ?? (mapTools ? t('developer.mapTools.notFound', { count: mapTools.searched.length }) : t('developer.mapTools.looking'))}
              </div>
            </div>
          ))}
        </div>

        {validation && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold text-slate-200">
                {validation.problems.length === 0 ? t('developer.results.allRead') : t('developer.results.problems', { problems: validation.problems.length, files: byFile.length })}
              </div>
              <div className="text-[11px] font-mono text-slate-500">{t('developer.results.counts', { lua: validation.lua_files, scripts: validation.script_files })}</div>
            </div>
            {validation.problems.length === 0 && (
              <p className="text-[11px] text-slate-400">{t('developer.results.clean')}</p>
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
                    title={t('developer.results.openTitle')}
                  >
                    <span className="font-mono text-amber-300 shrink-0 w-16">{p.line ? `${p.line}${p.col ? `:${p.col}` : ''}` : '—'}</span>
                    <span className="flex-1">{problemText(p)}</span>
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
