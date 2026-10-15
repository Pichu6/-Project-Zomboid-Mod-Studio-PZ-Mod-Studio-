import React from 'react';
import { CatalogModSummary } from '../../types';
import { TauriService } from '../../services/tauri';

type SourceKind = 'steam' | 'nexus' | 'manual' | 'local' | 'upload' | 'studio';

const STYLE: Record<SourceKind, { label: string; className: string }> = {
  steam: { label: 'Steam', className: 'border-sky-600/60 text-sky-300 bg-sky-950/40' },
  nexus: { label: 'Nexus', className: 'border-orange-600/60 text-orange-300 bg-orange-950/40' },
  manual: { label: 'Manual', className: 'border-violet-600/60 text-violet-300 bg-violet-950/40' },
  local: { label: 'Local', className: 'border-slate-600 text-slate-300 bg-slate-900' },
  upload: { label: 'My upload', className: 'border-teal-600/60 text-teal-300 bg-teal-950/40' },
  studio: { label: 'Studio', className: 'border-emerald-600/60 text-emerald-300 bg-emerald-950/40' },
};

export function sourceOf(modId: string, entry: CatalogModSummary | undefined): { kind: SourceKind; title: string; url?: string } {
  if (modId.startsWith('Z_PZModStudio_')) return { kind: 'studio', title: 'Created by PZ Mod Studio' };
  if (!entry) return { kind: 'local', title: 'Installed in Zomboid/mods' };
  switch (entry.source.kind) {
    case 'workshop':
      return {
        kind: 'steam',
        title: `Steam Workshop item ${entry.source.workshop_id}`,
        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${entry.source.workshop_id}`,
      };
    case 'workshop_upload':
      return { kind: 'upload', title: `Your Workshop upload folder (${entry.source.item_folder})` };
    case 'local':
      if (entry.origin?.kind === 'nexus') {
        return { kind: 'nexus', title: `Downloaded from Nexus Mods (mod ${entry.origin.mod_id})`, url: entry.origin.page_url };
      }
      if (entry.origin?.kind === 'manual') {
        return { kind: 'manual', title: `Installed by hand${entry.origin.file_name ? ` from ${entry.origin.file_name}` : ''}` };
      }
      return { kind: 'local', title: 'In Zomboid/mods (installed outside the Studio)' };
  }
}

/** Small tag saying where a mod comes from; clicking it opens its page when there is one. */
export const SourceBadge: React.FC<{ modId: string; entry: CatalogModSummary | undefined }> = ({ modId, entry }) => {
  const src = sourceOf(modId, entry);
  const style = STYLE[src.kind];
  const className = `text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${style.className}`;
  if (!src.url) {
    return <span className={className} title={src.title}>{style.label}</span>;
  }
  return (
    <button
      type="button"
      className={`${className} cursor-pointer hover:brightness-125`}
      title={`${src.title}: open its page`}
      onClick={(e) => {
        e.stopPropagation();
        TauriService.openExternalUrl(src.url!);
      }}
    >
      {style.label}
    </button>
  );
};
