import React, { useState, useEffect, useMemo } from 'react';
import {
  Settings2,
  Sliders,
  CalendarCheck,
  Calculator,
  Mail,
  HelpCircle,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Building2,
  Plus,
  Trash2,
  Info,
  Clock,
  Target,
  Send,
  FileSpreadsheet,
  Check
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import { saveConfiguracoes } from '../../services/data.service';
import { OPCOES_DIA_CORTE } from '../../config/constants';
import type { ContractConfig, DiaCorteMedicao, MedCriterio, UsoffUnWeight } from '../../domain/types';
import { formatHours } from '../../utils/format';

type ConfigTab = 'geral' | 'ciclo' | 'usoff' | 'comunicacao' | 'memorial';

export const ConfiguracoesView: React.FC = () => {
  const { dataset, isGlobal, isAdmin, refreshData } = useApp();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<ConfigTab>('geral');
  const [saving, setSaving] = useState(false);

  // Estados locais do formulário de regras
  const [hhDia, setHhDia] = useState<number>(11);
  const [metaPercentual, setMetaPercentual] = useState<number>(100);
  const [atencaoPercentual, setAtencaoPercentual] = useState<number>(90);
  const [prazoJustificativa, setPrazoJustificativa] = useState<number>(2);
  const [diasEmbarque, setDiasEmbarque] = useState<number>(14);
  const [diaCorte, setDiaCorte] = useState<DiaCorteMedicao>(21);
  const [medCriterio, setMedCriterio] = useState<MedCriterio>('enc');
  const [usPePadrao, setUsPePadrao] = useState<string>('');
  const [usExPadrao, setUsExPadrao] = useState<string>('');
  const [slogan, setSlogan] = useState<string>('');

  // Lista de e-mails como array interativo de chips
  const [emailsList, setEmailsList] = useState<string[]>([]);
  const [novoEmailInput, setNovoEmailInput] = useState<string>('');
  const [bulkEmailMode, setBulkEmailMode] = useState<boolean>(false);
  const [bulkEmailText, setBulkEmailText] = useState<string>('');

  // Grade estruturada de pesos por Unidade de Negócio
  const [unWeightsList, setUnWeightsList] = useState<Array<{ un: string; pe: string; ex: string }>>([]);
  const [novaUn, setNovaUn] = useState<string>('');

  // Carrega configurações do dataset
  const resetToDataset = () => {
    if (dataset.config) {
      const c = dataset.config;
      setHhDia(c.hh_dia || 11);
      setMetaPercentual(c.meta_percentual || 100);
      setAtencaoPercentual(c.atencao_percentual || 90);
      setPrazoJustificativa(c.prazo_justificativa_dias || 2);
      setDiasEmbarque(c.dias_embarque || 14);
      setDiaCorte((c.dia_corte_medicao as DiaCorteMedicao) || 21);
      setMedCriterio((c.med_criterio as MedCriterio) || 'enc');
      setUsPePadrao(c.us_pe_padrao != null ? String(c.us_pe_padrao) : '');
      setUsExPadrao(c.us_ex_padrao != null ? String(c.us_ex_padrao) : '');
      setSlogan(c.slogan || '');
    }

    if (dataset.emailsResumo) {
      const cleaned = dataset.emailsResumo.map(e => e.trim().toLowerCase()).filter(Boolean);
      setEmailsList(cleaned);
      setBulkEmailText(cleaned.join('\n'));
    }

    const allKnownUns = new Set<string>();
    Object.values(dataset.plataformas).forEach(p => {
      if (p.un && p.un.trim()) allKnownUns.add(p.un.trim());
    });
    Object.keys(dataset.usoffUnWeights || {}).forEach(u => {
      if (u && u.trim()) allKnownUns.add(u.trim());
    });

    const sortedUns = Array.from(allKnownUns).sort((a, b) => a.localeCompare(b));
    const items = sortedUns.map(un => {
      const existing = dataset.usoffUnWeights[un];
      return {
        un,
        pe: existing?.pe != null ? String(existing.pe) : '',
        ex: existing?.ex != null ? String(existing.ex) : ''
      };
    });

    setUnWeightsList(items);
  };

  useEffect(() => {
    resetToDataset();
  }, [dataset.config, dataset.emailsResumo, dataset.plataformas, dataset.usoffUnWeights]);

  // Detector de alterações pendentes (Dirty State)
  const isDirty = useMemo(() => {
    if (!dataset.config) return false;
    const c = dataset.config;
    if (hhDia !== (c.hh_dia || 11)) return true;
    if (metaPercentual !== (c.meta_percentual || 100)) return true;
    if (atencaoPercentual !== (c.atencao_percentual || 90)) return true;
    if (prazoJustificativa !== (c.prazo_justificativa_dias || 2)) return true;
    if (diasEmbarque !== (c.dias_embarque || 14)) return true;
    if (diaCorte !== ((c.dia_corte_medicao as DiaCorteMedicao) || 21)) return true;
    if (medCriterio !== ((c.med_criterio as MedCriterio) || 'enc')) return true;
    if (usPePadrao !== (c.us_pe_padrao != null ? String(c.us_pe_padrao) : '')) return true;
    if (usExPadrao !== (c.us_ex_padrao != null ? String(c.us_ex_padrao) : '')) return true;
    if (slogan !== (c.slogan || '')) return true;

    const originalEmails = (dataset.emailsResumo || []).map(e => e.trim().toLowerCase()).sort().join('|');
    const currentEmails = emailsList.map(e => e.trim().toLowerCase()).sort().join('|');
    if (originalEmails !== currentEmails) return true;

    return false;
  }, [
    dataset.config,
    dataset.emailsResumo,
    hhDia,
    metaPercentual,
    atencaoPercentual,
    prazoJustificativa,
    diasEmbarque,
    diaCorte,
    medCriterio,
    usPePadrao,
    usExPadrao,
    slogan,
    emailsList
  ]);

  // Manipulação de E-mails
  const handleAddEmail = () => {
    const raw = novoEmailInput.trim().toLowerCase();
    if (!raw) return;
    if (!raw.includes('@') || !raw.includes('.')) {
      showToast('Por favor, informe um endereço de e-mail válido.', 'warn');
      return;
    }
    if (emailsList.includes(raw)) {
      showToast('Este e-mail já consta na lista de destinatários.', 'warn');
      return;
    }
    setEmailsList(prev => [...prev, raw]);
    setNovoEmailInput('');
  };

  const handleRemoveEmail = (index: number) => {
    setEmailsList(prev => prev.filter((_, i) => i !== index));
  };

  const handleApplyBulkEmails = () => {
    const lines = bulkEmailText
      .split(/[\n,;]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0 && e.includes('@') && e.includes('.'));
    const unique = Array.from(new Set(lines));
    setEmailsList(unique);
    setBulkEmailMode(false);
    showToast(`${unique.length} e-mails consolidados com sucesso!`, 'success');
  };

  // Manipulação de Unidades de Negócio
  const handleAddUn = () => {
    const clean = novaUn.trim();
    if (!clean) return;
    if (unWeightsList.some(item => item.un.toLowerCase() === clean.toLowerCase())) {
      showToast('Esta Unidade de Negócio já consta na lista.', 'warn');
      return;
    }
    setUnWeightsList(prev => [...prev, { un: clean, pe: '', ex: '' }].sort((a, b) => a.un.localeCompare(b.un)));
    setNovaUn('');
  };

  const handleUpdateWeight = (index: number, field: 'pe' | 'ex', val: string) => {
    setUnWeightsList(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const handleRemoveUn = (index: number) => {
    setUnWeightsList(prev => prev.filter((_, i) => i !== index));
  };

  // Gravação geral no Supabase
  const handleSave = async () => {
    setSaving(true);
    try {
      const numPe = usPePadrao.trim() ? parseFloat(usPePadrao.replace(',', '.')) : null;
      const numEx = usExPadrao.trim() ? parseFloat(usExPadrao.replace(',', '.')) : null;

      const updatedConfig: ContractConfig = {
        ...dataset.config,
        hh_dia: Number(hhDia) || 11,
        meta_percentual: Number(metaPercentual) || 100,
        atencao_percentual: Number(atencaoPercentual) || 90,
        prazo_justificativa_dias: Number(prazoJustificativa) || 2,
        dias_embarque: Number(diasEmbarque) || 14,
        dia_corte_medicao: Number(diaCorte) as DiaCorteMedicao,
        med_criterio: medCriterio,
        us_pe_padrao: numPe != null && !isNaN(numPe) ? numPe : null,
        us_ex_padrao: numEx != null && !isNaN(numEx) ? numEx : null,
        slogan: slogan.trim()
      };

      const weightsToSave: UsoffUnWeight[] = unWeightsList.map(item => ({
        unidade_negocio: item.un,
        pe: item.pe.trim() ? parseFloat(item.pe.replace(',', '.')) : null,
        ex: item.ex.trim() ? parseFloat(item.ex.replace(',', '.')) : null
      }));

      const emailsToSave = emailsList
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0 && e.includes('@'));

      await saveConfiguracoes(updatedConfig, weightsToSave, emailsToSave);
      await refreshData();
      showToast('Configurações do contrato salvas e sincronizadas com sucesso!', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao salvar configurações.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!isGlobal) {
    return (
      <div className="card note note-bad" style={{ margin: '20px 0' }}>
        <strong>Área Restrita:</strong> Esta seção de parametrização contratual é exclusiva para Administradores e Gestores autorizados.
      </div>
    );
  }

  const tabOptions: SegmentedOption<ConfigTab>[] = [
    { value: 'geral', label: 'Geral & Metas' },
    { value: 'ciclo', label: 'Ciclo de Medição' },
    { value: 'usoff', label: 'Ponderações USOFF', count: unWeightsList.length },
    { value: 'comunicacao', label: 'Comunicação & Notificações', count: emailsList.length },
    { value: 'memorial', label: 'Memorial de Cálculo' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '70px' }}>
      <style>{`
        .cfg-input-addon {
          display: flex;
          align-items: center;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: var(--radius-sm);
          overflow: hidden;
          transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
        }
        .cfg-input-addon:focus-within {
          border-color: var(--blue);
          box-shadow: 0 0 0 2px var(--blue-soft);
        }
        .cfg-input-addon input {
          border: none !important;
          background: transparent !important;
          flex: 1;
          padding: 8px 12px;
          outline: none !important;
          font-variant-numeric: tabular-nums;
        }
        .cfg-input-addon .addon-badge {
          background: var(--surface-alt);
          padding: 8px 12px;
          color: var(--ink-muted);
          font-size: 0.82rem;
          font-weight: 600;
          border-left: 1px solid var(--line);
          user-select: none;
          white-space: nowrap;
        }
        .cfg-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
          gap: 20px;
          align-items: start;
        }
        .cfg-scale-preview {
          display: flex;
          height: 10px;
          border-radius: 999px;
          overflow: hidden;
          margin-top: 10px;
          background: var(--line);
        }
        .cfg-scale-segment-bad {
          background: var(--bad);
        }
        .cfg-scale-segment-warn {
          background: var(--warn);
        }
        .cfg-scale-segment-ok {
          background: var(--ok);
        }
        .cfg-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: var(--surface-alt);
          border: 1px solid var(--line);
          border-radius: 999px;
          font-size: 0.85rem;
          color: var(--ink);
          transition: background var(--transition-fast);
        }
        .cfg-chip:hover {
          background: var(--surface);
        }
        .cfg-chip-close {
          border: none;
          background: none;
          color: var(--ink-muted);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          padding: 0;
          line-height: 1;
        }
        .cfg-chip-close:hover {
          color: var(--bad);
        }
        .cfg-selection-card {
          border: 2px solid var(--line);
          border-radius: var(--radius-md);
          padding: 16px;
          cursor: pointer;
          transition: all var(--transition-fast);
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: var(--surface);
        }
        .cfg-selection-card:hover {
          border-color: var(--blue-soft);
          background: var(--surface-alt);
        }
        .cfg-selection-card.selected {
          border-color: var(--blue);
          background: var(--blue-soft);
        }
      `}</style>

      {/* Cabeçalho da Página de Configurações */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'var(--blue-soft)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Settings2 size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.35rem', fontFamily: 'var(--f-display)', color: 'var(--ink)' }}>Configurações do Contrato</h2>
              <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.85rem' }}>
                Parâmetros regulamentares, pesos contratuais USOFF, ciclo de apuração e distribuição diária.
              </p>
            </div>
          </div>
        </div>

        {/* Ações do Topo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {isDirty && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={resetToDataset}
              disabled={saving}
              title="Desfazer alterações e restaurar valores originais"
            >
              <RotateCcw size={15} style={{ marginRight: '6px' }} />
              Descartar alterações
            </button>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ minWidth: '170px' }}
          >
            {saving ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <span className="animate-spin" style={{ display: 'inline-block' }}>⟳</span> Gravando…
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <Save size={16} /> Salvar configurações
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Resumo Rápido das Configurações em Badges Executivas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.82rem' }}>
        <div className="pill pill-info" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}>
          <Clock size={13} /> Carga Padrão: <b>{formatHours(hhDia)}/dia</b>
        </div>
        <div className="pill pill-ok" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}>
          <Target size={13} /> Meta Contratual: <b>{metaPercentual}%</b> (Atenção em {atencaoPercentual}%)
        </div>
        <div className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--surface-alt)' }}>
          <CalendarCheck size={13} /> Ciclo de Corte: <b>Dia {diaCorte}</b>
        </div>
        <div className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--surface-alt)' }}>
          <Building2 size={13} /> Critério: <b>{medCriterio === 'enc' ? 'Embarques Encerrados' : 'Dias Trabalhados'}</b>
        </div>
        <div className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--surface-alt)' }}>
          <Mail size={13} /> <b>{emailsList.length}</b> destinatários executivos
        </div>
        {isDirty && (
          <div className="pill pill-warn" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', fontWeight: 700 }}>
            <AlertCircle size={13} /> Alterações pendentes de gravação
          </div>
        )}
      </div>

      {/* Navegação Estruturada por Abas */}
      <div style={{ marginTop: '4px' }}>
        <SegmentedControl<ConfigTab>
          options={tabOptions}
          value={activeTab}
          onChange={setActiveTab}
          size="md"
        />
      </div>

      {/* ========================================================================= */}
      {/* ABA 1: PARÂMETROS E METAS DE HH                                           */}
      {/* ========================================================================= */}
      {activeTab === 'geral' && (
        <div className="cfg-card-grid">
          {/* Card: Metas e Carga Horária */}
          <div className="card stack" style={{ gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ color: 'var(--blue)' }}><Sliders size={20} /></div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Carga Horária & Metas de Desempenho</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                  Define a jornada base diária embarcada e os limiares de apuração do contrato.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                  Meta de horas por dia (HH disponível)
                </label>
                <div className="cfg-input-addon">
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="24"
                    value={hhDia}
                    onChange={e => setHhDia(parseFloat(e.target.value) || 0)}
                    disabled={saving}
                  />
                  <div className="addon-badge">horas / dia</div>
                </div>
                <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
                  Carga horária esperada para cada dia em que o técnico constar embarcado na carteira.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                  Meta de execução contratual (%)
                </label>
                <div className="cfg-input-addon">
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={metaPercentual}
                    onChange={e => setMetaPercentual(parseFloat(e.target.value) || 0)}
                    disabled={saving}
                  />
                  <div className="addon-badge">% de execução</div>
                </div>
                <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
                  Percentual exigido do HH disponível. Execuções abaixo deste valor demandam justificativa operacional.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                  Faixa de atenção a partir de (%)
                </label>
                <div className="cfg-input-addon">
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={atencaoPercentual}
                    onChange={e => setAtencaoPercentual(parseFloat(e.target.value) || 0)}
                    disabled={saving}
                  />
                  <div className="addon-badge">% de alerta</div>
                </div>
                <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
                  Valores entre {atencaoPercentual}% e {metaPercentual - 1}% recebem classificação de Atenção (Amarelo).
                </div>
              </div>

              {/* Pré-visualização da Régua Contratual */}
              <div style={{ background: 'var(--surface-alt)', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Régua Visual de Avaliação</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>Status por percentual executado</span>
                </div>
                <div className="cfg-scale-preview">
                  <div className="cfg-scale-segment-bad" style={{ width: `${Math.min(100, Math.max(0, atencaoPercentual))}%` }} title="Abaixo da Meta (Crítico)" />
                  <div className="cfg-scale-segment-warn" style={{ width: `${Math.max(0, metaPercentual - atencaoPercentual)}%` }} title="Faixa de Atenção (Alerta)" />
                  <div className="cfg-scale-segment-ok" style={{ flex: 1 }} title="Meta Atingida (OK)" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                  <span style={{ color: 'var(--bad)', fontWeight: 600 }}>0% a {atencaoPercentual - 1}% (Crítico)</span>
                  <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{atencaoPercentual}% a {metaPercentual - 1}% (Atenção)</span>
                  <span style={{ color: 'var(--ok)', fontWeight: 600 }}>&ge; {metaPercentual}% (Meta Atingida)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card: Prazos e Escala Padrão */}
          <div className="card stack" style={{ gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ color: 'var(--blue)' }}><Clock size={20} /></div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Prazos & Parâmetros de Embarque</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                  Regras de prazo para justificativas e escala estimada para dados sem carteira.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                  Prazo regulamentar para justificativa
                </label>
                <div className="cfg-input-addon">
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={prazoJustificativa}
                    onChange={e => setPrazoJustificativa(parseInt(e.target.value, 10) || 0)}
                    disabled={saving}
                  />
                  <div className="addon-badge">dias corridos</div>
                </div>
                <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
                  Prazo contado a partir do dia trabalhado (D + {prazoJustificativa} dias). Após esse período, a justificativa é marcada como vencida.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                  Escala de embarque padrão estimada
                </label>
                <div className="cfg-input-addon">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={diasEmbarque}
                    onChange={e => setDiasEmbarque(parseInt(e.target.value, 10) || 0)}
                    disabled={saving}
                  />
                  <div className="addon-badge">dias de escala</div>
                </div>
                <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
                  Utilizado quando o apontamento do técnico não possui carteira de embarque previamente cadastrada no sistema.
                </div>
              </div>

              {/* Informação Operacional */}
              <div className="note note-info" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', margin: 0 }}>
                <Info size={16} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--blue)' }} />
                <div style={{ fontSize: '0.82rem', lineHeight: '1.45' }}>
                  <strong>Regra de Compensação Contratual:</strong> O acumulado do embarque compensa dias de baixa produtividade com dias de excedente de horas até o atingimento da meta global.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 2: CICLO DE MEDIÇÃO & APURAÇÃO                                        */}
      {/* ========================================================================= */}
      {activeTab === 'ciclo' && (
        <div className="cfg-card-grid">
          {/* Card: Dia de Corte */}
          <div className="card stack" style={{ gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ color: 'var(--blue)' }}><CalendarCheck size={20} /></div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Ciclo do Mês de Medição</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                  Dia de corte mensal do contrato utilizado no fechamento das medições.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {OPCOES_DIA_CORTE.map(op => {
                const isSelected = diaCorte === op.value;
                return (
                  <div
                    key={op.value}
                    className={`cfg-selection-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setDiaCorte(op.value)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: isSelected ? 'var(--blue)' : 'var(--ink)' }}>
                        {op.label}
                      </span>
                      {isSelected ? (
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--blue)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Check size={12} strokeWidth={3} />
                        </div>
                      ) : (
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: '2px solid var(--line)' }} />
                      )}
                    </div>
                    <div className="sub" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                      {op.value === 21 && 'Padrão tradicional de contratos Petrobras Offshore (Dia 21 ao dia 20 do mês seguinte).'}
                      {op.value === 1 && 'Ciclo alinhado com o mês civil completo (Do dia 1º ao último dia do mês).'}
                      {op.value === 16 && 'Ciclo quinzenal com fechamento no dia 15 do mês seguinte.'}
                      {op.value === 26 && 'Ciclo antecipado com fechamento no dia 25 do mês seguinte.'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Card: Critério de Apuração */}
          <div className="card stack" style={{ gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ color: 'var(--blue)' }}><Building2 size={20} /></div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Critério de Apuração dos Relatórios</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                  Metodologia de inclusão dos embarques nos relatórios de medição mensal.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div
                className={`cfg-selection-card ${medCriterio === 'enc' ? 'selected' : ''}`}
                onClick={() => setMedCriterio('enc')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: medCriterio === 'enc' ? 'var(--blue)' : 'var(--ink)' }}>
                    Embarques Encerrados no Ciclo (Recomendado)
                  </span>
                  {medCriterio === 'enc' ? (
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--blue)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Check size={12} strokeWidth={3} />
                    </div>
                  ) : (
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: '2px solid var(--line)' }} />
                  )}
                </div>
                <div className="sub" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                  Computa exclusivamente os técnicos com <b>desembarque homologado</b> dentro do período de corte. O embarque entra por inteiro na medição e quem continua a bordo rola para o mês subsequente.
                </div>
              </div>

              <div
                className={`cfg-selection-card ${medCriterio === 'dias' ? 'selected' : ''}`}
                onClick={() => setMedCriterio('dias')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: medCriterio === 'dias' ? 'var(--blue)' : 'var(--ink)' }}>
                    Todos os Dias Trabalhados no Período
                  </span>
                  {medCriterio === 'dias' ? (
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--blue)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Check size={12} strokeWidth={3} />
                    </div>
                  ) : (
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: '2px solid var(--line)' }} />
                  )}
                </div>
                <div className="sub" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                  Computa todos os dias trabalhados <b>estritamente contidos</b> no período de corte, independente de quando o técnico embarcou ou desembarcou.
                </div>
              </div>

              <div className="note note-warn" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', margin: 0 }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.8rem' }}>
                  Esta escolha afeta os relatórios formais de medição. As abas operacionais do dia a dia (Visão Geral e Painel do Dia) sempre refletem todos os embarcados ativos em tempo real.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 3: PONDERAÇÃO USOFF (PE & EX)                                         */}
      {/* ========================================================================= */}
      {activeTab === 'usoff' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Banner da Hierarquia */}
          <div className="card note note-info" style={{ display: 'flex', gap: '12px', alignItems: 'center', margin: 0, padding: '12px 16px' }}>
            <Calculator size={20} style={{ color: 'var(--blue)', flexShrink: 0 }} />
            <div style={{ fontSize: '0.85rem' }}>
              <b>Hierarquia de Pesos USOFF:</b> Operação Específica (Linha) &rarr; Unidade de Negócio (UN) &rarr; Padrão Global Contratual. Se uma UN não possuir fator cadastrado, herda automaticamente os valores globais.
            </div>
          </div>

          <div className="cfg-card-grid">
            {/* Card: Padrões Globais */}
            <div className="card stack" style={{ gap: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Fatores Padrão Globais (Fallback)</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                  Utilizados quando a plataforma ou operação não possui peso customizado.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    PE Global (Programado)
                  </label>
                  <div className="cfg-input-addon">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={usPePadrao}
                      onChange={e => setUsPePadrao(e.target.value)}
                      placeholder="Ex: 0.50"
                      disabled={saving}
                    />
                    <div className="addon-badge">fator</div>
                  </div>
                  <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
                    Multiplica o HH Programado (HP)
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    EX Global (Executado)
                  </label>
                  <div className="cfg-input-addon">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={usExPadrao}
                      onChange={e => setUsExPadrao(e.target.value)}
                      placeholder="Ex: 1.00"
                      disabled={saving}
                    />
                    <div className="addon-badge">fator</div>
                  </div>
                  <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
                    Multiplica o HH Executado (HC)
                  </div>
                </div>
              </div>
            </div>

            {/* Card: Adicionar Nova UN */}
            <div className="card stack" style={{ gap: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Gerenciar Grade de Unidades</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                  Adicione novas Unidades de Negócio para aplicar fatores específicos.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={novaUn}
                  onChange={e => setNovaUn(e.target.value)}
                  placeholder="Nome da Unidade (ex: Búzios (UN-BUZ))"
                  style={{ flex: 1, padding: '8px 12px', fontSize: '0.9rem' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddUn();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAddUn}
                  disabled={!novaUn.trim() || saving}
                >
                  <Plus size={16} /> Adicionar UN
                </button>
              </div>
            </div>
          </div>

          {/* Tabela de Pesos por UN */}
          <div className="card stack" style={{ gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Grade de Ponderação por Unidade de Negócio ({unWeightsList.length})</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                  Valores em branco herdam automaticamente o padrão global configurado acima.
                </p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="tb">
                <thead>
                  <tr>
                    <th style={{ width: '280px', minWidth: '240px' }}>Unidade de Negócio</th>
                    <th style={{ width: '160px', minWidth: '140px' }}>PE (Prog.)</th>
                    <th style={{ width: '160px', minWidth: '140px' }}>EX (Exec.)</th>
                    <th style={{ width: '160px', minWidth: '140px' }}>Status</th>
                    <th style={{ width: '80px', textAlign: 'center' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {unWeightsList.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-muted)' }}>
                        Nenhuma Unidade de Negócio cadastrada. Utilize o campo acima para adicionar.
                      </td>
                    </tr>
                  ) : (
                    unWeightsList.map((row, idx) => {
                      const hasCustomPe = row.pe.trim() !== '';
                      const hasCustomEx = row.ex.trim() !== '';
                      const isCustom = hasCustomPe || hasCustomEx;

                      return (
                        <tr key={row.un}>
                          <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Building2 size={16} style={{ color: 'var(--blue)' }} />
                              <span>{row.un}</span>
                            </div>
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder={usPePadrao ? `Padrão (${usPePadrao})` : '—'}
                              value={row.pe}
                              onChange={e => handleUpdateWeight(idx, 'pe', e.target.value)}
                              style={{ width: '100%', padding: '6px 8px', fontSize: '0.85rem' }}
                              disabled={saving}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder={usExPadrao ? `Padrão (${usExPadrao})` : '—'}
                              value={row.ex}
                              onChange={e => handleUpdateWeight(idx, 'ex', e.target.value)}
                              style={{ width: '100%', padding: '6px 8px', fontSize: '0.85rem' }}
                              disabled={saving}
                            />
                          </td>
                          <td>
                            {isCustom ? (
                              <span className="pill pill-ok" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                                Personalizado
                              </span>
                            ) : (
                              <span className="pill" style={{ fontSize: '0.72rem', background: 'var(--surface-alt)', color: 'var(--ink-muted)' }}>
                                Herdado do Global
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-icon btn-ghost"
                              onClick={() => handleRemoveUn(idx)}
                              title={`Remover ${row.un} da grade de pesos`}
                              aria-label={`Remover ${row.un}`}
                              style={{ color: 'var(--bad)' }}
                              disabled={saving}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 4: COMUNICAÇÃO & RESUMO DIÁRIO                                        */}
      {/* ========================================================================= */}
      {activeTab === 'comunicacao' && (
        <div className="cfg-card-grid">
          {/* Card: Slogan do Contrato */}
          <div className="card stack" style={{ gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ color: 'var(--blue)' }}><Mail size={20} /></div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Identidade Institucional</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                  Slogan exibido nos cabeçalhos executivos, relatórios exportados e e-mails.
                </p>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                Slogan do contrato
              </label>
              <input
                type="text"
                value={slogan}
                onChange={e => setSlogan(e.target.value)}
                placeholder="Ex: Excelência em Serviços e Operações Offshore"
                style={{ width: '100%', padding: '8px 12px' }}
                disabled={saving}
              />
              <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: '4px' }}>
                Texto de rodapé e cabeçalho em relatórios gerados.
              </div>
            </div>

            {/* Pré-visualização do Banner */}
            {slogan && (
              <div style={{ background: 'var(--surface-alt)', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
                <span className="sub" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', display: 'block', marginBottom: '4px' }}>
                  Pré-visualização no Cabeçalho
                </span>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--blue)' }}>
                  HH Offshore · Infotec
                </div>
                <div style={{ fontSize: '0.85rem', fontStyle: 'italic', color: 'var(--ink)' }}>
                  "{slogan}"
                </div>
              </div>
            )}
          </div>

          {/* Card: Destinatários Executivos com Gerenciador de Chips */}
          <div className="card stack" style={{ gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ color: 'var(--blue)' }}><Send size={20} /></div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Destinatários do Resumo Diário ({emailsList.length})</h3>
                  <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                    Recebem o boletim executivo matinal com o status das plataformas e pendências.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setBulkEmailMode(!bulkEmailMode)}
              >
                {bulkEmailMode ? 'Voltar para modo individual' : 'Colar em massa'}
              </button>
            </div>

            {bulkEmailMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <textarea
                  rows={5}
                  value={bulkEmailText}
                  onChange={e => setBulkEmailText(e.target.value)}
                  placeholder="Cole aqui os e-mails separados por linha, vírgula ou ponto-e-vírgula"
                  style={{ width: '100%', padding: '10px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={handleApplyBulkEmails}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Processar e atualizar lista
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Input para Adicionar Novo E-mail */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="email"
                    value={novoEmailInput}
                    onChange={e => setNovoEmailInput(e.target.value)}
                    placeholder="Adicionar e-mail executivo (ex: gestao@empresa.com.br)"
                    style={{ flex: 1, padding: '8px 12px', fontSize: '0.88rem' }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddEmail();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={handleAddEmail}
                    disabled={!novoEmailInput.trim()}
                  >
                    <Plus size={16} /> Adicionar
                  </button>
                </div>

                {/* Grade de Chips de E-mails */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '200px', overflowY: 'auto', padding: '4px 0' }}>
                  {emailsList.length === 0 ? (
                    <span className="sub" style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
                      Nenhum e-mail cadastrado para envio automático.
                    </span>
                  ) : (
                    emailsList.map((em, idx) => (
                      <div key={em} className="cfg-chip">
                        <Mail size={13} style={{ color: 'var(--blue)' }} />
                        <span>{em}</span>
                        <button
                          type="button"
                          className="cfg-chip-close"
                          onClick={() => handleRemoveEmail(idx)}
                          title={`Remover ${em}`}
                          aria-label={`Remover ${em}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
              O envio automático consolida técnicos abaixo da meta no dia anterior, justificativas pendentes ou vencidas e status por plataforma.
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 5: MEMORIAL DE CÁLCULO & REGRAS                                       */}
      {/* ========================================================================= */}
      {activeTab === 'memorial' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card stack" style={{ gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ color: 'var(--blue)' }}><HelpCircle size={22} /></div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Memorial Descritivo & Fórmulas Matemáticas</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '0.85rem' }}>
                  Documentação detalhada e transparente sobre como cada indicador contratual é apurado no sistema.
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
              <div className="card note note-info" style={{ margin: 0 }}>
                <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>1. HH Disponível & Jornada Diária</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.45' }}>
                  Calculado como <b>{formatHours(hhDia)} por dia</b> em que o técnico está embarcado na carteira de plataformas. A planilha de apontamentos informa exclusivamente as horas executadas; ausência de apontamento em dia embarcado resulta em 0 h executada.
                </p>
              </div>

              <div className="card note note-info" style={{ margin: 0 }}>
                <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>2. Percentual de Execução do Dia (% Dia)</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.45' }}>
                  Fórmula: <code>% = (HH Executado ÷ HH Disponível) &times; 100</code>. Execuções abaixo de <b>{metaPercentual}%</b> sinalizam não atingimento da meta contratual e exigem justificativa formal do preposto.
                </p>
              </div>

              <div className="card note note-info" style={{ margin: 0 }}>
                <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>3. Acumulado do Embarque</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.45' }}>
                  Soma de todo o HH executado dividida pela soma de todo o HH disponível desde o primeiro dia do ciclo de embarque até a data de apuração. Dias com horas excedentes compensam dias com horas abaixo da meta.
                </p>
              </div>

              <div className="card note note-info" style={{ margin: 0 }}>
                <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>4. Ponderação Contratual USOFF</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.45' }}>
                  Fórmula por operação: <code>US = &Sigma; [(PE &times; HP) + (EX &times; HC)]</code>, onde <b>HP</b> = HH Programado, <b>HC</b> = HH Executado, e os fatores PE e EX são resolvidos pela hierarquia (Linha &rarr; UN &rarr; Padrão Global).
                </p>
              </div>

              <div className="card note note-info" style={{ margin: 0 }}>
                <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>5. Desconto de Gangway Desconectada</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.45' }}>
                  Quando há justificativa homologada de gangway desconectada, o indicador <b>% sem Gangway</b> abate as horas perdidas: <code>Executado ÷ (Disponível &minus; Horas Gangway)</code>.
                </p>
              </div>

              <div className="card note note-info" style={{ margin: 0 }}>
                <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>6. Ciclos de Fechamento & Prazos</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.45' }}>
                  O ciclo atual está configurado para o <b>dia {diaCorte}</b> de cada mês. O prazo de tolerância para justificativas é de <b>{prazoJustificativa} dias corridos</b> a partir do dia trabalhado.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barra Flutuante de Gravação quando houver alterações pendentes */}
      {isDirty && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '24px',
            zIndex: 100,
            background: 'var(--surface)',
            border: '2px solid var(--blue)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg, 0 10px 25px -5px rgba(0, 0, 0, 0.15))',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            animation: 'fadeIn 0.2s ease-in-out'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} style={{ color: 'var(--warn)' }} />
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--ink)' }}>
              Você possui alterações não salvas no contrato
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={resetToDataset}
              disabled={saving}
            >
              Descartar
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Gravando…' : 'Salvar configurações'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
