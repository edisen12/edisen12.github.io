# Decisões — Regras de Negócio e Arquitetura

> Registro vivo. Toda regra de negócio ou mudança de arquitetura definida pelo usuário no chat entra aqui **imediatamente**, com data.
> Invariante absoluto: nenhuma refatoração pode alterar o resultado numérico das regras de §1 em relação ao motor legado. Qualquer mudança em `src/domain/` exige `npm run test:run` verde.

## 1. Regras de Negócio (domínio)

### 1.1 Parâmetros contratuais (`configuracoes`, id `'geral'`; defaults em `src/config/constants.ts → DEFAULT_CONFIG`)
- `hh_dia = 11` h disponíveis por dia embarcado · `meta_percentual = 100` · `atencao_percentual = 90` · `dias_embarque = 14` · `dia_corte_medicao = 21` · `prazo_justificativa_dias = 2` · `med_criterio = 'enc'` · `us_pe_padrao` / `us_ex_padrao = null`.

### 1.2 Ciclo de medição (`periods.ts → periodOf(ym, diaCorte)`)
- `dia_corte_medicao` ∈ {1, 16, 21, 26} é o **dia de corte da medição mensal**, NÃO é escala de trabalho.
- Corte 1 → mês civil inteiro. Corte C → do dia C do mês anterior até o dia C−1 do mês de referência (ex.: corte 21, `2026-06` = `2026-05-21` a `2026-06-20`).

### 1.3 Critério de inclusão (`med_criterio`)
- `'enc'` (padrão): entram só os embarques com `data_fim ∈ [P.ini, P.fim]`, e **todos os dias** desse embarque contam (inclusive os anteriores a `P.ini`). Quem continua a bordo passa para a medição seguinte.
- `'dias'`: só os dias com `data ∈ [P.ini, P.fim]`.
- Consequência na query: o banco sempre é consultado de `addDays(P.ini, -45)` até `P.fim` (lookback de 45 dias).

### 1.4 Resolução diária e "Não chegou" (`sem: true`)
- `LAST` = maior data de HH do contrato inteiro (RPC `get_watermark_status()`, visível até para escopo restrito).
- Se há apontamento: `d = hh_dia`, `e = horas_executadas`.
- Se não há apontamento, o técnico está previsto na carteira em D, `D ≤ LAST` e `(mat, D)` ∉ `externalCoveredSet` → gera `sem = true`: `d = 11`, `e = 0`, status `'bad'`, justificativa obrigatória.
- `justificativas` tem `UNIQUE(matricula, data)` e **nenhuma FK** para `apontamentos_hh` (porque justifica dias sem apontamento).

### 1.5 Transbordo entre carteiras (`externalCoveredSet`)
- RPC `get_external_covered_days(p_ini, p_fim)` devolve só os pares `(matricula, data)` em que o técnico da carteira visível apontou em plataforma fora do escopo. Isso evita um "Não chegou" falso sem vazar sigla, UN nem horas da outra carteira.

### 1.6 Gangway desconectada
- `horas_gangway` só conta se `motivo === 'Gangway desconectada'`, limitado a `[0, d]`.
- `p = e/d` · `pAj = e/(d − gw)` se `d − gw > 0`, senão `null`.
- Semáforo `statusOf`: `≥ meta` → `ok` · `≥ atenção` → `warn` · abaixo → `bad`.

### 1.7 USOFF (`usoff.ts`)
- Agrupa por `operacao` (OP) normalizada. Sem OP → `EMB:<id>`. Apontamento sem carteira → `SEMOP:<...>` (tipo "Sem programação").
- `HP` = `horas_programadas` se > 0 (fonte "informada"), senão `dias × hh_dia`. `hpAte` = parcela proporcional até `LAST`.
- Pesos em cascata: linha da carteira (`pe`, `ex`) → `config_usoff_un[un]` → global (`us_pe_padrao`, `us_ex_padrao`).
- **Regra dos 12 dias no USOFF:**
  - `Carteira` (programação com $\ge 12$ dias de antecedência): utiliza a ponderação de Programação ($PE \times HP_{carteira}$) e de Execução ($EX \times HC$).
  - `Fora da carteira` (programação inserida com $< 12$ dias de antecedência ou durante o embarque): utiliza **APENAS** a ponderação da Execução ($EX \times HC$). A parcela de programação **não pontua** ($PE \times 0$).
  - Portanto: $US_{off} = (PE \times HP_{carteira}) + (EX \times HC)$. Se `hh_carteira` não for informado (base legada), recai de forma retrocompatível para $HP$ total.
- **Trava `falta`:** se algum item não tem PE e EX, o total exibe `—` (`null`). Nunca mostra soma parcial.
- `get_shared_ops(p_ops)` sinaliza OPs que também existem fora da carteira, e só para OPs que o usuário de fato possui (anti-oráculo, migration 008).

### 1.8 SLA de justificativas
- Todo dia com `e < d` (inclusive `sem`) exige justificativa. `vencimento = D + prazo_justificativa_dias`.
- Não justificado e `LAST > vencimento` → **Vencida**. Justificado → compara `criado_em` com o vencimento (no prazo / fora do prazo) e calcula o tempo médio de resposta.
- `criado_por` e `criado_em` são forçados pelo trigger (`auth.uid()`, `now()`) e imutáveis (migration 007). O frontend não pode forjar autoria nem SLA.

### 1.9 Catálogos fixos (`constants.ts`)
- 10 motivos de justificativa (`MOTIVOS_JUSTIFICATIVA`; "Gangway desconectada" é o único que ativa o abatimento).
- Situações de plataforma: Mobilizada, Mobilizando, Desmobilizando, Desmobilizada.
- Importação de HH/carteira com sigla desconhecida → cria a plataforma automaticamente com `cadastro_pendente = true`.

### 1.10 Sanitização Canônica de Plataformas e Aliases (`sanitizePlatformCode`, `PLATFORM_ALIASES`)
- Aliases conhecidos do Portal Offshore e SAP são normalizados de forma determinística antes de qualquer busca ou gravação no banco:
  - `PMXL1`, `PMXL` → `MXL` (Mexilhão, Bacia de Santos UN-BS).
  - `PMLZ1`, `PMLZ` → `MLZ` (Merluza, Bacia de Santos UN-BS).
  - `PMNT1` → `PMNT` (Plataforma de Manati, Bahia UN-BA).
  - `PAG-02`, `PAG02` → `PAG2` (PAG 2, GAD Nordeste); também `PAG-01` → `PAG1`, `PAG-03` → `PAG3`.
  - `PCR-01`, `PCR01` → `PCR1` (PCR 1, GAD Nordeste).
  - `PCM-9`, `PCM-09` → `PCM9` (GAD Nordeste).
  - `PPE-1A`, `PPE-01A` → `PPE1A` (Bahia UN-BA).
  - `PRA-1`, `PRA-01` → `PRA1` (Espírito Santo UN-ES).
  - Padrão Petrobras `P-XX` → `PXX` (ex.: `P-09` → `P09`, `P-18` → `P18`, `P-25` → `P25`, etc.).
- Gatilho defensivo no banco: trigger PL/pgSQL `trg_sanitize_carteira_plataforma` em `carteira_operacoes` auto-corrige siglas e injeta a UN canônica automaticamente.

### 1.11 Regra de Armador / Diária e Desconsideração de "Não Chegou" (`isArmadorDiariaSemProg`)
- Contratos de embarcações de **Armador** (`un === 'Armador'`, `tipo` afretado/AHTS, `armador !== ''`, `un === 'FPSOs afretados'` ou demais UMS afretadas) são medidos por **diária**.
- Quando tanto a programação (`horas_programadas == null || horas_programadas === 0`) quanto a execução (`horas_executadas == null || horas_executadas === 0` / sem apontamento) forem nulas ou em branco:
  - O dia/embarque **NÃO ENTRA na métrica de apontamento negativo / "Não chegou"** (`sem: true`).
  - `resolveRecord` retorna `null` para essas datas, evitando débito de saldo negativo de -11h, marcação de status `'bad'` (vermelho) e cobrança indevida de justificativas.
  - No acumulado da carteira, `calcCarteiraHP` retorna 0h e o rótulo de fonte exibe `'Diária (Armador)'`.
- **Exceção de UMS por HH do Armador (`UMS_HH_ARMADOR_SIGLAS`):**
  - Apenas **`UMAR`**, **`UMCP`** e **`UMPA`** são medidas por HH do armador (possuem programação de carteira).
  - As demais UMS (ex.: `UMAC`, `UMGR`, `UMLI`, `UMMA`, `UMPC`, `UMPT`, `UMTJ`, `UMVT`, `UMVV`, etc.) operam por **diária** por não possuírem carteira programada, recebendo a isenção de "Não chegou" quando sem programação.

## 2. RBAC e Escopo

| Papel | Escopo | Abas | Escrita |
|---|---|---|---|
| `admin` | global | todas (`ger dia emb jus med us pes imp cfg adm perfil`) | total + Edge Function (gerencia inclusive admins) |
| `gestor` | global | todas | operacional total; Edge Function **sem** criar, promover, editar ou excluir `admin` |
| `controlador` / `preposto` | carteira = `pessoa_plataformas` ∪ plataformas de `pessoa_unidades` | `ger dia emb jus med us perfil` | só `INSERT`/`UPDATE` em `justificativas` da própria carteira (`auth_can_access_justificativa`) |
| `anon` | nada | só `LoginView` | zero (só RPC `ping_health`) |
| `ativo = false` | corte imediato (0 ms) via `auth_is_active()` | logout | zero |

- Abas globais forçadas por não-global caem em `VisaoGeralView` (`ActiveTabRouter` em `App.tsx`); a Sidebar omite a seção ADM.
- Exportação `.xlsx` de escopo restrito → marca `ESCOPO PARCIAL` no cabeçalho e `[PARCIAL - ...]` no nome do arquivo.
- `configuracoes_notificacao`, `fluxo_importacoes` e `system_audit_logs`: só leitura global (admin/gestor).
- **Anti-lockout (Edge Function):** ninguém se auto-rebaixa, se auto-desativa ou se auto-exclui; não é possível desativar, rebaixar ou excluir o último admin ativo; senha provisória ≥ 8; rollback (`deleteUser`) se o SQL falhar depois do GoTrue.
- **Primeiro login:** se `primeiro_login` ou `obriga_troca_senha` for true → só `FirstLoginGate` (sem AppShell, sem dataset, sem Realtime). Nova senha: ≥ 8 caracteres, letras + números, diferente da provisória. Conclusão via RPC `complete_first_login_password_change` (`SECURITY DEFINER`, migration 010). As flags são protegidas contra alteração por DML direto via trigger anti-bypass (`trg_prevent_user_onboarding_flag_bypass`) e política RLS limpa sem recursão (migration 010).

## 3. Decisões Arquiteturais

| Decisão | Motivo técnico |
|---|---|
| SPA estática no GitHub Pages + Supabase | Custo $0; o backend dinâmico fica todo no Supabase |
| Segurança 100% no banco (RLS `TO authenticated` + funções `SECURITY DEFINER STABLE SET search_path = public`) | O frontend é público; a anon key é pública por design. `anon` com 0 grants (migration 006) |
| Anon key com fallback hardcoded em `supabase.config.ts` e nos workflows | Intencional na topologia `baas`: é pública e o RLS protege os dados (isolada fora de `env.ts` para ser 100% removida por tree-shaking em builds `self-hosted`). Override por `VITE_SUPABASE_*` |
| Gestão de usuários pela Edge Function `admin-users` (`verify_jwt: true`, service_role só no servidor) | Evita depender de e-mail (limite de 3 e-mails/h no SMTP free e problemas com SafeLinks corporativo). Contas criadas com `email_confirm: true` |
| Realtime **só** em `justificativas` + `sync_heartbeat` (debounce de 450 ms) | Cota free. Importação em lote toca o heartbeat 1× (`FOR EACH STATEMENT`), e o cliente faz 1 re-fetch HTTP |
| Ingestão por batch UPSERT em chunks de 500, ordenados por chave natural | Evita timeouts e deadlocks `40P01` |
| Leitura paginada de 1000 em 1000 (`fetchAllPages` + `.range`) | Limite `max_rows` do PostgREST |
| `xlsx` só por `await import('xlsx')` (chunk `xlsx-vendor`) | Bundle inicial leve (< 50 KB gz) |
| Chunks manuais: `xlsx-vendor`, `supabase-vendor`, `ui-vendor` | Cache de longo prazo no CDN |
| Sem roteador de URL: aba = estado (`TabId`) persistido em `sessionStorage`/`localStorage` | Dispensa o fallback de SPA (`404.html`) no Pages. Não adicionar `react-router` sem decisão do usuário |
| Estado global único em `AppContext` (sem Redux/Zustand) + `ToastContext` | Escopo do app cabe num provider; modais globais (justificativa, ficha, e-mail) controlados por ele |
| `base: './'` no Vite | Funciona em subdiretório e na raiz do Pages |
| Auditoria WORM (`system_audit_logs`): sem UPDATE/DELETE para nenhuma role + trigger que lança `P0001` | Conformidade forense. Triggers automáticos em `configuracoes`, `pessoas`, `plataformas`, `profiles(role, ativo)`; RPC `log_system_event` para eventos do app |
| Modo demonstração automático quando não há HH, carteira nem watermark | Onboarding de banco vazio; `dataset.isDemo = true` |
| Testes 100% offline com `mockSupabase` | Nunca tocar produção a partir dos testes |
| Keepalive por cron do GitHub Actions chamando `ping_health` | Impede a pausa de 7 dias do Supabase free |
| Preferências do usuário em `localStorage` (`hhoff_prefs`) + banco (`user_onboarding.preferencias` via `update_own_profile`, máx. 32 KB, nome ≤ 120) | Aplicação instantânea + roaming entre dispositivos |
| Abstração de Persistência Dual-Topology com Registry Aberto (`VITE_TOPOLOGY = 'baas' \| 'self-hosted'`) | **Topologia `baas`:** SPA estática (GitHub Pages) + registry aberto `BaaSConnectorPort` (`VITE_BAAS_PROVIDER`, default `supabase`) sobre pipeline compartilhado (`SharedClientPipeline`); proíbe bancos puros sem backend. **Topologia `self-hosted`:** obrigatória para bancos puros (VPS + Docker Compose: Nginx + Backend `server/` + Banco em rede interna isolada); sessão stateful via Cookie `HttpOnly; Secure; SameSite=Strict` + CSRF, zero tokens/chaves/BaaS no bundle `dist/`, e `UniversalStorageDriverPort` (7 primitivas + drivers genéricos SQL/Document + registry aberto) para aceitar qualquer banco de dados a qualquer momento |
| Design Responsivo Multi-Tela + PWA Instalável (WebAPK / Add to Home Screen) | Adaptação integral de layout para smartphones (`320px`–`480px`), tablets (`768px`–`1024px`), notebooks HD (`1366×768`) e ultrawide (`≥ 1560px`), preservando o shell `100dvh` e adicionando áreas seguras (`safe-area-inset`). Suporte nativo a PWA (`manifest.webmanifest`, ícones quadrados `180`/`192`/`512`/maskable, `sw.js` estritamente para assets estáticos sem cachear endpoints de dados/auth/PII, captura de `beforeinstallprompt` no Android/Desktop e guia passo a passo de instalação para iOS Safari) permitindo instalação direta no celular sem APK |

## 4. Log de Decisões do Usuário (cronológico)

- **2026-11-01** — Memória do projeto será nativa em Markdown (`.agent/memory/`), sem MCP externo e sem alterar a config global. Protocolo em `.agent/rules/memory-protocol.md`, com espelho em `AGENTS.md`.
- **2026-11-01** — GSD removido do sistema; não usar mais o fluxo `.planning/`.
- **2026-11-01** — Abstração de banco de dados deve operar em duas topologias mutuamente exclusivas com travas de build/segurança: (1) `baas` para hospedagem estática (GitHub Pages) aceitando qualquer BaaS via abstração aberta (não restrita a Supabase/Firebase); e (2) `self-hosted` obrigando servidor frontend + backend privado + banco em VPS/Docker (sem chaves ou tokens expostos no navegador, usando sessão Cookie `HttpOnly` + CSRF) e abstração server-side aberta capaz de aceitar qualquer banco de dados puro (SQL ou NoSQL) sem lista fixa de 3 drivers.
- **2026-11-03** — Correção de recursão infinita RLS em `user_onboarding` (Migration 010): eliminada subquery recursiva em `WITH CHECK` de `user_onboarding_update_policy`, promovida a RPC `complete_first_login_password_change` para `SECURITY DEFINER` e implementada trigger PL/pgSQL anti-tamper para travar DML não autorizado de `primeiro_login`/`obriga_troca_senha` sem recursão de RLS.
- **2026-11-03** — Ciclo de vida de exclusão de pessoas e credenciais: ao excluir uma pessoa (`deletePessoa`), o sistema remove automaticamente as credenciais associadas em `auth.users`, `profiles` e `user_onboarding` via `delete-user` (Edge Function / Server), evitando contas órfãs. Salvaguardas anti-lockout continuam ativas (bloqueando a exclusão se for o próprio usuário ou o último admin ativo). Adicionado também botão de exclusão pontual de credenciais no modal de login da pessoa (`UserLoginModal`). Extração de erro aprimorada no conector para desserializar respostas de erro de Edge Function em vez de exibir mensagem genérica de status HTTP.
- **2026-11-03** — Estrutura de Carteira Granular e Cenário B de Programação (Migration 011): Adoção do modelo de operações detalhadas (`carteira_operacoes`) com chave natural `(matricula, data_inicio, ordem, operacao)`. Mantém rastreabilidade total de Ordens, Operações, HH Programado e status (`Carteira`, `Fora da carteira`, `Cancelada`).
- **2026-11-03** — Substituição de Ordens por `id_embarque` na Carteira de Embarques (Migration 012): Inclusão da coluna `id_embarque text NOT NULL DEFAULT ''` na tabela `carteira_embarques` (com índice `idx_carteira_id_embarque`), mapeando diretamente o identificador único do embarque do Portal Offshore (`portal_id`).
- **2026-11-03** — Regra dos 12 Dias, HH Programado Total e Higienização de `operacao` (Migration 013):
  - `horas_programadas` em `carteira_embarques` consolida `Carteira` + `Fora da carteira`. Canceladas ficam segregadas em `hh_cancelado`.
- **2026-11-04** — Reconciliação Contínua e Ingestão Autônoma de Carteira e SAP (Migration 014 + Pipeline):
  - Ingestão de confirmações do SAP e carteira do Portal Offshore em qualquer ordem dispara automaticamente `reconciliar_confirmacoes_sap()`.
  - A conciliação gera apontamentos diários agrupados em `apontamentos_hh` por `(matricula, data_fim_real)`, atualiza a marca d'água `ultima_data_hh` e alimenta todas as visões (Geral, Dia, Embarque, Justificativas e USOFF) com zero intervenção manual.
  - Reconhecimento automático de colunas do Portal Offshore (`ID`, `Unidade`, `Ordem`, `Operação`, `Status Programação`, etc.) direto no Card 2 de importação.
  1. *Regra dos 12 dias:* Atividades planejadas com $\ge 12$ dias de antecedência do embarque são `'Carteira'`. Atividades planejadas com $< 12$ dias ou durante o embarque são `'Fora da carteira'`. Ambas representam trabalho programado real a ser cumprido pelo técnico; portanto, o somatório de `horas_programadas` do embarque físico em `carteira_embarques` consolida `Carteira` + `Fora da carteira`. Atividades com status `'Cancelada'` são mantidas na base para visibilidade e auditoria, mas são excluídas da soma de `horas_programadas`.
  2. *Colunas granulares na consolidação:* Adicionadas colunas `hh_carteira`, `hh_fora_carteira` e `hh_cancelado` em `carteira_embarques`.
  3. *Eliminação de redundância:* Coluna `operacao` descartada fisicamente de `carteira_embarques` em favor do `id_embarque`.
  4. *De-Para e Padronização da Visão Embarque Atual:* Remoção da métrica calculada "Programado até agora" da tabela acumulada; cabeçalhos padronizados para `HH programado`, `HH disponível`, `HH executado`, `% Exec. / Disponível` (meta diária) e `% Exec. / Programado` (avanço físico real sobre a programação total). Justificativas diárias de 11h permanecem focadas no Painel do Dia (`PainelDiaView`).
- **2026-11-04** — Confirmações do SAP, Tolerância do PMB, Estornos Retroativos e Reconciliação (Migration 014):
  1. *Tabela `confirmacoes_sap`:* Armazena o extrato completo de confirmações do SAP com chave única `(matricula, data_criacao, data_lancamento, data_fim_real, ordem, operacao, horas_confirmadas)`.
  2. *Motor de Reconciliação em Cascata (`reconciliar_confirmacoes_sap`):*
     - Prioridade 1: Ordem/Operação com `data_fim_real` exatamente dentro da janela física do embarque `[data_inicio, data_fim]`.
     - Prioridade 2: Ordem/Operação com `data_lancamento` dentro da tolerância de até +4 dias após `data_fim` (janela padrão de ajuste do PMB).
     - Prioridade 3: Se a Ordem/Operação pertence a um único embarque histórico daquele técnico, vincula diretamente mesmo se o estorno/reversão ocorreu no mês seguinte (`data_criacao` tardia, com `data_lancamento` e `data_fim_real` retroativos).
     - Prioridades 4 e 5: Lançamentos sem ordem prévia em carteira vinculados ao embarque pela presença a bordo (`data_fim_real` ou `data_lancamento`).
  3. *Regra de Confronto e Divergência de Horas:*
     - Compara `hh_confirmado` (Portal Offshore) vs `SUM(horas_confirmadas)` do SAP agrupado por `(matricula, ordem, operacao, id_embarque)`.
     - Divergência: `hh_confirmado - hh_confirmado_sap`.
     - Status classificados: `'OK'` (100% igual), `'Divergente (Portal > SAP)'`, `'Divergente (SAP > Portal)'`, `'Não Apontado no SAP'` (confirmado no Portal mas 0h no SAP), `'Não Confirmado no Portal'` (apontado no SAP mas 0h no Portal), `'Não Confirmado'` (0h em ambos).
  4. *Visualização Integrada no Frontend:* Aba "Confronto SAP vs Portal" dentro de `MedicaoUsoffView.tsx` com filtros de status, KPIs de divergência, grid com destaques coloridos de divergência e exportador Excel dedicado (`exportConfrontoSAPXlsx`). Upload de extrato do SAP adicionado como Card 5 na tela de `ImportarDadosView.tsx`.


- **2026-11-05** — Sincronização em Tempo Real de Configurações e Diretório Mestre (Migration 015):
  - Criadas triggers `AFTER INSERT OR UPDATE OR DELETE` em `configuracoes`, `config_usoff_un`, `plataformas` e `pessoas` executando `fn_touch_heartbeat()`.
  - Qualquer alteração cadastral ou contratual feita por qualquer usuário pulsa o canal `sync_heartbeat`, sincronizando abas e navegadores abertos sem necessidade de F5 manual.
- **2026-11-05** — UX e Robustez na Importação de Dados (`ImportarDadosView.tsx` / `excel.service.ts`):
  - Detecção heurística (`guessImportKind`) expandida para mapear com precisão cabeçalhos do Portal Offshore (`Início`, `Fim`, `Ordem`, `Operação`, `HH Programado`, `Status Programação`) sem falsos positivos em `hh`.
  - Inclusão de botão proeminente "Gravar no Banco de Dados" no topo da seção de prévia com rolagem suave automática (`scrollIntoView`) ao carregar o arquivo.
  - Alerta explícito no painel caso 0 linhas sejam lidas e toast informativo orientando o clique em gravação.
- **2026-11-05** — Correção de Trigger de Carteira e Alinhamento de Colunas (Migration 016):
  - Corrigida a função PL/pgSQL `sync_carteira_embarques_from_operacoes()` em `carteira_operacoes` para agrupar estritamente por `(matricula, data_inicio)` com agregação `MAX` para `portal_id`, `plataforma_sigla` e `unidade_negocio`, eliminando o erro SQL `21000: ON CONFLICT DO UPDATE command cannot affect row a second time` na importação de carteira do Portal Offshore.
  - No client-pipeline, o payload de `carteira_embarques` foi blindado para nunca transmitir coluna redundante `operacao` ao Supabase (removida fisicamente na Migration 013).
  - Na tela de importação, o campo de operação foi clarificado como `Operação (cruzamento SAP)` para evidenciar seu papel de relacionamento com as confirmações do SAP.
- **2026-11-05** — Reset de Confirmações SAP e Inclusão de `contador_confirmacao` (Migration 017):
  - Base `confirmacoes_sap` resetada (truncada) e indicadores de conciliação zerados em `carteira_operacoes` e `carteira_embarques` a pedido do usuário para nova ingestão limpa.
  - Adicionada a coluna `contador_confirmacao bigint NOT NULL DEFAULT 0` na tabela `confirmacoes_sap`.
  - Tratamento numérico adotado como padrão arquitetural (`bigint` no banco, `parseCounter` no frontend): elimina qualquer divergência de zeros à esquerda (`'00000001'` vs `'1'`) e resolve o cenário de múltiplos lançamentos de mesma quantidade de horas para o mesmo técnico/ordem/operação no mesmo dia (ex.: 3h pela manhã e 3h à tarde).
  - Atualizada a chave de unicidade para `(matricula, data_criacao, data_lancamento, data_fim_real, ordem, operacao, horas_confirmadas, contador_confirmacao)`.
- **2026-11-05** — Unificação de `id_embarque`, Correção de Serial Excel e Visibilidade Total (Migration 018):
  - *Diagnóstico do Bug do SheetJS:* A flag `cellDates: true` convertia identificadores numéricos inteiros do Portal Offshore na faixa de 40.000–70.000 (ex.: `55104`, `56299`) em objetos JavaScript `Date`. A serialização `String(date)` gravava strings de data GMT completas no banco. Como a função SQL agregava via `MAX()`, o texto `'Tue...'` vencia alfabeticamente os dígitos numéricos, corrompendo o `id_embarque`.
  - *Unificação de Schema:* Adicionada a coluna física `id_embarque text NOT NULL DEFAULT ''` na tabela `carteira_operacoes` (com índice dedicado), mantendo sincronia bidirecional com `portal_id`.
  - *Trigger de Self-Healing:* Criada trigger PL/pgSQL `trg_normalize_carteira_operacoes_ids` que converte strings GMT residuais de volta para inteiros seriais do Excel e espelha `id_embarque` e `portal_id`.
  - *Utilitário `parseIdEmbarque`:* Implementado em `src/utils/format.ts` para recuperação determinística tanto de objetos `Date` quanto de strings de data.
  - *Exibição e Rastreabilidade na UI:* Adicionada coluna destacada `"ID Embarque"` em `EmbarqueAtualView.tsx` (com badge e busca integrada) e no Confronto SAP em `MedicaoUsoffView.tsx`.
  - *Gestão e Substituição de Carteira:* Criada RPC `reset_carteira_embarques()` permitindo aos administradores e gestores substituir a carteira anterior durante a importação (limpando embarques legados de testes passados para manter a contagem 1-para-1 com a planilha original).
- **2026-11-05** — Correção de SafeUpdate na RPC `reset_carteira_embarques` (Migration 019):
  - *Diagnóstico do Erro no Supabase:* Ao acionar a opção "Substituir carteira anterior", a chamada retornava HTTP 400 com a mensagem `"UPDATE requires a WHERE clause"`. O Supabase ativa a extensão PostgreSQL `safeupdate` para sessões de API, exigindo cláusula `WHERE` explícita em todos os comandos `UPDATE` e `DELETE`.
  - *Correção Aplicada:* Migration 019 atualizou a RPC `reset_carteira_embarques()` para utilizar `DELETE ... WHERE id IS NOT NULL` e `UPDATE confirmacoes_sap SET id_embarque = '', status_reconciliacao = 'Pendente' WHERE id_embarque <> '' OR status_reconciliacao <> 'Pendente'`, eliminando o erro 400 e permitindo o reset limpo imediato da carteira.
  - *Execução de Reset:* A base de carteira foi resetada no banco para receber limpos os 147 embarques do período de medição atual informados pelo usuário.
- **2026-11-05** — Sanitização Canônica de Plataformas e Regra de Diária / Armador (Migration 020):
  - *Sanitização de Plataformas:* Implementado `sanitizePlatformCode` e `PLATFORM_ALIASES` em `src/utils/format.ts` para normalizar automaticamente variações de siglas do Portal Offshore e SAP (`PMXL1`/`PMXL` -> `MXL`, `PMLZ1` -> `MLZ`, `PMNT1` -> `PMNT`, `PAG-02` -> `PAG2`, `PCR-01` -> `PCR1`, `PCM-9` -> `PCM9`, etc.) e zeros à esquerda. Integrado em `lookupPlatform`, `buildPlatformIndex` e pipelines de ingestão de carteira e HH.
  - *Limpeza e Self-Healing no Banco (Migration 020):* Excluídas as plataformas pendentes duplicadas criadas por falta de matching (`PMXL`, `PMLZ1`, `PMNT1`, `PAG-02`, `PCR-01`), saneados os apontamentos de HH legados para as siglas canônicas, e criada a trigger PL/pgSQL `trg_sanitize_carteira_plataforma` em `carteira_operacoes` garantindo normalização determinística no banco. Plataforma `HFAB` vinculada à UN `Armador`.
  - *Regra de Negócio de Armador / Diária (`isArmadorDiariaSemProg`):* Embarcações de Armador medidas por diária com programação e execução nulas ou em branco são desconsideradas da métrica de apontamento negativo ("Não chegou"), suprimindo o saldo falso de -11h e o status `'bad'`.
  - *Exceção Operacional UMS:* A frota de UMS (`UMPA`, `UMCP`, `UMAC`, `UMMA`, etc.) possui programação operacional e foi expressamente mantida fora do escopo de isenção, sendo cobrada normalmente caso não aponte horas.
- **2026-11-05** — Refinamento de UMS do Armador (HH vs Diária):
  - Definido pelo usuário que apenas **`UMAR`**, **`UMCP`** e **`UMPA`** são medidas por HH de Armador.
  - Todas as demais UMS operam por **diária** por não possuírem carteira programada, recebendo a isenção de apontamento negativo ("Não chegou") quando a programação for nula ou zero.
- **2026-11-05** — Visibilidade e Confronto de Ordens do SAP fora da Carteira do Portal Offshore:
  - *Diagnóstico da divergência:* No Portal Offshore, a programação cadastrada pode conter poucas horas ou uma única ordem (ex.: 4h), enquanto no SAP o técnico confirmou 10 a 11 horas diariamente em dezenas de ordens executadas a bordo que nunca foram cadastradas no planejamento do Portal Offshore.
  - *Ingestão e Indexação Client-Side:* Inclusão de `confirmacoesSap` no `AppDataset` para registros vinculados a embarques (`id_embarque <> ''`). Indexador `buildSapIndex` (`byTechDate`, `byEmbarkation`, `byTech`) para resolução instantânea em O(1).
  - *Painel do Dia (`PainelDiaView`):* Identificação na coluna Executado com botão de ordens e alerta `⚠️` para ordens não cadastradas no Portal; modal completo de detalhamento diário discriminando situação no Portal (`Cadastrada no Portal` vs `Não Cadastrada no Portal`); novo botão de exportação `Exportar Apontamentos do Dia (Excel)`.
  - *Ficha do Técnico (`FichaTecnicoDrawer`):* Histórico diário expansível com detalhamento de ordens do SAP por dia e badges de situação no Portal; exportador do técnico (`exportTecnicoXlsx`) atualizado com a aba dedicada "Confirmações SAP".
  - *Confronto SAP vs Portal (`MedicaoUsoffView`):* Função `mergeConfrontoOperations` consolida na tabela de confronto tanto as operações da carteira do Portal quanto as ordens confirmadas no SAP não cadastradas no Portal (`status_divergencia = 'Não Cadastrado no Portal'`), com filtro dedicado e exportação completa via `exportConfrontoSAPXlsx`.
- **2026-11-05** — Regra Contratual dos 12 Dias no Cálculo do USOFF e Desambiguação de Nomenclatura:
  - *Ponderação USOFF:* Atividades classificadas no Portal Offshore como 'Carteira' (programadas com $\ge 12$ dias de antecedência) utilizam a ponderação mista de Programação ($PE \times HP_{carteira}$) e Execução ($EX \times HC$). Atividades classificadas como 'Fora da carteira' (inseridas no embarque ou com $< 12$ dias de antecedência) utilizam **estritamente a ponderação da execução** ($EX \times HC$), tendo parcela de programação nula ($PE \times 0$). Se `hh_carteira` não for informado (base legada), recai retrocompativelmente sobre $HP$ total.
  - *Desambiguação de Rótulos:* Ordens confirmadas no SAP pelo técnico que não foram cadastradas pelo planejamento no Portal Offshore são denominadas estritamente de 'Não Cadastrada no Portal', preservando o termo 'Fora da carteira' com exclusividade para a programação do Portal com $< 12$ dias. No USOFF, a coluna e o card de KPI evidenciam `Σ PE × HP (Carteira)`.
- **2026-11-07** — Adaptação Integral Mobile / Multi-Tela, PWA Instalável sem APK e Higienização Geral do Projeto:
  - *Responsividade Multi-Dispositivo:* Reestruturação responsiva completa de CSS, componentes base (`AppShell`, `Sidebar`, `TopHeader`, `StickyFilterBar`, `DataTable`, `SegmentedControl`, `Modal`, `Drawer`) e todas as views/modais para encaixe sem estouro horizontal em celulares (`320px`–`480px`), tablets (`768px`–`1024px`) e desktops (`1366×768` e `Full HD+`), incluindo filtros recolhíveis no mobile, gaveta lateral em largura total no celular e suporte a `safe-area-inset`.
  - *PWA Instalável (Android WebAPK / iOS Home Screen / Desktop):* Manifesto Web App (`manifest.webmanifest`), ícones padronizados (`180×180`, `192×192`, `512×512` `any` e `maskable`), Service Worker (`sw.js`) restrito a assets públicos imutáveis (jamais cacheando Supabase/API/Auth/PII) e interface dedicada de instalação ("Instalar App") acionando `beforeinstallprompt` no Android/Chrome/Edge ou instruções guiadas no iOS Safari.
  - *Auditoria, Sanitização e Cobertura de Testes:* Revisão de ponta a ponta da base de código para remoção de código morto/não utilizado, reforço de tratamento de erros, acessibilidade e ampliação da suíte automatizada de testes mantendo intactos todos os invariantes numéricos de `src/domain/`.
- **2026-11-10** — Reformulação da Apuração do USOFF: Granularidade por Operação, Execução Zero, Exceção Gangway e Diária:
  - *Granularidade por Operação:* A apuração do USOFF opera tupla por tupla `(Ordem, Operação)` a partir do cruzamento entre a Carteira do Portal Offshore (`carteira_operacoes`) e o extrato de confirmações do SAP (`confirmacoes_sap`), eliminando a agregação global de embarque como base de remuneração.
  - *Trava de Execução Zero:* O cálculo de USOFF só existe se houver execução confirmada ($HC > 0$). Se uma operação tiver execução zero ($HC = 0$), seu USOFF é zero (não pontua parcela de programação nem de execução).
  - *Exceção de Gangway Desconectada:* Caso haja anotação ou justificativa de Gangway desconectada no período, a operação recebe excepcionalmente 30% da programação ($0{,}30 \times HP$), mesmo sem execução confirmada.
  - *Ponderações Carteira vs. Fora da Carteira:* Para operações com execução ($HC > 0$), atividades em `Carteira` ($\ge 12$ dias) recebem 30% da programação + 70% da execução ($0{,}30 \times HP_{\text{carteira}} + 0{,}70 \times HC$). Atividades `Fora da carteira` ($< 12$ dias ou não cadastradas no portal) recebem estritamente 70% da execução ($0{,}70 \times HC$), com programação zerada ($PE \times 0$).
  - *Fórmula de Unidades por Diária:* Embarcações de Armador / afretadas e a frota de UMS (exceto `UMAR`, `UMCP` e `UMPA`) apuram o USOFF pela fórmula contratual $(\text{dias} + 1) \times 10$, sem incidência de pesos $PE/EX$ e sem exibir pendência de falta.
  - *Sanitização de Plataformas Próprias:* `isArmadorPlatform` em `calculations.ts` foi aprimorado para não classificar plataformas Petrobras/próprias como diária de armador por conter o nome do cliente no campo `armador`.
- **2026-11-10** — Visualização e Agrupamento do USOFF por Embarque e ID de Embarque:
  - *Agrupamento Principal por Embarque:* A visualização primária da tela de Medição de USOFF (`MedicaoUsoffView.tsx`) passa a ser **Por Embarque (ID)**, com identificador único `id_embarque`, técnico, plataforma, período de embarque, HP, HD, HC, MeterBars, PE, EX, Σ PE×HP, Σ EX×HC, USOFF e botão/link direto para a Carteira do Embarque.
  - *Cálculo Granular Preservado:* O cálculo matemático do USOFF continua sendo avaliado operação por operação com trava de execução zero ($HC = 0 \implies US = 0$, exceto Gangway $0{,}30 \times HP$) e acumulado no embarque correspondente, permitindo ao usuário auditar e bater o USOFF 1-para-1 com a planilha do Portal Offshore.
  - *Diária e Duração Físicas:* No agrupamento por embarque, os dias e HD representam a duração real do embarque (`diffDays(ini, fim) + 1` e `dias * 11h`), e a fórmula de diária $(\text{dias} + 1) \times 10$ incide uma única vez por embarque.
  - *Filtro e Busca Direta:* Suporte a pesquisa instantânea por ID de embarque (`55104`, `EMB-99881`), matrícula, nome do técnico e plataforma.
- **2026-11-10** — Modal de Visualização da Carteira do Embarque e Confronto Determinístico Portal vs. SAP:
  - *Nova Tela de Carteira do Embarque (`CarteiraEmbarqueModal.tsx`):* Acesso centralizado via estado global `carteiraModal` (`openCarteiraModal(matricula, idEmbarque?, dataRef?)`), permitindo inspecionar o embarque ativo com ID da Carteira / Embarque, dados institucionais (técnico, matrícula, função, plataforma, UN, datas e total de dias embarcado).
  - *Confronto de Horas e KPIs:* Apresenta de forma visual consolidada o HH Programado (com abertura Carteira vs. Fora da carteira), o HC lançado no Portal Offshore e o HH Confirmado no SAP, com apuração do saldo de divergência ($HC_{\text{Portal}} - HH_{\text{SAP}}$).
  - *Alerta de Ordens Não Cadastradas:* Notificação em destaque quando houver apontamentos confirmados no SAP que não estavam planejados no Portal Offshore para o embarque.
  - *Tabela Detalhada com Filtros e Exportação Excel:* Lista todas as ordens e operações com situação da programação, horas programadas e executadas, badges de confronto (`✓ OK`, `⚠️ Portal > SAP`, `ℹ️ SAP > Portal`, `Não Apontado no SAP`, `Não Cadastrada no Portal`), filtros rápidos por texto e status, e exportação `.xlsx` da carteira.
  - *Pontos de Integração:* Botão "📋 Ver Carteira Completa do Embarque" no modal de ordens do dia (`PainelDiaView`), link direto de ID de embarque na coluna de embarque do `PainelDiaView`, botão/badge de ID de embarque na tabela de `EmbarqueAtualView`, e botões no cabeçalho, rodapé e histórico diário da `FichaTecnicoDrawer`.
- **2026-11-10** — Cálculo e Apuração Granular de USOFF na Modal da Carteira do Embarque (`CarteiraEmbarqueModal.tsx`):
  - *Card de Validação e Apuração do USOFF:* Integrado card dedicado no topo com o total apurado de USOFF do embarque, pesos $PE/EX$ aplicados (ou indicação de diária $(\text{dias} + 1) \times 10$), anotação de Gangway ativa ($0{,}30 \times HP$), e monitoramento da Trava de Execução Zero ($HC = 0 \implies USOFF = 0$).
  - *Colunas Granulares por Operação:* Adicionadas colunas na tabela de ordens/operações: `PE × HP`, `EX × HC` e `USoff`, com indicação textual da regra/motivo aplicado a cada linha (`PE×HP + EX×HC`, `Apenas EX (Fora)`, `Execução Zero (HC=0)`, `Gangway (30% HP)` ou `Diária (Armador)`).
  - *Totais e Exportação Excel:* Linha de totais (`tfoot`) somando as parcelas `PE × HP`, `EX × HC` e `USoff`, e exportação `.xlsx` estendida com todas as colunas de ponderação e motivos contratuais para conciliação direta.
- **2026-11-11** — Remoção da Sub-visão Global "Por Operação" na Medição de USOFF (`MedicaoUsoffView.tsx`):
  - *Decisão do Usuário:* A visualização genérica "Por Operação" foi removida por ser redundante e desconectada do contexto de embarque.
  - *Fluxo Canônico:* A conferência de USOFF ocorre estritamente no nível de **Embarque (ID)**, com auditoria granular de cada operação diretamente dentro da modal da Carteira do Embarque correspondente. O `SegmentedControl` da tela mantém as abas: Por Embarque (ID), Por Unidade (UN), Por Preposto e Confronto SAP vs Portal.
- **2026-11-11** — Módulo de Gerenciamento de Técnicos Offshore na Configuração e Diretório Mestre:
  - *Decisão do Usuário:* O sistema passa a oferecer gerenciamento ativo e autônomo dos técnicos offshore (`tecnicos`), eliminando a dependência de criação exclusiva por auto-inserção durante o upload de planilhas.
  - *Pontos de Acesso:* Disponibilizado na aba `Configurações` (`ConfiguracoesView`, sub-aba "Técnicos Offshore") e também na aba `Pessoas, plataformas e acessos` (`PessoasPlataformasView`, sub-aba "Técnicos Offshore").
  - *Recursos e Salvaguardas:*
    1. CRUD completo: Criação (`saveTecnico`), edição e exclusão com 2 cliques (`deleteTecnico`).
    2. Salvaguarda de Integridade: Técnicos que já possuem apontamentos de HH ou embarques na carteira têm a exclusão bloqueada pela UI e pelo banco (`ON DELETE RESTRICT`), prevenindo perda de histórico ou orfandade de dados.
    3. Importação e Exportação: Importador em lote de planilhas (`.xlsx`/`.csv`) com remapeamento de colunas e pré-visualização; exportador dedicado da base de técnicos para Excel (`exportTecnicosListXlsx`) com contadores de apontamentos e embarques; e gerador de planilha modelo (`exportModeloXlsx('tec')`).
    4. Sincronização e Auditoria (Migration 021): Trigger Realtime `trg_heartbeat_tecnicos` disparando `fn_touch_heartbeat()` e trigger WORM `trg_audit_tecnicos` registrando inserções, atualizações e exclusões em `system_audit_logs`.
    5. Dual-Topology: Implementado tanto para BaaS (Supabase) quanto para backend universal self-hosted Node.js (`/api/v1/tecnicos`).
- **2026-11-11** — Identificação e Configuração do Regime de Medição por Diária (UNs e Plataformas):
  - *Decisão do Usuário:* Criar uma forma explícita de identificar quais unidades e plataformas operam no regime de **Diária**, para que o motor de cálculo do USOFF compute diárias ($(\text{dias} + 1) \times 10$) em vez de exigir HH ou aplicar pesos de Homem-Hora, mesmo quando houver horas de HH apontadas.
  - *Configuração no Nível de Unidade de Negócio (UN):*
    - Disponibilizado em `ConfiguracoesView.tsx` na tabela de pesos de USOFF por Regional/UN, com seletor interativo de dois estados (`HH` | `Diária`) por UN.
    - Persistência resiliente: gravado em `config_usoff_un.tipo_medicao` (Migration 022) e sincronizado defensivamente em `configuracoes.regionais_extras` com marcadores `DIARIA_UN:<un>` para garantir funcionamento imediato mesmo sem migração prévia do schema.
  - *Configuração no Nível de Plataforma (Unidade Marítima):*
    - Disponibilizado em `PessoasPlataformasView.tsx` no formulário de cadastro/edição de plataformas com seletor de "Regime de Medição / Remuneração" (`Homem-Hora (HH)` vs `Diária`).
    - Filtro dedicado na toolbar de plataformas: "Todos", "Apenas Diária" e "Apenas HH", com contadores em tempo real.
- **2026-11-12** — Ajuste da Fórmula de Diária do USOFF ($\text{dias} \times 10$):
  - *Decisão do Usuário:* A fórmula de apuração do USOFF por diária foi corrigida de $(\text{dias} + 1) \times 10$ para $\text{dias} \times 10$.
  - *Motivação e Alinhamento com o Portal Offshore:* A soma de $+1$ havia sido solicitada pelo usuário considerando a subtração do Excel (`Fim - Início`), que não inclui a data de início. Como o motor do sistema já computa os dias de forma inclusiva ($\text{diffDays} + 1$), o $+1$ adicional na fórmula resultava em um dia a mais (ex.: 14 dias embarcado apurava 15 dias = 150 USOFF). Com o ajuste, 14 dias apuram exatamente $14 \times 10 = 140\text{ USOFF}$.
  - *Arquivos Atualizados:* `src/domain/usoff.ts`, `src/ui/modals/CarteiraEmbarqueModal.tsx`, `src/ui/views/ConfiguracoesView.tsx`, `src/ui/views/PessoasPlataformasView.tsx`, `supabase/migrations/022_unidades_e_plataformas_diaria.sql` e testes em `src/domain/__tests__/usoff.test.ts`.
    - Coluna de status visual na tabela de plataformas com badges `Diária` (verde) e `HH` (neutro).
    - Suporte a importação e exportação de planilhas Excel com a coluna `Regime de medição` / `medicao`.
    - Persistência retrocompatível: além do campo `tipo_medicao` em `plataformas` (Migration 022), a string `tipo` armazena `(Diária)` garantindo compatibilidade com versões anteriores de banco e PostgREST.
  - *Impacto no Motor de Cálculo USOFF e Carteira:*
    - `isArmadorPlatform` em `calculations.ts` e `isArmadorDiariaSemProg` passam a receber o mapa `dataset.usoffUnWeights` e verificar tanto a flag explícita da plataforma quanto a flag da UN.
    - Se a UN ou a plataforma estiver sinalizada como `diaria`, o cálculo de USOFF adota a fórmula de diária $(\text{dias} + 1) \times 10$ em todos os cenários (carteira de operações, carteira legacy e sem programação), marcando `falta: false` e exibindo badge e rótulo explicativo `'Diária'` / `'Diária (Armador)'`.
    - Modal da Carteira do Embarque (`CarteiraEmbarqueModal.tsx`) reconhece a configuração e exibe a fórmula de diária no card de resumo e nas linhas de operações.
- **2026-11-11** — Revisão de UI/UX das Ações de Técnicos e Fluxo de Exclusão em Cascata:
  - *Decisão do Usuário:* Ajustar os botões de ação ao lado de "Ficha" na listagem de técnicos offshore (não estavam visíveis ou estourando layout) e corrigir a impossibilidade de exclusão de técnicos com registros vinculados.
  - *Padronização de UI/UX dos Botões de Ação:*
    - Removida restrição arbitrária `isGlobal` que ocultava os botões de editar e excluir na tabela.
    - Padronizados botões com as classes canônicas do sistema (`btn btn-sm btn-ghost` para Ficha e `btn btn-sm btn-icon btn-ghost` para Edição e Exclusão), eliminando a classe fantasma `btn-xs` e o estouro de padding.
    - Ajustada largura da coluna de ações para `180px` com `display: inline-flex` e alinhamento à direita contido.
  - *Fluxo de Exclusão e Suporte a Cascata:*
    - Botão de exclusão da lixeira é sempre interativo e clicável (não fica travado ou desabilitado silenciosamente).
    - Modal de exclusão com diagnóstico em tempo real: exibe contagem de apontamentos de HH e embarques vinculados ao técnico.
    - Se o técnico possuir histórico, exige confirmação explícita via checkbox de exclusão em cascata.
    - Backend Dual-Topology (Supabase Connector + Server Node.js) atualizado com suporte a `deleteTecnico(matricula, cascade = true)`: remove em ordem referencial reversa (`justificativas` -> `carteira_operacoes` -> `carteira_embarques` -> `apontamentos_hh` -> `confirmacoes_sap` -> `tecnicos`), eliminando falhas de chave estrangeira (`23503`).


