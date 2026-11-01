// ==============================================================================
// View: AdminAuditView - Governança, Gestão de Contas & Trilha de Auditoria WORM
// Design System Corporativo Infotec Brasil - Alta Disponibilidade & Compliance
// ==============================================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Users,
  Search,
  RefreshCw,
  Download,
  KeyRound,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Eye,
  Copy,
  Check,
  UserCheck,
  UserX,
  UserPlus,
  FileJson,
  Filter,
  Shield
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { KpiCard } from '../components/KpiCard';
import { Modal } from '../components/Modal';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import {
  fetchSystemAuditLogs,
  deleteUserAccount,
  logSystemEvent
} from '../../services/data.service';
import { adminManageUser } from '../../services/auth.service';
import { ROLES_LABEL } from '../../config/constants';
import type { SystemAuditLog, UserProfile, SystemRole } from '../../domain/types';

type AdminMainTab = 'audit' | 'users';
type CategoryFilter = 'all' | 'usuarios' | 'seguranca' | 'configuracoes' | 'cadastros' | 'operacional';

export const AdminAuditView: React.FC = () => {
  const { dataset, isGlobal, isAdmin, userProfile, refreshData } = useApp();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<AdminMainTab>('audit');

  // Estados da Trilha de Auditoria
  const [logs, setLogs] = useState<SystemAuditLog[]>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<SystemAuditLog | null>(null);
  const [jsonCopied, setJsonCopied] = useState<boolean>(false);

  // Estados de Gestão de Contas
  const [userSearch, setUserSearch] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [newAdminModalOpen, setNewAdminModalOpen] = useState<boolean>(false);

  // Modais de Ação de Usuário
  const [resetPwUser, setResetPwUser] = useState<UserProfile | null>(null);
  const [toggleActiveUser, setToggleActiveUser] = useState<UserProfile | null>(null);
  const [deleteTargetUser, setDeleteTargetUser] = useState<UserProfile | null>(null);

  // Carregamento de Logs
  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await fetchSystemAuditLogs({
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        limit: 300
      });
      setLogs(data);
    } catch (err: any) {
      showToast('Falha ao carregar trilha de auditoria.', 'error');
    } finally {
      setLogsLoading(false);
    }
  }, [categoryFilter, showToast]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Contagem de Administradores Ativos
  const activeAdminsCount = useMemo(() => {
    const profiles = Object.values(dataset.profiles || {});
    return profiles.filter(p => p.role === 'admin' && p.ativo).length;
  }, [dataset.profiles]);

  // Contagem de Alertas de Segurança nos últimos 7 dias
  const securityAlertsCount7d = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return logs.filter(l => {
      if (l.category !== 'seguranca') return false;
      const logDate = new Date(l.created_at);
      return logDate >= sevenDaysAgo;
    }).length;
  }, [logs]);

  // Total de Contas no Sistema
  const allProfilesList = useMemo(() => {
    return Object.values(dataset.profiles || {});
  }, [dataset.profiles]);

  // Filtragem local de Logs
  const filteredLogs = useMemo(() => {
    let result = logs;

    if (categoryFilter !== 'all') {
      result = result.filter(l => l.category === categoryFilter);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      result = result.filter(l =>
        (l.action && l.action.toLowerCase().includes(term)) ||
        (l.actor_nome && l.actor_nome.toLowerCase().includes(term)) ||
        (l.actor_email && l.actor_email.toLowerCase().includes(term)) ||
        (l.target_label && l.target_label.toLowerCase().includes(term)) ||
        (l.ip_address && l.ip_address.toLowerCase().includes(term)) ||
        (l.category && l.category.toLowerCase().includes(term))
      );
    }

    return result;
  }, [logs, categoryFilter, searchTerm]);

  // Filtragem de Usuários
  const filteredUsers = useMemo(() => {
    let list = allProfilesList;

    if (roleFilter !== 'all') {
      list = list.filter(u => u.role === roleFilter);
    }

    if (userSearch.trim()) {
      const term = userSearch.trim().toLowerCase();
      list = list.filter(u =>
        u.nome.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term)
      );
    }

    return list.sort((a, b) => {
      // Admins primeiro, depois ordenação alfabética
      if (a.role === 'admin' && b.role !== 'admin') return -1;
      if (b.role === 'admin' && a.role !== 'admin') return 1;
      return a.nome.localeCompare(b.nome);
    });
  }, [allProfilesList, roleFilter, userSearch]);

  // Opções do SegmentedControl Principal
  const tabOptions: Array<SegmentedOption<AdminMainTab>> = [
    {
      value: 'audit',
      label: 'Trilha de Auditoria (Audit Trail)',
      count: filteredLogs.length,
      icon: <Activity size={16} />
    },
    {
      value: 'users',
      label: 'Gestão Global de Administradores & Acessos',
      count: allProfilesList.length,
      icon: <Users size={16} />
    }
  ];

  // Opções de Filtro de Categoria
  const categoryOptions: Array<SegmentedOption<CategoryFilter>> = [
    { value: 'all', label: 'Todas' },
    { value: 'usuarios', label: 'Usuários' },
    { value: 'seguranca', label: 'Segurança', badgeTone: securityAlertsCount7d > 0 ? 'bad' : 'default' },
    { value: 'configuracoes', label: 'Configurações' },
    { value: 'cadastros', label: 'Cadastros' },
    { value: 'operacional', label: 'Operacional' }
  ];

  // Exportar Logs em JSON
  const handleExportLogs = () => {
    const exportPayload = {
      sistema: 'HH Offshore Infotec Brasil',
      modulo: 'Trilha de Auditoria de Governança',
      exportado_em: new Date().toISOString(),
      exportado_por: {
        id: userProfile?.id,
        nome: userProfile?.nome,
        email: userProfile?.email
      },
      total_registros: filteredLogs.length,
      filtros_aplicados: {
        categoria: categoryFilter,
        busca: searchTerm || null
      },
      logs: filteredLogs
    };

    const jsonStr = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `Audit_Trail_Infotec_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Trilha de auditoria exportada com sucesso!', 'success');
  };

  // Copiar JSON do Log Selecionado
  const handleCopyJson = (obj: any) => {
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 2000);
    showToast('JSON copiado para a área de transferência.', 'info');
  };

  // Renderizador de Badge de Categoria
  const renderCategoryBadge = (cat: string) => {
    switch (cat) {
      case 'seguranca':
        return <span className="pill pill-bad">Segurança</span>;
      case 'usuarios':
        return <span className="pill pill-info">Usuários</span>;
      case 'configuracoes':
        return <span className="pill pill-warn">Configuração</span>;
      case 'cadastros':
        return <span className="pill pill-ok">Cadastros</span>;
      case 'operacional':
        return <span className="pill pill-none" style={{ background: 'var(--surface-alt)' }}>Operacional</span>;
      default:
        return <span className="pill pill-none">{cat}</span>;
    }
  };

  // Verificação de Restrição
  if (!isGlobal && !isAdmin) {
    return (
      <div className="card note note-bad" style={{ margin: '24px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldAlert size={20} />
          <strong>Acesso Restrito:</strong>
        </div>
        <p style={{ margin: '8px 0 0' }}>
          Esta área é de acesso restrito a Administradores do Sistema.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header Institucional de Governança */}
      <div className="card" style={{ padding: '20px 24px', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: 'rgba(30, 58, 138, 0.1)',
                  color: 'var(--brand-primary, #1e3a8a)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ShieldCheck size={22} />
              </div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--ink)' }}>
                Painel de Governança, Contas & Auditoria
              </h1>
            </div>
            <p className="sub" style={{ margin: '6px 0 0', maxWidth: '700px' }}>
              Rastreamento de integridade e imutabilidade WORM (Write Once, Read Many), conformidade LGPD, controle de credenciais e salvaguardas anti-lockout.
            </p>
          </div>

          {/* Badges de Certificação de Segurança */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pill pill-ok" title="Registros gravados uma única vez e imutáveis">
              <Lock size={12} style={{ marginRight: '4px' }} /> WORM Imutável
            </span>
            <span className="pill pill-info" title="Auditoria centralizada com context hooks automáticos">
              <Activity size={12} style={{ marginRight: '4px' }} /> Audit Trail Ativo
            </span>
            <span className="pill pill-ok" title="Proteção contra auto-exclusão e perda de último administrador">
              <Shield size={12} style={{ marginRight: '4px' }} /> Anti-Lockout
            </span>
            <span className="pill pill-ok" title="Row Level Security blindado no Supabase">
              RLS Blindado
            </span>
          </div>
        </div>
      </div>

      {/* Cards de Métricas e KPIs de Governança */}
      <div className="kpis">
        <KpiCard
          value={logs.length}
          label="Total de Eventos Rastreados"
          tone="blue"
          sub="Trilha completa de governança"
        />
        <KpiCard
          value={securityAlertsCount7d}
          label="Alertas de Segurança (7d)"
          tone={securityAlertsCount7d > 0 ? 'warn' : 'ok'}
          sub={securityAlertsCount7d > 0 ? 'Eventos sensíveis registrados' : 'Nenhuma ameaça ou violação'}
        />
        <KpiCard
          value={activeAdminsCount}
          label="Administradores Ativos"
          tone="ok"
          sub={activeAdminsCount <= 1 ? 'Atenção: salvaguarda anti-lockout' : 'Gestores com acesso irrestrito'}
        />
        <KpiCard
          value={allProfilesList.length}
          label="Total de Contas de Acesso"
          tone="blue"
          sub={`${allProfilesList.filter(p => p.ativo).length} ativas no sistema`}
        />
      </div>

      {/* Navegação por Sub-Abas do Painel */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <SegmentedControl<AdminMainTab>
          options={tabOptions}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="Alternar entre Trilha de Auditoria e Gestão de Usuários"
          size="md"
        />

        {activeTab === 'users' && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setNewAdminModalOpen(true)}
          >
            <UserPlus size={16} /> Novo Administrador
          </button>
        )}
      </div>

      {/* ========================================================================= */}
      {/* ABA 1: TRILHA DE AUDITORIA (AUDIT TRAIL) */}
      {/* ========================================================================= */}
      {activeTab === 'audit' && (
        <div className="card stack" style={{ gap: '16px' }}>
          {/* Barra de Filtros e Ferramentas */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <SegmentedControl<CategoryFilter>
                options={categoryOptions}
                value={categoryFilter}
                onChange={setCategoryFilter}
                size="sm"
                ariaLabel="Filtrar por categoria"
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Buscar ação, ator, alvo ou IP..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ padding: '6px 12px 6px 32px', minWidth: '260px' }}
                />
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
              </div>

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={loadLogs}
                disabled={logsLoading}
                title="Atualizar trilha de auditoria"
              >
                <RefreshCw size={15} className={logsLoading ? 'spin' : ''} />
                <span>Atualizar</span>
              </button>

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleExportLogs}
                disabled={filteredLogs.length === 0}
                title="Exportar trilha em formato JSON auditável"
              >
                <Download size={15} />
                <span>Exportar JSON</span>
              </button>
            </div>
          </div>

          {/* Tabela de Registros de Auditoria */}
          <div className="tb" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '160px', minWidth: '150px' }}>Data / Hora (UTC-3)</th>
                  <th style={{ width: '130px', minWidth: '120px' }}>Categoria</th>
                  <th style={{ width: '180px', minWidth: '160px' }}>Ação Executada</th>
                  <th style={{ width: '220px', minWidth: '200px' }}>Ator Solicitante</th>
                  <th>Alvo / Objeto Afetado</th>
                  <th style={{ width: '130px', minWidth: '110px' }}>Endereço IP</th>
                  <th style={{ width: '90px', minWidth: '80px', textAlign: 'center' }}>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {logsLoading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-muted)' }}>
                      <RefreshCw size={20} className="spin" style={{ margin: '0 auto 8px' }} />
                      <div>Carregando registros imutáveis da trilha de auditoria...</div>
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-muted)' }}>
                      Nenhum registro de auditoria encontrado com os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map(log => {
                    const dateFormatted = new Date(log.created_at).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    });

                    return (
                      <tr key={log.id}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem', fontFamily: 'monospace' }}>
                          {dateFormatted}
                        </td>
                        <td>{renderCategoryBadge(log.category)}</td>
                        <td style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                          {log.action}
                        </td>
                        <td>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                              {log.actor_nome || 'Sistema / Trigger'}
                            </div>
                            <div className="sub" style={{ fontSize: '0.78rem' }}>
                              {log.actor_email || '—'}
                              {log.actor_role && (
                                <span style={{ marginLeft: '4px', opacity: 0.8 }}>
                                  ({ROLES_LABEL[log.actor_role as SystemRole] || log.actor_role})
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          {log.target_label ? (
                            <div>
                              <span style={{ fontWeight: 600 }}>{log.target_label}</span>
                              {log.target_id && (
                                <span className="sub" style={{ display: 'block', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                                  ID: {log.target_id}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="sub">—</span>
                          )}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                          {log.ip_address || '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon btn-ghost"
                            onClick={() => setSelectedLog(log)}
                            title="Inspecionar payload e metadados completos do log"
                            aria-label="Ver detalhes do log"
                          >
                            <Eye size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 2: GESTÃO GLOBAL DE ADMINISTRADORES & ACESSOS */}
      {/* ========================================================================= */}
      {activeTab === 'users' && (
        <div className="card stack" style={{ gap: '16px' }}>
          {/* Controles de Busca e Filtro de Usuários */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Buscar usuário por nome ou e-mail..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  style={{ padding: '6px 12px 6px 32px', minWidth: '280px' }}
                />
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
              </div>

              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                style={{ padding: '6px 12px' }}
              >
                <option value="all">Todos os papéis</option>
                <option value="admin">Administradores</option>
                <option value="gestor">Gestores</option>
                <option value="controlador">Controladores</option>
                <option value="preposto">Prepostos</option>
              </select>
            </div>

            <div className="sub" style={{ fontSize: '0.85rem' }}>
              Exibindo <b>{filteredUsers.length}</b> conta{filteredUsers.length === 1 ? '' : 's'}
            </div>
          </div>

          {/* Tabela de Contas e Credenciais */}
          <div className="tb" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '140px', minWidth: '130px' }}>Papel</th>
                  <th style={{ width: '220px', minWidth: '200px' }}>Nome Completo</th>
                  <th style={{ width: '240px', minWidth: '220px' }}>E-mail de Acesso</th>
                  <th style={{ width: '140px', minWidth: '130px' }}>Status</th>
                  <th>Segurança & Credenciais</th>
                  <th style={{ width: '180px', minWidth: '160px', textAlign: 'right' }}>Ações Administrativas</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-muted)' }}>
                      Nenhum usuário encontrado com os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(u => {
                    const isSelf = userProfile?.id === u.id;
                    const onb = dataset.onboardingMap?.[u.id];

                    return (
                      <tr key={u.id}>
                        <td>
                          <span
                            className={`pill ${
                              u.role === 'admin'
                                ? 'pill-ok'
                                : u.role === 'gestor'
                                ? 'pill-info'
                                : u.role === 'controlador'
                                ? 'pill-warn'
                                : 'pill-none'
                            }`}
                          >
                            {ROLES_LABEL[u.role] || u.role}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <b>{u.nome}</b>
                            {isSelf && (
                              <span
                                className="pill pill-info"
                                style={{ fontSize: '0.7rem', padding: '1px 6px' }}
                              >
                                você
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {u.email}
                        </td>
                        <td>
                          <span className={`pill ${u.ativo ? 'pill-ok' : 'pill-bad'}`}>
                            {u.ativo ? 'Acesso Ativo' : 'Acesso Desativado'}
                          </span>
                        </td>
                        <td>
                          {onb && (onb.primeiro_login || onb.obriga_troca_senha) ? (
                            <span
                              className="badge badge-warn pill pill-warn"
                              title="Usuário deverá definir nova senha pessoal no próximo login"
                              style={{ fontSize: '0.72rem' }}
                            >
                              <Lock size={11} style={{ marginRight: '3px' }} /> Troca de Senha Obrigatória
                            </span>
                          ) : (
                            <span
                              className="badge badge-ok pill pill-ok"
                              title="Credencial ativa e validada pessoalmente pelo usuário"
                              style={{ fontSize: '0.72rem' }}
                            >
                              <CheckCircle2 size={11} style={{ marginRight: '3px' }} /> Senha Pessoal Ativa
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                            {/* Botão Redefinir Senha */}
                            <button
                              type="button"
                              className="btn btn-sm btn-icon btn-ghost"
                              title={`Redefinir senha provisória de ${u.nome}`}
                              aria-label="Redefinir senha"
                              style={{ color: 'var(--blue)' }}
                              onClick={() => setResetPwUser(u)}
                            >
                              <KeyRound size={16} />
                            </button>

                            {/* Botão Ativar / Desativar */}
                            <button
                              type="button"
                              className="btn btn-sm btn-icon btn-ghost"
                              title={
                                isSelf
                                  ? 'Você não pode desativar seu próprio acesso (Anti-Lockout)'
                                  : u.ativo
                                  ? `Desativar acesso de ${u.nome}`
                                  : `Reativar acesso de ${u.nome}`
                              }
                              aria-label={u.ativo ? 'Desativar acesso' : 'Ativar acesso'}
                              style={{
                                color: isSelf
                                  ? 'var(--ink-muted)'
                                  : u.ativo
                                  ? 'var(--bad)'
                                  : 'var(--ok)',
                                opacity: isSelf ? 0.4 : 1,
                                cursor: isSelf ? 'not-allowed' : 'pointer'
                              }}
                              disabled={isSelf}
                              onClick={() => {
                                if (!isSelf) setToggleActiveUser(u);
                              }}
                            >
                              {u.ativo ? <UserX size={16} /> : <UserCheck size={16} />}
                            </button>

                            {/* Botão Excluir Conta */}
                            <button
                              type="button"
                              className="btn btn-sm btn-icon btn-ghost"
                              title={
                                isSelf
                                  ? 'Auto-exclusão bloqueada (Anti-Lockout)'
                                  : `Excluir conta definitivamente (${u.email})`
                              }
                              aria-label="Excluir conta"
                              style={{
                                color: isSelf ? 'var(--ink-muted)' : 'var(--bad)',
                                opacity: isSelf ? 0.4 : 1,
                                cursor: isSelf ? 'not-allowed' : 'pointer'
                              }}
                              disabled={isSelf}
                              onClick={() => {
                                if (!isSelf) setDeleteTargetUser(u);
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: DETALHES COMPLETOS DO LOG DE AUDITORIA */}
      {/* ========================================================================= */}
      {selectedLog && (
        <Modal
          open={!!selectedLog}
          onClose={() => setSelectedLog(null)}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileJson size={18} />
              <span>Registro de Auditoria · {selectedLog.action}</span>
            </div>
          }
          maxWidth="680px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleCopyJson(selectedLog)}
              >
                {jsonCopied ? <Check size={15} color="var(--ok)" /> : <Copy size={15} />}
                <span>{jsonCopied ? 'Copiado!' : 'Copiar JSON'}</span>
              </button>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setSelectedLog(null)}
              >
                Fechar
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Metadados Básicos */}
            <div className="card note note-info" style={{ margin: 0, padding: '12px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                <div>
                  <span className="sub" style={{ fontSize: '0.75rem' }}>Identificador (UUID):</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>{selectedLog.id}</div>
                </div>
                <div>
                  <span className="sub" style={{ fontSize: '0.75rem' }}>Data / Hora UTC:</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{selectedLog.created_at}</div>
                </div>
                <div>
                  <span className="sub" style={{ fontSize: '0.75rem' }}>Ator Solicitante:</span>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                    {selectedLog.actor_nome || 'Sistema'} {selectedLog.actor_email ? `(${selectedLog.actor_email})` : ''}
                  </div>
                </div>
                <div>
                  <span className="sub" style={{ fontSize: '0.75rem' }}>Endereço IP:</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{selectedLog.ip_address || 'Não registrado'}</div>
                </div>
              </div>
            </div>

            {/* Alvo / Objeto Afetado */}
            {(selectedLog.target_label || selectedLog.target_id) && (
              <div style={{ fontSize: '0.85rem' }}>
                <strong>Alvo da Ação:</strong> {selectedLog.target_label || '—'}
                {selectedLog.target_id && (
                  <span className="sub" style={{ marginLeft: '6px', fontFamily: 'monospace' }}>
                    [ID: {selectedLog.target_id}]
                  </span>
                )}
              </div>
            )}

            {/* Payload JSON de Detalhes */}
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: '4px' }}>
                Payload Detalhado de Metadados & Auditoria (details JSON):
              </div>
              <pre
                style={{
                  background: 'var(--surface-alt)',
                  padding: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--line)',
                  fontSize: '0.78rem',
                  fontFamily: 'monospace',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  margin: 0
                }}
              >
                {JSON.stringify(selectedLog.details, null, 2)}
              </pre>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: REDEFINIR SENHA PROVISÓRIA */}
      {/* ========================================================================= */}
      {resetPwUser && (
        <ResetPasswordModal
          user={resetPwUser}
          onClose={() => setResetPwUser(null)}
          onSuccess={async () => {
            setResetPwUser(null);
            await refreshData();
            await loadLogs();
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: ATIVAR / DESATIVAR ACESSO */}
      {/* ========================================================================= */}
      {toggleActiveUser && (
        <ToggleActiveModal
          user={toggleActiveUser}
          activeAdminsCount={activeAdminsCount}
          onClose={() => setToggleActiveUser(null)}
          onSuccess={async () => {
            setToggleActiveUser(null);
            await refreshData();
            await loadLogs();
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: EXCLUIR CONTA DE USUÁRIO (ANTI-LOCKOUT) */}
      {/* ========================================================================= */}
      {deleteTargetUser && (
        <DeleteUserModal
          user={deleteTargetUser}
          activeAdminsCount={activeAdminsCount}
          onClose={() => setDeleteTargetUser(null)}
          onSuccess={async () => {
            setDeleteTargetUser(null);
            await refreshData();
            await loadLogs();
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: NOVO ADMINISTRADOR */}
      {/* ========================================================================= */}
      {newAdminModalOpen && (
        <NovoAdminModal
          open={newAdminModalOpen}
          onClose={() => setNewAdminModalOpen(false)}
          onCreated={async () => {
            setNewAdminModalOpen(false);
            await refreshData();
            await loadLogs();
          }}
        />
      )}
    </div>
  );
};

// ==============================================================================
// SUB-MODAL: REDEFINIR SENHA PROVISÓRIA
// ==============================================================================
interface ResetPasswordModalProps {
  user: UserProfile;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  user,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleResetPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (password.length < 8) {
      setErrorMsg('A senha provisória deve conter no mínimo 8 caracteres.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await adminManageUser({
        action: 'reset-password',
        userId: user.id,
        newPassword: password,
        forceChange: true
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao redefinir senha do usuário.');
      }

      await logSystemEvent({
        action: 'reset-password',
        category: 'seguranca',
        target_id: user.id,
        target_label: `${user.nome} (${user.email})`,
        details: { forceChange: true }
      });

      showToast(`Senha provisória de ${user.nome} redefinida com sucesso!`, 'success');
      await onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao redefinir senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <KeyRound size={18} />
          <span>Redefinir Senha Provisória · {user.nome}</span>
        </div>
      }
      maxWidth="480px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleResetPassword()}
            disabled={loading || password.length < 8}
          >
            {loading ? 'Redefinindo…' : 'Confirmar Nova Senha'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="note note-warn" style={{ margin: 0, fontSize: '0.84rem' }}>
          Esta é uma credencial provisória. O sistema obrigará o usuário a definir uma nova senha pessoal no próximo login.
        </div>

        <div>
          <span className="sub" style={{ fontSize: '0.8rem' }}>Conta do usuário:</span>
          <div style={{ fontWeight: 600 }}>{user.nome} &lt;{user.email}&gt;</div>
        </div>

        <label className="fld">
          <span>Nova senha provisória (mínimo 8 caracteres)</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Digite a nova senha temporária"
            autoFocus
            required
            disabled={loading}
          />
        </label>

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </form>
    </Modal>
  );
};

// ==============================================================================
// SUB-MODAL: ATIVAR / DESATIVAR ACESSO (ANTI-LOCKOUT)
// ==============================================================================
interface ToggleActiveModalProps {
  user: UserProfile;
  activeAdminsCount: number;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

const ToggleActiveModal: React.FC<ToggleActiveModalProps> = ({
  user,
  activeAdminsCount,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const willDeactivate = user.ativo;
  const isLastActiveAdmin = user.role === 'admin' && willDeactivate && activeAdminsCount <= 1;

  const handleToggle = async () => {
    if (isLastActiveAdmin) {
      setErrorMsg('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await adminManageUser({
        action: 'toggle-active',
        userId: user.id,
        ativo: !user.ativo
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao alterar status de acesso do usuário.');
      }

      await logSystemEvent({
        action: willDeactivate ? 'deactivate-user' : 'activate-user',
        category: 'usuarios',
        target_id: user.id,
        target_label: `${user.nome} (${user.email})`,
        details: { novo_status: !user.ativo }
      });

      showToast(`Acesso de ${user.nome} ${willDeactivate ? 'desativado' : 'ativado'} com sucesso!`, 'success');
      await onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao processar alteração.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {willDeactivate ? <UserX size={18} color="var(--bad)" /> : <UserCheck size={18} color="var(--ok)" />}
          <span>{willDeactivate ? 'Desativar Acesso' : 'Reativar Acesso'} · {user.nome}</span>
        </div>
      }
      maxWidth="480px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="button"
            className={`btn ${willDeactivate ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleToggle}
            disabled={loading || isLastActiveAdmin}
          >
            {loading ? 'Processando…' : willDeactivate ? 'Confirmar Desativação' : 'Confirmar Reativação'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {isLastActiveAdmin ? (
          <div className="note note-bad" style={{ margin: 0 }}>
            <strong>Salvaguarda Anti-Lockout Ativa:</strong>
            <p style={{ margin: '4px 0 0' }}>
              Este é o único Administrador ativo no sistema. Desativá-lo bloquearia permanentemente o painel de governança. Cadastre outro administrador antes de desativar esta conta.
            </p>
          </div>
        ) : willDeactivate ? (
          <div className="note note-warn" style={{ margin: 0 }}>
            <strong>Atenção:</strong> Ao desativar o acesso de <b>{user.nome}</b>, o token de sessão será imediatamente revogado no banco de dados e a conta será bloqueada para login.
          </div>
        ) : (
          <div className="note note-info" style={{ margin: 0 }}>
            Ao reativar o acesso, <b>{user.nome}</b> poderá efetuar login normalmente com suas credenciais vigentes.
          </div>
        )}

        <div>
          <span className="sub" style={{ fontSize: '0.8rem' }}>Usuário:</span>
          <div style={{ fontWeight: 600 }}>{user.nome}</div>
          <div className="sub">{user.email} · Papel: {ROLES_LABEL[user.role] || user.role}</div>
        </div>

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </div>
    </Modal>
  );
};

// ==============================================================================
// SUB-MODAL: EXCLUIR CONTA DE USUÁRIO (SALVAGUARDA ANTI-LOCKOUT)
// ==============================================================================
interface DeleteUserModalProps {
  user: UserProfile;
  activeAdminsCount: number;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

const DeleteUserModal: React.FC<DeleteUserModalProps> = ({
  user,
  activeAdminsCount,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  const [confirmInput, setConfirmInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isLastActiveAdmin = user.role === 'admin' && activeAdminsCount <= 1;
  const isMatch = confirmInput.trim().toLowerCase() === user.email.toLowerCase() ||
                  confirmInput.trim().toLowerCase() === user.nome.toLowerCase();

  const handleDelete = async () => {
    if (isLastActiveAdmin) {
      setErrorMsg('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
      return;
    }

    if (!isMatch) {
      setErrorMsg('A confirmação digitada não confere com o e-mail ou nome do usuário.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await deleteUserAccount(user.id);
      if (!res.ok) {
        throw new Error(res.message || 'Falha ao excluir conta de usuário.');
      }

      await logSystemEvent({
        action: 'delete-user',
        category: 'usuarios',
        target_id: user.id,
        target_label: `${user.nome} (${user.email})`,
        details: { role: user.role }
      });

      showToast(`Conta de ${user.nome} excluída definitivamente.`, 'success');
      await onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao excluir conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--bad)' }}>
          <AlertTriangle size={20} />
          <span>Exclusão Definitiva de Conta</span>
        </div>
      }
      maxWidth="500px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleDelete}
            disabled={loading || isLastActiveAdmin || !isMatch}
          >
            {loading ? 'Excluindo…' : 'Excluir Definitivamente'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {isLastActiveAdmin ? (
          <div className="note note-bad" style={{ margin: 0 }}>
            <strong>Salvaguarda Anti-Lockout Ativa:</strong>
            <p style={{ margin: '4px 0 0' }}>
              Este é o único Administrador ativo no sistema. A exclusão desta conta bloquearia irremediavelmente a governança do sistema. Crie outro administrador antes de prosseguir.
            </p>
          </div>
        ) : (
          <>
            <div className="note note-bad" style={{ margin: 0 }}>
              <strong>Atenção: Ação Irreversível!</strong>
              <p style={{ margin: '4px 0 0' }}>
                A exclusão removerá as credenciais de autenticação no Supabase GoTrue, o perfil de acesso e os registros de onboarding do usuário <b>{user.nome}</b>. Lançamentos operacionais e justificativas históricas serão preservados com desvinculação segura.
              </p>
            </div>

            <label className="fld">
              <span>Para confirmar a exclusão, digite o e-mail ou nome exato do usuário:</span>
              <div style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--ink)' }}>
                {user.email}
              </div>
              <input
                type="text"
                value={confirmInput}
                onChange={e => setConfirmInput(e.target.value)}
                placeholder="Digite o e-mail para confirmar"
                autoFocus
                disabled={loading}
              />
            </label>
          </>
        )}

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </div>
    </Modal>
  );
};

// ==============================================================================
// SUB-MODAL: NOVO ADMINISTRADOR
// ==============================================================================
interface NovoAdminModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

const NovoAdminModal: React.FC<NovoAdminModalProps> = ({
  open,
  onClose,
  onCreated
}) => {
  const { showToast } = useToast();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!nome.trim() || !email.trim() || password.length < 8) {
      setErrorMsg('Preencha todos os campos obrigatórios. A senha deve ter no mínimo 8 caracteres.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await adminManageUser({
        action: 'create',
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        password,
        role: 'admin'
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao criar administrador.');
      }

      await logSystemEvent({
        action: 'create-admin',
        category: 'usuarios',
        target_id: res.userId || null,
        target_label: `${nome.trim()} (${email.trim().toLowerCase()})`,
        details: { role: 'admin' }
      });

      showToast('Novo administrador criado com sucesso!', 'success');
      await onCreated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao criar administrador.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={18} />
          <span>Novo Administrador do Sistema</span>
        </div>
      }
      maxWidth="480px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit()}
            disabled={loading || password.length < 8}
          >
            {loading ? 'Criando…' : 'Criar Administrador'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p className="sub" style={{ margin: 0 }}>
          Administradores possuem privilégios totais de governança no sistema: visão irrestrita, configurações, importação e gestão de credenciais.
        </p>

        <div className="note note-warn" style={{ fontSize: '0.84rem', margin: 0 }}>
          Esta é uma senha provisória. No primeiro acesso, o novo administrador será obrigado a definir uma senha pessoal forte.
        </div>

        <label className="fld">
          <span>Nome completo</span>
          <input
            type="text"
            value={nome}
            onChange={e => setNome(e.target.value)}
            placeholder="Nome do administrador"
            required
            disabled={loading}
          />
        </label>

        <label className="fld">
          <span>E-mail institucional</span>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="admin@infotecbrasil.com.br"
            required
            disabled={loading}
          />
        </label>

        <label className="fld">
          <span>Senha inicial provisória (mínimo 8 caracteres)</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Defina uma senha provisória"
            required
            disabled={loading}
          />
        </label>

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </form>
    </Modal>
  );
};
