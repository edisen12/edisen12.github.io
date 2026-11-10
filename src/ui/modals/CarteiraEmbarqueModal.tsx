import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { Modal } from '../components/Modal';
import { StatusPill } from '../components/StatusPill';
import {
  findCarteira,
  inferEmbarkation,
  mergeConfrontoOperations,
  resolveLocation,
  resolveTechName
} from '../../domain/calculations';
import type { CarteiraOperacao, ConfirmacaoSAP } from '../../domain/types';
import { addDays, diffDays, formatBr, formatBrShort } from '../../utils/date';
import { formatHours, formatSignedHours } from '../../utils/format';
import { Download, Search, CheckCircle2, AlertTriangle, Info, FileSpreadsheet, ExternalLink } from 'lucide-react';

export function CarteiraEmbarqueModal() {
  const {
    carteiraModal,
    closeCarteiraModal,
    dataset,
    pidx,
    activePeriod,
    openFichaDrawer
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'carteira' | 'fora' | 'nao_cadastrado' | 'divergentes'>('todos');
  const [isExporting, setIsExporting] = useState(false);

  const mat = carteiraModal?.matricula || '';
  const idEmbarqueParam = carteiraModal?.idEmbarque || '';
  const dataRef = carteiraModal?.dataRef || '';

  // Localiza o embarque correspondente em dataset.carteira
  const embarque = useMemo(() => {
    if (!mat && !idEmbarqueParam) return null;

    if (idEmbarqueParam) {
      const found = dataset.carteira.find(
        c => (c.id_embarque === idEmbarqueParam || c.id === idEmbarqueParam) &&
             (!mat || c.matricula === mat)
      );
      if (found) return found;
    }

    if (dataRef && mat) {
      const found = findCarteira(dataset.carteira, mat, dataRef);
      if (found) return found;
      const inf = inferEmbarkation(mat, dataRef, dataset);
      if (inf) {
        const matching = dataset.carteira.find(
          c => c.matricula === mat && c.data_inicio === inf.ini && c.data_fim === inf.fim
        );
        if (matching) return matching;
      }
    }

    if (mat) {
      const tecEmbs = dataset.carteira.filter(c => c.matricula === mat);
      if (tecEmbs.length > 0) {
        // Tenta embarque dentro do período ativo
        const inPeriod = tecEmbs.find(
          c => c.data_inicio <= activePeriod.fim && c.data_fim >= activePeriod.ini
        );
        return inPeriod || tecEmbs[0];
      }
    }

    return null;
  }, [mat, idEmbarqueParam, dataRef, dataset.carteira, dataset, activePeriod]);

  // Metadados do embarque
  const idEmbFinal = embarque?.id_embarque || idEmbarqueParam || '';
  const tecMat = mat || embarque?.matricula || '';
  const tecNome = resolveTechName(tecMat, dataset);
  const tecFuncao = dataset.tecnicos[tecMat]?.funcao || embarque?.funcao || 'Técnico Offshore';
  const dataInicio = embarque?.data_inicio || '';
  const dataFim = embarque?.data_fim || '';
  const diasEmbarque = dataInicio && dataFim ? diffDays(dataInicio, dataFim) + 1 : 0;
  const platSigla = embarque?.plataforma_sigla || '';
  const loc = resolveLocation(tecMat, dataInicio || activePeriod.ini, dataset, pidx);
  const platNome = pidx[platSigla]?.nome || platSigla;
  const unidade = embarque?.unidade_negocio || loc.r || 'UN Não Informada';

  // Consolidação de operações do Portal Offshore e confirmações do SAP
  const { operacoes, summary } = useMemo(() => {
    if (!tecMat) {
      return { operacoes: [], summary: null };
    }

    // 1. Filtra operações da carteira_operacoes pertencentes a este técnico e embarque
    const opsDoEmbarque = (dataset.carteiraOperacoes || []).filter(op => {
      if (op.matricula !== tecMat) return false;
      if (idEmbFinal && (op.id_embarque === idEmbFinal || op.portal_id === idEmbFinal)) return true;
      if (dataInicio && dataFim) {
        return op.data_inicio >= dataInicio && op.data_fim <= dataFim;
      }
      return true;
    });

    // 2. Filtra confirmações SAP deste técnico vinculadas ao embarque ou na janela de datas
    const sapDoEmbarque = (dataset.confirmacoesSap || []).filter(cs => {
      if (cs.matricula !== tecMat) return false;
      if (idEmbFinal && cs.id_embarque === idEmbFinal) return true;
      if (dataInicio && dataFim) {
        const d = cs.data_fim_real || cs.data_lancamento;
        return d >= dataInicio && d <= addDays(dataFim, 4);
      }
      return false;
    });

    // 3. Cruzamento integrado
    const merged = mergeConfrontoOperations(
      opsDoEmbarque,
      sapDoEmbarque,
      embarque ? [embarque] : [],
      dataset.tecnicos || {}
    );

    let totHp = 0;
    let totHpCarteira = 0;
    let totHpFora = 0;
    let totPortal = 0;
    let totSap = 0;
    let okCount = 0;
    let divCount = 0;
    let naoCadastradoCount = 0;
    let naoApontadoSapCount = 0;

    merged.forEach(o => {
      totHp += o.hh_programado || 0;
      if (o.status_programacao === 'Carteira') {
        totHpCarteira += o.hh_programado || 0;
      } else if (o.status_programacao === 'Fora da carteira') {
        totHpFora += o.hh_programado || 0;
      }
      totPortal += o.hh_confirmado || 0;
      totSap += o.hh_confirmado_sap || 0;

      if (o.status_divergencia === 'OK') okCount++;
      else if (o.status_divergencia === 'Não Cadastrado no Portal') naoCadastradoCount++;
      else if (o.status_divergencia === 'Não Apontado no SAP') naoApontadoSapCount++;
      else divCount++;
    });

    const saldoDiv = Math.round((totPortal - totSap) * 100) / 100;

    return {
      operacoes: merged,
      summary: {
        totHp: Math.round(totHp * 10) / 10,
        totHpCarteira: Math.round(totHpCarteira * 10) / 10,
        totHpFora: Math.round(totHpFora * 10) / 10,
        totPortal: Math.round(totPortal * 10) / 10,
        totSap: Math.round(totSap * 10) / 10,
        saldoDiv,
        okCount,
        divCount,
        naoCadastradoCount,
        naoApontadoSapCount,
        totalOps: merged.length
      }
    };
  }, [tecMat, idEmbFinal, dataInicio, dataFim, dataset.carteiraOperacoes, dataset.confirmacoesSap, embarque, dataset.tecnicos]);

  // Filtragem e busca nas operações
  const filteredOperacoes = useMemo(() => {
    return operacoes.filter(op => {
      // Filtro por busca textual (ordem ou operação)
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const matchesOrdem = op.ordem.toLowerCase().includes(q);
        const matchesOperacao = op.operacao.toLowerCase().includes(q);
        const matchesStatus = (op.status_programacao || '').toLowerCase().includes(q);
        if (!matchesOrdem && !matchesOperacao && !matchesStatus) {
          return false;
        }
      }

      // Filtro por status
      if (statusFilter === 'carteira') {
        return op.status_programacao === 'Carteira';
      }
      if (statusFilter === 'fora') {
        return op.status_programacao === 'Fora da carteira';
      }
      if (statusFilter === 'nao_cadastrado') {
        return op.status_programacao === 'Não Cadastrado no Portal';
      }
      if (statusFilter === 'divergentes') {
        return op.status_divergencia !== 'OK' && op.status_divergencia !== 'Não Confirmado';
      }

      return true;
    });
  }, [operacoes, searchTerm, statusFilter]);

  // Exportação rápida da carteira do embarque para Excel
  const handleExportCarteiraXlsx = async () => {
    setIsExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      const headers = [
        'ID Embarque',
        'Matrícula',
        'Técnico',
        'Plataforma',
        'Unidade de Negócio',
        'Ordem',
        'Operação',
        'Classificação Programação',
        'HH Programado',
        'HC Portal Offshore',
        'HH Confirmado SAP',
        'Divergência (Portal - SAP)',
        'Status do Confronto',
        'Início',
        'Fim'
      ];

      const rows = filteredOperacoes.map(op => [
        op.id_embarque || op.portal_id || idEmbFinal,
        op.matricula,
        tecNome,
        op.plataforma_sigla || platSigla,
        op.unidade_negocio || unidade,
        op.ordem,
        op.operacao,
        op.status_programacao,
        op.hh_programado || 0,
        op.hh_confirmado || 0,
        op.hh_confirmado_sap || 0,
        op.divergencia_sap || 0,
        op.status_divergencia || 'Pendente',
        op.data_inicio ? formatBr(op.data_inicio) : '',
        op.data_fim ? formatBr(op.data_fim) : ''
      ]);

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      XLSX.utils.book_append_sheet(wb, ws, 'Carteira Embarque');

      const fileMat = tecMat || 'tecnico';
      const fileId = idEmbFinal ? `_ID_${idEmbFinal}` : '';
      XLSX.writeFile(wb, `Carteira_Embarque_${fileMat}${fileId}.xlsx`);
    } catch (err) {
      console.error('Falha ao exportar carteira:', err);
    } finally {
      setIsExporting(false);
    }
  };

  if (!carteiraModal) return null;

  return (
    <Modal
      open={Boolean(carteiraModal)}
      onClose={closeCarteiraModal}
      maxWidth="1020px"
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>Carteira do Embarque</span>
          {idEmbFinal && (
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '0.88rem',
                fontWeight: 700,
                background: 'var(--brand-primary, #0ea5e9)',
                color: '#fff',
                padding: '2px 8px',
                borderRadius: '6px'
              }}
            >
              ID {idEmbFinal}
            </span>
          )}
        </div>
      }
      subtitle={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
          <b style={{ color: 'var(--ink)' }}>{tecNome}</b>
          <span style={{ color: 'var(--ink-muted)' }}>· Mat. {tecMat}</span>
          <span style={{ color: 'var(--ink-muted)' }}>· {tecFuncao}</span>
          <span style={{ color: 'var(--ink-muted)' }}>·</span>
          <span style={{ fontWeight: 600, color: 'var(--blue)' }}>{platSigla ? `${platSigla} (${platNome})` : 'Plataforma não informada'}</span>
          <span style={{ color: 'var(--ink-muted)' }}>· {unidade}</span>
        </div>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExportCarteiraXlsx}
              disabled={isExporting || filteredOperacoes.length === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <FileSpreadsheet size={15} />
              <span>{isExporting ? 'Exportando...' : 'Exportar Carteira (.xlsx)'}</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                closeCarteiraModal();
                openFichaDrawer(tecMat);
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <ExternalLink size={14} />
              <span>Ver Ficha Completa do Técnico</span>
            </button>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={closeCarteiraModal}>
            Fechar
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Card Resumo do Embarque */}
        <div
          style={{
            background: 'var(--surface-alt, #f8fafc)',
            border: '1px solid var(--line, #e2e8f0)',
            borderRadius: 'var(--radius-md, 8px)',
            padding: '14px 18px'
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
            <div>
              <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
                Período do Embarque
              </span>
              <b style={{ fontSize: '1rem', color: 'var(--ink)' }}>
                {dataInicio && dataFim ? `${formatBrShort(dataInicio)} a ${formatBrShort(dataFim)}` : 'Não definido'}
              </b>
              <span className="sub" style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', marginTop: '2px' }}>
                {diasEmbarque > 0 ? `${diasEmbarque} dias embarcado` : 'Sem datas'}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
                HH Programado Total
              </span>
              <b style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>
                {formatHours(summary?.totHp || 0)}
              </b>
              <span className="sub" style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', marginTop: '2px' }}>
                Carteira: <b>{formatHours(summary?.totHpCarteira || 0)}</b> · Fora: <b>{formatHours(summary?.totHpFora || 0)}</b>
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
                HC Portal Offshore
              </span>
              <b style={{ fontSize: '1.1rem', color: 'var(--blue, #0284c7)' }}>
                {formatHours(summary?.totPortal || 0)}
              </b>
              <span className="sub" style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', marginTop: '2px' }}>
                Confirmado na planilha
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
                HH Confirmado SAP
              </span>
              <b style={{ fontSize: '1.1rem', color: 'var(--ok, #16a34a)' }}>
                {formatHours(summary?.totSap || 0)}
              </b>
              <span className="sub" style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', marginTop: '2px' }}>
                Extrato SAP reconciliado
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
                Confronto Portal vs SAP
              </span>
              <b
                style={{
                  fontSize: '1.1rem',
                  color: summary?.saldoDiv === 0 ? 'var(--ok, #16a34a)' : (summary?.saldoDiv && summary.saldoDiv > 0 ? 'var(--orange-dark, #c2410c)' : 'var(--blue, #0284c7)')
                }}
              >
                {summary ? (summary.saldoDiv === 0 ? '0h (100% OK)' : formatSignedHours(summary.saldoDiv)) : '—'}
              </b>
              <span className="sub" style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', marginTop: '2px' }}>
                {summary?.okCount || 0} OK · {summary?.divCount || 0} div · {summary?.naoCadastradoCount || 0} fora
              </span>
            </div>
          </div>
        </div>

        {/* Notificação/Alerta explicativo quando houver divergências ou ordens fora da carteira */}
        {summary && summary.naoCadastradoCount > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '10px 14px',
              background: 'var(--orange-soft, rgba(245, 158, 11, 0.1))',
              border: '1px solid var(--orange, #f59e0b)',
              borderRadius: 'var(--radius-sm, 6px)',
              fontSize: '0.82rem',
              color: 'var(--orange-dark, #b45309)'
            }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <b>Atenção:</b> Existem <b>{summary.naoCadastradoCount}</b> ordens/operações confirmadas no SAP que <b>não constam na carteira programada do Portal Offshore</b> para este embarque. Elas estão sinalizadas na tabela abaixo como <i>Não Cadastrada no Portal</i> e são contabilizadas como horas executadas a bordo.
            </div>
          </div>
        )}

        {/* Barra de Filtros e Busca de Ordens */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-muted)', marginRight: '4px' }}>
              Filtrar por:
            </span>
            {[
              { id: 'todos', label: `Todas (${operacoes.length})` },
              { id: 'carteira', label: `Carteira (${operacoes.filter(o => o.status_programacao === 'Carteira').length})` },
              { id: 'fora', label: `Fora da carteira (${operacoes.filter(o => o.status_programacao === 'Fora da carteira').length})` },
              { id: 'nao_cadastrado', label: `Não Cadastrado no Portal (${summary?.naoCadastradoCount || 0})` },
              { id: 'divergentes', label: `Divergentes (${(summary?.divCount || 0) + (summary?.naoApontadoSapCount || 0)})` }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as any)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '20px',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  border: statusFilter === tab.id ? '1px solid var(--brand-primary, #0ea5e9)' : '1px solid var(--line, #cbd5e1)',
                  background: statusFilter === tab.id ? 'var(--brand-primary, #0ea5e9)' : 'var(--surface, #fff)',
                  color: statusFilter === tab.id ? '#fff' : 'var(--ink)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', minWidth: '220px' }}>
            <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
            <input
              type="text"
              placeholder="Buscar ordem ou operação..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px 6px 32px',
                fontSize: '0.82rem',
                borderRadius: 'var(--radius-sm, 6px)',
                border: '1px solid var(--line, #cbd5e1)',
                background: 'var(--surface, #fff)',
                color: 'var(--ink)'
              }}
            />
          </div>
        </div>

        {/* Tabela de Ordens e Operações da Carteira */}
        <div className="table-responsive" style={{ maxHeight: '440px', overflowY: 'auto', overflowX: 'auto', border: '1px solid var(--line, #e2e8f0)', borderRadius: 'var(--radius-md, 8px)' }}>
          <table className="table-base" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line, #cbd5e1)', background: 'var(--surface-alt, #f8fafc)', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '9px 12px' }}>Ordem</th>
                <th style={{ padding: '9px 12px' }}>Operação</th>
                <th style={{ padding: '9px 12px' }}>Classificação</th>
                <th style={{ padding: '9px 12px', textAlign: 'right' }}>HH Programado</th>
                <th style={{ padding: '9px 12px', textAlign: 'right' }}>HC Portal</th>
                <th style={{ padding: '9px 12px', textAlign: 'right' }}>HH SAP</th>
                <th style={{ padding: '9px 12px', textAlign: 'right' }}>Divergência</th>
                <th style={{ padding: '9px 12px' }}>Confronto SAP vs Portal</th>
                <th style={{ padding: '9px 12px' }}>Período Operação</th>
              </tr>
            </thead>
            <tbody>
              {filteredOperacoes.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-muted)' }}>
                    Nenhuma ordem ou operação encontrada para os critérios selecionados.
                  </td>
                </tr>
              ) : (
                filteredOperacoes.map((op, idx) => {
                  const isCarteira = op.status_programacao === 'Carteira';
                  const isFora = op.status_programacao === 'Fora da carteira';
                  const isNaoCadastrado = op.status_programacao === 'Não Cadastrado no Portal';
                  const div = Math.round(((op.hh_confirmado || 0) - (op.hh_confirmado_sap || 0)) * 100) / 100;
                  const isOk = op.status_divergencia === 'OK';

                  return (
                    <tr
                      key={op.id || `${op.ordem}_${op.operacao}_${idx}`}
                      style={{
                        borderBottom: '1px solid var(--line, #e2e8f0)',
                        background: isNaoCadastrado ? 'rgba(238, 242, 255, 0.5)' : (idx % 2 === 0 ? 'var(--surface, #fff)' : 'var(--surface-alt, #fafafa)')
                      }}
                    >
                      {/* Ordem */}
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--ink)' }}>
                        {op.ordem}
                      </td>

                      {/* Operação */}
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontWeight: 600 }}>
                        {op.operacao}
                      </td>

                      {/* Classificação Programação */}
                      <td style={{ padding: '9px 12px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '0.73rem',
                            fontWeight: 600,
                            background: isCarteira
                              ? 'var(--green-soft, #dcfce7)'
                              : (isFora ? 'var(--orange-soft, #fef3c7)' : 'var(--blue-soft, #e0f2fe)'),
                            color: isCarteira
                              ? 'var(--ok, #15803d)'
                              : (isFora ? 'var(--orange-dark, #b45309)' : 'var(--blue, #0369a1)')
                          }}
                        >
                          {op.status_programacao}
                        </span>
                      </td>

                      {/* HH Programado */}
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>
                        {formatHours(op.hh_programado)}
                      </td>

                      {/* HC Portal Offshore */}
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--blue, #0284c7)' }}>
                        {formatHours(op.hh_confirmado)}
                      </td>

                      {/* HH Confirmado SAP */}
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--ok, #16a34a)' }}>
                        {formatHours(op.hh_confirmado_sap)}
                      </td>

                      {/* Divergência Numérica */}
                      <td
                        style={{
                          padding: '9px 12px',
                          textAlign: 'right',
                          fontWeight: 700,
                          color: div === 0 ? 'var(--ok, #16a34a)' : (div > 0 ? 'var(--orange-dark, #c2410c)' : 'var(--blue, #0284c7)')
                        }}
                      >
                        {div === 0 ? '0h' : formatSignedHours(div)}
                      </td>

                      {/* Confronto / Notificação Visual */}
                      <td style={{ padding: '9px 12px' }}>
                        {isOk ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--ok, #16a34a)', fontSize: '0.76rem', fontWeight: 600 }}>
                            <CheckCircle2 size={14} />
                            <span>OK (Conciliado)</span>
                          </span>
                        ) : isNaoCadastrado ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--blue, #0284c7)', fontSize: '0.76rem', fontWeight: 600 }}>
                            <Info size={14} />
                            <span>Não Cadastrado no Portal</span>
                          </span>
                        ) : op.status_divergencia === 'Não Apontado no SAP' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--bad, #dc2626)', fontSize: '0.76rem', fontWeight: 600 }}>
                            <AlertTriangle size={14} />
                            <span>Não Apontado no SAP</span>
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--orange-dark, #b45309)', fontSize: '0.76rem', fontWeight: 600 }}>
                            <AlertTriangle size={14} />
                            <span>{op.status_divergencia}</span>
                          </span>
                        )}
                      </td>

                      {/* Período */}
                      <td style={{ padding: '9px 12px', fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                        {op.data_inicio && op.data_fim ? `${formatBrShort(op.data_inicio)} a ${formatBrShort(op.data_fim)}` : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
