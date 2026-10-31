import React from 'react';
import type { ContractConfig, StatusMeta } from '../../domain/types';
import { formatPct } from '../../utils/format';

export interface Sparkline120Props {
  items: Array<{ label: string; pct: number | null }>;
  config: ContractConfig;
  className?: string;
}

export function Sparkline120({ items, config, className = '' }: Sparkline120Props) {
  const meta = config.meta_percentual || 100;
  const atencao = config.atencao_percentual || 90;

  // Escala base: 120% representa 100% da altura do componente
  const metaBottomPct = Math.min(100, (meta / 120) * 100);
  const atencaoBottomPct = Math.min(100, (atencao / 120) * 100);

  return (
    <div className={`spark-container ${className}`.trim()}>
      <div className="spark" role="img" aria-label="Histórico de aderência diária escala 120%">
        {/* Linha guia de Meta (100%) */}
        <div
          className="spark-guide-100"
          style={{ bottom: `${metaBottomPct}%` }}
          title={`Meta Contratual (${meta}%)`}
        />
        {/* Linha guia de Atenção (90%) */}
        <div
          className="spark-guide-90"
          style={{ bottom: `${atencaoBottomPct}%` }}
          title={`Faixa de Atenção (${atencao}%)`}
        />

        {items.map((it, idx) => {
          let st: StatusMeta = 'sem';
          let heightPct = 0;

          if (it.pct != null) {
            if (it.pct >= meta - 0.0001) st = 'ok';
            else if (it.pct >= atencao) st = 'warn';
            else st = 'bad';

            heightPct = Math.min(100, Math.max(4, (it.pct / 120) * 100));
          }

          return (
            <div
              key={`${it.label}_${idx}`}
              className={`spark-col ${st}`}
              style={{ height: it.pct != null ? `${heightPct}%` : '3px' }}
              title={`${it.label}: ${formatPct(it.pct)}`}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--ink-muted)' }}>
        <span>Escala 0–120%</span>
        <span>Meta: {meta}%</span>
      </div>
    </div>
  );
}
