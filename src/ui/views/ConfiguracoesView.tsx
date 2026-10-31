import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { saveConfiguracoes } from '../../services/data.service';
import { OPCOES_DIA_CORTE } from '../../config/constants';
import type { ContractConfig, DiaCorteMedicao, MedCriterio, UsoffUnWeight } from '../../domain/types';
import { formatHours } from '../../utils/format';

export const ConfiguracoesView: React.FC = () => {
  const { dataset, isGlobal, isAdmin, refreshData } = useApp();
  const { showToast } = useToast();

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
  const [emailsText, setEmailsText] = useState<string>('');

  // Grade estruturada de pesos por Unidade de Negócio
  const [unWeightsList, setUnWeightsList] = useState<Array<{ un: string; pe: string; ex: string }>>([]);
  const [novaUn, setNovaUn] = useState<string>('');
  const [showAddUn, setShowAddUn] = useState<boolean>(false);

  // Carrega configurações do dataset
  useEffect(() => {
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
      setEmailsText(dataset.emailsResumo.join('\n'));
    }

    // Inicializa lista de UNs consolidando plataformas + pesos configurados
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
  }, [dataset.config, dataset.emailsResumo, dataset.plataformas, dataset.usoffUnWeights]);

  const handleAddUn = () => {
    const clean = novaUn.trim();
    if (!clean) return;
    if (unWeightsList.some(item => item.un.toLowerCase() === clean.toLowerCase())) {
      showToast('Esta Unidade de Negócio já consta na lista.', 'warn');
      return;
    }
    setUnWeightsList(prev => [...prev, { un: clean, pe: '', ex: '' }].sort((a, b) => a.un.localeCompare(b.un)));
    setNovaUn('');
    setShowAddUn(false);
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

      const emailsToSave = emailsText
        .split('\n')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0 && e.includes('@'));

      await saveConfiguracoes(updatedConfig, weightsToSave, emailsToSave);
      await refreshData();
      showToast('Configurações salvas com sucesso!', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao salvar configurações.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!isGlobal) {
    return (
      <div className="card note note-bad" style={{ margin: '20px 0' }}>
        <strong>Área Restrita:</strong> Esta seção é exclusiva para Administradores e Gestores do contrato.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Cabeçalho da Página de Configurações */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Configurações do Contrato</h2>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            Parâmetros matemáticos contratuais, ponderações USOFF, regras de cálculo e distribuição diária.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Gravando…' : 'Salvar configurações'}
        </button>
      </div>

      <style>{`
        .config-two-columns {
          display: grid;
          grid-template-columns: 1fr;
          gap: 20px;
          align-items: start;
        }
        @media (min-width: 960px) {
          .config-two-columns {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      `}</style>

      <div className="config-two-columns">
        {/* COLUNA 1: Parâmetros Contratuais + Resumo Diário */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Card 1: Parâmetros Contratuais e Regras de Medição */}
          <div className="card stack" style={{ gap: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Parâmetros contratuais e regras de medição</h3>
              <p className="sub" style={{ margin: '4px 0 0' }}>
                Parâmetros utilizados no cálculo diário e medições de fechamento mensal.
              </p>
            </div>

            <div className="form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              <label className="fld">
                <span>Meta de horas por dia (HH disponível)</span>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="24"
                  value={hhDia}
                  onChange={e => setHhDia(parseFloat(e.target.value) || 0)}
                  disabled={saving}
                />
              </label>

              <label className="fld">
                <span>Meta de execução contratual (%)</span>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={metaPercentual}
                  onChange={e => setMetaPercentual(parseFloat(e.target.value) || 0)}
                  disabled={saving}
                />
              </label>

              <label className="fld">
                <span>Faixa de atenção a partir de (%)</span>
                <input
                  type="number"
                  min="0"
                  max="200"
                  value={atencaoPercentual}
                  onChange={e => setAtencaoPercentual(parseFloat(e.target.value) || 0)}
                  disabled={saving}
                />
              </label>

              <label className="fld">
                <span>Prazo para justificativa (dias)</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={prazoJustificativa}
                  onChange={e => setPrazoJustificativa(parseInt(e.target.value, 10) || 0)}
                  disabled={saving}
                />
              </label>

              <label className="fld">
                <span>Dias de embarque padrão</span>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={diasEmbarque}
                  onChange={e => setDiasEmbarque(parseInt(e.target.value, 10) || 0)}
                  disabled={saving}
                />
              </label>

              <label className="fld">
                <span>Ciclo do mês de medição</span>
                <select
                  value={diaCorte}
                  onChange={e => setDiaCorte(Number(e.target.value) as DiaCorteMedicao)}
                  disabled={saving}
                >
                  {OPCOES_DIA_CORTE.map(op => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="fld full" style={{ gridColumn: '1 / -1' }}>
                <span>Critério dos relatórios de medição</span>
                <select
                  value={medCriterio}
                  onChange={e => setMedCriterio(e.target.value as MedCriterio)}
                  disabled={saving}
                >
                  <option value="enc">
                    Embarques encerrados no período (inclusive dias antes do ciclo)
                  </option>
                  <option value="dias">
                    Todos os dias trabalhados estritamente dentro do período
                  </option>
                </select>
              </label>
            </div>
          </div>

          {/* Card 2: Comunicação & Destinatários do Resumo Diário */}
          <div className="card stack" style={{ gap: '14px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Comunicação e resumo diário</h3>
              <p className="sub" style={{ margin: '4px 0 0' }}>
                Slogan de cabeçalho e destinatários automáticos de e-mail de fechamento diário.
              </p>
            </div>

            <div className="form" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label className="fld full">
                <span>Slogan do cabeçalho institucional</span>
                <input
                  type="text"
                  value={slogan}
                  onChange={e => setSlogan(e.target.value)}
                  placeholder="Ex: Excelência em Serviços e Operações Offshore"
                  disabled={saving}
                />
              </label>

              <label className="fld full">
                <span>Destinatários do resumo diário (um e-mail por linha)</span>
                <textarea
                  rows={4}
                  value={emailsText}
                  onChange={e => setEmailsText(e.target.value)}
                  placeholder="gestao@empresa.com.br&#10;coordenacao@empresa.com.br"
                  disabled={saving}
                />
              </label>

              <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                O relatório executivo diário consolidado é enviado automaticamente para esses endereços com o status das plataformas e justificativas pendentes.
              </div>
            </div>
          </div>
        </div>

        {/* COLUNA 2: Pesos USOFF + Memorial Descritivo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Card 3: Pesos USOFF (PE e EX por UN e Padrão Global) */}
          <div className="card stack" style={{ gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Pesos PE e EX por Unidade (USOFF)</h3>
                <p className="sub" style={{ margin: '4px 0 0' }}>
                  Fatores de ponderação para cálculo de USOFF por UN ou padrão global.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setShowAddUn(!showAddUn)}
              >
                {showAddUn ? 'Cancelar' : '+ Adicionar unidade'}
              </button>
            </div>

            {/* Padrões Globais PE e EX */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'var(--surface-alt)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <label className="fld">
                <span>PE Padrão Global</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={usPePadrao}
                  onChange={e => setUsPePadrao(e.target.value)}
                  placeholder="Ex: 0.50"
                  disabled={saving}
                />
              </label>

              <label className="fld">
                <span>EX Padrão Global</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={usExPadrao}
                  onChange={e => setUsExPadrao(e.target.value)}
                  placeholder="Ex: 1.00"
                  disabled={saving}
                />
              </label>
            </div>

            {showAddUn && (
              <div className="card note note-info" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '10px' }}>
                <input
                  type="text"
                  value={novaUn}
                  onChange={e => setNovaUn(e.target.value)}
                  placeholder="Nome da nova Unidade (ex: Búzios (UN-BUZ))"
                  style={{ flex: 1, minWidth: '200px' }}
                />
                <button type="button" className="btn btn-sm btn-primary" onClick={handleAddUn}>
                  Confirmar inclusão
                </button>
              </div>
            )}

            <div className="tb" style={{ overflowX: 'auto', maxHeight: '280px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', minWidth: '160px' }}>Unidade de Negócio</th>
                    <th style={{ width: '120px', textAlign: 'left' }}>PE (Prog.)</th>
                    <th style={{ width: '120px', textAlign: 'left' }}>EX (Exec.)</th>
                    <th style={{ width: '60px', textAlign: 'center' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {unWeightsList.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '16px' }}>
                        Nenhuma unidade cadastrada ainda.
                      </td>
                    </tr>
                  ) : (
                    unWeightsList.map((row, idx) => (
                      <tr key={row.un}>
                        <td style={{ fontWeight: 600 }}>{row.un}</td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={usPePadrao ? `(${usPePadrao})` : '—'}
                            value={row.pe}
                            onChange={e => handleUpdateWeight(idx, 'pe', e.target.value)}
                            style={{ width: '100%', padding: '4px 6px', fontSize: '0.85rem' }}
                            disabled={saving}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={usExPadrao ? `(${usExPadrao})` : '—'}
                            value={row.ex}
                            onChange={e => handleUpdateWeight(idx, 'ex', e.target.value)}
                            style={{ width: '100%', padding: '4px 6px', fontSize: '0.85rem' }}
                            disabled={saving}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => handleRemoveUn(idx)}
                            title="Remover unidade da grade"
                            style={{ color: 'var(--bad)' }}
                            disabled={saving}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Card 4: Memorial Descritivo Dinâmico das Fórmulas */}
          <div className="card stack" style={{ gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Como cada número é calculado</h3>
            <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.88rem', color: 'var(--ink-secondary)' }}>
              <li>
                <b>HH disponível</b> = {formatHours(hhDia)} por dia em que o técnico está embarcado na carteira. O fluxo envia somente o executado.
              </li>
              <li>
                <b>% do dia</b> = HH executado ÷ HH disponível do dia. Abaixo de {metaPercentual}% o técnico não atingiu a meta e precisa de justificativa. Dia embarcado sem executado informado conta 0 h.
              </li>
              <li>
                <b>Acumulado do embarque</b> = soma do executado ÷ soma do disponível, do primeiro dia do embarque até o dia escolhido. Dias acima da meta compensam dias abaixo.
              </li>
              <li>
                <b>HH programado (HP)</b> = horas programadas do embarque no Portal Offshore; quando a planilha não traz, dias de embarque × {formatHours(hhDia)}.
              </li>
              <li>
                <b>US<sub>off</sub></b> = &Sigma; [(PE &times; HP) + (EX &times; HC)] por operação, com HC = HH executado e PE e EX definidos pela hierarquia (Linha &rarr; UN &rarr; Padrão Global).
              </li>
              <li>
                <b>Mês de medição</b> = do dia {diaCorte === 1 ? '1 ao último dia do mês' : `${diaCorte} de um mês ao dia ${diaCorte - 1} do mês seguinte`}. O nome do mês corresponde ao do fechamento.
              </li>
              <li>
                <b>Relatórios de medição</b>:{' '}
                {medCriterio === 'enc'
                  ? 'computa exclusivamente os técnicos com desembarque dentro do período; o embarque entra por inteiro, e quem permanece a bordo rola para a medição seguinte'
                  : 'computa todos os dias trabalhados estritamente dentro do período de corte'}. As demais abas operacionais refletem todos os embarcados ativos.
              </li>
              <li>
                <b>Prazo para justificar</b> = dia trabalhado + {prazoJustificativa} dias corridos.
              </li>
              <li>
                <b>% sem gangway</b> = executado ÷ (disponível &minus; horas justificadas de gangway desconectada).
              </li>
              <li>
                A unidade de negócio vem do cadastro de plataformas. Sem carteira cadastrada, o embarque é inferido a partir do primeiro dia com apontamento e dura {diasEmbarque} dias.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
