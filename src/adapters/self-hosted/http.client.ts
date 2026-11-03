// ==============================================================================
// Cliente HTTP para Topologia Self-Hosted
// Comunicação Same-Origin, Cookies HttpOnly para Sessão e Tokens CSRF em Memória
// Zero credenciais salvas em localStorage/sessionStorage
// ==============================================================================

import { API_BASE_URL } from '../../config/env';

export interface HttpClientOptions {
  baseUrl?: string;
  customFetch?: typeof fetch;
}

export class SelfHostedHttpClient {
  public readonly baseUrl: string;
  private readonly customFetch?: typeof fetch;
  private csrfToken: string | null = null;

  constructor(options?: HttpClientOptions) {
    this.baseUrl = (options?.baseUrl || API_BASE_URL).replace(/\/+$/, '');
    this.customFetch = options?.customFetch;
  }

  public getCsrfToken(): string | null {
    return this.csrfToken;
  }

  public setCsrfToken(token: string | null): void {
    this.csrfToken = token;
  }

  public clearCsrfToken(): void {
    this.csrfToken = null;
  }

  private extractCsrf(res: Response, jsonBody?: any): void {
    const headerToken = res.headers.get('x-csrf-token') || res.headers.get('X-CSRF-Token');
    if (headerToken) {
      this.csrfToken = headerToken;
      return;
    }
    if (jsonBody && typeof jsonBody === 'object' && jsonBody.csrfToken) {
      this.csrfToken = String(jsonBody.csrfToken);
    }
  }

  public async request<T = any>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const method = (init.method || 'GET').toUpperCase();

    const headers = new Headers(init.headers);

    // Envia o CSRF Token em mutações de estado quando disponível
    if (this.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      headers.set('X-CSRF-Token', this.csrfToken);
    }

    if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    const fetchFn = this.customFetch || fetch;
    const response = await fetchFn(url, {
      ...init,
      headers,
      credentials: 'same-origin'
    });

    let jsonBody: any = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        jsonBody = await response.json();
      } catch {
        jsonBody = null;
      }
    } else {
      const text = await response.text();
      try {
        jsonBody = JSON.parse(text);
      } catch {
        jsonBody = { message: text };
      }
    }

    this.extractCsrf(response, jsonBody);

    if (!response.ok) {
      const errorMessage =
        jsonBody?.message ||
        `Erro na requisição HTTP: ${response.status} ${response.statusText}`;
      const err = new Error(errorMessage);
      (err as any).statusCode = response.status;
      (err as any).responseBody = jsonBody;
      throw err;
    }

    return jsonBody as T;
  }

  public get<T = any>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  public post<T = any>(path: string, body?: any, init?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  }

  public put<T = any>(path: string, body?: any, init?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  }

  public delete<T = any>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'DELETE' });
  }
}
