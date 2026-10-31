-- ==============================================================================
-- Migration: 004_user_onboarding_and_preferences.sql
-- Controle de Primeiro Acesso (Troca Obrigatória de Senha) e Preferências de UI
-- ==============================================================================

-- 1. Tabela dedicada de Onboarding, Segurança de Senha e Preferências do Usuário
CREATE TABLE IF NOT EXISTS public.user_onboarding (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  primeiro_login boolean NOT NULL DEFAULT true,
  obriga_troca_senha boolean NOT NULL DEFAULT true,
  senha_trocada_em timestamptz,
  preferencias jsonb NOT NULL DEFAULT '{"themeMode":"light","density":"comfortable","defaultTab":"ger","pageSize":50}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_pendente
  ON public.user_onboarding (primeiro_login, obriga_troca_senha);

ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;

-- 2. Políticas RLS Zero-Trust (somente authenticated ativo)
DROP POLICY IF EXISTS user_onboarding_select_policy ON public.user_onboarding;
CREATE POLICY user_onboarding_select_policy ON public.user_onboarding
  FOR SELECT TO authenticated
  USING (
    public.auth_is_active()
    AND (user_id = (SELECT auth.uid()) OR public.auth_is_global())
  );

DROP POLICY IF EXISTS user_onboarding_insert_policy ON public.user_onboarding;
CREATE POLICY user_onboarding_insert_policy ON public.user_onboarding
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_is_active()
    AND (user_id = (SELECT auth.uid()) OR public.auth_is_admin())
  );

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

DROP POLICY IF EXISTS user_onboarding_delete_policy ON public.user_onboarding;
CREATE POLICY user_onboarding_delete_policy ON public.user_onboarding
  FOR DELETE TO authenticated
  USING (
    public.auth_is_active() AND public.auth_is_admin()
  );

-- 3. Trigger automático ao criar novo perfil em public.profiles
CREATE OR REPLACE FUNCTION public.fn_init_user_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_onboarding (user_id, primeiro_login, obriga_troca_senha)
  VALUES (NEW.id, true, true)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_init_user_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_init_user_onboarding() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_profiles_init_onboarding ON public.profiles;
CREATE TRIGGER trg_profiles_init_onboarding
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_init_user_onboarding();

-- 4. RPC para conclusão de troca obrigatória de senha no primeiro acesso / redefinição
CREATE OR REPLACE FUNCTION public.complete_first_login_password_change()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT public.auth_is_active() THEN
    RAISE EXCEPTION 'Sessão inválida ou usuário inativo.';
  END IF;

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

-- 5. RPC segura para o próprio usuário atualizar nome de exibição e preferências de UI
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_nome text,
  p_preferencias jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_clean_nome text := btrim(COALESCE(p_nome, ''));
BEGIN
  IF v_uid IS NULL OR NOT public.auth_is_active() THEN
    RAISE EXCEPTION 'Sessão inválida ou usuário inativo.';
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
    INSERT INTO public.user_onboarding (
      user_id,
      primeiro_login,
      obriga_troca_senha,
      preferencias,
      updated_at
    ) VALUES (
      v_uid,
      false,
      false,
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

-- 6. Backfill inicial: marca contas existentes (incluindo Administrador bootstrap) como primeiro login pendente
INSERT INTO public.user_onboarding (user_id, primeiro_login, obriga_troca_senha)
SELECT id, true, true
FROM auth.users
ON CONFLICT (user_id) DO UPDATE SET
  primeiro_login = true,
  obriga_troca_senha = true,
  updated_at = now();
