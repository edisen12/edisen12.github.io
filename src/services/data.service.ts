// ==============================================================================
// Serviço de Dados (Fachada Agnóstica de Topologia)
// Delega as consultas e mutações para o provedor de banco de dados ativo
// Mantém exportJsonSnapshot como utilitário puro de contingência offline no cliente
// ==============================================================================

import type {
  AppDataset,
  ContractConfig,
  Justificativa,
  Pessoa,
  Plataforma,
  SystemAuditLog,
  Tecnico,
  UsoffUnWeight
} from '../domain/types';
import type {
  AuditLogFilterInput,
  BatchImportCarteiraOptions,
  BatchImportCarteiraRow,
  BatchImportConfirmacaoSAPRow,
  BatchImportHHRow,
  BatchImportPessoaRow,
  BatchImportPlataformaRow,
  CarteiraDedupSnapshot,
  ProgressCallback,
  SavePessoaInput
} from '../ports/data.port';
import { getClientDatabaseProvider } from './provider.registry';

/**
 * Carrega o dataset completo da aplicação para a janela de datas informada.
 */
export async function loadAppDataset(
  queryIni: string,
  queryFim: string,
  isGlobal: boolean
): Promise<AppDataset> {
  return getClientDatabaseProvider().data.loadAppDataset(queryIni, queryFim, isGlobal);
}

/**
 * Salva ou atualiza uma justificativa via chave natural (matricula, data).
 */
export async function saveJustificativa(just: Omit<Justificativa, 'id'>): Promise<void> {
  return getClientDatabaseProvider().data.saveJustificativa(just);
}

/**
 * Salva configurações gerais, pesos de UNs para USOFF e lista de e-mails de notificação.
 */
export async function saveConfiguracoes(
  cfg: ContractConfig,
  unWeights: UsoffUnWeight[],
  emailsResumo: string[]
): Promise<void> {
  return getClientDatabaseProvider().data.saveConfiguracoes(cfg, unWeights, emailsResumo);
}

/**
 * Salva ou atualiza uma plataforma no catálogo.
 */
export async function savePlataforma(
  plat: Partial<Plataforma> & { sigla: string }
): Promise<void> {
  return getClientDatabaseProvider().data.savePlataforma(plat);
}

/**
 * Remove uma plataforma do catálogo.
 */
export async function deletePlataforma(sigla: string): Promise<void> {
  return getClientDatabaseProvider().data.deletePlataforma(sigla);
}

/**
 * Salva ou atualiza um técnico offshore no cadastro mestre.
 */
export async function saveTecnico(tec: Tecnico): Promise<void> {
  return getClientDatabaseProvider().data.saveTecnico(tec);
}

/**
 * Remove um técnico offshore do cadastro mestre.
 */
export async function deleteTecnico(matricula: string, cascade?: boolean): Promise<void> {
  return getClientDatabaseProvider().data.deleteTecnico(matricula, cascade);
}

/**
 * Importa técnicos offshore em lote com callback de progresso.
 */
export async function batchImportTecnicos(
  rows: Array<{ matricula: string; nome: string; funcao: string }>,
  onProgress?: ProgressCallback
): Promise<void> {
  return getClientDatabaseProvider().data.batchImportTecnicos(rows, onProgress);
}

/**
 * Salva ou atualiza uma pessoa responsável e substitui suas atribuições de plataformas e UNs.
 */
export async function savePessoa(input: SavePessoaInput): Promise<Pessoa> {
  return getClientDatabaseProvider().data.savePessoa(input);
}

/**
 * Remove uma pessoa e suas relações associadas.
 */
export async function deletePessoa(id: string): Promise<void> {
  return getClientDatabaseProvider().data.deletePessoa(id);
}

/**
 * Importa lote de apontamentos HH diários em chunks determinísticos.
 */
export async function batchImportHH(
  rows: BatchImportHHRow[],
  pidx: Record<string, Plataforma>,
  onProgress?: ProgressCallback,
  origem = 'planilha (manual)'
): Promise<void> {
  return getClientDatabaseProvider().data.batchImportHH(rows, pidx, onProgress, origem);
}

/**
 * Importa lote de programações da Carteira de Embarques em chunks determinísticos.
 */
export async function batchImportCarteira(
  rows: BatchImportCarteiraRow[],
  pidx: Record<string, Plataforma>,
  onProgress?: ProgressCallback,
  origem = 'planilha (manual)',
  options?: BatchImportCarteiraOptions
): Promise<void> {
  return getClientDatabaseProvider().data.batchImportCarteira(rows, pidx, onProgress, origem, options);
}

/**
 * Busca retrato completo da carteira e operações existentes no banco para deduplicação inteligente.
 */
export async function fetchCarteiraDedupSnapshot(): Promise<CarteiraDedupSnapshot | null> {
  const provider = getClientDatabaseProvider();
  if (typeof provider.data.fetchCarteiraDedupSnapshot === 'function') {
    return provider.data.fetchCarteiraDedupSnapshot();
  }
  return null;
}

/**
 * Importa catálogo de plataformas em lote.
 */
export async function batchImportPlataformas(
  rows: BatchImportPlataformaRow[],
  onProgress?: ProgressCallback
): Promise<void> {
  return getClientDatabaseProvider().data.batchImportPlataformas(rows, onProgress);
}

/**
 * Importa pessoas e suas atribuições de carteira em lote.
 */
export async function batchImportPessoas(
  rows: BatchImportPessoaRow[],
  onProgress?: ProgressCallback
): Promise<void> {
  return getClientDatabaseProvider().data.batchImportPessoas(rows, onProgress);
}

/**
 * Importa lote de confirmações do SAP em chunks determinísticos.
 */
export async function batchImportConfirmacoesSAP(
  rows: BatchImportConfirmacaoSAPRow[],
  onProgress?: ProgressCallback
): Promise<any> {
  const provider = getClientDatabaseProvider();
  if (typeof provider.data.batchImportConfirmacoesSAP === 'function') {
    return provider.data.batchImportConfirmacoesSAP(rows, onProgress);
  }
}

/**
 * Dispara a reconciliação e batimento entre confirmações do SAP e ordens da carteira.
 */
export async function reconciliarConfirmacoesSAP(): Promise<any> {
  const provider = getClientDatabaseProvider();
  if (typeof provider.data.reconciliarConfirmacoesSAP === 'function') {
    return provider.data.reconciliarConfirmacoesSAP();
  }
}

/**
 * Reseta e limpa com segurança a carteira de operações e embarques para reimportação do zero.
 */
export async function resetCarteiraEmbarques(): Promise<{ deleted_operacoes: number; deleted_embarques: number }> {
  const provider = getClientDatabaseProvider();
  if (typeof provider.data.resetCarteiraEmbarques === 'function') {
    return provider.data.resetCarteiraEmbarques();
  }
  return { deleted_operacoes: 0, deleted_embarques: 0 };
}

/**
 * Consulta a trilha de auditoria do sistema com filtros opcionais.
 */
export async function fetchSystemAuditLogs(filters?: AuditLogFilterInput): Promise<SystemAuditLog[]> {
  return getClientDatabaseProvider().data.fetchSystemAuditLogs(filters);
}

/**
 * Solicita a exclusão definitiva da conta de um usuário.
 */
export async function deleteUserAccount(
  userId: string
): Promise<{ ok: boolean; message: string }> {
  return getClientDatabaseProvider().data.deleteUserAccount(userId);
}

/**
 * Registra um evento de auditoria no sistema.
 */
export async function logSystemEvent(event: Partial<SystemAuditLog>): Promise<void> {
  return getClientDatabaseProvider().data.logSystemEvent(event);
}

/**
 * Exporta snapshot JSON seguro para contingência offline (operação 100% no navegador).
 */
export function exportJsonSnapshot(dataset: AppDataset): void {
  const cleanSnapshot = {
    exportedAt: new Date().toISOString(),
    config: dataset.config,
    usoffUnWeights: dataset.usoffUnWeights,
    plataformas: dataset.plataformas,
    tecnicos: dataset.tecnicos,
    carteira: dataset.carteira,
    hhMap: dataset.hhMap,
    justMap: dataset.justMap,
    watermark: dataset.watermark
  };

  const jsonStr = JSON.stringify(cleanSnapshot, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `HH_Offshore_Backup_Contingencia_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
