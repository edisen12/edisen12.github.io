import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { acquireScrollLock, registerEscapeLayer } from '../../utils/scrollLock';

export interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string | number;
  className?: string;
}

export function Modal({
  open,
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  maxWidth = 620,
  className = ''
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Fecha no Escape (respeitando pilha de overlays) e trava o scroll do fundo
  useEffect(() => {
    if (!open) return;

    const releaseScrollLock = acquireScrollLock();
    const releaseEscapeLayer = registerEscapeLayer(() => onCloseRef.current(), 120);

    return () => {
      releaseEscapeLayer();
      releaseScrollLock();
    };
  }, [open]);

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
        style={{ maxWidth, width: '100%' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
            {icon && (
              <div className="modal-header-icon">
                {icon}
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="modal-title">{title}</div>
              {subtitle && <div className="modal-subtitle">{subtitle}</div>}
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Fechar janela"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
