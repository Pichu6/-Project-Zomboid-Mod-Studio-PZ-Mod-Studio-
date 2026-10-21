import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map as MapIcon, RefreshCw, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService } from '../../services/tauri';
import { MapCells, MapImage } from '../../types';

interface MapsModuleProps {
  paths: StudioPathsUI;
}

const key = (c: [number, number]) => `${c[0]},${c[1]}`;
/** A colour per map, far apart on the wheel. */
const colour = (i: number, alpha = 0.85) => `hsla(${(i * 137.5) % 360}, 70%, 55%, ${alpha})`;
const VANILLA = 'rgba(71, 85, 105, 0.9)';
const CLASH = 'rgba(239, 68, 68, 1)';
/** Pixels per cell, smallest to largest. */
const ZOOMS = [6, 10, 16, 24, 32];
const SQUARES_PER_CELL = 256;

/**
 * Every cell of the world the game ships and each installed map mod covers, on one grid over the
 * real map: which maps replace parts of the game's world, and where two maps fight over the same
 * cells. Below, the mods about maps with no cells of their own (spawn points, tiles).
 */
export const MapsModule: React.FC<MapsModuleProps> = ({ paths }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<MapCells | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [realMap, setRealMap] = useState(true);
  const [zoom, setZoom] = useState<number | null>(null);
  const [images, setImages] = useState<{ img: MapImage; el: HTMLImageElement }[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  const load = async () => {
    if (!paths.user_zomboid_dir) return;
    setLoading(true);
    setData(await TauriService.mapCells(paths));
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  const maps = useMemo(() => (data?.maps ?? []).map((m, i) => ({ ...m, idx: i })).filter((m) => !onlyActive || m.active), [data, onlyActive]);
  const shown = useMemo(() => maps.filter((m) => !hidden.has(`${m.mod_id}/${m.folder}`)), [maps, hidden]);
  const clashes = useMemo(() => (data?.clashes ?? []).filter((c) => !onlyActive || c.both_active), [data, onlyActive]);
  const related = (data?.related ?? []).filter((r) => !onlyActive || r.active);
  const tiledefClashes = (data?.tiledef_clashes ?? []).filter((c) => !onlyActive || c.both_active);

  // Who is on each cell, for the drawing and the hover.
  const byCell = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const m of shown) for (const c of m.cells) out.set(key(c), [...(out.get(key(c)) ?? []), m.title]);
    return out;
  }, [shown]);
  const vanillaSet = useMemo(() => new Set((data?.vanilla ?? []).map(key)), [data]);
  const clashSet = useMemo(() => new Set(clashes.flatMap((c) => c.cells.map(key))), [clashes]);

  const bounds = useMemo(() => {
    const all = [...(data?.vanilla ?? []), ...shown.flatMap((m) => m.cells)];
    if (all.length === 0) return null;
    const xs = all.map((c) => c[0]);
    const ys = all.map((c) => c[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }, [data, shown]);
  const fitted = bounds ? Math.max(3, Math.min(10, Math.floor(720 / Math.max(bounds.x1 - bounds.x0 + 1, bounds.y1 - bounds.y0 + 1)))) : 6;
  const size = zoom ?? fitted;
  // The images come at 16 px per cell, or 32 when zoomed in past 16.
  const imagePx = size > 16 ? 32 : 16;

  useEffect(() => {
    if (!realMap || !data || !paths.user_zomboid_dir) return;
    let gone = false;
    const urls: string[] = [];
    setImagesLoading(true);
    void (async () => {
      const list = await TauriService.mapImages(paths, imagePx);
      const loaded: { img: MapImage; el: HTMLImageElement }[] = [];
      for (const img of list) {
        const url = await TauriService.mapImageUrl(paths, img.id);
        if (!url || gone) continue;
        urls.push(url);
        const el = new Image();
        el.src = url;
        try {
          await el.decode();
          loaded.push({ img, el });
        } catch {
          // a broken image is left out; the grid still draws
        }
      }
      if (!gone) {
        setImages(loaded);
        setImagesLoading(false);
      }
    })();
    return () => {
      gone = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [realMap, data, paths, imagePx]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !bounds || !data) return;
    const w = (bounds.x1 - bounds.x0 + 1) * size;
    const h = (bounds.y1 - bounds.y0 + 1) * size;
    el.width = w;
    el.height = h;
    const g = el.getContext('2d');
    if (!g) return;
    g.fillStyle = '#020617';
    g.fillRect(0, 0, w, h);
    const withMap = realMap && images.length > 0;
    const gap = size > 4 ? 1 : 0;
    const at = (c: [number, number]) => [(c[0] - bounds.x0) * size, (c[1] - bounds.y0) * size] as const;
    const cell = (c: [number, number], fill: string) => {
      const [x, y] = at(c);
      g.fillStyle = fill;
      g.fillRect(x, y, size - gap, size - gap);
    };
    if (withMap) {
      g.imageSmoothingEnabled = true;
      for (const { img, el: im } of images) {
        const shownMod = img.folder === 'Muldraugh, KY' || shown.some((m) => m.folder === img.folder);
        if (!shownMod) continue;
        const x = (img.bounds[0] / SQUARES_PER_CELL - bounds.x0) * size;
        const y = (img.bounds[1] / SQUARES_PER_CELL - bounds.y0) * size;
        g.drawImage(im, x, y, ((img.bounds[2] - img.bounds[0]) / SQUARES_PER_CELL) * size, ((img.bounds[3] - img.bounds[1]) / SQUARES_PER_CELL) * size);
      }
      // The game's world as a faint grid over its own picture.
      if (size >= 6) {
        g.strokeStyle = 'rgba(15, 23, 42, 0.35)';
        g.lineWidth = 1;
        for (const c of data.vanilla) {
          const [x, y] = at(c);
          g.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
        }
      }
      for (const m of shown) for (const c of m.cells) cell(c, colour(m.idx, 0.45));
      for (const c of clashes) for (const x of c.cells) cell(x, 'rgba(239, 68, 68, 0.7)');
    } else {
      for (const c of data.vanilla) cell(c, VANILLA);
      for (const m of shown) for (const c of m.cells) cell(c, colour(m.idx));
      for (const c of clashes) for (const x of c.cells) cell(x, CLASH);
    }
  }, [data, shown, clashes, bounds, size, realMap, images]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!bounds) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / size) + bounds.x0;
    const y = Math.floor((e.clientY - r.top) / size) + bounds.y0;
    setHover({ x, y, px: e.clientX - r.left, py: e.clientY - r.top });
  };
  const hoverMaps = hover ? byCell.get(`${hover.x},${hover.y}`) ?? [] : [];
  const hoverVanilla = hover ? vanillaSet.has(`${hover.x},${hover.y}`) : false;
  const zoomBy = (step: number) => {
    const next = step > 0 ? ZOOMS.find((z) => z > size) : [...ZOOMS].reverse().find((z) => z < size);
    if (next) setZoom(next);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2"><MapIcon className="w-5 h-5 text-emerald-400" />{t('maps.title')}</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">{t('maps.blurb')}</p>
        </div>
        <button onClick={() => void load()} disabled={loading} aria-label={t('maps.refresh')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer w-fit">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="accent-emerald-500" />
          {t('maps.onlyActive')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer w-fit">
          <input type="checkbox" checked={realMap} onChange={(e) => setRealMap(e.target.checked)} className="accent-emerald-500" />
          {t('maps.realMap')}
        </label>
        <span className="flex items-center gap-1 text-xs text-slate-400">
          {t('maps.zoom')}
          <button onClick={() => zoomBy(-1)} disabled={size <= ZOOMS[0]} aria-label={`${t('maps.zoom')} -`} className="p-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"><ZoomOut className="w-3.5 h-3.5" /></button>
          <span className="w-10 text-center font-mono">{size}px</span>
          <button onClick={() => zoomBy(1)} disabled={size >= ZOOMS[ZOOMS.length - 1]} aria-label={`${t('maps.zoom')} +`} className="p-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"><ZoomIn className="w-3.5 h-3.5" /></button>
        </span>
        {realMap && imagesLoading && <span className="text-[11px] text-slate-500 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" />{t('maps.loadingImage')}</span>}
      </div>

      {(clashes.length > 0 || tiledefClashes.length > 0) && (
        <div className="space-y-1.5">
          {clashes.map((c) => (
            <div key={`${c.a}|${c.b}`} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${c.both_active ? 'border-red-700/70 bg-red-950/40 text-red-200' : 'border-amber-700/60 bg-amber-950/30 text-amber-200'}`}>
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{c.both_active ? t('maps.clashNow', { a: c.a, b: c.b, count: c.cells.length }) : t('maps.clashIf', { a: c.a, b: c.b, count: c.cells.length })}</span>
            </div>
          ))}
          {tiledefClashes.map((c) => {
            const names = c.mods.map((m) => `${m[1]}${m[3] ? '' : ` (${t('maps.off')})`}`).join(', ');
            return (
              <div key={`tiledef-${c.number}`} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${c.both_active ? 'border-red-700/70 bg-red-950/40 text-red-200' : 'border-amber-700/60 bg-amber-950/30 text-amber-200'}`}>
                <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{c.both_active ? t('maps.tiledefNow', { number: c.number, mods: names }) : t('maps.tiledefIf', { number: c.number, mods: names })}</span>
              </div>
            );
          })}
        </div>
      )}

      {data && data.maps.length === 0 && <div className="p-8 text-center text-slate-500 text-xs">{t('maps.none')}</div>}

      {data && (
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          <div className="relative rounded-lg border border-slate-800 bg-slate-950 p-2 overflow-auto max-w-full max-h-[75vh]">
            <canvas ref={canvas} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block" style={{ imageRendering: realMap && images.length > 0 ? 'auto' : 'pixelated' }} aria-label={t('maps.gridLabel')} />
            {hover && (hoverVanilla || hoverMaps.length > 0) && (
              <div className="absolute pointer-events-none rounded-md border border-slate-700 bg-slate-900/95 px-2 py-1 text-[11px] text-slate-200 shadow-lg" style={{ left: hover.px + 18, top: hover.py + 8 }}>
                <div className="font-mono text-slate-400">{t('maps.cell', { x: hover.x, y: hover.y })}</div>
                {hoverVanilla && <div className="text-slate-400">{t('maps.vanillaCell')}</div>}
                {hoverMaps.map((name) => <div key={name}>{name}</div>)}
                {clashSet.has(`${hover.x},${hover.y}`) && <div className="text-red-300">{t('maps.sharedCell')}</div>}
              </div>
            )}
            <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: VANILLA }} />{t('maps.legendVanilla')}</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: CLASH }} />{t('maps.legendClash')}</span>
            </div>
          </div>

          <div className="flex-1 min-w-[260px] space-y-1.5">
            {maps.map((m) => {
              const id = `${m.mod_id}/${m.folder}`;
              const off = hidden.has(id);
              return (
                <label key={id} className={`flex items-start gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 cursor-pointer ${off ? 'opacity-50' : ''}`}>
                  <input type="checkbox" checked={!off} onChange={() => setHidden((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })} className="mt-0.5 accent-emerald-500" />
                  <span className="inline-block w-3 h-3 mt-0.5 rounded-sm shrink-0" style={{ background: colour(m.idx) }} />
                  <span className="min-w-0">
                    <span className="block text-xs text-slate-100 truncate">{m.title}</span>
                    <span className="block text-[10px] text-slate-500 truncate">{m.mod_name}</span>
                    <span className="block text-[10px] text-slate-400">
                      {t('maps.cells', { count: m.cells.length })}
                      {' · '}
                      {m.over_vanilla > 0 ? t('maps.overVanilla', { count: m.over_vanilla }) : t('maps.outsideVanilla')}
                      {m.lots.length > 0 ? ` · ${t('maps.buildsOn', { maps: m.lots.join(', ') })}` : ''}
                      {!m.active ? ` · ${t('maps.off')}` : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-200">{t('maps.related', { count: related.length })}</h3>
          <p className="text-[11px] text-slate-400 max-w-3xl">{t('maps.relatedBlurb')}</p>
          {related.length === 0 ? (
            <div className="text-xs text-slate-500">{t('maps.noRelated')}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-1.5">
              {related.map((r) => (
                <div key={r.mod_id} className={`rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 ${r.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-slate-100 truncate">{r.mod_name}</span>
                    {r.kinds.map((k) => (
                      <span key={k} className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${k === 'spawn' ? 'bg-sky-900/60 text-sky-200' : 'bg-violet-900/60 text-violet-200'}`}>{t(`maps.kind_${k}`)}</span>
                    ))}
                    {!r.active && <span className="shrink-0 text-[10px] text-slate-500">{t('maps.off')}</span>}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono truncate" title={r.detail.join('\n')}>{r.mod_id} · {r.detail.join(' · ')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
