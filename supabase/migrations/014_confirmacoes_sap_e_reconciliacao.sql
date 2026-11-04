-- ==============================================================================
-- Migration: 014_confirmacoes_sap_e_reconciliacao.sql
-- 1. Cria a tabela confirmacoes_sap com chave natural única
-- 2. Adiciona campos de confronto e divergência em carteira_operacoes e carteira_embarques
-- 3. Cria rotina de conciliação com janela de tolerância de +4 dias e estornos retroativos
-- 4. Cria índices de performance e políticas de Row Level Security (RLS)
-- ==============================================================================

-- 1. Tabela de Apontamentos / Confirmações do SAP
CREATE TABLE IF NOT EXISTS public.confirmacoes_sap (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula text NOT NULL,
  data_criacao date NOT NULL,
  data_lancamento date NOT NULL,
  data_fim_real date NOT NULL,
  ordem text NOT NULL,
  operacao text NOT NULL,
  horas_confirmadas numeric NOT NULL DEFAULT 0,
  id_embarque text NOT NULL DEFAULT '',
  status_reconciliacao text NOT NULL DEFAULT 'Pendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_confirmacao_sap_row UNIQUE (
    matricula,
    data_criacao,
    data_lancamento,
    data_fim_real,
    ordem,
    operacao,
    horas_confirmadas
  )
);

-- 2. Índices para performance de busca e cruzamento
CREATE INDEX IF NOT EXISTS idx_confirmacoes_sap_chave 
ON public.confirmacoes_sap (matricula, ordem, operacao);

CREATE INDEX IF NOT EXISTS idx_confirmacoes_sap_embarque 
ON public.confirmacoes_sap (id_embarque);

CREATE INDEX IF NOT EXISTS idx_confirmacoes_sap_datas 
ON public.confirmacoes_sap (matricula, data_lancamento, data_fim_real);

-- 3. Adição de colunas de confronto em carteira_operacoes
ALTER TABLE public.carteira_operacoes 
ADD COLUMN IF NOT EXISTS hh_confirmado_sap numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS divergencia_sap numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS status_divergencia text NOT NULL DEFAULT 'Não Apontado no SAP';

-- 4. Adição de colunas de confronto consolidado em carteira_embarques
ALTER TABLE public.carteira_embarques
ADD COLUMN IF NOT EXISTS hh_confirmado_portal numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS hh_confirmado_sap numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS divergencia_confirmada numeric NOT NULL DEFAULT 0;

-- 5. Função de Reconciliação e Confronto SAP x Portal Offshore
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
  -- Passo 1: Vincular cada confirmação do SAP ao id_embarque do técnico
  UPDATE public.confirmacoes_sap cs
  SET 
    id_embarque = sub.id_embarque,
    status_reconciliacao = sub.status_rec,
    updated_at = now()
  FROM (
    SELECT 
      cs_in.id,
      COALESCE(
        -- Prioridade 1: Ordem/Operação com data_fim_real exatamente dentro do embarque físico
        (
          SELECT co.portal_id 
          FROM public.carteira_operacoes co 
          WHERE co.matricula = cs_in.matricula 
            AND co.ordem = cs_in.ordem 
            AND co.operacao = cs_in.operacao
            AND cs_in.data_fim_real >= co.data_inicio 
            AND cs_in.data_fim_real <= co.data_fim
          ORDER BY co.data_inicio DESC
          LIMIT 1
        ),
        -- Prioridade 2: Ordem/Operação com data_lancamento dentro do embarque até +4 dias de tolerância
        (
          SELECT co.portal_id 
          FROM public.carteira_operacoes co 
          WHERE co.matricula = cs_in.matricula 
            AND co.ordem = cs_in.ordem 
            AND co.operacao = cs_in.operacao
            AND cs_in.data_lancamento >= co.data_inicio 
            AND cs_in.data_lancamento <= (co.data_fim + INTERVAL '4 days')
          ORDER BY co.data_inicio DESC
          LIMIT 1
        ),
        -- Prioridade 3: Se a ordem/operação existe em um único embarque daquele técnico (estorno retroativo tardio)
        (
          SELECT min(co.portal_id) 
          FROM public.carteira_operacoes co 
          WHERE co.matricula = cs_in.matricula 
            AND co.ordem = cs_in.ordem 
            AND co.operacao = cs_in.operacao
          HAVING count(DISTINCT co.portal_id) = 1
          LIMIT 1
        ),
        -- Prioridade 4: Não tem ordem em carteira, mas o técnico executou a bordo (data_fim_real no embarque)
        (
          SELECT ce.id_embarque
          FROM public.carteira_embarques ce
          WHERE ce.matricula = cs_in.matricula
            AND cs_in.data_fim_real >= ce.data_inicio
            AND cs_in.data_fim_real <= ce.data_fim
          ORDER BY ce.data_inicio DESC
          LIMIT 1
        ),
        -- Prioridade 5: Lançamento nos 4 dias de tolerância do PMB
        (
          SELECT ce.id_embarque
          FROM public.carteira_embarques ce
          WHERE ce.matricula = cs_in.matricula
            AND cs_in.data_lancamento >= ce.data_inicio
            AND cs_in.data_lancamento <= (ce.data_fim + INTERVAL '4 days')
          ORDER BY ce.data_inicio DESC
          LIMIT 1
        ),
        ''
      ) AS id_embarque,
      CASE 
        WHEN EXISTS (
          SELECT 1 FROM public.carteira_operacoes co 
          WHERE co.matricula = cs_in.matricula AND co.ordem = cs_in.ordem AND co.operacao = cs_in.operacao
        ) THEN 'Em Carteira'
        WHEN EXISTS (
          SELECT 1 FROM public.carteira_embarques ce
          WHERE ce.matricula = cs_in.matricula
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

  -- Passo 2: Atualizar indicadores de confronto em carteira_operacoes
  WITH sap_agg AS (
    SELECT 
      cs.matricula,
      cs.ordem,
      cs.operacao,
      cs.id_embarque,
      SUM(cs.horas_confirmadas) AS total_hc_sap
    FROM public.confirmacoes_sap cs
    GROUP BY cs.matricula, cs.ordem, cs.operacao, cs.id_embarque
  )
  UPDATE public.carteira_operacoes co
  SET 
    hh_confirmado_sap = COALESCE(sa.total_hc_sap, 0),
    divergencia_sap = ROUND((co.hh_confirmado - COALESCE(sa.total_hc_sap, 0))::numeric, 2),
    status_divergencia = CASE 
      WHEN co.hh_confirmado = 0 AND COALESCE(sa.total_hc_sap, 0) = 0 THEN 'Não Confirmado'
      WHEN co.hh_confirmado = COALESCE(sa.total_hc_sap, 0) THEN 'OK'
      WHEN COALESCE(sa.total_hc_sap, 0) = 0 AND co.hh_confirmado > 0 THEN 'Não Apontado no SAP'
      WHEN co.hh_confirmado = 0 AND COALESCE(sa.total_hc_sap, 0) > 0 THEN 'Não Confirmado no Portal'
      WHEN co.hh_confirmado > COALESCE(sa.total_hc_sap, 0) THEN 'Divergente (Portal > SAP)'
      WHEN co.hh_confirmado < COALESCE(sa.total_hc_sap, 0) THEN 'Divergente (SAP > Portal)'
      ELSE 'Divergente'
    END,
    updated_at = now()
  FROM public.carteira_operacoes co_target
  LEFT JOIN sap_agg sa 
    ON sa.matricula = co_target.matricula 
   AND sa.ordem = co_target.ordem 
   AND sa.operacao = co_target.operacao
   AND sa.id_embarque = co_target.portal_id
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
      co.portal_id AS id_embarque,
      co.matricula,
      co.data_inicio,
      COALESCE(SUM(co.hh_confirmado), 0) AS conf_portal,
      COALESCE(SUM(co.hh_confirmado_sap), 0) AS conf_sap
    FROM public.carteira_operacoes co
    GROUP BY co.portal_id, co.matricula, co.data_inicio
  ) sub
  WHERE ce.id_embarque = sub.id_embarque;

  -- Passo 4: Sincronizar apontamentos diários de HH a partir das confirmações do SAP
  INSERT INTO public.apontamentos_hh (
    matricula,
    data,
    plataforma_sigla,
    unidade_negocio,
    horas_executadas,
    updated_at
  )
  SELECT 
    cs.matricula,
    cs.data_fim_real AS data,
    COALESCE(
      MAX(ce_direct.plataforma_sigla),
      (SELECT ce_near.plataforma_sigla FROM public.carteira_embarques ce_near WHERE ce_near.matricula = cs.matricula ORDER BY ABS(ce_near.data_inicio - cs.data_fim_real) LIMIT 1),
      NULL
    ) AS plataforma_sigla,
    COALESCE(
      MAX(ce_direct.unidade_negocio),
      (SELECT ce_near.unidade_negocio FROM public.carteira_embarques ce_near WHERE ce_near.matricula = cs.matricula ORDER BY ABS(ce_near.data_inicio - cs.data_fim_real) LIMIT 1),
      'UN-DESCONHECIDA'
    ) AS unidade_negocio,
    LEAST(24::numeric, GREATEST(0::numeric, ROUND(SUM(cs.horas_confirmadas)::numeric, 2))) AS horas_executadas,
    now() AS updated_at
  FROM public.confirmacoes_sap cs
  LEFT JOIN public.carteira_embarques ce_direct ON ce_direct.id_embarque = cs.id_embarque AND cs.id_embarque <> ''
  JOIN public.tecnicos t ON t.matricula = cs.matricula
  WHERE cs.data_fim_real IS NOT NULL
  GROUP BY cs.matricula, cs.data_fim_real
  ON CONFLICT (matricula, data) DO UPDATE
  SET 
    plataforma_sigla = EXCLUDED.plataforma_sigla,
    unidade_negocio = EXCLUDED.unidade_negocio,
    horas_executadas = EXCLUDED.horas_executadas,
    updated_at = now();

  GET DIAGNOSTICS v_dias_sincronizados = ROW_COUNT;

  -- Passo 5: Atualizar fluxo_importacoes para ativar watermark
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

-- 6. Configuração de RLS para confirmacoes_sap
ALTER TABLE public.confirmacoes_sap ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "confirmacoes_sap_select_policy" ON public.confirmacoes_sap;
CREATE POLICY "confirmacoes_sap_select_policy" ON public.confirmacoes_sap
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR matricula IN (
      SELECT ce.matricula 
      FROM public.carteira_embarques ce 
      WHERE ce.plataforma_sigla = ANY((SELECT public.auth_allowed_platforms()))
         OR ce.unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
    )
  )
);

DROP POLICY IF EXISTS "confirmacoes_sap_global_write_policy" ON public.confirmacoes_sap;
CREATE POLICY "confirmacoes_sap_global_write_policy" ON public.confirmacoes_sap
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- 7. Grants
REVOKE ALL ON public.confirmacoes_sap FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.confirmacoes_sap TO authenticated;
GRANT ALL ON public.confirmacoes_sap TO service_role;

GRANT EXECUTE ON FUNCTION public.reconciliar_confirmacoes_sap() TO authenticated;
