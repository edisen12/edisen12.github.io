import { describe, expect, it } from 'vitest';
import type {
  AppDataset,
  CarteiraEmbarque,
  ContractConfig,
  FilterState,
  PeriodDayEntry,
  PeriodWindow,
  Pessoa,
  Plataforma
} from '../types';
import { DEFAULT_CONFIG } from '../../config/constants';
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
      armador: 'SBM Offshore',
      gerencia: '',
      tipo: 'FPSO',
      situacao: 'Mobilizada',
      cadastro_pendente: false
    }
  },
  pessoas: {
    prep1: {
      id: 'prep1',
      slug: 'prep-1',
      nome: 'Preposto Santos',
      papel: 'preposto',
      email: 'santos@infotec.com.br',
      user_id: null,
      plats: ['P58'],
      uns: ['Espírito Santo (UN-ES)']
    },
    gest1: {
      id: 'gest1',
      slug: 'gest-1',
      nome: 'Gestor Oliveira',
      papel: 'gestor',
      email: 'oliveira@infotec.com.br',
      user_id: null,
      plats: [],
      uns: ['Espírito Santo (UN-ES)']
    }
  },
  profiles: {},
  tecnicos: {
    '1001': { matricula: '1001', nome: 'Carlos Silva', funcao: 'Técnico de Automação' },
    '1002': { matricula: '1002', nome: 'Mariana Costa', funcao: 'Técnica de Instrumentação' }
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

const emptyFilters: FilterState = {
  fDate: '',
  fReg: '',
  fPlat: '',
  fResp: '',
  fPer: '',
  cIni: '',
  cFim: ''
};

describe('src/domain/calculations.ts - Invariantes Matemáticos & Regras de Domínio', () => {
  describe('1. resolveRecord & Síntese de "Não chegou" (sem: true) e Proteção de Transbordo', () => {
    it('caso 1: dia com apontamento normal (11h disponíveis, 11h executadas)', () => {
      const dataset = createBaseDataset({
        hhMap: {
          '1001|2026-10-10': {
            matricula: '1001',
            data: '2026-10-10',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 11
          }
        }
      });

      const rec = resolveRecord('1001', '2026-10-10', dataset);
      expect(rec).not.toBeNull();
      expect(rec).toEqual({
        d: 11,
        e: 11,
        p: 'P58',
        r: 'Espírito Santo (UN-ES)',
        sem: false
      });
    });

    it('caso 2: dia parcial (11h disponíveis, 6h executadas)', () => {
      const dataset = createBaseDataset({
        hhMap: {
          '1001|2026-10-10': {
            matricula: '1001',
            data: '2026-10-10',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 6
          }
        }
      });

      const rec = resolveRecord('1001', '2026-10-10', dataset);
      expect(rec).not.toBeNull();
      expect(rec).toEqual({
        d: 11,
        e: 6,
        p: 'P58',
        r: 'Espírito Santo (UN-ES)',
        sem: false
      });
    });

    it('caso 3: dia fora do embarque e sem apontamento -> retorna null', () => {
      const dataset = createBaseDataset({
        carteira: [],
        hhMap: {}
      });

      const rec = resolveRecord('1001', '2026-10-10', dataset);
      expect(rec).toBeNull();
    });

    it('caso 4: dia com carteira mas data posterior a ultima_data_hh -> retorna null (ainda não importado)', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-10',
            data_fim: '2026-10-23',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ],
        watermark: {
          ultima_data_hh: '2026-10-15', // Importado até 15/10
          ultima_importacao_em: '2026-10-15T08:00:00'
        },
        hhMap: {}
      });

      // Data 16/10 é futura em relação à última importação (15/10)
      const rec = resolveRecord('1001', '2026-10-16', dataset);
      expect(rec).toBeNull();
    });

    it('caso 5: síntese de "Não chegou" (sem: true) quando previsto em carteira na data D <= LAST sem apontamento', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-10',
            data_fim: '2026-10-23',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ],
        watermark: {
          ultima_data_hh: '2026-10-15',
          ultima_importacao_em: '2026-10-15T08:00:00'
        },
        hhMap: {} // Nenhum apontamento no período importado
      });

      const rec = resolveRecord('1001', '2026-10-12', dataset);
      expect(rec).not.toBeNull();
      expect(rec).toEqual({
        d: 11,
        e: 0,
        p: '',
        r: '',
        sem: true // Identificado como "Não chegou"
      });
    });

    it('caso 6: proteção de transbordo (externalCoveredSet) não pode gerar falso "Não chegou"', () => {
      const key = '1001|2026-10-12';
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-10',
            data_fim: '2026-10-23',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ],
        watermark: {
          ultima_data_hh: '2026-10-15',
          ultima_importacao_em: '2026-10-15T08:00:00'
        },
        hhMap: {}, // Sem apontamento no contrato principal
        externalCoveredSet: new Set([key]) // Técnico em transbordo coberto em outro contrato/sistema
      });

      // Com a chave em externalCoveredSet, resolveRecord deve retornar null em vez de sintetizar falta/sem:true
      const rec = resolveRecord('1001', '2026-10-12', dataset);
      expect(rec).toBeNull();
    });
  });

  describe('2. accumulateEmbarkation & Compensação de Gangway Desconectada (pAj)', () => {
    it('acumula dias, calcula saldo positivo/negativo e percentual bruto', () => {
      const emb = {
        ini: '2026-10-01',
        fim: '2026-10-14',
        dia: 3,
        n: 14,
        plat: 'P58',
        reg: 'Espírito Santo (UN-ES)',
        fonte: 'carteira' as const,
        hp: 154,
        hpF: 'Portal Offshore'
      };

      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ],
        hhMap: {
          '1001|2026-10-01': { matricula: '1001', data: '2026-10-01', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 },
          '1001|2026-10-02': { matricula: '1001', data: '2026-10-02', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 8 },
          '1001|2026-10-03': { matricula: '1001', data: '2026-10-03', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 }
        }
      });

      const acc = accumulateEmbarkation('1001', '2026-10-03', emb, dataset);

      // d = 33, e = 30
      expect(acc.d).toBe(33);
      expect(acc.e).toBe(30);
      expect(acc.dias).toBe(3);
      expect(acc.saldo).toBe(-3); // 30 - 33 = -3h (saldo negativo)
      expect(acc.p).toBeCloseTo((30 / 33) * 100, 2);
      expect(acc.prog).toBe(154);
      // progAte = 154 * (3 / 14) = 33
      expect(acc.progAte).toBeCloseTo(33, 1);
    });

    it('calcula percentual ajustado (pAj) descontando horas de Gangway desconectada', () => {
      const emb = {
        ini: '2026-10-01',
        fim: '2026-10-14',
        dia: 2,
        n: 14,
        plat: 'P58',
        reg: 'Espírito Santo (UN-ES)',
        fonte: 'carteira' as const,
        hp: 154,
        hpF: 'Portal Offshore'
      };

      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ],
        hhMap: {
          // Dia 1: 11h
          '1001|2026-10-01': { matricula: '1001', data: '2026-10-01', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 },
          // Dia 2: 0h (Gangway desconectada por 11h justificadas)
          '1001|2026-10-02': { matricula: '1001', data: '2026-10-02', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 0 }
        },
        justMap: {
          '1001|2026-10-02': {
            matricula: '1001',
            data: '2026-10-02',
            motivo: 'Gangway desconectada',
            horas_gangway: 11,
            descricao: 'Mar agitado',
            responsavel_nome: 'Preposto'
          }
        }
      });

      const acc = accumulateEmbarkation('1001', '2026-10-02', emb, dataset);

      // d = 22, e = 11, gw = 11
      expect(acc.d).toBe(22);
      expect(acc.e).toBe(11);
      expect(acc.gw).toBe(11);

      // Percentual bruto p = 11 / 22 = 50%
      expect(acc.p).toBe(50);

      // Percentual ajustado pAj = e / (d - gw) = 11 / (22 - 11) = 11 / 11 = 100%!
      expect(acc.pAj).toBe(100);
    });
  });

  describe('3. inferEmbarkation (Identificação do ciclo de embarque)', () => {
    it('infere embarque a partir da carteira calculando dia atual e total n', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ]
      });

      const emb = inferEmbarkation('1001', '2026-10-05', dataset);
      expect(emb).not.toBeNull();
      expect(emb?.fonte).toBe('carteira');
      expect(emb?.dia).toBe(5); // 01 a 05 = dia 5
      expect(emb?.n).toBe(14); // 01 a 14 = 14 dias
      expect(emb?.plat).toBe('P58');
      expect(emb?.hp).toBe(154);
    });

    it('infere embarque a partir de apontamentos sequenciais quando técnico não possui carteira', () => {
      const dataset = createBaseDataset({
        carteira: [],
        hhMap: {
          '1001|2026-10-03': { matricula: '1001', data: '2026-10-03', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 },
          '1001|2026-10-04': { matricula: '1001', data: '2026-10-04', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 },
          '1001|2026-10-05': { matricula: '1001', data: '2026-10-05', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 }
        }
      });

      const emb = inferEmbarkation('1001', '2026-10-05', dataset);
      expect(emb).not.toBeNull();
      expect(emb?.fonte).toBe('apontamentos');
      expect(emb?.ini).toBe('2026-10-03'); // Rastreado para o início da sequência
      expect(emb?.dia).toBe(3);
      expect(emb?.n).toBe(14); // Padrão de 14 dias do contrato
      expect(emb?.hp).toBe(14 * 11); // 154h
    });

    it('retorna null se técnico não tem carteira e nem apontamento no dia', () => {
      const dataset = createBaseDataset();
      const emb = inferEmbarkation('1001', '2026-10-05', dataset);
      expect(emb).toBeNull();
    });
  });

  describe('4. Status contratual (statusOf)', () => {
    const config = DEFAULT_CONFIG; // meta: 100%, atencao: 90%

    it('retorna "ok" para valores >= 100%', () => {
      expect(statusOf(100, config)).toBe('ok');
      expect(statusOf(105, config)).toBe('ok');
      expect(statusOf(99.9999, config)).toBe('ok'); // margem de floating point
    });

    it('retorna "warn" para valores entre 90% e 99.9%', () => {
      expect(statusOf(90, config)).toBe('warn');
      expect(statusOf(95, config)).toBe('warn');
      expect(statusOf(99.9, config)).toBe('warn');
    });

    it('retorna "bad" para valores < 90%', () => {
      expect(statusOf(89.9, config)).toBe('bad');
      expect(statusOf(50, config)).toBe('bad');
      expect(statusOf(0, config)).toBe('bad');
    });

    it('retorna "sem" para valores nulos ou indefinidos', () => {
      expect(statusOf(null, config)).toBe('sem');
    });
  });

  describe('5. Agregações (aggregateDays)', () => {
    it('consolida métricas de dias, horas, técnicos, pendências e técnicos abaixo da meta', () => {
      const days: PeriodDayEntry[] = [
        // Técnico 1001: 2 dias, 11h e 6h (com pendência no segundo dia)
        { mat: '1001', D: '2026-10-01', p: 'P58', r: 'Espírito Santo (UN-ES)', d: 11, e: 11, sem: false, j: null },
        { mat: '1001', D: '2026-10-02', p: 'P58', r: 'Espírito Santo (UN-ES)', d: 11, e: 6, sem: false, j: null },
        // Técnico 1002: 1 dia, 11h com meta batida
        { mat: '1002', D: '2026-10-01', p: 'P74', r: 'Búzios (UN-BUZ)', d: 11, e: 11, sem: false, j: null }
      ];

      const config: ContractConfig = {
        ...DEFAULT_CONFIG,
        prazo_justificativa_dias: 2
      };

      // refToday = 2026-10-10 -> pendência de 02/10 tem prazo 04/10 -> VENCIDA!
      const metrics = aggregateDays(days, config, '2026-10-10');

      expect(metrics.n).toBe(3); // 3 registros diários
      expect(metrics.d).toBe(33); // 3 * 11
      expect(metrics.e).toBe(28); // 11 + 6 + 11
      expect(metrics.saldo).toBe(-5); // 28 - 33 = -5h
      expect(metrics.inf).toBe(1); // 1 registro abaixo da meta
      expect(metrics.pend).toBe(1); // 1 pendente de justificativa
      expect(metrics.venc).toBe(1); // 1 vencido
      expect(metrics.tec).toBe(2); // 2 técnicos únicos (1001 e 1002)
      expect(metrics.abAcc).toBe(1); // Apenas 1001 ficou abaixo no acumulado (17 / 22 < 100%)
      expect(metrics.plats.size).toBe(2);
      expect(metrics.regs.size).toBe(2);
    });
  });

  describe('6. SLA de Justificativas (computeCobrancaStats)', () => {
    it('calcula estatísticas de SLA: no prazo vs vencidas, tempo médio e atraso', () => {
      const daysBelowTarget: PeriodDayEntry[] = [
        // Justificado em 2 dias (no prazo)
        {
          mat: '1001',
          D: '2026-10-01',
          p: 'P58',
          r: 'Espírito Santo (UN-ES)',
          d: 11,
          e: 5,
          sem: false,
          j: {
            matricula: '1001',
            data: '2026-10-01',
            motivo: 'Condições climáticas',
            horas_gangway: 0,
            descricao: '',
            responsavel_nome: 'Preposto',
            criado_em: '2026-10-03T10:00:00' // Respondeu em 2 dias
          }
        },
        // Justificado fora do prazo (em 5 dias)
        {
          mat: '1001',
          D: '2026-10-02',
          p: 'P58',
          r: 'Espírito Santo (UN-ES)',
          d: 11,
          e: 4,
          sem: false,
          j: {
            matricula: '1001',
            data: '2026-10-02',
            motivo: 'Falta de material',
            horas_gangway: 0,
            descricao: '',
            responsavel_nome: 'Preposto',
            criado_em: '2026-10-07T10:00:00' // Respondeu em 5 dias (prazo era 04/10)
          }
        },
        // Pendente vencido
        {
          mat: '1002',
          D: '2026-10-05',
          p: 'P74',
          r: 'Búzios (UN-BUZ)',
          d: 11,
          e: 0,
          sem: true,
          j: null // Sem justificativa! Prazo era 07/10. Em 15/10 está vencido há 8 dias!
        },
        // Pendente no prazo
        {
          mat: '1002',
          D: '2026-10-14',
          p: 'P74',
          r: 'Búzios (UN-BUZ)',
          d: 11,
          e: 6,
          sem: false,
          j: null // Prazo 16/10. Em 15/10 está no prazo!
        }
      ];

      const config: ContractConfig = {
        ...DEFAULT_CONFIG,
        prazo_justificativa_dias: 2
      };

      const stats = computeCobrancaStats(daysBelowTarget, config, '2026-10-15');

      expect(stats.need).toBe(4);
      expect(stats.ok).toBe(2);
      expect(stats.pend).toBe(2);
      expect(stats.venc).toBe(1);
      expect(stats.noPrazo).toBe(1);
      expect(stats.fora).toBe(1); // 1 foi justificado após o prazo
      // Tempo médio de resposta dos 2 justificados: (2 + 5) / 2 = 3.5 dias
      expect(stats.tMed).toBe(3.5);
      expect(stats.oldest).toBe('2026-10-05');
      // Atraso do item mais antigo (2026-10-05 prazo 2026-10-07 até 2026-10-15 = 8 dias)
      expect(stats.atraso).toBe(8);
      expect(stats.st).toBe('bad'); // Vencido presente -> status 'bad'
      expect(stats.stTxt).toBe('Cobrar');
    });
  });

  describe('7. Funções Utilitárias de Plataforma, Contrato & Responsabilidade', () => {
    it('buildPlatformIndex e lookupPlatform resolvem variações de grafia', () => {
      const dataset = createBaseDataset();
      const pidx = buildPlatformIndex(dataset.plataformas);

      expect(lookupPlatform(pidx, 'P58')?.sigla).toBe('P58');
      expect(lookupPlatform(pidx, 'p-58')?.sigla).toBe('P58');
      expect(lookupPlatform(pidx, 'P 58')?.sigla).toBe('P58');
      expect(lookupPlatform(pidx, 'P-74')?.sigla).toBe('P74');
      expect(lookupPlatform(pidx, 'Inexistente')).toBeNull();
    });

    it('formatPlatformLabel e armadorOf', () => {
      const dataset = createBaseDataset();
      const pidx = buildPlatformIndex(dataset.plataformas);

      expect(armadorOf(pidx, 'P74')).toBe('SBM Offshore');
      expect(armadorOf(pidx, 'P58')).toBe('Petrobras');
      // P-74 normaliza para p74, que é idêntico à sigla P74 -> base é apenas P74
      expect(formatPlatformLabel(dataset.plataformas.P74)).toBe('P74 · Armador SBM Offshore');

      // Plataforma com nome diferente da sigla exibe ambos
      const platNomeDiferente: Plataforma = {
        sigla: 'MV30',
        chave_norm: 'mv30',
        nome: 'FPSO Carioca',
        un: 'Santos (UN-BS)',
        armador: 'MODEC',
        gerencia: '',
        tipo: 'FPSO',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      };
      expect(formatPlatformLabel(platNomeDiferente)).toBe('MV30 · FPSO Carioca · Armador MODEC');
    });

    it('resolvePlace e passesFilter', () => {
      const dataset = createBaseDataset();
      const pidx = buildPlatformIndex(dataset.plataformas);

      const place = resolvePlace(pidx, 'P58', '');
      expect(place.p).toBe('P58');
      expect(place.r).toBe('Espírito Santo (UN-ES)');

      const filterOk: FilterState = { ...emptyFilters, fReg: 'Espírito Santo (UN-ES)' };
      expect(passesFilter(place, filterOk, dataset.pessoas)).toBe(true);

      const filterFail: FilterState = { ...emptyFilters, fReg: 'Búzios (UN-BUZ)' };
      expect(passesFilter(place, filterFail, dataset.pessoas)).toBe(false);
    });

    it('isPersonResponsible e findResponsiblePeople', () => {
      const dataset = createBaseDataset();
      const prep1 = dataset.pessoas.prep1; // Responde por P58 / UN-ES

      expect(isPersonResponsible(prep1, { p: 'P58', r: 'Espírito Santo (UN-ES)' })).toBe(true);
      expect(isPersonResponsible(prep1, { p: 'P74', r: 'Búzios (UN-BUZ)' })).toBe(false);

      const responsible = findResponsiblePeople(dataset.pessoas, ['P58'], ['Espírito Santo (UN-ES)']);
      expect(responsible.map(p => p.id)).toContain('prep1');
      expect(responsible.map(p => p.id)).toContain('gest1');
    });

    it('gestorOfUn retorna gestores daquela unidade', () => {
      const dataset = createBaseDataset();
      const gestores = gestorOfUn('Espírito Santo (UN-ES)', dataset.plataformas, dataset.pessoas);
      expect(gestores).toContain('Gestor Oliveira');
    });

    it('calcCarteiraHP e calcHpInInterval', () => {
      const config = DEFAULT_CONFIG; // 11h/dia
      const c: CarteiraEmbarque = {
        id: 'c1',
        matricula: '1001',
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        horas_programadas: null, // Sem horas fixas -> calcula n * H
        operacao: 'OP-01',
        pe: 1,
        ex: 1,
        fonte: 'carteira'
      };

      // 14 dias * 11 = 154h
      expect(calcCarteiraHP(c, config)).toBe(154);
      expect(hpSourceLabel(c, config)).toContain('dias ×');

      // Em um intervalo de 7 dias (01 a 07): 154 * 7 / 14 = 77h
      expect(calcHpInInterval(c, '2026-10-01', '2026-10-07', config)).toBe(77);
    });

    it('prazoOf e computeDataAte', () => {
      const config = { ...DEFAULT_CONFIG, prazo_justificativa_dias: 2 };
      expect(prazoOf('2026-10-01', config)).toBe('2026-10-03');

      const P: PeriodWindow = { ini: '2026-09-21', fim: '2026-10-20', m: '2026-10' };
      expect(computeDataAte(P, '2026-10-15')).toBe('2026-10-15');
      expect(computeDataAte(P, '2026-10-25')).toBe('2026-10-20');
    });

    it('resolveTechName', () => {
      const dataset = createBaseDataset();
      expect(resolveTechName('1001', dataset)).toBe('Carlos Silva');
      expect(resolveTechName('9999', dataset)).toBe('Matrícula 9999');
    });

    it('resolveTechSituation indica se o técnico está embarcado, desembarcou ou fora', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);

      // Em 2026-10-05: Embarcado
      const sitEmbarcado = resolveTechSituation('1001', 'P58', dataset, pidx, '2026-10-05');
      expect(sitEmbarcado.t).toBe('Embarcado agora');
      expect(sitEmbarcado.s).toContain('dia 5 de 14');

      // Em 2026-10-20: Desembarcou
      const sitDesembarcou = resolveTechSituation('1001', 'P58', dataset, pidx, '2026-10-20');
      expect(sitDesembarcou.t).toBe('Desembarcou');
      expect(sitDesembarcou.s).toContain('em 14/10/2026');

      // Em 2026-09-25: Embarca no futuro
      const sitFuturo = resolveTechSituation('1001', 'P58', dataset, pidx, '2026-09-25');
      expect(sitFuturo.t).toBe('Embarca');
      expect(sitFuturo.s).toContain('em 01/10/2026');
    });

    it('listAvailableUnits e listAvailablePlatforms listam opções deduplicadas e ordenadas', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const units = listAvailableUnits(dataset, pidx);
      expect(units).toContain('Espírito Santo (UN-ES)');
      expect(units).toContain('Búzios (UN-BUZ)');

      const plats = listAvailablePlatforms(dataset, pidx);
      expect(plats).toContain('P58');
    });
  });

  describe('8. Pipeline de Processamento de Linhas e Períodos (computeDayRows, computePeriodDays, computeMeasurementDays, computePeriodTechs)', () => {
    const period: PeriodWindow = {
      ini: '2026-09-21',
      fim: '2026-10-20',
      m: '2026-10'
    };

    it('computeDayRows processa apontamentos e carteira do dia ordenando por percentual ascendente', () => {
      const dataset = createBaseDataset({
        hhMap: {
          '1001|2026-10-05': { matricula: '1001', data: '2026-10-05', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 6 },
          '1002|2026-10-05': { matricula: '1002', data: '2026-10-05', plataforma_sigla: 'P74', unidade_negocio: 'Búzios (UN-BUZ)', horas_executadas: 11 }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const rows = computeDayRows('2026-10-05', dataset, pidx);

      expect(rows).toHaveLength(2);
      // Ordenação: 1001 tem 6/11 (54.5%) vem antes de 1002 com 11/11 (100%)
      expect(rows[0].mat).toBe('1001');
      expect(rows[0].pc).toBeCloseTo(54.54, 1);
      expect(rows[0].st).toBe('bad');

      expect(rows[1].mat).toBe('1002');
      expect(rows[1].pc).toBe(100);
      expect(rows[1].st).toBe('ok');
    });

    it('computePeriodDays filtra por janela de medição e respeita filtros de regional/plataforma', () => {
      const dataset = createBaseDataset({
        hhMap: {
          '1001|2026-10-01': { matricula: '1001', data: '2026-10-01', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 },
          '1002|2026-10-01': { matricula: '1002', data: '2026-10-01', plataforma_sigla: 'P74', unidade_negocio: 'Búzios (UN-BUZ)', horas_executadas: 11 }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);

      // Sem filtro -> retorna 2 registros
      const allDays = computePeriodDays(period, dataset, emptyFilters, pidx);
      expect(allDays).toHaveLength(2);

      // Com filtro para P58 -> retorna apenas 1001
      const filterP58: FilterState = { ...emptyFilters, fPlat: 'P58' };
      const p58Days = computePeriodDays(period, dataset, filterP58, pidx);
      expect(p58Days).toHaveLength(1);
      expect(p58Days[0].mat).toBe('1001');
    });

    it('getClosedEmbarkations e getRollingEmbarkations separam embarques encerrados vs contínuos (rolling)', () => {
      const dataset = createBaseDataset({
        carteira: [
          // Embarque encerrado dentro do período (fim: 2026-10-14 <= 2026-10-20)
          {
            id: 'c-encerrado',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          },
          // Embarque contínuo virando a medição (inicio: 2026-10-15, fim: 2026-10-28 > 2026-10-20)
          {
            id: 'c-rolling',
            matricula: '1002',
            plataforma_sigla: 'P74',
            unidade_negocio: 'Búzios (UN-BUZ)',
            data_inicio: '2026-10-15',
            data_fim: '2026-10-28',
            horas_programadas: 154,
            operacao: 'OP-02',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);

      const closed = getClosedEmbarkations(period, dataset, emptyFilters, pidx);
      expect(closed).toHaveLength(1);
      expect(closed[0].id).toBe('c-encerrado');

      const rolling = getRollingEmbarkations(period, dataset, emptyFilters, pidx);
      expect(rolling).toHaveLength(1);
      expect(rolling[0].id).toBe('c-rolling');
    });

    it('computeMeasurementDays com med_criterio = "enc" inclui dias de embarque que começaram antes do período mas encerraram nele', () => {
      const dataset = createBaseDataset({
        config: {
          ...DEFAULT_CONFIG,
          med_criterio: 'enc' // Critério de embarque encerrado
        },
        carteira: [
          {
            id: 'c-cross-period',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-09-15', // Iniciou antes de 2026-09-21
            data_fim: '2026-09-28',    // Encerrou dentro da medição de 2026-10!
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ],
        hhMap: {
          '1001|2026-09-15': { matricula: '1001', data: '2026-09-15', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 },
          '1001|2026-09-25': { matricula: '1001', data: '2026-09-25', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const days = computeMeasurementDays(period, dataset, emptyFilters, pidx);

      // Deve incluir o dia 2026-09-15 mesmo estando antes de P.ini (2026-09-21)
      expect(days.some(d => d.D === '2026-09-15')).toBe(true);
      expect(days.some(d => d.D === '2026-09-25')).toBe(true);
    });

    it('computePeriodTechs gera sumário consolidado com histórico de embarques e dias da carteira', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-01',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ],
        hhMap: {
          '1001|2026-10-01': { matricula: '1001', data: '2026-10-01', plataforma_sigla: 'P58', unidade_negocio: 'Espírito Santo (UN-ES)', horas_executadas: 11 }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const techs = computePeriodTechs(period, false, dataset, emptyFilters, pidx);

      expect(techs).toHaveLength(1);
      const t = techs[0];
      expect(t.mat).toBe('1001');
      expect(t.nome).toBe('Carlos Silva');
      // 14 dias previstos na carteira com data <= watermark: d = 14 * 11 = 154h
      expect(t.d).toBe(154);
      expect(t.e).toBe(11);
      expect(t.dias).toBe(1); // 1 dia efetivamente apontado
      expect(t.semAp).toBe(13); // 13 dias sintetizados como "Não chegou"
      expect(t.cartDias).toBe(14);
      expect(t.prog).toBe(154);
      expect(t.st).toBe('bad'); // 11 / 154 = 7.1% < 90% -> status 'bad'
    });

    it('groupDaysByField agrupa corretamente por regional ("r") ou plataforma ("p")', () => {
      const days: PeriodDayEntry[] = [
        { mat: '1001', D: '2026-10-01', p: 'P58', r: 'Espírito Santo (UN-ES)', d: 11, e: 11, sem: false, j: null },
        { mat: '1002', D: '2026-10-01', p: 'P74', r: 'Búzios (UN-BUZ)', d: 11, e: 6, sem: false, j: null }
      ];

      const byReg = groupDaysByField(days, 'r', DEFAULT_CONFIG);
      expect(byReg).toHaveLength(2);
      expect(byReg.map(g => g.k)).toContain('Espírito Santo (UN-ES)');
      expect(byReg.map(g => g.k)).toContain('Búzios (UN-BUZ)');

      const byPlat = groupDaysByField(days, 'p', DEFAULT_CONFIG);
      expect(byPlat).toHaveLength(2);
      expect(byPlat.map(g => g.k)).toContain('P58');
      expect(byPlat.map(g => g.k)).toContain('P74');
    });
  });
});
