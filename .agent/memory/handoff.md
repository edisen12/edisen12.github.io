# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-10 16:35 (BRT) · HEAD: 432631e · Suíte Completa: 30 arquivos / 565 testes aprovados (100% verdes) ✅ · `npm run typecheck`: 0 erros ✅ · `npm run build`: bundle de produção gerado com sucesso em 8.23s ✅ · Server Typecheck: 0 erros ✅

## 1. Resumo Executivo

- **Objetivo:** SPA corporativa multiusuário para gestão de Homem-Hora (HH) e medição contratual USOFF de técnicos embarcados em plataformas offshore. Substitui um `index.html` monolítico legado (~1 MB) mantendo **resultado numérico idêntico** ao motor original.
- **Stack:** React 19 + TypeScript 5.7 (strict) + Vite 6 · PWA Instalável (WebAPK / iOS Home Screen / Desktop) · CSS puro com tokens · `lucide-react` · SheetJS (`xlsx`, import dinâmico) · Persistência Dual-Topology (`baas` via registry aberto, default Supabase PostgreSQL 17 + Auth + RLS + Edge Function Deno + Realtime; ou `self-hosted` com Nginx + Backend Node 22/TS `server/` + `UniversalStorageDriverPort` para qualquer banco SQL/NoSQL em Docker/VPS) · Vitest 3 + happy-dom + Testing Library · GitHub Pages + GitHub Actions (Node 22).
- **Supabase prod (topologia `baas` default):** project ref `fwdvrkfootvublicetim`, região `sa-east-1`.
- **Repositório PÚBLICO** (`edisen12.github.io`): zero PII/segredos em qualquer arquivo versionado — inclusive nesta pasta `.agent/`.
- **Referência profunda:** `CONTEXT_MEMORY.md` (61 KB). **Não leia inteiro.** Use `grep`/leitura por seção apenas quando precisar de detalhe que não está aqui. Ele tem desvios conhecidos (ver `gotchas.md` §6).

## 2. Zonas Consolidadas (Ignore List Contextual)

> **Instrução para futuras sessões:** os itens abaixo estão prontos, testados e validados. **NÃO abra, leia, inspecione nem refatore** estes arquivos a menos que (a) o usuário peça explicitamente, ou (b) a tarefa atual dependa diretamente da lógica interna deles. Para usar uma função, confie na assinatura/descrição em `patterns.md` e `decisions.md`.

### PWA Instalável sem APK e Infraestrutura Mobile
- `public/manifest.webmanifest`, `public/sw.js` (estático seguro v2, zero PII/dados), `public/icons/*` (ícones quadrados e maskable 180, 192, 512px), `public/.nojekyll`, metadados PWA em `index.html`.
- `src/utils/pwa.ts` (`initPwa`, `usePwaInstall`, `triggerPwaInstall`, detecção iOS/Android, standalone, persistência de banner de instalação).
- `src/ui/modals/PwaInstallModal.tsx` — modal corporativo de instalação com abas para iOS Safari e Android/Desktop.
- Gatilhos de instalação integrados na UI: botão no topo de `TopHeader.tsx` e no menu de perfil, botão na gaveta lateral de `Sidebar.tsx`, botão pré-login em `LoginView.tsx`, card em `UserSettingsView.tsx`, e banner sutil dispensável no topo mobile em `AppShell.tsx`.

### Arquitetura CSS Responsiva e Shell Multi-Tela (320px celular até 1920px+ ultrawide)
- `src/styles/{tokens,reset,layout,components}.css` — eliminação de estouro horizontal em grades (`minmax(min(100%, ...), 1fr)`), suporte a `env(safe-area-inset-*)`, prevenção de auto-zoom em iOS Safari (`font-size: 16px` em inputs), tabelas responsivas (`.table-responsive`, `.table-base`), cabeçalhos flexíveis (`.card-header-view`) e classes utilitárias (`.form-grid-2`, `.toolbar-responsive`, `.pwa-mobile-banner`).
- `src/ui/components/{AppShell,Sidebar,TopHeader,StickyFilterBar,DataTable,SegmentedControl,Modal,Drawer,ToastContext,ScopeBanner,KpiCard}.tsx` — `StickyFilterBar` compacta e recolhível no mobile, `Sidebar` com gaveta em largura total no mobile mesmo se colapsada no desktop, `DataTable` com scroll touch contido, e modais/drawers fluidos.

### Modais Compartilhados e Telas Adaptadas
- `src/ui/modals/AdminAccountModals.tsx` — desduplicação de ~550 linhas de modais administrativos (`NovoAdminModal`, `AdminResetPasswordModal`, `AdminToggleActiveModal`, `AdminDeleteUserModal`), registrando auditoria WORM `logSystemEvent` e layouts fluidos.
- `src/ui/views/*` — todas as 13 views reestruturadas sem larguras fixas rígidas ou grids quebradas: `LoginView`, `FirstLoginGate`, `VisaoGeralView`, `PainelDiaView`, `EmbarqueAtualView`, `JustificativasView`, `MedicaoRelatoriosView`, `MedicaoUsoffView`, `PessoasPlataformasView`, `ImportarDadosView`, `ConfiguracoesView`, `UserSettingsView`, `AdminAuditView`.
- `src/ui/modals/{EmailComposerModal,FichaTecnicoDrawer,JustificativaModal,ManualEntryModals}.tsx` — adaptados para mobile e padronizados com `.form-grid-2`.
- `src/ui/modals/CarteiraEmbarqueModal.tsx` — modal de alta densidade corporativa para visualização da carteira do embarque, apuração granular de USOFF (card com pesos, trava de execução zero, exceção gangway e fórmula de diária, colunas PE×HP, EX×HC e USoff por operação com motivos explicativos e linha de totais), confronto determinístico entre ordens do Portal Offshore e apontamentos do SAP ($HC$ vs $HH_{\text{SAP}}$), filtros rápidos e exportação `.xlsx` estendida com colunas de USOFF.

### Motor de domínio (puro, coberto por testes — invariantes contratuais)
- `src/domain/periods.ts` — ciclos de corte 1/16/21/26 + janela de lookback de 45 dias.
- `src/domain/calculations.ts` — resolução diária, "Não chegou", gangway, agregações, embarques, SLA de cobrança.
- `src/domain/usoff.ts` — agrupamento por OP/ordem, cascata PE/EX em 3 níveis, trava `falta`, Regra dos 12 dias ($US_{off} = PE \times HP_{carteira} + EX \times HC$), trava de execução zero ($HC = 0 \implies US = 0$), exceção de Gangway desconectada ($0{,}30 \times HP$), unidades de diária ($(\text{dias} + 1) \times 10$) e apuração granular cruzando Portal e SAP.
- `src/domain/communications.ts` — textos e deeplinks Outlook/mailto/WhatsApp com sanitização.
- `src/domain/demo.ts` — overlay sintético sem PII.
- `src/domain/types.ts` — contratos centrais (`ConfirmacaoSAP` inclui `contador_confirmacao`).
- Testes: `src/domain/__tests__/*` (domain, calculations, periods, usoff, communications).

### Utilitários
- `src/utils/date.ts`, `src/utils/format.ts` (`parseCounter`, `parseFlexibleHours`, `parseIdEmbarque`, `sanitizePlatformCode`, `PLATFORM_ALIASES`) + `src/utils/__tests__/date-format.test.ts` (67 testes).
- `src/utils/__tests__/pwa.test.ts` (8 testes cobrindo Service Worker seguro, Web App Manifest e ciclo de instalação).

### Serviços & Abstração Client-Side (Dual-Topology)
- `src/ports/{auth,data,realtime,client-provider,baas-connector}.port.ts` — contratos agnósticos de Auth, Data, Realtime e BaaS (`BatchImportConfirmacaoSAPRow` com `contador`).
- `src/adapters/shared/client-pipeline.ts` — pipeline compartilhado (`assembleAppDataset`, sanitização integrada de plataformas, batching topológico, chunks de 500, ordenação determinística por chave natural, validação de senha, debounce Realtime de 450 ms, overlay demo, deduplicação em memória e ordenação de confirmações SAP).
- `src/config/env.ts`, `src/config/topology-guard.ts`, `src/services/provider.registry.ts` — resolução de topologia (`baas` vs `self-hosted`) e travas de build/runtime.
- `src/adapters/baas/{registry,index}.ts`, `src/adapters/baas/providers/{supabase.config,supabase.connector}.ts` — registry aberto de BaaS (`registerBaaSConnector`) + conector Supabase com `upsertConfirmacoesSAPChunk` usando a chave única estendida com `contador_confirmacao`.
- `src/adapters/self-hosted/{http.client,self-hosted.provider,index}.ts` — cliente HTTP `credentials: 'same-origin'` com `X-CSRF-Token` apenas em memória + SSE Realtime.
- `src/services/{supabase,auth.service,data.service,realtime.service}.ts` (fachadas 100% retrocompatíveis) e `src/services/excel.service.ts` (parser com `parseCounter`, seletor SAP com `contador`, 6 exportadores, sanitização anti-fórmula).

### Backend Supabase (Topologia `baas` default)
- `supabase/migrations/001` → `020` — **imutáveis**.
- `supabase/functions/admin-users/index.ts` — Edge Function v4 com rollback compensatório em todas as etapas SQL pós-GoTrue e travas anti-lockout + auditoria WORM.
- `src/types/database.types.ts` — gerado via schema.

### Backend Universal Self-Hosted & Infraestrutura VPS / Docker (Topologia `self-hosted`)
- `server/package.json`, `server/tsconfig.json` — servidor Node 22/TS puro, zero dependências npm obrigatórias.
- `server/src/ports/universal-storage.port.ts` — `UniversalStorageDriverPort` (7 primitivas universais + operador `neq`).
- `server/src/drivers/{registry,in-memory.driver,generic-sql.driver,generic-document.driver}.ts` — registry aberto + drivers universais.
- `server/src/core/{crypto,realtime-hub,domain-engine.service}.ts`, `server/src/{app,index}.ts` — aplicação server-side de 100% das regras de negócio, granularidade, reconciliação SAP (+4 dias PMB) e reset de carteira.
- `docker/{frontend,backend}.Dockerfile`, `docker/nginx/nginx.conf`, `docker-compose.yml` · `.env.example` · `.env.vps.example` · `docs/DATABASE_ABSTRACTION.md`.

### Segurança e Suíte Completa de Testes
- `src/security/__tests__/*` (157 testes em rbac, rls-policies, admin-users-edge, first-login-gate-security, data-leakage-and-sanitization com varredura em `src/`, `server/`, `supabase/` e `public/`).
- `src/adapters/__tests__/{topology-and-baas-registry,self-hosted-universal-drivers}.test.ts` (41 testes cobrindo BaaS connector, provider self-hosted, drivers SQL/Doc/Memória, reconciliação SAP +4 dias, granularidade e operador `neq`).
- `src/services/__tests__/{auth,data,excel}.service.test.ts` (70 testes cobrindo autenticação, importação em lote, parsing e exportadores Excel com anti-formula injection e escopo parcial).
- `src/ui/components/__tests__/*` (30 testes em DataTable, SegmentedControl, Sidebar e ResponsiveShellAndPwa).
- `src/ui/modals/__tests__/ModalsAndDrawer.test.tsx` (7 testes).
- `src/ui/modals/__tests__/CarteiraEmbarqueModal.test.tsx` (7 testes).
- `src/ui/views/__tests__/*` (59 testes em AdminAuditView, ConfiguracoesView, FirstLoginGate, LoginView, UserSettingsView, OperationalViews e MedicaoUsoffView).
- `src/test/setup.ts`, `src/test/mockSupabase.ts`, `src/test/testFixtures.ts`.

## 3. Estado Atual (Work in Progress)

- **Frentes Concluídas e Validadas:**
  - **Frente 1: Motor de Cálculo USOFF Granular com Agrupamento por Embarque:**
    - Apuração matemática granular tupla por tupla de ordem/operação via `mergeConfrontoOperations`.
    - Trava estrita de execução zero: $HC = 0 \implies USOFF = 0$ (não pontua programação nem execução, exceto exceção de Gangway $0{,}30 \times HP$).
    - Ponderações isoladas: Carteira (30% PE + 70% EX) e Fora da carteira (apenas 70% EX).
    - Unidades de Diária: $(\text{dias} + 1) \times 10$, aplicada uma única vez no agrupamento do embarque sem inflar dias.
    - Suporte nativo a `groupBy: 'embarque' | 'operacao'` em `computeUsoffOperations`.
  - **Frente 2: Visualização e Filtro do USOFF por Embarque e ID de Embarque:**
    - Visualização padrão na tela de USOFF alterada para **Por Embarque (ID)**, com identificador único `id_embarque`, técnico, plataforma, período, HP, HD, HC, MeterBars, PE, EX, Σ PE×HP, Σ EX×HC, USOFF e botão/link direto para a Carteira do Embarque.
    - Busca instantânea habilitada por ID de embarque (`55104`, `EMB-99881`), técnico, matrícula ou plataforma.
    - SegmentedControl completo com 5 abas: Por Embarque (ID), Por Operação, Por Unidade (UN), Por Preposto e Confronto SAP vs Portal.
  - **Frente 3: Tela de Carteira do Embarque (Confronto SAP vs Portal Offshore):**
    - Modal `CarteiraEmbarqueModal.tsx` integrado no fluxo global via `openCarteiraModal(matricula, idEmbarque?, dataRef?)`.
    - Confronto de Horas: HH Programado (Carteira vs Fora), HC Portal Offshore, HH Confirmado SAP, Saldo de Divergência ($HC_{\text{Portal}} - HH_{\text{SAP}}$).
    - Ícones profissionais vetoriais `lucide-react` padronizados, sem emojis inline no layout corporativo.
  - **Frente 4: Cálculo e Validação de USOFF dentro da Carteira do Embarque:**
    - Card de Apuração de USOFF no topo da modal exibindo: Total USOFF do embarque, pesos contratuais PE/EX aplicados, Gangway ativa ($0{,}30 \times HP$), e badge com status da Trava de Execução Zero ($HC = 0 \implies USOFF = 0$).
    - Colunas granulares na tabela de operações: `PE × HP`, `EX × HC` e `USoff`, com badges e motivos contratuais em cada linha (`PE×HP + EX×HC`, `Apenas EX (Fora)`, `Execução Zero (HC=0)`, `Gangway (30% HP)`, `Diária (Armador)`).
    - Linha de totais (`tfoot`) consolidando horas, divergência, PE×HP, EX×HC e USOFF total.
    - Exportador Excel (`.xlsx`) atualizado com todas as colunas de USOFF e regras aplicadas.
  - **Resultados de Qualidade:**
    - Suíte de testes: **30 arquivos / 565 testes aprovados (100% verdes)**.
    - `npm run typecheck`: **0 erros**.
    - `npm run build`: **bundle de produção gerado com sucesso em 8.23s**.

## 4. Próximos Passos (priorizados)

1. **Subir atualizações para o repositório remoto GitHub (`main`):** realizar commit e push das alterações da medição USOFF e carteira do embarque conforme solicitado pelo usuário.
2. **Validar fluxos de usuário em ambiente de staging / pré-produção:** navegar pela medição de USOFF, filtrar por IDs de embarque e abrir a carteira para conferência determinística.
3. **Decisão pendente do usuário — visibilidade da aba `adm`:** confirmar se o perfil `gestor` deve manter acesso à aba ADM ou se fica restrita a `admin`.


