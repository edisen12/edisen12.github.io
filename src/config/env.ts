/// <reference types="vite/client" />

// Chaves públicas (Anon JWT) seguras sob Zero-Trust RLS no PostgreSQL
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://fwdvrkfootvublicetim.supabase.co';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3ZHZya2Zvb3R2dWJsaWNldGltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MTM0MzgsImV4cCI6MjEwODk4OTQzOH0.WlkAKyLY0tu-t2TreehR3UqoigixGjBXRHnH0IYYpGU';
