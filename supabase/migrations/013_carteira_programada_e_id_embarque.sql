-- ==============================================================================
-- Migration: 013_carteira_programada_e_id_embarque.sql
-- 1. Horas programadas somam Carteira + Fora da carteira (trabalho previsto do embarque)
-- 2. Adiciona colunas hh_carteira, hh_fora_carteira, hh_cancelado para visibilidade segregada
-- 3. Remove a coluna redundante 'operacao' de carteira_embarques (mantendo apenas id_embarque)
-- 4. Atualiza a função e o trigger trg_sync_carteira_embarques
-- ==============================================================================

-- 1. Adição das colunas de segregação de HH
ALTER TABLE public.carteira_embarques 
ADD COLUMN IF NOT EXISTS hh_carteira numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS hh_fora_carteira numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS hh_cancelado numeric NOT NULL DEFAULT 0;

-- 2. Remoção da coluna redundante operacao
ALTER TABLE public.carteira_embarques 
DROP COLUMN IF EXISTS operacao;

-- 3. Atualização da função de consolidação
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
    co.portal_id AS id_embarque,
    co.matricula,
    co.plataforma_sigla,
    co.unidade_negocio,
    co.data_inicio,
    MAX(co.data_fim) AS data_fim,
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao IN ('Carteira', 'Fora da carteira')), 0) AS horas_programadas,
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Carteira'), 0) AS hh_carteira,
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Fora da carteira'), 0) AS hh_fora_carteira,
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Cancelada'), 0) AS hh_cancelado,
    'portal_offshore' AS fonte,
    now() AS updated_at
  FROM public.carteira_operacoes co
  GROUP BY co.portal_id, co.matricula, co.plataforma_sigla, co.unidade_negocio, co.data_inicio
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

-- 4. Executa a sincronização para recalcular todos os embarques físicos existentes
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
  co.portal_id AS id_embarque,
  co.matricula,
  co.plataforma_sigla,
  co.unidade_negocio,
  co.data_inicio,
  MAX(co.data_fim) AS data_fim,
  COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao IN ('Carteira', 'Fora da carteira')), 0) AS horas_programadas,
  COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Carteira'), 0) AS hh_carteira,
  COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Fora da carteira'), 0) AS hh_fora_carteira,
  COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Cancelada'), 0) AS hh_cancelado,
  'portal_offshore' AS fonte,
  now() AS updated_at
FROM public.carteira_operacoes co
GROUP BY co.portal_id, co.matricula, co.plataforma_sigla, co.unidade_negocio, co.data_inicio
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
