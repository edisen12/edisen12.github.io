import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FirstLoginGate } from '../FirstLoginGate';
import { useApp } from '../../state/AppContext';
import { ToastProvider } from '../../components/ToastContext';
import { completeFirstLoginPassword } from '../../../services/auth.service';
import type { UserProfile, UserOnboarding } from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/auth.service', () => ({
  completeFirstLoginPassword: vi.fn()
}));

const MOCK_PROFILE: UserProfile = {
  id: 'usr-first-1',
  email: 'novo.colaborador@infotecbrasil.com.br',
  nome: 'Rodrigo Medeiros',
  role: 'controlador',
  ativo: true
};

const MOCK_ONBOARDING: UserOnboarding = {
  user_id: 'usr-first-1',
  primeiro_login: true,
  obriga_troca_senha: true,
  senha_trocada_em: null,
  preferencias: {
    themeMode: 'light',
    density: 'comfortable',
    defaultTab: 'ger',
    pageSize: 50
  }
};

function renderFirstLoginGate() {
  return render(
    <ToastProvider>
      <FirstLoginGate />
    </ToastProvider>
  );
}

describe('FirstLoginGate (Bloqueio de Primeiro Acesso e Troca Obrigatória)', () => {
  const mockRefreshAuth = vi.fn().mockResolvedValue(undefined);
  const mockLogout = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      userProfile: MOCK_PROFILE,
      userOnboarding: MOCK_ONBOARDING,
      refreshAuth: mockRefreshAuth,
      logout: mockLogout
    } as unknown as ReturnType<typeof useApp>);
  });

  it('renderiza o bloqueio de primeiro acesso com dados do usuário e badge Zero-Trust', () => {
    renderFirstLoginGate();

    expect(screen.getByText('Segurança Zero-Trust Infotec')).not.toBeNull();
    expect(screen.getByText('Primeiro acesso detectado — troque sua senha agora')).not.toBeNull();
    expect(screen.getByText(/Olá, Rodrigo Medeiros!/i)).not.toBeNull();
    expect(screen.getByText('novo.colaborador@infotecbrasil.com.br')).not.toBeNull();
    expect(screen.getByText('Controlador')).not.toBeNull();

    // Inicialmente com medidor "Aguardando senha"
    expect(screen.getByText('Aguardando senha')).not.toBeNull();

    // Botão de acesso bloqueado / desabilitado inicialmente
    const submitBtn = screen.getByRole('button', { name: /Definir Nova Senha e Acessar/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('exibe texto apropriado para troca obrigatória redefinida pelo admin (não primeiro login)', () => {
    vi.mocked(useApp).mockReturnValue({
      userProfile: MOCK_PROFILE,
      userOnboarding: { ...MOCK_ONBOARDING, primeiro_login: false },
      refreshAuth: mockRefreshAuth,
      logout: mockLogout
    } as unknown as ReturnType<typeof useApp>);

    renderFirstLoginGate();

    expect(screen.getByText('Troca obrigatória de senha')).not.toBeNull();
    expect(screen.getByText(/Sua senha foi redefinida pela administração/i)).not.toBeNull();
  });

  it('atualiza progressivamente o medidor visual de força da senha conforme os 4 critérios', () => {
    renderFirstLoginGate();

    const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
    const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
    const submitBtn = screen.getByRole('button', { name: /Definir Nova Senha e Acessar/i }) as HTMLButtonElement;

    // 1 critério: apenas letras curtas (< 8 chars, sem número, sem match)
    fireEvent.change(newPwdInput, { target: { value: 'abc' } });
    expect(screen.getByText('Muito fraca')).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);

    // 2 critérios: >= 8 chars + letras (sem números, sem match)
    fireEvent.change(newPwdInput, { target: { value: 'abcdefgh' } });
    expect(screen.getByText('Fraca')).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);

    // 3 critérios: >= 8 chars + letras + números (sem confirmação ainda)
    fireEvent.change(newPwdInput, { target: { value: 'abcde123' } });
    expect(screen.getByText('Quase pronta')).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);

    // 4 critérios completos: senha e confirmação coincidem
    fireEvent.change(confirmPwdInput, { target: { value: 'abcde123' } });
    expect(screen.getByText('Excelente / Válida')).not.toBeNull();

    // Botão agora está liberado!
    expect(submitBtn.disabled).toBe(false);
  });

  it('permite alternar visualização de senha e confirmação com os botões de olho', () => {
    renderFirstLoginGate();

    const newPwdInput = screen.getByLabelText('Nova Senha Pessoal') as HTMLInputElement;
    const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha') as HTMLInputElement;

    expect(newPwdInput.type).toBe('password');
    expect(confirmPwdInput.type).toBe('password');

    // Alterna nova senha
    const toggleNewBtn = screen.getByRole('button', { name: 'Ver senha' });
    fireEvent.click(toggleNewBtn);
    expect(newPwdInput.type).toBe('text');

    // Alterna confirmação
    const toggleConfirmBtn = screen.getByRole('button', { name: 'Ver confirmação' });
    fireEvent.click(toggleConfirmBtn);
    expect(confirmPwdInput.type).toBe('text');
  });

  it('submete com sucesso chamando completeFirstLoginPassword e atualiza credenciais', async () => {
    vi.mocked(completeFirstLoginPassword).mockResolvedValueOnce();

    const { container } = renderFirstLoginGate();

    const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
    const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
    const form = container.querySelector('form')!;

    fireEvent.change(newPwdInput, { target: { value: 'NovaInfotec2026' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'NovaInfotec2026' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(completeFirstLoginPassword).toHaveBeenCalledWith('NovaInfotec2026');
      expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Senha atualizada com sucesso! Bem-vindo(a).')).not.toBeNull();
    });
  });

  it('exibe mensagem de erro amigável caso a chamada ao backend falhe', async () => {
    vi.mocked(completeFirstLoginPassword).mockRejectedValueOnce(
      new Error('A senha não atende aos requisitos mínimos do servidor.')
    );

    const { container } = renderFirstLoginGate();

    const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
    const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
    const form = container.querySelector('form')!;

    fireEvent.change(newPwdInput, { target: { value: 'NovaInfotec2026' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'NovaInfotec2026' } });
    fireEvent.submit(form);

    await waitFor(() => {
      const errorNotes = screen.getAllByText('A senha não atende aos requisitos mínimos do servidor.');
      expect(errorNotes.length).toBeGreaterThanOrEqual(1);
    });

    expect(mockRefreshAuth).not.toHaveBeenCalled();
  });

  it('permite ao usuário sair do sistema clicando em "Sair e voltar ao login"', () => {
    renderFirstLoginGate();

    const logoutBtn = screen.getByRole('button', { name: /Sair e voltar ao login/i });
    fireEvent.click(logoutBtn);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
