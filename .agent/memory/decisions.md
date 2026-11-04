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
- `USoff = PE × HP + EX × HC` (HC = horas executadas).
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

## 4. Log de Decisões do Usuário (cronológico)

- **2026-11-01** — Memória do projeto será nativa em Markdown (`.agent/memory/`), sem MCP externo e sem alterar a config global. Protocolo em `.agent/rules/memory-protocol.md`, com espelho em `AGENTS.md`.
- **2026-11-01** — GSD removido do sistema; não usar mais o fluxo `.planning/`.
- **2026-11-01** — Abstração de banco de dados deve operar em duas topologias mutuamente exclusivas com travas de build/segurança: (1) `baas` para hospedagem estática (GitHub Pages) aceitando qualquer BaaS via abstração aberta (não restrita a Supabase/Firebase); e (2) `self-hosted` obrigando servidor frontend + backend privado + banco em VPS/Docker (sem chaves ou tokens expostos no navegador, usando sessão Cookie `HttpOnly` + CSRF) e abstração server-side aberta capaz de aceitar qualquer banco de dados puro (SQL ou NoSQL) sem lista fixa de 3 drivers.
- **2026-11-03** — Correção de recursão infinita RLS em `user_onboarding` (Migration 010): eliminada subquery recursiva em `WITH CHECK` de `user_onboarding_update_policy`, promovida a RPC `complete_first_login_password_change` para `SECURITY DEFINER` e implementada trigger PL/pgSQL anti-tamper para travar DML não autorizado de `primeiro_login`/`obriga_troca_senha` sem recursão de RLS.
- **2026-11-03** — Ciclo de vida de exclusão de pessoas e credenciais: ao excluir uma pessoa (`deletePessoa`), o sistema remove automaticamente as credenciais associadas em `auth.users`, `profiles` e `user_onboarding` via `delete-user` (Edge Function / Server), evitando contas órfãs. Salvaguardas anti-lockout continuam ativas (bloqueando a exclusão se for o próprio usuário ou o último admin ativo). Adicionado também botão de exclusão pontual de credenciais no modal de login da pessoa (`UserLoginModal`). Extração de erro aprimorada no conector para desserializar respostas de erro de Edge Function em vez de exibir mensagem genérica de status HTTP.
- **2026-11-03** — Estrutura de Carteira Granular e Cenário B de Programação (Migration 011): Adoção do modelo de operações detalhadas (`carteira_operacoes`) com chave natural `(matricula, data_inicio, ordem, operacao)`. Mantém rastreabilidade total de Ordens, Operações, HH Programado e status (`Carteira`, `Fora da carteira`, `Cancelada`).
- **2026-11-03** — Substituição de Ordens por `id_embarque` na Carteira de Embarques (Migration 012): Inclusão da coluna `id_embarque text NOT NULL DEFAULT ''` na tabela `carteira_embarques` (com índice `idx_carteira_id_embarque`), mapeando diretamente o identificador único do embarque do Portal Offshore (`portal_id`).
- **2026-11-03** — Regra dos 12 Dias, HH Programado Total e Higienização de `operacao` (Migration 013):
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
