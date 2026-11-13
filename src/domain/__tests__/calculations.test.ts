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
  buildSapIndex,
  calcCarteiraHP,
  calcCarteiraHPCarteira,
  calcCarteiraHPForaCarteira,
  calcHpCarteiraInInterval,
  calcHpForaCarteiraInInterval,
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
  isSapBeforeEmbarkation,
  isArmadorDiariaSemProg,
  isArmadorPlatform,
  isPersonResponsible,
  listAvailablePlatforms,
  listAvailableUnits,
  lookupPlatform,
  mergeConfrontoOperations,
  UMS_HH_ARMADOR_SIGLAS,
  UMS_PROGRAMADAS_SIGLAS,
  passesFilter,
  prazoOf,
  resolveLocation,
  resolvePlace,
  resolvePersonFilter,
  resolvePersonUns,
  resolveDivergenciaSapStatus,
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

    it('caso 7: embarcação de Armador medida por diária sem programação e sem execução -> não gera "Não chegou" (retorna null)', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c-armador',
            matricula: '1001',
            plataforma_sigla: 'CDAN',
            unidade_negocio: 'Armador',
            data_inicio: '2026-10-10',
            data_fim: '2026-10-23',
            horas_programadas: 0,
            operacao: 'EMB_1001',
            pe: null,
            ex: null,
            fonte: 'carteira'
          }
        ],
        plataformas: {
          CDAN: {
            sigla: 'CDAN',
            chave_norm: 'cdan',
            nome: 'FPSO CIDADE DE ANCHIETA',
            un: 'FPSOs afretados',
            armador: '',
            gerencia: '',
            tipo: 'Embarcação afretada',
            situacao: 'Operando',
            cadastro_pendente: false
          }
        },
        watermark: {
          ultima_data_hh: '2026-10-15',
          ultima_importacao_em: '2026-10-15T08:00:00'
        },
        hhMap: {}
      });

      // Em 2026-10-12, técnico está previsto a bordo de embarcação de armador sem programação e sem apontamento
      const rec = resolveRecord('1001', '2026-10-12', dataset);
      expect(rec).toBeNull(); // Não gera sem: true (-11h negativo)
    });

    it('caso 8: UMS (UMAR, UMCP, UMPA) são medidas por HH do armador; demais UMS são por diária (sem carteira programada)', () => {
      // UMS medidas por HH do armador
      expect(UMS_PROGRAMADAS_SIGLAS.has('UMAR')).toBe(true);
      expect(UMS_PROGRAMADAS_SIGLAS.has('UMCP')).toBe(true);
      expect(UMS_PROGRAMADAS_SIGLAS.has('UMPA')).toBe(true);

      // Demais UMS operam por diária
      expect(UMS_PROGRAMADAS_SIGLAS.has('UMAC')).toBe(false);
      expect(UMS_PROGRAMADAS_SIGLAS.has('UMGR')).toBe(false);
      expect(UMS_PROGRAMADAS_SIGLAS.has('UMTJ')).toBe(false);

      // Plataforma UMAC (diária) sem programação e sem apontamento: isenta de "Não chegou" (retorna null)
      const datasetUmac = createBaseDataset({
        carteira: [
          {
            id: 'c-umac',
            matricula: '1001',
            plataforma_sigla: 'UMAC',
            unidade_negocio: 'Bacia de Campos (UN-BC)',
            data_inicio: '2026-10-10',
            data_fim: '2026-10-23',
            horas_programadas: 0,
            operacao: 'EMB_UMAC',
            pe: null,
            ex: null,
            fonte: 'carteira'
          }
        ],
        plataformas: {
          UMAC: {
            sigla: 'UMAC',
            chave_norm: 'umac',
            nome: 'UMS ARRAIAL DO CABO',
            un: 'Bacia de Campos (UN-BC)',
            armador: '',
            gerencia: '',
            tipo: 'Unidade Afretada UMS',
            situacao: 'Operando',
            cadastro_pendente: false
          }
        },
        watermark: {
          ultima_data_hh: '2026-10-15',
          ultima_importacao_em: '2026-10-15T08:00:00'
        },
        hhMap: {}
      });

      const recUmac = resolveRecord('1001', '2026-10-12', datasetUmac);
      expect(recUmac).toBeNull(); // Isenta: não gera -11h nem "Não chegou"

      // Plataforma UMCP (medida por HH) sem apontamento: gera "Não chegou" normalmente
      const datasetUmcp = createBaseDataset({
        carteira: [
          {
            id: 'c-umcp',
            matricula: '1002',
            plataforma_sigla: 'UMCP',
            unidade_negocio: 'Armador',
            data_inicio: '2026-10-10',
            data_fim: '2026-10-23',
            horas_programadas: 154,
            operacao: 'EMB_UMCP',
            pe: 1,
            ex: 1,
            fonte: 'carteira'
          }
        ],
        plataformas: {
          UMCP: {
            sigla: 'UMCP',
            chave_norm: 'umcp',
            nome: 'UMS PRAIA DO CABO FRIO',
            un: 'Armador',
            armador: '',
            gerencia: '',
            tipo: 'Unidade Afretada UMS',
            situacao: 'Operando',
            cadastro_pendente: false
          }
        },
        watermark: {
          ultima_data_hh: '2026-10-15',
          ultima_importacao_em: '2026-10-15T08:00:00'
        },
        hhMap: {}
      });

      const recUmcp = resolveRecord('1002', '2026-10-12', datasetUmcp);
      expect(recUmcp).not.toBeNull();
      expect(recUmcp?.sem).toBe(true);
      expect(recUmcp?.d).toBe(11);
      expect(recUmcp?.e).toBe(0);
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

      // Filtro por responsável: aceita ID e fallback legado por nome, e bloqueia plataformas não atribuídas
      const respFilterById: FilterState = { ...emptyFilters, fResp: 'prep1' };
      expect(passesFilter(place, respFilterById, dataset.pessoas)).toBe(true);
      expect(passesFilter({ p: 'P74', r: 'Búzios (UN-BUZ)' }, respFilterById, dataset.pessoas)).toBe(false);

      const respFilterByLegacyName: FilterState = { ...emptyFilters, fResp: dataset.pessoas.prep1.nome };
      expect(passesFilter(place, respFilterByLegacyName, dataset.pessoas)).toBe(true);

      const respFilterUnknown: FilterState = { ...emptyFilters, fResp: 'id-inexistente' };
      expect(passesFilter(place, respFilterUnknown, dataset.pessoas)).toBe(false);
    });

    it('isPersonResponsible, resolvePersonFilter e resolvePersonUns aplicam de-para automático sem vazar outras plataformas da UN', () => {
      const dataset = createBaseDataset();
      const multiPlats: Record<string, Plataforma> = {
        ...dataset.plataformas,
        P57: {
          sigla: 'P57',
          chave_norm: 'P57',
          nome: 'Plataforma P-57',
          un: 'Espírito Santo (UN-ES)',
          armador: '',
          gerencia: 'UO-ES',
          tipo: 'FPSO',
          situacao: 'Mobilizada',
          cadastro_pendente: false
        }
      };
      const localPidx = buildPlatformIndex(multiPlats);
      const pessoaSemUnManual: Pessoa = {
        id: 'prep-depara',
        slug: 'prep-depara',
        nome: 'Preposto DePara',
        papel: 'preposto',
        email: 'depara@infotecbrasil.com.br',
        user_id: null,
        plats: ['P58', 'P74'],
        uns: []
      };

      expect(resolvePersonUns(pessoaSemUnManual, localPidx)).toEqual([
        'Búzios (UN-BUZ)',
        'Espírito Santo (UN-ES)'
      ]);
      // Tem acesso às plataformas atribuídas e ao agrupamento por UN via de-para
      expect(isPersonResponsible(pessoaSemUnManual, { p: 'P58', r: 'Espírito Santo (UN-ES)' }, localPidx)).toBe(true);
      expect(isPersonResponsible(pessoaSemUnManual, { p: '', r: 'Espírito Santo (UN-ES)' }, localPidx)).toBe(true);
      // Não herda outra plataforma da mesma UN só porque possui P58 na UN-ES
      expect(isPersonResponsible(pessoaSemUnManual, { p: 'P57', r: 'Espírito Santo (UN-ES)' }, localPidx)).toBe(false);
      expect(resolvePersonFilter('prep-depara', { 'prep-depara': pessoaSemUnManual })?.id).toBe('prep-depara');
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

    it('calcCarteiraHPCarteira e calcHpCarteiraInInterval (regra dos 12 dias)', () => {
      const config = DEFAULT_CONFIG;
      // Embarque com 100h programadas totais: 70h em Carteira (>= 12 dias) e 30h Fora da carteira (< 12 dias)
      const c1: CarteiraEmbarque = {
        id: 'c1',
        matricula: '1001',
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-10', // 10 dias
        horas_programadas: 100,
        hh_carteira: 70,
        hh_fora_carteira: 30,
        operacao: 'OP-01',
        pe: 1,
        ex: 1,
        fonte: 'carteira'
      };

      // HP Total: 100h
      expect(calcCarteiraHP(c1, config)).toBe(100);
      // HP Carteira: 70h
      expect(calcCarteiraHPCarteira(c1, config)).toBe(70);
      // HP Fora da Carteira: 30h
      expect(calcCarteiraHPForaCarteira(c1)).toBe(30);

      // Em 5 dias (01 a 05 de 10 dias):
      expect(calcHpCarteiraInInterval(c1, '2026-10-01', '2026-10-05', config)).toBe(35);
      expect(calcHpForaCarteiraInInterval(c1, '2026-10-01', '2026-10-05')).toBe(15);

      // Fallback: se hh_carteira não estiver definido, recai para calcCarteiraHP
      const cLegacy: CarteiraEmbarque = {
        id: 'cleg',
        matricula: '1001',
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-10',
        horas_programadas: 80,
        operacao: 'OP-02',
        pe: 1,
        ex: 1,
        fonte: 'carteira'
      };
      expect(calcCarteiraHPCarteira(cLegacy, config)).toBe(80);
      expect(calcCarteiraHPForaCarteira(cLegacy)).toBe(0);
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

    it('buildSapIndex indexa confirmações por matrícula, dia e embarque', () => {
      const sapItems = [
        {
          id: 's1',
          matricula: '1001',
          data_criacao: '2026-10-30',
          data_lancamento: '2026-10-30',
          data_fim_real: '2026-10-30',
          ordem: 'ORD-1',
          operacao: '0010',
          horas_confirmadas: 4,
          id_embarque: '5001',
          status_reconciliacao: 'Em Carteira'
        },
        {
          id: 's2',
          matricula: '1001',
          data_criacao: '2026-10-30',
          data_lancamento: '2026-10-30',
          data_fim_real: '2026-10-30',
          ordem: 'ORD-2',
          operacao: '0010',
          horas_confirmadas: 6,
          id_embarque: '5001',
          status_reconciliacao: 'Fora da Carteira'
        }
      ];

      const idx = buildSapIndex(sapItems);
      expect(idx.byTech.get('1001')).toHaveLength(2);
      expect(idx.byTechDate.get('1001|2026-10-30')).toHaveLength(2);
      expect(idx.byEmbarkation.get('5001')).toHaveLength(2);
    });

    it('mergeConfrontoOperations unifica operações da carteira com ordens SAP fora da carteira', () => {
      const carteiraOps = [
        {
          id: 'co1',
          portal_id: '5001',
          id_embarque: '5001',
          matricula: '1001',
          chave_petrobras: '',
          nome: 'Técnico Teste',
          empresa: 'Infotec',
          estrutura: '',
          unidade_negocio: 'UN-BS',
          plataforma_sigla: 'P19',
          data_inicio: '2026-10-23',
          data_fim: '2026-11-05',
          ordem: 'ORD-1',
          operacao: '0010',
          status_processamento: 'Concluído',
          prioridade: 'Regular',
          status_programacao: 'Fora da carteira',
          hh_programado: 4,
          hh_confirmado: 4,
          hh_confirmado_sap: 4,
          divergencia_sap: 0,
          status_divergencia: 'OK',
          recursos: 1,
          fonte: 'carteira'
        }
      ];

      const sapItems = [
        {
          id: 's1',
          matricula: '1001',
          data_criacao: '2026-10-30',
          data_lancamento: '2026-10-30',
          data_fim_real: '2026-10-30',
          ordem: 'ORD-1',
          operacao: '0010',
          horas_confirmadas: 4,
          id_embarque: '5001',
          status_reconciliacao: 'Em Carteira'
        },
        {
          id: 's2',
          matricula: '1001',
          data_criacao: '2026-10-30',
          data_lancamento: '2026-10-30',
          data_fim_real: '2026-10-30',
          ordem: 'ORD-2',
          operacao: '0010',
          horas_confirmadas: 6,
          id_embarque: '5001',
          status_reconciliacao: 'Fora da Carteira'
        }
      ];

      const merged = mergeConfrontoOperations(carteiraOps, sapItems, [], {
        '1001': { matricula: '1001', nome: 'Técnico Teste', funcao: 'Eletricista' }
      });

      expect(merged).toHaveLength(2);
      const extraOp = merged.find(o => o.ordem === 'ORD-2');
      expect(extraOp).toBeDefined();
      expect(extraOp?.status_programacao).toBe('Não Cadastrado no Portal');
      expect(extraOp?.status_divergencia).toBe('Não Cadastrado no Portal');
      expect(extraOp?.hh_confirmado_sap).toBe(6);
      expect(extraOp?.hh_programado).toBe(0);
      expect(extraOp?.hh_confirmado).toBe(0);
      expect(extraOp?.divergencia_sap).toBe(-6);
    });

    it('UMS_HH_ARMADOR_SIGLAS: UMAR, UMCP e UMPA são cobradas em HH enquanto UMAC e UMMA são isentas por diária quando sem programação/execução', () => {
      expect(UMS_HH_ARMADOR_SIGLAS.has('UMAR')).toBe(true);
      expect(UMS_HH_ARMADOR_SIGLAS.has('UMCP')).toBe(true);
      expect(UMS_HH_ARMADOR_SIGLAS.has('UMPA')).toBe(true);
      expect(UMS_HH_ARMADOR_SIGLAS.has('UMAC')).toBe(false);
      expect(UMS_HH_ARMADOR_SIGLAS.has('UMMA')).toBe(false);

      const umsCatalog: Record<string, Plataforma> = {
        UMAR: {
          sigla: 'UMAR',
          chave_norm: 'umar',
          nome: 'UMS Arendal',
          un: 'Armador',
          armador: 'Floatel',
          gerencia: 'UO-RIO',
          tipo: 'UMS Afretada',
          situacao: 'Mobilizada',
          cadastro_pendente: false
        },
        UMCP: {
          sigla: 'UMCP',
          chave_norm: 'umcp',
          nome: 'UMS Cidade de Paraty',
          un: 'Armador',
          armador: 'POSH',
          gerencia: 'UO-BS',
          tipo: 'UMS',
          situacao: 'Mobilizada',
          cadastro_pendente: false
        },
        UMPA: {
          sigla: 'UMPA',
          chave_norm: 'umpa',
          nome: 'UMS Posh Arcadia',
          un: 'Armador',
          armador: 'POSH',
          gerencia: 'UO-BC',
          tipo: 'UMS',
          situacao: 'Mobilizada',
          cadastro_pendente: false
        },
        UMAC: {
          sigla: 'UMAC',
          chave_norm: 'umac',
          nome: 'UMS Aquarius',
          un: 'Armador',
          armador: 'GranEnergia',
          gerencia: 'UO-BC',
          tipo: 'UMS',
          situacao: 'Mobilizada',
          cadastro_pendente: false
        },
        UMMA: {
          sigla: 'UMMA',
          chave_norm: 'umma',
          nome: 'UMS Mariana',
          un: 'Armador',
          armador: 'OOS',
          gerencia: 'UO-BC',
          tipo: 'UMS',
          situacao: 'Mobilizada',
          cadastro_pendente: false
        }
      };

      // Exceções cobradas em HH: nunca tratadas como armador de diária isento
      for (const hhUms of ['UMAR', 'UMCP', 'UMPA']) {
        expect(isArmadorPlatform(umsCatalog[hhUms], hhUms, 'Armador')).toBe(false);
        const embHhUms: CarteiraEmbarque = {
          id: `c-${hhUms}`,
          matricula: '1001',
          plataforma_sigla: hhUms,
          unidade_negocio: 'Armador',
          data_inicio: '2026-10-01',
          data_fim: '2026-10-05',
          horas_programadas: null,
          operacao: `OP-${hhUms}`,
          pe: null,
          ex: null,
          fonte: 'carteira'
        };
        expect(isArmadorDiariaSemProg(embHhUms, umsCatalog)).toBe(false);
        expect(calcCarteiraHP(embHhUms, DEFAULT_CONFIG, umsCatalog)).toBe(5 * 11);
      }

      // UMAC e UMMA sem programação: isentas por diária
      for (const diariaUms of ['UMAC', 'UMMA']) {
        expect(isArmadorPlatform(umsCatalog[diariaUms], diariaUms, 'Armador')).toBe(true);
        const embDiaria: CarteiraEmbarque = {
          id: `c-${diariaUms}`,
          matricula: '1002',
          plataforma_sigla: diariaUms,
          unidade_negocio: 'Armador',
          data_inicio: '2026-10-01',
          data_fim: '2026-10-05',
          horas_programadas: 0,
          operacao: `OP-${diariaUms}`,
          pe: null,
          ex: null,
          fonte: 'carteira'
        };
        expect(isArmadorDiariaSemProg(embDiaria, umsCatalog)).toBe(true);
        expect(calcCarteiraHP(embDiaria, DEFAULT_CONFIG, umsCatalog)).toBe(0);
        expect(hpSourceLabel(embDiaria, DEFAULT_CONFIG, umsCatalog)).toBe('Diária (Armador)');
      }

      // UMAC com programação explícita > 0 deixa de ser isenta sem programação
      const embUmacComProg: CarteiraEmbarque = {
        id: 'c-umac-prog',
        matricula: '1002',
        plataforma_sigla: 'UMAC',
        unidade_negocio: 'Armador',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-05',
        horas_programadas: 44,
        operacao: 'OP-UMAC-PROG',
        pe: null,
        ex: null,
        fonte: 'carteira'
      };
      expect(isArmadorDiariaSemProg(embUmacComProg, umsCatalog)).toBe(false);
      expect(calcCarteiraHP(embUmacComProg, DEFAULT_CONFIG, umsCatalog)).toBe(44);
    });

    it('buildSapIndex trata estornos negativos, múltiplos contadores e registros parciais sem matrícula ou datas', () => {
      const sapItems = [
        {
          id: 'sap-pos',
          matricula: '1001',
          data_criacao: '2026-10-10',
          data_lancamento: '2026-10-10',
          data_fim_real: '2026-10-10',
          ordem: '20260001',
          operacao: '0010',
          horas_confirmadas: 8,
          contador_confirmacao: 1,
          id_embarque: '55104',
          status_reconciliacao: 'Em Carteira' as const
        },
        {
          id: 'sap-estorno',
          matricula: '1001',
          data_criacao: '2026-10-11',
          data_lancamento: '2026-10-11',
          data_fim_real: '2026-10-10',
          ordem: '20260001',
          operacao: '0010',
          horas_confirmadas: -8, // Estorno integral
          contador_confirmacao: 2,
          id_embarque: '55104',
          status_reconciliacao: 'Em Carteira' as const
        },
        {
          id: 'sap-reapontamento',
          matricula: '1001',
          data_criacao: '2026-10-11',
          data_lancamento: '2026-10-11',
          data_fim_real: '2026-10-10',
          ordem: '20260001',
          operacao: '0010',
          horas_confirmadas: 6.5, // Novo apontamento ajustado
          contador_confirmacao: 3,
          id_embarque: '55104',
          status_reconciliacao: 'Em Carteira' as const
        },
        {
          id: 'sap-sem-emb-e-data',
          matricula: '1002',
          data_criacao: '2026-10-12',
          data_lancamento: '2026-10-12',
          data_fim_real: '',
          ordem: '20260009',
          operacao: '0020',
          horas_confirmadas: 4,
          contador_confirmacao: 1,
          id_embarque: '',
          status_reconciliacao: 'Sem Embarque' as const
        },
        {
          id: 'sap-invalido-sem-mat',
          matricula: '',
          data_criacao: '2026-10-12',
          data_lancamento: '2026-10-12',
          data_fim_real: '2026-10-12',
          ordem: '20260099',
          operacao: '0010',
          horas_confirmadas: 5,
          contador_confirmacao: 1,
          id_embarque: '55104',
          status_reconciliacao: 'Pendente' as const
        }
      ];

      const idx = buildSapIndex(sapItems);
      expect(idx.byTech.has('')).toBe(false);
      expect(idx.byTech.get('1001')).toHaveLength(3);
      const netHours = (idx.byTechDate.get('1001|2026-10-10') || []).reduce(
        (acc, r) => acc + r.horas_confirmadas,
        0
      );
      expect(netHours).toBeCloseTo(6.5, 5);
      expect(idx.byEmbarkation.get('55104')?.map(r => r.contador_confirmacao)).toEqual([1, 2, 3]);

      // Matrícula 1002 sem data_fim_real e sem id_embarque fica indexada apenas em byTech
      expect(idx.byTech.get('1002')).toHaveLength(1);
      expect(idx.byTechDate.size).toBe(1);
      expect(idx.byEmbarkation.has('')).toBe(false);
    });

    it('mergeConfrontoOperations agrega múltiplos apontamentos + estornos, janela PMB +4d, Não Cadastrado no Portal e alias de plataforma', () => {
      const mxlCatalog: Record<string, Plataforma> = {
        MXL: {
          sigla: 'MXL',
          chave_norm: 'mxl',
          nome: 'Mexilhão',
          un: 'Bacia de Santos (UN-BS)',
          armador: '',
          gerencia: 'UO-BS',
          tipo: 'Fixa',
          situacao: 'Mobilizada',
          cadastro_pendente: false
        }
      };
      const pidx = buildPlatformIndex(mxlCatalog);

      // Embarque encerrado em 2026-10-14 na plataforma com alias PMXL-1 -> MXL
      const embRows: CarteiraEmbarque[] = [
        {
          id: 'emb-mxl-1',
          id_embarque: '55900',
          matricula: '1001',
          plataforma_sigla: 'PMXL-1',
          unidade_negocio: 'Bacia de Santos (UN-BS)',
          data_inicio: '2026-10-01',
          data_fim: '2026-10-14',
          horas_programadas: 154,
          hh_carteira: 154,
          operacao: '55900',
          pe: 1.1,
          ex: 1.2,
          fonte: 'portal_offshore'
        }
      ];

      // Confirmações SAP não cadastradas no Portal, incluindo estorno e lançamento no +4d (PMB 2026-10-18)
      const sapConfirmacoes = [
        {
          id: 'sap-extra-1',
          matricula: '1001',
          data_criacao: '2026-10-18',
          data_lancamento: '2026-10-18', // +4 dias pós-desembarque (janela PMB)
          data_fim_real: '2026-10-13',
          ordem: '40009999',
          operacao: '0020',
          horas_confirmadas: 10,
          contador_confirmacao: 1,
          id_embarque: '55900',
          status_reconciliacao: 'Fora da Carteira' as const
        },
        {
          id: 'sap-extra-2-estorno',
          matricula: '1001',
          data_criacao: '2026-10-18',
          data_lancamento: '2026-10-18',
          data_fim_real: '2026-10-14',
          ordem: '40009999',
          operacao: '0020',
          horas_confirmadas: -2.5,
          contador_confirmacao: 2,
          id_embarque: '55900',
          status_reconciliacao: 'Fora da Carteira' as const
        }
      ];

      const merged = mergeConfrontoOperations([], sapConfirmacoes, embRows, {
        '1001': { matricula: '1001', nome: 'Carlos Sintético', funcao: 'Instrumentista' }
      });

      expect(merged).toHaveLength(1);
      const synth = merged[0];
      expect(synth.status_programacao).toBe('Não Cadastrado no Portal');
      expect(synth.status_divergencia).toBe('Não Cadastrado no Portal');
      expect(synth.fonte).toBe('sap_fora_carteira');
      expect(synth.hh_confirmado_sap).toBe(7.5); // 10 - 2.5
      expect(synth.divergencia_sap).toBe(-7.5);
      expect(synth.data_inicio).toBe('2026-10-01');
      expect(synth.data_fim).toBe('2026-10-14');
      expect(synth.nome).toBe('Carlos Sintético');
      // Alias PMXL-1 resolve deterministicamente para MXL no índice de plataformas
      expect(lookupPlatform(pidx, synth.plataforma_sigla)?.sigla).toBe('MXL');
    });

    it('recalcula soma líquida SAP de [+9, -9 (estorno tardio), +9, +9] = 18 para ordem 002032288155/0010 normalizando zeros à esquerda e evitando saldo stale 27', () => {
      const embs: CarteiraEmbarque[] = [
        {
          id: 'emb-55104',
          matricula: '1001',
          nome: 'Carlos Sintético',
          unidade_negocio: 'UN-ES',
          plataforma_sigla: 'P58',
          data_inicio: '2026-10-01',
          data_fim: '2026-10-14',
          horas_programadas: 154,
          hh_carteira: 154,
          id_embarque: '55104',
          operacao: '55104',
          pe: 0.3,
          ex: 0.7,
          fonte: 'portal_offshore'
        },
        {
          id: 'emb-55200',
          matricula: '1001',
          nome: 'Carlos Sintético',
          unidade_negocio: 'UN-ES',
          plataforma_sigla: 'P58',
          data_inicio: '2026-11-01',
          data_fim: '2026-11-14',
          horas_programadas: 154,
          hh_carteira: 154,
          id_embarque: '55200',
          operacao: '55200',
          pe: 0.3,
          ex: 0.7,
          fonte: 'portal_offshore'
        }
      ];

      const ops = [
        {
          id: 'op-emb1',
          portal_id: '55104',
          id_embarque: '55104',
          matricula: '1001',
          chave_petrobras: '',
          nome: 'Carlos Sintético',
          empresa: 'Infotec Brasil',
          estrutura: '',
          unidade_negocio: 'UN-ES',
          plataforma_sigla: 'P58',
          data_inicio: '2026-10-01',
          data_fim: '2026-10-14',
          ordem: '2032288155', // sem zeros à esquerda
          operacao: '10',       // sem zeros à esquerda
          status_processamento: 'Concluído',
          prioridade: 'Regular',
          status_programacao: 'Carteira',
          hh_programado: 20,
          hh_confirmado: 18,
          hh_confirmado_sap: 27, // cache antigo no banco
          divergencia_sap: -9,
          status_divergencia: 'Divergente (SAP > Portal)',
          recursos: 1,
          fonte: 'portal_offshore'
        },
        {
          id: 'op-emb2',
          portal_id: '55200',
          id_embarque: '55200',
          matricula: '1001',
          chave_petrobras: '',
          nome: 'Carlos Sintético',
          empresa: 'Infotec Brasil',
          estrutura: '',
          unidade_negocio: 'UN-ES',
          plataforma_sigla: 'P58',
          data_inicio: '2026-11-01',
          data_fim: '2026-11-14',
          ordem: '002032288155',
          operacao: '0010',
          status_processamento: 'Concluído',
          prioridade: 'Regular',
          status_programacao: 'Carteira',
          hh_programado: 10,
          hh_confirmado: 0,
          hh_confirmado_sap: 0,
          divergencia_sap: 0,
          status_divergencia: 'Não Confirmado',
          recursos: 1,
          fonte: 'portal_offshore'
        }
      ];

      const sap = [
        {
          id: 's1', matricula: '1001', data_criacao: '2026-10-05', data_lancamento: '2026-10-05', data_fim_real: '2026-10-05',
          ordem: '002032288155', operacao: '0010', horas_confirmadas: 9, contador_confirmacao: 1, id_embarque: '55104', status_reconciliacao: 'Em Carteira' as const
        },
        {
          id: 's2', matricula: '1001', data_criacao: '2026-10-22', data_lancamento: '2026-10-22', data_fim_real: '2026-10-22', // antes de 2026-11-01 e > 4d após 2026-10-14
          ordem: '002032288155', operacao: '0010', horas_confirmadas: -9, contador_confirmacao: 2, id_embarque: '', status_reconciliacao: 'Pendente' as const
        },
        {
          id: 's3', matricula: '1001', data_criacao: '2026-10-07', data_lancamento: '2026-10-07', data_fim_real: '2026-10-07',
          ordem: '002032288155', operacao: '0010', horas_confirmadas: 9, contador_confirmacao: 3, id_embarque: '55104', status_reconciliacao: 'Em Carteira' as const
        },
        {
          id: 's4', matricula: '1001', data_criacao: '2026-10-08', data_lancamento: '2026-10-08', data_fim_real: '2026-10-08',
          ordem: '002032288155', operacao: '0010', horas_confirmadas: 9, contador_confirmacao: 4, id_embarque: '55104', status_reconciliacao: 'Em Carteira' as const
        }
      ];

      const merged = mergeConfrontoOperations(ops, sap, embs, { '1001': { matricula: '1001', nome: 'Carlos Sintético', funcao: 'Mecânico' } });
      expect(merged).toHaveLength(2);
      const emb1 = merged.find(o => o.id === 'op-emb1')!;
      const emb2 = merged.find(o => o.id === 'op-emb2')!;
      expect(emb1.hh_confirmado_sap).toBe(18);
      expect(emb1.divergencia_sap).toBe(0);
      expect(emb1.status_divergencia).toBe('OK');
      expect(emb2.hh_confirmado_sap).toBe(0);
    });

    it('acopla estorno tardio sem id_embarque em ordem Fora da Carteira à confirmação irmã (+9 e -9 somam 0) e trata saldo negativo líquido', () => {
      const extraMerged = mergeConfrontoOperations([], [
        {
          id: 'ex1', matricula: '1001', data_criacao: '2026-10-05', data_lancamento: '2026-10-05', data_fim_real: '2026-10-05',
          ordem: '00409988', operacao: '0010', horas_confirmadas: 9, contador_confirmacao: 1, id_embarque: '55104', status_reconciliacao: 'Fora da Carteira'
        },
        {
          id: 'ex2', matricula: '1001', data_criacao: '2026-10-25', data_lancamento: '2026-10-25', data_fim_real: '2026-10-25',
          ordem: '409988', operacao: '10', horas_confirmadas: -9, contador_confirmacao: 2, id_embarque: '', status_reconciliacao: 'Sem Embarque'
        }
      ]);
      expect(extraMerged).toHaveLength(1);
      expect(extraMerged[0].id_embarque).toBe('55104');
      expect(extraMerged[0].hh_confirmado_sap).toBe(0);

      expect(resolveDivergenciaSapStatus(18, 18.000001)).toBe('OK');
      expect(resolveDivergenciaSapStatus(0, -9)).toBe('Divergente (Portal > SAP)');
      expect(resolveDivergenciaSapStatus(9, 0)).toBe('Não Apontado no SAP');
    });

    it('não gera operações fantasmas para SAP Sem Embarque avulso, janela anterior ou id_embarque fora da carteira do período', () => {
      const embAtual = {
        id: 'ce-56586',
        id_embarque: '56586',
        matricula: '1005',
        plataforma_sigla: 'MXL',
        unidade_negocio: 'UN-BS',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        horas_programadas: 30,
        operacao: '',
        pe: 0.30,
        ex: 0.70,
        fonte: 'portal_offshore' as const
      };
      const opAtual = {
        id: 'op-56586',
        portal_id: '56586',
        id_embarque: '56586',
        matricula: '1005',
        chave_petrobras: '',
        nome: 'Técnico Sintético 05',
        empresa: 'Infotec Brasil',
        estrutura: '',
        unidade_negocio: 'UN-BS',
        plataforma_sigla: 'MXL',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        ordem: '2032288155',
        operacao: '10',
        status_processamento: 'Concluído',
        prioridade: 'Regular',
        status_programacao: 'Carteira',
        hh_programado: 20,
        hh_confirmado: 18,
        hh_confirmado_sap: 0,
        divergencia_sap: 0,
        status_divergencia: 'Pendente',
        recursos: 1,
        fonte: 'portal_offshore' as const
      };

      const sapNoise: import('../types').ConfirmacaoSAP[] = [
        // 4 confirmações legítimas [+9, -9 tardio, +9, +9] = 18
        { id: 'v1', matricula: '1005', data_criacao: '2026-10-05', data_lancamento: '2026-10-05', data_fim_real: '2026-10-05', ordem: '002032288155', operacao: '0010', horas_confirmadas: 9, contador_confirmacao: 1, id_embarque: '56586', status_reconciliacao: 'Em Carteira' },
        { id: 'v2', matricula: '1005', data_criacao: '2026-10-25', data_lancamento: '2026-10-25', data_fim_real: '2026-10-25', ordem: '002032288155', operacao: '0010', horas_confirmadas: -9, contador_confirmacao: 2, id_embarque: '', status_reconciliacao: 'Sem Embarque' },
        { id: 'v3', matricula: '1005', data_criacao: '2026-10-07', data_lancamento: '2026-10-07', data_fim_real: '2026-10-07', ordem: '002032288155', operacao: '0010', horas_confirmadas: 9, contador_confirmacao: 3, id_embarque: '56586', status_reconciliacao: 'Em Carteira' },
        { id: 'v4', matricula: '1005', data_criacao: '2026-10-08', data_lancamento: '2026-10-08', data_fim_real: '2026-10-08', ordem: '002032288155', operacao: '0010', horas_confirmadas: 9, contador_confirmacao: 4, id_embarque: '56586', status_reconciliacao: 'Em Carteira' },
        // Confirmação antiga sem vínculo na mesma ordem repetitiva (< data_inicio 2026-10-01): não pode somar!
        { id: 'old-same-ord', matricula: '1005', data_criacao: '2026-06-05', data_lancamento: '2026-06-05', data_fim_real: '2026-06-05', ordem: '002032288155', operacao: '0010', horas_confirmadas: 11, contador_confirmacao: 9, id_embarque: '', status_reconciliacao: 'Sem Embarque' },
        // Fora da carteira legítima dentro do embarque 56586
        { id: 'fora-ok', matricula: '1005', data_criacao: '2026-10-09', data_lancamento: '2026-10-09', data_fim_real: '2026-10-09', ordem: '00409999', operacao: '0010', horas_confirmadas: 6, contador_confirmacao: 1, id_embarque: '56586', status_reconciliacao: 'Fora da Carteira' },
        // Embarque antigo (agosto 49000) ausente da carteira do período: nunca sequestra datas de 56586
        { id: 'hist-emb', matricula: '1005', data_criacao: '2026-08-05', data_lancamento: '2026-08-05', data_fim_real: '2026-08-05', ordem: '00501111', operacao: '0010', horas_confirmadas: 22, contador_confirmacao: 1, id_embarque: '49000', status_reconciliacao: 'Fora da Carteira' },
        // 250 confirmações Sem Embarque avulsas na base/terra dentro do mês
        ...Array.from({ length: 250 }, (_, i) => ({
          id: `sem-${i}`,
          matricula: String(1100 + i),
          data_criacao: '2026-10-10',
          data_lancamento: '2026-10-10',
          data_fim_real: '2026-10-10',
          ordem: `0099${String(i).padStart(4, '0')}`,
          operacao: '0010',
          horas_confirmadas: 11,
          contador_confirmacao: 1,
          id_embarque: '',
          status_reconciliacao: 'Sem Embarque' as const
        }))
      ];

      const merged = mergeConfrontoOperations([opAtual], sapNoise, [embAtual]);
      expect(merged).toHaveLength(2);
      const principal = merged.find(o => o.ordem === '2032288155')!;
      expect(principal.hh_confirmado_sap).toBe(18);
      expect(principal.status_divergencia).toBe('OK');

      const extraValida = merged.find(o => o.ordem === '00409999')!;
      expect(extraValida.id_embarque).toBe('56586');
      expect(extraValida.hh_confirmado_sap).toBe(6);
      expect(extraValida.data_inicio).toBe('2026-10-01');
      expect(extraValida.data_fim).toBe('2026-10-14');
    });

    it('rejeita confirmação SAP pré-embarque (data_lancamento ou data_fim_real < data_inicio), inclusive para ORD 002031549540 / op 0020 com id_embarque legado', () => {
      expect(isSapBeforeEmbarkation({ data_lancamento: '2026-10-08', data_fim_real: '2026-10-11', data_criacao: '2026-10-11' }, '2026-10-10')).toBe(true);
      expect(isSapBeforeEmbarkation({ data_lancamento: '2026-10-11', data_fim_real: '2026-10-08', data_criacao: '2026-10-11' }, '2026-10-10')).toBe(true);
      expect(isSapBeforeEmbarkation({ data_lancamento: '2026-10-25', data_fim_real: '2026-10-12', data_criacao: '2026-10-25' }, '2026-10-10')).toBe(false);
      expect(isSapBeforeEmbarkation({ data_lancamento: '', data_fim_real: '', data_criacao: '2026-10-09' }, '2026-10-10')).toBe(true);

      const embActual: CarteiraEmbarque = {
        id: 'emb-57010',
        matricula: '1007',
        id_embarque: '57010',
        plataforma_sigla: 'P50',
        unidade_negocio: 'UN-RIO',
        data_inicio: '2026-10-10',
        data_fim: '2026-10-20',
        horas_programadas: 110,
        operacao: 'OP-GERAL',
        pe: null,
        ex: null,
        fonte: 'portal_offshore'
      };

      const op0020: import('../types').CarteiraOperacao = {
        id: 'op-2031549540-0020',
        portal_id: '57010',
        id_embarque: '57010',
        matricula: '1007',
        chave_petrobras: '',
        nome: 'Técnico Sintético',
        empresa: 'Infotec',
        estrutura: 'UN-RIO',
        unidade_negocio: 'UN-RIO',
        plataforma_sigla: 'P50',
        data_inicio: '2026-10-10',
        data_fim: '2026-10-20',
        ordem: '002031549540',
        operacao: '0020',
        status_processamento: 'Concluído',
        prioridade: 'Regular',
        status_programacao: 'Carteira',
        hh_programado: 5,
        hh_confirmado: 5,
        hh_confirmado_sap: 6,
        divergencia_sap: 1,
        status_divergencia: 'Divergente (+1h)',
        recursos: 1,
        fonte: 'portal_offshore'
      };

      const sapEntries: import('../types').ConfirmacaoSAP[] = [
        // 5h válidas durante o embarque
        {
          id: 'sap-ok-5h',
          matricula: '1007',
          data_criacao: '2026-10-12',
          data_lancamento: '2026-10-12',
          data_fim_real: '2026-10-12',
          ordem: '002031549540',
          operacao: '0020',
          horas_confirmadas: 5,
          contador_confirmacao: 2,
          id_embarque: '57010',
          status_reconciliacao: 'Em Carteira'
        },
        // 1h pré-embarque (data_lancamento 2026-10-08 < data_inicio 2026-10-10), mesmo com data_fim_real dentro e id_embarque legado
        {
          id: 'sap-pre-1h-lanc',
          matricula: '1007',
          data_criacao: '2026-10-11',
          data_lancamento: '2026-10-08',
          data_fim_real: '2026-10-11',
          ordem: '002031549540',
          operacao: '0020',
          horas_confirmadas: 1,
          contador_confirmacao: 1,
          id_embarque: '57010',
          status_reconciliacao: 'Em Carteira'
        },
        // Extra Fora da Carteira também pré-embarque com id_embarque legado: não deve vazar em Passo A
        {
          id: 'sap-pre-fora-extra',
          matricula: '1007',
          data_criacao: '2026-10-07',
          data_lancamento: '2026-10-07',
          data_fim_real: '2026-10-12',
          ordem: '002099998888',
          operacao: '0030',
          horas_confirmadas: 4,
          contador_confirmacao: 1,
          id_embarque: '57010',
          status_reconciliacao: 'Fora da Carteira'
        }
      ];

      const mergedSingle = mergeConfrontoOperations([op0020], sapEntries, [embActual]);
      expect(mergedSingle).toHaveLength(1);
      expect(mergedSingle[0].hh_confirmado_sap).toBe(5);
      expect(mergedSingle[0].divergencia_sap).toBe(0);
      expect(mergedSingle[0].status_divergencia).toBe('OK');

      // Sem vínculo no banco (!csEmb) e múltiplas operações futuras: nunca cai em embarque futuro nem via Passo B
      const embFut: CarteiraEmbarque = {
        ...embActual,
        id: 'emb-57999',
        id_embarque: '57999',
        data_inicio: '2026-10-25',
        data_fim: '2026-11-05'
      };
      const opFut: import('../types').CarteiraOperacao = {
        ...op0020,
        id: 'op-fut',
        id_embarque: '57999',
        portal_id: '57999',
        data_inicio: '2026-10-25',
        data_fim: '2026-11-05',
        hh_confirmado: 0,
        hh_confirmado_sap: 0
      };
      const sapPreFut: import('../types').ConfirmacaoSAP[] = [
        {
          id: 'sap-pre-unlinked',
          matricula: '1007',
          data_criacao: '2026-10-05',
          data_lancamento: '2026-10-05',
          data_fim_real: '2026-10-05',
          ordem: '002031549540',
          operacao: '0020',
          horas_confirmadas: 3,
          contador_confirmacao: 1,
          id_embarque: '',
          status_reconciliacao: 'Sem Embarque'
        },
        {
          // Irmã Fora da Carteira com id_embarque vazio e pré-embarque: não deve acoplar em opFut (Passo B)
          id: 'sap-pre-sibling',
          matricula: '1007',
          data_criacao: '2026-10-05',
          data_lancamento: '2026-10-05',
          data_fim_real: '2026-10-05',
          ordem: '002031549540',
          operacao: '0099',
          horas_confirmadas: 2,
          contador_confirmacao: 1,
          id_embarque: '',
          status_reconciliacao: 'Sem Embarque'
        }
      ];

      const mergedFut = mergeConfrontoOperations([opFut], sapPreFut, [embFut]);
      expect(mergedFut).toHaveLength(1);
      expect(mergedFut[0].hh_confirmado_sap).toBe(0);
    });
  });
});
