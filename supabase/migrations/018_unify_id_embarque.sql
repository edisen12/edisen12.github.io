-- ==============================================================================
-- Migration: 018_unify_id_embarque.sql
-- Unifica a coluna id_embarque em carteira_operacoes e carteira_embarques,
-- normaliza identificadores numéricos recuperando seriais de datas corrompidas
-- e adiciona triggers de sincronização e self-healing para id_embarque / portal_id.
-- ==============================================================================

-- 1. Adiciona a coluna id_embarque em carteira_operacoes caso ainda não exista
ALTER TABLE public.carteira_operacoes
  ADD COLUMN IF NOT EXISTS id_embarque text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_carteira_operacoes_id_embarque
  ON public.carteira_operacoes (id_embarque);

-- 2. Função de normalização e auto-recuperação de IDs (Self-Healing)
CREATE OR REPLACE FUNCTION public.fn_normalize_carteira_operacoes_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Se portal_id contiver string de data GMT/Brasília (artefato de parsing do Excel)
  IF NEW.portal_id LIKE '%GMT%' OR NEW.portal_id LIKE '%Brasília%' OR NEW.portal_id LIKE '%UTC%' THEN
    NEW.portal_id := (to_date(substring(NEW.portal_id from '^[A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{4}'), 'Dy Mon DD YYYY') - '1899-12-30'::date)::text;
  END IF;

  -- Se id_embarque contiver string de data GMT/Brasília
  IF NEW.id_embarque LIKE '%GMT%' OR NEW.id_embarque LIKE '%Brasília%' OR NEW.id_embarque LIKE '%UTC%' THEN
    NEW.id_embarque := (to_date(substring(NEW.id_embarque from '^[A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{4}'), 'Dy Mon DD YYYY') - '1899-12-30'::date)::text;
  END IF;

  -- Garante sincronização bidirecional entre portal_id e id_embarque
  IF NEW.id_embarque <> '' AND (NEW.portal_id = '' OR NEW.portal_id IS NULL) THEN
    NEW.portal_id := NEW.id_embarque;
  ELSIF NEW.portal_id <> '' AND (NEW.id_embarque = '' OR NEW.id_embarque IS NULL) THEN
    NEW.id_embarque := NEW.portal_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_carteira_operacoes_ids ON public.carteira_operacoes;
CREATE TRIGGER trg_normalize_carteira_operacoes_ids
  BEFORE INSERT OR UPDATE ON public.carteira_operacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_normalize_carteira_operacoes_ids();

-- 3. Atualiza trigger de consolidação física em carteira_embarques para priorizar id_embarque limpo
CREATE OR REPLACE FUNCTION public.sync_carteira_embarques_from_operacoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.carteira_embarques (
    id_embarque,
    matricula,
    plataforma_sigla,
    unidade_negocio,
    data_inicio,
    data_fim,
    horas_programadas,
    hh_carteira,
    hh_fora_carteira,
    hh_cancelado,
    fonte,
    updated_at
  )
  SELECT
    COALESCE(MAX(NULLIF(co.id_embarque, '')), MAX(NULLIF(co.portal_id, '')), '') AS id_embarque,
    co.matricula,
    COALESCE(MAX(co.plataforma_sigla), '') AS plataforma_sigla,
    COALESCE(MAX(NULLIF(co.unidade_negocio, '')), '') AS unidade_negocio,
    co.data_inicio,
    MAX(co.data_fim) AS data_fim,
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao IN ('Carteira', 'Fora da carteira')), 0) AS horas_programadas,
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Carteira'), 0) AS hh_carteira,
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Fora da carteira'), 0) AS hh_fora_carteira,
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Cancelada'), 0) AS hh_cancelado,
    'portal_offshore' AS fonte,
    now() AS updated_at
  FROM public.carteira_operacoes co
  GROUP BY co.matricula, co.data_inicio
  ON CONFLICT (matricula, data_inicio) DO UPDATE SET
    id_embarque = EXCLUDED.id_embarque,
    plataforma_sigla = EXCLUDED.plataforma_sigla,
    unidade_negocio = EXCLUDED.unidade_negocio,
    data_fim = EXCLUDED.data_fim,
    horas_programadas = EXCLUDED.horas_programadas,
    hh_carteira = EXCLUDED.hh_carteira,
    hh_fora_carteira = EXCLUDED.hh_fora_carteira,
    hh_cancelado = EXCLUDED.hh_cancelado,
    fonte = EXCLUDED.fonte,
    updated_at = now();

  RETURN NULL;
END;
$$;

-- 4. RPC para reset seguro da carteira (operacoes e embarques) caso o usuário deseje reimportar do zero
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

  TRUNCATE TABLE public.carteira_operacoes CASCADE;
  TRUNCATE TABLE public.carteira_embarques CASCADE;

  -- Desvincula confirmações SAP vinculadas à carteira anterior
  UPDATE public.confirmacoes_sap SET id_embarque = '';

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
