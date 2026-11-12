import React, { useState, useMemo } from 'react';
import { Briefcase, ExternalLink, FileSpreadsheet } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { KpiCard } from '../components/KpiCard';
import { StatusPill } from '../components/StatusPill';
import { MeterBar } from '../components/MeterBar';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { SegmentedControl } from '../components/SegmentedControl';
import type { CarteiraOperacao, UsoffOperationRow } from '../../domain/types';
import {
  calcPct,
  formatHours,
  formatPct,
  formatUs,
  plural
} from '../../utils/format';
import { formatBr, formatBrShort } from '../../utils/date';
import {
  computeDataAte,
  isPersonResponsible,
  mergeConfrontoOperations,
  passesFilter,
  resolvePlace,
  statusOf
} from '../../domain/calculations';
import { computeUsoffOperations, summarizeUsoff } from '../../domain/usoff';
import { periodDisplayName } from '../../domain/periods';
import {
  exportUsoffXlsx,
  exportUsoffPortalOffshoreXlsx,
  exportConfrontoSAPXlsx
} from '../../services/excel.service';
import { reconciliarConfirmacoesSAP } from '../../services/data.service';

export function MedicaoUsoffView() {
  const {
    dataset,
    pidx,
    activePeriod,
    filters,
    openFichaDrawer,
    openCarteiraModal,
    scopeLabel,
    isGlobal,
    refreshData
  } = useApp();

  const { showToast } = useToast();
  const [usoffTab, setUsoffTab] = useState<'embarques' | 'unidades' | 'prepostos' | 'confronto'>('embarques');
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingPortal, setIsExportingPortal] = useState(false);
  const [isExportingConfronto, setIsExportingConfronto] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [confrontoStatusFilter, setConfrontoStatusFilter] = useState<string>('todos');

  const P = activePeriod;
  const isEnc = dataset.config.med_criterio === 'enc';
  const ate = computeDataAte(P, dataset.watermark.ultima_data_hh);

  // Embarques calculados da USOFF (agrupamento principal para conferência e validação)
  const embarques = useMemo(() => {
    return computeUsoffOperations(P, dataset, filters, pidx, 'embarque');
  }, [P, dataset, filters, pidx]);

  // Sumário geral baseado na consolidação dos embarques do período
  const T = useMemo(() => {
    return summarizeUsoff(embarques);
  }, [embarques]);

  // Exportação Excel USOFF
  const handleExportUsoff = async () => {
    setIsExporting(true);
    try {
      await exportUsoffXlsx(dataset, P, scopeLabel);
      showToast('Relatório de USOFF exportado com sucesso!', 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao exportar USOFF: ' + (err.message || 'Falha na geração'), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // Exportação Excel Formato Portal Offshore + Cálculo USOFF ao lado
  const handleExportPortalUsoff = async () => {
    setIsExportingPortal(true);
    try {
      await exportUsoffPortalOffshoreXlsx(dataset, P, filters, scopeLabel);
      showToast('Relatório Portal Offshore + USOFF exportado com sucesso!', 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao exportar relatório Portal Offshore + USOFF: ' + (err.message || 'Falha na geração'), 'error');
    } finally {
      setIsExportingPortal(false);
    }
  };

  // Agrupamentos por UN e por Preposto a partir dos embarques
  const groupByField = (keyFn: (o: UsoffOperationRow) => string[]) => {
    const map: Record<string, UsoffOperationRow[]> = {};
    embarques.forEach(x => {
      keyFn(x).forEach(k => {
        (map[k] = map[k] || []).push(x);
      });
    });

    return Object.entries(map).map(([k, list]) => ({
      name: k,
      summary: summarizeUsoff(list)
    })).sort((a, b) => (a.summary.pP ?? 999) - (b.summary.pP ?? 999));
  };

  const groupUn = useMemo(() => {
    return groupByField(x => Array.from(x.regs));
  }, [embarques]);

  const groupPreposto = useMemo(() => {
    return groupByField(x => {
      const respNames = Object.values(dataset.pessoas)
        .filter(p => (p.papel || 'preposto') === 'preposto' && Array.from(x.plats).some(pp => isPersonResponsible(p, { p: pp, r: Array.from(x.regs)[0] || '' })))
        .map(p => p.nome);
      return respNames.length ? respNames : ['Sem preposto'];
    });
  }, [embarques, dataset.pessoas]);

  interface GroupSummaryRow {
    name: string;
    summary: ReturnType<typeof summarizeUsoff>;
  }

  const groupColumns = (label: string): DataTableColumn<GroupSummaryRow>[] => [
    {
      key: 'name',
      header: label,
      width: '240px',
      render: r => <b style={{ whiteSpace: 'nowrap' }}>{r.name}</b>
    },
    {
      key: 'n',
      header: 'Embarques',
      align: 'right',
      sortValue: r => r.summary.n,
      render: r => r.summary.n
    },
    {
      key: 'hp',
      header: 'HP',
      align: 'right',
      sortValue: r => r.summary.hp,
      render: r => formatHours(r.summary.hp)
    },
    {
      key: 'hd',
      header: 'HD',
      align: 'right',
      sortValue: r => r.summary.hd,
      render: r => formatHours(r.summary.hd)
    },
    {
      key: 'hc',
      header: 'HC',
      align: 'right',
      sortValue: r => r.summary.hc,
      render: r => formatHours(r.summary.hc)
    },
    {
      key: 'pD',
      header: 'HC ÷ HD',
      sortValue: r => r.summary.pD ?? -1,
      render: r => <MeterBar pct={r.summary.pD} status={statusOf(r.summary.pD, dataset.config)} />
    },
    {
      key: 'pP',
      header: 'HC ÷ HP',
      sortValue: r => r.summary.pP ?? -1,
      render: r => <MeterBar pct={r.summary.pP} status={statusOf(r.summary.pP, dataset.config)} />
    },
    {
      key: 'peHp',
      header: 'Σ PE × HP',
      align: 'right',
      sortValue: r => r.summary.peHp,
      render: r => (r.summary.falta > 0 ? '—' : formatUs(r.summary.peHp))
    },
    {
      key: 'exHc',
      header: 'Σ EX × HC',
      align: 'right',
      sortValue: r => r.summary.exHc,
      render: r => (r.summary.falta > 0 ? '—' : formatUs(r.summary.exHc))
    },
    {
      key: 'us',
      header: 'USoff',
      align: 'right',
      sortValue: r => r.summary.us ?? -1,
      render: r => <b>{formatUs(r.summary.us)}</b>
    }
  ];

  // Tabela de Embarques (agrupamento principal por Embarque / ID de Embarque)
  const embarqueColumns: DataTableColumn<UsoffOperationRow>[] = [
    {
      key: 'id_embarque',
      header: 'ID Embarque',
      width: '180px',
      sortValue: r => r.id_embarque || r.op || '',
      render: r => {
        const embId = r.id_embarque || (r.op.startsWith('ID ') ? r.op.replace('ID ', '') : '');
        const firstMat = Array.from(r.mats)[0] || '';
        return (
          <div>
            {embId ? (
              <button
                type="button"
                className="btn-link"
                onClick={() => openCarteiraModal(firstMat, embId, r.ini)}
                title="Abrir Carteira Completa deste Embarque"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: 'var(--blue-soft, #e0f2fe)',
                  border: '1px solid var(--blue-border, #bae6fd)',
                  color: 'var(--blue, #0284c7)',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <Briefcase size={12} />
                <span>{embId}</span>
                <ExternalLink size={10} style={{ opacity: 0.7 }} />
              </button>
            ) : (
              <StatusPill
                status={r.tipo === 'Sem programação' ? 'warn' : 'info'}
                text={r.op || r.tipo}
              />
            )}
            {r.totalOps != null && r.totalOps > 0 && (
              <div className="sub" style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', marginTop: '2px' }}>
                {plural(r.totalOps, 'operação', 'operações')}
              </div>
            )}
            <div className="sub" style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
              {r.fonte}
            </div>
          </div>
        );
      }
    },
    {
      key: 'mats',
      header: 'Técnico',
      width: '240px',
      render: r => {
        const mats = Array.from(r.mats);
        return (
          <div style={{ minWidth: '200px' }}>
            {mats.slice(0, 2).map(m => {
              const nome = dataset.tecnicos[m]?.nome || `Mat. ${m}`;
              return (
                <div key={m}>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => openFichaDrawer(m)}
                    style={{ fontSize: '0.82rem', color: 'var(--blue)', whiteSpace: 'nowrap', fontWeight: 600 }}
                  >
                    {nome}
                  </button>
                  <div className="sub" style={{ fontSize: '0.74rem', color: 'var(--ink-muted)' }}>
                    Mat. {m}
                  </div>
                </div>
              );
            })}
            {mats.length > 2 && (
              <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                +{mats.length - 2} técnicos
              </div>
            )}
          </div>
        );
      }
    },
    {
      key: 'plats',
      header: 'Plataforma / UN',
      width: '180px',
      render: r => (
        <div>
          <b>{Array.from(r.plats).join(', ')}</b>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            {Array.from(r.regs).join(', ')}
          </div>
        </div>
      )
    },
    {
      key: 'periodo',
      header: 'Período',
      width: '150px',
      sortValue: r => r.ini,
      render: r => (
        <div>
          <div>{formatBrShort(r.ini)} a {formatBrShort(r.fim)}</div>
          <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
            {plural(r.dias, 'dia', 'dias')}
          </div>
        </div>
      )
    },
    {
      key: 'hp',
      header: 'HP',
      align: 'right',
      sortValue: r => r.hp,
      render: r => (
        <div>
          <div>{formatHours(r.hp)}</div>
          {(r.hpForaCarteira ?? 0) > 0 && (
            <div className="sub" style={{ fontSize: '0.72rem', color: 'var(--orange-dark)' }}>
              {formatHours(r.hpCarteira ?? 0)}c + {formatHours(r.hpForaCarteira ?? 0)}f
            </div>
          )}
        </div>
      )
    },
    {
      key: 'hd',
      header: 'HD',
      align: 'right',
      sortValue: r => r.hd,
      render: r => formatHours(r.hd)
    },
    {
      key: 'hc',
      header: 'HC',
      align: 'right',
      sortValue: r => r.hc,
      render: r => <b>{formatHours(r.hc)}</b>
    },
    {
      key: 'pD',
      header: 'HC ÷ HD',
      sortValue: r => r.pD ?? -1,
      render: r => <MeterBar pct={r.pD} status={statusOf(r.pD, dataset.config)} />
    },
    {
      key: 'pP',
      header: 'HC ÷ HP',
      sortValue: r => r.pP ?? -1,
      render: r => (
        r.hpAte > 0 ? (
          <MeterBar pct={r.pP} status={statusOf(r.pP, dataset.config)} />
        ) : (
          <span className="sub">sem programação</span>
        )
      )
    },
    {
      key: 'pe',
      header: 'PE',
      align: 'right',
      render: r => {
        if (r.fonte.includes('Diária')) return <span className="sub">diária</span>;
        if (r.falta) return <span style={{ color: 'var(--bad)' }}>falta</span>;
        const pes = Array.from(r.pes);
        return pes.length === 1 ? formatUs(pes[0]) : (pes.length > 1 ? 'vários' : '—');
      }
    },
    {
      key: 'ex',
      header: 'EX',
      align: 'right',
      render: r => {
        if (r.fonte.includes('Diária')) return <span className="sub">diária</span>;
        if (r.falta) return <span style={{ color: 'var(--bad)' }}>falta</span>;
        const exs = Array.from(r.exs);
        return exs.length === 1 ? formatUs(exs[0]) : (exs.length > 1 ? 'vários' : '—');
      }
    },
    {
      key: 'peHp',
      header: 'Σ PE × HP',
      align: 'right',
      sortValue: r => r.peHp,
      render: r => (r.falta ? '—' : formatUs(r.peHp))
    },
    {
      key: 'exHc',
      header: 'Σ EX × HC',
      align: 'right',
      sortValue: r => r.exHc,
      render: r => (r.falta ? '—' : formatUs(r.exHc))
    },
    {
      key: 'us',
      header: 'USoff',
      align: 'right',
      sortValue: r => r.us ?? -1,
      render: r => <b style={{ color: 'var(--blue)' }}>{formatUs(r.us)}</b>
    },
    {
      key: 'carteira',
      header: 'Ações',
      align: 'center',
      width: '100px',
      render: r => {
        const firstMat = Array.from(r.mats)[0] || '';
        const embId = r.id_embarque || (r.op.startsWith('ID ') ? r.op.replace('ID ', '') : '');
        return (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => openCarteiraModal(firstMat, embId || undefined, r.ini)}
            title="Visualizar carteira completa de ordens deste embarque"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
          >
            <Briefcase size={13} />
            <span>Carteira</span>
          </button>
        );
      }
    }
  ];

  // Operações combinadas da Carteira do Portal + Confirmações do SAP não cadastradas no Portal
  const rawCarteiraOps = useMemo(() => {
    return mergeConfrontoOperations(
      dataset.carteiraOperacoes || [],
      dataset.confirmacoesSap || [],
      dataset.carteira || [],
      dataset.tecnicos || {}
    );
  }, [dataset.carteiraOperacoes, dataset.confirmacoesSap, dataset.carteira, dataset.tecnicos]);

  const confrontoOps = useMemo(() => {
    return rawCarteiraOps.filter(op => {
      if (isEnc) {
        if (op.data_fim < P.ini || op.data_fim > P.fim) return false;
      } else {
        if (op.data_inicio > P.fim || op.data_fim < P.ini) return false;
      }
      const l = resolvePlace(pidx, op.plataforma_sigla ?? undefined, op.unidade_negocio);
      if (!passesFilter(l, filters, dataset.pessoas)) return false;
      return true;
    });
  }, [rawCarteiraOps, isEnc, P, pidx, filters, dataset.pessoas]);

  const filteredConfrontoOps = useMemo(() => {
    if (confrontoStatusFilter === 'todos') return confrontoOps;
    if (confrontoStatusFilter === 'divergentes') {
      return confrontoOps.filter(
        op => op.status_divergencia && op.status_divergencia !== 'OK' && op.status_divergencia !== 'Não Confirmado'
      );
    }
    if (confrontoStatusFilter === 'ok') {
      return confrontoOps.filter(op => op.status_divergencia === 'OK');
    }
    if (confrontoStatusFilter === 'div_portal_sap') {
      return confrontoOps.filter(op => op.status_divergencia === 'Divergente (Portal > SAP)');
    }
    if (confrontoStatusFilter === 'div_sap_portal') {
      return confrontoOps.filter(op => op.status_divergencia === 'Divergente (SAP > Portal)');
    }
    if (confrontoStatusFilter === 'nao_sap') {
      return confrontoOps.filter(op => op.status_divergencia === 'Não Apontado no SAP');
    }
    if (confrontoStatusFilter === 'nao_portal') {
      return confrontoOps.filter(
        op =>
          op.status_divergencia === 'Não Confirmado no Portal' ||
          op.status_divergencia === 'Não Cadastrado no Portal'
      );
    }
    if (confrontoStatusFilter === 'nao_conf') {
      return confrontoOps.filter(op => op.status_divergencia === 'Não Confirmado');
    }
    return confrontoOps;
  }, [confrontoOps, confrontoStatusFilter]);

  const confrontoSummary = useMemo(() => {
    let okCount = 0;
    let divCount = 0;
    let naoApontadoSapCount = 0;
    let naoConfirmadoPortalCount = 0;
    let naoConfirmadoCount = 0;
    let totalHhProg = 0;
    let totalHhPortal = 0;
    let totalHhSap = 0;

    confrontoOps.forEach(op => {
      totalHhProg += op.hh_programado || 0;
      totalHhPortal += op.hh_confirmado || 0;
      totalHhSap += op.hh_confirmado_sap || 0;

      const s = op.status_divergencia;
      if (s === 'OK') {
        okCount++;
      } else if (s === 'Não Confirmado') {
        naoConfirmadoCount++;
      } else if (s === 'Não Apontado no SAP') {
        naoApontadoSapCount++;
        divCount++;
      } else if (s === 'Não Confirmado no Portal' || s === 'Não Cadastrado no Portal') {
        naoConfirmadoPortalCount++;
        divCount++;
      } else if (s && s.startsWith('Divergente')) {
        divCount++;
      }
    });

    const diffHh = totalHhPortal - totalHhSap;

    return {
      totalOps: confrontoOps.length,
      okCount,
      divCount,
      naoApontadoSapCount,
      naoConfirmadoPortalCount,
      naoConfirmadoCount,
      totalHhProg,
      totalHhPortal,
      totalHhSap,
      diffHh
    };
  }, [confrontoOps]);

  const handleExportConfronto = async () => {
    setIsExportingConfronto(true);
    try {
      await exportConfrontoSAPXlsx(filteredConfrontoOps, periodDisplayName(P));
      showToast('Relatório de confronto exportado com sucesso!', 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao exportar confronto: ' + (err.message || 'Falha na geração'), 'error');
    } finally {
      setIsExportingConfronto(false);
    }
  };

  const handleReconcile = async () => {
    setIsReconciling(true);
    try {
      const res = await reconciliarConfirmacoesSAP();
      await refreshData();
      showToast(
        `Reconciliação concluída: ${res?.operacoes_com_batimento_ok ?? 0} operações com batimento 100% OK e ${res?.operacoes_com_divergencia ?? 0} divergentes.`,
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || 'Erro ao executar reconciliação do SAP.', 'error');
    } finally {
      setIsReconciling(false);
    }
  };

  const confrontoColumns: DataTableColumn<CarteiraOperacao>[] = [
    {
      key: 'op',
      header: 'Ordem / OP',
      width: '160px',
      sortValue: r => `${r.ordem}_${r.operacao}`,
      render: r => (
        <div>
          <b>{r.ordem}</b>
          <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            Op: {r.operacao || '—'}
          </div>
        </div>
      )
    },
    {
      key: 'tec',
      header: 'Técnico',
      width: '220px',
      sortValue: r => r.nome,
      render: r => (
        <div style={{ minWidth: '180px' }}>
          <button
            type="button"
            className="btn-link"
            onClick={() => openFichaDrawer(r.matricula)}
            style={{ fontSize: '0.82rem', color: 'var(--blue)', whiteSpace: 'nowrap', textAlign: 'left' }}
          >
            {r.nome}
          </button>
          <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
            Mat. {r.matricula}
          </div>
        </div>
      )
    },
    {
      key: 'plat',
      header: 'Plataforma / UN',
      width: '150px',
      sortValue: r => r.plataforma_sigla || '',
      render: r => (
        <div>
          <b>{r.plataforma_sigla || '—'}</b>
          <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
            {r.unidade_negocio || '—'}
          </div>
        </div>
      )
    },
    {
      key: 'periodo',
      header: 'Período',
      width: '150px',
      sortValue: r => r.data_inicio,
      render: r => {
        const idEmb = r.id_embarque || r.portal_id;
        return (
          <div style={{ fontSize: '0.82rem' }}>
            <div>{formatBrShort(r.data_inicio)} a {formatBrShort(r.data_fim)}</div>
            <div style={{ fontSize: '0.74rem', marginTop: '2px' }}>
              {idEmb ? (
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: '3px',
                    background: 'var(--surface-muted, #f1f5f9)',
                    border: '1px solid var(--border-subtle, #e2e8f0)',
                    color: 'var(--ink, #1e293b)'
                  }}
                  title="ID do Embarque no Portal Offshore"
                >
                  ID {idEmb}
                </span>
              ) : (
                <span className="sub" style={{ color: 'var(--ink-muted)' }}>sem ID</span>
              )}
            </div>
          </div>
        );
      }
    },
    {
      key: 'statusProg',
      header: 'Programação',
      width: '130px',
      sortValue: r => r.status_programacao,
      render: r => (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '0.75rem',
            fontWeight: 600,
            background:
              r.status_programacao === 'Carteira'
                ? 'var(--blue-soft)'
                : r.status_programacao === 'Fora da carteira'
                ? 'var(--orange-soft)'
                : r.status_programacao === 'Não Cadastrado no Portal'
                ? 'var(--bad-soft, #fee2e2)'
                : 'var(--surface-alt)',
            color:
              r.status_programacao === 'Carteira'
                ? 'var(--blue)'
                : r.status_programacao === 'Fora da carteira'
                ? 'var(--orange-dark)'
                : r.status_programacao === 'Não Cadastrado no Portal'
                ? 'var(--bad, #b91c1c)'
                : 'var(--ink-muted)'
          }}
        >
          {r.status_programacao}
        </span>
      )
    },
    {
      key: 'hhProg',
      header: 'HH Prog.',
      align: 'right',
      width: '100px',
      sortValue: r => r.hh_programado,
      render: r => formatHours(r.hh_programado)
    },
    {
      key: 'hhPortal',
      header: 'Conf. Portal',
      align: 'right',
      width: '110px',
      sortValue: r => r.hh_confirmado,
      render: r => <b>{formatHours(r.hh_confirmado)}</b>
    },
    {
      key: 'hhSap',
      header: 'Conf. SAP',
      align: 'right',
      width: '110px',
      sortValue: r => r.hh_confirmado_sap || 0,
      render: r => (
        <b style={{ color: (r.hh_confirmado_sap || 0) > 0 ? 'var(--blue)' : 'var(--ink-muted)' }}>
          {formatHours(r.hh_confirmado_sap || 0)}
        </b>
      )
    },
    {
      key: 'div',
      header: 'Divergência',
      align: 'right',
      width: '110px',
      sortValue: r => r.divergencia_sap || 0,
      render: r => {
        const div = r.divergencia_sap || 0;
        if (div === 0) {
          return <span style={{ color: 'var(--ink-muted)' }}>0,00</span>;
        }
        const isPos = div > 0;
        return (
          <span
            style={{
              fontWeight: 700,
              color: isPos ? 'var(--orange-dark)' : 'var(--bad)'
            }}
          >
            {isPos ? `+${formatHours(div)}` : formatHours(div)}
          </span>
        );
      }
    },
    {
      key: 'status',
      header: 'Status Confronto',
      width: '190px',
      sortValue: r => r.status_divergencia || '',
      render: r => {
        const s = r.status_divergencia || 'Não Confirmado';
        let meta: 'ok' | 'warn' | 'bad' | 'sem' | 'info' = 'sem';
        if (s === 'OK') meta = 'ok';
        else if (s === 'Divergente (Portal > SAP)') meta = 'warn';
        else if (s === 'Divergente (SAP > Portal)') meta = 'bad';
        else if (s === 'Não Apontado no SAP') meta = 'warn';
        else if (s === 'Não Confirmado no Portal' || s === 'Não Cadastrado no Portal') meta = 'info';

        return <StatusPill status={meta} text={s} />;
      }
    }
  ];

  return (
    <div className="view-medicao-usoff">
      {/* Cabeçalho */}
      <div className="card-header-view" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', color: 'var(--blue)' }}>
            Medição USOFF · {periodDisplayName(P)} ({formatBr(P.ini)} a {formatBr(P.fim)})
          </h2>
          <div className="sub" style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
            Executado recebido até {formatBr(ate)}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleExportPortalUsoff}
            disabled={isExportingPortal}
            title="Exporta os dados no mesmo formato do Portal Offshore com o cálculo de USOFF ao lado para conferência do total"
          >
            <FileSpreadsheet size={16} />
            <span>{isExportingPortal ? 'Exportando...' : 'Exportar Portal Offshore + USOFF (Excel)'}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExportUsoff}
            disabled={isExporting}
          >
            {isExporting ? 'Exportando...' : 'Exportar USOFF (Excel)'}
          </button>
        </div>
      </div>

      {/* Card da Fórmula Algébrica */}
      <div
        className="card"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          marginBottom: '16px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: '1.2rem', color: 'var(--blue)', fontWeight: 700 }}>
            US<sub>off</sub> = &Sigma;<sub>i=1&hellip;n</sub> [ (PE<sub>i</sub> &times; HP<sub>i</sub>) + (EX<sub>i</sub> &times; HC<sub>i</sub>) ]
          </span>
          <span className="sub" style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
            fórmula de apuração do SERVIÇO TÉCNICO OFFSHORE
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))', gap: '8px 16px', fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
          <div>
            <b>OP<sub>i</sub></b>: cada operação dos embarques do período. No app, cada embarque do Portal Offshore
            {isEnc ? ' com desembarque no período' : ''}, ou o código de operação da planilha.
          </div>
          <div>
            <b>HP<sub>i</sub></b>: horas programadas no Portal Offshore
            {isEnc ? ' para o embarque inteiro' : ', proporcionais aos dias dentro do período'}.
          </div>
          <div>
            <b>HC<sub>i</sub></b>: horas confirmadas, isto é, o HH executado recebido do fluxo.
          </div>
          <div>
            <b>PE<sub>i</sub> e EX<sub>i</sub></b>: ponderações da programação e da execução, definidas em Configurações (UN ou padrão) ou na planilha.
          </div>
        </div>
      </div>

      {!embarques.length ? (
        <div className="note" style={{ textAlign: 'center', padding: '32px' }}>
          {isEnc
            ? 'Nenhum embarque com desembarque neste período'
            : 'Sem programação de embarque nem HH executado neste período'}
          {filters.fReg || filters.fPlat || filters.fResp ? ' com esses filtros' : ''}. Importe a programação do Portal Offshore na aba Importar dados.
        </div>
      ) : (
        <>
          {/* Alerta de ponderações faltantes */}
          {T.falta > 0 && (
            <div className="note note-warn" style={{ marginBottom: '16px' }}>
              <b>Faltam as ponderações PE e EX</b> em {plural(T.falta, 'embarque', 'embarques')}.
              Informe os valores do contrato em Configurações (padrão ou por unidade de negócio) ou nas colunas PE e EX da planilha do Portal Offshore. Enquanto isso, o app mostra as horas e as comparações, sem a US<sub>off</sub>.
            </div>
          )}

          {/* 6 KPIs */}
          <div className="kpis">
            <KpiCard
              value={T.n}
              label={isEnc ? 'embarques com desembarque no período' : 'embarques no período'}
              tone="blue"
            />
            <KpiCard
              value={formatHours(T.hp)}
              label={isEnc ? 'HP · programado dos embarques' : 'HP · programado no período'}
              tone="blue"
            />
            <KpiCard
              value={formatHours(T.hd)}
              label={`HD · disponível até ${formatBrShort(ate)}`}
              tone="blue"
            />
            <KpiCard
              value={formatHours(T.hc)}
              label="HC · executado confirmado"
              tone="blue"
            />
            <KpiCard
              value={formatPct(T.pD)}
              label="HC ÷ HD (sobre disponível)"
              tone={statusOf(T.pD, dataset.config) === 'ok' ? 'ok' : 'bad'}
            />
            <KpiCard
              value={formatPct(T.pP)}
              label={`HC ÷ HP até ${formatBrShort(ate)}`}
              tone={statusOf(T.pP, dataset.config) === 'ok' ? 'ok' : 'bad'}
            />
          </div>

          {/* Card destaque do total USoff */}
          <div
            className="card"
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--line)',
              borderLeft: '4px solid var(--blue)',
              padding: 'clamp(14px, 4vw, 20px)',
              marginBottom: '28px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <div className="sub" style={{ fontSize: '0.88rem', color: 'var(--ink-muted)', fontWeight: 600 }}>
                  US<sub>off</sub> apurado no período
                </div>
                <div style={{ fontFamily: 'var(--f-display)', fontSize: 'clamp(1.65rem, 6vw, 2.4rem)', fontWeight: 800, color: 'var(--blue)', fontVariantNumeric: 'tabular-nums' }}>
                  {T.us == null ? '—' : formatUs(T.us)}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
                  gap: '12px 24px',
                  background: 'var(--surface-alt)',
                  padding: '12px 18px',
                  borderRadius: 'var(--radius-md)'
                }}
              >
                <div title="Ponderação de Programação (PE × HP_carteira): incide apenas sobre horas em Carteira (>= 12 dias de antecedência). Horas fora da carteira (< 12 dias) pontuam apenas na Execução (EX × HC).">
                  <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                    Parcela da programação &Sigma; PE &times; HP (Carteira)
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                    {T.falta > 0 ? '—' : formatUs(T.peHp)}
                  </div>
                </div>

                <div>
                  <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                    Parcela da execução &Sigma; EX &times; HC
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                    {T.falta > 0 ? '—' : formatUs(T.exHc)}
                  </div>
                </div>

                <div>
                  <div className="sub" style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                    Embarques sem programação
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                    {embarques.filter(x => x.tipo === 'Sem programação').length}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Seção com SegmentedControl e Tabelas */}
          <div style={{ marginBottom: '28px' }}>
            <div className="section-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <SegmentedControl<'embarques' | 'unidades' | 'prepostos' | 'confronto'>
                options={[
                  { value: 'embarques', label: 'Por Embarque (ID)', count: embarques.length },
                  { value: 'unidades', label: 'Por Unidade (UN)', count: groupUn.length },
                  { value: 'prepostos', label: 'Por Preposto', count: groupPreposto.length },
                  {
                    value: 'confronto',
                    label: 'Confronto SAP vs Portal',
                    count: confrontoSummary.divCount > 0 ? confrontoSummary.divCount : confrontoOps.length,
                    badgeTone: confrontoSummary.divCount > 0 ? 'warn' : 'default'
                  }
                ]}
                value={usoffTab}
                onChange={setUsoffTab}
              />
            </div>

            {/* Sub-visão 1: Por Embarque (ID) */}
            {usoffTab === 'embarques' && (
              <div>
                <DataTable
                  data={embarques}
                  columns={embarqueColumns}
                  rowKey={r => r.key}
                  searchable
                  searchPlaceholder="Buscar por ID de embarque, técnico, matrícula ou plataforma..."
                  getSearchString={r => `${r.id_embarque || ''} ${r.op} ${Array.from(r.mats).map(m => `${m} ${dataset.tecnicos[m]?.nome || ''}`).join(' ')} ${Array.from(r.plats).join(' ')} ${Array.from(r.regs).join(' ')}`}
                  emptyMessage="Nenhum embarque encontrado no período."
                />
                <p className="sub" style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                  {isEnc
                    ? 'Exibindo embarques com desembarque no período. Clique no ID ou em Carteira para detalhar ordens e confirmações SAP.'
                    : 'Exibindo embarques ativos no período. Clique no ID ou em Carteira para detalhar ordens e confirmações SAP.'}{' '}
                  A apuração de USOFF é calculada individualmente por operação com trava de execução zero e consolidada por embarque.
                </p>
              </div>
            )}

            {/* Sub-visão 2: Por Unidade */}
            {usoffTab === 'unidades' && (
              <div>
                <DataTable
                  data={groupUn}
                  columns={groupColumns('Unidade')}
                  rowKey={r => r.name}
                  emptyMessage="Sem dados por UN."
                />
              </div>
            )}

            {/* Sub-visão 3: Por Preposto */}
            {usoffTab === 'prepostos' && (
              <div>
                <DataTable
                  data={groupPreposto}
                  columns={groupColumns('Preposto')}
                  rowKey={r => r.name}
                  emptyMessage="Sem dados por preposto."
                />
              </div>
            )}

            {/* Sub-visão 4: Confronto SAP vs Portal */}
            {usoffTab === 'confronto' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Barra de Ações e Filtro de Status */}
                <div
                  className="card"
                  style={{
                    background: 'var(--surface-alt)',
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--line)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', maxWidth: '100%' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--ink)' }}>
                      Filtrar por Status:
                    </label>
                    <select
                      value={confrontoStatusFilter}
                      onChange={e => setConfrontoStatusFilter(e.target.value)}
                      aria-label="Filtrar por Status do Confronto"
                      style={{ padding: '6px 12px', fontWeight: 600, borderRadius: 'var(--radius-sm)', maxWidth: '100%', width: 'min(100%, 360px)' }}
                    >
                      <option value="todos">Todos os registros ({confrontoSummary.totalOps})</option>
                      <option value="divergentes">Apenas com divergência ({confrontoSummary.divCount})</option>
                      <option value="ok">Batimento OK (100%) ({confrontoSummary.okCount})</option>
                      <option value="div_portal_sap">Divergente (Portal &gt; SAP)</option>
                      <option value="div_sap_portal">Divergente (SAP &gt; Portal)</option>
                      <option value="nao_sap">Não Apontado no SAP ({confrontoSummary.naoApontadoSapCount})</option>
                      <option value="nao_portal">Não Confirmado / Não Cadastrado no Portal ({confrontoSummary.naoConfirmadoPortalCount})</option>
                      <option value="nao_conf">Não Confirmado ({confrontoSummary.naoConfirmadoCount})</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {isGlobal && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={handleReconcile}
                        disabled={isReconciling}
                        title="Executa o motor de reconciliação para reprocessar todas as ordens com tolerância de +4 dias e estornos"
                      >
                        {isReconciling ? 'Reconciliando...' : 'Reconciliar SAP'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={handleExportConfronto}
                      disabled={isExportingConfronto || filteredConfrontoOps.length === 0}
                    >
                      {isExportingConfronto ? 'Exportando...' : 'Exportar Confronto (Excel)'}
                    </button>
                  </div>
                </div>

                {/* 6 KPIs de Confronto */}
                <div className="kpis" style={{ marginBottom: 0 }}>
                  <KpiCard
                    value={confrontoSummary.totalOps}
                    label="Operações no período"
                    tone="blue"
                  />
                  <KpiCard
                    value={confrontoSummary.okCount}
                    label="Batimento 100% OK"
                    tone="ok"
                  />
                  <KpiCard
                    value={confrontoSummary.divCount}
                    label="Divergências apuradas"
                    tone={confrontoSummary.divCount > 0 ? 'bad' : 'blue'}
                  />
                  <KpiCard
                    value={formatHours(confrontoSummary.totalHhPortal)}
                    label="HH Conf. Portal Offshore"
                    tone="blue"
                  />
                  <KpiCard
                    value={formatHours(confrontoSummary.totalHhSap)}
                    label="HH Conf. Extrato SAP"
                    tone="blue"
                  />
                  <KpiCard
                    value={(confrontoSummary.diffHh > 0 ? '+' : '') + formatHours(confrontoSummary.diffHh)}
                    label="Saldo Líquido (Portal − SAP)"
                    tone={confrontoSummary.diffHh === 0 ? 'ok' : 'warn'}
                  />
                </div>

                {/* Tabela de Confronto */}
                <DataTable
                  data={filteredConfrontoOps}
                  columns={confrontoColumns}
                  rowKey={r => r.id || `${r.matricula}_${r.ordem}_${r.operacao}_${r.portal_id}`}
                  searchable
                  searchPlaceholder="Buscar por ordem, operação, matrícula, técnico, ID embarque ou plataforma..."
                  getSearchString={r => `${r.ordem} ${r.operacao} ${r.matricula} ${r.nome} ${r.id_embarque || ''} ${r.portal_id || ''} ${r.plataforma_sigla || ''} ${r.unidade_negocio || ''} ${r.status_divergencia || ''}`}
                  emptyMessage="Nenhuma operação encontrada com os filtros selecionados."
                />

                <p className="sub" style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                  A reconciliação vincula os apontamentos do SAP ao embarque físico do Portal Offshore considerando a janela de execução real, tolerância de +4 dias após o desembarque (PMB) e estornos retroativos.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
