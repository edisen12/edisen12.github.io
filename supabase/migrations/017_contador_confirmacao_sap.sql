-- ==============================================================================
-- Migration: 017_contador_confirmacao_sap.sql
-- 1. Reseta a tabela confirmacoes_sap e os campos de conciliação SAP
-- 2. Adiciona a coluna contador_confirmacao (bigint) para distinguir lançamentos múltiplos no mesmo dia
-- 3. Atualiza a restrição de unicidade (uq_confirmacao_sap_row) incluindo contador_confirmacao
-- ==============================================================================

-- 1. Reset da base de confirmações do SAP e indicadores de conciliação
TRUNCATE TABLE public.confirmacoes_sap;

UPDATE public.carteira_operacoes
SET 
  hh_confirmado_sap = 0,
  divergencia_sap = 0,
  status_divergencia = 'Não Apontado no SAP',
  updated_at = now();

UPDATE public.carteira_embarques
SET 
  hh_confirmado_sap = 0,
  divergencia_confirmada = 0,
  updated_at = now();

-- 2. Adição da coluna contador_confirmacao como bigint (tratamento numérico que elimina zeros à esquerda)
ALTER TABLE public.confirmacoes_sap
ADD COLUMN IF NOT EXISTS contador_confirmacao bigint NOT NULL DEFAULT 0;

-- 3. Atualização da chave de unicidade
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
  horas_confirmadas,
  contador_confirmacao
);

-- 4. Índices para performance
CREATE INDEX IF NOT EXISTS idx_confirmacoes_sap_contador
ON public.confirmacoes_sap (contador_confirmacao);

CREATE INDEX IF NOT EXISTS idx_confirmacoes_sap_chave_contador
ON public.confirmacoes_sap (matricula, ordem, operacao, contador_confirmacao);
