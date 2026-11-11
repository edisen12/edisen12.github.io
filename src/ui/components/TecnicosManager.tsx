import React, { useState, useMemo, useRef } from 'react';
import {
  HardHat,
  Plus,
  Search,
  FileSpreadsheet,
  Download,
  Upload,
  Edit3,
  Trash2,
  FileText,
  Users,
  Check,
  AlertCircle,
  Copy,
  Briefcase,
  X
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useToast } from './ToastContext';
import { Modal } from './Modal';
import { DataTable, type DataTableColumn } from './DataTable';
import { saveTecnico, deleteTecnico, batchImportTecnicos } from '../../services/data.service';
import {
  exportTecnicosListXlsx,
  exportModeloXlsx,
  parseSpreadsheetFile,
  rebuildPreviewRows,
  IMPORT_COLUMNS_DEF,
  type ParsedPreviewState
} from '../../services/excel.service';
import type { Tecnico } from '../../domain/types';

interface TecnicoRowData extends Tecnico {
  hhCount: number;
  cartCount: number;
  totalVinculos: number;
}

export function TecnicosManager() {
  const { dataset, refreshData, isGlobal, openFichaDrawer } = useApp();
  const { showToast } = useToast();

  // Estados de filtro e busca
  const [search, setSearch] = useState('');
  const [funcaoFilter, setFuncaoFilter] = useState('todas');
  const [historicoFilter, setHistoricoFilter] = useState<'todos' | 'com_historico' | 'sem_historico'>('todos');

  // Modais
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTecnico, setEditingTecnico] = useState<Tecnico | null>(null);

  const [delModalOpen, setDelModalOpen] = useState(false);
  const [deletingTecnico, setDeletingTecnico] = useState<TecnicoRowData | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);

  // Copiar matrícula com feedback
  const [copiedMat, setCopiedMat] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const handleCopyMat = (mat: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(mat);
    }
    setCopiedMat(mat);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedMat(null), 2000);
  };

  // Contadores de apontamentos e embarques por matrícula
  const { hhCounts, cartCounts } = useMemo(() => {
    const hh: Record<string, number> = {};
    Object.values(dataset.hhMap || {}).forEach(r => {
      if (r?.matricula) {
        hh[r.matricula] = (hh[r.matricula] || 0) + 1;
      }
    });

    const cart: Record<string, number> = {};
    (dataset.carteira || []).forEach(emb => {
      cart[emb.matricula] = (cart[emb.matricula] || 0) + 1;
    });

    return { hhCounts: hh, cartCounts: cart };
  }, [dataset.hhMap, dataset.carteira]);

  // Lista enriquecida de técnicos
  const allRows: TecnicoRowData[] = useMemo(() => {
    return Object.values(dataset.tecnicos || {}).map(t => {
      const hc = hhCounts[t.matricula] || 0;
      const cc = cartCounts[t.matricula] || 0;
      return {
        ...t,
        hhCount: hc,
        cartCount: cc,
        totalVinculos: hc + cc
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [dataset.tecnicos, hhCounts, cartCounts]);

  // Funções únicas para o filtro
  const funcoesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach(r => {
      if (r.funcao && r.funcao.trim()) set.add(r.funcao.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  // Filtragem dos dados
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter(r => {
      if (q) {
        const matchesMat = r.matricula.toLowerCase().includes(q);
        const matchesNome = r.nome.toLowerCase().includes(q);
        const matchesFuncao = (r.funcao || '').toLowerCase().includes(q);
        if (!matchesMat && !matchesNome && !matchesFuncao) return false;
      }

      if (funcaoFilter !== 'todas' && (r.funcao || '').trim() !== funcaoFilter) {
        return false;
      }

      if (historicoFilter === 'com_historico' && r.totalVinculos === 0) {
        return false;
      }
      if (historicoFilter === 'sem_historico' && r.totalVinculos > 0) {
        return false;
      }

      return true;
    });
  }, [allRows, search, funcaoFilter, historicoFilter]);

  // Estatísticas do cadastro
  const stats = useMemo(() => {
    const total = allRows.length;
    const comHist = allRows.filter(r => r.totalVinculos > 0).length;
    const semHist = total - comHist;
    const totalFuncoes = funcoesDisponiveis.length;
    return { total, comHist, semHist, totalFuncoes };
  }, [allRows, funcoesDisponiveis]);

  // Confirmação de exclusão
  const handleDeleteConfirm = async () => {
    if (!deletingTecnico) return;
    setDeleting(true);
    try {
      await deleteTecnico(deletingTecnico.matricula);
      showToast(`Técnico ${deletingTecnico.nome} (Mat. ${deletingTecnico.matricula}) excluído com sucesso.`, 'success');
      setDelModalOpen(false);
      setDeletingTecnico(null);
      await refreshData();
    } catch (err: any) {
      showToast(err?.message || 'Falha ao excluir técnico offshore.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Definição das colunas da DataTable
  const columns: DataTableColumn<TecnicoRowData>[] = [
    {
      key: 'matricula',
      header: 'Matrícula',
      sortValue: r => r.matricula,
      width: '160px',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="badge badge-subtle num" style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.88rem' }}>
            {r.matricula}
          </span>
          <button
            type="button"
            className="btn-icon-subtle"
            title={copiedMat === r.matricula ? 'Copiado!' : 'Copiar matrícula'}
            aria-label="Copiar matrícula"
            onClick={e => {
              e.stopPropagation();
              handleCopyMat(r.matricula);
            }}
          >
            {copiedMat === r.matricula ? <Check size={13} style={{ color: 'var(--green)' }} /> : <Copy size={13} />}
          </button>
        </div>
      )
    },
    {
      key: 'nome',
      header: 'Nome do Colaborador',
      sortValue: r => r.nome,
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.78rem',
              color: 'var(--brand-primary)',
              flexShrink: 0
            }}
            aria-hidden="true"
          >
            {r.nome.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.nome}</div>
            <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
              {r.funcao || 'Técnico Offshore'}
            </div>
          </div>
        </div>
      )
    },
    {
      key: 'funcao',
      header: 'Função / Especialidade',
      sortValue: r => r.funcao,
      render: r => (
        <span className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem' }}>
          <Briefcase size={12} style={{ color: 'var(--ink-muted)' }} />
          {r.funcao || 'Técnico Offshore'}
        </span>
      )
    },
    {
      key: 'totalVinculos',
      header: 'Histórico Operacional',
      sortValue: r => r.totalVinculos,
      width: '210px',
      render: r => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="badge badge-subtle" title="Apontamentos diários de HH">{r.hhCount} HHs</span>
            <span className="badge badge-subtle" title="Embarques em carteira">{r.cartCount} Emb.</span>
          </div>
          {r.totalVinculos === 0 && (
            <span className="sub" style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
              Sem histórico lançado
            </span>
          )}
        </div>
      )
    },
    {
      key: 'acoes',
      header: 'Ações',
      align: 'right',
      width: '160px',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            title="Abrir ficha detalhada do técnico"
            aria-label="Abrir ficha do técnico"
            onClick={() => openFichaDrawer(r.matricula)}
          >
            <FileText size={14} /> Ficha
          </button>

          {isGlobal && (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                title="Editar dados cadastrais"
                aria-label="Editar técnico"
                onClick={() => {
                  setEditingTecnico(r);
                  setModalOpen(true);
                }}
              >
                <Edit3 size={14} />
              </button>

              <button
                type="button"
                className="btn btn-ghost btn-xs text-danger"
                title={
                  r.totalVinculos > 0
                    ? `Técnico possui ${r.totalVinculos} registros de histórico. Exclusão bloqueada para integridade contratual.`
                    : 'Excluir técnico do cadastro mestre'
                }
                aria-label="Excluir técnico"
                disabled={r.totalVinculos > 0}
                onClick={() => {
                  setDeletingTecnico(r);
                  setDelModalOpen(true);
                }}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Banner de Apresentação e Estatísticas */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ color: 'var(--brand-primary)' }}>
              <HardHat size={28} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Gerenciamento de Técnicos Offshore</h3>
              <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.85rem' }}>
                Diretório mestre de colaboradores embarcados. Vincule cadastros manuais, edite funções e audite presenças.
              </p>
            </div>
          </div>

          {/* Botões de Ação Primária */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => exportModeloXlsx('tec', dataset)}
              title="Baixar planilha modelo vazia para cadastro de técnicos"
            >
              <Download size={14} style={{ marginRight: '6px' }} /> Modelo Excel
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => exportTecnicosListXlsx(dataset)}
              title="Exportar todos os técnicos cadastrados para planilha Excel"
            >
              <FileSpreadsheet size={14} style={{ marginRight: '6px' }} /> Exportar Técnicos
            </button>

            {isGlobal && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setImportModalOpen(true)}
                  title="Importar lista de técnicos em lote via planilha"
                >
                  <Upload size={14} style={{ marginRight: '6px' }} /> Importar em Lote
                </button>

                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setEditingTecnico(null);
                    setModalOpen(true);
                  }}
                  title="Cadastrar um novo técnico manualmente"
                >
                  <Plus size={15} style={{ marginRight: '6px' }} /> Novo Técnico
                </button>
              </>
            )}
          </div>
        </div>

        {/* Badges de Contagem Rápida */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.82rem' }}>
          <div className="pill pill-info" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}>
            <Users size={13} /> Total Cadastrados: <b>{stats.total}</b>
          </div>
          <div className="pill pill-ok" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}>
            <Check size={13} /> Com Histórico (HH/Emb): <b>{stats.comHist}</b>
          </div>
          <div className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--surface-alt)' }}>
            <AlertCircle size={13} style={{ color: 'var(--ink-muted)' }} /> Sem Apontamento: <b>{stats.semHist}</b>
          </div>
          <div className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--surface-alt)' }}>
            <Briefcase size={13} style={{ color: 'var(--ink-muted)' }} /> Funções Distintas: <b>{stats.totalFuncoes}</b>
          </div>
          {filteredRows.length !== allRows.length && (
            <div className="pill pill-warn" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', fontWeight: 600 }}>
              Exibindo <b>{filteredRows.length}</b> de {allRows.length} técnicos filtrados
            </div>
          )}
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
          <input
            type="text"
            className="input"
            style={{ width: '100%', paddingLeft: '32px' }}
            placeholder="Buscar por nome, matrícula ou função…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="btn-icon-subtle"
              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)' }}
              onClick={() => setSearch('')}
              title="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink-muted)' }}>Função:</label>
          <select
            className="select"
            value={funcaoFilter}
            onChange={e => setFuncaoFilter(e.target.value)}
            style={{ minWidth: '180px' }}
          >
            <option value="todas">Todas as funções ({funcoesDisponiveis.length})</option>
            {funcoesDisponiveis.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink-muted)' }}>Histórico:</label>
          <select
            className="select"
            value={historicoFilter}
            onChange={e => setHistoricoFilter(e.target.value as any)}
            style={{ minWidth: '160px' }}
          >
            <option value="todos">Todos</option>
            <option value="com_historico">Com Histórico Ativo</option>
            <option value="sem_historico">Sem Histórico Lançado</option>
          </select>
        </div>

        {(search || funcaoFilter !== 'todas' || historicoFilter !== 'todos') && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSearch('');
              setFuncaoFilter('todas');
              setHistoricoFilter('todos');
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Tabela de Dados */}
      <DataTable<TecnicoRowData>
        columns={columns}
        data={filteredRows}
        rowKey={r => r.matricula}
        emptyMessage="Nenhum técnico offshore encontrado com os filtros informados."
        initialPageSize={20}
      />

      {/* Modal de Cadastro / Edição Manual */}
      {modalOpen && (
        <TecnicoModal
          open={modalOpen}
          initialTecnico={editingTecnico}
          existingFuncoes={funcoesDisponiveis}
          onClose={() => {
            setModalOpen(false);
            setEditingTecnico(null);
          }}
          onSaved={async () => {
            setModalOpen(false);
            setEditingTecnico(null);
            await refreshData();
          }}
        />
      )}

      {/* Modal de Confirmação de Exclusão */}
      {delModalOpen && deletingTecnico && (
        <Modal
          open={delModalOpen}
          title="Excluir Técnico Offshore"
          onClose={() => !deleting && setDelModalOpen(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0 }}>
              Deseja realmente remover o técnico <b>{deletingTecnico.nome}</b> (Matrícula <b>{deletingTecnico.matricula}</b>) do cadastro mestre?
            </p>
            <div className="pill pill-warn" style={{ fontSize: '0.82rem', padding: '8px 12px' }}>
              <AlertCircle size={14} style={{ marginRight: '6px' }} />
              Esta ação removerá o registro mestre. A exclusão só é permitida porque o colaborador não possui apontamentos de HH nem embarques em carteira.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDelModalOpen(false)}
                disabled={deleting}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? 'Excluindo…' : 'Sim, Excluir'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal de Importação em Lote via Planilha */}
      {importModalOpen && (
        <ImportarTecnicosModal
          open={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          onImported={async () => {
            setImportModalOpen(false);
            await refreshData();
          }}
        />
      )}
    </div>
  );
}

// ==============================================================================
// Modal de Criação / Edição de Técnico
// ==============================================================================
interface TecnicoModalProps {
  open: boolean;
  initialTecnico: Tecnico | null;
  existingFuncoes: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function TecnicoModal({ open, initialTecnico, existingFuncoes, onClose, onSaved }: TecnicoModalProps) {
  const { showToast } = useToast();
  const [matricula, setMatricula] = useState(initialTecnico?.matricula || '');
  const [nome, setNome] = useState(initialTecnico?.nome || '');
  const [funcao, setFuncao] = useState(initialTecnico?.funcao || '');
  const [saving, setSaving] = useState(false);

  const isEditing = Boolean(initialTecnico);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMat = matricula.trim();
    const cleanNome = nome.trim();
    const cleanFuncao = funcao.trim() || 'Técnico Offshore';

    if (!cleanMat) {
      showToast('A matrícula do colaborador é obrigatória.', 'error');
      return;
    }
    if (!cleanNome) {
      showToast('O nome completo do colaborador é obrigatório.', 'error');
      return;
    }

    setSaving(true);
    try {
      await saveTecnico({
        matricula: cleanMat,
        nome: cleanNome,
        funcao: cleanFuncao
      });
      showToast(
        isEditing
          ? `Técnico ${cleanNome} atualizado com sucesso.`
          : `Técnico ${cleanNome} cadastrado com sucesso.`,
        'success'
      );
      await onSaved();
    } catch (err: any) {
      showToast(err?.message || 'Falha ao salvar dados do técnico offshore.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEditing ? `Editar Técnico: ${initialTecnico?.nome}` : 'Novo Técnico Offshore'}
      onClose={() => !saving && onClose()}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
            Matrícula *
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%', fontFamily: 'monospace' }}
            value={matricula}
            onChange={e => setMatricula(e.target.value)}
            disabled={saving || isEditing}
            placeholder="Ex.: 10231 ou TEC-9981"
            required
          />
          {isEditing && (
            <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
              A matrícula é a chave primária e não pode ser alterada diretamente para preservar os vínculos contratuais.
            </div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
            Nome Completo *
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%' }}
            value={nome}
            onChange={e => setNome(e.target.value)}
            disabled={saving}
            placeholder="Ex.: Carlos Eduardo da Silva"
            required
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
            Função / Especialidade Offshore
          </label>
          <input
            type="text"
            list="dlTecnicoFuncoes"
            className="input"
            style={{ width: '100%' }}
            value={funcao}
            onChange={e => setFuncao(e.target.value)}
            disabled={saving}
            placeholder="Ex.: Técnico Offshore, Instrumentista, Mecânico…"
          />
          <datalist id="dlTecnicoFuncoes">
            {existingFuncoes.map(f => (
              <option key={f} value={f} />
            ))}
            <option value="Técnico Offshore" />
            <option value="Técnico de Instrumentação" />
            <option value="Técnico de Elétrica" />
            <option value="Técnico de Mecânica" />
            <option value="Caldeireiro" />
            <option value="Delineador" />
            <option value="Soldador" />
            <option value="Inspetor de END" />
            <option value="Supervisor de Operações" />
          </datalist>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
          >
            {saving ? 'Gravando…' : isEditing ? 'Salvar Alterações' : 'Cadastrar Técnico'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ==============================================================================
// Modal de Importação em Lote via Planilha (Excel / CSV)
// ==============================================================================
interface ImportarTecnicosModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => Promise<void>;
}

function ImportarTecnicosModal({ open, onClose, onImported }: ImportarTecnicosModalProps) {
  const { pidx } = useApp();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [preview, setPreview] = useState<ParsedPreviewState | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);
    try {
      const parsed = await parseSpreadsheetFile(file, 'tec');
      const built = rebuildPreviewRows(parsed, pidx);
      setPreview(built);
      showToast(`Planilha processada: ${built.rows.length} técnicos lidos.`, 'info');
    } catch (err: any) {
      showToast(err?.message || 'Falha ao processar arquivo de planilha.', 'error');
      setPreview(null);
    } finally {
      setParsing(false);
    }
  };

  const handleSaveImport = async () => {
    if (!preview || !preview.rows.length) {
      showToast('Nenhum técnico válido identificado para gravação.', 'error');
      return;
    }

    const payload = preview.rows.map(r => ({
      matricula: String(r.mat || '').trim(),
      nome: String(r.nome || '').trim(),
      funcao: String(r.funcao || '').trim() || 'Técnico Offshore'
    }));

    setSaving(true);
    setProgress({ current: 0, total: payload.length });
    try {
      await batchImportTecnicos(payload, (gravadas, total) => {
        setProgress({ current: gravadas, total });
      });
      showToast(`${payload.length} técnicos gravados no banco de dados com sucesso!`, 'success');
      await onImported();
    } catch (err: any) {
      showToast(err?.message || 'Falha ao gravar técnicos offshore no banco.', 'error');
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  return (
    <Modal
      open={open}
      title="Importar Técnicos Offshore em Lote"
      onClose={() => !saving && onClose()}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0, fontSize: '0.88rem' }}>
          Selecione uma planilha (<b>.xlsx</b>, <b>.xls</b> ou <b>.csv</b>) contendo as colunas <b>Matrícula</b>, <b>Nome</b> e <b>Função</b>. Registros existentes com a mesma matrícula serão atualizados automaticamente.
        </p>

        {/* Input de Arquivo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx, .xls, .csv"
            onChange={handleFileChange}
            disabled={parsing || saving}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={parsing || saving}
          >
            <Upload size={15} style={{ marginRight: '6px' }} />
            {parsing ? 'Processando…' : 'Selecionar Planilha'}
          </button>
          {preview && (
            <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
              {preview.fileName} ({preview.rows.length} registros prontos)
            </span>
          )}
        </div>

        {/* Remapeamento de Colunas */}
        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              {IMPORT_COLUMNS_DEF.tec.map(cDef => (
                <label key={cDef.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                  <span style={{ fontWeight: 600 }}>{cDef.label}:</span>
                  <select
                    className="select"
                    value={preview.colMap[cDef.key] ?? ''}
                    onChange={e => {
                      const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                      const updated = {
                        ...preview,
                        colMap: { ...preview.colMap, [cDef.key]: val }
                      };
                      setPreview(rebuildPreviewRows(updated, pidx));
                    }}
                  >
                    <option value="">(não usar)</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Coluna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            {/* Tabela de Pré-visualização */}
            <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
              <table className="table-base table-compact" style={{ width: '100%', fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>Matrícula</th>
                    <th>Nome</th>
                    <th>Função</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 30).map((row, idx) => (
                    <tr key={idx}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.mat || '—'}</td>
                      <td>{row.nome || '—'}</td>
                      <td>{row.funcao || 'Técnico Offshore'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 30 && (
              <span className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                Mostrando as primeiras 30 linhas de {preview.rows.length}.
              </span>
            )}
            {preview.errors.length > 0 && (
              <div className="pill pill-warn" style={{ fontSize: '0.75rem', padding: '6px 10px' }}>
                <AlertCircle size={12} style={{ marginRight: '4px' }} />
                {preview.errors.length} avisos ou linhas ignoradas.
              </div>
            )}
          </div>
        )}

        {/* Barra de Progresso */}
        {progress && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
              <span>Gravando técnicos…</span>
              <span>{progress.current} / {progress.total}</span>
            </div>
            <div style={{ width: '100%', height: '6px', background: 'var(--surface-alt)', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                  height: '100%',
                  background: 'var(--brand-primary)',
                  transition: 'width 0.2s ease'
                }}
              />
            </div>
          </div>
        )}

        {/* Ações do Rodapé */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Fechar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveImport}
            disabled={!preview || saving || preview.rows.length === 0}
          >
            {saving ? 'Gravando…' : `Gravar ${preview?.rows.length || 0} Técnicos no Banco`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
