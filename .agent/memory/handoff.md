# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-03 22:48 (BRT) · HEAD `94622af` (main sincronizada com origin e deploy Pages disparado) · Suíte: 24 arquivos / 449 testes ✅ · `npm run typecheck` ✅ · `npm run build` ✅

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
- `supabase/migrations/001` → `013` — **imutáveis**.
  - `010_fix_user_onboarding_rls_recursion.sql`: recursão RLS e RPC `complete_first_login_password_change`.
  - `011_carteira_operacoes.sql`: tabela granular `carteira_operacoes`, trigger `trg_sync_carteira_embarques` que consolida fisicamente em `carteira_embarques`.
  - `012_carteira_id_embarque.sql`: inclusão de `id_embarque text NOT NULL DEFAULT ''`.
  - `013_carteira_programada_e_id_embarque.sql`: regra dos 12 dias (`horas_programadas` = `Carteira` + `Fora da carteira`), colunas `hh_carteira`, `hh_fora_carteira` e `hh_cancelado`, e remoção da coluna física redundante `operacao` de `carteira_embarques`.
- `supabase/functions/admin-users/index.ts` — Edge Function v4 (create, update-role, reset-password, toggle-active, delete-user + travas anti-lockout + auditoria WORM).
- `src/types/database.types.ts` — gerado; só regenerar via MCP `generate_typescript_types`, nunca editar à mão.

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

- **Carga de Técnicos, Operações da Carteira, Regra dos 12 Dias e Limpeza da Visão Embarque Atual (Consolidado ✅):**
  - **136 técnicos** carregados em `public.tecnicos` (100% de cobertura; 0 faltantes em relação ao extrato operacional).
  - **54 plataformas/UMS** cadastradas e verificadas em `public.plataformas` (todas as unidades referenciadas na carteira possuem sigla normalizada).
  - **Migration 011, 012 & 013 aplicadas:** `carteira_operacoes` populada com **1.777 registros** granulares (1.440 status `'Carteira'`, 312 `'Fora da carteira'`, 25 `'Cancelada'`).
  - **Regra dos 12 Dias e Consolidação Física Automática:** O trigger `sync_carteira_embarques_from_operacoes()` em `carteira_embarques` consolida:
    - `horas_programadas`: soma de `hh_programado` onde status ∈ (`Carteira`, `Fora da carteira`) = **8.862,70h** em todo o contrato.
    - Colunas granulares adicionadas: `hh_carteira` (7.447,00h), `hh_fora_carteira` (1.415,70h), `hh_cancelado` (133,00h).
    - `operacao` redundante removida fisicamente de `carteira_embarques`; `id_embarque` é a referência unificada.
  - **Visão de Embarque Atual (`EmbarqueAtualView.tsx`) Padronizada:**
    - Removida coluna calculada artificial "Programado até agora".
    - Cabeçalhos padronizados: `HH programado`, `HH disponível`, `HH executado`, `% Exec. / Disponível` (meta diária) e `% Exec. / Programado` (progresso total real).
    - KPI cards simplificados e alinhados com a terminologia da operação.
  - **Frontend e Tipagens Sincronizadas:** `CarteiraEmbarque` e `CarteiraOperacao` em `src/domain/types.ts`; `database.types.ts` regenerado via Supabase MCP; `assembleAppDataset` mapeando novos campos.
  - **Higienização de Scratch:** Todos os arquivos temporários de processamento com dados foram eliminados.
  - **Validação de Código:** `npm run typecheck`, `npm run test:run` (24 suítes / 449 testes) e `npm run build` 100% verdes.

- **Aguardando Entrada do Usuário:**
  - Envio da planilha de **Confirmações do SAP** (ou amostra de suas colunas) para criação da tabela `public.confirmacoes_sap` e modelagem da lógica de conciliação (+4 dias após o fim do embarque, reconciliação de datas de criação/lançamento vs. início/fim real, e tratamento de estornos/reversões).

## 4. Próximos Passos (priorizados)

1. **Aguardar amostra/planilha de Confirmações do SAP** do usuário para definir o esquema da tabela e as regras de cruzamento com as ordens da carteira.
2. **Desenvolver módulo de confronto:** estruturar regras de conferência de apontamentos (período do embarque, tolerância de +4 dias, batimento de horas confirmadas vs programadas por ordem/operação, estornos).
3. **Frontend Integration para Operações e Confirmações:**
   - Adicionar adaptadores e leitor de arquivo no `ImportarDadosView.tsx` para o Portal Offshore e extrato de confirmação SAP.
   - Exibir detalhamento granular nas telas de medição e justificativas.
4. **Decisão pendente do usuário — visibilidade da aba `adm`:** o código libera para `admin` **e** `gestor` (`App.tsx` usa `isGlobal`; `Sidebar.tsx:78` faz `isGlobal || role==='admin'`). Confirmar se gestor mantém acesso à aba ADM.
5. **Evolução de Técnicos (Backlog):** avaliar inclusão de tabela de busca e cadastro manual isolado de técnicos em *Pessoas, Plataformas e Acessos*.
6. **Sincronizar `CONTEXT_MEMORY.md` com o código** (lista de desvios em `gotchas.md` §6).
