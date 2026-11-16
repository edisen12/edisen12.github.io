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
import { DEFAULT_CONFIG, DEFAULT_USER_PREFERENCES, ROLES_LABEL } from '../../config/constants';
import { todayIso } from '../../utils/date';
import {
  computeDatasetAvailability,
  clampDateToPeriodBounds,
  neededQueryWindow,
  periodOf,
  resolveEffectivePeriod,
  resolvePeriodDateBounds,
  type DatasetPeriodAvailability
} from '../../domain/periods';
import { buildPlatformIndex } from '../../domain/calculations';
import {
  buildImpersonationTargets,
  resolveImpersonationFromPessoa,
  resolveImpersonationFromProfile,
  scopeDatasetForUser,
  type ImpersonationTarget
} from '../../utils/impersonation';
import {
  fetchCurrentUserScope,
  saveOwnProfileAndPreferences,
  signOut
} from '../../services/auth.service';
import { loadAppDataset } from '../../services/data.service';
import { subscribeToRealtimeUpdates } from '../../services/realtime.service';
import { useToast, type ToastVariant } from '../components/ToastContext';

export interface EmailModalState {
  mode: 'daily' | 'cobranca';
  date?: string;
  plats?: string[];
  targetRespId?: string;
}

export interface CarteiraModalState {
  matricula: string;
  idEmbarque?: string;
  dataRef?: string;
  /** Matrícula da Ficha do Técnico de origem, para oferecer botão "Voltar" sem empilhar Drawer+Modal */
  returnToFichaMat?: string;
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

  // Simulação de Usuário (Modo "Ver como outro usuário" para Administradores)
  isRealAdmin: boolean;
  realUserProfile: UserProfile | null;
  isImpersonating: boolean;
  impersonatedTarget: ImpersonationTarget | null;
  fullDataset: AppDataset;
  impersonateModalOpen: boolean;
  openImpersonateModal: () => void;
  closeImpersonateModal: () => void;
  startImpersonation: (target: ImpersonationTarget) => void;
  impersonateByPessoa: (pessoa: Pessoa) => void;
  impersonateByProfile: (profile: UserProfile) => void;
  stopImpersonation: () => void;

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
  availability?: DatasetPeriodAvailability;
  activePeriod: PeriodWindow;
  isLoading: boolean;
  loadError?: string | null;
  reloadDataset: () => Promise<boolean | void>;
  refreshData: () => Promise<boolean | void>;

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

  carteiraModal: CarteiraModalState | null;
  openCarteiraModal: (matricula: string, idEmbarque?: string, dataRef?: string) => void;
  closeCarteiraModal: () => void;
}

const IMPERSONATE_STORAGE_KEY = 'hhoff_impersonate_key';

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
  carteiraOperacoes: [],
  confirmacoesSap: [],
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

function useOptionalShowToast(): ((message: string, type?: ToastVariant | 'warning') => void) | null {
  try {
    const { showToast } = useToast();
    return (message: string, type?: ToastVariant | 'warning') => {
      const variant: ToastVariant = type === 'warning' ? 'warn' : (type || 'info');
      showToast(message, variant);
    };
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const showToast = useOptionalShowToast();

  // Autenticação, Onboarding e Usuário Real
  const [realUserProfile, setRealUserProfile] = useState<UserProfile | null>(null);
  const [realUserOnboarding, setRealUserOnboarding] = useState<UserOnboarding | null>(null);
  const [realPessoaScope, setRealPessoaScope] = useState<Pessoa | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  // Simulação de Usuário ("Ver como outro usuário")
  const [impersonatedTarget, setImpersonatedTarget] = useState<ImpersonationTarget | null>(null);
  const [impersonateModalOpen, setImpersonateModalOpen] = useState(false);
  const restoredImpersonationRef = useRef(false);

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
  const activeTabRef = useRef<TabId>(activeTab);
  activeTabRef.current = activeTab;

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

  // Dataset Bruto (da sessão autenticada real) e Dados Projetados
  const [fullDataset, setFullDataset] = useState<AppDataset>(INITIAL_DATASET);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');

  // Modais Globais
  const [justModal, setJustModal] = useState<{ mat: string; date: string } | null>(null);
  const [fichaMat, setFichaMat] = useState<string | null>(null);
  const fichaMatRef = useRef<string | null>(null);
  fichaMatRef.current = fichaMat;
  const [emailModal, setEmailModal] = useState<EmailModalState | null>(null);
  const [carteiraModal, setCarteiraModal] = useState<CarteiraModalState | null>(null);

  const openJustModal = useCallback((mat: string, date: string) => setJustModal({ mat, date }), []);
  const closeJustModal = useCallback(() => setJustModal(null), []);

  const openFichaDrawer = useCallback((mat: string) => {
    setCarteiraModal(null);
    setFichaMat(mat);
  }, []);
  const closeFichaDrawer = useCallback(() => setFichaMat(null), []);

  const openEmailModal = useCallback((opts: EmailModalState) => setEmailModal(opts), []);
  const closeEmailModal = useCallback(() => setEmailModal(null), []);

  const openCarteiraModal = useCallback((matricula: string, idEmbarque?: string, dataRef?: string) => {
    const activeDrawerMat = fichaMatRef.current;
    if (activeDrawerMat) {
      setFichaMat(null);
    }
    setCarteiraModal({
      matricula,
      idEmbarque,
      dataRef,
      returnToFichaMat: activeDrawerMat ?? undefined
    });
  }, []);
  const closeCarteiraModal = useCallback(() => setCarteiraModal(null), []);

  // Escopo Real vs Simulado ("Ver como outro usuário")
  const isRealAdmin = useMemo(() => {
    return realUserProfile?.role === 'admin';
  }, [realUserProfile]);

  const realIsGlobal = useMemo(() => {
    if (!realUserProfile) return true;
    return realUserProfile.role === 'admin' || realUserProfile.role === 'gestor';
  }, [realUserProfile]);

  const activeImpersonation = isRealAdmin ? impersonatedTarget : null;
  const isImpersonating = Boolean(activeImpersonation);

  const userProfile = activeImpersonation ? activeImpersonation.profile : realUserProfile;
  const pessoaScope = activeImpersonation ? activeImpersonation.pessoa : realPessoaScope;
  const userOnboarding = useMemo(() => {
    if (!activeImpersonation) return realUserOnboarding;
    return fullDataset.onboardingMap?.[activeImpersonation.profile.id] ?? null;
  }, [activeImpersonation, fullDataset.onboardingMap, realUserOnboarding]);

  const isGlobal = useMemo(() => {
    if (!userProfile) return true;
    return userProfile.role === 'admin' || userProfile.role === 'gestor';
  }, [userProfile]);

  const isAdmin = useMemo(() => {
    return userProfile?.role === 'admin';
  }, [userProfile]);

  // Primeiro login / troca obrigatória avaliada sempre sobre a conta real autenticada
  const requiresPasswordChange = useMemo(() => {
    if (!realUserProfile || !realUserOnboarding) return false;
    return Boolean(realUserOnboarding.primeiro_login || realUserOnboarding.obriga_troca_senha);
  }, [realUserProfile, realUserOnboarding]);

  const scopeLabel = useMemo(() => {
    if (isGlobal || !userProfile) return undefined;
    return `Carteira ${userProfile.nome}`;
  }, [isGlobal, userProfile]);

  // Índice global de plataformas + dataset projetado para o usuário efetivo
  const fullPidx = useMemo(() => {
    return buildPlatformIndex(fullDataset.plataformas);
  }, [fullDataset.plataformas]);

  const dataset = useMemo(() => {
    if (activeImpersonation && isRealAdmin) {
      return scopeDatasetForUser(fullDataset, activeImpersonation, fullPidx);
    }
    return fullDataset;
  }, [fullDataset, activeImpersonation, isRealAdmin, fullPidx]);

  // Índice de Plataformas do escopo efetivo
  const pidx = useMemo(() => {
    return buildPlatformIndex(dataset.plataformas);
  }, [dataset.plataformas]);

  // Disponibilidade real de períodos e datas com dados
  const availability = useMemo(() => {
    return computeDatasetAvailability(dataset, dataset.config.dia_corte_medicao, filters.fPer);
  }, [dataset, filters.fPer]);

  // Período de Medição Ativo (considera períodos com dados reais no modo automático)
  const activePeriod = useMemo(() => {
    return resolveEffectivePeriod(filters, dataset.config.dia_corte_medicao, availability, todayIso());
  }, [filters, dataset.config.dia_corte_medicao, availability]);

  // Janela de Consulta Calculada (monotônica para não encolher dados já carregados ao trocar de período)
  const queryScopeRef = useRef<string>('');
  const minQueryIniRef = useRef<string>('');
  const maxQueryFimRef = useRef<string>('');

  const queryWindow = useMemo(() => {
    const currentScope = `${realUserProfile?.id || ''}|${realIsGlobal}`;
    if (queryScopeRef.current !== currentScope) {
      queryScopeRef.current = currentScope;
      minQueryIniRef.current = '';
      maxQueryFimRef.current = '';
    }

    const today = todayIso();
    const wm = dataset.watermark.ultima_data_hh || '';
    const fDate = filters.fDate || today;
    let refMax = today;
    if (fDate > refMax) refMax = fDate;
    if (wm && wm > refMax) refMax = wm;

    const rawWin = neededQueryWindow(activePeriod, refMax);
    const nextIni =
      minQueryIniRef.current && minQueryIniRef.current < rawWin.queryIni
        ? minQueryIniRef.current
        : rawWin.queryIni;
    const nextFim =
      maxQueryFimRef.current && maxQueryFimRef.current > rawWin.queryFim
        ? maxQueryFimRef.current
        : rawWin.queryFim;

    minQueryIniRef.current = nextIni;
    maxQueryFimRef.current = nextFim;

    return { queryIni: nextIni, queryFim: nextFim };
  }, [activePeriod, filters.fDate, dataset.watermark.ultima_data_hh, realUserProfile?.id, realIsGlobal]);

  const updateFilter = useCallback((key: keyof FilterState, val: string) => {
    setFilters(prev => {
      const next: FilterState = { ...prev, [key]: val };
      const diaCorte = dataset.config.dia_corte_medicao;

      if (key === 'fPer') {
        const nextAvail =
          val && val !== 'custom' && /^\d{4}-\d{2}$/.test(val)
            ? computeDatasetAvailability(dataset, diaCorte, val)
            : availability;
        const nextP =
          val === 'custom' && next.cIni && next.cFim && next.cIni <= next.cFim
            ? resolveEffectivePeriod(next, diaCorte, nextAvail, todayIso())
            : val === ''
              ? (nextAvail.availablePeriods[0]?.window ||
                resolveEffectivePeriod(next, diaCorte, nextAvail, todayIso()))
              : val !== 'custom'
                ? periodOf(val, diaCorte)
                : activePeriod;
        const bounds = resolvePeriodDateBounds(nextP, prev.fDate, nextAvail, todayIso());
        next.fDate = bounds.defaultDate;
        return next;
      }

      if (
        (key === 'cIni' || key === 'cFim') &&
        next.fPer === 'custom' &&
        next.cIni &&
        next.cFim &&
        next.cIni <= next.cFim
      ) {
        const nextP = resolveEffectivePeriod(next, diaCorte, availability, todayIso());
        if (
          !prev.fDate ||
          prev.fDate < nextP.ini ||
          prev.fDate > nextP.fim ||
          (availability.datesWithData.size > 0 && !availability.datesWithData.has(prev.fDate))
        ) {
          const bounds = resolvePeriodDateBounds(nextP, prev.fDate, availability, todayIso());
          next.fDate = bounds.defaultDate;
        }
        return next;
      }

      if (key === 'fDate' && availability.datesWithData.size > 0) {
        const targetPeriod = resolveEffectivePeriod(next, diaCorte, availability, todayIso());
        const bounds = resolvePeriodDateBounds(targetPeriod, prev.fDate, availability, todayIso());
        next.fDate = clampDateToPeriodBounds(val, bounds);
      }

      return next;
    });
  }, [setFilters, dataset, availability, activePeriod]);

  const resetFilters = useCallback(() => {
    const latestDate =
      availability.maxDatasetDate ||
      dataset.watermark.ultima_data_hh ||
      todayIso();
    setFilters({
      ...INITIAL_FILTERS,
      fDate: latestDate
    });
  }, [setFilters, availability.maxDatasetDate, dataset.watermark.ultima_data_hh]);

  // Ações de Simulação de Usuário
  const openImpersonateModal = useCallback(() => {
    if (!isRealAdmin) return;
    setImpersonateModalOpen(true);
  }, [isRealAdmin]);

  const closeImpersonateModal = useCallback(() => {
    setImpersonateModalOpen(false);
  }, []);

  const stopImpersonation = useCallback(() => {
    restoredImpersonationRef.current = true;
    setImpersonatedTarget(null);
    setImpersonateModalOpen(false);
    try {
      sessionStorage.removeItem(IMPERSONATE_STORAGE_KEY);
    } catch {
      // Ignora erro local
    }
    setFilters(prev => ({ ...prev, fResp: '', fPlat: '', fReg: '' }));
    setJustModal(null);
    setFichaMat(null);
    setEmailModal(null);
    setCarteiraModal(null);
    showToast?.('Retornado à visualização de Administrador.', 'success');
  }, [setFilters, showToast]);

  const startImpersonation = useCallback((target: ImpersonationTarget) => {
    if (!isRealAdmin) return;
    restoredImpersonationRef.current = true;

    if (realUserProfile && target.profile.id === realUserProfile.id) {
      stopImpersonation();
      return;
    }

    setImpersonatedTarget(target);
    setImpersonateModalOpen(false);
    try {
      sessionStorage.setItem(IMPERSONATE_STORAGE_KEY, target.key);
    } catch {
      // Ignora erro local
    }
    setFilters(prev => ({ ...prev, fResp: '', fPlat: '', fReg: '' }));
    setJustModal(null);
    setFichaMat(null);
    setEmailModal(null);
    setCarteiraModal(null);

    const targetIsGlobal = target.profile.role === 'admin' || target.profile.role === 'gestor';
    if (
      !targetIsGlobal &&
      (activeTabRef.current === 'pes' ||
        activeTabRef.current === 'imp' ||
        activeTabRef.current === 'cfg' ||
        activeTabRef.current === 'adm')
    ) {
      setActiveTab('ger');
    }

    const roleName = ROLES_LABEL[target.profile.role] || target.profile.role;
    showToast?.(
      `Modo de validação ativo: visualizando como ${target.profile.nome} (${roleName}).`,
      'info'
    );
  }, [isRealAdmin, realUserProfile, stopImpersonation, setFilters, setActiveTab, showToast]);

  const impersonateByPessoa = useCallback((pessoa: Pessoa) => {
    if (!isRealAdmin) return;
    const target = resolveImpersonationFromPessoa(pessoa, fullDataset);
    startImpersonation(target);
  }, [isRealAdmin, fullDataset, startImpersonation]);

  const impersonateByProfile = useCallback((profile: UserProfile) => {
    if (!isRealAdmin) return;
    const target = resolveImpersonationFromProfile(profile, fullDataset);
    startImpersonation(target);
  }, [isRealAdmin, fullDataset, startImpersonation]);

  // Sincroniza ou restaura simulação com os dados atualizados do contrato
  useEffect(() => {
    if (!authInitialized) return;
    if (!isRealAdmin) {
      if (impersonatedTarget) setImpersonatedTarget(null);
      try {
        sessionStorage.removeItem(IMPERSONATE_STORAGE_KEY);
      } catch {
        // Ignora
      }
      return;
    }

    const hasDirectoryData =
      Object.keys(fullDataset.pessoas || {}).length > 0 ||
      Object.keys(fullDataset.profiles || {}).length > 0;
    if (!hasDirectoryData) return;

    const allTargets = buildImpersonationTargets(fullDataset, realUserProfile?.id);

    if (impersonatedTarget) {
      const refreshed = allTargets.find(t => t.key === impersonatedTarget.key);
      if (!refreshed) {
        setImpersonatedTarget(null);
        try {
          sessionStorage.removeItem(IMPERSONATE_STORAGE_KEY);
        } catch {
          // Ignora
        }
      } else if (
        refreshed.profile !== impersonatedTarget.profile ||
        refreshed.pessoa !== impersonatedTarget.pessoa ||
        refreshed.hasLoginAccount !== impersonatedTarget.hasLoginAccount
      ) {
        setImpersonatedTarget(refreshed);
      }
      return;
    }

    if (!restoredImpersonationRef.current) {
      restoredImpersonationRef.current = true;
      try {
        const savedKey = sessionStorage.getItem(IMPERSONATE_STORAGE_KEY);
        if (savedKey) {
          const restored = allTargets.find(t => t.key === savedKey);
          if (restored) {
            setImpersonatedTarget(restored);
          } else {
            sessionStorage.removeItem(IMPERSONATE_STORAGE_KEY);
          }
        }
      } catch {
        // Ignora
      }
    }
  }, [authInitialized, isRealAdmin, fullDataset, realUserProfile?.id, impersonatedTarget]);

  // Carrega Autenticação Inicial e Preferências do Servidor
  const refreshAuth = useCallback(async () => {
    try {
      const scope = await fetchCurrentUserScope();
      if (scope) {
        setRealUserProfile(scope.profile);
        setRealPessoaScope(scope.pessoa);
        setRealUserOnboarding(scope.onboarding);

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
        setRealUserProfile(null);
        setRealPessoaScope(null);
        setRealUserOnboarding(null);
      }
    } catch (err) {
      console.warn('Não foi possível carregar usuário ativo:', err);
      setRealUserProfile(null);
      setRealPessoaScope(null);
      setRealUserOnboarding(null);
    } finally {
      setAuthInitialized(true);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } finally {
      lastQueryRef.current = '';
      queryScopeRef.current = '';
      minQueryIniRef.current = '';
      maxQueryFimRef.current = '';
      restoredImpersonationRef.current = false;
      try {
        sessionStorage.removeItem('hhoff_session_tab');
        sessionStorage.removeItem(IMPERSONATE_STORAGE_KEY);
      } catch {
        // Ignora
      }
      setFullDataset(INITIAL_DATASET);
      setLoadError(null);
      setImpersonatedTarget(null);
      setImpersonateModalOpen(false);
      setRealUserProfile(null);
      setRealPessoaScope(null);
      setRealUserOnboarding(null);
      setRealtimeStatus('disconnected');
      setJustModal(null);
      setFichaMat(null);
      setEmailModal(null);
      setCarteiraModal(null);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  // Garante que perfis restritos não permaneçam em abas administrativas (mas permite 'perfil' para todos)
  useEffect(() => {
    if (userProfile && !isGlobal && (activeTab === 'pes' || activeTab === 'imp' || activeTab === 'cfg' || activeTab === 'adm')) {
      setActiveTab('ger');
    }
  }, [userProfile, isGlobal, activeTab, setActiveTab]);

  // Atualização de Preferências (persiste localmente + no Supabase user_onboarding, exceto durante simulação)
  const updateUserPreferences = useCallback(async (partial: Partial<UserPreferences>) => {
    const next: UserPreferences = {
      ...userPreferences,
      ...partial
    };
    setUserPreferences(next);
    if (!isImpersonating) {
      setRealUserOnboarding(prev => (prev ? { ...prev, preferencias: next } : prev));
    }
    try {
      localStorage.setItem('hhoff_prefs', JSON.stringify(next));
      localStorage.setItem('hhoff_theme', next.themeMode === 'dark' ? 'dark' : 'light');
    } catch {
      // Ignora erro local
    }

    if (realUserProfile && !isImpersonating) {
      await saveOwnProfileAndPreferences(realUserProfile.nome, next);
    }
  }, [userPreferences, realUserProfile, isImpersonating]);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    await updateUserPreferences({ themeMode: mode });
  }, [updateUserPreferences]);

  const toggleTheme = useCallback(() => {
    const nextMode: ThemeMode = theme === 'light' ? 'dark' : 'light';
    updateUserPreferences({ themeMode: nextMode }).catch(err => console.warn('Falha ao persistir tema:', err));
  }, [theme, updateUserPreferences]);

  // Carregamento de Dados com Janelamento Automático (usa a sessão real autenticada)
  const lastQueryRef = useRef<string>('');

  const reloadDataset = useCallback(async (): Promise<boolean> => {
    if (!realUserProfile || requiresPasswordChange) return false;
    setIsLoading(true);
    setLoadError(null);
    try {
      const ds = await loadAppDataset(queryWindow.queryIni, queryWindow.queryFim, realIsGlobal);
      setFullDataset(ds);

      const avail = computeDatasetAvailability(ds, ds.config.dia_corte_medicao, '');
      setFiltersState(prev => {
        const effAvail =
          prev.fPer && /^\d{4}-\d{2}$/.test(prev.fPer)
            ? computeDatasetAvailability(ds, ds.config.dia_corte_medicao, prev.fPer)
            : avail;
        let nextPer = prev.fPer;
        if (
          nextPer &&
          nextPer !== 'custom' &&
          avail.datesWithData.size > 0 &&
          !avail.availablePeriods.some(opt => opt.value === nextPer)
        ) {
          nextPer = '';
        }
        const activeAvail = nextPer ? effAvail : avail;
        const nextFiltersBase: FilterState = { ...prev, fPer: nextPer };
        const targetPeriod = resolveEffectivePeriod(
          nextFiltersBase,
          ds.config.dia_corte_medicao,
          activeAvail,
          todayIso()
        );
        const bounds = resolvePeriodDateBounds(
          targetPeriod,
          prev.fDate,
          activeAvail,
          todayIso()
        );
        const needsDateAdjust =
          !prev.fDate ||
          prev.fDate < bounds.minDate ||
          prev.fDate > bounds.maxDate ||
          (avail.datesWithData.size > 0 && !avail.datesWithData.has(prev.fDate));

        if (!needsDateAdjust && nextPer === prev.fPer) {
          return prev;
        }
        const updated: FilterState = {
          ...nextFiltersBase,
          fDate: needsDateAdjust ? bounds.defaultDate : prev.fDate
        };
        try {
          localStorage.setItem('hhoff_filters', JSON.stringify(updated));
        } catch {
          // Ignora erro de cota local
        }
        return updated;
      });
      return true;
    } catch (err: any) {
      console.error('Erro ao carregar dataset do contrato:', err);
      const msg =
        err?.message && String(err.message).trim()
          ? `Falha ao carregar dados do banco (${String(err.message).slice(0, 140)}).`
          : 'Erro ao carregar dados do contrato. Verifique sua conexão ou sessão.';
      setLoadError(msg);
      showToast?.(msg, 'error');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [realUserProfile, requiresPasswordChange, queryWindow.queryIni, queryWindow.queryFim, realIsGlobal, showToast]);

  useEffect(() => {
    if (!authInitialized || !realUserProfile || requiresPasswordChange) {
      lastQueryRef.current = '';
      return;
    }

    const queryKey = `${realUserProfile.id}|${queryWindow.queryIni}|${queryWindow.queryFim}|${realIsGlobal}`;
    if (lastQueryRef.current !== queryKey) {
      lastQueryRef.current = queryKey;
      reloadDataset();
    }
  }, [queryWindow.queryIni, queryWindow.queryFim, realIsGlobal, authInitialized, realUserProfile, requiresPasswordChange, reloadDataset]);

  // Sincronização Realtime (somente após conclusão do primeiro login)
  useEffect(() => {
    if (!authInitialized || !realUserProfile || requiresPasswordChange) return;

    setRealtimeStatus('connected');
    const unsubscribe = subscribeToRealtimeUpdates(() => {
      reloadDataset();
    });

    return () => {
      unsubscribe();
    };
  }, [authInitialized, realUserProfile, requiresPasswordChange, reloadDataset]);

  const value = useMemo<AppContextValue>(() => ({
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
    isRealAdmin,
    realUserProfile,
    isImpersonating,
    impersonatedTarget: activeImpersonation,
    fullDataset,
    impersonateModalOpen,
    openImpersonateModal,
    closeImpersonateModal,
    startImpersonation,
    impersonateByPessoa,
    impersonateByProfile,
    stopImpersonation,
    userPreferences,
    updateUserPreferences,
    themeMode: userPreferences.themeMode,
    setThemeMode,
    theme,
    toggleTheme,
    dataset,
    pidx,
    availability,
    activePeriod,
    isLoading,
    loadError,
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
    closeEmailModal,
    carteiraModal,
    openCarteiraModal,
    closeCarteiraModal
  }), [
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
    isRealAdmin,
    realUserProfile,
    isImpersonating,
    activeImpersonation,
    fullDataset,
    impersonateModalOpen,
    openImpersonateModal,
    closeImpersonateModal,
    startImpersonation,
    impersonateByPessoa,
    impersonateByProfile,
    stopImpersonation,
    userPreferences,
    updateUserPreferences,
    setThemeMode,
    theme,
    toggleTheme,
    dataset,
    pidx,
    availability,
    activePeriod,
    isLoading,
    loadError,
    reloadDataset,
    filters,
    setFilters,
    updateFilter,
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
    closeEmailModal,
    carteiraModal,
    openCarteiraModal,
    closeCarteiraModal
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp deve ser usado dentro de um AppProvider');
  }
  return context;
}
