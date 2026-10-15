import React, { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, FileArchive, FolderOpen, Globe, Heart, Loader2, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { InstallResult, NexusMod, NexusSort } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, reportBackendError } from '../../services/tauri';

interface BrowseModuleProps {
  paths: StudioPathsUI;
  /** Called after mods were installed, so the mod list is rescanned. */
  onInstalled: () => void;
}

const PAGE_SIZE = 24;
const CONFLICT_PREFIX = 'INSTALL_CONFLICT:';

const SORTS: { id: NexusSort; label: string }[] = [
  { id: 'updated', label: 'Recently updated' },
  { id: 'downloads', label: 'Most downloaded' },
  { id: 'endorsements', label: 'Most endorsed' },
  { id: 'newest', label: 'Newest' },
];

const formatCount = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

const BuildBadge: React.FC<{ hint: string | null }> = ({ hint }) => {
  if (!hint) {
    return <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-500" title="The page does not say which game build it is for">build ?</span>;
  }
  const color = hint.includes('42') ? 'border-emerald-600/60 text-emerald-300' : 'border-amber-600/60 text-amber-300';
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${color}`} title="From the mod's name/summary">B{hint}</span>;
};

/** Install a mod downloaded by hand (any site) from a .zip or an extracted folder. */
const InstallBox: React.FC<{ paths: StudioPathsUI; onInstalled: () => void }> = ({ paths, onInstalled }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);

  const install = async (source: string) => {
    setBusy(true);
    setResult(null);
    try {
      let res: InstallResult;
      try {
        res = await TauriService.installMods(source, paths, false);
      } catch (err) {
        const text = String(err);
        if (!text.startsWith(CONFLICT_PREFIX)) throw err;
        const { existing_folders } = JSON.parse(text.slice(CONFLICT_PREFIX.length)) as { existing_folders: string[] };
        const ok = confirm(
          `Already installed in Zomboid/mods: ${existing_folders.join(', ')}.\n\nReplace? The current copy is moved to Zomboid/PZModStudio_Backups/mods first.`
        );
        if (!ok) return;
        res = await TauriService.installMods(source, paths, true);
      }
      setResult(res);
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

export const BrowseModule: React.FC<BrowseModuleProps> = ({ paths, onInstalled }) => {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [sort, setSort] = useState<NexusSort>('updated');
  const [showAdult, setShowAdult] = useState(false);
  const [mods, setMods] = useState<NexusMod[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const page = await TauriService.nexusSearch(submittedQuery, sort, offset, PAGE_SIZE);
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
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 gap-4 font-sans">
      <div className="flex items-start gap-3 p-5 rounded-xl border border-slate-800 bg-slate-900/60">
        <Globe className="w-6 h-6 text-emerald-400 mt-0.5" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-bold text-slate-100">Browse Mods</h1>
          <p className="text-xs text-slate-400 max-w-3xl">
            Project Zomboid mods on <b>Nexus Mods</b>. Open a mod's page, download the file there (Files tab), then install it
            below. Steam Workshop browsing is coming next.
          </p>
        </div>
      </div>

      <InstallBox paths={paths} onInstalled={onInstalled} />

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedQuery(query.trim());
        }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 focus-within:border-emerald-700">
          <Search className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Nexus Mods (words in the mod name)"
            aria-label="Search Nexus Mods"
            className="flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as NexusSort)}
          aria-label="Sort"
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 cursor-pointer"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
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

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {visible.map((m) => (
          <article key={m.mod_id} className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="aspect-video bg-slate-950 overflow-hidden">
              {m.thumbnail_url ? (
                <img src={m.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-700 text-xs">No image</div>
              )}
            </div>
            <div className="flex flex-col gap-1.5 p-3 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-100 leading-snug">{m.name}</h3>
                <BuildBadge hint={m.build_hint} />
              </div>
              <div className="text-[10px] text-slate-500">
                by {m.author || m.uploader || 'unknown'}
                {m.version && <> · v{m.version}</>} · updated {formatDate(m.updated_at)}
              </div>
              {m.summary && <p className="text-[11px] text-slate-400 line-clamp-3">{m.summary}</p>}
              <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 mt-auto pt-1">
                <span className="flex items-center gap-1"><Download className="w-3 h-3" aria-hidden="true" />{formatCount(m.downloads)}</span>
                <span className="flex items-center gap-1"><Heart className="w-3 h-3" aria-hidden="true" />{formatCount(m.endorsements)}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => TauriService.openExternalUrl(m.page_url)}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">
                  <ExternalLink className="w-3 h-3" aria-hidden="true" /> Page
                </button>
                <button type="button" onClick={() => TauriService.openExternalUrl(`${m.page_url}?tab=files`)}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-bold bg-emerald-700 hover:bg-emerald-600 text-white cursor-pointer"
                  title="Opens the Files tab on Nexus: download there, then use Install .zip above">
                  <Download className="w-3 h-3" aria-hidden="true" /> Download
                </button>
              </div>
            </div>
          </article>
        ))}
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
