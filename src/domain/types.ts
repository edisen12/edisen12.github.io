// Contrato central de tipos compartilhado entre Domínio, Serviços e Views React

export type SystemRole = 'admin' | 'gestor' | 'controlador' | 'preposto';
export type PapelOperacional = 'preposto' | 'controlador' | 'gestor';
export type MedCriterio = 'enc' | 'dias';
export type DiaCorteMedicao = 1 | 16 | 21 | 26;
export type StatusMeta = 'ok' | 'warn' | 'bad' | 'sem' | 'info';
export type TabId = 'ger' | 'dia' | 'emb' | 'jus' | 'med' | 'us' | 'pes' | 'imp' | 'cfg' | 'perfil';
export type ImportKind = 'hh' | 'cart' | 'plat' | 'pes';
export type ThemeMode = 'light' | 'dark' | 'system';
export type TableDensity = 'comfortable' | 'compact';

export interface UserPreferences {
  themeMode: ThemeMode;
  density: TableDensity;
  defaultTab: Exclude<TabId, 'perfil'>;
  pageSize: 25 | 50 | 100;
}

export interface UserOnboarding {
  user_id: string;
  primeiro_login: boolean;
  obriga_troca_senha: boolean;
  senha_trocada_em: string | null;
  preferencias: UserPreferences;
}

export interface UserProfile {
  id: string;
  email: string;
  nome: string;
  role: SystemRole;
  ativo: boolean;
}

export interface Plataforma {
  sigla: string;
  chave_norm: string;
  nome: string;
  un: string;
  armador: string;
  gerencia: string;
  tipo: string;
  situacao: string;
  cadastro_pendente: boolean;
}

export interface Pessoa {
  id: string;
  slug: string;
  nome: string;
  papel: PapelOperacional;
  email: string;
  user_id: string | null;
  plats: string[];
  uns: string[];
}

export interface Tecnico {
  matricula: string;
  nome: string;
  funcao: string;
}

export interface CarteiraEmbarque {
  id: string;
  matricula: string;
  nome?: string;
  funcao?: string;
  plataforma_sigla: string;
  unidade_negocio: string;
  data_inicio: string; // YYYY-MM-DD
  data_fim: string;    // YYYY-MM-DD
  horas_programadas: number | null;
  operacao: string;
  pe: number | null;
  ex: number | null;
  fonte: string;
}

export interface ApontamentoHH {
  id?: string;
  matricula: string;
  data: string; // YYYY-MM-DD
  plataforma_sigla: string;
  unidade_negocio: string;
  horas_executadas: number;
}

export interface Justificativa {
  id?: string;
  matricula: string;
  data: string; // YYYY-MM-DD
  motivo: string;
  horas_gangway: number;
  descricao: string;
  responsavel_nome: string;
  criado_por?: string | null;
  criado_em?: string;
  updated_by?: string | null;
  updated_at?: string;
}

export interface ContractConfig {
  id: string;
  hh_dia: number;
  meta_percentual: number;
  atencao_percentual: number;
  dias_embarque: number;
  dia_corte_medicao: DiaCorteMedicao;
  prazo_justificativa_dias: number;
  med_criterio: MedCriterio;
  us_pe_padrao: number | null;
  us_ex_padrao: number | null;
  slogan: string;
  regionais_extras: string[];
}

export interface UsoffUnWeight {
  unidade_negocio: string;
  pe: number | null;
  ex: number | null;
}

export interface FluxoImportacao {
  id: string;
  tipo_fluxo: 'hh' | 'carteira' | 'plataformas' | 'pessoas' | 'manual';
  origem: string;
  total_linhas: number;
  data_maxima: string | null;
  observacao: string;
  criado_em: string;
}

export interface WatermarkStatus {
  ultima_data_hh: string | null;
  ultima_importacao_em: string | null;
}

export interface PeriodWindow {
  ini: string; // YYYY-MM-DD
  fim: string; // YYYY-MM-DD
  m: string;   // YYYY-MM
  custom?: boolean;
}

export interface ResolvedPlace {
  p: string; // sigla da plataforma ou 'Sem plataforma'
  r: string; // unidade de negócio ou 'Sem unidade'
}

export interface ResolvedRecord {
  d: number;      // HH disponível (ex: 11)
  e: number;      // HH executado
  p: string;      // plataforma bruta
  r: string;      // UN bruta
  sem: boolean;   // true = "Não chegou" (previsto na carteira até LAST, conta 0 h)
}

export interface EmbarkationInfo {
  ini: string;
  fim: string;
  dia: number;
  n: number;
  plat: string;
  reg: string;
  fonte: 'carteira' | 'apontamentos';
  hp: number;
  hpF: string;
}

export interface EmbarkationAccum {
  d: number;
  e: number;
  gw: number;
  dias: number;
  p: number | null;
  saldo: number;
  prog: number;
  progAte: number;
  pAj: number | null;
}

export interface DayTechRow {
  mat: string;
  nome: string;
  D: string;
  p: string;
  r: string;
  d: number;
  e: number;
  sem: boolean;
  pc: number | null;
  st: StatusMeta;
  emb: EmbarkationInfo | null;
  acc: EmbarkationAccum | null;
  j: Justificativa | null;
}

export interface PeriodDayEntry {
  mat: string;
  D: string;
  p: string;
  r: string;
  d: number;
  e: number;
  sem: boolean;
  j: Justificativa | null;
}

export interface AggregatedMetrics {
  d: number;
  e: number;
  n: number;
  inf: number;
  pend: number;
  venc: number;
  gw: number;
  tec: number;
  abAcc: number;
  p: number | null;
  saldo: number;
  pInf: number | null;
  st: StatusMeta;
  mats: Record<string, { d: number; e: number; inf: number }>;
  plats: Set<string>;
  regs: Set<string>;
}

export interface PeriodTechSummary {
  mat: string;
  nome: string;
  d: number;
  e: number;
  gw: number;
  dias: number;
  semAp: number;
  pend: number;
  jus: number;
  plats: Set<string>;
  regs: Set<string>;
  list: PeriodDayEntry[];
  embs: string;
  cartDias: number;
  prog: number;
  progAte: number;
  pProg: number | null;
  p: number | null;
  pAj: number | null;
  st: StatusMeta;
}

export interface CobrancaStats {
  need: number;
  ok: number;
  pend: number;
  venc: number;
  noPrazo: number;
  fora: number;
  tempo: number[];
  oldest: string;
  plats: Set<string>;
  mats: Set<string>;
  pJ: number | null;
  tMed: number | null;
  atraso: number;
  st: StatusMeta;
  stTxt: string;
}

export interface UsoffOperationRow {
  key: string;
  op: string;
  tipo: 'Operação' | 'Embarque' | 'Sem programação';
  fonte: string;
  mats: Set<string>;
  plats: Set<string>;
  regs: Set<string>;
  ini: string;
  fim: string;
  dias: number;
  hp: number;
  hpAte: number;
  hd: number;
  hc: number;
  peHp: number;
  exHc: number;
  pes: Set<number>;
  exs: Set<number>;
  falta: boolean;
  us: number | null;
  pD: number | null;
  pP: number | null;
  sharedAcrossPortfolios?: boolean;
}

export interface UsoffSummary {
  n: number;
  hp: number;
  hpAte: number;
  hd: number;
  hc: number;
  peHp: number;
  exHc: number;
  falta: number;
  us: number | null;
  pD: number | null;
  pP: number | null;
}

export interface FilterState {
  fDate: string;
  fReg: string;
  fPlat: string;
  fResp: string;
  fPer: string; // 'YYYY-MM' | 'custom' | ''
  cIni: string;
  cFim: string;
}

export interface AppDataset {
  config: ContractConfig;
  usoffUnWeights: Record<string, UsoffUnWeight>;
  emailsResumo: string[];
  plataformas: Record<string, Plataforma>;
  pessoas: Record<string, Pessoa>;
  profiles: Record<string, UserProfile>;
  onboardingMap?: Record<string, UserOnboarding>;
  tecnicos: Record<string, Tecnico>;
  carteira: CarteiraEmbarque[];
  hhMap: Record<string, ApontamentoHH>; // chave: `${matricula}|${data}`
  justMap: Record<string, Justificativa>; // chave: `${matricula}|${data}`
  externalCoveredSet: Set<string>; // conjunto `${matricula}|${data}`
  sharedOpsSet: Set<string>; // conjunto de códigos OP compartilhados com outras carteiras
  watermark: WatermarkStatus;
  latestFluxo: FluxoImportacao | null;
  isDemo: boolean;
  demoReason: string;
}
