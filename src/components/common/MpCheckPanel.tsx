import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { MpFinding, MpModReport } from '../../types';

/**
 * What a mod's client code does directly that the game, in multiplayer, only does on the
 * server — one row per call, with the game's own handler as evidence. A call inside an
 * `if isClient()` branch is marked handled; a file that mentions isClient() anywhere is marked
 * aware, and its rows are notes rather than warnings.
 */
export const MpCheckPanel: React.FC<{ reports: MpModReport[]; onOpen?: (root: string, f: MpFinding) => void }> = ({ reports, onOpen }) => {
  const { t } = useTranslation();
  if (reports.length === 0) return null;
  const total = reports.reduce((n, r) => n + r.report.findings.filter((f) => !f.guarded).length, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-slate-400">
        {total === 0 ? t('mpCheck.none') : t('mpCheck.some', { count: total })}
      </div>
      {reports.map(({ mod_id, name, report }) => {
        const open = report.findings.filter((f) => !f.guarded);
        const guarded = report.findings.length - open.length;
        if (report.findings.length === 0) return null;
        return (
          <div key={mod_id} className="rounded-lg border border-slate-800 bg-slate-950/60">
            <div className="px-3 py-1.5 text-[11px] border-b border-slate-900 flex items-center justify-between gap-2">
              <span className="text-slate-200 font-bold truncate">{name} <span className="font-mono font-normal text-slate-500">{mod_id}</span></span>
              <span className="text-slate-500 shrink-0">
                {t('mpCheck.toLookAt', { count: open.length })}{guarded ? t('mpCheck.handled', { count: guarded }) : ''}{report.has_server_lua ? t('mpCheck.serverLua') : ''}
              </span>
            </div>
            {open.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onOpen?.(report.root, f)}
                title={`${t('mpCheck.rowTitle', { what: f.what, handler: f.handler, evidence: f.evidence })}${f.aware ? t('mpCheck.rowAware') : ''}${onOpen ? t('mpCheck.rowClick') : ''}`}
                className={`w-full text-left px-3 py-1.5 text-[11px] flex items-start gap-2 ${onOpen ? 'hover:bg-slate-900 cursor-pointer' : 'cursor-default'}`}
              >
                <span className={`font-mono shrink-0 w-6 text-center ${f.aware ? 'text-slate-500' : 'text-amber-300'}`}>{f.aware ? 'i' : '!'}</span>
                <span className="flex-1 min-w-0">
                  <span className="text-slate-200">{f.what}</span>
                  <span className="text-slate-500"> — {f.handler}</span>
                  <div className="font-mono text-[10px] text-slate-500 truncate">{f.path}:{f.line}  {f.snippet}</div>
                </span>
                {onOpen && <ExternalLink className="w-3 h-3 text-slate-600 shrink-0 mt-0.5" aria-hidden="true" />}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
};
