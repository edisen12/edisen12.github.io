# Política de Backup, Restauração Verificada e Separação de Ambientes

> Referência técnica alinhada à LGPD (Art. 46 — integridade e disponibilidade) e aos princípios de banco de dados em produção.

---

## 1. Regra de Ouro: Backup Sem Teste de Restauração Não Existe

Um backup só é considerado válido quando passa por restauração periódica em **banco isolado de validação/homologação** (nunca apontando para produção) com checagem de contagem das tabelas críticas.

### Topologia `baas` (Supabase Gerenciado)
1. **Snapshots / PITR:** manter backups diários ativos no painel do Supabase (ou Point-in-Time Recovery conforme plano contratado).
2. **Cópia externa periódica fora da nuvem primária (3-2-1):** exportar dump lógico (`pg_dump --format=custom`) a partir de uma credencial administrativa protegida em cofre (nunca no repositório Git) para armazenamento externo criptografado (S3 / Cloudflare R2 / cofre corporativo).
3. **Teste em Branch / Ambiente Isolado:** utilizar Supabase Database Branching ou container PostgreSQL local descartável para testar periodicamente [`scripts/backup-and-verify-restore.sh`](../scripts/backup-and-verify-restore.sh).

### Topologia `self-hosted` (VPS / Docker Compose)
1. O arquivo de backup **jamais deve permanecer apenas no mesmo disco/servidor** da aplicação (`postgres_data`). Sincronize o diretório `BACKUP_DIR` para um bucket externo criptografado (`rclone` / S3) imediatamente após a execução.
2. Agende no cron do host de infraestrutura (com `VERIFY_ADMIN_URL` apontando para um container PostgreSQL temporário de teste):
   ```cron
   0 3 * * * SOURCE_DATABASE_URL="postgres://..." VERIFY_ADMIN_URL="postgres://..." BACKUP_DIR="/mnt/offsite/hh-offshore" /opt/hh-offshore/scripts/backup-and-verify-restore.sh >> /var/log/hh-backup.log 2>&1
   ```
3. Restrinja permissões dos arquivos `.dump` (`chmod 600`) por conterem dados pessoais operacionais de técnicos.

---

## 2. Separação de Ambientes (Dev × Produção) e Migrations

- Toda alteração estrutural (tabelas, índices, constraints, políticas RLS e RPCs) deve ser versionada em [`supabase/migrations/`](../supabase/migrations/) em ordem sequencial (`001`..`031`+).
- **Nunca** altere o schema diretamente no painel web em produção sem gerar a respectiva migration no Git.
- Chaves `service_role`, tokens de deploy e senhas de banco pertencem exclusivamente a variáveis de ambiente server-side (`.env.vps`, Supabase Secrets) e jamais podem ser incluídas no bundle frontend ou no repositório público.

---

## 3. Atomicidade Transacional e Constraints no Motor do Banco

- Operações multi-tabela críticas no BaaS encapsulam gravação e limpeza de vínculos dentro de transações PostgreSQL (`save_pessoa_with_scopes` e `delete_tecnico_atomic`, Migration `031`).
- Regras numéricas e referenciais críticas ficam garantidas por constraints nativas (`CHECK`, `UNIQUE`, `FOREIGN KEY`, `NOT NULL`) e índices em chaves estrangeiras no PostgreSQL, além da validação de UX no frontend.
