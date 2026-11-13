import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VisaoGeralView } from '../VisaoGeralView';
import { PainelDiaView } from '../PainelDiaView';
import { EmbarqueAtualView } from '../EmbarqueAtualView';
import { JustificativasView } from '../JustificativasView';
import { ToastProvider } from '../../components/ToastContext';
import { useApp } from '../../state/AppContext';
import { exportPainelDiaOrdensXlsx } from '../../../services/excel.service';
import { DEFAULT_CONFIG } from '../../../config/constants';
import { buildPlatformIndex } from '../../../domain/calculations';
import type {
  AppDataset,
  FilterState,
  PeriodWindow,
  Plataforma,
  UserProfile
} from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/excel.service', () => ({
  exportPainelDiaOrdensXlsx: vi.fn().mockResolvedValue(undefined)
}));

const MOCK_PLATFORMS: Record<string, Plataforma> = {
  P51: {
    sigla: 'P51',
    chave_norm: 'P51',
    nome: 'Plataforma P-51',
    un: 'UN-BS',
    armador: '',
    gerencia: 'UO-BS',
    tipo: 'SS',
    situacao: 'Mobilizada',
    cadastro_pendente: false
  },
  P58: {
    sigla: 'P58',
    chave_norm: 'P58',
    nome: 'Plataforma P-58',
    un: 'UN-ES',
    armador: '',
    gerencia: 'UO-ES',
    tipo: 'FPSO',
    situacao: 'Mobilizada',
    cadastro_pendente: false
  }
};

const MOCK_PIDX = buildPlatformIndex(MOCK_PLATFORMS);

const MOCK_PERIOD: PeriodWindow = {
  ini: '2026-06-01',
  fim: '2026-06-20',
  m: '2026-06'
};

const MOCK_USER: UserProfile = {
  id: 'usr-gestor-1',
  email: 'gestor.teste@infotecbrasil.com.br',
  nome: 'Lucas Silva Pereira',
  role: 'gestor',
  ativo: true
};

function createSyntheticDataset(): AppDataset {
  return {
    config: {
      ...DEFAULT_CONFIG,
      hh_dia: 11,
      meta_percentual: 100,
      atencao_percentual: 90,
      prazo_justificativa_dias: 2
    },
    usoffUnWeights: {},
    emailsResumo: ['coordenacao.operacional@infotecbrasil.com.br'],
    plataformas: MOCK_PLATFORMS,
    pessoas: {
      'pes-1': {
        id: 'pes-1',
        slug: 'camila-rocha-mendes',
        nome: 'Camila Rocha Mendes',
        papel: 'preposto',
        email: 'preposto.teste@infotecbrasil.com.br',
        user_id: 'usr-prep-1',
        plats: ['P51'],
        uns: ['UN-BS']
      },
      'pes-2': {
        id: 'pes-2',
        slug: 'bruno-alves-sintetico',
        nome: 'Bruno Alves Sintético',
        papel: 'preposto',
        email: 'bruno.alves@infotecbrasil.com.br',
        user_id: null,
        plats: ['P58'],
        uns: ['UN-ES']
      }
    },
    profiles: {},
    tecnicos: {
      '10231': {
        matricula: '10231',
        nome: 'Carlos Eduardo Sintético',
        funcao: 'Técnico de Automação'
      },
      '10232': {
        matricula: '10232',
        nome: 'Mariana Lima Sintética',
        funcao: 'Técnica de Elétrica'
      }
    },
    carteira: [
      {
        id: 'emb-1',
        id_embarque: '55104',
        matricula: '10231',
        nome: 'Carlos Eduardo Sintético',
        funcao: 'Técnico de Automação',
        plataforma_sigla: 'P51',
        unidade_negocio: 'UN-BS',
        data_inicio: '2026-06-01',
        data_fim: '2026-06-14',
        horas_programadas: 154,
        operacao: '0010',
        pe: 0.5,
        ex: 1.0,
        fonte: 'portal'
      },
      {
        id: 'emb-2',
        id_embarque: '55208',
        matricula: '10232',
        nome: 'Mariana Lima Sintética',
        funcao: 'Técnica de Elétrica',
        plataforma_sigla: 'P58',
        unidade_negocio: 'UN-ES',
        data_inicio: '2026-06-01',
        data_fim: '2026-06-14',
        horas_programadas: 154,
        operacao: '0020',
        pe: 0.5,
        ex: 1.0,
        fonte: 'portal'
      }
    ],
    carteiraOperacoes: [],
    confirmacoesSap: [
      {
        id: 'sap-1',
        matricula: '10231',
        data_criacao: '2026-06-02',
        data_lancamento: '2026-06-02',
        data_fim_real: '2026-06-02',
        ordem: '20045001',
        operacao: '0010',
        horas_confirmadas: 4,
        contador_confirmacao: 1,
        id_embarque: '55104',
        status_reconciliacao: 'Em Carteira'
      },
      {
        id: 'sap-2',
        matricula: '10231',
        data_criacao: '2026-06-02',
        data_lancamento: '2026-06-02',
        data_fim_real: '2026-06-02',
        ordem: '20099988',
        operacao: '0020',
        horas_confirmadas: 3.5,
        contador_confirmacao: 2,
        id_embarque: '55104',
        status_reconciliacao: 'Fora da Carteira'
      }
    ],
    hhMap: {
      '10231|2026-06-01': {
        matricula: '10231',
        data: '2026-06-01',
        plataforma_sigla: 'P51',
        unidade_negocio: 'UN-BS',
        horas_executadas: 11
      },
      '10231|2026-06-02': {
        matricula: '10231',
        data: '2026-06-02',
        plataforma_sigla: 'P51',
        unidade_negocio: 'UN-BS',
        horas_executadas: 7.5
      },
      '10232|2026-06-01': {
        matricula: '10232',
        data: '2026-06-01',
        plataforma_sigla: 'P58',
        unidade_negocio: 'UN-ES',
        horas_executadas: 9
      },
      '10232|2026-06-02': {
        matricula: '10232',
        data: '2026-06-02',
        plataforma_sigla: 'P58',
        unidade_negocio: 'UN-ES',
        horas_executadas: 11
      }
    },
    justMap: {
      '10232|2026-06-01': {
        id: 'just-1',
        matricula: '10232',
        data: '2026-06-01',
        motivo: 'Gangway desconectada',
        horas_gangway: 2,
        descricao: 'Ajuste de gangway preventivo',
        responsavel_nome: 'Bruno Alves Sintético',
        criado_em: '2026-06-02T10:00:00Z',
        criado_por: 'usr-prep-2'
      }
    },
    externalCoveredSet: new Set<string>(),
    sharedOpsSet: new Set<string>(),
    watermark: { ultima_data_hh: '2026-06-02', ultima_importacao_em: '2026-06-03T08:00:00Z' },
    latestFluxo: null,
    isDemo: false,
    demoReason: ''
  };
}

function setupAppMock(overrides: Record<string, unknown> = {}) {
  const dataset = createSyntheticDataset();
  const filters: FilterState = {
    fDate: '2026-06-02',
    fReg: '',
    fPlat: '',
    fResp: '',
    fPer: '',
    cIni: '',
    cFim: ''
  };

  const ctx = {
    dataset,
    pidx: MOCK_PIDX,
    activePeriod: MOCK_PERIOD,
    filters,
    setFilters: vi.fn(),
    updateFilter: vi.fn(),
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    userProfile: MOCK_USER,
    isGlobal: true,
    isAdmin: false,
    scopeLabel: undefined,
    openFichaDrawer: vi.fn(),
    closeFichaDrawer: vi.fn(),
    openJustModal: vi.fn(),
    closeJustModal: vi.fn(),
    openEmailModal: vi.fn(),
    closeEmailModal: vi.fn(),
    refreshData: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };

  vi.mocked(useApp).mockReturnValue(ctx as unknown as ReturnType<typeof useApp>);
  return ctx;
}

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('Views Operacionais (VisaoGeralView, PainelDiaView, EmbarqueAtualView, JustificativasView)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      },
      writable: true,
      configurable: true
    });
  });

  describe('VisaoGeralView', () => {
    it('renderiza os 6 KPIs principais sem crash com dataset sintético', () => {
      setupAppMock();
      renderWithToast(<VisaoGeralView />);

      expect(screen.getByText('técnicos no período')).not.toBeNull();
      expect(screen.getByText('execução acumulada no período')).not.toBeNull();
      expect(screen.getByText(/execução em 02\/06/i)).not.toBeNull();
      expect(screen.getAllByText(/dias com problema/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('técnicos abaixo da meta no acumulado')).not.toBeNull();
      expect(screen.getByText('justificativas pendentes')).not.toBeNull();
    });

    it('renderiza tabela de plataformas operacionais e permite navegar até o detalhe da plataforma', () => {
      const updateFilter = vi.fn();
      setupAppMock({ updateFilter });
      renderWithToast(<VisaoGeralView />);

      expect(screen.getAllByText('P51').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('P58').length).toBeGreaterThanOrEqual(1);

      const btnP51 = screen.getAllByRole('button', { name: 'P51' })[0];
      fireEvent.click(btnP51);

      expect(updateFilter).toHaveBeenCalledWith('fPlat', 'P51');
    });

    it('no detalhe da plataforma (fPlat ativo), exibe técnicos embarcados e abre a ficha do técnico', () => {
      const openFichaDrawer = vi.fn();
      setupAppMock({
        filters: {
          fDate: '2026-06-02',
          fReg: '',
          fPlat: 'P51',
          fResp: '',
          fPer: '',
          cIni: '',
          cFim: ''
        },
        openFichaDrawer
      });

      renderWithToast(<VisaoGeralView />);

      expect(screen.getByText('Carlos Eduardo Sintético')).not.toBeNull();
      expect(screen.getByText(/Mat\. 10231/i)).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Carlos Eduardo Sintético' }));
      expect(openFichaDrawer).toHaveBeenCalledWith('10231');
    });

    it('aplica filtro por responsável (fResp) no detalhe e exibe Prepostos na tabela de UNs via de-para sem UN manual', () => {
      const dsSemUnManual = createSyntheticDataset();
      dsSemUnManual.pessoas['pes-1'].uns = [];
      dsSemUnManual.pessoas['pes-2'].uns = [];

      // 1) Sem fResp: tabela de UNs lista responsáveis derivados por plataforma -> UN (de-para)
      setupAppMock({ dataset: dsSemUnManual });
      const { unmount } = renderWithToast(<VisaoGeralView />);
      expect(screen.getAllByText(/Camila Rocha Mendes/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Bruno Alves Sintético/).length).toBeGreaterThanOrEqual(1);
      unmount();

      // 2) Com fResp = 'pes-1': exibe visão detalhada restrita apenas às plataformas atribuídas a pes-1
      setupAppMock({
        dataset: dsSemUnManual,
        filters: {
          fDate: '2026-06-02',
          fReg: '',
          fPlat: '',
          fResp: 'pes-1',
          fPer: '',
          cIni: '',
          cFim: ''
        }
      });
      renderWithToast(<VisaoGeralView />);
      expect(screen.getByText(/Camila Rocha Mendes · Preposto/)).not.toBeNull();
      expect(screen.getByText(/\(UN: UN-BS\)/)).not.toBeNull();
      expect(screen.getAllByText('P51').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('P58')).toBeNull();
    });
  });

  describe('PainelDiaView', () => {
    it('renderiza KPIs do dia e alerta explicativo de apontamento abaixo das horas', () => {
      setupAppMock();
      renderWithToast(<PainelDiaView />);

      expect(screen.getByText(/Execução de 02\/06\/2026/i)).not.toBeNull();
      expect(screen.getByText('técnicos embarcados')).not.toBeNull();
      expect(screen.getByText('HH disponível')).not.toBeNull();
      expect(screen.getByText('HH executado')).not.toBeNull();
      expect(screen.getByText('execução do dia')).not.toBeNull();
      expect(screen.getByText('abaixo das horas disponíveis')).not.toBeNull();

      // Alerta para pendência de justificativa
      expect(screen.getByText(/não executou as horas disponíveis em 02\/06\/2026/i)).not.toBeNull();
    });

    it('alterna visualização entre técnicos abaixo das horas e todos os técnicos via SegmentedControl', () => {
      setupAppMock();
      renderWithToast(<PainelDiaView />);

      // Por padrão abre com "Abaixo das horas"
      expect(screen.getByText('Carlos Eduardo Sintético')).not.toBeNull();
      expect(screen.queryByText('Mariana Lima Sintética')).toBeNull();

      // Alterna para "Todos os técnicos"
      const todosBtn = screen.getByRole('tab', { name: /Todos os técnicos/i });
      fireEvent.click(todosBtn);

      expect(screen.getByText('Carlos Eduardo Sintético')).not.toBeNull();
      expect(screen.getByText('Mariana Lima Sintética')).not.toBeNull();
    });

    it('abre modal de ordens SAP do dia ao clicar no botão de ordens com divergência ⚠️', () => {
      setupAppMock();
      renderWithToast(<PainelDiaView />);

      const sapBtn = screen.getByRole('button', { name: /2 ordens ⚠️/i });
      expect(sapBtn).not.toBeNull();

      fireEvent.click(sapBtn);

      expect(screen.getByText(/Ordens e Operações no SAP · 02\/06\/2026/i)).not.toBeNull();
      expect(screen.getByText('20045001')).not.toBeNull();
      expect(screen.getByText('20099988')).not.toBeNull();
      expect(screen.getByText('Cadastrada no Portal')).not.toBeNull();
      expect(screen.getByText('Não Cadastrada no Portal')).not.toBeNull();
      expect(screen.getByText(/não constam na carteira programada do Portal Offshore/i)).not.toBeNull();

      // Fecha modal pelo botão Fechar janela
      fireEvent.click(screen.getByRole('button', { name: 'Fechar janela' }));
      expect(screen.queryByText(/Ordens e Operações no SAP · 02\/06\/2026/i)).toBeNull();
    });

    it('botão "Exportar Apontamentos do Dia (Excel)" chama exportPainelDiaOrdensXlsx com scopeLabel para usuário restrito', async () => {
      const ctx = setupAppMock({
        isGlobal: false,
        scopeLabel: 'Carteira P51'
      });

      renderWithToast(<PainelDiaView />);

      const exportBtn = screen.getByRole('button', { name: /Exportar Apontamentos do Dia \(Excel\)/i });
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(exportPainelDiaOrdensXlsx).toHaveBeenCalledTimes(1);
        expect(exportPainelDiaOrdensXlsx).toHaveBeenCalledWith(
          expect.objectContaining({
            date: '2026-06-02',
            dataset: ctx.dataset,
            scopeLabel: 'Carteira P51'
          })
        );
      });
    });

    it('botão "Exportar Apontamentos do Dia (Excel)" passa scopeLabel undefined para usuário global', async () => {
      const ctx = setupAppMock({
        isGlobal: true,
        scopeLabel: undefined
      });

      renderWithToast(<PainelDiaView />);

      const exportBtn = screen.getByRole('button', { name: /Exportar Apontamentos do Dia \(Excel\)/i });
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(exportPainelDiaOrdensXlsx).toHaveBeenCalledTimes(1);
        expect(exportPainelDiaOrdensXlsx).toHaveBeenCalledWith(
          expect.objectContaining({
            date: '2026-06-02',
            dataset: ctx.dataset,
            scopeLabel: undefined
          })
        );
      });
    });

    it('aciona openJustModal ao clicar no botão "Justificar" da linha do técnico', () => {
      const openJustModal = vi.fn();
      setupAppMock({ openJustModal });
      renderWithToast(<PainelDiaView />);

      const justBtn = screen.getByRole('button', { name: 'Justificar' });
      fireEvent.click(justBtn);

      expect(openJustModal).toHaveBeenCalledWith('10231', '2026-06-02');
    });
  });

  describe('EmbarqueAtualView', () => {
    it('renderiza KPIs de embarque e exibe a coluna "ID Embarque" com tags monospace para identificadores únicos', () => {
      setupAppMock();
      renderWithToast(<EmbarqueAtualView />);

      // KPIs
      expect(screen.getByText('técnicos a bordo')).not.toBeNull();
      expect(screen.getByText('HH programado total')).not.toBeNull();
      expect(screen.getByText('HH disponível até a data')).not.toBeNull();
      expect(screen.getByText('HH executado até a data')).not.toBeNull();

      // Coluna ID Embarque no cabeçalho
      expect(screen.getByText('ID Embarque')).not.toBeNull();

      // Badges numéricos do Portal Offshore
      expect(screen.getByText('55104')).not.toBeNull();
      expect(screen.getByText('55208')).not.toBeNull();

      // Nomes dos técnicos embarcados
      expect(screen.getByText('Carlos Eduardo Sintético')).not.toBeNull();
      expect(screen.getByText('Mariana Lima Sintética')).not.toBeNull();
    });

    it('aciona openFichaDrawer ao clicar no técnico na visão de embarque', () => {
      const openFichaDrawer = vi.fn();
      setupAppMock({ openFichaDrawer });
      renderWithToast(<EmbarqueAtualView />);

      fireEvent.click(screen.getByRole('button', { name: 'Carlos Eduardo Sintético' }));
      expect(openFichaDrawer).toHaveBeenCalledWith('10231');
    });

    it('filtra embarques exibidos quando fResp está selecionado', () => {
      const dsSemUnManual = createSyntheticDataset();
      dsSemUnManual.pessoas['pes-1'].uns = [];
      dsSemUnManual.pessoas['pes-2'].uns = [];

      setupAppMock({
        dataset: dsSemUnManual,
        filters: {
          fDate: '2026-06-02',
          fReg: '',
          fPlat: '',
          fResp: 'pes-1',
          fPer: '',
          cIni: '',
          cFim: ''
        }
      });
      renderWithToast(<EmbarqueAtualView />);

      expect(screen.getAllByText(/55104/).length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(/55208/)).toBeNull();
    });
  });

  describe('JustificativasView', () => {
    it('renderiza os 6 KPIs de SLA de justificativas', () => {
      setupAppMock();
      renderWithToast(<JustificativasView />);

      expect(screen.getByRole('heading', { name: /Justificativas ·/i })).not.toBeNull();
      expect(screen.getByText('dias que pedem justificativa')).not.toBeNull();
      expect(screen.getByText('justificados')).not.toBeNull();
      expect(screen.getByText('pendentes dentro do prazo')).not.toBeNull();
      expect(screen.getByText('pendentes com prazo vencido')).not.toBeNull();
      expect(screen.getByText('justificados fora do prazo')).not.toBeNull();
      expect(screen.getByText('tempo médio para justificar')).not.toBeNull();
    });

    it('permite alternar entre as 3 sub-abas via SegmentedControl', () => {
      setupAppMock();
      renderWithToast(<JustificativasView />);

      // 1. Sub-aba padrão: Cobrança por responsável
      expect(screen.getByRole('tab', { name: /Cobrança por responsável/i })).not.toBeNull();
      expect(screen.getByRole('heading', { name: /Cobrança por responsável/i })).not.toBeNull();
      expect(screen.getByText('Cobrança por unidade de negócio')).not.toBeNull();

      // 2. Alterna para Pendentes de justificativa
      const pendTab = screen.getByRole('tab', { name: /Pendentes de justificativa/i });
      fireEvent.click(pendTab);

      expect(screen.getByText('dias abaixo das horas')).not.toBeNull();
      expect(screen.getByText('Carlos Eduardo Sintético')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Justificar' })).not.toBeNull();

      // 3. Alterna para Justificativas registradas
      const feitasTab = screen.getByRole('tab', { name: /Justificativas registradas/i });
      fireEvent.click(feitasTab);

      expect(screen.getByText('Motivos registrados')).not.toBeNull();
      expect(screen.getByText('perdidas com gangway')).not.toBeNull();
      expect(screen.getAllByText(/Gangway desconectada/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/2,0 h de gangway/i)).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Editar' })).not.toBeNull();
    });

    it('dispara ações de cobrança via openEmailModal (individual e todos com pendência)', () => {
      const openEmailModal = vi.fn();
      setupAppMock({ openEmailModal });
      renderWithToast(<JustificativasView />);

      // Botão "Cobrar" na linha de Camila Rocha Mendes
      const cobrarBtn = screen.getByRole('button', { name: 'Cobrar' });
      fireEvent.click(cobrarBtn);

      expect(openEmailModal).toHaveBeenCalledWith({
        mode: 'cobranca',
        targetRespId: 'pes-1'
      });

      // Botão "Cobrar todos com pendência (1)"
      const cobrarTodosBtn = screen.getByRole('button', { name: /Cobrar todos com pendência/i });
      fireEvent.click(cobrarTodosBtn);

      expect(openEmailModal).toHaveBeenCalledWith({
        mode: 'cobranca',
        targetRespId: '*'
      });
    });

    it('copia lista de cobrança para a área de transferência ao clicar em "Copiar lista de cobrança"', async () => {
      setupAppMock();
      renderWithToast(<JustificativasView />);

      const copyBtn = screen.getByRole('button', { name: /Copiar lista de cobrança/i });
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Lista de cobrança copiada para a área de transferência!')).not.toBeNull();
      });
    });
  });
});
