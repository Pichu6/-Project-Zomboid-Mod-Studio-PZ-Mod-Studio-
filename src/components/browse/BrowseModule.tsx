import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, ExternalLink, FileArchive, FolderOpen, Globe, Heart, KeyRound, Library, Link2, Loader2, Search, Users, X,
} from 'lucide-react';
import { CatalogModSummary, InstallResult, ModOrigin, NexusMod, NexusSort, WorkshopInstallState, WorkshopItem, WorkshopLookup, WorkshopSort } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, reportBackendError } from '../../services/tauri';

interface BrowseModuleProps {
  paths: StudioPathsUI;
  /** Installed mods as the game sees them (from useModHealth). */
  catalog: CatalogModSummary[];
  /** Called after mods were installed, so the mod list is rescanned. */
  onInstalled: () => void;
}

type SourceTab = 'workshop' | 'nexus';

const CONFLICT_PREFIX = 'INSTALL_CONFLICT:';
const NEXUS_PAGE_SIZE = 24;

const formatCount = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const formatIsoDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');
const formatUnixDate = (secs: number | null) => (secs ? new Date(secs * 1000).toLocaleDateString() : '');

const Chip: React.FC<{ className: string; title?: string; children: React.ReactNode }> = ({ className, title, children }) => (
  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${className}`} title={title}>{children}</span>
);

const BuildChips: React.FC<{ builds: string[]; source: string }> = ({ builds, source }) =>
  builds.length === 0 ? (
    <Chip className="border-slate-700 text-slate-500" title={`${source} does not say which game build it is for`}>build ?</Chip>
  ) : (
    <>
      {builds.map((b) => (
        <Chip key={b} className={b === '42' ? 'border-emerald-600/60 text-emerald-300' : 'border-amber-600/60 text-amber-300'} title={`Tagged for Build ${b} (${source})`}>
          B{b}
        </Chip>
      ))}
    </>
  );

const InstalledChip: React.FC = () => <Chip className="border-emerald-500/60 text-emerald-300 bg-emerald-950/40">Installed</Chip>;

// ---------------------------------------------------------------------------------------------
// Install a downloaded mod
// ---------------------------------------------------------------------------------------------

const InstallBox: React.FC<{
  paths: StudioPathsUI;
  pendingOrigin: (ModOrigin & { kind: 'nexus' }) | null;
  onClearOrigin: () => void;
  onInstalled: () => void;
}> = ({ paths, pendingOrigin, onClearOrigin, onInstalled }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);

  const install = async (source: string) => {
    setBusy(true);
    setResult(null);
    const origin = pendingOrigin ?? undefined;
    try {
      let res: InstallResult;
      try {
        res = await TauriService.installMods(source, paths, false, origin);
      } catch (err) {
        const text = String(err);
        if (!text.startsWith(CONFLICT_PREFIX)) throw err;
        const { existing_folders } = JSON.parse(text.slice(CONFLICT_PREFIX.length)) as { existing_folders: string[] };
        const ok = confirm(
          `Already installed in Zomboid/mods: ${existing_folders.join(', ')}.\n\nReplace? The current copy is moved to Zomboid/PZModStudio_Backups/mods first.`
        );
        if (!ok) return;
        res = await TauriService.installMods(source, paths, true, origin);
      }
      setResult(res);
      onClearOrigin();
      onInstalled();
    } catch (err) {
      reportBackendError('Installing the mod', err);
    } finally {
      setBusy(false);
    }
  };

  const pickZip = async () => {
    const file = await TauriService.pickOpenFile('Mod archive (.zip)', 'zip');
    if (file) await install(file);
  };
  const pickFolder = async () => {
    const folder = await TauriService.pickFolder();
    if (folder) await install(folder);
  };

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-100">Install a mod you downloaded</h2>
          <p className="text-xs text-slate-400 max-w-2xl">
            From Nexus, the forums, GitHub or anywhere else. Choose the <code>.zip</code> (or the folder you extracted, for
            .7z/.rar); the Studio finds the mod inside and puts it in <code>Zomboid/mods</code> with the right structure.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={pickZip} disabled={busy || !paths.is_valid}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <FileArchive className="w-3.5 h-3.5" aria-hidden="true" />}
            Install .zip
          </button>
          <button type="button" onClick={pickFolder} disabled={busy || !paths.is_valid}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-50">
            <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
            Install folder
          </button>
        </div>
      </div>
      {pendingOrigin && (
        <div className="flex items-center gap-2 text-[11px] text-orange-200 bg-orange-950/30 border border-orange-800/50 rounded-lg px-3 py-1.5">
          <Link2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            The next install will be tagged as downloaded from Nexus: <b>{pendingOrigin.name}</b>
          </span>
          <button type="button" onClick={onClearOrigin} className="p-0.5 rounded hover:bg-orange-900/60 cursor-pointer" aria-label="Do not tag the next install">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-1.5 text-xs">
          {result.installed.map((m) => (
            <div key={m.destination} className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {m.replaced ? 'Replaced' : 'Installed'} <b>{m.name || m.folder}</b>
                {m.mod_id && <span className="font-mono text-emerald-400/70"> ({m.mod_id})</span>}: enable it in the Mod List.
              </span>
            </div>
          ))}
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Steam Workshop
// ---------------------------------------------------------------------------------------------

const UpdateChips: React.FC<{ state: WorkshopInstallState | undefined }> = ({ state }) => (
  <>
    {state?.update_pending && (
      <Chip className="border-amber-500/60 text-amber-300 bg-amber-950/40" title="Steam has a newer version that is not downloaded yet">Update waiting</Chip>
    )}
    {state?.updated_since_last_play && !state.update_pending && (
      <Chip className="border-sky-500/60 text-sky-300 bg-sky-950/40" title="This version was published after you last played">New since last play</Chip>
    )}
  </>
);

const WorkshopCard: React.FC<{ item: WorkshopItem; installedIds: string[]; state?: WorkshopInstallState }> = ({ item, installedIds, state }) => (
  <article className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
    <div className="aspect-video bg-slate-950 overflow-hidden">
      {item.preview_url ? (
        <img src={item.preview_url} alt="" loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-slate-700 text-xs">No image</div>
      )}
    </div>
    <div className="flex flex-col gap-1.5 p-3 flex-1">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-bold text-slate-100 leading-snug">{item.found ? item.title : `Item ${item.workshop_id}`}</h3>
        <div className="flex flex-wrap justify-end gap-1">
          {installedIds.length > 0 && <InstalledChip />}
          <UpdateChips state={state} />
          {item.found && <BuildChips builds={item.builds} source="The Workshop page" />}
        </div>
      </div>
      {!item.found ? (
        <p className="text-[11px] text-amber-300">Steam has no public item with this id (removed, private or wrong id).</p>
      ) : (
        <>
          {!item.is_project_zomboid && <p className="text-[11px] text-amber-300">This item is for another game.</p>}
          {item.banned && <p className="text-[11px] text-red-300">Steam has banned this item.</p>}
          <div className="text-[10px] text-slate-500">updated {formatUnixDate(item.time_updated)}</div>
          {installedIds.length > 0 && (
            <div className="text-[10px] font-mono text-emerald-400/80 truncate" title={installedIds.join(', ')}>mods: {installedIds.join(', ')}</div>
          )}
          {item.summary && <p className="text-[11px] text-slate-400 line-clamp-3">{item.summary}</p>}
          <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 mt-auto pt-1">
            <span className="flex items-center gap-1" title="Subscribers"><Users className="w-3 h-3" aria-hidden="true" />{formatCount(item.subscriptions)}</span>
            <span className="flex items-center gap-1" title="Favorites"><Heart className="w-3 h-3" aria-hidden="true" />{formatCount(item.favorited)}</span>
          </div>
        </>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => TauriService.openExternalUrl(item.page_url)}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer"
          title={installedIds.length > 0 ? 'Opens the Workshop page in your browser' : 'Opens the Workshop page in your browser: press Subscribe there (logged in on steamcommunity.com)'}>
          <ExternalLink className="w-3 h-3" aria-hidden="true" /> {installedIds.length > 0 ? 'Open page' : 'Open page to subscribe'}
        </button>
      </div>
    </div>
  </article>
);

const WORKSHOP_SORTS: { id: WorkshopSort; label: string }[] = [
  { id: 'trending', label: 'Trending (7 days)' },
  { id: 'most_subscribed', label: 'Most subscribed' },
  { id: 'recently_updated', label: 'Recently updated' },
  { id: 'newest', label: 'Newest' },
  { id: 'top_rated', label: 'Top rated' },
];

type WorkshopQuery = { text: string; sort: WorkshopSort; build: string };

/** In-app Workshop search; needs the user's own Steam Web API key (kept in Windows Credential Manager). */
const WorkshopSearch: React.FC<{ installedByItem: Map<string, string[]> }> = ({ installedByItem }) => {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [sort, setSort] = useState<WorkshopSort>('trending');
  const [build, setBuild] = useState('42');
  const [submitted, setSubmitted] = useState<WorkshopQuery | null>(null);
  const [items, setItems] = useState<WorkshopItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    TauriService.steamKeyStatus().then(setHasKey).catch(() => setHasKey(false));
  }, []);

  const runSearch = useCallback(async (query: WorkshopQuery, nextPage: number) => {
    setSearching(true);
    try {
      const r = await TauriService.workshopSearch(query.text, query.sort, query.build || null, nextPage);
      setTotal(r.total);
      setPage(nextPage);
      setItems((prev) => (nextPage === 1 ? r.items : [...prev, ...r.items]));
    } catch (err) {
      reportBackendError('Searching the Workshop', err);
    } finally {
      setSearching(false);
    }
  }, []);

  // Show results as soon as a key is available (trending Build 42 mods).
  useEffect(() => {
    if (hasKey && !submitted) {
      const initial: WorkshopQuery = { text: '', sort: 'trending', build: '42' };
      setSubmitted(initial);
      runSearch(initial, 1);
    }
  }, [hasKey, submitted, runSearch]);

  const saveKey = async () => {
    setSavingKey(true);
    setKeyError(null);
    try {
      await TauriService.setSteamKey(keyInput);
      setKeyInput('');
      setHasKey(true);
    } catch (err) {
      setKeyError(String(err));
    } finally {
      setSavingKey(false);
    }
  };

  const removeKey = async () => {
    if (!confirm('Remove the saved Steam Web API key from this PC?')) return;
    try {
      await TauriService.deleteSteamKey();
      setHasKey(false);
      setItems([]);
      setSubmitted(null);
    } catch (err) {
      reportBackendError('Removing the Steam key', err);
    }
  };

  if (hasKey === null) return null;

  if (!hasKey) {
    return (
      <div className="p-4 rounded-xl border border-sky-900/60 bg-sky-950/20 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <KeyRound className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-bold text-slate-100">Search the Workshop from here</h2>
            <p className="text-xs text-slate-400 max-w-2xl">
              Steam only allows Workshop search with a personal Steam Web API key. Create one for free (any domain name works,
              for example <code>localhost</code>) and paste it below. It is checked with Steam, then saved in Windows Credential
              Manager on this PC only: never in a file, and never shown again.
            </p>
          </div>
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); saveKey(); }}>
          <button type="button" onClick={() => TauriService.openExternalUrl('https://steamcommunity.com/dev/apikey')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Get a key
          </button>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Paste your Steam Web API key"
            aria-label="Steam Web API key"
            className="flex-1 min-w-[260px] px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-sky-700 text-xs text-slate-100 outline-none placeholder:text-slate-600 font-mono"
          />
          <button type="submit" disabled={savingKey || !keyInput.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer disabled:opacity-50">
            {savingKey && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />} Check and save
          </button>
        </form>
        {keyError && <p className="text-xs text-red-300">{keyError}</p>}
      </div>
    );
  }

  const submit = () => {
    const query: WorkshopQuery = { text: text.trim(), sort, build };
    setSubmitted(query);
    runSearch(query, 1);
  };

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-100">Search the Workshop</h2>
        <button type="button" onClick={removeKey} className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer">Remove saved key</button>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex items-center gap-2 flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 focus-within:border-sky-700">
          <Search className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search Workshop mods" aria-label="Search the Workshop"
            className="flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as WorkshopSort)} aria-label="Workshop sort" disabled={!!text.trim()}
          title={text.trim() ? 'Text searches are ordered by relevance' : undefined}
          className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 cursor-pointer disabled:opacity-50">
          {WORKSHOP_SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select value={build} onChange={(e) => setBuild(e.target.value)} aria-label="Game build"
          className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 cursor-pointer">
          <option value="42">Build 42 only</option>
          <option value="41">Build 41 only</option>
          <option value="">Any build</option>
        </select>
        <button type="submit" disabled={searching} className="px-3 py-2 rounded-lg text-xs font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer disabled:opacity-60">Search</button>
      </form>
      {submitted && (
        <div className="text-[11px] font-mono text-slate-500">
          {searching && items.length === 0 ? 'Searching...' : `${total.toLocaleString()} items${submitted.text ? ` for "${submitted.text}"` : ''}`}
        </div>
      )}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {items.map((i) => <WorkshopCard key={i.workshop_id} item={i} installedIds={installedByItem.get(i.workshop_id) ?? []} />)}
      </div>
      {submitted && items.length < total && (
        <button type="button" onClick={() => runSearch(submitted, page + 1)} disabled={searching}
          className="self-center px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-60">
          {searching ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
};

const WorkshopPanel: React.FC<{ catalog: CatalogModSummary[] }> = ({ catalog }) => {
  // Workshop id -> mod ids installed from it.
  const installedByItem = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of catalog) {
      if (m.source.kind === 'workshop' && !m.shadowed_by) {
        map.set(m.source.workshop_id, [...(map.get(m.source.workshop_id) ?? []), m.id]);
      }
    }
    return map;
  }, [catalog]);
  const subscribedIds = useMemo(() => [...installedByItem.keys()].sort(), [installedByItem]);
  // Workshop id -> what Steam has installed (update waiting / new since last play).
  const stateByItem = useMemo(() => {
    const map = new Map<string, WorkshopInstallState>();
    for (const m of catalog) {
      if (m.source.kind === 'workshop' && m.workshop_state) map.set(m.source.workshop_id, m.workshop_state);
    }
    return map;
  }, [catalog]);
  const pendingCount = [...stateByItem.values()].filter((s) => s.update_pending).length;
  const newSincePlayCount = [...stateByItem.values()].filter((s) => s.updated_since_last_play).length;
  const [updateFilter, setUpdateFilter] = useState<'all' | 'pending' | 'new'>('all');

  const [subscribed, setSubscribed] = useState<WorkshopItem[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [filter, setFilter] = useState('');
  const [lookupText, setLookupText] = useState('');
  const [lookup, setLookup] = useState<WorkshopLookup | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const subscribedKey = subscribedIds.join(',');
  useEffect(() => {
    if (!subscribedKey) return;
    let cancelled = false;
    setLoadingSubs(true);
    TauriService.workshopDetails(subscribedKey.split(','))
      .then((items) => !cancelled && setSubscribed(items))
      .catch((err) => !cancelled && reportBackendError('Loading Workshop details', err))
      .finally(() => !cancelled && setLoadingSubs(false));
    return () => {
      cancelled = true;
    };
  }, [subscribedKey]);

  const runLookup = async () => {
    if (!lookupText.trim()) return;
    setLookingUp(true);
    try {
      setLookup(await TauriService.workshopLookup(lookupText));
    } catch (err) {
      reportBackendError('Looking up the Workshop link', err);
    } finally {
      setLookingUp(false);
    }
  };

  const visibleSubs = useMemo(() => {
    const q = filter.toLowerCase().trim();
    let list = q ? subscribed.filter((i) => i.title.toLowerCase().includes(q) || (installedByItem.get(i.workshop_id) ?? []).some((id) => id.toLowerCase().includes(q))) : subscribed;
    if (updateFilter === 'pending') list = list.filter((i) => stateByItem.get(i.workshop_id)?.update_pending);
    if (updateFilter === 'new') list = list.filter((i) => stateByItem.get(i.workshop_id)?.updated_since_last_play);
    return [...list].sort((a, b) => (b.time_updated ?? 0) - (a.time_updated ?? 0));
  }, [subscribed, filter, installedByItem, updateFilter, stateByItem]);

  const lookupMissing = lookup ? lookup.items.filter((i) => !installedByItem.has(i.workshop_id)) : [];

  return (
    <div className="flex flex-col gap-4">
      <WorkshopSearch installedByItem={installedByItem} />

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-100">Look up links or a collection</h2>
            <p className="text-xs text-slate-400 max-w-2xl">
              Paste Workshop links, ids or a <b>collection</b> link to see what they are and what you are missing. Pages open in
              your browser; subscribe there while logged in on steamcommunity.com.
            </p>
          </div>
          <button type="button" onClick={() => TauriService.openExternalUrl('https://steamcommunity.com/app/108600/workshop/')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer">
            <Globe className="w-3.5 h-3.5" aria-hidden="true" /> Browse the Workshop
          </button>
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); runLookup(); }}>
          <input
            value={lookupText}
            onChange={(e) => setLookupText(e.target.value)}
            placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=..."
            aria-label="Workshop links, ids or collection link"
            className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-sky-700 text-xs text-slate-100 outline-none placeholder:text-slate-600"
          />
          <button type="submit" disabled={lookingUp}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-60">
            {lookingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Search className="w-3.5 h-3.5" aria-hidden="true" />}
            Look up
          </button>
        </form>
        {lookup && (
          <div className="flex flex-col gap-3">
            <div className="text-[11px] text-slate-300 flex flex-wrap items-center gap-2">
              {lookup.collection ? (
                <>
                  <Library className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                  Collection <b>{lookup.collection.title}</b>: {lookup.items.length} items, {lookup.items.length - lookupMissing.length} installed,{' '}
                  <span className={lookupMissing.length ? 'text-amber-300' : 'text-emerald-300'}>{lookupMissing.length} missing</span>
                  <button type="button" onClick={() => TauriService.openExternalUrl(lookup.collection!.page_url)}
                    className="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer"
                    title="Opens the collection page in your browser, where Subscribe to all is">
                    Open collection page (Subscribe to all)
                  </button>
                </>
              ) : (
                <>{lookup.items.length} items, {lookupMissing.length} not installed</>
              )}
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {lookup.items.map((i) => <WorkshopCard key={i.workshop_id} item={i} installedIds={installedByItem.get(i.workshop_id) ?? []} />)}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-100">
          Your subscriptions <span className="text-slate-500 font-mono text-xs">({subscribedIds.length})</span>
          {loadingSubs && <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin text-slate-500" aria-hidden="true" />}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={updateFilter} onChange={(e) => setUpdateFilter(e.target.value as 'all' | 'pending' | 'new')} aria-label="Filter by update status"
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 cursor-pointer">
            <option value="all">All subscriptions</option>
            <option value="new">New since last play ({newSincePlayCount})</option>
            <option value="pending">Update waiting ({pendingCount})</option>
          </select>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title or mod id"
          aria-label="Filter subscriptions"
          className="w-64 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 outline-none placeholder:text-slate-600"
        />
        </div>
      </div>
      {(pendingCount > 0 || newSincePlayCount > 0) && (
        <p className="text-xs text-slate-400">
          {pendingCount > 0 && <span className="text-amber-300">{pendingCount} updates are waiting to download in Steam (multiplayer servers reject mismatched versions). </span>}
          {newSincePlayCount > 0 && <span className="text-sky-300">{newSincePlayCount} items changed since you last played.</span>}
        </p>
      )}
      {subscribedIds.length === 0 && <p className="text-xs text-slate-500">No subscribed Workshop items found in your Workshop folder.</p>}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {visibleSubs.map((i) => <WorkshopCard key={i.workshop_id} item={i} installedIds={installedByItem.get(i.workshop_id) ?? []} state={stateByItem.get(i.workshop_id)} />)}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Nexus Mods
// ---------------------------------------------------------------------------------------------

const SORTS: { id: NexusSort; label: string }[] = [
  { id: 'updated', label: 'Recently updated' },
  { id: 'downloads', label: 'Most downloaded' },
  { id: 'endorsements', label: 'Most endorsed' },
  { id: 'newest', label: 'Newest' },
];

const NexusPanel: React.FC<{ catalog: CatalogModSummary[]; onDownload: (m: NexusMod) => void }> = ({ catalog, onDownload }) => {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [sort, setSort] = useState<NexusSort>('updated');
  const [showAdult, setShowAdult] = useState(false);
  const [mods, setMods] = useState<NexusMod[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // Nexus mod id -> installed mod ids (recorded when installed through the Studio).
  const installedByNexusId = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const m of catalog) {
      if (m.origin?.kind === 'nexus' && !m.shadowed_by) map.set(m.origin.mod_id, [...(map.get(m.origin.mod_id) ?? []), m.id]);
    }
    return map;
  }, [catalog]);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const page = await TauriService.nexusSearch(submittedQuery, sort, offset, NEXUS_PAGE_SIZE);
      setTotal(page.total);
      setMods((prev) => (offset === 0 ? page.mods : [...prev, ...page.mods]));
    } catch (err) {
      reportBackendError('Searching Nexus Mods', err);
    } finally {
      setLoading(false);
    }
  }, [submittedQuery, sort]);

  useEffect(() => {
    load(0);
  }, [load]);

  const visible = showAdult ? mods : mods.filter((m) => !m.adult_content);
  const hiddenAdult = mods.length - visible.length;

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setSubmittedQuery(query.trim()); }}>
        <div className="flex items-center gap-2 flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 focus-within:border-orange-700">
          <Search className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Nexus Mods (words in the mod name)" aria-label="Search Nexus Mods"
            className="flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as NexusSort)} aria-label="Sort"
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 cursor-pointer">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button type="submit" className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">Search</button>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
          <input type="checkbox" checked={showAdult} onChange={(e) => setShowAdult(e.target.checked)} className="w-3.5 h-3.5" />
          Show adult content
        </label>
      </form>

      <div className="text-[11px] font-mono text-slate-500">
        {loading && mods.length === 0 ? 'Loading...' : `${total} mods${submittedQuery ? ` matching "${submittedQuery}"` : ''}${hiddenAdult ? ` (${hiddenAdult} adult hidden)` : ''}`}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {visible.map((m) => {
          const installed = installedByNexusId.get(m.mod_id) ?? [];
          return (
            <article key={m.mod_id} className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
              <div className="aspect-video bg-slate-950 overflow-hidden">
                {m.thumbnail_url ? <img src={m.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-slate-700 text-xs">No image</div>}
              </div>
              <div className="flex flex-col gap-1.5 p-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-100 leading-snug">{m.name}</h3>
                  <div className="flex flex-wrap justify-end gap-1">
                    {installed.length > 0 && <InstalledChip />}
                    <BuildChips builds={m.build_hint ? m.build_hint.split('+') : []} source="The Nexus name/summary" />
                  </div>
                </div>
                <div className="text-[10px] text-slate-500">
                  by {m.author || m.uploader || 'unknown'}{m.version && <> · v{m.version}</>} · updated {formatIsoDate(m.updated_at)}
                </div>
                {m.summary && <p className="text-[11px] text-slate-400 line-clamp-3">{m.summary}</p>}
                <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 mt-auto pt-1">
                  <span className="flex items-center gap-1" title="Downloads"><Download className="w-3 h-3" aria-hidden="true" />{formatCount(m.downloads)}</span>
                  <span className="flex items-center gap-1" title="Endorsements"><Heart className="w-3 h-3" aria-hidden="true" />{formatCount(m.endorsements)}</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => TauriService.openExternalUrl(m.page_url)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">
                    <ExternalLink className="w-3 h-3" aria-hidden="true" /> Page
                  </button>
                  <button type="button" onClick={() => onDownload(m)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-bold bg-orange-700 hover:bg-orange-600 text-white cursor-pointer"
                    title="Opens the Files tab on Nexus: download there, then use Install .zip above">
                    <Download className="w-3 h-3" aria-hidden="true" /> Download
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {mods.length < total && (
        <button type="button" onClick={() => load(mods.length)} disabled={loading}
          className="self-center px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-60">
          {loading ? 'Loading...' : `Load more (${total - mods.length} left)`}
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------

const TABS: { id: SourceTab; label: string; active: string }[] = [
  { id: 'workshop', label: 'Steam Workshop', active: 'bg-sky-950/80 text-sky-200 border-sky-700' },
  { id: 'nexus', label: 'Nexus Mods', active: 'bg-orange-950/80 text-orange-200 border-orange-700' },
];

export const BrowseModule: React.FC<BrowseModuleProps> = ({ paths, catalog, onInstalled }) => {
  const [tab, setTab] = useState<SourceTab>('workshop');
  const [pendingOrigin, setPendingOrigin] = useState<(ModOrigin & { kind: 'nexus' }) | null>(null);

  const handleNexusDownload = (m: NexusMod) => {
    setPendingOrigin({ kind: 'nexus', mod_id: m.mod_id, page_url: m.page_url, name: m.name });
    TauriService.openExternalUrl(`${m.page_url}?tab=files`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 gap-4 font-sans">
      <div className="flex items-start gap-3 p-5 rounded-xl border border-slate-800 bg-slate-900/60">
        <Globe className="w-6 h-6 text-emerald-400 mt-0.5" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-bold text-slate-100">Browse Mods</h1>
          <p className="text-xs text-slate-400 max-w-3xl">
            Find Project Zomboid mods on the Steam Workshop and Nexus Mods. Every mod in your Mod List shows a tag saying where it
            comes from.
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Mod source" className="flex gap-2">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-xs font-bold border cursor-pointer transition ${tab === t.id ? t.active : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <InstallBox paths={paths} pendingOrigin={pendingOrigin} onClearOrigin={() => setPendingOrigin(null)} onInstalled={onInstalled} />

      {tab === 'workshop' ? <WorkshopPanel catalog={catalog} /> : <NexusPanel catalog={catalog} onDownload={handleNexusDownload} />}
    </div>
  );
};
