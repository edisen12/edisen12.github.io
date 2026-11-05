# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-05 09:12 (BRT) · Branch `main` sincronizada com `origin/main` · Suíte: 24 arquivos / 449 testes ✅ · `npm run typecheck` ✅ · `npm run build` ✅

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
- `src/services/{supabase,auth.service,data.service,realtime.service}.ts` (fachadas 100% retrocompatíveis) e `src/services/excel.service.ts` (parser com regex heurística robusta para Portal Offshore e SAP, 4 exportadores, sanitização anti-fórmula).

### Backend Supabase (Topologia `baas` default)
- `supabase/migrations/001` → `015` — **imutáveis**.
  - `010_fix_user_onboarding_rls_recursion.sql`: recursão RLS e RPC `complete_first_login_password_change`.
  - `011_carteira_operacoes.sql`: tabela granular `carteira_operacoes`, trigger `trg_sync_carteira_embarques` que consolida fisicamente em `carteira_embarques`.
  - `012_carteira_id_embarque.sql`: inclusão de `id_embarque text NOT NULL DEFAULT ''`.
  - `013_carteira_programada_e_id_embarque.sql`: regra dos 12 dias (`horas_programadas` = `Carteira` + `Fora da carteira`), colunas `hh_carteira`, `hh_fora_carteira` e `hh_cancelado`, e remoção da coluna física redundante `operacao` de `carteira_embarques`.
  - `014_confirmacoes_sap_e_reconciliacao.sql`: tabela `confirmacoes_sap`, colunas de conciliação em `carteira_operacoes` e `carteira_embarques`, RPC `reconciliar_confirmacoes_sap` (cascata de 5 prioridades, tolerância de +4 dias PMB e estornos retroativos).
  - `015_realtime_configuracoes_e_cadastros.sql`: triggers de sincronização instantânea em tempo real (heartbeat) sobre `configuracoes`, `config_usoff_un`, `plataformas` e `pessoas`.
- `supabase/functions/admin-users/index.ts` — Edge Function v4 (create, update-role, reset-password, toggle-active, delete-user + travas anti-lockout + auditoria WORM).
- `src/types/database.types.ts` — gerado; só regenerar via MCP `generate_typescript_types`, nunca editar à mão.

### Backend Universal Self-Hosted & Infraestrutura VPS / Docker (Topologia `self-hosted`)
- `server/package.json`, `server/tsconfig.json` — servidor Node 22/TS puro (`node:http`, `node:crypto`), zero dependências npm obrigatórias.
- `server/src/ports/universal-storage.port.ts` — `UniversalStorageDriverPort` (7 primitivas universais: `init`, `close`, `findOne`, `findMany`, `upsertMany`, `deleteMany`, `appendImmutable` + `runInTransaction` opcional).
- `server/src/drivers/{registry,in-memory.driver,generic-sql.driver,generic-document.driver}.ts` — registry aberto (`registerStorageDriver` / `DB_DRIVER_MODULE`) + `GenericSqlDialectDriver` parametrizado (Postgres, MariaDB/MySQL, SQLite, MSSQL, Oracle, CockroachDB) + `GenericDocumentDriver` (MongoDB, CouchDB, DynamoDB) + `InMemoryStorageDriver`.
- `server/src/core/{crypto,realtime-hub,domain-engine.service}.ts`, `server/src/{app,index}.ts` — aplicação server-side de 100% das regras de negócio e segurança.
- `docker/{frontend,backend}.Dockerfile`, `docker/nginx/nginx.conf`, `docker-compose.yml` · `.env.example` · `.env.vps.example` · `docs/DATABASE_ABSTRACTION.md`.

### Segurança e infraestrutura de testes
- `src/security/__tests__/*` (rbac, rls-policies, admin-users-edge, first-login-gate-security, data-leakage-and-sanitization).
- `src/adapters/__tests__/{topology-and-baas-registry,self-hosted-universal-drivers}.test.ts` (34 testes).
- `src/services/__tests__/{auth,data,excel}.service.test.ts`.
- `src/test/setup.ts`, `src/test/mockSupabase.ts`, `src/test/testFixtures.ts`.

### UI consolidada
- Componentes: `DataTable`, `SegmentedControl`, `Sidebar` (+ `__tests__`), `AppShell`, `Drawer`, `KpiCard`, `MeterBar`, `Modal`, `ScopeBanner`, `Sparkline120`, `StatusPill`, `StickyFilterBar`, `ToastContext`, `TopHeader`.
- Views: `LoginView`, `FirstLoginGate`, `UserSettingsView`, `ConfiguracoesView`, `AdminAuditView` (+ `__tests__`), `VisaoGeralView`, `PainelDiaView`, `EmbarqueAtualView`, `JustificativasView`, `MedicaoUsoffView`, `ImportarDadosView` (com auto-scroll, CTA no topo e alerta de 0 linhas).
- `src/App.tsx`, `src/main.tsx`, `src/ui/state/AppContext.tsx`.

## 3. Estado Atual (Work in Progress)

- **Diagnóstico e Correção da Importação de Dados (Portal Offshore e SAP):**
  - **Diagnóstico do problema relatado:**
    1. *Heurística `guessImportKind`:* O arquivo do Portal Offshore possui cabeçalhos como `Início`, `Fim`, `Ordem`, `Operação`, `Status Programação`, `HH Programado`. A regex anterior buscava especificamente a palavra `embarque` ou `desembarque`; sem encontrá-las, caía no fallback de `hh` (HH diário). Como `hh` procura a coluna `Data` (inexistente no Portal), gerava **0 linhas** na prévia.
    2. *Toast falso-positivo prematuro:* O código chamava `showToast('Planilha ... processada com sucesso!')` assim que o SheetJS fazia a leitura em memória do arquivo (prévia), induzindo o usuário a acreditar que os dados já haviam sido persistidos no Supabase.
    3. *Botão de gravação oculto e desabilitado:* O botão "Salvar X linhas" ficava apenas no final da página (abaixo de 5 cartões, 15 seletores e da tabela de prévia). Quando 0 linhas eram geradas, o botão ficava como `Salvar 0 linhas` (desabilitado). Mesmo com as 8.784 linhas do SAP carregadas, o usuário não rolava até o final para clicar.
  - **Soluções Implementadas:**
    1. *Detecção Heurística Precisa:* Regex em `src/services/excel.service.ts` atualizada para cobrir `status.*prog`, `hh.*prog`, `id_embarque`, `portal`, `inicio` + `fim`, `ordem` + `operacao` + `hh`, garantindo classificação imediata como `cart` (Carteira de embarque) com mapeamento completo das 15 colunas.
    2. *CTA no Topo e Auto-Scroll:* Adicionado botão proeminente `Gravar X linhas no Banco` diretamente no cabeçalho do painel de prévia em `ImportarDadosView.tsx`, além de rolagem automática suave (`scrollIntoView`) ao selecionar o arquivo.
    3. *Mensagens Claras de Toast & Alerta de 0 Linhas:* Toast atualizado para informar que a planilha foi carregada na prévia e orientar o clique em gravação. Adicionado card de aviso caso o usuário carregue um tipo incompatível.
    4. *Sincronização em Tempo Real (Migration 015):* Aplicada trigger de heartbeat nas tabelas de configurações e pessoas/plataformas, permitindo sincronização instantânea entre múltiplos navegadores sem F5.
- **Validação de Código:**
  - `npm run typecheck`: 0 erros.
  - `npm run test:run`: 24 suítes / 449 testes aprovados.
  - `npm run build`: Bundle de produção gerado com sucesso em 3.80s.

## 4. Próximos Passos (priorizados)

1. **Apresentar diagnóstico e orientações ao usuário:** explicar a causa raiz do não salvamento e como a nova experiência com botão no topo e auto-scroll soluciona o fluxo.
2. **Conferência da conciliação:** conferir os resultados na aba *Confronto SAP vs Portal* em *Medição USOFF* após as gravações.
3. **Decisão pendente do usuário — visibilidade da aba `adm`:** confirmar se o perfil `gestor` deve manter acesso à aba ADM ou se fica restrita a `admin`.
4. **Evolução de Técnicos (Backlog):** avaliar inclusão de busca e cadastro manual isolado de técnicos em *Pessoas, Plataformas e Acessos*.
