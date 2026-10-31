// ==============================================================================
// Fixtures Sintéticas e Determinísticas para Testes de Integração e Unidade
// GARANTIA: Dados puramente simulados sem PII ou segredos reais
// ==============================================================================

import type {
  ApontamentoHH,
  CarteiraEmbarque,
  ContractConfig,
  FluxoImportacao,
  Justificativa,
  Pessoa,
  Plataforma,
  Tecnico,
  UserOnboarding,
  UserProfile,
  UsoffUnWeight,
  WatermarkStatus
} from '../domain/types';
import { DEFAULT_CONFIG, DEFAULT_USER_PREFERENCES } from '../config/constants';

// ------------------------------------------------------------------------------
// Usuários Sintéticos e Perfis RBAC
// ------------------------------------------------------------------------------

export const mockUsers = {
  admin: {
    id: 'user-admin-001',
    email: 'admin.teste@empresa.com.br',
    password: 'SenhaForte123!',
    role: 'admin' as const,
    nome: 'Administrador de Teste',
    ativo: true
  },
  gestor: {
    id: 'user-gestor-002',
    email: 'gestor.teste@empresa.com.br',
    password: 'SenhaForte123!',
    role: 'gestor' as const,
    nome: 'Gestor de Contrato Teste',
    ativo: true
  },
  preposto: {
    id: 'user-preposto-003',
    email: 'preposto.teste@empresa.com.br',
    password: 'SenhaProvisoria123!',
    role: 'preposto' as const,
    nome: 'Preposto Operacional Teste',
    ativo: true
  },
  controlador: {
    id: 'user-controlador-004',
    email: 'controlador.teste@empresa.com.br',
    password: 'SenhaForte123!',
    role: 'controlador' as const,
    nome: 'Controlador de Medição Teste',
    ativo: true
  },
  inativo: {
    id: 'user-inativo-005',
    email: 'inativo.teste@empresa.com.br',
    password: 'SenhaForte123!',
    role: 'preposto' as const,
    nome: 'Usuário Inativo Teste',
    ativo: false
  }
};

export const adminUser: UserProfile = {
  id: mockUsers.admin.id,
  email: mockUsers.admin.email,
  nome: mockUsers.admin.nome,
  role: mockUsers.admin.role,
  ativo: mockUsers.admin.ativo
};

export const gestorUser: UserProfile = {
  id: mockUsers.gestor.id,
  email: mockUsers.gestor.email,
  nome: mockUsers.gestor.nome,
  role: mockUsers.gestor.role,
  ativo: mockUsers.gestor.ativo
};

export const prepostoUser: UserProfile = {
  id: mockUsers.preposto.id,
  email: mockUsers.preposto.email,
  nome: mockUsers.preposto.nome,
  role: mockUsers.preposto.role,
  ativo: mockUsers.preposto.ativo
};

export const controladorUser: UserProfile = {
  id: mockUsers.controlador.id,
  email: mockUsers.controlador.email,
  nome: mockUsers.controlador.nome,
  role: mockUsers.controlador.role,
  ativo: mockUsers.controlador.ativo
};

export const mockProfiles: UserProfile[] = [
  adminUser,
  gestorUser,
  prepostoUser,
  controladorUser,
  {
    id: mockUsers.inativo.id,
    email: mockUsers.inativo.email,
    nome: mockUsers.inativo.nome,
    role: mockUsers.inativo.role,
    ativo: mockUsers.inativo.ativo
  }
];

// ------------------------------------------------------------------------------
// Estados de Onboarding (Primeiro Login vs Usuário Recorrente)
// ------------------------------------------------------------------------------

export const firstLoginOnboarding: UserOnboarding = {
  user_id: mockUsers.preposto.id,
  primeiro_login: true,
  obriga_troca_senha: true,
  senha_trocada_em: null,
  preferencias: { ...DEFAULT_USER_PREFERENCES }
};

export const normalOnboarding: UserOnboarding = {
  user_id: mockUsers.admin.id,
  primeiro_login: false,
  obriga_troca_senha: false,
  senha_trocada_em: '2026-01-15T09:30:00Z',
  preferencias: {
    ...DEFAULT_USER_PREFERENCES,
    themeMode: 'dark',
    density: 'compact'
  }
};

export const gestorOnboarding: UserOnboarding = {
  user_id: mockUsers.gestor.id,
  primeiro_login: false,
  obriga_troca_senha: false,
  senha_trocada_em: '2026-02-01T10:00:00Z',
  preferencias: { ...DEFAULT_USER_PREFERENCES }
};

export const controladorOnboarding: UserOnboarding = {
  user_id: mockUsers.controlador.id,
  primeiro_login: false,
  obriga_troca_senha: false,
  senha_trocada_em: '2026-02-15T10:00:00Z',
  preferencias: { ...DEFAULT_USER_PREFERENCES }
};

export const mockOnboardings: UserOnboarding[] = [
  normalOnboarding,
  gestorOnboarding,
  firstLoginOnboarding,
  controladorOnboarding
];

// ------------------------------------------------------------------------------
// Catálogo de Plataformas (Mobilizadas e Ativas)
// ------------------------------------------------------------------------------

export const mockPlatforms: Record<string, Plataforma> = {
  P50: {
    sigla: 'P50',
    chave_norm: 'p50',
    nome: 'P-50 (Albacora Leste)',
    un: 'Espírito Santo (UN-ES)',
    armador: 'Petrobras',
    gerencia: 'UO-ES',
    tipo: 'FPSO',
    situacao: 'Mobilizada',
    cadastro_pendente: false
  },
  P74: {
    sigla: 'P74',
    chave_norm: 'p74',
    nome: 'P-74 (Búzios)',
    un: 'Búzios (UN-BUZ)',
    armador: 'Petrobras',
    gerencia: 'UO-BUZ',
    tipo: 'FPSO',
    situacao: 'Mobilizada',
    cadastro_pendente: false
  },
  P25: {
    sigla: 'P25',
    chave_norm: 'p25',
    nome: 'P-25 (Albacora)',
    un: 'Bacia de Campos (UN-BC)',
    armador: 'Petrobras',
    gerencia: 'UO-BC',
    tipo: 'Semissubmersível',
    situacao: 'Mobilizada',
    cadastro_pendente: false
  },
  P58: {
    sigla: 'P58',
    chave_norm: 'p58',
    nome: 'P-58 (Baleia Azul)',
    un: 'Espírito Santo (UN-ES)',
    armador: 'Petrobras',
    gerencia: 'UO-ES',
    tipo: 'FPSO',
    situacao: 'Mobilizada',
    cadastro_pendente: false
  }
};

export const mockPlataformasRows = Object.values(mockPlatforms);

// ------------------------------------------------------------------------------
// Pessoas Operacionais e Atribuição de Escopo (Carteiras por Plataforma / UN)
// ------------------------------------------------------------------------------

export const prepostoPessoa: Pessoa = {
  id: 'pes-preposto-001',
  slug: 'preposto-teste',
  nome: 'Preposto Operacional Teste',
  papel: 'preposto',
  email: mockUsers.preposto.email,
  user_id: mockUsers.preposto.id,
  plats: ['P50', 'P74'],
  uns: []
};

export const gestorPessoa: Pessoa = {
  id: 'pes-gestor-002',
  slug: 'gestor-teste',
  nome: 'Gestor de Contrato Teste',
  papel: 'gestor',
  email: mockUsers.gestor.email,
  user_id: mockUsers.gestor.id,
  plats: [],
  uns: ['Espírito Santo (UN-ES)', 'Búzios (UN-BUZ)']
};

export const controladorPessoa: Pessoa = {
  id: 'pes-controlador-003',
  slug: 'controlador-teste',
  nome: 'Controlador de Medição Teste',
  papel: 'controlador',
  email: mockUsers.controlador.email,
  user_id: mockUsers.controlador.id,
  plats: ['P25'],
  uns: ['Bacia de Campos (UN-BC)']
};

export const mockPessoas: Record<string, Pessoa> = {
  [prepostoPessoa.id]: prepostoPessoa,
  [gestorPessoa.id]: gestorPessoa,
  [controladorPessoa.id]: controladorPessoa
};

export const mockPessoasRows = [
  {
    id: prepostoPessoa.id,
    slug: prepostoPessoa.slug,
    nome: prepostoPessoa.nome,
    papel: prepostoPessoa.papel,
    email: prepostoPessoa.email,
    user_id: prepostoPessoa.user_id
  },
  {
    id: gestorPessoa.id,
    slug: gestorPessoa.slug,
    nome: gestorPessoa.nome,
    papel: gestorPessoa.papel,
    email: gestorPessoa.email,
    user_id: gestorPessoa.user_id
  },
  {
    id: controladorPessoa.id,
    slug: controladorPessoa.slug,
    nome: controladorPessoa.nome,
    papel: controladorPessoa.papel,
    email: controladorPessoa.email,
    user_id: controladorPessoa.user_id
  }
];

export const mockPessoaPlataformasRows = [
  { pessoa_id: prepostoPessoa.id, plataforma_sigla: 'P50' },
  { pessoa_id: prepostoPessoa.id, plataforma_sigla: 'P74' },
  { pessoa_id: controladorPessoa.id, plataforma_sigla: 'P25' }
];

export const mockPessoaUnidadesRows = [
  { pessoa_id: gestorPessoa.id, unidade_negocio: 'Espírito Santo (UN-ES)' },
  { pessoa_id: gestorPessoa.id, unidade_negocio: 'Búzios (UN-BUZ)' },
  { pessoa_id: controladorPessoa.id, unidade_negocio: 'Bacia de Campos (UN-BC)' }
];

// ------------------------------------------------------------------------------
// Técnicos Especialistas
// ------------------------------------------------------------------------------

export const mockTecnicos: Record<string, Tecnico> = {
  '1001': { matricula: '1001', nome: 'Carlos Silva', funcao: 'Técnico de Automação' },
  '1002': { matricula: '1002', nome: 'Mariana Costa', funcao: 'Técnica de Instrumentação' },
  '1003': { matricula: '1003', nome: 'Roberto Dias', funcao: 'Técnico Mecânico' },
  '1004': { matricula: '1004', nome: 'Juliana Lima', funcao: 'Técnica de Elétrica' }
};

export const mockTecnicosRows = Object.values(mockTecnicos);

// ------------------------------------------------------------------------------
// Carteira de Embarques Programados
// ------------------------------------------------------------------------------

export const mockCarteiraRows: CarteiraEmbarque[] = [
  {
    id: 'cart-001',
    matricula: '1001',
    plataforma_sigla: 'P50',
    unidade_negocio: 'Espírito Santo (UN-ES)',
    data_inicio: '2026-10-01',
    data_fim: '2026-10-14',
    horas_programadas: 168,
    operacao: 'OP-100',
    pe: 1.05,
    ex: 1.02,
    fonte: 'carteira'
  },
  {
    id: 'cart-002',
    matricula: '1002',
    plataforma_sigla: 'P74',
    unidade_negocio: 'Búzios (UN-BUZ)',
    data_inicio: '2026-10-05',
    data_fim: '2026-10-18',
    horas_programadas: 168,
    operacao: 'OP-200',
    pe: 1.15,
    ex: 1.10,
    fonte: 'carteira'
  },
  {
    id: 'cart-003',
    matricula: '1003',
    plataforma_sigla: 'P25',
    unidade_negocio: 'Bacia de Campos (UN-BC)',
    data_inicio: '2026-10-10',
    data_fim: '2026-10-24',
    horas_programadas: 168,
    operacao: 'OP-300',
    pe: 1.00,
    ex: 1.00,
    fonte: 'carteira'
  }
];

// ------------------------------------------------------------------------------
// Apontamentos Diários de HH
// ------------------------------------------------------------------------------

export const mockApontamentosHHRows: ApontamentoHH[] = [
  {
    id: 'hh-001',
    matricula: '1001',
    data: '2026-10-01',
    plataforma_sigla: 'P50',
    unidade_negocio: 'Espírito Santo (UN-ES)',
    horas_executadas: 12
  },
  {
    id: 'hh-002',
    matricula: '1001',
    data: '2026-10-02',
    plataforma_sigla: 'P50',
    unidade_negocio: 'Espírito Santo (UN-ES)',
    horas_executadas: 12
  },
  {
    id: 'hh-003',
    matricula: '1001',
    data: '2026-10-03',
    plataforma_sigla: 'P50',
    unidade_negocio: 'Espírito Santo (UN-ES)',
    horas_executadas: 0
  },
  {
    id: 'hh-004',
    matricula: '1002',
    data: '2026-10-05',
    plataforma_sigla: 'P74',
    unidade_negocio: 'Búzios (UN-BUZ)',
    horas_executadas: 12
  },
  {
    id: 'hh-005',
    matricula: '1002',
    data: '2026-10-06',
    plataforma_sigla: 'P74',
    unidade_negocio: 'Búzios (UN-BUZ)',
    horas_executadas: 8
  }
];

// ------------------------------------------------------------------------------
// Justificativas Operacionais
// ------------------------------------------------------------------------------

export const mockJustificativasRows: Justificativa[] = [
  {
    id: 'jus-001',
    matricula: '1001',
    data: '2026-10-03',
    motivo: 'Condições climáticas desfavoráveis (gangway desconectado)',
    horas_gangway: 12,
    descricao: 'Ressaca marítima impossibilitou a conexão segura da passarela offshore.',
    responsavel_nome: 'Preposto Operacional Teste',
    criado_por: mockUsers.preposto.id,
    criado_em: '2026-10-03T19:00:00Z',
    updated_by: null,
    updated_at: '2026-10-03T19:00:00Z'
  }
];

// ------------------------------------------------------------------------------
// Pesos USOFF por UN e Configurações Gerais
// ------------------------------------------------------------------------------

export const mockUsoffUnWeights: UsoffUnWeight[] = [
  { unidade_negocio: 'Espírito Santo (UN-ES)', pe: 1.05, ex: 1.02 },
  { unidade_negocio: 'Búzios (UN-BUZ)', pe: 1.15, ex: 1.10 },
  { unidade_negocio: 'Bacia de Campos (UN-BC)', pe: 1.00, ex: 1.00 }
];

export const mockContractConfig: ContractConfig = {
  ...DEFAULT_CONFIG,
  id: 'geral',
  hh_dia: 12,
  meta_percentual: 90,
  atencao_percentual: 75,
  dias_embarque: 14,
  dia_corte_medicao: 1,
  prazo_justificativa_dias: 3,
  med_criterio: 'dias',
  us_pe_padrao: 1.0,
  us_ex_padrao: 1.0,
  slogan: 'Gestão Inteligente de HH Offshore · Ambiente de Teste',
  regionais_extras: ['Espírito Santo (UN-ES)', 'Búzios (UN-BUZ)', 'Bacia de Campos (UN-BC)']
};

export const mockWatermark: WatermarkStatus = {
  ultima_data_hh: '2026-10-06',
  ultima_importacao_em: '2026-10-06T18:30:00Z'
};

export const mockLatestFluxo: FluxoImportacao = {
  id: 'fluxo-001',
  tipo_fluxo: 'hh',
  origem: 'planilha (manual)',
  total_linhas: 5,
  data_maxima: '2026-10-06',
  observacao: 'Importação inicial de teste sintético',
  criado_em: '2026-10-06T18:30:00Z'
};

// ------------------------------------------------------------------------------
// Gerador de Estado Inicial Limpo para Banco Mock
// ------------------------------------------------------------------------------

export function createInitialMockDatabaseState() {
  return {
    authUsers: [
      {
        id: mockUsers.admin.id,
        email: mockUsers.admin.email,
        password: mockUsers.admin.password,
        ativo: mockUsers.admin.ativo
      },
      {
        id: mockUsers.gestor.id,
        email: mockUsers.gestor.email,
        password: mockUsers.gestor.password,
        ativo: mockUsers.gestor.ativo
      },
      {
        id: mockUsers.preposto.id,
        email: mockUsers.preposto.email,
        password: mockUsers.preposto.password,
        ativo: mockUsers.preposto.ativo
      },
      {
        id: mockUsers.controlador.id,
        email: mockUsers.controlador.email,
        password: mockUsers.controlador.password,
        ativo: mockUsers.controlador.ativo
      },
      {
        id: mockUsers.inativo.id,
        email: mockUsers.inativo.email,
        password: mockUsers.inativo.password,
        ativo: mockUsers.inativo.ativo,
        banned: true
      }
    ],
    currentUser: {
      id: mockUsers.admin.id,
      email: mockUsers.admin.email
    },
    tables: {
      profiles: JSON.parse(JSON.stringify(mockProfiles)),
      user_onboarding: JSON.parse(JSON.stringify(mockOnboardings)),
      plataformas: JSON.parse(JSON.stringify(mockPlataformasRows)),
      pessoas: JSON.parse(JSON.stringify(mockPessoasRows)),
      pessoa_plataformas: JSON.parse(JSON.stringify(mockPessoaPlataformasRows)),
      pessoa_unidades: JSON.parse(JSON.stringify(mockPessoaUnidadesRows)),
      tecnicos: JSON.parse(JSON.stringify(mockTecnicosRows)),
      carteira_embarques: JSON.parse(JSON.stringify(mockCarteiraRows)),
      apontamentos_hh: JSON.parse(JSON.stringify(mockApontamentosHHRows)),
      justificativas: JSON.parse(JSON.stringify(mockJustificativasRows)),
      configuracoes: [JSON.parse(JSON.stringify(mockContractConfig))],
      config_usoff_un: JSON.parse(JSON.stringify(mockUsoffUnWeights)),
      configuracoes_notificacao: [
        {
          id: 'geral',
          emails_resumo: ['gestor.teste@empresa.com.br', 'admin.teste@empresa.com.br'],
          updated_at: '2026-10-01T00:00:00Z'
        }
      ],
      fluxo_importacoes: [JSON.parse(JSON.stringify(mockLatestFluxo))]
    }
  };
}
