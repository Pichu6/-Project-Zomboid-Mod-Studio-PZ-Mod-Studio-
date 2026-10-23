import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, CheckCircle2, ChevronDown, ChevronRight, FolderOpen, HardDrive, Loader2, Pin, PinOff, RefreshCw, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService } from '../../services/tauri';
import { AppInstance, SaveBackupEntry, SaveSummary, SavesOverview, SessionDiff } from '../../types';
import { formatBytes } from '../browse/common';
import i18next from 'i18next';

interface SavesModuleProps {
  paths: StudioPathsUI;
}

const when = (secs: number) => (secs ? new Date(secs * 1000).toLocaleString(i18next.language) : '');
/** A mod list entry as a plain id (`<workshop id>/<Mod>` -> `Mod`). */
const plainId = (id: string) => id.split('/').pop() ?? id;

/**
 * The player's saves and their backups. The Studio backs a save up when the player leaves it,
 * before it loads with changed mods and before its mod list is changed (the Link mod asks); here
 * the player sees them, makes one, keeps one, or puts one back. Every backup listed was read back
 * after it was written, and the room on the disk is always in view.
 */
export const SavesModule: React.FC<SavesModuleProps> = ({ paths }) => {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<SavesOverview | null>(null);
  const [diffs, setDiffs] = useState<Record<string, SessionDiff>>({});
  const [profiles, setProfiles] = useState<AppInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!paths.user_zomboid_dir) return;
    setLoading(true);
    const [next, sessions, list] = await Promise.all([
      TauriService.savesOverview(paths),
      TauriService.saveSessionDiffs(paths),
      TauriService.listInstances(paths.user_zomboid_dir).catch(() => [] as AppInstance[]),
    ]);
    if (next) setOverview(next);
    setDiffs(sessions);
    setProfiles(list);
    setLoading(false);
  }, [paths]);

  useEffect(() => {
    void refresh();
    const unlisten: Array<() => void> = [];
    void TauriService.listenSaveBackupsChanged(() => void refresh()).then((u) => unlisten.push(u));
    void TauriService.listenLinkGameState(() => void refresh()).then((u) => unlisten.push(u));
    return () => unlisten.forEach((u) => u());
  }, [refresh]);

  /**
   * The profile a save was played with. The Studio notes the active profile each time a save is
   * played while it runs; a save played without it is matched only to a profile whose mods are
   * exactly the save's. Anything less than that names no profile.
   */
  const profileOf = (save: SaveSummary): string | null => {
    const noted = diffs[save.id];
    if (noted?.profile) return profiles.find((p) => p.id === noted.profile)?.name ?? noted.profile_name ?? null;
    const mods = new Set(save.mods.map(plainId));
    const same = profiles.find((p) => p.active_mod_ids.length === mods.size && p.active_mod_ids.every((id) => mods.has(plainId(id))));
    return same?.name ?? null;
  };

  const free = overview?.free_bytes ?? null;
  const biggest = useMemo(() => Math.max(0, ...(overview?.saves ?? []).map((s) => s.bytes)), [overview]);
  /** Short of room: the biggest save could not be backed up twice more. */
  const lowSpace = free !== null && biggest > 0 && free < biggest * 2 + 256 * 1024 * 1024;

  const run = async (key: string, job: () => Promise<string>) => {
    setWorking(key);
    setNotice(null);
    try {
      setNotice({ tone: 'ok', text: await job() });
    } catch (err) {
      setNotice({ tone: 'error', text: String(err) });
    }
    setWorking(null);
    void refresh();
  };

  const backUp = (save: SaveSummary) =>
    run(`backup:${save.id}`, async () => {
      const out = await TauriService.backupSave(paths, save.id);
      return out.unchanged ? t('saves.unchangedKept', { world: save.world }) : t('saves.backedUp', { world: save.world, size: formatBytes(out.entry.zip_bytes) });
    });

  const restore = (save: SaveSummary, b: SaveBackupEntry) => {
    if (!window.confirm(t('saves.restoreConfirm', { world: save.world, when: when(b.at) }))) return;
    void run(`restore:${save.id}:${b.file}`, async () => {
      await TauriService.restoreSaveBackup(paths, save.id, b.file);
      return t('saves.restored', { world: save.world, when: when(b.at) });
    });
  };

  const remove = (save: SaveSummary, b: SaveBackupEntry) => {
    if (!window.confirm(t('saves.deleteConfirm', { when: when(b.at), world: save.world }))) return;
    void run(`delete:${save.id}:${b.file}`, async () => {
      await TauriService.deleteSaveBackup(paths, save.id, b.file);
      return t('saves.deleted', { when: when(b.at) });
    });
  };

  const toggleKept = (save: SaveSummary, b: SaveBackupEntry) =>
    run(`kept:${save.id}:${b.file}`, async () => {
      await TauriService.setSaveBackupKept(paths, save.id, b.file, !b.kept);
      return b.kept ? t('saves.unkept', { when: when(b.at) }) : t('saves.kept', { when: when(b.at) });
    });

  const status = (save: SaveSummary) => {
    if (save.busy || working === `backup:${save.id}`)
      return <span className="flex items-center gap-1 text-sky-300"><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('saves.status.busy')}</span>;
    if (save.backed_up) return <span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="w-3.5 h-3.5" />{t('saves.status.backedUp')}</span>;
    if (save.backups.length > 0) return <span className="flex items-center gap-1 text-amber-300"><ShieldAlert className="w-3.5 h-3.5" />{t('saves.status.changed', { when: when(save.backups[0].at) })}</span>;
    return <span className="flex items-center gap-1 text-red-300"><ShieldAlert className="w-3.5 h-3.5" />{t('saves.status.none')}</span>;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2"><Archive className="w-5 h-5 text-emerald-400" />{t('saves.title')}</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">{t('saves.blurb', { keep: overview?.keep_automatic ?? 5 })}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => void TauriService.openBackupsFolder(paths)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer">
            <FolderOpen className="w-3.5 h-3.5" />{t('saves.openFolder')}
          </button>
          <button onClick={() => void refresh()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer" aria-label={t('saves.refresh')}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* The room on the disk, always in view. */}
      <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 text-xs ${lowSpace ? 'border-amber-600/60 bg-amber-950/30 text-amber-200' : 'border-slate-800 bg-slate-900/60 text-slate-300'}`}>
        <HardDrive className="w-4 h-4 shrink-0" />
        <div className="flex-1 min-w-0">
          {free !== null
            ? t('saves.space', { free: formatBytes(free), total: formatBytes(overview?.total_bytes ?? 0), used: formatBytes(overview?.backups_bytes ?? 0) || '0 B' })
            : t('saves.spaceUnknown', { used: formatBytes(overview?.backups_bytes ?? 0) || '0 B' })}
          {lowSpace && <div className="mt-0.5 font-semibold">{t('saves.lowSpace', { size: formatBytes(biggest) })}</div>}
          <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5" title={overview?.backup_dir}>{overview?.backup_dir}</div>
        </div>
      </div>

      {notice && (
        <div className={`rounded-md border px-3 py-2 text-xs ${notice.tone === 'ok' ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200' : 'border-red-700/60 bg-red-950/40 text-red-200'}`}>{notice.text}</div>
      )}

      {overview && overview.saves.length === 0 && (
        <div className="p-8 text-center text-slate-500 text-xs">{t('saves.empty')}</div>
      )}

      <div className="space-y-2">
        {overview?.saves.map((save) => {
          const expanded = open === save.id;
          const roomFor = free === null || free > save.bytes + 256 * 1024 * 1024;
          return (
            <div key={save.id} className="rounded-lg border border-slate-800 bg-slate-900/70">
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => setOpen(expanded ? null : save.id)} className="text-slate-500 hover:text-slate-300 cursor-pointer" aria-label={t('saves.showBackups')}>
                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-slate-100 truncate">{save.world}</span>
                    {(() => {
                      const profile = profileOf(save);
                      return profile ? (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-sky-700/60 text-sky-300" title={t('saves.profileTitle')}>
                          {t('saves.profile', { name: profile })}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {t('saves.line', { mode: save.mode, size: formatBytes(save.bytes), files: save.files.toLocaleString(), mods: save.mods.length, when: when(save.modified) })}
                  </div>
                  {(() => {
                    const d = diffs[save.id];
                    if (!d || (d.added.length === 0 && d.removed.length === 0 && d.updated.length === 0 && !d.reordered)) return null;
                    const parts = [
                      d.added.length > 0 && t('saves.session.added', { count: d.added.length }),
                      d.removed.length > 0 && t('saves.session.removed', { count: d.removed.length }),
                      d.updated.length > 0 && t('saves.session.updated', { count: d.updated.length }),
                      d.reordered && t('saves.session.reordered'),
                    ].filter(Boolean).join(' · ');
                    const detail = [
                      d.removed.length > 0 && `${t('saves.session.removedList')}: ${d.removed.join(', ')}`,
                      d.added.length > 0 && `${t('saves.session.addedList')}: ${d.added.join(', ')}`,
                      d.updated.length > 0 && `${t('saves.session.updatedList')}: ${d.updated.join(', ')}`,
                    ].filter(Boolean).join('\n');
                    return (
                      <div className="text-[11px] text-amber-300 mt-0.5" title={detail}>
                        {t('saves.session.line', { when: when(d.at), what: parts })}
                      </div>
                    );
                  })()}
                </div>
                <div className="text-[11px] shrink-0">{status(save)}</div>
                <button
                  onClick={() => void backUp(save)}
                  disabled={working !== null || save.busy || !roomFor}
                  title={!roomFor ? t('saves.noRoom', { size: formatBytes(save.bytes) }) : undefined}
                  className="shrink-0 px-2.5 py-1.5 rounded-md bg-emerald-700/70 hover:bg-emerald-600/80 text-emerald-50 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {t('saves.backUpNow')}
                </button>
              </div>
              {expanded && (
                <div className="border-t border-slate-800 px-4 py-2 space-y-1">
                  {save.backups.length === 0 && <div className="text-xs text-slate-500 py-2">{t('saves.noBackups')}</div>}
                  {save.backups.map((b) => (
                    <div key={b.file} className="flex items-center gap-3 text-xs py-1.5">
                      <div className="flex-1 min-w-0">
                        <span className="text-slate-200">{when(b.at)}</span>
                        <span className="ml-2 text-slate-400">{t(`saves.reason.${b.reason}`, { defaultValue: b.reason })}</span>
                        {b.kept && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-sky-700/60 text-sky-300">{t('saves.keptChip')}</span>}
                        <div className="text-[10px] text-slate-500">
                          {t('saves.backupLine', { zip: formatBytes(b.zip_bytes), size: formatBytes(b.save_bytes), files: b.files.toLocaleString(), mods: b.mods.length })}
                          {b.verified && <span className="ml-2 text-emerald-400">✓ {t('saves.verified')}</span>}
                        </div>
                      </div>
                      <button onClick={() => void toggleKept(save, b)} disabled={working !== null} title={b.kept ? t('saves.unkeepTitle') : t('saves.keepTitle', { keep: overview?.keep_automatic ?? 5 })} className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-sky-300 disabled:opacity-40 cursor-pointer">
                        {b.kept ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => restore(save, b)} disabled={working !== null} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40 cursor-pointer">
                        <RotateCcw className="w-3.5 h-3.5" />{t('saves.restore')}
                      </button>
                      <button onClick={() => remove(save, b)} disabled={working !== null} className="p-1.5 rounded hover:bg-red-950/60 text-slate-500 hover:text-red-300 disabled:opacity-40 cursor-pointer" aria-label={t('saves.delete')} title={t('saves.delete')}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
