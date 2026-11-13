-- ==============================================================================
-- Migration 025: Otimiza public.reconciliar_confirmacoes_sap() com CTEs MATERIALIZED
-- e Hash Joins (O(N + M)) no lugar de subqueries correlacionadas O(N * M), mantendo
-- semântica idêntica de prioridades P1..P6, estornos negativos e zeros à esquerda.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.reconciliar_confirmacoes_sap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_sap integer;
  v_vinculados integer;
  v_sem_embarque integer;
  v_ops_ok integer;
  v_ops_div integer;
  v_dias_sincronizados integer;
BEGIN
  IF auth.uid() IS NOT NULL AND (NOT public.auth_is_active() OR NOT public.auth_is_global()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas usuários globais ativos podem reconciliar confirmações SAP';
  END IF;

  -- Passo 1A: Vínculo inicial P1..P5 em uma única passada com Hash Joins sobre chaves pré-normalizadas
  WITH co_norm AS MATERIALIZED (
    SELECT
      public.normalize_sap_code(co.matricula) AS norm_mat,
      public.normalize_sap_code(co.ordem) AS norm_ordem,
      public.normalize_sap_code(co.operacao) AS norm_op,
      COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '') AS emb_id,
      co.data_inicio,
      co.data_fim
    FROM public.carteira_operacoes co
  ),
  ce_norm AS MATERIALIZED (
    SELECT
      public.normalize_sap_code(ce.matricula) AS norm_mat,
      COALESCE(NULLIF(TRIM(ce.id_embarque), ''), '') AS emb_id,
      ce.data_inicio,
      ce.data_fim
    FROM public.carteira_embarques ce
  ),
  sap_norm AS MATERIALIZED (
    SELECT
      cs.id,
      public.normalize_sap_code(cs.matricula) AS norm_mat,
      public.normalize_sap_code(cs.ordem) AS norm_ordem,
      public.normalize_sap_code(cs.operacao) AS norm_op,
      cs.data_fim_real,
      cs.data_lancamento
    FROM public.confirmacoes_sap cs
  ),
  sap_co_match AS (
    SELECT
      sap.id,
      bool_or(co.norm_mat IS NOT NULL) AS has_co,
      (ARRAY_AGG(co.emb_id ORDER BY co.data_inicio DESC)
        FILTER (WHERE co.emb_id <> '' AND sap.data_fim_real >= co.data_inicio AND sap.data_fim_real <= co.data_fim))[1] AS p1_emb,
      (ARRAY_AGG(co.emb_id ORDER BY co.data_inicio DESC)
        FILTER (WHERE co.emb_id <> '' AND sap.data_lancamento >= co.data_inicio AND sap.data_lancamento <= (co.data_fim + INTERVAL '4 days')))[1] AS p2_emb,
      CASE
        WHEN count(DISTINCT NULLIF(co.emb_id, '')) = 1
        THEN min(NULLIF(co.emb_id, ''))
      END AS p3_emb
    FROM sap_norm sap
    LEFT JOIN co_norm co
      ON co.norm_mat = sap.norm_mat
     AND co.norm_ordem = sap.norm_ordem
     AND co.norm_op = sap.norm_op
    GROUP BY sap.id
  ),
  sap_ce_match AS (
    SELECT
      sap.id,
      (ARRAY_AGG(ce.emb_id ORDER BY ce.data_inicio DESC)
        FILTER (WHERE ce.emb_id <> '' AND sap.data_fim_real >= ce.data_inicio AND sap.data_fim_real <= ce.data_fim))[1] AS p4_emb,
      (ARRAY_AGG(ce.emb_id ORDER BY ce.data_inicio DESC)
        FILTER (WHERE ce.emb_id <> '' AND sap.data_lancamento >= ce.data_inicio AND sap.data_lancamento <= (ce.data_fim + INTERVAL '4 days')))[1] AS p5_emb,
      bool_or(
        ce.norm_mat IS NOT NULL AND (
          (sap.data_fim_real BETWEEN ce.data_inicio AND ce.data_fim)
          OR (sap.data_lancamento BETWEEN ce.data_inicio AND (ce.data_fim + INTERVAL '4 days'))
        )
      ) AS has_ce_fora
    FROM sap_norm sap
    LEFT JOIN ce_norm ce
      ON ce.norm_mat = sap.norm_mat
    GROUP BY sap.id
  )
  UPDATE public.confirmacoes_sap cs
  SET
    id_embarque = COALESCE(
      scm.p1_emb,
      scm.p2_emb,
      scm.p3_emb,
      sem.p4_emb,
      sem.p5_emb,
      ''
    ),
    status_reconciliacao = CASE
      WHEN scm.has_co THEN 'Em Carteira'
      WHEN sem.has_ce_fora THEN 'Fora da Carteira'
      ELSE 'Sem Embarque'
    END,
    updated_at = now()
  FROM sap_co_match scm
  JOIN sap_ce_match sem ON sem.id = scm.id
  WHERE cs.id = scm.id;

  -- Passo 1B: Vínculo tardio (> 4 dias pós-desembarque) para multi-embarques e estornos irmãos Fora da Carteira
  WITH co_norm AS MATERIALIZED (
    SELECT
      public.normalize_sap_code(co.matricula) AS norm_mat,
      public.normalize_sap_code(co.ordem) AS norm_ordem,
      public.normalize_sap_code(co.operacao) AS norm_op,
      COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '') AS emb_id,
      co.data_inicio
    FROM public.carteira_operacoes co
    WHERE COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '') <> ''
  ),
  co_all_keys AS MATERIALIZED (
    SELECT DISTINCT
      public.normalize_sap_code(co.matricula) AS norm_mat,
      public.normalize_sap_code(co.ordem) AS norm_ordem,
      public.normalize_sap_code(co.operacao) AS norm_op
    FROM public.carteira_operacoes co
  ),
  pos_sap_keys AS MATERIALIZED (
    SELECT DISTINCT
      cs_pos.id_embarque AS emb_id,
      public.normalize_sap_code(cs_pos.matricula) AS norm_mat,
      public.normalize_sap_code(cs_pos.ordem) AS norm_ordem,
      public.normalize_sap_code(cs_pos.operacao) AS norm_op
    FROM public.confirmacoes_sap cs_pos
    WHERE COALESCE(cs_pos.id_embarque, '') <> ''
      AND cs_pos.horas_confirmadas > 0
  ),
  ce_emb AS MATERIALIZED (
    SELECT
      NULLIF(TRIM(id_embarque), '') AS id_embarque,
      MIN(data_inicio) AS data_inicio
    FROM public.carteira_embarques
    WHERE NULLIF(TRIM(id_embarque), '') IS NOT NULL
    GROUP BY NULLIF(TRIM(id_embarque), '')
  ),
  sib_norm AS MATERIALIZED (
    SELECT
      cs_sib.id_embarque,
      public.normalize_sap_code(cs_sib.matricula) AS norm_mat,
      public.normalize_sap_code(cs_sib.ordem) AS norm_ordem,
      public.normalize_sap_code(cs_sib.operacao) AS norm_op,
      cs_sib.horas_confirmadas,
      cs_sib.data_fim_real,
      ce_sib.data_inicio AS emb_data_inicio
    FROM public.confirmacoes_sap cs_sib
    LEFT JOIN ce_emb ce_sib
      ON ce_sib.id_embarque = cs_sib.id_embarque
    WHERE COALESCE(cs_sib.id_embarque, '') <> ''
  ),
  unlinked_sap AS MATERIALIZED (
    SELECT
      cs_in.id,
      public.normalize_sap_code(cs_in.matricula) AS norm_mat,
      public.normalize_sap_code(cs_in.ordem) AS norm_ordem,
      public.normalize_sap_code(cs_in.operacao) AS norm_op,
      cs_in.horas_confirmadas,
      COALESCE(cs_in.data_fim_real, cs_in.data_lancamento, cs_in.data_criacao) AS ref_date
    FROM public.confirmacoes_sap cs_in
    WHERE COALESCE(cs_in.id_embarque, '') = ''
  ),
  p3b_match AS (
    SELECT
      u.id,
      (ARRAY_AGG(
        co.emb_id
        ORDER BY
          (co.data_inicio <= u.ref_date) DESC,
          (u.horas_confirmadas < 0 AND pk.emb_id IS NOT NULL) DESC,
          CASE WHEN co.data_inicio <= u.ref_date THEN co.data_inicio END DESC NULLS LAST,
          co.data_inicio ASC
      ))[1] AS p3b_emb
    FROM unlinked_sap u
    JOIN co_norm co
      ON co.norm_mat = u.norm_mat
     AND co.norm_ordem = u.norm_ordem
     AND co.norm_op = u.norm_op
    LEFT JOIN pos_sap_keys pk
      ON pk.emb_id = co.emb_id
     AND pk.norm_mat = u.norm_mat
     AND pk.norm_ordem = u.norm_ordem
     AND pk.norm_op = u.norm_op
    GROUP BY u.id
  ),
  p6_match AS (
    SELECT
      u.id,
      (ARRAY_AGG(
        sib.id_embarque
        ORDER BY
          (sib.emb_data_inicio IS NOT NULL AND sib.emb_data_inicio <= u.ref_date) DESC,
          (u.horas_confirmadas < 0 AND sib.horas_confirmadas > 0) DESC,
          sib.emb_data_inicio DESC NULLS LAST,
          sib.data_fim_real DESC NULLS LAST
      ))[1] AS p6_emb
    FROM unlinked_sap u
    JOIN sib_norm sib
      ON sib.norm_mat = u.norm_mat
     AND sib.norm_ordem = u.norm_ordem
     AND sib.norm_op = u.norm_op
    GROUP BY u.id
  ),
  resolved AS (
    SELECT
      u.id,
      COALESCE(p3b.p3b_emb, p6.p6_emb, '') AS resolved_id,
      (ck.norm_mat IS NOT NULL) AS in_carteira
    FROM unlinked_sap u
    LEFT JOIN p3b_match p3b ON p3b.id = u.id
    LEFT JOIN p6_match p6 ON p6.id = u.id
    LEFT JOIN co_all_keys ck
      ON ck.norm_mat = u.norm_mat
     AND ck.norm_ordem = u.norm_ordem
     AND ck.norm_op = u.norm_op
  )
  UPDATE public.confirmacoes_sap cs
  SET
    id_embarque = r.resolved_id,
    status_reconciliacao = CASE
      WHEN r.in_carteira THEN 'Em Carteira'
      WHEN r.resolved_id <> '' THEN 'Fora da Carteira'
      ELSE cs.status_reconciliacao
    END,
    updated_at = now()
  FROM resolved r
  WHERE cs.id = r.id
    AND r.resolved_id <> '';

  -- Passo 2: Atualizar indicadores de confronto em carteira_operacoes (soma líquida + e estornos -)
  WITH sap_agg AS MATERIALIZED (
    SELECT
      public.normalize_sap_code(cs.matricula) AS norm_mat,
      public.normalize_sap_code(cs.ordem) AS norm_ordem,
      public.normalize_sap_code(cs.operacao) AS norm_op,
      COALESCE(cs.id_embarque, '') AS id_embarque,
      ROUND(COALESCE(SUM(cs.horas_confirmadas), 0)::numeric, 2) AS total_hc_sap
    FROM public.confirmacoes_sap cs
    GROUP BY
      public.normalize_sap_code(cs.matricula),
      public.normalize_sap_code(cs.ordem),
      public.normalize_sap_code(cs.operacao),
      COALESCE(cs.id_embarque, '')
  )
  UPDATE public.carteira_operacoes co
  SET
    hh_confirmado_sap = ROUND(COALESCE(sa.total_hc_sap, 0)::numeric, 2),
    divergencia_sap = ROUND((COALESCE(co_target.hh_confirmado, 0) - COALESCE(sa.total_hc_sap, 0))::numeric, 2),
    status_divergencia = CASE
      WHEN abs(ROUND(COALESCE(co_target.hh_confirmado, 0)::numeric, 2)) < 0.01
       AND abs(ROUND(COALESCE(sa.total_hc_sap, 0)::numeric, 2)) < 0.01 THEN 'Não Confirmado'
      WHEN ROUND(COALESCE(co_target.hh_confirmado, 0)::numeric, 2) > 0
       AND abs(ROUND(COALESCE(sa.total_hc_sap, 0)::numeric, 2)) < 0.01 THEN 'Não Apontado no SAP'
      WHEN abs(ROUND(COALESCE(co_target.hh_confirmado, 0)::numeric, 2)) < 0.01
       AND ROUND(COALESCE(sa.total_hc_sap, 0)::numeric, 2) > 0 THEN 'Não Confirmado no Portal'
      WHEN abs(ROUND(COALESCE(co_target.hh_confirmado, 0)::numeric, 2)) < 0.01
       AND ROUND(COALESCE(sa.total_hc_sap, 0)::numeric, 2) < 0 THEN 'Divergente (Portal > SAP)'
      WHEN abs(ROUND(COALESCE(co_target.hh_confirmado, 0)::numeric, 2) - ROUND(COALESCE(sa.total_hc_sap, 0)::numeric, 2)) < 0.01 THEN 'OK'
      WHEN ROUND(COALESCE(co_target.hh_confirmado, 0)::numeric, 2) > ROUND(COALESCE(sa.total_hc_sap, 0)::numeric, 2) THEN 'Divergente (Portal > SAP)'
      ELSE 'Divergente (SAP > Portal)'
    END,
    updated_at = now()
  FROM public.carteira_operacoes co_target
  LEFT JOIN sap_agg sa
    ON sa.norm_mat = public.normalize_sap_code(co_target.matricula)
   AND sa.norm_ordem = public.normalize_sap_code(co_target.ordem)
   AND sa.norm_op = public.normalize_sap_code(co_target.operacao)
   AND sa.id_embarque = COALESCE(NULLIF(TRIM(co_target.id_embarque), ''), NULLIF(TRIM(co_target.portal_id), ''), '')
  WHERE co.id = co_target.id;

  -- Passo 3: Consolidar totais de confirmação em carteira_embarques
  UPDATE public.carteira_embarques ce
  SET
    hh_confirmado_portal = sub.conf_portal,
    hh_confirmado_sap = sub.conf_sap,
    divergencia_confirmada = ROUND((sub.conf_portal - sub.conf_sap)::numeric, 2),
    updated_at = now()
  FROM (
    SELECT
      ce_in.id AS cart_id,
      ROUND(COALESCE(SUM(co.hh_confirmado), 0)::numeric, 2) AS conf_portal,
      ROUND(COALESCE(SUM(co.hh_confirmado_sap), 0)::numeric, 2) AS conf_sap
    FROM public.carteira_embarques ce_in
    LEFT JOIN public.carteira_operacoes co
      ON (
        COALESCE(NULLIF(TRIM(ce_in.id_embarque), ''), '') <> ''
        AND COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '')
          = COALESCE(NULLIF(TRIM(ce_in.id_embarque), ''), '')
      )
      OR (
        co.matricula = ce_in.matricula
        AND co.data_inicio = ce_in.data_inicio
      )
    GROUP BY ce_in.id
  ) sub
  WHERE ce.id = sub.cart_id;

  -- Passo 4: Sincronizar apontamentos diários de HH a partir das confirmações do SAP (teto [0, 24])
  WITH tec_norm AS MATERIALIZED (
    SELECT
      t.matricula,
      public.normalize_sap_code(t.matricula) AS norm_mat
    FROM public.tecnicos t
  ),
  ce_direct AS MATERIALIZED (
    SELECT
      NULLIF(TRIM(id_embarque), '') AS id_embarque,
      MAX(plataforma_sigla) AS plataforma_sigla,
      MAX(unidade_negocio) AS unidade_negocio
    FROM public.carteira_embarques
    WHERE NULLIF(TRIM(id_embarque), '') IS NOT NULL
    GROUP BY NULLIF(TRIM(id_embarque), '')
  ),
  sap_daily AS MATERIALIZED (
    SELECT
      t.matricula,
      cs.data_fim_real AS data,
      MAX(ce_d.plataforma_sigla) AS direct_plat,
      MAX(ce_d.unidade_negocio) AS direct_un,
      LEAST(24::numeric, GREATEST(0::numeric, ROUND(SUM(cs.horas_confirmadas)::numeric, 2))) AS horas_executadas
    FROM public.confirmacoes_sap cs
    JOIN tec_norm t
      ON t.norm_mat = public.normalize_sap_code(cs.matricula)
    LEFT JOIN ce_direct ce_d
      ON ce_d.id_embarque = cs.id_embarque
     AND cs.id_embarque <> ''
    WHERE cs.data_fim_real IS NOT NULL
    GROUP BY t.matricula, cs.data_fim_real
  )
  INSERT INTO public.apontamentos_hh (
    matricula,
    data,
    plataforma_sigla,
    unidade_negocio,
    horas_executadas,
    updated_at
  )
  SELECT
    sd.matricula,
    sd.data,
    COALESCE(sd.direct_plat, near.plataforma_sigla, NULL) AS plataforma_sigla,
    COALESCE(sd.direct_un, near.unidade_negocio, 'UN-DESCONHECIDA') AS unidade_negocio,
    sd.horas_executadas,
    now() AS updated_at
  FROM sap_daily sd
  LEFT JOIN LATERAL (
    SELECT ce_near.plataforma_sigla, ce_near.unidade_negocio
    FROM public.carteira_embarques ce_near
    WHERE ce_near.matricula = sd.matricula
    ORDER BY ABS(ce_near.data_inicio - sd.data)
    LIMIT 1
  ) near ON sd.direct_plat IS NULL OR sd.direct_un IS NULL
  ON CONFLICT (matricula, data) DO UPDATE
  SET
    plataforma_sigla = EXCLUDED.plataforma_sigla,
    unidade_negocio = EXCLUDED.unidade_negocio,
    horas_executadas = EXCLUDED.horas_executadas,
    updated_at = now();

  GET DIAGNOSTICS v_dias_sincronizados = ROW_COUNT;

  -- Passo 5: Atualizar fluxo_importacoes para manter o watermark atualizado
  INSERT INTO public.fluxo_importacoes (
    tipo_fluxo,
    origem,
    total_linhas,
    data_maxima,
    observacao,
    criado_em
  )
  SELECT
    'hh',
    'Reconciliação SAP (' || count(*) || ' dias)',
    count(*),
    max(data),
    'Sincronizado automaticamente das confirmações do SAP',
    now()
  FROM public.apontamentos_hh;

  -- Estatísticas finais
  SELECT count(*) INTO v_total_sap FROM public.confirmacoes_sap;
  SELECT count(*) INTO v_vinculados FROM public.confirmacoes_sap WHERE id_embarque <> '';
  SELECT count(*) INTO v_sem_embarque FROM public.confirmacoes_sap WHERE id_embarque = '';
  SELECT count(*) INTO v_ops_ok FROM public.carteira_operacoes WHERE status_divergencia = 'OK';
  SELECT count(*) INTO v_ops_div FROM public.carteira_operacoes WHERE status_divergencia LIKE 'Divergente%';

  RETURN jsonb_build_object(
    'total_confirmacoes_sap', v_total_sap,
    'vinculados_ao_embarque', v_vinculados,
    'sem_embarque_associado', v_sem_embarque,
    'operacoes_com_batimento_ok', v_ops_ok,
    'operacoes_com_divergencia', v_ops_div,
    'dias_apontados_sincronizados', v_dias_sincronizados
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_confirmacoes_sap() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconciliar_confirmacoes_sap() TO authenticated;
