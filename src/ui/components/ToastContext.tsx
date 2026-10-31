import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react';

export type ToastVariant = 'info' | 'success' | 'warn' | 'error';

export interface ToastItem {
  id: string;
  msg: string;
  variant: ToastVariant;
}

export interface ToastContextValue {
  showToast: (msg: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((msg: string, variant: ToastVariant = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newToast: ToastItem = { id, msg, variant };

    setToasts(prev => [...prev.slice(-4), newToast]); // Mantém no máximo 5 toasts simultâneos

    const timer = setTimeout(() => {
      removeToast(id);
    }, 4500);

    timersRef.current.set(id, timer);
  }, [removeToast]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map(toast => {
          const Icon =
            toast.variant === 'success'
              ? CheckCircle2
              : toast.variant === 'warn'
              ? AlertTriangle
              : toast.variant === 'error'
              ? AlertCircle
              : Info;

          return (
            <div
              key={toast.id}
              className={`toast-item ${toast.variant}`}
              role={toast.variant === 'error' ? 'alert' : 'status'}
            >
              <Icon size={18} className="toast-icon" aria-hidden="true" />
              <span className="toast-msg" style={{ flex: 1 }}>{toast.msg}</span>
              <button
                type="button"
                className="btn-icon"
                onClick={() => removeToast(toast.id)}
                aria-label="Fechar notificação"
                style={{ padding: 2, minHeight: 'auto', minWidth: 'auto', color: 'var(--ink-muted)' }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast deve ser usado dentro de um ToastProvider');
  }
  return context;
}
