# Registro de Operações de Tratamento de Dados Pessoais (ROPA — Art. 37 da LGPD)

**Sistema:** HH Offshore · Gestão de Homem-Hora (HH) e Consolidação USOFF  
**Controladora:** Infotec Brasil *(preencher razão social e CNPJ oficiais na adoção corporativa)*  
**Encarregado pelo Tratamento de Dados (DPO):** *Configurável no painel administrativo (`configuracoes.dpo_contato`) após nomeação formal (Art. 41 da LGPD)*  
**Versão do Modelo:** 1.0 (alinhado ao schema até a Migration `032`)

---

## 1. Visão Geral e Finalidade Principal

O sistema realiza o controle de presença offshore, apuração diária de horas executadas (`HH`), programação de carteira e consolidação contratual por Unidade de Serviços Offshore (`USOFF`), garantindo rastreabilidade e conformidade operacional de equipes destacadas em unidades marítimas.

---

## 2. Inventário de Tratamentos por Tabela / Processo

| ID | Processo / Tabela | Categorias de Titulares | Dados Tratados | Dados Sensíveis (Art. 5º II)? | Base Legal (Art. 7º / Art. 11) | Compartilhamento / Operadores | Prazo de Retenção e Descarte (Art. 15–16) |
|---|---|---|---|---|---|---|---|
| **T-01** | **Cadastro de Técnicos Offshore** (`public.tecnicos`) | Colaboradores técnicos vinculados à operação offshore | Matrícula funcional, nome completo, função operacional, status `ativo` | Não *(evitar inferência sindical/saúde)* | **Art. 7º, V** (Execução de contrato / procedimentos preliminares) e **Art. 7º, II** (Cumprimento de obrigação legal/trabalhista) | Equipes internas autorizadas com RBAC/RLS por unidade/plataforma; contratante (medição) | **Mínimo 5 anos** após término do vínculo ou últimas medições; após prazo, **anonimização automática** via `executar_retencao_lgpd` |
| **T-02** | **Apontamentos de Horas & Embarques** (`apontamentos_hh`, `carteira_operacoes`, `carteira_embarques`, `confirmacoes_sap`) | Técnicos offshore | Matrícula, nome completo (em `carteira_operacoes`), datas início/fim de embarque, plataforma, UN, horas programadas/executadas/SAP *(campo `chave_petrobras` descartado na ingestão e higienizado na Migration 032)* | Não | **Art. 7º, V** (Execução do contrato de prestação de serviços) e **Art. 7º, II** (Apuração de jornada e memória fiscal/trabalhista) | Prepostos/Controladores apenas das respectivas plataformas; Gestores e Contratante para medição USOFF | **5 a 10 anos** para preservação contratual/trabalhista; nomes em `carteira_operacoes` são substituídos por `"Técnico Anonimizado (LGPD)"` no expurgo ou sob demanda |
| **T-03** | **Justificativas Operacionais e Histórico** (`justificativas`, `justificativas_audit_log`) | Técnicos offshore e responsáveis pelo lançamento | Matrícula, data, motivo estruturado *(ex.: "Atestado / Afastamento médico" sem clínica, "Desembarque por questão de saúde" sem clínica)*, descrição operacional, `responsavel_nome` | **Risco controlado:** sistema proíbe CID/diagnósticos (`validateJustificativaNoHealthPii`) e mascara exportações | **Art. 7º, V** (Justificativa de divergência HH) e **Art. 7º, II** (Regulação trabalhista/segurança marítima) | Restrito à plataforma/UN de vínculo (Preposto/Controlador); trilha `justificativas_audit_log` restrita a **Admin** | Textos livres em `descricao` higienizados para `"[Expurgado por retenção LGPD]"` após **5 anos** ou imediatamente via `anonimizar_tecnico_lgpd` |
| **T-04** | **Usuários, Perfis e Escopos Operacionais** (`profiles`, `user_onboarding`, `pessoas`, `pessoa_plataformas`, `pessoa_unidades`) | Empregados/Gestores usuários do sistema (Admin, Gestor, Controlador, Preposto) | UUID, e-mail corporativo, nome completo, papel RBAC, status `ativo`, timestamps de troca de senha, plataformas/UNs atribuídas | Não | **Art. 7º, V e IX** (Segurança da informação e controle de acesso ao ambiente corporativo) | Provedor de Autenticação/Banco (Supabase / self-hosted PostgreSQL) | Durante vigência do acesso; desativação corta sessão em 0ms no RLS (`auth_is_active()`); exclusão remove de `auth.users`, `profiles` e desvincula de `pessoas` |
| **T-05** | **Trilha Imutável de Auditoria WORM** (`system_audit_logs`) | Atores autenticados e técnicos (apenas matrícula, sem PII nova) | `actor_id`, `actor_nome`, `actor_email`, `actor_role`, ação, categoria, `target_id`, `ip_address` | Não | **Art. 7º, II** (Marco Civil da Internet — Art. 15 quando aplicável — e prestação de contas Art. 6º X) e **Art. 7º, IX** (Segurança e prevenção à fraude) | **Acesso restrito exclusivamente ao perfil `admin`** (Migration 029); armazenado no PostgreSQL gerenciado | Registro de eventos mantido sob política **WORM**; campo `ip_address` é automaticamente expurgado (`NULL`) após **12 meses** via `executar_retencao_lgpd` |
| **T-06** | **Destinatários de Boletim Executivo** (`configuracoes_notificacao`) | Gestores e executivos autorizados | Lista de e-mails corporativos de envio de resumo | Não | **Art. 7º, IX** (Legítimo interesse corporativo operacional) | Visível apenas para `admin` e `gestor`; nunca exposto a prepostos/controladores ou `anon` | Enquanto o destinatário exercer função de acompanhamento gerencial |

---

## 3. Medidas Técnicas e Organizacionais Aplicadas (Art. 46 da LGPD)

1. **Zero-Trust RLS & Least Privilege:** `anon` sem leitura de tabelas com dados pessoais (`tecnicos`, `confirmacoes_sap`, `system_audit_logs`, `justificativas_audit_log`, `profiles`); acesso de `preposto` e `controlador` estritamente limitado às plataformas/UNs atribuídas.
2. **Minimização na Ingestão e Exportação:** descarte de `chave_petrobras` no parser de importação (`client-pipeline.ts` / `server`), mascaramento de descrições sensíveis de saúde nas exportações Excel/JSON (`maskHealthDescriptionForExport`) e ausência de matrícula/observações médicas em URLs de e-mail (`mailto:`/Outlook Web).
3. **Sem Vazamento para CDNs de Terceiros:** fontes corporativas (`Montserrat` e `Source Sans 3`) empacotadas localmente via `@fontsource/*`, CSP bloqueando domínios externos de fontes e Service Worker estrito apenas same-origin.
4. **Higiene de Sessão e Senhas:** auto-logout em **30 minutos** de inatividade, troca obrigatória de senha provisória no primeiro login, política de senha forte (mínimo 8 caracteres com letras e números) e TTL configurável no modo self-hosted (`SESSION_TTL_HOURS`).
5. **Auditoria WORM & Anonimização:** gatilho anti-alteração em `system_audit_logs`, proibição de gravação de PII em logs de alteração de técnicos e RPCs transacionais `anonimizar_tecnico_lgpd` e `executar_retencao_lgpd`.

---

## 4. Fluxo de Transferência Internacional (Art. 33 / Res. CD/ANPD nº 19/2024)

Na topologia padrão **BaaS + GitHub Pages**:
- **Frontend estático (GitHub Pages CDN):** distribui apenas código HTML/JS/CSS e fontes estáticas, sem armazenar dados contratuais ou pessoais no servidor de arquivos.
- **Backend/Banco (Supabase · região `sa-east-1` / infraestrutura gerenciada):** consultar subcontratados e cláusulas contratuais padrão (DPA / Standard Contractual Clauses do provedor) ou optar pela topologia **Self-Hosted Docker/VPS em território nacional (`VITE_TOPOLOGY=self-hosted`)** para soberania integral de dados.

---

## 5. Registro de Aprovação Corporativa *(Preencher na adoção)*

- **Área Gestora do Contrato:** ___________________________ Data: ____/____/______  
- **Encarregado pelo Tratamento de Dados (DPO):** ___________________________ Data: ____/____/______
