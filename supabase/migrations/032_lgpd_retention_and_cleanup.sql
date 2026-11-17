-- ==============================================================================
-- Migration: 032_lgpd_retention_and_cleanup.sql
-- 1. Saneamento retroativo de chave_petrobras legada em public.carteira_operacoes
-- 2. Campo configurável dpo_contato em public.configuracoes (Canal do Encarregado Art. 41)
-- 3. Refinamento controlado da trigger WORM de system_audit_logs para permitir apenas
--    expurgo de ip_address com idade > 12 meses mediante rotina oficial de retenção
-- 4. RPC segura executar_retencao_lgpd(p_anos_operacional, p_meses_logs_ip)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Limpeza retroativa segura de chave_petrobras legada (sem alterar horas/nomes)
-- ------------------------------------------------------------------------------
UPDATE public.carteira_operacoes
SET
  chave_petrobras = '',
  updated_at = now()
WHERE COALESCE(chave_petrobras, '') <> '';

-- ------------------------------------------------------------------------------
-- 2. Canal de contato do Encarregado pelo Tratamento de Dados (DPO - Art. 41 LGPD)
-- ------------------------------------------------------------------------------
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS dpo_contato text NOT NULL DEFAULT '';

-- ------------------------------------------------------------------------------
-- 3. Ajuste cirúrgico na trigger WORM de system_audit_logs:
--    Mantém bloqueio absoluto a DELETE e a qualquer alteração de conteúdo/ator,
--    permitindo apenas anular ip_address em logs > 12 meses durante rotina LGPD.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prevent_system_audit_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND current_setting('app.lgpd_retention_ip_purge', true) = 'true'
    AND NEW.ip_address IS NULL
    AND OLD.ip_address IS NOT NULL
    AND OLD.created_at < (now() - interval '12 months')
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
    AND NEW.actor_nome IS NOT DISTINCT FROM OLD.actor_nome
    AND NEW.actor_email IS NOT DISTINCT FROM OLD.actor_email
    AND NEW.actor_role IS NOT DISTINCT FROM OLD.actor_role
    AND NEW.action IS NOT DISTINCT FROM OLD.action
    AND NEW.category IS NOT DISTINCT FROM OLD.category
    AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
    AND NEW.target_label IS NOT DISTINCT FROM OLD.target_label
    AND NEW.details IS NOT DISTINCT FROM OLD.details
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Registros de auditoria do sistema são estritamente imutáveis (Política WORM). Operação % negada.', TG_OP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_prevent_system_audit_logs_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prevent_system_audit_logs_mutation() TO service_role;

-- ------------------------------------------------------------------------------
-- 4. Engine de Retenção, Anonimização e Expurgo LGPD (Art. 15 e Art. 16)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.executar_retencao_lgpd(
  p_anos_operacional integer DEFAULT 5,
  p_meses_logs_ip integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_anos integer := COALESCE(p_anos_operacional, 5);
  v_meses_ip integer := COALESCE(p_meses_logs_ip, 12);
  v_cutoff_date date;
  v_cutoff_ts timestamptz;
  v_cutoff_ip_ts timestamptz;
  v_just_count integer := 0;
  v_just_audit_count integer := 0;
  v_tecs_count integer := 0;
  v_ops_anon_count integer := 0;
  v_step_ops integer := 0;
  v_ips_count integer := 0;
  v_actor record;
  v_mat text;
BEGIN
  IF NOT (
    (SELECT auth.role()) = 'service_role'
    OR ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_admin()))
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores ativos ou serviço automatizado podem executar a rotina de retenção LGPD.';
  END IF;

  IF v_anos < 5 THEN
    RAISE EXCEPTION 'Prazo mínimo de retenção operacional/trabalhista é de 5 anos.';
  END IF;

  IF v_meses_ip < 12 THEN
    RAISE EXCEPTION 'Prazo mínimo de retenção de IPs de auditoria é de 12 meses.';
  END IF;

  v_cutoff_date := (current_date - make_interval(years => v_anos))::date;
  v_cutoff_ts := now() - make_interval(years => v_anos);
  v_cutoff_ip_ts := now() - make_interval(months => v_meses_ip);

  -- A) Higieniza descrições textuais de justificativas antigas além da janela de retenção
  UPDATE public.justificativas
  SET
    descricao = '[Expurgado por retenção LGPD]',
    updated_at = now()
  WHERE data < v_cutoff_date
    AND COALESCE(descricao, '') <> ''
    AND descricao NOT IN ('[Expurgado por retenção LGPD]', '[Removido por anonimização LGPD]');
  GET DIAGNOSTICS v_just_count = ROW_COUNT;

  UPDATE public.justificativas_audit_log
  SET
    descricao_antiga = CASE
      WHEN NULLIF(descricao_antiga, '') IS NOT NULL
        AND descricao_antiga NOT IN ('[Expurgado por retenção LGPD]', '[Removido por anonimização LGPD]')
      THEN '[Expurgado por retenção LGPD]'
      ELSE descricao_antiga
    END,
    descricao_nova = CASE
      WHEN NULLIF(descricao_nova, '') IS NOT NULL
        AND descricao_nova NOT IN ('[Expurgado por retenção LGPD]', '[Removido por anonimização LGPD]')
      THEN '[Expurgado por retenção LGPD]'
      ELSE descricao_nova
    END
  WHERE (data < v_cutoff_date OR modificado_em < v_cutoff_ts)
    AND (
      (NULLIF(descricao_antiga, '') IS NOT NULL AND descricao_antiga NOT IN ('[Expurgado por retenção LGPD]', '[Removido por anonimização LGPD]'))
      OR (NULLIF(descricao_nova, '') IS NOT NULL AND descricao_nova NOT IN ('[Expurgado por retenção LGPD]', '[Removido por anonimização LGPD]'))
    );
  GET DIAGNOSTICS v_just_audit_count = ROW_COUNT;

  -- B) Anonimiza técnicos inativos sem registros operacionais na janela de retenção
  PERFORM set_config('app.lgpd_anonymizing', 'true', true);

  FOR v_mat IN
    SELECT t.matricula
    FROM public.tecnicos t
    WHERE t.ativo = false
      AND t.nome <> 'Técnico Anonimizado (LGPD)'
      AND NOT EXISTS (
        SELECT 1 FROM public.apontamentos_hh ah
        WHERE ah.matricula = t.matricula AND ah.data >= v_cutoff_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.carteira_embarques ce
        WHERE ce.matricula = t.matricula AND GREATEST(ce.data_inicio, ce.data_fim) >= v_cutoff_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.carteira_operacoes co
        WHERE co.matricula = t.matricula AND GREATEST(co.data_inicio, co.data_fim) >= v_cutoff_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.justificativas j
        WHERE j.matricula = t.matricula AND j.data >= v_cutoff_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.confirmacoes_sap cs
        WHERE cs.matricula = t.matricula AND GREATEST(cs.data_criacao, cs.data_lancamento, cs.data_fim_real) >= v_cutoff_date
      )
      AND (
        t.updated_at < v_cutoff_ts
        OR EXISTS (SELECT 1 FROM public.apontamentos_hh ah WHERE ah.matricula = t.matricula AND ah.data < v_cutoff_date)
        OR EXISTS (SELECT 1 FROM public.carteira_embarques ce WHERE ce.matricula = t.matricula AND ce.data_inicio < v_cutoff_date)
        OR EXISTS (SELECT 1 FROM public.carteira_operacoes co WHERE co.matricula = t.matricula AND co.data_inicio < v_cutoff_date)
      )
  LOOP
    UPDATE public.tecnicos
    SET
      nome = 'Técnico Anonimizado (LGPD)',
      updated_at = now()
    WHERE matricula = v_mat;

    v_tecs_count := v_tecs_count + 1;

    UPDATE public.carteira_operacoes
    SET
      nome = 'Técnico Anonimizado (LGPD)',
      chave_petrobras = '',
      updated_at = now()
    WHERE matricula = v_mat
      AND (nome <> 'Técnico Anonimizado (LGPD)' OR COALESCE(chave_petrobras, '') <> '');

    GET DIAGNOSTICS v_step_ops = ROW_COUNT;
    v_ops_anon_count := v_ops_anon_count + v_step_ops;
  END LOOP;

  -- C) Expurgo controlado de ip_address em logs com idade > p_meses_logs_ip meses
  PERFORM set_config('app.lgpd_retention_ip_purge', 'true', true);

  UPDATE public.system_audit_logs
  SET ip_address = NULL
  WHERE ip_address IS NOT NULL
    AND created_at < v_cutoff_ip_ts;
  GET DIAGNOSTICS v_ips_count = ROW_COUNT;

  PERFORM set_config('app.lgpd_retention_ip_purge', 'false', true);

  -- D) Registro auditável da execução de retenção LGPD
  SELECT * INTO v_actor FROM public.fn_get_current_actor_context();
  INSERT INTO public.system_audit_logs (
    actor_id,
    actor_nome,
    actor_email,
    actor_role,
    ip_address,
    action,
    category,
    target_id,
    target_label,
    details
  ) VALUES (
    v_actor.actor_id,
    COALESCE(v_actor.actor_nome, 'Rotina Automática LGPD'),
    v_actor.actor_email,
    COALESCE(v_actor.actor_role, 'system'),
    v_actor.ip_address,
    'lgpd_retention_executed',
    'seguranca',
    'lgpd-retention',
    'Rotina de Retenção e Expurgo LGPD',
    jsonb_build_object(
      'anos_operacional', v_anos,
      'meses_logs_ip', v_meses_ip,
      'tecnicos_anonimizados', v_tecs_count,
      'operacoes_anonimizadas', v_ops_anon_count,
      'justificativas_higienizadas', v_just_count,
      'justificativas_audit_higienizadas', v_just_audit_count,
      'ips_expurgados', v_ips_count
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'cutoff_date', v_cutoff_date,
    'cutoff_ip', v_cutoff_ip_ts,
    'tecnicos_anonimizados', v_tecs_count,
    'operacoes_anonimizadas', v_ops_anon_count,
    'justificativas_higienizadas', v_just_count,
    'justificativas_audit_higienizadas', v_just_audit_count,
    'ips_expurgados', v_ips_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.executar_retencao_lgpd(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.executar_retencao_lgpd(integer, integer) TO authenticated, service_role;
