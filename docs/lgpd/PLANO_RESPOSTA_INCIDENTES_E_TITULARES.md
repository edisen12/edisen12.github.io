# Plano de Resposta a Incidentes e Atendimento a Direitos dos Titulares (LGPD)

**Fundamentação Legal:**  
- **Art. 9º e Art. 18 da Lei nº 13.709/2018 (LGPD):** Direitos de confirmação, acesso, retificação, oposição e anonimização/eliminação.  
- **Art. 41 da LGPD:** Atribuições do Encarregado (DPO).  
- **Art. 48 da LGPD e Resolução CD/ANPD nº 15/2024:** Comunicação de incidentes de segurança envolvendo dados pessoais à ANPD e aos titulares em até **3 (três) dias úteis** (quando houver risco ou dano relevante).

---

## Parte I — Procedimento de Atendimento ao Titular (Art. 18 da LGPD)

### 1. Canais de Entrada e Triagem
- O titular (técnico offshore ou usuário do sistema) submete requisição pelo canal divulgado internamente e exibido no **Aviso de Privacidade** para usuários autenticados (`configuracoes.dpo_contato`).
- **Verificação de identidade:** Antes de fornecer dados ou alterar registros, validar identidade funcional (matrícula + confirmação por RH/liderança).

### 2. Prazos Legais de Resposta (Art. 19)
- **Declaração simplificada imediata** (confirmação de existência de tratamento) ou **declaração completa em até 15 (quinze) dias** contados da solicitação do titular.

### 3. Matriz de Execução Técnica por Tipo de Pedido

| Direito Solicitado (Art. 18) | Verificação Jurídica / Contratual | Ação Técnica Executada no Sistema |
|---|---|---|
| **Confirmação e Acesso** (I, II) | Verificar se o solicitante é o titular ou representante legal válido | Consultar tabelas vinculadas à matrícula (`tecnicos`, `apontamentos_hh`, `carteira_embarques`, `justificativas`) sob perfil `admin` e emitir extrato estruturado **sem incluir chaves de terceiros** e **mascarando termos sensíveis**. |
| **Correção de Dados** (III) | Validar erro cadastral (nome, função, matrícula) | Atualizar registro via tela de **Pessoas / Cadastros** (`saveTecnico` / planilhas mestras). |
| **Eliminação / Anonimização** (IV, VI) | Verificar se há obrigação legal/trabalhista/contratual vigente (**Art. 16, I LGPD** + guarda CLT 5 anos / auditoria Petrobras) | 1. Se ainda dentro do prazo legal obrigatório: responder com fundamento legal mantendo os dados sob guarda restrita (`ativo = false` quando desligado).<br>2. Se cabível anonimização preservando totais numéricos contratuais: acessar **Governança e Auditoria -> Privacidade & LGPD -> Anonimização de Titular** (`anonimizar_tecnico_lgpd(matricula)`). O sistema substitui o nome por `"Técnico Anonimizado (LGPD)"`, limpa `chave_petrobras` e higieniza `justificativas.descricao`, registrando evento WORM sem gravar a PII removida. |
| **Desativação / Revogação de Acesso de Usuário** | Usuário desligado ou troca de função | Acessar **Gestão Global de Administradores & Acessos**: desativar (`toggle-active`, bloqueio imediato no RLS em 0ms) ou excluir conta (`delete-user`). |

---

## Parte II — Plano de Resposta a Incidentes de Segurança (Art. 48 & Res. ANPD nº 15/2024)

### Fases de Resposta

1. **Detecção e Contenção Imediata (Hora 0 a 4h):**
   - Revogar acesso suspeito na hora (`toggle-active` -> inativo corta `auth_is_active()` no PostgreSQL em 0ms) ou rotacionar chaves/sessões no Supabase.
   - Exportar o recorte relevante da **Trilha de Auditoria WORM** (`system_audit_logs`, aba `adm`) preservando evidências cronológicas e IPs dos últimos 12 meses.
   - Se o incidente envolver comprometimento de senhas, forçar redefinição (`reset-password` com `obriga_troca_senha: true`).

2. **Avaliação de Impacto e Escopo (Até 24h):**
   - Identificar tabelas afetadas, número de titulares impactados, natureza dos dados (se inclui `justificativas.descricao`, e-mails, matrículas) e mecanismo da falha (ex.: credencial comprometida, exportação indevida em estação compartilhada, endpoint externo).

3. **Comunicação à ANPD e aos Titulares (Até **3 dias úteis** do conhecimento — Res. CD/ANPD nº 15/2024):**
   - Aplicável se o incidente puder acarretar **risco ou dano relevante** aos titulares (ex.: acesso não autorizado a grande volume de nomes/matrículas/justificativas, ausência de criptografia ou vazamento de dados pessoais).
   - **Nota sobre registro interno:** Ainda que avaliado como sem risco relevante, **documentar formalmente o incidente e a análise técnica por no mínimo 5 anos** (obrigação da Res. CD/ANPD nº 15/2024).

4. **Erradicação, Recuperação e Pós-Incidente:**
   - Se necessário restauro íntegro de dados, seguir procedimento validado em [`docs/DATABASE_BACKUP_AND_DR.md`](../DATABASE_BACKUP_AND_DR.md) testando em instância isolada antes de qualquer intervenção em produção.
   - Conduzir revisão de causas-raízes, atualizar regras RLS/testes de segurança e comunicar encerramento à Diretoria/DPO.
