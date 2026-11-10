import type {
  AppDataset,
  CarteiraEmbarque,
  ContractConfig,
  FilterState,
  Justificativa,
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
  calcHpCarteiraInInterval,
  calcHpForaCarteiraInInterval,
  calcHpInInterval,
  computeDataAte,
  computePeriodDays,
  findCarteira,
  getClosedEmbarkations,
  hpSourceLabel,
  isArmadorPlatform,
  lookupPlatform,
  mergeConfrontoOperations,
  passesFilter,
  resolvePlace,
  resolveRecord
} from './calculations';

/**
 * Identifica se houve justificativa ou anotação de Gangway desconectada
 * no intervalo do embarque para a matrícula informada.
 */
export const hasGangwayJustification = (
  mat: string,
  ini: string,
  fim: string,
  justMap?: Record<string, Justificativa>
): boolean => {
  if (!justMap) return false;
  let hasGw = false;
  eachDay(ini, fim, d => {
    const j = justMap[`${mat}|${d}`];
    if (j && (j.motivo === 'Gangway desconectada' || (j.horas_gangway != null && Number(j.horas_gangway) > 0))) {
      hasGw = true;
    }
  });
  return hasGw;
};

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
  const enc = dataset.config.med_criterio === 'enc';

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
    sharedAcrossPortfolios = false,
    hpCarteira?: number,
    hpForaCarteira?: number,
    isDiaria = false,
    hasGw = false
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
        hpCarteira: 0,
        hpForaCarteira: 0,
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
    const effHpCarteira = hpCarteira !== undefined ? hpCarteira : hp;
    o.hpCarteira = (o.hpCarteira || 0) + effHpCarteira;
    o.hpForaCarteira = (o.hpForaCarteira || 0) + (hpForaCarteira || 0);
    o.hpAte += hpAte;
    o.hd += hd;
    o.hc += hc;

    if (sharedAcrossPortfolios) {
      o.sharedAcrossPortfolios = true;
    }

    if (isDiaria) {
      // Regra contratual para unidades por Diária (Armador / afretadas / UMS):
      // Fórmula: (quantidade de dias + 1) * 10
      const nDias = diffDays(a, b) + 1;
      const usDiaria = (nDias + 1) * 10;
      o.exHc += usDiaria;
    } else if (w.pe == null || w.ex == null) {
      o.falta = true;
    } else {
      o.pes.add(w.pe);
      o.exs.add(w.ex);

      if (hc === 0) {
        if (hasGw) {
          // Exceção Gangway com execução zero: recebe 30% da programação
          o.peHp += w.pe * effHpCarteira;
        }
        // Se execução zero e sem gangway: não pontua USOFF (peHp e exHc permanecem 0)
      } else {
        // Regra contratual de USOFF com execução confirmada:
        // - Carteira (>= 12 dias de antecedência): ponderação mista de Programação (PE * HP_carteira) e Execução (EX * HC)
        // - Fora da carteira (< 12 dias de antecedência): apenas Execução (EX * HC); PE não incide
        o.peHp += w.pe * effHpCarteira;
        o.exHc += w.ex * hc;
      }
    }
  };

  const hasGranularOps = Boolean(dataset.carteiraOperacoes && dataset.carteiraOperacoes.length > 0);

  if (hasGranularOps) {
    // Processamento granular por operação da carteira e confirmações SAP
    const rawOps = mergeConfrontoOperations(
      dataset.carteiraOperacoes || [],
      dataset.confirmacoesSap || [],
      dataset.carteira || [],
      dataset.tecnicos || {}
    );

    rawOps.forEach(op => {
      const a = op.data_inicio;
      const b = op.data_fim;
      if (enc) {
        if (b < P.ini || b > P.fim) return;
      } else {
        if (a > P.fim || b < P.ini) return;
      }
      if (op.status_programacao === 'Cancelada') return;

      const l = resolvePlace(pidx, op.plataforma_sigla || undefined, op.unidade_negocio);
      if (!passesFilter(l, filters, dataset.pessoas)) return;

      const platObj = lookupPlatform(pidx, op.plataforma_sigla || undefined);
      const isDiaria = isArmadorPlatform(platObj, op.plataforma_sigla || undefined, op.unidade_negocio);
      const hasGw = hasGangwayJustification(op.matricula, a, b, dataset.justMap);

      const hp = Number(op.hh_programado) || 0;
      const hc = Math.max(Number(op.hh_confirmado_sap) || 0, Number(op.hh_confirmado) || 0);

      const isCarteira = op.status_programacao === 'Carteira';
      const hpCart = isCarteira ? hp : 0;
      const hpFora = !isCarteira ? hp : 0;

      const embRef = dataset.carteira.find(ce => (ce.id_embarque && ce.id_embarque === op.id_embarque) || ce.matricula === op.matricula);
      const w = resolveUsoffWeights(embRef || null, l, dataset.config, dataset.usoffUnWeights);

      const isShared = !!(
        op.operacao &&
        dataset.sharedOpsSet &&
        dataset.sharedOpsSet.has(op.operacao)
      );

      const opKey = op.operacao
        ? `op:${op.operacao}`
        : (op.ordem ? `op:ORD_${op.ordem}` : `emb:${op.id_embarque || op.portal_id || op.matricula}`);

      add(
        opKey,
        {
          op: op.operacao || (op.ordem ? `Ordem ${op.ordem}` : ''),
          tipo: op.operacao ? 'Operação' : 'Embarque',
          fonte: isDiaria ? 'Diária (Armador)' : 'Portal Offshore'
        },
        l,
        op.matricula,
        a,
        b,
        hp,
        hp,
        hp,
        hc,
        w,
        isShared,
        hpCart,
        hpFora,
        isDiaria,
        hasGw
      );
    });
  } else {
    // Modo embarque consolidado (legado ou fixtures de teste)
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

      const platObj = lookupPlatform(pidx, c.plataforma_sigla);
      const isDiaria = isArmadorPlatform(platObj, c.plataforma_sigla, c.unidade_negocio);
      const hasGw = hasGangwayJustification(c.matricula, a, b, dataset.justMap);

      const isShared = !!(
        c.operacao &&
        dataset.sharedOpsSet &&
        dataset.sharedOpsSet.has(c.operacao)
      );

      const w = resolveUsoffWeights(c, l, dataset.config, dataset.usoffUnWeights);
      const opKey = c.operacao
        ? `op:${c.operacao}`
        : `emb:${c.id || c.matricula + '_' + c.data_inicio}`;

      const hpCart = calcHpCarteiraInInterval(c, a, b, dataset.config, dataset.plataformas);
      const hpFora = calcHpForaCarteiraInInterval(c, a, b);

      add(
        opKey,
        {
          op: c.operacao || '',
          tipo: c.operacao ? 'Operação' : 'Embarque',
          fonte: hpSourceLabel(c, dataset.config, dataset.plataformas)
        },
        l,
        c.matricula,
        a,
        b,
        calcHpInInterval(c, a, b, dataset.config, dataset.plataformas),
        calcHpInInterval(c, a, bb, dataset.config, dataset.plataformas),
        hd,
        hc,
        w,
        isShared,
        hpCart,
        hpFora,
        isDiaria,
        hasGw
      );
    });
  }

  if (!enc) {
    computePeriodDays(P, dataset, filters, pidx).forEach(x => {
      if (findCarteira(dataset.carteira, x.mat, x.D)) return;
      const platObj = lookupPlatform(pidx, x.p);
      const isDiaria = isArmadorPlatform(platObj, x.p, x.r);
      const hasGw = hasGangwayJustification(x.mat, x.D, x.D, dataset.justMap);
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
          fonte: isDiaria ? 'Diária (Armador)' : 'sem programação'
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
        false,
        0,
        0,
        isDiaria,
        hasGw
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
    hpCarteira: 0,
    hpForaCarteira: 0,
    hpAte: 0,
    hd: 0,
    hc: 0,
    peHp: 0,
    exHc: 0,
    falta: 0
  };

  list.forEach(o => {
    t.hp += o.hp;
    t.hpCarteira += o.hpCarteira ?? o.hp;
    t.hpForaCarteira += o.hpForaCarteira ?? 0;
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
