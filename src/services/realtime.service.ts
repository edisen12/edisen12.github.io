// ==============================================================================
// Serviço Realtime Cirúrgico: Sincronização Multiusuário Leve
// Escuta apenas justificativas e sync_heartbeat com debounce de 450ms
// ==============================================================================

import { supabase } from './supabase';

/**
 * Assina atualizações em tempo real nas tabelas vitais de colaboração multiusuário:
 * - justificativas (novas justificativas, edições e abatimentos de gangway)
 * - sync_heartbeat (sinal disparado após importações de apontamentos ou carteira)
 *
 * Aplica debounce de 450ms para consolidar disparos múltiplos em um único recarregamento.
 * Retorna uma função de limpeza (unsubscribe) para uso em useEffect.
 */
export function subscribeToRealtimeUpdates(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debouncedOnChange = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      try {
        onChange();
      } catch (err) {
        console.error('Erro ao executar callback do Realtime:', err);
      }
    }, 450);
  };

  const channel = supabase
    .channel('realtime-hh-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'justificativas' },
      () => {
        debouncedOnChange();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sync_heartbeat' },
      () => {
        debouncedOnChange();
      }
    )
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('Realtime channel error — tentando reconectar automaticamente...');
      }
    });

  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    supabase.removeChannel(channel);
  };
}
