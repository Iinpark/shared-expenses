import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/** Без провайдера тост просто не показывается. */
const noToast: (text: string) => void = () => undefined;
const ToastContext = createContext<(text: string) => void>(noToast);

/** Тихий тост внизу экрана: без звука и анимации-отскока (HANDOFF, «Поведение»). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((t: string) => {
    setText(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setText(null);
    }, 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">{text && <div className="toast">{text}</div>}</div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
