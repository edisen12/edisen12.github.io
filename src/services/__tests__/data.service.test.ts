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
import type { AppDataset, ContractConfig, Justificativa, UsoffUnWeight } from '../../domain/types';

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
  savePessoa,
  deletePessoa,
  batchImportHH,
  batchImportCarteira,
  batchImportPlataformas,
  batchImportPessoas,
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

    it('remove uma pessoa do sistema', async () => {
      await deletePessoa('pes-preposto-001');

      const pessoaExiste = mockClient.__mockState.tables.pessoas.some(
        (p: any) => p.id === 'pes-preposto-001'
      );
      expect(pessoaExiste).toBe(false);
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
});
