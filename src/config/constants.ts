import type { ContractConfig, PapelOperacional, SystemRole, TabId, UserPreferences } from '../domain/types';

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  themeMode: 'light',
  density: 'comfortable',
  defaultTab: 'ger',
  pageSize: 50
};

export const DEFAULT_CONFIG: ContractConfig = {
  id: 'geral',
  hh_dia: 11,
  meta_percentual: 100,
  atencao_percentual: 90,
  dias_embarque: 14,
  dia_corte_medicao: 21,
  prazo_justificativa_dias: 2,
  med_criterio: 'enc',
  us_pe_padrao: null,
  us_ex_padrao: null,
  slogan: '',
  regionais_extras: []
};

export const PAPEIS_LABEL: Record<PapelOperacional, string> = {
  preposto: 'Preposto',
  controlador: 'Controlador',
  gestor: 'Gestor'
};

export const PAPEIS_PLURAL: Record<PapelOperacional, string> = {
  preposto: 'Prepostos',
  controlador: 'Controladores',
  gestor: 'Gestores'
};

export const ROLES_LABEL: Record<SystemRole, string> = {
  admin: 'Administrador',
  gestor: 'Gestor do Contrato',
  controlador: 'Controlador',
  preposto: 'Preposto'
};

export const MOTIVOS_JUSTIFICATIVA = [
  'Gangway desconectada',
  'Condições de mar ou clima',
  'Falta de material ou sobressalente',
  'Aguardando permissão de trabalho',
  'Parada ou restrição da plataforma',
  'Treinamento, reunião ou simulado',
  'Problema de ordem de manutenção (OM)',
  'Atestado ou desembarque antecipado',
  'Deslocamento ou transbordo',
  'Outro'
] as const;

export const SITUACOES_PLATAFORMA = [
  'Mobilizada',
  'Mobilizando',
  'Desmobilizando',
  'Desmobilizada'
] as const;

export const OPCOES_DIA_CORTE: Array<{ value: 1 | 16 | 21 | 26; label: string }> = [
  { value: 21, label: 'Dia 21 ao dia 20' },
  { value: 1, label: 'Dia 1 ao último dia do mês' },
  { value: 26, label: 'Dia 26 ao dia 25' },
  { value: 16, label: 'Dia 16 ao dia 15' }
];

export const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
] as const;

export interface NavSectionItem {
  id: TabId;
  label: string;
  group: 'operacao' | 'medicao' | 'admin';
  globalOnly?: boolean;
}

export const NAV_TABS: NavSectionItem[] = [
  { id: 'ger', label: 'Visão geral', group: 'operacao' },
  { id: 'dia', label: 'Painel do dia', group: 'operacao' },
  { id: 'emb', label: 'Embarque atual', group: 'operacao' },
  { id: 'jus', label: 'Justificativas', group: 'operacao' },
  { id: 'med', label: 'Medição e relatórios', group: 'medicao' },
  { id: 'us', label: 'Medição USOFF', group: 'medicao' },
  { id: 'pes', label: 'Pessoas, plataformas e acessos', group: 'admin', globalOnly: true },
  { id: 'imp', label: 'Importar dados', group: 'admin', globalOnly: true },
  { id: 'cfg', label: 'Configurações', group: 'admin', globalOnly: true },
  { id: 'adm', label: 'Painel do Administrador', group: 'admin', globalOnly: true }
];

export const TAB_TITLES: Record<TabId, string> = {
  ger: 'Visão geral',
  dia: 'Painel do dia',
  emb: 'Embarque atual',
  jus: 'Justificativas',
  med: 'Medição e relatórios',
  us: 'Medição USOFF',
  pes: 'Pessoas, plataformas e acessos',
  imp: 'Importar dados',
  cfg: 'Configurações do Contrato',
  adm: 'Painel do Administrador & Governança',
  perfil: 'Configurações do Usuário'
};
