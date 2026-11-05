# Gotchas — Armadilhas, Ambiente e Comandos

> Toda vez que um bug ou comportamento levar mais de 2 tentativas para resolver, registre aqui: **Sintoma → Causa → Solução**.

## 1. Comandos Exatos

```powershell
npm ci                 # instalar (CI usa Node 22; local: Node 24 funciona)
npm run dev            # http://localhost:5173 (porta fixa, liberada no CORS da Edge Function)
npm run typecheck      # tsc --noEmit
npm run test:run       # vitest run — esperado: 22 arquivos / 410 testes, ~15 s
npm run build          # já roda tsc --noEmit antes do vite build → dist/
npm run preview        # http://localhost:4173 (também liberada no CORS)
```
Antes de qualquer commit: `typecheck` + `test:run` + `build`. O deploy (`deploy.yml`) roda os mesmos três e para se algum falhar.

## 2. Ambiente Windows / PowerShell 5.1

- **Mojibake no terminal** (`Medi�ǜo`, `Configura�es`): os arquivos são UTF-8 e o PowerShell 5.1 lê como cp1252. **Não "corrija" o arquivo.** Para ler: `Get-Content -Encoding UTF8` e `[Console]::OutputEncoding=[Text.Encoding]::UTF8`. Para editar, use as ferramentas de edição de arquivo, não `Set-Content` sem `-Encoding UTF8`.
- **`npm run ...` aparece como `NativeCommandError`** por causa de `npm notice` no stderr. Não é falha: confira o exit code e a saída real.
- **Stack trace de `callEdge` (admin-users-edge.test.ts) no log do Vitest** é esperado (caminhos de erro testados de propósito). Os 41 testes passam.
- O workspace fica em `Downloads\edisen12.github.io-main\edisen12.github.io-main` (pasta duplicada por extração de zip). O remoto `origin/main` existe e está sincronizado.

## 3. Armadilhas de Domínio e Dados

- **Drift de fuso:** `new Date('YYYY-MM-DD')` é UTC 00:00, que vira o dia anterior em UTC−3. Use sempre `utils/date.ts`.
- **Limite de 1000 linhas do PostgREST:** um `.select('*')` simples trunca sem avisar. Use `fetchAllPages`.
- **Lookback de 45 dias:** remover o `-45` em `neededQueryWindow`/`loadAppDataset` faz embarques que cruzam o corte perderem dias no critério `enc`.
- **"Não chegou" falso** em preposto: acontece se `externalCoveredSet` não for populado (RPC `get_external_covered_days`).
- **Deadlock `40P01` em importação:** acontece se os chunks não forem ordenados por chave natural antes do upsert.
- **Erro `21000` em importação de carteira (`ON CONFLICT DO UPDATE command cannot affect row a second time`):**
  - *Sintoma:* Erro HTTP 500 no `POST /rest/v1/carteira_operacoes` ao salvar prévia da carteira do Portal Offshore.
  - *Causa:* A trigger `sync_carteira_embarques_from_operacoes()` em `carteira_operacoes` continha `GROUP BY co.portal_id, co.matricula, co.plataforma_sigla, co.unidade_negocio, co.data_inicio`. Quando operações do mesmo técnico no mesmo início de embarque possuíam variações de `portal_id` ou de plataforma, o comando `INSERT INTO carteira_embarques ... ON CONFLICT (matricula, data_inicio) DO UPDATE` tentava atualizar a mesma tupla duas vezes no mesmo comando SQL, acionando o erro 21000 do Postgres.
  - *Solução:* Migration 016 corrigindo a trigger para agrupar estritamente por `(co.matricula, co.data_inicio)` e agregando campos variáveis via `MAX(...)`.
- **Importação do Portal Offshore / SAP não grava no banco ("processada com sucesso" falso):**
  - *Sintoma:* O usuário seleciona o arquivo do Portal Offshore ou do SAP, vê a mensagem de sucesso, mas nenhuma linha é gravada no Supabase.
  - *Causa:* 1) A heurística `guessImportKind` em `excel.service.ts` não reconhecia cabeçalhos com "Início" e "Fim" sem a palavra "embarque", caindo no tipo `'hh'` e gerando 0 linhas por ausência da coluna `Data`; 2) O toast informava "Planilha processada com sucesso" logo após o SheetJS ler o arquivo em memória, dando a ilusão de que a gravação já havia ocorrido; 3) O botão "Salvar linhas" ficava apenas no rodapé da página.
  - *Solução:* Ajustar regex de detecção em `guessImportKind`, adicionar botão "Gravar X linhas no Banco" no topo do painel de prévia com scroll suave automático, alertar explicitamente caso 0 linhas sejam lidas e ajustar o texto do toast para orientar o clique em gravação.
- **FK em importação:** técnicos e plataformas pendentes precisam ser gravados antes dos apontamentos. Hoje esses upserts não checam `error` (dívida — handoff, Próximos Passos #2).
- **Modo demo:** com o banco sem HH, carteira e watermark, o app mostra dados sintéticos (`isDemo`). Não confundir com bug nem com vazamento.
- **Gangway:** só abate quando o motivo é exatamente `'Gangway desconectada'` (string igual à de `MOTIVOS_JUSTIFICATIVA`).

## 4. Segurança e Configurações Sensíveis

- **Repo público:** zero PII (nomes reais, e-mails, CPFs, matrículas reais) e zero segredos em qualquer arquivo versionado — código, testes, fixtures, docs e `.agent/memory/`.
- **Anon key hardcoded** (`src/config/env.ts`, `deploy.yml`, `supabase-keepalive.yml`) é intencional e segura (RLS + `anon` sem grants). A **service_role** nunca entra no repo. Ela existe só como secret da Edge Function no Supabase.
- **CSP no `index.html`:** qualquer origem externa nova (API, CDN, fonte, imagem) precisa entrar em `connect-src`/`font-src`/`img-src`/etc., senão é bloqueada em silêncio no navegador.
- **CORS da Edge Function** (`ALLOWED_ORIGINS` em `admin-users/index.ts`): só `https://edisen12.github.io`, `localhost:5173` e `localhost:4173`. Porta ou domínio novo → editar e **reimplantar** a função.
- **Excel:** toda célula exportada passa por `sanitizeSpreadsheetCell` (prefixa `'` em `= + - @ \t \r`). Upload máximo de 15 MB.
- **Edge Function 500:** nunca devolver mensagem crua do Postgres (CWE-209).
- **`system_audit_logs` é WORM:** UPDATE/DELETE lança `P0001` de propósito. Não tente "limpar" logs por SQL.

## 5. Build, Deploy e Infra

- `base: './'` no Vite: não trocar por `/` (quebra assets no Pages).
- `xlsx` precisa continuar como import dinâmico. Um import estático puxa ~400 KB para o bundle inicial.
- O app não tem roteador de URL. A receita de `404.html`/SPA fallback da skill global `github-pages-software-engineering` **não se aplica** aqui, e a árvore de pastas da skill (vanilla JS) é substituída pela deste projeto (React + TS).
- **Migrations `001`–`010` são imutáveis:** mudança de schema = nova migration numerada aplicada no projeto `fwdvrkfootvublicetim`.
- **Recursão infinita em política RLS (erro `42P17`):** sintoma: `"infinite recursion detected in policy for relation \"user_onboarding\""`. Causa: subconsulta na própria tabela (`SELECT ... FROM user_onboarding`) dentro de `WITH CHECK` da política RLS faz o rewriter de queries do PostgreSQL expandir a política recursivamente no momento de compilação da query. Solução: nunca consultar a própria tabela dentro de sua política RLS; se precisar checar transição `OLD` vs `NEW` sem permitir bypass de console, use uma trigger `BEFORE UPDATE/INSERT` e marque a RPC de conclusão como `SECURITY DEFINER` liberando a transição via setting de sessão transacional (`set_config('app.allow_first_login_completion', 'true', true)`).
- **Edge Function retornando erro não-2xx com mensagem genérica no frontend:** sintoma: `"Edge Function returned a non 2xx status code"` ou `FunctionsHttpError` sem mensagem explicativa. Causa: `@supabase/supabase-js` embrulha erros HTTP de Edge Function em `FunctionsHttpError`, armazenando o body JSON da resposta na propriedade `error.context`. Acessar apenas `error.message` exibe a string genérica padrão do SDK. Solução: checar `if ('context' in error && error.context)` e executar `await error.context.clone().json()` para extrair `body.message` ou `body.error` retornado pelo servidor Deno.
- Keepalive: o cron **real** é `0 11 * * 1,4` (seg/qui 11:00 UTC = 08:00 BRT).

## 6. Desvios Conhecidos do `CONTEXT_MEMORY.md` (código é a verdade)

| CONTEXT_MEMORY diz | Código real |
|---|---|
| `sanitizeTab` em `App.tsx`/`Sidebar.tsx` | Não existe. Fallback via `ActiveTabRouter` (`isGlobal ? View : VisaoGeralView`) + filtro na Sidebar |
| Keepalive às 09:00 UTC | `0 11 * * 1,4` (11:00 UTC) |
| Mapa de diretórios com migrations 001–002 | Existem 001–009 |
| "9 abas" | 10 abas + `perfil` (inclui `adm`) |
| Aba `adm` "visível para administradores" | Visível para `admin` **e** `gestor` (decisão pendente — handoff #3) |
| 376 / 387 testes (seções antigas) | 410 testes / 22 arquivos |
| Duas seções numeradas "## 7" | Numeração duplicada |

## 7. Histórico de Ambiente (sessões anteriores)

- **2026-11-01:** o framework GSD (`get-shit-done-cc`) foi desinstalado globalmente. O `~/.gemini/config/config.json` global ainda guarda entradas antigas de allowlist com `git add .planning/...`; são inofensivas e ficaram de fora porque essa config é global e não deve ser alterada.
