#!/usr/bin/env bash
# ==============================================================================
# Script de Backup Físico + Teste Automatizado de Restauração (Disaster Recovery)
# HH Offshore · Infotec Brasil
#
# Princípio de Engenharia ("Backup que volta"):
# 1. Gera dump lógico consistente (pg_dump -Fc) fora da pasta da aplicação/disco principal.
# 2. Restaura em um banco TEMPORÁRIO de verificação (NUNCA em produção!).
# 3. Valida presença e integridade básica das tabelas críticas (profiles, tecnicos,
#    carteira_embarques, apontamentos_hh, justificativas, system_audit_logs).
# 4. Remove o banco temporário após validar e imprime relatório final.
#
# Uso recomendado (Linux VPS / Docker self-hosted ou pg_dump externo):
#   SOURCE_DATABASE_URL="postgres://..." \
#   VERIFY_ADMIN_URL="postgres://postgres:***@verify-postgres:5432/postgres" \
#   BACKUP_DIR="/mnt/offsite-backups/hh-offshore" \
#   ./scripts/backup-and-verify-restore.sh
# ==============================================================================
set -euo pipefail

SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:-}"
VERIFY_ADMIN_URL="${VERIFY_ADMIN_URL:-}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hh-offshore}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PG_SCHEMA="${PG_SCHEMA:-}"

if [[ -z "$SOURCE_DATABASE_URL" ]]; then
  echo "ERRO: defina SOURCE_DATABASE_URL (somente leitura / dump de origem)." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="${BACKUP_DIR}/hhoffshore_${STAMP}.dump"

DUMP_ARGS=(--format=custom --no-owner --no-privileges --file="$DUMP_FILE")
if [[ -n "$PG_SCHEMA" ]]; then
  DUMP_ARGS+=(--schema="$PG_SCHEMA")
fi

echo "[1/4] Gerando dump PostgreSQL em ${DUMP_FILE}..."
pg_dump "${DUMP_ARGS[@]}" "$SOURCE_DATABASE_URL"
chmod 600 "$DUMP_FILE"

if [[ ! -s "$DUMP_FILE" ]]; then
  echo "ERRO: arquivo de dump vazio ou não gerado: $DUMP_FILE" >&2
  exit 1
fi

echo "[2/4] Dump criado com sucesso ($(du -h "$DUMP_FILE" | cut -f1))."

if [[ -n "$VERIFY_ADMIN_URL" ]]; then
  VERIFY_DB="hhoff_restore_check_${STAMP}"
  echo "[3/4] Testando restauração isolada no banco temporário '${VERIFY_DB}'..."

  cleanup() {
    psql "$VERIFY_ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${VERIFY_DB}\" WITH (FORCE);" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  psql "$VERIFY_ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${VERIFY_DB}\";"
  VERIFY_DB_URL="$(echo "$VERIFY_ADMIN_URL" | sed -E "s#/[^/?]+(\?.*)?\$#/${VERIFY_DB}\1#")"

  # Ignora extensões específicas de provedor se ausentes no container de teste local, mas falha em erros SQL graves
  pg_restore --no-owner --no-privileges --dbname="$VERIFY_DB_URL" "$DUMP_FILE"

  echo "[4/4] Validando integridade estrutural das tabelas críticas restauradas..."
  psql "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 -c "
    SELECT
      (SELECT count(*) FROM public.profiles) AS profiles,
      (SELECT count(*) FROM public.plataformas) AS plataformas,
      (SELECT count(*) FROM public.tecnicos) AS tecnicos,
      (SELECT count(*) FROM public.carteira_embarques) AS carteira_embarques,
      (SELECT count(*) FROM public.apontamentos_hh) AS apontamentos_hh,
      (SELECT count(*) FROM public.justificativas) AS justificativas,
      (SELECT count(*) FROM public.system_audit_logs) AS system_audit_logs;
  "

  cleanup
  trap - EXIT
  echo "OK: Backup e teste de restauração concluídos com sucesso!"
else
  echo "[3/4] AVISO: VERIFY_ADMIN_URL não informado; pulando restauração automatizada."
  echo "      Para validar que o backup realmente volta, configure VERIFY_ADMIN_URL em instância isolada de homologação."
fi

# Rotação segura de backups locais antigos conforme janela configurada
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'hhoffshore_*.dump' -mtime +"$RETENTION_DAYS" -delete || true
