// ==============================================================================
// Cliente Supabase Tipado com Sessão Persistente
// Zero-Trust RLS: Comunicação autenticada com PostgreSQL 17
// ==============================================================================

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/env';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined
  }
});
