// ==============================================================================
// Registro e Injeção do Provedor de Banco de Dados Ativo
// Permite alternância transparente entre topologias BaaS e Self-Hosted
// ==============================================================================

import type { ClientDatabaseProvider } from '../ports/client-provider.port';
import { defaultClientProvider } from '@active-adapter';

let activeProvider: ClientDatabaseProvider = defaultClientProvider;

/**
 * Obtém a instância ativa do provedor de banco de dados (BaaS ou Self-Hosted).
 */
export function getClientDatabaseProvider(): ClientDatabaseProvider {
  return activeProvider;
}

/**
 * Substitui o provedor ativo (útil para testes unitários ou alternância em runtime).
 */
export function setClientDatabaseProvider(provider: ClientDatabaseProvider): void {
  activeProvider = provider;
}

/**
 * Restaura o provedor configurado no build (@active-adapter).
 */
export function resetClientDatabaseProvider(): void {
  activeProvider = defaultClientProvider;
}
