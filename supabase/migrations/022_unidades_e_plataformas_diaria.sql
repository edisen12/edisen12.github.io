-- Migration 022: Sinalização e Identificação de Unidades e Plataformas por Diária
-- Permite identificar explicitamente quais unidades/plataformas operam no regime de diária
-- contratual (fórmula dias * 10), mesmo com apontamentos de HH.

-- 1. Coluna tipo_medicao na tabela plataformas ('hh' ou 'diaria')
ALTER TABLE public.plataformas
ADD COLUMN IF NOT EXISTS tipo_medicao text NOT NULL DEFAULT 'hh';

-- 2. Coluna tipo_medicao na tabela config_usoff_un ('hh' ou 'diaria')
ALTER TABLE public.config_usoff_un
ADD COLUMN IF NOT EXISTS tipo_medicao text NOT NULL DEFAULT 'hh';

-- 3. Atualizar plataformas que já possuem Diária no tipo ou são armador
UPDATE public.plataformas
SET tipo_medicao = 'diaria'
WHERE tipo ILIKE '%diária%'
   OR tipo ILIKE '%diaria%'
   OR un = 'Armador'
   OR un = 'FPSOs afretados';

-- 4. Atualizar config_usoff_un para UNs de diária
UPDATE public.config_usoff_un
SET tipo_medicao = 'diaria'
WHERE unidade_negocio = 'Armador'
   OR unidade_negocio = 'FPSOs afretados'
   OR unidade_negocio ILIKE '%diária%'
   OR unidade_negocio ILIKE '%diaria%';
