# Handoff — HH Offshore · Infotec Brasil

> Última atualização: 2026-11-13 13:49 (BRT) · Base HEAD: 128ddf7 (com alterações validadas para commit/push em `main`) · Suíte Completa: 34 arquivos / 611 testes aprovados (100% verdes) ✅ · `npm run typecheck`: 0 erros ✅ · `npm run build`: bundle de produção gerado com sucesso em 5.91s ✅ · Server Typecheck: 0 erros ✅ · Supabase PROD (`fwdvrkfootvublicetim`): Migrations 023, 024 e 025 aplicadas; Migration 026 (índices de janela SAP) versionada no repositório ⏳

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
- `src/ui/components/{AppShell,Sidebar,TopHeader,StickyFilterBar,DataTable,SegmentedControl,Modal,Drawer,ToastContext,ScopeBanner,KpiCard,TecnicosManager}.tsx` — `StickyFilterBar` compacta e recolhível no mobile, `Sidebar` com gaveta em largura total no mobile mesmo se colapsada no desktop, `DataTable` com scroll touch contido, modais/drawers fluidos e `TecnicosManager` com CRUD completo de técnicos offshore, importação em lote e exportação Excel.

### Modais Compartilhados e Telas Adaptadas
- `src/ui/modals/AdminAccountModals.tsx` — desduplicação de ~550 linhas de modais administrativos (`NovoAdminModal`, `AdminResetPasswordModal`, `AdminToggleActiveModal`, `AdminDeleteUserModal`), registrando auditoria WORM `logSystemEvent` e layouts fluidos.
- `src/ui/views/*` — todas as 13 views reestruturadas sem larguras fixas rígidas ou grids quebradas: `LoginView`, `FirstLoginGate`, `VisaoGeralView`, `PainelDiaView`, `EmbarqueAtualView`, `JustificativasView`, `MedicaoRelatoriosView`, `MedicaoUsoffView`, `PessoasPlataformasView`, `ImportarDadosView`, `ConfiguracoesView`, `UserSettingsView`, `AdminAuditView`.
- `src/ui/modals/{EmailComposerModal,FichaTecnicoDrawer,JustificativaModal,ManualEntryModals}.tsx` — adaptados para mobile e padronizados com `.form-grid-2`.
- `src/ui/modals/CarteiraEmbarqueModal.tsx` — modal de alta densidade corporativa para visualização da carteira do embarque, apuração granular de USOFF (card com pesos, trava de execução zero, exceção gangway e fórmula de diária, colunas PE×HP, EX×HC e USoff por operação com motivos explicativos e linha de totais), confronto determinístico entre ordens do Portal Offshore e apontamentos do SAP ($HC$ vs $HH_{\text{SAP}}$), filtros rápidos e exportação `.xlsx` estendida com colunas de USOFF.

### Motor de domínio (puro, coberto por testes — invariantes contratuais)
- `src/domain/periods.ts` — ciclos de corte 1/16/21/26 + janela de lookback de 45 dias.
- `src/domain/calculations.ts` — resolução diária, "Não chegou", gangway, agregações, embarques, SLA de cobrança.
- `src/domain/usoff.ts` — agrupamento por OP/ordem, cascata PE/EX em 3 níveis, trava `falta`, Regra dos 12 dias ($US_{off} = PE \times HP_{carteira} + EX \times HC$), trava de execução zero ($HC = 0 \implies US = 0$), exceção de Gangway desconectada ($0{,}30 \times HP$), unidades de diária ($\text{dias} \times 10$) e apuração granular cruzando Portal e SAP.
- `src/domain/communications.ts` — textos e deeplinks Outlook/mailto/WhatsApp com sanitização.
- `src/domain/demo.ts` — overlay sintético sem PII.
- `src/domain/types.ts` — contratos centrais (`ConfirmacaoSAP` inclui `contador_confirmacao`).
- Testes: `src/domain/__tests__/*` (domain, calculations, periods, usoff, communications).

### Utilitários
- `src/utils/date.ts`, `src/utils/format.ts` (`parseCounter`, `parseFlexibleHours` com suporte a estornos `9,00-`/`(9,00)`/unicode/`-hh:mm`, `normalizeSapCode`, `isSapEstornoFlag`, `parseIdEmbarque`, `sanitizePlatformCode`, `PLATFORM_ALIASES`) + `src/utils/__tests__/date-format.test.ts` (70 testes).
- `src/utils/pwa.ts` (ver acima) + `src/utils/__tests__/pwa.test.ts` (8 testes cobrindo Service Worker seguro, Web App Manifest e ciclo de instalação).
- `src/utils/scrollLock.ts` (`acquireScrollLock` com contagem de referências e `registerEscapeLayer` com pilha por prioridade/LIFO) + `src/utils/__tests__/scrollLock.test.ts` (2 testes).

### Serviços & Abstração Client-Side (Dual-Topology)
- `src/ports/{auth,data,realtime,client-provider,baas-connector}.port.ts` — contratos agnósticos de Auth, Data, Realtime e BaaS (`BatchImportConfirmacaoSAPRow` com `contador`).
- `src/adapters/shared/client-pipeline.ts` — pipeline compartilhado (`assembleAppDataset`, sanitização integrada de plataformas, batching topológico, chunks de 500, ordenação determinística por chave natural, validação de senha, debounce Realtime de 450 ms, overlay demo, planners incrementais `planSmartSapImport` / `planSmartCarteiraImport`, deduplicação em memória e ordenação de confirmações SAP).
- `src/config/env.ts`, `src/config/topology-guard.ts`, `src/services/provider.registry.ts` — resolução de topologia (`baas` vs `self-hosted`) e travas de build/runtime.
- `src/adapters/baas/{registry,index}.ts`, `src/adapters/baas/providers/{supabase.config,supabase.connector}.ts` — registry aberto de BaaS (`registerBaaSConnector`) + conector Supabase com `upsertConfirmacoesSAPChunk` (chave única estendida com `contador_confirmacao` e sem `horas_confirmadas`), `fetchAllCarteiraForDedup` e `pruneStaleCarteiraByEmbarquesRPC`.
- `src/adapters/self-hosted/{http.client,self-hosted.provider,index}.ts` — cliente HTTP `credentials: 'same-origin'` com `X-CSRF-Token` apenas em memória + SSE Realtime + suporte a `GET /api/v1/carteira/dedup-snapshot` e poda por embarque.
- `src/services/{supabase,auth.service,data.service,realtime.service}.ts` (fachadas 100% retrocompatíveis, incluindo `fetchCarteiraDedupSnapshot` e opções de poda em `batchImportCarteira`) e `src/services/excel.service.ts` (parser com `parseCounter`, seletor SAP com `contador`, 6 exportadores, sanitização anti-fórmula).

### Backend Supabase (Topologia `baas` default)
- `supabase/migrations/001` → `022` — **imutáveis** (021: heartbeat e auditoria de técnicos; 022: unidades e plataformas por diária).
- `supabase/migrations/023_fix_reconciliar_sap_estornos.sql` — normalização `normalize_sap_code`, reconciliação SAP em 2 passadas (estornos tardios multi-embarque e irmãs Fora da Carteira), soma líquida com arredondamento e guarda `safeupdate` + RBAC global.
- `supabase/migrations/024_smart_dedup_sap_e_portal.sql` — limpeza de 168 duplicatas em `confirmacoes_sap`, recriação de `uq_confirmacao_sap_row` sem `horas_confirmadas`, trigger `sync_carteira_embarques_from_operacoes` removendo órfãos `portal_offshore` e RPC `prune_stale_carteira_by_embarques`.
- `supabase/migrations/025_optimize_reconciliar_sap_hash_joins.sql` — otimização de `reconciliar_confirmacoes_sap()` com CTEs `AS MATERIALIZED` e Hash Joins (reduzindo execução em produção para ~4,8 s sem timeout HTTP 524).
- `supabase/migrations/026_perf_indexes_confirmacoes_sap.sql` — índices B-Tree idempotentes em `confirmacoes_sap` (`data_fim_real`, `data_lancamento`, `data_criacao`) para acelerar o filtro janelado `OR` no carregamento do dashboard.
- `supabase/functions/admin-users/index.ts` — Edge Function v4 com rollback compensatório em todas as etapas SQL pós-GoTrue e travas anti-lockout + auditoria WORM.
- `src/types/database.types.ts` — gerado via schema.

### Backend Universal Self-Hosted & Infraestrutura VPS / Docker (Topologia `self-hosted`)
- `server/package.json`, `server/tsconfig.json` — servidor Node 22/TS puro, zero dependências npm obrigatórias.
- `server/src/ports/universal-storage.port.ts` — `UniversalStorageDriverPort` (7 primitivas universais + operador `neq`).
- `server/src/drivers/{registry,in-memory.driver,generic-sql.driver,generic-document.driver}.ts` — registry aberto + drivers universais.
- `server/src/core/{crypto,realtime-hub,domain-engine.service}.ts`, `server/src/{app,index}.ts` — aplicação server-side de 100% das regras de negócio, granularidade, reconciliação SAP (+4 dias PMB) e reset de carteira.
- `docker/{frontend,backend}.Dockerfile`, `docker/nginx/nginx.conf`, `docker-compose.yml` · `.env.example` · `.env.vps.example` · `docs/DATABASE_ABSTRACTION.md`.

### Segurança e Suíte Completa de Testes
- `src/security/__tests__/*` (159 testes em rbac, rls-policies incluindo Migrations 023/024/025, admin-users-edge, first-login-gate-security, data-leakage-and-sanitization com varredura em `src/`, `server/`, `supabase/` e `public/`).
- `src/adapters/__tests__/{topology-and-baas-registry,self-hosted-universal-drivers}.test.ts` (43 testes cobrindo BaaS connector, provider self-hosted, drivers SQL/Doc/Memória, reconciliação SAP +4 dias, estornos tardios multi-embarque, irmãs Fora da Carteira, poda incremental de embarques sem stacking, granularidade e operador `neq`).
- `src/services/__tests__/{auth,data,excel}.service.test.ts` (75 testes cobrindo autenticação, importação em lote, deduplicação inteligente SAP/Portal Offshore, estornos `+9 -> -9`, parsing SAP IW47 e exportadores Excel com anti-formula injection e escopo parcial).
- `src/ui/components/__tests__/*` (DataTable incluindo `minWidth`, SegmentedControl, Sidebar, ResponsiveShellAndPwa e MeterBarAndOverlay).
- `src/ui/modals/__tests__/ModalsAndDrawer.test.tsx` (7 testes).
- `src/ui/modals/__tests__/CarteiraEmbarqueModal.test.tsx` (9 testes, incluindo retorno `returnToFichaMat` e estornos `002032288155/0010` = `18,0 h`).
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
    - SegmentedControl com 4 abas: Por Embarque (ID), Por Unidade (UN), Por Preposto e Confronto SAP vs Portal (sub-visão global Por Operação removida a pedido do usuário).
  - **Frente 3: Tela de Carteira do Embarque (Confronto SAP vs Portal Offshore):**
    - Modal `CarteiraEmbarqueModal.tsx` integrado no fluxo global via `openCarteiraModal(matricula, idEmbarque?, dataRef?)`.
    - Confronto de Horas: HH Programado (Carteira vs Fora), HC Portal Offshore, HH Confirmado SAP, Saldo de Divergência ($HC_{\text{Portal}} - HH_{\text{SAP}}$).
    - Ícones profissionais vetoriais `lucide-react` padronizados, sem emojis inline no layout corporativo.
  - **Frente 4: Cálculo e Validação de USOFF dentro da Carteira do Embarque:**
    - Card de Apuração de USOFF no topo da modal exibindo: Total USOFF do embarque, pesos contratuais PE/EX aplicados, Gangway ativa ($0{,}30 \times HP$), e badge com status da Trava de Execução Zero ($HC = 0 \implies USOFF = 0$).
    - Colunas granulares na tabela de operações: `PE × HP`, `EX × HC` e `USoff`, com badges e motivos contratuais em cada linha (`PE×HP + EX×HC`, `Apenas EX (Fora)`, `Execução Zero (HC=0)`, `Gangway (30% HP)`, `Diária (Armador)`).
    - Linha de totais (`tfoot`) consolidando horas, divergência, PE×HP, EX×HC e USOFF total.
    - Exportador Excel (`.xlsx`) atualizado com todas as colunas de USOFF e regras aplicadas.
  - **Frente 5: Gerenciamento Ativo de Técnicos Offshore (`TecnicosManager`):**
    - Módulo corporativo `TecnicosManager.tsx` integrado nas abas `Configurações` (`ConfiguracoesView`, sub-aba "Técnicos Offshore") e `Pessoas, plataformas e acessos` (`PessoasPlataformasView`, sub-aba "Técnicos Offshore").
    - Elimina a limitação de inserção exclusiva por upload de arquivos, oferecendo autonomia cadastral completa.
    - Busca instantânea (nome, matrícula, função) e filtros combinados por função e situação de histórico operacional.
    - Cadastro manual (`saveTecnico`) com validação de matrícula única e formulário com datalist de especialidades offshore.
    - Edição inline de dados cadastrais mantendo a integridade referencial da matrícula.
    - Exclusão com confirmação rica (`deleteTecnico`): botões sempre interativos na tabela (sem bloqueio silencioso), diagnóstico no modal com contagem de HHs e embarques, e suporte a exclusão em cascata (`cascade = true`) eliminando falhas de chave estrangeira (`ON DELETE RESTRICT`). Coluna de ações padronizada com `btn btn-sm btn-icon btn-ghost` para Edição e Exclusão, e `btn btn-sm btn-ghost` para Ficha, com largura fluida de `180px` evitando quebra de layout.
    - Importação em lote via planilha (`.xlsx`/`.csv`) com SheetJS, remapeamento de colunas e tabela de pré-visualização.
    - Exportador Excel dedicado (`exportTecnicosListXlsx`) enriquecido com total de HH e embarques de cada técnico, e gerador de planilha modelo vazia (`exportModeloXlsx('tec')`).
    - Integração de visualização rápida da Ficha do Técnico (`openFichaDrawer`).
    - Backend Dual-Topology implementado (Supabase Connector + Server Node.js `/api/v1/tecnicos`).
    - Migration `021_tecnicos_heartbeat_e_auditoria.sql` com trigger Realtime `trg_heartbeat_tecnicos` e auditoria forense WORM `trg_audit_tecnicos` gravando em `system_audit_logs`.
  - **Frente 6: Identificação de Unidades e Plataformas por Diária e Cálculo USOFF ($\text{dias} \times 10$):**
    - Atendimento integral à demanda de identificação das unidades medidas por diária (mesmo com HH apontado):
      1. *Nível de Unidade de Negócio (UN) em `ConfiguracoesView`:* Seletor interativo `HH` vs `Diária` por regional na tabela de pesos de USOFF, permitindo marcar uma UN inteira (ex.: Armador, FPSOs afretados) como regime de diária. Card explicativo detalhando a fórmula de diária corrigida $\text{dias} \times 10$ (eliminando o $+1$ excedente do Excel).
      2. *Nível de Plataforma em `PessoasPlataformasView`:* Campo "Regime de Medição / Remuneração" (`Homem-Hora (HH)` vs `Diária`) no formulário de edição/criação de plataformas, com filtro por regime na barra de ferramentas (`Todos`, `Apenas Diária`, `Apenas HH`) com contadores e coluna com badges visuais (`Diária` verde vs `HH`).
      3. *Motor de Cálculo USOFF e Carteira:* `isArmadorPlatform` e `computeUsoffOperations` consideram a marcação de diária tanto da plataforma quanto da UN. Unidades de diária apuram o USOFF pela fórmula contratual $\text{dias} \times 10$ (ex.: 14 dias = 140 USOFF), com `falta: false` e rótulo `'Diária'` / `'Diária (Armador)'`, sem penalizar apontamentos de HH nem pendências de pesos $PE/EX$.
      4. *Modal Carteira do Embarque (`CarteiraEmbarqueModal.tsx`):* Card de apuração e tabela de ordens/operações reconhecem unidades de diária e exibem o badge e a fórmula $\text{dias} \times 10$ correspondente.
      5. *Importação e Exportação Excel (`excel.service.ts`):* Suporte à coluna `Regime de medição` / `medicao` nas planilhas de cadastro de plataformas.
      6. *Persistência Resiliente e Migration:* Colunas `tipo_medicao text NOT NULL DEFAULT 'hh'` em `plataformas` e `config_usoff_un` adicionadas via migration `022_unidades_e_plataformas_diaria.sql`, com salvaguardas de compatibilidade (`(Diária)` em `tipo` e `DIARIA_UN:<un>` em `regionais_extras`).
  - **Frente 7: Exportação Excel para Auditoria "Portal Offshore + USOFF" (`exportUsoffPortalOffshoreXlsx`):**
    - Novo botão **`Exportar Portal Offshore + USOFF (Excel)`** no cabeçalho de `MedicaoUsoffView.tsx` ao lado de `Exportar USOFF (Excel)`, respeitando integralmente os filtros ativos e o `scopeLabel` parcial do usuário logado.
    - Exportador `exportUsoffPortalOffshoreXlsx` em `src/services/excel.service.ts` gerando 2 abas:
      1. `Portal Offshore + USOFF`: as **17 colunas idênticas** ao download oficial do Portal Offshore (`ID`, `Matrícula`, `Chave`, `Nome`, `Empresa`, `Estrutura`, `Unidade`, `Início`, `Fim`, `Ordem`, `Operação`, `Status Processamento`, `Prioridade`, `Status Programação`, `HH Programado`, `HH Confirmado`, `Recursos`) seguidas de **14 colunas de cálculo USOFF ao lado** (`UN (Sistema)`, `Plataforma (Sistema)`, `Regime`, `Dias Embarque`, `HH Confirmado (SAP)`, `HC Considerado (USOFF)`, `HP Carteira (≥12d)`, `Gangway`, `PE`, `EX`, `PE × HP`, `EX × HC`, `USoff`, `Regra / Observação USoff`).
      2. `Resumo Validação`: conciliação direta entre `Total USoff apresentado no painel` e `Soma da coluna USoff (Aba 1)` (diferença garantida `0`), além de detalhamento por classificação/regra (`Carteira (com execução HC > 0)`, `Carteira (Execução Zero HC = 0)`, `Carteira (Gangway HC = 0)`, `Fora da carteira (com execução HC > 0)`, `Fora da carteira (Execução Zero HC = 0)`, `Não Cadastrado no Portal (SAP)`, `Diária (Armador / UMS / Afretadas)`, `Cancelada (desconsiderada)`, `Sem programação`, `Falta PE/EX`).
    - Cobertura de testes adicionada em `src/ui/views/__tests__/MedicaoUsoffView.test.tsx` e `src/services/__tests__/excel.service.test.ts` (validando paridade exata com `summarizeUsoff(computeUsoffOperations(..., 'embarque')).us`, CWE-1236 e escopo parcial).
  - **Frente 8: Refinamento de UI/UX (Transição Ficha ↔ Carteira, Camadas de Overlays e Barras de Progresso/Colunas):**
    - *Navegação limpa entre Ficha do Técnico e Carteira do Embarque:* `AppContext.tsx` (`returnToFichaMat` e `fichaMatRef`) suspende automaticamente o `FichaTecnicoDrawer` ao abrir `CarteiraEmbarqueModal` (eliminando sobreposição de dois painéis grandes e dois backdrops), e `CarteiraEmbarqueModal.tsx` exibe os botões contextuais **`Voltar à Ficha`** (cabeçalho) e **`Voltar para a Ficha do Técnico`** (rodapé). Da mesma forma, `PainelDiaView.tsx` fecha `modalOrdens` ao abrir a carteira.
    - *Empilhamento seguro para sub-modais compactos:* `.modal-overlay` elevado para `z-index: 120` (acima do `.drawer-box` em `101` e abaixo dos toasts em `200`), combinando `Modal.tsx` e `Drawer.tsx` com `src/utils/scrollLock.ts` para manter o bloqueio de scroll por contagem de referências e fechar sempre a camada superior na tecla `Escape`.
    - *Dimensionamento de tabelas e visibilidade de `<MeterBar />`:* `DataTable.tsx` passa a aceitar `minWidth`; `src/styles/components.css` reforça `.meter` (`min-width: 148px`), `.meter-val` (`min-width: 52px`), `.meter-track` (`min-width: 76px`, `height: 10px`, contraste `var(--line)`/`--line-strong`), e `MeterBar.tsx` aplica `minWidth: '4px'` em percentuais positivos baixos (`> 0%`). Larguras e `minWidth` ajustados em `MedicaoUsoffView.tsx`, `MedicaoRelatoriosView.tsx` (incluindo remoção de `'minmax(170px, 240px)'` inválido em `<td>`), `JustificativasView.tsx` e `VisaoGeralView.tsx` (`175px` / `minWidth: 165px`).
  - **Frente 9: Correção Sistêmica de Estornos SAP Negativos, Zeros à Esquerda e Reconciliação Multi-Embarque (`[+9, -9, +9, +9] = 18`):**
    - *Parsing de Horas e Colunas SAP (`src/utils/format.ts`, `src/services/excel.service.ts`, `src/adapters/shared/client-pipeline.ts`):* `parseFlexibleHours` agora reconhece sinal negativo à direita (`9,00-`, `09:30-`), parênteses contábeis (`(9,00)`, `(09:30)`), traços unicode (`−`, `–`, `—`) e `-hh:mm`; `isSapEstornoFlag` inverte positivos quando a coluna de estorno (`STOKZ`/`Estorno`) estiver marcada (`X`, `Sim`, `Estornado`); coluna `hc` (`Trabalho real`) priorizada antes de `real` (`Data Fim Real`), adicionado sinônimo `Oper.` e fallbacks de datas de lançamento/fim real.
    - *Reconciliação Dual-Topology & Conector (`supabase/migrations/023_fix_reconciliar_sap_estornos.sql`, `server/src/core/domain-engine.service.ts`, `src/test/mockSupabase.ts`, `src/adapters/baas/providers/supabase.connector.ts`):* normalização de códigos sem zeros à esquerda (`normalizeSapCode` / `public.normalize_sap_code`), reconciliação em 2 passadas vinculando estornos tardios (`> 4d`) mesmo em ordens repetidas em múltiplos embarques e acoplando estornos irmãos `Fora da Carteira`, remoção do filtro `.neq('id_embarque', '')` em `loadAppDataset` e desempate `.order('id', { ascending: true })` na paginação Supabase.
    - *Motor de Confronto e Interfaces (`src/domain/calculations.ts`, `CarteiraEmbarqueModal.tsx`, `MedicaoUsoffView.tsx`, `PainelDiaView.tsx`, `FichaTecnicoDrawer.tsx`):* `mergeConfrontoOperations` recalcula `hh_confirmado_sap` e `status_divergencia` (via `resolveDivergenciaSapStatus`) diretamente das confirmações SAP quando carregadas (evitando saldo cacheado `27`), acopla estornos sem vínculo e preserva isolamento entre `id_embarque`s distintos na `CarteiraEmbarqueModal`; UI destaca estornos negativos em vermelho.
  - **Frente 10: Deduplicação Inteligente Sem Empilhamento (SAP + Portal Offshore) e Validação em Produção:**
    - *Chave Única SAP e Limpeza em Produção (`supabase/migrations/024_smart_dedup_sap_e_portal.sql`, `025_optimize_reconciliar_sap_hash_joins.sql`):* removida `horas_confirmadas` de `uq_confirmacao_sap_row`, no `onConflict` do conector Supabase e no `domain-engine.service.ts` (`conflictKeys`), eliminando 168 grupos duplicados em `confirmacoes_sap` (`12.295` → `12.127` linhas; 0 grupos duplicados restantes). `reconciliar_confirmacoes_sap()` otimizada com Hash Joins (`MATERIALIZED` CTEs) rodando em ~4,8 s em produção (`total_confirmacoes_sap = 12.127`, `vinculados_ao_embarque = 4.428`, `operacoes_com_batimento_ok = 1.736`). Caso real `002032288155 / 0010` validado com `[+9, -9, +9, +9] = 18,00 h` (`status_divergencia = 'OK'`, embarque `56586` atualizado para `hh_confirmado_sap = 36,50 h`).
    - *Poda Segura do Portal Offshore & Pré-visualização Inteligente (`client-pipeline.ts`, `ImportarDadosView.tsx`, `data.service.ts`, `supabase.connector.ts`, `self-hosted.provider.ts`, `server/src/app.ts`, `mockSupabase.ts`):* planners puros `planSmartSapImport` e `planSmartCarteiraImport` colapsam duplicatas intra-arquivo, ignoram linhas idênticas já existentes no banco, alinham zeros à esquerda do SAP e comparam o Portal Offshore contra todo o banco sem recorte mensal (`fetchCarteiraDedupSnapshot`); embarques com `data_inicio` alterada ou operações removidas executam `prune_stale_carteira_by_embarques` mantendo todas as operações válidas (`pruneKeepOps`), e o trigger `sync_carteira_embarques_from_operacoes` limpa linhas órfãs `portal_offshore` em `carteira_embarques` (0 órfãos em produção).
  - **Frente 11: Blindagem Anti-Inflação do Confronto & USOFF contra Confirmações SAP `Sem Embarque` e Embarques Históricos (`907` → `148`):**
    - *Confronto Determinístico (`src/domain/calculations.ts` → `mergeConfrontoOperations`):* removida geração de operações `'Não Cadastrado no Portal'` para confirmações `Sem Embarque` (`id_embarque = ''`) sem irmã vinculada no Passo B; acoplamento de não vinculados no `matchPortalOpIndex` e Passo B restrito à janela `[data_inicio, data_fim + 45d]`; quando `carteiraEmbarques` estiver carregada, `extraOps` cujo `id_embarque` não pertença à carteira do contexto são descartadas e não caem mais no fallback por `matricula` (evitando herança indevida de datas do período ativo).
    - *Isolamento Estrito de Embarque no USOFF e Excel (`src/domain/usoff.ts`, `src/services/excel.service.ts`):* lookup de `embRef` normaliza `id_embarque` (`parseIdEmbarque` + `normalizeSapCode`) sem fallback cruzado por `matricula` e ignora `'Não Cadastrado no Portal'` sem `embRef` correspondente na carteira carregada.
    - *Testes de Regressão (`calculations.test.ts`, `usoff.test.ts`):* novos testes com centenas de SAP `Sem Embarque` e períodos históricos comprovando contagem exata de embarques, `HD`, `HC`, `USOFF` e manutenção do saldo líquido `[+9, -9, +9, +9] = 18`.
  - **Frente 12: Janelamento da Carga SAP, Visibilidade de Erros de Carga, Filtro `Responsável` e De-Para Plataforma → UN:**
    - *Eliminação do "apagão" após upload SAP (`supabase.connector.ts`, `client-pipeline.ts`, `data.service.ts`, `self-hosted.provider.ts`, `server/src/app.ts`, `domain-engine.service.ts`, `ImportarDadosView.tsx`, `AppContext.tsx`, `AppShell.tsx`):*
      - Em `fetchRawDataset`, `confirmacoes_sap` deixou de varrer e ordenar a tabela inteira sem índice e passou a consultar a janela `sapWindowIni = addDays(queryIni, -45)` via `.or('data_fim_real.gte.<sapWindowIni>,data_lancamento.gte.<sapWindowIni>,data_criacao.gte.<sapWindowIni>').order('id', { ascending: true })`.
      - Adicionado `fetchSapDedupSnapshot()` (BaaS + endpoint `GET /api/v1/sap/dedup-snapshot`) carregado sob demanda na tela de importação para manter a deduplicação SAP completa contra todo o histórico sem travar o boot do app.
      - Queries críticas de bootstrap (`configuracoes`, `config_usoff_un`, `pessoas`, `get_watermark_status`, `profiles`) agora lançam erro explícito quando falham; `AppContext.reloadDataset()`/`refreshData()` propagam `loadError` (boolean de retorno `false` na falha) exibindo banner `role="alert"` com ação **`Recarregar dados`** em `AppShell.tsx`, e `ImportarDadosView` evita confirmar recarga verde quando `refreshData() === false`.
      - Criada migration idempotente `supabase/migrations/026_perf_indexes_confirmacoes_sap.sql` (3 índices de data em `confirmacoes_sap`).
    - *Correção do Filtro `Responsável` & De-Para Automático Plataforma → UN (`calculations.ts`, `StickyFilterBar.tsx`, `ScopeBanner.tsx`, `VisaoGeralView.tsx`, `PessoasPlataformasView.tsx`, `UserSettingsView.tsx`, `excel.service.ts`):*
      - `StickyFilterBar` passou a emitir `value={p.id}` (normalizado por `resolvePersonFilter` para retrocompatibilidade com nome) e limpa `fPlat` incompatível ao alternar `fReg`; `ScopeBanner` traduz `filters.fResp` de ID para `p.nome`.
      - Removido o seletor manual `"Unidades de negócio inteiras (opcional)"` (`selectedUns`/`toggleUn`) de `PessoaModal` em `PessoasPlataformasView.tsx`; o formulário agora salva `uns: []` e exibe preview em tempo real `"Unidades de negócio (de-para automático)"`.
      - Introduzida `resolvePersonUns(pessoa, plataformasOrPidx?)` e atualizada `isPersonResponsible(pessoa, place, plataformasOrPidx?)`: quando a pessoa possui apenas plataformas (`uns: []`), a UN correspondente (`plat.un`) é derivada automaticamente pelas plataformas atribuídas no nível de UN (`VisaoGeralView`, `UserSettingsView`, exportação Excel) **sem conceder acesso cruzado a outras plataformas da mesma UN**. `passesFilter` resolve `fResp` por ID ou nome e rejeita ID desconhecido quando `pessoas` estiver carregado.
    - *Cobertura de Testes Adicionada:* `calculations.test.ts`, `ResponsiveShellAndPwa.test.tsx`, `OperationalViews.test.tsx`, `PessoasModalDePara.test.tsx`, `UserSettingsView.test.tsx`, `data.service.test.ts`, `self-hosted-universal-drivers.test.ts` e `mockSupabase.ts` (suporte a `.or(...)`).
  - **Resultados de Qualidade:**
    - Suíte de testes: **34 arquivos / 611 testes aprovados (100% verdes)**.
    - `npm run typecheck`: **0 erros** (`server/tsconfig.json`: **0 erros**).
    - `npm run build`: **bundle de produção gerado com sucesso em 5.91s**.
    - Banco Supabase PROD (`fwdvrkfootvublicetim`): Migrations `023`, `024` e `025` aplicadas e auditadas; Migration `026` pronta para execução opcional no SQL Editor.

## 4. Próximos Passos (priorizados)

1. **Validação pelo usuário em produção após o redeploy no GitHub Pages:** testar upload SAP/Portal Offshore confirmando que o carregamento principal segue instantâneo após gravação, conferir o filtro **`Responsável`** (seleção por pessoa, visão detalhada por plataforma, listagem por UN com Prepostos derivados automaticamente) e validar edição de pessoas em `Pessoas & Plataformas` sem seletor manual de Regional/UN.
2. **Opcional (Recomendado) — Aplicar Migration `026_perf_indexes_confirmacoes_sap.sql` no Supabase PROD:** executar via SQL Editor (ou após renovar o PAT do MCP Supabase) para criar os 3 índices de data em `confirmacoes_sap`.
3. **Decisão pendente do usuário — visibilidade da aba `adm`:** confirmar se o perfil `gestor` deve manter acesso à aba ADM ou se fica restrita a `admin`.



