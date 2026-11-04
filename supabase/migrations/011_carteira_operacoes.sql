-- ==============================================================================
-- Migration: 011_carteira_operacoes.sql
-- Detalhamento Granular de Ordens e Operações da Carteira do Portal Offshore
-- Mantém rastreabilidade completa de Carteira, Fora da Carteira e Canceladas
-- Sincroniza automaticamente a presença consolidada em carteira_embarques
-- ==============================================================================

-- 1. Criação da tabela granular de operações da carteira
CREATE TABLE IF NOT EXISTS public.carteira_operacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id text NOT NULL DEFAULT '',
  matricula text NOT NULL REFERENCES public.tecnicos(matricula) ON DELETE RESTRICT,
  chave_petrobras text NOT NULL DEFAULT '',
  nome text NOT NULL DEFAULT '',
  empresa text NOT NULL DEFAULT '',
  estrutura text NOT NULL DEFAULT '',
  unidade_negocio text NOT NULL DEFAULT '',
  plataforma_sigla text REFERENCES public.plataformas(sigla) ON DELETE SET NULL,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  ordem text NOT NULL,
  operacao text NOT NULL,
  status_processamento text NOT NULL DEFAULT 'Pendente',
  prioridade text NOT NULL DEFAULT 'Regular',
  status_programacao text NOT NULL DEFAULT 'Carteira',
  hh_programado numeric NOT NULL DEFAULT 0,
  hh_confirmado numeric NOT NULL DEFAULT 0,
  recursos integer NOT NULL DEFAULT 1,
  fonte text NOT NULL DEFAULT 'portal_offshore',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carteira_operacoes_datas_check CHECK (data_fim >= data_inicio),
  CONSTRAINT carteira_operacoes_unique_key UNIQUE (matricula, data_inicio, ordem, operacao)
);

-- 2. Índices de alta performance
CREATE INDEX IF NOT EXISTS idx_cart_ops_datas ON public.carteira_operacoes (data_fim, data_inicio);
CREATE INDEX IF NOT EXISTS idx_cart_ops_mat ON public.carteira_operacoes (matricula);
CREATE INDEX IF NOT EXISTS idx_cart_ops_ordem ON public.carteira_operacoes (ordem);
CREATE INDEX IF NOT EXISTS idx_cart_ops_plat ON public.carteira_operacoes (plataforma_sigla);
CREATE INDEX IF NOT EXISTS idx_cart_ops_portal_id ON public.carteira_operacoes (portal_id);
CREATE INDEX IF NOT EXISTS idx_cart_ops_status_prog ON public.carteira_operacoes (status_programacao);

-- 3. Trigger Realtime de Heartbeat
DROP TRIGGER IF EXISTS trg_heartbeat_carteira_operacoes ON public.carteira_operacoes;
CREATE TRIGGER trg_heartbeat_carteira_operacoes
AFTER INSERT OR UPDATE OR DELETE ON public.carteira_operacoes
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();

-- 4. Função e Trigger para Sincronização Automática com carteira_embarques
-- Consolida o embarque físico do técnico (1 linha por ciclo com HP somado de 'Carteira')
CREATE OR REPLACE FUNCTION public.sync_carteira_embarques_from_operacoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.carteira_embarques (
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
    co.matricula,
    co.plataforma_sigla,
    co.unidade_negocio,
    co.data_inicio,
    MAX(co.data_fim) AS data_fim,
    COALESCE(SUM(co.hh_programado) FILTER (WHERE co.status_programacao = 'Carteira'), 0) AS horas_programadas,
    STRING_AGG(DISTINCT co.ordem, ', ' ORDER BY co.ordem) AS operacao,
    'portal_offshore' AS fonte,
    now() AS updated_at
  FROM public.carteira_operacoes co
  GROUP BY co.matricula, co.plataforma_sigla, co.unidade_negocio, co.data_inicio
  ON CONFLICT (matricula, data_inicio) DO UPDATE SET
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

DROP TRIGGER IF EXISTS trg_sync_carteira_embarques ON public.carteira_operacoes;
CREATE TRIGGER trg_sync_carteira_embarques
AFTER INSERT OR UPDATE OR DELETE ON public.carteira_operacoes
FOR EACH STATEMENT EXECUTE FUNCTION public.sync_carteira_embarques_from_operacoes();

-- 5. Configuração de RLS (Row Level Security)
ALTER TABLE public.carteira_operacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carteira_operacoes_select_policy" ON public.carteira_operacoes;
CREATE POLICY "carteira_operacoes_select_policy" ON public.carteira_operacoes
FOR SELECT TO authenticated
USING (
  (SELECT public.auth_is_active()) AND (
    (SELECT public.auth_is_global())
    OR plataforma_sigla = ANY((SELECT public.auth_allowed_platforms()))
    OR unidade_negocio = ANY((SELECT public.auth_allowed_uns()))
  )
);

DROP POLICY IF EXISTS "carteira_operacoes_global_write_policy" ON public.carteira_operacoes;
CREATE POLICY "carteira_operacoes_global_write_policy" ON public.carteira_operacoes
FOR ALL TO authenticated
USING ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()))
WITH CHECK ((SELECT public.auth_is_active()) AND (SELECT public.auth_is_global()));

-- 6. Grants e restrições de permissão
REVOKE ALL ON public.carteira_operacoes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carteira_operacoes TO authenticated;
GRANT ALL ON public.carteira_operacoes TO service_role;
