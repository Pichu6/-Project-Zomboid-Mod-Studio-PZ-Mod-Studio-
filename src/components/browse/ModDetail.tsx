import React, { useEffect, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, FileArchive, Heart, Loader2, Play, Users, X } from 'lucide-react';
import { NexusMod, NexusModDetails, WorkshopInstallState, WorkshopItem, WorkshopItemDetails } from '../../types';
import { TauriService, reportBackendError } from '../../services/tauri';
import { BBCode } from './BBCode';
import { BuildChips, Chip, InstalledChip, UpdateChips, formatBytes, formatCount, formatIsoDate, formatUnixDate } from './common';

export type DetailTarget =
  | { kind: 'workshop'; id: string; preview?: WorkshopItem }
  | { kind: 'nexus'; modId: number; preview?: NexusMod };

interface ModDetailProps {
  target: DetailTarget;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onOpen: (target: DetailTarget) => void;
  /** Workshop id -> installed mod ids. */
  installedByItem: Map<string, string[]>;
  stateByItem: Map<string, WorkshopInstallState>;
  /** Nexus mod id -> installed mod ids. */
  installedByNexusId: Map<number, string[]>;
  onNexusDownload: (m: NexusMod) => void;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-1.5">
    <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">{title}</h3>
    {children}
  </section>
);

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) =>
  value ? (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 text-right">{value}</span>
    </div>
  ) : null;

/** Big image plus a strip of thumbnails. */
const Gallery: React.FC<{ images: string[]; videos?: string[] }> = ({ images, videos = [] }) => {
  const [current, setCurrent] = useState(0);
  const imagesKey = images.join('|');
  useEffect(() => {
    setCurrent(0);
  }, [imagesKey]);
  if (images.length === 0) return <div className="aspect-video rounded-lg bg-slate-950 flex items-center justify-center text-slate-700 text-xs">No image</div>;
  return (
    <div className="flex flex-col gap-2">
      <div className="aspect-video rounded-lg bg-slate-950 overflow-hidden flex items-center justify-center">
        <img src={images[Math.min(current, images.length - 1)]} alt="" className="max-w-full max-h-full object-contain" />
      </div>
      {(images.length > 1 || videos.length > 0) && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button key={src} type="button" onClick={() => setCurrent(i)} aria-label={`Image ${i + 1}`}
              className={`shrink-0 w-24 aspect-video rounded overflow-hidden border-2 cursor-pointer ${i === current ? 'border-emerald-500' : 'border-transparent opacity-70 hover:opacity-100'}`}>
              <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
          {videos.map((id) => (
            <button key={id} type="button" onClick={() => TauriService.openExternalUrl(`https://www.youtube.com/watch?v=${id}`)}
              className="relative shrink-0 w-24 aspect-video rounded overflow-hidden border-2 border-transparent opacity-80 hover:opacity-100 cursor-pointer" title="Watch on YouTube (browser)">
              <img src={`https://img.youtube.com/vi/${id}/mqdefault.jpg`} alt="" loading="lazy" className="w-full h-full object-cover" />
              <Play className="absolute inset-0 m-auto w-6 h-6 text-white drop-shadow" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ActionButton: React.FC<{ onClick: () => void; className: string; title?: string; children: React.ReactNode }> = ({ onClick, className, title, children }) => (
  <button type="button" onClick={onClick} title={title}
    className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer ${className}`}>
    {children}
  </button>
);

function useDetails<T>(load: () => Promise<T>, key: string, what: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoading(true);
    load()
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && reportBackendError(what, err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, loading };
}

const WorkshopDetail: React.FC<ModDetailProps & { target: { kind: 'workshop' } & DetailTarget }> = ({ target, installedByItem, stateByItem, onOpen }) => {
  const { data, loading } = useDetails<WorkshopItemDetails>(() => TauriService.workshopItemDetails(target.id), target.id, 'Loading the Workshop item');
  const item = data?.item ?? target.preview;
  const installed = installedByItem.get(target.id) ?? [];
  const images = [...(item?.preview_url ? [item.preview_url] : []), ...(data?.screenshots ?? [])];
  const missing = data?.required_items.filter((r) => !installedByItem.has(r.workshop_id)) ?? [];
  const categories = item?.tags.filter((t) => !/^Build \d+$/.test(t)) ?? [];

  return (
    <DetailLayout
      title={item?.title ?? `Workshop item ${target.id}`}
      subtitle={data?.author ? `by ${data.author}` : undefined}
      chips={<>{installed.length > 0 && <InstalledChip />}<UpdateChips state={stateByItem.get(target.id)} />{item && <BuildChips builds={item.builds} source="The Workshop page" />}</>}
      loading={loading}
      main={
        <>
          <Gallery images={images} videos={data?.videos} />
          {data ? <BBCode source={data.description} /> : item?.summary && <p className="text-xs text-slate-400">{item.summary}</p>}
        </>
      }
      side={
        <>
          <div className="flex flex-col gap-2">
            <ActionButton onClick={() => TauriService.openExternalUrl(item?.page_url ?? `https://steamcommunity.com/sharedfiles/filedetails/?id=${target.id}`)}
              className="bg-sky-700 hover:bg-sky-600 text-white"
              title="Opens the Workshop page in your browser; press Subscribe there (logged in on steamcommunity.com)">
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> {installed.length > 0 ? 'Open Workshop page' : 'Open page to subscribe'}
            </ActionButton>
            {installed.length > 0 && <div className="text-[10px] font-mono text-emerald-400/80 break-all">Installed as: {installed.join(', ')}</div>}
          </div>
          {item && (
            <Section title="Info">
              <InfoRow label="Subscribers" value={<span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{formatCount(item.subscriptions)}</span>} />
              <InfoRow label="Favorites" value={<span className="inline-flex items-center gap-1"><Heart className="w-3 h-3" />{formatCount(item.favorited)}</span>} />
              <InfoRow label="Size" value={formatBytes(item.file_size)} />
              <InfoRow label="Created" value={formatUnixDate(data?.time_created)} />
              <InfoRow label="Updated" value={formatUnixDate(item.time_updated)} />
              <InfoRow label="Workshop id" value={<span className="font-mono">{target.id}</span>} />
            </Section>
          )}
          {categories.length > 0 && (
            <Section title="Categories">
              <div className="flex flex-wrap gap-1">{categories.map((t) => <Chip key={t} className="border-slate-700 text-slate-300">{t}</Chip>)}</div>
            </Section>
          )}
          {data && data.required_items.length > 0 && (
            <Section title={`Required items (${data.required_items.length}${missing.length ? `, ${missing.length} missing` : ''})`}>
              <div className="flex flex-col gap-1">
                {data.required_items.map((r) => {
                  const have = installedByItem.has(r.workshop_id);
                  return (
                    <button key={r.workshop_id} type="button" onClick={() => onOpen({ kind: 'workshop', id: r.workshop_id })}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-slate-800 bg-slate-950/60 hover:border-slate-600 text-left cursor-pointer">
                      <span className="text-[11px] text-slate-200 line-clamp-2">{r.title || r.workshop_id}</span>
                      {have ? <InstalledChip /> : <Chip className="border-amber-500/60 text-amber-300">Missing</Chip>}
                    </button>
                  );
                })}
              </div>
            </Section>
          )}
          {item && !item.is_project_zomboid && <p className="text-[11px] text-amber-300">This item is for another game.</p>}
          {item?.banned && <p className="text-[11px] text-red-300">Steam has banned this item.</p>}
        </>
      }
    />
  );
};

const FILE_STYLE: Record<string, string> = {
  MAIN: 'border-emerald-600/60 text-emerald-300',
  UPDATE: 'border-sky-600/60 text-sky-300',
  OPTIONAL: 'border-violet-600/60 text-violet-300',
};

const NexusDetail: React.FC<ModDetailProps & { target: { kind: 'nexus' } & DetailTarget }> = ({ target, installedByNexusId, onNexusDownload, onOpen }) => {
  const { data, loading } = useDetails<NexusModDetails>(() => TauriService.nexusModDetails(target.modId), String(target.modId), 'Loading the Nexus mod');
  const m = data?.mod ?? target.preview;
  const installed = installedByNexusId.get(target.modId) ?? [];
  const pageUrl = m?.page_url ?? `https://www.nexusmods.com/projectzomboid/mods/${target.modId}`;
  const image = m?.picture_url ?? m?.thumbnail_url ?? null;

  return (
    <DetailLayout
      title={m?.name ?? `Nexus mod ${target.modId}`}
      subtitle={m ? `by ${m.author || m.uploader || 'unknown'}${m.version ? ` · v${m.version}` : ''}` : undefined}
      chips={<>{installed.length > 0 && <InstalledChip />}{m && <BuildChips builds={m.build_hint ? m.build_hint.split('+') : []} source="The Nexus name/summary" />}{m?.category && <Chip className="border-orange-700/60 text-orange-300">{m.category}</Chip>}</>}
      loading={loading}
      main={
        <>
          <Gallery images={image ? [image] : []} />
          {data ? <BBCode source={data.description} /> : m?.summary && <p className="text-xs text-slate-400">{m.summary}</p>}
        </>
      }
      side={
        <>
          <div className="flex flex-col gap-2">
            {m && (
              <ActionButton onClick={() => onNexusDownload(m)} className="bg-orange-700 hover:bg-orange-600 text-white"
                title="Opens the Files tab on Nexus: download there, then use Install .zip in Browse Mods">
                <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download on Nexus
              </ActionButton>
            )}
            <ActionButton onClick={() => TauriService.openExternalUrl(pageUrl)} className="bg-slate-800 hover:bg-slate-700 text-slate-200">
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Open Nexus page
            </ActionButton>
            {installed.length > 0 && <div className="text-[10px] font-mono text-emerald-400/80 break-all">Installed as: {installed.join(', ')}</div>}
            <p className="text-[10px] text-slate-500">After downloading, press <b>Install .zip</b> at the top of Browse Mods and choose the file.</p>
          </div>
          {m && (
            <Section title="Info">
              <InfoRow label="Downloads" value={formatCount(m.downloads)} />
              <InfoRow label="Endorsements" value={formatCount(m.endorsements)} />
              <InfoRow label="Created" value={formatIsoDate(m.created_at)} />
              <InfoRow label="Updated" value={formatIsoDate(m.updated_at)} />
              <InfoRow label="Nexus id" value={<span className="font-mono">{target.modId}</span>} />
            </Section>
          )}
          {data && data.requirements.length > 0 && (
            <Section title={`Requirements (${data.requirements.length})`}>
              <div className="flex flex-col gap-1">
                {data.requirements.map((r, i) => {
                  const nexusId = !r.external && r.mod_id ? r.mod_id : null;
                  const have = nexusId !== null && installedByNexusId.has(nexusId);
                  return (
                    <button key={i} type="button"
                      onClick={() => (nexusId !== null ? onOpen({ kind: 'nexus', modId: nexusId }) : r.url && TauriService.openExternalUrl(r.url))}
                      className="flex flex-col gap-0.5 px-2 py-1.5 rounded border border-slate-800 bg-slate-950/60 hover:border-slate-600 text-left cursor-pointer">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-200">{r.name}</span>
                        {have ? <InstalledChip /> : r.external ? <Chip className="border-slate-700 text-slate-400">external</Chip> : null}
                      </span>
                      {r.notes && <span className="text-[10px] text-slate-500">{r.notes}</span>}
                    </button>
                  );
                })}
              </div>
            </Section>
          )}
          {data && data.files.length > 0 && (
            <Section title={`Files (${data.files.length})`}>
              <div className="flex flex-col gap-1">
                {data.files.map((f, i) => (
                  <div key={i} className="flex flex-col gap-0.5 px-2 py-1.5 rounded border border-slate-800 bg-slate-950/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-200 min-w-0">
                        <FileArchive className="w-3 h-3 shrink-0 text-slate-500" aria-hidden="true" />
                        <span className="truncate" title={f.name}>{f.name}</span>
                      </span>
                      <Chip className={FILE_STYLE[f.category] ?? 'border-slate-700 text-slate-400'}>{f.category.toLowerCase()}</Chip>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {[f.version && `v${f.version}`, formatBytes(f.size_bytes), formatUnixDate(f.uploaded)].filter(Boolean).join(' · ')}
                    </div>
                    {f.description && <div className="text-[10px] text-slate-400 line-clamp-3">{f.description}</div>}
                  </div>
                ))}
              </div>
            </Section>
          )}
          {m?.adult_content && <p className="text-[11px] text-amber-300">Marked as adult content on Nexus.</p>}
        </>
      }
    />
  );
};

const DetailLayout: React.FC<{
  title: string;
  subtitle?: string;
  chips: React.ReactNode;
  loading: boolean;
  main: React.ReactNode;
  side: React.ReactNode;
}> = ({ title, subtitle, chips, loading, main, side }) => (
  <>
    <div className="flex flex-col gap-1 min-w-0">
      <h2 className="text-base font-bold text-slate-100 leading-snug flex items-center gap-2">
        <span className="min-w-0">{title}</span>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-500 shrink-0" aria-label="Loading" />}
      </h2>
      <div className="flex flex-wrap items-center gap-1.5">
        {subtitle && <span className="text-[11px] text-slate-400 mr-1">{subtitle}</span>}
        {chips}
      </div>
    </div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] mt-3">
      <div className="flex flex-col gap-4 min-w-0">{main}</div>
      <aside className="flex flex-col gap-4">{side}</aside>
    </div>
  </>
);

/** Full-page detail view over the Browse tab (Esc closes). */
export const ModDetail: React.FC<ModDetailProps> = (props) => {
  const { target, canGoBack, onBack, onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [target]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-full flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2">
            {canGoBack && (
              <button type="button" onClick={onBack} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-300 hover:bg-slate-800 cursor-pointer">
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back
              </button>
            )}
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${target.kind === 'workshop' ? 'border-sky-700 text-sky-300' : 'border-orange-700 text-orange-300'}`}>
              {target.kind === 'workshop' ? 'STEAM WORKSHOP' : 'NEXUS MODS'}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div ref={scrollRef} className="overflow-y-auto p-5">
          {target.kind === 'workshop' ? <WorkshopDetail {...props} target={target} /> : <NexusDetail {...props} target={target} />}
        </div>
      </div>
    </div>
  );
};
