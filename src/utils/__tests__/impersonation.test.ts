import { describe, expect, it } from 'vitest';
import {
  buildImpersonationTargets,
  resolveImpersonationFromPessoa,
  resolveImpersonationFromProfile,
  scopeDatasetForUser
} from '../impersonation';
import { buildPlatformIndex } from '../../domain/calculations';
import type { AppDataset, Pessoa, UserProfile } from '../../domain/types';
import {
  adminUser,
  controladorPessoa,
  controladorUser,
  gestorPessoa,
  gestorUser,
  mockApontamentosHHRows,
  mockCarteiraRows,
  mockContractConfig,
  mockJustificativasRows,
  mockLatestFluxo,
  mockOnboardings,
  mockPlatforms,
  mockTecnicos,
  mockUsoffUnWeights,
  mockWatermark,
  prepostoPessoa,
  prepostoUser
} from '../../test/testFixtures';

function createFullTestDataset(): AppDataset {
  const pessoaSemLogin: Pessoa = {
    id: 'pes-sem-login-004',
    slug: 'preposto-sem-login',
    nome: 'Preposto Sem Login Teste',
    papel: 'preposto',
    email: 'sem.login@empresa.com.br',
    user_id: null,
    plats: ['P58'],
    uns: []
  };

  const pessoaPorEmail: Pessoa = {
    id: 'pes-email-link-005',
    slug: 'controlador-email',
    nome: 'Controlador Vinculado Por Email',
    papel: 'controlador',
    email: 'LINK.EMAIL@EMPRESA.COM.BR',
    user_id: null,
    plats: ['P25'],
    uns: []
  };

  const profilePorEmail: UserProfile = {
    id: 'usr-email-link-005',
    email: 'link.email@empresa.com.br',
    nome: 'Controlador Vinculado Por Email',
    role: 'controlador',
    ativo: true
  };

  const gestorSemPessoa: UserProfile = {
    id: 'usr-gestor-extra-006',
    email: 'gestor.extra@empresa.com.br',
    nome: 'Gestor Global Extra',
    role: 'gestor',
    ativo: true
  };

  const hhMap: AppDataset['hhMap'] = {};
  mockApontamentosHHRows.forEach(h => {
    hhMap[`${h.matricula}|${h.data}`] = h;
  });
  // Transbordo: técnico 1001 da carteira do preposto (P50) aponta em P25 (fora do escopo do preposto) em 2026-10-04
  hhMap['1001|2026-10-04'] = {
    id: 'hh-transbordo-1',
    matricula: '1001',
    data: '2026-10-04',
    plataforma_sigla: 'P25',
    unidade_negocio: 'Bacia de Campos (UN-BC)',
    horas_executadas: 11
  };

  const justMap: AppDataset['justMap'] = {
    '1001|2026-10-03': mockJustificativasRows[0],
    // Justificativa de técnico fora da carteira do preposto
    '1003|2026-10-12': {
      id: 'jus-fora-1',
      matricula: '1003',
      data: '2026-10-12',
      motivo: 'Outro',
      horas_gangway: 0,
      descricao: 'Justificativa fora da carteira',
      responsavel_nome: 'Controlador de Medição Teste'
    }
  };

  return {
    config: { ...mockContractConfig },
    usoffUnWeights: {
      'Espírito Santo (UN-ES)': mockUsoffUnWeights[0],
      'Búzios (UN-BUZ)': mockUsoffUnWeights[1],
      'Bacia de Campos (UN-BC)': mockUsoffUnWeights[2]
    },
    emailsResumo: ['auditoria@empresa.com.br'],
    plataformas: { ...mockPlatforms },
    pessoas: {
      [prepostoPessoa.id]: prepostoPessoa,
      [gestorPessoa.id]: gestorPessoa,
      [controladorPessoa.id]: controladorPessoa,
      [pessoaSemLogin.id]: pessoaSemLogin,
      [pessoaPorEmail.id]: pessoaPorEmail
    },
    profiles: {
      [adminUser.id]: adminUser,
      [gestorUser.id]: gestorUser,
      [prepostoUser.id]: prepostoUser,
      [controladorUser.id]: controladorUser,
      [profilePorEmail.id]: profilePorEmail,
      [gestorSemPessoa.id]: gestorSemPessoa
    },
    onboardingMap: Object.fromEntries(mockOnboardings.map(o => [o.user_id, o])),
    tecnicos: { ...mockTecnicos },
    carteira: [
      ...mockCarteiraRows,
      // Embarque fora do escopo do preposto compartilhando a mesma operação OP-100
      {
        id: 'cart-shared-op',
        id_embarque: '55999',
        matricula: '1004',
        plataforma_sigla: 'P25',
        unidade_negocio: 'Bacia de Campos (UN-BC)',
        data_inicio: '2026-10-10',
        data_fim: '2026-10-18',
        horas_programadas: 100,
        operacao: 'OP-100',
        pe: 1.0,
        ex: 1.0,
        fonte: 'carteira'
      }
    ],
    carteiraOperacoes: [
      {
        portal_id: '55101',
        id_embarque: '55101',
        matricula: '1001',
        chave_petrobras: 'CHV1',
        nome: 'Carlos Silva',
        empresa: 'Infotec Brasil',
        estrutura: 'UN-ES',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        plataforma_sigla: 'P50',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        ordem: '002030000100',
        operacao: '0010',
        status_processamento: 'Concluído',
        prioridade: 'Regular',
        status_programacao: 'Carteira',
        hh_programado: 20,
        hh_confirmado: 20,
        hh_confirmado_sap: 20,
        recursos: 1,
        fonte: 'portal_offshore'
      },
      {
        portal_id: '55202',
        id_embarque: '55202',
        matricula: '1003',
        chave_petrobras: 'CHV2',
        nome: 'Roberto Dias',
        empresa: 'Infotec Brasil',
        estrutura: 'UN-BC',
        unidade_negocio: 'Bacia de Campos (UN-BC)',
        plataforma_sigla: 'P25',
        data_inicio: '2026-10-10',
        data_fim: '2026-10-24',
        ordem: '002030000200',
        operacao: '0020',
        status_processamento: 'Concluído',
        prioridade: 'Regular',
        status_programacao: 'Carteira',
        hh_programado: 15,
        hh_confirmado: 15,
        hh_confirmado_sap: 15,
        recursos: 1,
        fonte: 'portal_offshore'
      }
    ],
    confirmacoesSap: [
      {
        id: 'sap-1',
        matricula: '1001',
        data_criacao: '2026-10-02',
        data_lancamento: '2026-10-02',
        data_fim_real: '2026-10-02',
        ordem: '002030000100',
        operacao: '0010',
        horas_confirmadas: 12,
        id_embarque: '55101'
      },
      {
        id: 'sap-2',
        matricula: '1003',
        data_criacao: '2026-10-12',
        data_lancamento: '2026-10-12',
        data_fim_real: '2026-10-12',
        ordem: '002030000200',
        operacao: '0020',
        horas_confirmadas: 15,
        id_embarque: '55202'
      }
    ],
    hhMap,
    justMap,
    externalCoveredSet: new Set<string>(),
    sharedOpsSet: new Set<string>(),
    watermark: { ...mockWatermark },
    latestFluxo: { ...mockLatestFluxo },
    isDemo: false,
    demoReason: ''
  };
}

describe('impersonation utilities (Ver como outro usuário)', () => {
  it('buildImpersonationTargets vincula pessoas e perfis, gera perfil virtual sem login e exclui o próprio admin', () => {
    const ds = createFullTestDataset();
    const targets = buildImpersonationTargets(ds, adminUser.id);

    // O admin logado não aparece como alvo
    expect(targets.some(t => t.profile.id === adminUser.id)).toBe(false);

    // Preposto com login vinculado por user_id
    const tPrep = targets.find(t => t.key === `pessoa:${prepostoPessoa.id}`);
    expect(tPrep).toBeDefined();
    expect(tPrep?.hasLoginAccount).toBe(true);
    expect(tPrep?.profile.id).toBe(prepostoUser.id);

    // Controlador vinculado por e-mail case-insensitive
    const tEmail = targets.find(t => t.key === 'pessoa:pes-email-link-005');
    expect(tEmail).toBeDefined();
    expect(tEmail?.hasLoginAccount).toBe(true);
    expect(tEmail?.profile.id).toBe('usr-email-link-005');

    // Pessoa sem login ganha perfil virtual ativo para simular sua carteira
    const tSemLogin = targets.find(t => t.key === 'pessoa:pes-sem-login-004');
    expect(tSemLogin).toBeDefined();
    expect(tSemLogin?.hasLoginAccount).toBe(false);
    expect(tSemLogin?.profile.id).toBe('sim-pessoa-pes-sem-login-004');
    expect(tSemLogin?.profile.ativo).toBe(true);
    expect(tSemLogin?.profile.role).toBe('preposto');

    // Gestor extra sem linha na tabela pessoas aparece como profile:<id>
    const tGestorExtra = targets.find(t => t.key === 'profile:usr-gestor-extra-006');
    expect(tGestorExtra).toBeDefined();
    expect(tGestorExtra?.pessoa).toBeNull();
    expect(tGestorExtra?.hasLoginAccount).toBe(true);

    // Ordenação: prepostos -> controladores -> gestores
    const firstNonPrepostoIdx = targets.findIndex(t => t.profile.role !== 'preposto');
    const firstGestorIdx = targets.findIndex(t => t.profile.role === 'gestor');
    expect(firstNonPrepostoIdx).toBeGreaterThan(0);
    expect(firstGestorIdx).toBeGreaterThan(firstNonPrepostoIdx);
  });

  it('resolveImpersonationFromPessoa e resolveImpersonationFromProfile resolvem corretamente os vínculos', () => {
    const ds = createFullTestDataset();

    const fromPessoa = resolveImpersonationFromPessoa(prepostoPessoa, ds);
    expect(fromPessoa.profile.id).toBe(prepostoUser.id);
    expect(fromPessoa.pessoa?.id).toBe(prepostoPessoa.id);
    expect(fromPessoa.hasLoginAccount).toBe(true);

    const fromProfile = resolveImpersonationFromProfile(controladorUser, ds);
    expect(fromProfile.pessoa?.id).toBe(controladorPessoa.id);
    expect(fromProfile.key).toBe(`pessoa:${controladorPessoa.id}`);
  });

  it('scopeDatasetForUser mantém acesso global integral para gestor e admin', () => {
    const ds = createFullTestDataset();
    const pidx = buildPlatformIndex(ds.plataformas);
    const gestorTarget = resolveImpersonationFromProfile(gestorUser, ds);

    const scoped = scopeDatasetForUser(ds, gestorTarget, pidx);
    expect(scoped).toBe(ds);
    expect(Object.keys(scoped.plataformas)).toHaveLength(4);
    expect(scoped.carteira).toHaveLength(4);
  });

  it('scopeDatasetForUser aplica RLS completo em memória para preposto (carteira, HH, SAP, justificativas, transbordo e OPs compartilhadas)', () => {
    const ds = createFullTestDataset();
    const pidx = buildPlatformIndex(ds.plataformas);
    const prepTarget = resolveImpersonationFromPessoa(prepostoPessoa, ds);

    const scoped = scopeDatasetForUser(ds, prepTarget, pidx);

    // Apenas plataformas P50 e P74 são visíveis para o preposto
    expect(Object.keys(scoped.plataformas).sort()).toEqual(['P50', 'P74']);

    // UNs derivadas das plataformas visíveis (UN-ES e UN-BUZ), sem UN-BC
    expect(Object.keys(scoped.usoffUnWeights).sort()).toEqual([
      'Búzios (UN-BUZ)',
      'Espírito Santo (UN-ES)'
    ]);

    // Metadados administrativos ocultos
    expect(scoped.emailsResumo).toEqual([]);
    expect(scoped.latestFluxo).toBeNull();
    expect(Object.keys(scoped.pessoas)).toEqual([prepostoPessoa.id]);
    expect(Object.keys(scoped.profiles)).toEqual([prepostoUser.id]);

    // Carteira e operações filtradas
    expect(scoped.carteira.map(c => c.id)).toEqual(['cart-001', 'cart-002']);
    expect(scoped.carteiraOperacoes?.map(co => co.portal_id)).toEqual(['55101']);

    // Confirmações SAP filtradas pelos técnicos presentes na carteira visível
    expect(scoped.confirmacoesSap?.map(cs => cs.id)).toEqual(['sap-1']);

    // Apontamentos HH filtrados (exclui o apontamento 1001|2026-10-04 em P25)
    expect(scoped.hhMap['1001|2026-10-01']).toBeDefined();
    expect(scoped.hhMap['1002|2026-10-05']).toBeDefined();
    expect(scoped.hhMap['1001|2026-10-04']).toBeUndefined();

    // Justificativas filtradas (mantém 1001|2026-10-03, oculta 1003|2026-10-12)
    expect(scoped.justMap['1001|2026-10-03']).toBeDefined();
    expect(scoped.justMap['1003|2026-10-12']).toBeUndefined();

    // Transbordo zero-knowledge: técnico 1001 na carteira P50 apontou em P25 no dia 2026-10-04
    expect(scoped.externalCoveredSet.has('1001|2026-10-04')).toBe(true);
    expect(scoped.externalCoveredSet.size).toBe(1);

    // OP-100 existe na carteira P50 e também em P25 fora da carteira do preposto
    expect(scoped.sharedOpsSet.has('OP-100')).toBe(true);
    expect(scoped.sharedOpsSet.has('OP-200')).toBe(false);
  });
});
