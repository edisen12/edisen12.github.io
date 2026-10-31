-- ==============================================================================
-- Migration: 005_security_hardening.sql
-- Hardening de Funções de Trigger e RPCs no PostgreSQL
-- Revoga execução direta via REST/RPC de funções que devem rodar exclusivamente como triggers
-- ==============================================================================

-- 1. Funções de Trigger: Somente o PostgreSQL/Service Role deve executá-las via evento DML
REVOKE EXECUTE ON FUNCTION public.fn_init_user_onboarding() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_justificativas_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_touch_heartbeat() FROM PUBLIC, anon, authenticated;

-- Garante que o service_role mantém a permissão caso necessário internamente
GRANT EXECUTE ON FUNCTION public.fn_init_user_onboarding() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_justificativas_audit() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_touch_heartbeat() TO service_role;
