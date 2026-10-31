import React from 'react';
import { AlertTriangle, ShieldAlert, Filter, X } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { ROLES_LABEL } from '../../config/constants';

export function ScopeBanner() {
  const { dataset, isGlobal, userProfile, filters, updateFilter } = useApp();

  // Banner 1: Modo Demo Ativo
  if (dataset.isDemo) {
    return (
      <div
        className="scope-banner note note-warn"
        style={{
          padding: '8px 14px',
          marginBottom: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}
        role="status"
      >
        <AlertTriangle size={18} style={{ color: 'var(--orange)', flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: '0.84rem' }}>
          <strong>Ambiente de Demonstração:</strong>{' '}
          <span style={{ color: 'var(--ink-secondary)' }}>
            {dataset.demoReason || 'Nenhuma importação real realizada ainda. Dados fictícios gerados para demonstração.'}
          </span>
        </div>
      </div>
    );
  }

  // Banner 2: Carteira Restrita do Usuário (Preposto / Controlador)
  if (!isGlobal && userProfile) {
    const roleName = ROLES_LABEL[userProfile.role] || userProfile.role;
    return (
      <div
        className="scope-banner note"
        style={{
          padding: '8px 14px',
          marginBottom: '14px',
          borderLeftColor: 'var(--orange)',
          background: 'var(--blue-soft)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}
        role="status"
      >
        <ShieldAlert size={18} style={{ color: 'var(--blue)', flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: '0.84rem' }}>
          <strong>Escopo restrito ({userProfile.nome} · {roleName}):</strong>{' '}
          <span style={{ color: 'var(--ink-secondary)' }}>
            Exibindo exclusivamente as plataformas e unidades sob sua gestão operacional.
          </span>
        </div>
      </div>
    );
  }

  // Banner 3: Filtro Global Ativo por Responsável
  if (isGlobal && filters.fResp) {
    return (
      <div
        className="scope-banner note"
        style={{
          padding: '8px 14px',
          marginBottom: '14px',
          borderLeftColor: 'var(--blue)',
          background: 'var(--surface-alt)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px'
        }}
        role="status"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem' }}>
          <Filter size={16} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span>
            Visualizando dados filtrados pelo responsável <strong>{filters.fResp}</strong>.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => updateFilter('fResp', '')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            fontSize: '0.78rem',
            minHeight: '26px'
          }}
          title="Remover filtro de responsável"
        >
          <X size={13} />
          <span>Ver todo o contrato</span>
        </button>
      </div>
    );
  }

  return null;
}
