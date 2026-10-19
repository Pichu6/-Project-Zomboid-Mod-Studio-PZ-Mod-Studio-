import React from 'react';
import { CatalogModSummary } from '../../types';
import { TauriService } from '../../services/tauri';
import i18next from 'i18next';

type SourceKind = 'steam' | 'nexus' | 'manual' | 'local' | 'upload' | 'studio' | 'compat';

const STYLE: Record<SourceKind, string> = {
  steam: 'border-sky-600/60 text-sky-300 bg-sky-950/40',
  nexus: 'border-orange-600/60 text-orange-300 bg-orange-950/40',
  manual: 'border-violet-600/60 text-violet-300 bg-violet-950/40',
  local: 'border-slate-600 text-slate-300 bg-slate-900',
  upload: 'border-teal-600/60 text-teal-300 bg-teal-950/40',
  studio: 'border-emerald-600/60 text-emerald-300 bg-emerald-950/40',
  compat: 'border-amber-600/60 text-amber-300 bg-amber-950/40',
};

export function sourceOf(modId: string, entry: CatalogModSummary | undefined): { kind: SourceKind; title: string; url?: string } {
  // Studio packages, the Live Bridge and the Claude Agent mod are all installed by the Studio.
  if (modId.startsWith('Z_PZModStudio_') || modId === 'Z_ClaudeAgent') return { kind: 'studio', title: i18next.t('source.studioTitle') };
  if (!entry) return { kind: 'local', title: i18next.t('source.localTitle') };
  switch (entry.source.kind) {
    case 'workshop':
      return {
        kind: 'steam',
        title: i18next.t('source.workshopTitle', { id: entry.source.workshop_id }),
        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${entry.source.workshop_id}`,
      };
    case 'workshop_upload':
      return { kind: 'upload', title: i18next.t('source.uploadTitle', { folder: entry.source.item_folder }) };
    case 'local':
      if (entry.origin?.kind === 'nexus') {
        return { kind: 'nexus', title: i18next.t('source.nexusTitle', { id: entry.origin.mod_id }), url: entry.origin.page_url };
      }
      if (entry.origin?.kind === 'compat') {
        return {
          kind: 'compat',
          title: i18next.t('source.compatTitle', { changes: entry.origin.changes.join(' ') }),
          url: entry.origin.workshop_id ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${entry.origin.workshop_id}` : undefined,
        };
      }
      if (entry.origin?.kind === 'url') {
        return {
          kind: 'manual',
          title: i18next.t('source.urlTitle', { source: entry.origin.source }),
          url: entry.origin.page_url ?? entry.origin.url,
        };
      }
      if (entry.origin?.kind === 'manual') {
        return { kind: 'manual', title: entry.origin.file_name ? i18next.t('source.manualFromTitle', { file: entry.origin.file_name }) : i18next.t('source.manualTitle') };
      }
      return { kind: 'local', title: i18next.t('source.outsideTitle') };
  }
}

/** Small tag saying where a mod comes from; clicking it opens its page when there is one. */
export const SourceBadge: React.FC<{ modId: string; entry: CatalogModSummary | undefined }> = ({ modId, entry }) => {
  const src = sourceOf(modId, entry);
  const label = i18next.t(`source.${src.kind}`);
  const className = `text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${STYLE[src.kind]}`;
  if (!src.url) {
    return <span className={className} title={src.title}>{label}</span>;
  }
  return (
    <button
      type="button"
      className={`${className} cursor-pointer hover:brightness-125`}
      title={i18next.t('source.openPage', { title: src.title })}
      onClick={(e) => {
        e.stopPropagation();
        TauriService.openExternalUrl(src.url!);
      }}
    >
      {label}
    </button>
  );
};
