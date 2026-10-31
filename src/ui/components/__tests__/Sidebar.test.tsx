import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { useApp } from '../../state/AppContext';
import type { TabId, UserProfile } from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

const MOCK_GLOBAL_USER: UserProfile = {
  id: 'usr-1',
  email: 'gestor@infotecbrasil.com.br',
  nome: 'Lucas Martins Ferreira',
  role: 'gestor',
  ativo: true
};

const MOCK_LOCAL_USER: UserProfile = {
  id: 'usr-2',
  email: 'preposto@infotecbrasil.com.br',
  nome: 'Mariana Lima',
  role: 'preposto',
  ativo: true
};

describe('Sidebar (Menu Principal de Navegação)', () => {
  const mockSetActiveTab = vi.fn();
  const mockOpenUserSettings = vi.fn();
  const mockLogout = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renderiza os 3 grupos (Operação Diária, Medição Contratual, Administração) para usuários com acesso global', () => {
    vi.mocked(useApp).mockReturnValue({
      activeTab: 'ger' as TabId,
      setActiveTab: mockSetActiveTab,
      isGlobal: true,
      userProfile: MOCK_GLOBAL_USER,
      openUserSettings: mockOpenUserSettings,
      logout: mockLogout
    } as unknown as ReturnType<typeof useApp>);

    render(<Sidebar />);

    // Títulos dos Grupos
    expect(screen.getByText('Operação Diária')).not.toBeNull();
    expect(screen.getByText('Medição Contratual')).not.toBeNull();
    expect(screen.getByText('Administração')).not.toBeNull();

    // Abas de Operação
    expect(screen.getByText('Visão geral')).not.toBeNull();
    expect(screen.getByText('Painel do dia')).not.toBeNull();
    expect(screen.getByText('Embarque atual')).not.toBeNull();
    expect(screen.getByText('Justificativas')).not.toBeNull();

    // Abas de Medição
    expect(screen.getByText('Medição e relatórios')).not.toBeNull();
    expect(screen.getByText('Medição USOFF')).not.toBeNull();

    // Abas Administrativas
    expect(screen.getByText('Pessoas, plataformas e acessos')).not.toBeNull();
    expect(screen.getByText('Importar dados')).not.toBeNull();
    expect(screen.getByText('Configurações')).not.toBeNull();
  });

  it('oculta totalmente o grupo "Administração" para papéis locais não-globais (preposto / controlador)', () => {
    vi.mocked(useApp).mockReturnValue({
      activeTab: 'ger' as TabId,
      setActiveTab: mockSetActiveTab,
      isGlobal: false, // Perfil restrito a plataformas específicas
      userProfile: MOCK_LOCAL_USER,
      openUserSettings: mockOpenUserSettings,
      logout: mockLogout
    } as unknown as ReturnType<typeof useApp>);

    render(<Sidebar />);

    // Grupos operacionais permanecem visíveis
    expect(screen.getByText('Operação Diária')).not.toBeNull();
    expect(screen.getByText('Medição Contratual')).not.toBeNull();

    // Grupo Administração e suas abas restritas NÃO devem ser renderizados
    expect(screen.queryByText('Administração')).toBeNull();
    expect(screen.queryByText('Pessoas, plataformas e acessos')).toBeNull();
    expect(screen.queryByText('Importar dados')).toBeNull();
    expect(screen.queryByText('Configurações')).toBeNull();
  });

  it('dispara setActiveTab ao clicar em um item de navegação', () => {
    vi.mocked(useApp).mockReturnValue({
      activeTab: 'ger' as TabId,
      setActiveTab: mockSetActiveTab,
      isGlobal: true,
      userProfile: MOCK_GLOBAL_USER,
      openUserSettings: mockOpenUserSettings,
      logout: mockLogout
    } as unknown as ReturnType<typeof useApp>);

    render(<Sidebar />);

    const tabEmb = screen.getByText('Embarque atual');
    fireEvent.click(tabEmb);

    expect(mockSetActiveTab).toHaveBeenCalledTimes(1);
    expect(mockSetActiveTab).toHaveBeenCalledWith('emb');
  });

  it('alterna para modo colapsado e exibe micro-etiquetas nos divisores (MED, ADM)', () => {
    vi.mocked(useApp).mockReturnValue({
      activeTab: 'ger' as TabId,
      setActiveTab: mockSetActiveTab,
      isGlobal: true,
      userProfile: MOCK_GLOBAL_USER,
      openUserSettings: mockOpenUserSettings,
      logout: mockLogout
    } as unknown as ReturnType<typeof useApp>);

    const { container } = render(<Sidebar />);

    const aside = container.querySelector('aside.app-sidebar');
    expect(aside?.classList.contains('collapsed')).toBe(false);

    // Botão de colapsar
    const collapseBtn = screen.getByRole('button', { name: /Recolher barra lateral/i });
    fireEvent.click(collapseBtn);

    // Sidebar passa a ter classe 'collapsed'
    expect(aside?.classList.contains('collapsed')).toBe(true);

    // No modo colapsado, os divisores exibem as microtags correspondentes aos grupos
    expect(screen.getByText('MED')).not.toBeNull();
    expect(screen.getByText('ADM')).not.toBeNull();

    // Persistência em localStorage
    expect(localStorage.getItem('hhoff_sidebar_collapsed')).toBe('true');
  });

  it('exibe dados do usuário no rodapé e dispara navegação para perfil e logout', () => {
    vi.mocked(useApp).mockReturnValue({
      activeTab: 'ger' as TabId,
      setActiveTab: mockSetActiveTab,
      isGlobal: true,
      userProfile: MOCK_GLOBAL_USER,
      openUserSettings: mockOpenUserSettings,
      logout: mockLogout
    } as unknown as ReturnType<typeof useApp>);

    render(<Sidebar />);

    // Iniciais e primeiro nome
    expect(screen.getByText('LM')).not.toBeNull(); // Lucas Martins -> LM
    expect(screen.getByText('Lucas')).not.toBeNull();

    // Clica no perfil do rodapé
    const profileBtn = screen.getByRole('button', { name: /Configurações do usuário/i });
    fireEvent.click(profileBtn);
    expect(mockOpenUserSettings).toHaveBeenCalledWith('perfil');

    // Clica no logout
    const logoutBtn = screen.getByRole('button', { name: /Sair do sistema/i });
    fireEvent.click(logoutBtn);
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('lida com drawer mobile e aciona callback onCloseMobile ao selecionar item ou clicar no overlay', () => {
    const handleCloseMobile = vi.fn();

    vi.mocked(useApp).mockReturnValue({
      activeTab: 'ger' as TabId,
      setActiveTab: mockSetActiveTab,
      isGlobal: true,
      userProfile: MOCK_GLOBAL_USER,
      openUserSettings: mockOpenUserSettings,
      logout: mockLogout
    } as unknown as ReturnType<typeof useApp>);

    const { container } = render(
      <Sidebar mobileOpen={true} onCloseMobile={handleCloseMobile} />
    );

    // Overlay de fundo
    const overlay = container.querySelector('.mobile-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(handleCloseMobile).toHaveBeenCalledTimes(1);

    // Botão de fechar do header mobile
    const closeBtn = screen.getByRole('button', { name: /Fechar menu/i });
    fireEvent.click(closeBtn);
    expect(handleCloseMobile).toHaveBeenCalledTimes(2);

    // Ao selecionar uma aba no mobile, também fecha o menu
    const tabDia = screen.getByText('Painel do dia');
    fireEvent.click(tabDia);
    expect(handleCloseMobile).toHaveBeenCalledTimes(3);
    expect(mockSetActiveTab).toHaveBeenCalledWith('dia');
  });
});
