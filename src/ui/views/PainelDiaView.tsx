import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { KpiCard } from '../components/KpiCard';
import { StatusPill } from '../components/StatusPill';
import { MeterBar } from '../components/MeterBar';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl } from '../components/SegmentedControl';
import type { DayTechRow, StatusMeta } from '../../domain/types';
import {
  calcPct,
  formatHours,
  formatPct,
  formatSignedHours,
  plural
} from '../../utils/format';
import { addDays, diffDays, formatBr, formatBrShort, todayIso } from '../../utils/date';
import {
  computeDayRows,
  gestorOfUn,
  groupDaysByField,
  passesFilter,
  prazoOf,
  statusOf
} from '../../domain/calculations';
import { buildDailyAlertText } from '../../domain/communications';

export function PainelDiaView() {
  const {
    dataset,
    pidx,
    filters,
    updateFilter,
    openFichaDrawer,
    openJustModal,
    openEmailModal
  } = useApp();

  const { showToast } = useToast();
  const [dayViewMode, setDayViewMode] = useState<'abaixo' | 'todos'>('abaixo');

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
      width: '110px',
      sortValue: r => (r.sem ? 0 : r.e),
      render: r => (
        r.sem ? (
          <div>
            <span style={{ color: 'var(--bad)', fontWeight: 700 }}>Não chegou</span>
            <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>conta 0 h</div>
          </div>
        ) : (
          formatHours(r.e)
        )
      )
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
      <div className="card-header-view" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
            Execução de {formatBr(D)} {D === ontem ? '(ontem)' : ''}
          </h2>
          <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
            Acompanhamento diário de execução e faltas de apontamento
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
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
    </div>
  );
}
