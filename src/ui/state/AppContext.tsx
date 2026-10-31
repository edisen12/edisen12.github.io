import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  AppDataset,
  FilterState,
  PeriodWindow,
  Pessoa,
  Plataforma,
  TabId,
  ThemeMode,
  UserOnboarding,
  UserPreferences,
  UserProfile
} from '../../domain/types';
import { DEFAULT_CONFIG, DEFAULT_USER_PREFERENCES } from '../../config/constants';
import { todayIso } from '../../utils/date';
import { neededQueryWindow, resolveActivePeriod } from '../../domain/periods';
import { buildPlatformIndex } from '../../domain/calculations';
import {
  fetchCurrentUserScope,
  saveOwnProfileAndPreferences,
  signOut
} from '../../services/auth.service';
import { loadAppDataset } from '../../services/data.service';
import { subscribeToRealtimeUpdates } from '../../services/realtime.service';

export interface EmailModalState {
  mode: 'daily' | 'cobranca';
  date?: string;
  plats?: string[];
  targetRespId?: string;
}

export type UserSettingsSection = 'perfil' | 'aparencia' | 'seguranca';

export interface AppContextValue {
  // Autenticação, Onboarding & Escopo
  authInitialized: boolean;
  userProfile: UserProfile | null;
  userOnboarding: UserOnboarding | null;
  requiresPasswordChange: boolean;
  pessoaScope: Pessoa | null;
  isGlobal: boolean;
  isAdmin: boolean;
  scopeLabel?: string;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;

  // Preferências do Usuário & Tema
  userPreferences: UserPreferences;
  updateUserPreferences: (partial: Partial<UserPreferences>) => Promise<void>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  theme: 'light' | 'dark';
  toggleTheme: () => void;

  // Dados do Contrato
  dataset: AppDataset;
  pidx: Record<string, Plataforma>;
  activePeriod: PeriodWindow;
  isLoading: boolean;
  reloadDataset: () => Promise<void>;
  refreshData: () => Promise<void>;

  // Filtros Reativos
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  updateFilter: (key: keyof FilterState, val: string) => void;
  setFilter: (key: keyof FilterState, val: string) => void;
  resetFilters: () => void;

  // Navegação & Configurações do Usuário
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  userSettingsSection: UserSettingsSection;
  openUserSettings: (section?: UserSettingsSection) => void;

  // Realtime
  realtimeStatus: 'connected' | 'connecting' | 'disconnected';

  // Modais Globais
  justModal: { mat: string; date: string } | null;
  openJustModal: (mat: string, date: string) => void;
  closeJustModal: () => void;

  fichaMat: string | null;
  openFichaDrawer: (mat: string) => void;
  closeFichaDrawer: () => void;

  emailModal: EmailModalState | null;
  openEmailModal: (opts: EmailModalState) => void;
  closeEmailModal: () => void;
}

const INITIAL_DATASET: AppDataset = {
  config: DEFAULT_CONFIG,
  usoffUnWeights: {},
  emailsResumo: [],
  plataformas: {},
  pessoas: {},
  profiles: {},
  onboardingMap: {},
  tecnicos: {},
  carteira: [],
  hhMap: {},
  justMap: {},
  externalCoveredSet: new Set<string>(),
  sharedOpsSet: new Set<string>(),
  watermark: { ultima_data_hh: null, ultima_importacao_em: null },
  latestFluxo: null,
  isDemo: false,
  demoReason: ''
};

const INITIAL_FILTERS: FilterState = {
  fDate: todayIso(),
  fReg: '',
  fPlat: '',
  fResp: '',
  fPer: '',
  cIni: '',
  cFim: ''
};

function readLocalPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem('hhoff_prefs');
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_USER_PREFERENCES, ...parsed };
    }
    const legacyTheme = localStorage.getItem('hhoff_theme');
    if (legacyTheme === 'dark' || legacyTheme === 'light') {
      return { ...DEFAULT_USER_PREFERENCES, themeMode: legacyTheme };
    }
  } catch {
    // Fallback seguro
  }
  return { ...DEFAULT_USER_PREFERENCES };
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Autenticação, Onboarding e Usuário
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userOnboarding, setUserOnboarding] = useState<UserOnboarding | null>(null);
  const [pessoaScope, setPessoaScope] = useState<Pessoa | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  // Preferências do Usuário
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(readLocalPreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (ev: MediaQueryListEvent) => setSystemPrefersDark(ev.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } catch {
      return undefined;
    }
  }, []);

  const theme: 'light' | 'dark' = useMemo(() => {
    if (userPreferences.themeMode === 'system') {
      return systemPrefersDark ? 'dark' : 'light';
    }
    return userPreferences.themeMode === 'dark' ? 'dark' : 'light';
  }, [userPreferences.themeMode, systemPrefersDark]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-density', userPreferences.density);
  }, [theme, userPreferences.density]);

  // Navegação por Abas
  const [activeTab, setActiveTabState] = useState<TabId>(() => {
    try {
      const saved = sessionStorage.getItem('hhoff_session_tab') || localStorage.getItem('hhoff_tab');
      return (saved as TabId) || readLocalPreferences().defaultTab || 'ger';
    } catch {
      return 'ger';
    }
  });

  const [userSettingsSection, setUserSettingsSection] = useState<UserSettingsSection>('perfil');

  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabState(tab);
    try {
      sessionStorage.setItem('hhoff_session_tab', tab);
      localStorage.setItem('hhoff_tab', tab);
    } catch {
      // Ignora erro de cota local
    }
  }, []);

  const openUserSettings = useCallback((section: UserSettingsSection = 'perfil') => {
    setUserSettingsSection(section);
    setActiveTab('perfil');
  }, [setActiveTab]);

  // Filtros Globais Reativos
  const [filters, setFiltersState] = useState<FilterState>(() => {
    try {
      const saved = localStorage.getItem('hhoff_filters');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...INITIAL_FILTERS,
          ...parsed,
          fDate: parsed.fDate || todayIso()
        };
      }
    } catch {
      // Fallback
    }
    return INITIAL_FILTERS;
  });

  const setFilters = useCallback((updater: React.SetStateAction<FilterState>) => {
    setFiltersState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('hhoff_filters', JSON.stringify(next));
      } catch {
        // Ignora erro de cota
      }
      return next;
    });
  }, []);

  const updateFilter = useCallback((key: keyof FilterState, val: string) => {
    setFilters(prev => ({ ...prev, [key]: val }));
  }, [setFilters]);

  const resetFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, [setFilters]);

  // Dataset e Dados
  const [dataset, setDataset] = useState<AppDataset>(INITIAL_DATASET);
  const [isLoading, setIsLoading] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');

  // Modais Globais
  const [justModal, setJustModal] = useState<{ mat: string; date: string } | null>(null);
  const [fichaMat, setFichaMat] = useState<string | null>(null);
  const [emailModal, setEmailModal] = useState<EmailModalState | null>(null);

  const openJustModal = useCallback((mat: string, date: string) => setJustModal({ mat, date }), []);
  const closeJustModal = useCallback(() => setJustModal(null), []);

  const openFichaDrawer = useCallback((mat: string) => setFichaMat(mat), []);
  const closeFichaDrawer = useCallback(() => setFichaMat(null), []);

  const openEmailModal = useCallback((opts: EmailModalState) => setEmailModal(opts), []);
  const closeEmailModal = useCallback(() => setEmailModal(null), []);

  // Escopo de Papel & Primeiro Login
  const isGlobal = useMemo(() => {
    if (!userProfile) return true;
    return userProfile.role === 'admin' || userProfile.role === 'gestor';
  }, [userProfile]);

  const isAdmin = useMemo(() => {
    return userProfile?.role === 'admin';
  }, [userProfile]);

  const requiresPasswordChange = useMemo(() => {
    if (!userProfile || !userOnboarding) return false;
    return Boolean(userOnboarding.primeiro_login || userOnboarding.obriga_troca_senha);
  }, [userProfile, userOnboarding]);

  const scopeLabel = useMemo(() => {
    if (isGlobal || !userProfile) return undefined;
    return `Carteira ${userProfile.nome}`;
  }, [isGlobal, userProfile]);

  // Índice de Plataformas
  const pidx = useMemo(() => {
    return buildPlatformIndex(dataset.plataformas);
  }, [dataset.plataformas]);

  // Período de Medição Ativo
  const activePeriod = useMemo(() => {
    return resolveActivePeriod(filters, dataset.config.dia_corte_medicao, todayIso());
  }, [filters, dataset.config.dia_corte_medicao]);

  // Janela de Consulta Calculada
  const queryWindow = useMemo(() => {
    return neededQueryWindow(activePeriod, filters.fDate || todayIso());
  }, [activePeriod, filters.fDate]);

  // Carrega Autenticação Inicial e Preferências do Servidor
  const refreshAuth = useCallback(async () => {
    try {
      const scope = await fetchCurrentUserScope();
      if (scope) {
        setUserProfile(scope.profile);
        setPessoaScope(scope.pessoa);
        setUserOnboarding(scope.onboarding);

        const mergedPrefs: UserPreferences = {
          ...DEFAULT_USER_PREFERENCES,
          ...scope.onboarding.preferencias
        };
        setUserPreferences(mergedPrefs);
        try {
          localStorage.setItem('hhoff_prefs', JSON.stringify(mergedPrefs));
          if (!sessionStorage.getItem('hhoff_session_tab')) {
            setActiveTabState(mergedPrefs.defaultTab || 'ger');
          }
        } catch {
          // Ignora erro local
        }
      } else {
        setUserProfile(null);
        setPessoaScope(null);
        setUserOnboarding(null);
      }
    } catch (err) {
      console.warn('Não foi possível carregar usuário ativo:', err);
      setUserProfile(null);
      setPessoaScope(null);
      setUserOnboarding(null);
    } finally {
      setAuthInitialized(true);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } finally {
      lastQueryRef.current = '';
      try {
        sessionStorage.removeItem('hhoff_session_tab');
      } catch {
        // Ignora
      }
      setDataset(INITIAL_DATASET);
      setUserProfile(null);
      setPessoaScope(null);
      setUserOnboarding(null);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  // Garante que perfis restritos não permaneçam em abas administrativas (mas permite 'perfil' para todos)
  useEffect(() => {
    if (userProfile && !isGlobal && (activeTab === 'pes' || activeTab === 'imp' || activeTab === 'cfg')) {
      setActiveTab('ger');
    }
  }, [userProfile, isGlobal, activeTab, setActiveTab]);

  // Atualização de Preferências (persiste localmente + no Supabase user_onboarding)
  const updateUserPreferences = useCallback(async (partial: Partial<UserPreferences>) => {
    const next: UserPreferences = {
      ...userPreferences,
      ...partial
    };
    setUserPreferences(next);
    setUserOnboarding(prev => (prev ? { ...prev, preferencias: next } : prev));
    try {
      localStorage.setItem('hhoff_prefs', JSON.stringify(next));
      localStorage.setItem('hhoff_theme', next.themeMode === 'dark' ? 'dark' : 'light');
    } catch {
      // Ignora erro local
    }

    if (userProfile) {
      await saveOwnProfileAndPreferences(userProfile.nome, next);
    }
  }, [userPreferences, userProfile]);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    await updateUserPreferences({ themeMode: mode });
  }, [updateUserPreferences]);

  const toggleTheme = useCallback(() => {
    const nextMode: ThemeMode = theme === 'light' ? 'dark' : 'light';
    void updateUserPreferences({ themeMode: nextMode });
  }, [theme, updateUserPreferences]);

  // Carregamento de Dados com Janelamento Automático (somente autenticado E com senha definitiva trocada)
  const lastQueryRef = useRef<string>('');

  const reloadDataset = useCallback(async () => {
    if (!userProfile || requiresPasswordChange) return;
    setIsLoading(true);
    try {
      const ds = await loadAppDataset(queryWindow.queryIni, queryWindow.queryFim, isGlobal);
      setDataset(ds);
    } catch (err) {
      console.error('Erro ao carregar dataset do contrato:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userProfile, requiresPasswordChange, queryWindow.queryIni, queryWindow.queryFim, isGlobal]);

  useEffect(() => {
    if (!authInitialized || !userProfile || requiresPasswordChange) {
      lastQueryRef.current = '';
      return;
    }

    const queryKey = `${userProfile.id}|${queryWindow.queryIni}|${queryWindow.queryFim}|${isGlobal}`;
    if (lastQueryRef.current !== queryKey) {
      lastQueryRef.current = queryKey;
      reloadDataset();
    }
  }, [queryWindow.queryIni, queryWindow.queryFim, isGlobal, authInitialized, userProfile, requiresPasswordChange, reloadDataset]);

  // Sincronização Realtime (somente após conclusão do primeiro login)
  useEffect(() => {
    if (!authInitialized || !userProfile || requiresPasswordChange) return;

    setRealtimeStatus('connected');
    const unsubscribe = subscribeToRealtimeUpdates(() => {
      reloadDataset();
    });

    return () => {
      unsubscribe();
    };
  }, [authInitialized, userProfile, requiresPasswordChange, reloadDataset]);

  const value: AppContextValue = {
    authInitialized,
    userProfile,
    userOnboarding,
    requiresPasswordChange,
    pessoaScope,
    isGlobal,
    isAdmin,
    scopeLabel,
    refreshAuth,
    logout,
    userPreferences,
    updateUserPreferences,
    themeMode: userPreferences.themeMode,
    setThemeMode,
    theme,
    toggleTheme,
    dataset,
    pidx,
    activePeriod,
    isLoading,
    reloadDataset,
    refreshData: reloadDataset,
    filters,
    setFilters,
    updateFilter,
    setFilter: updateFilter,
    resetFilters,
    activeTab,
    setActiveTab,
    userSettingsSection,
    openUserSettings,
    realtimeStatus,
    justModal,
    openJustModal,
    closeJustModal,
    fichaMat,
    openFichaDrawer,
    closeFichaDrawer,
    emailModal,
    openEmailModal,
    closeEmailModal
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp deve ser usado dentro de um AppProvider');
  }
  return context;
}
