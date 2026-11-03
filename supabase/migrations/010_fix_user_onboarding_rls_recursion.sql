-- ==============================================================================
-- Migration: 010_fix_user_onboarding_rls_recursion.sql
-- Correção de Recursão Infinita em Políticas RLS de user_onboarding
-- e Endurecimento Seguro de Conclusão do Primeiro Acesso (Troca de Senha)
-- ==============================================================================

-- 1. Elimina a subconsulta recursiva em user_onboarding_update_policy
-- Na migration 007, a cláusula WITH CHECK fazia subselects na própria tabela user_onboarding
-- (SELECT uo.obriga_troca_senha FROM user_onboarding uo ...), o que dispara o erro 42P17
-- (infinite recursion detected in policy for relation "user_onboarding") durante a
-- expansão de políticas RLS em qualquer UPDATE realizado por usuários autenticados.
DROP POLICY IF EXISTS user_onboarding_update_policy ON public.user_onboarding;
CREATE POLICY user_onboarding_update_policy ON public.user_onboarding
  FOR UPDATE TO authenticated
  USING (
    public.auth_is_active()
    AND (user_id = (SELECT auth.uid()) OR public.auth_is_admin())
  )
  WITH CHECK (
    public.auth_is_active()
    AND (user_id = (SELECT auth.uid()) OR public.auth_is_admin())
  );

-- 2. Trigger de proteção contra bypass via console (sem usar RLS recursiva)
-- Garante que nenhum usuário comum consiga desmarcar primeiro_login ou obriga_troca_senha
-- via UPDATE direto no cliente/console sem passar pela RPC autorizada ou por administrador.
CREATE OR REPLACE FUNCTION public.fn_prevent_user_onboarding_flag_bypass()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.primeiro_login IS DISTINCT FROM OLD.primeiro_login OR NEW.obriga_troca_senha IS DISTINCT FROM OLD.obriga_troca_senha) THEN
      IF NOT public.auth_is_admin() AND current_setting('app.allow_first_login_completion', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Alteração de primeiro_login e obriga_troca_senha não é permitida diretamente por DML.';
      END IF;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF (NEW.primeiro_login = false OR NEW.obriga_troca_senha = false) THEN
      IF NOT public.auth_is_admin() AND current_setting('app.allow_first_login_completion', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Criação de onboarding com flags liberadas não é permitida diretamente.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_prevent_user_onboarding_flag_bypass() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prevent_user_onboarding_flag_bypass() TO service_role;

DROP TRIGGER IF EXISTS trg_prevent_user_onboarding_flag_bypass ON public.user_onboarding;
CREATE TRIGGER trg_prevent_user_onboarding_flag_bypass
  BEFORE INSERT OR UPDATE ON public.user_onboarding
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_user_onboarding_flag_bypass();

-- 3. Promove complete_first_login_password_change() para SECURITY DEFINER
-- Na migration 004 foi criada como SECURITY INVOKER, o que a tornava sujeita às restrições
-- de RLS e causava a execução sob o contexto do próprio usuário comum que acabara de trocar a senha.
CREATE OR REPLACE FUNCTION public.complete_first_login_password_change()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT public.auth_is_active() THEN
    RAISE EXCEPTION 'Sessão inválida ou usuário inativo.';
  END IF;

  -- Sinaliza à trigger de proteção que a conclusão legítima do primeiro login está autorizada
  PERFORM set_config('app.allow_first_login_completion', 'true', true);

  INSERT INTO public.user_onboarding (
    user_id,
    primeiro_login,
    obriga_troca_senha,
    senha_trocada_em,
    updated_at
  ) VALUES (
    v_uid,
    false,
    false,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    primeiro_login = false,
    obriga_troca_senha = false,
    senha_trocada_em = now(),
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_first_login_password_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_first_login_password_change() TO authenticated, service_role;
