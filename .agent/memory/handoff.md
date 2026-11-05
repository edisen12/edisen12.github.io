# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-05 09:32 (BRT) · Branch `main` sincronizada com `origin/main` · Suíte: 24 arquivos / 449 testes ✅ · `npm run typecheck` ✅ · `npm run build` ✅

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
- `src/adapters/baas/{registry,index}.ts`, `src/adapters/baas/providers/{supabase.config,supabase.connector}.ts` — registry aberto de BaaS (`registerBaaSConnector`) + conector Supabase com checagem explícita de `{ error }` em 100% das chamadas e sanitização contra colunas inexistentes.
- `src/adapters/self-hosted/{http.client,self-hosted.provider,index}.ts` — cliente HTTP `credentials: 'same-origin'` com `X-CSRF-Token` apenas em memória (zero tokens em `localStorage`) + SSE Realtime (`/api/v1/realtime/events`).
- `src/services/{supabase,auth.service,data.service,realtime.service}.ts` (fachadas 100% retrocompatíveis) e `src/services/excel.service.ts` (parser com regex heurística robusta para Portal Offshore e SAP, 4 exportadores, sanitização anti-fórmula).

### Backend Supabase (Topologia `baas` default)
- `supabase/migrations/001` → `016` — **imutáveis**.
  - `010_fix_user_onboarding_rls_recursion.sql`: recursão RLS e RPC `complete_first_login_password_change`.
  - `011_carteira_operacoes.sql`: tabela granular `carteira_operacoes`, trigger `trg_sync_carteira_embarques` que consolida fisicamente em `carteira_embarques`.
  - `012_carteira_id_embarque.sql`: inclusão de `id_embarque text NOT NULL DEFAULT ''`.
  - `013_carteira_programada_e_id_embarque.sql`: regra dos 12 dias (`horas_programadas` = `Carteira` + `Fora da carteira`), colunas `hh_carteira`, `hh_fora_carteira` e `hh_cancelado`, e remoção da coluna física redundante `operacao` de `carteira_embarques`.
  - `014_confirmacoes_sap_e_reconciliacao.sql`: tabela `confirmacoes_sap`, colunas de conciliação em `carteira_operacoes` e `carteira_embarques`, RPC `reconciliar_confirmacoes_sap` (cascata de 5 prioridades, tolerância de +4 dias PMB e estornos retroativos).
  - `015_realtime_configuracoes_e_cadastros.sql`: triggers de sincronização instantânea em tempo real (heartbeat) sobre `configuracoes`, `config_usoff_un`, `plataformas` e `pessoas`.
  - `016_fix_sync_carteira_embarques_trigger.sql`: correção da função `sync_carteira_embarques_from_operacoes()` para agrupar estritamente por `(matricula, data_inicio)` com agregação `MAX(...)` para campos variantes, blindando contra erros SQL `21000`.
- `supabase/functions/admin-users/index.ts` — Edge Function v4 (create, update-role, reset-password, toggle-active, delete-user + travas anti-lockout + auditoria WORM).
- `src/types/database.types.ts` — gerado; só regenerar via MCP `generate_typescript_types`, nunca editar à mão.

### Backend Universal Self-Hosted & Infraestrutura VPS / Docker (Topologia `self-hosted`)
- `server/package.json`, `server/tsconfig.json` — servidor Node 22/TS puro (`node:http`, `node:crypto`), zero dependências npm obrigatórias.
- `server/src/ports/universal-storage.port.ts` — `UniversalStorageDriverPort` (7 primitivas universais: `init`, `close`, `findOne`, `findMany`, `upsertMany`, `deleteMany`, `appendImmutable` + `runInTransaction` opcional).
- `server/src/drivers/{registry,in-memory.driver,generic-sql.driver,generic-document.driver}.ts` — registry aberto (`registerStorageDriver` / `DB_DRIVER_MODULE`) + `GenericSqlDialectDriver` parametrizado + `GenericDocumentDriver` + `InMemoryStorageDriver`.
- `server/src/core/{crypto,realtime-hub,domain-engine.service}.ts`, `server/src/{app,index}.ts` — aplicação server-side de 100% das regras de negócio e segurança.
- `docker/{frontend,backend}.Dockerfile`, `docker/nginx/nginx.conf`, `docker-compose.yml` · `.env.example` · `.env.vps.example` · `docs/DATABASE_ABSTRACTION.md`.

### Segurança e infraestrutura de testes
- `src/security/__tests__/*` (rbac, rls-policies, admin-users-edge, first-login-gate-security, data-leakage-and-sanitization).
- `src/adapters/__tests__/{topology-and-baas-registry,self-hosted-universal-drivers}.test.ts` (34 testes).
- `src/services/__tests__/{auth,data,excel}.service.test.ts`.
- `src/test/setup.ts`, `src/test/mockSupabase.ts`, `src/test/testFixtures.ts`.

### UI consolidada
- Componentes: `DataTable`, `SegmentedControl`, `Sidebar` (+ `__tests__`), `AppShell`, `Drawer`, `KpiCard`, `MeterBar`, `Modal`, `ScopeBanner`, `Sparkline120`, `StatusPill`, `StickyFilterBar`, `ToastContext`, `TopHeader`.
- Views: `LoginView`, `FirstLoginGate`, `UserSettingsView`, `ConfiguracoesView`, `AdminAuditView` (+ `__tests__`), `VisaoGeralView`, `PainelDiaView`, `EmbarqueAtualView`, `JustificativasView`, `MedicaoUsoffView`, `ImportarDadosView` (com auto-scroll, CTA no topo, alerta de 0 linhas e mapeamento de colunas explícito para cruzamento SAP).
- `src/App.tsx`, `src/main.tsx`, `src/ui/state/AppContext.tsx`.

## 3. Estado Atual (Work in Progress)

- **Diagnóstico Completo de Carga do SAP e Portal Offshore:**
  - **Validação de Duplicatas do SAP:**
    - Verificação direta no Supabase confirmou **zero duplicatas**: 9.301 linhas totais e exatamente 9.301 chaves naturais distintas em `confirmacoes_sap`.
    - Ao importar o lote de mais de 4.000 linhas, o mecanismo de `ON CONFLICT (matricula, data_criacao, data_lancamento, data_fim_real, ordem, operacao, horas_confirmadas)` identificou as linhas idênticas já existentes, atualizou apenas o carimbo `updated_at` e inseriu apenas os 517 novos registros reais que faltavam.
  - **Causa Raiz da Falha do Portal Offshore (Erro 500 / Postgres 21000):**
    - Identificado no log de eventos do Supabase o erro: `ON CONFLICT DO UPDATE command cannot affect row a second time` (SQLSTATE 21000) no `POST /carteira_operacoes`.
    - Causa: a trigger `sync_carteira_embarques_from_operacoes()` agrupava por `co.portal_id, co.plataforma_sigla, co.unidade_negocio`. Caso operações de um mesmo embarque físico possuíssem variações em algum desses atributos, a consolidação gerava linhas concorrentes para o mesmo `(matricula, data_inicio)` na mesma instrução de inserção em `carteira_embarques`.
    - Solução: Migration 016 criada e aplicada no banco de dados, reescrevendo a trigger com `GROUP BY co.matricula, co.data_inicio` e agregadores `MAX(...)`, tornando impossível a colisão de chaves.
  - **Esclarecimento e Ajuste da Coluna de Operação:**
    - Na tabela consolidada `carteira_embarques`, a coluna `operacao` foi fisicamente descartada na Migration 013, mantendo apenas `id_embarque`.
    - Na tabela granular `carteira_operacoes`, a coluna `operacao` é fundamental para o batimento ordem-a-ordem com o extrato do SAP.
    - No frontend, o seletor foi renomeado para `Operação (cruzamento SAP)` e o conector Supabase foi protegido para nunca enviar campos inexistentes a `carteira_embarques`.
- **Validação de Código:**
  - `npm run typecheck`: 0 erros.
  - `npm run test:run`: 24 suítes / 449 testes aprovados.
  - `npm run build`: Bundle de produção gerado com sucesso em 3.87s (`index-QhzoEFEv.js`).

## 4. Próximos Passos (priorizados)

1. **Confirmar com o usuário:** informar o resultado da conferência do SAP (0 duplicatas, 9.301 registros íntegros) e a resolução do erro da trigger do Portal Offshore com a Migration 016.
2. **Conferência da conciliação:** conferir os resultados na aba *Confronto SAP vs Portal* em *Medição USOFF* após a nova carga da carteira.
3. **Decisão pendente do usuário — visibilidade da aba `adm`:** confirmar se o perfil `gestor` deve manter acesso à aba ADM ou se fica restrita a `admin`.
4. **Evolução de Técnicos (Backlog):** avaliar inclusão de busca e cadastro manual isolado de técnicos em *Pessoas, Plataformas e Acessos*.
