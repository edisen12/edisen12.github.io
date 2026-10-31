import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { Modal } from '../components/Modal';
import { StatusPill } from '../components/StatusPill';
import { PAPEIS_LABEL } from '../../config/constants';
import type { Pessoa } from '../../domain/types';
import {
  buildCobrancaMailPayload,
  buildDailyMailPayload,
  buildMailLinks
} from '../../domain/communications';
import { formatBr } from '../../utils/date';
import { plural } from '../../utils/format';

export function EmailComposerModal() {
  const {
    emailModal,
    closeEmailModal,
    dataset,
    pidx,
    activePeriod,
    userProfile
  } = useApp();

  const { showToast } = useToast();

  const mode = emailModal?.mode;
  const date = emailModal?.date || '';
  const plats = emailModal?.plats || [];
  const targetRespId = emailModal?.targetRespId;

  // Gera o payload inicial com base no modo
  const initialData = useMemo(() => {
    if (!emailModal) return null;

    if (mode === 'daily') {
      return buildDailyMailPayload(
        date,
        plats,
        dataset,
        pidx,
        userProfile?.nome
      );
    }

    if (mode === 'cobranca') {
      const target: Pessoa | '*' | null =
        targetRespId === '*'
          ? '*'
          : targetRespId
          ? dataset.pessoas[targetRespId] || null
          : null;

      return buildCobrancaMailPayload(
        target,
        activePeriod,
        dataset,
        pidx,
        userProfile?.nome
      );
    }

    return null;
  }, [emailModal, mode, date, plats, targetRespId, dataset, pidx, userProfile, activePeriod]);

  // Estados editáveis do modal
  const [toInput, setToInput] = useState('');
  const [subjectInput, setSubjectInput] = useState('');
  const [bodyInput, setBodyInput] = useState('');

  useEffect(() => {
    if (initialData) {
      setToInput(initialData.to.join('; '));
      setSubjectInput(initialData.subj);
      setBodyInput(initialData.body);
    }
  }, [initialData]);

  // Links do Outlook Web e Desktop
  const mailLinks = useMemo(() => {
    return buildMailLinks(toInput, subjectInput, bodyInput);
  }, [toInput, subjectInput, bodyInput]);

  if (!emailModal || !initialData) return null;

  const ppl = initialData.ppl;
  const semMail = ppl.filter(p => !p.email);

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copiado para a área de transferência!`, 'success');
    } catch {
      showToast('Falha ao copiar automaticamente.', 'warn');
    }
  };

  const title = mode === 'daily' ? 'E-mail aos responsáveis' : 'Cobrança de justificativas';

  const subtitle =
    mode === 'daily' ? (
      <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginTop: '2px' }}>
        {plats.join(', ')} · {formatBr(date)} · {plural((initialData as any).rows?.length || 0, 'técnico', 'técnicos')} abaixo das horas
      </div>
    ) : (
      <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginTop: '2px' }}>
        {targetRespId === '*'
          ? `${plural(ppl.length, 'responsável', 'responsáveis')} com pendência`
          : ppl[0]?.nome || 'Responsável'}{' '}
        · {plural((initialData as any).pendentesCount || 0, 'dia pendente', 'dias pendentes')}
        {(initialData as any).vencidosCount > 0 && (
          <span style={{ color: 'var(--bad)', fontWeight: 600 }}>
            {' '}· {(initialData as any).vencidosCount} vencidos
          </span>
        )}
      </div>
    );

  return (
    <Modal
      open={!!emailModal}
      onClose={closeEmailModal}
      title={
        <div>
          <div>{title}</div>
          {subtitle}
        </div>
      }
      maxWidth={720}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => handleCopy(toInput, 'Destinatários')}
            >
              Copiar destinatários
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => handleCopy(bodyInput, 'Texto')}
            >
              Copiar texto
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeEmailModal}
            >
              Fechar
            </button>
            <a
              href={mailLinks.outlookWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-accent"
              style={{ textDecoration: 'none' }}
            >
              Abrir no Outlook na web
            </a>
            <a
              href={mailLinks.mailtoUrl}
              className="btn btn-primary"
              style={{ textDecoration: 'none' }}
            >
              Abrir no Outlook
            </a>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Chips dos responsáveis */}
        {ppl.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {ppl.map(p => (
              <span
                key={p.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  borderRadius: '12px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: p.email ? 'var(--blue-soft)' : 'var(--bad-bg)',
                  color: p.email ? 'var(--blue)' : 'var(--bad)'
                }}
              >
                <span>{PAPEIS_LABEL[p.papel] || 'Preposto'}:</span>
                <span>{p.nome}</span>
                {!p.email && <span style={{ fontWeight: 700 }}>(sem e-mail)</span>}
              </span>
            ))}
          </div>
        ) : (
          <div className="note note-bad" style={{ fontSize: '0.85rem' }}>
            Nenhum preposto, controlador ou gestor está associado a esta plataforma.
          </div>
        )}

        {/* Alerta de pessoas sem e-mail */}
        {semMail.length > 0 && (
          <div className="note note-warn" style={{ fontSize: '0.82rem' }}>
            <b>Atenção:</b> {semMail.map(p => p.nome).join(', ')} sem e-mail cadastrado no sistema.
          </div>
        )}

        {/* Campos de envio */}
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: '4px' }}>
            Para
          </label>
          <input
            type="text"
            value={toInput}
            onChange={e => setToInput(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: '4px' }}>
            Assunto
          </label>
          <input
            type="text"
            value={subjectInput}
            onChange={e => setSubjectInput(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: '4px' }}>
            Texto
          </label>
          <textarea
            value={bodyInput}
            onChange={e => setBodyInput(e.target.value)}
            rows={10}
            style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem', lineHeight: 1.5 }}
          />
        </div>

        <p className="sub" style={{ margin: 0, fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
          Se o Outlook não abrir sozinho, copie os destinatários e o texto e cole numa mensagem nova. Textos muito longos podem ser cortados ao abrir via link: nesse caso, use &quot;Copiar texto&quot;.
        </p>
      </div>
    </Modal>
  );
}
