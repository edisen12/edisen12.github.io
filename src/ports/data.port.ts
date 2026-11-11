// ==============================================================================
// Porta de Dados do Cliente (Frontend Client Data Port)
// Define os contratos de persistência, consultas operacionais e importações em lote
// Paridade exata com os 14 métodos de persistência do serviço de dados
// ==============================================================================

import type {
  AppDataset,
  ContractConfig,
  Justificativa,
  PapelOperacional,
  Pessoa,
  Plataforma,
  SystemAuditLog,
  Tecnico,
  UsoffUnWeight
} from '../domain/types';

export type ProgressCallback = (gravadas: number, total: number) => void;

export interface SavePessoaInput {
  id?: string;
  nome: string;
  papel: PapelOperacional;
  email: string;
  plats: string[];
  uns: string[];
}

export interface BatchImportHHRow {
  mat: string;
  nome?: string;
  funcao?: string;
  p: string;
  r?: string;
  D: string;
  e: number;
}

export interface BatchImportCarteiraRow {
  mat: string;
  nome?: string;
  funcao?: string;
  plat: string;
  reg?: string;
  ini: string;
  fim: string;
  hp?: number | null;
  op?: string;
  id_embarque?: string;
  ordem?: string;
  status_prog?: string;
  hc_portal?: number | null;
  chave?: string;
  empresa?: string;
  recursos?: any;
  pe?: number | null;
  ex?: number | null;
}

export interface BatchImportPlataformaRow {
  sigla: string;
  nome?: string;
  un?: string;
  armador?: string;
  tipo?: string;
  situacao?: string;
}

export interface BatchImportConfirmacaoSAPRow {
  mat: string;
  cria: string;
  lanc: string;
  real: string;
  ordem: string;
  op: string;
  hc: number;
  contador?: number;
}

export interface BatchImportPessoaRow {
  nome: string;
  papel: PapelOperacional;
  email: string;
  plats: string[];
  uns: string[];
}

export interface AuditLogFilterInput {
  category?: string;
  search?: string;
  limit?: number;
}

export interface ClientDataPort {
  loadAppDataset(queryIni: string, queryFim: string, isGlobal: boolean): Promise<AppDataset>;
  saveJustificativa(just: Omit<Justificativa, 'id'>): Promise<void>;
  saveConfiguracoes(cfg: ContractConfig, unWeights: UsoffUnWeight[], emailsResumo: string[]): Promise<void>;
  savePlataforma(plat: Partial<Plataforma> & { sigla: string }): Promise<void>;
  deletePlataforma(sigla: string): Promise<void>;
  saveTecnico(tec: Tecnico): Promise<void>;
  deleteTecnico(matricula: string): Promise<void>;
  savePessoa(input: SavePessoaInput): Promise<Pessoa>;
  deletePessoa(id: string): Promise<void>;
  batchImportHH(
    rows: BatchImportHHRow[],
    pidx: Record<string, Plataforma>,
    onProgress?: ProgressCallback,
    origem?: string
  ): Promise<void>;
  batchImportCarteira(
    rows: BatchImportCarteiraRow[],
    pidx: Record<string, Plataforma>,
    onProgress?: ProgressCallback,
    origem?: string
  ): Promise<void>;
  batchImportPlataformas(
    rows: BatchImportPlataformaRow[],
    onProgress?: ProgressCallback
  ): Promise<void>;
  batchImportPessoas(
    rows: BatchImportPessoaRow[],
    onProgress?: ProgressCallback
  ): Promise<void>;
  batchImportTecnicos(
    rows: Array<{ matricula: string; nome: string; funcao: string }>,
    onProgress?: ProgressCallback
  ): Promise<void>;
  batchImportConfirmacoesSAP?(
    rows: BatchImportConfirmacaoSAPRow[],
    onProgress?: ProgressCallback
  ): Promise<any>;
  reconciliarConfirmacoesSAP?(): Promise<any>;
  resetCarteiraEmbarques?(): Promise<{ deleted_operacoes: number; deleted_embarques: number }>;
  fetchSystemAuditLogs(filters?: AuditLogFilterInput): Promise<SystemAuditLog[]>;
  deleteUserAccount(userId: string): Promise<{ ok: boolean; message: string }>;
  logSystemEvent(event: Partial<SystemAuditLog>): Promise<void>;
}
