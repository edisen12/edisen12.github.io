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
import { buildPlatformIndex } from '../calculations';

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
});
