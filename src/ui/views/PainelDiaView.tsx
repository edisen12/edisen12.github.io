import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { KpiCard } from '../components/KpiCard';
import { StatusPill } from '../components/StatusPill';
import { MeterBar } from '../components/MeterBar';
import { Modal } from '../components/Modal';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl } from '../components/SegmentedControl';
import type { ConfirmacaoSAP, DayTechRow } from '../../domain/types';
import {
  calcPct,
  formatHours,
  formatPct,
  formatSignedHours,
  plural
} from '../../utils/format';
import { addDays, formatBr, formatBrShort, todayIso } from '../../utils/date';
import {
  buildSapIndex,
  computeDayRows,
  gestorOfUn,
  groupDaysByField,
  passesFilter,
  prazoOf,
  statusOf
} from '../../domain/calculations';
import { buildDailyAlertText } from '../../domain/communications';
import { exportPainelDiaOrdensXlsx } from '../../services/excel.service';
import { Briefcase, ExternalLink, AlertTriangle } from 'lucide-react';

export function PainelDiaView() {
  const {
    dataset,
    pidx,
    filters,
    updateFilter,
    openFichaDrawer,
    openJustModal,
    openEmailModal,
    openCarteiraModal,
    isGlobal,
    scopeLabel
  } = useApp();

  const { showToast } = useToast();
  const [dayViewMode, setDayViewMode] = useState<'abaixo' | 'todos'>('abaixo');
  const [modalOrdens, setModalOrdens] = useState<{
    mat: string;
    nome: string;
    p: string;
    items: ConfirmacaoSAP[];
  } | null>(null);
  const [isExportingDia, setIsExportingDia] = useState(false);

  const sapIndex = useMemo(() => buildSapIndex(dataset.confirmacoesSap), [dataset.confirmacoesSap]);

  const D = filters.fDate;
  const TODAY = todayIso();
  const ontem = addDays(TODAY, -1);

  // Linhas do dia filtradas pelo escopo
  const allRows = useMemo(() => {
    if (!D) return [];
    return computeDayRows(D, dataset, pidx).filter(r =>
      passesFilter({ p: r.p, r: r.r }, filters, dataset.pessoas)
    );
  }, [D, dataset, pidx, filters]);

  // Cálculos agregados do dia
  const { d, e, ab, pend, semCount, accPosCount, lowPlats } = useMemo(() => {
    let totD = 0;
    let totE = 0;
    const below: DayTechRow[] = [];
    const pending: DayTechRow[] = [];
    let sCount = 0;
    let aPos = 0;
    const lpSet = new Set<string>();

    allRows.forEach(x => {
      totD += x.d;
      totE += x.e;
      const isBelow = x.e < x.d - 0.001;
      if (isBelow) {
        below.push(x);
        lpSet.add(x.p);
        if (!x.j) {
          pending.push(x);
        }
        if (x.acc && x.acc.saldo >= 0) {
          aPos++;
        }
      }
      if (x.sem) {
        sCount++;
      }
    });

    return {
      d: totD,
      e: totE,
      ab: below,
      pend: pending,
      semCount: sCount,
      accPosCount: aPos,
      lowPlats: Array.from(lpSet)
    };
  }, [allRows]);

  const diaPct = calcPct(e, d);
  const diaSt = statusOf(diaPct, dataset.config);

  // Copiar alerta do dia
  const handleCopyAlert = async () => {
    if (!D) return;
    try {
      const text = buildDailyAlertText(D, dataset, filters, pidx);
      await navigator.clipboard.writeText(text);
      showToast('Alerta copiado. Cole no e-mail ou no WhatsApp.', 'success');
    } catch {
      showToast('Não foi possível copiar automaticamente para a área de transferência.', 'warn');
    }
  };

  // Exportar apontamentos e ordens do dia para Excel
  const handleExportDia = async () => {
    if (!D || allRows.length === 0) return;
    setIsExportingDia(true);
    try {
      await exportPainelDiaOrdensXlsx({
        date: D,
        dataset,
        rows: allRows,
        scopeLabel: isGlobal ? undefined : scopeLabel
      });
      showToast(`Apontamentos e ordens de ${formatBr(D)} exportados com sucesso!`, 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao exportar apontamentos: ' + (err?.message || 'Falha'), 'error');
    } finally {
      setIsExportingDia(false);
    }
  };

  if (!D) {
    return (
      <div className="note" style={{ textAlign: 'center', padding: '32px' }}>
        Escolha o dia do apontamento no filtro superior.
      </div>
    );
  }

  if (!allRows.length) {
    const lastDate = dataset.watermark.ultima_data_hh;
    return (
      <div className="note" style={{ textAlign: 'center', padding: '32px' }}>
        Nenhum técnico embarcado com dados em {formatBr(D)}
        {filters.fReg || filters.fPlat || filters.fResp ? ' com esses filtros' : ''}.
        {lastDate && D > lastDate
          ? ` O último HH executado recebido é de ${formatBr(lastDate)}.`
          : ' O fluxo traz o HH executado do dia anterior; use as setas do filtro para mudar o dia.'}
      </div>
    );
  }

  // Agrupamento por unidade de negócio
  const daysAsEntries = allRows.map(x => ({
    mat: x.mat,
    D,
    p: x.p,
    r: x.r,
    d: x.d,
    e: x.e,
    sem: x.sem,
    j: x.j
  }));
  const regsGrouped = groupDaysByField(daysAsEntries, 'r', dataset.config);

  const displayList = dayViewMode === 'abaixo' ? ab : allRows;

  // Definição das colunas da tabela de técnicos do dia
  const columns: DataTableColumn<DayTechRow>[] = [
    {
      key: 'st',
      header: 'Situação',
      width: '120px',
      render: r => <StatusPill status={r.st} />
    },
    {
      key: 'tecnico',
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
      key: 'plat',
      header: 'Plataforma',
      width: '160px',
      render: r => (
        <div style={{ whiteSpace: 'nowrap' }}>
          <b>{r.p}</b>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
            {r.r}
          </div>
        </div>
      )
    },
    {
      key: 'emb',
      header: 'Embarque',
      width: '150px',
      render: r => (
        r.emb ? (
          <div>
            <div>{formatBrShort(r.emb.ini)} a {formatBrShort(r.emb.fim)}</div>
            <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
              Dia {r.emb.dia} de {r.emb.n}
              {r.emb.fonte === 'apontamentos' && ' · sem carteira'}
            </div>
            {r.emb.id_embarque && (
              <div>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => openCarteiraModal(r.mat, r.emb?.id_embarque, D)}
                  style={{ fontSize: '0.74rem', color: 'var(--blue)', fontWeight: 600, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                  title="Visualizar Carteira do Embarque (Confronto SAP vs Portal)"
                >
                  <span>ID {r.emb.id_embarque}</span>
                  <ExternalLink size={10} style={{ opacity: 0.7 }} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <span className="sub">—</span>
        )
      )
    },
    {
      key: 'disp',
      header: 'Disponível',
      align: 'right',
      width: '100px',
      sortValue: r => r.d,
      render: r => formatHours(r.d)
    },
    {
      key: 'exec',
      header: 'Executado',
      align: 'right',
      width: '130px',
      sortValue: r => (r.sem ? 0 : r.e),
      render: r => {
        if (r.sem) {
          return (
            <div>
              <span style={{ color: 'var(--bad)', fontWeight: 700 }}>Não chegou</span>
              <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>conta 0 h</div>
            </div>
          );
        }

        const sapKey = `${r.mat}|${D}`;
        const daySap = sapIndex.byTechDate.get(sapKey) || [];
        const hasFora = daySap.some(s => s.status_reconciliacao !== 'Em Carteira');

        return (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 600 }}>{formatHours(r.e)}</div>
            {daySap.length > 0 && (
              <button
                type="button"
                className="btn-link"
                onClick={() => setModalOrdens({ mat: r.mat, nome: r.nome, p: r.p, items: daySap })}
                style={{
                  fontSize: '0.74rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  color: hasFora ? 'var(--orange-dark)' : 'var(--blue)',
                  marginTop: '2px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: 'none',
                  padding: 0
                }}
                title={hasFora ? 'Contém ordens confirmadas no SAP não cadastradas no Portal (clique para ver)' : 'Ver ordens confirmadas no SAP'}
              >
                {daySap.length} {plural(daySap.length, 'ordem', 'ordens')}
                {hasFora ? ' ⚠️' : ''}
              </button>
            )}
          </div>
        );
      }
    },
    {
      key: 'pc',
      header: '% do dia',
      width: '100px',
      sortValue: r => r.pc ?? -1,
      render: r => (
        <span style={{ fontWeight: 600 }}>
          {formatPct(r.pc)}
        </span>
      )
    },
    {
      key: 'acc',
      header: 'Acumulado do embarque',
      width: '160px',
      render: r => (
        r.acc ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 700, color: r.acc.saldo >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                {formatPct(r.acc.p)}
              </span>
              <span style={{ fontSize: '0.8rem', color: r.acc.saldo >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                ({formatSignedHours(r.acc.saldo)})
              </span>
            </div>
            <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
              {formatHours(r.acc.e)} de {formatHours(r.acc.d)}
            </div>
          </div>
        ) : (
          <span className="sub">—</span>
        )
      )
    },
    {
      key: 'just',
      header: 'Justificativa',
      width: '220px',
      render: r => {
        const isBelow = r.e < r.d - 0.001;
        if (!isBelow) {
          return <span className="sub" style={{ color: 'var(--ink-muted)' }}>Não precisa</span>;
        }

        if (r.j) {
          return (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                {r.j.motivo}
                {r.j.horas_gangway > 0 && ` · ${formatHours(r.j.horas_gangway)} de gangway`}
              </div>
              {r.j.descricao && (
                <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                  {r.j.descricao}
                </div>
              )}
              <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                {r.j.responsavel_nome}
                {r.j.criado_em && ` · em ${formatBr(r.j.criado_em.slice(0, 10))}`}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => openJustModal(r.mat, D)}
                style={{ padding: '2px 6px', fontSize: '0.78rem', marginTop: '4px' }}
              >
                Editar
              </button>
            </div>
          );
        }

        // Pendente
        const pz = prazoOf(D, dataset.config);
        const vencido = TODAY > pz;

        return (
          <div>
            <div style={{ marginBottom: '6px' }}>
              {vencido ? (
                <StatusPill status="bad" text={`Prazo vencido (${formatBrShort(pz)})`} />
              ) : (
                <StatusPill status="warn" text={`Pendente (até ${formatBrShort(pz)})`} />
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={() => openJustModal(r.mat, D)}
              >
                Justificar
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => openEmailModal({ mode: 'daily', plats: [r.p], date: D })}
              >
                E-mail
              </button>
            </div>
          </div>
        );
      }
    }
  ];

  return (
    <div className="view-painel-dia">
      {/* Cabeçalho */}
      <div className="card-header-view" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
            Execução de {formatBr(D)} {D === ontem ? '(ontem)' : ''}
          </h2>
          <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
            Acompanhamento diário de execução e faltas de apontamento
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportDia}
            disabled={isExportingDia || allRows.length === 0}
            title="Exportar planilha Excel com todas as ordens e operações confirmadas no SAP neste dia"
          >
            {isExportingDia ? 'Exportando...' : 'Exportar Apontamentos do Dia (Excel)'}
          </button>
          {lowPlats.length > 0 && (
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => openEmailModal({ mode: 'daily', plats: lowPlats, date: D })}
            >
              E-mail aos responsáveis ({plural(lowPlats.length, 'plataforma', 'plataformas')})
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCopyAlert}
          >
            Copiar alerta do dia
          </button>
        </div>
      </div>

      {/* 6 KPIs do dia */}
      <div className="kpis">
        <KpiCard
          value={allRows.length}
          label="técnicos embarcados"
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
          value={formatPct(diaPct)}
          label="execução do dia"
          tone={diaSt === 'ok' ? 'ok' : diaSt === 'warn' ? 'warn' : 'bad'}
        />
        <KpiCard
          value={ab.length}
          label="abaixo das horas disponíveis"
          tone={ab.length > 0 ? 'bad' : 'ok'}
        />
        <KpiCard
          value={pend.length}
          label="justificativas pendentes"
          tone={pend.length > 0 ? 'orange' : 'ok'}
        />
      </div>

      {/* Alerta vermelho explicativo */}
      {pend.length > 0 && (
        <div className="note note-bad" style={{ marginBottom: '20px' }}>
          <b>
            {plural(pend.length, 'técnico não executou', 'técnicos não executaram')} as horas disponíveis em {formatBr(D)}.
          </b>{' '}
          Favor justificar.
          {semCount > 0 && (
            <>
              {' '}
              {semCount === 1
                ? '1 deles está embarcado na carteira e não teve HH executado informado pelo fluxo (conta 0 h).'
                : `${semCount} deles estão embarcados na carteira e não tiveram HH executado informado pelo fluxo (conta 0 h).`}
            </>
          )}
          {accPosCount > 0 && (
            <>
              {' '}
              {accPosCount === 1
                ? '1 deles segue com acumulado do embarque positivo.'
                : `${accPosCount} deles seguem com acumulado do embarque positivo.`}
            </>
          )}
        </div>
      )}

      {/* Unidades de negócio */}
      <div style={{ marginBottom: '28px' }}>
        <h3 style={{ fontFamily: 'var(--f-display)', marginBottom: '14px' }}>Unidades de negócio</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '16px' }}>
          {regsGrouped.map(g => {
            const platInUn = allRows.filter(x => x.r === g.k);
            const platsGrouped = groupDaysByField(
              platInUn.map(x => ({
                mat: x.mat,
                D,
                p: x.p,
                r: x.r,
                d: x.d,
                e: x.e,
                sem: x.sem,
                j: x.j
              })),
              'p',
              dataset.config
            );
            const lowPlatsInUn = platsGrouped.filter(p => p.st !== 'ok');
            const gestor = gestorOfUn(g.k, dataset.plataformas, dataset.pessoas);

            return (
              <div
                key={g.k}
                className="reg-card"
                style={{
                  background: 'var(--surface)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  border: '1px solid var(--line)',
                  borderTop: `4px solid var(--${g.st})`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: '1.05rem' }}>{g.k}</h4>
                  <StatusPill status={g.st} />
                </div>

                <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--f-display)', color: 'var(--ink)' }}>
                  {formatPct(g.p)}
                </div>

                <MeterBar pct={g.p} status={g.st} />

                <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                  {formatHours(g.e)} de {formatHours(g.d)} · {g.mats.size} técnicos
                  {gestor && <div>Responsáveis: {gestor}</div>}
                </div>

                {lowPlatsInUn.length > 0 ? (
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
                      Plataformas abaixo da meta:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                      {lowPlatsInUn.map(p => (
                        <li key={p.k} style={{ marginBottom: '2px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{p.k}</span>:{' '}
                          {formatPct(p.p)} · {p.abaixo} téc.{' '}
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => openEmailModal({ mode: 'daily', plats: [p.k], date: D })}
                            style={{ fontSize: '0.78rem', color: 'var(--orange)' }}
                          >
                            e-mail
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="sub" style={{ fontSize: '0.8rem', color: 'var(--ok)' }}>
                    Todas as plataformas na meta.
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => updateFilter('fReg', g.k)}
                  style={{ alignSelf: 'flex-start', marginTop: 'auto' }}
                >
                  Ver só esta unidade
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabela de técnicos com SegmentedControl */}
      <div style={{ marginBottom: '20px' }}>
        <div className="section-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--f-display)' }}>Técnicos em {formatBr(D)}</h3>

          <SegmentedControl<'abaixo' | 'todos'>
            options={[
              { value: 'abaixo', label: 'Abaixo das horas', count: ab.length, badgeTone: ab.length > 0 ? 'bad' : 'default' },
              { value: 'todos', label: 'Todos os técnicos', count: allRows.length }
            ]}
            value={dayViewMode}
            onChange={setDayViewMode}
            size="sm"
          />
        </div>

        <DataTable
          data={displayList}
          columns={columns}
          rowKey={r => `${r.mat}_${r.p}`}
          searchable
          searchPlaceholder="Buscar técnico, matrícula ou plataforma..."
          getSearchString={r => `${r.nome} ${r.mat} ${r.p} ${r.r}`}
          emptyMessage={
            dayViewMode === 'abaixo'
              ? 'Todos os técnicos executaram as horas disponíveis neste dia.'
              : 'Nenhum técnico encontrado.'
          }
        />
      </div>

      {/* Modal de Detalhamento de Ordens e Confirmações do SAP */}
      {modalOrdens && (
        <Modal
          open={!!modalOrdens}
          onClose={() => setModalOrdens(null)}
          title={`Ordens e Operações no SAP · ${formatBr(D)}`}
          subtitle={`${modalOrdens.nome} · Matrícula ${modalOrdens.mat} · Plataforma ${modalOrdens.p}`}
          maxWidth={750}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const idEmb = modalOrdens.items[0]?.id_embarque;
                  openCarteiraModal(modalOrdens.mat, idEmb, D);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <span>📋 Ver Carteira Completa do Embarque</span>
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setModalOrdens(null)}
              >
                Fechar
              </button>
            </div>
          }
        >
          <div>
            {/* Resumo do Dia */}
            {(() => {
              const totalH = modalOrdens.items.reduce((acc, it) => acc + (it.horas_confirmadas || 0), 0);
              const totalEmCart = modalOrdens.items
                .filter(it => it.status_reconciliacao === 'Em Carteira')
                .reduce((acc, it) => acc + (it.horas_confirmadas || 0), 0);
              const totalForaCart = modalOrdens.items
                .filter(it => it.status_reconciliacao !== 'Em Carteira')
                .reduce((acc, it) => acc + (it.horas_confirmadas || 0), 0);

              return (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: '12px',
                    padding: '12px 14px',
                    background: 'var(--surface-alt)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '16px'
                  }}
                >
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Total confirmado no dia</span>
                    <b style={{ fontSize: '1.1rem', color: 'var(--blue)' }}>{formatHours(totalH)}</b>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Cadastradas no Portal</span>
                    <b style={{ fontSize: '1.1rem', color: 'var(--ok)' }}>{formatHours(totalEmCart)}</b>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Não cadastradas no Portal</span>
                    <b style={{ fontSize: '1.1rem', color: totalForaCart > 0 ? 'var(--orange-dark)' : 'var(--ink)' }}>
                      {formatHours(totalForaCart)}
                    </b>
                  </div>
                </div>
              );
            })()}

            {/* Aviso quando há ordens não cadastradas no Portal */}
            {modalOrdens.items.some(it => it.status_reconciliacao !== 'Em Carteira') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  background: 'var(--orange-soft, rgba(245, 158, 11, 0.1))',
                  border: '1px solid var(--orange, #f59e0b)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 14px',
                  marginBottom: '14px',
                  fontSize: '0.82rem',
                  color: 'var(--orange-dark, #b45309)'
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <b>Atenção:</b> Existem ordens confirmadas no SAP neste dia que <b>não constam na carteira programada do Portal Offshore</b> para este embarque. Elas são contabilizadas como horas executadas a bordo, mas geram divergência em relação ao planejamento cadastrado.
                </div>
              </div>
            )}

            {/* Tabela de Ordens */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' }}>
                Apontamentos confirmados pelo técnico no dia:
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const idEmb = modalOrdens.items[0]?.id_embarque;
                  openCarteiraModal(modalOrdens.mat, idEmb, D);
                }}
                style={{ fontSize: '0.78rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Briefcase size={13} />
                <span>Ver Carteira Completa do Embarque</span>
              </button>
            </div>
            <div className="table-responsive" style={{ maxHeight: '380px', overflowY: 'auto', overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' }}>
              <table className="table-base" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left', background: 'var(--surface)' }}>
                    <th style={{ padding: '8px' }}>Ordem</th>
                    <th style={{ padding: '8px' }}>Operação</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Horas Confirmadas</th>
                    <th style={{ padding: '8px' }}>Situação no Portal Offshore</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>Contador</th>
                    <th style={{ padding: '8px' }}>ID Embarque</th>
                  </tr>
                </thead>
                <tbody>
                  {modalOrdens.items.map((it, idx) => {
                    const isEmCart = it.status_reconciliacao === 'Em Carteira';
                    return (
                      <tr key={it.id || `${it.ordem}_${it.operacao}_${idx}`} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px', fontFamily: 'monospace', fontWeight: 600 }}>{it.ordem}</td>
                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>{it.operacao}</td>
                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>
                          {formatHours(it.horas_confirmadas)}
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '0.74rem',
                              fontWeight: 600,
                              background: isEmCart ? 'var(--green-soft, #dcfce7)' : 'var(--orange-soft, #fef3c7)',
                              color: isEmCart ? 'var(--ok, #15803d)' : 'var(--orange-dark, #b45309)'
                            }}
                          >
                            {isEmCart ? 'Cadastrada no Portal' : 'Não Cadastrada no Portal'}
                          </span>
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center', fontFamily: 'monospace', color: 'var(--ink-muted)' }}>
                          {it.contador_confirmacao || '—'}
                        </td>
                        <td style={{ padding: '8px', fontFamily: 'monospace', color: 'var(--ink-muted)' }}>
                          {it.id_embarque ? `ID ${it.id_embarque}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
