import React, { useState } from 'react';
import { ModInfo, ModListVersion } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, explainError } from '../../services/tauri';
import { History, X } from 'lucide-react';

interface ModListHistoryProps {
  paths: StudioPathsUI;
  mods: ModInfo[];
  /** The list on disk is the source of truth: after a restore it is re-read. */
  onRefreshMods: () => void | Promise<void>;
  toast: (message: string, ms?: number) => void;
}

/**
 * Undo for the mod list. Every time the Studio writes `default.txt` it keeps the one before in
 * `Zomboid/PZModStudio_Backups`; this is the button that shows them and puts one back.
 */
export const ModListHistory: React.FC<ModListHistoryProps> = ({ paths, mods, onRefreshMods, toast }) => {
  /** Earlier versions of the list, read from the Studio's own backups when asked for. */
  const [history, setHistory] = useState<ModListVersion[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  /** The name the list shows for a mod id, or the id when it is not installed any more. */
  const nameOfMod = (id: string) => mods.find((m) => m.mod_id === id)?.name ?? id;

  const openHistory = async () => {
    setHistory(await TauriService.modListHistory(paths));
  };

  /**
   * Goes back to an earlier list. The list on disk now becomes a version of its own, so this can
   * be undone the same way, and the Mod List is re-read because the file is the source of truth.
   */
  const handleRestoreVersion = async (version: ModListVersion) => {
    const changes = [
      version.added.length > 0 ? `switch ${version.added.length} back on` : null,
      version.removed.length > 0 ? `switch ${version.removed.length} off` : null,
    ].filter(Boolean);
    const ok = window.confirm(
      `Go back to the list saved at ${version.saved_at} (${version.active_count} mods)?` +
        (changes.length > 0 ? `\n\nThis would ${changes.join(' and ')}.` : '\n\nIt matches your list as it is now.') +
        `\n\nYour list as it is now is kept as a version too, so you can come straight back.`
    );
    if (!ok) return;
    setRestoring(version.file);
    try {
      await TauriService.restoreModListVersion(paths, version.file);
      await onRefreshMods();
      setHistory(await TauriService.modListHistory(paths));
      toast(`Your mod list is back to ${version.saved_at}.`, 4000);
    } catch (err) {
      alert(explainError(err));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <>
      <button
        onClick={openHistory}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer transition"
        title="Undo a change to your list: every time the Studio wrote it, the one before was kept. Pick one and it is put back."
      >
        <History className="w-3.5 h-3.5 text-slate-400" />
        <span>Earlier lists</span>
      </button>

      {/* Earlier versions of the list, which were on disk all along. */}
      {history !== null && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setHistory(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <History className="w-4 h-4 text-cyan-400" />
                  <span>Your mod list, earlier</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  This is undo for the list. Every time the Studio wrote it — a mod switched on or off, a
                  profile, a sort, a package published — it kept the one before. Pick a version and it is
                  put back as your list; the one you have now is kept here too.
                </p>
              </div>
              <button onClick={() => setHistory(null)} className="text-slate-500 hover:text-slate-300 p-1 cursor-pointer">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                No earlier version yet. One is kept each time your list changes.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-800 rounded-xl border border-slate-800">
                {history.map((v) => {
                  const same = v.added.length === 0 && v.removed.length === 0;
                  return (
                    <div key={v.file} className="p-3 flex items-start justify-between gap-3 hover:bg-slate-950/60 transition">
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-slate-200">{v.saved_at}</div>
                        <div className="text-[11px] text-slate-400">
                          {v.active_count} mods
                          {same ? ' · same as your list now' : ''}
                          {v.added.length > 0 ? ` · ${v.added.length} back on` : ''}
                          {v.removed.length > 0 ? ` · ${v.removed.length} off` : ''}
                        </div>
                        {(v.added.length > 0 || v.removed.length > 0) && (
                          <div className="text-[10px] text-slate-500 truncate mt-0.5">
                            {[...v.added.map((id) => `+${nameOfMod(id)}`), ...v.removed.map((id) => `-${nameOfMod(id)}`)]
                              .slice(0, 6)
                              .join(', ')}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleRestoreVersion(v)}
                        disabled={restoring !== null}
                        className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer transition disabled:opacity-50"
                      >
                        {restoring === v.file ? 'Going back...' : 'Go back to this'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
