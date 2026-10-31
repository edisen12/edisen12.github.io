import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string | number;
  className?: string;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  maxWidth = 620,
  className = ''
}: ModalProps) {
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
    <div
      className="modal-overlay"
      onClick={e => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={boxRef}
        className={`modal-box ${className}`.trim()}
        style={{ maxWidth }}
      >
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Fechar janela"
            style={{ color: 'var(--ink-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
