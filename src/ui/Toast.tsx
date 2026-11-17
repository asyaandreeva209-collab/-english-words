// Простые всплывающие уведомления.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  text: string;
}

type ShowToast = (text: string) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

/** extra — постоянные элементы в области тостов (например, «Доступно обновление»). */
export function ToastProvider({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback<ShowToast>((text) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-2), { id, text }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {extra}
        {items.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
