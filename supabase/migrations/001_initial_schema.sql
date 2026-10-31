-- ==============================================================================
-- Schema Relacional: HH Offshore Infotec Brasil
-- Migration: 001_initial_schema.sql
-- Zero-Trust, Relacional, Idempotente, Sem Dados Sensíveis Versionados
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. Tabela: profiles (Extensão de auth.users com RBAC e Revogação em 0ms)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  nome text NOT NULL,
  role text NOT NULL DEFAULT 'preposto' CHECK (role IN ('admin', 'gestor', 'controlador', 'preposto')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 2. Tabela: plataformas (Catálogo e chave normalizada para match resiliente)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plataformas (
  sigla text PRIMARY KEY,
  chave_norm text NOT NULL UNIQUE,
  nome text NOT NULL,
  un text NOT NULL DEFAULT '',
  armador text NOT NULL DEFAULT '',
  gerencia text NOT NULL DEFAULT '',
  tipo text NOT NULL DEFAULT '',
  situacao text NOT NULL DEFAULT 'Mobilizada',
  cadastro_pendente boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 3. Tabela: pessoas (Responsáveis operacionais vinculados opcionalmente a login)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pessoas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  nome text NOT NULL,
  papel text NOT NULL DEFAULT 'preposto' CHECK (papel IN ('preposto', 'controlador', 'gestor')),
  email text NOT NULL DEFAULT '',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 4. Tabelas de Atribuição de Carteira: pessoa_plataformas & pessoa_unidades
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pessoa_plataformas (
  pessoa_id uuid NOT NULL REFERENCES public.pessoas(id) ON DELETE CASCADE,
  plataforma_sigla text NOT NULL REFERENCES public.plataformas(sigla) ON DELETE CASCADE,
  PRIMARY KEY (pessoa_id, plataforma_sigla)
);

CREATE TABLE IF NOT EXISTS public.pessoa_unidades (
  pessoa_id uuid NOT NULL REFERENCES public.pessoas(id) ON DELETE CASCADE,
  unidade_negocio text NOT NULL,
  PRIMARY KEY (pessoa_id, unidade_negocio)
);

-- ------------------------------------------------------------------------------
-- 5. Tabela: tecnicos (Colaboradores cadastrados pelas matrículas de carteira/HH)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tecnicos (
  matricula text PRIMARY KEY,
  nome text NOT NULL DEFAULT '',
  funcao text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 6. Tabela: carteira_embarques (Programação oficial do Portal Offshore)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carteira_embarques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula text NOT NULL REFERENCES public.tecnicos(matricula) ON DELETE RESTRICT,
  plataforma_sigla text REFERENCES public.plataformas(sigla) ON DELETE SET NULL,
  unidade_negocio text NOT NULL DEFAULT '',
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  horas_programadas numeric,
  operacao text NOT NULL DEFAULT '',
  pe numeric,
  ex numeric,
  fonte text NOT NULL DEFAULT 'carteira',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carteira_embarques_datas_check CHECK (data_fim >= data_inicio),
  CONSTRAINT carteira_embarques_matricula_data_inicio_key UNIQUE (matricula, data_inicio)
);

-- ------------------------------------------------------------------------------
-- 7. Tabela: apontamentos_hh (Horas efetivamente executadas por técnico/dia)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.apontamentos_hh (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula text NOT NULL REFERENCES public.tecnicos(matricula) ON DELETE RESTRICT,
  data date NOT NULL,
  plataforma_sigla text REFERENCES public.plataformas(sigla) ON DELETE SET NULL,
  unidade_negocio text NOT NULL DEFAULT '',
  horas_executadas numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apontamentos_hh_matricula_data_key UNIQUE (matricula, data)
);

-- ------------------------------------------------------------------------------
-- 8. Tabela: justificativas (Auditoria e SLA de justificativas operacionais)
-- Sem FK para apontamentos_hh permitindo justificar faltas 'sem: true' / 'Não chegou'
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.justificativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula text NOT NULL REFERENCES public.tecnicos(matricula) ON DELETE RESTRICT,
  data date NOT NULL,
  motivo text NOT NULL,
  horas_gangway numeric NOT NULL DEFAULT 0,
  descricao text NOT NULL DEFAULT '',
  responsavel_nome text NOT NULL DEFAULT '',
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT justificativas_matricula_data_key UNIQUE (matricula, data)
);

-- ------------------------------------------------------------------------------
-- 9. Tabela: configuracoes (Parâmetros matemáticos globais do contrato)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.configuracoes (
  id text PRIMARY KEY DEFAULT 'geral',
  hh_dia numeric NOT NULL DEFAULT 11,
  meta_percentual numeric NOT NULL DEFAULT 100,
  atencao_percentual numeric NOT NULL DEFAULT 90,
  dias_embarque smallint NOT NULL DEFAULT 14,
  dia_corte_medicao smallint NOT NULL DEFAULT 21 CHECK (dia_corte_medicao IN (1, 16, 21, 26)),
  prazo_justificativa_dias smallint NOT NULL DEFAULT 2,
  med_criterio text NOT NULL DEFAULT 'enc' CHECK (med_criterio IN ('enc', 'dias')),
  us_pe_padrao numeric,
  us_ex_padrao numeric,
  slogan text NOT NULL DEFAULT '',
  regionais_extras jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Inserção de registro padrão de configurações
INSERT INTO public.configuracoes (id, hh_dia, meta_percentual, atencao_percentual, dias_embarque, dia_corte_medicao, prazo_justificativa_dias, med_criterio)
VALUES ('geral', 11, 100, 90, 14, 21, 2, 'enc')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 10. Tabela: config_usoff_un (Pesos PE e EX por Unidade de Negócio)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.config_usoff_un (
  unidade_negocio text PRIMARY KEY,
  pe numeric,
  ex numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 11. Tabela: configuracoes_notificacao (E-mails confidenciais restritos a admin)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.configuracoes_notificacao (
  id text PRIMARY KEY DEFAULT 'geral',
  emails_resumo jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.configuracoes_notificacao (id, emails_resumo)
VALUES ('geral', '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 12. Tabela: fluxo_importacoes (Histórico e marcação de uploads)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fluxo_importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_fluxo text NOT NULL,
  origem text NOT NULL DEFAULT 'planilha',
  total_linhas integer NOT NULL DEFAULT 0,
  data_maxima date,
  observacao text NOT NULL DEFAULT '',
  usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 13. Tabela: sync_heartbeat (Linha única para sinalização cirúrgica Realtime)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_heartbeat (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sync_heartbeat (id, updated_at)
VALUES (1, now())
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- Índices de Otimização de Consultas & Filtros de Escopo
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_apontamentos_data ON public.apontamentos_hh (data);
CREATE INDEX IF NOT EXISTS idx_apontamentos_plat_data ON public.apontamentos_hh (plataforma_sigla, data);
CREATE INDEX IF NOT EXISTS idx_carteira_datas ON public.carteira_embarques (data_fim, data_inicio);
CREATE INDEX IF NOT EXISTS idx_carteira_plat_ini ON public.carteira_embarques (plataforma_sigla, data_inicio);
CREATE INDEX IF NOT EXISTS idx_carteira_mat ON public.carteira_embarques (matricula);
CREATE INDEX IF NOT EXISTS idx_justificativas_data ON public.justificativas (data);
CREATE INDEX IF NOT EXISTS idx_pessoas_user_id ON public.pessoas (user_id);
CREATE INDEX IF NOT EXISTS idx_pessoa_plat_sigla ON public.pessoa_plataformas (plataforma_sigla);
CREATE INDEX IF NOT EXISTS idx_plataformas_chave_norm ON public.plataformas (chave_norm);

-- ------------------------------------------------------------------------------
-- Triggers de Auditoria & Heartbeat Realtime
-- ------------------------------------------------------------------------------

-- Trigger 1: Auditoria de Justificativas (mantém criado_em imutável para SLA)
CREATE OR REPLACE FUNCTION public.fn_justificativas_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.criado_por := COALESCE(NEW.criado_por, auth.uid());
    NEW.criado_em := COALESCE(NEW.criado_em, now());
    NEW.updated_by := COALESCE(NEW.updated_by, auth.uid());
    NEW.updated_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.criado_por := OLD.criado_por;
    NEW.criado_em := OLD.criado_em;
    NEW.updated_by := COALESCE(auth.uid(), OLD.updated_by);
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_justificativas_audit ON public.justificativas;
CREATE TRIGGER trg_justificativas_audit
BEFORE INSERT OR UPDATE ON public.justificativas
FOR EACH ROW EXECUTE FUNCTION public.fn_justificativas_audit();

-- Trigger 2: Notificação leve em sync_heartbeat para escuta Realtime
CREATE OR REPLACE FUNCTION public.fn_touch_heartbeat()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.sync_heartbeat (id, updated_at)
  VALUES (1, now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_heartbeat_apontamentos ON public.apontamentos_hh;
CREATE TRIGGER trg_heartbeat_apontamentos
AFTER INSERT OR UPDATE OR DELETE ON public.apontamentos_hh
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_carteira ON public.carteira_embarques;
CREATE TRIGGER trg_heartbeat_carteira
AFTER INSERT OR UPDATE OR DELETE ON public.carteira_embarques
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_justificativas ON public.justificativas;
CREATE TRIGGER trg_heartbeat_justificativas
AFTER INSERT OR UPDATE OR DELETE ON public.justificativas
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_fluxo ON public.fluxo_importacoes;
CREATE TRIGGER trg_heartbeat_fluxo
AFTER INSERT ON public.fluxo_importacoes
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();
