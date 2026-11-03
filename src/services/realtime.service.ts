// ==============================================================================
// Serviço Realtime (Fachada Agnóstica de Topologia)
// Delega a subscrição de atualizações colaborativas para o provedor ativo
// ==============================================================================

import { getClientDatabaseProvider } from './provider.registry';

/**
 * Assina atualizações em tempo real no banco de dados ativo com debounce consolidado.
 * Retorna uma função de limpeza (unsubscribe) para uso em efeitos colaterais (useEffect).
 */
export function subscribeToRealtimeUpdates(onChange: () => void): () => void {
  return getClientDatabaseProvider().realtime.subscribeToRealtimeUpdates(onChange);
}
