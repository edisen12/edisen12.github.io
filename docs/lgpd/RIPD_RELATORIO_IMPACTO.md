# Relatório de Impacto à Proteção de Dados Pessoais (RIPD / DPIA — Art. 38 da LGPD)

**Projeto / Sistema:** HH Offshore · Controle Operacional e Medição USOFF  
**Controladora:** Infotec Brasil *(preencher na formalização interna)*  
**Escopo Técnico Auditado:** Frontend React/Vite (`src/`), Migrations PostgreSQL (`001`–`032`), Edge Function `admin-users` e API Self-Hosted (`server/`)

---

## 1. Motivo da Elaboração do RIPD

Embora o sistema trate primordialmente dados funcionais necessários à execução contratual offshore, há dois vetores que justificam avaliação formal de impacto (Art. 5º XVII e Art. 38 da LGPD):
1. **Monitoramento contínuo de localização/período de embarque e vínculo contratual** de técnicos alocados em unidades marítimas (risco indireto à privacidade se exposto além da necessidade operacional).
2. **Risco de inserção acidental de dados sensíveis de saúde (Art. 5º II e Art. 11)** em campos de descrição livre ao justificar faltas/desembarques por atestado ou emergência médica.

---

## 2. Matriz de Riscos Identificados e Controles Implementados

| Código | Risco Mapeado | Probabilidade / Impacto Inicial | Controles Técnicos Implementados no Código & Banco | Risco Residual |
|---|---|---|---|---|
| **R-01** | **Exposição excessiva do cadastro completo de técnicos e confirmações SAP** a usuários de escopo restrito (`preposto` / `controlador`) ou à role pública `anon` | Alta / Alto | **Migrations 029 e 030:** `tecnicos_select_policy` e `confirmacoes_sap_select_policy` filtram estritamente por vínculo com plataformas/UNs do usuário autenticado; política legada `tecnicos_select` removida; `anon` sem privilégios de leitura. | **Baixo** |
| **R-02** | **Armazenamento ou exportação de chave/credencial de sistema terceiro (`chave_petrobras`)** em planilhas e banco | Alta / Médio | Parser de importação descarta `chave_petrobras`; exportações Excel forçam valor vazio; **Migration 032** realizou limpeza retroativa das **2.524 linhas** legadas em `carteira_operacoes`. | **Residual Mínimo** |
| **R-03** | **Inserção de dados pessoais sensíveis de saúde (CID, diagnósticos, sintomas, laudos)** em `justificativas.descricao` e exposição em exportações/URLs | Média / Muito Alto (Art. 11) | Separação de motivo estruturado sem dado clínico; bloqueio síncrono client + server (`validateJustificativaNoHealthPii`); bloqueio no URL `mailto:`/Outlook (`summarizeJustificativaForMailUrl`); mascaramento em Excel/JSON (`maskHealthDescriptionForExport`). | **Baixo** *(depende também de treinamento operacional contra textos clínicos não-padrão)* |
| **R-04** | **Acesso por não-administradores a endereços IP e payloads da trilha WORM / gravação de nome em log** | Média / Médio-Alto | **Migration 029 + UI:** aba `adm` restrita a `adminOnly: true`; RLS `system_audit_logs` e `justificativas_audit_log` restritos a `auth_is_admin()`; `fn_audit_tecnicos` grava apenas `matricula`, `funcao` e `ativo`. | **Baixo** |
| **R-05** | **Sessões abandonadas em estações compartilhadas de bordo / salas de controle** | Alta / Alto | Auto-logout após **30 min** de inatividade; suporte opcional a `VITE_AUTH_STORAGE=session` (`sessionStorage`); TTL configurável em `self-hosted` (`SESSION_TTL_HOURS`, padrão 8h); logout limpa contexto em memória. | **Baixo** *(requer ativação opcional de MFA para contas administrativas no painel Supabase Auth)* |
| **R-06** | **Retenção indefinida de textos antigos e endereços IP em auditoria WORM** | Média / Médio | **Migration 032 (`executar_retencao_lgpd`):** expurgo controlado de `ip_address` > 12 meses na trigger WORM; higienização de descrições > 5 anos; anonimização de técnicos inativos além da janela; acionamento manual em `AdminAuditView` ("Privacidade & LGPD") ou cron mensal via GitHub Actions. | **Baixo** |
| **R-07** | **Divulgação passiva de IP de usuários para CDNs externas de fontes (Google Fonts)** | Média / Baixo | Fontes `Montserrat` e `Source Sans 3` empacotadas no bundle (`@fontsource/*`); CSP e `public/sw.js` endurecidos para `'self'` (zero chamadas para `fonts.googleapis.com` / `fonts.gstatic.com`). | **Eliminado** |
| **R-08** | **Falha na recuperação após desastre ou exclusão acidental ("Backup sem teste de restore")** | Baixa / Crítico | Script `scripts/backup-and-verify-restore.sh` e workflow `.github/workflows/database-backup-verify.yml` com verificação automática em banco PostgreSQL efêmero + guia `docs/DATABASE_BACKUP_AND_DR.md`. | **Controlado** *(ativar PITR no Supabase e/ou secret `SOURCE_DATABASE_URL`)* |

---

## 3. Recomendações Pendentes de Governança Corporativa (Não Automatizáveis por Código)

1. **Habilitar no Painel Supabase Auth:** *Leaked Password Protection (HaveIBeenPwned)* e exigir **MFA/2FA (TOTP)** ao menos para usuários `admin` e `gestor`.
2. **Assinar DPAs / Avaliar Transferência Internacional:** validar o *Data Processing Addendum* da plataforma hospedeira (Supabase Inc. / GitHub Inc.) conforme Resolução CD/ANPD nº 19/2024, ou implantar a stack **Self-Hosted Docker** já pronta em infraestrutura no Brasil.
3. **Nomear DPO (Art. 41):** registrar formalmente o Encarregado e preencher o campo **"Canal do Encarregado (DPO)"** na aba administrativa *Privacidade & LGPD*.

---

## 4. Parecer Conclusivo

Considerando as salvaguardas técnicas implantadas (Zero-Trust RLS, separação de saúde, bloqueio de CID, anonimização sob demanda e retenção controlada), o tratamento apresenta **nível de risco compatível e mitigado**, desde que acompanhado das medidas organizacionais listadas na Seção 3.
