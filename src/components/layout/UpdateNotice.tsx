import React, { useEffect, useState } from 'react';
import { Download, X, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TauriService } from '../../services/tauri';
import { AppUpdateStatus } from '../../types';

const RELEASES = 'https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/releases/latest';

/**
 * A bar under the header when a newer PZ Mod Studio is out. The check runs once at start (the
 * backend asks GitHub at most once a day, and not at all when it is off in Settings). Download
 * opens the release page in the browser; "Not now" hides it until the next version.
 */
export const UpdateNotice: React.FC<{ userZomboidDir: string }> = ({ userZomboidDir }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);

  useEffect(() => {
    if (!userZomboidDir) return;
    let alive = true;
    void TauriService.appUpdateStatus(userZomboidDir).then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, [userZomboidDir]);

  if (!status || !status.enabled || !status.newer || status.dismissed || !status.latest) return null;
  const latest = status.latest;

  return (
    <div role="status" className="flex items-center gap-3 px-4 py-1.5 bg-emerald-950/70 border-b border-emerald-800/60 text-xs text-emerald-100">
      <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
      <span className="font-semibold">{t('update.available', { latest })}</span>
      <span className="text-emerald-300/70">({t('update.current', { current: status.current })})</span>
      <button
        type="button"
        onClick={() => TauriService.openExternalUrl(status.url ?? RELEASES)}
        className="ml-auto flex items-center gap-1 px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" /> {t('update.download')}
      </button>
      <button
        type="button"
        title={t('update.notNowTitle')}
        onClick={() => {
          void TauriService.dismissAppUpdate(userZomboidDir, latest);
          setStatus({ ...status, dismissed: true });
        }}
        className="flex items-center gap-1 px-2 py-0.5 rounded text-emerald-300 hover:bg-emerald-900/60 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" /> {t('update.notNow')}
      </button>
    </div>
  );
};
