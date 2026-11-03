# Padrões de Código

> Siga estes padrões para manter consistência. Em caso de dúvida, imite o arquivo vizinho mais recente do mesmo tipo.

## 1. Organização de Pastas (camadas — dependência só "para dentro")

```
src/config/   → constantes e env (sem lógica)
src/domain/   → regras puras: zero React, zero rede, zero DOM
src/utils/    → funções puras genéricas (data, formatação)
src/services/ → única camada que fala com o Supabase/SheetJS
src/ui/state/ → AppContext (orquestra services + domain)
src/ui/components/ · src/ui/modals/ · src/ui/views/ → apresentação
src/types/database.types.ts → gerado do schema (não editar)
supabase/migrations/NNN_descricao.sql · supabase/functions/<nome>/index.ts
```
- Views **nunca** chamam `supabase` diretamente: passam por `services/*` (normalmente via ações do `useApp()`).
- O domínio recebe dados e devolve dados novos. Não importa nada de `services/` nem de `ui/`.

## 2. Nomenclatura

| Item | Convenção | Exemplo |
|---|---|---|
| Componentes/Views | `PascalCase.tsx`, sufixo `View`/`Modal`/`Drawer` | `MedicaoUsoffView.tsx` |
| Serviços | `camelCase.service.ts` | `data.service.ts` |
| Funções de serviço | verbo + entidade | `saveJustificativa`, `batchImportHH`, `fetchSystemAuditLogs` |
| Funções de domínio | `export const fn = (...) =>` (arrow) | `computePeriodDays`, `resolveUsoffWeights` |
| Tipos | `interface` PascalCase em `domain/types.ts`; unions string literais | `type TabId = 'ger' \| ...` |
| Banco | `snake_case` (tabelas, colunas, RPCs); helpers RLS `auth_*`; triggers `trg_*`; funções de trigger `fn_*` | `auth_allowed_platforms()` |
| Abas | código de 3 letras em `TabId` + entrada em `NAV_TABS` e `TAB_TITLES` (`constants.ts`) | `'adm'` |
| Storage keys | prefixo `hhoff_` | `hhoff_prefs`, `hhoff_filters`, `hhoff_tab`, `hhoff_session_tab`, `hhoff_theme` |
| Abreviações legadas do motor | mantidas de propósito (paridade com o legado) | `mat`, `D`, `d`, `e`, `p`, `pAj`, `sem`, `LAST`, `P.ini/P.fim`, `HP`, `HC`, `PE`, `EX` |

- Textos de UI, mensagens de erro e comentários: **pt-BR**. Commits: Conventional Commits (`feat(escopo): ...`, `fix(security): ...`, `test: ...`), descrição em inglês ou português.

## 3. Componentes React

- Preferir `export function Nome(props: NomeProps)` com `export interface NomeProps` logo acima (padrão de `components/`). Algumas views grandes usam `export const X: React.FC = () =>`; ambos são aceitos, mas o código novo deve usar `function`.
- Named exports (só `App.tsx` tem também `export default`).
- Props opcionais com default na desestruturação (`className = ''`); classes montadas com template string + `.trim()`.
- Estado global via `useApp()`; feedback via `useToast()` (`'info' | 'success' | 'warn' | 'error'`).
- Ícones: `lucide-react`. Botões só com ícone **sempre** levam `title` + `aria-label`.
- Tabelas: usar `<DataTable>` com `DataTableColumn` declarando `width`/`minWidth`. Colunas de nome/matrícula/plataforma: `width: '240px'`–`'260px'`, `minWidth: '220px'`–`'240px'`, `whiteSpace: 'nowrap'`.
- Sub-visões/abas internas: `<SegmentedControl>` com contadores.
- Usuários de escopo restrito: views operacionais exibem `<ScopeBanner />`.

## 4. Estilos

- CSS puro, sem CSS-in-JS nem Tailwind. Cores, espaçamentos e tipografia **só por tokens** de `tokens.css` (`--brand-primary`, `--brand-accent`, ...); tema via `data-theme` em `<html>`.
- Classes `kebab-case` (`kpi-card`, `tone-ok`, `btn-link`). Números, horas, % e USOFF: classe `.num` (`tabular-nums`).
- Fontes: Montserrat (títulos/KPIs/nav) e Source Sans 3 (corpo/tabelas).
- Layout desktop com viewport travado (`100dvh`), e só `.main-scroll-area` rola. Grid de KPIs: 6 colunas (≥ 1560px) ou 3 colunas (900–1559px, alvo 1366×768).

## 5. Serviços e Tratamento de Erros

- Funções `async` exportadas soltas (sem classes). Cabeçalho de arquivo com banner `// ====...` descrevendo a responsabilidade.
- Padrão de erro Supabase: `const { data, error } = await ...; if (error) throw error;` ou `throw new Error('<mensagem pt-BR amigável>')` (ver `translatePasswordError` em `auth.service.ts`).
- A UI captura com `try/catch` e mostra `toast` com a mensagem. Nunca engolir erro em silêncio (há dívida conhecida: ver handoff, Próximos Passos #2).
- Leituras volumosas: `fetchAllPages((from, to) => supabase.from(...).range(from, to))`.
- Escritas em lote: chunks de `CHUNK_SIZE = 500`, ordenados por chave natural, `upsert(..., { onConflict })`, callback `onProgress(gravadas, total)`, e registro em `fluxo_importacoes`.
- Antes de gravar uma entidade com FK, garantir que a dependência existe (plataformas pendentes → técnicos → apontamentos).
- Payloads PostgREST são montados campo a campo com cast explícito (ver `saveJustificativa`). Nunca fazer spread de objeto vindo da UI.

## 6. Datas e Números

- Datas operacionais são strings ISO `'YYYY-MM-DD'`. Aritmética só com `utils/date.ts` (`addDays`, `diffDays`, `toDate` ao meio-dia local, `isoOf`, `todayIso`).
- Formatação só via `utils/format.ts` (`formatHours`, `formatPct`, `formatUs`, `calcPct`, `normalizeText`, `platformKey`, `slugify`, `parseFlexibleHours`).

## 7. Testes

- Arquivos em `__tests__/` irmão do código, nomeados `<alvo>.test.ts(x)`. Ambiente `happy-dom`, `globals: true`, setup em `src/test/setup.ts`.
- Supabase é sempre mockado (`src/test/mockSupabase.ts`) com dados de `src/test/testFixtures.ts` (sem PII: nomes e matrículas fictícios).
- Toda mudança em domínio, RLS ou Edge Function → teste novo ou atualizado em `src/domain/__tests__` ou `src/security/__tests__`.

## 8. Banco de Dados

- Nova tabela: `ENABLE ROW LEVEL SECURITY` + políticas `TO authenticated` que checam `auth_is_active()` e o escopo (`auth_is_global()` / `auth_allowed_platforms()` / `auth_allowed_uns()`).
- Funções `SECURITY DEFINER` sempre com `SET search_path = public` e `REVOKE EXECUTE` de `PUBLIC`/`anon` quando não forem RPC pública. Funções só de trigger: revogar de `authenticated` também.
- Depois de uma migration: regenerar `database.types.ts`, rodar os Security Advisors e documentar em `decisions.md` (e em `CONTEXT_MEMORY.md` se for feature grande, como nos commits anteriores).
