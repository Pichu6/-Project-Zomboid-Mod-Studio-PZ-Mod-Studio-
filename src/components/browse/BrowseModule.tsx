import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, ExternalLink, FileArchive, FolderOpen, Globe, Heart, KeyRound, Library, Link2, Loader2, Search, Users, X,
} from 'lucide-react';
import {
  CatalogModSummary, InstallResult, ModOrigin, NexusCategory, NexusMod, NexusSort, WorkshopInstallState, WorkshopItem, WorkshopLookup, WorkshopSort,
} from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, reportBackendError } from '../../services/tauri';
import {
  BuildChips, CardGrid, CategoryBar, Chip, InstalledChip, ModCard, PAGE_SIZE, Pagination, SCROLL_ID, Toolbar, UpdateChips, formatCount, formatIsoDate, formatUnixDate, scrollBrowseToTop, selectClass,
} from './common';
import { DetailTarget, ModDetail } from './ModDetail';

interface BrowseModuleProps {
  paths: StudioPathsUI;
  /** Workshop item to open the detail view on (set when the Mod List sends the user here). */
  focusWorkshopId?: string | null;
  onFocusHandled?: () => void;
  /** Installed mods as the game sees them (from useModHealth). */
  catalog: CatalogModSummary[];
  /** Called after mods were installed, so the mod list is rescanned. */
  onInstalled: () => void;
}

type SourceTab = 'workshop' | 'nexus' | 'mine';

const CONFLICT_PREFIX = 'INSTALL_CONFLICT:';

/** The Workshop's categories for Project Zomboid (same list as workshop::CATEGORIES). */
const WORKSHOP_CATEGORIES = [
  'Animals', 'Audio', 'Balance', 'Building', 'Clothing/Armor', 'Farming', 'Food', 'Framework', 'Hardmode', 'Interface', 'Items',
  'Language/Translation', 'Literature', 'Map', 'Military', 'Misc', 'Models', 'Multiplayer', 'Pop Culture', 'QoL', 'Realistic',
  'Silly/Fun', 'Skills', 'Textures', 'Traits', 'Vehicles', 'Weapons', 'WIP',
].map((name) => ({ name }));

const pageCountOf = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

/** Pasted Workshop links / ids instead of search words. */
const looksLikeWorkshopLinks = (text: string) => /steamcommunity\.com|CommunityFilePage/i.test(text) || /^[\d\s,;]{4,}$/.test(text.trim());

// ---------------------------------------------------------------------------------------------
// Installing a downloaded mod
// ---------------------------------------------------------------------------------------------

function useInstaller(paths: StudioPathsUI, pendingOrigin: (ModOrigin & { kind: 'nexus' }) | null, onDone: () => void) {
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
        if (!confirm(`Already installed in Zomboid/mods: ${existing_folders.join(', ')}.\n\nReplace? The current copy is moved to Zomboid/PZModStudio_Backups/mods first.`)) return;
        res = await TauriService.installMods(source, paths, true, origin);
      }
      setResult(res);
      TauriService.clearRemoteCache('workshop:');
      onDone();
    } catch (err) {
      reportBackendError('Installing the mod', err);
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    result,
    clearResult: () => setResult(null),
    pickZip: async () => {
      const file = await TauriService.pickOpenFile('Mod archive (.zip)', 'zip');
      if (file) await install(file);
    },
    pickFolder: async () => {
      const folder = await TauriService.pickFolder();
      if (folder) await install(folder);
    },
  };
}

const InstallResultBanner: React.FC<{ result: InstallResult; onClose: () => void }> = ({ result, onClose }) => (
  <div className="flex items-start gap-3 px-3 py-2 rounded-lg border border-emerald-800/60 bg-emerald-950/20 text-xs">
    <div className="flex-1 flex flex-col gap-1">
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
    <button type="button" onClick={onClose} className="p-0.5 rounded hover:bg-emerald-900/50 text-slate-400 cursor-pointer" aria-label="Close">
      <X className="w-3.5 h-3.5" />
    </button>
  </div>
);

// ---------------------------------------------------------------------------------------------
// Steam Workshop
// ---------------------------------------------------------------------------------------------

const workshopCard = (item: WorkshopItem, installedIds: string[], state: WorkshopInstallState | undefined, onOpen: (t: DetailTarget) => void) => (
  <ModCard
    key={item.workshop_id}
    image={item.preview_url}
    title={item.found ? item.title : `Item ${item.workshop_id}`}
    subtitle={item.found ? `updated ${formatUnixDate(item.time_updated)}` : 'Not public on Steam (removed, private or wrong id)'}
    chips={<>{installedIds.length > 0 && <InstalledChip />}<UpdateChips state={state} />{item.found && <BuildChips builds={item.builds} source="The Workshop page" />}</>}
    summary={item.summary}
    stats={item.found && (
      <>
        <span className="flex items-center gap-1" title="Subscribers"><Users className="w-3 h-3" aria-hidden="true" />{formatCount(item.subscriptions)}</span>
        <span className="flex items-center gap-1" title="Favorites"><Heart className="w-3 h-3" aria-hidden="true" />{formatCount(item.favorited)}</span>
      </>
    )}
    onOpen={item.found ? () => onOpen({ kind: 'workshop', id: item.workshop_id, preview: item }) : undefined}
  />
);

// The same four the Workshop's own Browse menu offers, in its wording.
/** A collection: its picture, how many of its mods you already have, and a way in. */
const collectionCard = (item: WorkshopItem, installedByItem: Map<string, string[]>, onOpen: (t: DetailTarget) => void) => {
  const missing = item.children.filter((id) => !installedByItem.has(id)).length;
  return (
    <ModCard
      key={item.workshop_id}
      image={item.preview_url}
      title={item.title}
      subtitle={`${item.children.length} mods · updated ${formatUnixDate(item.time_updated)}`}
      chips={
        <>
          <Chip className="border-violet-600/60 text-violet-300">Collection</Chip>
          {item.children.length > 0 && (
            missing === 0
              ? <Chip className="border-emerald-500/60 text-emerald-300">All installed</Chip>
              : <Chip className="border-amber-500/60 text-amber-300">{missing} missing</Chip>
          )}
        </>
      }
      summary={item.summary}
      stats={
        <>
          <span className="flex items-center gap-1" title="Subscribers"><Users className="w-3 h-3" aria-hidden="true" />{formatCount(item.subscriptions)}</span>
          <span className="flex items-center gap-1" title="Favorites"><Heart className="w-3 h-3" aria-hidden="true" />{formatCount(item.favorited)}</span>
        </>
      }
      onOpen={() => onOpen({ kind: 'collection', id: item.workshop_id, preview: item })}
    />
  );
};

const WORKSHOP_SORTS: { id: WorkshopSort; label: string }[] = [
  { id: 'trending', label: 'Most Popular' },
  { id: 'top_rated', label: 'Top Rated All Time' },
  { id: 'newest', label: 'Most Recent' },
  { id: 'recently_updated', label: 'Last Updated' },
];

/** The time window the Workshop offers next to "Most Popular". */
const POPULAR_DAYS: { id: number; label: string }[] = [
  { id: 1, label: 'Today' },
  { id: 7, label: 'One Week' },
  { id: 90, label: 'Three Months' },
  { id: 365, label: 'One Year' },
];

/** Fallback when the public Workshop page cannot be read: the user's own Steam Web API key. */
const SteamKeyForm: React.FC<{ onSaved: () => void; reason: string }> = ({ onSaved, reason }) => {
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await TauriService.setSteamKey(keyInput);
      setKeyInput('');
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg border border-amber-900/60 bg-amber-950/20">
      <div className="flex items-start gap-2 text-[11px] text-slate-300">
        <KeyRound className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
        <span>
          <b className="text-amber-200">{reason}</b> You can still paste Workshop links or a collection above. To search anyway, add a
          personal <b>Steam Web API key</b> (free; any domain name works, for example <code>localhost</code>): it is checked with
          Steam and kept in Windows Credential Manager on this PC only.
        </span>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <button type="button" onClick={() => TauriService.openExternalUrl('https://steamcommunity.com/dev/apikey')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">
          <ExternalLink className="w-3 h-3" aria-hidden="true" /> Get a key
        </button>
        <input type="password" autoComplete="off" spellCheck={false} value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
          placeholder="Paste your Steam Web API key" aria-label="Steam Web API key"
          className="flex-1 min-w-[220px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-sky-700 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 font-mono" />
        <button type="submit" disabled={saving || !keyInput.trim()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer disabled:opacity-50">
          {saving && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />} Check and save
        </button>
      </form>
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
};

type WorkshopQuery = { text: string; sort: WorkshopSort; build: string; category: string; days: number; collections: boolean };

/** The filters as the backend wants them (collections are not filtered by build or category). */
const toBrowseQuery = (q: WorkshopQuery, page: number) => ({
  text: q.text,
  sort: q.sort,
  build: q.collections ? null : q.build,
  category: q.collections ? null : q.category,
  days: q.days,
  collections: q.collections,
  page,
});

const WorkshopTab: React.FC<{
  installedByItem: Map<string, string[]>;
  stateByItem: Map<string, WorkshopInstallState>;
  onOpen: (t: DetailTarget) => void;
}> = ({ installedByItem, stateByItem, onOpen }) => {
  const [text, setText] = useState('');
  const [query, setQuery] = useState<WorkshopQuery>({ text: '', sort: 'trending', build: '42', category: '', days: 7, collections: false });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [items, setItems] = useState<WorkshopItem[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<WorkshopLookup | null>(null);
  const [lookupPage, setLookupPage] = useState(1);

  const runSearch = useCallback(async (q: WorkshopQuery, p: number) => {
    setSearching(true);
    try {
      const r = await TauriService.workshopSearch(toBrowseQuery(q, p));
      setTotal(r.total);
      setPages(r.pages);
      setItems(r.items);
      setPage(r.page || p);
      setSearchError(null);
      // The next page is usually where the user goes: fetch it while they read this one.
      const next = { ...toBrowseQuery(q, p + 1) };
      if (p + 1 <= r.pages) TauriService.prefetch(TauriService.workshopSearchKey(next), () => TauriService.workshopSearch(next));
    } catch (err) {
      setSearchError(String(err));
      setItems([]);
      setTotal(0);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!lookup) runSearch(query, 1);
    // Re-run when a filter changes; the text only on submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const submit = async () => {
    const t = text.trim();
    if (t && looksLikeWorkshopLinks(t)) {
      setSearching(true);
      try {
        setLookup(await TauriService.workshopLookup(t));
        setLookupPage(1);
      } catch (err) {
        reportBackendError('Looking up the Workshop link', err);
      } finally {
        setSearching(false);
      }
      return;
    }
    setLookup(null);
    setQuery((q) => ({ ...q, text: t }));
  };

  const setFilter = (patch: Partial<WorkshopQuery>) => {
    setLookup(null);
    setQuery((q) => ({ ...q, ...patch }));
  };

  const lookupMissing = lookup ? lookup.items.filter((i) => !installedByItem.has(i.workshop_id)).length : 0;
  const lookupItems = lookup ? lookup.items.slice((lookupPage - 1) * PAGE_SIZE, lookupPage * PAGE_SIZE) : [];

  return (
    <div className="flex flex-col gap-3">
      <Toolbar onSubmit={submit}>
        <div className="flex items-center gap-2 flex-1 min-w-[240px] px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 focus-within:border-sky-700">
          <Search className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Search the Workshop or paste links"
            placeholder="Search the Workshop, or paste links / a collection link"
            className="flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600" />
          {(text || lookup) && (
            <button type="button" onClick={() => { setText(''); setLookup(null); if (query.text) setFilter({ text: '' }); }} aria-label="Clear"
              className="text-slate-500 hover:text-slate-300 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
          )}
        </div>
        <select value={query.text ? 'relevance' : query.sort} onChange={(e) => setFilter({ sort: e.target.value as WorkshopSort })} aria-label="Sort"
          disabled={!!query.text} title={query.text ? 'Text searches are ordered by relevance' : undefined} className={selectClass}>
          {query.text && <option value="relevance">Relevance</option>}
          {WORKSHOP_SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {query.sort === 'trending' && !query.text && (
          <select value={query.days} onChange={(e) => setFilter({ days: Number(e.target.value) })} aria-label="Most popular over" className={selectClass}>
            {POPULAR_DAYS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        {!query.collections && (
          <select value={query.build} onChange={(e) => setFilter({ build: e.target.value })} aria-label="Game build" className={selectClass}>
            <option value="42">Build 42</option>
            <option value="41">Build 41</option>
            <option value="">Any build</option>
          </select>
        )}
        <button type="submit" disabled={searching} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer disabled:opacity-60">
          Search
        </button>
        <button type="button" onClick={() => TauriService.openExternalUrl('https://steamcommunity.com/app/108600/workshop/')} title="Open the Workshop in your browser"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-slate-900 border border-slate-800 hover:bg-slate-800 cursor-pointer">
          <Globe className="w-3.5 h-3.5" aria-hidden="true" /> Web
        </button>
      </Toolbar>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800" role="group" aria-label="What to list">
          {[
            { id: false, label: 'Mods' },
            { id: true, label: 'Collections' },
          ].map((o) => (
            <button key={String(o.id)} type="button" onClick={() => setFilter({ collections: o.id })} aria-pressed={query.collections === o.id}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition ${query.collections === o.id ? 'bg-sky-800/80 text-sky-100' : 'text-slate-400 hover:text-slate-200'}`}>
              {o.label}
            </button>
          ))}
        </div>
        {!query.collections && (
          <CategoryBar categories={WORKSHOP_CATEGORIES} value={query.category} onChange={(c) => setFilter({ category: c })} accent="border-sky-600 bg-sky-900/50 text-sky-200" />
        )}
      </div>
      {searchError && !lookup && <SteamKeyForm reason={searchError} onSaved={() => runSearch(query, 1)} />}

      {lookup ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
            {lookup.collection ? (
              <>
                <Library className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                Collection <b>{lookup.collection.title}</b>: {lookup.items.length} items,{' '}
                <span className={lookupMissing ? 'text-amber-300' : 'text-emerald-300'}>{lookupMissing} not installed</span>
                <button type="button" onClick={() => TauriService.openExternalUrl(lookup.collection!.page_url)}
                  className="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-700 hover:bg-sky-600 text-white cursor-pointer" title="Opens the collection page in your browser, where Subscribe to all is">
                  Open collection (Subscribe to all)
                </button>
              </>
            ) : (
              <>{lookup.items.length} items, {lookupMissing} not installed</>
            )}
          </div>
          <CardGrid>{lookupItems.map((i) => workshopCard(i, installedByItem.get(i.workshop_id) ?? [], stateByItem.get(i.workshop_id), onOpen))}</CardGrid>
          <Pagination page={lookupPage} pageCount={pageCountOf(lookup.items.length)} onPage={setLookupPage} />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>
              {searching && items.length === 0
                ? 'Searching...'
                : `${total.toLocaleString()} ${query.collections ? 'collections' : 'mods'}${query.text ? ` for "${query.text}"` : ''}${query.category ? ` in ${query.category}` : ''}`}
              {searching && items.length > 0 && <Loader2 className="inline w-3 h-3 ml-2 animate-spin" aria-hidden="true" />}
            </span>
            <span>page {page} of {pages.toLocaleString()}</span>
          </div>
          <CardGrid>
            {items.map((i) =>
              query.collections
                ? collectionCard(i, installedByItem, onOpen)
                : workshopCard(i, installedByItem.get(i.workshop_id) ?? [], stateByItem.get(i.workshop_id), onOpen)
            )}
          </CardGrid>
          <Pagination page={page} pageCount={pages} onPage={(p) => runSearch(query, p)} disabled={searching} />
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Nexus Mods
// ---------------------------------------------------------------------------------------------

const NEXUS_SORTS: { id: NexusSort; label: string }[] = [
  { id: 'updated', label: 'Recently updated' },
  { id: 'downloads', label: 'Most downloaded' },
  { id: 'endorsements', label: 'Most endorsed' },
  { id: 'newest', label: 'Newest' },
];

const nexusCard = (m: NexusMod, installed: boolean, onOpen: (t: DetailTarget) => void) => (
  <ModCard
    key={m.mod_id}
    image={m.thumbnail_url}
    title={m.name}
    subtitle={`by ${m.author || m.uploader || 'unknown'}${m.version ? ` · v${m.version}` : ''} · ${formatIsoDate(m.updated_at)}`}
    chips={<>{installed && <InstalledChip />}<BuildChips builds={m.build_hint ? m.build_hint.split('+') : []} source="The Nexus name/summary" />{m.category && <Chip className="border-orange-700/60 text-orange-300">{m.category}</Chip>}</>}
    summary={m.summary}
    stats={
      <>
        <span className="flex items-center gap-1" title="Downloads"><Download className="w-3 h-3" aria-hidden="true" />{formatCount(m.downloads)}</span>
        <span className="flex items-center gap-1" title="Endorsements"><Heart className="w-3 h-3" aria-hidden="true" />{formatCount(m.endorsements)}</span>
      </>
    }
    onOpen={() => onOpen({ kind: 'nexus', modId: m.mod_id, preview: m })}
  />
);

const NexusTab: React.FC<{ installedByNexusId: Map<number, string[]>; onOpen: (t: DetailTarget) => void }> = ({ installedByNexusId, onOpen }) => {
  const [text, setText] = useState('');
  const [query, setQuery] = useState({ text: '', category: '', sort: 'updated' as NexusSort });
  const [showAdult, setShowAdult] = useState(false);
  const [categories, setCategories] = useState<NexusCategory[]>([]);
  const [mods, setMods] = useState<NexusMod[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    TauriService.nexusCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const r = await TauriService.nexusSearch(query.text, query.category || null, query.sort, (p - 1) * PAGE_SIZE, PAGE_SIZE);
      setTotal(r.total);
      setMods(r.mods);
      setPage(p);
      if (p * PAGE_SIZE < r.total) {
        TauriService.prefetch(`nexus:search:${query.sort}:${query.category}:${p * PAGE_SIZE}:${PAGE_SIZE}:${query.text}`, () =>
          TauriService.nexusSearch(query.text, query.category || null, query.sort, p * PAGE_SIZE, PAGE_SIZE)
        );
      }
    } catch (err) {
      reportBackendError('Searching Nexus Mods', err);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load(1);
  }, [load]);

  const visible = showAdult ? mods : mods.filter((m) => !m.adult_content);
  const hiddenAdult = mods.length - visible.length;

  return (
    <div className="flex flex-col gap-3">
      <Toolbar onSubmit={() => setQuery((q) => ({ ...q, text: text.trim() }))}>
        <div className="flex items-center gap-2 flex-1 min-w-[240px] px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 focus-within:border-orange-700">
          <Search className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search Nexus Mods (words in the mod name)" aria-label="Search Nexus Mods"
            className="flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600" />
          {text && (
            <button type="button" onClick={() => { setText(''); setQuery((q) => ({ ...q, text: '' })); }} aria-label="Clear" className="text-slate-500 hover:text-slate-300 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select value={query.sort} onChange={(e) => setQuery((q) => ({ ...q, sort: e.target.value as NexusSort }))} aria-label="Sort" className={selectClass}>
          {NEXUS_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button type="submit" className="px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-700 hover:bg-orange-600 text-white cursor-pointer">Search</button>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
          <input type="checkbox" checked={showAdult} onChange={(e) => setShowAdult(e.target.checked)} className="w-3.5 h-3.5" />
          Adult content
        </label>
        <button type="button" onClick={() => TauriService.openExternalUrl('https://www.nexusmods.com/games/projectzomboid/mods')} title="Open Nexus Mods in your browser"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-slate-900 border border-slate-800 hover:bg-slate-800 cursor-pointer">
          <Globe className="w-3.5 h-3.5" aria-hidden="true" /> Web
        </button>
      </Toolbar>
      {categories.length > 0 && (
        <CategoryBar categories={categories} value={query.category} onChange={(c) => setQuery((q) => ({ ...q, category: c }))} accent="border-orange-600 bg-orange-900/50 text-orange-200" />
      )}
      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
        <span>
          {loading && mods.length === 0 ? 'Loading...' : `${total} mods${query.text ? ` matching "${query.text}"` : ''}${query.category ? ` in ${query.category}` : ''}${hiddenAdult ? ` (${hiddenAdult} adult hidden on this page)` : ''}`}
          {loading && mods.length > 0 && <Loader2 className="inline w-3 h-3 ml-2 animate-spin" aria-hidden="true" />}
        </span>
        <span>page {page} of {pageCountOf(total)}</span>
      </div>
      <CardGrid>{visible.map((m) => nexusCard(m, installedByNexusId.has(m.mod_id), onOpen))}</CardGrid>
      <Pagination page={page} pageCount={pageCountOf(total)} onPage={load} disabled={loading} />
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// My mods
// ---------------------------------------------------------------------------------------------

type MineRow =
  | { key: string; kind: 'workshop'; item: WorkshopItem; modIds: string[]; state?: WorkshopInstallState }
  | { key: string; kind: 'local'; mod: CatalogModSummary };

type MineSource = 'all' | 'workshop' | 'nexus' | 'local';
type MineStatus = 'all' | 'new' | 'pending';

const localLabel = (m: CatalogModSummary) =>
  m.origin?.kind === 'nexus' ? 'Nexus' : m.origin?.kind === 'compat' ? 'Compatible copy' : m.source.kind === 'workshop_upload' ? 'Your Workshop upload' : 'Local';

const MyModsTab: React.FC<{
  catalog: CatalogModSummary[];
  installedByItem: Map<string, string[]>;
  stateByItem: Map<string, WorkshopInstallState>;
  onOpen: (t: DetailTarget) => void;
}> = ({ catalog, installedByItem, stateByItem, onOpen }) => {
  const [details, setDetails] = useState<WorkshopItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [source, setSource] = useState<MineSource>('all');
  const [status, setStatus] = useState<MineStatus>('all');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const [page, setPage] = useState(1);

  const subscribedKey = useMemo(() => [...installedByItem.keys()].sort().join(','), [installedByItem]);
  useEffect(() => {
    if (!subscribedKey) return;
    let cancelled = false;
    setLoading(true);
    TauriService.workshopDetails(subscribedKey.split(','))
      .then((items) => !cancelled && setDetails(items))
      .catch((err) => !cancelled && reportBackendError('Loading Workshop details', err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [subscribedKey]);

  const rows = useMemo<MineRow[]>(() => {
    const byId = new Map(details.map((d) => [d.workshop_id, d]));
    const out: MineRow[] = [];
    for (const [id, modIds] of installedByItem) {
      const item = byId.get(id) ?? ({ workshop_id: id, found: true, title: modIds.join(', '), summary: '', preview_url: null, time_updated: null, subscriptions: 0, favorited: 0, file_size: 0, tags: [], builds: [], is_project_zomboid: true, banned: false, page_url: '', children: [], is_collection: false } as WorkshopItem);
      out.push({ key: `w${id}`, kind: 'workshop', item, modIds, state: stateByItem.get(id) });
    }
    for (const m of catalog) {
      if (m.source.kind !== 'workshop' && !m.shadowed_by && !m.id.startsWith('Z_PZModStudio_')) out.push({ key: `l${m.id}`, kind: 'local', mod: m });
    }
    return out;
  }, [details, installedByItem, stateByItem, catalog]);

  const counts = useMemo(() => ({
    workshop: rows.filter((r) => r.kind === 'workshop').length,
    nexus: rows.filter((r) => r.kind === 'local' && r.mod.origin?.kind === 'nexus').length,
    local: rows.filter((r) => r.kind === 'local' && r.mod.origin?.kind !== 'nexus').length,
    newSincePlay: rows.filter((r) => r.kind === 'workshop' && r.state?.updated_since_last_play).length,
    pending: rows.filter((r) => r.kind === 'workshop' && r.state?.update_pending).length,
  }), [rows]);

  const categories = useMemo(() => {
    const tally = new Map<string, number>();
    for (const r of rows) if (r.kind === 'workshop') for (const t of r.item.tags) if (!/^Build \d+$/.test(t)) tally.set(t, (tally.get(t) ?? 0) + 1);
    return [...tally].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = text.toLowerCase().trim();
    const list = rows.filter((r) => {
      if (source === 'workshop' && r.kind !== 'workshop') return false;
      if (source === 'nexus' && !(r.kind === 'local' && r.mod.origin?.kind === 'nexus')) return false;
      if (source === 'local' && !(r.kind === 'local' && r.mod.origin?.kind !== 'nexus')) return false;
      if (status === 'new' && !(r.kind === 'workshop' && r.state?.updated_since_last_play)) return false;
      if (status === 'pending' && !(r.kind === 'workshop' && r.state?.update_pending)) return false;
      if (category && !(r.kind === 'workshop' && r.item.tags.includes(category))) return false;
      if (!q) return true;
      const hay = r.kind === 'workshop' ? `${r.item.title} ${r.modIds.join(' ')} ${r.item.workshop_id}` : `${r.mod.name} ${r.mod.id}`;
      return hay.toLowerCase().includes(q);
    });
    const name = (r: MineRow) => (r.kind === 'workshop' ? r.item.title : r.mod.name).toLowerCase();
    const time = (r: MineRow) => (r.kind === 'workshop' ? r.item.time_updated ?? 0 : 0);
    return list.sort((a, b) => (sort === 'name' ? name(a).localeCompare(name(b)) : time(b) - time(a) || name(a).localeCompare(name(b))));
  }, [rows, text, source, status, category, sort]);

  useEffect(() => {
    setPage(1);
  }, [text, source, status, category, sort]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const statusChip = (value: MineStatus, label: string, n: number, cls: string) =>
    n > 0 && (
      <button type="button" onClick={() => setStatus(status === value ? 'all' : value)} aria-pressed={status === value}
        className={`px-2 py-0.5 rounded-full text-[11px] border cursor-pointer ${status === value ? cls : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'}`}>
        {label} <span className="font-mono">{n}</span>
      </button>
    );

  return (
    <div className="flex flex-col gap-3">
      <Toolbar onSubmit={() => undefined}>
        <div className="flex items-center gap-2 flex-1 min-w-[240px] px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 focus-within:border-emerald-700">
          <Search className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by name, mod id or Workshop id" aria-label="Filter your mods"
            className="flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600" />
        </div>
        <select value={source} onChange={(e) => setSource(e.target.value as MineSource)} aria-label="Source" className={selectClass}>
          <option value="all">All sources ({rows.length})</option>
          <option value="workshop">Steam Workshop ({counts.workshop})</option>
          <option value="nexus">Nexus ({counts.nexus})</option>
          <option value="local">Local / other ({counts.local})</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'updated' | 'name')} aria-label="Sort" className={selectClass}>
          <option value="updated">Recently updated</option>
          <option value="name">Name</option>
        </select>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" aria-label="Loading" />}
      </Toolbar>
      {(counts.newSincePlay > 0 || counts.pending > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {statusChip('new', 'New since last play', counts.newSincePlay, 'border-sky-600 bg-sky-900/50 text-sky-200')}
          {statusChip('pending', 'Update waiting in Steam', counts.pending, 'border-amber-600 bg-amber-900/50 text-amber-200')}
        </div>
      )}
      {categories.length > 0 && <CategoryBar categories={categories} value={category} onChange={setCategory} accent="border-emerald-600 bg-emerald-900/50 text-emerald-200" />}
      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
        <span>{filtered.length} of {rows.length} mods</span>
        <span>page {page} of {pageCountOf(filtered.length)}</span>
      </div>
      {rows.length === 0 && !loading && <p className="text-xs text-slate-500">No installed mods found. Check your folders in App Settings.</p>}
      <CardGrid>
        {pageRows.map((r) => {
          if (r.kind === 'workshop') return workshopCard(r.item, [], r.state, onOpen) // every card here is installed;
          const nexusId = r.mod.origin?.kind === 'nexus' ? r.mod.origin.mod_id : null;
          return (
            <ModCard
              key={r.key}
              image={null}
              title={r.mod.name}
              subtitle={<span className="font-mono">{r.mod.id}</span>}
              chips={<Chip className={nexusId !== null ? 'border-orange-700/60 text-orange-300' : 'border-slate-600 text-slate-300'}>{localLabel(r.mod)}</Chip>}
              summary={r.mod.loadability.status !== 'loadable' ? 'Your game build does not load this mod as it is (see Mod Health).' : null}
              onOpen={nexusId !== null ? () => onOpen({ kind: 'nexus', modId: nexusId }) : undefined}
            />
          );
        })}
      </CardGrid>
      <Pagination page={page} pageCount={pageCountOf(filtered.length)} onPage={setPage} />
    </div>
  );
};

// ---------------------------------------------------------------------------------------------

const TABS: { id: SourceTab; label: string; active: string }[] = [
  { id: 'workshop', label: 'Steam Workshop', active: 'bg-sky-950/80 text-sky-200 border-sky-700' },
  { id: 'nexus', label: 'Nexus Mods', active: 'bg-orange-950/80 text-orange-200 border-orange-700' },
  { id: 'mine', label: 'My mods', active: 'bg-emerald-950/80 text-emerald-200 border-emerald-700' },
];

export const BrowseModule: React.FC<BrowseModuleProps> = ({ paths, catalog, onInstalled, focusWorkshopId, onFocusHandled }) => {
  const [tab, setTab] = useState<SourceTab>('workshop');
  // Tabs stay mounted once visited, so switching keeps their page and filters.
  const [visited, setVisited] = useState<Set<SourceTab>>(() => new Set(['workshop']));
  const [pendingOrigin, setPendingOrigin] = useState<(ModOrigin & { kind: 'nexus' }) | null>(null);
  const [detailStack, setDetailStack] = useState<DetailTarget[]>([]);
  const installer = useInstaller(paths, pendingOrigin, () => {
    setPendingOrigin(null);
    onInstalled();
  });

  const installedByItem = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of catalog) {
      if (m.source.kind === 'workshop' && !m.shadowed_by) map.set(m.source.workshop_id, [...(map.get(m.source.workshop_id) ?? []), m.id]);
    }
    return map;
  }, [catalog]);
  const stateByItem = useMemo(() => {
    const map = new Map<string, WorkshopInstallState>();
    for (const m of catalog) if (m.source.kind === 'workshop' && m.workshop_state) map.set(m.source.workshop_id, m.workshop_state);
    return map;
  }, [catalog]);
  const installedByNexusId = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const m of catalog) if (m.origin?.kind === 'nexus' && !m.shadowed_by) map.set(m.origin.mod_id, [...(map.get(m.origin.mod_id) ?? []), m.id]);
    return map;
  }, [catalog]);
  const myCount = useMemo(() => installedByItem.size + catalog.filter((m) => m.source.kind !== 'workshop' && !m.shadowed_by && !m.id.startsWith('Z_PZModStudio_')).length, [catalog, installedByItem]);

  const openTab = (t: SourceTab) => {
    setTab(t);
    setVisited((v) => new Set(v).add(t));
    scrollBrowseToTop();
  };
  const openDetail = useCallback((t: DetailTarget) => setDetailStack((s) => [...s, t]), []);

  // Subscribing needs the Steam client, not a key: ask it once whether it is there.
  const [steamReady, setSteamReady] = useState(false);
  useEffect(() => {
    if (!paths.is_valid) return;
    let cancelled = false;
    TauriService.steamClientReady(paths).then((ready) => !cancelled && setSteamReady(ready));
    return () => {
      cancelled = true;
    };
  }, [paths]);

  const handleSubscribe = useCallback(
    async (ids: string[], subscribe: boolean) => {
      try {
        const outcome = await TauriService.workshopSubscribe(paths, ids, subscribe);
        if (outcome.failed.length > 0) {
          reportBackendError(
            subscribe ? 'Subscribing' : 'Unsubscribing',
            `${outcome.failed.length} of ${ids.length} did not go through: ${outcome.failed[0][1]}`
          );
        }
        // Steam downloads in the background; pick up whatever has landed.
        onInstalled();
      } catch (err) {
        reportBackendError(subscribe ? 'Subscribing' : 'Unsubscribing', err);
        throw err;
      }
    },
    [paths, onInstalled]
  );

  // The Mod List asked for one item: show it on its own, not stacked on whatever was open.
  useEffect(() => {
    if (!focusWorkshopId) return;
    setDetailStack([{ kind: 'workshop', id: focusWorkshopId }]);
    onFocusHandled?.();
  }, [focusWorkshopId, onFocusHandled]);
  const closeDetail = useCallback(() => setDetailStack([]), []);

  const handleNexusDownload = (m: NexusMod) => {
    setPendingOrigin({ kind: 'nexus', mod_id: m.mod_id, page_url: m.page_url, name: m.name });
    TauriService.openExternalUrl(`${m.page_url}?tab=files`);
  };

  return (
    <div id={SCROLL_ID} className="flex-1 flex flex-col min-h-0 overflow-y-auto font-sans">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 px-6 py-3 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="flex items-center gap-2 mr-2">
          <Globe className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          <h1 className="text-sm font-bold text-slate-100">Browse Mods</h1>
        </div>
        <div role="tablist" aria-label="Mod source" className="flex gap-1.5">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => openTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition ${tab === t.id ? t.active : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'}`}>
              {t.label}
              {t.id === 'mine' && <span className="ml-1.5 font-mono text-[10px] opacity-70">{myCount}</span>}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5" title="Install a mod you downloaded (Nexus, forums, GitHub...): the Studio finds the mod inside and puts it in Zomboid/mods">
          <button type="button" onClick={installer.pickZip} disabled={installer.busy || !paths.is_valid}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer disabled:opacity-50">
            {installer.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <FileArchive className="w-3.5 h-3.5" aria-hidden="true" />}
            Install .zip
          </button>
          <button type="button" onClick={installer.pickFolder} disabled={installer.busy || !paths.is_valid}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-50"
            title="For .7z / .rar: extract it first, then choose the folder">
            <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
            Folder
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-6 py-4">
        {pendingOrigin && (
          <div className="flex items-center gap-2 text-[11px] text-orange-200 bg-orange-950/30 border border-orange-800/50 rounded-lg px-3 py-1.5">
            <Link2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              Downloading <b>{pendingOrigin.name}</b> from Nexus: when it finishes, press <b>Install .zip</b> and it will be tagged as a Nexus mod.
            </span>
            <button type="button" onClick={() => setPendingOrigin(null)} className="p-0.5 rounded hover:bg-orange-900/60 cursor-pointer" aria-label="Do not tag the next install">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {installer.result && <InstallResultBanner result={installer.result} onClose={installer.clearResult} />}

        <div hidden={tab !== 'workshop'}>
          {visited.has('workshop') && <WorkshopTab installedByItem={installedByItem} stateByItem={stateByItem} onOpen={openDetail} />}
        </div>
        <div hidden={tab !== 'nexus'}>
          {visited.has('nexus') && <NexusTab installedByNexusId={installedByNexusId} onOpen={openDetail} />}
        </div>
        <div hidden={tab !== 'mine'}>
          {visited.has('mine') && <MyModsTab catalog={catalog} installedByItem={installedByItem} stateByItem={stateByItem} onOpen={openDetail} />}
        </div>
      </div>

      {detailStack.length > 0 && (
        <ModDetail
          paths={paths}
          steamReady={steamReady}
          onSubscribe={handleSubscribe}
          target={detailStack[detailStack.length - 1]}
          canGoBack={detailStack.length > 1}
          onBack={() => setDetailStack((s) => s.slice(0, -1))}
          onClose={closeDetail}
          onOpen={openDetail}
          installedByItem={installedByItem}
          stateByItem={stateByItem}
          installedByNexusId={installedByNexusId}
          onNexusDownload={handleNexusDownload}
        />
      )}
    </div>
  );
};
