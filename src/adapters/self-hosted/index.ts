// ==============================================================================
// Ponto de Entrada do Adaptador Self-Hosted
// Exporta a fábrica e o provedor padrão para comunicação via API RESTful
// ==============================================================================

import { createSelfHostedClientProvider } from './self-hosted.provider';

export const defaultClientProvider = createSelfHostedClientProvider();
export * from './self-hosted.provider';
export * from './http.client';
