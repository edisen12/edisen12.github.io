-- Migration 020: Sanitização Canônica de Plataformas e Aliases do Portal Offshore
-- Corrige siglas divergentes (PMXL1/PMXL -> MXL, PMLZ1 -> MLZ, PMNT1 -> PMNT, PAG-02 -> PAG2, PCR-01 -> PCR1)
-- Remove plataformas pendentes duplicadas e implementa trigger de auto-sanitização em carteira_operacoes.

-- 1. Atualizar apontamentos_hh legados para as siglas e unidades canônicas
UPDATE public.apontamentos_hh
SET plataforma_sigla = 'PAG2', unidade_negocio = 'GAD (Nordeste)'
WHERE plataforma_sigla = 'PAG-02';

UPDATE public.apontamentos_hh
SET plataforma_sigla = 'PCR1', unidade_negocio = 'GAD (Nordeste)'
WHERE plataforma_sigla = 'PCR-01';

UPDATE public.apontamentos_hh
SET plataforma_sigla = 'MLZ', unidade_negocio = 'Bacia de Santos (UN-BS)'
WHERE plataforma_sigla = 'PMLZ1';

UPDATE public.apontamentos_hh
SET plataforma_sigla = 'PMNT', unidade_negocio = 'Bahia (UN-BA)'
WHERE plataforma_sigla = 'PMNT1';

UPDATE public.apontamentos_hh
SET plataforma_sigla = 'MXL', unidade_negocio = 'Bacia de Santos (UN-BS)'
WHERE plataforma_sigla = 'PMXL';

-- 2. Deletar com segurança as plataformas pendentes duplicadas
DELETE FROM public.plataformas
WHERE sigla IN ('PAG-02', 'PCR-01', 'PMLZ1', 'PMNT1', 'PMXL', 'HFAB')
  AND cadastro_pendente = true;

-- 3. Trigger de auto-sanitização determinística na tabela carteira_operacoes
CREATE OR REPLACE FUNCTION public.fn_sanitize_carteira_plataforma()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.plataforma_sigla IS NOT NULL THEN
    CASE UPPER(TRIM(NEW.plataforma_sigla))
      WHEN 'PMXL1', 'PMXL' THEN
        NEW.plataforma_sigla := 'MXL';
        IF NEW.unidade_negocio IS NULL OR NEW.unidade_negocio = '' THEN
          NEW.unidade_negocio := 'Bacia de Santos (UN-BS)';
        END IF;
      WHEN 'PMLZ1', 'PMLZ' THEN
        NEW.plataforma_sigla := 'MLZ';
        IF NEW.unidade_negocio IS NULL OR NEW.unidade_negocio = '' THEN
          NEW.unidade_negocio := 'Bacia de Santos (UN-BS)';
        END IF;
      WHEN 'PMNT1' THEN
        NEW.plataforma_sigla := 'PMNT';
        IF NEW.unidade_negocio IS NULL OR NEW.unidade_negocio = '' THEN
          NEW.unidade_negocio := 'Bahia (UN-BA)';
        END IF;
      WHEN 'PAG-02', 'PAG02' THEN
        NEW.plataforma_sigla := 'PAG2';
        IF NEW.unidade_negocio IS NULL OR NEW.unidade_negocio = '' THEN
          NEW.unidade_negocio := 'GAD (Nordeste)';
        END IF;
      WHEN 'PCR-01', 'PCR01' THEN
        NEW.plataforma_sigla := 'PCR1';
        IF NEW.unidade_negocio IS NULL OR NEW.unidade_negocio = '' THEN
          NEW.unidade_negocio := 'GAD (Nordeste)';
        END IF;
      WHEN 'PCM-9', 'PCM-09', 'PCM09' THEN
        NEW.plataforma_sigla := 'PCM9';
        IF NEW.unidade_negocio IS NULL OR NEW.unidade_negocio = '' THEN
          NEW.unidade_negocio := 'GAD (Nordeste)';
        END IF;
      WHEN 'PPE-1A', 'PPE-01A' THEN
        NEW.plataforma_sigla := 'PPE1A';
        IF NEW.unidade_negocio IS NULL OR NEW.unidade_negocio = '' THEN
          NEW.unidade_negocio := 'Bahia (UN-BA)';
        END IF;
      WHEN 'PRA-1', 'PRA-01' THEN
        NEW.plataforma_sigla := 'PRA1';
        IF NEW.unidade_negocio IS NULL OR NEW.unidade_negocio = '' THEN
          NEW.unidade_negocio := 'Espírito Santo (UN-ES)';
        END IF;
      WHEN 'P-09' THEN
        NEW.plataforma_sigla := 'P09';
      ELSE
        -- Normaliza padrão P-XX para PXX (ex: P-18 -> P18, P-25 -> P25)
        IF NEW.plataforma_sigla ~* '^P-[0-9]+$' THEN
          NEW.plataforma_sigla := REPLACE(UPPER(TRIM(NEW.plataforma_sigla)), '-', '');
        END IF;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sanitize_carteira_plataforma ON public.carteira_operacoes;
CREATE TRIGGER trg_sanitize_carteira_plataforma
BEFORE INSERT OR UPDATE OF plataforma_sigla, unidade_negocio ON public.carteira_operacoes
FOR EACH ROW
EXECUTE FUNCTION public.fn_sanitize_carteira_plataforma();
