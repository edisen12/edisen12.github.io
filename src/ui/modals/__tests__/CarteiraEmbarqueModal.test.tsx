import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CarteiraEmbarqueModal } from '../CarteiraEmbarqueModal';
import { ToastProvider } from '../../components/ToastContext';
import { useApp } from '../../state/AppContext';
import { DEFAULT_CONFIG } from '../../../config/constants';
import { buildPlatformIndex } from '../../../domain/calculations';
import type { AppDataset, PeriodWindow, Plataforma, UserProfile } from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
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
  }
};

const MOCK_PIDX = buildPlatformIndex(MOCK_PLATFORMS);

const MOCK_PERIOD: PeriodWindow = {
  ini: '2026-06-01',
  fim: '2026-06-30',
  m: '2026-06'
};

const MOCK_USER: UserProfile = {
  id: 'usr-admin-1',
  email: 'admin@infotecbrasil.com.br',
  nome: 'Administrador',
  role: 'admin',
  ativo: true
};

function createSyntheticDataset(): AppDataset {
  return {
    config: { ...DEFAULT_CONFIG, hh_dia: 11 },
    usoffUnWeights: {},
    emailsResumo: [],
    plataformas: MOCK_PLATFORMS,
    pessoas: {},
    profiles: {},
    tecnicos: {
      '10231': {
        matricula: '10231',
        nome: 'Carlos Eduardo Sintético',
        funcao: 'Técnico de Instrumentação'
      }
    },
    carteira: [
      {
        id: 'cart-101',
        id_embarque: 'EMB-99881',
        matricula: '10231',
        nome: 'Carlos Eduardo Sintético',
        funcao: 'Técnico de Instrumentação',
        plataforma_sigla: 'P51',
        unidade_negocio: 'UN-BS',
        data_inicio: '2026-06-01',
        data_fim: '2026-06-14',
        horas_programadas: 154,
        hh_carteira: 154,
        hh_fora_carteira: 0,
        operacao: 'OP-GERAL',
        pe: null,
        ex: null,
        fonte: 'Portal Offshore'
      }
    ],
    carteiraOperacoes: [
      {
        id: 'op-1',
        matricula: '10231',
        id_embarque: 'EMB-99881',
        portal_id: 'EMB-99881',
        chave_petrobras: 'CH-1',
        nome: 'Carlos Eduardo Sintético',
        empresa: 'Infotec',
        estrutura: 'Estrutura A',
        unidade_negocio: 'UN-BS',
        ordem: 'ORD-1001',
        operacao: 'OP-10',
        status_processamento: 'Processado',
        prioridade: 'Alta',
        hh_programado: 50,
        hh_confirmado: 40,
        status_programacao: 'Carteira',
        recursos: 1,
        fonte: 'Portal Offshore',
        data_inicio: '2026-06-01',
        data_fim: '2026-06-14',
        plataforma_sigla: 'P51'
      },
      {
        id: 'op-2',
        matricula: '10231',
        id_embarque: 'EMB-99881',
        portal_id: 'EMB-99881',
        chave_petrobras: 'CH-2',
        nome: 'Carlos Eduardo Sintético',
        empresa: 'Infotec',
        estrutura: 'Estrutura A',
        unidade_negocio: 'UN-BS',
        ordem: 'ORD-1002',
        operacao: 'OP-20',
        status_processamento: 'Processado',
        prioridade: 'Média',
        hh_programado: 30,
        hh_confirmado: 20,
        status_programacao: 'Fora da carteira',
        recursos: 1,
        fonte: 'Portal Offshore',
        data_inicio: '2026-06-01',
        data_fim: '2026-06-14',
        plataforma_sigla: 'P51'
      }
    ],
    confirmacoesSap: [
      {
        id: 'sap-1',
        matricula: '10231',
        data_criacao: '2026-06-05',
        ordem: 'ORD-1001',
        operacao: 'OP-10',
        horas_confirmadas: 40,
        data_fim_real: '2026-06-05',
        data_lancamento: '2026-06-05',
        status_reconciliacao: 'Em Carteira',
        id_embarque: 'EMB-99881',
        contador_confirmacao: 1
      },
      {
        id: 'sap-2',
        matricula: '10231',
        data_criacao: '2026-06-06',
        ordem: 'ORD-1002',
        operacao: 'OP-20',
        horas_confirmadas: 25,
        data_fim_real: '2026-06-06',
        data_lancamento: '2026-06-06',
        status_reconciliacao: 'Em Carteira',
        id_embarque: 'EMB-99881',
        contador_confirmacao: 2
      },
      {
        id: 'sap-3',
        matricula: '10231',
        data_criacao: '2026-06-07',
        ordem: 'ORD-9999',
        operacao: 'OP-99',
        horas_confirmadas: 10,
        data_fim_real: '2026-06-07',
        data_lancamento: '2026-06-07',
        status_reconciliacao: 'Fora da Carteira',
        id_embarque: 'EMB-99881',
        contador_confirmacao: 3
      }
    ],
    hhMap: {},
    justMap: {},
    externalCoveredSet: new Set(),
    sharedOpsSet: new Set(),
    watermark: {
      ultima_data_hh: '2026-06-14',
      ultima_importacao_em: '2026-06-14T10:00:00Z'
    },
    latestFluxo: null,
    isDemo: false,
    demoReason: ''
  };
}

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('CarteiraEmbarqueModal', () => {
  const closeCarteiraModal = vi.fn();
  const openFichaDrawer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupModalMock(modalState: { matricula: string; idEmbarque?: string; dataRef?: string } | null) {
    (useApp as any).mockReturnValue({
      carteiraModal: modalState,
      closeCarteiraModal,
      openFichaDrawer,
      dataset: createSyntheticDataset(),
      pidx: MOCK_PIDX,
      activePeriod: MOCK_PERIOD,
      currentUser: MOCK_USER
    });
  }

  it('não renderiza nada quando carteiraModal é nulo', () => {
    setupModalMock(null);
    renderWithToast(<CarteiraEmbarqueModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renderiza os dados institucionais do embarque e KPIs de confronto', () => {
    setupModalMock({ matricula: '10231', idEmbarque: 'EMB-99881' });
    renderWithToast(<CarteiraEmbarqueModal />);

    // Cabeçalho e identificação
    expect(screen.getByText(/Carteira do Embarque/i)).not.toBeNull();
    expect(screen.getByText(/EMB-99881/)).not.toBeNull();
    expect(screen.getByText('Carlos Eduardo Sintético')).not.toBeNull();
    expect(screen.getByText(/P51/)).not.toBeNull();

    // KPIs: HH Programado (80h), HC Portal Offshore (60h), HH Confirmado SAP (75h)
    expect(screen.getByText('HH Programado')).not.toBeNull();
    expect(screen.getByText('HC Portal Offshore')).not.toBeNull();
    expect(screen.getByText('HH Confirmado SAP')).not.toBeNull();
    expect(screen.getByText('Confronto Portal vs SAP')).not.toBeNull();

    // Verifica que as ordens são listadas na tabela
    expect(screen.getByText('ORD-1001')).not.toBeNull();
    expect(screen.getByText('ORD-1002')).not.toBeNull();
    expect(screen.getByText('ORD-9999')).not.toBeNull(); // Não cadastrada no Portal
  });

  it('permite filtrar por busca textual de ordem ou operação', () => {
    setupModalMock({ matricula: '10231', idEmbarque: 'EMB-99881' });
    renderWithToast(<CarteiraEmbarqueModal />);

    const searchInput = screen.getByPlaceholderText(/Buscar ordem ou operação/i);
    fireEvent.change(searchInput, { target: { value: 'ORD-9999' } });

    expect(screen.getByText('ORD-9999')).not.toBeNull();
    expect(screen.queryByText('ORD-1001')).toBeNull();
  });

  it('permite filtrar por status da programação', () => {
    setupModalMock({ matricula: '10231', idEmbarque: 'EMB-99881' });
    renderWithToast(<CarteiraEmbarqueModal />);

    // Clica no filtro "Não Cadastrado no Portal"
    const naoCadastradoBtn = screen.getByRole('button', { name: /Não Cadastrado no Portal/i });
    fireEvent.click(naoCadastradoBtn);

    expect(screen.getByText('ORD-9999')).not.toBeNull();
    expect(screen.queryByText('ORD-1001')).toBeNull();
  });

  it('dispara closeCarteiraModal ao clicar no botão Fechar', () => {
    setupModalMock({ matricula: '10231', idEmbarque: 'EMB-99881' });
    renderWithToast(<CarteiraEmbarqueModal />);

    const closeBtn = screen.getByRole('button', { name: /^Fechar$/i });
    fireEvent.click(closeBtn);

    expect(closeCarteiraModal).toHaveBeenCalledTimes(1);
  });

  it('exibe o card e as colunas de USOFF quando configurados os pesos PE e EX', () => {
    const ds = createSyntheticDataset();
    ds.config.us_pe_padrao = 0.30;
    ds.config.us_ex_padrao = 0.70;

    (useApp as any).mockReturnValue({
      carteiraModal: { matricula: '10231', idEmbarque: 'EMB-99881' },
      closeCarteiraModal,
      openFichaDrawer,
      dataset: ds,
      pidx: MOCK_PIDX,
      activePeriod: MOCK_PERIOD,
      currentUser: MOCK_USER
    });

    renderWithToast(<CarteiraEmbarqueModal />);

    // Card de Apuração de USOFF
    expect(screen.getByText(/Apurado deste Embarque/i)).not.toBeNull();
    expect(screen.getByText(/PE × HP \(Carteira\)/i)).not.toBeNull();
    expect(screen.getByText(/EX × HC \(Execução\)/i)).not.toBeNull();
    expect(screen.getByText('Trava de Execução Zero')).not.toBeNull();

    // Colunas na tabela
    expect(screen.getByRole('columnheader', { name: /PE × HP/i })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: /EX × HC/i })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: /^USoff$/i })).not.toBeNull();

    // Motivos das operações
    expect(screen.getByText('PE×HP + EX×HC')).not.toBeNull();
    expect(screen.getAllByText('Apenas EX (Fora)').length).toBeGreaterThanOrEqual(1);
  });

  it('aplica a trava de execução zero (HC = 0 -> USOFF = 0)', () => {
    const ds = createSyntheticDataset();
    ds.config.us_pe_padrao = 0.30;
    ds.config.us_ex_padrao = 0.70;
    // Força execução zero na primeira operação
    if (ds.carteiraOperacoes && ds.carteiraOperacoes[0]) {
      ds.carteiraOperacoes[0].hh_confirmado = 0;
    }
    if (ds.confirmacoesSap) {
      ds.confirmacoesSap = ds.confirmacoesSap.filter(s => s.ordem !== 'ORD-1001');
    }

    (useApp as any).mockReturnValue({
      carteiraModal: { matricula: '10231', idEmbarque: 'EMB-99881' },
      closeCarteiraModal,
      openFichaDrawer,
      dataset: ds,
      pidx: MOCK_PIDX,
      activePeriod: MOCK_PERIOD,
      currentUser: MOCK_USER
    });

    renderWithToast(<CarteiraEmbarqueModal />);

    // Trava de execução zero deve aparecer
    expect(screen.getByText('Trava de Execução Zero')).not.toBeNull();
    expect(screen.getByText('1 op. sem USOFF')).not.toBeNull();
    expect(screen.getByText('Execução Zero (HC=0)')).not.toBeNull();
  });
});
