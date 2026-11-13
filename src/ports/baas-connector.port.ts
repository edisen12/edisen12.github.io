// ==============================================================================
// Porta Conectora BaaS (BaaS Connector Port)
// Primitivas de baixo nível para integração com qualquer backend como serviço
// (Supabase, Firebase, PocketBase, Appwrite, Amplify, Convex, etc.)
// ==============================================================================

import type {
  ContractConfig,
  PapelOperacional,
  Pessoa,
  SystemAuditLog,
  UserPreferences,
  UsoffUnWeight
} from '../domain/types';
import type {
  AdminManageUserResult,
  AuthSessionResult,
  AuthenticatedUserScope
} from './auth.port';

export interface RawBaaSDatasetPayload {
  configRow?: Record<string, unknown> | null;
  usoffWeightRows?: Array<Record<string, unknown>> | null;
  plataformaRows: Array<Record<string, unknown>>;
  pessoaRows: Array<Record<string, unknown>>;
  tecnicoRows: Array<Record<string, unknown>>;
  carteiraRows: Array<Record<string, unknown>>;
  carteiraOperacaoRows?: Array<Record<string, unknown>> | null;
  confirmacaoSapRows?: Array<Record<string, unknown>> | null;
  hhRows: Array<Record<string, unknown>>;
  justificativaRows: Array<Record<string, unknown>>;
  watermarkRow?:
    | { ultima_data_hh?: string | null; ultima_importacao_em?: string | null }
    | Array<{ ultima_data_hh?: string | null; ultima_importacao_em?: string | null }>
    | null;
  profileRows?: Array<Record<string, unknown>> | null;
  onboardingRows?: Array<Record<string, unknown>> | null;
  emailsResumo?: string[] | null;
  latestFluxoRow?: Record<string, unknown> | null;
  externalCoveredRows?: Array<{ matricula: string; data: string }> | null;
  sharedOps?: string[] | null;
  resolveSharedOps?: (uniqueOps: string[]) => Promise<string[]>;
}

export interface BaaSConnectorPort {
  readonly providerId: string;

  // Primitivas de Autenticação
  signIn(cleanEmail: string, password: string): Promise<AuthSessionResult>;
  signOut(): Promise<void>;
  changePasswordAndConfirmFirstLogin(newPassword: string): Promise<void>;
  updateOwnProfile(cleanNome: string, preferencias?: UserPreferences): Promise<void>;
  fetchCurrentUserScope(): Promise<AuthenticatedUserScope | null>;
  invokeAdminUsers(payload: Record<string, unknown>): Promise<AdminManageUserResult>;

  // Primitivas de Dados
  fetchRawDataset(queryIni: string, queryFim: string, isGlobal: boolean): Promise<RawBaaSDatasetPayload>;
  upsertJustificativa(cleanRecord: {
    matricula: string;
    data: string;
    motivo: string;
    horas_gangway: number;
    descricao: string;
    responsavel_nome: string;
  }): Promise<void>;
  saveConfiguracoesBundle(
    cfg: ContractConfig,
    unWeights: UsoffUnWeight[],
    emailsResumo: string[]
  ): Promise<void>;
  upsertPlataformasChunk(rows: Array<Record<string, unknown>>): Promise<void>;
  deletePlataforma(sigla: string): Promise<void>;
  savePessoaWithScopes(input: {
    id?: string;
    slug: string;
    nome: string;
    papel: PapelOperacional;
    email: string;
    plats: string[];
    uns: string[];
  }): Promise<Pessoa>;
  deletePessoa(id: string): Promise<void>;
  upsertTecnicosChunk(rows: Array<{ matricula: string; nome: string; funcao: string }>): Promise<void>;
  deleteTecnico?(matricula: string, cascade?: boolean): Promise<void>;
  upsertApontamentosChunk(rows: Array<Record<string, unknown>>): Promise<void>;
  upsertCarteiraChunk(rows: Array<Record<string, unknown>>): Promise<void>;
  upsertCarteiraOperacoesChunk?(rows: Array<Record<string, unknown>>): Promise<void>;
  upsertConfirmacoesSAPChunk?(rows: Array<Record<string, unknown>>): Promise<void>;
  pruneStaleCarteiraByEmbarquesRPC?(
    embarqueIds: string[],
    keepOps: Array<{
      id_embarque: string;
      matricula: string;
      data_inicio: string;
      ordem: string;
      operacao: string;
    }>
  ): Promise<{ deleted_operacoes: number }>;
  fetchAllCarteiraForDedup?(): Promise<{ carteiraRows: any[]; carteiraOperacaoRows: any[] }>;
  fetchAllSapForDedup?(): Promise<any[]>;
  reconciliarConfirmacoesSAPRPC?(): Promise<any>;
  resetCarteiraEmbarquesRPC?(): Promise<{ deleted_operacoes: number; deleted_embarques: number }>;
  insertFluxoImportacao(row: {
    tipo_fluxo: 'hh' | 'carteira';
    origem: string;
    total_linhas: number;
    data_maxima: string | null;
    observacao: string;
  }): Promise<void>;
  fetchRawAuditLogs(filters?: { category?: string; limit?: number }): Promise<SystemAuditLog[]>;
  insertAuditLog(event: Partial<SystemAuditLog>): Promise<void>;

  // Primitiva de Tempo Real
  subscribeRawChanges(trigger: () => void): () => void;
}
