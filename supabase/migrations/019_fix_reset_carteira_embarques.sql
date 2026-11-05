-- ==============================================================================
-- Migration: 019_fix_reset_carteira_embarques.sql
-- Corrige a RPC reset_carteira_embarques() para incluir cláusulas WHERE explícitas
-- em todos os comandos UPDATE e DELETE, atendendo aos requisitos de conformidade da
-- extensão safeupdate do PostgreSQL / Supabase PostgREST.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.reset_carteira_embarques()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ops_count integer;
  v_emb_count integer;
BEGIN
  IF NOT public.auth_is_active() OR NOT public.auth_is_global() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores e gestores globais podem resetar a carteira';
  END IF;

  SELECT count(*) INTO v_ops_count FROM public.carteira_operacoes;
  SELECT count(*) INTO v_emb_count FROM public.carteira_embarques;

  -- Exclusão explícita com WHERE para total compatibilidade com safeupdate
  DELETE FROM public.carteira_operacoes WHERE id IS NOT NULL;
  DELETE FROM public.carteira_embarques WHERE id IS NOT NULL;

  -- Desvincula confirmações SAP vinculadas à carteira anterior com WHERE explícito
  UPDATE public.confirmacoes_sap 
  SET id_embarque = '',
      status_reconciliacao = 'Pendente',
      updated_at = now()
  WHERE id_embarque <> '' OR status_reconciliacao <> 'Pendente';

  RETURN jsonb_build_object(
    'success', true,
    'deleted_operacoes', v_ops_count,
    'deleted_embarques', v_emb_count,
    'message', 'Carteira de operações e embarques resetadas com sucesso para reimportação limpa.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_carteira_embarques() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_carteira_embarques() FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_carteira_embarques() TO authenticated;
