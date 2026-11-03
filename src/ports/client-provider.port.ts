// ==============================================================================
// Provedor de Banco de Dados do Cliente (Frontend Client Database Provider)
// Agrupa as portas de autenticação, dados e realtime sob uma topologia explícita
// ==============================================================================

import type { ClientAuthPort } from './auth.port';
import type { ClientDataPort } from './data.port';
import type { ClientRealtimePort } from './realtime.port';

export interface ClientDatabaseProvider {
  readonly topology: 'baas' | 'self-hosted';
  readonly providerId: string;
  readonly auth: ClientAuthPort;
  readonly data: ClientDataPort;
  readonly realtime: ClientRealtimePort;
}
