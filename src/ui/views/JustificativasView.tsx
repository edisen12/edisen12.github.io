import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { KpiCard } from '../components/KpiCard';
import { StatusPill } from '../components/StatusPill';
import { MeterBar } from '../components/MeterBar';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl } from '../components/SegmentedControl';
import { PAPEIS_LABEL, PAPEIS_PLURAL } from '../../config/constants';
import type {
  CobrancaStats,
  PeriodDayEntry,
  Pessoa,
  StatusMeta
} from '../../domain/types';
import {
  computeCobrancaStats,
  computePeriodDays,
  findResponsiblePeople,
  isPersonResponsible,
  prazoOf,
  resolveTechName
} from '../../domain/calculations';
import { periodDisplayName } from '../../domain/periods';
import {
  buildCobrancaListText
} from '../../domain/communications';
import { diffDays, formatBr, formatBrShort, todayIso } from '../../utils/date';
import {
  calcPct,
  formatHours,
  formatPct,
  plural
} from '../../utils/format';

type JustSubView = 'cob' | 'pend' | 'feitas';

export function JustificativasView() {
  const {
    dataset,
    pidx,
    activePeriod,
    filters,
    updateFilter,
    openFichaDrawer,
    openJustModal,
    openEmailModal,
    isGlobal,
    userProfile
  } = useApp();

  const { showToast } = useToast();
  const [subView, setSubView] = useState<JustSubView>('cob');
  const [papelFilter, setPapelFilter] = useState<'preposto' | 'controlador' | 'gestor'>('preposto');

  const P = activePeriod;
  const TODAY = todayIso();

  // Dias com problema no período (e < d - 0.001)
  const daysBelow = useMemo(() => {
    return computePeriodDays(P, dataset, filters, pidx).filter(
      x => x.e < x.d - 0.001
    );
  }, [P, dataset, filters, pidx]);

  const pend = useMemo(() => daysBelow.filter(x => !x.j), [daysBelow]);
  const feitas = useMemo(() => daysBelow.filter(x => !!x.j), [daysBelow]);

  // Lista para sub-visões pendentes e registradas
  const activeList = useMemo(() => {
    return (subView === 'pend' ? pend : feitas).slice().reverse();
  }, [subView, pend, feitas]);

  // Motivos registrados
  const motivosRanking = useMemo(() => {
    const counts: Record<string, number> = {};
    feitas.forEach(x => {
      if (x.j?.motivo) {
        counts[x.j.motivo] = (counts[x.j.motivo] || 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [feitas]);

  const totalGw = useMemo(() => {
    return feitas.reduce((sum, x) => sum + (Number(x.j?.horas_gangway) || 0), 0);
  }, [feitas]);

  const hhNaoExec = useMemo(() => {
    return daysBelow.reduce((sum, x) => sum + Math.max(0, x.d - x.e), 0);
  }, [daysBelow]);

  // Estatísticas de cobrança gerais
  const A = useMemo(() => {
    return computeCobrancaStats(daysBelow, dataset.config, TODAY);
  }, [daysBelow, dataset.config, TODAY]);

  // Agregações por responsável para cobrança
  const rowsResp = useMemo(() => {
    const pessoasList = Object.values(dataset.pessoas);
    return pessoasList.map(p => {
      const respDays = daysBelow.filter(x => isPersonResponsible(p, { p: x.p, r: x.r }));
      return {
        p,
        M: computeCobrancaStats(respDays, dataset.config, TODAY)
      };
    });
  }, [daysBelow, dataset.pessoas, dataset.config, TODAY]);

  const semRespDays = useMemo(() => {
    const pessoasList = Object.values(dataset.pessoas);
    return daysBelow.filter(x => !pessoasList.some(p => isPersonResponsible(p, { p: x.p, r: x.r })));
  }, [daysBelow, dataset.pessoas]);

  const semRespStats = useMemo(() => {
    return computeCobrancaStats(semRespDays, dataset.config, TODAY);
  }, [semRespDays, dataset.config, TODAY]);

  // Pior preposto em cobrança
  const worstResp = useMemo(() => {
    return rowsResp
      .filter(r => (r.p.papel || 'preposto') === 'preposto' && r.M.venc > 0)
      .sort((a, b) => b.M.venc - a.M.venc)[0];
  }, [rowsResp]);

  const devedores = useMemo(() => {
    return rowsResp.filter(r => r.M.pend > 0);
  }, [rowsResp]);

  // Agrupamento por unidade de negócio
  const rowsUn = useMemo(() => {
    const uns = Array.from(new Set(daysBelow.map(x => x.r)));
    return uns
      .map(u => ({
        u,
        M: computeCobrancaStats(daysBelow.filter(x => x.r === u), dataset.config, TODAY)
      }))
      .sort((a, b) => b.M.venc - a.M.venc || b.M.pend - a.M.pend);
  }, [daysBelow, dataset.config, TODAY]);

  // Copiar lista de cobrança
  const handleCopyCobrancaList = async () => {
    try {
      const text = buildCobrancaListText(P, dataset, pidx, TODAY);
      await navigator.clipboard.writeText(text);
      showToast('Lista de cobrança copiada para a área de transferência!', 'success');
    } catch {
      showToast('Não foi possível copiar automaticamente.', 'warn');
    }
  };

  // -------------------------------------------------------------
  // TABELA DE COBRANÇA
  // -------------------------------------------------------------
  const filteredRespCob = useMemo(() => {
    return rowsResp
      .filter(r => (r.p.papel || 'preposto') === papelFilter)
      .sort((a, b) => b.M.venc - a.M.venc || b.M.pend - a.M.pend || (a.M.pJ ?? 999) - (b.M.pJ ?? 999) || a.p.nome.localeCompare(b.p.nome));
  }, [rowsResp, papelFilter]);

  interface RespCobRow {
    p: Pessoa;
    M: CobrancaStats;
  }

  const cobRespColumns: DataTableColumn<RespCobRow>[] = [
    {
      key: 'st',
      header: 'Situação',
      render: r => <StatusPill status={r.M.st} text={r.M.stTxt} />
    },
    {
      key: 'resp',
      header: 'Responsável',
      render: r => (
        <div>
          <b>{r.p.nome}</b>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            {r.p.email ? r.p.email : <span style={{ color: 'var(--bad)' }}>sem e-mail</span>} ·{' '}
            {plural(r.M.plats.size, 'plataforma', 'plataformas')} com dias a justificar
          </div>
        </div>
      )
    },
    {
      key: 'need',
      header: 'A justificar',
      align: 'right',
      sortValue: r => r.M.need,
      render: r => r.M.need
    },
    {
      key: 'ok',
      header: 'Justificados',
      align: 'right',
      sortValue: r => r.M.ok,
      render: r => r.M.ok
    },
    {
      key: 'pj',
      header: '% justificado',
      sortValue: r => r.M.pJ ?? -1,
      render: r => (r.M.need > 0 ? <MeterBar pct={r.M.pJ} status={r.M.st} /> : <span className="sub">—</span>)
    },
    {
      key: 'noPrazo',
      header: 'Pendentes no prazo',
      align: 'right',
      sortValue: r => r.M.noPrazo,
      render: r => (r.M.noPrazo > 0 ? r.M.noPrazo : '—')
    },
    {
      key: 'venc',
      header: 'Vencidas',
      align: 'right',
      sortValue: r => r.M.venc,
      render: r => (r.M.venc > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}>{r.M.venc}</span> : '—')
    },
    {
      key: 'oldest',
      header: 'Mais antiga pendente',
      render: r => {
        if (!r.M.oldest) return '—';
        return (
          <div>
            <div>{formatBr(r.M.oldest)}</div>
            {r.M.atraso > 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--bad)', fontWeight: 600 }}>
                {plural(r.M.atraso, 'dia', 'dias')} de atraso
              </div>
            ) : (
              <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                prazo {formatBrShort(prazoOf(r.M.oldest, dataset.config))}
              </div>
            )}
          </div>
        );
      }
    },
    {
      key: 'fora',
      header: 'Fora do prazo',
      align: 'right',
      sortValue: r => r.M.fora,
      render: r => (r.M.fora > 0 ? r.M.fora : '—')
    },
    {
      key: 'tMed',
      header: 'Tempo médio',
      align: 'right',
      sortValue: r => r.M.tMed ?? -1,
      render: r => (r.M.tMed != null ? `${r.M.tMed.toFixed(1)} d` : '—')
    },
    {
      key: 'acoes',
      header: '',
      render: r => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {r.M.pend > 0 && (
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => openEmailModal({ mode: 'cobranca', targetRespId: r.p.id })}
            >
              Cobrar
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              updateFilter('fResp', r.p.id);
              setSubView('pend');
            }}
          >
            Ver
          </button>
        </div>
      )
    }
  ];

  interface UnCobRow {
    u: string;
    M: CobrancaStats;
  }

  const cobUnColumns: DataTableColumn<UnCobRow>[] = [
    {
      key: 'st',
      header: 'Situação',
      render: r => <StatusPill status={r.M.st} text={r.M.stTxt} />
    },
    {
      key: 'un',
      header: 'Unidade',
      render: r => <b>{r.u}</b>
    },
    {
      key: 'need',
      header: 'A justificar',
      align: 'right',
      sortValue: r => r.M.need,
      render: r => r.M.need
    },
    {
      key: 'ok',
      header: 'Justificados',
      align: 'right',
      sortValue: r => r.M.ok,
      render: r => r.M.ok
    },
    {
      key: 'pj',
      header: '% justificado',
      sortValue: r => r.M.pJ ?? -1,
      render: r => (r.M.need > 0 ? <MeterBar pct={r.M.pJ} status={r.M.st} /> : <span className="sub">—</span>)
    },
    {
      key: 'noPrazo',
      header: 'Pendentes no prazo',
      align: 'right',
      sortValue: r => r.M.noPrazo,
      render: r => (r.M.noPrazo > 0 ? r.M.noPrazo : '—')
    },
    {
      key: 'venc',
      header: 'Vencidas',
      align: 'right',
      sortValue: r => r.M.venc,
      render: r => (r.M.venc > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}>{r.M.venc}</span> : '—')
    },
    {
      key: 'oldest',
      header: 'Mais antiga pendente',
      render: r => {
        if (!r.M.oldest) return '—';
        return (
          <div>
            <div>{formatBr(r.M.oldest)}</div>
            {r.M.atraso > 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--bad)', fontWeight: 600 }}>
                {plural(r.M.atraso, 'dia', 'dias')} de atraso
              </div>
            ) : (
              <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                prazo {formatBrShort(prazoOf(r.M.oldest, dataset.config))}
              </div>
            )}
          </div>
        );
      }
    },
    {
      key: 'fora',
      header: 'Fora do prazo',
      align: 'right',
      sortValue: r => r.M.fora,
      render: r => (r.M.fora > 0 ? r.M.fora : '—')
    },
    {
      key: 'tMed',
      header: 'Tempo médio',
      align: 'right',
      sortValue: r => r.M.tMed ?? -1,
      render: r => (r.M.tMed != null ? `${r.M.tMed.toFixed(1)} d` : '—')
    }
  ];

  // -------------------------------------------------------------
  // TABELA DE PENDENTES / REGISTRADAS
  // -------------------------------------------------------------
  const detailColumns: DataTableColumn<PeriodDayEntry>[] = [
    {
      key: 'data',
      header: 'Data',
      sortValue: r => r.D,
      render: r => <div>{formatBr(r.D)}</div>
    },
    {
      key: 'tecnico',
      header: 'Técnico',
      render: r => (
        <div>
          <button
            type="button"
            className="btn-link"
            onClick={() => openFichaDrawer(r.mat)}
            style={{ fontWeight: 600, color: 'var(--blue)', textAlign: 'left' }}
          >
            {resolveTechName(r.mat, dataset)}
          </button>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            Mat. {r.mat}
          </div>
        </div>
      )
    },
    {
      key: 'plat',
      header: 'Plataforma',
      render: r => (
        <div>
          <b>{r.p}</b>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            {r.r}
          </div>
        </div>
      )
    },
    {
      key: 'disp',
      header: 'Disp.',
      align: 'right',
      sortValue: r => r.d,
      render: r => formatHours(r.d)
    },
    {
      key: 'exec',
      header: 'Exec.',
      align: 'right',
      sortValue: r => r.e,
      render: r => (r.sem ? <span style={{ color: 'var(--bad)' }}>0 h (não chegou)</span> : formatHours(r.e))
    },
    {
      key: 'pct',
      header: '%',
      sortValue: r => calcPct(r.e, r.d) ?? -1,
      render: r => formatPct(calcPct(r.e, r.d))
    },
    {
      key: 'resp',
      header: 'Responsáveis',
      render: r => {
        const ppl = findResponsiblePeople(dataset.pessoas, [r.p], [r.r]);
        return (
          <div className="sub" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
            {ppl.map(p => p.nome).join(', ') || 'sem responsável'}
          </div>
        );
      }
    },
    ...(subView === 'pend'
      ? [
          {
            key: 'prazo',
            header: 'Prazo',
            render: (r: PeriodDayEntry) => {
              const pz = prazoOf(r.D, dataset.config);
              const vencido = TODAY > pz;
              return vencido ? (
                <StatusPill status="bad" text={`Vencido ${formatBrShort(pz)}`} />
              ) : (
                <StatusPill status="warn" text={`Até ${formatBrShort(pz)}`} />
              );
            }
          }
        ]
      : []),
    {
      key: 'acao',
      header: subView === 'pend' ? 'Ação' : 'Justificativa',
      render: r => {
        if (r.j) {
          const emDate = r.j.criado_em ? r.j.criado_em.slice(0, 10) : '';
          const foraDoPrazo = emDate > prazoOf(r.D, dataset.config);

          return (
            <div>
              <div style={{ fontWeight: 600 }}>
                {r.j.motivo}
                {r.j.horas_gangway > 0 && ` · ${formatHours(r.j.horas_gangway)} de gangway`}
              </div>
              {r.j.descricao && (
                <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: '2px' }}>
                  {r.j.descricao}
                </div>
              )}
              <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', marginTop: '2px' }}>
                {r.j.responsavel_nome}
                {emDate && ` · em ${formatBr(emDate)}`}
                {foraDoPrazo && <span style={{ color: 'var(--warn)', marginLeft: '4px' }}>(fora do prazo)</span>}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => openJustModal(r.mat, r.D)}
                style={{ marginTop: '4px', fontSize: '0.78rem' }}
              >
                Editar
              </button>
            </div>
          );
        }

        return (
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => openJustModal(r.mat, r.D)}
            >
              Justificar
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => openEmailModal({ mode: 'daily', plats: [r.p], date: r.D })}
            >
              E-mail
            </button>
          </div>
        );
      }
    }
  ];

  return (
    <div className="view-justificativas">
      {/* Cabeçalho */}
      <div className="card-header-view" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
            Justificativas · {periodDisplayName(P)} ({formatBr(P.ini)} a {formatBr(P.fim)})
          </h2>
          <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
            Gestão de pendências, SLA contratual e motivos de desvios de HH
          </div>
        </div>

        {/* Sub-abas com SegmentedControl e contagens */}
        <SegmentedControl<JustSubView>
          options={[
            { value: 'cob', label: 'Cobrança por responsável', count: rowsResp.filter(r => r.M.need > 0).length },
            { value: 'pend', label: 'Pendentes de justificativa', count: pend.length, badgeTone: pend.length > 0 ? (A.venc > 0 ? 'bad' : 'warn') : 'default' },
            { value: 'feitas', label: 'Justificativas registradas', count: feitas.length, badgeTone: 'ok' }
          ]}
          value={subView}
          onChange={setSubView}
        />
      </div>

      {/* SUB-VISÃO 1: COBRANÇA */}
      {subView === 'cob' && (
        <div className="subview-cobranca">
          {/* 6 KPIs de SLA */}
          <div className="kpis">
            <KpiCard
              value={A.need}
              label="dias que pedem justificativa"
              tone="blue"
            />
            <KpiCard
              value={
                <>
                  {A.ok}{' '}
                  <span style={{ fontSize: '0.85rem' }}>({formatPct(A.pJ)})</span>
                </>
              }
              label="justificados"
              tone={A.pJ != null && A.pJ >= 100 ? 'ok' : 'blue'}
            />
            <KpiCard
              value={A.noPrazo}
              label="pendentes dentro do prazo"
              tone={A.noPrazo > 0 ? 'orange' : 'ok'}
            />
            <KpiCard
              value={A.venc}
              label="pendentes com prazo vencido"
              tone={A.venc > 0 ? 'bad' : 'ok'}
            />
            <KpiCard
              value={A.fora}
              label="justificados fora do prazo"
              tone={A.fora > 0 ? 'orange' : 'ok'}
            />
            <KpiCard
              value={A.tMed == null ? '—' : `${A.tMed.toFixed(1)} d`}
              label="tempo médio para justificar"
              tone="blue"
            />
          </div>

          {/* Alerta de devedor vencido */}
          {worstResp ? (
            <div className="note note-bad" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>{worstResp.p.nome}</b> tem a maior pendência vencida:{' '}
                {plural(worstResp.M.venc, 'justificativa vencida', 'justificativas vencidas')}, a mais antiga de{' '}
                {formatBr(worstResp.M.oldest)} ({plural(worstResp.M.atraso, 'dia', 'dias')} de atraso).
              </div>
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={() => openEmailModal({ mode: 'cobranca', targetRespId: worstResp.p.id })}
              >
                Cobrar agora
              </button>
            </div>
          ) : !A.pend && A.need > 0 ? (
            <div className="note note-ok" style={{ marginBottom: '20px' }}>
              Todas as justificativas do período foram registradas dentro ou fora do prazo.
            </div>
          ) : null}

          {/* Seção Cobrança por responsável */}
          <div style={{ marginBottom: '32px' }}>
            <div className="section-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--f-display)' }}>Cobrança por responsável</h3>
                <SegmentedControl<'preposto' | 'controlador' | 'gestor'>
                  options={[
                    { value: 'preposto', label: 'Prepostos', count: rowsResp.filter(r => (r.p.papel || 'preposto') === 'preposto').length },
                    { value: 'controlador', label: 'Controladores', count: rowsResp.filter(r => (r.p.papel || 'preposto') === 'controlador').length },
                    { value: 'gestor', label: 'Gestores', count: rowsResp.filter(r => (r.p.papel || 'preposto') === 'gestor').length }
                  ]}
                  value={papelFilter}
                  onChange={setPapelFilter}
                  size="sm"
                />
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                {devedores.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-accent btn-sm"
                    onClick={() => openEmailModal({ mode: 'cobranca', targetRespId: '*' })}
                  >
                    Cobrar todos com pendência ({devedores.length})
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleCopyCobrancaList}
                >
                  Copiar lista de cobrança
                </button>
              </div>
            </div>

            <DataTable
              data={filteredRespCob}
              columns={cobRespColumns}
              rowKey={r => r.p.id}
              rowClassName={r => (r === worstResp ? 'worst' : '')}
              emptyMessage="Nenhuma pessoa com esse papel ou sem pendências."
            />
          </div>

          {/* Cobrança por unidade de negócio */}
          {rowsUn.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontFamily: 'var(--f-display)', marginBottom: '12px' }}>
                Cobrança por unidade de negócio
              </h3>
              <DataTable
                data={rowsUn}
                columns={cobUnColumns}
                rowKey={r => r.u}
                emptyMessage="Sem dados por unidade de negócio."
              />
            </div>
          )}
        </div>
      )}

      {/* SUB-VISÃO 2 E 3: PENDENTES OU REGISTRADAS */}
      {subView !== 'cob' && (
        <div className="subview-detalhada">
          {/* 6 KPIs de Detalhe */}
          <div className="kpis">
            <KpiCard
              value={daysBelow.length}
              label="dias abaixo das horas"
              tone="blue"
            />
            <KpiCard
              value={pend.length}
              label="pendentes"
              tone={pend.length > 0 ? 'bad' : 'ok'}
            />
            <KpiCard
              value={feitas.length}
              label="justificados"
              tone="ok"
            />
            <KpiCard
              value={formatHours(totalGw)}
              label="perdidas com gangway"
              tone="orange"
            />
            <KpiCard
              value={formatHours(hhNaoExec)}
              label="HH não executado"
              tone="blue"
            />
            <KpiCard
              value={pend.filter(x => TODAY > prazoOf(x.D, dataset.config)).length}
              label="com prazo vencido"
              tone={pend.some(x => TODAY > prazoOf(x.D, dataset.config)) ? 'bad' : 'ok'}
            />
          </div>

          {/* Ranking de motivos */}
          {motivosRanking.length > 0 && (
            <div className="card" style={{ background: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', marginBottom: '20px', border: '1px solid var(--line)' }}>
              <h4 style={{ margin: '0 0 10px 0', fontFamily: 'var(--f-display)' }}>Motivos registrados</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {motivosRanking.map(([motivo, count]) => (
                  <span
                    key={motivo}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      background: 'var(--blue-soft)',
                      color: 'var(--blue)',
                      fontSize: '0.82rem',
                      fontWeight: 600
                    }}
                  >
                    {motivo} · {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          <DataTable
            data={activeList}
            columns={detailColumns}
            rowKey={r => `${r.mat}_${r.D}`}
            searchable
            searchPlaceholder="Buscar por técnico, data ou plataforma..."
            getSearchString={r => `${resolveTechName(r.mat, dataset)} ${r.mat} ${r.D} ${r.p} ${r.r}`}
            emptyMessage={
              subView === 'pend'
                ? 'Nenhuma justificativa pendente neste período.'
                : 'Nenhuma justificativa registrada neste período.'
            }
          />
        </div>
      )}
    </div>
  );
}
