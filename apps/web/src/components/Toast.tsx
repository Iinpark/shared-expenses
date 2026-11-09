import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon.js';

/** Тост: строка или LiveToast (D02, S03) — что изменилось, вторая строка про твой баланс, ссылка и крестик. */
export interface ToastContent {
  text: string;
  sub?: string;
  action?: { label: string; to: string };
}

type Show = (toast: string | ToastContent) => void;

/** Без провайдера тост просто не показывается. */
const noToast: Show = () => undefined;
const ToastContext = createContext<Show>(noToast);

/** Простой тост висит 3,5 секунды, живой — дольше: его успевают прочитать и нажать «В ленту». */
const SHORT_MS = 3500;
const LIVE_MS = 9000;

/** Тихий тёмный тост внизу экрана: без звука и анимации-отскока (HANDOFF, «Поведение»). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastContent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);
  const show = useCallback<Show>((t) => {
    const content = typeof t === 'string' ? { text: t } : t;
    setToast(content);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        setToast(null);
      },
      content.sub || content.action ? LIVE_MS : SHORT_MS,
    );
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">{toast && <ToastView toast={toast} onClose={hide} />}</div>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onClose }: { toast: ToastContent; onClose: () => void }) {
  if (!toast.sub && !toast.action) return <div className="toast">{toast.text}</div>;
  return (
    <div className="toast toast--live">
      <div className="toast__body">
        <strong className="toast__title">{toast.text}</strong>
        {toast.sub && <span className="toast__sub">{toast.sub}</span>}
      </div>
      {toast.action && (
        <Link to={toast.action.to} className="toast__action" onClick={onClose}>
          {toast.action.label}
        </Link>
      )}
      <button type="button" className="toast__close" aria-label="Закрыть" onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

export const useToast = () => useContext(ToastContext);
