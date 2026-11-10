// ============================================================================
// Utilitário & Hook Reativo de PWA — HH Offshore · Infotec Brasil
// Gerenciador de ciclo de vida PWA, Service Worker e Instalação (WebAPK & iOS)
// ============================================================================

import { useSyncExternalStore } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface PwaState {
  isInstalled: boolean;
  isStandalone: boolean;
  isIos: boolean;
  isMobile: boolean;
  canPromptDirectly: boolean;
  canShowInstallOption: boolean;
  bannerDismissed: boolean;
}

export type PwaInstallOutcome = 'accepted' | 'dismissed' | 'manual-instructions';

const BANNER_STORAGE_KEY = 'hhoff_pwa_banner_dismissed';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let isInitialized = false;
let customInstalledFlag = false;
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  subscribers.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.warn('[PWA] Erro ao notificar subscriber:', err);
    }
  });
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const isStandaloneMq = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
    const isIosStandalone = (navigator as { standalone?: boolean })?.standalone === true;
    return isStandaloneMq || isIosStandalone || customInstalledFlag;
  } catch {
    return false;
  }
}

function checkIsIos(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  try {
    const ua = navigator.userAgent || '';
    const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '';
    const isIosDevice = /iPad|iPhone|iPod/.test(ua);
    const isMacWithTouch = platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
    return isIosDevice || isMacWithTouch;
  } catch {
    return false;
  }
}

function checkIsMobile(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  try {
    const ua = navigator.userAgent || '';
    const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    const isSmallScreen = window.matchMedia?.('(max-width: 768px)')?.matches ?? false;
    return mobileRegex.test(ua) || isSmallScreen;
  } catch {
    return false;
  }
}

function checkBannerDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(BANNER_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

let currentSnapshot: PwaState = {
  isInstalled: false,
  isStandalone: false,
  isIos: false,
  isMobile: false,
  canPromptDirectly: false,
  canShowInstallOption: false,
  bannerDismissed: false
};

function computePwaState(): PwaState {
  const isStandalone = checkIsStandalone();
  const isIos = checkIsIos();
  const isMobile = checkIsMobile();
  const canPromptDirectly = Boolean(deferredPrompt);
  const bannerDismissed = checkBannerDismissed();
  const isInstalled = isStandalone || customInstalledFlag;
  // A opção de instalar é útil em qualquer ambiente não-standalone
  const canShowInstallOption = !isInstalled;

  return {
    isInstalled,
    isStandalone,
    isIos,
    isMobile,
    canPromptDirectly,
    canShowInstallOption,
    bannerDismissed
  };
}

function updateSnapshot(): void {
  const next = computePwaState();
  // Comparação simples para preservar referência caso nada tenha mudado
  if (
    currentSnapshot.isInstalled !== next.isInstalled ||
    currentSnapshot.isStandalone !== next.isStandalone ||
    currentSnapshot.isIos !== next.isIos ||
    currentSnapshot.isMobile !== next.isMobile ||
    currentSnapshot.canPromptDirectly !== next.canPromptDirectly ||
    currentSnapshot.canShowInstallOption !== next.canShowInstallOption ||
    currentSnapshot.bannerDismissed !== next.bannerDismissed
  ) {
    currentSnapshot = next;
    notifySubscribers();
  }
}

export function initPwa(): void {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  // 1. Captura antecipada de beforeinstallprompt (Android WebAPK / Chromium)
  window.addEventListener('beforeinstallprompt', (e) => {
    // Previne a mini-infobar automática nativa do Chrome para dar controle à UI corporativa
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    updateSnapshot();
  });

  // 2. Escuta conclusão da instalação
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    customInstalledFlag = true;
    updateSnapshot();
  });

  // 3. Escuta alterações em display-mode
  try {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    if (mq?.addEventListener) {
      mq.addEventListener('change', () => updateSnapshot());
    } else if (mq && 'addListener' in mq) {
      (mq as unknown as { addListener: (fn: () => void) => void }).addListener(() => updateSnapshot());
    }
  } catch {
    // Ignora silenciosamente em navegadores antigos ou ambientes de teste
  }

  // 4. Registro seguro do Service Worker (apenas prod ou localhost/https)
  if (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    (import.meta.env?.PROD ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1')
  ) {
    const registerSw = () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((registration) => {
          // Monitora atualizações em segundo plano
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (installing) {
              installing.addEventListener('statechange', () => {
                if (
                  installing.state === 'installed' &&
                  navigator.serviceWorker.controller
                ) {
                  // Nova versão estática disponível silenciosamente
                }
              });
            }
          });
        })
        .catch((err) => {
          console.warn('[PWA] Falha silenciosa no registro do Service Worker:', err);
        });
    };

    if (document.readyState === 'complete') {
      registerSw();
    } else {
      window.addEventListener('load', registerSw, { once: true });
    }
  }

  updateSnapshot();
}

export async function triggerPwaInstall(): Promise<PwaInstallOutcome> {
  if (deferredPrompt) {
    try {
      await deferredPrompt.prompt();
      // Timeout protetivo de 3s para evitar travamento caso o diálogo nativo fique pendente em automações/headless
      const choice = await Promise.race([
        deferredPrompt.userChoice,
        new Promise<{ outcome: 'dismissed'; platform: string }>((resolve) =>
          setTimeout(() => resolve({ outcome: 'dismissed', platform: 'timeout' }), 3000)
        )
      ]);
      if (choice.outcome === 'accepted') {
        deferredPrompt = null;
        customInstalledFlag = true;
        updateSnapshot();
        return 'accepted';
      }
      return 'dismissed';
    } catch (err) {
      console.warn('[PWA] Erro ao invocar prompt nativo de instalação:', err);
      return 'manual-instructions';
    }
  }
  return 'manual-instructions';
}

export function dismissInstallBanner(): void {
  try {
    localStorage.setItem(BANNER_STORAGE_KEY, 'true');
  } catch {
    // Ignora erro de cota ou storage bloqueado
  }
  updateSnapshot();
}

export function resetInstallBanner(): void {
  try {
    localStorage.removeItem(BANNER_STORAGE_KEY);
  } catch {
    // Ignora erro
  }
  updateSnapshot();
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function subscribePwa(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function getPwaSnapshot(): PwaState {
  return currentSnapshot;
}

const SERVER_SNAPSHOT: PwaState = {
  isInstalled: false,
  isStandalone: false,
  isIos: false,
  isMobile: false,
  canPromptDirectly: false,
  canShowInstallOption: false,
  bannerDismissed: false
};

export function getServerPwaSnapshot(): PwaState {
  return SERVER_SNAPSHOT;
}

export function usePwaInstall(): PwaState & {
  triggerInstall: () => Promise<PwaInstallOutcome>;
  dismissBanner: () => void;
  resetBanner: () => void;
} {
  const state = useSyncExternalStore(subscribePwa, getPwaSnapshot, getServerPwaSnapshot);

  return {
    ...state,
    triggerInstall: triggerPwaInstall,
    dismissBanner: dismissInstallBanner,
    resetBanner: resetInstallBanner
  };
}
