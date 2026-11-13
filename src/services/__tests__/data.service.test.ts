import { describe, expect, it, beforeEach, vi } from 'vitest';
import { resetMockDatabase } from '../../test/mockSupabase';
import {
  mockContractConfig,
  mockUsers,
  mockPlatforms,
  mockPessoas,
  mockTecnicos,
  mockCarteiraRows,
  mockApontamentosHHRows,
  mockJustificativasRows,
  mockUsoffUnWeights
} from '../../test/testFixtures';
import type {
  AppDataset,
  CarteiraEmbarque,
  CarteiraOperacao,
  ConfirmacaoSAP,
  ContractConfig,
  Justificativa,
  Plataforma,
  UsoffUnWeight
} from '../../domain/types';
import { planSmartCarteiraImport, planSmartSapImport } from '../../adapters/shared/client-pipeline';

vi.mock('../supabase', async () => {
  const { createMockSupabaseClient } = await import('../../test/mockSupabase');
  return {
    supabase: createMockSupabaseClient()
  };
});

import { supabase } from '../supabase';
const mockClient = supabase as any;

import {
  loadAppDataset,
  saveJustificativa,
  saveConfiguracoes,
  savePlataforma,
  deletePlataforma,
  saveTecnico,
  deleteTecnico,
  batchImportTecnicos,
  savePessoa,
  deletePessoa,
  batchImportHH,
  batchImportCarteira,
  batchImportPlataformas,
  batchImportPessoas,
  batchImportConfirmacoesSAP,
  reconciliarConfirmacoesSAP,
  resetCarteiraEmbarques,
  fetchCarteiraDedupSnapshot,
  exportJsonSnapshot
} from '../data.service';

describe('Data Service - Consultas Janeladas, RLS, Batch UPSERT e Persistência', () => {
  beforeEach(() => {
    resetMockDatabase(mockClient);
  });

  describe('1. loadAppDataset (Visão Global vs Escopo Restrito)', () => {
    it('carrega o dataset completo em modo global (isGlobal = true)', async () => {
      const dataset = await loadAppDataset('2026-10-01', '2026-10-31', true);

      expect(dataset).toBeDefined();
      expect(dataset.config.hh_dia).toBe(12);
      expect(dataset.config.slogan).toContain('Ambiente de Teste');

      // Catálogos e Entidades
      expect(Object.keys(dataset.plataformas)).toEqual(
        expect.arrayContaining(['P50', 'P74', 'P25', 'P58'])
      );
      expect(Object.keys(dataset.pessoas).length).toBeGreaterThanOrEqual(3);
      expect(Object.keys(dataset.tecnicos)).toEqual(
        expect.arrayContaining(['1001', '1002', '1003'])
      );

      // Carteira de embarques com nomes e funções resolvidos
      expect(dataset.carteira.length).toBe(3);
      const c1001 = dataset.carteira.find(c => c.matricula === '1001');
      expect(c1001?.nome).toBe('Carlos Silva');
      expect(c1001?.funcao).toBe('Técnico de Automação');

      // Apontamentos HH indexados por matricula|data
      expect(dataset.hhMap['1001|2026-10-01']).toBeDefined();
      expect(dataset.hhMap['1001|2026-10-01'].horas_executadas).toBe(12);

      // Justificativas indexadas por matricula|data
      expect(dataset.justMap['1001|2026-10-03']).toBeDefined();
      expect(dataset.justMap['1001|2026-10-03'].horas_gangway).toBe(12);

      // Marca d'água
      expect(dataset.watermark.ultima_data_hh).toBe('2026-10-06');

      // Específicos do escopo global
      expect(Object.keys(dataset.profiles).length).toBeGreaterThanOrEqual(4);
      expect(Object.keys(dataset.onboardingMap || {}).length).toBeGreaterThanOrEqual(3);
      expect(dataset.emailsResumo).toContain('gestor.teste@empresa.com.br');
      expect(dataset.latestFluxo).not.toBeNull();
      expect(dataset.externalCoveredSet.size).toBe(0);
      expect(dataset.sharedOpsSet.size).toBe(0);

      // Não está em modo demo porque existem apontamentos e carteira reais
      expect(dataset.isDemo).toBe(false);
    });

    it('carrega o dataset em modo restrito (isGlobal = false) populando externalCoveredSet e sharedOpsSet', async () => {
      const dataset = await loadAppDataset('2026-10-01', '2026-10-31', false);

      expect(dataset).toBeDefined();

      // No modo restrito, dados administrativos não são carregados
      expect(Object.keys(dataset.profiles).length).toBe(0);
      expect(Object.keys(dataset.onboardingMap || {}).length).toBe(0);
      expect(dataset.emailsResumo.length).toBe(0);
      expect(dataset.latestFluxo).toBeNull();

      // RPCs de escopo restrito devem estar populadas
      expect(dataset.externalCoveredSet.has('1001|2026-10-01')).toBe(true);
      expect(dataset.sharedOpsSet.has('OP-100')).toBe(true);
      expect(dataset.sharedOpsSet.has('OP-200')).toBe(true);
    });

    it('ativa o modo demonstração (isDemo = true) quando o banco estiver totalmente zerado de dados operacionais', async () => {
      // Limpa dados operacionais
      mockClient.__mockState.tables.apontamentos_hh = [];
      mockClient.__mockState.tables.carteira_embarques = [];
      mockClient.__mockState.tables.fluxo_importacoes = [];

      const dataset = await loadAppDataset('2026-10-01', '2026-10-31', true);

      expect(dataset.isDemo).toBe(true);
      expect(dataset.demoReason).toContain('Sem apontamentos ou embarques reais');
      expect(dataset.carteira.length).toBeGreaterThan(0);
    });

    it('usa DEFAULT_CONFIG quando a tabela configuracoes não tiver o registro geral', async () => {
      mockClient.__mockState.tables.configuracoes = [];

      const dataset = await loadAppDataset('2026-10-01', '2026-10-31', true);
      expect(dataset.config.hh_dia).toBe(11);
      expect(dataset.config.dias_embarque).toBe(14);
    });
  });

  describe('2. Paginação Automática fetchAllPages (>1.000 registros)', () => {
    it('consome múltiplas páginas transparentemente quando a tabela ultrapassar 1.000 linhas', async () => {
      // Cria 1.250 técnicos sintéticos
      const bulkTecnicos = Array.from({ length: 1250 }, (_, i) => ({
        matricula: `TEC-${String(i + 1).padStart(5, '0')}`,
        nome: `Técnico Número ${i + 1}`,
        funcao: 'Especialista Offshore'
      }));

      mockClient.__mockState.tables.tecnicos = bulkTecnicos;

      const dataset = await loadAppDataset('2026-10-01', '2026-10-31', true);
      expect(Object.keys(dataset.tecnicos).length).toBe(1250);
      expect(dataset.tecnicos['TEC-00001']).toBeDefined();
      expect(dataset.tecnicos['TEC-01250']).toBeDefined();
    });
  });

  describe('3. saveJustificativa', () => {
    it('insere uma nova justificativa operacional', async () => {
      const novaJust: Omit<Justificativa, 'id'> = {
        matricula: '1002',
        data: '2026-10-07',
        motivo: 'Treinamento de Segurança Obrigatório',
        horas_gangway: 4,
        descricao: 'Treinamento de combate a incêndio offshore',
        responsavel_nome: 'Preposto Operacional Teste'
      };

      await saveJustificativa(novaJust);

      const salva = mockClient.__mockState.tables.justificativas.find(
        (j: any) => j.matricula === '1002' && j.data === '2026-10-07'
      );
      expect(salva).toBeDefined();
      expect(salva.motivo).toBe('Treinamento de Segurança Obrigatório');
      expect(salva.horas_gangway).toBe(4);
    });

    it('atualiza uma justificativa existente via UPSERT sem duplicar chave (matricula, data)', async () => {
      const justAtualizada: Omit<Justificativa, 'id'> = {
        matricula: '1001',
        data: '2026-10-03',
        motivo: 'Condições climáticas severas e ventos acima de 40 nós',
        horas_gangway: 12,
        descricao: 'Atualização pós-inspeção técnica',
        responsavel_nome: 'Preposto Operacional Teste'
      };

      await saveJustificativa(justAtualizada);

      const todas = mockClient.__mockState.tables.justificativas.filter(
        (j: any) => j.matricula === '1001' && j.data === '2026-10-03'
      );
      expect(todas.length).toBe(1);
      expect(todas[0].motivo).toContain('ventos acima de 40 nós');
    });
  });

  describe('4. saveConfiguracoes', () => {
    it('salva configurações contratuais, pesos de UN e lista de e-mails', async () => {
      const novaCfg: ContractConfig = {
        ...mockContractConfig,
        hh_dia: 10,
        meta_percentual: 95,
        slogan: 'Novo Slogan Contratual 2026'
      };

      const novosPesos: UsoffUnWeight[] = [
        { unidade_negocio: 'Nova UN Norte', pe: 1.25, ex: 1.2 }
      ];

      const novosEmails = ['diretoria@empresa.com.br', 'operacoes@empresa.com.br'];

      await saveConfiguracoes(novaCfg, novosPesos, novosEmails);

      const cfgBanco = mockClient.__mockState.tables.configuracoes.find((c: any) => c.id === 'geral');
      expect(cfgBanco.hh_dia).toBe(10);
      expect(cfgBanco.meta_percentual).toBe(95);
      expect(cfgBanco.slogan).toBe('Novo Slogan Contratual 2026');

      const pesoBanco = mockClient.__mockState.tables.config_usoff_un.find(
        (w: any) => w.unidade_negocio === 'Nova UN Norte'
      );
      expect(pesoBanco).toBeDefined();
      expect(pesoBanco.pe).toBe(1.25);

      const notifBanco = mockClient.__mockState.tables.configuracoes_notificacao.find(
        (n: any) => n.id === 'geral'
      );
      expect(notifBanco.emails_resumo).toEqual(novosEmails);
    });
  });

  describe('5. savePlataforma & deletePlataforma', () => {
    it('salva uma nova plataforma normalizando chave e sigla maiúscula', async () => {
      await savePlataforma({
        sigla: 'p66',
        nome: 'Plataforma P-66',
        un: 'Búzios (UN-BUZ)',
        armador: 'Petrobras',
        tipo: 'FPSO'
      });

      const plat = mockClient.__mockState.tables.plataformas.find((p: any) => p.sigla === 'P66');
      expect(plat).toBeDefined();
      expect(plat.sigla).toBe('P66');
      expect(plat.chave_norm).toBe('p66');
      expect(plat.cadastro_pendente).toBe(false);
    });

    it('remove uma plataforma existente', async () => {
      expect(
        mockClient.__mockState.tables.plataformas.some((p: any) => p.sigla === 'P25')
      ).toBe(true);

      await deletePlataforma('P25');

      expect(
        mockClient.__mockState.tables.plataformas.some((p: any) => p.sigla === 'P25')
      ).toBe(false);
    });
  });

  describe('5.1 saveTecnico, deleteTecnico & batchImportTecnicos', () => {
    it('salva ou atualiza um técnico offshore no cadastro mestre', async () => {
      await saveTecnico({
        matricula: 'TEC-99001',
        nome: 'Técnico Especialista de Teste',
        funcao: 'Instrumentista Especialista'
      });

      const tec = mockClient.__mockState.tables.tecnicos.find((t: any) => t.matricula === 'TEC-99001');
      expect(tec).toBeDefined();
      expect(tec.nome).toBe('Técnico Especialista de Teste');
      expect(tec.funcao).toBe('Instrumentista Especialista');
    });

    it('remove um técnico offshore do cadastro mestre', async () => {
      mockClient.__mockState.tables.tecnicos.push({
        matricula: 'TEC-TO-DELETE',
        nome: 'Para Exclusão',
        funcao: 'Técnico Offshore'
      });

      expect(
        mockClient.__mockState.tables.tecnicos.some((t: any) => t.matricula === 'TEC-TO-DELETE')
      ).toBe(true);

      await deleteTecnico('TEC-TO-DELETE');

      expect(
        mockClient.__mockState.tables.tecnicos.some((t: any) => t.matricula === 'TEC-TO-DELETE')
      ).toBe(false);
    });

    it('remove um técnico offshore e seus vínculos em cascata quando solicitado', async () => {
      mockClient.__mockState.tables.tecnicos.push({
        matricula: 'TEC-CASCADE',
        nome: 'Para Cascata',
        funcao: 'Técnico Offshore'
      });
      mockClient.__mockState.tables.apontamentos_hh.push({
        matricula: 'TEC-CASCADE',
        data: '2026-06-01',
        horas_executadas: 11
      });

      await deleteTecnico('TEC-CASCADE', true);

      expect(
        mockClient.__mockState.tables.tecnicos.some((t: any) => t.matricula === 'TEC-CASCADE')
      ).toBe(false);
      expect(
        mockClient.__mockState.tables.apontamentos_hh.some((a: any) => a.matricula === 'TEC-CASCADE')
      ).toBe(false);
    });

    it('importa técnicos em lote com chunks e progresso', async () => {
      const rows = [
        { matricula: 'BULK-01', nome: 'Bulk Um', funcao: 'Caldeireiro' },
        { matricula: 'BULK-02', nome: 'Bulk Dois', funcao: 'Delineador' }
      ];

      const progressSpy = vi.fn();
      await batchImportTecnicos(rows, progressSpy);

      expect(mockClient.__mockState.tables.tecnicos.some((t: any) => t.matricula === 'BULK-01')).toBe(true);
      expect(mockClient.__mockState.tables.tecnicos.some((t: any) => t.matricula === 'BULK-02')).toBe(true);
      expect(progressSpy).toHaveBeenCalled();
    });
  });

  describe('6. savePessoa & deletePessoa', () => {
    it('cria uma nova pessoa com substituição atômica de plataformas e unidades', async () => {
      const pessoaCriada = await savePessoa({
        nome: 'Novo Preposto de Teste',
        papel: 'preposto',
        email: 'novo.preposto@empresa.com.br',
        plats: ['P50', 'P58'],
        uns: ['Espírito Santo (UN-ES)']
      });

      expect(pessoaCriada.id).toBeDefined();
      expect(pessoaCriada.slug).toContain('novo-preposto-de-teste');
      expect(pessoaCriada.plats).toEqual(['P50', 'P58']);

      // Verifica tabelas relacionais no banco
      const platsNoBanco = mockClient.__mockState.tables.pessoa_plataformas.filter(
        (pp: any) => pp.pessoa_id === pessoaCriada.id
      );
      expect(platsNoBanco.length).toBe(2);

      const unsNoBanco = mockClient.__mockState.tables.pessoa_unidades.filter(
        (pu: any) => pu.pessoa_id === pessoaCriada.id
      );
      expect(unsNoBanco.length).toBe(1);
    });

    it('atualiza uma pessoa existente modificando atribuições', async () => {
      const pessoaId = 'pes-preposto-001';

      await savePessoa({
        id: pessoaId,
        nome: 'Preposto Operacional Atualizado',
        papel: 'preposto',
        email: 'preposto.atualizado@empresa.com.br',
        plats: ['P25'], // Antes tinha P50 e P74
        uns: ['Bacia de Campos (UN-BC)']
      });

      const pessoaBanco = mockClient.__mockState.tables.pessoas.find((p: any) => p.id === pessoaId);
      expect(pessoaBanco.nome).toBe('Preposto Operacional Atualizado');

      const platsNoBanco = mockClient.__mockState.tables.pessoa_plataformas.filter(
        (pp: any) => pp.pessoa_id === pessoaId
      );
      expect(platsNoBanco.map((p: any) => p.plataforma_sigla)).toEqual(['P25']);
    });

    it('remove uma pessoa do sistema e suas credenciais de login associadas', async () => {
      const prepostoUserId = mockUsers.preposto.id;
      // Confere que a pessoa e seu perfil de acesso existem antes
      expect(
        mockClient.__mockState.tables.pessoas.some((p: any) => p.id === 'pes-preposto-001')
      ).toBe(true);
      expect(
        mockClient.__mockState.tables.profiles.some((p: any) => p.id === prepostoUserId)
      ).toBe(true);

      await deletePessoa('pes-preposto-001');

      // Verifica que a pessoa foi removida
      const pessoaExiste = mockClient.__mockState.tables.pessoas.some(
        (p: any) => p.id === 'pes-preposto-001'
      );
      expect(pessoaExiste).toBe(false);

      // Verifica que as credenciais associadas também foram removidas
      const perfilExiste = mockClient.__mockState.tables.profiles.some(
        (p: any) => p.id === prepostoUserId
      );
      expect(perfilExiste).toBe(false);
    });

    it('remove uma pessoa sem credenciais de acesso sem falhar', async () => {
      // Cria uma pessoa sem login
      mockClient.__mockState.tables.pessoas.push({
        id: 'pes-sem-login-999',
        nome: 'Pessoa Sem Login',
        slug: 'pessoa-sem-login',
        papel: 'controlador',
        email: 'sem.login@empresa.com.br',
        user_id: null
      });

      await deletePessoa('pes-sem-login-999');

      const pessoaExiste = mockClient.__mockState.tables.pessoas.some(
        (p: any) => p.id === 'pes-sem-login-999'
      );
      expect(pessoaExiste).toBe(false);
    });

    it('aborta a exclusão da pessoa se a remoção das credenciais falhar por salvaguarda', async () => {
      mockClient.__mockState.edgeFunctions = {
        'admin-users': async () => ({
          data: { ok: false, message: 'Operação bloqueada por salvaguarda anti-lockout' },
          error: null
        })
      };

      await expect(deletePessoa('pes-preposto-001')).rejects.toThrow(
        'Operação bloqueada por salvaguarda anti-lockout'
      );

      // A pessoa continua no banco pois a operação foi abortada
      const pessoaExiste = mockClient.__mockState.tables.pessoas.some(
        (p: any) => p.id === 'pes-preposto-001'
      );
      expect(pessoaExiste).toBe(true);
    });
  });

  describe('7. Chunking em Lotes de 500 Linhas para Importações Massivas', () => {
    it('batchImportHH processa >1.000 apontamentos em chunks de 500 com auto-cadastro de plataformas e registro de fluxo', async () => {
      // 1.200 linhas de HH
      const rows = Array.from({ length: 1200 }, (_, i) => ({
        mat: `TEC-HH-${String(i % 100).padStart(3, '0')}`,
        nome: `Técnico HH ${i % 100}`,
        funcao: 'Técnico',
        p: i % 2 === 0 ? 'P50' : 'PLAT_NOVA_INEDITA',
        r: 'UN-ES',
        D: `2026-10-${String((i % 25) + 1).padStart(2, '0')}`,
        e: 12
      }));

      const progressTicks: number[] = [];
      await batchImportHH(
        rows,
        mockPlatforms,
        (gravadas, total) => {
          progressTicks.push(gravadas);
        },
        'teste-automatizado'
      );

      // Deve ter reportado progresso nos marcos de 500, 1000 e 1200
      expect(progressTicks).toContain(500);
      expect(progressTicks).toContain(1000);
      expect(progressTicks).toContain(1200);

      // Auto-cadastro de plataforma inédita com cadastro_pendente: true
      const platNova = mockClient.__mockState.tables.plataformas.find(
        (p: any) => p.sigla === 'PLAT_NOVA_INEDITA'
      );
      expect(platNova).toBeDefined();
      expect(platNova.cadastro_pendente).toBe(true);

      // Garante pré-cadastro de todos os técnicos únicos para não violar FK
      const tecCadastrado = mockClient.__mockState.tables.tecnicos.find(
        (t: any) => t.matricula === 'TEC-HH-001'
      );
      expect(tecCadastrado).toBeDefined();

      // Registro de auditoria em fluxo_importacoes
      const fluxo = mockClient.__mockState.tables.fluxo_importacoes.find(
        (f: any) => f.origem === 'teste-automatizado'
      );
      expect(fluxo).toBeDefined();
      expect(fluxo.tipo_fluxo).toBe('hh');
      expect(fluxo.total_linhas).toBe(1200);
    });

    it('batchImportCarteira processa embarques em chunks de 500 e registra histórico', async () => {
      const rows = Array.from({ length: 1050 }, (_, i) => ({
        mat: `TEC-CART-${String(i % 50).padStart(3, '0')}`,
        nome: `Técnico Cart ${i % 50}`,
        funcao: 'Instrumentista',
        plat: 'P74',
        reg: 'Búzios (UN-BUZ)',
        ini: '2026-10-01',
        fim: '2026-10-14',
        hp: 168,
        op: `OP-${i}`
      }));

      let maxProgress = 0;
      await batchImportCarteira(rows, mockPlatforms, (gravadas, total) => {
        maxProgress = gravadas;
      });

      expect(maxProgress).toBe(1050);
      const fluxo = mockClient.__mockState.tables.fluxo_importacoes.find(
        (f: any) => f.tipo_fluxo === 'carteira' && f.total_linhas === 1050
      );
      expect(fluxo).toBeDefined();
    });

    it('batchImportPlataformas e batchImportPessoas processam lotes com sucesso', async () => {
      const platRows = [
        { sigla: 'P90', nome: 'Plataforma P-90', un: 'UN-BUZ' },
        { sigla: 'P91', nome: 'Plataforma P-91', un: 'UN-ES' }
      ];

      await batchImportPlataformas(platRows);
      expect(mockClient.__mockState.tables.plataformas.some((p: any) => p.sigla === 'P90')).toBe(true);

      const pesRows = [
        {
          nome: 'Preposto Lote 1',
          papel: 'preposto' as const,
          email: 'preposto.lote1@empresa.com.br',
          plats: ['P90'],
          uns: []
        }
      ];

      let countPessoas = 0;
      await batchImportPessoas(pesRows, (gravadas, total) => {
        countPessoas = gravadas;
      });

      expect(countPessoas).toBe(1);
      expect(mockClient.__mockState.tables.pessoas.some((p: any) => p.nome === 'Preposto Lote 1')).toBe(true);
    });
  });

  describe('8. exportJsonSnapshot (Backup Seguro de Contingência)', () => {
    it('gera backup estruturado de contingência sem PII de autenticação', async () => {
      const dataset = await loadAppDataset('2026-10-01', '2026-10-31', true);

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      exportJsonSnapshot(dataset);

      expect(clickSpy).toHaveBeenCalled();
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');

      clickSpy.mockRestore();
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
    });
  });

  describe('9. Propagação de Erros e Sanidade de Integridade Referencial (Resolução de Dívidas)', () => {
    it('lança erro em batchImportHH quando o upsert prévio de plataformas pendentes falha', async () => {
      const originalFrom = mockClient.from.bind(mockClient);
      const fromSpy = vi.spyOn(mockClient, 'from').mockImplementation(((table: any) => {
        if (table === 'plataformas') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: new Error('Falha RLS plataformas') })
          } as any;
        }
        return originalFrom(table);
      }) as any);

      try {
        const rows = [
          { mat: '1001', p: 'INEDITA_P999', D: '2026-10-01', e: 10 }
        ];
        await expect(batchImportHH(rows, {})).rejects.toThrow('Falha RLS plataformas');
      } finally {
        fromSpy.mockRestore();
      }
    });

    it('lança erro em batchImportCarteira quando o upsert prévio de técnicos falha', async () => {
      const pidx: Record<string, any> = {
        p50: { sigla: 'P50', chave_norm: 'p50', nome: 'Plataforma P-50' }
      };

      const originalFrom = mockClient.from.bind(mockClient);
      const fromSpy = vi.spyOn(mockClient, 'from').mockImplementation(((table: any) => {
        if (table === 'tecnicos') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: new Error('Falha FK tecnicos') })
          } as any;
        }
        return originalFrom(table);
      }) as any);

      try {
        const rows = [
          { mat: '9999', plat: 'P50', ini: '2026-10-01', fim: '2026-10-14' }
        ];
        await expect(batchImportCarteira(rows, pidx)).rejects.toThrow('Falha FK tecnicos');
      } finally {
        fromSpy.mockRestore();
      }
    });

    it('lança erro em savePessoa quando a limpeza de pessoa_plataformas falha', async () => {
      const originalFrom = mockClient.from.bind(mockClient);
      const fromSpy = vi.spyOn(mockClient, 'from').mockImplementation(((table: any) => {
        if (table === 'pessoa_plataformas') {
          return {
            delete: () => ({
              eq: vi.fn().mockResolvedValue({ error: new Error('Deadlock ao limpar escopo') })
            })
          } as any;
        }
        return originalFrom(table);
      }) as any);

      try {
        const input = {
          id: 'pes-1',
          nome: 'Controlador Teste',
          papel: 'controlador' as const,
          email: 'controlador@empresa.com.br',
          plats: ['P50'],
          uns: []
        };
        await expect(savePessoa(input)).rejects.toThrow('Deadlock ao limpar escopo');
      } finally {
        fromSpy.mockRestore();
      }
    });
  });

  describe('10. Reconciliação SAP, Carteira Granular e Retrocompatibilidade de Dataset', () => {
    it('assembleAppDataset garante retrocompatibilidade de hh_carteira (legado carteira 0/ausente vira undefined; portal_offshore mantém 0)', async () => {
      mockClient.__mockState.tables.carteira_embarques = [
        {
          id: 'cart-legado-1',
          matricula: '1001',
          data_inicio: '2026-10-01',
          data_fim: '2026-10-14',
          horas_programadas: 154,
          hh_carteira: 0,
          hh_fora_carteira: 0,
          hh_cancelado: 0,
          fonte: 'carteira',
          plataforma_sigla: 'P50',
          unidade_negocio: 'Espírito Santo (UN-ES)'
        },
        {
          id: 'cart-legado-2',
          matricula: '1002',
          data_inicio: '2026-10-01',
          data_fim: '2026-10-14',
          horas_programadas: 154,
          fonte: 'carteira',
          plataforma_sigla: 'P74',
          unidade_negocio: 'Búzios (UN-BUZ)'
        },
        {
          id: 'cart-portal-3',
          matricula: '1003',
          data_inicio: '2026-10-01',
          data_fim: '2026-10-14',
          horas_programadas: 154,
          hh_carteira: 0,
          hh_fora_carteira: 154,
          hh_cancelado: 0,
          fonte: 'portal_offshore',
          plataforma_sigla: 'P25',
          unidade_negocio: 'Bacia de Campos (UN-BC)'
        }
      ];

      const dataset = await loadAppDataset('2026-10-01', '2026-10-31', true);
      const c1 = dataset.carteira.find(c => c.id === 'cart-legado-1');
      const c2 = dataset.carteira.find(c => c.id === 'cart-legado-2');
      const c3 = dataset.carteira.find(c => c.id === 'cart-portal-3');

      expect(c1).toBeDefined();
      expect(c1?.hh_carteira).toBeUndefined(); // Legado recai para horas_programadas

      expect(c2).toBeDefined();
      expect(c2?.hh_carteira).toBeUndefined(); // Ausente recai para horas_programadas

      expect(c3).toBeDefined();
      expect(c3?.hh_carteira).toBe(0); // Portal Offshore preserva explicitamente 0
      expect(c3?.hh_fora_carteira).toBe(154);
    });

    it('batchImportConfirmacoesSAP preserva contador e contador_confirmacao sem colisão de chave', async () => {
      const sapRows = [
        {
          mat: '1001',
          cria: '2026-10-02',
          lanc: '2026-10-02',
          real: '2026-10-02',
          ordem: 'ORD-7001',
          op: '0010',
          hc: 4.5,
          contador: 1
        },
        {
          mat: '1001',
          cria: '2026-10-02',
          lanc: '2026-10-02',
          real: '2026-10-02',
          ordem: 'ORD-7001',
          op: '0010',
          hc: 4.5,
          contador: 2
        }
      ];

      let progressRecorded = 0;
      await batchImportConfirmacoesSAP(sapRows, (gravadas, _total) => {
        progressRecorded = gravadas;
      });

      expect(progressRecorded).toBe(2);

      const saved = mockClient.__mockState.tables.confirmacoes_sap.filter(
        (c: any) => c.matricula === '1001' && c.ordem === 'ORD-7001'
      );
      expect(saved.length).toBe(2);

      const item1 = saved.find((c: any) => c.contador_confirmacao === 1);
      const item2 = saved.find((c: any) => c.contador_confirmacao === 2);

      expect(item1).toBeDefined();
      expect(item1.horas_confirmadas).toBe(4.5);
      expect(item2).toBeDefined();
      expect(item2.horas_confirmadas).toBe(4.5);
    });

    it('batchImportCarteira granular sanitiza PMXL1 -> MXL em plataformas pendentes e operações', async () => {
      const rows = [
        {
          mat: '1002',
          nome: 'Mariana Costa',
          funcao: 'Técnica de Elétrica',
          plat: 'PMXL1',
          reg: 'Bacia de Santos (UN-BS)',
          ini: '2026-10-05',
          fim: '2026-10-19',
          hp: 80,
          ordem: 'ORD-5500',
          op: '0020',
          status_prog: 'Carteira',
          id_embarque: '55104'
        }
      ];

      await batchImportCarteira(rows, {});

      // 1. Plataforma pendente auto-cadastrada deve ter sigla 'MXL'
      const platMxl = mockClient.__mockState.tables.plataformas.find(
        (p: any) => p.sigla === 'MXL'
      );
      expect(platMxl).toBeDefined();
      expect(platMxl.cadastro_pendente).toBe(true);

      // Não deve ter criado 'PMXL1'
      const platPmxl = mockClient.__mockState.tables.plataformas.find(
        (p: any) => p.sigla === 'PMXL1'
      );
      expect(platPmxl).toBeUndefined();

      // 2. Operações em carteira_operacoes devem ter plataforma_sigla sanitizada para 'MXL'
      const opSalva = mockClient.__mockState.tables.carteira_operacoes.find(
        (o: any) => o.matricula === '1002' && o.ordem === 'ORD-5500'
      );
      expect(opSalva).toBeDefined();
      expect(opSalva.plataforma_sigla).toBe('MXL');
      expect(opSalva.id_embarque).toBe('55104');
    });

    it('resetCarteiraEmbarques e reconciliarConfirmacoesSAP acionam as RPCs correspondentes no Supabase', async () => {
      const rpcSpy = vi.spyOn(mockClient, 'rpc');

      // 1. Reconciliação
      const reconciliaResult = await reconciliarConfirmacoesSAP();
      expect(rpcSpy).toHaveBeenCalledWith('reconciliar_confirmacoes_sap');
      expect(reconciliaResult).toBeDefined();

      // 2. Reset da carteira
      const resetResult = await resetCarteiraEmbarques();
      expect(rpcSpy).toHaveBeenCalledWith('reset_carteira_embarques');
      expect(resetResult).toHaveProperty('deleted_operacoes');
      expect(resetResult).toHaveProperty('deleted_embarques');
      expect(mockClient.__mockState.tables.carteira_operacoes).toEqual([]);
      expect(mockClient.__mockState.tables.carteira_embarques).toEqual([]);

      rpcSpy.mockRestore();
    });
  });

  describe('11. Deduplicação Inteligente e Estornos SAP / Portal Offshore', () => {
    const pidxSintetico: Record<string, Plataforma> = {
      P50: {
        sigla: 'P50',
        chave_norm: 'P50',
        nome: 'P-50',
        un: 'UN-RIO',
        armador: '',
        gerencia: '',
        tipo: 'FPSO',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      }
    };

    it('planSmartSapImport colapsa duplicatas intra-arquivo, ignora idênticas do banco e atualiza estorno (+9 -> -9) alinhando zeros à esquerda', () => {
      const existingSap: ConfirmacaoSAP[] = [
        {
          id: 'sap-1',
          matricula: '0001099',
          data_criacao: '2026-10-10',
          data_lancamento: '2026-10-10',
          data_fim_real: '2026-10-10',
          ordem: '002099990001',
          operacao: '0010',
          horas_confirmadas: 9,
          contador_confirmacao: 1
        },
        {
          id: 'sap-2',
          matricula: '0001099',
          data_criacao: '2026-10-10',
          data_lancamento: '2026-10-10',
          data_fim_real: '2026-10-10',
          ordem: '002099990001',
          operacao: '0010',
          horas_confirmadas: 9,
          contador_confirmacao: 2
        }
      ];

      const plan = planSmartSapImport(
        [
          // Idêntico ao banco (com menos zeros à esquerda): deve ser ignorado
          { mat: '1099', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '2099990001', op: '10', hc: 9, contador: 1 },
          // Duplicata exata na própria planilha do contador 1: deve colapsar
          { mat: '0001099', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '002099990001', op: '0010', hc: 9, contador: 1 },
          // Estorno no mesmo contador 2 (+9 -> -9): deve ser atualizado e alinhado com raw strings do banco
          { mat: '1099', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '2099990001', op: '10', hc: -9, contador: 2 },
          // Registro inédito (contador 3)
          { mat: '0001099', cria: '2026-10-11', lanc: '2026-10-11', real: '2026-10-11', ordem: '002099990001', op: '0010', hc: 9, contador: 3 }
        ],
        existingSap
      );

      expect(plan.totalValidRows).toBe(4);
      expect(plan.intraFileDuplicates).toBe(1);
      expect(plan.dbDuplicatesIgnored).toBe(1);
      expect(plan.updatedCount).toBe(1);
      expect(plan.newCount).toBe(1);
      expect(plan.rowsToImport).toHaveLength(2);

      const estornoRow = plan.rowsToImport.find(r => r.contador === 2);
      expect(estornoRow).toEqual({
        mat: '0001099',
        cria: '2026-10-10',
        lanc: '2026-10-10',
        real: '2026-10-10',
        ordem: '002099990001',
        op: '0010',
        hc: -9,
        contador: 2
      });
    });

    it('planSmartCarteiraImport evita somar duplicatas no modo não-granular e gera poda completa (incluindo ops inalteradas do mesmo embarque) no modo granular', async () => {
      // 1. Modo não-granular com linha idêntica repetida na planilha: não deve duplicar 60 -> 120
      const legacyDupRows = [
        { mat: '1099', nome: 'Técnico Sintético 01', plat: 'P50', reg: 'UN-RIO', ini: '2026-10-01', fim: '2026-10-10', hp: 60 },
        { mat: '001099', nome: 'Técnico Sintético 01', plat: 'P50', reg: 'UN-RIO', ini: '2026-10-01', fim: '2026-10-10', hp: 60 }
      ];
      const legacyPlan = planSmartCarteiraImport(legacyDupRows, pidxSintetico, [], []);
      expect(legacyPlan.isGranular).toBe(false);
      expect(legacyPlan.intraFileDuplicates).toBe(1);
      expect(legacyPlan.rowsToImport).toHaveLength(1);

      await batchImportCarteira(legacyDupRows, pidxSintetico, undefined, 'teste-dedup-legado');
      const legacyCart = mockClient.__mockState.tables.carteira_embarques.filter(
        (c: any) => c.matricula === '1099' && c.data_inicio === '2026-10-01'
      );
      expect(legacyCart).toHaveLength(1);
      expect(legacyCart[0].horas_programadas).toBe(60);

      // 2. Modo granular: embarque 56900 tinha OP-10 (inalterada) e OP-20 (antes 2026-10-05, agora movida para 2026-10-06)
      const existingOps: CarteiraOperacao[] = [
        {
          id: 'op-10',
          portal_id: '56900',
          id_embarque: '56900',
          matricula: '1098',
          chave_petrobras: '',
          nome: 'Técnico Sintético 02',
          empresa: 'Empresa Teste',
          estrutura: 'UN-RIO',
          unidade_negocio: 'UN-RIO',
          plataforma_sigla: 'P50',
          data_inicio: '2026-10-05',
          data_fim: '2026-10-15',
          ordem: 'ORD-900',
          operacao: '0010',
          status_processamento: 'Programado',
          prioridade: 'Normal',
          status_programacao: 'Carteira',
          hh_programado: 20,
          hh_confirmado: 0,
          recursos: 1,
          fonte: 'portal_offshore'
        },
        {
          id: 'op-20',
          portal_id: '56900',
          id_embarque: '56900',
          matricula: '1098',
          chave_petrobras: '',
          nome: 'Técnico Sintético 02',
          empresa: 'Empresa Teste',
          estrutura: 'UN-RIO',
          unidade_negocio: 'UN-RIO',
          plataforma_sigla: 'P50',
          data_inicio: '2026-10-05',
          data_fim: '2026-10-15',
          ordem: 'ORD-900',
          operacao: '0020',
          status_processamento: 'Programado',
          prioridade: 'Normal',
          status_programacao: 'Carteira',
          hh_programado: 15,
          hh_confirmado: 0,
          recursos: 1,
          fonte: 'portal_offshore'
        }
      ];

      const planIdentical = planSmartCarteiraImport(
        [
          { mat: '1098', nome: 'Técnico Sintético 02', plat: 'P50', reg: 'UN-RIO', empresa: 'Empresa Teste', ini: '2026-10-05', fim: '2026-10-15', hp: 20, hc_portal: 0, status_prog: 'Carteira', ordem: 'ORD-900', op: '0010', id_embarque: '56900' },
          { mat: '1098', nome: 'Técnico Sintético 02', plat: 'P50', reg: 'UN-RIO', empresa: 'Empresa Teste', ini: '2026-10-05', fim: '2026-10-15', hp: 15, hc_portal: 0, status_prog: 'Carteira', ordem: 'ORD-900', op: '0020', id_embarque: '56900' }
        ],
        pidxSintetico,
        existingOps,
        []
      );
      expect(planIdentical.dbDuplicatesIgnored).toBe(2);
      expect(planIdentical.rowsToImport).toHaveLength(0);
      expect(planIdentical.affectedPruneEmbarqueIds).toEqual([]);

      // Agora desloca OP-20 para 2026-10-06 mantendo OP-10 inalterada em 2026-10-05
      const planShifted = planSmartCarteiraImport(
        [
          { mat: '1098', nome: 'Técnico Sintético 02', plat: 'P50', reg: 'UN-RIO', empresa: 'Empresa Teste', ini: '2026-10-05', fim: '2026-10-15', hp: 20, hc_portal: 0, status_prog: 'Carteira', ordem: 'ORD-900', op: '0010', id_embarque: '56900' },
          { mat: '1098', nome: 'Técnico Sintético 02', plat: 'P50', reg: 'UN-RIO', empresa: 'Empresa Teste', ini: '2026-10-06', fim: '2026-10-15', hp: 15, hc_portal: 0, status_prog: 'Carteira', ordem: 'ORD-900', op: '0020', id_embarque: '56900' }
        ],
        pidxSintetico,
        existingOps,
        []
      );
      expect(planShifted.dbDuplicatesIgnored).toBe(1);
      expect(planShifted.newCount).toBe(1);
      expect(planShifted.staleOpsToPruneCount).toBe(1);
      expect(planShifted.affectedPruneEmbarqueIds).toEqual(['56900']);
      expect(planShifted.rowsToImport).toHaveLength(1);
      // Crítico: pruneKeepOps deve incluir OP-10 (inalterada) e OP-20 (nova) para não apagar OP-10 na poda!
      expect(planShifted.pruneKeepOps).toHaveLength(2);
      expect(planShifted.pruneKeepOps.map(o => `${o.operacao}@${o.data_inicio}`).sort()).toEqual([
        '0010@2026-10-05',
        '0020@2026-10-06'
      ]);
    });

    it('batchImportConfirmacoesSAP e batchImportCarteira no mockSupabase sobrescrevem estorno (18h em vez de 27h) e podam embarque deslocado sem empilhar linhas órfãs', async () => {
      // 1. SAP: importa 4 contadores (+9, +9, +9, +9) e depois reimporta contador 2 como estorno (-9)
      await batchImportConfirmacoesSAP([
        { mat: '1097', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '002099990002', op: '0010', hc: 9, contador: 1 },
        { mat: '1097', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '002099990002', op: '0010', hc: 9, contador: 2 },
        { mat: '1097', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '002099990002', op: '0010', hc: 9, contador: 3 },
        { mat: '1097', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '002099990002', op: '0010', hc: 9, contador: 4 }
      ]);

      const ds1 = await loadAppDataset('2026-10-01', '2026-10-31', true);
      const sapPlan2 = planSmartSapImport(
        [
          { mat: '1097', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '002099990002', op: '0010', hc: 9, contador: 1 },
          { mat: '1097', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '002099990002', op: '0010', hc: -9, contador: 2 },
          { mat: '1097', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '002099990002', op: '0010', hc: 9, contador: 3 },
          { mat: '1097', cria: '2026-10-10', lanc: '2026-10-10', real: '2026-10-10', ordem: '002099990002', op: '0010', hc: 9, contador: 4 }
        ],
        ds1.confirmacoesSap || []
      );
      expect(sapPlan2.updatedCount).toBe(1);
      expect(sapPlan2.dbDuplicatesIgnored).toBe(3);

      await batchImportConfirmacoesSAP(sapPlan2.rowsToImport);
      const sap1097 = mockClient.__mockState.tables.confirmacoes_sap.filter(
        (cs: any) => cs.matricula === '1097' && cs.ordem === '002099990002'
      );
      expect(sap1097).toHaveLength(4);
      const sum1097 = sap1097.reduce((acc: number, cs: any) => acc + Number(cs.horas_confirmadas || 0), 0);
      expect(sum1097).toBe(18);

      // 2. Portal Offshore granular: embarque 56901 começa em 2026-10-05 (OP-10 e OP-20), depois desloca inteiro para 2026-10-06 e remove OP-20
      const portalLote1 = [
        { mat: '1096', nome: 'Técnico Sintético 03', plat: 'P50', reg: 'UN-RIO', ini: '2026-10-05', fim: '2026-10-15', hp: 20, hc_portal: 0, status_prog: 'Carteira', ordem: 'ORD-901', op: '0010', id_embarque: '56901' },
        { mat: '1096', nome: 'Técnico Sintético 03', plat: 'P50', reg: 'UN-RIO', ini: '2026-10-05', fim: '2026-10-15', hp: 10, hc_portal: 0, status_prog: 'Carteira', ordem: 'ORD-901', op: '0020', id_embarque: '56901' }
      ];
      await batchImportCarteira(portalLote1, pidxSintetico, undefined, 'portal-lote-1');

      const snap = await fetchCarteiraDedupSnapshot();
      expect(snap).not.toBeNull();
      const portalLote2 = [
        { mat: '1096', nome: 'Técnico Sintético 03', plat: 'P50', reg: 'UN-RIO', ini: '2026-10-06', fim: '2026-10-16', hp: 20, hc_portal: 0, status_prog: 'Carteira', ordem: 'ORD-901', op: '0010', id_embarque: '56901' }
      ];
      const cartPlan2 = planSmartCarteiraImport(portalLote2, pidxSintetico, snap?.carteiraOperacoes || [], snap?.carteira || []);
      expect(cartPlan2.affectedPruneEmbarqueIds).toEqual(['56901']);

      await batchImportCarteira(cartPlan2.rowsToImport, pidxSintetico, undefined, 'portal-lote-2', {
        pruneEmbarqueIds: cartPlan2.affectedPruneEmbarqueIds,
        pruneKeepOps: cartPlan2.pruneKeepOps
      });

      const ops56901 = mockClient.__mockState.tables.carteira_operacoes.filter((o: any) => o.id_embarque === '56901');
      expect(ops56901).toHaveLength(1);
      expect(ops56901[0].data_inicio).toBe('2026-10-06');

      const embs1096 = mockClient.__mockState.tables.carteira_embarques.filter((c: any) => c.matricula === '1096');
      expect(embs1096).toHaveLength(1);
      expect(embs1096[0].data_inicio).toBe('2026-10-06');
      expect(embs1096[0].horas_programadas).toBe(20);
    });
  });
});
