# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-03 10:41 (BRT) · HEAD `1bc33ac` (main sincronizada com origin) · Suíte: 24 arquivos / 449 testes ✅ · `tsc --noEmit` (front + server) ✅

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

### Modais do Sistema (Design System Infotec Elevado)
- `Modal.tsx` — primitivo acessível com suporte a `icon`, `subtitle`, elevação `--shadow-modal`, close button com hover e backdrop blur.
- `UserLoginModal` (`PessoasPlataformasView.tsx`) — provisionamento zero-touch e redefinição com inputs de ícone, alternador de senha (`Eye`/`EyeOff`), requisitos em tempo real e seleção de papel via cards operacionais explicativos.
- `NovoAdminModal` (`PessoasPlataformasView.tsx` e `AdminAuditView.tsx`) — criação com campos estilizados, ícones e feedback.
- `ResetPasswordModal`, `ToggleActiveModal`, `DeleteUserModal` (`AdminAuditView.tsx` e `PessoasPlataformasView.tsx`).
- `PessoaModal` e `PlataformaModal` (`PessoasPlataformasView.tsx`).
- `JustificativaModal`, `EmailComposerModal`, `ManualEntryModals` (`ManualHHModal`, `ManualEscalaModal`).

## 3. Estado Atual (Work in Progress)

- **Repaginação Geral de Modais e Sistema Unificado de Inputs:**
  - Causa raiz do aspecto "jogado/esquisito": `.fld` não possuía regras em nenhum arquivo CSS, fazendo com que `<label className="fld">` renderizasse como `display: inline` padrão do navegador com inputs/selects crus, sem alinhamento, sem padding nem tokens de foco.
  - Implementado design system de formulários em `src/styles/components.css`:
    1. `.fld`, `.fld-label`, `.fld-hint` com flexbox estruturado e tipografia do sistema;
    2. Inputs, selects (com seta SVG chevron) e textareas universais com tokens `--surface`, `--line`, foco com `--blue` e halo `--blue-soft`;
    3. Padrão `.input-with-icon` com leading icons e trailing action buttons (como alternador de senha);
    4. `.role-cards-grid` e `.role-card-option` para seleção interativa de papéis operacionais (Preposto, Controlador, Gestor);
    5. `.password-requirements-card` com checagem visual em tempo real;
    6. Atualização de `Modal.tsx` com `icon` e `subtitle`.
  - Repaginação completa aplicada em todos os modais do sistema:
    - `UserLoginModal`: e-mail com ícone, senha com `Eye`/`EyeOff` e check de 8 dígitos, seleção de papel em cards enriquecidos com badges e descrições contratuais;
    - `NovoAdminModal` (ambas as views): ícones `User`, `Mail`, `Lock`, alternador de senha;
    - `ResetPasswordModal`, `ToggleActiveModal`, `DeleteUserModal` (ambas as views): cartões informativos de usuário, confirmação assistida;
    - `PessoaModal` e `PlataformaModal`: inputs estruturados com ícones temáticos (`Anchor`, `Building2`, `Ship`, etc.);
    - `JustificativaModal`: fatos do dia em cards KPI, motivo com `.form-select`, horas com `.input-with-icon`, textarea e badge de usuário;
    - `EmailComposerModal`: chips dos responsáveis, campos "Para" e "Assunto" com ícones, textarea estilizada e botões de cópia/abertura;
    - `ManualEntryModals` (`ManualHHModal` e `ManualEscalaModal`): todos os campos convertidos para o novo padrão.
  - Suíte de validação:
    - `npm run typecheck` (front) → 0 erros ✅
    - `npx tsc -p server/tsconfig.json --noEmit` (server) → 0 erros ✅
    - `npm run test:run` → **24 arquivos / 449 testes passando** ✅
    - `npm run build` → bundle Vite de produção compilado com sucesso ✅

## 4. Próximos Passos (priorizados)

1. **Avisar à usuária Luanna** que ela já pode concluir a troca de senha na tela de primeiro acesso.
2. **Revisar e commitar** as alterações pendentes da working tree (Modais/Inputs + Exclusão em cascata + Dual-Topology + Migration 010 + memória).
3. **Decisão pendente do usuário — visibilidade da aba `adm`:** o código libera para `admin` **e** `gestor` (`App.tsx` usa `isGlobal`; `Sidebar.tsx:78` faz `isGlobal || role==='admin'`). Confirmar se gestor mantém acesso à aba ADM.
4. **Sincronizar `CONTEXT_MEMORY.md` com o código** (lista de desvios em `gotchas.md` §6).
