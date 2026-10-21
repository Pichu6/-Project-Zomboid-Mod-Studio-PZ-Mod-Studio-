import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map as MapIcon, RefreshCw, TriangleAlert } from 'lucide-react';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService } from '../../services/tauri';
import { MapCells } from '../../types';

interface MapsModuleProps {
  paths: StudioPathsUI;
}

const key = (c: [number, number]) => `${c[0]},${c[1]}`;
/** A colour per map, far apart on the wheel. */
const colour = (i: number, alpha = 0.85) => `hsla(${(i * 137.5) % 360}, 70%, 55%, ${alpha})`;
const VANILLA = 'rgba(71, 85, 105, 0.9)';
const CLASH = 'rgba(239, 68, 68, 1)';

/**
 * Every cell of the world the game ships and each installed map mod covers, on one grid: which
 * maps replace parts of the game's world, and where two maps fight over the same cells.
 */
export const MapsModule: React.FC<MapsModuleProps> = ({ paths }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<MapCells | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
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
  const shown = maps.filter((m) => !hidden.has(`${m.mod_id}/${m.folder}`));
  const clashes = (data?.clashes ?? []).filter((c) => !onlyActive || c.both_active);

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
  const size = bounds ? Math.max(3, Math.min(10, Math.floor(720 / Math.max(bounds.x1 - bounds.x0 + 1, bounds.y1 - bounds.y0 + 1)))) : 6;

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
    const cell = (c: [number, number], fill: string) => {
      g.fillStyle = fill;
      g.fillRect((c[0] - bounds.x0) * size, (c[1] - bounds.y0) * size, size - (size > 4 ? 1 : 0), size - (size > 4 ? 1 : 0));
    };
    for (const c of data.vanilla) cell(c, VANILLA);
    for (const m of shown) for (const c of m.cells) cell(c, colour(m.idx));
    for (const c of clashes) for (const x of c.cells) cell(x, CLASH);
  }, [data, shown, clashes, bounds, size]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!bounds) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / size) + bounds.x0;
    const y = Math.floor((e.clientY - r.top) / size) + bounds.y0;
    setHover({ x, y, px: e.clientX - r.left, py: e.clientY - r.top });
  };
  const hoverMaps = hover ? byCell.get(`${hover.x},${hover.y}`) ?? [] : [];
  const hoverVanilla = hover ? vanillaSet.has(`${hover.x},${hover.y}`) : false;

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

      <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer w-fit">
        <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="accent-emerald-500" />
        {t('maps.onlyActive')}
      </label>

      {clashes.length > 0 && (
        <div className="space-y-1.5">
          {clashes.map((c) => (
            <div key={`${c.a}|${c.b}`} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${c.both_active ? 'border-red-700/70 bg-red-950/40 text-red-200' : 'border-amber-700/60 bg-amber-950/30 text-amber-200'}`}>
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{c.both_active ? t('maps.clashNow', { a: c.a, b: c.b, count: c.cells.length }) : t('maps.clashIf', { a: c.a, b: c.b, count: c.cells.length })}</span>
            </div>
          ))}
        </div>
      )}

      {data && data.maps.length === 0 && <div className="p-8 text-center text-slate-500 text-xs">{t('maps.none')}</div>}

      {data && (
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          <div className="relative rounded-lg border border-slate-800 bg-slate-950 p-2 overflow-auto max-w-full">
            <canvas ref={canvas} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block" style={{ imageRendering: 'pixelated' }} aria-label={t('maps.gridLabel')} />
            {hover && (hoverVanilla || hoverMaps.length > 0) && (
              <div className="absolute pointer-events-none rounded-md border border-slate-700 bg-slate-900/95 px-2 py-1 text-[11px] text-slate-200 shadow-lg" style={{ left: hover.px + 18, top: hover.py + 8 }}>
                <div className="font-mono text-slate-400">{t('maps.cell', { x: hover.x, y: hover.y })}</div>
                {hoverVanilla && <div className="text-slate-400">{t('maps.vanillaCell')}</div>}
                {hoverMaps.map((name) => <div key={name}>{name}</div>)}
                {hover && clashSet.has(`${hover.x},${hover.y}`) && <div className="text-red-300">{t('maps.sharedCell')}</div>}
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
    </div>
  );
};
