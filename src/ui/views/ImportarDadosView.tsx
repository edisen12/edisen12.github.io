import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import {
  batchImportHH,
  batchImportCarteira,
  batchImportPlataformas,
  batchImportPessoas,
  batchImportConfirmacoesSAP,
  fetchCarteiraDedupSnapshot,
  fetchSapDedupSnapshot,
  resetCarteiraEmbarques,
  exportJsonSnapshot
} from '../../services/data.service';
import {
  planSmartCarteiraImport,
  planSmartSapImport
} from '../../adapters/shared/client-pipeline';
import type { CarteiraDedupSnapshot } from '../../ports/data.port';
import {
  parseSpreadsheetFile,
  rebuildPreviewRows,
  IMPORT_COLUMNS_DEF,
  exportModeloXlsx,
  type ParsedPreviewState
} from '../../services/excel.service';
import { formatBr, diffDays } from '../../utils/date';
import { formatHours } from '../../utils/format';
import type { ConfirmacaoSAP, ImportKind, TabId } from '../../domain/types';
import { ManualHHModal, ManualCartModal } from '../modals/ManualEntryModals';

export const ImportarDadosView: React.FC = () => {
  const { dataset, pidx, refreshData, isGlobal, setActiveTab, setFilter } = useApp();
  const { showToast } = useToast();

  const [preview, setPreview] = useState<ParsedPreviewState | null>(null);
  const [parsing, setParsing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveProgress, setSaveProgress] = useState<string>('');
  const [substituirCarteira, setSubstituirCarteira] = useState<boolean>(false);
  const [cartDedupSnapshot, setCartDedupSnapshot] = useState<CarteiraDedupSnapshot | null>(null);
  const [sapDedupSnapshot, setSapDedupSnapshot] = useState<ConfirmacaoSAP[] | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState<boolean>(false);

  const [openManualHH, setOpenManualHH] = useState<boolean>(false);
  const [openManualCart, setOpenManualCart] = useState<boolean>(false);

  // Drag over states
  const [dragActiveKind, setDragActiveKind] = useState<ImportKind | null>(null);

  // Hidden file inputs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const currentUploadKindRef = useRef<ImportKind>('hh');
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const handleExportModelo = async (kind: 'cad' | 'cart' | 'hh' | 'sap') => {
    try {
      await exportModeloXlsx(kind, dataset);
      showToast('Planilha modelo baixada com sucesso!', 'success');
    } catch (err: any) {
      showToast('Erro ao baixar modelo de planilha: ' + (err?.message || 'Falha'), 'error');
    }
  };

  const handleTriggerFileInput = (kind: ImportKind) => {
    currentUploadKindRef.current = kind;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const loadCartDedupSnapshot = async () => {
    setLoadingSnapshot(true);
    try {
      const snap = await fetchCarteiraDedupSnapshot();
      if (snap && (snap.carteiraOperacoes.length > 0 || snap.carteira.length > 0)) {
        setCartDedupSnapshot(snap);
      } else {
        setCartDedupSnapshot(null);
      }
    } catch {
      setCartDedupSnapshot(null);
    } finally {
      setLoadingSnapshot(false);
    }
  };

  const loadSapDedupSnapshot = async () => {
    setLoadingSnapshot(true);
    try {
      const snap = await fetchSapDedupSnapshot();
      setSapDedupSnapshot(snap && snap.length > 0 ? snap : null);
    } catch {
      setSapDedupSnapshot(null);
    } finally {
      setLoadingSnapshot(false);
    }
  };

  const handleFileSelected = async (file: File, forcedKind?: ImportKind) => {
    setParsing(true);
    setPreview(null);
    setCartDedupSnapshot(null);
    setSapDedupSnapshot(null);
    try {
      const parsed = await parseSpreadsheetFile(file, forcedKind || currentUploadKindRef.current);
      const built = rebuildPreviewRows(parsed, pidx);
      setPreview(built);
      if (built.kind === 'cart') {
        void loadCartDedupSnapshot();
      } else if (built.kind === 'sap') {
        void loadSapDedupSnapshot();
      }
      if (built.rows.length > 0) {
        showToast(`Planilha "${file.name}" carregada: ${built.rows.length} registros identificados. Confira a prévia e clique em "Gravar no Banco" abaixo.`, 'info');
      } else {
        showToast(`Atenção: Nenhuma linha válida encontrada para o tipo "${built.kind}". Verifique o tipo ou o mapeamento de colunas.`, 'warn');
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err: any) {
      showToast(err?.message || 'Erro ao processar planilha.', 'error');
    } finally {
      setParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent, kind: ImportKind) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveKind(null);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0], kind);
    }
  };

  const handleColMapChange = (colKey: string, newIndexStr: string) => {
    if (!preview) return;
    const newIdx = newIndexStr === '' ? undefined : parseInt(newIndexStr, 10);
    const updatedPreview: ParsedPreviewState = {
      ...preview,
      colMap: {
        ...preview.colMap,
        [colKey]: newIdx
      }
    };
    const rebuilt = rebuildPreviewRows(updatedPreview, pidx);
    setPreview(rebuilt);
  };

  const handleKindChange = (newKind: ImportKind) => {
    if (!preview) return;
    const rebuilt = rebuildPreviewRows(preview, pidx, newKind);
    setPreview(rebuilt);
    if (newKind === 'cart') {
      void loadCartDedupSnapshot();
    } else if (newKind === 'sap') {
      void loadSapDedupSnapshot();
    }
  };

  const cartPlan = useMemo(() => {
    if (!preview || preview.kind !== 'cart') return null;
    const existingOps = cartDedupSnapshot?.carteiraOperacoes ?? dataset.carteiraOperacoes ?? [];
    const existingCart = cartDedupSnapshot?.carteira ?? dataset.carteira ?? [];
    return planSmartCarteiraImport(preview.rows, pidx, existingOps, existingCart, substituirCarteira);
  }, [preview, pidx, cartDedupSnapshot, dataset.carteiraOperacoes, dataset.carteira, substituirCarteira]);

  const sapPlan = useMemo(() => {
    if (!preview || preview.kind !== 'sap') return null;
    const existingSap = sapDedupSnapshot ?? dataset.confirmacoesSap ?? [];
    return planSmartSapImport(preview.rows, existingSap);
  }, [preview, sapDedupSnapshot, dataset.confirmacoesSap]);

  const effectiveSaveCount = useMemo(() => {
    if (!preview) return 0;
    if (preview.kind === 'cart' && cartPlan) {
      return cartPlan.rowsToImport.length;
    }
    if (preview.kind === 'sap' && sapPlan) {
      return sapPlan.rowsToImport.length;
    }
    return preview.rows.length;
  }, [preview, cartPlan, sapPlan]);

  const hasNothingToSave = useMemo(() => {
    if (!preview || preview.rows.length === 0) return true;
    if (preview.kind === 'cart' && cartPlan && !substituirCarteira) {
      return cartPlan.rowsToImport.length === 0 && cartPlan.staleOpsToPruneCount === 0;
    }
    if (preview.kind === 'sap' && sapPlan) {
      return sapPlan.rowsToImport.length === 0;
    }
    return false;
  }, [preview, cartPlan, sapPlan, substituirCarteira]);

  const handleSavePreview = async () => {
    if (!preview || preview.rows.length === 0) return;
    if (hasNothingToSave) {
      const ignored =
        preview.kind === 'cart' && cartPlan
          ? cartPlan.dbDuplicatesIgnored + cartPlan.intraFileDuplicates
          : preview.kind === 'sap' && sapPlan
            ? sapPlan.dbDuplicatesIgnored + sapPlan.intraFileDuplicates
            : 0;
      showToast(
        `Nenhuma alteração pendente: todas as ${ignored} linhas duplicadas já constam identicamente no banco e foram ignoradas.`,
        'info'
      );
      return;
    }

    setSaving(true);
    setSaveProgress(`Iniciando gravação de ${effectiveSaveCount || preview.rows.length} registros…`);

    try {
      const onProgress = (current: number, total: number) => {
        setSaveProgress(`Gravando ${current} de ${total}…`);
      };

      const finalizeAfterSave = async (successMsg: string, nextTab: TabId) => {
        const refreshed = await refreshData();
        setPreview(null);
        if (refreshed === false) {
          showToast(
            `${successMsg} Porém não foi possível recarregar os dados na tela agora — clique em "Recarregar dados" no aviso acima.`,
            'warn'
          );
          return;
        }
        showToast(successMsg, 'success');
        setActiveTab(nextTab);
      };

      if (preview.kind === 'hh') {
        await batchImportHH(preview.rows, pidx, onProgress, `planilha (${preview.fileName})`);
        const maxDate = preview.rows.reduce((acc: string, r: any) => (r.D > acc ? r.D : acc), '');
        if (maxDate) {
          setFilter('fDate', maxDate);
        }
        await finalizeAfterSave('Apontamentos de HH importados com sucesso!', 'dia');
      } else if (preview.kind === 'cart') {
        const plan = cartPlan;
        const rowsToWrite = plan ? plan.rowsToImport : preview.rows;
        if (substituirCarteira) {
          await resetCarteiraEmbarques();
          await batchImportCarteira(rowsToWrite, pidx, onProgress, `planilha (${preview.fileName})`, {
            skipPrune: true
          });
        } else {
          await batchImportCarteira(rowsToWrite, pidx, onProgress, `planilha (${preview.fileName})`, {
            pruneEmbarqueIds: plan?.affectedPruneEmbarqueIds || [],
            pruneKeepOps: plan?.pruneKeepOps || [],
            skipPrune: !plan || plan.affectedPruneEmbarqueIds.length === 0
          });
        }
        const ignoredTotal = plan ? plan.dbDuplicatesIgnored + plan.intraFileDuplicates : 0;
        const pruneInfo = !substituirCarteira && plan && plan.staleOpsToPruneCount > 0
          ? `, ${plan.staleOpsToPruneCount} operação(ões) obsoleta(s) removida(s)`
          : '';
        await finalizeAfterSave(
          substituirCarteira
            ? `Carteira anterior substituída e ${rowsToWrite.length} linha(s) importada(s) com sucesso!`
            : `Carteira sincronizada: ${plan?.newCount ?? rowsToWrite.length} nova(s), ${plan?.updatedCount ?? 0} atualizada(s), ${ignoredTotal} duplicata(s) ignorada(s)${pruneInfo}.`,
          'emb'
        );
      } else if (preview.kind === 'plat') {
        await batchImportPlataformas(preview.rows, onProgress);
        await finalizeAfterSave('Catálogo de plataformas atualizado com sucesso!', 'pes');
      } else if (preview.kind === 'pes') {
        await batchImportPessoas(preview.rows, onProgress);
        await finalizeAfterSave('Cadastro de pessoas atualizado com sucesso!', 'pes');
      } else if (preview.kind === 'sap') {
        const plan = sapPlan;
        const rowsToWrite = plan ? plan.rowsToImport : preview.rows;
        await batchImportConfirmacoesSAP(rowsToWrite, onProgress);
        const ignoredTotal = plan ? plan.dbDuplicatesIgnored + plan.intraFileDuplicates : 0;
        await finalizeAfterSave(
          `SAP sincronizado e reconciliado: ${plan?.newCount ?? rowsToWrite.length} nova(s), ${plan?.updatedCount ?? 0} atualizada(s), ${ignoredTotal} duplicata(s) ignorada(s).`,
          'us'
        );
      }
    } catch (err: any) {
      showToast(err?.message || 'Erro ao gravar registros no banco de dados.', 'error');
    } finally {
      setSaving(false);
      setSaveProgress('');
    }
  };

  if (!isGlobal) {
    return (
      <div className="card note note-bad" style={{ margin: '20px 0' }}>
        <strong>Área Restrita:</strong> A importação de dados e cargas de planilhas é restrita aos Administradores e Gestores do contrato.
      </div>
    );
  }

  const fx = dataset.latestFluxo;
  const wm = dataset.watermark;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Input de arquivo invisível reutilizável */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={e => {
          if (e.target.files && e.target.files[0]) {
            handleFileSelected(e.target.files[0], currentUploadKindRef.current);
          }
        }}
      />

      {/* Card: Status da Última Importação */}
      <div className="card stack" style={{ gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Última importação</h2>
        <p className="sub" style={{ margin: 0 }}>
          Os dados importados são validados, normalizados e sincronizados instantaneamente no Supabase PostgreSQL via RLS multi-escopo.
        </p>

        <div className="facts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>Última leitura</span>
            <b style={{ display: 'block', fontSize: '1.05rem', marginTop: '2px' }}>
              {fx?.criado_em
                ? `${formatBr(fx.criado_em.slice(0, 10))} ${fx.criado_em.slice(11, 16)}`
                : wm.ultima_importacao_em
                ? `${formatBr(wm.ultima_importacao_em.slice(0, 10))} ${wm.ultima_importacao_em.slice(11, 16)}`
                : '—'}
            </b>
          </div>

          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>Origem</span>
            <b style={{ display: 'block', fontSize: '1.05rem', marginTop: '2px' }}>
              {fx?.origem || '—'}
            </b>
          </div>

          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>Linhas gravadas</span>
            <b style={{ display: 'block', fontSize: '1.05rem', marginTop: '2px' }}>
              {fx?.total_linhas != null ? fx.total_linhas : '—'}
            </b>
          </div>

          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>Dados de HH recebidos até</span>
            <b style={{ display: 'block', fontSize: '1.05rem', marginTop: '2px', color: 'var(--blue)' }}>
              {formatBr(wm.ultima_data_hh || fx?.data_maxima)}
            </b>
          </div>
        </div>

        {fx?.observacao && (
          <div className="sub" style={{ fontStyle: 'italic', color: 'var(--ink-secondary)' }}>
            Observação: {fx.observacao}
          </div>
        )}
      </div>

      {/* Grid Principal: 4 Cards de Upload em Grid Equilibrado 2×2 (>= 860px) */}
      <style>{`
        .import-upload-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 860px) {
          .import-upload-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      `}</style>
      <div className="import-upload-grid">
        {/* Card 1: HH Executado */}
        <div className="card stack" style={{ gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>1. HH executado do dia</h2>
          <p className="sub" style={{ margin: 0, fontSize: '0.86rem' }}>
            Uma linha por técnico por dia trabalhado. Colunas: Data, Matrícula, Nome, Plataforma e HH executado. O HH disponível ({formatHours(dataset.config.hh_dia)}) é calculado automaticamente.
          </p>

          <div
            className={`dropzone ${dragActiveKind === 'hh' ? 'on' : ''}`}
            tabIndex={0}
            role="button"
            onClick={() => handleTriggerFileInput('hh')}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTriggerFileInput('hh');
              }
            }}
            onDragOver={e => {
              e.preventDefault();
              setDragActiveKind('hh');
            }}
            onDragLeave={() => setDragActiveKind(null)}
            onDrop={e => handleDrop(e, 'hh')}
            style={{
              padding: '24px 16px',
              border: '2px dashed var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragActiveKind === 'hh' ? 'var(--blue-soft)' : 'var(--surface-alt)',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--blue)', marginBottom: '4px' }}>
              Arraste a planilha de HH executado aqui
            </div>
            <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>
              ou clique para escolher arquivo (.xlsx, .xls ou .csv)
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => handleExportModelo('hh')}
            >
              Baixar modelo de HH
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setOpenManualHH(true)}
            >
              Lançar um dia à mão
            </button>
          </div>
        </div>

        {/* Card 2: Carteira / Programação */}
        <div className="card stack" style={{ gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>2. Programação de embarque (Portal Offshore)</h2>
          <p className="sub" style={{ margin: 0, fontSize: '0.86rem' }}>
            Quem embarca, onde, quando e quantas horas estão programadas. Colunas: Matrícula, Nome, Função, Plataforma, Embarque, Desembarque e HP; Operação, PE e EX são opcionais.
          </p>

          <div
            className={`dropzone ${dragActiveKind === 'cart' ? 'on' : ''}`}
            tabIndex={0}
            role="button"
            onClick={() => handleTriggerFileInput('cart')}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTriggerFileInput('cart');
              }
            }}
            onDragOver={e => {
              e.preventDefault();
              setDragActiveKind('cart');
            }}
            onDragLeave={() => setDragActiveKind(null)}
            onDrop={e => handleDrop(e, 'cart')}
            style={{
              padding: '24px 16px',
              border: '2px dashed var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragActiveKind === 'cart' ? 'var(--blue-soft)' : 'var(--surface-alt)',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--blue)', marginBottom: '4px' }}>
              Arraste a planilha de Carteira aqui
            </div>
            <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>
              ou clique para escolher arquivo (.xlsx, .xls ou .csv)
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => handleExportModelo('cart')}
            >
              Baixar modelo da carteira
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setOpenManualCart(true)}
            >
              Cadastrar embarque à mão
            </button>
          </div>
        </div>

        {/* Card 3: Catálogo de Plataformas */}
        <div className="card stack" style={{ gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>3. Catálogo de plataformas e unidades</h2>
          <p className="sub" style={{ margin: 0, fontSize: '0.86rem' }}>
            Unidades offshore contratadas, armadores e gerências Petrobras. Colunas: Sigla, Nome, Unidade de negócio, Armador e Tipo de unidade.
          </p>

          <div
            className={`dropzone ${dragActiveKind === 'plat' ? 'on' : ''}`}
            tabIndex={0}
            role="button"
            onClick={() => handleTriggerFileInput('plat')}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTriggerFileInput('plat');
              }
            }}
            onDragOver={e => {
              e.preventDefault();
              setDragActiveKind('plat');
            }}
            onDragLeave={() => setDragActiveKind(null)}
            onDrop={e => handleDrop(e, 'plat')}
            style={{
              padding: '24px 16px',
              border: '2px dashed var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragActiveKind === 'plat' ? 'var(--blue-soft)' : 'var(--surface-alt)',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--blue)', marginBottom: '4px' }}>
              Arraste a planilha de Plataformas aqui
            </div>
            <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>
              ou clique para escolher arquivo (.xlsx, .xls ou .csv)
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => handleExportModelo('cad')}
            >
              Baixar modelo cadastral (.xlsx)
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setActiveTab('pes')}
            >
              Ver catálogo atual
            </button>
          </div>
        </div>

        {/* Card 4: Pessoas e Carteiras de Responsabilidade */}
        <div className="card stack" style={{ gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>4. Pessoas e carteiras de responsabilidade</h2>
          <p className="sub" style={{ margin: 0, fontSize: '0.86rem' }}>
            Diretório de Prepostos, Controladores e Gestores e plataformas vinculadas. Colunas: Nome, Papel, E-mail, Plataformas e Unidades.
          </p>

          <div
            className={`dropzone ${dragActiveKind === 'pes' ? 'on' : ''}`}
            tabIndex={0}
            role="button"
            onClick={() => handleTriggerFileInput('pes')}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTriggerFileInput('pes');
              }
            }}
            onDragOver={e => {
              e.preventDefault();
              setDragActiveKind('pes');
            }}
            onDragLeave={() => setDragActiveKind(null)}
            onDrop={e => handleDrop(e, 'pes')}
            style={{
              padding: '24px 16px',
              border: '2px dashed var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragActiveKind === 'pes' ? 'var(--blue-soft)' : 'var(--surface-alt)',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--blue)', marginBottom: '4px' }}>
              Arraste a planilha de Pessoas aqui
            </div>
            <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>
              ou clique para escolher arquivo (.xlsx, .xls ou .csv)
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => handleExportModelo('cad')}
            >
              Baixar modelo cadastral (.xlsx)
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setActiveTab('pes')}
            >
              Ver diretório de pessoas
            </button>
          </div>
        </div>

        {/* Card 5: Confirmações do SAP */}
        <div className="card stack" style={{ gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>5. Confirmações e apontamentos do SAP</h2>
          <p className="sub" style={{ margin: 0, fontSize: '0.86rem' }}>
            Extrato de ordens e operações confirmadas no SAP. Reconciliação com embarque físico (+4 dias de tolerância do PMB e estornos retroativos).
          </p>

          <div
            className={`dropzone ${dragActiveKind === 'sap' ? 'on' : ''}`}
            tabIndex={0}
            role="button"
            onClick={() => handleTriggerFileInput('sap')}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTriggerFileInput('sap');
              }
            }}
            onDragOver={e => {
              e.preventDefault();
              setDragActiveKind('sap');
            }}
            onDragLeave={() => setDragActiveKind(null)}
            onDrop={e => handleDrop(e, 'sap')}
            style={{
              padding: '24px 16px',
              border: '2px dashed var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragActiveKind === 'sap' ? 'var(--blue-soft)' : 'var(--surface-alt)',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--blue)', marginBottom: '4px' }}>
              Arraste a planilha de Confirmações do SAP aqui
            </div>
            <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>
              ou clique para escolher arquivo (.xlsx, .xls ou .csv)
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => handleExportModelo('sap')}
            >
              Baixar modelo SAP (.xlsx)
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setActiveTab('us')}
            >
              Ver confronto SAP vs Portal
            </button>
          </div>
        </div>
      </div>

      {/* Painel Interativo de Revisão e Remapeamento de Colunas */}
      {parsing && (
        <div className="card note note-info" style={{ textAlign: 'center', padding: '24px' }}>
          <strong>Lendo e interpretando arquivo…</strong>
        </div>
      )}

      {preview && (
        <div ref={previewRef} className="card stack" style={{ gap: '16px', border: '2px solid var(--blue)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--blue)' }}>
                Revisão: {preview.fileName} ({preview.sheetName})
              </h2>
              <p className="sub" style={{ margin: '4px 0 0' }}>
                Confira o mapeamento de colunas e clique em "Gravar no Banco de Dados" para sincronizar.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '0.88rem', fontWeight: 600 }}>Tipo de dado:</label>
                <select
                  id="pTipo"
                  value={preview.kind}
                  onChange={e => handleKindChange(e.target.value as ImportKind)}
                  style={{ padding: '6px 12px', fontWeight: 600 }}
                >
                  <option value="hh">HH executado do dia</option>
                  <option value="cart">Carteira de embarque</option>
                  <option value="plat">Plataformas</option>
                  <option value="pes">Pessoas e responsabilidades</option>
                  <option value="sap">Confirmações do SAP</option>
                </select>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSavePreview}
                disabled={saving || hasNothingToSave}
                style={{ fontWeight: 700 }}
              >
                {saving
                  ? 'Gravando…'
                  : hasNothingToSave && preview.rows.length > 0
                    ? 'Tudo já sincronizado (0 pendentes)'
                    : (preview.kind === 'cart' || preview.kind === 'sap') && !substituirCarteira
                      ? effectiveSaveCount === 0 && cartPlan && cartPlan.staleOpsToPruneCount > 0
                        ? `Limpar ${cartPlan.staleOpsToPruneCount} registro(s) obsoleto(s)`
                        : `Gravar ${effectiveSaveCount} alterações no Banco`
                      : `Gravar ${effectiveSaveCount} linhas no Banco`}
              </button>
            </div>
          </div>

          {preview.kind === 'cart' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'var(--surface-alt, #f8fafc)', borderRadius: '6px', border: '1px solid var(--border-subtle, #e2e8f0)' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', cursor: 'pointer', userSelect: 'none', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={substituirCarteira}
                  onChange={e => setSubstituirCarteira(e.target.checked)}
                  style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                />
                <span>Substituir toda a carteira existente (opcional — no modo padrão, duplicatas são ignoradas e embarques alterados atualizam sem empilhar)</span>
              </label>
            </div>
          )}

          {((preview.kind === 'cart' && cartPlan) || (preview.kind === 'sap' && sapPlan)) && preview.rows.length > 0 && (
            <div
              className={`note ${hasNothingToSave ? 'note-ok' : 'note-info'}`}
              style={{ margin: 0, fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: '4px' }}
            >
              <div>
                <strong>Deduplicação inteligente ativa:</strong>{' '}
                {preview.kind === 'cart' && cartPlan ? (
                  <>
                    <b>{cartPlan.newCount}</b> nova(s) ·{' '}
                    <b>{cartPlan.updatedCount}</b> atualizada(s) ·{' '}
                    <b>{cartPlan.dbDuplicatesIgnored}</b> já idêntica(s) no banco (ignoradas)
                    {cartPlan.intraFileDuplicates > 0 && (
                      <>
                        {' · '}
                        <b>{cartPlan.intraFileDuplicates}</b> repetida(s) na planilha (ignoradas)
                      </>
                    )}
                    {!substituirCarteira && cartPlan.staleOpsToPruneCount > 0 && (
                      <>
                        {' · '}
                        <b>{cartPlan.staleOpsToPruneCount}</b> antiga(s) de embarques alterados (serão substituídas sem empilhar)
                      </>
                    )}
                    {loadingSnapshot && ' · Verificando histórico completo da base…'}
                  </>
                ) : sapPlan ? (
                  <>
                    <b>{sapPlan.newCount}</b> nova(s) ·{' '}
                    <b>{sapPlan.updatedCount}</b> atualizada(s) (incluindo estornos/horas alteradas) ·{' '}
                    <b>{sapPlan.dbDuplicatesIgnored}</b> já idêntica(s) no banco (ignoradas)
                    {sapPlan.intraFileDuplicates > 0 && (
                      <>
                        {' · '}
                        <b>{sapPlan.intraFileDuplicates}</b> repetida(s) na planilha (ignoradas)
                      </>
                    )}
                    {loadingSnapshot && ' · Verificando histórico completo da base…'}
                  </>
                ) : null}
              </div>
              {hasNothingToSave && (
                <div>
                  Nenhuma linha nova ou alterada encontrada: o sistema ignorará todas as duplicatas para não empilhar nem regravar a base sem necessidade.
                </div>
              )}
            </div>
          )}

          {preview.rows.length === 0 && (
            <div className="card note note-bad" style={{ margin: 0, padding: '12px 16px' }}>
              <strong>⚠️ Nenhuma linha válida pôde ser lida com o tipo "{preview.kind === 'hh' ? 'HH executado do dia' : preview.kind === 'cart' ? 'Carteira de embarque' : preview.kind === 'sap' ? 'Confirmações do SAP' : preview.kind}"!</strong>
              <p style={{ margin: '4px 0 0', fontSize: '0.88rem' }}>
                Se esta planilha é uma Carteira do Portal Offshore ou Confirmações do SAP, selecione a opção correta no campo <b>"Tipo de dado"</b> acima para recarregar as colunas automaticamente.
              </p>
            </div>
          )}

          {/* Seletores de Colunas */}
          <div
            className="form"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              gap: '12px',
              background: 'var(--surface-alt)',
              padding: '14px',
              borderRadius: 'var(--radius-md)'
            }}
          >
            {IMPORT_COLUMNS_DEF[preview.kind]?.map(colDef => (
              <label key={colDef.key} className="fld">
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{colDef.label}</span>
                <select
                  value={preview.colMap[colDef.key] ?? ''}
                  onChange={e => handleColMapChange(colDef.key, e.target.value)}
                >
                  <option value="">(não usar)</option>
                  {preview.headers.map((hdr, hIdx) => (
                    <option key={hIdx} value={hIdx}>
                      {hdr ? `${hdr} (col ${hIdx + 1})` : `Coluna ${hIdx + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {/* Resumo de Linhas e Erros */}
          <div className="note note-info" style={{ margin: 0, fontSize: '0.9rem' }}>
            <strong>{preview.rows.length} linha{preview.rows.length === 1 ? '' : 's'}</strong> pronta{preview.rows.length === 1 ? '' : 's'} para salvar
            {preview.kind === 'hh' && preview.rows.length > 0 && (
              <>
                {' · Período: '}
                <b>{formatBr(preview.rows.reduce((min, r) => (r.D < min ? r.D : min), preview.rows[0].D))}</b>
                {' a '}
                <b>{formatBr(preview.rows.reduce((max, r) => (r.D > max ? r.D : max), preview.rows[0].D))}</b>
              </>
            )}
            {preview.errors.length > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--bad)', fontWeight: 600 }}>
                  {preview.errors.length} linha{preview.errors.length === 1 ? '' : 's'} ignorada{preview.errors.length === 1 ? '' : 's'}
                </span>{' '}
                ({preview.errors.slice(0, 3).join('; ')}
                {preview.errors.length > 3 ? '…' : ''})
              </>
            )}
          </div>

          {/* Tabela de Prévia (primeiras 10 linhas) */}
          <div className="table-wrap" style={{ maxHeight: '380px', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="tb" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                {preview.kind === 'hh' && (
                  <tr>
                    <th>Data</th>
                    <th>Matrícula</th>
                    <th>Nome</th>
                    <th>Plataforma</th>
                    <th>Unidade</th>
                    <th style={{ textAlign: 'right' }}>HH executado</th>
                  </tr>
                )}
                {preview.kind === 'cart' && (
                  <tr>
                    <th>ID Embarque</th>
                    <th>Matrícula</th>
                    <th>Nome</th>
                    <th>Plataforma</th>
                    <th>Unidade</th>
                    <th>Embarque</th>
                    <th>Desembarque</th>
                    <th style={{ textAlign: 'center' }}>Dias</th>
                    <th style={{ textAlign: 'right' }}>Horas programadas</th>
                    <th>Operação</th>
                  </tr>
                )}
                {preview.kind === 'plat' && (
                  <tr>
                    <th>Sigla</th>
                    <th>Nome</th>
                    <th>Unidade</th>
                    <th>Armador</th>
                    <th>Tipo</th>
                    <th>Status</th>
                  </tr>
                )}
                {preview.kind === 'pes' && (
                  <tr>
                    <th>Nome</th>
                    <th>Papel</th>
                    <th>E-mail</th>
                    <th>Plataformas</th>
                    <th>Unidades</th>
                  </tr>
                )}
                {preview.kind === 'sap' && (
                  <tr>
                    <th>Matrícula</th>
                    <th>Criação</th>
                    <th>Lançamento</th>
                    <th>Fim Real</th>
                    <th>Ordem</th>
                    <th>Operação</th>
                    <th>Contador</th>
                    <th style={{ textAlign: 'right' }}>Horas confirmadas</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {preview.rows.slice(0, 10).map((r, rIdx) => {
                  if (preview.kind === 'hh') {
                    return (
                      <tr key={rIdx}>
                        <td>{formatBr(r.D)}</td>
                        <td style={{ fontWeight: 600 }}>{r.mat}</td>
                        <td>{r.nome}</td>
                        <td>{r.p}</td>
                        <td>{r.r || '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatHours(r.e)}</td>
                      </tr>
                    );
                  }
                  if (preview.kind === 'cart') {
                    const dias = r.ini && r.fim ? diffDays(r.ini, r.fim) + 1 : '—';
                    return (
                      <tr key={rIdx}>
                        <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{r.id_embarque || '—'}</td>
                        <td style={{ fontWeight: 600 }}>{r.mat}</td>
                        <td>{r.nome}</td>
                        <td>{r.plat}</td>
                        <td>{r.reg || '—'}</td>
                        <td>{formatBr(r.ini)}</td>
                        <td>{formatBr(r.fim)}</td>
                        <td style={{ textAlign: 'center' }}>{dias}</td>
                        <td style={{ textAlign: 'right' }}>
                          {r.hp != null ? formatHours(r.hp) : `dias × ${formatHours(dataset.config.hh_dia)}`}
                        </td>
                        <td>{r.op || '—'}</td>
                      </tr>
                    );
                  }
                  if (preview.kind === 'plat') {
                    return (
                      <tr key={rIdx}>
                        <td style={{ fontWeight: 700 }}>{r.sigla}</td>
                        <td>{r.nome}</td>
                        <td>{r.un || '—'}</td>
                        <td>{r.armador || '—'}</td>
                        <td>{r.tipo || '—'}</td>
                        <td>{dataset.plataformas[r.sigla] ? 'Atualiza existente' : 'Nova plataforma'}</td>
                      </tr>
                    );
                  }
                  if (preview.kind === 'pes') {
                    return (
                      <tr key={rIdx}>
                        <td style={{ fontWeight: 600 }}>{r.nome}</td>
                        <td>{r.papel}</td>
                        <td>{r.email || '—'}</td>
                        <td>{Array.isArray(r.plats) ? r.plats.join(', ') : '—'}</td>
                        <td>{Array.isArray(r.uns) ? r.uns.join(', ') : '—'}</td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={rIdx}>
                      <td style={{ fontWeight: 600 }}>{r.mat}</td>
                      <td>{formatBr(r.cria)}</td>
                      <td>{formatBr(r.lanc)}</td>
                      <td>{formatBr(r.real)}</td>
                      <td style={{ fontWeight: 600 }}>{r.ordem}</td>
                      <td>{r.op || '—'}</td>
                      <td>{r.contador != null && r.contador !== 0 ? r.contador : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatHours(r.hc)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.rows.length > 10 && (
            <div className="sub" style={{ fontSize: '0.85rem' }}>
              Exibindo as primeiras 10 de {preview.rows.length} linhas.
            </div>
          )}

          {/* Ações da Prévia */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSavePreview}
              disabled={saving || hasNothingToSave}
            >
              {saving
                ? 'Gravando…'
                : hasNothingToSave && preview.rows.length > 0
                  ? 'Tudo já sincronizado'
                  : (preview.kind === 'cart' || preview.kind === 'sap') && !substituirCarteira
                    ? effectiveSaveCount === 0 && cartPlan && cartPlan.staleOpsToPruneCount > 0
                      ? `Limpar ${cartPlan.staleOpsToPruneCount} obsoletas`
                      : `Salvar ${effectiveSaveCount} alterações`
                    : `Salvar ${effectiveSaveCount} linhas`}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPreview(null)}
              disabled={saving}
            >
              Cancelar
            </button>
            {saveProgress && (
              <span style={{ fontSize: '0.88rem', color: 'var(--blue)', fontWeight: 600 }}>
                {saveProgress}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Card: Cópia de Contingência (Snapshot JSON) */}
      <div className="card stack" style={{ gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Cópia de contingência (Snapshot JSON)</h2>
        <p className="sub" style={{ margin: 0 }}>
          Baixe um snapshot completo dos dados da janela de medição atual para backup local, inspeção técnica ou contingência operacional.
        </p>

        <div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => exportJsonSnapshot(dataset)}
          >
            Baixar snapshot JSON dos dados atuais
          </button>
        </div>
      </div>

      {/* Modais de Lançamento Manual */}
      <ManualHHModal
        open={openManualHH}
        onClose={() => setOpenManualHH(false)}
      />

      <ManualCartModal
        open={openManualCart}
        onClose={() => setOpenManualCart(false)}
      />
    </div>
  );
};
