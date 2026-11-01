import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { KpiCard } from '../components/KpiCard';
import { StatusPill } from '../components/StatusPill';
import { MeterBar } from '../components/MeterBar';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl } from '../components/SegmentedControl';
import type { UsoffOperationRow } from '../../domain/types';
import {
  calcPct,
  formatHours,
  formatPct,
  formatUs,
  plural
} from '../../utils/format';
import { formatBr, formatBrShort } from '../../utils/date';
import { computeDataAte, isPersonResponsible, statusOf } from '../../domain/calculations';
import { computeUsoffOperations, summarizeUsoff } from '../../domain/usoff';
import { periodDisplayName } from '../../domain/periods';
import { exportUsoffXlsx } from '../../services/excel.service';

export function MedicaoUsoffView() {
  const {
    dataset,
    pidx,
    activePeriod,
    filters,
    openFichaDrawer,
    scopeLabel
  } = useApp();

  const { showToast } = useToast();
  const [usoffTab, setUsoffTab] = useState<'operacoes' | 'unidades' | 'prepostos'>('operacoes');
  const [isExporting, setIsExporting] = useState(false);

  const P = activePeriod;
  const isEnc = dataset.config.med_criterio === 'enc';
  const ate = computeDataAte(P, dataset.watermark.ultima_data_hh);

  // Operações calculadas da USOFF
  const ops = useMemo(() => {
    return computeUsoffOperations(P, dataset, filters, pidx);
  }, [P, dataset, filters, pidx]);

  // Sumário geral
  const T = useMemo(() => {
    return summarizeUsoff(ops);
  }, [ops]);

  // Exportação Excel USOFF
  const handleExportUsoff = async () => {
    setIsExporting(true);
    try {
      await exportUsoffXlsx(dataset, P, scopeLabel);
      showToast('Relatório de USOFF exportado com sucesso!', 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao exportar USOFF: ' + (err.message || 'Falha na geração'), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // Agrupamentos por UN e por Preposto
  const groupByField = (keyFn: (o: UsoffOperationRow) => string[]) => {
    const map: Record<string, UsoffOperationRow[]> = {};
    ops.forEach(x => {
      keyFn(x).forEach(k => {
        (map[k] = map[k] || []).push(x);
      });
    });

    return Object.entries(map).map(([k, list]) => ({
      name: k,
      summary: summarizeUsoff(list)
    })).sort((a, b) => (a.summary.pP ?? 999) - (b.summary.pP ?? 999));
  };

  const groupUn = useMemo(() => {
    return groupByField(x => Array.from(x.regs));
  }, [ops]);

  const groupPreposto = useMemo(() => {
    return groupByField(x => {
      const respNames = Object.values(dataset.pessoas)
        .filter(p => (p.papel || 'preposto') === 'preposto' && Array.from(x.plats).some(pp => isPersonResponsible(p, { p: pp, r: Array.from(x.regs)[0] || '' })))
        .map(p => p.nome);
      return respNames.length ? respNames : ['Sem preposto'];
    });
  }, [ops, dataset.pessoas]);

  interface GroupSummaryRow {
    name: string;
    summary: ReturnType<typeof summarizeUsoff>;
  }

  const groupColumns = (label: string): DataTableColumn<GroupSummaryRow>[] => [
    {
      key: 'name',
      header: label,
      width: '240px',
      render: r => <b style={{ whiteSpace: 'nowrap' }}>{r.name}</b>
    },
    {
      key: 'n',
      header: 'Operações',
      align: 'right',
      sortValue: r => r.summary.n,
      render: r => r.summary.n
    },
    {
      key: 'hp',
      header: 'HP',
      align: 'right',
      sortValue: r => r.summary.hp,
      render: r => formatHours(r.summary.hp)
    },
    {
      key: 'hd',
      header: 'HD',
      align: 'right',
      sortValue: r => r.summary.hd,
      render: r => formatHours(r.summary.hd)
    },
    {
      key: 'hc',
      header: 'HC',
      align: 'right',
      sortValue: r => r.summary.hc,
      render: r => formatHours(r.summary.hc)
    },
    {
      key: 'pD',
      header: 'HC ÷ HD',
      sortValue: r => r.summary.pD ?? -1,
      render: r => <MeterBar pct={r.summary.pD} status={statusOf(r.summary.pD, dataset.config)} />
    },
    {
      key: 'pP',
      header: 'HC ÷ HP',
      sortValue: r => r.summary.pP ?? -1,
      render: r => <MeterBar pct={r.summary.pP} status={statusOf(r.summary.pP, dataset.config)} />
    },
    {
      key: 'peHp',
      header: 'Σ PE × HP',
      align: 'right',
      sortValue: r => r.summary.peHp,
      render: r => (r.summary.falta > 0 ? '—' : formatUs(r.summary.peHp))
    },
    {
      key: 'exHc',
      header: 'Σ EX × HC',
      align: 'right',
      sortValue: r => r.summary.exHc,
      render: r => (r.summary.falta > 0 ? '—' : formatUs(r.summary.exHc))
    },
    {
      key: 'us',
      header: 'USoff',
      align: 'right',
      sortValue: r => r.summary.us ?? -1,
      render: r => <b>{formatUs(r.summary.us)}</b>
    }
  ];

  // Tabela de Operações detalhada
  const opColumns: DataTableColumn<UsoffOperationRow>[] = [
    {
      key: 'op',
      header: 'Operação',
      width: '180px',
      render: r => (
        <div>
          {r.op ? (
            <b>{r.op}</b>
          ) : (
            <StatusPill
              status={r.tipo === 'Sem programação' ? 'warn' : 'info'}
              text={r.tipo}
            />
          )}
          {r.sharedAcrossPortfolios && (
            <div
              style={{
                display: 'inline-block',
                marginTop: '4px',
                padding: '2px 6px',
                borderRadius: '8px',
                background: 'var(--orange-soft)',
                color: 'var(--orange-dark)',
                fontSize: '0.72rem',
                fontWeight: 700
              }}
              title="Esta operação possui técnicos em plataformas de outras carteiras além da sua."
            >
              Parcial da OP na sua carteira
            </div>
          )}
          <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
            HP: {r.fonte}
          </div>
        </div>
      )
    },
    {
      key: 'mats',
      header: 'Técnico',
      width: '220px',
      render: r => {
        const mats = Array.from(r.mats);
        return (
          <div style={{ minWidth: '200px' }}>
            {mats.slice(0, 2).map(m => {
              const nome = dataset.tecnicos[m]?.nome || `Mat. ${m}`;
              return (
                <div key={m}>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => openFichaDrawer(m)}
                    style={{ fontSize: '0.82rem', color: 'var(--blue)', whiteSpace: 'nowrap' }}
                  >
                    {nome}
                  </button>
                </div>
              );
            })}
            {mats.length > 2 && (
              <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                +{mats.length - 2}
              </div>
            )}
          </div>
        );
      }
    },
    {
      key: 'plats',
      header: 'Plataforma',
      width: '180px',
      render: r => (
        <div>
          <b>{Array.from(r.plats).join(', ')}</b>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            {Array.from(r.regs).join(', ')}
          </div>
        </div>
      )
    },
    {
      key: 'periodo',
      header: 'No período',
      render: r => (
        <div>
          <div>{formatBrShort(r.ini)} a {formatBrShort(r.fim)}</div>
          <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
            {plural(r.dias, 'dia', 'dias')}
          </div>
        </div>
      )
    },
    {
      key: 'hp',
      header: 'HP',
      align: 'right',
      sortValue: r => r.hp,
      render: r => formatHours(r.hp)
    },
    {
      key: 'hd',
      header: 'HD',
      align: 'right',
      sortValue: r => r.hd,
      render: r => formatHours(r.hd)
    },
    {
      key: 'hc',
      header: 'HC',
      align: 'right',
      sortValue: r => r.hc,
      render: r => formatHours(r.hc)
    },
    {
      key: 'pD',
      header: 'HC ÷ HD',
      sortValue: r => r.pD ?? -1,
      render: r => <MeterBar pct={r.pD} status={statusOf(r.pD, dataset.config)} />
    },
    {
      key: 'pP',
      header: 'HC ÷ HP',
      sortValue: r => r.pP ?? -1,
      render: r => (
        r.hpAte > 0 ? (
          <MeterBar pct={r.pP} status={statusOf(r.pP, dataset.config)} />
        ) : (
          <span className="sub">sem programação</span>
        )
      )
    },
    {
      key: 'pe',
      header: 'PE',
      align: 'right',
      render: r => {
        if (r.falta) return <span style={{ color: 'var(--bad)' }}>falta</span>;
        const pes = Array.from(r.pes);
        return pes.length === 1 ? formatUs(pes[0]) : (pes.length > 1 ? 'vários' : '—');
      }
    },
    {
      key: 'ex',
      header: 'EX',
      align: 'right',
      render: r => {
        if (r.falta) return <span style={{ color: 'var(--bad)' }}>falta</span>;
        const exs = Array.from(r.exs);
        return exs.length === 1 ? formatUs(exs[0]) : (exs.length > 1 ? 'vários' : '—');
      }
    },
    {
      key: 'peHp',
      header: 'PE × HP',
      align: 'right',
      sortValue: r => r.peHp,
      render: r => (r.falta ? '—' : formatUs(r.peHp))
    },
    {
      key: 'exHc',
      header: 'EX × HC',
      align: 'right',
      sortValue: r => r.exHc,
      render: r => (r.falta ? '—' : formatUs(r.exHc))
    },
    {
      key: 'us',
      header: 'USoff',
      align: 'right',
      sortValue: r => r.us ?? -1,
      render: r => <b>{formatUs(r.us)}</b>
    }
  ];

  return (
    <div className="view-medicao-usoff">
      {/* Cabeçalho */}
      <div className="card-header-view" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
            Medição USOFF · {periodDisplayName(P)} ({formatBr(P.ini)} a {formatBr(P.fim)})
          </h2>
          <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
            Executado recebido até {formatBr(ate)}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleExportUsoff}
          disabled={isExporting}
        >
          {isExporting ? 'Exportando...' : 'Exportar USOFF (Excel)'}
        </button>
      </div>

      {/* Card da Fórmula Algébrica */}
      <div
        className="card"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          marginBottom: '16px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: '1.2rem', color: 'var(--blue)', fontWeight: 700 }}>
            US<sub>off</sub> = &Sigma;<sub>i=1&hellip;n</sub> [ (PE<sub>i</sub> &times; HP<sub>i</sub>) + (EX<sub>i</sub> &times; HC<sub>i</sub>) ]
          </span>
          <span className="sub" style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
            fórmula de apuração do SERVIÇO TÉCNICO OFFSHORE
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px 16px', fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
          <div>
            <b>OP<sub>i</sub></b>: cada operação dos embarques do período. No app, cada embarque do Portal Offshore
            {isEnc ? ' com desembarque no período' : ''}, ou o código de operação da planilha.
          </div>
          <div>
            <b>HP<sub>i</sub></b>: horas programadas no Portal Offshore
            {isEnc ? ' para o embarque inteiro' : ', proporcionais aos dias dentro do período'}.
          </div>
          <div>
            <b>HC<sub>i</sub></b>: horas confirmadas, isto é, o HH executado recebido do fluxo.
          </div>
          <div>
            <b>PE<sub>i</sub> e EX<sub>i</sub></b>: ponderações da programação e da execução, definidas em Configurações (UN ou padrão) ou na planilha.
          </div>
        </div>
      </div>

      {!ops.length ? (
        <div className="note" style={{ textAlign: 'center', padding: '32px' }}>
          {isEnc
            ? 'Nenhum embarque com desembarque neste período'
            : 'Sem programação de embarque nem HH executado neste período'}
          {filters.fReg || filters.fPlat || filters.fResp ? ' com esses filtros' : ''}. Importe a programação do Portal Offshore na aba Importar dados.
        </div>
      ) : (
        <>
          {/* Alerta de ponderações faltantes */}
          {T.falta > 0 && (
            <div className="note note-warn" style={{ marginBottom: '16px' }}>
              <b>Faltam as ponderações PE e EX</b> em {plural(T.falta, 'operação', 'operações')}.
              Informe os valores do contrato em Configurações (padrão ou por unidade de negócio) ou nas colunas PE e EX da planilha do Portal Offshore. Enquanto isso, o app mostra as horas e as comparações, sem a US<sub>off</sub>.
            </div>
          )}

          {/* 6 KPIs */}
          <div className="kpis">
            <KpiCard
              value={T.n}
              label={isEnc ? 'operações com desembarque no período' : 'operações no período'}
              tone="blue"
            />
            <KpiCard
              value={formatHours(T.hp)}
              label={isEnc ? 'HP · programado dos embarques' : 'HP · programado no período'}
              tone="blue"
            />
            <KpiCard
              value={formatHours(T.hd)}
              label={`HD · disponível até ${formatBrShort(ate)}`}
              tone="blue"
            />
            <KpiCard
              value={formatHours(T.hc)}
              label="HC · executado confirmado"
              tone="blue"
            />
            <KpiCard
              value={formatPct(T.pD)}
              label="HC ÷ HD (sobre disponível)"
              tone={statusOf(T.pD, dataset.config) === 'ok' ? 'ok' : 'bad'}
            />
            <KpiCard
              value={formatPct(T.pP)}
              label={`HC ÷ HP até ${formatBrShort(ate)}`}
              tone={statusOf(T.pP, dataset.config) === 'ok' ? 'ok' : 'bad'}
            />
          </div>

          {/* Card destaque do total USoff */}
          <div
            className="card"
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--line)',
              borderLeft: '4px solid var(--blue)',
              padding: '20px',
              marginBottom: '28px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <div className="sub" style={{ fontSize: '0.88rem', color: 'var(--ink-muted)', fontWeight: 600 }}>
                  US<sub>off</sub> apurado no período
                </div>
                <div style={{ fontFamily: 'var(--f-display)', fontSize: '2.4rem', fontWeight: 800, color: 'var(--blue)', fontVariantNumeric: 'tabular-nums' }}>
                  {T.us == null ? '—' : formatUs(T.us)}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px 24px',
                  background: 'var(--surface-alt)',
                  padding: '12px 18px',
                  borderRadius: 'var(--radius-md)'
                }}
              >
                <div>
                  <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                    Parcela da programação &Sigma; PE &times; HP
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                    {T.falta > 0 ? '—' : formatUs(T.peHp)}
                  </div>
                </div>

                <div>
                  <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                    Parcela da execução &Sigma; EX &times; HC
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                    {T.falta > 0 ? '—' : formatUs(T.exHc)}
                  </div>
                </div>

                <div>
                  <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                    Operações sem programação
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                    {ops.filter(x => x.tipo === 'Sem programação').length}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Seção com SegmentedControl e Tabelas */}
          <div style={{ marginBottom: '28px' }}>
            <div className="section-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <SegmentedControl<'operacoes' | 'unidades' | 'prepostos'>
                options={[
                  { value: 'operacoes', label: 'Por Operação', count: ops.length },
                  { value: 'unidades', label: 'Por Unidade (UN)', count: groupUn.length },
                  { value: 'prepostos', label: 'Por Preposto', count: groupPreposto.length }
                ]}
                value={usoffTab}
                onChange={setUsoffTab}
              />
            </div>

            {/* Sub-visão 1: Por Operação */}
            {usoffTab === 'operacoes' && (
              <div>
                <DataTable
                  data={ops}
                  columns={opColumns}
                  rowKey={r => r.key}
                  searchable
                  searchPlaceholder="Buscar por código de operação, técnico ou plataforma..."
                  getSearchString={r => `${r.op} ${Array.from(r.mats).join(' ')} ${Array.from(r.plats).join(' ')} ${Array.from(r.regs).join(' ')}`}
                  emptyMessage="Nenhuma operação encontrada no período."
                />
                <p className="sub" style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                  {isEnc
                    ? 'HP = horas programadas do embarque inteiro.'
                    : 'HP do período = horas programadas do embarque × dias do embarque dentro do período ÷ dias do embarque.'}{' '}
                  HC ÷ HP compara o executado com o programado até {formatBr(ate)}, o último dia recebido; no fechamento da medição as duas datas coincidem.
                </p>
              </div>
            )}

            {/* Sub-visão 2: Por Unidade */}
            {usoffTab === 'unidades' && (
              <div>
                <DataTable
                  data={groupUn}
                  columns={groupColumns('Unidade')}
                  rowKey={r => r.name}
                  emptyMessage="Sem dados por UN."
                />
              </div>
            )}

            {/* Sub-visão 3: Por Preposto */}
            {usoffTab === 'prepostos' && (
              <div>
                <DataTable
                  data={groupPreposto}
                  columns={groupColumns('Preposto')}
                  rowKey={r => r.name}
                  emptyMessage="Sem dados por preposto."
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
