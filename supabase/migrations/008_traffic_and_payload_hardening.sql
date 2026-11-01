-- ==============================================================================
-- Migration: 008_traffic_and_payload_hardening.sql
-- Auditoria de Tráfego, Neutralização de Oráculos e Proteção de Payloads
-- ==============================================================================

-- 1. Hardening de get_shared_ops: Elimina vetor de oráculo booleano
-- Garante que o usuário só consiga consultar OPs que já façam parte da sua carteira permitida
CREATE OR REPLACE FUNCTION public.get_shared_ops(p_ops text[])
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(array_agg(DISTINCT c_ext.operacao), '{}'::text[])
  FROM public.carteira_embarques c_ext
  WHERE NOT (SELECT public.auth_is_global())
    AND c_ext.operacao = ANY (p_ops)
    AND NOT (c_ext.plataforma_sigla = ANY ((SELECT public.auth_allowed_platforms())))
    AND EXISTS (
      SELECT 1 FROM public.carteira_embarques c_user
      WHERE c_user.operacao = c_ext.operacao
        AND (
          c_user.plataforma_sigla = ANY ((SELECT public.auth_allowed_platforms()))
          OR c_user.unidade_negocio = ANY ((SELECT public.auth_allowed_uns()))
        )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_ops(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_ops(text[]) TO authenticated, service_role;

-- 2. Hardening de update_own_profile: Validação estrita de tamanho de payload e integridade de onboarding
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_nome text,
  p_preferencias jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_clean_nome text := btrim(COALESCE(p_nome, ''));
BEGIN
  IF v_uid IS NULL OR NOT public.auth_is_active() THEN
    RAISE EXCEPTION 'Sessão inválida ou usuário inativo.';
  END IF;

  -- Proteção contra payloads excessivos no nome (Buffer / DoS)
  IF length(v_clean_nome) > 120 THEN
    RAISE EXCEPTION 'Nome de exibição excede o limite de 120 caracteres.';
  END IF;

  -- Proteção contra DoS de armazenamento em JSONB (máximo 32 KB para preferências de UI)
  IF p_preferencias IS NOT NULL AND length(p_preferencias::text) > 32768 THEN
    RAISE EXCEPTION 'Payload de preferências excede o limite máximo permitido (32 KB).';
  END IF;

  IF v_clean_nome <> '' THEN
    UPDATE public.profiles
    SET nome = v_clean_nome,
        updated_at = now()
    WHERE id = v_uid;

    UPDATE public.pessoas
    SET nome = v_clean_nome,
        updated_at = now()
    WHERE user_id = v_uid;
  END IF;

  IF p_preferencias IS NOT NULL THEN
    -- Preserva flags de segurança de primeiro_login / obriga_troca_senha intactas
    INSERT INTO public.user_onboarding (
      user_id,
      preferencias,
      updated_at
    ) VALUES (
      v_uid,
      p_preferencias,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      preferencias = p_preferencias,
      updated_at = now();
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_own_profile(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, jsonb) TO authenticated, service_role;
