import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '../ToastContext';
import { AppProvider, useApp } from '../../state/AppContext';
import { AppShell } from '../AppShell';
import { UserSettingsView } from '../../views/UserSettingsView';
import * as authService from '../../../services/auth.service';
import * as dataService from '../../../services/data.service';
import * as realtimeService from '../../../services/realtime.service';
import type { AppDataset } from '../../../domain/types';
import {
  adminUser,
  controladorPessoa,
  controladorUser,
  gestorOnboarding,
  gestorPessoa,
  gestorUser,
  mockApontamentosHHRows,
  mockCarteiraRows,
  mockContractConfig,
  mockJustificativasRows,
  mockOnboardings,
  mockPlatforms,
  mockTecnicos,
  mockUsoffUnWeights,
  mockWatermark,
  normalOnboarding,
  prepostoPessoa,
  prepostoUser
} from '../../../test/testFixtures';

vi.mock('../../../services/auth.service', () => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  updateOwnPassword: vi.fn().mockResolvedValue(undefined),
  completeFirstLoginPassword: vi.fn().mockResolvedValue(undefined),
  saveOwnProfileAndPreferences: vi.fn().mockResolvedValue(undefined),
  fetchCurrentUserScope: vi.fn(),
  adminManageUser: vi.fn()
}));

vi.mock('../../../services/data.service', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../services/data.service')>();
  return {
    ...actual,
    loadAppDataset: vi.fn()
  };
});

vi.mock('../../../services/realtime.service', () => ({
  subscribeToRealtimeUpdates: vi.fn(() => () => {})
}));

function buildMockDataset(): AppDataset {
  const hhMap: AppDataset['hhMap'] = {};
  mockApontamentosHHRows.forEach(h => {
    hhMap[`${h.matricula}|${h.data}`] = h;
  });

  const justMap: AppDataset['justMap'] = {
    '1001|2026-10-03': mockJustificativasRows[0]
  };

  return {
    config: { ...mockContractConfig },
    usoffUnWeights: {
      'Espírito Santo (UN-ES)': mockUsoffUnWeights[0],
      'Búzios (UN-BUZ)': mockUsoffUnWeights[1],
      'Bacia de Campos (UN-BC)': mockUsoffUnWeights[2]
    },
    emailsResumo: ['auditoria@empresa.com.br'],
    plataformas: { ...mockPlatforms },
    pessoas: {
      [prepostoPessoa.id]: prepostoPessoa,
      [gestorPessoa.id]: gestorPessoa,
      [controladorPessoa.id]: controladorPessoa
    },
    profiles: {
      [adminUser.id]: adminUser,
      [gestorUser.id]: gestorUser,
      [prepostoUser.id]: prepostoUser,
      [controladorUser.id]: controladorUser
    },
    onboardingMap: Object.fromEntries(mockOnboardings.map(o => [o.user_id, o])),
    tecnicos: { ...mockTecnicos },
    carteira: [...mockCarteiraRows],
    carteiraOperacoes: [],
    confirmacoesSap: [],
    hhMap,
    justMap,
    externalCoveredSet: new Set<string>(),
    sharedOpsSet: new Set<string>(),
    watermark: { ...mockWatermark },
    latestFluxo: null,
    isDemo: false,
    demoReason: ''
  };
}

function TestWorkspace() {
  const { activeTab, dataset, userProfile, isGlobal } = useApp();

  if (activeTab === 'perfil') {
    return <UserSettingsView />;
  }

  return (
    <div data-testid="workspace-summary">
      <div data-testid="effective-user-name">{userProfile?.nome}</div>
      <div data-testid="effective-is-global">{String(isGlobal)}</div>
      <div data-testid="visible-platforms">
        {Object.keys(dataset.plataformas).sort().join(',')}
      </div>
      <div data-testid="visible-carteira-count">{dataset.carteira.length}</div>
    </div>
  );
}

function renderHarness() {
  return render(
    <ToastProvider>
      <AppProvider>
        <AppShell>
          <TestWorkspace />
        </AppShell>
      </AppProvider>
    </ToastProvider>
  );
}

describe('Fluxo de Simulação Administrativa ("Ver como outro usuário")', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      })
    });
    vi.mocked(realtimeService.subscribeToRealtimeUpdates).mockReturnValue(() => {});
  });

  it('permite ao Admin abrir o seletor, simular um Preposto com escopo restrito, proteger perfil/senha e voltar para Admin', async () => {
    vi.mocked(authService.fetchCurrentUserScope).mockResolvedValue({
      profile: adminUser,
      pessoa: null,
      onboarding: normalOnboarding
    });
    vi.mocked(dataService.loadAppDataset).mockResolvedValue(buildMockDataset());

    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId('visible-platforms').textContent).toContain('P25,P50,P58,P74');
    });

    // Admin enxerga o botão no cabeçalho e as abas administrativas na Sidebar
    const impersonateBtn = screen.getByRole('button', { name: 'Ver como outro usuário' });
    expect(impersonateBtn).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pessoas, plataformas e acessos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Painel do Administrador' })).toBeTruthy();

    // Abre modal de seleção
    fireEvent.click(impersonateBtn);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ver e usar o sistema como outro usuário')).toBeTruthy();

    // Filtra por nome do preposto
    const searchInput = within(dialog).getByLabelText('Buscar usuário para simular');
    fireEvent.change(searchInput, { target: { value: 'Preposto Operacional' } });

    const viewAsButtons = within(dialog).getAllByRole('button', { name: 'Ver como este usuário' });
    expect(viewAsButtons).toHaveLength(1);
    fireEvent.click(viewAsButtons[0]);

    // Verifica modo de validação ativo, ScopeBanner restrito, Sidebar sem abas globais e dataset filtrado
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Modo de validação de usuário ativo' })).toBeTruthy();
    });

    expect(screen.getByTestId('effective-user-name').textContent).toBe(prepostoUser.nome);
    expect(screen.getByTestId('effective-is-global').textContent).toBe('false');
    expect(screen.getByTestId('visible-platforms').textContent).toBe('P50,P74');
    expect(screen.getByTestId('visible-carteira-count').textContent).toBe('2');
    expect(screen.getByText(/Escopo restrito \(Preposto Operacional Teste · Preposto\)/i)).toBeTruthy();

    // Abas globais ocultadas durante simulação de preposto
    expect(screen.queryByRole('button', { name: 'Pessoas, plataformas e acessos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Painel do Administrador' })).toBeNull();

    // Navega para Configurações do usuário e confirma salvaguarda de perfil/senha
    fireEvent.click(screen.getByRole('button', { name: 'Configurações do usuário' }));
    await waitFor(() => {
      expect(screen.getByText(/Modo de Validação:/i)).toBeTruthy();
    });
    const nomeInput = screen.getByLabelText('Nome de exibição') as HTMLInputElement;
    expect(nomeInput.disabled).toBe(true);
    expect(nomeInput.value).toBe(prepostoUser.nome);
    const saveBtn = screen.getByRole('button', { name: /Salvar Alterações de Perfil/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Volta para Admin pelo banner de simulação
    const banner = screen.getByRole('status', { name: 'Modo de validação de usuário ativo' });
    fireEvent.click(within(banner).getByRole('button', { name: 'Voltar para Admin' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('status', { name: 'Modo de validação de usuário ativo' })
      ).toBeNull();
    });

    // Volta para aba Visão Geral para inspecionar o workspace restaurado
    fireEvent.click(screen.getByRole('button', { name: 'Visão geral' }));
    await waitFor(() => {
      expect(screen.getByTestId('effective-user-name').textContent).toBe(adminUser.nome);
    });
    expect(screen.getByTestId('effective-is-global').textContent).toBe('true');
    expect(screen.getByTestId('visible-platforms').textContent).toBe('P25,P50,P58,P74');
    expect(screen.getByRole('button', { name: 'Painel do Administrador' })).toBeTruthy();
  });

  it('não exibe a opção de simular usuário para contas que não são admin (ex: gestor)', async () => {
    vi.mocked(authService.fetchCurrentUserScope).mockResolvedValue({
      profile: gestorUser,
      pessoa: gestorPessoa,
      onboarding: gestorOnboarding
    });
    vi.mocked(dataService.loadAppDataset).mockResolvedValue(buildMockDataset());

    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId('effective-user-name').textContent).toBe(gestorUser.nome);
    });

    expect(screen.queryByRole('button', { name: 'Ver como outro usuário' })).toBeNull();
  });
});
