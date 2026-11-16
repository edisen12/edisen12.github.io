import React from 'react';
import { ShieldCheck, Lock, Globe, FileCheck2, UserCheck, Mail } from 'lucide-react';
import { Modal } from '../components/Modal';

export interface PrivacyNoticeModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Aviso de Privacidade Corporativo e Diretrizes LGPD (Lei nº 13.709/2018).
 */
export function PrivacyNoticeModal({ open, onClose }: PrivacyNoticeModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Aviso de Privacidade e Conformidade LGPD"
      subtitle="Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018) · Operação HH Offshore"
      icon={<ShieldCheck size={20} color="var(--blue)" />}
      maxWidth={720}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Entendi
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.86rem', lineHeight: 1.5, color: 'var(--ink-secondary)' }}>
        <div className="note note-blue" style={{ margin: 0 }}>
          <b>Controladora e Finalidade:</b> Este sistema é operado pela <b>Infotec Brasil</b> exclusivamente para gestão operacional, apuração de horas executadas (HH), consolidação contratual (USOFF) e auditoria de embarques offshore, em cumprimento de obrigações legais/trabalhistas e execução contratual (<b>Art. 7º, II e V da LGPD</b>).
        </div>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink)', fontWeight: 700, marginBottom: '4px' }}>
            <UserCheck size={16} color="var(--blue)" />
            <span>1. Dados Tratados e Regra de Dados Sensíveis (Art. 5º II e Art. 11)</span>
          </div>
          <p style={{ margin: 0 }}>
            São tratados apenas dados funcionais estritamente necessários: identificação corporativa de usuários autorizados (nome, e-mail e perfil), matrícula funcional, nome completo, função e datas/horas de embarque de técnicos offshore.
            <b> É proibido registrar códigos CID, diagnósticos clínicos, sintomas ou laudos médicos</b> nos campos de descrição livre das justificativas operacionais. Registros de credenciais de sistemas terceiros não são armazenados em claro após importação.
          </p>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink)', fontWeight: 700, marginBottom: '4px' }}>
            <Lock size={16} color="var(--blue)" />
            <span>2. Controle de Acesso, Minimização e Sessão (Art. 6º III e Art. 46)</span>
          </div>
          <p style={{ margin: 0 }}>
            Prepostos e controladores visualizam exclusivamente os técnicos, ordens SAP e justificativas pertencentes às suas plataformas e Unidades de Negócio (Zero-Trust RLS). Trilhas de auditoria WORM e dados de acesso administrativos são restritos a Administradores do sistema. Em estações compartilhadas de bordo ou salas de controle, a sessão é encerrada automaticamente após <b>30 minutos de inatividade</b>.
          </p>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink)', fontWeight: 700, marginBottom: '4px' }}>
            <Globe size={16} color="var(--blue)" />
            <span>3. Compartilhamento Contratual e Transferência Internacional (Art. 33 e Res. ANPD nº 19/2024)</span>
          </div>
          <p style={{ margin: 0 }}>
            Os consolidados operacionais e de medição são compartilhados estritamente dentro do escopo contratual com a contratante (Petrobras) e armadores responsáveis pelas unidades. Os arquivos estáticos da interface e serviços em nuvem utilizados para hospedagem e banco de dados podem envolver infraestrutura internacional protegida por criptografia em trânsito (TLS), controle de acesso por linha (RLS) e cláusulas contratuais aplicáveis. Não encaminhe relatórios ou listas nominais por aplicativos pessoais de mensagens.
          </p>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink)', fontWeight: 700, marginBottom: '4px' }}>
            <FileCheck2 size={16} color="var(--blue)" />
            <span>4. Retenção, Anonimização e Direitos do Titular (Art. 15, 16 e 18)</span>
          </div>
          <p style={{ margin: 0 }}>
            Registros de medição contratual, trilhas fiscais e apontamentos trabalhistas são mantidos pelo prazo legal aplicável, podendo ter a identificação pessoal anonimizada pela administração mediante solicitação fundamentada, sem prejuízo das obrigações legais vigentes. O titular pode solicitar confirmação, acesso, retificação ou eliminação/anonimização nos termos do Art. 18 da LGPD.
          </p>
        </section>

        <section style={{ borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink)', fontWeight: 700, marginBottom: '4px' }}>
            <Mail size={16} color="var(--blue)" />
            <span>5. Canal de Atendimento e Encarregado pelo Tratamento (DPO — Art. 41)</span>
          </div>
          <p style={{ margin: 0 }}>
            Para exercer direitos previstos na LGPD, reportar incidentes de privacidade ou solicitar esclarecimentos sobre este aviso, contate o Encarregado pelo Tratamento de Dados (DPO) ou a Administração do Contrato da <b>Infotec Brasil</b> através dos canais internos corporativos de Governança e Compliance.
          </p>
        </section>
      </div>
    </Modal>
  );
}
