import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TecnicosManager } from '../TecnicosManager';
import { useApp } from '../../state/AppContext';
import { ToastProvider } from '../ToastContext';
import { saveTecnico, deleteTecnico } from '../../../services/data.service';
import { exportTecnicosListXlsx, exportModeloXlsx } from '../../../services/excel.service';
import type { AppDataset, Tecnico } from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/data.service', () => ({
  saveTecnico: vi.fn().mockResolvedValue(undefined),
  deleteTecnico: vi.fn().mockResolvedValue(undefined),
  batchImportTecnicos: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../../services/excel.service', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../services/excel.service')>();
  return {
    ...actual,
    exportTecnicosListXlsx: vi.fn().mockResolvedValue(undefined),
    exportModeloXlsx: vi.fn().mockResolvedValue(undefined)
  };
});

const MOCK_TECNICOS: Record<string, Tecnico> = {
  '10231': { matricula: '10231', nome: 'Carlos Silva', funcao: 'Técnico de Manutenção' },
  '10232': { matricula: '10232', nome: 'Ana Souza', funcao: 'Instrumentista' },
  '10233': { matricula: '10233', nome: 'Roberto Alves', funcao: 'Caldeireiro' }
};

const MOCK_DATASET: Partial<AppDataset> = {
  tecnicos: MOCK_TECNICOS,
  hhMap: {
    '10231|2026-05-25': {
      matricula: '10231',
      data: '2026-05-25',
      plataforma_sigla: 'P58',
      unidade_negocio: 'UN-BSPS',
      horas_executadas: 11
    }
  },
  carteira: [
    {
      id: 'emb-1',
      matricula: '10231',
      plataforma_sigla: 'P58',
      unidade_negocio: 'UN-BSPS',
      data_inicio: '2026-05-20',
      data_fim: '2026-06-03',
      horas_programadas: 154,
      operacao: 'OP-01',
      pe: 1,
      ex: 1,
      fonte: 'carteira'
    }
  ],
  plataformas: {}
};

function renderTecnicosManager(overrideApp?: Record<string, unknown>) {
  const openFichaDrawer = vi.fn();
  const refreshData = vi.fn().mockResolvedValue(undefined);

  const defaultApp = {
    dataset: MOCK_DATASET,
    pidx: {},
    isGlobal: true,
    isAdmin: true,
    openFichaDrawer,
    refreshData,
    ...overrideApp
  };
  (useApp as unknown as ReturnType<typeof vi.fn>).mockReturnValue(defaultApp);

  const utils = render(
    <ToastProvider>
      <TecnicosManager />
    </ToastProvider>
  );

  return { ...utils, openFichaDrawer, refreshData };
}

describe('TecnicosManager (Gestão de Técnicos Offshore)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Renderiza o cabeçalho, KPIs, botões de ação e lista os técnicos cadastrados', () => {
    renderTecnicosManager();

    expect(screen.getByText(/Gerenciamento de Técnicos Offshore/i)).not.toBeNull();
    expect(screen.getByText(/Total Cadastrados:/i)).not.toBeNull();
    expect(screen.getByText(/Com Histórico \(HH\/Emb\):/i)).not.toBeNull();

    // Colunas e linhas
    expect(screen.getByText('Carlos Silva')).not.toBeNull();
    expect(screen.getByText('10231')).not.toBeNull();
    expect(screen.getByText('Ana Souza')).not.toBeNull();
    expect(screen.getByText('10232')).not.toBeNull();
    expect(screen.getByText('Roberto Alves')).not.toBeNull();
    expect(screen.getByText('10233')).not.toBeNull();

    // Contadores de histórico
    expect(screen.getByText('1 HHs')).not.toBeNull();
    expect(screen.getByText('1 Emb.')).not.toBeNull();
  });

  it('2. Permite buscar técnicos por nome, matrícula ou especialidade', () => {
    renderTecnicosManager();

    const searchInput = screen.getByPlaceholderText(/Buscar por nome, matrícula ou função…/i);
    fireEvent.change(searchInput, { target: { value: 'Ana' } });

    expect(screen.getByText('Ana Souza')).not.toBeNull();
    expect(screen.queryByText('Carlos Silva')).toBeNull();
    expect(screen.queryByText('Roberto Alves')).toBeNull();

    // Limpa busca
    fireEvent.change(searchInput, { target: { value: '10233' } });
    expect(screen.getByText('Roberto Alves')).not.toBeNull();
    expect(screen.queryByText('Carlos Silva')).toBeNull();
  });

  it('3. Permite filtrar por função / especialidade', () => {
    renderTecnicosManager();

    const selects = screen.getAllByRole('combobox');
    const funcaoSelect = selects[0]; // filtro de função

    fireEvent.change(funcaoSelect, { target: { value: 'Instrumentista' } });

    expect(screen.getByText('Ana Souza')).not.toBeNull();
    expect(screen.queryByText('Carlos Silva')).toBeNull();
    expect(screen.queryByText('Roberto Alves')).toBeNull();
  });

  it('4. Abre a ficha do técnico ao clicar no botão "Ficha"', () => {
    const { openFichaDrawer } = renderTecnicosManager();

    const fichaButtons = screen.getAllByRole('button', { name: /Abrir ficha do técnico/i });
    expect(fichaButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(fichaButtons[0]);
    expect(openFichaDrawer).toHaveBeenCalled();
  });

  it('5. Abre o modal de Novo Técnico e chama saveTecnico ao submeter', async () => {
    const { refreshData } = renderTecnicosManager();

    const novoBtn = screen.getByRole('button', { name: /Novo Técnico/i });
    fireEvent.click(novoBtn);

    expect(screen.getByText(/Novo Técnico Offshore/i)).not.toBeNull();

    const matInput = screen.getByPlaceholderText(/Ex.: 10231 ou TEC-9981/i);
    const nomeInput = screen.getByPlaceholderText(/Ex.: Carlos Eduardo da Silva/i);
    const funcaoInput = screen.getByPlaceholderText(/Ex.: Técnico Offshore, Instrumentista, Mecânico…/i);

    fireEvent.change(matInput, { target: { value: '99881' } });
    fireEvent.change(nomeInput, { target: { value: 'Marina Costa' } });
    fireEvent.change(funcaoInput, { target: { value: 'Eletricista' } });

    const submitBtn = screen.getByRole('button', { name: /Cadastrar Técnico/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(saveTecnico).toHaveBeenCalledWith({
        matricula: '99881',
        nome: 'Marina Costa',
        funcao: 'Eletricista'
      });
      expect(refreshData).toHaveBeenCalled();
    });
  });

  it('6. Abre o modal de Editar Técnico e permite atualizar dados', async () => {
    const { refreshData } = renderTecnicosManager();

    const editButtons = screen.getAllByRole('button', { name: /Editar técnico/i });
    // Ordenado por nome: [0] Ana Souza, [1] Carlos Silva, [2] Roberto Alves
    fireEvent.click(editButtons[1]); // Carlos Silva

    expect(screen.getByText(/Editar Técnico: Carlos Silva/i)).not.toBeNull();

    const nomeInput = screen.getByPlaceholderText(/Ex.: Carlos Eduardo da Silva/i);
    fireEvent.change(nomeInput, { target: { value: 'Carlos Silva Atualizado' } });

    const submitBtn = screen.getByRole('button', { name: /Salvar Alterações/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(saveTecnico).toHaveBeenCalledWith({
        matricula: '10231',
        nome: 'Carlos Silva Atualizado',
        funcao: 'Técnico de Manutenção'
      });
      expect(refreshData).toHaveBeenCalled();
    });
  });

  it('7. Bloqueia exclusão de técnico com apontamentos/embarques e permite exclusão de técnico sem histórico', async () => {
    const { refreshData } = renderTecnicosManager();

    // Ordenado por nome: [0] Ana Souza (0 vinculos), [1] Carlos Silva (2 vinculos), [2] Roberto Alves (0 vinculos)
    const delButtons = screen.getAllByRole('button', { name: /Excluir técnico/i });
    const anaDelBtn = delButtons[0];
    const carlosDelBtn = delButtons[1];
    const robertoDelBtn = delButtons[2];

    expect(carlosDelBtn).toHaveProperty('disabled', true);
    expect(anaDelBtn).toHaveProperty('disabled', false);
    expect(robertoDelBtn).toHaveProperty('disabled', false);

    fireEvent.click(robertoDelBtn);

    // Modal de confirmação
    expect(screen.getByText(/Excluir Técnico Offshore/i)).not.toBeNull();
    expect(screen.getByText(/Deseja realmente remover o técnico/i)).not.toBeNull();

    const confirmBtn = screen.getByRole('button', { name: /Sim, Excluir/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteTecnico).toHaveBeenCalledWith('10233');
      expect(refreshData).toHaveBeenCalled();
    });
  });

  it('8. Dispara exportação para Excel ao clicar em "Exportar Técnicos" e modelo', async () => {
    renderTecnicosManager();

    const exportBtn = screen.getByRole('button', { name: /Exportar Técnicos/i });
    fireEvent.click(exportBtn);

    expect(exportTecnicosListXlsx).toHaveBeenCalled();

    const modeloBtn = screen.getByRole('button', { name: /Modelo Excel/i });
    fireEvent.click(modeloBtn);

    expect(exportModeloXlsx).toHaveBeenCalledWith('tec', expect.anything());
  });
});
