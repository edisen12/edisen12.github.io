// ==============================================================================
// Suíte de Testes Unitários e de Segurança PWA
// Alvos: src/utils/pwa.ts, public/manifest.webmanifest e public/sw.js
// GARANTIA: 100% offline, validação de binários PNG reais e bypass estrito de APIs
// ==============================================================================

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'manifest.webmanifest');
const SW_PATH = path.join(PUBLIC_DIR, 'sw.js');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // Chunk IHDR inicia no byte 12 ("IHDR"), largura em [16..19] e altura em [20..23] Big-Endian
  const chunkType = buf.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') {
    throw new Error(`Chunk PNG inicial inesperado: ${chunkType}`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

describe('1. Ciclo de Vida PWA e Hook Reativo (src/utils/pwa.ts)', () => {
  const originalUserAgent = navigator.userAgent;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });

    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36'
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: originalUserAgent
    });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia
    });
    vi.restoreAllMocks();
  });

  it('inicializa estado mobile, captura beforeinstallprompt e executa triggerPwaInstall ("accepted")', async () => {
    const pwa = await import('../pwa');
    pwa.initPwa();

    const { result } = renderHook(() => pwa.usePwaInstall());

    expect(result.current.isInstalled).toBe(false);
    expect(result.current.isStandalone).toBe(false);
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isIos).toBe(false);
    expect(result.current.canPromptDirectly).toBe(false);
    expect(result.current.canShowInstallOption).toBe(true);

    // Sem prompt diferido, triggerPwaInstall orienta instruções manuais
    await act(async () => {
      const outcomeNoPrompt = await pwa.triggerPwaInstall();
      expect(outcomeNoPrompt).toBe('manual-instructions');
    });

    // Dispara beforeinstallprompt sintético
    const promptSpy = vi.fn().mockResolvedValue(undefined);
    const fakePromptEvent = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      platforms: ['web'],
      prompt: promptSpy,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
    });

    act(() => {
      window.dispatchEvent(fakePromptEvent);
    });

    expect(fakePromptEvent.defaultPrevented).toBe(true);
    expect(pwa.getDeferredPrompt()).toBe(fakePromptEvent);
    expect(result.current.canPromptDirectly).toBe(true);

    let outcome: string = '';
    await act(async () => {
      outcome = await result.current.triggerInstall();
    });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('accepted');
    expect(pwa.getDeferredPrompt()).toBeNull();
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canShowInstallOption).toBe(false);
  });

  it('trata recusa do usuário ("dismissed") e erro em prompt() ("manual-instructions")', async () => {
    const pwa = await import('../pwa');
    pwa.initPwa();

    const dismissedEvent = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      platforms: ['web'],
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })
    });

    window.dispatchEvent(dismissedEvent);
    expect(await pwa.triggerPwaInstall()).toBe('dismissed');
    expect(pwa.getPwaSnapshot().isInstalled).toBe(false);

    // Simula exceção no prompt nativo
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const brokenEvent = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      platforms: ['web'],
      prompt: vi.fn().mockRejectedValue(new Error('DOMException: user gesture required')),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })
    });

    window.dispatchEvent(brokenEvent);
    expect(await pwa.triggerPwaInstall()).toBe('manual-instructions');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('persiste e reseta estado do banner via dismissInstallBanner e resetInstallBanner', async () => {
    const pwa = await import('../pwa');
    pwa.initPwa();

    const { result } = renderHook(() => pwa.usePwaInstall());
    expect(result.current.bannerDismissed).toBe(false);

    act(() => {
      pwa.dismissInstallBanner();
    });
    expect(localStorage.getItem('hhoff_pwa_banner_dismissed')).toBe('true');
    expect(result.current.bannerDismissed).toBe(true);

    act(() => {
      pwa.resetInstallBanner();
    });
    expect(localStorage.getItem('hhoff_pwa_banner_dismissed')).toBeNull();
    expect(result.current.bannerDismissed).toBe(false);
  });

  it('marca aplicativo como instalado ao receber evento global appinstalled e detecta iOS / standalone', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'
    });

    const pwa = await import('../pwa');
    pwa.initPwa();

    expect(pwa.getPwaSnapshot().isIos).toBe(true);
    expect(pwa.getPwaSnapshot().isMobile).toBe(true);
    expect(pwa.getServerPwaSnapshot().isInstalled).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(pwa.getPwaSnapshot().isInstalled).toBe(true);
    expect(pwa.getPwaSnapshot().canShowInstallOption).toBe(false);
  });
});

describe('2. Integridade do Manifesto e Binários PNG (public/manifest.webmanifest & public/icons/)', () => {
  it('manifest.webmanifest é um JSON válido com display standalone, start_url "./" e escopo relativo', () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true);
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(raw);

    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.lang).toBe('pt-BR');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  it('ícones 192x192 e 512x512 declarados existem fisicamente em public/icons/ com assinatura PNG válida', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const sizesFound = new Set<string>();

    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      const relativeSrc = String(icon.src).replace(/^\.\//, '');
      const absIconPath = path.join(PUBLIC_DIR, relativeSrc);

      expect(fs.existsSync(absIconPath), `Ícone ausente: ${absIconPath}`).toBe(true);

      const bytes = fs.readFileSync(absIconPath);
      expect(bytes.length).toBeGreaterThan(100);

      // Valida magic bytes PNG (89 50 4E 47 0D 0A 1A 0A)
      const header = bytes.subarray(0, 8);
      expect(header.equals(PNG_SIGNATURE), `Assinatura PNG inválida em ${relativeSrc}`).toBe(true);

      // Valida dimensões reais no header IHDR
      const dims = readPngDimensions(bytes);
      expect(`${dims.width}x${dims.height}`).toBe(icon.sizes);
      sizesFound.add(icon.sizes);
    }

    expect(sizesFound.has('192x192')).toBe(true);
    expect(sizesFound.has('512x512')).toBe(true);
  });
});

describe('3. Segurança e Bypass Estrito do Service Worker (public/sw.js)', () => {
  function createSwSandbox(origin = 'https://edisen12.github.io') {
    const swCode = fs.readFileSync(SW_PATH, 'utf-8');
    const listeners: Record<string, Array<(event: any) => void>> = {};
    const cacheStore = new Map<string, Map<string, any>>();

    const mockCaches = {
      open: vi.fn(async (name: string) => {
        if (!cacheStore.has(name)) cacheStore.set(name, new Map());
        const bucket = cacheStore.get(name)!;
        return {
          addAll: vi.fn(async (urls: string[]) => {
            urls.forEach(u => bucket.set(u, { status: 200 }));
          }),
          put: vi.fn(async (req: any, res: any) => {
            const key = typeof req === 'string' ? req : req.url;
            bucket.set(key, res);
          })
        };
      }),
      match: vi.fn(async (req: any) => {
        const key = typeof req === 'string' ? req : req.url;
        for (const bucket of cacheStore.values()) {
          if (bucket.has(key)) return bucket.get(key);
        }
        return undefined;
      }),
      keys: vi.fn(async () => Array.from(cacheStore.keys())),
      delete: vi.fn(async (key: string) => cacheStore.delete(key))
    };

    interface MockFetchResponse {
      status: number;
      url: string;
      clone: () => MockFetchResponse;
    }

    const mockFetch = vi.fn(async (req: unknown): Promise<MockFetchResponse> => {
      const urlStr = typeof req === 'string' ? req : (req as { url?: string })?.url || '';
      const createResponse = (): MockFetchResponse => ({
        status: 200,
        url: urlStr,
        clone: () => createResponse()
      });
      return createResponse();
    });

    const selfObj = {
      location: new URL(origin),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
      addEventListener: (type: string, handler: (event: any) => void) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(handler);
      }
    };

    const context = vm.createContext({
      self: selfObj,
      caches: mockCaches,
      fetch: mockFetch,
      URL,
      Response: { error: () => ({ status: 500, error: true }) },
      Promise,
      console
    });

    vm.runInContext(swCode, context);

    return {
      listeners,
      cacheStore,
      mockCaches,
      mockFetch,
      dispatchFetch(input: {
        url: string;
        method?: string;
        mode?: string;
        headers?: Record<string, string>;
      }) {
        const headerMap = new Map<string, string>();
        for (const [k, v] of Object.entries(input.headers || {})) {
          headerMap.set(k.toLowerCase(), v);
        }
        const respondWith = vi.fn();
        const event = {
          request: {
            url: input.url,
            method: input.method || 'GET',
            mode: input.mode || 'cors',
            headers: {
              get: (name: string) => headerMap.get(name.toLowerCase()) || null,
              has: (name: string) => headerMap.has(name.toLowerCase())
            }
          },
          respondWith
        };
        for (const fn of listeners['fetch'] || []) {
          fn(event);
        }
        return { respondWith, event };
      }
    };
  }

  it('JAMAIS intercepta ou faz cache de rotas sensíveis (/api/, /auth/, /rest/, /functions/, /realtime/) nem de *.supabase.co', () => {
    const sw = createSwSandbox('https://edisen12.github.io');

    const forbiddenRequests: Array<{
      url: string;
      method?: string;
      mode?: string;
      headers?: Record<string, string>;
    }> = [
      // Supabase Cloud (qualquer projeto *.supabase.co)
      { url: 'https://fwdvrkfootvublicetim.supabase.co/rest/v1/apontamentos_hh?select=*' },
      { url: 'https://fwdvrkfootvublicetim.supabase.co/auth/v1/token?grant_type=password' },
      { url: 'https://fwdvrkfootvublicetim.supabase.co/functions/v1/admin-users' },
      { url: 'https://qualquer-instancia.supabase.co/realtime/v1/websocket' },
      // Rotas sensíveis same-origin (topologia Self-Hosted ou reverse-proxy)
      { url: 'https://edisen12.github.io/api/v1/dataset?ini=2026-10-01&fim=2026-10-31' },
      { url: 'https://edisen12.github.io/subpath/api/v1/auth/session' },
      { url: 'https://edisen12.github.io/auth/v1/user' },
      { url: 'https://edisen12.github.io/rest/v1/pessoas' },
      { url: 'https://edisen12.github.io/functions/v1/admin-users' },
      { url: 'https://edisen12.github.io/realtime/events' },
      // Métodos mutativos (POST / PUT / DELETE)
      { url: 'https://edisen12.github.io/index.html', method: 'POST' },
      // Cabeçalhos autenticados (Bearer JWT) ou SSE (text/event-stream)
      {
        url: 'https://edisen12.github.io/algum-recurso.js',
        headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.mock' }
      },
      {
        url: 'https://edisen12.github.io/stream',
        headers: { Accept: 'text/event-stream' }
      }
    ];

    for (const req of forbiddenRequests) {
      const { respondWith } = sw.dispatchFetch(req);
      expect(
        respondWith,
        `Service Worker NÃO deveria interceptar URL sensível: ${req.url}`
      ).not.toHaveBeenCalled();
    }

    // Confirma que nenhum dado entrou no cacheStore
    expect(sw.cacheStore.size).toBe(0);
  });

  it('intercepta legitimamente assets estáticos com hash (/assets/*.js) e navegação HTML sem vazar APIs', async () => {
    const sw = createSwSandbox('https://edisen12.github.io');

    // Asset estático com hash -> Cache-First
    const assetDispatch = sw.dispatchFetch({
      url: 'https://edisen12.github.io/assets/index-B7x9K2.js',
      method: 'GET'
    });
    expect(assetDispatch.respondWith).toHaveBeenCalledTimes(1);
    const assetResp = await assetDispatch.respondWith.mock.calls[0][0];
    expect(assetResp.status).toBe(200);

    // Navegação de documento -> Network-First
    const navDispatch = sw.dispatchFetch({
      url: 'https://edisen12.github.io/',
      method: 'GET',
      mode: 'navigate'
    });
    expect(navDispatch.respondWith).toHaveBeenCalledTimes(1);
    const navResp = await navDispatch.respondWith.mock.calls[0][0];
    expect(navResp.status).toBe(200);

    // Ciclo activate remove caches obsoletos mantendo apenas CACHE_NAME atual
    sw.cacheStore.set('hhoff-static-v1-legado', new Map());
    const waitPromises: Promise<any>[] = [];
    for (const fn of sw.listeners['activate'] || []) {
      fn({ waitUntil: (p: Promise<any>) => waitPromises.push(p) });
    }
    await Promise.all(waitPromises);
    expect(sw.cacheStore.has('hhoff-static-v1-legado')).toBe(false);
  });
});
