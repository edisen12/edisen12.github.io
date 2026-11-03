// ==============================================================================
// Ponto de Entrada do Adaptador BaaS
// Exporta o provedor padrão baseado na variável VITE_BAAS_PROVIDER
// ==============================================================================

import { BAAS_PROVIDER } from '../../config/env';
import { resolveBaaSClientProvider } from './registry';

export const defaultClientProvider = resolveBaaSClientProvider(BAAS_PROVIDER);
export * from './registry';
