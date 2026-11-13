import type {
  AggregatedMetrics,
  AppDataset,
  CarteiraEmbarque,
  CarteiraOperacao,
  CobrancaStats,
  ConfirmacaoSAP,
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
  StatusMeta,
  Tecnico,
  UsoffUnWeight
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
  normalizeSapCode,
  parseIdEmbarque,
  platformKey,
  sanitizePlatformCode
} from '../utils/format';
import { eachDay } from './periods';

export const buildPlatformIndex = (
  plataformas: Record<string, Plataforma>
): Record<string, Plataforma> => {
  const idx: Record<string, Plataforma> = {};
  Object.values(plataformas).forEach(p => {
    [p.sigla, p.nome, sanitizePlatformCode(p.sigla)].forEach(x => {
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
  const sanitized = sanitizePlatformCode(rawName);
  const kSanitized = platformKey(sanitized);
  if (pidx[kSanitized]) return pidx[kSanitized];

  const kRaw = platformKey(rawName);
  if (pidx[kRaw]) return pidx[kRaw];

  const rawUpper = String(rawName).trim().toUpperCase();
  if (/^P[A-Z]{3,}/.test(rawUpper)) {
    const withoutP = platformKey(rawUpper.slice(1));
    if (pidx[withoutP]) return pidx[withoutP];
    const sanitizedWithoutP = platformKey(sanitizePlatformCode(rawUpper.slice(1)));
    if (pidx[sanitizedWithoutP]) return pidx[sanitizedWithoutP];
  }

  return null;
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

/**
 * Conjunto estrito de UMS que são medidas por HH de Armador (possuem carteira programada de HH).
 * Conforme definição de negócio: apenas UMAR, UMCP e UMPA.
 * As demais UMS (ex.: UMAC, UMGR, UMLI, UMPC, UMPT, UMTJ, UMVT, UMVV) operam por diária
 * visto que não possuem carteira programada, sendo desconsideradas de apontamento negativo
 * ("Não chegou" / sem: true) quando tanto programação quanto execução forem nulas ou em branco.
 */
export const UMS_HH_ARMADOR_SIGLAS = new Set([
  'UMAR', 'UMCP', 'UMPA'
]);

// Alias de retrocompatibilidade
export const UMS_PROGRAMADAS_SIGLAS = UMS_HH_ARMADOR_SIGLAS;

/**
 * Verifica se uma plataforma é classificada como Armador / Embarcação Afretada por Diária.
 */
export const isArmadorPlatform = (
  plat?: Plataforma | null,
  rawPlatSigla?: string,
  rawUn?: string,
  usoffUnWeights?: Record<string, UsoffUnWeight>
): boolean => {
  const sigla = (plat?.sigla || rawPlatSigla || '').trim().toUpperCase();
  const un = (plat?.un || rawUn || '').trim();
  const armador = (plat?.armador || '').trim();
  const tipo = (plat?.tipo || '').toLowerCase();
  const tipoMedicao = (plat?.tipo_medicao || '').toLowerCase();

  // 1. Sinalização explícita na plataforma (coluna tipo_medicao ou tag Diária no tipo)
  if (tipoMedicao === 'diaria' || tipo.includes('diaria') || tipo.includes('diária')) {
    return true;
  }

  // Se a plataforma foi expressamente cadastrada como 'hh', respeita
  if (tipoMedicao === 'hh') {
    return false;
  }

  // UMS medidas por HH (UMAR, UMCP, UMPA) NÃO são tratadas como armador de diária isento
  if (UMS_HH_ARMADOR_SIGLAS.has(sigla)) {
    return false;
  }

  // 2. Sinalização explícita na Unidade de Negócio (UN configurada como diária ou nome)
  if (un === 'Armador' || un === 'FPSOs afretados' || /di[áa]ria/i.test(un)) {
    return true;
  }
  if (usoffUnWeights && usoffUnWeights[un]?.tipo_medicao === 'diaria') {
    return true;
  }

  // Demais UMS operam por diária do armador (sem carteira programada)
  if (sigla.startsWith('UM') || tipo.includes('ums')) {
    return true;
  }

  if (
    armador !== '' &&
    armador !== 'Não informado' &&
    armador.toLowerCase() !== 'petrobras' &&
    armador.toLowerCase() !== 'propria' &&
    armador.toLowerCase() !== 'própria'
  ) return true;
  if (tipo.includes('afretad') || tipo.includes('ahts')) return true;

  return false;
};

/**
 * Regra de Negócio: Embarcações de Armador medidas por diária.
 * Sempre que for armador e tanto a programação quanto a execução forem null, zero ou em branco,
 * o dia NÃO deve entrar na métrica de apontamento negativo / "Não chegou" (sem: true),
 * evitando saldo negativo falso de -11h e status bad.
 */
export const isArmadorDiariaSemProg = (
  c: CarteiraEmbarque,
  plataformas?: Record<string, Plataforma>,
  usoffUnWeights?: Record<string, UsoffUnWeight>
): boolean => {
  const hp = c.horas_programadas != null ? Number(c.horas_programadas) : null;
  if (hp != null && !isNaN(hp) && hp > 0) {
    return false;
  }
  const pFound = plataformas ? lookupPlatform(buildPlatformIndex(plataformas), c.plataforma_sigla) : null;
  return isArmadorPlatform(pFound, c.plataforma_sigla, c.unidade_negocio, usoffUnWeights);
};

export const calcCarteiraHP = (
  c: CarteiraEmbarque,
  config: ContractConfig,
  plataformas?: Record<string, Plataforma>
): number => {
  if (plataformas && isArmadorDiariaSemProg(c, plataformas)) {
    return 0;
  }
  const n = diffDays(c.data_inicio, c.data_fim) + 1;
  const H = Number(config.hh_dia) || 11;
  return c.horas_programadas != null && !isNaN(Number(c.horas_programadas))
    ? Number(c.horas_programadas)
    : n * H;
};

export const hpSourceLabel = (
  c: CarteiraEmbarque,
  config: ContractConfig,
  plataformas?: Record<string, Plataforma>
): string => {
  if (plataformas && isArmadorDiariaSemProg(c, plataformas)) {
    return 'Diária (Armador)';
  }
  return c.horas_programadas != null && !isNaN(Number(c.horas_programadas))
    ? 'Portal Offshore'
    : `dias × ${formatHours(config.hh_dia)}`;
};

export const calcHpInInterval = (
  c: CarteiraEmbarque,
  a: string,
  b: string,
  config: ContractConfig,
  plataformas?: Record<string, Plataforma>
): number => {
  if (a > b) return 0;
  const n = diffDays(c.data_inicio, c.data_fim) + 1;
  return (calcCarteiraHP(c, config, plataformas) * (diffDays(a, b) + 1)) / n;
};

/**
 * Retorna as horas programadas estritamente em 'Carteira' (com antecedência >= 12 dias do início do embarque).
 * Conforme regra contratual:
 * - Atividades com >= 12 dias são 'Carteira' e pontuam na parcela PE (PE * HP_carteira) e EX (EX * HC).
 * - Atividades com < 12 dias ou inseridas no embarque são 'Fora da carteira' e NÃO pontuam na parcela PE,
 *   pontuando apenas na execução (EX * HC).
 * - Se c.hh_carteira não estiver informado (null/undefined - ex.: base legada ou sem detalhamento de 12 dias),
 *   recai de forma retrocompatível para calcCarteiraHP(c, config, plataformas).
 */
export const calcCarteiraHPCarteira = (
  c: CarteiraEmbarque,
  config: ContractConfig,
  plataformas?: Record<string, Plataforma>
): number => {
  if (plataformas && isArmadorDiariaSemProg(c, plataformas)) {
    return 0;
  }
  if (c.hh_carteira != null && !isNaN(Number(c.hh_carteira))) {
    return Number(c.hh_carteira);
  }
  return calcCarteiraHP(c, config, plataformas);
};

export const calcHpCarteiraInInterval = (
  c: CarteiraEmbarque,
  a: string,
  b: string,
  config: ContractConfig,
  plataformas?: Record<string, Plataforma>
): number => {
  if (a > b) return 0;
  const n = diffDays(c.data_inicio, c.data_fim) + 1;
  return (calcCarteiraHPCarteira(c, config, plataformas) * (diffDays(a, b) + 1)) / n;
};

export const calcCarteiraHPForaCarteira = (
  c: CarteiraEmbarque
): number => {
  if (c.hh_fora_carteira != null && !isNaN(Number(c.hh_fora_carteira))) {
    return Number(c.hh_fora_carteira);
  }
  return 0;
};

export const calcHpForaCarteiraInInterval = (
  c: CarteiraEmbarque,
  a: string,
  b: string
): number => {
  if (a > b) return 0;
  const n = diffDays(c.data_inicio, c.data_fim) + 1;
  return (calcCarteiraHPForaCarteira(c) * (diffDays(a, b) + 1)) / n;
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
  const cart = findCarteira(dataset.carteira, mat, dateIso);
  if (
    lastDate &&
    dateIso <= lastDate &&
    cart
  ) {
    if (dataset.externalCoveredSet && dataset.externalCoveredSet.has(key)) {
      return null;
    }

    // Regra Armador por Diária: se for embarcação de armador sem programação e sem execução,
    // não entra na métrica de apontamento (evita saldo negativo de 11h e status bad falso)
    if (isArmadorDiariaSemProg(cart, dataset.plataformas)) {
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
      id_embarque: c.id_embarque,
      ini: c.data_inicio,
      fim: c.data_fim,
      dia,
      n,
      plat: c.plataforma_sigla,
      reg: c.unidade_negocio,
      fonte: 'carteira',
      hp: calcCarteiraHP(c, dataset.config, dataset.plataformas),
      hpF: hpSourceLabel(c, dataset.config, dataset.plataformas)
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
        t += calcHpInInterval(c, a, b, dataset.config, dataset.plataformas);
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
        pg = es.reduce((t, c) => t + calcCarteiraHP(c, dataset.config, dataset.plataformas), 0);
        pa = es.reduce(
          (t, c) =>
            t +
            calcHpInInterval(
              c,
              c.data_inicio,
              c.data_fim < ate ? c.data_fim : ate,
              dataset.config,
              dataset.plataformas
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

export interface SapIndex {
  byTechDate: Map<string, ConfirmacaoSAP[]>;
  byEmbarkation: Map<string, ConfirmacaoSAP[]>;
  byTech: Map<string, ConfirmacaoSAP[]>;
}

export const buildSapIndex = (confirmacoes?: ConfirmacaoSAP[]): SapIndex => {
  const byTechDate = new Map<string, ConfirmacaoSAP[]>();
  const byEmbarkation = new Map<string, ConfirmacaoSAP[]>();
  const byTech = new Map<string, ConfirmacaoSAP[]>();

  (confirmacoes || []).forEach(cs => {
    if (!cs.matricula) return;

    // Indexar por matrícula
    const techList = byTech.get(cs.matricula) || [];
    techList.push(cs);
    byTech.set(cs.matricula, techList);

    // Indexar por matrícula + data_fim_real
    if (cs.data_fim_real) {
      const tdKey = `${cs.matricula}|${cs.data_fim_real}`;
      const tdList = byTechDate.get(tdKey) || [];
      tdList.push(cs);
      byTechDate.set(tdKey, tdList);
    }

    // Indexar por id_embarque
    if (cs.id_embarque) {
      const embList = byEmbarkation.get(cs.id_embarque) || [];
      embList.push(cs);
      byEmbarkation.set(cs.id_embarque, embList);
    }
  });

  return { byTechDate, byEmbarkation, byTech };
};

export interface ResolveDivergenciaSapOptions {
  statusProgramacao?: string;
  statusDivergencia?: string;
  detailed?: boolean;
}

/**
 * Classifica o status de confronto Portal Offshore vs SAP a partir das horas confirmadas.
 * Centraliza tolerância (0.01 h), arredondamento e tratamento de estornos líquidos negativos.
 */
export function resolveDivergenciaSapStatus(
  hhPortal: number,
  hhSap: number,
  options: ResolveDivergenciaSapOptions = {}
): string {
  const { statusProgramacao, statusDivergencia, detailed = false } = options;
  if (statusProgramacao === 'Cancelada') return 'Cancelada';
  if (statusProgramacao === 'Não Cadastrado no Portal') return 'Não Cadastrado no Portal';
  if (detailed && statusDivergencia && statusDivergencia !== 'Pendente') {
    return statusDivergencia;
  }

  const pRaw = Math.round((Number(hhPortal) || 0) * 100) / 100;
  const sRaw = Math.round((Number(hhSap) || 0) * 100) / 100;
  const p = Object.is(pRaw, -0) ? 0 : pRaw;
  const s = Object.is(sRaw, -0) ? 0 : sRaw;

  if (Math.abs(p) < 0.01 && Math.abs(s) < 0.01) return 'Não Confirmado';
  if (p > 0 && Math.abs(s) < 0.01) return 'Não Apontado no SAP';
  if (Math.abs(p) < 0.01 && s > 0) return 'Não Confirmado no Portal';
  if (Math.abs(p) < 0.01 && s < 0) return 'Divergente (Portal > SAP)';
  if (Math.abs(p - s) < 0.01) return 'OK';
  return p > s ? 'Divergente (Portal > SAP)' : 'Divergente (SAP > Portal)';
}

function addDaysYmd(ymd: string, days: number): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const d = new Date(`${ymd}T00:00:00Z`);
  if (isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getSapRefDate(cs: ConfirmacaoSAP): string {
  return cs.data_fim_real || cs.data_lancamento || cs.data_criacao || '';
}

function pickBestEmbarqueWindowMatch<T extends { data_inicio?: string; data_fim?: string }>(
  items: T[],
  refDate: string
): T | undefined {
  if (items.length === 0) return undefined;
  if (items.length === 1 || !refDate) return items[0];

  const exactWindow = items.filter(
    it => it.data_inicio && it.data_fim && refDate >= it.data_inicio && refDate <= it.data_fim
  );
  if (exactWindow.length === 1) return exactWindow[0];
  if (exactWindow.length > 1) {
    return [...exactWindow].sort((a, b) => (b.data_inicio || '').localeCompare(a.data_inicio || ''))[0];
  }

  const graceWindow = items.filter(
    it =>
      it.data_inicio &&
      it.data_fim &&
      refDate >= it.data_inicio &&
      refDate <= addDaysYmd(it.data_fim, 4)
  );
  if (graceWindow.length === 1) return graceWindow[0];
  if (graceWindow.length > 1) {
    return [...graceWindow].sort((a, b) => (b.data_inicio || '').localeCompare(a.data_inicio || ''))[0];
  }

  const startedBefore = items.filter(it => it.data_inicio && it.data_inicio <= refDate);
  if (startedBefore.length > 0) {
    return [...startedBefore].sort((a, b) => (b.data_inicio || '').localeCompare(a.data_inicio || ''))[0];
  }

  return [...items].sort((a, b) => (a.data_inicio || '').localeCompare(b.data_inicio || ''))[0];
}

export const mergeConfrontoOperations = (
  carteiraOps: CarteiraOperacao[],
  sapConfirmacoes: ConfirmacaoSAP[] = [],
  carteiraEmbarques: CarteiraEmbarque[] = [],
  tecnicos: Record<string, Tecnico> = {}
): CarteiraOperacao[] => {
  const normEmb = (v: unknown): string => parseIdEmbarque(v) || String(v ?? '').trim();
  const buildKey3 = (mat: unknown, ordem: unknown, op: unknown): string =>
    `${normalizeSapCode(mat)}|${normalizeSapCode(ordem)}|${normalizeSapCode(op)}`;

  const portalExactMap = new Map<string, number[]>();
  const portalByKey3 = new Map<string, number[]>();

  carteiraOps.forEach((op, idx) => {
    const idEmb = normEmb(op.id_embarque || op.portal_id || '');
    const k3 = buildKey3(op.matricula, op.ordem, op.operacao);
    const exactKey = `${k3}|${idEmb}`;

    const exactArr = portalExactMap.get(exactKey) || [];
    exactArr.push(idx);
    portalExactMap.set(exactKey, exactArr);

    const k3Arr = portalByKey3.get(k3) || [];
    k3Arr.push(idx);
    portalByKey3.set(k3, k3Arr);
  });

  const embById = new Map<string, CarteiraEmbarque>();
  const embByMat = new Map<string, CarteiraEmbarque[]>();
  carteiraEmbarques.forEach(ce => {
    const eid = normEmb(ce.id_embarque);
    if (eid) embById.set(eid, ce);
    const mKey = normalizeSapCode(ce.matricula);
    if (mKey) {
      const list = embByMat.get(mKey) || [];
      list.push(ce);
      embByMat.set(mKey, list);
    }
  });

  // Se houver confirmações SAP carregadas, recalculamos o total líquido (+ e estornos -)
  // diretamente a partir de sapConfirmacoes para evitar cache desatualizado no banco/fixture.
  const hasSapSource = sapConfirmacoes.length > 0;
  const portalSapSums = new Array<number>(carteiraOps.length).fill(0);
  const unmatchedCs: ConfirmacaoSAP[] = [];

  const matchPortalOpIndex = (cs: ConfirmacaoSAP): number | null => {
    const k3 = buildKey3(cs.matricula, cs.ordem, cs.operacao);
    const csEmb = normEmb(cs.id_embarque);

    if (csEmb) {
      const exactMatches = portalExactMap.get(`${k3}|${csEmb}`);
      if (exactMatches && exactMatches.length > 0) {
        return exactMatches[0];
      }
      // Nunca sequestrar confirmação explicitamente vinculada a outro id_embarque.
      return null;
    }

    const candidates = portalByKey3.get(k3);
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const csDate = getSapRefDate(cs);
    const candidateObjs = candidates.map(i => ({ idx: i, ...carteiraOps[i] }));
    const picked = pickBestEmbarqueWindowMatch(candidateObjs, csDate);
    return picked ? picked.idx : candidates[0];
  };

  sapConfirmacoes.forEach(cs => {
    const matchedIdx = matchPortalOpIndex(cs);
    const hcVal = Number(cs.horas_confirmadas) || 0;
    if (matchedIdx !== null) {
      portalSapSums[matchedIdx] += hcVal;
    } else {
      unmatchedCs.push(cs);
    }
  });

  interface ExtraSapGroup {
    matricula: string;
    ordem: string;
    operacao: string;
    id_embarque: string;
    totalHcSap: number;
    dataMin: string;
    dataMax: string;
    data_inicio?: string;
    data_fim?: string;
  }

  const extraSapMap = new Map<string, ExtraSapGroup>();
  const extraByKey3 = new Map<string, ExtraSapGroup[]>();

  const accumulateExtra = (group: ExtraSapGroup, cs: ConfirmacaoSAP) => {
    group.totalHcSap += Number(cs.horas_confirmadas) || 0;
    const refDate = getSapRefDate(cs);
    if (refDate) {
      if (!group.dataMin || refDate < group.dataMin) group.dataMin = refDate;
      if (!group.dataMax || refDate > group.dataMax) group.dataMax = refDate;
    }
  };

  const getOrCreateExtra = (cs: ConfirmacaoSAP, embId: string): ExtraSapGroup => {
    const k3 = buildKey3(cs.matricula, cs.ordem, cs.operacao);
    const key = `${k3}|${embId}`;
    let entry = extraSapMap.get(key);
    if (!entry) {
      const embMeta = embId ? embById.get(embId) : undefined;
      entry = {
        matricula: cs.matricula,
        ordem: cs.ordem,
        operacao: cs.operacao,
        id_embarque: embId,
        totalHcSap: 0,
        dataMin: getSapRefDate(cs),
        dataMax: getSapRefDate(cs),
        data_inicio: embMeta?.data_inicio,
        data_fim: embMeta?.data_fim
      };
      extraSapMap.set(key, entry);
      const list = extraByKey3.get(k3) || [];
      list.push(entry);
      extraByKey3.set(k3, list);
    }
    return entry;
  };

  // Passo A: confirmações extra com id_embarque explícito
  const unlinkedExtras: ConfirmacaoSAP[] = [];
  unmatchedCs.forEach(cs => {
    const idEmb = normEmb(cs.id_embarque);
    if (idEmb) {
      const entry = getOrCreateExtra(cs, idEmb);
      accumulateExtra(entry, cs);
    } else {
      unlinkedExtras.push(cs);
    }
  });

  // Passo B: confirmações extra sem id_embarque (ex.: estornos tardios de ordens fora da carteira)
  // acoplam-se à irmã com id_embarque para que +9 e -9 somem 0 na mesma linha.
  unlinkedExtras.forEach(cs => {
    const k3 = buildKey3(cs.matricula, cs.ordem, cs.operacao);
    const siblings = extraByKey3.get(k3);
    if (siblings && siblings.length > 0) {
      const target = pickBestEmbarqueWindowMatch(siblings, getSapRefDate(cs)) || siblings[0];
      accumulateExtra(target, cs);
    } else {
      const entry = getOrCreateExtra(cs, '');
      accumulateExtra(entry, cs);
    }
  });

  const normalizedCarteiraOps = hasSapSource
    ? carteiraOps.map((op, idx) => {
        const totalSapRaw = Math.round(portalSapSums[idx] * 100) / 100;
        const totalSap = Object.is(totalSapRaw, -0) ? 0 : totalSapRaw;
        const hhConf = Number(op.hh_confirmado) || 0;
        const divRaw = Math.round((hhConf - totalSap) * 100) / 100;
        const divergencia = Object.is(divRaw, -0) ? 0 : divRaw;
        return {
          ...op,
          hh_confirmado_sap: totalSap,
          divergencia_sap: divergencia,
          status_divergencia: resolveDivergenciaSapStatus(hhConf, totalSap, {
            statusProgramacao: op.status_programacao
          })
        };
      })
    : carteiraOps;

  const extraOps: CarteiraOperacao[] = Array.from(extraSapMap.values()).map(item => {
    const matEmbs = embByMat.get(normalizeSapCode(item.matricula)) || [];
    const emb =
      (item.id_embarque ? embById.get(item.id_embarque) : undefined) ||
      pickBestEmbarqueWindowMatch(matEmbs, item.dataMin || item.dataMax) ||
      carteiraEmbarques.find(ce => normalizeSapCode(ce.matricula) === normalizeSapCode(item.matricula));
    const tec = tecnicos[item.matricula];
    const totalSapRaw = Math.round(item.totalHcSap * 100) / 100;
    const totalSap = Object.is(totalSapRaw, -0) ? 0 : totalSapRaw;

    return {
      id: `sap-extra-${item.matricula}-${item.ordem}-${item.operacao}-${item.id_embarque}`,
      portal_id: item.id_embarque,
      id_embarque: item.id_embarque,
      matricula: item.matricula,
      chave_petrobras: '',
      nome: tec?.nome || emb?.nome || item.matricula,
      empresa: 'Infotec Brasil',
      estrutura: '',
      unidade_negocio: emb?.unidade_negocio || 'UN-DESCONHECIDA',
      plataforma_sigla: emb?.plataforma_sigla || '',
      data_inicio: emb?.data_inicio || item.dataMin,
      data_fim: emb?.data_fim || item.dataMax,
      ordem: item.ordem,
      operacao: item.operacao,
      status_processamento: 'Concluído',
      prioridade: 'Regular',
      status_programacao: 'Não Cadastrado no Portal',
      hh_programado: 0,
      hh_confirmado: 0,
      hh_confirmado_sap: totalSap,
      divergencia_sap: Object.is(-totalSap, -0) ? 0 : -totalSap,
      status_divergencia: 'Não Cadastrado no Portal',
      recursos: 1,
      fonte: 'sap_fora_carteira'
    };
  });

  return [...normalizedCarteiraOps, ...extraOps];
};
