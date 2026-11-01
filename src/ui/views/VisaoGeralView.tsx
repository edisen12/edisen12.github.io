import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { KpiCard } from '../components/KpiCard';
import { StatusPill } from '../components/StatusPill';
import { MeterBar } from '../components/MeterBar';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl } from '../components/SegmentedControl';
import { PAPEIS_LABEL, PAPEIS_PLURAL } from '../../config/constants';
import type {
  AggregatedMetrics,
  DayTechRow,
  PeriodDayEntry,
  PeriodWindow,
  Pessoa,
  Plataforma,
  StatusMeta
} from '../../domain/types';
import {
  aggregateDays,
  armadorOf,
  computeDayRows,
  computePeriodDays,
  formatPlatformLabel,
  isPersonResponsible,
  lookupPlatform,
  passesFilter,
  prazoOf,
  resolveTechSituation,
  resolveTechName,
  statusOf
} from '../../domain/calculations';
import { periodDisplayName } from '../../domain/periods';
import { formatBr, formatBrShort, todayIso } from '../../utils/date';
import {
  formatHours,
  formatPct,
  formatSignedHours,
  plural
} from '../../utils/format';

export function VisaoGeralView() {
  const {
    dataset,
    pidx,
    activePeriod,
    filters,
    setFilters,
    updateFilter,
    setActiveTab,
    openFichaDrawer,
    openEmailModal,
    isGlobal
  } = useApp();

  const [papelFilter, setPapelFilter] = useState<'preposto' | 'controlador' | 'gestor'>('preposto');
  const [operacionalTab, setOperacionalTab] = useState<'plataformas' | 'unidades' | 'armadores'>('plataformas');

  const TODAY = todayIso();
  const P = activePeriod;
  const D = filters.fDate;
  const fResp = filters.fResp;
  const fPlat = filters.fPlat;
  const fReg = filters.fReg;

  // Dias do período respeitando os filtros atuais
  const days = useMemo(() => {
    return computePeriodDays(P, dataset, filters, pidx);
  }, [P, dataset, filters, pidx]);

  // Linhas do dia de referência
  const dRows = useMemo(() => {
    if (!D) return [];
    return computeDayRows(D, dataset, pidx)
      .filter(r => passesFilter({ p: r.p, r: r.r }, filters, dataset.pessoas))
      .map(r => ({
        mat: r.mat,
        D,
        p: r.p,
        r: r.r,
        d: r.d,
        e: r.e,
        sem: r.sem,
        j: r.j
      }));
  }, [D, dataset, pidx, filters]);

  // Breadcrumbs (exibidos somente quando há filtro de drill-down ativo)
  const renderCrumbs = () => {
    if (!fReg && !fPlat && !fResp) return null;
    const ps = fResp ? dataset.pessoas[fResp] : null;

    return (
      <div className="crumbs" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setFilters(prev => ({ ...prev, fResp: '', fPlat: '', fReg: '' }));
          }}
        >
          Visão geral do contrato
        </button>

        {fReg && !ps && (
          <>
            <span style={{ color: 'var(--ink-muted)' }}>›</span>
            <b>{fReg}</b>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => updateFilter('fReg', '')}
              style={{ fontSize: '0.8rem' }}
            >
              tirar filtro
            </button>
          </>
        )}

        {ps && (
          <>
            <span style={{ color: 'var(--ink-muted)' }}>›</span>
            {fPlat ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => updateFilter('fPlat', '')}
              >
                {ps.nome}
              </button>
            ) : (
              <b>{ps.nome}</b>
            )}
          </>
        )}

        {fPlat && (
          <>
            <span style={{ color: 'var(--ink-muted)' }}>›</span>
            <b>{fPlat}</b>
          </>
        )}
      </div>
    );
  };

  // KPIs de Escopo (6 cards padronizados)
  const renderKpis = (A: AggregatedMetrics, Ad: AggregatedMetrics) => {
    const kpiTone = (st: StatusMeta): 'ok' | 'warn' | 'bad' | 'blue' => {
      if (st === 'ok') return 'ok';
      if (st === 'warn') return 'warn';
      if (st === 'bad') return 'bad';
      return 'blue';
    };

    return (
      <div className="kpis">
        <KpiCard
          value={A.tec}
          label="técnicos no período"
          tone="blue"
        />
        <KpiCard
          value={formatPct(A.p)}
          label="execução acumulada no período"
          tone={kpiTone(A.st)}
        />
        <KpiCard
          value={D ? formatPct(Ad.p) : '—'}
          label={`execução em ${D ? formatBrShort(D) : '—'}`}
          tone={kpiTone(Ad.st)}
        />
        <KpiCard
          value={A.inf}
          label={`dias com problema (${A.pInf == null ? '—' : formatPct(A.pInf)} dos dias)`}
          tone={A.inf > 0 ? 'bad' : 'ok'}
        />
        <KpiCard
          value={A.abAcc}
          label="técnicos abaixo da meta no acumulado"
          tone={A.abAcc > 0 ? 'bad' : 'ok'}
        />
        <KpiCard
          value={
            <>
              {A.pend}
              {A.venc > 0 && (
                <span style={{ fontSize: '0.8rem', marginLeft: '6px', color: 'var(--bad)' }}>
                  ({A.venc} vencidas)
                </span>
              )}
            </>
          }
          label="justificativas pendentes"
          tone={A.pend > 0 ? 'orange' : 'ok'}
        />
      </div>
    );
  };

  // -------------------------------------------------------------
  // MODO 3: DETALHE DA PLATAFORMA (vPlatDet)
  // -------------------------------------------------------------
  if (fPlat) {
    const platSigla = fPlat;
    const platDays = days.filter(x => x.p === platSigla);
    const A = aggregateDays(platDays, dataset.config);
    const platObj = lookupPlatform(pidx, platSigla);
    const dRowsPlat = dRows.filter(r => r.p === platSigla);
    const Ad = aggregateDays(dRowsPlat, dataset.config);

    const rs = Object.values(dataset.pessoas).filter(p =>
      isPersonResponsible(p, { p: platSigla, r: platObj?.un || '' })
    );

    // Lista de técnicos da plataforma
    const mats = new Set<string>(platDays.map(x => x.mat));
    dataset.carteira.forEach(c => {
      const cPlat = c.plataforma_sigla;
      if (cPlat === platSigla && !(c.data_fim < P.ini || c.data_inicio > P.fim)) {
        mats.add(c.matricula);
      }
    });

    const metaMin = dataset.config.meta_percentual - 0.0001;

    interface PlatTechRow {
      mat: string;
      nome: string;
      a: AggregatedMetrics;
      sit: { t: string; s: string; c: StatusMeta };
      ld: PeriodDayEntry | null;
      cd: number;
    }

    const techRows: PlatTechRow[] = Array.from(mats).map(mat => {
      const dd = platDays.filter(x => x.mat === mat);
      const a = aggregateDays(dd, dataset.config);
      const sit = resolveTechSituation(mat, platSigla, dataset, pidx);
      const ld = dd.length ? dd[dd.length - 1] : null;

      // Dias em carteira nesta plataforma
      let cd = 0;
      dataset.carteira.forEach(c => {
        if (c.matricula === mat && c.plataforma_sigla === platSigla) {
          const ini = c.data_inicio > P.ini ? c.data_inicio : P.ini;
          const fim = c.data_fim < P.fim ? c.data_fim : P.fim;
          if (ini <= fim) {
            const d1 = new Date(ini).getTime();
            const d2 = new Date(fim).getTime();
            cd += Math.round((d2 - d1) / 864e5) + 1;
          }
        }
      });

      return {
        mat,
        nome: resolveTechName(mat, dataset),
        a,
        sit,
        ld,
        cd
      };
    }).sort((x, y) => (x.a.p ?? 999) - (y.a.p ?? 999));

    const ab = techRows.filter(r => r.a.n > 0 && (r.a.p ?? 0) < metaMin);
    const desAb = ab.filter(r => r.sit.t === 'Desembarcou');

    const techColumns: DataTableColumn<PlatTechRow>[] = [
      {
        key: 'st',
        header: 'Acumulado',
        width: '120px',
        render: r => <StatusPill status={r.a.n > 0 ? r.a.st : 'sem'} />
      },
      {
        key: 'nome',
        header: 'Técnico',
        width: '240px',
        render: r => (
          <div style={{ minWidth: '220px', textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <button
              type="button"
              className="btn-link"
              onClick={() => openFichaDrawer(r.mat)}
              style={{ fontWeight: 600, color: 'var(--blue)', textAlign: 'left', whiteSpace: 'nowrap', display: 'block' }}
            >
              {r.nome}
            </button>
            <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
              Mat. {r.mat}
            </div>
          </div>
        )
      },
      {
        key: 'sit',
        header: 'Situação',
        width: '150px',
        render: r => (
          <div>
            <StatusPill status={r.sit.c} text={r.sit.t} />
            <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
              {r.sit.s}
            </div>
          </div>
        )
      },
      {
        key: 'dias',
        header: 'Dias no período',
        align: 'right',
        width: '120px',
        sortValue: r => r.a.n,
        render: r => (
          <div>
            {r.a.n}
            {r.cd > 0 && r.cd !== r.a.n && (
              <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                {r.cd} na carteira
              </div>
            )}
          </div>
        )
      },
      {
        key: 'disp',
        header: 'Disponível',
        align: 'right',
        width: '100px',
        sortValue: r => r.a.d,
        render: r => formatHours(r.a.d)
      },
      {
        key: 'exec',
        header: 'Executado',
        align: 'right',
        width: '100px',
        sortValue: r => r.a.e,
        render: r => formatHours(r.a.e)
      },
      {
        key: 'pct',
        header: '% no período',
        width: '140px',
        sortValue: r => r.a.p ?? -1,
        render: r => (r.a.n > 0 ? <MeterBar pct={r.a.p} status={r.a.st} /> : <span className="sub">—</span>)
      },
      {
        key: 'saldo',
        header: 'Saldo',
        align: 'right',
        width: '100px',
        sortValue: r => r.a.saldo,
        render: r => (
          <span style={{ color: r.a.saldo >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
            {r.a.n > 0 ? formatSignedHours(r.a.saldo) : '—'}
          </span>
        )
      },
      {
        key: 'inf',
        header: 'Dias com problema',
        align: 'right',
        width: '120px',
        sortValue: r => r.a.inf,
        render: r => (r.a.inf > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.a.inf}</span> : '—')
      },
      {
        key: 'meta',
        header: 'Atingiu a meta?',
        width: '130px',
        render: r => (
          r.a.n > 0 ? (
            r.a.p !== null && r.a.p >= metaMin ? (
              <StatusPill status="ok" text="Sim" />
            ) : (
              <StatusPill status="bad" text="Não" />
            )
          ) : (
            '—'
          )
        )
      },
      {
        key: 'pend',
        header: 'Pendentes',
        align: 'right',
        width: '100px',
        sortValue: r => r.a.pend,
        render: r => (r.a.pend > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.a.pend}</span> : '—')
      },
      {
        key: 'ld',
        header: 'Último dia',
        width: '130px',
        render: r => (
          r.ld ? (
            <span>
              {formatBrShort(r.ld.D)} · {formatPct(r.ld.d > 0 ? (r.ld.e / r.ld.d) * 100 : null)}
            </span>
          ) : (
            '—'
          )
        )
      }
    ];

    return (
      <div className="view-visao-geral-plat">
        {renderCrumbs()}

        <div className="card-header-view" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
              {platObj ? formatPlatformLabel(platObj) : platSigla}
            </h2>
            <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
              {platObj?.un || 'Sem unidade'} · {periodDisplayName(P)} ({formatBr(P.ini)} a {formatBr(P.fim)}) · Responsáveis:{' '}
              {rs.length ? rs.map(x => `${PAPEIS_LABEL[x.papel] || 'Preposto'} ${x.nome}`).join(', ') : 'nenhum cadastrado'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {Ad.inf > 0 && D && (
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => openEmailModal({ mode: 'daily', plats: [platSigla], date: D })}
              >
                E-mail aos responsáveis
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => updateFilter('fPlat', '')}
            >
              Voltar
            </button>
          </div>
        </div>

        {renderKpis(A, Ad)}

        {ab.length > 0 ? (
          <div className="note note-bad" style={{ marginBottom: '16px' }}>
            <b>{plural(ab.length, 'técnico', 'técnicos')} abaixo da meta no acumulado do período</b>
            {desAb.length > 0 && `, ${desAb.length} já ${plural(desAb.length, 'desembarcado', 'desembarcados')}`}.
          </div>
        ) : (
          <div className="note note-ok" style={{ marginBottom: '16px' }}>
            Todos os técnicos desta plataforma estão na meta no período.
          </div>
        )}

        <DataTable
          data={techRows}
          columns={techColumns}
          rowKey={r => r.mat}
          searchable
          searchPlaceholder="Filtrar técnico nesta plataforma..."
          getSearchString={r => `${r.nome} ${r.mat} ${r.sit.t}`}
          emptyMessage="Nenhum técnico nesta plataforma neste período."
        />
      </div>
    );
  }

  // -------------------------------------------------------------
  // MODO 2: DETALHE POR RESPONSÁVEL (vRespDet)
  // -------------------------------------------------------------
  if (fResp) {
    const ps = dataset.pessoas[fResp];
    if (ps) {
      const respDays = days.filter(x => isPersonResponsible(ps, { p: x.p, r: x.r }));
      const A = aggregateDays(respDays, dataset.config);
      const dRowsResp = dRows.filter(r => isPersonResponsible(ps, { p: r.p, r: r.r }));
      const Ad = aggregateDays(dRowsResp, dataset.config);

      const nPl = (ps.plats || []).length;
      const probPlats = Array.from(A.plats)
        .map(p => ({ p, A: aggregateDays(respDays.filter(x => x.p === p), dataset.config) }))
        .filter(x => x.A.st !== 'ok');

      interface PlatSummaryRow {
        p: string;
        u: string;
        A: AggregatedMetrics;
        Ad: AggregatedMetrics;
      }

      const platRows: PlatSummaryRow[] = Array.from(new Set(respDays.map(x => x.p)))
        .map(p => {
          const pDays = respDays.filter(x => x.p === p);
          const pAdDays = dRowsResp.filter(x => x.p === p);
          const first = respDays.find(x => x.p === p);
          return {
            p,
            u: first?.r || '',
            A: aggregateDays(pDays, dataset.config),
            Ad: aggregateDays(pAdDays, dataset.config)
          };
        })
        .sort((a, b) => (a.A.p ?? 999) - (b.A.p ?? 999) || b.A.inf - a.A.inf);

      const platCols: DataTableColumn<PlatSummaryRow>[] = [
        {
          key: 'plat',
          header: 'Plataforma',
          width: '160px',
          render: r => (
            <button
              type="button"
              className="btn-link"
              onClick={() => updateFilter('fPlat', r.p)}
              style={{ fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap' }}
            >
              {r.p}
            </button>
          )
        },
        {
          key: 'un',
          header: 'Unidade',
          width: '160px',
          render: r => {
            const arm = armadorOf(pidx, r.p);
            return (
              <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                {r.u}
                {arm && <div>Armador {arm}</div>}
              </div>
            );
          }
        },
        {
          key: 'tec',
          header: 'Técnicos',
          align: 'right',
          width: '90px',
          sortValue: r => r.A.tec,
          render: r => r.A.tec
        },
        {
          key: 'dia',
          header: D ? `Dia ${formatBrShort(D)}` : 'Dia',
          width: '130px',
          render: r => (r.Ad.n > 0 ? <MeterBar pct={r.Ad.p} status={r.Ad.st} /> : <span className="sub">sem dados</span>)
        },
        {
          key: 'abDia',
          header: 'Abaixo no dia',
          align: 'right',
          width: '110px',
          sortValue: r => r.Ad.inf,
          render: r => (r.Ad.inf > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.Ad.inf}</span> : '—')
        },
        {
          key: 'acc',
          header: 'Acumulado do período',
          width: '130px',
          render: r => <MeterBar pct={r.A.p} status={r.A.st} />
        },
        {
          key: 'saldo',
          header: 'Saldo',
          align: 'right',
          width: '100px',
          sortValue: r => r.A.saldo,
          render: r => (
            <span style={{ color: r.A.saldo >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
              {formatSignedHours(r.A.saldo)}
            </span>
          )
        },
        {
          key: 'inf',
          header: 'Dias com problema',
          align: 'right',
          width: '120px',
          sortValue: r => r.A.inf,
          render: r => r.A.inf
        },
        {
          key: 'abAcc',
          header: 'Abaixo no acumulado',
          align: 'right',
          width: '120px',
          sortValue: r => r.A.abAcc,
          render: r => (r.A.abAcc > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.A.abAcc}</span> : '—')
        },
        {
          key: 'pend',
          header: 'Pendentes',
          align: 'right',
          width: '100px',
          sortValue: r => r.A.pend,
          render: r => (r.A.pend > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.A.pend}</span> : '—')
        },
        {
          key: 'acoes',
          header: 'Ações',
          width: '130px',
          render: r => (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => updateFilter('fPlat', r.p)}
              >
                Técnicos
              </button>
              {r.Ad.inf > 0 && D && (
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  onClick={() => openEmailModal({ mode: 'daily', plats: [r.p], date: D })}
                >
                  E-mail
                </button>
              )}
            </div>
          )
        }
      ];

      return (
        <div className="view-visao-geral-resp">
          {renderCrumbs()}

          <div className="card-header-view" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
                {ps.nome} · {PAPEIS_LABEL[ps.papel] || 'Preposto'}
              </h2>
              <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
                Responsável por {plural(nPl, 'plataforma', 'plataformas')}
                {ps.uns?.length ? ` e pelas unidades ${ps.uns.join(', ')}` : ''}. {A.plats.size} delas com técnicos no período.
              </div>
            </div>

            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => updateFilter('fResp', '')}
            >
              Voltar
            </button>
          </div>

          {renderKpis(A, Ad)}

          {probPlats.length > 0 ? (
            <div className="note note-bad" style={{ marginBottom: '16px' }}>
              <b>{probPlats.length} de {A.plats.size} plataformas estão abaixo da meta no acumulado: </b>
              {probPlats
                .sort((a, b) => (a.A.p ?? 999) - (b.A.p ?? 999))
                .map((x, i) => (
                  <React.Fragment key={x.p}>
                    {i > 0 && ', '}
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => updateFilter('fPlat', x.p)}
                      style={{ fontWeight: 600, color: 'var(--bad)' }}
                    >
                      {x.p}
                    </button>{' '}
                    ({formatPct(x.A.p)})
                  </React.Fragment>
                ))}
              .
            </div>
          ) : (
            <div className="note note-ok" style={{ marginBottom: '16px' }}>
              Todas as plataformas de {ps.nome} estão na meta no acumulado do período.
            </div>
          )}

          <h3 style={{ fontFamily: 'var(--f-display)', marginTop: '24px', marginBottom: '12px' }}>
            Plataformas de {ps.nome}
          </h3>

          <DataTable
            data={platRows}
            columns={platCols}
            rowKey={r => r.p}
            rowClassName={r => (r.A.st === 'bad' ? 'worst' : '')}
            searchable
            searchPlaceholder="Buscar plataforma..."
            getSearchString={r => `${r.p} ${r.u}`}
            emptyMessage="Nenhuma plataforma com técnicos para este responsável no período."
          />
        </div>
      );
    }
  }

  // -------------------------------------------------------------
  // MODO 1: VISÃO GLOBAL / CARTEIRA GERAL (vGestao)
  // -------------------------------------------------------------
  const A = aggregateDays(days, dataset.config);
  const Ad = aggregateDays(dRows, dataset.config);

  const pessoasList = Object.values(dataset.pessoas);

  // Linhas por responsável
  const rowsResp = pessoasList.map(p => {
    const dd = days.filter(x => isPersonResponsible(p, { p: x.p, r: x.r }));
    const dr = dRows.filter(x => isPersonResponsible(p, { p: x.p, r: x.r }));
    return {
      p,
      A: aggregateDays(dd, dataset.config),
      Ad: aggregateDays(dr, dataset.config),
      nPl: (p.plats || []).length
    };
  });

  const semRespDays = days.filter(x => !pessoasList.some(p => isPersonResponsible(p, { p: x.p, r: x.r })));
  const semA = aggregateDays(semRespDays, dataset.config);

  const filteredRespList = rowsResp
    .filter(r => (r.p.papel || 'preposto') === papelFilter)
    .sort((a, b) => (a.A.n ? 0 : 1) - (b.A.n ? 0 : 1) || (a.A.p ?? 999) - (b.A.p ?? 999) || b.A.inf - a.A.inf);

  const comDados = rowsResp.filter(r => r.A.n > 0);
  const worstR = comDados
    .filter(r => (r.p.papel || 'preposto') === 'preposto')
    .sort((a, b) => (a.A.p ?? 999) - (b.A.p ?? 999) || b.A.inf - a.A.inf)[0];

  // UNs
  const regsList = Array.from(A.regs).map(u => ({
    u,
    A: aggregateDays(days.filter(x => x.r === u), dataset.config),
    Ad: aggregateDays(dRows.filter(x => x.r === u), dataset.config)
  }));
  const worstU = regsList.slice().sort((a, b) => b.A.inf - a.A.inf || (a.A.p ?? 999) - (b.A.p ?? 999))[0];

  // Plataformas
  const platsList = Array.from(A.plats)
    .map(p => ({
      p,
      A: aggregateDays(days.filter(x => x.p === p), dataset.config),
      Ad: aggregateDays(dRows.filter(x => x.p === p), dataset.config),
      u: (days.find(x => x.p === p) || {}).r || ''
    }))
    .sort((a, b) => (a.A.p ?? 999) - (b.A.p ?? 999) || b.A.inf - a.A.inf);
  const worstP = platsList[0];

  // Técnicos
  const tecsList = Object.entries(A.mats).map(([m, v]) => {
    const pctVal = v.d > 0 ? (v.e / v.d) * 100 : null;
    return {
      m,
      p: pctVal,
      saldo: v.e - v.d,
      inf: v.inf
    };
  }).sort((a, b) => (a.p ?? 999) - (b.p ?? 999));
  const worstT = tecsList[0];

  // Armadores
  const armDays = days.filter(x => armadorOf(pidx, x.p));
  const armadoresList = Array.from(new Set(armDays.map(x => armadorOf(pidx, x.p)))).map(k => ({
    k,
    A: aggregateDays(armDays.filter(x => armadorOf(pidx, x.p) === k), dataset.config),
    Ad: aggregateDays(dRows.filter(x => armadorOf(pidx, x.p) === k), dataset.config)
  })).sort((a, b) => (a.A.p ?? 999) - (b.A.p ?? 999));

  const metaMin = dataset.config.meta_percentual - 0.0001;
  const platsAbaixoMeta = platsList.filter(p => p.A.st === 'bad' || (p.A.p ?? 0) < metaMin);
  const tecsComDeficit = tecsList.filter(t => t.saldo < 0 || t.inf > 0);
  const pendentesList = days.filter(x => x.e < x.d - 0.001 && !x.j);

  const countPrepostos = pessoasList.filter(p => (p.papel || 'preposto') === 'preposto').length;
  const countControladores = pessoasList.filter(p => (p.papel || 'preposto') === 'controlador').length;
  const countGestores = pessoasList.filter(p => (p.papel || 'preposto') === 'gestor').length;

  return (
    <div className="view-visao-geral-gestao">
      {renderCrumbs()}

      <div className="card-header-view" style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
          Visão geral do contrato · {periodDisplayName(P)} ({formatBr(P.ini)} a {formatBr(P.fim)})
        </h2>
        <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
          Dia de referência: {formatBr(D)} · meta {formatHours(dataset.config.hh_dia)} por dia embarcado
        </div>
      </div>

      {!days.length ? (
        <div className="note" style={{ textAlign: 'center', padding: '32px' }}>
          Sem HH executado neste período{fReg ? ' nesta unidade' : ''}.
        </div>
      ) : (
        <>
          {renderKpis(A, Ad)}

          {/* Onde está o problema - 3 Colunas Analíticas Alinhadas */}
          <div className="problem-section" style={{ marginBottom: '28px' }}>
            <h3 style={{ fontFamily: 'var(--f-display)', marginBottom: '14px' }}>Onde está o problema</h3>
            <div className="problem-grid">
              {/* Coluna 1: Plataformas abaixo da meta */}
              <div className="problem-col">
                <div className="problem-col-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', paddingBottom: '8px', borderBottom: '2px solid var(--line)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--ink)' }}>
                    Plataformas abaixo da meta
                  </div>
                  <span className={`status-pill ${platsAbaixoMeta.length > 0 ? 'bad' : 'ok'}`} style={{ fontSize: '0.78rem' }}>
                    {platsAbaixoMeta.length}
                  </span>
                </div>
                {platsAbaixoMeta.length === 0 ? (
                  <div style={{ padding: '12px 8px', fontSize: '0.84rem', color: 'var(--ok)', fontWeight: 600 }}>
                    ✓ Todas as plataformas na meta ({dataset.config.meta_percentual}%).
                  </div>
                ) : (
                  <div className="problem-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {platsAbaixoMeta.slice(0, 5).map(p => (
                      <div
                        key={p.p}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          background: 'var(--surface-alt)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--line)'
                        }}
                      >
                        <div style={{ minWidth: 0, paddingRight: '8px' }}>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => updateFilter('fPlat', p.p)}
                            style={{ fontWeight: 700, color: 'var(--blue)', fontSize: '0.88rem', textAlign: 'left', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={`Filtrar plataforma ${p.p}`}
                          >
                            {p.p}
                          </button>
                          <div style={{ fontSize: '0.74rem', color: 'var(--ink-muted)' }}>
                            {p.u} · {plural(p.A.inf, 'dia', 'dias')} com problema
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ fontWeight: 700, color: 'var(--bad)', fontSize: '0.88rem' }}>
                            {formatPct(p.A.p)}
                          </span>
                          <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                            {formatSignedHours(p.A.saldo)}
                          </div>
                        </div>
                      </div>
                    ))}
                    {platsAbaixoMeta.length > 5 && (
                      <div style={{ padding: '4px', fontSize: '0.75rem', color: 'var(--ink-muted)', textAlign: 'center' }}>
                        +{platsAbaixoMeta.length - 5} outras plataformas abaixo
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Coluna 2: Técnicos com maior déficit */}
              <div className="problem-col">
                <div className="problem-col-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', paddingBottom: '8px', borderBottom: '2px solid var(--line)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--ink)' }}>
                    Técnicos com maior déficit
                  </div>
                  <span className={`status-pill ${tecsComDeficit.length > 0 ? 'bad' : 'ok'}`} style={{ fontSize: '0.78rem' }}>
                    {tecsComDeficit.length}
                  </span>
                </div>
                {tecsComDeficit.length === 0 ? (
                  <div style={{ padding: '12px 8px', fontSize: '0.84rem', color: 'var(--ok)', fontWeight: 600 }}>
                    ✓ Nenhum técnico com déficit de horas.
                  </div>
                ) : (
                  <div className="problem-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {tecsComDeficit.slice(0, 5).map(t => (
                      <div
                        key={t.m}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          background: 'var(--surface-alt)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--line)'
                        }}
                      >
                        <div style={{ minWidth: 0, paddingRight: '8px' }}>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => openFichaDrawer(t.m)}
                            style={{ fontWeight: 700, color: 'var(--blue)', fontSize: '0.88rem', textAlign: 'left', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={`Abrir ficha do técnico ${resolveTechName(t.m, dataset)}`}
                          >
                            {resolveTechName(t.m, dataset)}
                          </button>
                          <div style={{ fontSize: '0.74rem', color: 'var(--ink-muted)' }}>
                            Mat. {t.m} · {plural(t.inf, 'dia', 'dias')} abaixo
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ fontWeight: 700, color: 'var(--bad)', fontSize: '0.88rem' }}>
                            {formatSignedHours(t.saldo)}
                          </span>
                          <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                            {formatPct(t.p)}
                          </div>
                        </div>
                      </div>
                    ))}
                    {tecsComDeficit.length > 5 && (
                      <div style={{ padding: '4px', fontSize: '0.75rem', color: 'var(--ink-muted)', textAlign: 'center' }}>
                        +{tecsComDeficit.length - 5} outros técnicos com déficit
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Coluna 3: Dias pendentes sem justificativa */}
              <div className="problem-col">
                <div className="problem-col-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', paddingBottom: '8px', borderBottom: '2px solid var(--line)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--ink)' }}>
                    Dias pendentes sem justificativa
                  </div>
                  <span className={`status-pill ${A.venc > 0 ? 'bad' : A.pend > 0 ? 'warn' : 'ok'}`} style={{ fontSize: '0.78rem' }}>
                    {A.pend} {A.venc > 0 ? `(${A.venc} vencidas)` : ''}
                  </span>
                </div>
                {A.pend === 0 ? (
                  <div style={{ padding: '12px 8px', fontSize: '0.84rem', color: 'var(--ok)', fontWeight: 600 }}>
                    ✓ Todas as justificativas do período em dia.
                  </div>
                ) : (
                  <div className="problem-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {pendentesList.slice(0, 5).map(dEntry => {
                      const techName = resolveTechName(dEntry.mat, dataset);
                      const isVencido = TODAY > prazoOf(dEntry.D, dataset.config);
                      return (
                        <div
                          key={`${dEntry.mat}_${dEntry.D}`}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 10px',
                            background: 'var(--surface-alt)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--line)'
                          }}
                        >
                          <div style={{ minWidth: 0, paddingRight: '8px' }}>
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => openFichaDrawer(dEntry.mat)}
                              style={{ fontWeight: 700, color: 'var(--blue)', fontSize: '0.88rem', textAlign: 'left', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                              {techName}
                            </button>
                            <div style={{ fontSize: '0.74rem', color: 'var(--ink-muted)' }}>
                              {dEntry.p} · Dia {formatBrShort(dEntry.D)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <span style={{ fontWeight: 600, color: isVencido ? 'var(--bad)' : 'var(--warn)', fontSize: '0.78rem' }}>
                              {isVencido ? 'Vencido' : 'Pendente'}
                            </span>
                            <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                              -{formatHours(Math.max(0, dEntry.d - dEntry.e))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {A.pend > 5 && (
                      <div style={{ padding: '4px', fontSize: '0.75rem', color: 'var(--ink-muted)', textAlign: 'center' }}>
                        +{A.pend - 5} outras pendências
                      </div>
                    )}
                  </div>
                )}
                {semRespDays.length > 0 && (
                  <div style={{ marginTop: '8px', padding: '6px 8px', background: 'var(--orange-soft)', borderRadius: 'var(--radius-xs)', fontSize: '0.74rem', color: 'var(--ink)' }}>
                    ⚠️ {plural(semA.plats.size, 'plataforma', 'plataformas')} sem responsável cadastrado.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Por responsável (apenas para escopo global) */}
          {isGlobal && (
            <div style={{ marginBottom: '32px' }}>
              <div className="section-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--f-display)' }}>Por responsável</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className="toolbar-label" style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', fontWeight: 600 }}>
                    Exibir carteira de:
                  </span>
                  <SegmentedControl<'preposto' | 'controlador' | 'gestor'>
                    options={[
                      { value: 'preposto', label: 'Prepostos', count: countPrepostos },
                      { value: 'controlador', label: 'Controladores', count: countControladores },
                      { value: 'gestor', label: 'Gestores', count: countGestores }
                    ]}
                    value={papelFilter}
                    onChange={setPapelFilter}
                    size="sm"
                  />
                </div>
              </div>

              <DataTable
                data={filteredRespList}
                columns={[
                  {
                    key: 'nome',
                    header: 'Responsável',
                    width: '260px',
                    render: r => (
                      <div style={{ minWidth: '240px', textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => updateFilter('fResp', r.p.id)}
                          style={{
                            fontWeight: 700,
                            color: 'var(--blue)',
                            textAlign: 'left',
                            whiteSpace: 'nowrap',
                            display: 'block'
                          }}
                        >
                          {r.p.nome}
                        </button>
                        {r === worstR && r.A.st !== 'ok' && (
                          <div style={{ color: 'var(--bad)', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            maior problema
                          </div>
                        )}
                        {!r.A.n && (
                          <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                            {r.nPl || r.p.uns?.length ? 'sem técnicos no período' : 'nenhuma plataforma associada'}
                          </div>
                        )}
                      </div>
                    )
                  },
                  {
                    key: 'plats',
                    header: 'Plataformas com técnicos',
                    align: 'right',
                    width: '120px',
                    sortValue: r => r.A.plats.size,
                    render: r => r.A.plats.size
                  },
                  {
                    key: 'tec',
                    header: 'Técnicos',
                    align: 'right',
                    width: '90px',
                    sortValue: r => r.A.tec,
                    render: r => r.A.tec
                  },
                  {
                    key: 'dia',
                    header: D ? `Dia ${formatBrShort(D)}` : 'Dia',
                    width: '130px',
                    render: r => (r.Ad.n > 0 ? <MeterBar pct={r.Ad.p} status={r.Ad.st} /> : <span className="sub">sem dados</span>)
                  },
                  {
                    key: 'abDia',
                    header: 'Abaixo no dia',
                    align: 'right',
                    width: '110px',
                    sortValue: r => r.Ad.inf,
                    render: r => (r.Ad.inf > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.Ad.inf}</span> : '—')
                  },
                  {
                    key: 'acc',
                    header: 'Acumulado do período',
                    width: '130px',
                    render: r => <MeterBar pct={r.A.p} status={r.A.st} />
                  },
                  {
                    key: 'saldo',
                    header: 'Saldo',
                    align: 'right',
                    width: '100px',
                    sortValue: r => r.A.saldo,
                    render: r => (
                      <span style={{ color: r.A.saldo >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
                        {formatSignedHours(r.A.saldo)}
                      </span>
                    )
                  },
                  {
                    key: 'inf',
                    header: 'Dias com problema',
                    align: 'right',
                    width: '120px',
                    sortValue: r => r.A.inf,
                    render: r => (
                      <div>
                        {r.A.inf}
                        <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                          {formatPct(r.A.pInf)} dos dias
                        </div>
                      </div>
                    )
                  },
                  {
                    key: 'abAcc',
                    header: 'Abaixo no acumulado',
                    align: 'right',
                    width: '130px',
                    sortValue: r => r.A.abAcc,
                    render: r => (r.A.abAcc > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.A.abAcc} de {r.A.tec}</span> : '—')
                  },
                  {
                    key: 'pend',
                    header: 'Pendentes',
                    align: 'right',
                    width: '100px',
                    sortValue: r => r.A.pend,
                    render: r => (
                      <div>
                        {r.A.pend > 0 ? r.A.pend : '—'}
                        {r.A.venc > 0 && (
                          <div style={{ color: 'var(--bad)', fontSize: '0.75rem', fontWeight: 600 }}>
                            {r.A.venc} vencidas
                          </div>
                        )}
                      </div>
                    )
                  },
                  {
                    key: 'acoes',
                    header: '',
                    width: '80px',
                    render: r => (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => updateFilter('fResp', r.p.id)}
                      >
                        Abrir
                      </button>
                    )
                  }
                ]}
                rowKey={r => r.p.id}
                rowClassName={r => (r === worstR && r.A.st !== 'ok' ? 'worst' : '')}
                emptyMessage="Nenhuma pessoa cadastrada com esse papel."
              />
            </div>
          )}

          {/* Desempenho por Unidade e Plataforma */}
          <div style={{ marginBottom: '32px' }}>
            <div className="section-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--f-display)' }}>Desempenho por Unidade e Plataforma</h3>
              <SegmentedControl<'plataformas' | 'unidades' | 'armadores'>
                options={[
                  { value: 'plataformas', label: 'Plataformas', count: platsList.length },
                  { value: 'unidades', label: 'Unidades (UN)', count: regsList.length },
                  ...(armadoresList.length > 0 ? [{ value: 'armadores' as const, label: 'Armadores', count: armadoresList.length }] : [])
                ]}
                value={operacionalTab}
                onChange={setOperacionalTab}
                size="sm"
              />
            </div>

            {operacionalTab === 'unidades' && (
              <DataTable
                data={regsList.sort((a, b) => (a.A.p ?? 999) - (b.A.p ?? 999))}
                columns={[
                  {
                    key: 'un',
                    header: 'Unidade',
                    width: '200px',
                    render: r => (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => updateFilter('fReg', r.u)}
                        style={{ fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap' }}
                      >
                        {r.u}
                      </button>
                    )
                  },
                  {
                    key: 'plats',
                    header: 'Plataformas',
                    align: 'right',
                    width: '110px',
                    sortValue: r => r.A.plats.size,
                    render: r => r.A.plats.size
                  },
                  {
                    key: 'tec',
                    header: 'Técnicos',
                    align: 'right',
                    width: '90px',
                    sortValue: r => r.A.tec,
                    render: r => r.A.tec
                  },
                  {
                    key: 'dia',
                    header: D ? `Dia ${formatBrShort(D)}` : 'Dia',
                    width: '130px',
                    render: r => (r.Ad.n > 0 ? <MeterBar pct={r.Ad.p} status={r.Ad.st} /> : <span className="sub">sem dados</span>)
                  },
                  {
                    key: 'acc',
                    header: 'Acumulado do período',
                    width: '130px',
                    render: r => <MeterBar pct={r.A.p} status={r.A.st} />
                  },
                  {
                    key: 'saldo',
                    header: 'Saldo',
                    align: 'right',
                    width: '100px',
                    sortValue: r => r.A.saldo,
                    render: r => (
                      <span style={{ color: r.A.saldo >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
                        {formatSignedHours(r.A.saldo)}
                      </span>
                    )
                  },
                  {
                    key: 'inf',
                    header: 'Dias com problema',
                    align: 'right',
                    width: '120px',
                    sortValue: r => r.A.inf,
                    render: r => (
                      <div>
                        {r.A.inf}
                        <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                          {formatPct(r.A.pInf)} dos dias
                        </div>
                      </div>
                    )
                  },
                  {
                    key: 'abAcc',
                    header: 'Abaixo no acumulado',
                    align: 'right',
                    width: '120px',
                    sortValue: r => r.A.abAcc,
                    render: r => (r.A.abAcc > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.A.abAcc} de {r.A.tec}</span> : '—')
                  },
                  {
                    key: 'pend',
                    header: 'Pendentes',
                    align: 'right',
                    width: '100px',
                    sortValue: r => r.A.pend,
                    render: r => (r.A.pend > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.A.pend}</span> : '—')
                  },
                  {
                    key: 'prepostos',
                    header: 'Prepostos',
                    width: '160px',
                    render: r => {
                      const pr = Object.values(dataset.pessoas).filter(
                        p => p.papel !== 'controlador' && isPersonResponsible(p, { p: '', r: r.u })
                      );
                      return (
                        <div className="sub" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                          {pr.map(x => x.nome).join(', ') || '—'}
                        </div>
                      );
                    }
                  },
                  {
                    key: 'acoes',
                    header: '',
                    width: '80px',
                    render: r => (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => updateFilter('fReg', r.u)}
                      >
                        Filtrar
                      </button>
                    )
                  }
                ]}
                rowKey={r => r.u}
                rowClassName={r => (r === worstU && r.A.inf > 0 ? 'worst' : '')}
                emptyMessage="Sem dados para unidades de negócio."
              />
            )}

            {operacionalTab === 'plataformas' && (
              <DataTable
                data={platsList}
                columns={[
                  {
                    key: 'plat',
                    header: 'Plataforma',
                    width: '160px',
                    render: r => (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => updateFilter('fPlat', r.p)}
                        style={{ fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap' }}
                      >
                        {r.p}
                      </button>
                    )
                  },
                  {
                    key: 'un',
                    header: 'Unidade',
                    width: '160px',
                    render: r => {
                      const arm = armadorOf(pidx, r.p);
                      return (
                        <div className="sub" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                          {r.u}
                          {arm && <div>Armador {arm}</div>}
                        </div>
                      );
                    }
                  },
                  {
                    key: 'tec',
                    header: 'Técnicos',
                    align: 'right',
                    width: '90px',
                    sortValue: r => r.A.tec,
                    render: r => r.A.tec
                  },
                  {
                    key: 'dia',
                    header: D ? `Dia ${formatBrShort(D)}` : 'Dia',
                    width: '130px',
                    render: r => (r.Ad.n > 0 ? <MeterBar pct={r.Ad.p} status={r.Ad.st} /> : <span className="sub">sem dados</span>)
                  },
                  {
                    key: 'abDia',
                    header: 'Abaixo no dia',
                    align: 'right',
                    width: '110px',
                    sortValue: r => r.Ad.inf,
                    render: r => (r.Ad.inf > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.Ad.inf}</span> : '—')
                  },
                  {
                    key: 'acc',
                    header: 'Acumulado do período',
                    width: '130px',
                    render: r => <MeterBar pct={r.A.p} status={r.A.st} />
                  },
                  {
                    key: 'saldo',
                    header: 'Saldo',
                    align: 'right',
                    width: '100px',
                    sortValue: r => r.A.saldo,
                    render: r => (
                      <span style={{ color: r.A.saldo >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
                        {formatSignedHours(r.A.saldo)}
                      </span>
                    )
                  },
                  {
                    key: 'inf',
                    header: 'Dias com problema',
                    align: 'right',
                    width: '120px',
                    sortValue: r => r.A.inf,
                    render: r => r.A.inf
                  },
                  {
                    key: 'abAcc',
                    header: 'Abaixo no acumulado',
                    align: 'right',
                    width: '120px',
                    sortValue: r => r.A.abAcc,
                    render: r => (r.A.abAcc > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.A.abAcc} de {r.A.tec}</span> : '—')
                  },
                  {
                    key: 'pend',
                    header: 'Pendentes',
                    align: 'right',
                    width: '100px',
                    sortValue: r => r.A.pend,
                    render: r => (r.A.pend > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.A.pend}</span> : '—')
                  },
                  {
                    key: 'responsaveis',
                    header: 'Responsáveis',
                    width: '180px',
                    render: r => {
                      const rs = Object.values(dataset.pessoas).filter(p =>
                        isPersonResponsible(p, { p: r.p, r: r.u })
                      );
                      return (
                        <div className="sub" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                          {rs.map(x => x.nome).join(', ') || 'sem responsável'}
                        </div>
                      );
                    }
                  },
                  {
                    key: 'acoes',
                    header: '',
                    width: '130px',
                    render: r => (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => updateFilter('fPlat', r.p)}
                        >
                          Técnicos
                        </button>
                        {r.Ad.inf > 0 && D && (
                          <button
                            type="button"
                            className="btn btn-accent btn-sm"
                            onClick={() => openEmailModal({ mode: 'daily', plats: [r.p], date: D })}
                          >
                            E-mail
                          </button>
                        )}
                      </div>
                    )
                  }
                ]}
                rowKey={r => r.p}
                rowClassName={r => (r.A.st === 'bad' ? 'worst' : '')}
                emptyMessage="Sem plataformas com técnicos neste período."
                searchable
                searchPlaceholder="Buscar plataforma ou unidade..."
                getSearchString={r => `${r.p} ${r.u}`}
              />
            )}

            {operacionalTab === 'armadores' && armadoresList.length > 0 && (
              <DataTable
                data={armadoresList}
                columns={[
                  {
                    key: 'armador',
                    header: 'Armador',
                    width: '220px',
                    render: r => (
                      <div style={{ minWidth: '200px', whiteSpace: 'nowrap' }}>
                        <b>{r.k}</b>
                        <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                          {Array.from(r.A.plats).slice(0, 4).join(', ')}
                          {r.A.plats.size > 4 ? '…' : ''}
                        </div>
                      </div>
                    )
                  },
                  {
                    key: 'plats',
                    header: 'Embarcações',
                    align: 'right',
                    width: '120px',
                    sortValue: r => r.A.plats.size,
                    render: r => r.A.plats.size
                  },
                  {
                    key: 'tec',
                    header: 'Técnicos',
                    align: 'right',
                    width: '90px',
                    sortValue: r => r.A.tec,
                    render: r => r.A.tec
                  },
                  {
                    key: 'dia',
                    header: D ? `Dia ${formatBrShort(D)}` : 'Dia',
                    width: '130px',
                    render: r => (r.Ad.n > 0 ? <MeterBar pct={r.Ad.p} status={r.Ad.st} /> : <span className="sub">sem dados</span>)
                  },
                  {
                    key: 'acc',
                    header: 'Acumulado do período',
                    width: '130px',
                    render: r => <MeterBar pct={r.A.p} status={r.A.st} />
                  },
                  {
                    key: 'saldo',
                    header: 'Saldo',
                    align: 'right',
                    width: '100px',
                    sortValue: r => r.A.saldo,
                    render: r => (
                      <span style={{ color: r.A.saldo >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
                        {formatSignedHours(r.A.saldo)}
                      </span>
                    )
                  },
                  {
                    key: 'inf',
                    header: 'Dias com problema',
                    align: 'right',
                    width: '120px',
                    sortValue: r => r.A.inf,
                    render: r => r.A.inf
                  },
                  {
                    key: 'abAcc',
                    header: 'Abaixo no acumulado',
                    align: 'right',
                    width: '120px',
                    sortValue: r => r.A.abAcc,
                    render: r => (r.A.abAcc > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.A.abAcc} de {r.A.tec}</span> : '—')
                  },
                  {
                    key: 'pend',
                    header: 'Pendentes',
                    align: 'right',
                    width: '100px',
                    sortValue: r => r.A.pend,
                    render: r => (r.A.pend > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.A.pend}</span> : '—')
                  }
                ]}
                rowKey={r => r.k}
                emptyMessage="Nenhum armador encontrado."
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
