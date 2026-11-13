-- ==============================================================================
-- Migration 023: Corrige reconciliação SAP para estornos negativos, zeros à
-- esquerda (ordem/operação), multi-embarques e estornos tardios Fora da Carteira
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.normalize_sap_code(p_val text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_val IS NULL OR btrim(p_val) = '' THEN ''
    WHEN btrim(p_val) ~ '^[0-9]+$' THEN COALESCE(NULLIF(ltrim(btrim(p_val), '0'), ''), '0')
    ELSE upper(btrim(p_val))
  END
$$;

REVOKE ALL ON FUNCTION public.normalize_sap_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_sap_code(text) TO authenticated;

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

  -- Passo 1A: Vínculo inicial P1..P5 com normalização de códigos (remove zeros à esquerda)
  UPDATE public.confirmacoes_sap cs
  SET
    id_embarque = sub.id_embarque,
    status_reconciliacao = sub.status_rec,
    updated_at = now()
  FROM (
    SELECT
      cs_in.id,
      COALESCE(
        -- Prioridade 1: Ordem/Operação com data_fim_real dentro do embarque físico
        (
          SELECT COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '')
          FROM public.carteira_operacoes co
          WHERE public.normalize_sap_code(co.matricula) = public.normalize_sap_code(cs_in.matricula)
            AND public.normalize_sap_code(co.ordem) = public.normalize_sap_code(cs_in.ordem)
            AND public.normalize_sap_code(co.operacao) = public.normalize_sap_code(cs_in.operacao)
            AND COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '') <> ''
            AND cs_in.data_fim_real >= co.data_inicio
            AND cs_in.data_fim_real <= co.data_fim
          ORDER BY co.data_inicio DESC
          LIMIT 1
        ),
        -- Prioridade 2: Ordem/Operação com data_lancamento até +4 dias após desembarque
        (
          SELECT COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '')
          FROM public.carteira_operacoes co
          WHERE public.normalize_sap_code(co.matricula) = public.normalize_sap_code(cs_in.matricula)
            AND public.normalize_sap_code(co.ordem) = public.normalize_sap_code(cs_in.ordem)
            AND public.normalize_sap_code(co.operacao) = public.normalize_sap_code(cs_in.operacao)
            AND COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '') <> ''
            AND cs_in.data_lancamento >= co.data_inicio
            AND cs_in.data_lancamento <= (co.data_fim + INTERVAL '4 days')
          ORDER BY co.data_inicio DESC
          LIMIT 1
        ),
        -- Prioridade 3 (passada 1A): Ordem/Operação em único embarque do técnico
        (
          SELECT min(COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), ''))
          FROM public.carteira_operacoes co
          WHERE public.normalize_sap_code(co.matricula) = public.normalize_sap_code(cs_in.matricula)
            AND public.normalize_sap_code(co.ordem) = public.normalize_sap_code(cs_in.ordem)
            AND public.normalize_sap_code(co.operacao) = public.normalize_sap_code(cs_in.operacao)
            AND COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '') <> ''
          HAVING count(DISTINCT COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '')) = 1
          LIMIT 1
        ),
        -- Prioridade 4: Sem ordem na carteira, mas data_fim_real dentro do embarque físico
        (
          SELECT COALESCE(NULLIF(TRIM(ce.id_embarque), ''), '')
          FROM public.carteira_embarques ce
          WHERE public.normalize_sap_code(ce.matricula) = public.normalize_sap_code(cs_in.matricula)
            AND COALESCE(NULLIF(TRIM(ce.id_embarque), ''), '') <> ''
            AND cs_in.data_fim_real >= ce.data_inicio
            AND cs_in.data_fim_real <= ce.data_fim
          ORDER BY ce.data_inicio DESC
          LIMIT 1
        ),
        -- Prioridade 5: Lançamento nos 4 dias de tolerância pós-desembarque (PMB)
        (
          SELECT COALESCE(NULLIF(TRIM(ce.id_embarque), ''), '')
          FROM public.carteira_embarques ce
          WHERE public.normalize_sap_code(ce.matricula) = public.normalize_sap_code(cs_in.matricula)
            AND COALESCE(NULLIF(TRIM(ce.id_embarque), ''), '') <> ''
            AND cs_in.data_lancamento >= ce.data_inicio
            AND cs_in.data_lancamento <= (ce.data_fim + INTERVAL '4 days')
          ORDER BY ce.data_inicio DESC
          LIMIT 1
        ),
        ''
      ) AS id_embarque,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.carteira_operacoes co
          WHERE public.normalize_sap_code(co.matricula) = public.normalize_sap_code(cs_in.matricula)
            AND public.normalize_sap_code(co.ordem) = public.normalize_sap_code(cs_in.ordem)
            AND public.normalize_sap_code(co.operacao) = public.normalize_sap_code(cs_in.operacao)
        ) THEN 'Em Carteira'
        WHEN EXISTS (
          SELECT 1
          FROM public.carteira_embarques ce
          WHERE public.normalize_sap_code(ce.matricula) = public.normalize_sap_code(cs_in.matricula)
            AND (
              (cs_in.data_fim_real BETWEEN ce.data_inicio AND ce.data_fim)
              OR (cs_in.data_lancamento BETWEEN ce.data_inicio AND (ce.data_fim + INTERVAL '4 days'))
            )
        ) THEN 'Fora da Carteira'
        ELSE 'Sem Embarque'
      END AS status_rec
    FROM public.confirmacoes_sap cs_in
  ) sub
  WHERE cs.id = sub.id;

  -- Passo 1B: Vínculo tardio (> 4 dias pós-desembarque) para multi-embarques e estornos irmãos Fora da Carteira
  UPDATE public.confirmacoes_sap cs
  SET
    id_embarque = sub.resolved_id,
    status_reconciliacao = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.carteira_operacoes co
        WHERE public.normalize_sap_code(co.matricula) = public.normalize_sap_code(cs.matricula)
          AND public.normalize_sap_code(co.ordem) = public.normalize_sap_code(cs.ordem)
          AND public.normalize_sap_code(co.operacao) = public.normalize_sap_code(cs.operacao)
      ) THEN 'Em Carteira'
      WHEN sub.resolved_id <> '' THEN 'Fora da Carteira'
      ELSE cs.status_reconciliacao
    END,
    updated_at = now()
  FROM (
    SELECT
      cs_in.id,
      COALESCE(
        -- Prioridade 3B: Múltiplos embarques com a mesma ordem/operação; prioriza embarque iniciado até a data e saldo positivo
        (
          SELECT COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '')
          FROM public.carteira_operacoes co
          WHERE public.normalize_sap_code(co.matricula) = public.normalize_sap_code(cs_in.matricula)
            AND public.normalize_sap_code(co.ordem) = public.normalize_sap_code(cs_in.ordem)
            AND public.normalize_sap_code(co.operacao) = public.normalize_sap_code(cs_in.operacao)
            AND COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '') <> ''
          ORDER BY
            (co.data_inicio <= COALESCE(cs_in.data_fim_real, cs_in.data_lancamento, cs_in.data_criacao)) DESC,
            (
              cs_in.horas_confirmadas < 0
              AND EXISTS (
                SELECT 1
                FROM public.confirmacoes_sap cs_pos
                WHERE cs_pos.id_embarque = COALESCE(NULLIF(TRIM(co.id_embarque), ''), NULLIF(TRIM(co.portal_id), ''), '')
                  AND public.normalize_sap_code(cs_pos.matricula) = public.normalize_sap_code(cs_in.matricula)
                  AND public.normalize_sap_code(cs_pos.ordem) = public.normalize_sap_code(cs_in.ordem)
                  AND public.normalize_sap_code(cs_pos.operacao) = public.normalize_sap_code(cs_in.operacao)
                  AND cs_pos.horas_confirmadas > 0
              )
            ) DESC,
            CASE WHEN co.data_inicio <= COALESCE(cs_in.data_fim_real, cs_in.data_lancamento, cs_in.data_criacao) THEN co.data_inicio END DESC NULLS LAST,
            co.data_inicio ASC
          LIMIT 1
        ),
        -- Prioridade 6: Confirmação irmã já vinculada para a mesma ordem/operação fora da carteira
        (
          SELECT cs_sib.id_embarque
          FROM public.confirmacoes_sap cs_sib
          LEFT JOIN (
            SELECT
              NULLIF(TRIM(id_embarque), '') AS id_embarque,
              MIN(data_inicio) AS data_inicio
            FROM public.carteira_embarques
            WHERE NULLIF(TRIM(id_embarque), '') IS NOT NULL
            GROUP BY NULLIF(TRIM(id_embarque), '')
          ) ce_sib
            ON ce_sib.id_embarque = cs_sib.id_embarque
          WHERE cs_sib.id_embarque <> ''
            AND public.normalize_sap_code(cs_sib.matricula) = public.normalize_sap_code(cs_in.matricula)
            AND public.normalize_sap_code(cs_sib.ordem) = public.normalize_sap_code(cs_in.ordem)
            AND public.normalize_sap_code(cs_sib.operacao) = public.normalize_sap_code(cs_in.operacao)
          ORDER BY
            (ce_sib.data_inicio IS NOT NULL AND ce_sib.data_inicio <= COALESCE(cs_in.data_fim_real, cs_in.data_lancamento, cs_in.data_criacao)) DESC,
            (cs_in.horas_confirmadas < 0 AND cs_sib.horas_confirmadas > 0) DESC,
            ce_sib.data_inicio DESC NULLS LAST,
            cs_sib.data_fim_real DESC NULLS LAST
          LIMIT 1
        ),
        ''
      ) AS resolved_id
    FROM public.confirmacoes_sap cs_in
    WHERE COALESCE(cs_in.id_embarque, '') = ''
  ) sub
  WHERE cs.id = sub.id
    AND sub.resolved_id <> '';

  -- Passo 2: Atualizar indicadores de confronto em carteira_operacoes (soma líquida + e estornos -)
  WITH sap_agg AS (
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
  INSERT INTO public.apontamentos_hh (
    matricula,
    data,
    plataforma_sigla,
    unidade_negocio,
    horas_executadas,
    updated_at
  )
  SELECT
    t.matricula,
    cs.data_fim_real AS data,
    COALESCE(
      MAX(ce_direct.plataforma_sigla),
      (SELECT ce_near.plataforma_sigla FROM public.carteira_embarques ce_near WHERE ce_near.matricula = t.matricula ORDER BY ABS(ce_near.data_inicio - cs.data_fim_real) LIMIT 1),
      NULL
    ) AS plataforma_sigla,
    COALESCE(
      MAX(ce_direct.unidade_negocio),
      (SELECT ce_near.unidade_negocio FROM public.carteira_embarques ce_near WHERE ce_near.matricula = t.matricula ORDER BY ABS(ce_near.data_inicio - cs.data_fim_real) LIMIT 1),
      'UN-DESCONHECIDA'
    ) AS unidade_negocio,
    LEAST(24::numeric, GREATEST(0::numeric, ROUND(SUM(cs.horas_confirmadas)::numeric, 2))) AS horas_executadas,
    now() AS updated_at
  FROM public.confirmacoes_sap cs
  LEFT JOIN (
    SELECT
      NULLIF(TRIM(id_embarque), '') AS id_embarque,
      MAX(plataforma_sigla) AS plataforma_sigla,
      MAX(unidade_negocio) AS unidade_negocio
    FROM public.carteira_embarques
    WHERE NULLIF(TRIM(id_embarque), '') IS NOT NULL
    GROUP BY NULLIF(TRIM(id_embarque), '')
  ) ce_direct
    ON ce_direct.id_embarque = cs.id_embarque
   AND cs.id_embarque <> ''
  JOIN public.tecnicos t
    ON public.normalize_sap_code(t.matricula) = public.normalize_sap_code(cs.matricula)
  WHERE cs.data_fim_real IS NOT NULL
  GROUP BY t.matricula, cs.data_fim_real
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
