import React, { useState, useEffect, useMemo } from 'react';
import { UserCheck, Clock, FileText } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { Modal } from '../components/Modal';
import { MOTIVOS_JUSTIFICATIVA, ROLES_LABEL } from '../../config/constants';
import {
  accumulateEmbarkation,
  inferEmbarkation,
  resolveLocation,
  resolveRecord,
  resolveTechName
} from '../../domain/calculations';
import { formatBr } from '../../utils/date';
import {
  calcPct,
  formatHours,
  formatPct,
  formatSignedHours
} from '../../utils/format';
import { saveJustificativa } from '../../services/data.service';

export function JustificativaModal() {
  const {
    justModal,
    closeJustModal,
    dataset,
    pidx,
    userProfile,
    reloadDataset
  } = useApp();

  const { showToast } = useToast();

  const mat = justModal?.mat || '';
  const dateIso = justModal?.date || '';

  // Busca dados do dia e justificativa existente
  const r = useMemo(() => {
    if (!mat || !dateIso) return null;
    return resolveRecord(mat, dateIso, dataset) || { d: dataset.config.hh_dia, e: 0, p: '', r: '', sem: false };
  }, [mat, dateIso, dataset]);

  const existingJust = useMemo(() => {
    if (!mat || !dateIso) return null;
    return dataset.justMap[`${mat}|${dateIso}`] || null;
  }, [mat, dateIso, dataset]);

  const loc = useMemo(() => {
    if (!mat || !dateIso) return { p: '', r: '' };
    return resolveLocation(mat, dateIso, dataset, pidx);
  }, [mat, dateIso, dataset, pidx]);

  const acc = useMemo(() => {
    if (!mat || !dateIso) return null;
    const emb = inferEmbarkation(mat, dateIso, dataset);
    return emb ? accumulateEmbarkation(mat, dateIso, emb, dataset) : null;
  }, [mat, dateIso, dataset]);

  const faltaHoras = Math.max(0, (r?.d || 0) - (r?.e || 0));

  // Estados do formulário
  const [motivo, setMotivo] = useState<string>(MOTIVOS_JUSTIFICATIVA[0]);
  const [horasGw, setHorasGw] = useState<string>('');
  const [descricao, setDescricao] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Sincroniza estado inicial ao abrir modal
  useEffect(() => {
    if (justModal && mat && dateIso) {
      setErrorMsg('');
      if (existingJust) {
        setMotivo(existingJust.motivo || MOTIVOS_JUSTIFICATIVA[0]);
        setHorasGw(existingJust.horas_gangway ? String(existingJust.horas_gangway) : '');
        setDescricao(existingJust.descricao || '');
      } else {
        setMotivo(MOTIVOS_JUSTIFICATIVA[0]);
        setHorasGw(String(faltaHoras));
        setDescricao('');
      }
    }
  }, [justModal, mat, dateIso, existingJust, faltaHoras]);

  if (!justModal || !mat || !dateIso) return null;

  const nomeTecnico = resolveTechName(mat, dataset);
  const isGw = motivo === 'Gangway desconectada';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!motivo) {
      setErrorMsg('Selecione um motivo.');
      return;
    }

    if (motivo === 'Outro' && !descricao.trim()) {
      setErrorMsg('A descrição é obrigatória quando o motivo for "Outro".');
      return;
    }

    const gwVal = isGw && horasGw ? parseFloat(horasGw.replace(',', '.')) : 0;
    if (isGw && (isNaN(gwVal) || gwVal < 0 || gwVal > (r?.d || 24))) {
      setErrorMsg(`Horas de gangway deve ser um valor entre 0 e ${r?.d || 24} h.`);
      return;
    }

    setIsSaving(true);
    try {
      await saveJustificativa({
        matricula: mat,
        data: dateIso,
        motivo,
        horas_gangway: gwVal,
        descricao: descricao.trim(),
        responsavel_nome: userProfile?.nome || existingJust?.responsavel_nome || 'Gestão do contrato'
      });

      showToast('Justificativa salva com sucesso!', 'success');
      await reloadDataset();
      closeJustModal();
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Erro ao salvar justificativa: ' + (err.message || 'Falha de comunicação.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={!!justModal}
      onClose={closeJustModal}
      icon={<FileText size={20} />}
      title={`Justificar Apontamento · ${nomeTecnico}`}
      subtitle={`Data: ${formatBr(dateIso)} · Plataforma: ${loc.p}`}
      maxWidth={640}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={closeJustModal}
            disabled={isSaving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Salvando…' : 'Salvar justificativa'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Painel de fatos do dia */}
        <div
          className="facts"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '10px',
            background: 'var(--surface-alt)',
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--line)'
          }}
        >
          <div>
            <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', fontWeight: 600 }}>Data</span>
            <b style={{ fontSize: '0.92rem', color: 'var(--ink)' }}>{formatBr(dateIso)}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', fontWeight: 600 }}>Plataforma</span>
            <b style={{ fontSize: '0.92rem', color: 'var(--blue)' }}>{loc.p}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', fontWeight: 600 }}>Disponível</span>
            <b style={{ fontSize: '0.92rem' }}>{formatHours(r?.d)}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', fontWeight: 600 }}>Executado</span>
            <b style={{ fontSize: '0.92rem', color: r?.sem ? 'var(--bad)' : undefined }}>
              {r?.sem ? '0 h (não chegou)' : formatHours(r?.e)}
            </b>
          </div>
          <div>
            <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', fontWeight: 600 }}>% do dia</span>
            <b style={{ fontSize: '0.92rem' }}>{formatPct(calcPct(r?.e || 0, r?.d || 1))}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', display: 'block', fontWeight: 600 }}>Acumulado</span>
            <b style={{ fontSize: '0.92rem' }}>
              {acc ? `${formatPct(acc.p)} (${formatSignedHours(acc.saldo)})` : '—'}
            </b>
          </div>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label className="fld">
            <span>
              <span>Motivo da divergência</span>
              <span className="fld-hint">Obrigatório</span>
            </span>
            <select
              value={motivo}
              onChange={e => {
                const newM = e.target.value;
                setMotivo(newM);
                if (newM === 'Gangway desconectada' && !horasGw) {
                  setHorasGw(String(faltaHoras));
                }
              }}
              className="form-select"
            >
              {MOTIVOS_JUSTIFICATIVA.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          {isGw && (
            <label className="fld">
              <span>
                <span>Horas de gangway desconectada</span>
                <span className="fld-hint">Passo de 0.5 h (máx: {formatHours(r?.d || 24)})</span>
              </span>
              <div className="input-with-icon">
                <span className="input-icon-left">
                  <Clock size={16} />
                </span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max={r?.d || 24}
                  value={horasGw}
                  onChange={e => setHorasGw(e.target.value)}
                  placeholder="Ex: 4.5"
                  className="form-input"
                  required
                />
              </div>
            </label>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: 'var(--surface-alt)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--line)'
            }}
          >
            <UserCheck size={18} style={{ color: 'var(--blue)', flexShrink: 0 }} />
            <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
              <span style={{ color: 'var(--ink-muted)' }}>Responsável pelo registro: </span>
              <strong style={{ color: 'var(--ink)' }}>{userProfile?.nome || 'Usuário Atual'}</strong>
              <span style={{ color: 'var(--ink-muted)', fontSize: '0.78rem' }}>
                {' '}· {ROLES_LABEL[userProfile?.role || 'preposto'] || userProfile?.role}
              </span>
            </div>
          </div>

          <label className="fld">
            <span>
              <span>Descrição {motivo === 'Outro' ? <strong style={{ color: 'var(--bad)' }}>(obrigatória para &quot;Outro&quot;)</strong> : '(opcional)'}</span>
              <span className="fld-hint">Detalhes operacionais</span>
            </span>
            <textarea
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="O que aconteceu no dia…"
              rows={3}
              className="form-textarea"
            />
          </label>

          {errorMsg && (
            <div className="note note-bad">
              {errorMsg}
            </div>
          )}
        </form>
      </div>
    </Modal>
  );
}
