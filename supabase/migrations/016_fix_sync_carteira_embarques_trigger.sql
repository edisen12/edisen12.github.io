-- ==============================================================================
-- Migration: 016_fix_sync_carteira_embarques_trigger.sql
-- Corrige a função sync_carteira_embarques_from_operacoes() para agrupar
-- estritamente por (matricula, data_inicio), evitando erro de ON CONFLICT DO UPDATE (21000)
-- quando múltiplos portal_ids ou siglas existirem para o mesmo embarque físico.
-- ==============================================================================

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
    COALESCE(MAX(NULLIF(co.portal_id, '')), '') AS id_embarque,
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
