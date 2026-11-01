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
  UserX
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
  batchImportPessoas
} from '../../services/data.service';
import {
  parseSpreadsheetFile,
  rebuildPreviewRows,
  IMPORT_COLUMNS_DEF,
  exportModeloXlsx,
  type ParsedPreviewState
} from '../../services/excel.service';
import { findResponsiblePeople } from '../../domain/calculations';
import { PAPEIS_LABEL, SITUACOES_PLATAFORMA } from '../../config/constants';
import type { ImportKind, PapelOperacional, Pessoa, Plataforma, SystemRole, UserOnboarding, UserProfile } from '../../domain/types';
import { normalizeText, platformKey } from '../../utils/format';
import { Modal } from '../components/Modal';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';

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
  const [delPlatSigla, setDelPlatSigla] = useState<string | null>(null);

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
    setDelPesId(null);
    try {
      await deletePessoa(id);
      await refreshData();
      showToast('Pessoa excluída com sucesso.', 'success');
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
                style={{ minWidth: '240px', padding: '6px 12px' }}
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
                            title={delPesId === p.id ? 'Clique novamente para confirmar a exclusão' : 'Excluir pessoa do cadastro'}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
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
                  style={{ minWidth: '220px', padding: '6px 12px' }}
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

        <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {/* Card: Importar Plataformas */}
          <div className="card stack" style={{ gap: '8px' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Importar plataformas</h3>
            <p className="sub" style={{ margin: 0, fontSize: '0.85rem' }}>
              Colunas: Sigla, Nome, Unidade de negócio, Armador, Tipo. A mesma sigla atualiza a plataforma existente sem duplicar.
            </p>
            <div
              className="dropzone"
              onClick={() => handleTriggerFile('plat')}
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

        <div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => exportModeloXlsx('cad', dataset)}
          >
            Baixar modelo com o cadastro atual (.xlsx)
          </button>
          <span className="sub" style={{ display: 'inline-block', marginLeft: '12px', fontSize: '0.85rem' }}>
            A planilha já traz todas as plataformas e pessoas atuais pré-populadas em abas separadas.
          </span>
        </div>

        {/* Prévia de Importação de Cadastros */}
        {cadParsing && (
          <div className="card note note-info">Lendo planilha de cadastros…</div>
        )}

        {cadPreview && (
          <div className="card stack" style={{ gap: '14px', border: '2px solid var(--blue)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
      title={initialPessoa ? `Editar ${initialPessoa.nome}` : 'Nova pessoa'}
      maxWidth="680px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Nome</span>
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Nome completo"
              required
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Papel operacional</span>
            <select
              value={papel}
              onChange={e => setPapel(e.target.value as PapelOperacional)}
              disabled={saving}
            >
              <option value="preposto">Preposto</option>
              <option value="controlador">Controlador</option>
              <option value="gestor">Gestor</option>
            </select>
          </label>
        </div>

        <label className="fld">
          <span>E-mail</span>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="colaborador@empresa.com.br"
            disabled={saving}
          />
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              Plataformas individuais · <b>{selectedPlats.length}</b> marcadas
            </span>
            <input
              type="text"
              placeholder="Filtrar plataformas..."
              value={filterPlat}
              onChange={e => setFilterPlat(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '4px 8px', width: '180px' }}
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
      title={initialPlat ? `Editar ${initialPlat.sigla}` : 'Nova plataforma'}
      maxWidth="540px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div>
            {initialPlat && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: delConfirm ? 'var(--bad)' : undefined, fontWeight: delConfirm ? 700 : 400 }}
                onClick={handleDelete}
                disabled={saving}
              >
                {delConfirm ? 'Confirmar exclusão?' : 'Excluir'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
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
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '12px' }}>
          <label className="fld">
            <span>Sigla</span>
            <input
              type="text"
              value={sigla}
              onChange={e => setSigla(e.target.value.toUpperCase())}
              placeholder="Ex: P58"
              readOnly={!!initialPlat}
              required
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Nome descritivo</span>
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Ex: P-58 Baleia Azul"
              disabled={saving}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Unidade de negócio</span>
            <input
              type="text"
              list="dlUnPlatModal"
              value={un}
              onChange={e => setUn(e.target.value)}
              placeholder="Ex: UN-ES"
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Armador</span>
            <input
              type="text"
              list="dlArmPlatModal"
              value={armador}
              onChange={e => setArmador(e.target.value)}
              placeholder="Ex: Modec"
              disabled={saving}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Tipo de unidade</span>
            <input
              type="text"
              value={tipo}
              onChange={e => setTipo(e.target.value)}
              placeholder="Ex: FPSO, Semissubmersível"
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Situação</span>
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
  const [role, setRole] = useState<SystemRole>(profile?.role || (pessoa.papel as SystemRole) || 'preposto');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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
        newPassword: password
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao redefinir senha.');
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
      title={`Gestão de Acesso · ${pessoa.nome}`}
      maxWidth="500px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Fechar
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {profile ? (
          /* Usuário Já Possui Conta */
          <>
            <div className="card note note-info" style={{ margin: 0 }}>
              <div>
                <strong>Conta de login vinculada:</strong> {profile.email}
              </div>
              <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span>Status atual:</span>
                <span className={`pill ${profile.ativo ? 'pill-ok' : 'pill-bad'}`}>
                  {profile.ativo ? 'Acesso Ativo' : 'Acesso Desativado'}
                </span>
                {onboarding && (onboarding.primeiro_login || onboarding.obriga_troca_senha) && (
                  <span
                    className="badge badge-warn pill pill-warn"
                    title="Usuário ainda não trocou a senha provisória"
                    style={{ fontSize: '0.68rem' }}
                  >
                    1º login / Troca pendente
                  </span>
                )}
                {onboarding && !onboarding.primeiro_login && !onboarding.obriga_troca_senha && (
                  <span
                    className="badge badge-ok pill pill-ok"
                    title="Senha pessoal ativa e validada"
                    style={{ fontSize: '0.68rem' }}
                  >
                    Senha pessoal ativa
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
              <div className="note note-warn" style={{ fontSize: '0.84rem', margin: 0 }}>
                Esta é uma senha provisória. No primeiro acesso (ou próximo login), o sistema obrigará o usuário a definir uma nova senha pessoal.
              </div>

              <label className="fld">
                <span>Nova senha provisória (mínimo 8 caracteres)</span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Definir nova senha provisória"
                  disabled={loading}
                />
              </label>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleResetPassword}
                  disabled={loading || password.length < 8}
                >
                  {loading ? 'Salvando…' : 'Redefinir senha'}
                </button>

                <button
                  type="button"
                  className={`btn ${profile.ativo ? 'btn-ghost' : 'btn-accent'}`}
                  style={{ color: profile.ativo ? 'var(--bad)' : undefined }}
                  onClick={handleToggleActive}
                  disabled={loading}
                >
                  {profile.ativo ? 'Desativar acesso' : 'Ativar acesso'}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Usuário Não Possui Conta */
          <form onSubmit={handleCreateLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p className="sub" style={{ margin: 0 }}>
              Crie uma conta de login imediata com e-mail e senha inicial (sem depender de SMTP/confirmação).
            </p>

            <div className="note note-warn" style={{ fontSize: '0.84rem', margin: 0 }}>
              Esta é uma senha provisória. No primeiro acesso (ou próximo login), o sistema obrigará o usuário a definir uma nova senha pessoal.
            </div>

            <label className="fld">
              <span>E-mail de acesso</span>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="nome@empresa.com.br"
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
                placeholder="Defina a senha inicial provisória"
                required
                disabled={loading}
              />
            </label>

            <label className="fld">
              <span>Papel de sistema</span>
              <select
                value={role}
                onChange={e => setRole(e.target.value as SystemRole)}
                disabled={loading}
              >
                <option value="preposto">Preposto</option>
                <option value="controlador">Controlador</option>
                <option value="gestor">Gestor do Contrato</option>
              </select>
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ marginTop: '6px' }}
              disabled={loading || password.length < 8}
            >
              {loading ? 'Provisionando…' : 'Criar login'}
            </button>
          </form>
        )}

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </div>
    </Modal>
  );
};

interface NovoAdminModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

const NovoAdminModal: React.FC<NovoAdminModalProps> = ({ open, onClose, onCreated }) => {
  const { showToast } = useToast();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');
    if (!nome.trim()) {
      setErrorMsg('Informe o nome.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Informe um e-mail válido.');
      return;
    }
    if (!password || password.length < 8) {
      setErrorMsg('A senha deve ter no mínimo 8 caracteres.');
      return;
    }

    setLoading(true);
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
      title="Novo Administrador do Sistema"
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
            {loading ? 'Criando…' : 'Criar administrador'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p className="sub" style={{ margin: 0 }}>
          Administradores possuem permissão total no sistema: visão global, configurações, importação e gestão de todos os usuários.
        </p>

        <div className="note note-warn" style={{ fontSize: '0.84rem', margin: 0 }}>
          Esta é uma senha provisória. No primeiro acesso (ou próximo login), o sistema obrigará o usuário a definir uma nova senha pessoal.
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
            placeholder="admin@empresa.com.br"
            required
            disabled={loading}
          />
        </label>

        <label className="fld">
          <span>Senha inicial (mínimo 8 caracteres)</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Defina uma senha forte"
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
// SUB-MODAL: REDEFINIR SENHA DE ADMINISTRADOR
// ==============================================================================
interface AdminResetPasswordModalProps {
  user: UserProfile;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

const AdminResetPasswordModal: React.FC<AdminResetPasswordModalProps> = ({
  user,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleReset = async (e?: React.FormEvent) => {
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
        throw new Error(res.message || 'Falha ao redefinir senha do administrador.');
      }

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
          <span>Redefinir Senha · {user.nome}</span>
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
            onClick={() => handleReset()}
            disabled={loading || password.length < 8}
          >
            {loading ? 'Redefinindo…' : 'Salvar Nova Senha'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="note note-warn" style={{ margin: 0, fontSize: '0.84rem' }}>
          Esta é uma credencial provisória. O administrador será obrigado a definir uma nova senha no próximo login.
        </div>

        <div>
          <span className="sub" style={{ fontSize: '0.8rem' }}>Administrador:</span>
          <div style={{ fontWeight: 600 }}>{user.nome} &lt;{user.email}&gt;</div>
        </div>

        <label className="fld">
          <span>Nova senha provisória (mínimo 8 caracteres)</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Digite a nova senha provisória"
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
// SUB-MODAL: ATIVAR / DESATIVAR ADMINISTRADOR (ANTI-LOCKOUT)
// ==============================================================================
interface AdminToggleActiveModalProps {
  user: UserProfile;
  activeAdminsCount: number;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

const AdminToggleActiveModal: React.FC<AdminToggleActiveModalProps> = ({
  user,
  activeAdminsCount,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const willDeactivate = user.ativo;
  const isLastActiveAdmin = willDeactivate && activeAdminsCount <= 1;

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
        throw new Error(res.message || 'Falha ao alterar status do administrador.');
      }

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
              Este é o único Administrador ativo no sistema. Desativá-lo bloquearia permanentemente o painel administrativo.
            </p>
          </div>
        ) : willDeactivate ? (
          <div className="note note-warn" style={{ margin: 0 }}>
            <strong>Atenção:</strong> Ao desativar o acesso de <b>{user.nome}</b>, o token de sessão será revogado e a conta não poderá mais acessar o sistema até ser reativada.
          </div>
        ) : (
          <div className="note note-info" style={{ margin: 0 }}>
            Ao reativar o acesso, <b>{user.nome}</b> terá seus privilégios de administrador restaurados.
          </div>
        )}

        <div>
          <span className="sub" style={{ fontSize: '0.8rem' }}>Administrador:</span>
          <div style={{ fontWeight: 600 }}>{user.nome}</div>
          <div className="sub">{user.email}</div>
        </div>

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </div>
    </Modal>
  );
};

// ==============================================================================
// SUB-MODAL: EXCLUIR ADMINISTRADOR (SALVAGUARDA ANTI-LOCKOUT)
// ==============================================================================
interface AdminDeleteUserModalProps {
  user: UserProfile;
  activeAdminsCount: number;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

const AdminDeleteUserModal: React.FC<AdminDeleteUserModalProps> = ({
  user,
  activeAdminsCount,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  const [confirmInput, setConfirmInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isLastActiveAdmin = activeAdminsCount <= 1;
  const isMatch = confirmInput.trim().toLowerCase() === user.email.toLowerCase() ||
                  confirmInput.trim().toLowerCase() === user.nome.toLowerCase();

  const handleDelete = async () => {
    if (isLastActiveAdmin) {
      setErrorMsg('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
      return;
    }

    if (!isMatch) {
      setErrorMsg('A confirmação digitada não confere com o e-mail ou nome do administrador.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await deleteUserAccount(user.id);
      if (!res.ok) {
        throw new Error(res.message || 'Falha ao excluir administrador.');
      }

      showToast(`Administrador ${user.nome} excluído definitivamente.`, 'success');
      await onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao excluir administrador.');
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
          <span>Excluir Administrador Global</span>
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
              Este é o único Administrador ativo no sistema. A exclusão desta conta bloquearia a governança do sistema. Cadastre outro administrador antes de prosseguir.
            </p>
          </div>
        ) : (
          <>
            <div className="note note-bad" style={{ margin: 0 }}>
              <strong>Atenção: Ação Irreversível!</strong>
              <p style={{ margin: '4px 0 0' }}>
                A exclusão removerá permanentemente as credenciais e acessos do administrador <b>{user.nome}</b> ({user.email}).
              </p>
            </div>

            <label className="fld">
              <span>Para confirmar a exclusão, digite o e-mail do administrador:</span>
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
