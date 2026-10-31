import { describe, expect, it } from 'vitest';
import type {
  AppDataset,
  CarteiraEmbarque,
  ContractConfig,
  FilterState,
  PeriodDayEntry,
  PeriodWindow,
  Plataforma,
  UsoffUnWeight
} from '../types';
import { DEFAULT_CONFIG } from '../../config/constants';
import {
  addDays,
  diffDays,
  formatBr,
  formatBrShort,
  lastDayOfMonth,
  mesNome,
  mesOf,
  nextMonth,
  parseExcelOrStringDate,
  prevMonth
} from '../../utils/date';
import {
  calcPct,
  formatHours,
  formatPct,
  formatSignedHours,
  formatUs,
  normalizeText,
  parseFlexibleHours,
  platformKey,
  plural
} from '../../utils/format';
import {
  eachDay,
  listMeasurementOptions,
  neededQueryWindow,
  perContaining,
  periodDisplayName,
  periodFileSlug,
  periodOf,
  resolveActivePeriod
} from '../periods';
import {
  accumulateEmbarkation,
  aggregateDays,
  armadorOf,
  buildPlatformIndex,
  calcCarteiraHP,
  calcHpInInterval,
  computeCobrancaStats,
  computeDataAte,
  computeDayRows,
  computeMeasurementDays,
  computePeriodDays,
  computePeriodTechs,
  findCarteira,
  findResponsiblePeople,
  formatPlatformLabel,
  gestorOfUn,
  getClosedEmbarkations,
  getRollingEmbarkations,
  groupDaysByField,
  hpSourceLabel,
  inferEmbarkation,
  isPersonResponsible,
  listAvailablePlatforms,
  listAvailableUnits,
  lookupPlatform,
  passesFilter,
  prazoOf,
  resolveLocation,
  resolvePlace,
  resolveRecord,
  resolveTechName,
  resolveTechSituation,
  statusOf
} from '../calculations';
import {
  computeUsoffOperations,
  resolveUsoffWeights,
  summarizeUsoff
} from '../usoff';
import {
  buildCobrancaDetailsText,
  buildCobrancaListText,
  buildCobrancaMailPayload,
  buildDailyAlertText,
  buildDailyMailPayload,
  buildMailLinks
} from '../communications';
import { buildDemoOverlay } from '../demo';

const createBaseDataset = (overrides?: Partial<AppDataset>): AppDataset => ({
  config: { ...DEFAULT_CONFIG },
  usoffUnWeights: {},
  emailsResumo: [],
  plataformas: {
    P58: {
      sigla: 'P58',
      chave_norm: 'p58',
      nome: 'P-58',
      un: 'Espírito Santo (UN-ES)',
      armador: 'Petrobras',
      gerencia: '',
      tipo: 'UEP',
      situacao: 'Mobilizada',
      cadastro_pendente: false
    },
    P74: {
      sigla: 'P74',
      chave_norm: 'p74',
      nome: 'P-74',
      un: 'Búzios (UN-BUZ)',
      armador: 'Petrobras',
      gerencia: '',
      tipo: 'UEP',
      situacao: 'Mobilizada',
      cadastro_pendente: false
    }
  },
  pessoas: {
    prep1: {
      id: 'prep1',
      slug: 'preposto-1',
      nome: 'Preposto Santos',
      papel: 'preposto',
      email: 'preposto@infotec.com.br',
      user_id: null,
      plats: ['P58'],
      uns: []
    }
  },
  profiles: {},
  tecnicos: {
    '1001': { matricula: '1001', nome: 'Carlos Silva', funcao: 'Técnico de Automação' }
  },
  carteira: [],
  hhMap: {},
  justMap: {},
  externalCoveredSet: new Set<string>(),
  sharedOpsSet: new Set<string>(),
  watermark: {
    ultima_data_hh: '2026-10-15',
    ultima_importacao_em: '2026-10-15T08:00:00'
  },
  latestFluxo: null,
  isDemo: false,
  demoReason: '',
  ...overrides
});

describe('1. Cortes de medição (1, 16, 21, 26 + virada de ano)', () => {
  it('diaCorte = 1 gera mês cheio de 01 até o último dia do mês', () => {
    const pOut = periodOf('2026-10', 1);
    expect(pOut).toEqual({ ini: '2026-10-01', fim: '2026-10-31', m: '2026-10' });

    const pFev = periodOf('2026-02', 1);
    expect(pFev).toEqual({ ini: '2026-02-01', fim: '2026-02-28', m: '2026-02' });

    const pBissesto = periodOf('2024-02', 1);
    expect(pBissesto).toEqual({ ini: '2024-02-01', fim: '2024-02-29', m: '2024-02' });

    expect(perContaining('2026-10-15', 1)).toBe('2026-10');
    expect(perContaining('2026-10-31', 1)).toBe('2026-10');
  });

  it('diaCorte = 21 gera do dia 21 do mês anterior até o dia 20 do mês corrente', () => {
    const p = periodOf('2026-10', 21);
    expect(p).toEqual({ ini: '2026-09-21', fim: '2026-10-20', m: '2026-10' });

    expect(perContaining('2026-10-20', 21)).toBe('2026-10');
    expect(perContaining('2026-10-21', 21)).toBe('2026-11');
    expect(perContaining('2026-09-21', 21)).toBe('2026-10');
  });

  it('diaCorte = 16 gera do dia 16 do mês anterior até o dia 15 do mês corrente', () => {
    const p = periodOf('2026-05', 16);
    expect(p).toEqual({ ini: '2026-04-16', fim: '2026-05-15', m: '2026-05' });

    expect(perContaining('2026-05-15', 16)).toBe('2026-05');
    expect(perContaining('2026-05-16', 16)).toBe('2026-06');
  });

  it('diaCorte = 26 gera do dia 26 do mês anterior até o dia 25 do mês corrente', () => {
    const p = periodOf('2026-08', 26);
    expect(p).toEqual({ ini: '2026-07-26', fim: '2026-08-25', m: '2026-08' });

    expect(perContaining('2026-08-25', 26)).toBe('2026-08');
    expect(perContaining('2026-08-26', 26)).toBe('2026-09');
  });

  it('trata virada de ano com precisão (dezembro -> janeiro)', () => {
    const pJan = periodOf('2027-01', 21);
    expect(pJan).toEqual({ ini: '2026-12-21', fim: '2027-01-20', m: '2027-01' });

    expect(prevMonth('2027-01')).toBe('2026-12');
    expect(nextMonth('2026-12')).toBe('2027-01');

    expect(perContaining('2026-12-20', 21)).toBe('2026-12');
    expect(perContaining('2026-12-21', 21)).toBe('2027-01');

    const options = listMeasurementOptions('2026-12-22', 21, 3);
    expect(options[0].value).toBe('2027-02');
    expect(options[1].value).toBe('2027-01');
    expect(options[2].value).toBe('2026-12');
  });

  it('resolveActivePeriod trata períodos customizados ou padrão', () => {
    const filterCustom: FilterState = {
      fDate: '2026-10-10',
      fReg: '',
      fPlat: '',
      fResp: '',
      fPer: 'custom',
      cIni: '2026-10-05',
      cFim: '2026-10-18'
    };
    const resolved = resolveActivePeriod(filterCustom, 21);
    expect(resolved).toEqual({
      ini: '2026-10-05',
      fim: '2026-10-18',
      m: '2026-10',
      custom: true
    });
    expect(periodDisplayName(resolved)).toBe('Período livre');
    expect(periodFileSlug(resolved)).toBe('2026-10-05 a 2026-10-18');
  });
});

describe("2. Critério de medição: med_criterio = 'enc' vs 'dias'", () => {
  const P: PeriodWindow = {
    ini: '2026-09-21',
    fim: '2026-10-20',
    m: '2026-10'
  };

  const c1: CarteiraEmbarque = {
    id: 'emb-c1',
    matricula: '1001',
    nome: 'Carlos Silva',
    plataforma_sigla: 'P58',
    unidade_negocio: 'Espírito Santo (UN-ES)',
    data_inicio: '2026-09-10',
    data_fim: '2026-09-23', // Encerra dentro do período P
    horas_programadas: 154,
    operacao: 'OP-01',
    pe: 0.1,
    ex: 0.9,
    fonte: 'carteira'
  };

  const c2: CarteiraEmbarque = {
    id: 'emb-c2',
    matricula: '1002',
    nome: 'Marcos Souza',
    plataforma_sigla: 'P58',
    unidade_negocio: 'Espírito Santo (UN-ES)',
    data_inicio: '2026-10-15',
    data_fim: '2026-10-28', // Desembarque cai depois de P.fim (rolling)
    horas_programadas: 154,
    operacao: 'OP-02',
    pe: 0.1,
    ex: 0.9,
    fonte: 'carteira'
  };

  const pidx = buildPlatformIndex({
    P58: {
      sigla: 'P58',
      chave_norm: 'p58',
      nome: 'P-58',
      un: 'Espírito Santo (UN-ES)',
      armador: 'Petrobras',
      gerencia: '',
      tipo: 'UEP',
      situacao: 'Mobilizada',
      cadastro_pendente: false
    }
  });

  const emptyFilters: FilterState = {
    fDate: '',
    fReg: '',
    fPlat: '',
    fResp: '',
    fPer: '',
    cIni: '',
    cFim: ''
  };

  it("com med_criterio = 'enc', inclui embarque encerrado inteiro (inclusive dias anteriores a P.ini)", () => {
    const dataset = createBaseDataset({
      config: { ...DEFAULT_CONFIG, med_criterio: 'enc' },
      carteira: [c1, c2],
      watermark: { ultima_data_hh: '2026-10-25', ultima_importacao_em: null }
    });

    // Populate HH records for both technicians
    eachDay(c1.data_inicio, c1.data_fim, d => {
      dataset.hhMap[`${c1.matricula}|${d}`] = {
        matricula: c1.matricula,
        data: d,
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        horas_executadas: 11
      };
    });
    eachDay(c2.data_inicio, c2.data_fim, d => {
      dataset.hhMap[`${c2.matricula}|${d}`] = {
        matricula: c2.matricula,
        data: d,
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        horas_executadas: 11
      };
    });

    const closed = getClosedEmbarkations(P, dataset, emptyFilters, pidx);
    expect(closed).toHaveLength(1);
    expect(closed[0].matricula).toBe('1001');

    const rolling = getRollingEmbarkations(P, dataset, emptyFilters, pidx);
    expect(rolling).toHaveLength(1);
    expect(rolling[0].matricula).toBe('1002');

    const medDays = computeMeasurementDays(P, dataset, emptyFilters, pidx);
    // Deve trazer todos os 14 dias de c1 (de 2026-09-10 até 2026-09-23)
    expect(medDays).toHaveLength(14);
    expect(medDays[0].D).toBe('2026-09-10');
    expect(medDays[medDays.length - 1].D).toBe('2026-09-23');
    // c2 não deve entrar em medDays
    expect(medDays.some(x => x.mat === '1002')).toBe(false);
  });

  it("com med_criterio = 'dias', traz estritamente os dias dentro da janela P.ini a P.fim", () => {
    const dataset = createBaseDataset({
      config: { ...DEFAULT_CONFIG, med_criterio: 'dias' },
      carteira: [c1, c2],
      watermark: { ultima_data_hh: '2026-10-25', ultima_importacao_em: null }
    });

    eachDay(c1.data_inicio, c1.data_fim, d => {
      dataset.hhMap[`${c1.matricula}|${d}`] = {
        matricula: c1.matricula,
        data: d,
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        horas_executadas: 11
      };
    });
    eachDay(c2.data_inicio, c2.data_fim, d => {
      dataset.hhMap[`${c2.matricula}|${d}`] = {
        matricula: c2.matricula,
        data: d,
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        horas_executadas: 11
      };
    });

    const medDays = computeMeasurementDays(P, dataset, emptyFilters, pidx);
    // c1 só tem 3 dias dentro de P: 21, 22, 23/09
    const c1Days = medDays.filter(x => x.mat === '1001');
    expect(c1Days).toHaveLength(3);

    // c2 tem 6 dias dentro de P: 15, 16, 17, 18, 19, 20/10
    const c2Days = medDays.filter(x => x.mat === '1002');
    expect(c2Days).toHaveLength(6);
  });
});

describe('3. sem: true (Não chegou) e supressão por externalCoveredSet', () => {
  it('gera sem: true para técnico com carteira ativa até watermark sem apontamento', () => {
    const c: CarteiraEmbarque = {
      id: 'emb-1',
      matricula: '1001',
      plataforma_sigla: 'P58',
      unidade_negocio: 'UN-ES',
      data_inicio: '2026-10-01',
      data_fim: '2026-10-14',
      horas_programadas: 154,
      operacao: '',
      pe: null,
      ex: null,
      fonte: 'carteira'
    };

    const dataset = createBaseDataset({
      carteira: [c],
      watermark: { ultima_data_hh: '2026-10-05', ultima_importacao_em: null },
      hhMap: {} // Nenhum apontamento informado
    });

    const recPassado = resolveRecord('1001', '2026-10-03', dataset);
    expect(recPassado).toEqual({
      d: 11,
      e: 0,
      p: '',
      r: '',
      sem: true
    });

    // Dia futuro além do watermark não gera sem: true ainda
    const recFuturo = resolveRecord('1001', '2026-10-06', dataset);
    expect(recFuturo).toBeNull();
  });

  it('RED-TEAM: suprime sem: true quando dia está coberto no externalCoveredSet', () => {
    const c: CarteiraEmbarque = {
      id: 'emb-1',
      matricula: '1001',
      plataforma_sigla: 'P58',
      unidade_negocio: 'UN-ES',
      data_inicio: '2026-10-01',
      data_fim: '2026-10-14',
      horas_programadas: 154,
      operacao: '',
      pe: null,
      ex: null,
      fonte: 'carteira'
    };

    const externalCovered = new Set<string>(['1001|2026-10-03']);

    const dataset = createBaseDataset({
      carteira: [c],
      watermark: { ultima_data_hh: '2026-10-05', ultima_importacao_em: null },
      hhMap: {},
      externalCoveredSet: externalCovered
    });

    // 2026-10-03 teve transbordo / apontamento externo: DEVE retornar null!
    const recSuppressed = resolveRecord('1001', '2026-10-03', dataset);
    expect(recSuppressed).toBeNull();

    // 2026-10-04 NÃO está no externalCoveredSet: deve continuar gerando sem: true
    const recNormal = resolveRecord('1001', '2026-10-04', dataset);
    expect(recNormal).toEqual({
      d: 11,
      e: 0,
      p: '',
      r: '',
      sem: true
    });
  });
});

describe('4. Gangway desconectada e recálculo pAj', () => {
  it('deduz horas de gangway do divisor disponível para cálculo de pAj', () => {
    const c: CarteiraEmbarque = {
      id: 'emb-1',
      matricula: '1001',
      plataforma_sigla: 'P58',
      unidade_negocio: 'UN-ES',
      data_inicio: '2026-10-01',
      data_fim: '2026-10-10',
      horas_programadas: 110,
      operacao: '',
      pe: null,
      ex: null,
      fonte: 'carteira'
    };

    const dataset = createBaseDataset({
      carteira: [c],
      watermark: { ultima_data_hh: '2026-10-10', ultima_importacao_em: null }
    });

    // 10 dias com 8 horas executadas cada (d = 110, e = 80)
    eachDay('2026-10-01', '2026-10-10', d => {
      dataset.hhMap[`1001|${d}`] = {
        matricula: '1001',
        data: d,
        plataforma_sigla: 'P58',
        unidade_negocio: 'UN-ES',
        horas_executadas: 8
      };
    });

    // Em 2 dias, 3 horas de gangway desconectada cada (total gw = 6)
    dataset.justMap['1001|2026-10-02'] = {
      matricula: '1001',
      data: '2026-10-02',
      motivo: 'Gangway desconectada',
      horas_gangway: 3,
      descricao: 'Mar agitado',
      responsavel_nome: 'Preposto'
    };
    dataset.justMap['1001|2026-10-03'] = {
      matricula: '1001',
      data: '2026-10-03',
      motivo: 'Gangway desconectada',
      horas_gangway: 3,
      descricao: 'Mar agitado',
      responsavel_nome: 'Preposto'
    };

    const emb = inferEmbarkation('1001', '2026-10-10', dataset)!;
    expect(emb).not.toBeNull();

    const acc = accumulateEmbarkation('1001', '2026-10-10', emb, dataset);
    expect(acc.d).toBe(110);
    expect(acc.e).toBe(80);
    expect(acc.gw).toBe(6);

    // p normal = 80 / 110 * 100 = 72.7272...%
    expect(acc.p).toBeCloseTo((80 / 110) * 100, 4);

    // pAj = 80 / (110 - 6) * 100 = 80 / 104 * 100 = 76.923...%
    expect(acc.pAj).toBeCloseTo((80 / 104) * 100, 4);
  });
});

describe('5. SLA computeCobrancaStats e prazos de justificativa', () => {
  it('classifica corretamente justificativas no prazo, vencidas e fora do prazo', () => {
    const config: ContractConfig = {
      ...DEFAULT_CONFIG,
      prazo_justificativa_dias: 2
    };

    const todayRef = '2026-10-10';

    // Lista de dias com horas abaixo da meta
    const entries: PeriodDayEntry[] = [
      // 1: dia 2026-10-01, prazo 2026-10-03. Justificado em 2026-10-02 (no prazo)
      {
        mat: '1001',
        D: '2026-10-01',
        p: 'P58',
        r: 'UN-ES',
        d: 11,
        e: 6,
        sem: false,
        j: {
          matricula: '1001',
          data: '2026-10-01',
          motivo: 'Treinamento',
          horas_gangway: 0,
          descricao: '',
          responsavel_nome: 'P',
          criado_em: '2026-10-02T10:00:00'
        }
      },
      // 2: dia 2026-10-01, prazo 2026-10-03. Justificado em 2026-10-06 (fora do prazo)
      {
        mat: '1002',
        D: '2026-10-01',
        p: 'P58',
        r: 'UN-ES',
        d: 11,
        e: 5,
        sem: false,
        j: {
          matricula: '1002',
          data: '2026-10-01',
          motivo: 'Outro',
          horas_gangway: 0,
          descricao: '',
          responsavel_nome: 'P',
          criado_em: '2026-10-06T14:00:00'
        }
      },
      // 3: dia 2026-10-09, prazo 2026-10-11. Sem justificativa, mas hoje é 10 (no prazo!)
      {
        mat: '1003',
        D: '2026-10-09',
        p: 'P58',
        r: 'UN-ES',
        d: 11,
        e: 4,
        sem: false,
        j: null
      },
      // 4: dia 2026-10-04, prazo 2026-10-06. Sem justificativa e hoje é 10 (vencida!)
      {
        mat: '1004',
        D: '2026-10-04',
        p: 'P74',
        r: 'UN-BUZ',
        d: 11,
        e: 0,
        sem: true,
        j: null
      }
    ];

    const stats = computeCobrancaStats(entries, config, todayRef);
    expect(stats.need).toBe(4);
    expect(stats.ok).toBe(2);
    expect(stats.pend).toBe(2);
    expect(stats.venc).toBe(1);
    expect(stats.noPrazo).toBe(1);
    expect(stats.fora).toBe(1);
    expect(stats.oldest).toBe('2026-10-04');
    // Atraso de 2026-10-06 até 2026-10-10 = 4 dias
    expect(stats.atraso).toBe(4);
    expect(stats.st).toBe('bad');
    expect(stats.stTxt).toBe('Cobrar');
  });
});

describe('6. Cascata de 3 níveis PE / EX da Medição USOFF', () => {
  const config: ContractConfig = {
    ...DEFAULT_CONFIG,
    us_pe_padrao: 0.12,
    us_ex_padrao: 0.88
  };

  const usoffWeights: Record<string, UsoffUnWeight> = {
    'Búzios (UN-BUZ)': {
      unidade_negocio: 'Búzios (UN-BUZ)',
      pe: 0.15,
      ex: 0.85
    }
  };

  it('Nível 1: herda da carteira se preenchido', () => {
    const c: CarteiraEmbarque = {
      id: 'emb-1',
      matricula: '1001',
      plataforma_sigla: 'P74',
      unidade_negocio: 'Búzios (UN-BUZ)',
      data_inicio: '2026-10-01',
      data_fim: '2026-10-14',
      horas_programadas: 154,
      operacao: 'OP-10',
      pe: 0.2,
      ex: 0.8,
      fonte: 'carteira'
    };
    const place = { p: 'P74', r: 'Búzios (UN-BUZ)' };
    const w = resolveUsoffWeights(c, place, config, usoffWeights);
    expect(w).toEqual({ pe: 0.2, ex: 0.8 });
  });

  it('Nível 2: usa tabela da unidade se carteira for nula', () => {
    const c: CarteiraEmbarque = {
      id: 'emb-1',
      matricula: '1001',
      plataforma_sigla: 'P74',
      unidade_negocio: 'Búzios (UN-BUZ)',
      data_inicio: '2026-10-01',
      data_fim: '2026-10-14',
      horas_programadas: 154,
      operacao: 'OP-10',
      pe: null,
      ex: null,
      fonte: 'carteira'
    };
    const place = { p: 'P74', r: 'Búzios (UN-BUZ)' };
    const w = resolveUsoffWeights(c, place, config, usoffWeights);
    expect(w).toEqual({ pe: 0.15, ex: 0.85 });
  });

  it('Nível 3: usa padrão global do contrato se carteira e unidade forem nulos', () => {
    const c: CarteiraEmbarque = {
      id: 'emb-1',
      matricula: '1001',
      plataforma_sigla: 'P58',
      unidade_negocio: 'Espírito Santo (UN-ES)', // Sem peso cadastrado
      data_inicio: '2026-10-01',
      data_fim: '2026-10-14',
      horas_programadas: 154,
      operacao: 'OP-10',
      pe: null,
      ex: null,
      fonte: 'carteira'
    };
    const place = { p: 'P58', r: 'Espírito Santo (UN-ES)' };
    const w = resolveUsoffWeights(c, place, config, usoffWeights);
    expect(w).toEqual({ pe: 0.12, ex: 0.88 });
  });

  it('calcula USOFF completo e sinaliza sharedAcrossPortfolios', () => {
    const P: PeriodWindow = {
      ini: '2026-10-01',
      fim: '2026-10-14',
      m: '2026-10'
    };

    const c: CarteiraEmbarque = {
      id: 'emb-1',
      matricula: '1001',
      plataforma_sigla: 'P58',
      unidade_negocio: 'Espírito Santo (UN-ES)',
      data_inicio: '2026-10-01',
      data_fim: '2026-10-14',
      horas_programadas: 154,
      operacao: 'OP-COMPARTILHADA',
      pe: 0.1,
      ex: 0.9,
      fonte: 'carteira'
    };

    const pidx = buildPlatformIndex({
      P58: {
        sigla: 'P58',
        chave_norm: 'p58',
        nome: 'P-58',
        un: 'Espírito Santo (UN-ES)',
        armador: '',
        gerencia: '',
        tipo: 'UEP',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      }
    });

    const dataset = createBaseDataset({
      config: { ...DEFAULT_CONFIG, med_criterio: 'enc' },
      carteira: [c],
      sharedOpsSet: new Set<string>(['OP-COMPARTILHADA']),
      watermark: { ultima_data_hh: '2026-10-14', ultima_importacao_em: null }
    });

    eachDay('2026-10-01', '2026-10-14', d => {
      dataset.hhMap[`1001|${d}`] = {
        matricula: '1001',
        data: d,
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        horas_executadas: 10
      };
    });

    const ops = computeUsoffOperations(
      P,
      dataset,
      { fDate: '', fReg: '', fPlat: '', fResp: '', fPer: '', cIni: '', cFim: '' },
      pidx
    );

    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op.sharedAcrossPortfolios).toBe(true);
    expect(op.hp).toBe(154);
    expect(op.hc).toBe(140);
    // US = 0.1 * 154 + 0.9 * 140 = 15.4 + 126 = 141.4
    expect(op.us).toBeCloseTo(141.4, 4);

    const summary = summarizeUsoff(ops);
    expect(summary.us).toBeCloseTo(141.4, 4);
    expect(summary.n).toBe(1);
    expect(summary.falta).toBe(0);
  });
});

describe('7. parseFlexibleHours e parseExcelOrStringDate', () => {
  it('parseFlexibleHours analisa números, decimais com vírgula ou ponto, hh:mm e h sufixo', () => {
    expect(parseFlexibleHours(11)).toBe(11);
    expect(parseFlexibleHours(8.5)).toBe(8.5);
    expect(parseFlexibleHours('8,5')).toBe(8.5);
    expect(parseFlexibleHours('8.5')).toBe(8.5);
    expect(parseFlexibleHours('11 h')).toBe(11);
    expect(parseFlexibleHours('11,0h')).toBe(11);
    expect(parseFlexibleHours('08:30')).toBe(8.5);
    expect(parseFlexibleHours('11:00')).toBe(11);
    expect(parseFlexibleHours('07:45')).toBe(7.75);
    expect(parseFlexibleHours('')).toBeNull();
    expect(parseFlexibleHours(null)).toBeNull();
    expect(parseFlexibleHours('invalido')).toBeNull();
  });

  it('parseExcelOrStringDate analisa instâncias Date, seriais Excel e strings ISO/BR', () => {
    expect(parseExcelOrStringDate('2026-10-31')).toBe('2026-10-31');
    expect(parseExcelOrStringDate('31/10/2026')).toBe('2026-10-31');
    expect(parseExcelOrStringDate('31-10-2026')).toBe('2026-10-31');
    expect(parseExcelOrStringDate('31/10/26')).toBe('2026-10-31');

    const dt = new Date(2026, 9, 31, 15);
    expect(parseExcelOrStringDate(dt)).toBe('2026-10-31');

    // Serial Excel 45500 -> 2024-07-26
    const parsedSerial = parseExcelOrStringDate(45500);
    expect(parsedSerial).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(parseExcelOrStringDate('')).toBeNull();
    expect(parseExcelOrStringDate(null)).toBeNull();
    expect(parseExcelOrStringDate('nao-e-data')).toBeNull();
  });
});

describe('8. Demo overlay e utilitários de comunicação', () => {
  it('buildDemoOverlay constrói 9 técnicos fictícios sem e-mails reais', () => {
    const demo = buildDemoOverlay('2026-10-31');
    expect(Object.keys(demo.tecnicos)).toHaveLength(9);
    expect(demo.carteira.length).toBeGreaterThanOrEqual(18); // 9 atuais + 9 anteriores
    expect(demo.isDemo).toBe(true);

    // Garante que nenhum e-mail real foi inserido
    Object.values(demo.pessoas).forEach(p => {
      expect(p.email).toBe('');
    });

    // Técnico 10859 tem remoção de apontamento no dia anterior (D0 = 2026-10-30)
    expect(demo.hhMap['10859|2026-10-30']).toBeUndefined();
  });

  it('buildMailLinks formata URLs com deeplink para Outlook web e mailto desktop', () => {
    const links = buildMailLinks(
      ['teste@infotec.com.br', 'gestor@infotec.com.br'],
      'Assunto Teste',
      'Corpo do e-mail'
    );
    expect(links.mailtoUrl).toContain('mailto:teste@infotec.com.br,gestor@infotec.com.br?subject=Assunto%20Teste');
    expect(links.outlookWebUrl).toContain('https://outlook.office.com/mail/deeplink/compose?to=');
  });
});
