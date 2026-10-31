import React, { useState, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { KpiCard } from '../components/KpiCard';
import { StatusPill } from '../components/StatusPill';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl } from '../components/SegmentedControl';
import type {
  EmbarkationAccum,
  EmbarkationInfo,
  StatusMeta
} from '../../domain/types';
import {
  accumulateEmbarkation,
  computeDayRows,
  inferEmbarkation,
  passesFilter,
  resolveLocation,
  resolveRecord,
  resolveTechName,
  statusOf
} from '../../domain/calculations';
import { addDays, formatBr, formatBrShort, todayIso } from '../../utils/date';
import {
  calcPct,
  formatHours,
  formatPct,
  formatSignedHours,
  plural
} from '../../utils/format';

interface EmbarqueRowItem {
  mat: string;
  nome: string;
  p: string;
  r: string;
  emb: EmbarkationInfo;
  acc: EmbarkationAccum;
}

export function EmbarqueAtualView() {
  const { dataset, pidx, filters, openFichaDrawer } = useApp();

  const [statusFilter, setStatusFilter] = useState<'todos' | 'negativo' | 'ok'>('todos');
  const D = filters.fDate || todayIso();

  // Computa técnicos a bordo
  const rows = useMemo(() => {
    const mats = new Set<string>();

    // Técnicos com carteira ativa na data
    dataset.carteira.forEach(c => {
      if (c.data_inicio <= D && D <= c.data_fim) {
        mats.add(c.matricula);
      }
    });

    // Técnicos com apontamento na data
    computeDayRows(D, dataset, pidx).forEach(r => mats.add(r.mat));

    const list: EmbarqueRowItem[] = [];

    mats.forEach(mat => {
      let emb = inferEmbarkation(mat, D, dataset);
      if (!emb) {
        // Fallback: busca apontamentos recentes até 3 dias antes
        for (let i = 1; i <= 3; i++) {
          const prevDate = addDays(D, -i);
          const r = resolveRecord(mat, prevDate, dataset);
          if (r) {
            emb = inferEmbarkation(mat, prevDate, dataset);
            break;
          }
        }
      }

      if (!emb) return;

      const refDate = D <= emb.fim ? D : emb.fim;
      const loc = resolveLocation(mat, refDate, dataset, pidx);

      if (!passesFilter(loc, filters, dataset.pessoas)) return;

      const acc = accumulateEmbarkation(mat, refDate, emb, dataset);

      list.push({
        mat,
        nome: resolveTechName(mat, dataset),
        p: loc.p,
        r: loc.r,
        emb,
        acc
      });
    });

    return list.sort((a, b) => (a.acc.p ?? 999) - (b.acc.p ?? 999));
  }, [D, dataset, pidx, filters]);

  // Agregações dos 6 KPIs
  const { prog, pd, pe, negCount } = useMemo(() => {
    let totProg = 0;
    let totD = 0;
    let totE = 0;
    let negs = 0;

    rows.forEach(r => {
      totProg += r.acc.prog;
      totD += r.acc.d;
      totE += r.acc.e;
      if (r.acc.saldo < 0) {
        negs++;
      }
    });

    return {
      prog: totProg,
      pd: totD,
      pe: totE,
      negCount: negs
    };
  }, [rows]);

  const accPct = calcPct(pe, pd);
  const accSt = statusOf(accPct, dataset.config);

  const columns: DataTableColumn<EmbarqueRowItem>[] = [
    {
      key: 'st',
      header: 'Acumulado',
      render: r => <StatusPill status={statusOf(r.acc.p, dataset.config)} />
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
            {r.nome}
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
      key: 'emb',
      header: 'Embarque',
      render: r => (
        <div>
          <div>{formatBrShort(r.emb.ini)} a {formatBrShort(r.emb.fim)}</div>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            Dia {Math.min(r.emb.dia, r.emb.n)} de {r.emb.n}
            {r.emb.fonte === 'apontamentos' && ' · sem carteira'}
          </div>
        </div>
      )
    },
    {
      key: 'prog',
      header: 'HH programado',
      align: 'right',
      sortValue: r => r.acc.prog,
      render: r => (
        <div>
          <div>{formatHours(r.acc.prog)}</div>
          {r.emb.hpF && (
            <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
              {r.emb.hpF}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'progAte',
      header: 'Programado até agora',
      align: 'right',
      sortValue: r => r.acc.progAte,
      render: r => formatHours(r.acc.progAte)
    },
    {
      key: 'disp',
      header: 'Disponível até agora',
      align: 'right',
      sortValue: r => r.acc.d,
      render: r => formatHours(r.acc.d)
    },
    {
      key: 'exec',
      header: 'Executado',
      align: 'right',
      sortValue: r => r.acc.e,
      render: r => formatHours(r.acc.e)
    },
    {
      key: 'pctD',
      header: '% do disponível',
      sortValue: r => r.acc.p ?? -1,
      render: r => (
        <span style={{ fontWeight: 600 }}>
          {formatPct(r.acc.p)}
        </span>
      )
    },
    {
      key: 'pctP',
      header: '% do programado',
      sortValue: r => calcPct(r.acc.e, r.acc.progAte) ?? -1,
      render: r => (
        <span style={{ fontWeight: 600 }}>
          {formatPct(calcPct(r.acc.e, r.acc.progAte))}
        </span>
      )
    },
    {
      key: 'saldo',
      header: 'Saldo',
      align: 'right',
      sortValue: r => r.acc.saldo,
      render: r => (
        <span style={{ color: r.acc.saldo >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 700 }}>
          {formatSignedHours(r.acc.saldo)}
        </span>
      )
    },
    {
      key: 'gw',
      header: 'Gangway',
      align: 'right',
      sortValue: r => r.acc.gw,
      render: r => (r.acc.gw > 0 ? formatHours(r.acc.gw) : '—')
    }
  ];

  const filteredRows = useMemo(() => {
    if (statusFilter === 'negativo') {
      return rows.filter(r => r.acc.saldo < 0);
    }
    if (statusFilter === 'ok') {
      return rows.filter(r => r.acc.saldo >= 0);
    }
    return rows;
  }, [rows, statusFilter]);

  return (
    <div className="view-embarque-atual">
      {/* Cabeçalho */}
      <div className="card-header-view" style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
          Quem está embarcado em {formatBr(D)}
        </h2>
        <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
          Acumulado desde o primeiro dia do embarque até {formatBr(D)}
        </div>
      </div>

      {!rows.length ? (
        <div className="note" style={{ textAlign: 'center', padding: '32px' }}>
          Nenhum técnico embarcado neste dia
          {filters.fReg || filters.fPlat ? ' com esses filtros' : ''}. Importe a carteira de embarque para ver quem está a bordo.
        </div>
      ) : (
        <>
          {/* 6 KPIs */}
          <div className="kpis">
            <KpiCard
              value={rows.length}
              label="técnicos embarcados"
              tone="blue"
            />
            <KpiCard
              value={formatHours(prog)}
              label="HH programado dos embarques"
              tone="blue"
            />
            <KpiCard
              value={formatHours(pd)}
              label="disponível até agora"
              tone="blue"
            />
            <KpiCard
              value={formatHours(pe)}
              label="executado até agora"
              tone="blue"
            />
            <KpiCard
              value={formatPct(accPct)}
              label="acumulado"
              tone={accSt === 'ok' ? 'ok' : accSt === 'warn' ? 'warn' : 'bad'}
            />
            <KpiCard
              value={negCount}
              label="com saldo negativo"
              tone={negCount > 0 ? 'bad' : 'ok'}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <div className="section-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--f-display)' }}>Técnicos a bordo</h3>

              <SegmentedControl<'todos' | 'negativo' | 'ok'>
                options={[
                  { value: 'todos', label: 'Todos a bordo', count: rows.length },
                  { value: 'negativo', label: 'Com saldo negativo', count: negCount, badgeTone: negCount > 0 ? 'bad' : 'default' },
                  { value: 'ok', label: 'Na meta', count: rows.length - negCount, badgeTone: 'ok' }
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
                size="sm"
              />
            </div>

            <DataTable
              data={filteredRows}
              columns={columns}
              rowKey={r => `${r.mat}_${r.p}_${r.emb.ini}`}
              searchable
              searchPlaceholder="Buscar técnico, matrícula ou plataforma..."
              getSearchString={r => `${r.nome} ${r.mat} ${r.p} ${r.r}`}
              emptyMessage={
                statusFilter === 'negativo'
                  ? 'Nenhum técnico com saldo negativo a bordo.'
                  : 'Nenhum técnico embarcado encontrado com esses filtros.'
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
