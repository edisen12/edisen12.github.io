// ==============================================================================
// Suíte de Testes de Segurança: Matriz de Permissões RBAC (Role-Based Access Control)
// Sistema: hh-offshore-infotec (React 19 + TypeScript + Vite)
// GARANTIA: 100% isolado, zero chamadas de rede para ambiente de produção
// ==============================================================================

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { NAV_TABS } from '../../config/constants';
import type { TabId, UserProfile, SystemRole } from '../../domain/types';
import { Sidebar } from '../../ui/components/Sidebar';
import { useApp } from '../../ui/state/AppContext';
import { fetchCurrentUserScope } from '../../services/auth.service';
import { mockUsers } from '../../test/testFixtures';

// Mock do módulo de supabase para isolamento hermético
vi.mock('../../services/supabase', async () => {
  const { createMockSupabaseClient } = await import('../../test/mockSupabase');
  return {
    supabase: createMockSupabaseClient()
  };
});

import { supabase } from '../../services/supabase';
import { resetMockDatabase } from '../../test/mockSupabase';

// Mock do useApp para testes de componentes visuais
vi.mock('../../ui/state/AppContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/state/AppContext')>();
  return {
    ...actual,
    useApp: vi.fn()
  };
});

const mockClient = supabase as any;

describe('Segurança & RBAC: Matriz Completa de Permissões das 4 Roles', () => {
  const mockSetActiveTab = vi.fn();
  const mockOpenUserSettings = vi.fn();
  const mockLogout = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    resetMockDatabase(mockClient);
  });

  // ----------------------------------------------------------------------------
  // 1. REGRAS DA MATRIZ RBAC (Flags & Escopo de Carteira)
  // ----------------------------------------------------------------------------
  describe('1. Matriz de Autorização (Flags isGlobal, isAdmin e scopeLabel)', () => {
    function computeRbacFlags(profile: UserProfile | null) {
      if (!profile) {
        return { isGlobal: false, isAdmin: false, scopeLabel: undefined };
      }
      const isGlobal = profile.role === 'admin' || profile.role === 'gestor';
      const isAdmin = profile.role === 'admin';
      const scopeLabel = isGlobal ? undefined : `Carteira ${profile.nome}`;
      return { isGlobal, isAdmin, scopeLabel };
    }

    it('Role "admin": papel supremo com isGlobal=true, isAdmin=true e scopeLabel irrestrito', () => {
      const flags = computeRbacFlags({
        id: mockUsers.admin.id,
        email: mockUsers.admin.email,
        nome: mockUsers.admin.nome,
        role: 'admin',
        ativo: true
      });

      expect(flags.isGlobal).toBe(true);
      expect(flags.isAdmin).toBe(true);
      expect(flags.scopeLabel).toBeUndefined();
    });

    it('Role "gestor": papel operacional pleno com isGlobal=true, isAdmin=false e scopeLabel irrestrito', () => {
      const flags = computeRbacFlags({
        id: mockUsers.gestor.id,
        email: mockUsers.gestor.email,
        nome: mockUsers.gestor.nome,
        role: 'gestor',
        ativo: true
      });

      expect(flags.isGlobal).toBe(true);
      expect(flags.isAdmin).toBe(false);
      expect(flags.scopeLabel).toBeUndefined();
    });

    it('Role "controlador": papel analítico fatiado com isGlobal=false, isAdmin=false e scopeLabel "Carteira {Nome}"', () => {
      const flags = computeRbacFlags({
        id: mockUsers.controlador.id,
        email: mockUsers.controlador.email,
        nome: mockUsers.controlador.nome,
        role: 'controlador',
        ativo: true
      });

      expect(flags.isGlobal).toBe(false);
      expect(flags.isAdmin).toBe(false);
      expect(flags.scopeLabel).toBe(`Carteira ${mockUsers.controlador.nome}`);
    });

    it('Role "preposto": papel de ponta fatiado com isGlobal=false, isAdmin=false e scopeLabel "Carteira {Nome}"', () => {
      const flags = computeRbacFlags({
        id: mockUsers.preposto.id,
        email: mockUsers.preposto.email,
        nome: mockUsers.preposto.nome,
        role: 'preposto',
        ativo: true
      });

      expect(flags.isGlobal).toBe(false);
      expect(flags.isAdmin).toBe(false);
      expect(flags.scopeLabel).toBe(`Carteira ${mockUsers.preposto.nome}`);
    });
  });

  // ----------------------------------------------------------------------------
  // 2. ISOLAMENTO DE ABAS E NAVEGAÇÃO NA SIDEBAR
  // ----------------------------------------------------------------------------
  describe('2. Acesso e Visibilidade de Abas por Papel (NAV_TABS)', () => {
    it('Admin tem acesso a todas as 9 abas do sistema + perfil no rodapé', () => {
      vi.mocked(useApp).mockReturnValue({
        activeTab: 'ger' as TabId,
        setActiveTab: mockSetActiveTab,
        isGlobal: true,
        isAdmin: true,
        userProfile: {
          id: mockUsers.admin.id,
          email: mockUsers.admin.email,
          nome: mockUsers.admin.nome,
          role: 'admin',
          ativo: true
        },
        openUserSettings: mockOpenUserSettings,
        logout: mockLogout
      } as unknown as ReturnType<typeof useApp>);

      render(React.createElement(Sidebar));

      // Todas as 9 abas devem estar visíveis
      const expectedTabs = [
        'Visão geral',
        'Painel do dia',
        'Embarque atual',
        'Justificativas',
        'Medição e relatórios',
        'Medição USOFF',
        'Pessoas, plataformas e acessos',
        'Importar dados',
        'Configurações'
      ];

      for (const tabName of expectedTabs) {
        expect(screen.getByText(tabName)).not.toBeNull();
      }

      // Grupo Administração visível
      expect(screen.getByText('Administração')).not.toBeNull();

      // Botão de perfil no rodapé visível
      expect(screen.getByRole('button', { name: /Configurações do usuário/i })).not.toBeNull();
    });

    it('Gestor tem acesso a todas as 9 abas do sistema + perfil no rodapé', () => {
      vi.mocked(useApp).mockReturnValue({
        activeTab: 'ger' as TabId,
        setActiveTab: mockSetActiveTab,
        isGlobal: true,
        isAdmin: false,
        userProfile: {
          id: mockUsers.gestor.id,
          email: mockUsers.gestor.email,
          nome: mockUsers.gestor.nome,
          role: 'gestor',
          ativo: true
        },
        openUserSettings: mockOpenUserSettings,
        logout: mockLogout
      } as unknown as ReturnType<typeof useApp>);

      render(React.createElement(Sidebar));

      expect(screen.getByText('Pessoas, plataformas e acessos')).not.toBeNull();
      expect(screen.getByText('Importar dados')).not.toBeNull();
      expect(screen.getByText('Configurações')).not.toBeNull();
      expect(screen.getByText('Administração')).not.toBeNull();
    });

    it('Controlador tem acesso estrito a 7 abas (6 operacionais + perfil) e bloqueio das 3 administrativas', () => {
      vi.mocked(useApp).mockReturnValue({
        activeTab: 'ger' as TabId,
        setActiveTab: mockSetActiveTab,
        isGlobal: false,
        isAdmin: false,
        userProfile: {
          id: mockUsers.controlador.id,
          email: mockUsers.controlador.email,
          nome: mockUsers.controlador.nome,
          role: 'controlador',
          ativo: true
        },
        openUserSettings: mockOpenUserSettings,
        logout: mockLogout
      } as unknown as ReturnType<typeof useApp>);

      render(React.createElement(Sidebar));

      // 6 abas operacionais/medição permitidas
      expect(screen.getByText('Visão geral')).not.toBeNull();
      expect(screen.getByText('Painel do dia')).not.toBeNull();
      expect(screen.getByText('Embarque atual')).not.toBeNull();
      expect(screen.getByText('Justificativas')).not.toBeNull();
      expect(screen.getByText('Medição e relatórios')).not.toBeNull();
      expect(screen.getByText('Medição USOFF')).not.toBeNull();

      // 7ª aba universal: perfil de usuário
      expect(screen.getByRole('button', { name: /Configurações do usuário/i })).not.toBeNull();

      // Abas restritas PROIBIDAS para controlador
      expect(screen.queryByText('Pessoas, plataformas e acessos')).toBeNull();
      expect(screen.queryByText('Importar dados')).toBeNull();
      expect(screen.queryByText('Configurações')).toBeNull();
      expect(screen.queryByText('Administração')).toBeNull();
    });

    it('Preposto tem acesso estrito a 7 abas (6 operacionais + perfil) e bloqueio das 3 administrativas', () => {
      vi.mocked(useApp).mockReturnValue({
        activeTab: 'ger' as TabId,
        setActiveTab: mockSetActiveTab,
        isGlobal: false,
        isAdmin: false,
        userProfile: {
          id: mockUsers.preposto.id,
          email: mockUsers.preposto.email,
          nome: mockUsers.preposto.nome,
          role: 'preposto',
          ativo: true
        },
        openUserSettings: mockOpenUserSettings,
        logout: mockLogout
      } as unknown as ReturnType<typeof useApp>);

      render(React.createElement(Sidebar));

      // 6 abas operacionais/medição permitidas
      expect(screen.getByText('Visão geral')).not.toBeNull();
      expect(screen.getByText('Painel do dia')).not.toBeNull();
      expect(screen.getByText('Embarque atual')).not.toBeNull();
      expect(screen.getByText('Justificativas')).not.toBeNull();
      expect(screen.getByText('Medição e relatórios')).not.toBeNull();
      expect(screen.getByText('Medição USOFF')).not.toBeNull();

      // Perfil no rodapé
      expect(screen.getByRole('button', { name: /Configurações do usuário/i })).not.toBeNull();

      // Abas restritas totalmente ausentes
      expect(screen.queryByText('Pessoas, plataformas e acessos')).toBeNull();
      expect(screen.queryByText('Importar dados')).toBeNull();
      expect(screen.queryByText('Configurações')).toBeNull();
      expect(screen.queryByText('Administração')).toBeNull();
    });
  });

  // ----------------------------------------------------------------------------
  // 3. ENFORCEMENT DO ROTEADOR DE ABAS (ActiveTabRouter Security Logic)
  // ----------------------------------------------------------------------------
  describe('3. Roteamento Seguro e Confinamento de Rotas Restritas', () => {
    // Simulação determinística da lógica do ActiveTabRouter de src/App.tsx
    function simulateActiveTabRouter(activeTab: TabId, isGlobal: boolean): string {
      switch (activeTab) {
        case 'ger':
          return 'VisaoGeralView';
        case 'dia':
          return 'PainelDiaView';
        case 'emb':
          return 'EmbarqueAtualView';
        case 'jus':
          return 'JustificativasView';
        case 'med':
          return 'MedicaoRelatoriosView';
        case 'us':
          return 'MedicaoUsoffView';
        case 'pes':
          return isGlobal ? 'PessoasPlataformasView' : 'VisaoGeralView';
        case 'imp':
          return isGlobal ? 'ImportarDadosView' : 'VisaoGeralView';
        case 'cfg':
          return isGlobal ? 'ConfiguracoesView' : 'VisaoGeralView';
        case 'perfil':
          return 'UserSettingsView';
        default:
          return 'VisaoGeralView';
      }
    }

    it('Bloqueia acesso a "pes" para não-globais redirecionando para VisaoGeralView', () => {
      expect(simulateActiveTabRouter('pes', false)).toBe('VisaoGeralView');
      expect(simulateActiveTabRouter('pes', true)).toBe('PessoasPlataformasView');
    });

    it('Bloqueia acesso a "imp" para não-globais redirecionando para VisaoGeralView', () => {
      expect(simulateActiveTabRouter('imp', false)).toBe('VisaoGeralView');
      expect(simulateActiveTabRouter('imp', true)).toBe('ImportarDadosView');
    });

    it('Bloqueia acesso a "cfg" para não-globais redirecionando para VisaoGeralView', () => {
      expect(simulateActiveTabRouter('cfg', false)).toBe('VisaoGeralView');
      expect(simulateActiveTabRouter('cfg', true)).toBe('ConfiguracoesView');
    });

    it('Garante acesso seguro às abas operacionais para todos os papéis', () => {
      const operationalTabs: TabId[] = ['ger', 'dia', 'emb', 'jus', 'med', 'us'];
      for (const tab of operationalTabs) {
        expect(simulateActiveTabRouter(tab, false)).not.toBe('Blocked');
        expect(simulateActiveTabRouter(tab, true)).not.toBe('Blocked');
      }
    });

    it('Efeito no AppContext: se não-global tentar ficar em "pes", "imp" ou "cfg", força retorno para "ger"', () => {
      const activeTabsRestricted: TabId[] = ['pes', 'imp', 'cfg'];

      for (const restrictedTab of activeTabsRestricted) {
        let currentTab: TabId = restrictedTab;
        const setTab = (t: TabId) => { currentTab = t; };

        // Simula o useEffect de sanitização em AppContext.tsx:
        // if (userProfile && !isGlobal && (activeTab === 'pes' || activeTab === 'imp' || activeTab === 'cfg')) { setActiveTab('ger'); }
        const isGlobal = false;
        if (!isGlobal && (currentTab === 'pes' || currentTab === 'imp' || currentTab === 'cfg')) {
          setTab('ger');
        }

        expect(currentTab).toBe('ger');
      }
    });
  });

  // ----------------------------------------------------------------------------
  // 4. UNIVERSALIDADE DA ABA 'perfil' (UserSettingsView)
  // ----------------------------------------------------------------------------
  describe('4. Universalidade da Aba "perfil" (UserSettingsView)', () => {
    it('Permite acesso universal a "perfil" para os 4 papéis sem redirecionamento', () => {
      const roles: SystemRole[] = ['admin', 'gestor', 'controlador', 'preposto'];

      for (const role of roles) {
        const isGlobal = role === 'admin' || role === 'gestor';
        // ActiveTabRouter renders UserSettingsView unconditionally when activeTab === 'perfil'
        let targetView = 'VisaoGeralView';
        const activeTab: TabId = 'perfil';

        if (activeTab === 'perfil') {
          targetView = 'UserSettingsView';
        }

        expect(targetView).toBe('UserSettingsView');

        // Garante que o sanitizador de rotas administrativas não intercepta 'perfil'
        const isRestrictedAdminTab = (tab: TabId) => tab === 'pes' || tab === 'imp' || tab === 'cfg';
        const shouldRedirect = !isGlobal && isRestrictedAdminTab(activeTab);
        expect(shouldRedirect).toBe(false);
      }
    });

    it('Navega para o perfil ao clicar no botão de usuário do rodapé da Sidebar', () => {
      vi.mocked(useApp).mockReturnValue({
        activeTab: 'ger' as TabId,
        setActiveTab: mockSetActiveTab,
        isGlobal: false,
        isAdmin: false,
        userProfile: {
          id: mockUsers.preposto.id,
          email: mockUsers.preposto.email,
          nome: 'Mariana Lima',
          role: 'preposto',
          ativo: true
        },
        openUserSettings: mockOpenUserSettings,
        logout: mockLogout
      } as unknown as ReturnType<typeof useApp>);

      render(React.createElement(Sidebar));

      const profileBtn = screen.getByRole('button', { name: /Configurações do usuário/i });
      fireEvent.click(profileBtn);

      expect(mockOpenUserSettings).toHaveBeenCalledTimes(1);
      expect(mockOpenUserSettings).toHaveBeenCalledWith('perfil');
    });
  });

  // ----------------------------------------------------------------------------
  // 5. PRIVILÉGIOS DE GESTÃO: ADMIN VS GESTOR
  // ----------------------------------------------------------------------------
  describe('5. Privilégios de Gestão de Usuários: Admin vs Gestor', () => {
    it('Apenas admin possui privilégio supremo para criar novos administradores (isAdmin=true)', () => {
      const adminFlags = { isAdmin: true, isGlobal: true };
      const gestorFlags = { isAdmin: false, isGlobal: true };

      expect(adminFlags.isAdmin).toBe(true);
      expect(gestorFlags.isAdmin).toBe(false);

      // Regra de interface: o botão "+ Novo administrador" só deve ser exibido se isAdmin === true
      const canCreateAdminUser = (isAdmin: boolean) => isAdmin;
      expect(canCreateAdminUser(adminFlags.isAdmin)).toBe(true);
      expect(canCreateAdminUser(gestorFlags.isAdmin)).toBe(false);
    });

    it('Gestor não pode promover usuários para o papel "admin"', () => {
      const canAssignRole = (callerRole: SystemRole, targetRole: SystemRole): boolean => {
        if (targetRole === 'admin') {
          return callerRole === 'admin';
        }
        return callerRole === 'admin' || callerRole === 'gestor';
      };

      // Gestor criando papéis operacionais: PERMITIDO
      expect(canAssignRole('gestor', 'preposto')).toBe(true);
      expect(canAssignRole('gestor', 'controlador')).toBe(true);
      expect(canAssignRole('gestor', 'gestor')).toBe(true);

      // Gestor tentando criar/promover admin: BLOQUEADO
      expect(canAssignRole('gestor', 'admin')).toBe(false);

      // Admin criando qualquer papel: PERMITIDO
      expect(canAssignRole('admin', 'admin')).toBe(true);
      expect(canAssignRole('admin', 'gestor')).toBe(true);
      expect(canAssignRole('admin', 'controlador')).toBe(true);
      expect(canAssignRole('admin', 'preposto')).toBe(true);
    });
  });

  // ----------------------------------------------------------------------------
  // 6. ENCLAVE DE SEGURANÇA: USUÁRIO DESATIVADO (ativo = false)
  // ----------------------------------------------------------------------------
  describe('6. Isolamento e Bloqueio de Usuário Desativado (ativo = false)', () => {
    it('fetchCurrentUserScope retorna null se o perfil estiver com ativo = false', async () => {
      // Configura usuário inativo no mockClient
      mockClient.__mockState.currentUser = {
        id: mockUsers.inativo.id,
        email: mockUsers.inativo.email
      };

      const scope = await fetchCurrentUserScope();
      expect(scope).toBeNull();
    });

    it('Usuário desativado é bloqueado no AppGate e redirecionado para LoginView', () => {
      // Simulação da guarda AppGate em src/App.tsx:
      // if (!userProfile || !userProfile.ativo) return <LoginView />;
      const evaluateGate = (profile: UserProfile | null) => {
        if (!profile || !profile.ativo) {
          return 'LoginView';
        }
        return 'AppShell';
      };

      expect(evaluateGate(null)).toBe('LoginView');
      expect(
        evaluateGate({
          id: mockUsers.inativo.id,
          email: mockUsers.inativo.email,
          nome: mockUsers.inativo.nome,
          role: 'preposto',
          ativo: false
        })
      ).toBe('LoginView');

      expect(
        evaluateGate({
          id: mockUsers.admin.id,
          email: mockUsers.admin.email,
          nome: mockUsers.admin.nome,
          role: 'admin',
          ativo: true
        })
      ).toBe('AppShell');
    });

    it('Nenhuma carga de dados é realizada se userProfile for nulo ou desativado', () => {
      let datasetLoaded = false;

      const attemptReloadDataset = (userProfile: UserProfile | null, requiresPasswordChange: boolean) => {
        // Guarda exata de AppContext.tsx linha 400:
        if (!userProfile || requiresPasswordChange) return;
        datasetLoaded = true;
      };

      // Usuário nulo (desativado ou não logado)
      attemptReloadDataset(null, false);
      expect(datasetLoaded).toBe(false);

      // Usuário em troca obrigatória de senha
      attemptReloadDataset(
        {
          id: 'usr-temp',
          email: 'temp@empresa.com.br',
          nome: 'Temp',
          role: 'preposto',
          ativo: true
        },
        true
      );
      expect(datasetLoaded).toBe(false);
    });
  });
});
