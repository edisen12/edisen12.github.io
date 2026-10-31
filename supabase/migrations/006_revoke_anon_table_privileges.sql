-- ==============================================================================
-- Migration: 006_revoke_anon_table_privileges.sql
-- Hardening Zero-Trust: Revogação Total de Privilégios DML da Role 'anon' em Tabelas
-- O papel 'anon' não possui permissão de leitura nem escrita em nenhuma tabela pública
-- ==============================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
