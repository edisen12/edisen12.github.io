import React from 'react';

export interface KpiCardProps {
  value: React.ReactNode;
  label: string;
  tone?: 'blue' | 'orange' | 'ok' | 'warn' | 'bad';
  sub?: React.ReactNode;
  className?: string;
}

export function KpiCard({ value, label, tone, sub, className = '' }: KpiCardProps) {
  const toneClass = tone ? `tone-${tone}` : '';

  return (
    <div className={`kpi-card ${toneClass} ${className}`.trim()}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
