-- ==============================================================================
-- Migration: 030_drop_legacy_tecnicos_select_and_harden_triggers.sql
-- 1. Remove política legada "tecnicos_select" (que não validava auth_is_active())
--    mantendo exclusivamente "tecnicos_select_policy" da Migration 029
-- 2. Revoga EXECUTE de PUBLIC, anon e authenticated nas funções exclusivas de
--    trigger SECURITY DEFINER expostas no schema public (Advisor 0028/0029)
-- ==============================================================================

DROP POLICY IF EXISTS "tecnicos_select" ON public.tecnicos;

REVOKE EXECUTE ON FUNCTION public.fn_normalize_carteira_operacoes_ids() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sanitize_carteira_plataforma() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_carteira_embarques_from_operacoes() FROM PUBLIC, anon, authenticated;
