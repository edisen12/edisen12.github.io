-- ==============================================================================
-- Migration 026: Índices de performance em confirmacoes_sap para consultas
-- janeladas por data_fim_real / data_lancamento / data_criacao e paginação
-- ordenada sem sequential sort completo na tabela.
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_confirmacoes_sap_fim_real
  ON public.confirmacoes_sap (data_fim_real DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_confirmacoes_sap_lancamento
  ON public.confirmacoes_sap (data_lancamento DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_confirmacoes_sap_criacao
  ON public.confirmacoes_sap (data_criacao DESC, id ASC);
