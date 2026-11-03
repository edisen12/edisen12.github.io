// ==============================================================================
// Porta de Tempo Real do Cliente (Frontend Client Realtime Port)
// Define a assinatura de inscrição reativa em atualizações colaborativas
// ==============================================================================

export interface ClientRealtimePort {
  subscribeToRealtimeUpdates(onChange: () => void): () => void;
}
