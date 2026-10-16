import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { BACKEND_ERROR_EVENT, BackendErrorDetail, explainError } from '../../services/tauri';

interface ToastItem extends BackendErrorDetail {
  id: number;
}

const AUTO_DISMISS_MS = 12000;
const MAX_VISIBLE = 4;

/** Shows every failed backend operation reported through TauriService (reportBackendError). */
export const BackendErrorToasts: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    let nextId = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onError = (e: Event) => {
      const detail = (e as CustomEvent<BackendErrorDetail>).detail;
      const id = nextId++;
      setToasts((prev) => [...prev, { ...detail, id }].slice(-MAX_VISIBLE));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, AUTO_DISMISS_MS);
      timers.add(timer);
    };
    window.addEventListener(BACKEND_ERROR_EVENT, onError);
    return () => {
      window.removeEventListener(BACKEND_ERROR_EVENT, onError);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)]" role="status" aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} role="alert" className="flex items-start gap-3 p-3 rounded-lg border border-red-500/40 bg-red-950/90 text-red-100 shadow-lg">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold">{t.action} failed</div>
            <div className="text-[11px] text-red-200/90 break-words">{explainError(t.message)}</div>
          </div>
          <button
            type="button"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="p-0.5 rounded text-red-300 hover:text-white hover:bg-red-800/60 cursor-pointer"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
