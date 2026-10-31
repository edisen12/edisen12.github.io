import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginView } from '../LoginView';
import { useApp } from '../../state/AppContext';
import { ToastProvider } from '../../components/ToastContext';
import { signInWithPassword } from '../../../services/auth.service';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/auth.service', () => ({
  signInWithPassword: vi.fn()
}));

function renderLoginView() {
  return render(
    <ToastProvider>
      <LoginView />
    </ToastProvider>
  );
}

describe('LoginView (Fluxo de Autenticação Segura)', () => {
  const mockRefreshAuth = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      refreshAuth: mockRefreshAuth
    } as unknown as ReturnType<typeof useApp>);
  });

  it('renderiza o formulário institucional Infotec (sem botões soltos de tema no topo)', () => {
    const { container } = renderLoginView();

    // Logotipo e títulos institucionais
    const logo = screen.getByAltText('Infotec Brasil');
    expect(logo).not.toBeNull();
    expect(screen.getByText('Gestão de HH Offshore')).not.toBeNull();
    expect(screen.getByText('Acesso Restrito e Seguro · Zero-Trust')).not.toBeNull();

    // Campos do formulário
    expect(screen.getByLabelText(/E-mail Corporativo/i)).not.toBeNull();
    expect(screen.getByLabelText(/Senha de Acesso/i)).not.toBeNull();
    expect(screen.getByRole('button', { name: /Entrar no Sistema/i })).not.toBeNull();

    // Verificação de ausência de botões avulsos de tema (ThemeToggle solto no topo do card)
    const themeButtons = container.querySelectorAll('.theme-toggle, .btn-theme');
    expect(themeButtons.length).toBe(0);
  });

  it('permite alternar a visualização da senha (ver/ocultar senha)', () => {
    renderLoginView();

    const passwordInput = screen.getByLabelText(/Senha de Acesso/i) as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    const toggleBtn = screen.getByRole('button', { name: /Ver senha/i });
    fireEvent.click(toggleBtn);
    expect(passwordInput.type).toBe('text');

    const hideBtn = screen.getByRole('button', { name: /Ocultar senha/i });
    fireEvent.click(hideBtn);
    expect(passwordInput.type).toBe('password');
  });

  it('valida campos obrigatórios de e-mail e senha antes de tentar login', () => {
    const { container } = renderLoginView();

    const form = container.querySelector('form')!;
    const emailInput = screen.getByLabelText(/E-mail Corporativo/i);

    // Submissão com campos em branco
    fireEvent.submit(form);

    // Mensagem de validação amigável
    expect(screen.getByText('Informe seu e-mail corporativo e senha.')).not.toBeNull();
    expect(signInWithPassword).not.toHaveBeenCalled();

    // Preenche apenas e-mail, senha vazia
    fireEvent.change(emailInput, { target: { value: 'usuario@infotecbrasil.com.br' } });
    fireEvent.submit(form);

    expect(screen.getByText('Informe seu e-mail corporativo e senha.')).not.toBeNull();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('exibe mensagem amigável de erro caso o login falhe no backend', async () => {
    vi.mocked(signInWithPassword).mockRejectedValueOnce(new Error('Credenciais de acesso incorretas ou conta inativa.'));

    const { container } = renderLoginView();

    const form = container.querySelector('form')!;
    const emailInput = screen.getByLabelText(/E-mail Corporativo/i);
    const passwordInput = screen.getByLabelText(/Senha de Acesso/i);

    fireEvent.change(emailInput, { target: { value: 'operador@infotecbrasil.com.br' } });
    fireEvent.change(passwordInput, { target: { value: 'SenhaErrada123' } });
    fireEvent.submit(form);

    await waitFor(() => {
      // Exibe a mensagem de erro tanto no card quanto no toast
      const alerts = screen.getAllByText('Credenciais de acesso incorretas ou conta inativa.');
      expect(alerts.length).toBeGreaterThanOrEqual(1);
    });

    expect(signInWithPassword).toHaveBeenCalledWith('operador@infotecbrasil.com.br', 'SenhaErrada123');
    expect(mockRefreshAuth).not.toHaveBeenCalled();
  });

  it('submete com sucesso chamando signInWithPassword e atualiza o estado de autenticação', async () => {
    vi.mocked(signInWithPassword).mockResolvedValueOnce({
      user: { id: 'u1', email: 'coordenador@infotecbrasil.com.br' }
    } as unknown as Awaited<ReturnType<typeof signInWithPassword>>);

    const { container } = renderLoginView();

    const form = container.querySelector('form')!;
    const emailInput = screen.getByLabelText(/E-mail Corporativo/i);
    const passwordInput = screen.getByLabelText(/Senha de Acesso/i);

    fireEvent.change(emailInput, { target: { value: 'coordenador@infotecbrasil.com.br' } });
    fireEvent.change(passwordInput, { target: { value: 'Infotec@2026' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith('coordenador@infotecbrasil.com.br', 'Infotec@2026');
      expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Login realizado com sucesso!')).not.toBeNull();
    });
  });
});
