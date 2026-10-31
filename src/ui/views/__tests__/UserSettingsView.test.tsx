import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { UserSettingsView } from '../UserSettingsView';
import { useApp, type UserSettingsSection } from '../../state/AppContext';
import { ToastProvider } from '../../components/ToastContext';
import { saveOwnProfileAndPreferences, updateOwnPassword } from '../../../services/auth.service';
import type { UserProfile, UserOnboarding, UserPreferences, Pessoa } from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/auth.service', () => ({
  saveOwnProfileAndPreferences: vi.fn(),
  updateOwnPassword: vi.fn()
}));

const MOCK_PROFILE: UserProfile = {
  id: 'usr-sett-1',
  email: 'daniela.costa@infotecbrasil.com.br',
  nome: 'Daniela Costa',
  role: 'gestor',
  ativo: true
};

const MOCK_ONBOARDING: UserOnboarding = {
  user_id: 'usr-sett-1',
  primeiro_login: false,
  obriga_troca_senha: false,
  senha_trocada_em: '2026-02-15T14:30:00Z',
  preferencias: {
    themeMode: 'light',
    density: 'comfortable',
    defaultTab: 'ger',
    pageSize: 50
  }
};

const MOCK_PREFERENCES: UserPreferences = {
  themeMode: 'light',
  density: 'comfortable',
  defaultTab: 'ger',
  pageSize: 50
};

const MOCK_PESSOA_LOCAL: Pessoa = {
  id: 'pes-1',
  slug: 'daniela-costa',
  nome: 'Daniela Costa',
  papel: 'preposto',
  email: 'daniela.costa@infotecbrasil.com.br',
  user_id: 'usr-sett-1',
  uns: ['UN-BSUS', 'UN-RIO'],
  plats: ['P-51', 'P-53', 'FPSO Carioca']
};

function renderUserSettingsView() {
  return render(
    <ToastProvider>
      <UserSettingsView />
    </ToastProvider>
  );
}

describe('UserSettingsView (Central de Preferências do Usuário)', () => {
  const mockUpdateUserPreferences = vi.fn().mockResolvedValue(undefined);
  const mockOpenUserSettings = vi.fn();
  const mockRefreshAuth = vi.fn().mockResolvedValue(undefined);
  const mockLogout = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      userProfile: MOCK_PROFILE,
      userOnboarding: MOCK_ONBOARDING,
      pessoaScope: null,
      isGlobal: true,
      userPreferences: MOCK_PREFERENCES,
      updateUserPreferences: mockUpdateUserPreferences,
      userSettingsSection: 'perfil' as UserSettingsSection,
      openUserSettings: mockOpenUserSettings,
      refreshAuth: mockRefreshAuth,
      logout: mockLogout
    } as unknown as ReturnType<typeof useApp>);
  });

  it('renderiza o cabeçalho executivo com avatar, nome, papel, email e timestamp da última senha', () => {
    renderUserSettingsView();

    expect(screen.getByText('DC')).not.toBeNull(); // Iniciais de Daniela Costa
    expect(screen.getByRole('heading', { name: 'Daniela Costa' })).not.toBeNull();
    const rolePills = screen.getAllByText('Gestor do Contrato');
    expect(rolePills.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Ativo')).not.toBeNull();
    expect(screen.getAllByText('daniela.costa@infotecbrasil.com.br').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Última troca de senha:/i)).not.toBeNull();
  });

  it('permite alternar entre as 3 abas principais chamando openUserSettings', () => {
    renderUserSettingsView();

    const tabAparencia = screen.getByRole('tab', { name: /Tema & Exibição/i });
    const tabSeguranca = screen.getByRole('tab', { name: /Segurança & Senha/i });

    fireEvent.click(tabAparencia);
    expect(mockOpenUserSettings).toHaveBeenCalledWith('aparencia');

    fireEvent.click(tabSeguranca);
    expect(mockOpenUserSettings).toHaveBeenCalledWith('seguranca');
  });

  describe('Aba 1: Perfil & Carteira', () => {
    it('permite editar o nome de exibição e submeter alterações para persistência', async () => {
      vi.mocked(saveOwnProfileAndPreferences).mockResolvedValueOnce();

      const { container } = renderUserSettingsView();

      const nomeInput = screen.getByLabelText(/Nome de exibição/i);
      const emailInput = screen.getByLabelText(/E-mail corporativo/i) as HTMLInputElement;

      // E-mail deve ser somente leitura
      expect(emailInput.readOnly).toBe(true);
      expect(emailInput.disabled).toBe(true);

      const submitBtn = screen.getByRole('button', { name: /Salvar Alterações de Perfil/i }) as HTMLButtonElement;
      // Botão desabilitado se o nome for idêntico ao original
      expect(submitBtn.disabled).toBe(true);

      // Altera o nome
      fireEvent.change(nomeInput, { target: { value: 'Daniela Costa Ferreira' } });
      expect(submitBtn.disabled).toBe(false);

      const form = container.querySelector('form')!;
      await act(async () => {
        fireEvent.submit(form);
      });

      await waitFor(() => {
        expect(saveOwnProfileAndPreferences).toHaveBeenCalledWith('Daniela Costa Ferreira', MOCK_PREFERENCES);
        expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Perfil atualizado com sucesso!')).not.toBeNull();
      });
    });

    it('exibe visão global de escopo quando o usuário tem privilégios irrestritos (isGlobal = true)', () => {
      renderUserSettingsView();

      expect(screen.getByText('Acesso Global (Administrador / Gestor)')).not.toBeNull();
      expect(screen.getByText(/Seu perfil possui visão abrangente e controle irrestrito/i)).not.toBeNull();
    });

    it('exibe UNs e plataformas atribuídas quando o usuário é restrito (isGlobal = false)', () => {
      vi.mocked(useApp).mockReturnValue({
        userProfile: { ...MOCK_PROFILE, role: 'preposto' },
        userOnboarding: MOCK_ONBOARDING,
        pessoaScope: MOCK_PESSOA_LOCAL,
        isGlobal: false,
        userPreferences: MOCK_PREFERENCES,
        updateUserPreferences: mockUpdateUserPreferences,
        userSettingsSection: 'perfil',
        openUserSettings: mockOpenUserSettings,
        refreshAuth: mockRefreshAuth,
        logout: mockLogout
      } as unknown as ReturnType<typeof useApp>);

      renderUserSettingsView();

      expect(screen.getByText('Unidades de Negócio (UNs) Atribuídas')).not.toBeNull();
      expect(screen.getByText('UN-BSUS')).not.toBeNull();
      expect(screen.getByText('UN-RIO')).not.toBeNull();

      expect(screen.getByText('Plataformas Atribuídas')).not.toBeNull();
      expect(screen.getByText('P-51')).not.toBeNull();
      expect(screen.getByText('P-53')).not.toBeNull();
      expect(screen.getByText('FPSO Carioca')).not.toBeNull();
    });
  });

  describe('Aba 2: Tema & Exibição', () => {
    beforeEach(() => {
      vi.mocked(useApp).mockReturnValue({
        userProfile: MOCK_PROFILE,
        userOnboarding: MOCK_ONBOARDING,
        pessoaScope: null,
        isGlobal: true,
        userPreferences: MOCK_PREFERENCES,
        updateUserPreferences: mockUpdateUserPreferences,
        userSettingsSection: 'aparencia',
        openUserSettings: mockOpenUserSettings,
        refreshAuth: mockRefreshAuth,
        logout: mockLogout
      } as unknown as ReturnType<typeof useApp>);
    });

    it('permite alternar entre os temas Claro, Escuro e Automático do Sistema', async () => {
      renderUserSettingsView();

      // Clica no cartão de Escuro Offshore
      const darkOption = screen.getByText('Escuro Offshore');
      await act(async () => {
        fireEvent.click(darkOption);
      });
      expect(mockUpdateUserPreferences).toHaveBeenCalledWith({ themeMode: 'dark' });

      // Clica no cartão Automático do Sistema
      const sysOption = screen.getByText('Automático do Sistema');
      await act(async () => {
        fireEvent.click(sysOption);
      });
      expect(mockUpdateUserPreferences).toHaveBeenCalledWith({ themeMode: 'system' });

      // Clica no Claro Executivo
      const lightOption = screen.getByText('Claro Executivo');
      await act(async () => {
        fireEvent.click(lightOption);
      });
      expect(mockUpdateUserPreferences).toHaveBeenCalledWith({ themeMode: 'light' });
    });

    it('permite alternar a densidade das tabelas (Confortável vs Compacta para 1366×768)', async () => {
      renderUserSettingsView();

      const compactDensityBtn = screen.getByText(/Compacta \(Recomendado para 1366×768\)/i);
      await act(async () => {
        fireEvent.click(compactDensityBtn);
      });
      expect(mockUpdateUserPreferences).toHaveBeenCalledWith({ density: 'compact' });

      const comfortableDensityBtn = screen.getByText('Confortável');
      await act(async () => {
        fireEvent.click(comfortableDensityBtn);
      });
      expect(mockUpdateUserPreferences).toHaveBeenCalledWith({ density: 'comfortable' });
    });

    it('permite ajustar a paginação padrão (25, 50, 100 linhas por página)', async () => {
      renderUserSettingsView();

      const btn25 = screen.getByRole('tab', { name: '25 linhas' });
      await act(async () => {
        fireEvent.click(btn25);
      });
      expect(mockUpdateUserPreferences).toHaveBeenCalledWith({ pageSize: 25 });

      const btn100 = screen.getByRole('tab', { name: '100 linhas' });
      await act(async () => {
        fireEvent.click(btn100);
      });
      expect(mockUpdateUserPreferences).toHaveBeenCalledWith({ pageSize: 100 });
    });

    it('permite alterar a aba inicial padrão do sistema', async () => {
      renderUserSettingsView();

      const selectDefaultTab = screen.getByLabelText(/Aba Inicial ao Abrir o Sistema/i);
      await act(async () => {
        fireEvent.change(selectDefaultTab, { target: { value: 'med' } });
      });

      expect(mockUpdateUserPreferences).toHaveBeenCalledWith({ defaultTab: 'med' });
    });
  });

  describe('Aba 3: Segurança & Senha', () => {
    beforeEach(() => {
      vi.mocked(useApp).mockReturnValue({
        userProfile: MOCK_PROFILE,
        userOnboarding: MOCK_ONBOARDING,
        pessoaScope: null,
        isGlobal: true,
        userPreferences: MOCK_PREFERENCES,
        updateUserPreferences: mockUpdateUserPreferences,
        userSettingsSection: 'seguranca',
        openUserSettings: mockOpenUserSettings,
        refreshAuth: mockRefreshAuth,
        logout: mockLogout
      } as unknown as ReturnType<typeof useApp>);
    });

    it('valida requisitos de segurança e libera o botão apenas quando a senha é válida e coincidente', () => {
      renderUserSettingsView();

      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const submitBtn = screen.getByRole('button', { name: /Atualizar Minha Senha/i }) as HTMLButtonElement;

      expect(submitBtn.disabled).toBe(true);

      // Incompleta (< 8 caracteres)
      fireEvent.change(newPwdInput, { target: { value: 'Curta1' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'Curta1' } });
      expect(submitBtn.disabled).toBe(true);

      // Sem números
      fireEvent.change(newPwdInput, { target: { value: 'ApenasLetrasAqui' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'ApenasLetrasAqui' } });
      expect(submitBtn.disabled).toBe(true);

      // Senha e confirmação divergentes
      fireEvent.change(newPwdInput, { target: { value: 'SenhaForte2026' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'Diferente2026' } });
      expect(submitBtn.disabled).toBe(true);

      // Todos os 4 requisitos cumpridos
      fireEvent.change(confirmPwdInput, { target: { value: 'SenhaForte2026' } });
      expect(submitBtn.disabled).toBe(false);
      expect(screen.getByText('Excelente / Válida')).not.toBeNull();
    });

    it('submete alteração voluntária com sucesso chamando updateOwnPassword', async () => {
      vi.mocked(updateOwnPassword).mockResolvedValueOnce();

      const { container } = renderUserSettingsView();

      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const form = container.querySelector('form')!;

      fireEvent.change(newPwdInput, { target: { value: 'SenhaSuperSegura2026' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'SenhaSuperSegura2026' } });

      await act(async () => {
        fireEvent.submit(form);
      });

      await waitFor(() => {
        expect(updateOwnPassword).toHaveBeenCalledWith('SenhaSuperSegura2026');
        expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Senha alterada com sucesso!')).not.toBeNull();
      });
    });

    it('exibe erro amigável caso a alteração voluntária falhe no backend', async () => {
      vi.mocked(updateOwnPassword).mockRejectedValueOnce(new Error('Sua senha anterior não pode ser reutilizada.'));

      const { container } = renderUserSettingsView();

      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const form = container.querySelector('form')!;

      fireEvent.change(newPwdInput, { target: { value: 'SenhaSuperSegura2026' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'SenhaSuperSegura2026' } });

      await act(async () => {
        fireEvent.submit(form);
      });

      await waitFor(() => {
        const errorAlerts = screen.getAllByText('Sua senha anterior não pode ser reutilizada.');
        expect(errorAlerts.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  it('permite ao usuário encerrar a sessão pelo botão do topo', () => {
    renderUserSettingsView();

    const logoutBtn = screen.getByRole('button', { name: /Encerrar sessão \(Sair\)/i });
    fireEvent.click(logoutBtn);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
