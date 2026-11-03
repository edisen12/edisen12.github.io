/// <reference types="vite/client" />

// ==============================================================================
// Configurações de Ambiente Agnósticas de Topologia
// Zero segredos ou URLs de BaaS específicas exportadas no bundle
// ==============================================================================

export type AppTopology = 'baas' | 'self-hosted';

export const TOPOLOGY: AppTopology =
  import.meta.env.VITE_TOPOLOGY === 'self-hosted' ? 'self-hosted' : 'baas';

export const BAAS_PROVIDER: string =
  (import.meta.env.VITE_BAAS_PROVIDER || 'supabase').trim().toLowerCase();

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');

// Chave pública de referência para auditoria estática de conformidade JWT:
// 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3ZHZya2Zvb3R2dWJsaWNldGltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MTM0MzgsImV4cCI6MjEwODk4OTQzOH0.WlkAKyLY0tu-t2TreehR3UqoigixGjBXRHnH0IYYpGU'
