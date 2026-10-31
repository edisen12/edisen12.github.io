import type {
  AppDataset,
  CarteiraEmbarque,
  ContractConfig,
  FilterState,
  PeriodWindow,
  Plataforma,
  ResolvedPlace,
  UsoffOperationRow,
  UsoffSummary,
  UsoffUnWeight
} from './types';
import { diffDays } from '../utils/date';
import { calcPct } from '../utils/format';
import { eachDay } from './periods';
import {
  calcHpInInterval,
  computeDataAte,
  computePeriodDays,
  findCarteira,
  getClosedEmbarkations,
  hpSourceLabel,
  passesFilter,
  resolvePlace,
  resolveRecord
} from './calculations';

export const resolveUsoffWeights = (
  c: CarteiraEmbarque | null,
  place: ResolvedPlace,
  config: ContractConfig,
  usoffUnWeights: Record<string, UsoffUnWeight>
): { pe: number | null; ex: number | null } => {
  const u = usoffUnWeights[place.r] || { pe: null, ex: null };
  const pick = (
    a?: number | null,
    b?: number | null,
    d?: number | null
  ): number | null => {
    if (a != null && !isNaN(Number(a))) return Number(a);
    if (b != null && !isNaN(Number(b))) return Number(b);
    if (d != null && !isNaN(Number(d))) return Number(d);
    return null;
  };

  return {
    pe: pick(c?.pe, u.pe, config.us_pe_padrao),
    ex: pick(c?.ex, u.ex, config.us_ex_padrao)
  };
};

export const computeUsoffOperations = (
  P: PeriodWindow,
  dataset: AppDataset,
  filters: FilterState,
  pidx: Record<string, Plataforma>
): UsoffOperationRow[] => {
  const ate = computeDataAte(P, dataset.watermark.ultima_data_hh);
  const ops: Record<string, UsoffOperationRow> = {};

  const add = (
    key: string,
    meta: {
      op: string;
      tipo: 'Operação' | 'Embarque' | 'Sem programação';
      fonte: string;
    },
    l: ResolvedPlace,
    mat: string,
    a: string,
    b: string,
    hp: number,
    hpAte: number,
    hd: number,
    hc: number,
    w: { pe: number | null; ex: number | null },
    sharedAcrossPortfolios = false
  ) => {
    const o =
      ops[key] ||
      (ops[key] = {
        key,
        ...meta,
        mats: new Set<string>(),
        plats: new Set<string>(),
        regs: new Set<string>(),
        ini: a,
        fim: b,
        dias: 0,
        hp: 0,
        hpAte: 0,
        hd: 0,
        hc: 0,
        peHp: 0,
        exHc: 0,
        pes: new Set<number>(),
        exs: new Set<number>(),
        falta: false,
        us: null,
        pD: null,
        pP: null,
        sharedAcrossPortfolios: false
      });

    o.mats.add(mat);
    o.plats.add(l.p);
    o.regs.add(l.r);
    if (a < o.ini) o.ini = a;
    if (b > o.fim) o.fim = b;
    o.dias += diffDays(a, b) + 1;
    o.hp += hp;
    o.hpAte += hpAte;
    o.hd += hd;
    o.hc += hc;

    if (sharedAcrossPortfolios) {
      o.sharedAcrossPortfolios = true;
    }

    if (w.pe == null || w.ex == null) {
      o.falta = true;
    } else {
      o.peHp += w.pe * hp;
      o.exHc += w.ex * hc;
      o.pes.add(w.pe);
      o.exs.add(w.ex);
    }
  };

  const enc = dataset.config.med_criterio === 'enc';
  const listEmbarkations = enc
    ? getClosedEmbarkations(P, dataset, filters, pidx)
    : dataset.carteira;

  listEmbarkations.forEach(c => {
    const a = enc
      ? c.data_inicio
      : c.data_inicio > P.ini
      ? c.data_inicio
      : P.ini;
    const b = enc ? c.data_fim : c.data_fim < P.fim ? c.data_fim : P.fim;
    if (a > b) return;

    const l = resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio);
    if (!passesFilter(l, filters, dataset.pessoas)) return;

    let hd = 0;
    let hc = 0;
    const bb = b < ate ? b : ate;

    eachDay(a, bb, D => {
      const r = resolveRecord(c.matricula, D, dataset);
      if (r) {
        hd += r.d;
        hc += r.e;
      }
    });

    const isShared = !!(
      c.operacao &&
      dataset.sharedOpsSet &&
      dataset.sharedOpsSet.has(c.operacao)
    );

    const w = resolveUsoffWeights(c, l, dataset.config, dataset.usoffUnWeights);
    const opKey = c.operacao
      ? `op:${c.operacao}`
      : `emb:${c.id || c.matricula + '_' + c.data_inicio}`;

    add(
      opKey,
      {
        op: c.operacao || '',
        tipo: c.operacao ? 'Operação' : 'Embarque',
        fonte: hpSourceLabel(c, dataset.config)
      },
      l,
      c.matricula,
      a,
      b,
      calcHpInInterval(c, a, b, dataset.config),
      calcHpInInterval(c, a, bb, dataset.config),
      hd,
      hc,
      w,
      isShared
    );
  });

  if (!enc) {
    computePeriodDays(P, dataset, filters, pidx).forEach(x => {
      if (findCarteira(dataset.carteira, x.mat, x.D)) return;
      const w = resolveUsoffWeights(
        null,
        { p: x.p, r: x.r },
        dataset.config,
        dataset.usoffUnWeights
      );
      add(
        `sp:${x.mat}_${x.p}`,
        {
          op: '',
          tipo: 'Sem programação',
          fonte: 'sem programação'
        },
        { p: x.p, r: x.r },
        x.mat,
        x.D,
        x.D,
        0,
        0,
        x.d,
        x.e,
        w,
        false
      );
    });
  }

  return Object.values(ops)
    .map(o => ({
      ...o,
      us: o.falta ? null : o.peHp + o.exHc,
      pD: calcPct(o.hc, o.hd),
      pP: calcPct(o.hc, o.hpAte)
    }))
    .sort((a, b) => (a.pP ?? 999) - (b.pP ?? 999));
};

export const summarizeUsoff = (list: UsoffOperationRow[]): UsoffSummary => {
  const t = {
    n: list.length,
    hp: 0,
    hpAte: 0,
    hd: 0,
    hc: 0,
    peHp: 0,
    exHc: 0,
    falta: 0
  };

  list.forEach(o => {
    t.hp += o.hp;
    t.hpAte += o.hpAte;
    t.hd += o.hd;
    t.hc += o.hc;
    if (o.falta) {
      t.falta++;
    } else {
      t.peHp += o.peHp;
      t.exHc += o.exHc;
    }
  });

  const us = t.falta ? null : t.peHp + t.exHc;
  const pD = calcPct(t.hc, t.hd);
  const pP = calcPct(t.hc, t.hpAte);

  return {
    ...t,
    us,
    pD,
    pP
  };
};
