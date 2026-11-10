import React, { useState, useMemo, useRef } from 'react';
import {
  UserPlus,
  ShieldCheck,
  SlidersHorizontal,
  KeyRound,
  LayoutDashboard,
  Trash2,
  Edit3,
  Plus,
  AlertTriangle,
  UserCheck,
  UserX,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Check,
  Building2,
  Ship,
  MapPin,
  Anchor,
  User,
  Briefcase,
  HardHat,
  ClipboardCheck,
  Layers
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { adminManageUser } from '../../services/auth.service';
import {
  savePessoa,
  deletePessoa,
  savePlataforma,
  deletePlataforma,
  deleteUserAccount,
  batchImportPlataformas,
  batchImportPessoas,
  logSystemEvent
} from '../../services/data.service';
import {
  parseSpreadsheetFile,
  rebuildPreviewRows,
  IMPORT_COLUMNS_DEF,
  exportModeloXlsx,
  type ParsedPreviewState
} from '../../services/excel.service';
import { findResponsiblePeople } from '../../domain/calculations';
import { PAPEIS_LABEL, ROLES_LABEL, SITUACOES_PLATAFORMA } from '../../config/constants';
import type { ImportKind, PapelOperacional, Pessoa, Plataforma, SystemRole, UserOnboarding, UserProfile } from '../../domain/types';
import { normalizeText, platformKey } from '../../utils/format';
import { Modal } from '../components/Modal';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import {
  NovoAdminModal,
  AdminResetPasswordModal,
  AdminToggleActiveModal,
  AdminDeleteUserModal
} from '../modals/AdminAccountModals';

type SubTab = 'pessoas' | 'plataformas';
type PapelFilter = 'todos' | 'preposto' | 'controlador' | 'gestor';

export const PessoasPlataformasView: React.FC = () => {
  const { dataset, pidx, refreshData, isGlobal, isAdmin, userProfile, setFilter, setActiveTab } = useApp();
  const { showToast } = useToast();

  // Sub-aba interna ativa
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('pessoas');

  // Estados de busca e filtros
  const [pesBusca, setPesBusca] = useState('');
  const [papelFilter, setPapelFilter] = useState<PapelFilter>('todos');
  const [platUn, setPlatUn] = useState('');
  const [platBusca, setPlatBusca] = useState('');
  const [pendentesOnly, setPendentesOnly] = useState(false);

  // Confirmações de exclusão em 2 cliques
  const [delPesId, setDelPesId] = useState<string | null>(null);

  // Modais
  const [pesModalOpen, setPesModalOpen] = useState(false);
  const [editingPes, setEditingPes] = useState<Pessoa | null>(null);

  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminResetPwProfile, setAdminResetPwProfile] = useState<UserProfile | null>(null);
  const [adminToggleActiveProfile, setAdminToggleActiveProfile] = useState<UserProfile | null>(null);
  const [adminDeleteProfile, setAdminDeleteProfile] = useState<UserProfile | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [targetPesForLogin, setTargetPesForLogin] = useState<Pessoa | null>(null);

  const [platModalOpen, setPlatModalOpen] = useState(false);
  const [editingPlat, setEditingPlat] = useState<Plataforma | null>(null);

  // Estados de importação em massa
  const [cadPreview, setCadPreview] = useState<ParsedPreviewState | null>(null);
  const [cadParsing, setCadParsing] = useState(false);
  const [cadSaving, setCadSaving] = useState(false);
  const [cadProgress, setCadProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadKindRef = useRef<ImportKind>('plat');

  // Opções para SegmentedControl de Sub-Abas principais
  const countPessoas = Object.keys(dataset.pessoas).length;
  const countPlataformas = Object.keys(dataset.plataformas).length;

  const mainTabOptions = useMemo<SegmentedOption<SubTab>[]>(() => [
    { value: 'pessoas', label: 'Pessoas e Acessos', count: countPessoas },
    { value: 'plataformas', label: 'Catálogo de Plataformas', count: countPlataformas }
  ], [countPessoas, countPlataformas]);

  // Contagens e Opções para SegmentedControl de Papéis Operacionais
  const papelCounts = useMemo(() => {
    const list = Object.values(dataset.pessoas);
    return {
      todos: list.length,
      preposto: list.filter(p => p.papel === 'preposto').length,
      controlador: list.filter(p => p.papel === 'controlador').length,
      gestor: list.filter(p => p.papel === 'gestor').length
    };
  }, [dataset.pessoas]);

  const papelFilterOptions = useMemo<SegmentedOption<PapelFilter>[]>(() => [
    { value: 'todos', label: 'Todos', count: papelCounts.todos },
    { value: 'preposto', label: 'Prepostos', count: papelCounts.preposto },
    { value: 'controlador', label: 'Controladores', count: papelCounts.controlador },
    { value: 'gestor', label: 'Gestores', count: papelCounts.gestor }
  ], [papelCounts]);

  // --- SEÇÃO 1: Pessoas e Responsabilidades ---
  const filteredPessoas = useMemo(() => {
    let list = Object.values(dataset.pessoas).sort((a, b) =>
      (a.papel || '').localeCompare(b.papel || '') || a.nome.localeCompare(b.nome)
    );
    if (papelFilter !== 'todos') {
      list = list.filter(p => p.papel === papelFilter);
    }
    const q = normalizeText(pesBusca);
    if (!q) return list;
    return list.filter(p => {
      const text = `${p.nome} ${p.email || ''} ${(p.plats || []).join(' ')} ${(p.uns || []).join(' ')}`;
      return normalizeText(text).includes(q);
    });
  }, [dataset.pessoas, papelFilter, pesBusca]);

  const adminProfiles = useMemo(() => {
    return Object.values(dataset.profiles || {}).filter(p => p.role === 'admin');
  }, [dataset.profiles]);

  const activeAdminsCount = useMemo(() => {
    return adminProfiles.filter(p => p.ativo).length;
  }, [adminProfiles]);

  const semEmailCount = useMemo(() => {
    return Object.values(dataset.pessoas).filter(p => !p.email).length;
  }, [dataset.pessoas]);

  const semPlatOuUnCount = useMemo(() => {
    return Object.values(dataset.pessoas).filter(
      p => (!p.plats || p.plats.length === 0) && (!p.uns || p.uns.length === 0)
    ).length;
  }, [dataset.pessoas]);

  // Lista única de UNs
  const allUns = useMemo(() => {
    const s = new Set<string>();
    Object.values(dataset.plataformas).forEach(p => {
      if (p.un && p.un.trim()) s.add(p.un.trim());
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [dataset.plataformas]);

  // Armadores únicos para datalist
  const allArmadores = useMemo(() => {
    const s = new Set<string>();
    Object.values(dataset.plataformas).forEach(p => {
      if (p.armador && p.armador.trim()) s.add(p.armador.trim());
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [dataset.plataformas]);

  // --- SEÇÃO 2: Plataformas e UNs ---
  const filteredPlataformas = useMemo(() => {
    const list = Object.values(dataset.plataformas).sort((a, b) =>
      (a.un || '').localeCompare(b.un || '') || a.sigla.localeCompare(b.sigla, undefined, { numeric: true })
    );

    const q = normalizeText(platBusca);

    return list.filter(p => {
      if (platUn && (p.un || 'Sem unidade') !== platUn) return false;
      if (pendentesOnly && !p.cadastro_pendente) return false;
      if (!q) return true;
      const t = `${p.sigla} ${p.nome} ${p.armador || ''} ${p.tipo || ''}`;
      return normalizeText(t).includes(q);
    });
  }, [dataset.plataformas, platUn, pendentesOnly, platBusca]);

  // Definição das colunas para DataTable de Plataformas
  const platColumns: DataTableColumn<Plataforma>[] = [
    {
      key: 'sigla',
      header: 'Sigla',
      width: '110px',
      render: p => (
        <div>
          <b>{p.sigla}</b>
          {p.cadastro_pendente && (
            <span
              className="pill pill-warn"
              style={{ display: 'inline-block', marginLeft: '6px', fontSize: '0.7rem', padding: '1px 5px' }}
              title="Sigla criada automaticamente em upload; revise os dados cadastrais"
            >
              Pendente
            </span>
          )}
        </div>
      )
    },
    {
      key: 'nome',
      header: 'Nome / Situação',
      render: p => (
        <div>
          <div>{p.nome || p.sigla}</div>
          {p.situacao && p.situacao !== 'Mobilizada' && (
            <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
              {p.situacao}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'un',
      header: 'Unidade de negócio',
      render: p => <span>{p.un || '—'}</span>
    },
    {
      key: 'armador',
      header: 'Armador / Gerência',
      render: p => (
        <div>
          <div>{p.armador || '—'}</div>
          {p.gerencia && (
            <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
              {p.gerencia}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'tipo',
      header: 'Tipo',
      width: '130px',
      render: p => <span className="sub">{p.tipo || '—'}</span>
    },
    {
      key: 'prepostos',
      header: 'Prepostos',
      render: p => {
        const resp = findResponsiblePeople(dataset.pessoas, [p.sigla], [p.un]);
        const preps = resp.filter(x => x.papel !== 'controlador');
        return preps.length ? (
          <span style={{ fontSize: '0.85rem' }}>{preps.map(x => x.nome).join(', ')}</span>
        ) : (
          <span className="sub">—</span>
        );
      }
    },
    {
      key: 'controladores',
      header: 'Controladores',
      render: p => {
        const resp = findResponsiblePeople(dataset.pessoas, [p.sigla], [p.un]);
        const contr = resp.filter(x => x.papel === 'controlador');
        return contr.length ? (
          <span style={{ fontSize: '0.85rem' }}>{contr.map(x => x.nome).join(', ')}</span>
        ) : (
          <span className="sub">—</span>
        );
      }
    },
    {
      key: 'actions',
      header: '',
      width: '90px',
      render: p => (
        <button
          type="button"
          className="btn btn-sm btn-icon btn-ghost"
          title="Editar plataforma"
          aria-label="Editar plataforma"
          onClick={() => {
            setEditingPlat(p);
            setPlatModalOpen(true);
          }}
        >
          <Edit3 size={15} />
        </button>
      )
    }
  ];

  // Ações de Pessoas
  const handleDeletePes = async (id: string) => {
    if (delPesId !== id) {
      setDelPesId(id);
      return;
    }
    const targetPessoa = dataset.pessoas?.[id];
    const hadLogin = Boolean(
      targetPessoa?.user_id ||
      (targetPessoa?.email &&
        dataset.profiles &&
        Object.values(dataset.profiles).some(
          p => p.email.toLowerCase() === targetPessoa.email.toLowerCase()
        ))
    );

    setDelPesId(null);
    try {
      await deletePessoa(id);
      await refreshData();
      showToast(
        hadLogin
          ? 'Pessoa e credenciais de acesso excluídas com sucesso.'
          : 'Pessoa excluída com sucesso.',
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || 'Erro ao excluir pessoa.', 'error');
    }
  };

  const handleVerPainel = (pessoaId: string) => {
    setFilter('fResp', pessoaId);
    setActiveTab('ger');
  };

  // Upload em massa de Cadastros
  const handleTriggerFile = (kind: ImportKind) => {
    uploadKindRef.current = kind;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleCadFileSelected = async (file: File) => {
    setCadParsing(true);
    setCadPreview(null);
    try {
      const parsed = await parseSpreadsheetFile(file, uploadKindRef.current);
      const built = rebuildPreviewRows(parsed, pidx);
      setCadPreview(built);
      showToast(`Planilha "${file.name}" processada para revisão.`, 'info');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao ler planilha.', 'error');
    } finally {
      setCadParsing(false);
    }
  };

  const handleSaveCadPreview = async () => {
    if (!cadPreview || cadPreview.rows.length === 0) return;
    setCadSaving(true);
    setCadProgress(`Gravando ${cadPreview.rows.length} registros…`);
    try {
      const onProgress = (cur: number, tot: number) => {
        setCadProgress(`Gravando ${cur} de ${tot}…`);
      };

      if (cadPreview.kind === 'plat') {
        await batchImportPlataformas(cadPreview.rows, onProgress);
        showToast('Plataformas importadas com sucesso!', 'success');
      } else {
        await batchImportPessoas(cadPreview.rows, onProgress);
        showToast('Pessoas e responsabilidades salvas com sucesso!', 'success');
      }
      await refreshData();
      setCadPreview(null);
    } catch (err: any) {
      showToast(err?.message || 'Erro ao salvar registros.', 'error');
    } finally {
      setCadSaving(false);
      setCadProgress('');
    }
  };

  if (!isGlobal) {
    return (
      <div className="card note note-bad" style={{ margin: '20px 0' }}>
        <strong>Acesso Restrito:</strong> Esta área é exclusiva para Administradores e Gestores do contrato.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={e => {
          if (e.target.files && e.target.files[0]) {
            handleCadFileSelected(e.target.files[0]);
          }
        }}
      />

      {/* Sub-Abas Internas: Pessoas e Acessos vs Catálogo de Plataformas */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <SegmentedControl<SubTab>
          options={mainTabOptions}
          value={activeSubTab}
          onChange={setActiveSubTab}
          ariaLabel="Alternar entre Pessoas e Plataformas"
        />
      </div>

      {/* ========================================================================= */}
      {/* SEÇÃO 1: PESSOAS, RESPONSABILIDADES E CONTAS DE ACESSO */}
      {/* ========================================================================= */}
      {activeSubTab === 'pessoas' && (
        <div className="card stack" style={{ gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Pessoas, responsabilidades e contas de acesso</h2>
              <p className="sub" style={{ margin: '4px 0 0' }}>
                Gestão de Prepostos, Controladores e Gestores, suas carteiras de plataformas e vínculos de login.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Buscar pessoa, e-mail ou plataforma"
                value={pesBusca}
                onChange={e => setPesBusca(e.target.value)}
                style={{ minWidth: 'min(100%, 220px)', flex: '1 1 200px', padding: '6px 12px' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setEditingPes(null);
                  setPesModalOpen(true);
                }}
              >
                <UserPlus size={16} /> Nova pessoa
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => setAdminModalOpen(true)}
                >
                  <ShieldCheck size={16} /> Novo administrador
                </button>
              )}
            </div>
          </div>

          {/* Filtro por Papel Operacional */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', fontWeight: 600 }}>Papel:</span>
            <SegmentedControl<PapelFilter>
              options={papelFilterOptions}
              value={papelFilter}
              onChange={setPapelFilter}
              size="sm"
              ariaLabel="Filtrar pessoas por papel operacional"
            />
          </div>

          {/* Alerta de inconsistências cadastrais */}
          {(semEmailCount > 0 || semPlatOuUnCount > 0) && (
            <div className="note note-warn" style={{ margin: 0 }}>
              {semEmailCount > 0 && (
                <span>
                  <b>{semEmailCount}</b> pessoa{semEmailCount > 1 ? 's' : ''} sem e-mail.{' '}
                </span>
              )}
              {semPlatOuUnCount > 0 && (
                <span>
                  <b>{semPlatOuUnCount}</b> sem plataforma ou unidade associada.{' '}
                </span>
              )}
              Sem esses dados, o e-mail de alerta não sabe para quem ir.
            </div>
          )}

        {/* Tabela de Pessoas */}
        <div className="tb" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ width: '130px', minWidth: '130px' }}>Papel</th>
                <th style={{ width: '220px', minWidth: '200px' }}>Nome</th>
                <th style={{ width: '220px', minWidth: '200px' }}>E-mail</th>
                <th style={{ width: '160px', minWidth: '150px' }}>Conta de login</th>
                <th>Carteira de responsabilidade</th>
                <th style={{ width: '160px', minWidth: '150px', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredPessoas.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '20px' }}>
                    Nenhuma pessoa encontrada com este filtro.
                  </td>
                </tr>
              ) : (
                filteredPessoas.map(p => {
                  const prof = p.user_id ? dataset.profiles?.[p.user_id] : null;
                  const onb = p.user_id ? dataset.onboardingMap?.[p.user_id] : null;
                  const pl = p.plats || [];
                  const uns = p.uns || [];

                  return (
                    <tr key={p.id}>
                      <td>
                        <span
                          className={`pill ${
                            p.papel === 'controlador' ? 'pill-warn' : p.papel === 'gestor' ? 'pill-ok' : 'pill-info'
                          }`}
                        >
                          {PAPEIS_LABEL[p.papel] || 'Preposto'}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <b>{p.nome}</b>
                      </td>
                      <td>
                        {p.email ? (
                          <span>{p.email}</span>
                        ) : (
                          <span style={{ color: 'var(--bad)', fontSize: '0.85rem' }}>sem e-mail</span>
                        )}
                      </td>
                      <td>
                        {prof ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <span className={`pill ${prof.ativo ? 'pill-ok' : 'pill-bad'}`}>
                              {prof.ativo ? 'Acesso ativo' : 'Acesso desativado'}
                            </span>
                            {onb && (onb.primeiro_login || onb.obriga_troca_senha) && (
                              <span
                                className="badge badge-warn pill pill-warn"
                                title="Usuário ainda não trocou a senha provisória"
                                style={{ fontSize: '0.68rem' }}
                              >
                                1º login / Troca pendente
                              </span>
                            )}
                            {onb && !onb.primeiro_login && !onb.obriga_troca_senha && (
                              <span
                                className="badge badge-ok pill pill-ok"
                                title="Senha pessoal ativa e validada"
                                style={{ fontSize: '0.68rem' }}
                              >
                                Senha pessoal ativa
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="pill pill-none" style={{ background: 'var(--surface-alt)', color: 'var(--ink-muted)' }}>
                            Sem login criado
                          </span>
                        )}
                      </td>
                      <td>
                        {pl.length > 0 && (
                          <div>
                            <b>{pl.length}</b> plataforma{pl.length > 1 ? 's' : ''}
                            <div className="sub" style={{ fontSize: '0.78rem' }}>
                              {pl.slice(0, 6).join(', ')}
                              {pl.length > 6 ? ` e mais ${pl.length - 6}…` : ''}
                            </div>
                          </div>
                        )}
                        {uns.length > 0 && (
                          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--blue)' }}>
                            Unidades: {uns.join(', ')}
                          </div>
                        )}
                        {pl.length === 0 && uns.length === 0 && (
                          <span className="sub">nada associado</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon btn-ghost"
                            title="Editar carteira de plataformas e unidades"
                            aria-label="Editar carteira de plataformas e unidades"
                            onClick={() => {
                              setEditingPes(p);
                              setPesModalOpen(true);
                            }}
                          >
                            <SlidersHorizontal size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon btn-ghost"
                            title={prof ? `Gerenciar credenciais e login (${prof.email})` : 'Criar credencial de acesso ao sistema'}
                            aria-label={prof ? 'Gerenciar credenciais e login' : 'Criar credencial de acesso'}
                            style={{ color: prof ? 'var(--blue)' : 'var(--ink-muted)' }}
                            onClick={() => {
                              setTargetPesForLogin(p);
                              setLoginModalOpen(true);
                            }}
                          >
                            <KeyRound size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon btn-ghost"
                            title="Filtrar visão geral por esta pessoa"
                            aria-label="Filtrar visão geral por esta pessoa"
                            onClick={() => handleVerPainel(p.id)}
                          >
                            <LayoutDashboard size={16} />
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${delPesId === p.id ? 'btn-danger' : 'btn-icon btn-ghost'}`}
                            title={
                              delPesId === p.id
                                ? (prof ? 'Confirmar exclusão da pessoa e de suas credenciais de login?' : 'Clique novamente para confirmar a exclusão')
                                : (prof ? 'Excluir pessoa e suas credenciais de login' : 'Excluir pessoa do cadastro')
                            }
                            aria-label={delPesId === p.id ? 'Confirmar exclusão' : 'Excluir pessoa'}
                            style={{
                              color: delPesId === p.id ? 'var(--white)' : 'var(--ink-muted)',
                              background: delPesId === p.id ? 'var(--bad)' : undefined
                            }}
                            onClick={() => handleDeletePes(p.id)}
                          >
                            {delPesId === p.id ? (
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0 4px' }}>Confirmar?</span>
                            ) : (
                              <Trash2 size={16} />
                            )}
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

        {/* Lista Compacta de Contas Administrativas */}
        {isAdmin && adminProfiles.length > 0 && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--line)' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '1rem', color: 'var(--ink)' }}>
              Contas Administrativas Globais ({adminProfiles.length})
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '10px' }}>
              {adminProfiles.map(admProf => {
                const isSelf = userProfile?.id === admProf.id;
                const admOnb = dataset.onboardingMap?.[admProf.id];
                return (
                  <div
                    key={admProf.id}
                    className="card"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '10px',
                      padding: '10px 14px',
                      background: 'var(--surface-alt)'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        {admProf.nome} {isSelf && <span className="sub">(você)</span>}
                      </div>
                      <div className="sub" style={{ fontSize: '0.8rem' }}>{admProf.email}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      <span className={`pill ${admProf.ativo ? 'pill-ok' : 'pill-bad'}`}>
                        {admProf.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      {admOnb && (admOnb.primeiro_login || admOnb.obriga_troca_senha) && (
                        <span
                          className="badge badge-warn pill pill-warn"
                          title="Usuário ainda não trocou a senha provisória"
                          style={{ fontSize: '0.68rem' }}
                        >
                          1º login / Troca pendente
                        </span>
                      )}
                      {admOnb && !admOnb.primeiro_login && !admOnb.obriga_troca_senha && (
                        <span
                          className="badge badge-ok pill pill-ok"
                          title="Senha pessoal ativa e validada"
                          style={{ fontSize: '0.68rem' }}
                        >
                          Senha pessoal ativa
                        </span>
                      )}
                    </div>
                    {/* Ações Administrativas com Salvaguardas Anti-Lockout */}
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-icon btn-ghost"
                        title={`Redefinir senha de ${admProf.nome}`}
                        aria-label="Redefinir senha"
                        style={{ color: 'var(--blue)' }}
                        onClick={() => setAdminResetPwProfile(admProf)}
                      >
                        <KeyRound size={16} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-icon btn-ghost"
                        title={
                          isSelf
                            ? 'Você não pode desativar seu próprio acesso (Anti-Lockout)'
                            : admProf.ativo
                            ? `Desativar acesso de ${admProf.nome}`
                            : `Reativar acesso de ${admProf.nome}`
                        }
                        aria-label={admProf.ativo ? 'Desativar acesso' : 'Ativar acesso'}
                        style={{
                          color: isSelf ? 'var(--ink-muted)' : admProf.ativo ? 'var(--bad)' : 'var(--ok)',
                          opacity: isSelf ? 0.4 : 1,
                          cursor: isSelf ? 'not-allowed' : 'pointer'
                        }}
                        disabled={isSelf}
                        onClick={() => {
                          if (!isSelf) setAdminToggleActiveProfile(admProf);
                        }}
                      >
                        {admProf.ativo ? <UserX size={16} /> : <UserCheck size={16} />}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-icon btn-ghost"
                        title={
                          isSelf
                            ? 'Auto-exclusão bloqueada (Anti-Lockout)'
                            : `Excluir administrador (${admProf.email})`
                        }
                        aria-label="Excluir administrador"
                        style={{
                          color: isSelf ? 'var(--ink-muted)' : 'var(--bad)',
                          opacity: isSelf ? 0.4 : 1,
                          cursor: isSelf ? 'not-allowed' : 'pointer'
                        }}
                        disabled={isSelf}
                        onClick={() => {
                          if (!isSelf) setAdminDeleteProfile(admProf);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}

      {/* ========================================================================= */}
      {/* SEÇÃO 2: CATÁLOGO DE PLATAFORMAS E UNIDADES DE NEGÓCIO */}
      {/* ========================================================================= */}
      {activeSubTab === 'plataformas' && (
        <>
          <div className="card stack" style={{ gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                  Catálogo de Plataformas e Unidades de Negócio · {Object.keys(dataset.plataformas).length}
                </h2>
                <p className="sub" style={{ margin: '4px 0 0' }}>
                  Base oficial de unidades offshore contratadas, armadores e gerências Petrobras.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={platUn}
                  onChange={e => setPlatUn(e.target.value)}
                  style={{ padding: '6px 12px' }}
                >
                  <option value="">Todas as unidades</option>
                  {allUns.map(u => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>

                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pendentesOnly}
                    onChange={e => setPendentesOnly(e.target.checked)}
                  />
                  Pendentes de revisão
                </label>

                <input
                  type="text"
                  placeholder="Buscar sigla, nome ou armador"
                  value={platBusca}
                  onChange={e => setPlatBusca(e.target.value)}
                  style={{ minWidth: 'min(100%, 220px)', flex: '1 1 200px', padding: '6px 12px' }}
                />

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setEditingPlat(null);
                    setPlatModalOpen(true);
                  }}
                >
                  <Plus size={16} /> Nova plataforma
                </button>
              </div>
            </div>

            {/* KPIs das principais UNs */}
            <div className="kpis">
              {allUns.slice(0, 6).map(u => {
                const count = Object.values(dataset.plataformas).filter(p => p.un === u).length;
                return (
                  <div
                    key={u}
                    className="card"
                    style={{ padding: '10px 14px', cursor: 'pointer', background: platUn === u ? 'var(--blue-soft)' : undefined }}
                    onClick={() => setPlatUn(platUn === u ? '' : u)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setPlatUn(platUn === u ? '' : u)}
                    aria-label={`Filtrar por unidade ${u}`}
                  >
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--blue)' }}>{count}</div>
                    <div className="sub" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u}
                    </div>
                  </div>
                );
              })}
            </div>

        {/* DataTable de Plataformas */}
        <DataTable
          data={filteredPlataformas}
          columns={platColumns}
          rowKey={p => p.sigla}
          initialPageSize={50}
          emptyMessage="Nenhuma plataforma encontrada com os filtros selecionados."
        />
      </div>

      {/* ========================================================================= */}
      {/* SEÇÃO 3: IMPORTAÇÃO E EXPORTAÇÃO EM MASSA DE CADASTROS */}
      {/* ========================================================================= */}
      <div className="card stack" style={{ gap: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Importação e exportação em massa de cadastros</h2>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            Atualize o catálogo completo de plataformas ou o diretório de pessoas e suas carteiras via planilha Excel.
          </p>
        </div>

        <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '16px' }}>
          {/* Card: Importar Plataformas */}
          <div className="card stack" style={{ gap: '8px' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Importar plataformas</h3>
            <p className="sub" style={{ margin: 0, fontSize: '0.85rem' }}>
              Colunas: Sigla, Nome, Unidade de negócio, Armador, Tipo. A mesma sigla atualiza a plataforma existente sem duplicar.
            </p>
            <div
              className="dropzone"
              onClick={() => handleTriggerFile('plat')}
              role="button"
              tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleTriggerFile('plat')}
              aria-label="Upload de planilha de plataformas"
              style={{
                padding: '24px 12px',
                border: '2px dashed var(--line-strong)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'var(--surface-alt)'
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--blue)', fontSize: '0.92rem' }}>
                Clique ou arraste a planilha de plataformas
              </div>
            </div>
          </div>

          {/* Card: Importar Pessoas */}
          <div className="card stack" style={{ gap: '8px' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Importar pessoas e carteiras</h3>
            <p className="sub" style={{ margin: 0, fontSize: '0.85rem' }}>
              Colunas: Nome, Papel (Preposto, Controlador ou Gestor), E-mail, Plataformas (siglas separadas por vírgula), Unidades.
            </p>
            <div
              className="dropzone"
              onClick={() => handleTriggerFile('pes')}
              role="button"
              tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleTriggerFile('pes')}
              aria-label="Upload de planilha de pessoas e carteiras"
              style={{
                padding: '24px 12px',
                border: '2px dashed var(--line-strong)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'var(--surface-alt)'
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--blue)', fontSize: '0.92rem' }}>
                Clique ou arraste a planilha de pessoas
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              try {
                await exportModeloXlsx('cad', dataset);
                showToast('Modelo de cadastros exportado com sucesso!', 'success');
              } catch (err: any) {
                showToast(err?.message || 'Erro ao exportar modelo.', 'error');
              }
            }}
          >
            Baixar modelo com o cadastro atual (.xlsx)
          </button>
          <span className="sub" style={{ fontSize: '0.85rem' }}>
            A planilha já traz todas as plataformas e pessoas atuais pré-populadas em abas separadas.
          </span>
        </div>

        {/* Prévia de Importação de Cadastros */}
        {cadParsing && (
          <div className="card note note-info">Lendo planilha de cadastros…</div>
        )}

        {cadPreview && (
          <div className="card stack" style={{ gap: '14px', border: '2px solid var(--blue)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ margin: 0, color: 'var(--blue)' }}>
                Revisão: {cadPreview.fileName} ({cadPreview.rows.length} registros prontos)
              </h3>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setCadPreview(null)}
              >
                ✕ Cancelar
              </button>
            </div>

            {/* Remapeamento de Colunas */}
            <div className="form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              {IMPORT_COLUMNS_DEF[cadPreview.kind]?.map(cDef => (
                <label key={cDef.key} className="fld">
                  <span style={{ fontSize: '0.8rem' }}>{cDef.label}</span>
                  <select
                    value={cadPreview.colMap[cDef.key] ?? ''}
                    onChange={e => {
                      const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                      const updated = {
                        ...cadPreview,
                        colMap: { ...cadPreview.colMap, [cDef.key]: val }
                      };
                      setCadPreview(rebuildPreviewRows(updated, pidx));
                    }}
                  >
                    <option value="">(não usar)</option>
                    {cadPreview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Coluna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveCadPreview}
                disabled={cadSaving || cadPreview.rows.length === 0}
              >
                {cadSaving ? 'Gravando…' : `Salvar ${cadPreview.rows.length} registros`}
              </button>
              {cadProgress && <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{cadProgress}</span>}
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: EDITAR / NOVA PESSOA */}
      {/* ========================================================================= */}
      {pesModalOpen && (
        <PessoaModal
          open={pesModalOpen}
          initialPessoa={editingPes}
          allUns={allUns}
          allPlataformas={Object.values(dataset.plataformas)}
          onClose={() => {
            setPesModalOpen(false);
            setEditingPes(null);
          }}
          onSaved={async () => {
            await refreshData();
            setPesModalOpen(false);
            setEditingPes(null);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDITAR / NOVA PLATAFORMA */}
      {/* ========================================================================= */}
      {platModalOpen && (
        <PlataformaModal
          open={platModalOpen}
          initialPlat={editingPlat}
          allUns={allUns}
          allArmadores={allArmadores}
          onClose={() => {
            setPlatModalOpen(false);
            setEditingPlat(null);
          }}
          onSaved={async () => {
            await refreshData();
            setPlatModalOpen(false);
            setEditingPlat(null);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: GERENCIAR LOGIN / CRIAR LOGIN / REDEFINIR SENHA */}
      {/* ========================================================================= */}
      {loginModalOpen && targetPesForLogin && (
        <UserLoginModal
          open={loginModalOpen}
          pessoa={targetPesForLogin}
          profile={targetPesForLogin.user_id ? dataset.profiles?.[targetPesForLogin.user_id] : null}
          onboarding={targetPesForLogin.user_id ? dataset.onboardingMap?.[targetPesForLogin.user_id] : null}
          onClose={() => {
            setLoginModalOpen(false);
            setTargetPesForLogin(null);
          }}
          onChanged={async () => {
            await refreshData();
            setLoginModalOpen(false);
            setTargetPesForLogin(null);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: NOVO ADMINISTRADOR */}
      {/* ========================================================================= */}
      {adminModalOpen && (
        <NovoAdminModal
          open={adminModalOpen}
          onClose={() => setAdminModalOpen(false)}
          onCreated={async () => {
            await refreshData();
            setAdminModalOpen(false);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAIS DE GESTÃO DE ADMINISTRADORES (SALVAGUARDAS ANTI-LOCKOUT) */}
      {/* ========================================================================= */}
      {adminResetPwProfile && (
        <AdminResetPasswordModal
          user={adminResetPwProfile}
          onClose={() => setAdminResetPwProfile(null)}
          onSuccess={async () => {
            await refreshData();
            setAdminResetPwProfile(null);
          }}
        />
      )}

      {adminToggleActiveProfile && (
        <AdminToggleActiveModal
          user={adminToggleActiveProfile}
          activeAdminsCount={activeAdminsCount}
          onClose={() => setAdminToggleActiveProfile(null)}
          onSuccess={async () => {
            await refreshData();
            setAdminToggleActiveProfile(null);
          }}
        />
      )}

      {adminDeleteProfile && (
        <AdminDeleteUserModal
          user={adminDeleteProfile}
          activeAdminsCount={activeAdminsCount}
          onClose={() => setAdminDeleteProfile(null)}
          onSuccess={async () => {
            await refreshData();
            setAdminDeleteProfile(null);
          }}
        />
      )}
    </div>
  );
};

// ==============================================================================
// SUB-COMPONENTES DE MODAIS ESPECÍFICOS
// ==============================================================================

interface PessoaModalProps {
  open: boolean;
  initialPessoa: Pessoa | null;
  allUns: string[];
  allPlataformas: Plataforma[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const PessoaModal: React.FC<PessoaModalProps> = ({
  open,
  initialPessoa,
  allUns,
  allPlataformas,
  onClose,
  onSaved
}) => {
  const { showToast } = useToast();

  const [nome, setNome] = useState(initialPessoa?.nome || '');
  const [papel, setPapel] = useState<PapelOperacional>(initialPessoa?.papel || 'preposto');
  const [email, setEmail] = useState(initialPessoa?.email || '');
  const [selectedUns, setSelectedUns] = useState<string[]>(initialPessoa?.uns || []);
  const [selectedPlats, setSelectedPlats] = useState<string[]>(initialPessoa?.plats || []);
  const [filterPlat, setFilterPlat] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const platsSorted = useMemo(() => {
    return [...allPlataformas].sort((a, b) =>
      (a.un || '').localeCompare(b.un || '') || a.sigla.localeCompare(b.sigla, undefined, { numeric: true })
    );
  }, [allPlataformas]);

  const selSet = useMemo(() => new Set(selectedPlats.map(platformKey)), [selectedPlats]);

  const togglePlat = (sigla: string) => {
    const k = platformKey(sigla);
    if (selSet.has(k)) {
      setSelectedPlats(prev => prev.filter(s => platformKey(s) !== k));
    } else {
      setSelectedPlats(prev => [...prev, sigla]);
    }
  };

  const selectAllUnPlats = (unName: string) => {
    const platsInUn = platsSorted.filter(p => (p.un || 'Sem unidade') === unName).map(p => p.sigla);
    const existing = new Set(selectedPlats.map(platformKey));
    const toAdd = platsInUn.filter(s => !existing.has(platformKey(s)));
    setSelectedPlats(prev => [...prev, ...toAdd]);
  };

  const clearUnPlats = (unName: string) => {
    const keysInUn = new Set(
      platsSorted.filter(p => (p.un || 'Sem unidade') === unName).map(p => platformKey(p.sigla))
    );
    setSelectedPlats(prev => prev.filter(s => !keysInUn.has(platformKey(s))));
  };

  const toggleUn = (un: string) => {
    if (selectedUns.includes(un)) {
      setSelectedUns(prev => prev.filter(u => u !== un));
    } else {
      setSelectedUns(prev => [...prev, un]);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');
    const cleanNome = nome.trim();
    if (!cleanNome) {
      setErrorMsg('Informe o nome da pessoa.');
      return;
    }

    setSaving(true);
    try {
      await savePessoa({
        id: initialPessoa?.id,
        nome: cleanNome,
        papel,
        email: email.trim().toLowerCase(),
        plats: selectedPlats,
        uns: selectedUns
      });
      showToast('Pessoa e carteira salvas com sucesso!', 'success');
      await onSaved();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao salvar pessoa.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<UserPlus size={20} />}
      title={initialPessoa ? `Editar Pessoa · ${initialPessoa.nome}` : 'Cadastrar Nova Pessoa'}
      subtitle="Definição de perfil, papel operacional e carteira de plataformas"
      maxWidth="680px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => handleSave()} disabled={saving}>
            {saving ? 'Gravando…' : 'Salvar pessoa'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="form-grid-2" style={{ gap: '12px' }}>
          <label className="fld">
            <span>
              <span>Nome completo</span>
              <span className="fld-hint">Obrigatório</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon-left">
                <User size={16} />
              </span>
              <input
                type="text"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Nome completo do colaborador"
                required
                disabled={saving}
              />
            </div>
          </label>

          <label className="fld">
            <span>
              <span>Papel operacional</span>
              <span className="fld-hint">Função</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon-left">
                <Briefcase size={16} />
              </span>
              <select
                value={papel}
                onChange={e => setPapel(e.target.value as PapelOperacional)}
                disabled={saving}
              >
                <option value="preposto">Preposto</option>
                <option value="controlador">Controlador</option>
                <option value="gestor">Gestor</option>
              </select>
            </div>
          </label>
        </div>

        <label className="fld">
          <span>
            <span>E-mail institucional</span>
            <span className="fld-hint">Contato e notificações</span>
          </span>
          <div className="input-with-icon">
            <span className="input-icon-left">
              <Mail size={16} />
            </span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="colaborador@empresa.com.br"
              disabled={saving}
            />
          </div>
        </label>

        {/* Chips de UNs Inteiras */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            Unidades de negócio inteiras (opcional)
          </span>
          <p className="sub" style={{ margin: 0, fontSize: '0.8rem' }}>
            Marque uma unidade quando a pessoa responder por todas as plataformas dela, inclusive as que forem cadastradas futuramente.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
            {allUns.map(u => (
              <label
                key={u}
                className="chip"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--line)',
                  background: selectedUns.includes(u) ? 'var(--blue-soft)' : undefined
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedUns.includes(u)}
                  onChange={() => toggleUn(u)}
                  style={{ minHeight: 0 }}
                  disabled={saving}
                />
                <span style={{ fontSize: '0.82rem' }}>{u}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Checklist Agrupada de Plataformas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              Plataformas individuais · <b>{selectedPlats.length}</b> marcadas
            </span>
            <input
              type="text"
              placeholder="Filtrar plataformas..."
              value={filterPlat}
              onChange={e => setFilterPlat(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '4px 8px', width: 'min(100%, 200px)', flex: '1 1 150px' }}
            />
          </div>

          <div
            className="ckl"
            style={{
              maxHeight: '220px',
              overflowY: 'auto',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px'
            }}
          >
            {allUns.map(u => {
              const q = normalizeText(filterPlat);
              const platsInUn = platsSorted.filter(p => (p.un || 'Sem unidade') === u);
              const matchedPlats = q
                ? platsInUn.filter(p => normalizeText(`${p.sigla} ${p.nome} ${p.armador}`).includes(q))
                : platsInUn;

              if (matchedPlats.length === 0) return null;

              return (
                <fieldset
                  key={u}
                  style={{ border: '1px solid var(--line-subtle)', borderRadius: '4px', marginBottom: '8px', padding: '6px 10px' }}
                >
                  <legend style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--blue)' }}>
                    {u} ({matchedPlats.length}){' '}
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ padding: '0 4px', fontSize: '0.7rem' }}
                      onClick={() => selectAllUnPlats(u)}
                    >
                      marcar todas
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ padding: '0 4px', fontSize: '0.7rem' }}
                      onClick={() => clearUnPlats(u)}
                    >
                      limpar
                    </button>
                  </legend>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '4px' }}>
                    {matchedPlats.map(p => {
                      const isChecked = selSet.has(platformKey(p.sigla));
                      return (
                        <label
                          key={p.sigla}
                          style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
                          title={`${p.nome || p.sigla} · Armador: ${p.armador || '—'}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => togglePlat(p.sigla)}
                            disabled={saving}
                          />
                          <span style={{ fontWeight: isChecked ? 700 : 400 }}>{p.sigla}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </form>
    </Modal>
  );
};

interface PlataformaModalProps {
  open: boolean;
  initialPlat: Plataforma | null;
  allUns: string[];
  allArmadores: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const PlataformaModal: React.FC<PlataformaModalProps> = ({
  open,
  initialPlat,
  allUns,
  allArmadores,
  onClose,
  onSaved
}) => {
  const { showToast } = useToast();

  const [sigla, setSigla] = useState(initialPlat?.sigla || '');
  const [nome, setNome] = useState(initialPlat?.nome || '');
  const [un, setUn] = useState(initialPlat?.un || '');
  const [armador, setArmador] = useState(initialPlat?.armador || '');
  const [tipo, setTipo] = useState(initialPlat?.tipo || '');
  const [situacao, setSituacao] = useState(initialPlat?.situacao || 'Mobilizada');
  const [saving, setSaving] = useState(false);
  const [delConfirm, setDelConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');
    const cleanSigla = sigla.trim().toUpperCase();
    if (!cleanSigla) {
      setErrorMsg('Informe a sigla da plataforma.');
      return;
    }

    setSaving(true);
    try {
      await savePlataforma({
        sigla: cleanSigla,
        nome: nome.trim() || cleanSigla,
        un: un.trim(),
        armador: armador.trim(),
        tipo: tipo.trim(),
        situacao: situacao.trim()
      });
      showToast('Plataforma salva com sucesso!', 'success');
      await onSaved();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao salvar plataforma.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initialPlat) return;
    if (!delConfirm) {
      setDelConfirm(true);
      return;
    }

    setSaving(true);
    try {
      await deletePlataforma(initialPlat.sigla);
      showToast('Plataforma excluída com sucesso.', 'success');
      await onSaved();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao excluir plataforma.');
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Anchor size={20} />}
      title={initialPlat ? `Editar Plataforma · ${initialPlat.sigla}` : 'Nova Plataforma Offshore'}
      subtitle="Cadastro operacional de unidade offshore e armador"
      maxWidth="540px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            {initialPlat && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: delConfirm ? 'var(--bad)' : undefined, fontWeight: delConfirm ? 700 : 400 }}
                onClick={handleDelete}
                disabled={saving}
              >
                <Trash2 size={15} />
                {delConfirm ? 'Confirmar exclusão?' : 'Excluir plataforma'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={() => handleSave()} disabled={saving}>
              {saving ? 'Gravando…' : 'Salvar plataforma'}
            </button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="form-grid-2" style={{ gap: '12px' }}>
          <label className="fld">
            <span>
              <span>Sigla</span>
              <span className="fld-hint">Identificador</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon-left">
                <Anchor size={16} />
              </span>
              <input
                type="text"
                value={sigla}
                onChange={e => setSigla(e.target.value.toUpperCase())}
                placeholder="Ex: P58"
                readOnly={!!initialPlat}
                required
                disabled={saving}
                style={{ fontWeight: 700, letterSpacing: '0.04em' }}
              />
            </div>
          </label>

          <label className="fld">
            <span>
              <span>Nome descritivo</span>
              <span className="fld-hint">Opcional</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon-left">
                <Building2 size={16} />
              </span>
              <input
                type="text"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex: P-58 Baleia Azul"
                disabled={saving}
              />
            </div>
          </label>
        </div>

        <div className="form-grid-2" style={{ gap: '12px' }}>
          <label className="fld">
            <span>
              <span>Unidade de negócio</span>
              <span className="fld-hint">UN</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon-left">
                <MapPin size={16} />
              </span>
              <input
                type="text"
                list="dlUnPlatModal"
                value={un}
                onChange={e => setUn(e.target.value)}
                placeholder="Ex: UN-ES"
                disabled={saving}
              />
            </div>
          </label>

          <label className="fld">
            <span>
              <span>Armador</span>
              <span className="fld-hint">Operador</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon-left">
                <Ship size={16} />
              </span>
              <input
                type="text"
                list="dlArmPlatModal"
                value={armador}
                onChange={e => setArmador(e.target.value)}
                placeholder="Ex: Modec"
                disabled={saving}
              />
            </div>
          </label>
        </div>

        <div className="form-grid-2" style={{ gap: '12px' }}>
          <label className="fld">
            <span>
              <span>Tipo de unidade</span>
              <span className="fld-hint">Classe</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon-left">
                <Layers size={16} />
              </span>
              <input
                type="text"
                value={tipo}
                onChange={e => setTipo(e.target.value)}
                placeholder="Ex: FPSO, Semissubmersível"
                disabled={saving}
              />
            </div>
          </label>

          <label className="fld">
            <span>
              <span>Situação</span>
              <span className="fld-hint">Status</span>
            </span>
            <select
              value={situacao}
              onChange={e => setSituacao(e.target.value)}
              disabled={saving}
            >
              {SITUACOES_PLATAFORMA.map(sit => (
                <option key={sit} value={sit}>
                  {sit}
                </option>
              ))}
            </select>
          </label>
        </div>

        <datalist id="dlUnPlatModal">
          {allUns.map(u => (
            <option key={u} value={u} />
          ))}
        </datalist>

        <datalist id="dlArmPlatModal">
          {allArmadores.map(a => (
            <option key={a} value={a} />
          ))}
        </datalist>

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </form>
    </Modal>
  );
};

interface UserLoginModalProps {
  open: boolean;
  pessoa: Pessoa;
  profile: UserProfile | null;
  onboarding?: UserOnboarding | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

const UserLoginModal: React.FC<UserLoginModalProps> = ({
  open,
  pessoa,
  profile,
  onboarding,
  onClose,
  onChanged
}) => {
  const { showToast } = useToast();

  const [email, setEmail] = useState(profile?.email || pessoa.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<SystemRole>(profile?.role || (pessoa.papel as SystemRole) || 'preposto');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmDeleteCred, setConfirmDeleteCred] = useState(false);

  const handleDeleteCredentials = async () => {
    if (!profile) return;
    if (!confirmDeleteCred) {
      setConfirmDeleteCred(true);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await deleteUserAccount(profile.id);
      if (!res.ok) {
        throw new Error(res.message || 'Falha ao excluir credenciais.');
      }

      try {
        await logSystemEvent({
          action: 'delete-user',
          category: 'usuarios',
          target_id: profile.id,
          target_label: `${pessoa.nome} (${profile.email})`,
          details: { pessoaId: pessoa.id, role: profile.role }
        });
      } catch (logErr) {
        console.warn('Falha secundária ao registrar log de auditoria:', logErr);
      }

      showToast('Credenciais de acesso excluídas com sucesso!', 'success');
      await onChanged();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao excluir credenciais.');
      setConfirmDeleteCred(false);
    } finally {
      setLoading(false);
    }
  };

  const isPasswordValid = password.length >= 8;

  const handleCreateLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');
    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Informe um e-mail válido.');
      return;
    }
    if (!password || password.length < 8) {
      setErrorMsg('A senha inicial deve ter no mínimo 8 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const res = await adminManageUser({
        action: 'create',
        email: email.trim().toLowerCase(),
        password,
        nome: pessoa.nome,
        role,
        pessoaId: pessoa.id,
        plats: pessoa.plats,
        uns: pessoa.uns
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao provisionar login.');
      }

      try {
        await logSystemEvent({
          action: 'create-user-login',
          category: 'usuarios',
          target_id: res.userId || null,
          target_label: `${pessoa.nome} (${email.trim().toLowerCase()})`,
          details: { role, pessoaId: pessoa.id }
        });
      } catch (logErr) {
        console.warn('Falha secundária ao registrar log de auditoria:', logErr);
      }

      showToast('Conta de acesso criada com sucesso!', 'success');
      await onChanged();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao criar conta de login.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!profile) return;
    setErrorMsg('');
    if (!password || password.length < 8) {
      setErrorMsg('A nova senha deve ter no mínimo 8 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const res = await adminManageUser({
        action: 'reset-password',
        userId: profile.id,
        newPassword: password,
        forceChange: true
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao redefinir senha.');
      }

      try {
        await logSystemEvent({
          action: 'reset-password',
          category: 'seguranca',
          target_id: profile.id,
          target_label: `${pessoa.nome} (${profile.email})`,
          details: { forceChange: true }
        });
      } catch (logErr) {
        console.warn('Falha secundária ao registrar log de auditoria:', logErr);
      }

      showToast('Senha redefinida com sucesso!', 'success');
      setPassword('');
      await onChanged();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao redefinir senha.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const res = await adminManageUser({
        action: 'toggle-active',
        userId: profile.id,
        ativo: !profile.ativo
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao alterar status de acesso.');
      }

      try {
        await logSystemEvent({
          action: !profile.ativo ? 'activate-user' : 'deactivate-user',
          category: 'usuarios',
          target_id: profile.id,
          target_label: `${pessoa.nome} (${profile.email})`,
          details: { novo_status: !profile.ativo }
        });
      } catch (logErr) {
        console.warn('Falha secundária ao registrar log de auditoria:', logErr);
      }

      showToast(`Acesso ${!profile.ativo ? 'ativado' : 'desativado'} com sucesso!`, 'success');
      await onChanged();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao alterar status.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<KeyRound size={20} />}
      title={`Gestão de Acesso · ${pessoa.nome}`}
      subtitle={profile ? `Credenciais ativas vinculadas a ${profile.email}` : 'Provisionamento de login corporativo no sistema'}
      maxWidth="540px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Fechar
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {profile ? (
          /* Usuário Já Possui Conta */
          <>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '14px 16px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Mail size={16} style={{ color: 'var(--blue)' }} />
                  <strong style={{ fontSize: '0.92rem', color: 'var(--ink)' }}>{profile.email}</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className={`pill ${profile.ativo ? 'pill-ok' : 'pill-bad'}`}>
                    {profile.ativo ? 'Acesso Ativo' : 'Acesso Desativado'}
                  </span>
                  {onboarding && (onboarding.primeiro_login || onboarding.obriga_troca_senha) && (
                    <span
                      className="pill pill-warn"
                      title="Usuário ainda não trocou a senha provisória"
                      style={{ fontSize: '0.72rem' }}
                    >
                      1º login pendente
                    </span>
                  )}
                  {onboarding && !onboarding.primeiro_login && !onboarding.obriga_troca_senha && (
                    <span
                      className="pill pill-ok"
                      title="Senha pessoal ativa e validada"
                      style={{ fontSize: '0.72rem' }}
                    >
                      Senha ativa
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                Papel no sistema: <strong style={{ color: 'var(--ink)' }}>{ROLES_LABEL[profile.role] || profile.role}</strong>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                padding: '16px',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Lock size={15} style={{ color: 'var(--orange)' }} />
                  Redefinir Senha Provisória
                </div>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.78rem' }}>
                  Ao redefinir, o sistema exigirá que o usuário crie uma nova senha pessoal definitiva no próximo acesso.
                </p>
              </div>

              <label className="fld">
                <span>
                  <span>Nova senha temporária</span>
                  <span className="fld-hint">Mínimo 8 caracteres</span>
                </span>
                <div className="input-with-icon">
                  <span className="input-icon-left">
                    <Lock size={16} />
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Digite a nova senha provisória"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="input-action-right"
                    onClick={() => setShowPassword(p => !p)}
                    title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                    aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              {password.length > 0 && (
                <div className="password-requirements-card">
                  <div className={`password-req-item ${isPasswordValid ? 'met' : ''}`}>
                    <Check size={13} style={{ color: isPasswordValid ? 'var(--ok)' : 'var(--ink-muted)' }} />
                    <span>Mínimo de 8 caracteres {isPasswordValid ? '(OK)' : `(faltam ${8 - password.length})`}</span>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleResetPassword}
                  disabled={loading || password.length < 8}
                >
                  <KeyRound size={15} />
                  {loading ? 'Salvando…' : 'Salvar nova senha'}
                </button>

                <button
                  type="button"
                  className={`btn ${profile.ativo ? 'btn-ghost' : 'btn-accent'}`}
                  style={{ color: profile.ativo ? 'var(--bad)' : undefined }}
                  onClick={handleToggleActive}
                  disabled={loading}
                >
                  {profile.ativo ? <UserX size={15} /> : <UserCheck size={15} />}
                  {profile.ativo ? 'Desativar acesso' : 'Reativar acesso'}
                </button>

                <button
                  type="button"
                  className={`btn ${confirmDeleteCred ? 'btn-danger' : 'btn-ghost'}`}
                  style={{ color: confirmDeleteCred ? 'var(--white)' : 'var(--bad)' }}
                  onClick={handleDeleteCredentials}
                  disabled={loading}
                  title="Remove definitivamente o login e as credenciais desta pessoa"
                >
                  <Trash2 size={15} />
                  {confirmDeleteCred ? 'Confirmar exclusão?' : 'Excluir credenciais'}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Usuário Não Possui Conta - Provisionamento */
          <form onSubmit={handleCreateLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="note note-info" style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.45 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '2px' }}>
                <ShieldCheck size={16} />
                Provisionamento Direto (Zero-Touch)
              </div>
              Crie as credenciais de acesso corporativo com e-mail e senha inicial provisória. No primeiro login, o sistema guiará a definição obrigatória de senha pessoal.
            </div>

            {/* E-mail */}
            <label className="fld">
              <span>
                <span>E-mail de acesso corporativo</span>
                <span className="fld-hint">Identificador de login</span>
              </span>
              <div className="input-with-icon">
                <span className="input-icon-left">
                  <Mail size={16} />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="colaborador@empresa.com.br"
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
            </label>

            {/* Senha */}
            <label className="fld">
              <span>
                <span>Senha provisória inicial</span>
                <span className="fld-hint">Mínimo 8 caracteres</span>
              </span>
              <div className="input-with-icon">
                <span className="input-icon-left">
                  <Lock size={16} />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Defina a senha temporária"
                  required
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="input-action-right"
                  onClick={() => setShowPassword(p => !p)}
                  title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {password.length > 0 && (
              <div className="password-requirements-card">
                <div className={`password-req-item ${isPasswordValid ? 'met' : ''}`}>
                  <Check size={13} style={{ color: isPasswordValid ? 'var(--ok)' : 'var(--ink-muted)' }} />
                  <span>Mínimo de 8 caracteres {isPasswordValid ? '(OK)' : `(faltam ${8 - password.length})`}</span>
                </div>
              </div>
            )}

            {/* Papel do Sistema */}
            <div className="fld">
              <span>
                <span>Papel de governança no sistema</span>
                <span className="fld-hint">Escopo e permissões</span>
              </span>

              <div className="role-cards-grid" role="radiogroup" aria-label="Papel de governança no sistema">
                <div
                  className={`role-card-option ${role === 'preposto' ? 'selected' : ''}`}
                  onClick={() => !loading && setRole('preposto')}
                  role="radio"
                  aria-checked={role === 'preposto'}
                  tabIndex={0}
                  onKeyDown={e => (e.key === ' ' || e.key === 'Enter') && setRole('preposto')}
                >
                  <div className="role-card-header">
                    <div className="role-card-title">
                      <HardHat size={15} />
                      Preposto
                    </div>
                    <span className="role-card-badge">Operacional</span>
                  </div>
                  <div className="role-card-desc">
                    Acesso restrito às plataformas designadas na carteira. Registra e responde justificativas.
                  </div>
                </div>

                <div
                  className={`role-card-option ${role === 'controlador' ? 'selected' : ''}`}
                  onClick={() => !loading && setRole('controlador')}
                  role="radio"
                  aria-checked={role === 'controlador'}
                  tabIndex={0}
                  onKeyDown={e => (e.key === ' ' || e.key === 'Enter') && setRole('controlador')}
                >
                  <div className="role-card-header">
                    <div className="role-card-title">
                      <ClipboardCheck size={15} />
                      Controlador
                    </div>
                    <span className="role-card-badge">Auditoria</span>
                  </div>
                  <div className="role-card-desc">
                    Acompanhamento, conferência, relatórios e validação de conformidade da carteira.
                  </div>
                </div>

                <div
                  className={`role-card-option ${role === 'gestor' ? 'selected' : ''}`}
                  onClick={() => !loading && setRole('gestor')}
                  role="radio"
                  aria-checked={role === 'gestor'}
                  tabIndex={0}
                  onKeyDown={e => (e.key === ' ' || e.key === 'Enter') && setRole('gestor')}
                >
                  <div className="role-card-header">
                    <div className="role-card-title">
                      <ShieldCheck size={15} />
                      Gestor
                    </div>
                    <span className="role-card-badge">Global</span>
                  </div>
                  <div className="role-card-desc">
                    Acesso global a todas as plataformas, relatórios consolidados e medições USOFF.
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ marginTop: '6px', height: '40px' }}
              disabled={loading || password.length < 8}
            >
              <UserPlus size={16} />
              {loading ? 'Provisionando acesso…' : 'Criar login de acesso'}
            </button>
          </form>
        )}

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </div>
    </Modal>
  );
};
