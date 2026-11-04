-- ==============================================================================
-- Migration: 012_carteira_id_embarque.sql
-- Adiciona id_embarque na tabela carteira_embarques e atualiza o trigger de sincronização
-- Substitui a lista de ordens em 'operacao' pelo ID do embarque/carteira do Portal Offshore
-- ==============================================================================

-- 1. Adição da coluna id_embarque em carteira_embarques
ALTER TABLE public.carteira_embarques 
ADD COLUMN IF NOT EXISTS id_embarque text NOT NULL DEFAULT '';

-- 2. Índice para consultas rápidas por id_embarque
CREATE INDEX IF NOT EXISTS idx_carteira_id_embarque 
ON public.carteira_embarques (id_embarque);

-- 3. Atualização da função e trigger de sincronização
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
    operacao,
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
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Carteira'), 0) AS horas_programadas,
    co.portal_id AS operacao,
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
    operacao = EXCLUDED.operacao,
    fonte = EXCLUDED.fonte,
    updated_at = now();

  RETURN NULL;
END;
$$;

-- 4. Inserção de plataformas de apoio / UMS / afretadas necessárias para integridade referencial
INSERT INTO public.plataformas (sigla, chave_norm, nome, un, situacao, cadastro_pendente)
VALUES 
  ('CDAN', 'CDAN', 'FPSO CIDADE DE ANCHIETA', 'FPSOs afretados', 'Mobilizada', false),
  ('FPAR', 'FPAR', 'FPSO CIDADE DE ANGRA DOS REIS', 'FPSOs afretados', 'Mobilizada', false),
  ('FPMA', 'FPMA', 'FPSO CIDADE DE MANGARATIBA', 'FPSOs afretados', 'Mobilizada', false),
  ('FPPA', 'FPPA', 'FPSO CIDADE DE PARATY', 'FPSOs afretados', 'Mobilizada', false),
  ('FPPL', 'FPPL', 'FPSO PIONEIRO DE LIBRA', 'FPSOs afretados', 'Mobilizada', false),
  ('UMCP', 'UMCP', 'UMS PRAIA DO CABO FRIO', 'Armador', 'Mobilizada', false),
  ('UMLI', 'UMLI', 'UMS LAGOA DE IMBOASSICA', 'Armador', 'Mobilizada', false),
  ('URUCU', 'URUCU', 'URUCU - PROVINCIA PETROLIFERA', 'Amazonas (UN-AM)', 'Mobilizada', false)
ON CONFLICT (sigla) DO NOTHING;
