-- ==============================================================================
-- Migration: 031_atomic_rpcs_constraints_and_advisors.sql
-- Fundamentos de Banco de Dados (Atomicidade, Constraints, Índices & Advisors):
-- 1. Índice faltante em FK (justificativas_audit_log.modificado_por)
-- 2. Otimização de RLS (elimina auth_rls_initplan e multiple_permissive_policies)
-- 3. Constraints CHECK de integridade numérica e cadastral no PostgreSQL
-- 4. RPCs transacionais atômicas (save_pessoa_with_scopes e delete_tecnico_atomic)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Índice em Chave Estrangeira descoberta
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_just_audit_log_modificado_por
  ON public.justificativas_audit_log (modificado_por);

-- ------------------------------------------------------------------------------
-- 2. Otimização de RLS (InitPlan e separação SELECT vs escrita em policies)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS system_audit_logs_insert_policy ON public.system_audit_logs;
CREATE POLICY system_audit_logs_insert_policy ON public.system_audit_logs
  FOR INSERT TO authenticated, service_role
  WITH CHECK (
    (SELECT auth.role()) = 'authenticated' OR (SELECT auth.role()) = 'service_role'
  );

DROP POLICY IF EXISTS "carteira_operacoes_global_write_policy" ON public.carteira_operacoes;
DROP POLICY IF EXISTS "carteira_operacoes_global_insert_policy" ON public.carteira_operacoes;
DROP POLICY IF EXISTS "carteira_operacoes_global_update_policy" ON public.carteira_operacoes;
DROP POLICY IF EXISTS "carteira_operacoes_global_delete_policy" ON public.carteira_operacoes;

CREATE POLICY "carteira_operacoes_global_insert_policy" ON public.carteira_operacoes
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

CREATE POLICY "carteira_operacoes_global_update_policy" ON public.carteira_operacoes
  FOR UPDATE TO authenticated
  USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
  WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

CREATE POLICY "carteira_operacoes_global_delete_policy" ON public.carteira_operacoes
  FOR DELETE TO authenticated
  USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

DROP POLICY IF EXISTS "confirmacoes_sap_global_write_policy" ON public.confirmacoes_sap;
DROP POLICY IF EXISTS "confirmacoes_sap_global_insert_policy" ON public.confirmacoes_sap;
DROP POLICY IF EXISTS "confirmacoes_sap_global_update_policy" ON public.confirmacoes_sap;
DROP POLICY IF EXISTS "confirmacoes_sap_global_delete_policy" ON public.confirmacoes_sap;

CREATE POLICY "confirmacoes_sap_global_insert_policy" ON public.confirmacoes_sap
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

CREATE POLICY "confirmacoes_sap_global_update_policy" ON public.confirmacoes_sap
  FOR UPDATE TO authenticated
  USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
  WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

CREATE POLICY "confirmacoes_sap_global_delete_policy" ON public.confirmacoes_sap
  FOR DELETE TO authenticated
  USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- ------------------------------------------------------------------------------
-- 3. Constraints CHECK de Integridade de Domínio no Motor do Banco
-- ------------------------------------------------------------------------------
ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS chk_configuracoes_valores_positivos,
  ADD CONSTRAINT chk_configuracoes_valores_positivos CHECK (
    hh_dia > 0 AND hh_dia <= 24
    AND dias_embarque > 0
    AND prazo_justificativa_dias >= 0
    AND meta_percentual > 0 AND meta_percentual <= 100
    AND atencao_percentual >= 0 AND atencao_percentual <= 100
  );

ALTER TABLE public.carteira_embarques
  DROP CONSTRAINT IF EXISTS chk_carteira_embarques_hh_nao_negativo,
  ADD CONSTRAINT chk_carteira_embarques_hh_nao_negativo CHECK (
    (horas_programadas IS NULL OR horas_programadas >= 0)
    AND hh_carteira >= 0
    AND hh_fora_carteira >= 0
    AND hh_cancelado >= 0
    AND hh_confirmado_portal >= 0
  );

ALTER TABLE public.carteira_operacoes
  DROP CONSTRAINT IF EXISTS chk_carteira_operacoes_valores_nao_negativos,
  ADD CONSTRAINT chk_carteira_operacoes_valores_nao_negativos CHECK (
    hh_programado >= 0
    AND hh_confirmado >= 0
    AND recursos >= 0
  );

ALTER TABLE public.tecnicos
  DROP CONSTRAINT IF EXISTS chk_tecnicos_nao_vazio,
  ADD CONSTRAINT chk_tecnicos_nao_vazio CHECK (
    btrim(matricula) <> '' AND btrim(nome) <> ''
  );

ALTER TABLE public.plataformas
  DROP CONSTRAINT IF EXISTS chk_plataformas_sigla_nao_vazia,
  ADD CONSTRAINT chk_plataformas_sigla_nao_vazia CHECK (
    btrim(sigla) <> ''
  );

-- ------------------------------------------------------------------------------
-- 4. RPCs Transacionais Atômicas (evita estado parcial em múltiplas chamadas)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_pessoa_with_scopes(
  p_id uuid DEFAULT NULL,
  p_slug text DEFAULT '',
  p_nome text DEFAULT '',
  p_papel text DEFAULT 'preposto',
  p_email text DEFAULT '',
  p_plats text[] DEFAULT ARRAY[]::text[],
  p_uns text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_pessoa_id uuid;
  v_user_id uuid;
  v_slug text;
  v_nome text := btrim(COALESCE(p_nome, ''));
  v_email text := lower(btrim(COALESCE(p_email, '')));
BEGIN
  IF NOT ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global())) THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores e Gestores ativos podem gerenciar pessoas e escopos.';
  END IF;

  IF v_nome = '' THEN
    RAISE EXCEPTION 'O nome da pessoa é obrigatório.';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.pessoas
    SET
      nome = v_nome,
      papel = p_papel,
      email = v_email,
      updated_at = now()
    WHERE id = p_id
    RETURNING id, user_id, slug INTO v_pessoa_id, v_user_id, v_slug;

    IF v_pessoa_id IS NULL THEN
      RAISE EXCEPTION 'Pessoa não encontrada para atualização.';
    END IF;
  ELSE
    INSERT INTO public.pessoas (slug, nome, papel, email)
    VALUES (NULLIF(btrim(COALESCE(p_slug, '')), ''), v_nome, p_papel, v_email)
    RETURNING id, user_id, slug INTO v_pessoa_id, v_user_id, v_slug;
  END IF;

  DELETE FROM public.pessoa_plataformas WHERE pessoa_id = v_pessoa_id;
  INSERT INTO public.pessoa_plataformas (pessoa_id, plataforma_sigla)
  SELECT DISTINCT v_pessoa_id, btrim(plat_val)
  FROM unnest(COALESCE(p_plats, ARRAY[]::text[])) AS plat_val
  WHERE btrim(COALESCE(plat_val, '')) <> '';

  DELETE FROM public.pessoa_unidades WHERE pessoa_id = v_pessoa_id;
  INSERT INTO public.pessoa_unidades (pessoa_id, unidade_negocio)
  SELECT DISTINCT v_pessoa_id, btrim(un_val)
  FROM unnest(COALESCE(p_uns, ARRAY[]::text[])) AS un_val
  WHERE btrim(COALESCE(un_val, '')) <> '';

  RETURN jsonb_build_object(
    'id', v_pessoa_id,
    'slug', COALESCE(v_slug, p_slug),
    'user_id', v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_pessoa_with_scopes(uuid, text, text, text, text, text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_pessoa_with_scopes(uuid, text, text, text, text, text[], text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_tecnico_atomic(
  p_matricula text,
  p_cascade boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_mat text := btrim(COALESCE(p_matricula, ''));
BEGIN
  IF NOT ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global())) THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores e Gestores ativos podem excluir técnicos.';
  END IF;

  IF v_mat = '' THEN
    RAISE EXCEPTION 'Matrícula inválida para exclusão.';
  END IF;

  IF COALESCE(p_cascade, false) THEN
    DELETE FROM public.justificativas WHERE matricula = v_mat;
    DELETE FROM public.carteira_operacoes WHERE matricula = v_mat;
    DELETE FROM public.carteira_embarques WHERE matricula = v_mat;
    DELETE FROM public.apontamentos_hh WHERE matricula = v_mat;
    DELETE FROM public.confirmacoes_sap WHERE matricula = v_mat;
  END IF;

  DELETE FROM public.tecnicos WHERE matricula = v_mat;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_tecnico_atomic(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_tecnico_atomic(text, boolean) TO authenticated, service_role;
