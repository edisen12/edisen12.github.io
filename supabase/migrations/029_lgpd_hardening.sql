-- ==============================================================================
-- Migration: 029_lgpd_hardening.sql
-- Adequação à LGPD (Lei nº 13.709/2018):
-- 1. Minimização de dados pessoais (RLS estrito por escopo em tecnicos e confirmacoes_sap)
-- 2. Restrição estrita das trilhas de auditoria (IP e logs) exclusivamente a Administradores
-- 3. Correção da trigger fn_audit_tecnicos (colunas compatíveis com system_audit_logs)
--    e suporte a anonimização sem regravar PII antiga em histórico WORM
-- 4. RPC segura anonimizar_tecnico_lgpd para atendimento a direitos do titular (Art. 18 VI)
--    preservando integridade estatutária de medições/HH
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Minimização em public.tecnicos: não-globais enxergam apenas técnicos ligados
--    às plataformas ou Unidades de Negócio de seu escopo operacional
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "tecnicos_select_policy" ON public.tecnicos;
CREATE POLICY "tecnicos_select_policy" ON public.tecnicos
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR EXISTS (
      SELECT 1
      FROM public.carteira_embarques ce
      WHERE ce.matricula = tecnicos.matricula
        AND (
          ce.plataforma_sigla = ANY((SELECT public.auth_allowed_platforms()))
          OR ce.unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.carteira_operacoes co
      WHERE co.matricula = tecnicos.matricula
        AND (
          co.plataforma_sigla = ANY((SELECT public.auth_allowed_platforms()))
          OR co.unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.apontamentos_hh hh
      WHERE hh.matricula = tecnicos.matricula
        AND (
          hh.plataforma_sigla = ANY((SELECT public.auth_allowed_platforms()))
          OR hh.unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
        )
    )
  )
);

-- ------------------------------------------------------------------------------
-- 2. Minimização em public.confirmacoes_sap: escopo por id_embarque ou janela do
--    embarque autorizado (nunca por matrícula irrestrita entre plataformas/meses)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "confirmacoes_sap_select_policy" ON public.confirmacoes_sap;
CREATE POLICY "confirmacoes_sap_select_policy" ON public.confirmacoes_sap
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR EXISTS (
      SELECT 1
      FROM public.carteira_embarques ce
      WHERE (
        ce.plataforma_sigla = ANY((SELECT public.auth_allowed_platforms()))
        OR ce.unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
      )
      AND (
        (
          confirmacoes_sap.id_embarque <> ''
          AND ce.id_embarque <> ''
          AND ce.id_embarque = confirmacoes_sap.id_embarque
        )
        OR (
          confirmacoes_sap.id_embarque = ''
          AND ce.matricula = confirmacoes_sap.matricula
          AND (
            confirmacoes_sap.data_fim_real BETWEEN ce.data_inicio AND (ce.data_fim + 4)
            OR confirmacoes_sap.data_lancamento BETWEEN ce.data_inicio AND (ce.data_fim + 4)
          )
        )
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.carteira_operacoes co
      WHERE (
        co.plataforma_sigla = ANY((SELECT public.auth_allowed_platforms()))
        OR co.unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
      )
      AND confirmacoes_sap.id_embarque <> ''
      AND co.id_embarque <> ''
      AND co.id_embarque = confirmacoes_sap.id_embarque
    )
  )
);

-- ------------------------------------------------------------------------------
-- 3. Restrição de trilhas de auditoria (IP, eventos de segurança e histórico)
--    exclusivamente para Administradores ativos (Art. 46 LGPD - Need to Know)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS system_audit_logs_select_policy ON public.system_audit_logs;
CREATE POLICY system_audit_logs_select_policy ON public.system_audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_admin()));

DROP POLICY IF EXISTS justificativas_audit_log_select ON public.justificativas_audit_log;
CREATE POLICY justificativas_audit_log_select ON public.justificativas_audit_log
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_admin()));

-- ------------------------------------------------------------------------------
-- 4. Correção da trigger fn_audit_tecnicos (Migration 021 inseria em user_id
--    inexistente) e suporte seguro à anonimização LGPD sem duplicar PII no WORM
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_tecnicos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor record;
  v_action text;
  v_old_data jsonb;
  v_new_data jsonb;
  v_label text;
  v_is_lgpd_anon boolean := (current_setting('app.lgpd_anonymizing', true) = 'true');
BEGIN
  SELECT * INTO v_actor FROM public.fn_get_current_actor_context();

  IF v_is_lgpd_anon AND TG_OP = 'UPDATE' THEN
    INSERT INTO public.system_audit_logs (
      actor_id,
      actor_nome,
      actor_email,
      actor_role,
      ip_address,
      action,
      category,
      target_id,
      target_label,
      details
    ) VALUES (
      v_actor.actor_id,
      v_actor.actor_nome,
      v_actor.actor_email,
      v_actor.actor_role,
      v_actor.ip_address,
      'lgpd_anonymization',
      'seguranca',
      NEW.matricula,
      'Mat. ' || NEW.matricula,
      jsonb_build_object(
        'tabela', 'tecnicos',
        'lgpd_anonymized', true
      )
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'tecnico_created';
    v_new_data := jsonb_build_object(
      'matricula', NEW.matricula,
      'funcao', NEW.funcao,
      'ativo', NEW.ativo
    );
    v_label := 'Mat. ' || NEW.matricula;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'tecnico_updated';
    v_old_data := jsonb_build_object(
      'matricula', OLD.matricula,
      'funcao', OLD.funcao,
      'ativo', OLD.ativo
    );
    v_new_data := jsonb_build_object(
      'matricula', NEW.matricula,
      'funcao', NEW.funcao,
      'ativo', NEW.ativo
    );
    v_label := 'Mat. ' || NEW.matricula;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'tecnico_deleted';
    v_old_data := jsonb_build_object(
      'matricula', OLD.matricula,
      'funcao', OLD.funcao,
      'ativo', OLD.ativo
    );
    v_label := 'Mat. ' || OLD.matricula;
  END IF;

  INSERT INTO public.system_audit_logs (
    actor_id,
    actor_nome,
    actor_email,
    actor_role,
    ip_address,
    action,
    category,
    target_id,
    target_label,
    details
  ) VALUES (
    v_actor.actor_id,
    v_actor.actor_nome,
    v_actor.actor_email,
    v_actor.actor_role,
    v_actor.ip_address,
    v_action,
    'cadastros',
    COALESCE(NEW.matricula, OLD.matricula),
    v_label,
    jsonb_build_object(
      'tabela', 'tecnicos',
      'antes', v_old_data,
      'depois', v_new_data
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_audit_tecnicos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_tecnicos() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. RPC de Anonimização LGPD (Art. 18 VI): remove identificação pessoal direta
--    e descrições livres mantendo registros numéricos para obrigação legal/fiscal
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonimizar_tecnico_lgpd(p_matricula text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_mat text := btrim(COALESCE(p_matricula, ''));
  v_exists boolean := false;
  v_ops_count integer := 0;
  v_just_count integer := 0;
BEGIN
  IF NOT ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_admin())) THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores ativos podem anonimizar registros via LGPD.';
  END IF;

  IF v_mat = '' THEN
    RAISE EXCEPTION 'Matrícula obrigatória para anonimização LGPD.';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.tecnicos WHERE matricula = v_mat) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Técnico não encontrado para a matrícula informada.';
  END IF;

  PERFORM set_config('app.lgpd_anonymizing', 'true', true);

  UPDATE public.tecnicos
  SET
    nome = 'Técnico Anonimizado (LGPD)',
    ativo = false,
    updated_at = now()
  WHERE matricula = v_mat;

  UPDATE public.carteira_operacoes
  SET
    nome = 'Técnico Anonimizado (LGPD)',
    chave_petrobras = '',
    updated_at = now()
  WHERE matricula = v_mat;
  GET DIAGNOSTICS v_ops_count = ROW_COUNT;

  UPDATE public.justificativas
  SET
    descricao = '[Removido por anonimização LGPD]',
    updated_at = now()
  WHERE matricula = v_mat
    AND COALESCE(descricao, '') <> ''
    AND descricao <> '[Removido por anonimização LGPD]';
  GET DIAGNOSTICS v_just_count = ROW_COUNT;

  UPDATE public.justificativas_audit_log
  SET
    descricao_antiga = CASE
      WHEN NULLIF(descricao_antiga, '') IS NOT NULL THEN '[Removido por anonimização LGPD]'
      ELSE descricao_antiga
    END,
    descricao_nova = CASE
      WHEN NULLIF(descricao_nova, '') IS NOT NULL THEN '[Removido por anonimização LGPD]'
      ELSE descricao_nova
    END
  WHERE matricula = v_mat
    AND (NULLIF(descricao_antiga, '') IS NOT NULL OR NULLIF(descricao_nova, '') IS NOT NULL);

  RETURN jsonb_build_object(
    'ok', true,
    'matricula', v_mat,
    'operacoes_anonimizadas', v_ops_count,
    'justificativas_higienizadas', v_just_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anonimizar_tecnico_lgpd(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anonimizar_tecnico_lgpd(text) TO authenticated, service_role;
