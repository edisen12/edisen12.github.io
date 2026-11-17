-- ==============================================================================
-- Migration: 034_role_hierarchy_cobranca_and_admin_just.sql
-- Hierarquia operacional de cobrança e segregação de funções:
-- 1. Preposto passa a visualizar (SELECT) os Controladores subordinados cujas
--    plataformas ou UNs compartilham seu próprio escopo operacional (sem ver
--    outros Prepostos, Gestores ou Administradores).
-- 2. Controladores mantêm leitura restrita exclusivamente ao próprio registro.
-- 3. Administradores permanecem com leitura total para auditoria e cobrança,
--    mas não possuem permissão de escrita (INSERT/UPDATE/DELETE) em
--    justificativas operacionais (segregação de funções).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Funções auxiliares SECURITY DEFINER (sem recursão RLS)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_is_preposto()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT (ativo AND role = 'preposto') FROM public.profiles WHERE id = (SELECT auth.uid())),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_own_pessoa_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT id
  FROM public.pessoas
  WHERE user_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.auth_visible_controlador_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH caller_scope AS (
    SELECT pp.plataforma_sigla AS sigla
    FROM public.pessoas me
    JOIN public.profiles pr ON pr.id = me.user_id
    JOIN public.pessoa_plataformas pp ON pp.pessoa_id = me.id
    WHERE me.user_id = (SELECT auth.uid())
      AND pr.ativo = true
      AND pr.role = 'preposto'
      AND pp.plataforma_sigla IS NOT NULL
    UNION
    SELECT plat.sigla AS sigla
    FROM public.pessoas me
    JOIN public.profiles pr ON pr.id = me.user_id
    JOIN public.pessoa_unidades pu ON pu.pessoa_id = me.id
    JOIN public.plataformas plat ON plat.un = pu.unidade_negocio
    WHERE me.user_id = (SELECT auth.uid())
      AND pr.ativo = true
      AND pr.role = 'preposto'
      AND plat.sigla IS NOT NULL
  ),
  caller_uns AS (
    SELECT DISTINCT pu.unidade_negocio AS un
    FROM public.pessoas me
    JOIN public.profiles pr ON pr.id = me.user_id
    JOIN public.pessoa_unidades pu ON pu.pessoa_id = me.id
    WHERE me.user_id = (SELECT auth.uid())
      AND pr.ativo = true
      AND pr.role = 'preposto'
      AND pu.unidade_negocio IS NOT NULL
  )
  SELECT DISTINCT p.id
  FROM public.pessoas p
  WHERE p.papel = 'controlador'
    AND (
      EXISTS (
        SELECT 1
        FROM public.pessoa_plataformas pp
        JOIN caller_scope cs ON cs.sigla = pp.plataforma_sigla
        WHERE pp.pessoa_id = p.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.pessoa_unidades pu
        WHERE pu.pessoa_id = p.id
          AND (
            EXISTS (SELECT 1 FROM caller_uns cu WHERE cu.un = pu.unidade_negocio)
            OR EXISTS (
              SELECT 1
              FROM public.plataformas plat
              JOIN caller_scope cs ON cs.sigla = plat.sigla
              WHERE plat.un = pu.unidade_negocio
            )
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.auth_is_preposto() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_own_pessoa_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_visible_controlador_ids() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.auth_is_preposto() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_own_pessoa_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_visible_controlador_ids() TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. Políticas SELECT em pessoas, pessoa_plataformas e pessoa_unidades
--    (remove também políticas legadas de produção antes de recriar)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "pessoas_select" ON public.pessoas;
DROP POLICY IF EXISTS "pessoas_select_policy" ON public.pessoas;
CREATE POLICY "pessoas_select_policy" ON public.pessoas
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR user_id = (SELECT auth.uid())
    OR id IN (SELECT public.auth_visible_controlador_ids())
  )
);

DROP POLICY IF EXISTS "pessoa_plat_select" ON public.pessoa_plataformas;
DROP POLICY IF EXISTS "pessoa_plataformas_select_policy" ON public.pessoa_plataformas;
CREATE POLICY "pessoa_plataformas_select_policy" ON public.pessoa_plataformas
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR pessoa_id IN (SELECT public.auth_own_pessoa_ids())
    OR pessoa_id IN (SELECT public.auth_visible_controlador_ids())
  )
);

DROP POLICY IF EXISTS "pessoa_un_select" ON public.pessoa_unidades;
DROP POLICY IF EXISTS "pessoa_unidades_select_policy" ON public.pessoa_unidades;
CREATE POLICY "pessoa_unidades_select_policy" ON public.pessoa_unidades
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR pessoa_id IN (SELECT public.auth_own_pessoa_ids())
    OR pessoa_id IN (SELECT public.auth_visible_controlador_ids())
  )
);

-- ------------------------------------------------------------------------------
-- 3. Segregação em justificativas: leitura preservada para admin, escrita
--    operacional restrita a gestor, preposto e controlador (bloqueia admin)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "just_insert" ON public.justificativas;
DROP POLICY IF EXISTS "justificativas_insert_policy" ON public.justificativas;
CREATE POLICY "justificativas_insert_policy" ON public.justificativas
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.auth_is_active())
  AND NOT (SELECT public.auth_is_admin())
  AND (
    (SELECT public.auth_is_global())
    OR public.auth_can_access_justificativa(matricula, data)
  )
);

DROP POLICY IF EXISTS "just_update" ON public.justificativas;
DROP POLICY IF EXISTS "justificativas_update_policy" ON public.justificativas;
CREATE POLICY "justificativas_update_policy" ON public.justificativas
FOR UPDATE TO authenticated
USING (
  (SELECT public.auth_is_active())
  AND NOT (SELECT public.auth_is_admin())
  AND (
    (SELECT public.auth_is_global())
    OR public.auth_can_access_justificativa(matricula, data)
  )
)
WITH CHECK (
  (SELECT public.auth_is_active())
  AND NOT (SELECT public.auth_is_admin())
  AND (
    (SELECT public.auth_is_global())
    OR public.auth_can_access_justificativa(matricula, data)
  )
);

DROP POLICY IF EXISTS "just_delete" ON public.justificativas;
DROP POLICY IF EXISTS "justificativas_delete_policy" ON public.justificativas;
CREATE POLICY "justificativas_delete_policy" ON public.justificativas
FOR DELETE TO authenticated
USING (
  (SELECT public.auth_is_active())
  AND NOT (SELECT public.auth_is_admin())
  AND (SELECT public.auth_is_global())
);
