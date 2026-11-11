import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MedicaoUsoffView } from '../MedicaoUsoffView';
import { ToastProvider } from '../../components/ToastContext';
import { useApp } from '../../state/AppContext';
import { DEFAULT_CONFIG } from '../../../config/constants';
import { buildPlatformIndex } from '../../../domain/calculations';
import type {
  AppDataset,
  FilterState,
  PeriodWindow,
  Plataforma
} from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/excel.service', () => ({
  exportUsoffXlsx: vi.fn().mockResolvedValue(undefined),
  exportConfrontoSAPXlsx: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../../services/data.service', () => ({
  reconciliarConfirmacoesSAP: vi.fn().mockResolvedValue({
    operacoes_com_batimento_ok: 10,
    operacoes_com_divergencia: 0
  })
}));

const MOCK_PLATFORMS: Record<string, Plataforma> = {
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
  ini: '2026-10-01',
  fim: '2026-10-20',
  m: '2026-10'
};

const MOCK_FILTERS: FilterState = {
  fDate: '2026-10-15',
  fReg: '',
  fPlat: '',
  fResp: '',
  fPer: '',
  cIni: '',
  cFim: ''
};

function createMockDataset(): AppDataset {
  return {
    config: {
      ...DEFAULT_CONFIG,
      hh_dia: 11,
      meta_percentual: 100,
      atencao_percentual: 90,
      us_pe_padrao: 0.30,
      us_ex_padrao: 0.70
    },
    usoffUnWeights: {},
    emailsResumo: [],
    plataformas: MOCK_PLATFORMS,
    pessoas: {},
    profiles: {},
    tecnicos: {
      '1001': { matricula: '1001', nome: 'Carlos Eduardo Silva', funcao: 'Automação' }
    },
    carteira: [
      {
        id: 'cart-1',
        id_embarque: '55104',
        matricula: '1001',
        operacao: '',
        pe: null,
        ex: null,
        fonte: 'portal',
        plataforma_sigla: 'P58',
        unidade_negocio: 'UN-ES',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        horas_programadas: 130
      }
    ],
    carteiraOperacoes: [
      {
        id: 'op-1',
        portal_id: '55104',
        id_embarque: '55104',
        matricula: '1001',
        chave_petrobras: '',
        nome: 'Carlos Eduardo Silva',
        empresa: 'Infotec Brasil',
        estrutura: '',
        plataforma_sigla: 'P58',
        unidade_negocio: 'UN-ES',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        ordem: 'ORD-1000',
        operacao: 'OP-0010',
        status_processamento: 'Pendente',
        prioridade: 'Regular',
        status_programacao: 'Carteira',
        hh_programado: 10,
        hh_confirmado: 10,
        hh_confirmado_sap: 10,
        divergencia_sap: 0,
        status_divergencia: 'OK',
        recursos: 1,
        fonte: 'portal'
      },
      {
        id: 'op-2',
        portal_id: '55104',
        id_embarque: '55104',
        matricula: '1001',
        chave_petrobras: '',
        nome: 'Carlos Eduardo Silva',
        empresa: 'Infotec Brasil',
        estrutura: '',
        plataforma_sigla: 'P58',
        unidade_negocio: 'UN-ES',
        data_inicio: '2026-10-01',
        data_fim: '2026-10-14',
        ordem: 'ORD-2000',
        operacao: 'OP-0020',
        status_processamento: 'Pendente',
        prioridade: 'Regular',
        status_programacao: 'Carteira',
        hh_programado: 120,
        hh_confirmado: 0,
        hh_confirmado_sap: 0,
        divergencia_sap: 0,
        status_divergencia: 'Não Confirmado',
        recursos: 1,
        fonte: 'portal'
      }
    ],
    confirmacoesSap: [],
    hhMap: {},
    justMap: {},
    externalCoveredSet: new Set<string>(),
    sharedOpsSet: new Set<string>(),
    watermark: {
      ultima_data_hh: '2026-10-15',
      ultima_importacao_em: '2026-10-15T10:00:00'
    },
    latestFluxo: null,
    isDemo: false,
    demoReason: ''
  };
}

describe('MedicaoUsoffView - Medição USOFF & Visualização por Embarque', () => {
  const mockOpenCarteiraModal = vi.fn();
  const mockOpenFichaDrawer = vi.fn();
  const mockRefreshData = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useApp as any).mockReturnValue({
      dataset: createMockDataset(),
      pidx: MOCK_PIDX,
      activePeriod: MOCK_PERIOD,
      filters: MOCK_FILTERS,
      openFichaDrawer: mockOpenFichaDrawer,
      openCarteiraModal: mockOpenCarteiraModal,
      scopeLabel: undefined,
      isGlobal: true,
      refreshData: mockRefreshData
    });
  });

  it('renderiza o cabeçalho, card da fórmula de USOFF e tem a aba Por Embarque (ID) ativa por padrão', () => {
    render(
      <ToastProvider>
        <MedicaoUsoffView />
      </ToastProvider>
    );

    // Título e fórmula
    expect(screen.getByText(/Medição USOFF/i)).not.toBeNull();
    expect(screen.getByText(/fórmula de apuração do SERVIÇO TÉCNICO OFFSHORE/i)).not.toBeNull();

    // Aba ativa por padrão: Por Embarque (ID)
    expect(screen.getByText(/Por Embarque \(ID\)/i)).not.toBeNull();
    expect(screen.getByText('55104')).not.toBeNull();
    expect(screen.getByText('Carlos Eduardo Silva')).not.toBeNull();
    expect(screen.getByText('2 operações')).not.toBeNull();
  });

  it('permite abrir a Carteira do Embarque ao clicar no ID de embarque ou no botão Carteira', () => {
    render(
      <ToastProvider>
        <MedicaoUsoffView />
      </ToastProvider>
    );

    // Clica no botão de badge do ID 55104
    const idBtn = screen.getByText('55104');
    fireEvent.click(idBtn);
    expect(mockOpenCarteiraModal).toHaveBeenCalledWith('1001', '55104', '2026-10-01');

    // Clica no botão de ação "Carteira"
    const carteiraBtn = screen.getByRole('button', { name: /Carteira/i });
    fireEvent.click(carteiraBtn);
    expect(mockOpenCarteiraModal).toHaveBeenCalledWith('1001', '55104', '2026-10-01');
  });

  it('permite abrir a Ficha do Técnico ao clicar no nome do técnico', () => {
    render(
      <ToastProvider>
        <MedicaoUsoffView />
      </ToastProvider>
    );

    const tecBtn = screen.getByText('Carlos Eduardo Silva');
    fireEvent.click(tecBtn);
    expect(mockOpenFichaDrawer).toHaveBeenCalledWith('1001');
  });

  it('não exibe a aba Por Operação e permite alternar para a aba Por Unidade (UN)', () => {
    render(
      <ToastProvider>
        <MedicaoUsoffView />
      </ToastProvider>
    );

    // Confirma que a aba "Por Operação" não existe mais
    expect(screen.queryByRole('tab', { name: /Por Operação/i })).toBeNull();

    // Clica na aba Por Unidade (UN)
    const unTabBtn = screen.getByRole('tab', { name: /Por Unidade \(UN\)/i });
    fireEvent.click(unTabBtn);

    // Tabela exibe a coluna Unidade
    expect(screen.getByRole('columnheader', { name: /Unidade/i })).not.toBeNull();
  });

  it('permite alternar para a aba Confronto SAP vs Portal', () => {
    render(
      <ToastProvider>
        <MedicaoUsoffView />
      </ToastProvider>
    );

    const confrontoTabBtn = screen.getByRole('tab', { name: /Confronto SAP vs Portal/i });
    fireEvent.click(confrontoTabBtn);

    expect(screen.getByText(/Filtrar por Status:/i)).not.toBeNull();
    expect(screen.getByText(/Batimento 100% OK/i)).not.toBeNull();
  });
});