# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-05 10:41 (BRT) · Suíte: 24 arquivos / 456 testes ✅ · `npm run typecheck` ✅ · `npm run build` ✅ (`index-5VxX6_4X.js`)

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
- `supabase/migrations/001` → `018` — **imutáveis**.
  - `010_fix_user_onboarding_rls_recursion.sql`: recursão RLS e RPC `complete_first_login_password_change`.
  - `011_carteira_operacoes.sql`: tabela granular `carteira_operacoes`, trigger `trg_sync_carteira_embarques` que consolida fisicamente em `carteira_embarques`.
  - `012_carteira_id_embarque.sql`: inclusão de `id_embarque text NOT NULL DEFAULT ''`.
  - `013_carteira_programada_e_id_embarque.sql`: regra dos 12 dias (`horas_programadas` = `Carteira` + `Fora da carteira`), colunas `hh_carteira`, `hh_fora_carteira` e `hh_cancelado`, e remoção da coluna física redundante `operacao` de `carteira_embarques`.
  - `014_confirmacoes_sap_e_reconciliacao.sql`: tabela `confirmacoes_sap`, colunas de conciliação em `carteira_operacoes` e `carteira_embarques`, RPC `reconciliar_confirmacoes_sap`.
  - `015_realtime_configuracoes_e_cadastros.sql`: triggers de sincronização instantânea em tempo real (heartbeat) sobre `configuracoes`, `config_usoff_un`, `plataformas` e `pessoas`.
  - `016_fix_sync_carteira_embarques_trigger.sql`: correção da função `sync_carteira_embarques_from_operacoes()` para agrupar estritamente por `(matricula, data_inicio)`.
  - `017_contador_confirmacao_sap.sql`: reset de `confirmacoes_sap`, inclusão de `contador_confirmacao bigint NOT NULL DEFAULT 0` e chave única atualizada.
  - `018_unify_id_embarque.sql`: inclusão de `id_embarque` em `carteira_operacoes`, trigger de self-healing para strings GMT, sincronização bidirecional e RPC `reset_carteira_embarques`.
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

- **Resolução e Unificação Definitiva de `id_embarque` (Migration 018):**
  - **Diagnóstico Preciso:** A flag `cellDates: true` no SheetJS interpretava números inteiros na faixa de 40.000 a 70.000 (IDs do Portal Offshore como `55104`, `56299`) como datas do Excel, instanciando objetos JavaScript `Date`. A conversão ingênua `String(date)` gerava strings completas de data no fuso local (`"Tue Oct 20 2054 00:00:00 GMT-0300..."`), fazendo parecer no Supabase que o `id_embarque` havia sumido e sido substituído por datas.
  - **Recuperação de Dados em Produção:** 100% dos 1.830 registros de `carteira_operacoes` e 152 registros de `carteira_embarques` tiveram seus identificadores seriais originais recuperados matematicamente e limpos via SQL (0 strings GMT residuais no banco).
  - **Unificação de Schema:** Tabela `carteira_operacoes` agora possui a coluna física `id_embarque text NOT NULL DEFAULT ''` com índice dedicado, espelhando bidirecionalmente `portal_id`.
  - **Trigger de Self-Healing:** Implementada trigger `trg_normalize_carteira_operacoes_ids` que regenera o ID numérico e espelha `id_embarque` e `portal_id` automaticamente.
  - **Frontend & Visualização:**
    - Utilitário `parseIdEmbarque` protege o parser Excel client-side contra conversões indesejadas do SheetJS.
    - Coluna `"ID Embarque"` adicionada à tabela da visão *Embarque Atual* (`EmbarqueAtualView.tsx`), com badge destacado e suporte a busca/ordenação direta por ID.
    - Contador de embarques físicos com ID distinto adicionado ao cabeçalho da tabela.
    - Coluna e busca de `ID Embarque` integradas na aba *Confronto SAP vs Portal* (`MedicaoUsoffView.tsx`) e exportador Excel (`exportConfrontoSAPXlsx`).
    - Coluna de ID adicionada à tabela de prévia de importação da carteira (`ImportarDadosView.tsx`).
    - Opção "Substituir carteira anterior (limpar dados antigos antes de gravar)" e RPC `reset_carteira_embarques()` adicionadas para permitir que o usuário elimine embarques legados de testes passados e sincronize exatamente 1-para-1 com o arquivo oficial.
- **Validação de Código:**
  - `npm run typecheck`: 0 erros.
  - `npm run test:run`: 24 suítes / 456 testes aprovados (100% verdes).
  - `npm run build`: Bundle de produção gerado com sucesso em 4.46s (`index-5VxX6_4X.js`).

## 4. Próximos Passos (priorizados)

1. **Avisar o usuário:** explicar o diagnóstico da conversão de data do SheetJS, confirmar que todos os 150+ IDs reais do Portal Offshore foram recuperados no banco, demonstrar a nova coluna "ID Embarque" e a opção de substituição limpa na tela de importação.
2. **Acompanhar a ingestão da nova planilha SAP e Carteira:** validar se os múltiplos lançamentos diários com `contador_confirmacao` e os IDs de embarque do Portal Offshore confrontam com precisão na aba *Confronto SAP vs Portal*.
3. **Decisão pendente do usuário — visibilidade da aba `adm`:** confirmar se o perfil `gestor` deve manter acesso à aba ADM ou se fica restrita a `admin`.
4. **Evolução de Técnicos (Backlog):** avaliar inclusão de busca e cadastro manual isolado de técnicos em *Pessoas, Plataformas e Acessos*.
