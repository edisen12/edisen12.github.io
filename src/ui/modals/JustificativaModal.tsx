import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { Modal } from '../components/Modal';
import { MOTIVOS_JUSTIFICATIVA } from '../../config/constants';
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
  const [responsavel, setResponsavel] = useState<string>('');
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
        setResponsavel(existingJust.responsavel_nome || userProfile?.nome || '');
        setDescricao(existingJust.descricao || '');
      } else {
        setMotivo(MOTIVOS_JUSTIFICATIVA[0]);
        setHorasGw(String(faltaHoras));
        setResponsavel(userProfile?.nome || '');
        setDescricao('');
      }
    }
  }, [justModal, mat, dateIso, existingJust, faltaHoras, userProfile]);

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
        responsavel_nome: responsavel.trim() || userProfile?.nome || 'Gestão do contrato'
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
      title={`Justificar · ${nomeTecnico}`}
      maxWidth={640}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
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
            {isSaving ? 'Salvando...' : 'Salvar justificativa'}
          </button>
        </div>
      }
    >
      <div>
        {/* Painel de fatos do dia */}
        <div
          className="facts"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '10px',
            background: 'var(--surface-alt)',
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '18px'
          }}
        >
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Data</span>
            <b style={{ fontSize: '0.95rem' }}>{formatBr(dateIso)}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Plataforma</span>
            <b style={{ fontSize: '0.95rem' }}>{loc.p}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Disponível</span>
            <b style={{ fontSize: '0.95rem' }}>{formatHours(r?.d)}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Executado</span>
            <b style={{ fontSize: '0.95rem' }}>{r?.sem ? '0 h (não chegou)' : formatHours(r?.e)}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>% do dia</span>
            <b style={{ fontSize: '0.95rem' }}>{formatPct(calcPct(r?.e || 0, r?.d || 1))}</b>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', display: 'block' }}>Acumulado</span>
            <b style={{ fontSize: '0.95rem' }}>
              {acc ? `${formatPct(acc.p)} (${formatSignedHours(acc.saldo)})` : '—'}
            </b>
          </div>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
              Motivo
            </label>
            <select
              value={motivo}
              onChange={e => {
                const newM = e.target.value;
                setMotivo(newM);
                if (newM === 'Gangway desconectada' && !horasGw) {
                  setHorasGw(String(faltaHoras));
                }
              }}
              className="input-select"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
            >
              {MOTIVOS_JUSTIFICATIVA.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {isGw && (
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Horas de gangway desconectada (passo 0.5 h)
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                max={r?.d || 24}
                value={horasGw}
                onChange={e => setHorasGw(e.target.value)}
                placeholder="Ex: 4.5"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
              Responsável pela justificativa
            </label>
            <input
              type="text"
              value={responsavel}
              onChange={e => setResponsavel(e.target.value)}
              placeholder="Nome do preposto ou responsável"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
              Descrição {motivo === 'Outro' ? <span style={{ color: 'var(--bad)' }}>(obrigatória para &quot;Outro&quot;)</span> : '(opcional)'}
            </label>
            <textarea
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="O que aconteceu no dia"
              rows={3}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical' }}
            />
          </div>

          {errorMsg && (
            <div style={{ color: 'var(--bad)', fontSize: '0.85rem', fontWeight: 600 }}>
              {errorMsg}
            </div>
          )}
        </form>
      </div>
    </Modal>
  );
}
