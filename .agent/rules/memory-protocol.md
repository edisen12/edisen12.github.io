---
trigger: always_on
description: Protocolo obrigatório de memória contínua e handoff entre sessões (arquivos em .agent/memory/).
---

# Protocolo de Memória Contínua e Handoff (OBRIGATÓRIO)

Este repositório mantém memória persistente em `.agent/memory/`:

| Arquivo | Conteúdo |
|---|---|
| `handoff.md` | Resumo do projeto, **Zonas Consolidadas**, Estado Atual, Próximos Passos |
| `decisions.md` | Regras de negócio, RBAC, decisões arquiteturais, log de decisões do usuário |
| `patterns.md` | Convenções de código, pastas, nomes, erros, testes |
| `gotchas.md` | Comandos exatos, armadilhas de ambiente e de domínio, configurações sensíveis |

## 1. GATILHO DE INICIALIZAÇÃO SILENCIOSA (TURNO 1)

Sempre que uma nova sessão começar, antes de responder ou planejar qualquer ação para o usuário, leia silenciosamente os arquivos `.agent/memory/handoff.md` e `.agent/memory/decisions.md`. Se a tarefa envolver escrita de código ou correção de bugs, leia também `.agent/memory/patterns.md` e `.agent/memory/gotchas.md`.

Respeite estritamente a seção **Zonas Consolidadas** do `handoff.md`: não abra nem inspecione arquivos dados como concluídos se eles não tiverem relação direta com o pedido atual.

Não faça resumo do que leu na resposta; apenas aplique o contexto e execute o pedido do usuário.

> `CONTEXT_MEMORY.md` (61 KB) é referência profunda: consulte só trechos específicos (grep/leitura por seção) quando a memória acima não bastar. Nunca leia o arquivo inteiro por padrão.

## 2. GATILHO DE GRAVAÇÃO CONTÍNUA (EAGER UPDATE)

O usuário não avisará quando vai fechar a sessão ou abrir uma nova. Portanto, toda vez que você concluir uma tarefa, implementar uma feature, alterar arquivos ou fechar um ciclo de raciocínio com sucesso, atualize automaticamente o arquivo `.agent/memory/handoff.md` **antes de entregar sua resposta final**:

- mova o que foi finalizado (e validado com `typecheck` + `test:run`, quando houver código) para **Zonas Consolidadas**;
- reescreva **Estado Atual** com o que está em andamento, os arquivos exatos e o ponto onde parou;
- reordene **Próximos Passos** e remova os itens concluídos;
- atualize a linha "Última atualização" (data/hora, HEAD do git, contagem de testes).

## 3. GATILHO DE APRENDIZADO DE ERROS E REGRAS

- Sempre que você levar **mais de duas tentativas** para corrigir um bug ou descobrir um comportamento específico de biblioteca/ambiente, adicione imediatamente a causa e a solução em `.agent/memory/gotchas.md` (formato: Sintoma → Causa → Solução).
- Sempre que o usuário definir uma **nova regra de negócio ou mudança de arquitetura** no chat, registre imediatamente em `.agent/memory/decisions.md` (na seção pertinente e no "Log de Decisões do Usuário", com data).

## 4. Restrições da Memória

- **Repositório público:** jamais gravar PII (nomes reais, e-mails, CPFs, matrículas reais), senhas, tokens ou a chave `service_role` nos arquivos de memória.
- Escreva fatos verificados no código. Nada de texto genérico. Se a memória divergir do código, o código vence: corrija a memória.
- Mantenha os arquivos enxutos (são lidos em toda sessão). Prefira tabelas e listas a prosa.
