import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { Drawer } from '../components/Drawer';
import { Sparkline120 } from '../components/Sparkline120';
import { StatusPill } from '../components/StatusPill';
import {
  accumulateEmbarkation,
  buildSapIndex,
  findCarteira,
  inferEmbarkation,
  resolveLocation,
  resolveRecord,
  resolveTechName,
  statusOf
} from '../../domain/calculations';
import type { ConfirmacaoSAP } from '../../domain/types';
import { eachDay, periodDisplayName } from '../../domain/periods';
import { formatBr, formatBrShort } from '../../utils/date';
import {
  calcPct,
  formatHours,
  formatPct,
  formatSignedHours,
  plural
} from '../../utils/format';
import { exportTecnicoXlsx } from '../../services/excel.service';

interface FichaDayItem {
  D: string;
  r: ReturnType<typeof resolveRecord>;
  c: ReturnType<typeof findCarteira>;
  l: ReturnType<typeof resolveLocation>;
  emb: ReturnType<typeof inferEmbarkation>;
  acc: ReturnType<typeof accumulateEmbarkation> | null;
  j: any;
  sapItems: ConfirmacaoSAP[];
}

export function FichaTecnicoDrawer() {
  const {
    fichaMat,
    closeFichaDrawer,
    dataset,
    pidx,
    activePeriod,
    openJustModal,
    scopeLabel
  } = useApp();

  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  const mat = fichaMat || '';
  const P = activePeriod;

  const sapIndex = useMemo(() => buildSapIndex(dataset.confirmacoesSap), [dataset.confirmacoesSap]);

  // Busca dados de cada dia do período para este técnico
  const dayItems = useMemo(() => {
    if (!mat) return [];
    const out: FichaDayItem[] = [];

    eachDay(P.ini, P.fim, D => {
      const r = resolveRecord(mat, D, dataset);
      const c = findCarteira(dataset.carteira, mat, D);
      if (!r && !c) return;

      const emb = inferEmbarkation(mat, D, dataset);
      const acc = emb && r ? accumulateEmbarkation(mat, D, emb, dataset) : null;
      const l = resolveLocation(mat, D, dataset, pidx);
      const j = dataset.justMap[`${mat}|${D}`] || null;
      const sapItems = sapIndex.byTechDate.get(`${mat}|${D}`) || [];

      out.push({ D, r, c, l, emb, acc, j, sapItems });
    });

    return out;
  }, [mat, P, dataset, pidx, sapIndex]);

  // Agregações do técnico no período
  const summary = useMemo(() => {
    if (!mat) {
      return {
        cartDias: 0,
        prog: 0,
        d: 0,
        e: 0,
        p: null as number | null,
        gw: 0,
        jus: 0,
        pend: 0,
        totSap: 0,
        totSapFora: 0
      };
    }

    let totCartDias = 0;
    let totD = 0;
    let totE = 0;
    let totGw = 0;
    let totJus = 0;
    let totPend = 0;
    let totSap = 0;
    let totSapFora = 0;

    // Dias na carteira dentro do período
    dataset.carteira.forEach(c => {
      if (c.matricula === mat) {
        const a = c.data_inicio > P.ini ? c.data_inicio : P.ini;
        const b = c.data_fim < P.fim ? c.data_fim : P.fim;
        if (a <= b) {
          const d1 = new Date(a).getTime();
          const d2 = new Date(b).getTime();
          totCartDias += Math.round((d2 - d1) / 864e5) + 1;
        }
      }
    });

    dayItems.forEach(x => {
      if (x.r) {
        totD += x.r.d;
        totE += x.r.e;
        if (x.r.e < x.r.d - 0.001) {
          if (x.j) totJus++;
          else totPend++;
        }
      }
      if (x.j?.horas_gangway) {
        totGw += Number(x.j.horas_gangway) || 0;
      }
      (x.sapItems || []).forEach(cs => {
        totSap += cs.horas_confirmadas || 0;
        if (cs.status_reconciliacao !== 'Em Carteira') {
          totSapFora += cs.horas_confirmadas || 0;
        }
      });
    });

    const progHours = totCartDias * dataset.config.hh_dia;
    const p = calcPct(totE, totD);

    return {
      cartDias: totCartDias,
      prog: progHours,
      d: totD,
      e: totE,
      p,
      gw: totGw,
      jus: totJus,
      pend: totPend,
      totSap,
      totSapFora
    };
  }, [mat, P, dataset, dayItems]);

  // Sparkline data
  const sparklineItems = useMemo(() => {
    return dayItems
      .filter(x => x.r)
      .map(x => ({
        label: formatBrShort(x.D),
        pct: x.r ? calcPct(x.r.e, x.r.d) : null
      }));
  }, [dayItems]);

  const handleExport = async () => {
    if (!mat) return;
    setIsExporting(true);
    try {
      await exportTecnicoXlsx(mat, dataset, P, scopeLabel);
      showToast(`Relatório do técnico ${mat} exportado com sucesso!`, 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao exportar relatório: ' + (err.message || 'Falha'), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  if (!fichaMat) return null;

  const nome = resolveTechName(mat, dataset);
  const tecObj = dataset.tecnicos[mat];

  return (
    <Drawer
      open={!!fichaMat}
      onClose={closeFichaDrawer}
      title={nome}
      subtitle={`Mat. ${mat}${tecObj?.funcao ? ' · ' + tecObj.funcao : ''} · Medição ${periodDisplayName(P)} (${formatBr(P.ini)} a ${formatBr(P.fim)})`}
      width={700}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={closeFichaDrawer}
          >
            Fechar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'Exportando...' : 'Baixar relatório do técnico'}
          </button>
        </div>
      }
    >
      <div>
        {/* 8 Facts */}
        <div
          className="facts"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '10px',
            background: 'var(--surface-alt)',
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '18px'
          }}
        >
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Dias na carteira</span>
            <b style={{ fontSize: '0.95rem' }}>{summary.cartDias}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>HH programado</span>
            <b style={{ fontSize: '0.95rem' }}>{formatHours(summary.prog)}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Disponível</span>
            <b style={{ fontSize: '0.95rem' }}>{formatHours(summary.d)}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Executado</span>
            <b style={{ fontSize: '0.95rem' }}>{formatHours(summary.e)}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Execução</span>
            <b style={{ fontSize: '0.95rem' }}>{formatPct(summary.p)}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Gangway</span>
            <b style={{ fontSize: '0.95rem' }}>{summary.gw > 0 ? formatHours(summary.gw) : '—'}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Justificados</span>
            <b style={{ fontSize: '0.95rem' }}>{summary.jus}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Pendentes</span>
            <b style={{ fontSize: '0.95rem', color: summary.pend > 0 ? 'var(--bad)' : 'inherit' }}>
              {summary.pend}
            </b>
          </div>
          {summary.totSap > 0 && (
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Extrato SAP</span>
              <b style={{ fontSize: '0.95rem', color: 'var(--blue)' }}>
                {formatHours(summary.totSap)}
                {summary.totSapFora > 0 && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--orange-dark)', marginLeft: '4px' }}>
                    ({formatHours(summary.totSapFora)} fora)
                  </span>
                )}
              </b>
            </div>
          )}
        </div>

        {/* Gráfico Sparkline 120% */}
        {sparklineItems.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <div className="sub" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginBottom: '6px' }}>
              Execução dia a dia (barra cheia = 120%)
            </div>
            <Sparkline120 items={sparklineItems} config={dataset.config} />
          </div>
        )}

        {/* Tabela dia a dia */}
        <div>
          <h4 style={{ fontFamily: 'var(--f-display)', marginBottom: '8px' }}>Histórico diário</h4>
          {!dayItems.length ? (
            <div className="note" style={{ textAlign: 'center', padding: '20px' }}>
              Sem dias neste período.
            </div>
          ) : (
            <div className="table-responsive" style={{ maxHeight: '420px', overflowY: 'auto' }}>
              <table className="table-base" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left', background: 'var(--surface)' }}>
                    <th style={{ padding: '8px' }}>Data</th>
                    <th style={{ padding: '8px' }}>Plataforma</th>
                    <th style={{ padding: '8px' }}>Embarque</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Disp.</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Exec.</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>%</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Acumulado</th>
                    <th style={{ padding: '8px' }}>Justificativa</th>
                  </tr>
                </thead>
                <tbody>
                  {dayItems.map(x => {
                    const p = x.r ? calcPct(x.r.e, x.r.d) : null;
                    const need = x.r && x.r.e < x.r.d - 0.001;

                    return (
                      <React.Fragment key={x.D}>
                        <tr style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px', fontWeight: 600 }}>{formatBr(x.D)}</td>
                        <td style={{ padding: '8px' }}>
                          <b>{x.l.p}</b>
                          <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                            {x.l.r}
                          </div>
                        </td>
                        <td style={{ padding: '8px' }}>
                          {x.emb ? `Dia ${x.emb.dia}/${x.emb.n}` : '—'}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>
                          {x.r ? formatHours(x.r.d) : <span className="sub">fora do embarque</span>}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>
                          {x.r ? (
                            x.r.sem ? (
                              <span style={{ color: 'var(--bad)', fontWeight: 700 }}>Não chegou</span>
                            ) : (
                              <div>
                                <span style={{ fontWeight: 600 }}>{formatHours(x.r.e)}</span>
                                {x.sapItems && x.sapItems.length > 0 && (
                                  <div>
                                    <button
                                      type="button"
                                      className="btn-link"
                                      onClick={() => setExpandedDays(prev => ({ ...prev, [x.D]: !prev[x.D] }))}
                                      style={{
                                        fontSize: '0.72rem',
                                        color: x.sapItems.some(s => s.status_reconciliacao !== 'Em Carteira')
                                          ? 'var(--orange-dark)'
                                          : 'var(--blue)',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        background: 'none',
                                        border: 'none',
                                        padding: 0
                                      }}
                                    >
                                      {x.sapItems.length} {x.sapItems.length === 1 ? 'ordem' : 'ordens'}
                                      {x.sapItems.some(s => s.status_reconciliacao !== 'Em Carteira') ? ' ⚠️' : ''}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )
                          ) : (
                            ''
                          )}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          {x.r && <StatusPill status={statusOf(p, dataset.config)} text={formatPct(p)} />}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>
                          {x.acc ? (
                            <span style={{ color: x.acc.saldo >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
                              {formatPct(x.acc.p)} ({formatSignedHours(x.acc.saldo)})
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '8px' }}>
                          {x.j ? (
                            <div>
                              <b>{x.j.motivo}</b>
                              {x.j.horas_gangway > 0 && ` · ${formatHours(x.j.horas_gangway)}`}
                              {x.j.descricao && (
                                <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                                  {x.j.descricao}
                                </div>
                              )}
                            </div>
                          ) : need ? (
                            <button
                              type="button"
                              className="btn btn-accent btn-sm"
                              onClick={() => openJustModal(mat, x.D)}
                              style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                            >
                              Justificar
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                      {expandedDays[x.D] && x.sapItems && x.sapItems.length > 0 && (
                        <tr key={`expand_${x.D}`} style={{ background: 'var(--surface-alt)' }}>
                          <td colSpan={8} style={{ padding: '10px 14px' }}>
                            <div style={{ fontSize: '0.78rem' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--blue)' }}>
                                Ordens e Operações confirmadas no SAP em {formatBr(x.D)}:
                              </div>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-muted)' }}>
                                    <th style={{ textAlign: 'left', padding: '4px' }}>Ordem</th>
                                    <th style={{ textAlign: 'left', padding: '4px' }}>Operação</th>
                                    <th style={{ textAlign: 'right', padding: '4px' }}>Horas Confirmadas</th>
                                    <th style={{ textAlign: 'left', padding: '4px' }}>Situação na Carteira do Portal</th>
                                    <th style={{ textAlign: 'center', padding: '4px' }}>Contador</th>
                                    <th style={{ textAlign: 'left', padding: '4px' }}>ID Embarque</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {x.sapItems.map((cs, idx) => {
                                    const isEm = cs.status_reconciliacao === 'Em Carteira';
                                    return (
                                      <tr key={cs.id || `${cs.ordem}_${cs.operacao}_${idx}`} style={{ borderBottom: '1px dotted var(--line)' }}>
                                        <td style={{ padding: '4px', fontFamily: 'monospace', fontWeight: 600 }}>{cs.ordem}</td>
                                        <td style={{ padding: '4px', fontFamily: 'monospace' }}>{cs.operacao}</td>
                                        <td style={{ padding: '4px', textAlign: 'right', fontWeight: 600 }}>
                                          {formatHours(cs.horas_confirmadas)}
                                        </td>
                                        <td style={{ padding: '4px' }}>
                                          <span
                                            style={{
                                              padding: '1px 6px',
                                              borderRadius: '10px',
                                              fontSize: '0.72rem',
                                              fontWeight: 600,
                                              background: isEm ? 'var(--green-soft, #dcfce7)' : 'var(--orange-soft, #fef3c7)',
                                              color: isEm ? 'var(--ok, #15803d)' : 'var(--orange-dark, #b45309)'
                                            }}
                                          >
                                            {isEm ? 'Cadastrada no Portal' : 'Não Cadastrada no Portal'}
                                          </span>
                                        </td>
                                        <td style={{ padding: '4px', textAlign: 'center', fontFamily: 'monospace', color: 'var(--ink-muted)' }}>
                                          {cs.contador_confirmacao || '—'}
                                        </td>
                                        <td style={{ padding: '4px', fontFamily: 'monospace', color: 'var(--ink-muted)' }}>
                                          {cs.id_embarque ? `ID ${cs.id_embarque}` : '—'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
