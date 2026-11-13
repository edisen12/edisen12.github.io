import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StickyFilterBar } from '../StickyFilterBar';
import { Sidebar } from '../Sidebar';
import { TopHeader } from '../TopHeader';
import { AppShell } from '../AppShell';
import { ScopeBanner } from '../ScopeBanner';
import { PwaInstallModal } from '../../modals/PwaInstallModal';
import { useApp } from '../../state/AppContext';
import { DEFAULT_CONFIG, NAV_TABS } from '../../../config/constants';
import { buildPlatformIndex } from '../../../domain/calculations';
import { todayIso } from '../../../utils/date';
import { initPwa, resetInstallBanner, type BeforeInstallPromptEvent } from '../../../utils/pwa';
import type { AppDataset, FilterState, PeriodWindow, Plataforma, UserProfile } from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

const MOCK_PLATFORMS: Record<string, Plataforma> = {
  P51: {
    sigla: 'P51',
    chave_norm: 'P51',
    nome: 'Plataforma P-51',
    un: 'UN-BS',
    armador: '',
    gerencia: 'UO-BS',
    tipo: 'SS',
    situacao: 'Mobilizada',
    cadastro_pendente: false
  },
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

const MOCK_DATASET: AppDataset = {
  config: { ...DEFAULT_CONFIG },
  usoffUnWeights: {},
  emailsResumo: [],
  plataformas: MOCK_PLATFORMS,
  pessoas: {
    'pes-1': {
      id: 'pes-1',
      slug: 'ana-beatriz-costa',
      nome: 'Ana Beatriz Costa',
      papel: 'preposto',
      email: 'ana.costa@infotecbrasil.com.br',
      user_id: null,
      plats: ['P51'],
      uns: ['UN-BS']
    }
  },
  profiles: {},
  tecnicos: {},
  carteira: [],
  carteiraOperacoes: [],
  confirmacoesSap: [],
  hhMap: {},
  justMap: {},
  externalCoveredSet: new Set<string>(),
  sharedOpsSet: new Set<string>(),
  watermark: { ultima_data_hh: '2026-06-15', ultima_importacao_em: '2026-06-16T08:00:00Z' },
  latestFluxo: null,
  isDemo: false,
  demoReason: ''
};

const MOCK_PERIOD: PeriodWindow = {
  ini: '2026-05-21',
  fim: '2026-06-20',
  m: '2026-06'
};

const MOCK_USER: UserProfile = {
  id: 'usr-gestor-1',
  email: 'gestor.teste@infotecbrasil.com.br',
  nome: 'Rafael Souza Andrade',
  role: 'gestor',
  ativo: true
};

function configureMatchMedia(opts: { isMobile?: boolean; isStandalone?: boolean } = {}) {
  const { isMobile = false, isStandalone = false } = opts;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches:
        (query === '(max-width: 768px)' && isMobile) ||
        (query === '(display-mode: standalone)' && isStandalone),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });
}

function setupMockApp(overrides: Record<string, unknown> = {}) {
  const defaultFilters: FilterState = {
    fDate: todayIso(),
    fReg: '',
    fPlat: '',
    fResp: '',
    fPer: '',
    cIni: '',
    cFim: ''
  };

  const ctx = {
    activeTab: 'ger',
    setActiveTab: vi.fn(),
    isGlobal: true,
    isAdmin: false,
    scopeLabel: undefined,
    userProfile: MOCK_USER,
    dataset: MOCK_DATASET,
    pidx: MOCK_PIDX,
    activePeriod: MOCK_PERIOD,
    filters: defaultFilters,
    setFilters: vi.fn(),
    updateFilter: vi.fn(),
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    themeMode: 'light',
    isLoading: false,
    refreshData: vi.fn().mockResolvedValue(undefined),
    openUserSettings: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };

  vi.mocked(useApp).mockReturnValue(ctx as unknown as ReturnType<typeof useApp>);
  return ctx;
}

describe('Shell Responsivo & UI de Instalação PWA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    configureMatchMedia({ isMobile: false, isStandalone: false });
    initPwa();
    resetInstallBanner();
  });

  describe('StickyFilterBar (Barra Compacta Mobile, Contagem e Limpeza)', () => {
    it('renderiza .filter-mobile-bar e alterna aria-expanded no botão "Filtros" (false -> true -> false)', () => {
      setupMockApp();
      const { container } = render(<StickyFilterBar />);

      const mobileBar = container.querySelector('.filter-mobile-bar');
      expect(mobileBar).not.toBeNull();

      const fieldsContainer = container.querySelector('#filter-fields-container');
      expect(fieldsContainer?.classList.contains('mobile-collapsed')).toBe(true);

      const toggleBtn = screen.getByRole('button', { name: /Alternar painel de filtros/i });
      expect(toggleBtn.textContent).toContain('Filtros');
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');

      // Abre painel mobile
      fireEvent.click(toggleBtn);
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(fieldsContainer?.classList.contains('mobile-expanded')).toBe(true);

      // Fecha painel mobile novamente
      fireEvent.click(toggleBtn);
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
      expect(fieldsContainer?.classList.contains('mobile-collapsed')).toBe(true);

      // Sem filtros ativos: não deve exibir badge nem botão de limpar
      expect(container.querySelector('.filter-mobile-badge')).toBeNull();
      expect(screen.queryByRole('button', { name: /Limpar filtros/i })).toBeNull();
    });

    it('exibe badge de contagem de filtros ativos e aciona resetFilters ao clicar em limpar', () => {
      const resetFilters = vi.fn();
      setupMockApp({
        resetFilters,
        filters: {
          fDate: '2026-06-10', // 1 (diferente de todayIso)
          fReg: 'UN-BS',       // 2
          fPlat: 'P51',        // 3
          fResp: '',
          fPer: '',
          cIni: '',
          cFim: ''
        }
      });

      const { container } = render(<StickyFilterBar />);

      const badge = container.querySelector('.filter-mobile-badge');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe('3');

      const clearButtons = screen.getAllByRole('button', { name: /Limpar filtros/i });
      expect(clearButtons.length).toBeGreaterThanOrEqual(1);

      fireEvent.click(clearButtons[0]);
      expect(resetFilters).toHaveBeenCalledTimes(1);
    });

    it('envia p.id no select de responsável, resolve ScopeBanner por ID e limpa fPlat incompatível ao trocar UN', () => {
      const updateFilter = vi.fn();
      const setFilters = vi.fn();
      setupMockApp({
        filters: {
          fDate: todayIso(),
          fReg: 'UN-BS',
          fPlat: 'P51',
          fResp: 'pes-1',
          fPer: '',
          cIni: '',
          cFim: ''
        },
        updateFilter,
        setFilters
      });

      render(
        <>
          <StickyFilterBar />
          <ScopeBanner />
        </>
      );

      const respSelect = screen.getByLabelText('Responsável') as HTMLSelectElement;
      const anaOption = screen.getByRole('option', { name: 'Ana Beatriz Costa' }) as HTMLOptionElement;
      expect(anaOption.value).toBe('pes-1');
      expect(respSelect.value).toBe('pes-1');
      expect(screen.getByRole('status').textContent).toContain('Ana Beatriz Costa');

      fireEvent.change(respSelect, { target: { value: 'pes-1' } });
      expect(updateFilter).toHaveBeenCalledWith('fResp', 'pes-1');

      const regSelect = screen.getByLabelText('UN') as HTMLSelectElement;
      fireEvent.change(regSelect, { target: { value: 'UN-ES' } });
      expect(setFilters).toHaveBeenCalledTimes(1);
      const updater = setFilters.mock.calls[0][0] as (prev: FilterState) => FilterState;
      expect(
        updater({
          fDate: todayIso(),
          fReg: 'UN-BS',
          fPlat: 'P51',
          fResp: 'pes-1',
          fPer: '',
          cIni: '',
          cFim: ''
        })
      ).toMatchObject({ fReg: 'UN-ES', fPlat: '' });
    });

    it('exibe alerta com botão "Recarregar dados" no AppShell quando loadError está definido', () => {
      const reloadDataset = vi.fn().mockResolvedValue(true);
      setupMockApp({
        loadError: 'Falha simulada de conexão ao banco.',
        reloadDataset
      });

      render(
        <AppShell>
          <div>Conteúdo Operacional</div>
        </AppShell>
      );

      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('Falha simulada de conexão ao banco.');
      const retryBtn = screen.getByRole('button', { name: /Recarregar dados/i });
      fireEvent.click(retryBtn);
      expect(reloadDataset).toHaveBeenCalledTimes(1);
    });
  });

  describe('Sidebar Mobile (Gaveta Legível Ignorando Colapso do Desktop)', () => {
    it('omite a classe collapsed no mobile mesmo com hhoff_sidebar_collapsed="true", exibe todos os rótulos e fecha com Escape ou clique em aba', () => {
      localStorage.setItem('hhoff_sidebar_collapsed', 'true');
      const onCloseMobile = vi.fn();
      const setActiveTab = vi.fn();
      setupMockApp({ setActiveTab, isGlobal: true });

      const { container } = render(
        <Sidebar mobileOpen={true} onCloseMobile={onCloseMobile} />
      );

      const aside = container.querySelector('aside.app-sidebar');
      expect(aside).not.toBeNull();
      expect(aside?.classList.contains('mobile-open')).toBe(true);
      expect(aside?.classList.contains('collapsed')).toBe(false);

      // Exibe título do cabeçalho e todos os rótulos completos das abas
      expect(screen.getByText('MÓDULOS')).not.toBeNull();
      for (const tab of NAV_TABS) {
        expect(screen.getByText(tab.label)).not.toBeNull();
      }

      // Exibe botão "Fechar menu"
      const closeBtn = screen.getByRole('button', { name: /Fechar menu/i });
      expect(closeBtn).not.toBeNull();

      // Pressionar Escape deve acionar onCloseMobile
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onCloseMobile).toHaveBeenCalledTimes(1);

      // Clicar numa aba seleciona a aba e fecha a gaveta mobile
      fireEvent.click(screen.getByText('Justificativas'));
      expect(setActiveTab).toHaveBeenCalledWith('jus');
      expect(onCloseMobile).toHaveBeenCalledTimes(2);
    });
  });

  describe('TopHeader, AppShell e PwaInstallModal (Fluxo de Instalação PWA)', () => {
    it('exibe botão "Instalar aplicativo" no TopHeader quando canShowInstallOption está ativo e abre o modal de instruções', async () => {
      setupMockApp();
      render(<TopHeader />);

      const installPill = screen.getByRole('button', { name: /Instalar aplicativo/i });
      expect(installPill).not.toBeNull();
      expect(installPill.classList.contains('pwa-install-pill')).toBe(true);

      // Também exibe opção no menu dropdown do usuário
      const profileBtn = screen.getByTitle(/Conta de Rafael Souza Andrade/i);
      fireEvent.click(profileBtn);
      expect(screen.getByRole('menuitem', { name: /Instalar aplicativo/i })).not.toBeNull();

      // Clicar no pill sem prompt nativo abre o PwaInstallModal
      fireEvent.click(installPill);
      await waitFor(() => {
        expect(screen.getByText('Instalar Aplicativo HH Offshore')).not.toBeNull();
      });
    });

    it('exibe .pwa-mobile-banner no AppShell em telas móveis e persiste dispensa em localStorage', () => {
      configureMatchMedia({ isMobile: true, isStandalone: false });
      resetInstallBanner();
      setupMockApp();

      const { container } = render(
        <AppShell>
          <div>Conteúdo Operacional</div>
        </AppShell>
      );

      const banner = container.querySelector('.pwa-mobile-banner');
      expect(banner).not.toBeNull();
      expect(screen.getByText(/Instale o app HH Offshore no celular/i)).not.toBeNull();

      const dismissBtn = screen.getByRole('button', { name: /Dispensar aviso de instalação/i });
      fireEvent.click(dismissBtn);

      expect(localStorage.getItem('hhoff_pwa_banner_dismissed')).toBe('true');
      expect(container.querySelector('.pwa-mobile-banner')).toBeNull();
    });

    it('renderiza e alterna entre as abas "iPhone & iPad (Safari)" e "Android, Chrome & Edge" no PwaInstallModal', () => {
      const onClose = vi.fn();
      render(<PwaInstallModal open={true} onClose={onClose} />);

      const iosTabBtn = screen.getByRole('button', { name: /iPhone & iPad \(Safari\)/i });
      const androidTabBtn = screen.getByRole('button', { name: /Android, Chrome & Edge/i });

      expect(iosTabBtn).not.toBeNull();
      expect(androidTabBtn).not.toBeNull();

      // Aba padrão em ambiente não-iOS: Android, Chrome & Edge
      expect(screen.getByText(/Mais \(⋮\)/i)).not.toBeNull();
      expect(screen.getByText(/Adicionar à tela inicial/i)).not.toBeNull();

      // Alterna para guia iOS Safari
      fireEvent.click(iosTabBtn);
      expect(screen.getByText(/Compartilhar/i)).not.toBeNull();
      expect(screen.getByText(/Adicionar à Tela de Início/i)).not.toBeNull();

      // Alterna de volta para Android, Chrome & Edge
      fireEvent.click(androidTabBtn);
      expect(screen.getByText(/Samsung Internet/i)).not.toBeNull();

      // Fecha pelo botão do rodapé
      fireEvent.click(screen.getByRole('button', { name: /Entendi/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('habilita botão de instalação automática quando beforeinstallprompt é capturado', async () => {
      const promptSpy = vi.fn().mockResolvedValue(undefined);
      const fakePromptEvent = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        platforms: ['web'],
        prompt: promptSpy,
        userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })
      }) as BeforeInstallPromptEvent;

      window.dispatchEvent(fakePromptEvent);

      const onClose = vi.fn();
      render(<PwaInstallModal open={true} onClose={onClose} />);

      const directBtn = screen.getByRole('button', { name: /Instalar Agora no Dispositivo/i });
      expect(directBtn).not.toBeNull();

      fireEvent.click(directBtn);
      await waitFor(() => {
        expect(promptSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
