import React from 'react';
import type { StatusMeta } from '../../domain/types';
import { formatPct } from '../../utils/format';

export interface MeterBarProps {
  pct: number | null;
  status: StatusMeta;
  className?: string;
}

export function MeterBar({ pct, status, className = '' }: MeterBarProps) {
  const displayPct = formatPct(pct);
  const fillWidth = pct == null ? 0 : Math.min(100, Math.max(0, pct));

  return (
    <div className={`meter ${className}`.trim()} title={pct != null ? `${displayPct}` : 'Sem dados'}>
      <span className="meter-val">{displayPct}</span>
      <div className="meter-track" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`meter-fill ${status}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}
