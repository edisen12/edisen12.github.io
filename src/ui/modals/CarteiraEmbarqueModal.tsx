import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { Modal } from '../components/Modal';
import { StatusPill } from '../components/StatusPill';
import {
  findCarteira,
  inferEmbarkation,
  isArmadorPlatform,
  lookupPlatform,
  mergeConfrontoOperations,
  resolveLocation,
  resolvePlace,
  resolveTechName
} from '../../domain/calculations';
import { resolveUsoffWeights, hasGangwayJustification } from '../../domain/usoff';
import type { CarteiraOperacao, ConfirmacaoSAP } from '../../domain/types';
import { addDays, diffDays, formatBr, formatBrShort } from '../../utils/date';
import { formatHours, formatSignedHours, formatUs, normalizeSapCode } from '../../utils/format';
import { Download, Search, CheckCircle2, AlertTriangle, Info, FileSpreadsheet, ExternalLink, ArrowLeft, Briefcase, Calculator } from 'lucide-react';

export interface OperacaoComUsoffRow extends CarteiraOperacao {
  pe: number | null;
  ex: number | null;
  opPeHp: number;
  opExHc: number;
  opUsoff: number | null;
  usoffMotivo: string;
}

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

  // Consolidação de operações do Portal Offshore, confirmações do SAP e apuração do USOFF
  const { operacoes, summary } = useMemo(() => {
    if (!tecMat) {
      return { operacoes: [] as OperacaoComUsoffRow[], summary: null };
    }

    // 1. Filtra operações da carteira_operacoes pertencentes a este técnico e embarque
    const opsDoEmbarque = (dataset.carteiraOperacoes || []).filter(op => {
      if (normalizeSapCode(op.matricula) !== normalizeSapCode(tecMat)) return false;
      const opEmb = op.id_embarque || op.portal_id || '';
      if (idEmbFinal && opEmb === idEmbFinal) return true;
      if (idEmbFinal && opEmb && opEmb !== idEmbFinal) return false;
      if (dataInicio && dataFim) {
        return op.data_inicio >= dataInicio && op.data_fim <= dataFim;
      }
      return true;
    });

    const opsEmbKeySet = new Set(
      opsDoEmbarque.map(op => `${normalizeSapCode(op.ordem)}|${normalizeSapCode(op.operacao)}`)
    );

    // 2. Filtra confirmações SAP deste técnico vinculadas ao embarque ou na janela de datas
    const sapDoEmbarque = (dataset.confirmacoesSap || []).filter(cs => {
      if (normalizeSapCode(cs.matricula) !== normalizeSapCode(tecMat)) return false;
      const csEmb = cs.id_embarque || '';
      if (idEmbFinal && csEmb === idEmbFinal) return true;
      // Nunca sequestrar confirmação explicitamente vinculada a outro embarque.
      if (idEmbFinal && csEmb && csEmb !== idEmbFinal) return false;
      const csDate = cs.data_fim_real || cs.data_lancamento || cs.data_criacao || '';
      // Estorno ou confirmação sem id_embarque pertencente a ordem/operação deste embarque (inclui tardios > 4d)
      if (!csEmb && opsEmbKeySet.has(`${normalizeSapCode(cs.ordem)}|${normalizeSapCode(cs.operacao)}`)) {
        if (dataInicio && csDate && csDate < dataInicio) return false;
        const hasBetterLaterOp = (dataset.carteiraOperacoes || []).some(other =>
          normalizeSapCode(other.matricula) === normalizeSapCode(tecMat) &&
          normalizeSapCode(other.ordem) === normalizeSapCode(cs.ordem) &&
          normalizeSapCode(other.operacao) === normalizeSapCode(cs.operacao) &&
          (other.id_embarque || other.portal_id || '') !== idEmbFinal &&
          other.data_inicio <= csDate &&
          (!dataInicio || other.data_inicio > dataInicio)
        );
        if (!hasBetterLaterOp) return true;
      }
      if (dataInicio && dataFim) {
        return csDate >= dataInicio && csDate <= addDays(dataFim, 4);
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

    // 4. Resolução dos parâmetros contratuais de USOFF
    const effPlatSigla = platSigla || (opsDoEmbarque[0]?.plataforma_sigla ?? '');
    const effUnidade = unidade || (opsDoEmbarque[0]?.unidade_negocio ?? '');
    const platObj = lookupPlatform(pidx, effPlatSigla);
    const isDiaria = isArmadorPlatform(platObj, effPlatSigla, effUnidade, dataset.usoffUnWeights);
    const hasGw = hasGangwayJustification(
      tecMat,
      dataInicio || activePeriod.ini,
      dataFim || activePeriod.fim,
      dataset.justMap
    );
    const place = resolvePlace(pidx, effPlatSigla, effUnidade);
    const weights = resolveUsoffWeights(embarque, place, dataset.config, dataset.usoffUnWeights);
    const pe = weights.pe ?? dataset.config.us_pe_padrao ?? 0.30;
    const ex = weights.ex ?? dataset.config.us_ex_padrao ?? 0.70;
    const weightsFalta = !isDiaria && weights.pe == null && dataset.config.us_pe_padrao == null;

    let totHp = 0;
    let totHpCarteira = 0;
    let totHpFora = 0;
    let totPortal = 0;
    let totSap = 0;
    let okCount = 0;
    let divCount = 0;
    let naoCadastradoCount = 0;
    let naoApontadoSapCount = 0;
    let totPeHp = 0;
    let totExHc = 0;
    let opsComZeroExec = 0;

    const operacoesComUsoff: OperacaoComUsoffRow[] = merged.map(o => {
      const hp = Number(o.hh_programado) || 0;
      const hc = Math.max(Number(o.hh_confirmado_sap) || 0, Number(o.hh_confirmado) || 0, 0);
      const isCarteira = o.status_programacao === 'Carteira';
      const isFora = o.status_programacao === 'Fora da carteira';
      const hpCart = isCarteira ? hp : 0;
      const hpFora = !isCarteira ? hp : 0;

      let opPeHp = 0;
      let opExHc = 0;
      let opUsoff: number | null = null;
      let usoffMotivo = '';

      if (isDiaria) {
        usoffMotivo = 'Diária (Armador)';
      } else if (weightsFalta) {
        usoffMotivo = 'Falta PE/EX';
      } else {
        if (hc === 0) {
          if (hasGw) {
            opPeHp = Math.round(pe * hpCart * 100) / 100;
            opExHc = 0;
            opUsoff = opPeHp;
            usoffMotivo = 'Gangway (30% HP)';
          } else {
            opPeHp = 0;
            opExHc = 0;
            opUsoff = 0;
            usoffMotivo = 'Execução Zero (HC=0)';
            opsComZeroExec++;
          }
        } else {
          opPeHp = Math.round(pe * hpCart * 100) / 100;
          opExHc = Math.round(ex * hc * 100) / 100;
          opUsoff = Math.round((opPeHp + opExHc) * 100) / 100;
          usoffMotivo = isCarteira ? 'PE×HP + EX×HC' : 'Apenas EX (Fora)';
        }
      }

      totHp += hp;
      if (isCarteira) {
        totHpCarteira += hp;
      } else if (isFora) {
        totHpFora += hp;
      }
      totPortal += o.hh_confirmado || 0;
      totSap += o.hh_confirmado_sap || 0;
      totPeHp += opPeHp;
      totExHc += opExHc;

      if (o.status_divergencia === 'OK') okCount++;
      else if (o.status_divergencia === 'Não Cadastrado no Portal') naoCadastradoCount++;
      else if (o.status_divergencia === 'Não Apontado no SAP') naoApontadoSapCount++;
      else divCount++;

      return {
        ...o,
        pe: weightsFalta ? null : pe,
        ex: weightsFalta ? null : ex,
        opPeHp,
        opExHc,
        opUsoff,
        usoffMotivo
      };
    });

    const saldoDiv = Math.round((totPortal - totSap) * 100) / 100;
    const finalUsoffTotal = isDiaria
      ? diasEmbarque * 10
      : (weightsFalta ? null : Math.round((totPeHp + totExHc) * 100) / 100);

    return {
      operacoes: operacoesComUsoff,
      summary: {
        totHp: Math.round(totHp * 100) / 100,
        totHpCarteira: Math.round(totHpCarteira * 100) / 100,
        totHpFora: Math.round(totHpFora * 100) / 100,
        totPortal: Math.round(totPortal * 100) / 100,
        totSap: Math.round(totSap * 100) / 100,
        saldoDiv,
        okCount,
        divCount,
        naoCadastradoCount,
        naoApontadoSapCount,
        totalOps: merged.length,
        // USOFF
        totPeHp: isDiaria ? 0 : Math.round(totPeHp * 100) / 100,
        totExHc: isDiaria ? finalUsoffTotal || 0 : Math.round(totExHc * 100) / 100,
        usoffTotal: finalUsoffTotal,
        opsComZeroExec,
        pe: weightsFalta ? null : pe,
        ex: weightsFalta ? null : ex,
        weightsFalta,
        isDiaria,
        hasGw
      }
    };
  }, [tecMat, idEmbFinal, dataInicio, dataFim, diasEmbarque, platSigla, unidade, dataset.carteiraOperacoes, dataset.confirmacoesSap, embarque, dataset.tecnicos, dataset.config, dataset.usoffUnWeights, dataset.justMap, pidx, activePeriod]);

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
        'PE',
        'EX',
        'PE x HP (Carteira)',
        'EX x HC (Execução)',
        'USoff',
        'Motivo / Regra USoff',
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
        op.pe != null ? op.pe : '',
        op.ex != null ? op.ex : '',
        op.opPeHp || 0,
        op.opExHc || 0,
        op.opUsoff != null ? op.opUsoff : '',
        op.usoffMotivo || '',
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

  const returnMat = carteiraModal?.returnToFichaMat;
  const handleGoToFicha = () => {
    const targetMat = returnMat || tecMat;
    closeCarteiraModal();
    openFichaDrawer(targetMat);
  };

  return (
    <Modal
      open={Boolean(carteiraModal)}
      onClose={closeCarteiraModal}
      maxWidth="1160px"
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {returnMat && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleGoToFicha}
              title="Retornar ao painel lateral com as confirmações diárias do técnico"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                fontSize: '0.78rem'
              }}
            >
              <ArrowLeft size={14} />
              <span>Voltar à Ficha</span>
            </button>
          )}
          <Briefcase size={20} style={{ color: 'var(--brand-primary, #0ea5e9)', flexShrink: 0 }} />
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
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {returnMat && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleGoToFicha}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <ArrowLeft size={14} />
                <span>Voltar para a Ficha do Técnico</span>
              </button>
            )}
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
            {!returnMat && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleGoToFicha}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <ExternalLink size={14} />
                <span>Ver Ficha Completa do Técnico</span>
              </button>
            )}
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

        {/* Card Apuração e Validação de USOFF */}
        <div
          style={{
            background: 'var(--surface, #fff)',
            border: '1px solid var(--line, #e2e8f0)',
            borderLeft: '4px solid var(--blue, #0284c7)',
            borderRadius: 'var(--radius-md, 8px)',
            padding: '14px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px'
          }}
        >
          <div>
            <div style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
              US<sub>off</sub> Apurado deste Embarque
            </div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: '1.65rem', fontWeight: 800, color: 'var(--blue, #0284c7)', fontVariantNumeric: 'tabular-nums' }}>
              {summary?.weightsFalta ? '—' : (summary ? formatUs(summary.usoffTotal) : '—')}
            </div>
            <div className="sub" style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', marginTop: '2px' }}>
              {summary?.isDiaria
                ? `Fórmula de diária: ${diasEmbarque} dias × 10`
                : `Pesos: PE ${summary?.pe != null ? formatUs(summary.pe) : '—'} · EX ${summary?.ex != null ? formatUs(summary.ex) : '—'}`}
              {summary?.hasGw && (
                <span style={{ marginLeft: '6px', color: 'var(--orange-dark, #b45309)', fontWeight: 600 }}>
                  · Gangway ativa (30% HP)
                </span>
              )}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '10px 18px',
              background: 'var(--surface-alt, #f8fafc)',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm, 6px)'
            }}
          >
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', display: 'block' }}>
                &Sigma; PE &times; HP (Carteira)
              </span>
              <b style={{ fontSize: '0.98rem', color: 'var(--ink)' }}>
                {summary?.weightsFalta ? '—' : formatUs(summary?.totPeHp ?? 0)}
              </b>
              <span className="sub" style={{ fontSize: '0.70rem', color: 'var(--ink-muted)', display: 'block' }}>
                {summary?.opsComZeroExec ? `${summary.opsComZeroExec} op. com HC=0` : 'Horas em Carteira'}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', display: 'block' }}>
                &Sigma; EX &times; HC (Execução)
              </span>
              <b style={{ fontSize: '0.98rem', color: 'var(--ink)' }}>
                {summary?.weightsFalta ? '—' : formatUs(summary?.totExHc ?? 0)}
              </b>
              <span className="sub" style={{ fontSize: '0.70rem', color: 'var(--ink-muted)', display: 'block' }}>
                {summary?.isDiaria ? 'Medição diária' : `${formatHours(summary?.totPortal || 0)} confirmadas`}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', display: 'block' }}>
                Trava de Execução Zero
              </span>
              <b style={{ fontSize: '0.98rem', color: summary?.opsComZeroExec ? 'var(--orange-dark, #c2410c)' : 'var(--ok, #16a34a)' }}>
                {summary?.opsComZeroExec ? `${summary.opsComZeroExec} op. sem USOFF` : '100% com execução'}
              </b>
              <span className="sub" style={{ fontSize: '0.70rem', color: 'var(--ink-muted)', display: 'block' }}>
                HC = 0 &rArr; USOFF = 0
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

        {/* Tabela de Ordens e Operações da Carteira com apuração de USOFF */}
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
                <th style={{ padding: '9px 12px', textAlign: 'right' }} title="Ponderação de Programação (incide apenas em Carteira com execução)">PE &times; HP</th>
                <th style={{ padding: '9px 12px', textAlign: 'right' }} title="Ponderação de Execução confirmada">EX &times; HC</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', background: 'var(--blue-soft, #e0f2fe)' }} title="USOFF apurado desta operação">USoff</th>
                <th style={{ padding: '9px 12px' }}>Confronto SAP vs Portal</th>
                <th style={{ padding: '9px 12px' }}>Período Operação</th>
              </tr>
            </thead>
            <tbody>
              {filteredOperacoes.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-muted)' }}>
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
                      <td
                        style={{
                          padding: '9px 12px',
                          textAlign: 'right',
                          fontWeight: 600,
                          color: (op.hh_confirmado_sap || 0) < 0
                            ? 'var(--bad, #dc2626)'
                            : (op.hh_confirmado_sap || 0) === 0
                              ? 'var(--ink-muted)'
                              : 'var(--ok, #16a34a)'
                        }}
                      >
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

                      {/* PE × HP */}
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {summary?.isDiaria ? (
                          <span className="sub" style={{ color: 'var(--ink-muted)' }}>diária</span>
                        ) : summary?.weightsFalta ? (
                          <span style={{ color: 'var(--bad)' }}>falta</span>
                        ) : op.opPeHp > 0 ? (
                          <b>{formatUs(op.opPeHp)}</b>
                        ) : op.hh_programado && ((op.hh_confirmado || 0) <= 0 && (op.hh_confirmado_sap || 0) <= 0) ? (
                          <span className="sub" style={{ color: 'var(--orange-dark, #c2410c)' }}>0,00 (HC=0)</span>
                        ) : !isCarteira ? (
                          <span className="sub" style={{ color: 'var(--ink-muted)' }}>0,00 (fora)</span>
                        ) : (
                          <span style={{ color: 'var(--ink-muted)' }}>0,00</span>
                        )}
                      </td>

                      {/* EX × HC */}
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {summary?.isDiaria ? (
                          <span className="sub" style={{ color: 'var(--ink-muted)' }}>diária</span>
                        ) : summary?.weightsFalta ? (
                          <span style={{ color: 'var(--bad)' }}>falta</span>
                        ) : op.opExHc > 0 ? (
                          <b>{formatUs(op.opExHc)}</b>
                        ) : (
                          <span className="sub" style={{ color: 'var(--orange-dark, #c2410c)' }}>0,00 (HC=0)</span>
                        )}
                      </td>

                      {/* USoff */}
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', background: isNaoCadastrado ? 'transparent' : 'var(--blue-soft, #e0f2fe)' }}>
                        {summary?.isDiaria ? (
                          <span className="sub" style={{ color: 'var(--blue, #0284c7)' }} title="Unidade por diária: fórmula dias * 10">ver total</span>
                        ) : summary?.weightsFalta ? (
                          <span style={{ color: 'var(--bad)' }}>falta</span>
                        ) : (
                          <div>
                            <b style={{ color: (op.opUsoff || 0) > 0 ? 'var(--blue, #0284c7)' : 'var(--ink-muted)', fontSize: '0.86rem' }}>
                              {formatUs(op.opUsoff)}
                            </b>
                            {op.usoffMotivo && (
                              <div className="sub" style={{ fontSize: '0.68rem', color: (op.opUsoff || 0) === 0 ? 'var(--orange-dark, #c2410c)' : 'var(--ink-muted)' }}>
                                {op.usoffMotivo}
                              </div>
                            )}
                          </div>
                        )}
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
            {filteredOperacoes.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line, #cbd5e1)', background: 'var(--surface-alt, #f8fafc)', fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: '9px 12px' }}>
                    Total ({filteredOperacoes.length} {filteredOperacoes.length === 1 ? 'operação' : 'operações'})
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatHours(filteredOperacoes.reduce((acc, o) => acc + (o.hh_programado || 0), 0))}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--blue, #0284c7)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatHours(filteredOperacoes.reduce((acc, o) => acc + (o.hh_confirmado || 0), 0))}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--ok, #16a34a)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatHours(filteredOperacoes.reduce((acc, o) => acc + (o.hh_confirmado_sap || 0), 0))}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatSignedHours(filteredOperacoes.reduce((acc, o) => acc + ((o.hh_confirmado || 0) - (o.hh_confirmado_sap || 0)), 0))}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {summary?.weightsFalta ? '—' : formatUs(filteredOperacoes.reduce((acc, o) => acc + (o.opPeHp || 0), 0))}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {summary?.weightsFalta ? '—' : formatUs(filteredOperacoes.reduce((acc, o) => acc + (o.opExHc || 0), 0))}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--blue, #0284c7)', background: 'var(--blue-soft, #e0f2fe)', fontSize: '0.92rem', fontVariantNumeric: 'tabular-nums' }}>
                    {summary?.isDiaria ? formatUs(summary.usoffTotal) : (summary?.weightsFalta ? '—' : formatUs(filteredOperacoes.reduce((acc, o) => acc + (o.opUsoff || 0), 0)))}
                  </td>
                  <td colSpan={2} style={{ padding: '9px 12px' }}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </Modal>
  );
}
