-- ==============================================================================
-- Migration: 007_security_audit_hardening.sql
-- Hardening Avançado Pós-Pentest: Auditoria, Imutabilidade e Blindagem RLS
-- ==============================================================================

-- 1. Hardening do Trigger de Auditoria de Justificativas (Previne Fraude de Autoria e SLA)
CREATE OR REPLACE FUNCTION public.fn_justificativas_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Força estritamente a identidade da sessão autenticada (impossibilita forjar criado_por)
    NEW.criado_por := auth.uid();
    NEW.criado_em := now();
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();

    -- Sincroniza responsavel_nome automaticamente a partir do perfil oficial autenticado se não informado
    SELECT COALESCE(NEW.responsavel_nome, nome)
    INTO NEW.responsavel_nome
    FROM public.profiles
    WHERE id = auth.uid();

  ELSIF TG_OP = 'UPDATE' THEN
    -- Garante imutabilidade de autoria e data de criação inicial
    NEW.criado_por := OLD.criado_por;
    NEW.criado_em := OLD.criado_em;
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();

    SELECT COALESCE(NEW.responsavel_nome, OLD.responsavel_nome, nome)
    INTO NEW.responsavel_nome
    FROM public.profiles
    WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Correção de Permissões nas Funções de Trigger (Garante execução durante DML de usuários autenticados)
GRANT EXECUTE ON FUNCTION public.fn_justificativas_audit() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_touch_heartbeat() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_init_user_onboarding() TO authenticated, service_role;

-- 3. Hardening da Função de Heartbeat com search_path seguro
CREATE OR REPLACE FUNCTION public.fn_touch_heartbeat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.sync_heartbeat (id, updated_at)
  VALUES (1, now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  RETURN NEW;
END;
$$;

-- 4. Função Helper: Usuário Desbloqueado (Ativo e sem troca de senha provisória pendente)
CREATE OR REPLACE FUNCTION public.auth_is_unlocked()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.auth_is_active() AND NOT COALESCE(
    (SELECT obriga_troca_senha FROM public.user_onboarding WHERE user_id = auth.uid()),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_is_unlocked() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_unlocked() TO authenticated, service_role;

-- 5. Blindagem da Política de UPDATE em user_onboarding (Bloqueia Bypass de Troca de Senha via Console)
DROP POLICY IF EXISTS user_onboarding_update_policy ON public.user_onboarding;
CREATE POLICY user_onboarding_update_policy ON public.user_onboarding
  FOR UPDATE TO authenticated
  USING (
    public.auth_is_active()
    AND (user_id = (SELECT auth.uid()) OR public.auth_is_admin())
  )
  WITH CHECK (
    public.auth_is_active()
    AND (
      public.auth_is_admin()
      OR (
        user_id = (SELECT auth.uid())
        -- Usuário comum NÃO pode alterar as flags de obrigatoriedade de senha diretamente
        AND obriga_troca_senha = (SELECT uo.obriga_troca_senha FROM public.user_onboarding uo WHERE uo.user_id = auth.uid())
        AND primeiro_login = (SELECT uo.primeiro_login FROM public.user_onboarding uo WHERE uo.user_id = auth.uid())
      )
    )
  );

-- 6. Tabela de Log de Auditoria de Justificativas (Rastreabilidade Completa de Alterações e Exclusões)
CREATE TABLE IF NOT EXISTS public.justificativas_audit_log (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  justificativa_id uuid,
  matricula text NOT NULL,
  data date NOT NULL,
  motivo_antigo text,
  motivo_novo text,
  horas_antigas numeric,
  horas_novas numeric,
  descricao_antiga text,
  descricao_nova text,
  modificado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  modificado_em timestamptz NOT NULL DEFAULT now(),
  operacao text NOT NULL
);

ALTER TABLE public.justificativas_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS justificativas_audit_log_select ON public.justificativas_audit_log;
CREATE POLICY justificativas_audit_log_select ON public.justificativas_audit_log
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

CREATE OR REPLACE FUNCTION public.fn_log_justificativa_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.justificativas_audit_log (
      justificativa_id, matricula, data,
      motivo_antigo, motivo_novo,
      horas_antigas, horas_novas,
      descricao_antiga, descricao_nova,
      modificado_por, operacao
    ) VALUES (
      OLD.id, OLD.matricula, OLD.data,
      OLD.motivo, NEW.motivo,
      OLD.horas_gangway, NEW.horas_gangway,
      OLD.descricao, NEW.descricao,
      auth.uid(), 'UPDATE'
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.justificativas_audit_log (
      justificativa_id, matricula, data,
      motivo_antigo, motivo_novo,
      horas_antigas, horas_novas,
      descricao_antiga, descricao_nova,
      modificado_por, operacao
    ) VALUES (
      OLD.id, OLD.matricula, OLD.data,
      OLD.motivo, NULL,
      OLD.horas_gangway, NULL,
      OLD.descricao, NULL,
      auth.uid(), 'DELETE'
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_justificativas_history ON public.justificativas;
CREATE TRIGGER trg_justificativas_history
AFTER UPDATE OR DELETE ON public.justificativas
FOR EACH ROW EXECUTE FUNCTION public.fn_log_justificativa_change();

REVOKE EXECUTE ON FUNCTION public.fn_log_justificativa_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_log_justificativa_change() TO authenticated, service_role;

-- 7. Revogação de privilégios de criação de schema para proteção da integridade estrutural
REVOKE CREATE ON SCHEMA public FROM anon, authenticated, PUBLIC;
