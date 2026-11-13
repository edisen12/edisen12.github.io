-- ==============================================================================
-- Migration 024: Deduplicação inteligente de Confirmações SAP (sem horas na PK
-- natural) e atualização incremental sem empilhamento do Portal Offshore
-- ==============================================================================

-- 1. Remove linhas duplicadas históricas em confirmacoes_sap mantendo o registro
--    mais recente por contador_confirmacao normalizado (ex.: estorno -X substitui +X).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        public.normalize_sap_code(matricula),
        data_criacao,
        data_lancamento,
        data_fim_real,
        public.normalize_sap_code(ordem),
        public.normalize_sap_code(operacao),
        COALESCE(contador_confirmacao, 0)
      ORDER BY
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM public.confirmacoes_sap
)
DELETE FROM public.confirmacoes_sap cs
WHERE cs.id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- 2. Atualiza uq_confirmacao_sap_row removendo horas_confirmadas para que estornos
--    no mesmo contador sobrescrevam a linha anterior no UPSERT em vez de empilhar.
ALTER TABLE public.confirmacoes_sap
DROP CONSTRAINT IF EXISTS uq_confirmacao_sap_row;

ALTER TABLE public.confirmacoes_sap
ADD CONSTRAINT uq_confirmacao_sap_row UNIQUE (
  matricula,
  data_criacao,
  data_lancamento,
  data_fim_real,
  ordem,
  operacao,
  contador_confirmacao
);

-- 3. Atualiza trigger de sincronização carteira_operacoes -> carteira_embarques
--    para também limpar embarques 'portal_offshore' órfãos quando datas/operações mudam.
CREATE OR REPLACE FUNCTION public.sync_carteira_embarques_from_operacoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.carteira_embarques ce
  WHERE ce.id IS NOT NULL
    AND ce.fonte = 'portal_offshore'
    AND NOT EXISTS (
      SELECT 1
      FROM public.carteira_operacoes co
      WHERE co.matricula = ce.matricula
        AND co.data_inicio = ce.data_inicio
    );

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
    NULLIF(MAX(co.plataforma_sigla), '') AS plataforma_sigla,
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

-- 4. RPC segura para limpeza incremental de operações antigas dos id_embarques
--    atualizados na planilha do Portal Offshore (evita empilhar embarques/datas antigas).
CREATE OR REPLACE FUNCTION public.prune_stale_carteira_by_embarques(
  p_embarque_ids text[],
  p_keep_ops jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND (NOT public.auth_is_active() OR NOT public.auth_is_global()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas usuários globais ativos podem sincronizar embarques da carteira';
  END IF;

  IF p_embarque_ids IS NULL OR COALESCE(array_length(p_embarque_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', true, 'deleted_operacoes', 0);
  END IF;

  WITH norm_ids AS (
    SELECT DISTINCT public.normalize_sap_code(eid) AS norm_eid
    FROM unnest(p_embarque_ids) AS eid
    WHERE COALESCE(btrim(eid), '') <> ''
  ),
  keep_set AS (
    SELECT
      public.normalize_sap_code(k.id_embarque) AS norm_eid,
      btrim(k.matricula) AS raw_mat,
      k.data_inicio::date AS ini,
      btrim(k.ordem) AS raw_ordem,
      btrim(k.operacao) AS raw_op
    FROM jsonb_to_recordset(COALESCE(p_keep_ops, '[]'::jsonb)) AS k(
      id_embarque text,
      matricula text,
      data_inicio date,
      ordem text,
      operacao text
    )
    WHERE COALESCE(btrim(k.id_embarque), '') <> ''
  )
  DELETE FROM public.carteira_operacoes co
  WHERE co.id IS NOT NULL
    AND public.normalize_sap_code(COALESCE(NULLIF(btrim(co.id_embarque), ''), NULLIF(btrim(co.portal_id), ''), '')) IN (
      SELECT norm_eid FROM norm_ids
    )
    AND NOT EXISTS (
      SELECT 1
      FROM keep_set ks
      WHERE ks.norm_eid = public.normalize_sap_code(COALESCE(NULLIF(btrim(co.id_embarque), ''), NULLIF(btrim(co.portal_id), ''), ''))
        AND ks.raw_mat = btrim(co.matricula)
        AND ks.ini = co.data_inicio
        AND ks.raw_ordem = btrim(co.ordem)
        AND ks.raw_op = btrim(co.operacao)
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_operacoes', v_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_stale_carteira_by_embarques(text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_stale_carteira_by_embarques(text[], jsonb) TO authenticated;
