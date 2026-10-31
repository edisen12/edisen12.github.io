import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface DrawerProps {
  open: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string | number;
  className?: string;
}

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 540,
  className = ''
}: DrawerProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Fecha no Escape e trava o scroll do fundo
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="drawer-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={boxRef}
        className={`drawer-box ${className}`.trim()}
        style={{ width }}
        role="dialog"
        aria-modal="true"
      >
        <div className="drawer-header">
          <div className="drawer-titles">
            <div className="drawer-title">{title}</div>
            {subtitle && <div className="drawer-subtitle">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Fechar painel"
            style={{ color: 'var(--ink-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="drawer-body">{children}</div>

        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </>
  );
}
