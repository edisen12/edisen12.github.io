// ==============================================================================
// Registry Aberto de Conectores BaaS (BaaS Registry)
// Permite plugar dinamicamente qualquer backend como serviço no frontend
// ==============================================================================

import type { BaaSConnectorPort } from '../../ports/baas-connector.port';
import type { ClientDatabaseProvider } from '../../ports/client-provider.port';
import { createBaaSClientProvider } from '../shared/client-pipeline';
import { supabaseBaaSConnector } from './providers/supabase.connector';

const connectorRegistry = new Map<string, () => BaaSConnectorPort>();

/**
 * Registra uma fábrica de conector BaaS no registry aberto.
 */
export function registerBaaSConnector(
  providerId: string,
  factory: () => BaaSConnectorPort
): void {
  connectorRegistry.set(providerId.trim().toLowerCase(), factory);
}

/**
 * Lista todos os identificadores de provedores BaaS atualmente registrados.
 */
export function listRegisteredBaaSConnectors(): string[] {
  return Array.from(connectorRegistry.keys());
}

/**
 * Resolve o ClientDatabaseProvider completo para o provedor BaaS solicitado.
 * Lança erro instrutivo se o provedor não tiver sido registrado.
 */
export function resolveBaaSClientProvider(providerId?: string): ClientDatabaseProvider {
  const key = (providerId || 'supabase').trim().toLowerCase();
  const factory = connectorRegistry.get(key);

  if (!factory) {
    const registered = listRegisteredBaaSConnectors().join(', ');
    throw new Error(
      `[BaaS Registry] Provedor BaaS "${key}" não foi registrado. Provedores disponíveis: [${registered}]. Para registrar um novo conector, use registerBaaSConnector('${key}', () => meuConector).`
    );
  }

  const connector = factory();
  return createBaaSClientProvider(connector);
}

// Pré-registro do conector padrão Supabase
registerBaaSConnector('supabase', () => supabaseBaaSConnector);
