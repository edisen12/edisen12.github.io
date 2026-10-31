import type {
  AggregatedMetrics,
  AppDataset,
  CarteiraEmbarque,
  CobrancaStats,
  ContractConfig,
  DayTechRow,
  EmbarkationAccum,
  EmbarkationInfo,
  FilterState,
  PeriodDayEntry,
  PeriodTechSummary,
  PeriodWindow,
  Pessoa,
  Plataforma,
  ResolvedPlace,
  ResolvedRecord,
  StatusMeta
} from './types';
import {
  addDays,
  diffDays,
  formatBr,
  formatBrShort,
  todayIso
} from '../utils/date';
import {
  calcPct,
  formatHours,
  platformKey
} from '../utils/format';
import { eachDay } from './periods';

export const buildPlatformIndex = (
  plataformas: Record<string, Plataforma>
): Record<string, Plataforma> => {
  const idx: Record<string, Plataforma> = {};
  Object.values(plataformas).forEach(p => {
    [p.sigla, p.nome].forEach(x => {
      const k = platformKey(x);
      if (k && !idx[k]) {
        idx[k] = p;
      }
    });
  });
  return idx;
};

export const lookupPlatform = (
  pidx: Record<string, Plataforma>,
  rawName?: string | null
): Plataforma | null => {
  if (!rawName) return null;
  return pidx[platformKey(rawName)] || null;
};

export const formatPlatformLabel = (p: Plataforma): string => {
  const hasDiffName = p.nome && platformKey(p.nome) !== platformKey(p.sigla);
  const base = hasDiffName ? `${p.sigla} · ${p.nome}` : p.sigla;
  return p.armador ? `${base} · Armador ${p.armador}` : base;
};

export const armadorOf = (
  pidx: Record<string, Plataforma>,
  sigla?: string
): string => {
  const inf = lookupPlatform(pidx, sigla);
  return (inf && inf.armador) || '';
};

export const resolvePlace = (
  pidx: Record<string, Plataforma>,
  rawPlat?: string,
  rawUn?: string
): ResolvedPlace => {
  const inf = lookupPlatform(pidx, rawPlat);
  return {
    p: inf ? inf.sigla : rawPlat || 'Sem plataforma',
    r: (inf && inf.un) || rawUn || 'Sem unidade'
  };
};

export const statusOf = (
  pctVal: number | null,
  config: ContractConfig
): StatusMeta => {
  if (pctVal == null) return 'sem';
  if (pctVal >= config.meta_percentual - 0.0001) return 'ok';
  if (pctVal >= config.atencao_percentual) return 'warn';
  return 'bad';
};

export const prazoOf = (dateIso: string, config: ContractConfig): string => {
  return addDays(dateIso, Number(config.prazo_justificativa_dias) || 2);
};

export const findCarteira = (
  carteira: CarteiraEmbarque[],
  mat: string,
  dateIso: string
): CarteiraEmbarque | null => {
  return (
    carteira.find(
      e => e.matricula === mat && e.data_inicio <= dateIso && dateIso <= e.data_fim
    ) || null
  );
};

export const calcCarteiraHP = (
  c: CarteiraEmbarque,
  config: ContractConfig
): number => {
  const n = diffDays(c.data_inicio, c.data_fim) + 1;
  const H = Number(config.hh_dia) || 11;
  return c.horas_programadas != null && !isNaN(Number(c.horas_programadas))
    ? Number(c.horas_programadas)
    : n * H;
};

export const hpSourceLabel = (
  c: CarteiraEmbarque,
  config: ContractConfig
): string => {
  return c.horas_programadas != null && !isNaN(Number(c.horas_programadas))
    ? 'Portal Offshore'
    : `dias × ${formatHours(config.hh_dia)}`;
};

export const calcHpInInterval = (
  c: CarteiraEmbarque,
  a: string,
  b: string,
  config: ContractConfig
): number => {
  if (a > b) return 0;
  const n = diffDays(c.data_inicio, c.data_fim) + 1;
  return (calcCarteiraHP(c, config) * (diffDays(a, b) + 1)) / n;
};

export const computeDataAte = (
  P: PeriodWindow,
  lastDate: string | null
): string => {
  return lastDate && lastDate < P.fim ? lastDate : P.fim;
};

export const resolveRecord = (
  mat: string,
  dateIso: string,
  dataset: AppDataset
): ResolvedRecord | null => {
  const key = `${mat}|${dateIso}`;
  const rec = dataset.hhMap[key];
  const hhDia = Number(dataset.config.hh_dia) || 11;

  if (rec) {
    return {
      d: hhDia,
      e: Number(rec.horas_executadas) || 0,
      p: rec.plataforma_sigla || '',
      r: rec.unidade_negocio || '',
      sem: false
    };
  }

  const lastDate = dataset.watermark.ultima_data_hh;
  if (
    lastDate &&
    dateIso <= lastDate &&
    findCarteira(dataset.carteira, mat, dateIso)
  ) {
    if (dataset.externalCoveredSet && dataset.externalCoveredSet.has(key)) {
      return null;
    }
    return {
      d: hhDia,
      e: 0,
      p: '',
      r: '',
      sem: true
    };
  }

  return null;
};

export const resolveLocation = (
  mat: string,
  dateIso: string,
  dataset: AppDataset,
  pidx: Record<string, Plataforma>
): ResolvedPlace => {
  const r = resolveRecord(mat, dateIso, dataset);
  const c = findCarteira(dataset.carteira, mat, dateIso);
  return resolvePlace(
    pidx,
    (r && r.p) || (c && c.plataforma_sigla) || '',
    (r && r.r) || (c && c.unidade_negocio) || ''
  );
};

export const inferEmbarkation = (
  mat: string,
  dateIso: string,
  dataset: AppDataset
): EmbarkationInfo | null => {
  const c = findCarteira(dataset.carteira, mat, dateIso);
  if (c) {
    const dia = diffDays(c.data_inicio, dateIso) + 1;
    const n = diffDays(c.data_inicio, c.data_fim) + 1;
    return {
      ini: c.data_inicio,
      fim: c.data_fim,
      dia,
      n,
      plat: c.plataforma_sigla,
      reg: c.unidade_negocio,
      fonte: 'carteira',
      hp: calcCarteiraHP(c, dataset.config),
      hpF: hpSourceLabel(c, dataset.config)
    };
  }

  const key = `${mat}|${dateIso}`;
  if (!dataset.hhMap[key]) return null;

  let ini = dateIso;
  for (let i = 0; i < 40; i++) {
    const p = addDays(ini, -1);
    if (dataset.hhMap[`${mat}|${p}`]) {
      ini = p;
    } else {
      break;
    }
  }

  const n = Number(dataset.config.dias_embarque) || 14;
  const H = Number(dataset.config.hh_dia) || 11;
  return {
    ini,
    fim: addDays(ini, n - 1),
    dia: diffDays(ini, dateIso) + 1,
    n,
    plat: '',
    reg: '',
    fonte: 'apontamentos',
    hp: n * H,
    hpF: 'sem programação'
  };
};

export const accumulateEmbarkation = (
  mat: string,
  dateIso: string,
  emb: EmbarkationInfo,
  dataset: AppDataset
): EmbarkationAccum => {
  let d = 0;
  let e = 0;
  let gw = 0;
  let dias = 0;

  for (let x = emb.ini; x <= dateIso; x = addDays(x, 1)) {
    const r = resolveRecord(mat, x, dataset);
    if (r) {
      d += r.d;
      e += r.e;
      dias++;
    }
    const j = dataset.justMap[`${mat}|${x}`];
    if (j && j.horas_gangway) {
      gw += Number(j.horas_gangway) || 0;
    }
  }

  const H = Number(dataset.config.hh_dia) || 11;
  const prog = emb.hp != null ? emb.hp : emb.n * H;
  const progAte =
    prog *
    (Math.min(emb.n, Math.max(0, diffDays(emb.ini, dateIso) + 1)) / emb.n);

  return {
    d,
    e,
    gw,
    dias,
    p: calcPct(e, d),
    saldo: e - d,
    prog,
    progAte,
    pAj: calcPct(e, Math.max(0, d - gw))
  };
};

export const isPersonResponsible = (
  pessoa: Pessoa,
  place: ResolvedPlace
): boolean => {
  const pkPlace = platformKey(place.p);
  const plOk = (pessoa.plats || []).some(x => platformKey(x) === pkPlace);
  const unOk = (pessoa.uns || []).includes(place.r);
  return plOk || unOk;
};

export const findResponsiblePeople = (
  pessoas: Record<string, Pessoa>,
  plats: string[],
  uns: string[]
): Pessoa[] => {
  const platKeys = plats.map(platformKey);
  return Object.values(pessoas)
    .filter(
      ps =>
        (ps.plats || []).some(x => platKeys.includes(platformKey(x))) ||
        (ps.uns || []).some(u => uns.includes(u))
    )
    .sort(
      (a, b) =>
        (a.papel || '').localeCompare(b.papel || '') ||
        a.nome.localeCompare(b.nome)
    );
};

export const gestorOfUn = (
  un: string,
  plataformas: Record<string, Plataforma>,
  pessoas: Record<string, Pessoa>
): string => {
  const plats = Object.values(plataformas)
    .filter(p => p.un === un)
    .map(p => p.sigla);
  return findResponsiblePeople(pessoas, plats, [un])
    .filter(p => p.papel !== 'controlador')
    .map(p => p.nome)
    .join(', ');
};

export const passesFilter = (
  place: ResolvedPlace,
  filters: FilterState,
  pessoas: Record<string, Pessoa>
): boolean => {
  if (filters.fReg && place.r !== filters.fReg) return false;
  if (filters.fPlat && place.p !== filters.fPlat) return false;
  if (filters.fResp) {
    const ps = pessoas[filters.fResp];
    if (ps && !isPersonResponsible(ps, place)) return false;
  }
  return true;
};

export const resolveTechName = (mat: string, dataset: AppDataset): string => {
  const t = dataset.tecnicos[mat];
  if (t && t.nome) return t.nome;
  const c = dataset.carteira.find(x => x.matricula === mat && x.nome);
  if (c && c.nome) return c.nome;
  return `Matrícula ${mat}`;
};

export const computeDayRows = (
  dateIso: string,
  dataset: AppDataset,
  pidx: Record<string, Plataforma>
): DayTechRow[] => {
  const mats = new Set<string>();
  Object.keys(dataset.hhMap).forEach(key => {
    const [mat, d] = key.split('|');
    if (d === dateIso) mats.add(mat);
  });
  dataset.carteira.forEach(c => {
    if (c.data_inicio <= dateIso && dateIso <= c.data_fim) {
      mats.add(c.matricula);
    }
  });

  const out: DayTechRow[] = [];
  mats.forEach(mat => {
    const r = resolveRecord(mat, dateIso, dataset);
    if (!r) return;
    const l = resolveLocation(mat, dateIso, dataset, pidx);
    const emb = inferEmbarkation(mat, dateIso, dataset);
    const acc = emb ? accumulateEmbarkation(mat, dateIso, emb, dataset) : null;
    const pc = calcPct(r.e, r.d);
    const j = dataset.justMap[`${mat}|${dateIso}`] || null;

    out.push({
      mat,
      nome: resolveTechName(mat, dataset),
      D: dateIso,
      p: l.p,
      r: l.r,
      d: r.d,
      e: r.e,
      sem: r.sem,
      pc,
      st: statusOf(pc, dataset.config),
      emb,
      acc,
      j
    });
  });

  return out.sort(
    (a, b) => (a.pc ?? 999) - (b.pc ?? 999) || a.nome.localeCompare(b.nome)
  );
};

export const computePeriodDays = (
  P: PeriodWindow,
  dataset: AppDataset,
  filters: FilterState,
  pidx: Record<string, Plataforma>
): PeriodDayEntry[] => {
  const out: PeriodDayEntry[] = [];
  const mats = new Set<string>();
  Object.keys(dataset.hhMap).forEach(k => {
    const [mat] = k.split('|');
    mats.add(mat);
  });
  dataset.carteira.forEach(c => {
    if (!(c.data_fim < P.ini || c.data_inicio > P.fim)) {
      mats.add(c.matricula);
    }
  });

  mats.forEach(mat => {
    eachDay(P.ini, P.fim, D => {
      const r = resolveRecord(mat, D, dataset);
      if (!r) return;
      const l = resolveLocation(mat, D, dataset, pidx);
      if (!passesFilter(l, filters, dataset.pessoas)) return;
      out.push({
        mat,
        D,
        p: l.p,
        r: l.r,
        d: r.d,
        e: r.e,
        sem: r.sem,
        j: dataset.justMap[`${mat}|${D}`] || null
      });
    });
  });

  return out.sort((a, b) => (a.D < b.D ? -1 : a.D > b.D ? 1 : 0));
};

export const getClosedEmbarkations = (
  P: PeriodWindow,
  dataset: AppDataset,
  filters: FilterState,
  pidx: Record<string, Plataforma>
): CarteiraEmbarque[] => {
  return dataset.carteira.filter(c => {
    const inPeriod = c.data_fim >= P.ini && c.data_fim <= P.fim;
    if (!inPeriod) return false;
    const cl = resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio);
    return passesFilter(cl, filters, dataset.pessoas);
  });
};

export const getRollingEmbarkations = (
  P: PeriodWindow,
  dataset: AppDataset,
  filters: FilterState,
  pidx: Record<string, Plataforma>
): CarteiraEmbarque[] => {
  return dataset.carteira.filter(c => {
    const isRolling = c.data_fim > P.fim && c.data_inicio <= P.fim;
    if (!isRolling) return false;
    const cl = resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio);
    return passesFilter(cl, filters, dataset.pessoas);
  });
};

export const computeMeasurementDays = (
  P: PeriodWindow,
  dataset: AppDataset,
  filters: FilterState,
  pidx: Record<string, Plataforma>
): PeriodDayEntry[] => {
  if (dataset.config.med_criterio !== 'enc') {
    return computePeriodDays(P, dataset, filters, pidx);
  }
  const out: PeriodDayEntry[] = [];
  const seen = new Set<string>();
  const ate = computeDataAte(P, dataset.watermark.ultima_data_hh);

  getClosedEmbarkations(P, dataset, filters, pidx).forEach(c => {
    const maxD = c.data_fim < ate ? c.data_fim : ate;
    eachDay(c.data_inicio, maxD, D => {
      const k = `${c.matricula}|${D}`;
      if (seen.has(k)) return;
      seen.add(k);
      const r = resolveRecord(c.matricula, D, dataset);
      if (!r) return;
      const l = resolveLocation(c.matricula, D, dataset, pidx);
      out.push({
        mat: c.matricula,
        D,
        p: l.p,
        r: l.r,
        d: r.d,
        e: r.e,
        sem: r.sem,
        j: dataset.justMap[k] || null
      });
    });
  });

  return out.sort((a, b) => (a.D < b.D ? -1 : a.D > b.D ? 1 : 0));
};

export const aggregateDays = (
  days: PeriodDayEntry[],
  config: ContractConfig,
  today?: string
): AggregatedMetrics => {
  const refToday = today || todayIso();
  const mats: Record<string, { d: number; e: number; inf: number }> = {};
  const plats = new Set<string>();
  const regs = new Set<string>();
  let d = 0;
  let e = 0;
  let n = 0;
  let inf = 0;
  let pend = 0;
  let venc = 0;
  let gw = 0;

  days.forEach(x => {
    d += x.d;
    e += x.e;
    n++;
    plats.add(x.p);
    regs.add(x.r);
    const below = x.e < x.d - 0.001;
    if (below) {
      inf++;
      if (!x.j) {
        pend++;
        if (refToday > prazoOf(x.D, config)) {
          venc++;
        }
      }
    }
    if (x.j) {
      gw += Number(x.j.horas_gangway) || 0;
    }
    const m = mats[x.mat] || (mats[x.mat] = { d: 0, e: 0, inf: 0 });
    m.d += x.d;
    m.e += x.e;
    if (below) m.inf++;
  });

  const ms = Object.values(mats);
  const tec = ms.length;
  const M = config.meta_percentual - 0.0001;
  const abAcc = ms.filter(v => (calcPct(v.e, v.d) ?? 0) < M).length;
  const p = calcPct(e, d);
  const saldo = e - d;
  const pInf = n ? (inf / n) * 100 : null;
  const st = statusOf(p, config);

  return {
    d,
    e,
    n,
    inf,
    pend,
    venc,
    gw,
    tec,
    abAcc,
    p,
    saldo,
    pInf,
    st,
    mats,
    plats,
    regs
  };
};

export const computePeriodTechs = (
  P: PeriodWindow,
  forMeasurement: boolean,
  dataset: AppDataset,
  filters: FilterState,
  pidx: Record<string, Plataforma>
): PeriodTechSummary[] => {
  const enc = forMeasurement && dataset.config.med_criterio === 'enc';
  const days = forMeasurement
    ? computeMeasurementDays(P, dataset, filters, pidx)
    : computePeriodDays(P, dataset, filters, pidx);

  const by: Record<
    string,
    {
      mat: string;
      nome: string;
      d: number;
      e: number;
      gw: number;
      dias: number;
      semAp: number;
      pend: number;
      jus: number;
      plats: Set<string>;
      regs: Set<string>;
      list: PeriodDayEntry[];
    }
  > = {};

  days.forEach(x => {
    const o =
      by[x.mat] ||
      (by[x.mat] = {
        mat: x.mat,
        nome: resolveTechName(x.mat, dataset),
        d: 0,
        e: 0,
        gw: 0,
        dias: 0,
        semAp: 0,
        pend: 0,
        jus: 0,
        plats: new Set<string>(),
        regs: new Set<string>(),
        list: []
      });
    o.d += x.d;
    o.e += x.e;
    if (!x.sem) o.dias++;
    else o.semAp = (o.semAp || 0) + 1;
    o.plats.add(x.p);
    o.regs.add(x.r);
    o.list.push(x);
    if (x.j) {
      o.jus++;
      o.gw += Number(x.j.horas_gangway) || 0;
    } else if (x.e < x.d - 0.001) {
      o.pend++;
    }
  });

  const candidateEmbarkations = enc
    ? getClosedEmbarkations(P, dataset, filters, pidx)
    : dataset.carteira;

  candidateEmbarkations.forEach(c => {
    if (c.data_fim < P.ini || c.data_inicio > P.fim) return;
    const cl = resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio);
    if (!passesFilter(cl, filters, dataset.pessoas)) return;
    if (!by[c.matricula]) {
      by[c.matricula] = {
        mat: c.matricula,
        nome: resolveTechName(c.matricula, dataset),
        d: 0,
        e: 0,
        gw: 0,
        dias: 0,
        semAp: 0,
        pend: 0,
        jus: 0,
        plats: new Set([cl.p]),
        regs: new Set([cl.r]),
        list: []
      };
    }
  });

  const ate = computeDataAte(P, dataset.watermark.ultima_data_hh);

  const progInPeriod = (mat: string, win: PeriodWindow, limitDate?: string): number => {
    let t = 0;
    dataset.carteira
      .filter(c => c.matricula === mat)
      .forEach(c => {
        const cl = resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio);
        if (!passesFilter(cl, filters, dataset.pessoas)) return;
        const a = c.data_inicio > win.ini ? c.data_inicio : win.ini;
        let b = c.data_fim < win.fim ? c.data_fim : win.fim;
        if (limitDate && b > limitDate) b = limitDate;
        t += calcHpInInterval(c, a, b, dataset.config);
      });
    return t;
  };

  const cartDaysInPeriod = (mat: string, win: PeriodWindow): number => {
    let n = 0;
    const seen: Record<string, boolean> = {};
    dataset.carteira
      .filter(c => c.matricula === mat)
      .forEach(c => {
        const a = c.data_inicio > win.ini ? c.data_inicio : win.ini;
        const b = c.data_fim < win.fim ? c.data_fim : win.fim;
        if (a > b) return;
        eachDay(a, b, x => {
          if (seen[x]) return;
          const cl = resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio);
          if (!passesFilter(cl, filters, dataset.pessoas)) return;
          seen[x] = true;
          n++;
        });
      });
    return n;
  };

  return Object.values(by)
    .map(o => {
      let cd = 0;
      let pg = 0;
      let pa = 0;
      let embs = '';

      if (enc) {
        const es = getClosedEmbarkations(P, dataset, filters, pidx).filter(
          c => c.matricula === o.mat
        );
        embs = es
          .map(
            c =>
              formatBrShort(c.data_inicio) +
              ' a ' +
              formatBrShort(c.data_fim) +
              (c.data_inicio < P.ini ? ' (iniciou na medição anterior)' : '')
          )
          .join('; ');
        cd = es.reduce((t, c) => t + diffDays(c.data_inicio, c.data_fim) + 1, 0);
        pg = es.reduce((t, c) => t + calcCarteiraHP(c, dataset.config), 0);
        pa = es.reduce(
          (t, c) =>
            t +
            calcHpInInterval(
              c,
              c.data_inicio,
              c.data_fim < ate ? c.data_fim : ate,
              dataset.config
            ),
          0
        );
      } else {
        cd = cartDaysInPeriod(o.mat, P);
        pg = progInPeriod(o.mat, P);
        pa = progInPeriod(o.mat, P, ate);
      }

      const p = calcPct(o.e, o.d);
      const pProg = calcPct(o.e, pa);
      const pAj = calcPct(o.e, Math.max(0, o.d - o.gw));

      return {
        ...o,
        embs,
        cartDias: cd,
        prog: pg,
        progAte: pa,
        pProg,
        p,
        pAj,
        st: statusOf(p, dataset.config)
      };
    })
    .sort((a, b) => (a.p ?? 999) - (b.p ?? 999) || a.nome.localeCompare(b.nome));
};

export const groupDaysByField = (
  days: PeriodDayEntry[],
  field: 'p' | 'r',
  config: ContractConfig
) => {
  const g: Record<
    string,
    {
      k: string;
      d: number;
      e: number;
      gw: number;
      mats: Set<string>;
      pend: number;
      abaixo: number;
      reg: string;
    }
  > = {};

  days.forEach(x => {
    const k = x[field];
    const o =
      g[k] ||
      (g[k] = {
        k,
        d: 0,
        e: 0,
        gw: 0,
        mats: new Set<string>(),
        pend: 0,
        abaixo: 0,
        reg: x.r
      });
    o.d += x.d;
    o.e += x.e;
    o.mats.add(x.mat);
    if (x.j) {
      o.gw += Number(x.j.horas_gangway) || 0;
    } else if (x.e < x.d - 0.001) {
      o.pend++;
    }
    if (x.e < x.d - 0.001) {
      o.abaixo++;
    }
  });

  return Object.values(g)
    .map(o => {
      const p = calcPct(o.e, o.d);
      return {
        ...o,
        p,
        st: statusOf(p, config)
      };
    })
    .sort((a, b) => (a.p ?? 999) - (b.p ?? 999));
};

export const computeCobrancaStats = (
  daysBelowTarget: PeriodDayEntry[],
  config: ContractConfig,
  today?: string
): CobrancaStats => {
  const refToday = today || todayIso();
  const M = {
    need: 0,
    ok: 0,
    pend: 0,
    venc: 0,
    noPrazo: 0,
    fora: 0,
    tempo: [] as number[],
    oldest: '',
    plats: new Set<string>(),
    mats: new Set<string>()
  };

  daysBelowTarget.forEach(x => {
    M.need++;
    M.plats.add(x.p);
    if (x.j) {
      M.ok++;
      const em = (x.j.criado_em || '').slice(0, 10);
      if (em) {
        M.tempo.push(Math.max(0, diffDays(x.D, em)));
        if (em > prazoOf(x.D, config)) {
          M.fora++;
        }
      }
    } else {
      M.pend++;
      M.mats.add(x.mat);
      if (refToday > prazoOf(x.D, config)) {
        M.venc++;
      } else {
        M.noPrazo++;
      }
      if (!M.oldest || x.D < M.oldest) {
        M.oldest = x.D;
      }
    }
  });

  const pJ = M.need ? (M.ok / M.need) * 100 : null;
  const tMed = M.tempo.length
    ? M.tempo.reduce((a, b) => a + b, 0) / M.tempo.length
    : null;
  const atraso =
    M.oldest && refToday > prazoOf(M.oldest, config)
      ? diffDays(prazoOf(M.oldest, config), refToday)
      : 0;

  const st: StatusMeta = M.venc ? 'bad' : M.pend ? 'warn' : M.need ? 'ok' : 'sem';
  const stTxt = M.venc
    ? 'Cobrar'
    : M.pend
    ? 'No prazo'
    : M.need
    ? 'Em dia'
    : 'Sem pendências';

  return {
    ...M,
    pJ,
    tMed,
    atraso,
    st,
    stTxt
  };
};

export const resolveTechSituation = (
  mat: string,
  platSigla: string,
  dataset: AppDataset,
  pidx: Record<string, Plataforma>,
  today?: string
): {
  t: string;
  s: string;
  c: StatusMeta;
  ini?: string;
  fim?: string;
} => {
  const refToday = today || todayIso();
  const cs = dataset.carteira
    .filter(
      c =>
        c.matricula === mat &&
        resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio).p === platSigla
    )
    .sort((a, b) => (a.data_inicio < b.data_inicio ? 1 : -1));

  const cur = cs.find(c => c.data_inicio <= refToday && refToday <= c.data_fim);
  if (cur) {
    return {
      t: 'Embarcado agora',
      s: `dia ${diffDays(cur.data_inicio, refToday) + 1} de ${
        diffDays(cur.data_inicio, cur.data_fim) + 1
      } · desembarca ${formatBrShort(cur.data_fim)}`,
      c: 'info',
      ini: cur.data_inicio,
      fim: cur.data_fim
    };
  }

  const fut = cs.filter(c => c.data_inicio > refToday).pop();
  const past = cs.find(c => c.data_fim < refToday);

  if (past) {
    return {
      t: 'Desembarcou',
      s: `em ${formatBr(past.data_fim)}${
        fut ? ' · volta ' + formatBrShort(fut.data_inicio) : ''
      }`,
      c: 'sem',
      ini: past.data_inicio,
      fim: past.data_fim
    };
  }

  if (fut) {
    return {
      t: 'Embarca',
      s: `em ${formatBr(fut.data_inicio)}`,
      c: 'sem',
      ini: fut.data_inicio,
      fim: fut.data_fim
    };
  }

  let last = '';
  for (let i = 0; i < 3; i++) {
    const x = addDays(refToday, -i - 1);
    if (dataset.hhMap[`${mat}|${x}`]) {
      last = x;
      break;
    }
  }

  return last
    ? { t: 'Embarcado agora', s: 'sem carteira', c: 'info' }
    : { t: 'Fora de embarque', s: 'sem carteira', c: 'sem' };
};

export const listAvailableUnits = (
  dataset: AppDataset,
  pidx: Record<string, Plataforma>
): string[] => {
  const s = new Set<string>(dataset.config.regionais_extras || []);
  Object.values(dataset.plataformas).forEach(p => {
    if (p.un) s.add(p.un);
  });
  Object.values(dataset.hhMap).forEach(r => {
    if (r.plataforma_sigla) {
      s.add(resolvePlace(pidx, r.plataforma_sigla, r.unidade_negocio).r);
    }
  });
  dataset.carteira.forEach(c => {
    s.add(resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio).r);
  });
  s.delete('Sem unidade');
  return [...s].sort();
};

export const listAvailablePlatforms = (
  dataset: AppDataset,
  pidx: Record<string, Plataforma>,
  fReg?: string
): string[] => {
  const s = new Set<string>();
  Object.values(dataset.hhMap).forEach(r => {
    if (r.plataforma_sigla) {
      const l = resolvePlace(pidx, r.plataforma_sigla, r.unidade_negocio);
      if (!fReg || l.r === fReg) {
        s.add(l.p);
      }
    }
  });
  dataset.carteira.forEach(c => {
    const l = resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio);
    if (!fReg || l.r === fReg) {
      s.add(l.p);
    }
  });
  return [...s].sort();
};
