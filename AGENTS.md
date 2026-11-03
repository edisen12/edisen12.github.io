# AGENTS.md — HH Offshore · Infotec Brasil

Ponto de entrada para qualquer agente de IA (Antigravity, Codex, Cursor, Claude Code etc.).

**Protocolo canônico:** [`.agent/rules/memory-protocol.md`](.agent/rules/memory-protocol.md). Siga-o integralmente. Resumo obrigatório:

1. **Início de sessão (silencioso):** antes de responder, leia `.agent/memory/handoff.md` e `.agent/memory/decisions.md`. Se for escrever código ou corrigir bug, leia também `patterns.md` e `gotchas.md`. Não abra arquivos listados em **Zonas Consolidadas** sem relação direta com o pedido. Não resuma o que leu.
2. **Gravação contínua:** ao concluir qualquer tarefa ou alteração, atualize `.agent/memory/handoff.md` (Zonas Consolidadas, Estado Atual, Próximos Passos) **antes** da resposta final.
3. **Aprendizado:** bug que levou mais de 2 tentativas → registrar em `gotchas.md`. Nova regra de negócio ou de arquitetura definida pelo usuário → registrar em `decisions.md`.

**Regras inegociáveis do projeto:**
- Repositório público: zero PII e zero segredos em arquivos versionados.
- Não alterar o resultado numérico do motor de domínio (`src/domain/`). Antes de commit: `npm run typecheck && npm run test:run && npm run build`.
- Migrations `supabase/migrations/001`–`009` são imutáveis; evoluir com nova migration numerada.
