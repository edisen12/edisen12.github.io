// ==============================================================================
// Porta de Persistência Universal: Abstração de 7 Primitivas
// Permite conectar qualquer mecanismo de banco de dados (SQL, NoSQL, NewSQL, KV)
// ==============================================================================

import type {
  ContractConfig,
  UsoffUnWeight,
  Plataforma,
  Pessoa,
  Tecnico,
  CarteiraEmbarque,
  ApontamentoHH,
  Justificativa,
  FluxoImportacao,
  UserProfile,
  UserOnboarding,
  SystemAuditLog
} from '../../../src/domain/types';

/**
 * Coleções lógicas do domínio HH Offshore.
 */
export type LogicalCollection =
  | 'configuracoes'
  | 'config_usoff_un'
  | 'configuracoes_notificacao'
  | 'plataformas'
  | 'tecnicos'
  | 'profiles'
  | 'auth_credentials'
  | 'auth_sessions'
  | 'user_onboarding'
  | 'pessoas'
  | 'carteira_embarques'
  | 'apontamentos_hh'
  | 'justificativas'
  | 'justificativas_audit_log'
  | 'fluxo_importacoes'
  | 'system_audit_logs';

/**
 * Condição atômica aplicada a um campo individual em filtros de consulta.
 * Suporta valor escalar (igualdade implícita) ou operadores estruturados.
 */
export type FieldCondition<V = unknown> =
  | V
  | {
      eq?: V;
      in?: V[];
      gte?: string | number;
      lte?: string | number;
    };

/**
 * Mapa de filtros por nome de campo.
 */
export type StorageFilter = Record<string, FieldCondition<any>>;

/**
 * Opções de consulta janelada e ordenada.
 */
export interface StorageQueryOptions {
  filter?: StorageFilter;
  orderBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
  offset?: number;
}

/**
 * Registro de credencial de autenticação local (isolado no servidor).
 */
export interface AuthCredentialRow {
  user_id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

/**
 * Registro de sessão autenticada com CSRF token.
 */
export interface AuthSessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
  created_at: string;
}

/**
 * Configuração de destinatários de notificações e alertas.
 */
export interface ConfiguracoesNotificacaoRow {
  id: string;
  emails_resumo: string[];
  updated_at: string;
}

/**
 * Trilha de auditoria histórica de alterações em justificativas.
 */
export interface JustificativaAuditLogRow {
  id: string;
  justificativa_id?: string | null;
  matricula: string;
  data: string;
  action: 'insert' | 'update' | 'delete';
  motivo_antigo?: string | null;
  motivo_novo?: string | null;
  horas_gangway_antigo?: number | null;
  horas_gangway_novo?: number | null;
  descricao_antiga?: string | null;
  descricao_nova?: string | null;
  alterado_por: string;
  alterado_em: string;
}

/**
 * Mapeamento entre nome da coleção lógica e seu tipo TypeScript nativo.
 */
export interface CollectionRowTypeMap {
  configuracoes: ContractConfig;
  config_usoff_un: UsoffUnWeight;
  configuracoes_notificacao: ConfiguracoesNotificacaoRow;
  plataformas: Plataforma;
  tecnicos: Tecnico;
  profiles: UserProfile;
  auth_credentials: AuthCredentialRow;
  auth_sessions: AuthSessionRow;
  user_onboarding: UserOnboarding;
  pessoas: Pessoa;
  carteira_embarques: CarteiraEmbarque;
  apontamentos_hh: ApontamentoHH;
  justificativas: Justificativa;
  justificativas_audit_log: JustificativaAuditLogRow;
  fluxo_importacoes: FluxoImportacao;
  system_audit_logs: SystemAuditLog;
}

/**
 * Interface universal de 7 primitivas que isola qualquer banco de dados do motor de domínio.
 */
export interface UniversalStorageDriverPort {
  /** Identificador legível do driver (ex: 'in-memory', 'generic-sql:pg', 'generic-doc:mongodb') */
  readonly driverId: string;

  /** Inicialização assíncrona de conexões, pools ou schemas */
  init(): Promise<void>;

  /** Fechamento gracioso de conexões e pools */
  close(): Promise<void>;

  /** Busca um único registro correspondente ao filtro */
  findOne<T extends Record<string, any>>(
    collection: LogicalCollection,
    filter: StorageFilter
  ): Promise<T | null>;

  /** Busca múltiplos registros com opções de filtragem, ordenação e paginação */
  findMany<T extends Record<string, any>>(
    collection: LogicalCollection,
    options?: StorageQueryOptions
  ): Promise<T[]>;

  /**
   * Gravação ou atualização em lote com base em chaves de conflito naturais.
   * Lança erro caso executado sobre coleções imutáveis (Política WORM).
   */
  upsertMany<T extends Record<string, any>>(
    collection: LogicalCollection,
    rows: T[],
    conflictKeys: string[]
  ): Promise<void>;

  /**
   * Remoção em lote de registros com base em filtro.
   * Lança erro caso executado sobre coleções imutáveis (Política WORM).
   * Retorna a quantidade de registros removidos.
   */
  deleteMany(
    collection: LogicalCollection,
    filter: StorageFilter
  ): Promise<number>;

  /**
   * Gravação exclusiva por anexação imutável (WORM).
   * Não aceita atualização nem sobrescrita.
   */
  appendImmutable<T extends Record<string, any>>(
    collection: LogicalCollection,
    row: T
  ): Promise<void>;

  /**
   * Execução atômica dentro de transação, quando suportada pelo driver subjacente.
   */
  runInTransaction?<T>(
    work: (txDriver: UniversalStorageDriverPort) => Promise<T>
  ): Promise<T>;
}
