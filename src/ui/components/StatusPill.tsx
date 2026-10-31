import React from 'react';
import type { StatusMeta } from '../../domain/types';

export interface StatusPillProps {
  status: StatusMeta;
  text?: string;
  className?: string;
}

const DEFAULT_LABELS: Record<StatusMeta, string> = {
  ok: 'Na meta',
  warn: 'Atenção',
  bad: 'Abaixo da meta',
  sem: 'Sem dado',
  info: 'Informação'
};

export function StatusPill({ status, text, className = '' }: StatusPillProps) {
  const label = text ?? DEFAULT_LABELS[status] ?? status;

  return (
    <span className={`pill pill-${status} ${className}`.trim()} role="status">
      {label}
    </span>
  );
}
