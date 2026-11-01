-- ==============================================================================
-- Migration: 009_system_audit_logs.sql
-- Trilha de Auditoria Geral do Sistema (System Audit Logs)
-- Padrão WORM (Write Once, Read Many), RLS Estrito, Rastreabilidade Automática
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Tabela: system_audit_logs
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_nome text,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  category text NOT NULL CHECK (category IN ('usuarios', 'seguranca', 'configuracoes', 'cadastros', 'operacional')),
  target_id text,
  target_label text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Garantia de compatibilidade caso a tabela tenha sido criada preliminarmente sem colunas opcionais
ALTER TABLE public.system_audit_logs
  ADD COLUMN IF NOT EXISTS ip_address text,
  ALTER COLUMN actor_nome DROP NOT NULL,
  ALTER COLUMN actor_email DROP NOT NULL,
  ALTER COLUMN actor_role DROP NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. Índices para Alta Performance em Consultas de Governança
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_created_at
  ON public.system_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_category
  ON public.system_audit_logs (category);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_action
  ON public.system_audit_logs (action);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_actor
  ON public.system_audit_logs (actor_id);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_cat_created
  ON public.system_audit_logs (category, created_at DESC);

-- ------------------------------------------------------------------------------
-- 3. Habilitação de RLS e Imutabilidade WORM (Write Once, Read Many)
-- ------------------------------------------------------------------------------
ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;

-- Limpeza de políticas prévias se existentes
DROP POLICY IF EXISTS "system_audit_logs_select" ON public.system_audit_logs;
DROP POLICY IF EXISTS system_audit_logs_select_policy ON public.system_audit_logs;

-- SELECT: Permitido exclusivamente para administradores e gestores ativos
CREATE POLICY system_audit_logs_select_policy ON public.system_audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- INSERT: Permitido para sessões autenticadas e service_role
DROP POLICY IF EXISTS system_audit_logs_insert_policy ON public.system_audit_logs;
CREATE POLICY system_audit_logs_insert_policy ON public.system_audit_logs
  FOR INSERT TO authenticated, service_role
  WITH CHECK (
    auth.role() = 'authenticated' OR auth.role() = 'service_role'
  );

-- UPDATE / DELETE: Nenhuma política permitida e Trigger WORM para bloqueio ativo
CREATE OR REPLACE FUNCTION public.fn_prevent_system_audit_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria do sistema são estritamente imutáveis (Política WORM). Operação % negada.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_audit_logs_mutation ON public.system_audit_logs;
CREATE TRIGGER trg_prevent_system_audit_logs_mutation
  BEFORE UPDATE OR DELETE ON public.system_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_system_audit_logs_mutation();

-- Revogação explícita de privilégios de modificação e deleção
REVOKE ALL ON public.system_audit_logs FROM anon, public;
GRANT SELECT, INSERT ON public.system_audit_logs TO authenticated, service_role;
REVOKE UPDATE, DELETE ON public.system_audit_logs FROM authenticated, anon, public;

REVOKE EXECUTE ON FUNCTION public.fn_prevent_system_audit_logs_mutation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prevent_system_audit_logs_mutation() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. Função Helper: Resolução Segura de Contexto do Ator
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_get_current_actor_context()
RETURNS TABLE (
  actor_id uuid,
  actor_nome text,
  actor_email text,
  actor_role text,
  ip_address text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nome text := NULL;
  v_email text := NULL;
  v_role text := NULL;
  v_ip text := NULL;
  v_headers_raw text;
  v_claims_raw text;
BEGIN
  -- Extração de IP via PostgREST headers (quando aplicável)
  v_headers_raw := NULLIF(current_setting('request.headers', true), '');
  IF v_headers_raw IS NOT NULL THEN
    BEGIN
      v_ip := v_headers_raw::jsonb->>'x-forwarded-for';
      IF v_ip IS NULL THEN
        v_ip := v_headers_raw::jsonb->>'cf-connecting-ip';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
    END;
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT p.nome, p.email, p.role
    INTO v_nome, v_email, v_role
    FROM public.profiles p
    WHERE p.id = v_uid;

    IF v_nome IS NULL THEN
      v_claims_raw := NULLIF(current_setting('request.jwt.claims', true), '');
      IF v_claims_raw IS NOT NULL THEN
        BEGIN
          v_email := COALESCE(v_claims_raw::jsonb->>'email', 'usuario@autenticado');
          v_nome := COALESCE(v_claims_raw::jsonb->'user_metadata'->>'name', v_email);
          v_role := COALESCE(v_claims_raw::jsonb->>'role', 'authenticated');
        EXCEPTION WHEN OTHERS THEN
          v_nome := 'Usuário Autenticado';
          v_email := 'auth.user';
          v_role := 'authenticated';
        END;
      ELSE
        v_nome := 'Usuário Autenticado';
        v_email := 'auth.user';
        v_role := 'authenticated';
      END IF;
    END IF;
  ELSE
    IF auth.role() = 'service_role' THEN
      v_nome := 'Service Role / Backend';
      v_email := 'service_role@supabase';
      v_role := 'service_role';
    ELSE
      v_nome := 'Sistema / Postgres Interno';
      v_email := 'system@database';
      v_role := 'system';
    END IF;
  END IF;

  RETURN QUERY SELECT v_uid, v_nome, v_email, v_role, v_ip;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_get_current_actor_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_current_actor_context() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. Triggers Automáticos de Rastreabilidade em Tabelas Críticas
-- ------------------------------------------------------------------------------

-- 5.1 Trigger em public.configuracoes
CREATE OR REPLACE FUNCTION public.fn_audit_configuracoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor RECORD;
  v_old_json jsonb := to_jsonb(OLD) - 'updated_at';
  v_new_json jsonb := to_jsonb(NEW) - 'updated_at';
  v_diff jsonb := '{}'::jsonb;
  v_key text;
BEGIN
  IF v_old_json = v_new_json THEN
    RETURN NEW;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_new_json)
  LOOP
    IF (v_old_json -> v_key) IS DISTINCT FROM (v_new_json -> v_key) THEN
      v_diff := jsonb_set(
        v_diff,
        ARRAY[v_key],
        jsonb_build_object(
          'old', v_old_json -> v_key,
          'new', v_new_json -> v_key
        )
      );
    END IF;
  END LOOP;

  SELECT * INTO v_actor FROM public.fn_get_current_actor_context();

  INSERT INTO public.system_audit_logs (
    actor_id, actor_nome, actor_email, actor_role,
    action, category,
    target_id, target_label,
    details, ip_address
  ) VALUES (
    v_actor.actor_id, v_actor.actor_nome, v_actor.actor_email, v_actor.actor_role,
    'config_updated', 'configuracoes',
    NEW.id, 'Parâmetros do Contrato (' || NEW.id || ')',
    jsonb_build_object('diff', v_diff),
    v_actor.ip_address
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_configuracoes ON public.configuracoes;
CREATE TRIGGER trg_audit_configuracoes
  AFTER UPDATE ON public.configuracoes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_configuracoes();

REVOKE EXECUTE ON FUNCTION public.fn_audit_configuracoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_configuracoes() TO authenticated, service_role;

-- 5.2 Trigger em public.pessoas
CREATE OR REPLACE FUNCTION public.fn_audit_pessoas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor RECORD;
  v_diff jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.fn_get_current_actor_context();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_audit_logs (
      actor_id, actor_nome, actor_email, actor_role,
      action, category,
      target_id, target_label,
      details, ip_address
    ) VALUES (
      v_actor.actor_id, v_actor.actor_nome, v_actor.actor_email, v_actor.actor_role,
      'pessoa_created', 'cadastros',
      NEW.id::text, NEW.nome,
      jsonb_build_object(
        'slug', NEW.slug,
        'papel', NEW.papel,
        'email', NEW.email,
        'user_id', NEW.user_id
      ),
      v_actor.ip_address
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.nome IS DISTINCT FROM NEW.nome THEN
      v_diff := jsonb_set(v_diff, '{nome}', jsonb_build_object('old', OLD.nome, 'new', NEW.nome));
    END IF;
    IF OLD.papel IS DISTINCT FROM NEW.papel THEN
      v_diff := jsonb_set(v_diff, '{papel}', jsonb_build_object('old', OLD.papel, 'new', NEW.papel));
    END IF;
    IF OLD.email IS DISTINCT FROM NEW.email THEN
      v_diff := jsonb_set(v_diff, '{email}', jsonb_build_object('old', OLD.email, 'new', NEW.email));
    END IF;
    IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      v_diff := jsonb_set(v_diff, '{user_id}', jsonb_build_object('old', OLD.user_id, 'new', NEW.user_id));
    END IF;
    IF OLD.slug IS DISTINCT FROM NEW.slug THEN
      v_diff := jsonb_set(v_diff, '{slug}', jsonb_build_object('old', OLD.slug, 'new', NEW.slug));
    END IF;

    IF v_diff <> '{}'::jsonb THEN
      INSERT INTO public.system_audit_logs (
        actor_id, actor_nome, actor_email, actor_role,
        action, category,
        target_id, target_label,
        details, ip_address
      ) VALUES (
        v_actor.actor_id, v_actor.actor_nome, v_actor.actor_email, v_actor.actor_role,
        'pessoa_updated', 'cadastros',
        NEW.id::text, NEW.nome,
        jsonb_build_object('diff', v_diff),
        v_actor.ip_address
      );
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.system_audit_logs (
      actor_id, actor_nome, actor_email, actor_role,
      action, category,
      target_id, target_label,
      details, ip_address
    ) VALUES (
      v_actor.actor_id, v_actor.actor_nome, v_actor.actor_email, v_actor.actor_role,
      'pessoa_deleted', 'cadastros',
      OLD.id::text, OLD.nome,
      jsonb_build_object(
        'slug', OLD.slug,
        'papel', OLD.papel,
        'email', OLD.email,
        'user_id', OLD.user_id
      ),
      v_actor.ip_address
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_pessoas ON public.pessoas;
CREATE TRIGGER trg_audit_pessoas
  AFTER INSERT OR UPDATE OR DELETE ON public.pessoas
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_pessoas();

REVOKE EXECUTE ON FUNCTION public.fn_audit_pessoas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_pessoas() TO authenticated, service_role;

-- 5.3 Trigger em public.plataformas
CREATE OR REPLACE FUNCTION public.fn_audit_plataformas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor RECORD;
  v_diff jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.fn_get_current_actor_context();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_audit_logs (
      actor_id, actor_nome, actor_email, actor_role,
      action, category,
      target_id, target_label,
      details, ip_address
    ) VALUES (
      v_actor.actor_id, v_actor.actor_nome, v_actor.actor_email, v_actor.actor_role,
      'plataforma_created', 'cadastros',
      NEW.sigla, NEW.nome,
      jsonb_build_object(
        'un', NEW.un,
        'armador', NEW.armador,
        'gerencia', NEW.gerencia,
        'tipo', NEW.tipo,
        'situacao', NEW.situacao,
        'cadastro_pendente', NEW.cadastro_pendente
      ),
      v_actor.ip_address
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.nome IS DISTINCT FROM NEW.nome THEN
      v_diff := jsonb_set(v_diff, '{nome}', jsonb_build_object('old', OLD.nome, 'new', NEW.nome));
    END IF;
    IF OLD.un IS DISTINCT FROM NEW.un THEN
      v_diff := jsonb_set(v_diff, '{un}', jsonb_build_object('old', OLD.un, 'new', NEW.un));
    END IF;
    IF OLD.situacao IS DISTINCT FROM NEW.situacao THEN
      v_diff := jsonb_set(v_diff, '{situacao}', jsonb_build_object('old', OLD.situacao, 'new', NEW.situacao));
    END IF;
    IF OLD.cadastro_pendente IS DISTINCT FROM NEW.cadastro_pendente THEN
      v_diff := jsonb_set(v_diff, '{cadastro_pendente}', jsonb_build_object('old', OLD.cadastro_pendente, 'new', NEW.cadastro_pendente));
    END IF;
    IF OLD.armador IS DISTINCT FROM NEW.armador THEN
      v_diff := jsonb_set(v_diff, '{armador}', jsonb_build_object('old', OLD.armador, 'new', NEW.armador));
    END IF;
    IF OLD.gerencia IS DISTINCT FROM NEW.gerencia THEN
      v_diff := jsonb_set(v_diff, '{gerencia}', jsonb_build_object('old', OLD.gerencia, 'new', NEW.gerencia));
    END IF;
    IF OLD.tipo IS DISTINCT FROM NEW.tipo THEN
      v_diff := jsonb_set(v_diff, '{tipo}', jsonb_build_object('old', OLD.tipo, 'new', NEW.tipo));
    END IF;

    IF v_diff <> '{}'::jsonb THEN
      INSERT INTO public.system_audit_logs (
        actor_id, actor_nome, actor_email, actor_role,
        action, category,
        target_id, target_label,
        details, ip_address
      ) VALUES (
        v_actor.actor_id, v_actor.actor_nome, v_actor.actor_email, v_actor.actor_role,
        'plataforma_updated', 'cadastros',
        NEW.sigla, NEW.nome,
        jsonb_build_object('diff', v_diff),
        v_actor.ip_address
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_plataformas ON public.plataformas;
CREATE TRIGGER trg_audit_plataformas
  AFTER INSERT OR UPDATE ON public.plataformas
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_plataformas();

REVOKE EXECUTE ON FUNCTION public.fn_audit_plataformas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_plataformas() TO authenticated, service_role;

-- 5.4 Trigger em public.profiles
CREATE OR REPLACE FUNCTION public.fn_audit_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor RECORD;
  v_action text;
BEGIN
  -- Dispara apenas para alterações de perfil de segurança (role ou ativo)
  IF OLD.role IS NOT DISTINCT FROM NEW.role AND OLD.ativo IS NOT DISTINCT FROM NEW.ativo THEN
    RETURN NEW;
  END IF;

  IF OLD.role IS DISTINCT FROM NEW.role AND OLD.ativo IS DISTINCT FROM NEW.ativo THEN
    v_action := 'role_and_status_changed';
  ELSIF OLD.role IS DISTINCT FROM NEW.role THEN
    v_action := 'role_changed';
  ELSE
    v_action := 'status_toggled';
  END IF;

  SELECT * INTO v_actor FROM public.fn_get_current_actor_context();

  INSERT INTO public.system_audit_logs (
    actor_id, actor_nome, actor_email, actor_role,
    action, category,
    target_id, target_label,
    details, ip_address
  ) VALUES (
    v_actor.actor_id, v_actor.actor_nome, v_actor.actor_email, v_actor.actor_role,
    v_action, 'seguranca',
    NEW.id::text, NEW.nome || ' (' || NEW.email || ')',
    jsonb_build_object(
      'old_role', OLD.role,
      'new_role', NEW.role,
      'old_ativo', OLD.ativo,
      'new_ativo', NEW.ativo
    ),
    v_actor.ip_address
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_profiles ON public.profiles;
CREATE TRIGGER trg_audit_profiles
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_profiles();

REVOKE EXECUTE ON FUNCTION public.fn_audit_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_profiles() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. RPC: log_system_event (Registro Programático Seguro por Clientes e Funções)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_system_event(
  p_action text,
  p_category text,
  p_target_id text DEFAULT NULL,
  p_target_label text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor RECORD;
  v_action text := btrim(COALESCE(p_action, ''));
  v_category text := btrim(lower(COALESCE(p_category, '')));
  v_details jsonb := COALESCE(p_details, '{}'::jsonb);
  v_log_id uuid;
BEGIN
  IF v_action = '' THEN
    RAISE EXCEPTION 'Ação de auditoria não pode ser vazia.';
  END IF;

  IF v_category NOT IN ('usuarios', 'seguranca', 'configuracoes', 'cadastros', 'operacional') THEN
    RAISE EXCEPTION 'Categoria de auditoria inválida: %. Categorias permitidas: usuarios, seguranca, configuracoes, cadastros, operacional.', v_category;
  END IF;

  IF length(v_details::text) > 65536 THEN
    RAISE EXCEPTION 'Payload de detalhes excede o limite máximo permitido (64 KB).';
  END IF;

  SELECT * INTO v_actor FROM public.fn_get_current_actor_context();

  -- Se for um usuário comum autenticado, exige que ele esteja ativo
  IF v_actor.actor_id IS NOT NULL THEN
    IF NOT public.auth_is_active() THEN
      RAISE EXCEPTION 'Acesso não autorizado: usuário inativo ou suspenso.';
    END IF;
  ELSE
    -- Sessão de background, service_role ou postgres interno
    IF auth.role() IS NOT NULL AND auth.role() NOT IN ('service_role', 'supabase_admin') AND current_user NOT IN ('postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'Acesso não autorizado para emissão de auditoria.';
    END IF;
  END IF;

  INSERT INTO public.system_audit_logs (
    actor_id, actor_nome, actor_email, actor_role,
    action, category,
    target_id, target_label,
    details, ip_address
  ) VALUES (
    v_actor.actor_id, v_actor.actor_nome, v_actor.actor_email, v_actor.actor_role,
    v_action, v_category,
    p_target_id, p_target_label,
    v_details, v_actor.ip_address
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_system_event(text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_system_event(text, text, text, text, jsonb) TO authenticated, service_role;
