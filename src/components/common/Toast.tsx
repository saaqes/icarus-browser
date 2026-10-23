import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMessages } from '../../i18n';
import { Icon } from './Icon';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Notify = (kind: ToastKind, message: string) => void;

const ToastContext = createContext<Notify>(() => {});

const DURATION_MS: Record<ToastKind, number> = { success: 3200, info: 4500, error: 6500 };

/** Notificaciones discretas en la parte inferior. Los errores se anuncian como alerta. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const notify = useCallback<Notify>(
    (kind, message) => {
      const id = nextId.current++;
      setToasts((items) => [...items.filter((item) => item.message !== message).slice(-3), { id, kind, message }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), DURATION_MS[kind]));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const m = useMessages();
  const icon = { success: 'check', error: 'warning', info: 'info' } as const;
  return (
    <div className="toast-viewport">
      <div role="status" aria-live="polite" className="toast-stack">
        {toasts
          .filter((toast) => toast.kind !== 'error')
          .map((toast) => (
            <div key={toast.id} className={`toast toast--${toast.kind}`}>
              <Icon name={icon[toast.kind]} size={16} />
              <span>{toast.message}</span>
              <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label={m.toast.dismiss}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
      </div>
      <div role="alert" className="toast-stack">
        {toasts
          .filter((toast) => toast.kind === 'error')
          .map((toast) => (
            <div key={toast.id} className="toast toast--error">
              <Icon name="warning" size={16} />
              <span>{toast.message}</span>
              <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label={m.toast.dismiss}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

export function useToast(): Notify {
  return useContext(ToastContext);
}
