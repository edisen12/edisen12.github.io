import React, { useState, useRef } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import {
  batchImportHH,
  batchImportCarteira,
  batchImportPlataformas,
  batchImportPessoas,
  exportJsonSnapshot
} from '../../services/data.service';
import {
  parseSpreadsheetFile,
  rebuildPreviewRows,
  IMPORT_COLUMNS_DEF,
  exportModeloXlsx,
  type ParsedPreviewState
} from '../../services/excel.service';
import { formatBr, diffDays } from '../../utils/date';
import { formatHours } from '../../utils/format';
import type { ImportKind } from '../../domain/types';
import { ManualHHModal, ManualCartModal } from '../modals/ManualEntryModals';

export const ImportarDadosView: React.FC = () => {
  const { dataset, pidx, refreshData, isGlobal, setActiveTab, setFilter } = useApp();
  const { showToast } = useToast();

  const [preview, setPreview] = useState<ParsedPreviewState | null>(null);
  const [parsing, setParsing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveProgress, setSaveProgress] = useState<string>('');

  const [openManualHH, setOpenManualHH] = useState<boolean>(false);
  const [openManualCart, setOpenManualCart] = useState<boolean>(false);

  // Drag over states
  const [dragActiveKind, setDragActiveKind] = useState<ImportKind | null>(null);

  // Hidden file inputs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentUploadKindRef = useRef<ImportKind>('hh');

  const handleTriggerFileInput = (kind: ImportKind) => {
    currentUploadKindRef.current = kind;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = async (file: File, forcedKind?: ImportKind) => {
    setParsing(true);
    setPreview(null);
    try {
      const parsed = await parseSpreadsheetFile(file, forcedKind || currentUploadKindRef.current);
      const built = rebuildPreviewRows(parsed, pidx);
      setPreview(built);
      showToast(`Planilha "${file.name}" processada com sucesso!`, 'info');
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
  };

  const handleSavePreview = async () => {
    if (!preview || preview.rows.length === 0) return;
    setSaving(true);
    setSaveProgress(`Iniciando gravação de ${preview.rows.length} registros…`);

    try {
      const onProgress = (current: number, total: number) => {
        setSaveProgress(`Gravando ${current} de ${total}…`);
      };

      if (preview.kind === 'hh') {
        await batchImportHH(preview.rows, pidx, onProgress, `planilha (${preview.fileName})`);
        const maxDate = preview.rows.reduce((acc: string, r: any) => (r.D > acc ? r.D : acc), '');
        if (maxDate) {
          setFilter('fDate', maxDate);
        }
        await refreshData();
        showToast('Apontamentos de HH importados com sucesso!', 'success');
        setPreview(null);
        setActiveTab('dia');
      } else if (preview.kind === 'cart') {
        await batchImportCarteira(preview.rows, pidx, onProgress);
        await refreshData();
        showToast('Carteira de programação importada com sucesso!', 'success');
        setPreview(null);
        setActiveTab('emb');
      } else if (preview.kind === 'plat') {
        await batchImportPlataformas(preview.rows, onProgress);
        await refreshData();
        showToast('Catálogo de plataformas atualizado com sucesso!', 'success');
        setPreview(null);
        setActiveTab('pes');
      } else if (preview.kind === 'pes') {
        await batchImportPessoas(preview.rows, onProgress);
        await refreshData();
        showToast('Cadastro de pessoas atualizado com sucesso!', 'success');
        setPreview(null);
        setActiveTab('pes');
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
            handleFileSelected(e.target.files[0]);
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
              onClick={() => exportModeloXlsx('hh', dataset)}
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
              onClick={() => exportModeloXlsx('cart', dataset)}
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
              onClick={() => exportModeloXlsx('cad', dataset)}
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
              onClick={() => exportModeloXlsx('cad', dataset)}
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
      </div>

      {/* Painel Interativo de Revisão e Remapeamento de Colunas */}
      {parsing && (
        <div className="card note note-info" style={{ textAlign: 'center', padding: '24px' }}>
          <strong>Lendo e interpretando arquivo…</strong>
        </div>
      )}

      {preview && (
        <div className="card stack" style={{ gap: '16px', border: '2px solid var(--blue)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--blue)' }}>
                Revisão: {preview.fileName} ({preview.sheetName})
              </h2>
              <p className="sub" style={{ margin: '4px 0 0' }}>
                Confira o mapeamento de colunas antes de confirmar a gravação no banco de dados.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
              </select>
            </div>
          </div>

          {/* Seletores de Colunas */}
          <div
            className="form"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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
          <div className="tb" style={{ maxHeight: '380px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                  return (
                    <tr key={rIdx}>
                      <td style={{ fontWeight: 600 }}>{r.nome}</td>
                      <td>{r.papel}</td>
                      <td>{r.email || '—'}</td>
                      <td>{Array.isArray(r.plats) ? r.plats.join(', ') : '—'}</td>
                      <td>{Array.isArray(r.uns) ? r.uns.join(', ') : '—'}</td>
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
              disabled={saving || preview.rows.length === 0}
            >
              {saving ? 'Gravando…' : `Salvar ${preview.rows.length} linhas`}
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
