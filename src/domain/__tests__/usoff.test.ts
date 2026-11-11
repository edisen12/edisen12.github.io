import { describe, expect, it } from 'vitest';
import type {
  AppDataset,
  CarteiraEmbarque,
  ContractConfig,
  FilterState,
  PeriodWindow,
  Plataforma,
  ResolvedPlace,
  UsoffUnWeight
} from '../types';
import { DEFAULT_CONFIG } from '../../config/constants';
import {
  computeUsoffOperations,
  resolveUsoffWeights,
  summarizeUsoff
} from '../usoff';
import {
  buildPlatformIndex,
  calcHpCarteiraInInterval,
  calcHpForaCarteiraInInterval
} from '../calculations';

const createBaseDataset = (overrides?: Partial<AppDataset>): AppDataset => ({
  config: {
    ...DEFAULT_CONFIG,
    us_pe_padrao: null,
    us_ex_padrao: null
  },
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
  pessoas: {},
  profiles: {},
  tecnicos: {
    '1001': { matricula: '1001', nome: 'Técnico Um', funcao: 'Automação' },
    '1002': { matricula: '1002', nome: 'Técnico Dois', funcao: 'Instrumentação' }
  },
  carteira: [],
  hhMap: {},
  justMap: {},
  externalCoveredSet: new Set<string>(),
  sharedOpsSet: new Set<string>(),
  watermark: {
    ultima_data_hh: '2026-10-20',
    ultima_importacao_em: '2026-10-20T08:00:00'
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

const basePeriod: PeriodWindow = {
  ini: '2026-09-21',
  fim: '2026-10-20',
  m: '2026-10'
};

describe('src/domain/usoff.ts - Cálculo de USOFF & Invariantes Financeiros', () => {
  describe('1. Cascata de 3 níveis de resolução de pesos (resolveUsoffWeights)', () => {
    const configWithGlobal: ContractConfig = {
      ...DEFAULT_CONFIG,
      us_pe_padrao: 1.5,
      us_ex_padrao: 2.0
    };

    const unWeights: Record<string, UsoffUnWeight> = {
      'Espírito Santo (UN-ES)': {
        unidade_negocio: 'Espírito Santo (UN-ES)',
        pe: 1.2,
        ex: 1.8
      }
    };

    const placeES: ResolvedPlace = {
      p: 'P58',
      r: 'Espírito Santo (UN-ES)'
    };

    const placeBuziosSemPeso: ResolvedPlace = {
      p: 'P74',
      r: 'Búzios (UN-BUZ)'
    };

    it('Nível 1 (Máxima prioridade): utiliza peso explícito da linha da carteira se presente', () => {
      const carteira: CarteiraEmbarque = {
        id: 'c1',
        matricula: '1001',
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        horas_programadas: 154,
        operacao: 'OP-01',
        pe: 1.1, // Linha específica
        ex: 1.4, // Linha específica
        fonte: 'carteira'
      };

      const weights = resolveUsoffWeights(carteira, placeES, configWithGlobal, unWeights);
      expect(weights.pe).toBe(1.1);
      expect(weights.ex).toBe(1.4);
    });

    it('Nível 2: quando a linha não possui peso, herda o peso da Unidade de Negócio', () => {
      const carteiraSemPeso: CarteiraEmbarque = {
        id: 'c2',
        matricula: '1001',
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        horas_programadas: 154,
        operacao: 'OP-01',
        pe: null,
        ex: null,
        fonte: 'carteira'
      };

      const weights = resolveUsoffWeights(carteiraSemPeso, placeES, configWithGlobal, unWeights);
      expect(weights.pe).toBe(1.2); // Veio da UN
      expect(weights.ex).toBe(1.8); // Veio da UN
    });

    it('Nível 3: quando nem a linha nem a UN possuem peso, utiliza o peso padrão global do contrato', () => {
      const carteiraBuzios: CarteiraEmbarque = {
        id: 'c3',
        matricula: '1001',
        plataforma_sigla: 'P74',
        unidade_negocio: 'Búzios (UN-BUZ)',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        horas_programadas: 154,
        operacao: 'OP-02',
        pe: null,
        ex: null,
        fonte: 'carteira'
      };

      const weights = resolveUsoffWeights(
        carteiraBuzios,
        placeBuziosSemPeso,
        configWithGlobal,
        unWeights
      );
      expect(weights.pe).toBe(1.5); // Global
      expect(weights.ex).toBe(2.0); // Global
    });

    it('Cascata híbrida: pe da linha e ex da UN ou do contrato global', () => {
      const carteiraHibrida: CarteiraEmbarque = {
        id: 'c4',
        matricula: '1001',
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        horas_programadas: 154,
        operacao: 'OP-01',
        pe: 0.9, // Da linha
        ex: null, // Ausente na linha -> pega da UN (1.8)
        fonte: 'carteira'
      };

      const weights = resolveUsoffWeights(
        carteiraHibrida,
        placeES,
        configWithGlobal,
        unWeights
      );
      expect(weights.pe).toBe(0.9);
      expect(weights.ex).toBe(1.8);
    });

    it('Trava: quando nem linha, nem UN, nem global possuem PE/EX, retorna null', () => {
      const configSemGlobal: ContractConfig = {
        ...DEFAULT_CONFIG,
        us_pe_padrao: null,
        us_ex_padrao: null
      };

      const weights = resolveUsoffWeights(
        null,
        placeBuziosSemPeso,
        configSemGlobal,
        {}
      );
      expect(weights.pe).toBeNull();
      expect(weights.ex).toBeNull();
    });
  });

  describe('2. Trava de integridade falta = true e USoff = null', () => {
    it('sinaliza falta = true e USoff = null na operação quando os pesos não estão definidos', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-10',
            horas_programadas: 110,
            operacao: 'OP-FALTA',
            pe: null, // Faltando peso
            ex: null,
            fonte: 'carteira'
          }
        ],
        hhMap: {
          '1001|2026-10-01': {
            matricula: '1001',
            data: '2026-10-01',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 11
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.falta).toBe(true);
      expect(op.us).toBeNull(); // NUNCA computa valor incompleto
      expect(op.peHp).toBe(0);
      expect(op.exHc).toBe(0);
    });

    it('summarizeUsoff propaga falta: totaliza falta > 0 e deixa US total como null', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-10',
            horas_programadas: 110,
            operacao: 'OP-OK',
            pe: 1.0,
            ex: 1.0,
            fonte: 'carteira'
          },
          {
            id: 'c2',
            matricula: '1002',
            plataforma_sigla: 'P74',
            unidade_negocio: 'Búzios (UN-BUZ)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-10',
            horas_programadas: 110,
            operacao: 'OP-PENDENTE',
            pe: null, // Sem peso
            ex: null,
            fonte: 'carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);
      const summary = summarizeUsoff(ops);

      expect(summary.n).toBe(2);
      expect(summary.falta).toBe(1);
      expect(summary.us).toBeNull(); // Trava de integridade global no resumo
    });
  });

  describe('3. Fórmula matemática do USOFF: USoff = (PE * HP) + (EX * HC)', () => {
    it('calcula o valor exato quando todos os pesos e horas estão informados', () => {
      // 10 dias: 01 a 10/10. HP = 110h. Executadas = 5 dias * 10h = 50h
      const hhMap: Record<string, any> = {};
      for (let i = 1; i <= 5; i++) {
        const d = `2026-10-0${i}`;
        hhMap[`1001|${d}`] = {
          matricula: '1001',
          data: d,
          plataforma_sigla: 'P58',
          unidade_negocio: 'Espírito Santo (UN-ES)',
          horas_executadas: 10
        };
      }

      const PE = 1.5;
      const EX = 2.0;
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-10',
            horas_programadas: 110,
            operacao: 'OP-CALC',
            pe: PE,
            ex: EX,
            fonte: 'carteira'
          }
        ],
        hhMap
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.falta).toBe(false);
      expect(op.hp).toBe(110);
      expect(op.hc).toBe(50); // 5 dias * 10h
      // (1.5 * 110) + (2.0 * 50) = 165 + 100 = 265
      expect(op.peHp).toBe(165);
      expect(op.exHc).toBe(100);
      expect(op.us).toBe(265);

      const summary = summarizeUsoff(ops);
      expect(summary.us).toBe(265);
      expect(summary.falta).toBe(0);
    });
  });

  describe('4. Agrupamento de Operações (OP vs EMB vs SEMOP)', () => {
    it('agrupa múltiplos técnicos e embarques sob o mesmo código de operação OP', () => {
      const dataset = createBaseDataset({
        config: {
          ...DEFAULT_CONFIG,
          us_pe_padrao: 1.0,
          us_ex_padrao: 1.0
        },
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-CAMPANHA',
            pe: 1.0,
            ex: 1.0,
            fonte: 'carteira'
          },
          {
            id: 'c2',
            matricula: '1002',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-05',
            data_fim: '2026-10-18',
            horas_programadas: 154,
            operacao: 'OP-CAMPANHA',
            pe: 1.0,
            ex: 1.0,
            fonte: 'carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      // Deve agrupar em apenas 1 linha sob key "op:OP-CAMPANHA"
      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.key).toBe('op:OP-CAMPANHA');
      expect(op.tipo).toBe('Operação');
      expect(op.mats.size).toBe(2);
      expect(op.mats.has('1001')).toBe(true);
      expect(op.mats.has('1002')).toBe(true);
      expect(op.hp).toBe(308); // 154 + 154
    });

    it('cria entradas separadas de tipo "Embarque" para registros sem código de operação', () => {
      const dataset = createBaseDataset({
        config: {
          ...DEFAULT_CONFIG,
          us_pe_padrao: 1.0,
          us_ex_padrao: 1.0
        },
        carteira: [
          {
            id: 'emb-sem-op-1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: '', // Sem operação
            pe: 1.0,
            ex: 1.0,
            fonte: 'carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.key).toBe('emb:emb-sem-op-1');
      expect(op.tipo).toBe('Embarque');
    });

    it('inclui apontamentos avulsos de tipo "Sem programação" quando med_criterio !== "enc"', () => {
      const dataset = createBaseDataset({
        config: {
          ...DEFAULT_CONFIG,
          med_criterio: 'dias', // Modo dias processa sem programação
          us_pe_padrao: 1.0,
          us_ex_padrao: 1.0
        },
        carteira: [], // Sem carteira
        hhMap: {
          '1001|2026-10-05': {
            matricula: '1001',
            data: '2026-10-05',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 11
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.tipo).toBe('Sem programação');
      expect(op.key).toBe('sp:1001_P58');
      expect(op.hp).toBe(0);
      expect(op.hc).toBe(11);
    });
  });

  describe('5. Operações Compartilhadas entre Carteiras (sharedAcrossPortfolios)', () => {
    it('marca sharedAcrossPortfolios = true quando a operação está presente em dataset.sharedOpsSet', () => {
      const dataset = createBaseDataset({
        config: {
          ...DEFAULT_CONFIG,
          us_pe_padrao: 1.0,
          us_ex_padrao: 1.0
        },
        sharedOpsSet: new Set(['OP-COMPARTILHADA']),
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-COMPARTILHADA',
            pe: 1.0,
            ex: 1.0,
            fonte: 'carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops[0].sharedAcrossPortfolios).toBe(true);
    });

    it('mantém sharedAcrossPortfolios = false quando a operação não está compartilhada', () => {
      const dataset = createBaseDataset({
        config: {
          ...DEFAULT_CONFIG,
          us_pe_padrao: 1.0,
          us_ex_padrao: 1.0
        },
        sharedOpsSet: new Set(['OUTRA-OP']),
        carteira: [
          {
            id: 'c1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            operacao: 'OP-LOCAL',
            pe: 1.0,
            ex: 1.0,
            fonte: 'carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops[0].sharedAcrossPortfolios).toBe(false);
    });
  });

  describe('6. Regra dos 12 dias no USOFF (Carteira vs Fora da Carteira)', () => {
    it('incide PE exclusivamente sobre horas de Carteira (>= 12 dias) e remunera todas as horas executadas por EX', () => {
      // Embarque de 14 dias:
      // - Total programado: 96h
      // - Carteira (>= 12 dias): 72h
      // - Fora da carteira (< 12 dias): 24h
      // - Horas executadas (HC): 100h
      // - PE = 1.5, EX = 2.0
      // Esperado:
      // peHp = 1.5 * 72 = 108 (NÃO 1.5 * 96 = 144)
      // exHc = 2.0 * 100 = 200
      // USoff = 108 + 200 = 308
      const hhMap: Record<string, any> = {};
      for (let day = 1; day <= 10; day++) {
        const dStr = day < 10 ? `0${day}` : `${day}`;
        hhMap[`1001|2026-10-${dStr}`] = {
          matricula: '1001',
          data: `2026-10-${dStr}`,
          plataforma_sigla: 'P58',
          unidade_negocio: 'Espírito Santo (UN-ES)',
          horas_executadas: 10
        };
      }

      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c-12dias',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 96,
            hh_carteira: 72,
            hh_fora_carteira: 24,
            operacao: 'OP-12DIAS',
            pe: 1.5,
            ex: 2.0,
            fonte: 'carteira'
          }
        ],
        hhMap
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.hp).toBe(96);
      expect(op.hpCarteira).toBe(72);
      expect(op.hpForaCarteira).toBe(24);
      expect(op.hc).toBe(100);

      // Ponderação estrita: PE * 72 e EX * 100
      expect(op.peHp).toBe(108);
      expect(op.exHc).toBe(200);
      expect(op.us).toBe(308);

      const summary = summarizeUsoff(ops);
      expect(summary.hp).toBe(96);
      expect(summary.hpCarteira).toBe(72);
      expect(summary.hpForaCarteira).toBe(24);
      expect(summary.peHp).toBe(108);
      expect(summary.exHc).toBe(200);
      expect(summary.us).toBe(308);
    });

    it('caso de técnico com 100% Fora da carteira (ex: Alexandre com 4h fora da carteira e 110h executadas no SAP)', () => {
      // Quando hh_carteira = 0 e hh_fora_carteira = 4:
      // PE * 0 = 0
      // EX * 110 = 220 (com EX = 2.0)
      // USoff = 220
      const hhMap: Record<string, any> = {};
      for (let day = 1; day <= 10; day++) {
        const dStr = day < 10 ? `0${day}` : `${day}`;
        hhMap[`1001|2026-10-${dStr}`] = {
          matricula: '1001',
          data: `2026-10-${dStr}`,
          plataforma_sigla: 'P58',
          unidade_negocio: 'Espírito Santo (UN-ES)',
          horas_executadas: 11
        };
      }

      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c-alexandre',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 4,
            hh_carteira: 0,
            hh_fora_carteira: 4,
            operacao: 'OP-ALEXANDRE',
            pe: 1.5,
            ex: 2.0,
            fonte: 'carteira'
          }
        ],
        hhMap
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.hp).toBe(4);
      expect(op.hpCarteira).toBe(0);
      expect(op.hpForaCarteira).toBe(4);
      expect(op.hc).toBe(110);

      // PE não pontua porque foi programado com < 12 dias
      expect(op.peHp).toBe(0);
      // EX remunera integralmente a execução a bordo
      expect(op.exHc).toBe(220);
      expect(op.us).toBe(220);
    });

    it('fallback retrocompatível para registros legados onde hh_carteira não foi preenchido', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c-leg',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            // hh_carteira ausente
            operacao: 'OP-LEGACY',
            pe: 1.0,
            ex: 1.0,
            fonte: 'carteira'
          }
        ],
        hhMap: {
          '1001|2026-10-01': {
            matricula: '1001',
            data: '2026-10-01',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 11
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops[0].peHp).toBe(154);
      expect(ops[0].exHc).toBe(11);
      expect(ops[0].us).toBe(165);
    });

    it('med_criterio = "dias": proporcionaliza calcHpCarteiraInInterval e calcHpForaCarteiraInInterval em embarque cruzando fronteira [P.ini, P.fim]', () => {
      // Embarque de 14 dias (2026-09-14 a 2026-09-27): 7 dias fora e 7 dias dentro de basePeriod [2026-09-21, 2026-10-20] (50%)
      const crossingEmb: CarteiraEmbarque = {
        id: 'c-cross-dias',
        matricula: '1001',
        plataforma_sigla: 'P58',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        data_inicio: '2026-09-14',
        data_fim: '2026-09-27',
        horas_programadas: 140,
        hh_carteira: 100,
        hh_fora_carteira: 40,
        operacao: 'OP-CROSS-DIAS',
        pe: 1.5,
        ex: 2.0,
        fonte: 'portal_offshore'
      };

      const diasConfig: ContractConfig = {
        ...DEFAULT_CONFIG,
        med_criterio: 'dias',
        hh_dia: 11
      };

      // Teste unitário direto dos intervalos proporcionalizados (7 de 14 dias = 50%)
      expect(calcHpCarteiraInInterval(crossingEmb, '2026-09-21', '2026-09-27', diasConfig)).toBeCloseTo(50, 5);
      expect(calcHpForaCarteiraInInterval(crossingEmb, '2026-09-21', '2026-09-27')).toBeCloseTo(20, 5);
      // Intervalo invertido a > b retorna 0
      expect(calcHpCarteiraInInterval(crossingEmb, '2026-09-28', '2026-09-21', diasConfig)).toBe(0);
      expect(calcHpForaCarteiraInInterval(crossingEmb, '2026-09-28', '2026-09-21')).toBe(0);

      const dataset = createBaseDataset({
        config: diasConfig,
        carteira: [crossingEmb],
        hhMap: {
          '1001|2026-09-15': {
            matricula: '1001',
            data: '2026-09-15', // Fora da janela [2026-09-21, 2026-10-20], deve ser ignorado em med_criterio = 'dias'
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 12
          },
          '1001|2026-09-22': {
            matricula: '1001',
            data: '2026-09-22', // Dentro da janela
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 10
          },
          '1001|2026-09-23': {
            matricula: '1001',
            data: '2026-09-23', // Dentro da janela
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 12
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.ini).toBe('2026-09-21');
      expect(op.fim).toBe('2026-09-27');
      expect(op.dias).toBe(7);
      expect(op.hp).toBeCloseTo(70, 5); // 50% de 140
      expect(op.hpCarteira).toBeCloseTo(50, 5); // 50% de 100
      expect(op.hpForaCarteira).toBeCloseTo(20, 5); // 50% de 40
      expect(op.hc).toBe(22); // Somente 22/09 (10h) + 23/09 (12h)
      // PE incide apenas sobre hpCarteira proporcionalizado (50 * 1.5 = 75)
      expect(op.peHp).toBeCloseTo(75, 5);
      // EX incide sobre HC executado no período (22 * 2.0 = 44)
      expect(op.exHc).toBeCloseTo(44, 5);
      expect(op.us).toBeCloseTo(119, 5);
    });

    it('OP compartilhada por múltiplos técnicos (Carteira + Fora da carteira + sharedOpsSet)', () => {
      const dataset = createBaseDataset({
        sharedOpsSet: new Set(['OP-MULTI-TECH']),
        carteira: [
          {
            id: 'c-multi-1',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-10',
            horas_programadas: 110,
            hh_carteira: 80,
            hh_fora_carteira: 30,
            operacao: 'OP-MULTI-TECH',
            pe: 1.2,
            ex: 1.5,
            fonte: 'portal_offshore'
          },
          {
            id: 'c-multi-2',
            matricula: '1002',
            plataforma_sigla: 'P74',
            unidade_negocio: 'Búzios (UN-BUZ)',
            data_inicio: '2026-10-05',
            data_fim: '2026-10-14',
            horas_programadas: 60,
            hh_carteira: 0,
            hh_fora_carteira: 60, // Técnico 2 entrou com < 12 dias (100% fora da carteira)
            operacao: 'OP-MULTI-TECH',
            pe: 1.2,
            ex: 1.5,
            fonte: 'portal_offshore'
          }
        ],
        hhMap: {
          '1001|2026-10-02': {
            matricula: '1001',
            data: '2026-10-02',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 10
          },
          '1002|2026-10-06': {
            matricula: '1002',
            data: '2026-10-06',
            plataforma_sigla: 'P74',
            unidade_negocio: 'Búzios (UN-BUZ)',
            horas_executadas: 12
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.mats.size).toBe(2);
      expect(op.plats.has('P58')).toBe(true);
      expect(op.plats.has('P74')).toBe(true);
      expect(op.sharedAcrossPortfolios).toBe(true);
      expect(op.hp).toBe(170); // 110 + 60
      expect(op.hpCarteira).toBe(80); // 80 + 0
      expect(op.hpForaCarteira).toBe(90); // 30 + 60
      expect(op.hc).toBe(22); // 10 + 12
      expect(op.peHp).toBeCloseTo(80 * 1.2, 5); // 96
      expect(op.exHc).toBeCloseTo(22 * 1.5, 5); // 33
      expect(op.us).toBeCloseTo(129, 5);

      const summary = summarizeUsoff(ops);
      expect(summary.hp).toBe(170);
      expect(summary.hpCarteira).toBe(80);
      expect(summary.hpForaCarteira).toBe(90);
      expect(summary.us).toBeCloseTo(129, 5);
    });

    it('fallback legado (hh_carteira === undefined) em med_criterio = "dias" proporcionaliza HP integral na fronteira', () => {
      const diasConfig: ContractConfig = {
        ...DEFAULT_CONFIG,
        med_criterio: 'dias',
        hh_dia: 11
      };

      const dataset = createBaseDataset({
        config: diasConfig,
        carteira: [
          {
            id: 'c-leg-dias',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-16',
            data_fim: '2026-10-25', // 10 dias totais, 5 dias dentro de [2026-09-21, 2026-10-20]
            horas_programadas: 110,
            // hh_carteira === undefined (legado)
            operacao: 'OP-LEG-DIAS',
            pe: 1.0,
            ex: 1.5,
            fonte: 'carteira'
          }
        ],
        hhMap: {
          '1001|2026-10-18': {
            matricula: '1001',
            data: '2026-10-18',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 10
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.hp).toBeCloseTo(55, 5); // 5 de 10 dias = 55h
      expect(op.hpCarteira).toBeCloseTo(55, 5); // Fallback integral para hp
      expect(op.hpForaCarteira).toBe(0);
      expect(op.peHp).toBeCloseTo(55, 5);
      expect(op.exHc).toBeCloseTo(15, 5);
      expect(op.us).toBeCloseTo(70, 5);
    });
  });

  describe('7. Novas Regras de USOFF: Validação por Operação, Trava de Execução Zero, Gangway e Diária', () => {
    it('operação sem execução confirmada (HC = 0) e sem gangway tem USOFF = 0 (peHp = 0, exHc = 0, us = 0)', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c-zero-exec',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            hh_carteira: 154,
            hh_fora_carteira: 0,
            operacao: 'OP-ZERO',
            pe: 0.30,
            ex: 0.70,
            fonte: 'carteira'
          }
        ],
        hhMap: {} // Zero horas executadas
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.hc).toBe(0);
      expect(op.peHp).toBe(0);
      expect(op.exHc).toBe(0);
      expect(op.us).toBe(0); // Não calcula USOFF sem execução confirmada
    });

    it('operação com HC = 0 mas com anotação de Gangway desconectada recebe 30% da programação', () => {
      const dataset = createBaseDataset({
        carteira: [
          {
            id: 'c-gw',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 100,
            hh_carteira: 100,
            hh_fora_carteira: 0,
            operacao: 'OP-GW',
            pe: 0.30,
            ex: 0.70,
            fonte: 'carteira'
          }
        ],
        hhMap: {}, // Zero horas executadas
        justMap: {
          '1001|2026-10-05': {
            matricula: '1001',
            data: '2026-10-05',
            motivo: 'Gangway desconectada',
            horas_gangway: 11,
            descricao: 'Mar revolto',
            responsavel_nome: 'Fiscal'
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.hc).toBe(0);
      // Recebe 30% da programação: 0.30 * 100 = 30
      expect(op.peHp).toBe(30);
      expect(op.exHc).toBe(0);
      expect(op.us).toBe(30);
    });

    it('unidade classificada por diária (ex: UMS UMAC afretada) calcula USOFF = (dias + 1) * 10', () => {
      const umsCatalog = {
        ...createBaseDataset().plataformas,
        UMAC: {
          sigla: 'UMAC',
          chave_norm: 'umac',
          nome: 'UMS Cidade de Macaé',
          un: 'Armador',
          armador: 'GranEnergia',
          gerencia: 'UO-BC',
          tipo: 'UMS',
          situacao: 'Mobilizada',
          cadastro_pendente: false
        }
      };

      const dataset = createBaseDataset({
        plataformas: umsCatalog,
        carteira: [
          {
            id: 'c-diaria',
            matricula: '1001',
            plataforma_sigla: 'UMAC',
            unidade_negocio: 'Armador',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14', // 14 dias
            horas_programadas: 0,
            operacao: 'OP-DIARIA',
            pe: null,
            ex: null,
            fonte: 'carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      // 14 dias: (14 + 1) * 10 = 150
      expect(op.dias).toBe(14);
      expect(op.us).toBe(150);
      expect(op.falta).toBe(false);
      expect(op.fonte).toBe('Diária (Armador)');
    });

    it('processamento granular com carteiraOperacoes e confirmacoesSap: avalia cada tupla ordem/operação individualmente', () => {
      const dataset = createBaseDataset({
        config: {
          ...DEFAULT_CONFIG,
          us_pe_padrao: 0.30,
          us_ex_padrao: 0.70
        },
        carteira: [
          {
            id: 'c-gran',
            id_embarque: '55001',
            matricula: '1001',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 130,
            hh_carteira: 130,
            hh_fora_carteira: 0,
            operacao: '',
            pe: 0.30,
            ex: 0.70,
            fonte: 'carteira'
          }
        ],
        carteiraOperacoes: [
          {
            id: 'co-1',
            portal_id: '55001',
            id_embarque: '55001',
            matricula: '1001',
            chave_petrobras: '',
            nome: 'Técnico Um',
            empresa: 'Infotec Brasil',
            estrutura: '',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            plataforma_sigla: 'P58',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: 'ORD-1000',
            operacao: 'OP-EXEC',
            status_processamento: 'Concluído',
            prioridade: 'Regular',
            status_programacao: 'Carteira',
            hh_programado: 10,
            hh_confirmado: 10,
            hh_confirmado_sap: 10,
            divergencia_sap: 0,
            status_divergencia: 'OK',
            recursos: 1,
            fonte: 'portal'
          },
          {
            id: 'co-2',
            portal_id: '55001',
            id_embarque: '55001',
            matricula: '1001',
            chave_petrobras: '',
            nome: 'Técnico Um',
            empresa: 'Infotec Brasil',
            estrutura: '',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            plataforma_sigla: 'P58',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: 'ORD-2000',
            operacao: 'OP-NAO-EXEC',
            status_processamento: 'Pendente',
            prioridade: 'Regular',
            status_programacao: 'Carteira',
            hh_programado: 120,
            hh_confirmado: 0,
            hh_confirmado_sap: 0,
            divergencia_sap: 0,
            status_divergencia: 'Não Confirmado',
            recursos: 1,
            fonte: 'portal'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx);

      // Duas operações granularizadas
      expect(ops).toHaveLength(2);

      const opExec = ops.find(o => o.op === 'OP-EXEC');
      expect(opExec).toBeDefined();
      expect(opExec!.hc).toBe(10);
      // Carteira com execução: 0.30 * 10 + 0.70 * 10 = 3 + 7 = 10
      expect(opExec!.peHp).toBe(3);
      expect(opExec!.exHc).toBe(7);
      expect(opExec!.us).toBe(10);

      const opNaoExec = ops.find(o => o.op === 'OP-NAO-EXEC');
      expect(opNaoExec).toBeDefined();
      expect(opNaoExec!.hc).toBe(0);
      // Execução zero sem gangway: não pontua USOFF mesmo com 120h programadas!
      expect(opNaoExec!.peHp).toBe(0);
      expect(opNaoExec!.exHc).toBe(0);
      expect(opNaoExec!.us).toBe(0);

      // Total de USOFF reflete estritamente a soma das operações individuais
      const summary = summarizeUsoff(ops);
      expect(summary.us).toBe(10); // Apenas a operação executada pontuou!
    });
  });

  describe('10. Agrupamento por Embarque / ID de Embarque (groupBy: "embarque")', () => {
    it('consolida múltiplas operações de um mesmo embarque sem inflar dias e preservando a trava de execução zero', () => {
      const dataset = createBaseDataset({
        config: {
          ...DEFAULT_CONFIG,
          us_pe_padrao: 0.30,
          us_ex_padrao: 0.70
        },
        carteira: [
          {
            id: 'cart-emb-55104',
            id_embarque: '55104',
            matricula: '1001',
            operacao: '',
            pe: null,
            ex: null,
            fonte: 'portal',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 130
          }
        ],
        carteiraOperacoes: [
          {
            id: 'op-1',
            portal_id: '55104',
            id_embarque: '55104',
            matricula: '1001',
            chave_petrobras: '',
            nome: 'Técnico Um',
            empresa: 'Infotec Brasil',
            estrutura: '',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: 'ORD-1000',
            operacao: 'OP-EXEC',
            status_processamento: 'Pendente',
            prioridade: 'Regular',
            status_programacao: 'Carteira',
            hh_programado: 10,
            hh_confirmado: 10,
            hh_confirmado_sap: 10,
            divergencia_sap: 0,
            status_divergencia: 'OK',
            recursos: 1,
            fonte: 'portal'
          },
          {
            id: 'op-2',
            portal_id: '55104',
            id_embarque: '55104',
            matricula: '1001',
            chave_petrobras: '',
            nome: 'Técnico Um',
            empresa: 'Infotec Brasil',
            estrutura: '',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: 'ORD-2000',
            operacao: 'OP-NAO-EXEC',
            status_processamento: 'Pendente',
            prioridade: 'Regular',
            status_programacao: 'Carteira',
            hh_programado: 120,
            hh_confirmado: 0,
            hh_confirmado_sap: 0,
            divergencia_sap: 0,
            status_divergencia: 'Não Confirmado',
            recursos: 1,
            fonte: 'portal'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);

      // 1. Agrupamento padrão por operação
      const ops = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx, 'operacao');
      expect(ops).toHaveLength(2);

      // 2. Agrupamento por embarque
      const embarques = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx, 'embarque');
      expect(embarques).toHaveLength(1);

      const emb = embarques[0];
      expect(emb.key).toBe('emb:55104');
      expect(emb.id_embarque).toBe('55104');
      expect(emb.op).toBe('ID 55104');
      expect(emb.tipo).toBe('Embarque');
      expect(emb.totalOps).toBe(2);

      // Não infla dias (14 dias físicos, não 28)
      expect(emb.dias).toBe(14);
      // HD = 14 * 11 = 154 horas
      expect(emb.hd).toBe(154);

      // Horas programadas e confirmadas consolidadas
      expect(emb.hp).toBe(130);
      expect(emb.hpCarteira).toBe(130);
      expect(emb.hc).toBe(10);

      // Trava de execução zero avaliada operação por operação e somada:
      // OP-EXEC: 0.30 * 10 + 0.70 * 10 = 3 + 7 = 10
      // OP-NAO-EXEC: 0 (HC = 0)
      expect(emb.peHp).toBe(3);
      expect(emb.exHc).toBe(7);
      expect(emb.us).toBe(10);

      const summary = summarizeUsoff(embarques);
      expect(summary.n).toBe(1);
      expect(summary.us).toBe(10);
      expect(summary.hp).toBe(130);
      expect(summary.hc).toBe(10);
    });

    it('aplica a fórmula de diária (dias + 1) * 10 uma única vez por embarque mesmo com múltiplas operações', () => {
      const dataset = createBaseDataset({
        plataformas: {
          HFAB: {
            sigla: 'HFAB',
            chave_norm: 'hfab',
            nome: 'B/A Far Saga',
            un: 'Armador',
            armador: 'Farstad',
            gerencia: '',
            tipo: 'AHTS',
            situacao: 'Mobilizada',
            cadastro_pendente: false
          }
        },
        carteira: [
          {
            id: 'cart-armador-1',
            id_embarque: '56299',
            matricula: '1002',
            operacao: '',
            pe: null,
            ex: null,
            fonte: 'portal',
            plataforma_sigla: 'HFAB',
            unidade_negocio: 'Armador',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-07',
            horas_programadas: 0
          }
        ],
        carteiraOperacoes: [
          {
            id: 'op-arm-1',
            portal_id: '56299',
            id_embarque: '56299',
            matricula: '1002',
            chave_petrobras: '',
            nome: 'Técnico Dois',
            empresa: 'Infotec Brasil',
            estrutura: '',
            plataforma_sigla: 'HFAB',
            unidade_negocio: 'Armador',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-07',
            ordem: 'ORD-ARM-1',
            operacao: 'OP-1',
            status_processamento: 'Pendente',
            prioridade: 'Regular',
            status_programacao: 'Fora da carteira',
            hh_programado: 0,
            hh_confirmado: 50,
            hh_confirmado_sap: 50,
            divergencia_sap: 0,
            status_divergencia: 'OK',
            recursos: 1,
            fonte: 'portal'
          },
          {
            id: 'op-arm-2',
            portal_id: '56299',
            id_embarque: '56299',
            matricula: '1002',
            chave_petrobras: '',
            nome: 'Técnico Dois',
            empresa: 'Infotec Brasil',
            estrutura: '',
            plataforma_sigla: 'HFAB',
            unidade_negocio: 'Armador',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-07',
            ordem: 'ORD-ARM-2',
            operacao: 'OP-2',
            status_processamento: 'Pendente',
            prioridade: 'Regular',
            status_programacao: 'Fora da carteira',
            hh_programado: 0,
            hh_confirmado: 20,
            hh_confirmado_sap: 20,
            divergencia_sap: 0,
            status_divergencia: 'OK',
            recursos: 1,
            fonte: 'portal'
          }
        ]
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const embarques = computeUsoffOperations(basePeriod, dataset, emptyFilters, pidx, 'embarque');

      expect(embarques).toHaveLength(1);
      const emb = embarques[0];
      expect(emb.id_embarque).toBe('56299');
      expect(emb.dias).toBe(7); // 1 a 7 de outubro = 7 dias
      // Fórmula diária: (7 + 1) * 10 = 80
      expect(emb.exHc).toBe(80);
      expect(emb.peHp).toBe(0);
      expect(emb.us).toBe(80);
    });
  });
});
