import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { KpiCard } from '../components/KpiCard';
import { StatusPill } from '../components/StatusPill';
import { MeterBar } from '../components/MeterBar';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl } from '../components/SegmentedControl';
import type { PeriodTechSummary } from '../../domain/types';
import {
  calcPct,
  formatHours,
  formatPct
} from '../../utils/format';
import { formatBr, formatBrShort } from '../../utils/date';
import {
  computeMeasurementDays,
  computePeriodTechs,
  getClosedEmbarkations,
  getRollingEmbarkations,
  groupDaysByField,
  statusOf
} from '../../domain/calculations';
import { periodDisplayName } from '../../domain/periods';
import { exportPeriodoXlsx, exportTecnicoXlsx } from '../../services/excel.service';

export function MedicaoRelatoriosView() {
  const {
    dataset,
    pidx,
    activePeriod,
    filters,
    openFichaDrawer,
    scopeLabel,
    userProfile
  } = useApp();

  const { showToast } = useToast();
  const [medTab, setMedTab] = useState<'tecnicos' | 'plataformas' | 'unidades'>('tecnicos');
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [exportingTecMat, setExportingTecMat] = useState<string | null>(null);

  const P = activePeriod;
  const isEnc = dataset.config.med_criterio === 'enc';

  // Dias e Técnicos apurados segundo o critério de medição
  const days = useMemo(() => {
    return computeMeasurementDays(P, dataset, filters, pidx);
  }, [P, dataset, filters, pidx]);

  const tecs = useMemo(() => {
    return computePeriodTechs(P, true, dataset, filters, pidx);
  }, [P, dataset, filters, pidx]);

  // Contagens para critério de embarques encerrados
  const closedCount = useMemo(() => {
    if (!isEnc) return 0;
    return getClosedEmbarkations(P, dataset, filters, pidx).length;
  }, [isEnc, P, dataset, filters, pidx]);

  const rollingCount = useMemo(() => {
    if (!isEnc) return 0;
    return getRollingEmbarkations(P, dataset, filters, pidx).length;
  }, [isEnc, P, dataset, filters, pidx]);

  // Agregações de KPI
  const { d, e, prog, gw, pend } = useMemo(() => {
    let totD = 0;
    let totE = 0;
    let totProg = 0;
    let totGw = 0;
    let totPend = 0;

    days.forEach(x => {
      totD += x.d;
      totE += x.e;
    });

    tecs.forEach(t => {
      totProg += t.prog;
      totGw += t.gw;
      totPend += t.pend;
    });

    return {
      d: totD,
      e: totE,
      prog: totProg,
      gw: totGw,
      pend: totPend
    };
  }, [days, tecs]);

  const pctGeral = calcPct(e, d);
  const stGeral = statusOf(pctGeral, dataset.config);

  const semGwPct = useMemo(() => {
    if (!gw) return null;
    const dAj = Math.max(0, d - gw);
    return calcPct(e, dAj);
  }, [gw, e, d]);

  // Agrupamentos lado a lado por UN e por Plataforma
  const regsGrouped = useMemo(() => {
    return groupDaysByField(days, 'r', dataset.config);
  }, [days, dataset.config]);

  const platsGrouped = useMemo(() => {
    return groupDaysByField(days, 'p', dataset.config);
  }, [days, dataset.config]);

  // Exportação Excel de 7 abas do período
  const handleExportPeriodo = async () => {
    setIsExportingAll(true);
    try {
      await exportPeriodoXlsx(dataset, P, scopeLabel, userProfile?.nome);
      showToast('Relatório de medição do período exportado com sucesso!', 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao exportar Excel do período: ' + (err.message || 'Falha na geração'), 'error');
    } finally {
      setIsExportingAll(false);
    }
  };

  // Exportação individual do técnico
  const handleExportTecnico = async (mat: string) => {
    setExportingTecMat(mat);
    try {
      await exportTecnicoXlsx(mat, dataset, P, scopeLabel);
      showToast(`Relatório do técnico ${mat} exportado com sucesso!`, 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao exportar relatório do técnico: ' + (err.message || 'Falha'), 'error');
    } finally {
      setExportingTecMat(null);
    }
  };

  const metaMin = dataset.config.meta_percentual - 0.0001;

  const tecColumns: DataTableColumn<PeriodTechSummary>[] = [
    {
      key: 'st',
      header: 'Situação',
      width: '120px',
      render: t => <StatusPill status={t.st} />
    },
    {
      key: 'nome',
      header: 'Técnico',
      width: '240px',
      render: t => (
        <div style={{ minWidth: '220px', textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <button
            type="button"
            className="btn-link"
            onClick={() => openFichaDrawer(t.mat)}
            style={{ fontWeight: 600, color: 'var(--blue)', textAlign: 'left', whiteSpace: 'nowrap', display: 'block' }}
          >
            {t.nome}
          </button>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
            Mat. {t.mat}
          </div>
        </div>
      )
    },
    {
      key: 'plat',
      header: 'Plataforma',
      width: '180px',
      render: t => (
        <div style={{ whiteSpace: 'nowrap' }}>
          <b>{Array.from(t.plats).join(', ')}</b>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
            {Array.from(t.regs).join(', ')}
          </div>
          {t.embs && (
            <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
              Embarque {t.embs}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'cartDias',
      header: isEnc ? 'Dias de embarque' : 'Dias na carteira',
      align: 'right',
      width: '120px',
      sortValue: t => t.cartDias,
      render: t => t.cartDias
    },
    {
      key: 'prog',
      header: 'HH programado',
      align: 'right',
      width: '110px',
      sortValue: t => t.prog,
      render: t => formatHours(t.prog)
    },
    {
      key: 'dias',
      header: 'Dias com executado',
      align: 'right',
      width: '130px',
      sortValue: t => t.dias,
      render: t => t.dias
    },
    {
      key: 'disp',
      header: 'Disponível',
      align: 'right',
      width: '100px',
      sortValue: t => t.d,
      render: t => formatHours(t.d)
    },
    {
      key: 'exec',
      header: 'Executado',
      align: 'right',
      width: '100px',
      sortValue: t => t.e,
      render: t => formatHours(t.e)
    },
    {
      key: 'p',
      header: '% do disponível',
      width: '120px',
      sortValue: t => t.p ?? -1,
      render: t => (
        <span style={{ fontWeight: 600 }}>
          {formatPct(t.p)}
        </span>
      )
    },
    {
      key: 'pProg',
      header: '% do programado',
      width: '130px',
      sortValue: t => t.pProg ?? -1,
      render: t => (
        <span style={{ fontWeight: 600 }}>
          {formatPct(t.pProg)}
        </span>
      )
    },
    {
      key: 'gw',
      header: 'Gangway',
      align: 'right',
      width: '100px',
      sortValue: t => t.gw,
      render: t => (t.gw > 0 ? formatHours(t.gw) : '—')
    },
    {
      key: 'pAj',
      header: '% sem gangway',
      width: '120px',
      sortValue: t => t.pAj ?? -1,
      render: t => (t.gw > 0 ? formatPct(t.pAj) : '—')
    },
    {
      key: 'pend',
      header: 'Pendentes',
      align: 'right',
      width: '100px',
      sortValue: t => t.pend,
      render: t => (t.pend > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}>{t.pend}</span> : '—')
    },
    {
      key: 'meta',
      header: 'Atingiu a meta?',
      width: '130px',
      render: t => (
        t.p != null ? (
          t.p >= metaMin ? (
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
      key: 'acoes',
      header: '',
      render: t => (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => handleExportTecnico(t.mat)}
          disabled={exportingTecMat === t.mat}
        >
          {exportingTecMat === t.mat ? 'Gerando...' : 'Relatório'}
        </button>
      )
    }
  ];

  return (
    <div className="view-medicao-relatorios">
      {/* Cabeçalho */}
      <div className="card-header-view" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
            {periodDisplayName(P)} · {formatBr(P.ini)} a {formatBr(P.fim)}
          </h2>
          <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
            Meta contratual: {formatHours(dataset.config.hh_dia)} por dia embarcado ({dataset.config.meta_percentual}%)
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleExportPeriodo}
          disabled={isExportingAll}
        >
          {isExportingAll ? 'Gerando Excel...' : 'Exportar Excel do período'}
        </button>
      </div>

      {/* Nota explicativa do critério */}
      <div className="note" style={{ marginBottom: '16px', background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {isEnc ? (
          <span>
            <b>Critério de medição ativo:</b> Apenas técnicos com desembarque entre {formatBr(P.ini)} e {formatBr(P.fim)}{' '}
            (o embarque entra por inteiro na apuração contratual).{' '}
            <b>{closedCount}</b> embarques encerrados nesta medição;{' '}
            <b>{rollingCount}</b> embarques ainda a bordo rolam para a próxima medição.
          </span>
        ) : (
          <span>
            <b>Critério de medição ativo:</b> Todos os dias trabalhados dentro do período de {formatBr(P.ini)} a {formatBr(P.fim)}.
          </span>
        )}
      </div>

      {!tecs.length ? (
        <div className="note" style={{ textAlign: 'center', padding: '32px' }}>
          {isEnc
            ? `Nenhum técnico com desembarque entre ${formatBr(P.ini)} e ${formatBr(P.fim)}`
            : 'Sem apontamentos ou carteira neste período'}
          {filters.fReg || filters.fPlat || filters.fResp ? ' com esses filtros' : ''}.
        </div>
      ) : (
        <>
          {/* 6 KPIs da medição */}
          <div className="kpis">
            <KpiCard
              value={tecs.length}
              label={isEnc ? 'técnicos com desembarque no período' : 'técnicos no período'}
              tone="blue"
            />
            <KpiCard
              value={formatHours(prog)}
              label="HH programado"
              tone="blue"
            />
            <KpiCard
              value={formatHours(d)}
              label="HH disponível"
              tone="blue"
            />
            <KpiCard
              value={formatHours(e)}
              label="HH executado"
              tone="blue"
            />
            <KpiCard
              value={formatPct(pctGeral)}
              label="execução"
              tone={stGeral === 'ok' ? 'ok' : stGeral === 'warn' ? 'warn' : 'bad'}
            />
            <KpiCard
              value={pend}
              label="justificativas pendentes"
              tone={pend > 0 ? 'bad' : 'ok'}
            />
          </div>

          {/* Nota de impacto de gangway */}
          {gw > 0 && (
            <div className="note" style={{ marginBottom: '20px', borderLeft: '4px solid var(--orange)' }}>
              Gangway desconectada somou <b>{formatHours(gw)}</b> no período. Sem essas horas, a execução seria de{' '}
              <b>{formatPct(semGwPct)}</b>.
            </div>
          )}

          {/* Toolbar de Sub-visão com SegmentedControl */}
          <div style={{ marginBottom: '24px' }}>
            <div className="section-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <SegmentedControl<'tecnicos' | 'plataformas' | 'unidades'>
                options={[
                  { value: 'tecnicos', label: 'Por Técnico', count: tecs.length },
                  { value: 'plataformas', label: 'Por Plataforma', count: platsGrouped.length },
                  { value: 'unidades', label: 'Por Unidade (UN)', count: regsGrouped.length }
                ]}
                value={medTab}
                onChange={setMedTab}
              />
            </div>

            {/* Sub-visão 1: Por Técnico */}
            {medTab === 'tecnicos' && (
              <div>
                <DataTable
                  data={tecs}
                  columns={tecColumns}
                  rowKey={t => t.mat}
                  searchable
                  searchPlaceholder="Buscar por técnico, matrícula ou plataforma..."
                  getSearchString={t => `${t.nome} ${t.mat} ${Array.from(t.plats).join(' ')} ${Array.from(t.regs).join(' ')}`}
                  emptyMessage="Nenhum técnico apurado no período."
                />
              </div>
            )}

            {/* Sub-visão 2: Por Plataforma */}
            {medTab === 'plataformas' && (
              <div>
                <DataTable
                  data={platsGrouped}
                  columns={[
                    {
                      key: 'plat',
                      header: 'Plataforma',
                      render: r => (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <StatusPill status={r.st} text={formatPct(r.p)} />
                            <b>{r.k}</b>
                          </div>
                          {r.reg && (
                            <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                              {r.reg}
                            </div>
                          )}
                        </div>
                      )
                    },
                    {
                      key: 'tec',
                      header: 'Técnicos',
                      align: 'right',
                      sortValue: r => r.mats.size,
                      render: r => r.mats.size
                    },
                    {
                      key: 'disp',
                      header: 'Disponível',
                      align: 'right',
                      sortValue: r => r.d,
                      render: r => formatHours(r.d)
                    },
                    {
                      key: 'exec',
                      header: 'Executado',
                      align: 'right',
                      sortValue: r => r.e,
                      render: r => formatHours(r.e)
                    },
                    {
                      key: 'pct',
                      header: '%',
                      sortValue: r => r.p ?? -1,
                      render: r => <MeterBar pct={r.p} status={r.st} />
                    },
                    {
                      key: 'gw',
                      header: 'Gangway',
                      align: 'right',
                      sortValue: r => r.gw,
                      render: r => (r.gw > 0 ? formatHours(r.gw) : '—')
                    },
                    {
                      key: 'pend',
                      header: 'Pendentes',
                      align: 'right',
                      sortValue: r => r.pend,
                      render: r => (r.pend > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.pend}</span> : '—')
                    }
                  ]}
                  rowKey={r => r.k}
                  searchable
                  searchPlaceholder="Buscar por plataforma ou unidade..."
                  getSearchString={r => `${r.k} ${r.reg || ''}`}
                  emptyMessage="Sem dados de plataformas."
                />
              </div>
            )}

            {/* Sub-visão 3: Por Unidade */}
            {medTab === 'unidades' && (
              <div>
                <DataTable
                  data={regsGrouped}
                  columns={[
                    {
                      key: 'un',
                      header: 'Unidade',
                      render: r => (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <StatusPill status={r.st} text={formatPct(r.p)} />
                          <b>{r.k}</b>
                        </div>
                      )
                    },
                    {
                      key: 'tec',
                      header: 'Técnicos',
                      align: 'right',
                      sortValue: r => r.mats.size,
                      render: r => r.mats.size
                    },
                    {
                      key: 'disp',
                      header: 'Disponível',
                      align: 'right',
                      sortValue: r => r.d,
                      render: r => formatHours(r.d)
                    },
                    {
                      key: 'exec',
                      header: 'Executado',
                      align: 'right',
                      sortValue: r => r.e,
                      render: r => formatHours(r.e)
                    },
                    {
                      key: 'pct',
                      header: '%',
                      sortValue: r => r.p ?? -1,
                      render: r => <MeterBar pct={r.p} status={r.st} />
                    },
                    {
                      key: 'gw',
                      header: 'Gangway',
                      align: 'right',
                      sortValue: r => r.gw,
                      render: r => (r.gw > 0 ? formatHours(r.gw) : '—')
                    },
                    {
                      key: 'pend',
                      header: 'Pendentes',
                      align: 'right',
                      sortValue: r => r.pend,
                      render: r => (r.pend > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.pend}</span> : '—')
                    }
                  ]}
                  rowKey={r => r.k}
                  emptyMessage="Sem dados de UN."
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
