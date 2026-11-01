import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfiguracoesView } from '../ConfiguracoesView';
import { useApp } from '../../state/AppContext';
import { ToastProvider } from '../../components/ToastContext';
import { saveConfiguracoes } from '../../../services/data.service';
import type { AppDataset, ContractConfig } from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/data.service', () => ({
  saveConfiguracoes: vi.fn().mockResolvedValue(undefined)
}));

const MOCK_CONFIG: ContractConfig = {
  id: 'geral',
  hh_dia: 11,
  meta_percentual: 100,
  atencao_percentual: 90,
  prazo_justificativa_dias: 2,
  dias_embarque: 14,
  dia_corte_medicao: 21,
  med_criterio: 'enc',
  us_pe_padrao: 0.5,
  us_ex_padrao: 1.0,
  slogan: 'Excelência em Serviços Offshore',
  regionais_extras: []
};

const MOCK_DATASET: Partial<AppDataset> = {
  config: MOCK_CONFIG,
  emailsResumo: ['gestao@infotec.com.br', 'coordenacao@infotec.com.br'],
  plataformas: {
    'P-51': {
      sigla: 'P-51',
      chave_norm: 'p-51',
      nome: 'Plataforma 51',
      un: 'UN-BUZ',
      armador: 'Petrobras',
      gerencia: 'UO-BS',
      tipo: 'SS',
      situacao: 'Operação',
      cadastro_pendente: false
    }
  },
  usoffUnWeights: {
    'UN-BUZ': { unidade_negocio: 'UN-BUZ', pe: 0.6, ex: 1.2 }
  }
};

function renderConfiguracoesView(overrideApp?: Record<string, unknown>) {
  const defaultApp = {
    dataset: MOCK_DATASET,
    isGlobal: true,
    isAdmin: true,
    refreshData: vi.fn().mockResolvedValue(undefined),
    ...overrideApp
  };
  (useApp as unknown as ReturnType<typeof vi.fn>).mockReturnValue(defaultApp);

  return render(
    <ToastProvider>
      <ConfiguracoesView />
    </ToastProvider>
  );
}

describe('ConfiguracoesView (Central de Parametrização Contratual)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Bloqueia acesso e exibe aviso quando usuário não é global (admin/gestor)', () => {
    renderConfiguracoesView({ isGlobal: false });
    expect(screen.getByText(/Área Restrita/i)).not.toBeNull();
    expect(screen.queryByText(/Configurações do Contrato/i)).toBeNull();
  });

  it('2. Renderiza cabeçalho, resumo de badges e abas estruturadas para usuário global', () => {
    renderConfiguracoesView();
    expect(screen.getByRole('heading', { level: 2, name: /Configurações do Contrato/i })).not.toBeNull();
    expect(screen.getByText(/Carga Padrão:/i)).not.toBeNull();
    expect(screen.getByText(/Meta Contratual:/i)).not.toBeNull();

    // Abas de navegação (role tab)
    expect(screen.getByRole('tab', { name: /Geral & Metas/i })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /Ciclo de Medição/i })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /Ponderações USOFF/i })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /Comunicação & Notificações/i })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /Memorial de Cálculo/i })).not.toBeNull();
  });

  it('3. Permite alternar para a aba Ciclo de Medição e selecionar dia de corte e critério', () => {
    renderConfiguracoesView();

    const cicloTabBtn = screen.getByRole('tab', { name: /Ciclo de Medição/i });
    fireEvent.click(cicloTabBtn);

    expect(screen.getByText(/Ciclo do Mês de Medição/i)).not.toBeNull();
    expect(screen.getByText(/Embarques Encerrados no Ciclo/i)).not.toBeNull();
    const diasCards = screen.getAllByText(/Todos os Dias Trabalhados no Período/i);
    expect(diasCards.length).toBeGreaterThanOrEqual(1);

    // Clica em 'Todos os Dias Trabalhados no Período'
    fireEvent.click(diasCards[0]);

    // Deve ativar dirty state
    expect(screen.getByText(/Você possui alterações não salvas no contrato/i)).not.toBeNull();
  });

  it('4. Permite gerenciar e-mails via chips (adicionar e remover)', () => {
    renderConfiguracoesView();

    const commTabBtn = screen.getByRole('tab', { name: /Comunicação & Notificações/i });
    fireEvent.click(commTabBtn);

    expect(screen.getByText('gestao@infotec.com.br')).not.toBeNull();
    expect(screen.getByText('coordenacao@infotec.com.br')).not.toBeNull();

    // Adiciona novo e-mail
    const emailInput = screen.getByPlaceholderText(/Adicionar e-mail executivo/i);
    fireEvent.change(emailInput, { target: { value: 'diretoria@infotec.com.br' } });

    const addBtn = screen.getByRole('button', { name: /Adicionar/i });
    fireEvent.click(addBtn);

    expect(screen.getByText('diretoria@infotec.com.br')).not.toBeNull();
    expect(screen.getByText(/Você possui alterações não salvas no contrato/i)).not.toBeNull();

    // Remove o e-mail adicionado
    const removeBtn = screen.getByTitle(/Remover diretoria@infotec.com.br/i);
    fireEvent.click(removeBtn);

    expect(screen.queryByText('diretoria@infotec.com.br')).toBeNull();
  });

  it('5. Permite alternar para Ponderações USOFF e adicionar nova UN na grade', () => {
    renderConfiguracoesView();

    const usoffTabBtn = screen.getByRole('tab', { name: /Ponderações USOFF/i });
    fireEvent.click(usoffTabBtn);

    expect(screen.getByText(/Hierarquia de Pesos USOFF/i)).not.toBeNull();
    expect(screen.getByText('UN-BUZ')).not.toBeNull();

    // Adiciona nova UN
    const unInput = screen.getByPlaceholderText(/Nome da Unidade/i);
    fireEvent.change(unInput, { target: { value: 'UN-RIO' } });

    const addUnBtn = screen.getByRole('button', { name: /Adicionar UN/i });
    fireEvent.click(addUnBtn);

    expect(screen.getByText('UN-RIO')).not.toBeNull();
  });

  it('6. Exibe o Memorial de Cálculo com todas as fórmulas descritivas', () => {
    renderConfiguracoesView();

    const memTabBtn = screen.getByRole('tab', { name: /Memorial de Cálculo/i });
    fireEvent.click(memTabBtn);

    expect(screen.getByText(/1\. HH Disponível & Jornada Diária/i)).not.toBeNull();
    expect(screen.getByText(/4\. Ponderação Contratual USOFF/i)).not.toBeNull();
    expect(screen.getByText(/5\. Desconto de Gangway Desconectada/i)).not.toBeNull();
  });

  it('7. Grava configurações chamando saveConfiguracoes e atualiza dados', async () => {
    const refreshData = vi.fn().mockResolvedValue(undefined);
    renderConfiguracoesView({ refreshData });

    // Altera o slogan
    const commTabBtn = screen.getByRole('tab', { name: /Comunicação & Notificações/i });
    fireEvent.click(commTabBtn);

    const sloganInput = screen.getByPlaceholderText(/Excelência em Serviços e Operações/i);
    fireEvent.change(sloganInput, { target: { value: 'Novo Slogan Operacional 2026' } });

    // Salva
    const saveBtn = screen.getAllByRole('button', { name: /Salvar configurações/i })[0];
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveConfiguracoes).toHaveBeenCalledTimes(1);
      expect(refreshData).toHaveBeenCalledTimes(1);
    });

    const callArgs = (saveConfiguracoes as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0].slogan).toBe('Novo Slogan Operacional 2026');
  });

  it('8. Permite descartar alterações restaurando valores iniciais', () => {
    renderConfiguracoesView();

    // Altera valor de meta
    const inputs = screen.getAllByRole('spinbutton');
    const metaInput = inputs[1]; // metaPercentual
    fireEvent.change(metaInput, { target: { value: '85' } });

    expect(screen.getByText(/Você possui alterações não salvas no contrato/i)).not.toBeNull();

    // Clica em descartar
    const discardBtn = screen.getByTitle(/Desfazer alterações e restaurar valores originais/i);
    fireEvent.click(discardBtn);

    expect(screen.queryByText(/Você possui alterações não salvas no contrato/i)).toBeNull();
  });
});
