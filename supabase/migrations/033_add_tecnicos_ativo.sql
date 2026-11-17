-- ==============================================================================
-- Migration: 033_add_tecnicos_ativo.sql
-- Garante a coluna booleana "ativo" em public.tecnicos para suportar o fluxo de
-- desativação/anonimização LGPD (Migrations 029 e 032) e auditoria WORM em
-- fn_audit_tecnicos() sem falhas de campo ausente em runtime.
-- ==============================================================================

ALTER TABLE public.tecnicos
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
