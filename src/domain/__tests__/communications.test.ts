import { describe, expect, it } from 'vitest';
import type {
  AppDataset,
  CarteiraEmbarque,
  FilterState,
  PeriodWindow,
  Pessoa,
  Plataforma
} from '../types';
import { DEFAULT_CONFIG } from '../../config/constants';
import {
  buildCobrancaDetailsText,
  buildCobrancaListText,
  buildCobrancaMailPayload,
  buildDailyAlertText,
  buildDailyMailPayload,
  buildMailLinks
} from '../communications';
import { buildPlatformIndex } from '../calculations';

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
    prepES: {
      id: 'prepES',
      slug: 'preposto-es',
      nome: 'João Preposto ES',
      papel: 'preposto',
      email: 'joao.es@infotec.com.br',
      user_id: null,
      plats: ['P58'],
      uns: ['Espírito Santo (UN-ES)']
    },
    prepBUZ: {
      id: 'prepBUZ',
      slug: 'preposto-buz',
      nome: 'Maria Preposta Buzios',
      papel: 'preposto',
      email: 'maria.buz@infotec.com.br',
      user_id: null,
      plats: ['P74'],
      uns: ['Búzios (UN-BUZ)']
    },
    gestorContrato: {
      id: 'gestorContrato',
      slug: 'gestor-contrato',
      nome: 'Carlos Gestor',
      papel: 'gestor',
      email: 'carlos.gestor@infotec.com.br',
      user_id: null,
      plats: [],
      uns: ['Espírito Santo (UN-ES)', 'Búzios (UN-BUZ)']
    }
  },
  profiles: {},
  tecnicos: {
    '1001': { matricula: '1001', nome: 'Técnico Um', funcao: 'Automação' },
    '1002': { matricula: '1002', nome: 'Técnico Dois', funcao: 'Instrumentação' },
    '1003': { matricula: '1003', nome: 'Técnico Três', funcao: 'Elétrica' }
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

describe('src/domain/communications.ts - Geração de Comunicações, Links de E-mail & Cobranças', () => {
  describe('1. buildMailLinks (Desktop mailto vs Outlook Web deep link)', () => {
    it('gera links válidos para cliente desktop (mailto:) e web (Outlook Web)', () => {
      const to = ['preposto@infotec.com.br', 'gestor@infotec.com.br'];
      const subject = 'HH Offshore · P-58 · 15/10/2026 · favor justificar';
      const body = 'Prezados,\nFavor registrar justificativa.\nAtenciosamente.';

      const links = buildMailLinks(to, subject, body);

      // mailtoUrl deve unir destinatários com vírgula e codificar assunto/corpo
      expect(links.mailtoUrl).toContain('mailto:preposto@infotec.com.br,gestor@infotec.com.br?');
      expect(links.mailtoUrl).toContain('subject=' + encodeURIComponent(subject));
      expect(links.mailtoUrl).toContain('body=' + encodeURIComponent(body));

      // outlookWebUrl deve usar o deeplink oficial do Office 365
      expect(links.outlookWebUrl).toContain('https://outlook.office.com/mail/deeplink/compose?');
      expect(links.outlookWebUrl).toContain('to=' + encodeURIComponent('preposto@infotec.com.br,gestor@infotec.com.br'));
      expect(links.outlookWebUrl).toContain('subject=' + encodeURIComponent(subject));
      expect(links.outlookWebUrl).toContain('body=' + encodeURIComponent(body));
    });

    it('aceita string única de destinatários separada por ponto-e-vírgula ou espaços', () => {
      const toStr = 'contato1@infotec.com.br; contato2@infotec.com.br, contato3@infotec.com.br';
      const links = buildMailLinks(toStr, 'Assunto Teste', 'Corpo Teste');

      expect(links.mailtoUrl).toContain('mailto:contato1@infotec.com.br,contato2@infotec.com.br,contato3@infotec.com.br');
      expect(links.outlookWebUrl).toContain('to=' + encodeURIComponent('contato1@infotec.com.br,contato2@infotec.com.br,contato3@infotec.com.br'));
    });

    it('codifica devidamente caracteres especiais, quebras de linha e acentuação pt-BR', () => {
      const subject = 'Atenção: Medição & Operação P-58 / Espírito Santo';
      const body = 'Linha 1\nLinha 2 com caracteres: á, é, í, ó, ú, ç, ã, õ, & % $';

      const links = buildMailLinks(['teste@infotec.com.br'], subject, body);

      expect(links.mailtoUrl).not.toContain('\n');
      expect(links.mailtoUrl).not.toContain('Espírito'); // deve estar percent-encoded
      expect(decodeURIComponent(links.mailtoUrl)).toContain(subject);
      expect(decodeURIComponent(links.mailtoUrl)).toContain(body);
    });
  });

  describe('2. buildDailyMailPayload (Alerta Diário de Déficit de Horas)', () => {
    it('filtra técnicos com déficit de horas no dia e gera assunto e corpo estruturados', () => {
      const dateIso = '2026-10-15';
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
          // Técnico 1001 realizou apenas 6 horas de 11 disponíveis (DÉFICIT)
          '1001|2026-10-15': {
            matricula: '1001',
            data: '2026-10-15',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 6
          },
          // Técnico 1002 realizou 11 horas (META BATIDA -> NÃO DEVE ENTRAR NO E-MAIL)
          '1002|2026-10-15': {
            matricula: '1002',
            data: '2026-10-15',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 11
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const payload = buildDailyMailPayload(dateIso, ['P58'], dataset, pidx, 'Gestão Operacional');

      // Verifica lista de linhas com déficit
      expect(payload.rows).toHaveLength(1);
      expect(payload.rows[0].mat).toBe('1001');
      expect(payload.rows[0].e).toBe(6);
      expect(payload.rows[0].d).toBe(11);

      // Assunto
      expect(payload.subj).toBe('HH Offshore · P58 · 15/10/2026 · favor justificar');

      // Corpo
      expect(payload.body).toContain('Em 15/10/2026, os técnicos abaixo não executaram as 11,0 h disponíveis do dia');
      expect(payload.body).toContain('Técnico Um (mat. 1001): 6,0 h de 11,0 h (55%)');
      expect(payload.body).toContain('Gestão Operacional');
      expect(payload.body).toContain('Infotec Brasil');

      // Destinatários: deve incluir João Preposto ES e Carlos Gestor que respondem por P58 / UN-ES
      expect(payload.to).toContain('joao.es@infotec.com.br');
      expect(payload.to).toContain('carlos.gestor@infotec.com.br');
      expect(payload.to).not.toContain('maria.buz@infotec.com.br');
    });

    it('emite mensagem informando que não há técnicos com déficit quando todos cumprem a meta', () => {
      const dateIso = '2026-10-15';
      const dataset = createBaseDataset({
        hhMap: {
          '1001|2026-10-15': {
            matricula: '1001',
            data: '2026-10-15',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 11
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const payload = buildDailyMailPayload(dateIso, ['P58'], dataset, pidx);

      expect(payload.rows).toHaveLength(0);
      expect(payload.body).toContain('Não há técnico abaixo das horas disponíveis nessas plataformas neste dia.');
    });

    it('identifica técnico com falta total ("Não chegou" / sem: true)', () => {
      const dateIso = '2026-10-15';
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
        hhMap: {} // Nenhum HH apontado -> gera "Não chegou"
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const payload = buildDailyMailPayload(dateIso, ['P58'], dataset, pidx);

      expect(payload.rows).toHaveLength(1);
      expect(payload.rows[0].sem).toBe(true);
      expect(payload.body).toContain('sem HH executado informado');
    });
  });

  describe('3. buildCobrancaMailPayload & buildCobrancaDetailsText (Cobrança de Justificativas)', () => {
    const period: PeriodWindow = {
      ini: '2026-09-21',
      fim: '2026-10-20',
      m: '2026-10'
    };

    it('gera cobrança filtrada para um preposto específico (target = Pessoa)', () => {
      const dataset = createBaseDataset({
        hhMap: {
          // Pendência em P58 (sob responsabilidade de prepES)
          '1001|2026-10-01': {
            matricula: '1001',
            data: '2026-10-01',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 5
          },
          // Pendência em P74 (sob responsabilidade de prepBUZ)
          '1002|2026-10-02': {
            matricula: '1002',
            data: '2026-10-02',
            plataforma_sigla: 'P74',
            unidade_negocio: 'Búzios (UN-BUZ)',
            horas_executadas: 4
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const prepES = dataset.pessoas.prepES;

      const payload = buildCobrancaMailPayload(prepES, period, dataset, pidx, 'Controladoria', '2026-10-15');

      expect(payload.ppl).toHaveLength(1);
      expect(payload.ppl[0].id).toBe('prepES');
      expect(payload.to).toEqual(['joao.es@infotec.com.br']);
      expect(payload.pendentesCount).toBe(1); // Apenas a pendência de P58
      expect(payload.body).toContain('Prezado(a) João');
      expect(payload.body).toContain('P58');
      expect(payload.body).not.toContain('P74');
      expect(payload.body).toContain('Controladoria');
    });

    it('gera cobrança consolidada para todos os prepostos (target = "*")', () => {
      const dataset = createBaseDataset({
        hhMap: {
          '1001|2026-10-01': {
            matricula: '1001',
            data: '2026-10-01',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 5
          },
          '1002|2026-10-02': {
            matricula: '1002',
            data: '2026-10-02',
            plataforma_sigla: 'P74',
            unidade_negocio: 'Búzios (UN-BUZ)',
            horas_executadas: 4
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const payload = buildCobrancaMailPayload('*', period, dataset, pidx, 'Gestor Geral', '2026-10-15');

      expect(payload.ppl.length).toBeGreaterThanOrEqual(2);
      expect(payload.to).toContain('joao.es@infotec.com.br');
      expect(payload.to).toContain('maria.buz@infotec.com.br');
      expect(payload.pendentesCount).toBe(2);
      expect(payload.body).toContain('Prezados');
      expect(payload.body).toContain('João Preposto ES');
      expect(payload.body).toContain('Maria Preposta Buzios');
    });

    it('calcula corretamente pendências com prazo vencido e dias de atraso', () => {
      const dataset = createBaseDataset({
        config: {
          ...DEFAULT_CONFIG,
          prazo_justificativa_dias: 2
        },
        hhMap: {
          // Pendência de 2026-10-01. Prazo = 2026-10-03.
          // Na data ref 2026-10-15, está vencida há 12 dias!
          '1001|2026-10-01': {
            matricula: '1001',
            data: '2026-10-01',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 0
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const payload = buildCobrancaMailPayload(
        dataset.pessoas.prepES,
        period,
        dataset,
        pidx,
        'Gestão',
        '2026-10-15'
      );

      expect(payload.pendentesCount).toBe(1);
      expect(payload.vencidosCount).toBe(1);
      expect(payload.body).toContain('1 já com prazo vencido');
      expect(payload.body).toContain('vencido há 12 dias');
    });
  });

  describe('4. buildCobrancaListText & buildDailyAlertText', () => {
    const period: PeriodWindow = {
      ini: '2026-09-21',
      fim: '2026-10-20',
      m: '2026-10'
    };

    it('buildCobrancaListText gera resumo textual de pendências por preposto', () => {
      const dataset = createBaseDataset({
        hhMap: {
          '1001|2026-10-01': {
            matricula: '1001',
            data: '2026-10-01',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 4
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const text = buildCobrancaListText(period, dataset, pidx, '2026-10-15');

      expect(text).toContain('Cobrança de justificativas · HH Offshore');
      expect(text).toContain('Período: 21/09/2026 a 20/10/2026');
      expect(text).toContain('João Preposto ES (Preposto)');
      expect(text).toContain('1 pendentes');
    });

    it('buildDailyAlertText consolida percentuais por unidade regional e plataforma', () => {
      const dateIso = '2026-10-15';
      const dataset = createBaseDataset({
        hhMap: {
          '1001|2026-10-15': {
            matricula: '1001',
            data: '2026-10-15',
            plataforma_sigla: 'P58',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            horas_executadas: 5.5 // 50%
          }
        }
      });

      const pidx = buildPlatformIndex(dataset.plataformas);
      const emptyFilters: FilterState = {
        fDate: '',
        fReg: '',
        fPlat: '',
        fResp: '',
        fPer: '',
        cIni: '',
        cFim: ''
      };

      const alertText = buildDailyAlertText(dateIso, dataset, emptyFilters, pidx);

      expect(alertText).toContain('Alerta de HH Offshore · 15/10/2026');
      expect(alertText).toContain('Meta: 100% das horas disponíveis');
      expect(alertText).toContain('Espírito Santo (UN-ES)');
      expect(alertText).toContain('P58');
      expect(alertText).toContain('Técnico Um (P58): 5,5 h de 11,0 h, 50% no dia');
      expect(alertText).toContain('FAVOR JUSTIFICAR');
    });
  });
});
