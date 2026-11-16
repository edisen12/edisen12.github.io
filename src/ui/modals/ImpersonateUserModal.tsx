import React, { useMemo, useState, useEffect } from 'react';
import {
  Eye,
  Search,
  UserCheck,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Anchor,
  Globe
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import { useApp } from '../state/AppContext';
import { ROLES_LABEL } from '../../config/constants';
import type { SystemRole } from '../../domain/types';
import { buildPlatformIndex, resolvePersonUns } from '../../domain/calculations';
import { normalizeText } from '../../utils/format';
import {
  buildImpersonationTargets,
  type ImpersonationTarget
} from '../../utils/impersonation';

type RoleFilter = 'todos' | SystemRole;

export function ImpersonateUserModal() {
  const {
    isRealAdmin,
    realUserProfile,
    isImpersonating,
    impersonatedTarget,
    fullDataset,
    dataset,
    impersonateModalOpen,
    closeImpersonateModal,
    startImpersonation,
    stopImpersonation
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('todos');

  useEffect(() => {
    if (!impersonateModalOpen) {
      setSearchTerm('');
      setRoleFilter('todos');
    }
  }, [impersonateModalOpen]);

  const baseDataset = fullDataset || dataset;
  const fullPidx = useMemo(
    () => buildPlatformIndex(baseDataset?.plataformas || {}),
    [baseDataset]
  );

  const allTargets = useMemo(() => {
    if (!baseDataset) return [];
    return buildImpersonationTargets(baseDataset, realUserProfile?.id);
  }, [baseDataset, realUserProfile?.id]);

  const roleCounts = useMemo(() => {
    const counts: Record<RoleFilter, number> = {
      todos: allTargets.length,
      preposto: 0,
      controlador: 0,
      gestor: 0,
      admin: 0
    };
    allTargets.forEach(t => {
      if (t.profile.role in counts) {
        counts[t.profile.role]++;
      }
    });
    return counts;
  }, [allTargets]);

  const roleOptions = useMemo<Array<SegmentedOption<RoleFilter>>>(
    () => [
      { value: 'todos', label: 'Todos', count: roleCounts.todos },
      { value: 'preposto', label: 'Prepostos', count: roleCounts.preposto },
      { value: 'controlador', label: 'Controladores', count: roleCounts.controlador },
      { value: 'gestor', label: 'Gestores', count: roleCounts.gestor },
      { value: 'admin', label: 'Admins', count: roleCounts.admin }
    ],
    [roleCounts]
  );

  const filteredTargets = useMemo(() => {
    const q = normalizeText(searchTerm);
    return allTargets.filter(t => {
      if (roleFilter !== 'todos' && t.profile.role !== roleFilter) return false;
      if (!q) return true;
      const uns = t.pessoa ? resolvePersonUns(t.pessoa, fullPidx) : [];
      const plats = t.pessoa?.plats || [];
      const searchable = `${t.profile.nome} ${t.profile.email} ${ROLES_LABEL[t.profile.role] || t.profile.role} ${plats.join(' ')} ${uns.join(' ')}`;
      return normalizeText(searchable).includes(q);
    });
  }, [allTargets, roleFilter, searchTerm, fullPidx]);

  const showSelfAdminCard = useMemo(() => {
    if (!isImpersonating || !realUserProfile) return false;
    if (roleFilter !== 'todos' && roleFilter !== 'admin') return false;
    const q = normalizeText(searchTerm);
    if (!q) return true;
    const searchable = `${realUserProfile.nome} ${realUserProfile.email} admin administrador voltar minha conta`;
    return normalizeText(searchable).includes(q);
  }, [isImpersonating, realUserProfile, roleFilter, searchTerm]);

  if (!isRealAdmin || !impersonateModalOpen) {
    return null;
  }

  const handleSelectTarget = (target: ImpersonationTarget) => {
    startImpersonation(target);
  };

  return (
    <Modal
      open={Boolean(impersonateModalOpen)}
      onClose={closeImpersonateModal}
      icon={<Eye size={20} />}
      title="Ver e usar o sistema como outro usuário"
      subtitle="Simule exatamente o escopo de dados, abas e permissões de qualquer usuário para validação"
      maxWidth={760}
      footer={
        <div
          style={{
            display: 'flex',
            justifyContent: isImpersonating ? 'space-between' : 'flex-end',
            alignItems: 'center',
            gap: '10px',
            width: '100%',
            flexWrap: 'wrap'
          }}
        >
          {isImpersonating && (
            <button
              type="button"
              className="btn btn-accent"
              onClick={stopImpersonation}
            >
              <RotateCcw size={15} />
              <span>Encerrar simulação e voltar para Admin</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={closeImpersonateModal}
          >
            Fechar
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="note note-info" style={{ margin: 0, fontSize: '0.84rem' }}>
          <ShieldCheck size={17} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: '1px' }} />
          <div>
            Durante a simulação, sua sessão administrativa permanece protegida: o sistema aplica em
            memória o mesmo recorte de carteiras, plataformas, apontamentos e abas visíveis para o
            usuário selecionado.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Buscar por nome, e-mail, plataforma (ex: P-51) ou UN..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '8px 12px 8px 34px' }}
              aria-label="Buscar usuário para simular"
              autoFocus
            />
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '11px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-muted)'
              }}
            />
          </div>

          <SegmentedControl<RoleFilter>
            options={roleOptions}
            value={roleFilter}
            onChange={setRoleFilter}
            size="sm"
            ariaLabel="Filtrar usuários por papel"
          />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxHeight: '380px',
            overflowY: 'auto',
            paddingRight: '2px'
          }}
        >
          {showSelfAdminCard && realUserProfile && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--orange, #d97706)',
                background: 'var(--warn-soft, #fef3c7)'
              }}
            >
              <div style={{ minWidth: '220px', flex: '1 1 280px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '0.94rem', color: 'var(--ink)' }}>
                    {realUserProfile.nome}
                  </strong>
                  <span className="pill pill-ok">Administrador</span>
                  <span className="pill pill-info" style={{ fontSize: '0.72rem' }}>
                    Sua conta real
                  </span>
                </div>
                <div
                  className="sub"
                  style={{ fontSize: '0.8rem', marginTop: '3px', fontFamily: 'monospace' }}
                >
                  {realUserProfile.email}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={stopImpersonation}
                style={{ whiteSpace: 'nowrap' }}
              >
                <RotateCcw size={15} />
                <span>Retornar à conta Admin</span>
              </button>
            </div>
          )}

          {filteredTargets.length === 0 && !showSelfAdminCard ? (
            <div
              style={{
                textAlign: 'center',
                padding: '28px 16px',
                color: 'var(--ink-muted)',
                border: '1px dashed var(--line)',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              Nenhum usuário encontrado com os critérios informados.
            </div>
          ) : (
            filteredTargets.map(target => {
              const isCurrentSim = impersonatedTarget?.key === target.key;
              const isTargetGlobal =
                target.profile.role === 'admin' || target.profile.role === 'gestor';
              const plats = target.pessoa?.plats || [];
              const uns = target.pessoa ? resolvePersonUns(target.pessoa, fullPidx) : [];
              const hasEmptyScope = !isTargetGlobal && plats.length === 0 && uns.length === 0;
              const roleLabel = ROLES_LABEL[target.profile.role] || target.profile.role;

              return (
                <div
                  key={target.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${isCurrentSim ? 'var(--blue)' : 'var(--line)'}`,
                    background: isCurrentSim ? 'var(--blue-soft)' : 'var(--surface-alt)'
                  }}
                >
                  <div style={{ minWidth: '220px', flex: '1 1 280px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.94rem', color: 'var(--ink)' }}>
                        {target.profile.nome}
                      </strong>
                      <span
                        className={`pill ${
                          target.profile.role === 'admin'
                            ? 'pill-ok'
                            : target.profile.role === 'gestor'
                            ? 'pill-info'
                            : target.profile.role === 'controlador'
                            ? 'pill-warn'
                            : 'pill-none'
                        }`}
                      >
                        {roleLabel}
                      </span>
                      {!target.hasLoginAccount ? (
                        <span className="pill pill-warn" style={{ fontSize: '0.72rem' }}>
                          Sem login criado (simulação cadastral)
                        </span>
                      ) : target.profile.ativo ? (
                        <span className="pill pill-ok" style={{ fontSize: '0.72rem' }}>
                          Conta ativa
                        </span>
                      ) : (
                        <span className="pill pill-bad" style={{ fontSize: '0.72rem' }}>
                          Conta inativa
                        </span>
                      )}
                      {isCurrentSim && (
                        <span className="pill pill-info" style={{ fontSize: '0.72rem' }}>
                          Ativo agora
                        </span>
                      )}
                    </div>

                    <div
                      className="sub"
                      style={{ fontSize: '0.8rem', marginTop: '3px', fontFamily: 'monospace' }}
                    >
                      {target.profile.email}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                        marginTop: '6px',
                        fontSize: '0.8rem',
                        color: hasEmptyScope ? 'var(--warn)' : 'var(--ink-secondary)'
                      }}
                    >
                      {isTargetGlobal ? (
                        <>
                          <Globe size={13} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                          <span>Acesso Global ao Contrato</span>
                        </>
                      ) : !target.pessoa ? (
                        <>
                          <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                          <span>Sem registro de carteira vinculado (carteira vazia)</span>
                        </>
                      ) : hasEmptyScope ? (
                        <>
                          <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                          <span>0 plataformas vinculadas (carteira vazia)</span>
                        </>
                      ) : (
                        <>
                          <Anchor size={13} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                          <span>
                            <strong>{plats.length}</strong> plataforma{plats.length === 1 ? '' : 's'}:{' '}
                            {plats.slice(0, 6).join(', ')}
                            {plats.length > 6 ? ` (+${plats.length - 6})` : ''}
                            {uns.length > 0 ? ` · UNs: ${uns.join(', ')}` : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`btn btn-sm ${isCurrentSim ? 'btn-ghost' : 'btn-primary'}`}
                    disabled={isCurrentSim}
                    onClick={() => handleSelectTarget(target)}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {isCurrentSim ? (
                      <>
                        <UserCheck size={15} />
                        <span>Visualizando</span>
                      </>
                    ) : (
                      <>
                        <Eye size={15} />
                        <span>Ver como este usuário</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
