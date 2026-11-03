# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-03 10:35 (BRT) · HEAD `7f0ccf4` + working tree (Exclusão em cascata de pessoas/credenciais + Dual-Topology + Migration 010) · Suíte: 24 arquivos / 449 testes ✅ · `tsc --noEmit` (front + server) ✅

## 1. Resumo Executivo

- **Objetivo:** SPA corporativa multiusuário para gestão de Homem-Hora (HH) e medição contratual USOFF de técnicos embarcados em plataformas offshore. Substitui um `index.html` monolítico legado (~1 MB) mantendo **resultado numérico idêntico** ao motor original.
- **Stack:** React 19 + TypeScript 5.7 (strict) + Vite 6 · CSS puro com tokens · `lucide-react` · SheetJS (`xlsx`, import dinâmico) · Persistência Dual-Topology (`baas` via registry aberto, default Supabase PostgreSQL 17 + Auth + RLS + Edge Function Deno + Realtime; ou `self-hosted` com Nginx + Backend Node 22/TS `server/` + `UniversalStorageDriverPort` para qualquer banco SQL/NoSQL em Docker/VPS) · Vitest 3 + happy-dom + Testing Library · GitHub Pages + GitHub Actions (Node 22).
- **Supabase prod (topologia `baas` default):** project ref `fwdvrkfootvublicetim`, região `sa-east-1`.
- **Repositório PÚBLICO** (`edisen12.github.io`): zero PII/segredos em qualquer arquivo versionado — inclusive nesta pasta `.agent/`.
- **Referência profunda:** `CONTEXT_MEMORY.md` (61 KB). **Não leia inteiro.** Use `grep`/leitura por seção apenas quando precisar de detalhe que não está aqui. Ele tem desvios conhecidos (ver `gotchas.md` §6).

## 2. Zonas Consolidadas (Ignore List Contextual)

> **Instrução para futuras sessões:** os itens abaixo estão prontos, testados e validados. **NÃO abra, leia, inspecione nem refatore** estes arquivos a menos que (a) o usuário peça explicitamente, ou (b) a tarefa atual dependa diretamente da lógica interna deles. Para usar uma função, confie na assinatura/descrição em `patterns.md` e `decisions.md`.

### Motor de domínio (puro, coberto por testes — invariantes contratuais)
- `src/domain/periods.ts` — ciclos de corte 1/16/21/26 + janela de lookback de 45 dias.
- `src/domain/calculations.ts` — resolução diária, "Não chegou", gangway, agregações, embarques, SLA de cobrança.
- `src/domain/usoff.ts` — agrupamento por OP, cascata PE/EX em 3 níveis, trava `falta`.
- `src/domain/communications.ts` — textos e deeplinks Outlook/mailto/WhatsApp com sanitização.
- `src/domain/demo.ts` — overlay sintético sem PII.
- `src/domain/types.ts` — contratos centrais (só editar ao adicionar campos novos).
- Testes: `src/domain/__tests__/*` (domain, calculations, periods, usoff, communications).

### Utilitários
- `src/utils/date.ts`, `src/utils/format.ts` + `src/utils/__tests__/date-format.test.ts` (55 testes).

### Serviços & Abstração Client-Side (Dual-Topology)
- `src/ports/{auth,data,realtime,client-provider,baas-connector}.port.ts` — contratos agnósticos de Auth, Data, Realtime e BaaS.
- `src/adapters/shared/client-pipeline.ts` — pipeline compartilhado (`assembleAppDataset`, batching topológico, chunks de 500, ordenação determinística por chave natural, validação de senha, debounce Realtime de 450 ms, overlay demo).
- `src/config/env.ts`, `src/config/topology-guard.ts`, `src/services/provider.registry.ts` — resolução de topologia (`baas` vs `self-hosted`) e travas de build/runtime contra bancos puros em BaaS, segredos `VITE_*` e deploy estático indevido.
- `src/adapters/baas/{registry,index}.ts`, `src/adapters/baas/providers/{supabase.config,supabase.connector}.ts` — registry aberto de BaaS (`registerBaaSConnector`) + conector Supabase com checagem explícita de `{ error }` em 100% das chamadas (incluindo plataformas/técnicos pendentes, deleção de escopos, `fluxo_importacoes` e fallback `user_onboarding`).
- `src/adapters/self-hosted/{http.client,self-hosted.provider,index}.ts` — cliente HTTP `credentials: 'same-origin'` com `X-CSRF-Token` apenas em memória (zero tokens em `localStorage`) + SSE Realtime (`/api/v1/realtime/events`).
- `src/services/{supabase,auth.service,data.service,realtime.service}.ts` (fachadas 100% retrocompatíveis) e `src/services/excel.service.ts` (parser, 4 exportadores, sanitização anti-fórmula).

### Backend Supabase (Topologia `baas` default)
- `supabase/migrations/001` → `010` — **imutáveis**. Migration `010_fix_user_onboarding_rls_recursion.sql` criada e aplicada no banco de prod `fwdvrkfootvublicetim` (corrige recursão infinita 42P17 em `user_onboarding` e promove `complete_first_login_password_change` a `SECURITY DEFINER`).
- `supabase/functions/admin-users/index.ts` — Edge Function v4 (create, update-role, reset-password, toggle-active, delete-user + travas anti-lockout + auditoria WORM).
- `src/types/database.types.ts` — gerado; só regenerar, nunca editar à mão.

### Backend Universal Self-Hosted & Infraestrutura VPS / Docker (Topologia `self-hosted`)
- `server/package.json`, `server/tsconfig.json` — servidor Node 22/TS puro (`node:http`, `node:crypto`), zero dependências npm obrigatórias.
- `server/src/ports/universal-storage.port.ts` — `UniversalStorageDriverPort` (7 primitivas universais: `init`, `close`, `findOne`, `findMany`, `upsertMany`, `deleteMany`, `appendImmutable` + `runInTransaction` opcional).
- `server/src/drivers/{registry,in-memory.driver,generic-sql.driver,generic-document.driver}.ts` — registry aberto (`registerStorageDriver` / `DB_DRIVER_MODULE`) + `GenericSqlDialectDriver` parametrizado (Postgres, MariaDB/MySQL, SQLite, MSSQL, Oracle, CockroachDB) + `GenericDocumentDriver` (MongoDB, CouchDB, DynamoDB) + `InMemoryStorageDriver`.
- `server/src/core/{crypto,realtime-hub,domain-engine.service}.ts`, `server/src/{app,index}.ts` — aplicação server-side de 100% das regras de negócio e segurança (sessões stateful `scrypt` + Cookie `HttpOnly; Secure; SameSite=Strict` + CSRF, corte 0ms de inativo, gate de 1º login, RBAC por carteira, Zero-Knowledge `externalCoveredDays`, anti-oráculo `sharedOps`, SLA imutável em `justificativas`, auditoria WORM `system_audit_logs`, travas anti-lockout de `admin-users` e SSE Realtime).
- `docker/{frontend,backend}.Dockerfile`, `docker/nginx/nginx.conf`, `docker-compose.yml` (2 redes isoladas: `frontend-net` pública e `backend-net` `internal: true` sem portas de banco no host + profiles plugáveis) · `.env.example` · `.env.vps.example` · `docs/DATABASE_ABSTRACTION.md`.

### Segurança e infraestrutura de testes
- `src/security/__tests__/*` (rbac, rls-policies, admin-users-edge, first-login-gate-security, data-leakage-and-sanitization).
- `src/adapters/__tests__/{topology-and-baas-registry,self-hosted-universal-drivers}.test.ts` (34 testes cobrindo travas de topologia, registry BaaS, drivers universais SQL/NoSQL e integração real HTTP Cookie `HttpOnly` + CSRF + RBAC + WORM).
- `src/services/__tests__/{auth,data,excel}.service.test.ts`.
- `src/test/setup.ts`, `src/test/mockSupabase.ts`, `src/test/testFixtures.ts`.

### UI consolidada (com testes dedicados)
- Componentes: `DataTable`, `SegmentedControl`, `Sidebar` (+ `__tests__`), e os primitivos `AppShell`, `Drawer`, `KpiCard`, `MeterBar`, `Modal`, `ScopeBanner`, `Sparkline120`, `StatusPill`, `StickyFilterBar`, `ToastContext`, `TopHeader`.
- Views: `LoginView`, `FirstLoginGate`, `UserSettingsView`, `ConfiguracoesView`, `AdminAuditView` (+ `__tests__`).
- `src/App.tsx` (gate de auth + roteador de abas), `src/main.tsx`, `src/ui/state/AppContext.tsx`.

### Estilos, build e CI/CD
- `src/styles/{reset,tokens,layout,components}.css` — design system Infotec (azul `#1E4E9C` / laranja `#F5A100`, light/dark).
- `vite.config.ts` (alias condicional `@active-adapter`, CSP dinâmica por topologia e auditoria pós-build `closeBundle()` zero-leak em `self-hosted`), `vitest.config.ts`, `tsconfig.json`, `index.html` (CSP + frame-busting), `.gitignore`.
- `.github/workflows/deploy.yml` (typecheck → test → build → Pages) e `supabase-keepalive.yml`.

### Estáveis mas SEM cobertura de teste de UI (podem ser abertos se a tarefa exigir — mexer com cuidado)
- `VisaoGeralView`, `PainelDiaView`, `EmbarqueAtualView`, `JustificativasView`, `MedicaoRelatoriosView`, `MedicaoUsoffView`, `ImportarDadosView`, `PessoasPlataformasView` (85 KB, maior arquivo).
- Modais: `JustificativaModal`, `FichaTecnicoDrawer`, `EmailComposerModal`, `ManualEntryModals`.

## 3. Estado Atual (Work in Progress)

- **Exclusão em Cascata de Pessoas e Credenciais (Resolução de Contas Órfãs):**
  - Causa raiz: `deletePessoa` executava apenas `DELETE FROM pessoas WHERE id = id`. Como `profiles`, `auth.users` e `user_onboarding` não possuíam FK cascade direta a `pessoas`, as credenciais de login continuavam ativas e visíveis na tabela de credenciais (ou geravam erro 400 de e-mail duplicado ao tentar recadastrar a pessoa).
  - Correção implementada:
    1. `deletePessoa` (BaaS e Self-Hosted): antes de deletar a pessoa, localiza o `user_id` vinculado (ou busca perfil correspondente por e-mail) e aciona `action: 'delete-user'` via Edge Function / Server, removendo o usuário no GoTrue `auth.users`, em `profiles` e em `user_onboarding`, além de registrar auditoria WORM;
    2. Salvaguardas anti-lockout: caso a remoção do usuário seja bloqueada (tentativa de auto-exclusão de admin ou de remoção do último admin ativo), a exclusão da pessoa é abortada com mensagem clara;
    3. `invokeAdminUsers`: implementada extração de erro de `FunctionsHttpError` (via `(error.context as Response).clone().json()`), substituindo a mensagem genérica `"Edge Function returned a non 2xx status code"` pelo erro real da API;
    4. `UserLoginModal`: adicionado botão "Excluir credenciais" com confirmação inline de segurança em dois cliques, permitindo revogar o login de uma pessoa sem necessariamente excluí-la do cadastro operacional.
  - Testes: novos testes em `src/services/__tests__/data.service.test.ts` cobrindo a exclusão conjunta, exclusão de pessoa sem login e bloqueio por salvaguarda anti-lockout.
- **Correção de Recursão Infinita em `user_onboarding` (Migration 010):**
  - Causa raiz: na migration 007, a política `user_onboarding_update_policy` inseriu subconsultas na própria tabela `user_onboarding` dentro da cláusula `WITH CHECK`, disparando o erro PostgreSQL `42P17: infinite recursion detected in policy for relation "user_onboarding"` na compilação do query rewriter de qualquer `UPDATE`. Além disso, a RPC `complete_first_login_password_change` era `SECURITY INVOKER`, rodando sob RLS.
  - Correção implementada e aplicada no banco de produção (`fwdvrkfootvublicetim`):
    1. `user_onboarding_update_policy` limpa e sem recursão;
    2. Trigger anti-bypass em PL/pgSQL (`trg_prevent_user_onboarding_flag_bypass`) que impede alteração direta das flags de segurança por usuários sem passar pela RPC autorizada ou sem ser admin;
    3. `complete_first_login_password_change()` promovida a `SECURITY DEFINER` com token transacional de sessão `app.allow_first_login_completion`.
  - Migration versionada em `supabase/migrations/010_fix_user_onboarding_rls_recursion.sql` e aplicada no Supabase via MCP `apply_migration`.
  - Conta da Luanna validada no banco (ativa, aguardando conclusão normal de primeiro acesso).
- **Abstração Dual-Topology e Validações de Suíte:**
  - `npm run typecheck` (frontend) → 0 erros ✅
  - `npx tsc -p server/tsconfig.json --noEmit` (backend `server/`) → 0 erros ✅
  - `npm run test:run` → **24 arquivos / 449 testes passando** ✅
  - `npm run build` → build Vite de produção gerado com sucesso ✅
- **Memória nativa:** sincronizada em `.agent/memory/*`.

## 4. Próximos Passos (priorizados)

1. **Avisar à usuária Luanna** que ela já pode concluir a troca de senha na tela de primeiro acesso (se estiver com a tela aberta, basta clicar em salvar novamente; se fechar, entrar com a senha definida ou provisória e salvar).
2. **Revisar e commitar** as alterações pendentes da working tree (Dual-Topology + Migration 010 + memória).
3. **Decisão pendente do usuário — visibilidade da aba `adm`:** o código libera para `admin` **e** `gestor` (`App.tsx` usa `isGlobal`; `Sidebar.tsx:78` faz `isGlobal || role==='admin'`). Confirmar se gestor mantém acesso à aba ADM.
4. **Sincronizar `CONTEXT_MEMORY.md` com o código** (lista de desvios em `gotchas.md` §6).
