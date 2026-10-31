# CONTEXT_MEMORY.md — Memória Técnica e de Negócio para Agentes de IA

> **Finalidade deste documento:** Este arquivo é a **Fonte Única de Verdade (Single Source of Truth)** de memória arquitetural, matemática, contratual e operacional do sistema **HH Offshore · Infotec Brasil**. Qualquer agente de IA ou engenheiro que assuma a manutenção deste repositório deve ler este documento integralmente antes de modificar regras de domínio, políticas RLS, migrations SQL, componentes React ou fluxos de CI/CD.
>
> **Regra Crítica de Privacidade (Repositório Público):** Este repositório (`edisen12.github.io`) é público para operar gratuitamente no GitHub Pages. **JAMAIS** grave nomes reais de colaboradores/técnicos, e-mails pessoais, CPFs, matrículas reais ou senhas em arquivos versionados pelo Git (incluindo este documento, testes, mocks ou seeds locais). Todos os dados reais residem exclusivamente no PostgreSQL do Supabase protegido por autenticação obrigatória e Row Level Security (`TO authenticated`).

---

## 1. Identidade e Propósito do Sistema

- **Produto:** Controle de HH Offshore · Infotec Brasil.
- **Autoria Original da Regra de Negócio:** Luanna de Abreu Teixeira (crédito institucional preservado no rodapé da aplicação).
- **Domínio:** Gestão operacional e contratual de Homem-Hora (HH) e Unidade de Serviço Offshore (**USOFF**) de técnicos embarcados em plataformas marítimas, FPSOs, sondas e embarcações afretadas atendidas pela Infotec Brasil.
- **Transformação Arquitetural:** Refatorado de um aplicativo monolítico `index.html` (~1 MB offline/single-file) para uma SPA corporativa multiusuário **Online-First**, 100% gratuita em infraestrutura, construída com **React 19 + TypeScript 5 + Vite 6** hospedada no **GitHub Pages** e apoiada pelo **Supabase Cloud** (`PostgreSQL 17` + `Auth` + `RLS Multi-Escopo` + `Edge Functions` + `Realtime Cirúrgico`).

---

## 2. Topologia de Infraestrutura e Limites da Cota Gratuita (\$0/mês)

```
[Navegador do Usuário (HTTPS)]
   │
   ├── 1. Assets Estáticos (SPA React 19 + Vite + Lazy Chunk SheetJS)
   │      └── GitHub Pages (edisen12.github.io) via GitHub Actions (.github/workflows/deploy.yml)
   │
   ├── 2. Autenticação JWT (E-mail + Senha corporativa, sem SMTP público)
   │      └── Supabase Auth (sa-east-1 · ref: fwdvrkfootvublicetim)
   │
   ├── 3. Dados Operacionais & Isolamento Multi-Escopo
   │      └── Supabase PostgREST + PostgreSQL 17 RLS + RPCs SECURITY DEFINER
   │
   ├── 4. Colaboração em Tempo Real (Escopo Cirúrgico)
   │      └── Supabase Realtime (apenas tabelas `justificativas` e `sync_heartbeat`)
   │
   └── 5. Gestão de Usuários pelo Admin (Provisionamento Direto)
          └── Supabase Edge Function `admin-users` (Service Role isolada no servidor, verify_jwt: true)
```

### Engenharias de Respeito às Cotas Free Tier
1. **Anti-Pausa de 7 Dias do Supabase Free:** O workflow `.github/workflows/supabase-keepalive.yml` executa toda segunda e quinta-feira às `09:00 UTC` chamando `POST /rest/v1/rpc/ping_health` (única função acessível com `apikey` pública que retorna apenas `{"ok": true, "ts": ...}` sem tocar dados sensíveis).
2. **Contorno do Limite de 3 E-mails/Hora do SMTP Gratuito & SafeLinks Corporativo:** O sistema **não depende** de Magic Links nem de e-mails transacionais do Supabase Auth. O Administrador cria contas, redefine senhas, troca papéis (`admin`, `gestor`, `controlador`, `preposto`) e ativa/desativa acessos diretamente pela interface (*Pessoas, Plataformas & Acessos*) invocando a Edge Function `admin-users`, que grava no Supabase Auth com `email_confirm: true`.
3. **Economia de Conexões e Mensagens Realtime (Limite Free: 200 conexões simultâneas / 2M msgs):**
   - **Proibido** assinar `apontamentos_hh` ou `carteira_embarques` no Realtime (uma importação de 5.000 linhas estouraria a cota de broadcast).
   - O cliente assina **exclusivamente**:
     - `public:justificativas` (baixa frequência, atualização instantânea na tela da equipe).
     - `public:sync_heartbeat` (1 linha singleton atualizada por trigger `FOR EACH STATEMENT` ao fim de qualquer importação em lote, disparando um único re-fetch HTTP limpo nos clientes conectados).
4. **Ingestão Chunked Batch UPSERT:** Planilhas `.xlsx/.xls/.csv` são processadas no navegador via **SheetJS carregado sob demanda** (`await import('xlsx')`) e enviadas ao Supabase em blocos de **500 linhas** (`onConflict`), evitando timeouts HTTP e mantendo o bundle inicial leve.

---

## 3. Regras de Negócio e Invariantes Matemáticos Contratuais

> **Invariante Absoluto:** Nenhuma refatoração visual ou de banco pode alterar o resultado numérico destas regras em relação ao motor original. Toda alteração em `src/domain/` deve passar na suíte `npm run test:run` (Vitest).

### 3.1. Ciclo Mensal de Medição (`dia_corte_medicao`)
- `dia_corte_medicao` (no legado chamado `ciclo`) define o **dia de corte da medição mensal** (`21`, `1`, `16` ou `26`), e **NÃO** uma escala de trabalho 14x21.
- Para um mês de referência `YYYY-MM`:
  - Se `dia_corte_medicao === 1`: `ini = YYYY-MM-01` e `fim = último dia de YYYY-MM`.
  - Se `dia_corte_medicao === C` (`16`, `21` ou `26`): `ini = dia C do mês anterior` e `fim = dia (C - 1) do mês YYYY-MM`. Exemplo padrão (`21` para `2026-06`): `2026-05-21` até `2026-06-20`.

### 3.2. Critério de Inclusão na Medição (`med_criterio`) e Lookback de 45 Dias
- **`'enc'` (Padrão Contratual — Embarques Encerrados no Período):**
  - Nas abas **Medição e Relatórios** e **Medição USOFF**, entram **apenas os embarques cuja `data_fim` cai dentro de `[P.ini, P.fim]`**.
  - Quando um embarque se qualifica (`P.ini <= data_fim <= P.fim`), **TODOS os dias daquele embarque entram na soma** — inclusive os dias anteriores a `P.ini` (ex.: embarque `10/05` a `23/05` medido no ciclo `21/05`–`20/06` inclui integralmente os dias `10/05` a `20/05`).
  - **Implicação de Query no Banco:** `data.service.ts` sempre busca `apontamentos_hh`, `carteira_embarques`, `justificativas` e `get_external_covered_days` a partir de **`queryIni = addDays(P.ini, -45)`** até `P.fim` para nunca truncar o início de embarques que cruzam a fronteira do ciclo.
- **`'dias'` (Dias Estritos dentro do Período):**
  - Considera estritamente os registros cuja `data` pertence a `[P.ini, P.fim]`.

### 3.3. Regra `"Não chegou"` (`sem: true`) e Marca d'Água (`LAST`)
- `LAST` (`watermark.ultima_data_hh`) é a maior data de apontamento de HH carregada no contrato inteiro (obtida via RPC `get_watermark_status()`, para que mesmo um Preposto sem apontamentos recentes na sua carteira conheça a data-limite real do sistema sem vazamento de dados).
- Para qualquer par `(matricula, D)`:
  1. Se existe linha em `apontamentos_hh`: `d = hh_dia` (padrão `11h`), `e = horas_executadas`, `sem = false`.
  2. Se **não** existe linha em `apontamentos_hh`, mas o técnico está previsto em `carteira_embarques` cobrindo `D` (`data_inicio <= D <= data_fim`) **E** `D <= LAST` **E** `(matricula, D)` **não** está em `externalCoveredSet`:
     - O sistema sintetiza um registro **`sem = true`** (*"Não chegou"*):
     - **`d = hh_dia` (`11h` disponíveis)**, **`e = 0` (`0h` executadas)**, percentual `0%`, status `'bad'`.
     - **Exige justificativa obrigatória** (`needJust = true`).
  3. Por essa razão, a tabela `public.justificativas` possui chave natural `UNIQUE (matricula, data)` e **NÃO possui Foreign Key** para `apontamentos_hh` (pois precisa armazenar justificativas de dias onde o apontamento não chegou).

### 3.4. Proteção contra Transbordo Cross-Carteira sob RLS (`externalCoveredSet`)
- **Problema:** Sob RLS estrito, se o técnico `M` estava previsto na carteira do Preposto A (`P74`) na data `D`, mas sofreu transbordo operacional e apontou HH na plataforma `P75` (carteira do Preposto B), o PostgreSQL oculta a linha de `apontamentos_hh` da `P75` para o Preposto A. Sem tratamento, o motor do cliente veria a previsão em `P74` sem apontamento e geraria um falso `"Não chegou"` (`0h/11h`) para o Preposto A.
- **Solução Implementada:** A RPC `get_external_covered_days(p_ini, p_fim)` (`SECURITY DEFINER`) retorna apenas os pares `(matricula, data)` em que o técnico pertence à carteira visível do usuário mas já possui apontamento válido em plataforma fora do escopo do usuário (sem revelar sigla, UN ou horas da outra carteira). O motor popula `externalCoveredSet` e suprime a síntese falsa de `sem: true`.

### 3.5. Gangway Desconectada (`horas_gangway` e `% sem gangway` / `pAj`)
- O campo `horas_gangway` de uma justificativa **só é contabilizado** se `motivo === 'Gangway desconectada'`, limitado ao intervalo `[0, d]` (`0` a `11h`).
- **Percentual Bruto (`p`):** `e / d`.
- **Percentual Ajustado sem Gangway (`pAj`):**
  - Se `d - gw > 0`: `pAj = e / (d - gw)`.
  - Se `d - gw <= 0`: `pAj = null`.
- Semáforo de Status (`statusForPct(pct, config)`):
  - `pct >= meta_percentual` (padrão `100%`): `'ok'` (Verde).
  - `atencao_percentual <= pct < meta_percentual` (padrão `90%`–`99,9%`): `'warn'` (Âmbar/Laranja).
  - `pct < atencao_percentual`: `'bad'` (Vermelho).

### 3.6. Medição Contratual USOFF (`src/domain/usoff.ts`)
- Agrupamento: por código de operação `OP` (`carteira_embarques.operacao` normalizado). Se o embarque não tiver código `OP`, agrupa individualmente por embarque (`EMB:...`); apontamentos órfãos sem carteira caem em `SEMOP:...` (`tipo = 'Sem programação'`).
- **Horas Programadas (`HP`):**
  - Se `horas_programadas > 0` na carteira: usa o valor explícito (`fonte = 'informada'`).
  - Caso contrário: `dias_do_embarque * hh_dia` (`fonte = 'dias × 11h'`).
  - `hpAte`: parcela proporcional das horas programadas até a data `LAST`.
- **Cascata de 3 Níveis para Pesos `PE` e `EX`:**
  1. Peso específico na linha de `carteira_embarques` (`pe`, `ex`).
  2. Peso da Unidade de Negócio em `config_usoff_un` (`usoffUnWeights[un]`).
  3. Peso global padrão em `configuracoes` (`us_pe_padrao`, `us_ex_padrao`).
- **Fórmula USOFF:**
  $$\text{USoff} = (PE \times HP) + (EX \times HC)$$
  onde $HP$ = horas programadas da operação e $HC$ = horas executadas/computadas (`e`).
- **Trava de Segurança `falta`:** Se **qualquer** item de uma operação (ou qualquer operação no resumo geral) não tiver `PE` **e** `EX` definidos (`null`), marca-se `falta = true` e o valor `USoff` exibe **`—`** (`null`) — jamais calcula um total parcial enganoso.
- **Operações Compartilhadas (`sharedAcrossPortfolios`):** A RPC `get_shared_ops(p_ops)` sinaliza para Prepostos/Controladores quando um código `OP` também possui embarques em plataformas fora da sua carteira.

### 3.7. SLA de Cobrança de Justificativas (`prazo_justificativa_dias`)
- Todo dia com `e < d` (incluindo `sem: true`) exige justificativa (`needJust`).
- Prazo limite: `vencimento = addDays(D, prazo_justificativa_dias)` (padrão `+2 dias`).
- Se não justificado e `LAST > vencimento`: conta como **Vencida** (`venc`).
- Se justificado com `criado_em`: compara a data de criação com `vencimento` para classificar **No prazo** vs **Fora do prazo** e calcular o tempo médio de resposta em dias.

---

## 4. Arquitetura Supabase, Schema SQL e Segurança RLS Multi-Escopo

### 4.1. Metadados do Projeto Supabase Cloud (Produção)
- **Nome:** `hh-offshore-infotec`
- **Project Ref (`project_id`):** `fwdvrkfootvublicetim`
- **Região:** `sa-east-1` (São Paulo)
- **URL Pública:** `https://fwdvrkfootvublicetim.supabase.co`
- **Anon Key:** Configurada em `src/config/env.ts` com override via `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (segura para frontend público pois `anon` tem `0` permissões em tabelas; apenas `authenticated` passa pelas políticas RLS).

### 4.2. As 15 Tabelas de `public` (`001_initial_schema.sql` a `004_user_onboarding_and_preferences.sql`)

| Tabela | Chave Primária / Natural | Papel no Domínio |
|---|---|---|
| `profiles` | `id` (`UUID` FK `auth.users`) | Perfil autenticado (`email`, `nome`, `role`, `ativo`). |
| `user_onboarding` | `user_id` (`UUID` FK `auth.users`) | Controle obrigatório de primeiro login (`primeiro_login`, `obriga_troca_senha`, `senha_trocada_em`) e preferências persistentes de interface (`preferencias` JSONB: `themeMode`, `density`, `defaultTab`, `pageSize`). |
| `plataformas` | `sigla` (`TEXT`), `UNIQUE(chave_norm)` | Catálogo oficial de unidades marítimas (~511+ siglas). `cadastro_pendente = true` quando auto-criada via importação. |
| `pessoas` | `id` (`UUID`), `UNIQUE(slug)` | Diretório operacional de Prepostos, Controladores e Gestores; `user_id` vincula à conta de login. |
| `pessoa_plataformas` | `(pessoa_id, plataforma_sigla)` | Escopo explícito por plataforma atribuído a uma pessoa. |
| `pessoa_unidades` | `(pessoa_id, unidade_negocio)` | Escopo explícito por Unidade de Negócio inteira (ex.: `UN-BC`) atribuído a uma pessoa. |
| `tecnicos` | `matricula` (`TEXT`) | Cadastro mestre de técnicos (`matricula`, `nome`, `funcao`). |
| `carteira_embarques` | `id` (`UUID`), `UNIQUE(matricula, plataforma_sigla, data_inicio, data_fim)` | Programação de embarques, `horas_programadas`, `operacao` (`OP`) e pesos específicos `pe` / `ex`. |
| `apontamentos_hh` | `id` (`UUID`), `UNIQUE(matricula, data)` | Realizado diário de HH (`horas_executadas`, `plataforma_sigla`, `unidade_negocio`). |
| `justificativas` | `id` (`UUID`), `UNIQUE(matricula, data)` | Justificativas de desvios `< 11h` ou `"Não chegou"`, `horas_gangway` e trilha de auditoria imutável via trigger `trg_justificativas_audit`. |
| `configuracoes` | `id` (`'geral'`) | Parâmetros globais do contrato (`hh_dia`, `meta_percentual`, `atencao_percentual`, `dia_corte_medicao`, `med_criterio`, `prazo_justificativa_dias`, `us_pe_padrao`, `us_ex_padrao`). |
| `config_usoff_un` | `unidade_negocio` (`TEXT`) | Pesos `pe` e `ex` de USOFF por Unidade de Negócio. |
| `configuracoes_notificacao` | `id` (`'geral'`) | Lista `emails_resumo` (restrita a `admin` e `gestor` para evitar exposição a perfis de escopo parcial). |
| `fluxo_importacoes` | `id` (`UUID`) | Log auditável de importações de planilhas e lançamentos manuais. |
| `sync_heartbeat` | `id` (`1`) | Singleton atualizado por triggers `FOR EACH STATEMENT` para notificar clientes via Realtime e alimentar `get_watermark_status()`. |

### 4.3. Matriz de Isolamento Multi-Escopo (`supabase/migrations/002_rls_and_rpc_functions.sql`)

Todas as funções auxiliares de escopo (`auth_is_active()`, `auth_is_global()`, `auth_is_admin()`, `auth_allowed_uns()`, `auth_allowed_platforms()`, `auth_can_access_justificativa()`) são `SECURITY DEFINER STABLE` com `SET search_path = public`.

| Perfil (`profiles.role`) | `auth_is_global()` | Escopo de Leitura (`SELECT`) | Escopo de Escrita (`INSERT`/`UPDATE`/`DELETE`) | Abas Visíveis |
|---|---|---|---|---|
| `anon` (Não logado) | `false` | **ZERO** em todas as 14 tabelas (apenas RPC `ping_health()`). | **ZERO** | Apenas tela `LoginView` |
| Conta com `ativo = false` | `false` | **ZERO** imediato no banco (`auth_is_active() = false`). | **ZERO** | Bloqueado / Logout imediato |
| `admin` | `true` | 100% do contrato + `configuracoes_notificacao` | Total em todas as tabelas + invocação da Edge Function `admin-users` | Todas as 9 seções |
| `gestor` | `true` | 100% do contrato + `configuracoes_notificacao` | Operacional completo (importações, cadastros operacionais, justificativas, configurações) — exceto gestão de contas Auth (`admin-users`) | Todas as 9 seções |
| `controlador` | `false` | **Estritamente fatiado** às suas `pessoa_plataformas` $\cup$ plataformas das suas `pessoa_unidades` (incluindo Medição e USOFF fatiadas à própria carteira) | `INSERT` e `UPDATE` apenas em `justificativas` cujo `(matricula, data)` pertença à sua carteira (`auth_can_access_justificativa`) | 6 seções operacionais e de medição (`ger`, `dia`, `emb`, `jus`, `med`, `us`) com `ScopeBanner` |
| `preposto` | `false` | **Estritamente fatiado** às suas `pessoa_plataformas` $\cup$ plataformas das suas `pessoa_unidades` (incluindo Medição e USOFF fatiadas à própria carteira) | `INSERT` e `UPDATE` apenas em `justificativas` cujo `(matricula, data)` pertença à sua carteira (`auth_can_access_justificativa`) | 6 seções operacionais e de medição (`ger`, `dia`, `emb`, `jus`, `med`, `us`) com `ScopeBanner` |

> **Regra de Exportação Parcial:** Quando um `preposto` ou `controlador` exporta planilhas `.xlsx` em *Medição e Relatórios* ou *Medição USOFF*, o `excel.service.ts` estampa obrigatoriamente o aviso **`ESCOPO PARCIAL - Carteira [Nome do Usuário]`** no cabeçalho/aba de resumo para que ninguém confunda um recorte de carteira com o consolidado global do contrato.

### 4.4. Edge Function `admin-users` v2 & Fluxo de Primeiro Login Obrigatório
- Invocada com `Authorization: Bearer <access_token>` do usuário logado (`verify_jwt: true`).
- Valida o JWT no Supabase Auth **e** confirma no banco que `profiles.role IN ('admin', 'gestor')` e `profiles.ativo === true`.
- Ações suportadas:
  - `create`: cria usuário no Supabase Auth (`email_confirm: true`), insere `public.profiles`, cria registro em `public.user_onboarding` com `primeiro_login = true, obriga_troca_senha = true` e vincula `public.pessoas.user_id`.
  - `update-role`: atualiza nome e `role` sincronizando `profiles`, `auth.users` e `pessoas`.
  - `reset-password`: define senha provisória e marca `user_onboarding.obriga_troca_senha = true`, forçando o usuário a definir nova senha privada no próximo acesso.
  - `toggle-active`: ativa/desativa em 0ms (`profiles.ativo` + `ban_duration`).
  - **Trava Anti-Lockout:** Impede que o Admin desative a própria conta, rebaixe seu próprio papel `admin` ou remova o último Administrador ativo.
- **Gate Obrigatório de Primeiro Acesso (`FirstLoginGate.tsx`):**
  - Sempre que `user_onboarding.primeiro_login` ou `user_onboarding.obriga_troca_senha` for `true` (inclusive para Administradores no primeiro acesso), `AppGate` bloqueia o carregamento de dados operacionais (`AppContext`) e exibe exclusivamente `FirstLoginGate`, exigindo troca imediata da senha provisória (`complete_first_login_password_change()`).

---

## 5. Design System Oficial Infotec Brasil (`src/styles/`)

- **Identidade Visual:** Baseada na marca oficial da Infotec Brasil (`public/infotec-logo.png`).
  - **Azul Infotec (Primária Institucional):**
    - Light mode: `--brand-primary: #1E4E9C` | Hover: `#163C7A` | Suave: `#EBF2FC`
    - Dark mode: `--brand-primary: #7AA6EC` | Hover: `#9BBDF4` | Suave: `rgba(122, 166, 236, 0.14)`
  - **Laranja Infotec (Destaque / Acento / Indicador Ativo):**
    - Light mode: `--brand-accent: #F5A100` | Hover: `#D48800` | Suave: `#FFF6E0`
    - Dark mode: `--brand-accent: #FFB52E` | Hover: `#FFC65C` | Suave: `rgba(255, 181, 46, 0.14)`
  - **Semáforo Operacional:**
    - Meta atingida (`>= 100%`): Esmeralda (`#0F7B55` light / `#34D399` dark)
    - Faixa de atenção (`90%–99,9%`): Âmbar (`#B86E00` light / `#FBBF24` dark)
    - Abaixo da atenção (`< 90%` ou `"Não chegou"`): Rubi (`#C53030` light / `#F87171` dark)
- **Tipografia:**
  - Títulos, KPIs e navegação: `'Montserrat', sans-serif`
  - Corpo, formulários e tabelas densas: `'Source Sans 3', sans-serif`
  - **Obrigatório em colunas numéricas, horas, percentuais e USOFF:** `font-variant-numeric: tabular-nums` (classe `.num`).
- **Temas & Configurações do Usuário (`UserSettingsView.tsx`):**
  - Nenhum botão flutuante de tema ou indicador "Online" polui o `LoginView` ou o `TopHeader`.
  - A seleção de tema (`Claro Executivo`, `Escuro Offshore` ou `Automático do Sistema`), densidade de tabelas (`Confortável` vs `Compacta`), aba inicial padrão e paginação padrão (`25/50/100`) ficam centralizadas em **Configurações do Usuário** (`TabId = 'perfil'`), acessível a todos os papéis pelo menu dropdown do perfil no `TopHeader` ou pelo rodapé fixo da `Sidebar`, com persistência em `localStorage` (`hhoff_prefs`) e no banco (`public.user_onboarding.preferencias` via RPC `update_own_profile`).
- **Arquitetura de Layout Viewport-Locked (`100dvh`) & Otimização `1366×768` (16:9 HD):**
  - Em desktop (`> 860px`), `.app-shell` trava em `height: 100dvh; overflow: hidden`. Tanto a `Sidebar` (com cabeçalho e rodapé de Perfil/Logout fixos e divisores visuais `OP / MED / ADM` quando recolhida) quanto o `TopHeader` e a `StickyFilterBar` de linha única permanecem 100% congelados, rolando apenas `.main-scroll-area`.
  - Os grids `.kpis` usam colunas determinísticas (`repeat(6, 1fr)` em `>= 1560px` Full HD e `repeat(3, 1fr)` em `900px–1559px` para simetria `3×2` perfeita em monitores `1366×768`, eliminando cards órfãos `5 + 1`).
  - Seletores de sub-visão utilizam `<SegmentedControl />` de alto contraste com contadores numéricos.

---

## 6. Mapa de Diretórios e Responsabilidades (`src/`, `supabase/`, `.github/`)

```
├── .github/workflows/
│   ├── deploy.yml                  # Typecheck + Vitest + Vite Build + Deploy automático no GitHub Pages
│   └── supabase-keepalive.yml      # Cron 2x/semana (seg/qui 09:00 UTC) chamando RPC ping_health()
├── public/
│   └── infotec-logo.png            # Logotipo oficial Infotec Brasil
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql          # 14 tabelas, índices, triggers de auditoria e heartbeat, Realtime
│   │   └── 002_rls_and_rpc_functions.sql   # Funções SECURITY DEFINER, RPCs anti-vazamento e políticas RLS
│   └── functions/
│       └── admin-users/index.ts            # Edge Function Deno para provisionamento/gestão de contas Auth
├── src/
│   ├── config/
│   │   ├── env.ts                  # URL e Anon Key do projeto Supabase fwdvrkfootvublicetim
│   │   └── constants.ts            # Constantes contratuais, motivos de justificativa, abas e rótulos
│   ├── types/
│   │   └── database.types.ts       # Tipos TypeScript gerados diretamente do schema PostgreSQL live
│   ├── utils/
│   │   ├── date.ts                 # Manipulação segura de datas YYYY-MM-DD em horário local (sem drift UTC)
│   │   └── format.ts               # Formatação pt-BR de horas, percentuais, inteiros, chaves normalizadas e slugs
│   ├── domain/                     # Motor puro de regras de negócio (zero dependência de React ou rede)
│   │   ├── types.ts                # Interfaces centrais compartilhadas em toda a aplicação
│   │   ├── periods.ts              # Ciclo de corte mensal (21/1/16/26), janelas e lookback de 45 dias
│   │   ├── calculations.ts         # Resolução diária, "Não chegou", Gangway, agregações, embarques e SLA de cobrança
│   │   ├── usoff.ts                # Agrupamento OP, cascata 3 níveis PE/EX e fórmula USOFF
│   │   ├── communications.ts       # Geração de textos e deeplinks Outlook M365, mailto: e WhatsApp/Teams
│   │   ├── demo.ts                 # Dataset sintético fictício (apenas quando acionado em modo demonstração sem PII)
│   │   └── __tests__/domain.test.ts# Suíte Vitest cobrindo todas as invariantes matemáticas contratuais
│   ├── services/
│   │   ├── supabase.ts             # Instância tipada do cliente Supabase JS v2
│   │   ├── auth.service.ts         # Login, logout, sessão, perfil e chamada à Edge Function admin-users
│   │   ├── data.service.ts         # Carregamento paginado (>1000 linhas), batch UPSERT 500 linhas, mutações e RPCs
│   │   ├── realtime.service.ts     # Assinatura cirúrgica de `justificativas` e `sync_heartbeat` com debounce
│   │   └── excel.service.ts        # Parser universal (SheetJS lazy) com detecção de cabeçalho e exportador .xlsx
│   ├── styles/
│   │   ├── reset.css               # Reset moderno e acessibilidade de foco
│   │   ├── tokens.css              # Design Tokens Infotec Brasil (Light & Dark)
│   │   ├── layout.css              # Shell responsivo (Sidebar colapsável, TopHeader, StickyFilterBar, Grids)
│   │   └── components.css          # Tabelas densas, cards KPI, badges, barras de meta, modais e drawers
│   ├── test/                       # Infraestrutura de Teste e Banco Mock Isolado (Zero Network)
│   │   ├── setup.ts                # Configuração global Vitest e ambiente happy-dom
│   │   ├── testFixtures.ts         # Fixtures determinísticas sem PII (usuários, perfis, plataformas, carteira)
│   │   └── mockSupabase.ts         # Simulador em memória do cliente Supabase (auth, PostgREST fluente, RPCs)
│   ├── ui/
│   │   ├── state/AppContext.tsx    # Estado global autenticado, filtros, período ativo, dataset e mutações
│   │   ├── components/             # Primitivos reutilizáveis e suíte de testes (__tests__/)
│   │   ├── modals/                 # JustificativaModal, FichaTecnicoDrawer, EmailComposerModal, ManualEntryModals
│   │   └── views/                  # LoginView, FirstLoginGate, UserSettingsView + as 9 views operacionais (__tests__/)
│   ├── App.tsx                     # Orquestrador raiz (Gate de Autenticação + Roteamento de Abas e Modais Globais)
│   └── main.tsx                    # Bootstrap React 19 + importação da cascata CSS
└── CONTEXT_MEMORY.md               # Este documento
```

---

## 7. Arquitetura de Testes e Ambiente de Desenvolvimento Isolado

> **Garantia de Segurança Operacional:** Os testes unitários e de integração **NUNCA** acessam o banco de dados de produção (`fwdvrkfootvublicetim.supabase.co`). Toda a suíte executa de forma 100% determinística e offline utilizando o simulador em memória `mockSupabase.ts` e `testFixtures.ts`.

- **Framework:** `Vitest 3` com ambiente de execução `happy-dom` e `@testing-library/react`.
- **Cobertura Total:** **20 arquivos de teste e 376 testes automatizados (100% passando em ~10s)**.
  1. **Domínio e Invariantes Matemáticos (`src/domain/__tests__/`, `src/utils/__tests__/`):**
     - Todos os 4 ciclos de corte (`1`, `16`, `21`, `26`) e lookback de 45 dias.
     - Síntese de *"Não chegou"* com proteção contra transbordo (`externalCoveredSet`).
     - Dedução de Gangway desconectada (`pAj`).
     - Fórmula USOFF com cascata de 3 níveis de pesos e trava de integridade `falta = true`.
     - SLA de justificativas (no prazo vs vencidas e tempo médio).
     - Datas sem drift de fuso horário UTC vs local.
  2. **Serviços & Banco Mock Dev (`src/services/__tests__/`):**
     - Autenticação e primeiro login obrigatório (`auth.service.test.ts`).
     - Paginação de mais de 1.000 linhas via `.range(from, to)` e batch upsert em chunks de 500 linhas (`data.service.test.ts`).
     - Parsing tolerante a formatos e geração de planilhas XLSX com disclaimer de escopo parcial (`excel.service.test.ts`).
  3. **Interface e Fluxos do Usuário (`src/ui/**/__tests__/`):**
     - Bloqueio total no primeiro login e validação progressiva de senha (`FirstLoginGate.test.tsx`).
     - Persistência e aplicação de preferências de tema, densidade e paginação (`UserSettingsView.test.tsx`).
     - Ordenação e paginação customizada de tabelas (`DataTable.test.tsx`).
     - Contraste, seleção ativa e contagens numéricas de abas (`SegmentedControl.test.tsx`).
     - Exibição de grupos e divisores de seção na sidebar recolhida (`Sidebar.test.tsx`).
  4. **Segurança Avançada, RBAC, RLS & Edge Function (`src/security/__tests__/` - 122 testes):**
     - Isolamento RLS das 15 tabelas públicas e corte instantâneo 0ms (`rls-policies.test.ts` - 34 testes).
     - Matriz de acesso RBAC, redirecionamento forçado e visibilidade de abas (`rbac.test.ts` - 20 testes).
     - Segurança da Edge Function, travas anti-lockout e rollback compensatório (`admin-users-edge.test.ts` - 29 testes).
     - Inviolabilidade do gate de primeiro login e suspensão de carga de dados (`first-login-gate-security.test.ts` - 21 testes).
     - Prevenção de vazamento, auditoria estática zero-PII e marca d'água Excel (`data-leakage-and-sanitization.test.ts` - 18 testes).

## 7. Playbook Operacional para Futuras Manutenções

### 7.1. Comandos de Verificação Obrigatórios antes de Commit/Deploy
```bash
npm run typecheck   # Valida 100% dos tipos TypeScript (tsc --noEmit) sem erros
npm run test:run    # Executa a suíte Vitest do motor contratual (HH, Ciclo, Gangway, USOFF, SLA)
npm run build       # Gera bundle de produção em dist/ com code-splitting do SheetJS (xlsx-vendor)
```

### 7.2. Paginação PostgREST Acima de 1.000 Linhas (`max_rows = 1000`)
- O Supabase PostgREST limita respostas padrão a `1.000` linhas por requisição.
- Como `apontamentos_hh` em uma janela de 45+31 dias pode ultrapassar `5.000` linhas (e `plataformas` pode crescer além de `1.000`), **sempre** utilize o helper paginado por `.range(from, to)` em `src/services/data.service.ts` para buscar tabelas volumosas — nunca faça um `.select('*')` simples assumindo que todas as linhas vieram em uma única página.

### 7.3. Datas sem Drift de Fuso Horário (`America/Sao_Paulo` vs `UTC`)
- Datas operacionais (`YYYY-MM-DD`) **nunca** devem ser parseadas com `new Date('YYYY-MM-DD')` seguido de `.getDate()` em horário local (pois `'YYYY-MM-DD'` é interpretado como `00:00 UTC`, virando `21:00` do dia anterior em `UTC-3`!).
- Utilize exclusivamente os utilitários de `src/utils/date.ts` (construção explícita `new Date(y, m - 1, d, 12, 0, 0)` ao meio-dia local ou aritmética pura de strings ISO).

### 7.4. Como Evoluir o Schema SQL com Segurança
1. Crie uma nova migration numerada em `supabase/migrations/00X_descricao.sql`.
2. Aplique no projeto `fwdvrkfootvublicetim` (`apply_migration`).
3. Toda nova tabela **deve** ter `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` e políticas explícitas `TO authenticated` verificando `public.auth_is_active()` e o escopo (`auth_is_global()` vs `auth_allowed_platforms()`).
4. Regenere `src/types/database.types.ts` via Supabase CLI / MCP `generate_typescript_types`.
5. Rode os Security & Performance Advisors do Supabase para garantir `0` alertas de RLS ou índices faltantes.

---

## 8. Arquitetura de Segurança, Matriz RBAC & Isolamento RLS Multi-Escopo

> **Princípio Fundamental:** A segurança do sistema opera sob o modelo **Zero-Trust**. Nenhuma decisão de autorização de leitura ou gravação de dados sensíveis é delegada unicamente ao frontend. O backend PostgreSQL (RLS), o gateway GoTrue e a Edge Function administrativa aplicam travas criptográficas e relacionais independentes.

### 8.1. Matriz de Papéis (RBAC) & Privilégios de Acesso

| Papel (`role`) | Escopo (`isGlobal`) | Admin (`isAdmin`) | Abas Autorizadas | Acesso à Administração (`pes`, `imp`, `cfg`) | Gestão de Usuários na Edge Function |
| :--- | :---: | :---: | :--- | :---: | :--- |
| **`admin`** | `true` | `true` | Todas as 9 abas + `perfil` | Sim (irrestrito) | Criar/editar todos os papéis, inclusive novos administradores |
| **`gestor`** | `true` | `false` | Todas as 9 abas + `perfil` | Sim (operacional pleno) | Criar/editar `gestor`, `controlador`, `preposto`. **Bloqueado** para criar ou promover `admin` |
| **`controlador`**| `false` | `false` | 7 abas (`ger`, `dia`, `emb`, `jus`, `med`, `us`, `perfil`) | **Não** (redirecionado para `VisaoGeralView`) | **Sem acesso** (403 Forbidden imediato) |
| **`preposto`** | `false` | `false` | 7 abas (`ger`, `dia`, `emb`, `jus`, `med`, `us`, `perfil`) | **Não** (redirecionado para `VisaoGeralView`) | **Sem acesso** (403 Forbidden imediato) |

- **Sanitização de Roteamento de Abas:** Caso um `preposto` ou `controlador` force a troca de URL ou altere o estado para uma aba restrita (`pes`, `imp` ou `cfg`), o componente `App.tsx` e o `Sidebar.tsx` realizam sanitização automática (`sanitizeTab`) e redirecionam o usuário imediatamente para a visão geral (`'ger'`). A seção administrativa da barra lateral é completamente omitida do DOM.
- **Universalidade da Aba `perfil`:** A central `UserSettingsView` está disponível uniformemente para todos os 4 papéis, permitindo a troca de nome de exibição, alternância de tema, densidade, itens por página e redefinição de senha pessoal.

### 8.2. Isolamento RLS das 15 Tabelas Públicas

Todas as 15 tabelas públicas possuem RLS ativo com políticas restritas `TO authenticated`:
1. **Papel `anon` (Não Autenticado):** Possui zero permissões (`SELECT`, `INSERT`, `UPDATE`, `DELETE` rejeitados) em todas as 15 tabelas (`profiles`, `plataformas`, `pessoas`, `pessoa_plataformas`, `pessoa_unidades`, `tecnicos`, `carteira_embarques`, `apontamentos_hh`, `justificativas`, `configuracoes`, `config_usoff_un`, `configuracoes_notificacao`, `fluxo_importacoes`, `sync_heartbeat`, `user_onboarding`). Apenas a RPC pública `ping_health` responde para o healthcheck do GitHub Actions.
2. **Corte Instantâneo de Usuário Desativado (`ativo = false`):** Quando `profiles.ativo` passa para `false`, a função `auth_is_active()` retorna `false` e encerra o acesso a todas as tabelas em **0ms** (sem aguardar expiração de token JWT).
3. **Escopo Local de Plataformas e UNs:**
   - Prepostos e Controladores enxergam linhas em `carteira_embarques` e `apontamentos_hh` **apenas** quando `plataforma_sigla = ANY(auth_allowed_platforms())` ou `unidade_negocio = ANY(auth_allowed_uns())`.
4. **Proteção de Dados Sensíveis da Gestão:**
   - `configuracoes_notificacao`: armazena `emails_resumo` de gerentes e diretores. Prepostos e controladores recebem exatamente **0 linhas**; acesso exclusivo de `admin` e `gestor`.
   - `fluxo_importacoes`: logs de auditoria de pipelines de carga. Acesso restrito a `admin` e `gestor`.
5. **Gating de Justificativas:**
   - Apenas usuários com `auth_can_access_justificativa(matricula, data) = true` podem criar ou editar justificativas (ou seja, o técnico estava previsto ou apontado em plataforma sob gestão do preposto naquela data). Tentativas de adulterar justificativas de plataformas alheias são rejeitadas. Exclusão restrita a perfis globais.
6. **Hardening de Triggers de Banco (Migration `005_security_hardening.sql`):**
   - Funções desenhadas exclusivamente para triggers (`fn_init_user_onboarding`, `fn_justificativas_audit`, `fn_touch_heartbeat`) tiveram suas permissões `EXECUTE` revogadas de `PUBLIC`, `anon` e `authenticated`, impedindo chamadas espúrias via REST PostgREST (`/rpc/...`).

### 8.3. Segurança & Anti-Lockout na Edge Function `admin-users`

A Edge Function `supabase/functions/admin-users/index.ts` roda em ambiente Deno com chave `service_role` protegida no servidor e aplica travas anti-falha:
- **Autenticação Obrigatória:** Rejeita requisições sem header `Authorization` ou com JWT expirado/inválido (`401 Unauthorized`).
- **Validação de Papel do Solicitante:** Solicitantes desativados (`ativo = false`) ou com papel `preposto` / `controlador` são sumariamente rejeitados com `403 Forbidden`.
- **Anti-Elevação de Privilégio:** Um `gestor` não pode criar usuários com papel `admin`, nem promover terceiros para `admin`, nem editar status ou redefinir senha de contas `admin` (`403 Forbidden`). Apenas o papel `admin` pode gerenciar contas com papel de administrador.
- **Trava Anti-Lockout 1 (Auto-Rebaixamento):** Um administrador não pode alterar o próprio papel para `gestor`, `controlador` ou `preposto` (`400 Bad Request`).
- **Trava Anti-Lockout 2 (Auto-Desativação):** Um administrador não pode desativar seu próprio acesso (`ativo: false`) (`400 Bad Request`).
- **Trava Anti-Lockout 3 (Último Administrador Ativo):** Tentativas de desativar ou rebaixar o único Administrador ativo no sistema são bloqueadas no banco (`400 Bad Request`), garantindo que o sistema nunca fique sem governança.
- **Validação de Senha Forte:** Rejeição de senhas provisórias com menos de 8 caracteres.
- **Rollback Compensatório (Anti-Contas Órfãs):** Caso ocorra qualquer falha na persistência SQL pós-GoTrue (ex.: violação de constraint ou falha de conectividade), a Edge Function executa `auth.admin.deleteUser` imediatamente, removendo a credencial do GoTrue e impedindo a proliferação de contas órfãs no Auth.

### 8.4. Inviolabilidade do Gate de Primeiro Login (`FirstLoginGate`)

- Quando `user_onboarding.primeiro_login = true` ou `user_onboarding.obriga_troca_senha = true`, o usuário é contido no `FirstLoginGate`:
  - O `AppShell`, sidebar, rotas operacionais e modais operacionais permanecem totalmente **desmontados**.
  - O carregamento de dataset (`reloadDataset`) é **suspenso**, garantindo que nenhum dado contratual seja transferido para o cliente antes da redefinição de senha.
  - O listener Realtime permanece inativo enquanto o gate estiver presente.
  - O usuário não pode fechar o gate via teclado (Escape), navegação ou recarga de página: as únicas opções são redefinir a senha com êxito ou efetuar logout.
  - Regras de senha aplicadas: mínimo de 8 caracteres, mescla de letras e números, confirmação idêntica e proibição de reuso da senha provisória.
  - Após validação, a RPC atômica `complete_first_login_password_change` registra o timestamp de alteração (`senha_trocada_em`) e atualiza as flags no PostgreSQL. O desbloqueio só ocorre após a confirmação no banco de dados.

### 8.5. Prevenção de Vazamento de Dados & Sanitização Universal

- **Auditoria Estática Contínua:** Zero chaves `service_role`, zero chaves privadas PEM/RSA, zero tokens de nuvem mestres e zero CPFs/dados pessoais reais versionados no código-fonte.
- **Sanitização de Transbordo:** A RPC `get_external_covered_days` retorna exclusivamente chaves `(matricula, data)`, sem qualquer metadado de plataformas externas. O motor suprime falsos alertas de ausência sem vazar informações contextuais.
- **Carimbo de Escopo Parcial em Planilhas Excel:** Exportações geradas por usuários de escopo restrito (`preposto` e `controlador`) recebem compulsoriamente a marca d'água `[ESCOPO PARCIAL DE CARTEIRA - ...]` nos cabeçalhos e a tag `[PARCIAL - ...]` nos nomes dos arquivos, impedindo que dados locais sejam manipulados ou apresentados como totais contratuais.
- **Sanitização RFC 3986 em Deeplinks de Comunicação:** Os geradores de link para Outlook e e-mail padrão (`buildMailLinks`) aplicam codificação estrita em assuntos e corpos de mensagem, neutralizando ataques de CRLF Header Injection (`\r\n`), injeção de parâmetros de query e scripts maliciosos.

### 8.6. Auditoria de Segurança & Hardening no Supabase de Produção (`fwdvrkfootvublicetim`)

Em complemento aos testes em ambiente mock de desenvolvimento, realizou-se a auditoria e validação de segurança diretamente na instância de produção do Supabase:

1. **Varredura com Supabase Security Advisors:**
   - Executada inspeção automatizada (`get_advisors`) sobre o banco de dados `fwdvrkfootvublicetim`.
   - **Diagnóstico das Funções `SECURITY DEFINER`:** 10 alertas relativos a funções executáveis pelo papel `authenticated`. Todas as 10 funções foram auditadas: possuem obrigatoriamente `SET search_path = public` imutável, validação de `auth.uid()` e corte estrito via `auth_is_active()`.
     - 6 funções são helpers internos do RLS (`auth_is_active`, `auth_is_global`, `auth_is_admin`, `auth_allowed_platforms`, `auth_allowed_uns`, `auth_can_access_justificativa`).
     - 4 funções são RPCs negociais intencionais (`get_watermark_status`, `get_external_covered_days`, `complete_first_login_password_change`, `touch_sync_heartbeat`).
     - Triggers internos tiveram permissões `EXECUTE` revogadas de `PUBLIC` (Migration `005`).

2. **Auditoria de Row Level Security (RLS) nas 15 Tabelas Públicas:**
   - Consulta direta ao catálogo `pg_tables` confirmou que **100% das 15 tabelas públicas** possuem `rowsecurity = true`:
     `apontamentos_hh`, `carteira_embarques`, `config_usoff_un`, `configuracoes`, `configuracoes_notificacao`, `fluxo_importacoes`, `justificativas`, `pessoa_plataformas`, `pessoa_unidades`, `pessoas`, `plataformas`, `profiles`, `sync_heartbeat`, `tecnicos`, `user_onboarding`.

3. **Hardening de Privilégios DML do Papel `anon` (Migration `006_revoke_anon_table_privileges.sql`):**
   - No modelo padrão do Supabase, o papel `anon` possui permissões SQL DML (`SELECT`, `INSERT`, etc.) concedidas por padrão, dependendo exclusivamente das políticas RLS para retornar 0 linhas.
   - Para aplicar **Defesa em Profundidade (Defense-in-Depth)** física, executou-se e registrou-se a migration `006`:
     ```sql
     REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
     REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
     ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
     ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
     ```
   - Verificação pós-execução via `information_schema.role_table_grants`: o número de permissões concedidas a `anon` caiu de 105 para **exatamente 0**. Qualquer requisição anônima tentando tocar tabelas é barrada imediatamente na camada de privilégios (`insufficient_privilege`), antes mesmo de alcançar a árvore de avaliação de políticas RLS.
   - A função RPC `ping_health()` (rotina para o keepalive do GitHub Actions) permaneceu acessível para `anon` por ser uma rotina independente de tabelas.

4. **Testes Transacionais ao Vivo no PostgreSQL (Emulação de Roles via `SET LOCAL ROLE`):**
   - **Anon Leak Test:** Sob `SET LOCAL ROLE anon`, `SELECT * FROM profiles` retornou `0` registros e `INSERT` em `profiles` foi rejeitado.
   - **Inactive Account Test:** Criado temporariamente usuário com `ativo = false` em `auth.users` e `profiles`. Sob `SET LOCAL ROLE authenticated` com `auth.uid()` apontando para o usuário inativo:
     - `auth_is_active()` retornou `false`.
     - Queries em `carteira_embarques` e `apontamentos_hh` retornaram `0` registros. Registros de teste foram devidamente removidos.
   - **Preposto Scope Test:** Criado usuário temporário com papel `preposto`. Acesso a `configuracoes_notificacao` (e-mails executivos) e `fluxo_importacoes` (auditoria) retornou `0` registros.
   - **Justificativa Gate Test:** Criado preposto alocado apenas à plataforma `P50`. `auth_can_access_justificativa` retornou `true` para técnico na `P50` e `false` para técnico na `P25`.
   - **Keepalive Healthcheck Test:** Sob `SET LOCAL ROLE anon`, chamada `SELECT ping_health()` retornou `ok` com sucesso.

5. **Auditoria da Edge Function `admin-users` em Produção:**
   - Inspecionada via API do Supabase: estado `ACTIVE`, versão 2, e verificação de JWT do Gateway ativa (`verify_jwt: true`), assegurando que chamadas sem assinatura criptográfica válida nunca atingem o runtime Deno.


