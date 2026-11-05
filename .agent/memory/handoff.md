# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-05 11:15 (BRT) · Suíte: 24 arquivos / 456 testes ✅ · `npm run typecheck` ✅ · `npm run build` ✅ (`index-DjwXaauv.js`)

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
- `src/domain/types.ts` — contratos centrais (`ConfirmacaoSAP` inclui `contador_confirmacao`).
- Testes: `src/domain/__tests__/*` (domain, calculations, periods, usoff, communications).

### Utilitários
- `src/utils/date.ts`, `src/utils/format.ts` (`parseCounter`, `parseFlexibleHours`) + `src/utils/__tests__/date-format.test.ts` (58 testes).

### Serviços & Abstração Client-Side (Dual-Topology)
- `src/ports/{auth,data,realtime,client-provider,baas-connector}.port.ts` — contratos agnósticos de Auth, Data, Realtime e BaaS (`BatchImportConfirmacaoSAPRow` com `contador`).
- `src/adapters/shared/client-pipeline.ts` — pipeline compartilhado (`assembleAppDataset`, batching topológico, chunks de 500, ordenação determinística por chave natural, validação de senha, debounce Realtime de 450 ms, overlay demo, deduplicação em memória e ordenação de confirmações SAP).
- `src/config/env.ts`, `src/config/topology-guard.ts`, `src/services/provider.registry.ts` — resolução de topologia (`baas` vs `self-hosted`) e travas de build/runtime.
- `src/adapters/baas/{registry,index}.ts`, `src/adapters/baas/providers/{supabase.config,supabase.connector}.ts` — registry aberto de BaaS (`registerBaaSConnector`) + conector Supabase com `upsertConfirmacoesSAPChunk` usando a chave única estendida com `contador_confirmacao`.
- `src/adapters/self-hosted/{http.client,self-hosted.provider,index}.ts` — cliente HTTP `credentials: 'same-origin'` com `X-CSRF-Token` apenas em memória + SSE Realtime.
- `src/services/{supabase,auth.service,data.service,realtime.service}.ts` (fachadas 100% retrocompatíveis) e `src/services/excel.service.ts` (parser com `parseCounter`, seletor SAP com `contador`, 4 exportadores, sanitização anti-fórmula).

### Backend Supabase (Topologia `baas` default)
- `supabase/migrations/001` → `019` — **imutáveis**.
  - `010_fix_user_onboarding_rls_recursion.sql`: recursão RLS e RPC `complete_first_login_password_change`.
  - `011_carteira_operacoes.sql`: tabela granular `carteira_operacoes`, trigger `trg_sync_carteira_embarques` que consolida fisicamente em `carteira_embarques`.
  - `012_carteira_id_embarque.sql`: inclusão de `id_embarque text NOT NULL DEFAULT ''`.
  - `013_carteira_programada_e_id_embarque.sql`: regra dos 12 dias (`horas_programadas` = `Carteira` + `Fora da carteira`), colunas `hh_carteira`, `hh_fora_carteira` e `hh_cancelado`, e remoção da coluna física redundante `operacao` de `carteira_embarques`.
  - `014_confirmacoes_sap_e_reconciliacao.sql`: tabela `confirmacoes_sap`, colunas de conciliação em `carteira_operacoes` e `carteira_embarques`, RPC `reconciliar_confirmacoes_sap`.
  - `015_realtime_configuracoes_e_cadastros.sql`: triggers de sincronização instantânea em tempo real (heartbeat) sobre `configuracoes`, `config_usoff_un`, `plataformas` e `pessoas`.
  - `016_fix_sync_carteira_embarques_trigger.sql`: correção da função `sync_carteira_embarques_from_operacoes()` para agrupar estritamente por `(matricula, data_inicio)`.
  - `017_contador_confirmacao_sap.sql`: reset de `confirmacoes_sap`, inclusão de `contador_confirmacao bigint NOT NULL DEFAULT 0` e chave única atualizada.
  - `018_unify_id_embarque.sql`: inclusão de `id_embarque` em `carteira_operacoes`, trigger de self-healing para strings GMT, sincronização bidirecional e RPC `reset_carteira_embarques`.
  - `019_fix_reset_carteira_embarques.sql`: adequação da RPC `reset_carteira_embarques` à extensão safeupdate do PostgreSQL com cláusulas WHERE explícitas.
- `supabase/functions/admin-users/index.ts` — Edge Function v4 (create, update-role, reset-password, toggle-active, delete-user + travas anti-lockout + auditoria WORM).
- `src/types/database.types.ts` — gerado via MCP `generate_typescript_types` atualizado com `id_embarque` em `carteira_operacoes`.

### Backend Universal Self-Hosted & Infraestrutura VPS / Docker (Topologia `self-hosted`)
- `server/package.json`, `server/tsconfig.json` — servidor Node 22/TS puro, zero dependências npm obrigatórias.
- `server/src/ports/universal-storage.port.ts` — `UniversalStorageDriverPort` (7 primitivas universais).
- `server/src/drivers/{registry,in-memory.driver,generic-sql.driver,generic-document.driver}.ts` — registry aberto + drivers universais.
- `server/src/core/{crypto,realtime-hub,domain-engine.service}.ts`, `server/src/{app,index}.ts` — aplicação server-side de 100% das regras de negócio e segurança.
- `docker/{frontend,backend}.Dockerfile`, `docker/nginx/nginx.conf`, `docker-compose.yml` · `.env.example` · `.env.vps.example` · `docs/DATABASE_ABSTRACTION.md`.

### Segurança e infraestrutura de testes
- `src/security/__tests__/*` (rbac, rls-policies, admin-users-edge, first-login-gate-security, data-leakage-and-sanitization).
- `src/adapters/__tests__/{topology-and-baas-registry,self-hosted-universal-drivers}.test.ts` (34 testes).
- `src/services/__tests__/{auth,data,excel}.service.test.ts`.
- `src/test/setup.ts`, `src/test/mockSupabase.ts`, `src/test/testFixtures.ts`.

### UI consolidada
- Componentes: `DataTable`, `SegmentedControl`, `Sidebar` (+ `__tests__`), `AppShell`, `Drawer`, `KpiCard`, `MeterBar`, `Modal`, `ScopeBanner`, `Sparkline120`, `StatusPill`, `StickyFilterBar`, `ToastContext`, `TopHeader`.
- Views: `LoginView`, `FirstLoginGate`, `UserSettingsView`, `ConfiguracoesView`, `AdminAuditView` (+ `__tests__`), `VisaoGeralView`, `PainelDiaView`, `EmbarqueAtualView`, `JustificativasView`, `MedicaoUsoffView`, `ImportarDadosView` (com auto-scroll, CTA no topo, alerta de 0 linhas, mapeamento para `contador_confirmacao` e `Operação (cruzamento SAP)`).
- `src/App.tsx`, `src/main.tsx`, `src/ui/state/AppContext.tsx`.

## 3. Estado Atual (Work in Progress)

- **Correção da Chamada de Substituição de Carteira (Migration 019):**
  - **Diagnóstico do Erro no Supabase:** A chamada para `/rest/v1/rpc/reset_carteira_embarques` retornava HTTP 400 com `"UPDATE requires a WHERE clause"`. A extensão `safeupdate` do Supabase bloqueava a query `UPDATE confirmacoes_sap SET id_embarque = ''` por não conter uma cláusula `WHERE` explícita.
  - **Correção Definitiva:** Migration 019 substituiu todos os comandos por DMLs com `WHERE` explícito (`DELETE FROM carteira_operacoes WHERE id IS NOT NULL`, `DELETE FROM carteira_embarques WHERE id IS NOT NULL` e `UPDATE confirmacoes_sap SET id_embarque = '', status_reconciliacao = 'Pendente' WHERE id_embarque <> '' OR status_reconciliacao <> 'Pendente'`).
  - **Execução do Reset Limpo:** A carteira legada foi completamente resetada no banco de produção (0 linhas em `carteira_operacoes` e 0 linhas em `carteira_embarques`). A tabela `confirmacoes_sap` (10.025 registros) foi mantida intacta e pronta para conciliação automática.
  - **Pronto para os 147 Embarques:** O usuário pode agora subir a planilha oficial do Portal Offshore com os 147 embarques do período de medição, marcando a opção "Substituir carteira existente" ou importando diretamente.
- **Validação de Código:**
  - `npm run typecheck`: 0 erros.
  - `npm run test:run`: 24 suítes / 456 testes aprovados (100% verdes).
  - `npm run build`: Bundle de produção gerado com sucesso em 4.01s (`index-DjwXaauv.js`).

## 4. Próximos Passos (priorizados)

1. **Avisar o usuário:** informar o erro exato diagnosticado nos logs do Supabase (`safeupdate: UPDATE requires a WHERE clause`), confirmar que a correção via Migration 019 já está aplicada e testada, e que as tabelas de carteira foram zeradas para receber com precisão cirúrgica os 147 embarques do período de medição.
2. **Acompanhar a ingestão dos 147 embarques do Portal Offshore:** validar se a quantidade consolida em 147 embarques na visão *Embarque Atual* e se a conciliação automática com as 10.025 confirmações do SAP na aba *Confronto SAP vs Portal* opera perfeitamente.
3. **Decisão pendente do usuário — visibilidade da aba `adm`:** confirmar se o perfil `gestor` deve manter acesso à aba ADM ou se fica restrita a `admin`.
