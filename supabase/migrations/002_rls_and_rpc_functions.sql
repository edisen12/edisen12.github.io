-- ==============================================================================
-- RLS (Row Level Security) & Funções RPC de Escopo
-- Migration: 002_rls_and_rpc_functions.sql
-- Zero-Trust: Acesso anônimo bloqueado, filtros via InitPlan ((SELECT public.fn()))
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Funções de Escopo e Segurança (SECURITY DEFINER STABLE)
-- ------------------------------------------------------------------------------

-- Verifica se o usuário atual autenticado está ativo no sistema
CREATE OR REPLACE FUNCTION public.auth_is_active()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT ativo FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Verifica se o usuário atual autenticado possui privilégio de admin
CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (ativo AND role = 'admin') FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Verifica se o usuário atual autenticado possui escopo global (admin ou gestor)
CREATE OR REPLACE FUNCTION public.auth_is_global()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (ativo AND role IN ('admin', 'gestor')) FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Retorna as Unidades de Negócio atribuídas ao usuário logado
CREATE OR REPLACE FUNCTION public.auth_allowed_uns()
RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT u.unidade_negocio), '{}'::text[])
  FROM public.pessoa_unidades u
  JOIN public.pessoas p ON p.id = u.pessoa_id
  WHERE p.user_id = auth.uid();
$$;

-- Retorna a união consolidada de plataformas atribuídas diretamente e pelas UNs
CREATE OR REPLACE FUNCTION public.auth_allowed_platforms()
RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT s), '{}'::text[])
  FROM (
    SELECT pp.plataforma_sigla AS s
    FROM public.pessoa_plataformas pp
    JOIN public.pessoas p ON p.id = pp.pessoa_id
    WHERE p.user_id = auth.uid()
    UNION
    SELECT plat.sigla AS s
    FROM public.plataformas plat
    WHERE plat.un = ANY (public.auth_allowed_uns())
  ) t;
$$;

-- Valida permissão para visualizar/editar justificativa específica
CREATE OR REPLACE FUNCTION public.auth_can_access_justificativa(p_mat text, p_data date)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_allowed_plats text[];
  v_allowed_uns text[];
BEGIN
  IF public.auth_is_global() THEN
    RETURN true;
  END IF;

  v_allowed_plats := public.auth_allowed_platforms();
  v_allowed_uns := public.auth_allowed_uns();

  -- Verifica apontamento direto
  IF EXISTS (
    SELECT 1 FROM public.apontamentos_hh
    WHERE matricula = p_mat AND data = p_data
      AND (plataforma_sigla = ANY(v_allowed_plats) OR unidade_negocio = ANY(v_allowed_uns))
  ) THEN
    RETURN true;
  END IF;

  -- Verifica carteira de embarque que cobre o dia
  IF EXISTS (
    SELECT 1 FROM public.carteira_embarques
    WHERE matricula = p_mat AND p_data BETWEEN data_inicio AND data_fim
      AND (plataforma_sigla = ANY(v_allowed_plats) OR unidade_negocio = ANY(v_allowed_uns))
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Funções RPC Operacionais
-- ------------------------------------------------------------------------------

-- RPC 1: Marca d'água global do contrato
CREATE OR REPLACE FUNCTION public.get_watermark_status()
RETURNS TABLE (ultima_data_hh date, ultima_importacao_em timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    (SELECT MAX(data) FROM public.apontamentos_hh
     WHERE data <= (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    (SELECT MAX(criado_em) FROM public.fluxo_importacoes WHERE tipo_fluxo = 'hh');
$$;

-- RPC 2: Cobertura externa de dias (anti-falso-positivo de transbordo)
CREATE OR REPLACE FUNCTION public.get_external_covered_days(p_ini date, p_fim date)
RETURNS TABLE (matricula text, data date)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT DISTINCT a.matricula, a.data
  FROM public.apontamentos_hh a
  JOIN public.carteira_embarques c
    ON c.matricula = a.matricula AND a.data BETWEEN c.data_inicio AND c.data_fim
  WHERE NOT (SELECT public.auth_is_global())
    AND a.data BETWEEN p_ini AND p_fim
    AND c.plataforma_sigla = ANY ((SELECT public.auth_allowed_platforms()))
    AND (a.plataforma_sigla IS NULL OR NOT (a.plataforma_sigla = ANY ((SELECT public.auth_allowed_platforms()))));
$$;

-- RPC 3: Operações USOFF compartilhadas entre carteiras
CREATE OR REPLACE FUNCTION public.get_shared_ops(p_ops text[])
RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT c.operacao), '{}'::text[])
  FROM public.carteira_embarques c
  WHERE NOT (SELECT public.auth_is_global())
    AND c.operacao = ANY (p_ops)
    AND NOT (c.plataforma_sigla = ANY ((SELECT public.auth_allowed_platforms())));
$$;

-- RPC 4: Healthcheck leve para o Cron Keep-Alive do GitHub Actions
CREATE OR REPLACE FUNCTION public.ping_health()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT 'ok'::text FROM public.configuracoes LIMIT 1;
$$;

-- ------------------------------------------------------------------------------
-- 3. Habilitação de RLS em 100% das Tabelas
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plataformas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pessoas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pessoa_plataformas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pessoa_unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tecnicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carteira_embarques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apontamentos_hh ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.justificativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_usoff_un ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes_notificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fluxo_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_heartbeat ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 4. Permissões de Execução (Grants)
-- ------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, public;

GRANT EXECUTE ON FUNCTION public.ping_health TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_is_active, public.auth_is_admin, public.auth_is_global,
  public.auth_allowed_uns, public.auth_allowed_platforms, public.auth_can_access_justificativa,
  public.get_watermark_status, public.get_external_covered_days, public.get_shared_ops
  TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. Políticas RLS (Row Level Security)
-- ------------------------------------------------------------------------------

-- Tabela: profiles
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
FOR SELECT TO authenticated
USING ((SELECT public.auth_is_active()) AND ((SELECT public.auth_is_global()) OR id = auth.uid()));

DROP POLICY IF EXISTS "profiles_admin_all_policy" ON public.profiles;
CREATE POLICY "profiles_admin_all_policy" ON public.profiles
FOR ALL TO authenticated
USING ((SELECT public.auth_is_admin()))
WITH CHECK ((SELECT public.auth_is_admin()));

-- Tabela: plataformas
DROP POLICY IF EXISTS "plataformas_select_policy" ON public.plataformas;
CREATE POLICY "plataformas_select_policy" ON public.plataformas
FOR SELECT TO authenticated
USING ((SELECT public.auth_is_active()) AND ((SELECT public.auth_is_global()) OR sigla = ANY((SELECT public.auth_allowed_platforms()))));

DROP POLICY IF EXISTS "plataformas_global_write_policy" ON public.plataformas;
CREATE POLICY "plataformas_global_write_policy" ON public.plataformas
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: pessoas
DROP POLICY IF EXISTS "pessoas_select_policy" ON public.pessoas;
CREATE POLICY "pessoas_select_policy" ON public.pessoas
FOR SELECT TO authenticated
USING ((SELECT public.auth_is_active()) AND ((SELECT public.auth_is_global()) OR user_id = auth.uid()));

DROP POLICY IF EXISTS "pessoas_global_write_policy" ON public.pessoas;
CREATE POLICY "pessoas_global_write_policy" ON public.pessoas
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: pessoa_plataformas
DROP POLICY IF EXISTS "pessoa_plataformas_select_policy" ON public.pessoa_plataformas;
CREATE POLICY "pessoa_plataformas_select_policy" ON public.pessoa_plataformas
FOR SELECT TO authenticated
USING ((SELECT public.auth_is_active()) AND ((SELECT public.auth_is_global()) OR pessoa_id IN (SELECT id FROM public.pessoas WHERE user_id = auth.uid())));

DROP POLICY IF EXISTS "pessoa_plataformas_global_write_policy" ON public.pessoa_plataformas;
CREATE POLICY "pessoa_plataformas_global_write_policy" ON public.pessoa_plataformas
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: pessoa_unidades
DROP POLICY IF EXISTS "pessoa_unidades_select_policy" ON public.pessoa_unidades;
CREATE POLICY "pessoa_unidades_select_policy" ON public.pessoa_unidades
FOR SELECT TO authenticated
USING ((SELECT public.auth_is_active()) AND ((SELECT public.auth_is_global()) OR pessoa_id IN (SELECT id FROM public.pessoas WHERE user_id = auth.uid())));

DROP POLICY IF EXISTS "pessoa_unidades_global_write_policy" ON public.pessoa_unidades;
CREATE POLICY "pessoa_unidades_global_write_policy" ON public.pessoa_unidades
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: tecnicos
DROP POLICY IF EXISTS "tecnicos_select_policy" ON public.tecnicos;
CREATE POLICY "tecnicos_select_policy" ON public.tecnicos
FOR SELECT TO authenticated
USING ((SELECT public.auth_is_active()));

DROP POLICY IF EXISTS "tecnicos_global_write_policy" ON public.tecnicos;
CREATE POLICY "tecnicos_global_write_policy" ON public.tecnicos
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: carteira_embarques
DROP POLICY IF EXISTS "carteira_select_policy" ON public.carteira_embarques;
CREATE POLICY "carteira_select_policy" ON public.carteira_embarques
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR plataforma_sigla = ANY((SELECT public.auth_allowed_platforms()))
    OR unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
  )
);

DROP POLICY IF EXISTS "carteira_global_write_policy" ON public.carteira_embarques;
CREATE POLICY "carteira_global_write_policy" ON public.carteira_embarques
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: apontamentos_hh
DROP POLICY IF EXISTS "apontamentos_select_policy" ON public.apontamentos_hh;
CREATE POLICY "apontamentos_select_policy" ON public.apontamentos_hh
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR plataforma_sigla = ANY((SELECT public.auth_allowed_platforms()))
    OR unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
  )
);

DROP POLICY IF EXISTS "apontamentos_global_write_policy" ON public.apontamentos_hh;
CREATE POLICY "apontamentos_global_write_policy" ON public.apontamentos_hh
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: justificativas
DROP POLICY IF EXISTS "justificativas_select_policy" ON public.justificativas;
CREATE POLICY "justificativas_select_policy" ON public.justificativas
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR public.auth_can_access_justificativa(matricula, data)
  )
);

DROP POLICY IF EXISTS "justificativas_insert_policy" ON public.justificativas;
CREATE POLICY "justificativas_insert_policy" ON public.justificativas
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR public.auth_can_access_justificativa(matricula, data)
  )
);

DROP POLICY IF EXISTS "justificativas_update_policy" ON public.justificativas;
CREATE POLICY "justificativas_update_policy" ON public.justificativas
FOR UPDATE TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR public.auth_can_access_justificativa(matricula, data)
  )
)
WITH CHECK (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR public.auth_can_access_justificativa(matricula, data)
  )
);

DROP POLICY IF EXISTS "justificativas_delete_policy" ON public.justificativas;
CREATE POLICY "justificativas_delete_policy" ON public.justificativas
FOR DELETE TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: configuracoes
DROP POLICY IF EXISTS "configuracoes_select_policy" ON public.configuracoes;
CREATE POLICY "configuracoes_select_policy" ON public.configuracoes
FOR SELECT TO authenticated
USING ((SELECT public.auth_is_active()));

DROP POLICY IF EXISTS "configuracoes_global_write_policy" ON public.configuracoes;
CREATE POLICY "configuracoes_global_write_policy" ON public.configuracoes
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: config_usoff_un
DROP POLICY IF EXISTS "config_usoff_un_select_policy" ON public.config_usoff_un;
CREATE POLICY "config_usoff_un_select_policy" ON public.config_usoff_un
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
  )
);

DROP POLICY IF EXISTS "config_usoff_un_global_write_policy" ON public.config_usoff_un;
CREATE POLICY "config_usoff_un_global_write_policy" ON public.config_usoff_un
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: configuracoes_notificacao (Preposto e Controlador recebem 0 linhas)
DROP POLICY IF EXISTS "configuracoes_notificacao_policy" ON public.configuracoes_notificacao;
CREATE POLICY "configuracoes_notificacao_policy" ON public.configuracoes_notificacao
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: fluxo_importacoes
DROP POLICY IF EXISTS "fluxo_importacoes_policy" ON public.fluxo_importacoes;
CREATE POLICY "fluxo_importacoes_policy" ON public.fluxo_importacoes
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- Tabela: sync_heartbeat
DROP POLICY IF EXISTS "sync_heartbeat_select_policy" ON public.sync_heartbeat;
CREATE POLICY "sync_heartbeat_select_policy" ON public.sync_heartbeat
FOR SELECT TO authenticated
USING ((SELECT public.auth_is_active()));

DROP POLICY IF EXISTS "sync_heartbeat_global_write_policy" ON public.sync_heartbeat;
CREATE POLICY "sync_heartbeat_global_write_policy" ON public.sync_heartbeat
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));
