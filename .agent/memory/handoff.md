# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-05 10:04 (BRT) · Branch `main` sincronizada com `origin/main` · Suíte: 24 arquivos / 452 testes ✅ · `npm run typecheck` ✅ · `npm run build` ✅

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
- `supabase/migrations/001` → `017` — **imutáveis**.
  - `010_fix_user_onboarding_rls_recursion.sql`: recursão RLS e RPC `complete_first_login_password_change`.
  - `011_carteira_operacoes.sql`: tabela granular `carteira_operacoes`, trigger `trg_sync_carteira_embarques` que consolida fisicamente em `carteira_embarques`.
  - `012_carteira_id_embarque.sql`: inclusão de `id_embarque text NOT NULL DEFAULT ''`.
  - `013_carteira_programada_e_id_embarque.sql`: regra dos 12 dias (`horas_programadas` = `Carteira` + `Fora da carteira`), colunas `hh_carteira`, `hh_fora_carteira` e `hh_cancelado`, e remoção da coluna física redundante `operacao` de `carteira_embarques`.
  - `014_confirmacoes_sap_e_reconciliacao.sql`: tabela `confirmacoes_sap`, colunas de conciliação em `carteira_operacoes` e `carteira_embarques`, RPC `reconciliar_confirmacoes_sap`.
  - `015_realtime_configuracoes_e_cadastros.sql`: triggers de sincronização instantânea em tempo real (heartbeat) sobre `configuracoes`, `config_usoff_un`, `plataformas` e `pessoas`.
  - `016_fix_sync_carteira_embarques_trigger.sql`: correção da função `sync_carteira_embarques_from_operacoes()` para agrupar estritamente por `(matricula, data_inicio)`.
  - `017_contador_confirmacao_sap.sql`: reset de `confirmacoes_sap`, inclusão de `contador_confirmacao bigint NOT NULL DEFAULT 0` e chave única atualizada.
- `supabase/functions/admin-users/index.ts` — Edge Function v4 (create, update-role, reset-password, toggle-active, delete-user + travas anti-lockout + auditoria WORM).
- `src/types/database.types.ts` — gerado via MCP `generate_typescript_types` atualizado com `contador_confirmacao`.

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

- **Reset de Confirmações SAP e Inclusão da Coluna Contador Confirmação:**
  - **Tabela `confirmacoes_sap` resetada (truncada):** 0 linhas atualmente no Supabase.
  - **Campos de conciliação SAP zerados:** `hh_confirmado_sap = 0` e `status_divergencia = 'Não Apontado no SAP'` em `carteira_operacoes` e `carteira_embarques`.
  - **Nova Coluna `contador_confirmacao`:**
    - Criada no banco como `bigint NOT NULL DEFAULT 0` com índice dedicado.
    - Decisão arquitetural de tratamento numérico: elimina discrepâncias de zeros à esquerda (`'00000001'` vs `'1'`) e resolve o problema de confirmações múltiplas com a mesma quantidade de horas para o mesmo técnico e operação no mesmo dia.
    - Chave única `uq_confirmacao_sap_row` estendida para conter `contador_confirmacao`.
  - **Frontend Atualizado:**
    - Seletor "Contador Confirmação" adicionado na revisão de colunas da importação SAP.
    - Utilitário `parseCounter` converte automaticamente strings com zeros à esquerda ou inteiros para número limpo.
    - Tabela de prévia exibe a nova coluna "Contador".
    - `src/types/database.types.ts` atualizado com o schema real do banco.
- **Validação de Código:**
  - `npm run typecheck`: 0 erros.
  - `npm run test:run`: 24 suítes / 452 testes aprovados.
  - `npm run build`: Bundle de produção gerado com sucesso em 3.99s (`index-CEiZOx0e.js`).

## 4. Próximos Passos (priorizados)

1. **Avisar o usuário:** informar que a base do SAP foi resetada, a coluna `contador_confirmacao` foi criada e testada, e que o sistema está pronto para receber a nova planilha.
2. **Acompanhar a ingestão da nova planilha SAP e Carteira:** validar se os múltiplos lançamentos diários e a conciliação com o Portal Offshore somam corretamente na aba *Confronto SAP vs Portal*.
3. **Decisão pendente do usuário — visibilidade da aba `adm`:** confirmar se o perfil `gestor` deve manter acesso à aba ADM ou se fica restrita a `admin`.
4. **Evolução de Técnicos (Backlog):** avaliar inclusão de busca e cadastro manual isolado de técnicos em *Pessoas, Plataformas e Acessos*.
