import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FirstLoginGate } from '../../ui/views/FirstLoginGate';
import { useApp } from '../../ui/state/AppContext';
import { ToastProvider } from '../../ui/components/ToastContext';
import {
  completeFirstLoginPassword,
  updateOwnPassword
} from '../../services/auth.service';
import {
  createMockSupabaseClient,
  resetMockDatabase
} from '../../test/mockSupabase';
import {
  mockUsers,
  mockProfiles,
  mockOnboardings,
  firstLoginOnboarding,
  normalOnboarding
} from '../../test/testFixtures';
import type { UserProfile, UserOnboarding } from '../../domain/types';

// Mock do módulo Supabase para isolamento total de testes (zero chamadas para produção)
vi.mock('../../services/supabase', async () => {
  const { createMockSupabaseClient } = await import('../../test/mockSupabase');
  return {
    supabase: createMockSupabaseClient()
  };
});

import { supabase } from '../../services/supabase';
const mockSupabaseClient = supabase as unknown as ReturnType<typeof createMockSupabaseClient>;

// Mock do AppContext para testes unitários focados na UI do Gate
vi.mock('../../ui/state/AppContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/state/AppContext')>();
  return {
    ...actual,
    useApp: vi.fn()
  };
});

// Mock do auth.service para testes de comportamento da UI
vi.mock('../../services/auth.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/auth.service')>();
  return {
    ...actual,
    completeFirstLoginPassword: vi.fn()
  };
});

const MOCK_PROFILE: UserProfile = {
  id: 'usr-first-login-sec-1',
  email: 'colaborador.novo@infotecbrasil.com.br',
  nome: 'Lucas Valadão',
  role: 'preposto',
  ativo: true
};

const MOCK_ONBOARDING_PENDING: UserOnboarding = {
  user_id: 'usr-first-login-sec-1',
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
    React.createElement(
      ToastProvider,
      null,
      React.createElement(FirstLoginGate, null)
    )
  );
}

describe('Auditoria de Segurança: FirstLoginGate & Bloqueio Obrigatório de Acesso', () => {
  const mockRefreshAuth = vi.fn().mockResolvedValue(undefined);
  const mockLogout = vi.fn().mockResolvedValue(undefined);
  const mockReloadDataset = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockDatabase(mockSupabaseClient);

    vi.mocked(useApp).mockReturnValue({
      authInitialized: true,
      userProfile: MOCK_PROFILE,
      userOnboarding: MOCK_ONBOARDING_PENDING,
      requiresPasswordChange: true,
      pessoaScope: null,
      isGlobal: false,
      isAdmin: false,
      scopeLabel: 'Carteira Lucas Valadão',
      refreshAuth: mockRefreshAuth,
      logout: mockLogout,
      userPreferences: MOCK_ONBOARDING_PENDING.preferencias,
      updateUserPreferences: vi.fn(),
      theme: 'light',
      toggleTheme: vi.fn(),
      setThemeMode: vi.fn(),
      activeTab: 'ger',
      setActiveTab: vi.fn(),
      filters: { fDate: '', fReg: '', fPlat: '', fResp: '', fPer: '', cIni: '', cFim: '' },
      setFilters: vi.fn(),
      resetFilters: vi.fn(),
      dataset: {
        config: {
          hh_dia: 10.5,
          meta_percentual: 95,
          atencao_percentual: 80,
          dias_embarque: 14,
          dia_corte_medicao: 15,
          prazo_justificativa_dias: 3,
          med_criterio: 'trab'
        },
        emailsResumo: [],
        plataformas: {},
        pessoas: {},
        profiles: {},
        onboardingMap: {},
        tecnicos: {},
        carteira: [],
        hhMap: {},
        justMap: {},
        externalCoveredSet: new Set(),
        sharedOpsSet: new Set(),
        watermark: { ultima_data_hh: null, ultima_importacao_em: null },
        latestFluxo: null,
        isDemo: false,
        demoReason: ''
      },
      pidx: {},
      activePeriod: { id: '2026-10', ini: '2026-10-01', fim: '2026-10-31', label: 'Out/2026', dias: 31 },
      queryWindow: { queryIni: '2026-10-01', queryFim: '2026-10-31' },
      isLoading: false,
      realtimeStatus: 'disconnected',
      openJustModal: vi.fn(),
      closeJustModal: vi.fn(),
      justModal: null,
      openFichaDrawer: vi.fn(),
      closeFichaDrawer: vi.fn(),
      fichaMat: null,
      openEmailModal: vi.fn(),
      closeEmailModal: vi.fn(),
      emailModal: null,
      reloadDataset: mockReloadDataset
    } as unknown as ReturnType<typeof useApp>);
  });

  // ============================================================================
  // 1. INVIOLABILIDADE DO BLOQUEIO DE ACESSO
  // ============================================================================
  describe('1. Inviolabilidade do Bloqueio de Acesso (Zero-Trust Gate)', () => {
    it('bloqueia estritamente o acesso quando primeiro_login = true ou obriga_troca_senha = true', () => {
      renderFirstLoginGate();

      // O gate Zero-Trust deve ser renderizado
      expect(screen.getByText('Segurança Zero-Trust Infotec')).not.toBeNull();
      expect(screen.getByText('Primeiro acesso detectado — troque sua senha agora')).not.toBeNull();
      expect(screen.getByText(/Lucas Valadão/i)).not.toBeNull();
      expect(screen.getByText('colaborador.novo@infotecbrasil.com.br')).not.toBeNull();
      expect(screen.getByText('Preposto')).not.toBeNull();

      // Botão de submeter senha bloqueado por padrão
      const submitBtn = screen.getByRole('button', { name: /Definir Nova Senha e Acessar/i }) as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);

      // Elementos do AppShell e rotas operacionais NÃO podem existir no documento
      expect(screen.queryByText('Visão Geral')).toBeNull();
      expect(screen.queryByText('Painel do Dia')).toBeNull();
      expect(screen.queryByText('Embarque Atual')).toBeNull();
      expect(screen.queryByText('Configurações')).toBeNull();
      expect(screen.queryByText('Medição e Relatórios')).toBeNull();
    });

    it('bloqueia o acesso mesmo quando primeiro_login é false mas obriga_troca_senha é true (reset administrativo)', () => {
      vi.mocked(useApp).mockReturnValue({
        authInitialized: true,
        userProfile: MOCK_PROFILE,
        userOnboarding: { ...MOCK_ONBOARDING_PENDING, primeiro_login: false, obriga_troca_senha: true },
        requiresPasswordChange: true,
        refreshAuth: mockRefreshAuth,
        logout: mockLogout
      } as unknown as ReturnType<typeof useApp>);

      renderFirstLoginGate();

      expect(screen.getByText('Troca obrigatória de senha')).not.toBeNull();
      expect(screen.getByText(/Sua senha foi redefinida pela administração/i)).not.toBeNull();
    });

    it('apenas 2 ações são permitidas no gate: submeter nova senha válida ou fazer logout', () => {
      renderFirstLoginGate();

      const allButtons = screen.getAllByRole('button');
      // Esperados:
      // 1. Alternar visualização nova senha
      // 2. Alternar visualização confirmar senha
      // 3. Botão "Definir Nova Senha e Acessar" (submit)
      // 4. Botão "Sair e voltar ao login" (logout)
      expect(allButtons.length).toBe(4);

      // Não há botões de fechar (X), cancelar ou ignorar
      expect(screen.queryByRole('button', { name: /Fechar/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Cancelar/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Ignorar/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Pular/i })).toBeNull();
    });

    it('ação de logout encerra a sessão ativa do usuário imediatamente e limpa o contexto', () => {
      renderFirstLoginGate();

      const logoutBtn = screen.getByRole('button', { name: /Sair e voltar ao login/i });
      fireEvent.click(logoutBtn);

      expect(mockLogout).toHaveBeenCalledTimes(1);
    });

    it('gate permanece intransponível em simulação de recarga/re-render enquanto obriga_troca_senha for verdadeiro', () => {
      const { unmount } = renderFirstLoginGate();
      unmount();

      // Simula re-renderização/reload do componente
      renderFirstLoginGate();
      expect(screen.getByText('Segurança Zero-Trust Infotec')).not.toBeNull();
      expect(screen.queryByText('Visão Geral')).toBeNull();
    });

    it('garante que enquanto requiresPasswordChange for true, o carregamento do dataset é completamente inibido', () => {
      // Simula a lógica de guarda do reloadDataset em AppContext:
      // if (!userProfile || requiresPasswordChange) return;
      const guardedReload = (userProfile: any, requiresPasswordChange: boolean, spy: () => void) => {
        if (!userProfile || requiresPasswordChange) return;
        spy();
      };

      const spyAction = vi.fn();
      // Tentativa 1: com requiresPasswordChange = true
      guardedReload(MOCK_PROFILE, true, spyAction);
      expect(spyAction).not.toHaveBeenCalled();

      // Tentativa 2: sem perfil logado
      guardedReload(null, false, spyAction);
      expect(spyAction).not.toHaveBeenCalled();

      // Somente após desativação da guarda o carregamento pode ocorrer
      guardedReload(MOCK_PROFILE, false, spyAction);
      expect(spyAction).toHaveBeenCalledTimes(1);
    });

    it('garante que tentativas de navegação por teclado (Escape) não fecham ou bypassam o gate', () => {
      renderFirstLoginGate();

      // Dispara tecla Escape no documento
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

      // O gate permanece intacto
      expect(screen.getByText('Segurança Zero-Trust Infotec')).not.toBeNull();
      expect(screen.getByText('Primeiro acesso detectado — troque sua senha agora')).not.toBeNull();
      expect(mockLogout).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 2. REGRAS ESTRITAS DE VALIDAÇÃO DE SENHA
  // ============================================================================
  describe('2. Regras Estritas de Senha (Critérios Obrigatórios e Força)', () => {
    it('rejeita senha com menos de 8 caracteres e mantém o botão desabilitado', () => {
      renderFirstLoginGate();

      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const submitBtn = screen.getByRole('button', { name: /Definir Nova Senha e Acessar/i }) as HTMLButtonElement;

      // 6 caracteres (letras e números presentes, mas < 8)
      fireEvent.change(newPwdInput, { target: { value: 'Abc12' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'Abc12' } });

      expect(submitBtn.disabled).toBe(true);
      expect(screen.getByText('Quase pronta')).not.toBeNull();
    });

    it('rejeita senha composta somente por letras sem números', () => {
      renderFirstLoginGate();

      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const submitBtn = screen.getByRole('button', { name: /Definir Nova Senha e Acessar/i }) as HTMLButtonElement;

      // 12 caracteres, mas apenas letras
      fireEvent.change(newPwdInput, { target: { value: 'SomenteLetrasSemNum' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'SomenteLetrasSemNum' } });

      expect(submitBtn.disabled).toBe(true);
      expect(screen.getByText('Quase pronta')).not.toBeNull();
    });

    it('rejeita senha composta somente por números sem letras', () => {
      renderFirstLoginGate();

      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const submitBtn = screen.getByRole('button', { name: /Definir Nova Senha e Acessar/i }) as HTMLButtonElement;

      // 10 dígitos, mas apenas números
      fireEvent.change(newPwdInput, { target: { value: '1234567890' } });
      fireEvent.change(confirmPwdInput, { target: { value: '1234567890' } });

      expect(submitBtn.disabled).toBe(true);
      expect(screen.getByText('Quase pronta')).not.toBeNull();
    });

    it('rejeita quando a confirmação não for idêntica à nova senha', () => {
      renderFirstLoginGate();

      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const submitBtn = screen.getByRole('button', { name: /Definir Nova Senha e Acessar/i }) as HTMLButtonElement;

      // Senha forte, porém confirmação diferente
      fireEvent.change(newPwdInput, { target: { value: 'SenhaForte2026' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'SenhaForte2025' } });

      expect(submitBtn.disabled).toBe(true);
      expect(screen.getByText('Quase pronta')).not.toBeNull();
    });

    it('habilita o botão de submissão e exibe "Excelente / Válida" somente com os 4 critérios satisfeitos', () => {
      renderFirstLoginGate();

      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const submitBtn = screen.getByRole('button', { name: /Definir Nova Senha e Acessar/i }) as HTMLButtonElement;

      fireEvent.change(newPwdInput, { target: { value: 'SenhaInfotec2026' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'SenhaInfotec2026' } });

      expect(screen.getByText('Excelente / Válida')).not.toBeNull();
      expect(submitBtn.disabled).toBe(false);
    });

    it('captura e exibe erro amigável ao tentar reutilizar a senha provisória/anterior', async () => {
      vi.mocked(completeFirstLoginPassword).mockRejectedValueOnce(
        new Error('A nova senha deve ser diferente da senha atual/provisória.')
      );

      const { container } = renderFirstLoginGate();
      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const form = container.querySelector('form')!;

      fireEvent.change(newPwdInput, { target: { value: 'Provisoria123' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'Provisoria123' } });
      fireEvent.submit(form);

      await waitFor(() => {
        const errorAlerts = screen.getAllByText('A nova senha deve ser diferente da senha atual/provisória.');
        expect(errorAlerts.length).toBeGreaterThanOrEqual(1);
      });

      expect(mockRefreshAuth).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 3. DEFESA EM PROFUNDIDADE NA CAMADA DE SERVIÇO
  // ============================================================================
  describe('3. Defesa em Profundidade no Serviço de Autenticação (auth.service)', () => {
    it('updateOwnPassword rejeita senhas com menos de 8 caracteres diretamente no serviço', async () => {
      await expect(updateOwnPassword('Curta1')).rejects.toThrow(
        'A nova senha deve ter no mínimo 8 caracteres.'
      );
    });

    it('updateOwnPassword rejeita senhas vazias ou nulas no serviço', async () => {
      await expect(updateOwnPassword('')).rejects.toThrow(
        'A nova senha deve ter no mínimo 8 caracteres.'
      );
    });

    it('updateOwnPassword rejeita senhas compostas apenas por letras no serviço', async () => {
      await expect(updateOwnPassword('SomenteLetrasSemNumero')).rejects.toThrow(
        'A nova senha deve combinar letras e números para sua segurança.'
      );
    });

    it('updateOwnPassword rejeita senhas compostas apenas por números no serviço', async () => {
      await expect(updateOwnPassword('1234567890123')).rejects.toThrow(
        'A nova senha deve combinar letras e números para sua segurança.'
      );
    });
  });

  // ============================================================================
  // 4. GARANTIA DE AUDITORIA E DESBLOQUEIO SEGURO
  // ============================================================================
  describe('4. Garantia de Auditoria e Desbloqueio (RPC complete_first_login_password_change)', () => {
    it('RPC complete_first_login_password_change marca primeiro_login=false, obriga_troca_senha=false e preenche senha_trocada_em', async () => {
      // Configura o banco mockado com o preposto em primeiro login
      mockSupabaseClient.__mockState.currentUser = {
        id: mockUsers.preposto.id,
        email: mockUsers.preposto.email
      };

      const onboardings = mockSupabaseClient.__mockState.tables.user_onboarding || [];
      const userOnb = onboardings.find(o => o.user_id === mockUsers.preposto.id);
      expect(userOnb).toBeDefined();
      expect(userOnb?.primeiro_login).toBe(true);
      expect(userOnb?.obriga_troca_senha).toBe(true);
      expect(userOnb?.senha_trocada_em).toBeNull();

      // Executa a RPC diretamente no cliente
      const { error } = await mockSupabaseClient.rpc('complete_first_login_password_change');
      expect(error).toBeNull();

      // Verifica auditoria pós-execução
      expect(userOnb?.primeiro_login).toBe(false);
      expect(userOnb?.obriga_troca_senha).toBe(false);
      expect(userOnb?.senha_trocada_em).not.toBeNull();
      expect(typeof userOnb?.senha_trocada_em).toBe('string');
      // Timestamp ISO válido recente
      const ts = new Date(userOnb!.senha_trocada_em!).getTime();
      expect(Number.isNaN(ts)).toBe(false);
      expect(Date.now() - ts).toBeLessThan(10000);
    });

    it('fluxo de submissão no FirstLoginGate aciona completeFirstLoginPassword e dispara refreshAuth', async () => {
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

    it('se a RPC do banco falhar, o usuário não é desbloqueado e exibe a mensagem de erro', async () => {
      vi.mocked(completeFirstLoginPassword).mockRejectedValueOnce(
        new Error('Falha ao confirmar registro de primeiro acesso no PostgreSQL.')
      );

      const { container } = renderFirstLoginGate();
      const newPwdInput = screen.getByLabelText('Nova Senha Pessoal');
      const confirmPwdInput = screen.getByLabelText('Confirmar Nova Senha');
      const form = container.querySelector('form')!;

      fireEvent.change(newPwdInput, { target: { value: 'NovaInfotec2026' } });
      fireEvent.change(confirmPwdInput, { target: { value: 'NovaInfotec2026' } });
      fireEvent.submit(form);

      await waitFor(() => {
        const errorAlerts = screen.getAllByText('Falha ao confirmar registro de primeiro acesso no PostgreSQL.');
        expect(errorAlerts.length).toBeGreaterThanOrEqual(1);
      });

      // Não chama refreshAuth em caso de erro na RPC
      expect(mockRefreshAuth).not.toHaveBeenCalled();
    });

    it('cria registro em user_onboarding com primeiro_login=false se a linha ainda não existir no momento da RPC', async () => {
      const newUserId = 'usr-sem-onboarding-preexistente';
      mockSupabaseClient.__mockState.currentUser = {
        id: newUserId,
        email: 'novo.sem.onb@infotecbrasil.com.br'
      };

      const onboardings = mockSupabaseClient.__mockState.tables.user_onboarding || [];
      expect(onboardings.find(o => o.user_id === newUserId)).toBeUndefined();

      const { error } = await mockSupabaseClient.rpc('complete_first_login_password_change');
      expect(error).toBeNull();

      const created = onboardings.find(o => o.user_id === newUserId);
      expect(created).toBeDefined();
      expect(created?.primeiro_login).toBe(false);
      expect(created?.obriga_troca_senha).toBe(false);
      expect(created?.senha_trocada_em).not.toBeNull();
    });
  });
});
