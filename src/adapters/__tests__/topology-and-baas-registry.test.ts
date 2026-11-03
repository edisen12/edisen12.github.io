// ==============================================================================
// Testes de Guardas de Topologia e Registry Aberto de BaaS
// Valida travas de segurança arquitetural, conexão dinâmica e fachadas cliente
// ==============================================================================

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  assertValidTopologyConfig,
  buildConnectSrcDirective,
  auditSelfHostedBundleAssets,
  PURE_DATABASE_ENGINES,
  FORBIDDEN_CLIENT_SECRET_PATTERNS
} from '../../config/topology-guard';
import {
  registerBaaSConnector,
  listRegisteredBaaSConnectors,
  resolveBaaSClientProvider
} from '../baas/registry';
import {
  setClientDatabaseProvider,
  resetClientDatabaseProvider,
  getClientDatabaseProvider
} from '../../services/provider.registry';
import { signInWithPassword, updateOwnPassword } from '../../services/auth.service';
import { batchImportHH, loadAppDataset } from '../../services/data.service';
import { subscribeToRealtimeUpdates } from '../../services/realtime.service';
import type { BaaSConnectorPort, RawBaaSDatasetPayload } from '../../ports/baas-connector.port';
import type {
  AdminManageUserResult,
  AuthSessionResult,
  AuthenticatedUserScope
} from '../../ports/auth.port';
import type { Plataforma } from '../../domain/types';

// ==============================================================================
// CONECTOR MOCK PARA TESTAR O REGISTRY ABERTO
// ==============================================================================

class MockCustomBaaSConnector implements BaaSConnectorPort {
  readonly providerId = 'mock-custom-baas';

  public signedInEmails: string[] = [];
  public updatedPasswords: string[] = [];
  public upsertedPlataformas: Array<Record<string, unknown>> = [];
  public upsertedTecnicos: Array<{ matricula: string; nome: string; funcao: string }> = [];
  public upsertedApontamentos: Array<Record<string, unknown>> = [];
  public fluxoRecords: Array<{
    tipo_fluxo: 'hh' | 'carteira';
    origem: string;
    total_linhas: number;
    data_maxima: string | null;
    observacao: string;
  }> = [];
  public realtimeListener: (() => void) | null = null;

  async signIn(cleanEmail: string, password: string): Promise<AuthSessionResult> {
    this.signedInEmails.push(cleanEmail);
    return {
      user: { id: 'usr-custom-1', email: cleanEmail },
      session: { access_token: 'custom-jwt-mock', expires_at: 3600 }
    };
  }

  async signOut(): Promise<void> {}

  async changePasswordAndConfirmFirstLogin(newPassword: string): Promise<void> {
    this.updatedPasswords.push(newPassword);
  }

  async updateOwnProfile(): Promise<void> {}

  async fetchCurrentUserScope(): Promise<AuthenticatedUserScope | null> {
    return null;
  }

  async invokeAdminUsers(): Promise<AdminManageUserResult> {
    return { ok: true, userId: 'adm-custom-1', message: 'Sucesso' };
  }

  async fetchRawDataset(
    _queryIni: string,
    _queryFim: string,
    _isGlobal: boolean
  ): Promise<RawBaaSDatasetPayload> {
    return {
      configRow: null,
      usoffWeightRows: [],
      plataformaRows: [],
      pessoaRows: [],
      tecnicoRows: [],
      carteiraRows: [],
      hhRows: [],
      justificativaRows: [],
      watermarkRow: null,
      profileRows: [],
      onboardingRows: [],
      emailsResumo: [],
      latestFluxoRow: null,
      externalCoveredRows: []
    };
  }

  async upsertJustificativa(): Promise<void> {}
  async saveConfiguracoesBundle(): Promise<void> {}
  async deletePlataforma(): Promise<void> {}
  async savePessoaWithScopes(): Promise<any> {
    return {} as any;
  }
  async deletePessoa(): Promise<void> {}
  async upsertCarteiraChunk(): Promise<void> {}
  async fetchRawAuditLogs(): Promise<any[]> {
    return [];
  }
  async insertAuditLog(): Promise<void> {}

  async upsertPlataformasChunk(rows: Array<Record<string, unknown>>): Promise<void> {
    this.upsertedPlataformas.push(...rows);
  }

  async upsertTecnicosChunk(
    rows: Array<{ matricula: string; nome: string; funcao: string }>
  ): Promise<void> {
    this.upsertedTecnicos.push(...rows);
  }

  async upsertApontamentosChunk(rows: Array<Record<string, unknown>>): Promise<void> {
    this.upsertedApontamentos.push(...rows);
  }

  async insertFluxoImportacao(row: {
    tipo_fluxo: 'hh' | 'carteira';
    origem: string;
    total_linhas: number;
    data_maxima: string | null;
    observacao: string;
  }): Promise<void> {
    this.fluxoRecords.push(row);
  }

  subscribeRawChanges(trigger: () => void): () => void {
    this.realtimeListener = trigger;
    return () => {
      this.realtimeListener = null;
    };
  }
}

describe('1. Guardas de Topologia e Segurança Arquitetural (topology-guard.ts)', () => {
  describe('assertValidTopologyConfig', () => {
    it('aprova topologia "baas" com provedor "supabase" e variáveis limpas', () => {
      expect(() =>
        assertValidTopologyConfig({
          topology: 'baas',
          baasProvider: 'supabase',
          envKeys: ['VITE_TOPOLOGY', 'VITE_BAAS_PROVIDER', 'VITE_SUPABASE_URL']
        })
      ).not.toThrow();
    });

    it('aprova topologia "baas" com provedores customizados (pocketbase, appwrite, firebase)', () => {
      for (const provider of ['pocketbase', 'appwrite', 'firebase', 'convex', 'amplify']) {
        expect(() =>
          assertValidTopologyConfig({
            topology: 'baas',
            baasProvider: provider,
            envKeys: ['VITE_TOPOLOGY', 'VITE_BAAS_PROVIDER']
          })
        ).not.toThrow();
      }
    });

    it('aprova topologia "self-hosted" em ambiente Node/VPS com variáveis limpas', () => {
      expect(() =>
        assertValidTopologyConfig({
          topology: 'self-hosted',
          envKeys: ['VITE_TOPOLOGY', 'VITE_API_BASE_URL'],
          isGitHubPagesWorkflow: false
        })
      ).not.toThrow();
    });

    it('rejeita topologia desconhecida ou inválida (ex: "hybrid", "serverless")', () => {
      expect(() =>
        assertValidTopologyConfig({
          topology: 'hybrid',
          envKeys: []
        })
      ).toThrow('[TOPOLOGY ERROR]');

      expect(() =>
        assertValidTopologyConfig({
          topology: '',
          envKeys: []
        })
      ).toThrow('Topologia inválida');
    });

    it('rejeita qualquer variável com prefixo VITE_ contendo padrões proibidos de segredos', () => {
      for (const pattern of FORBIDDEN_CLIENT_SECRET_PATTERNS) {
        expect(() =>
          assertValidTopologyConfig({
            topology: 'baas',
            envKeys: [`VITE_${pattern}`]
          })
        ).toThrow('[SECURITY AUDIT FAILED]');
      }

      // Variações realistas com sufixos/prefixos
      expect(() =>
        assertValidTopologyConfig({
          topology: 'baas',
          envKeys: ['VITE_DATABASE_URL_PROD']
        })
      ).toThrow('[SECURITY AUDIT FAILED]');

      expect(() =>
        assertValidTopologyConfig({
          topology: 'baas',
          envKeys: ['VITE_SUPABASE_SERVICE_ROLE_KEY']
        })
      ).toThrow('[SECURITY AUDIT FAILED]');
    });

    it('rejeita todos os motores de banco puro quando topology === "baas", exigindo self-hosted', () => {
      for (const engine of PURE_DATABASE_ENGINES) {
        expect(() =>
          assertValidTopologyConfig({
            topology: 'baas',
            baasProvider: engine,
            envKeys: ['VITE_TOPOLOGY']
          })
        ).toThrow('[ARCHITECTURE GUARD FAILED]');
      }
    });

    it('rejeita topologia "self-hosted" quando o build ocorre no workflow do GitHub Pages', () => {
      expect(() =>
        assertValidTopologyConfig({
          topology: 'self-hosted',
          envKeys: ['VITE_TOPOLOGY'],
          isGitHubPagesWorkflow: true
        })
      ).toThrow('[BUILD GUARD FAILED]');
    });
  });

  describe('buildConnectSrcDirective', () => {
    it('retorna diretiva restrita same-origin em self-hosted', () => {
      const directive = buildConnectSrcDirective({ topology: 'self-hosted' });
      expect(directive).toBe("connect-src 'self' data: blob:;");
    });

    it('retorna os domínios Supabase quando topology === "baas" e baasProvider === "supabase"', () => {
      const directive = buildConnectSrcDirective({
        topology: 'baas',
        baasProvider: 'supabase'
      });
      expect(directive).toContain("connect-src 'self'");
      expect(directive).toContain('supabase.co');
      expect(directive).toContain('fwdvrkfootvublicetim.supabase.co');
    });

    it('retorna origens customizadas quando customConnectOrigins for fornecido', () => {
      const directive = buildConnectSrcDirective({
        topology: 'baas',
        baasProvider: 'custom-api',
        customConnectOrigins: 'https://api.meubanco.com.br wss://api.meubanco.com.br'
      });
      expect(directive).toBe(
        "connect-src 'self' https://api.meubanco.com.br wss://api.meubanco.com.br;"
      );
    });

    it('retorna connect-src \'self\'; para provedor baas sem customConnectOrigins', () => {
      const directive = buildConnectSrcDirective({
        topology: 'baas',
        baasProvider: 'pocketbase'
      });
      expect(directive).toBe("connect-src 'self';");
    });
  });

  describe('auditSelfHostedBundleAssets', () => {
    it('aprova arquivos limpos de bundle em self-hosted', () => {
      const cleanAssets = [
        { fileName: 'index-DQ9vblRv.js', content: 'console.log("App iniciada");' },
        { fileName: 'ui-vendor-iAbamEED.js', content: 'var React = {};' },
        { fileName: 'xlsx-vendor-CbTSpprj.js', content: 'var XLSX = {};' },
        { fileName: 'index-BL60PsjY.css' }
      ];

      expect(() => auditSelfHostedBundleAssets(cleanAssets)).not.toThrow();
    });

    it('detecta e bloqueia nome de arquivo contendo "supabase" em self-hosted', () => {
      const leakyAssets = [
        { fileName: 'supabase-vendor-s3XNS0mn.js', content: 'var s = 1;' }
      ];

      expect(() => auditSelfHostedBundleAssets(leakyAssets)).toThrow('[BUNDLE LEAK DETECTED]');
    });

    it('detecta e bloqueia conteúdo JS contendo URLs ou ref do Supabase em self-hosted', () => {
      const leakUrl = [
        { fileName: 'main-app.js', content: 'const url = "https://app.supabase.co";' }
      ];
      expect(() => auditSelfHostedBundleAssets(leakUrl)).toThrow('[BUNDLE LEAK DETECTED]');

      const leakRef = [
        { fileName: 'main-app.js', content: 'const projectRef = "fwdvrkfootvublicetim";' }
      ];
      expect(() => auditSelfHostedBundleAssets(leakRef)).toThrow('[BUNDLE LEAK DETECTED]');
    });
  });
});

describe('2. Registry Aberto de BaaS e Injeção Dinâmica de Provedor', () => {
  let mockConnector: MockCustomBaaSConnector;

  beforeEach(() => {
    mockConnector = new MockCustomBaaSConnector();
    registerBaaSConnector('mock-custom-baas', () => mockConnector);
  });

  afterEach(() => {
    resetClientDatabaseProvider();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('lista provedores registrados e resolve o provedor customizado via registry', () => {
    const list = listRegisteredBaaSConnectors();
    expect(list).toContain('supabase');
    expect(list).toContain('mock-custom-baas');

    const provider = resolveBaaSClientProvider('mock-custom-baas');
    expect(provider).toBeDefined();
    expect(provider.topology).toBe('baas');
    expect(provider.providerId).toBe('mock-custom-baas');
  });

  it('lança erro instrutivo ao tentar resolver um provedor BaaS não registrado', () => {
    expect(() => resolveBaaSClientProvider('nao-existe')).toThrow(
      '[BaaS Registry] Provedor BaaS "nao-existe" não foi registrado'
    );
  });

  it('integra fachadas cliente (auth.service) com conector customizado: normaliza email e valida senha', async () => {
    const provider = resolveBaaSClientProvider('mock-custom-baas');
    setClientDatabaseProvider(provider);

    // 1. signInWithPassword normaliza email
    const authRes = await signInWithPassword('  UsuArio.Teste@CustomBaaS.com.br  ', 'senha123');
    expect(authRes.user?.email).toBe('usuario.teste@custombaas.com.br');
    expect(mockConnector.signedInEmails).toContain('usuario.teste@custombaas.com.br');

    // 2. updateOwnPassword valida política corporativa no pipeline antes de chamar o BaaS
    await expect(updateOwnPassword('curta')).rejects.toThrow(
      'A nova senha deve ter no mínimo 8 caracteres.'
    );

    await expect(updateOwnPassword('somenteletraslongas')).rejects.toThrow(
      'A nova senha deve combinar letras e números para sua segurança.'
    );

    await updateOwnPassword('NovaSenhaForte2026');
    expect(mockConnector.updatedPasswords).toContain('NovaSenhaForte2026');
  });

  it('integra fachadas cliente (data.service): batchImportHH prepara chunks, plataformas inéditas e fluxo', async () => {
    const provider = resolveBaaSClientProvider('mock-custom-baas');
    setClientDatabaseProvider(provider);

    const pidx: Record<string, Plataforma> = {};
    const rows = [
      {
        mat: '2002',
        nome: 'Técnico B',
        funcao: 'Mecânico',
        p: 'PLAT_INEDITA_CUSTOM',
        r: 'UN-TESTE',
        D: '2026-10-02',
        e: 10
      },
      {
        mat: '1001',
        nome: 'Técnico A',
        funcao: 'Eletricista',
        p: 'PLAT_INEDITA_CUSTOM',
        r: 'UN-TESTE',
        D: '2026-10-01',
        e: 11
      }
    ];

    let progressoRegistrado = 0;
    await batchImportHH(rows, pidx, (gravadas) => {
      progressoRegistrado = gravadas;
    });

    // Auto-cadastro de plataforma inédita com cadastro_pendente: true
    expect(mockConnector.upsertedPlataformas).toHaveLength(1);
    expect(mockConnector.upsertedPlataformas[0].sigla).toBe('PLAT_INEDITA_CUSTOM');
    expect(mockConnector.upsertedPlataformas[0].cadastro_pendente).toBe(true);

    // Técnicos únicos ordenados por matrícula
    expect(mockConnector.upsertedTecnicos).toHaveLength(2);
    expect(mockConnector.upsertedTecnicos[0].matricula).toBe('1001');
    expect(mockConnector.upsertedTecnicos[1].matricula).toBe('2002');

    // Apontamentos ordenados por (matricula, data) anti-deadlock
    expect(mockConnector.upsertedApontamentos).toHaveLength(2);
    expect(mockConnector.upsertedApontamentos[0].matricula).toBe('1001');
    expect(mockConnector.upsertedApontamentos[1].matricula).toBe('2002');

    // Progresso e fluxo de importação
    expect(progressoRegistrado).toBe(2);
    expect(mockConnector.fluxoRecords).toHaveLength(1);
    expect(mockConnector.fluxoRecords[0].tipo_fluxo).toBe('hh');
    expect(mockConnector.fluxoRecords[0].total_linhas).toBe(2);
    expect(mockConnector.fluxoRecords[0].data_maxima).toBe('2026-10-02');
  });

  it('integra fachadas cliente (data.service): loadAppDataset monta overlay demo quando BaaS está vazio', async () => {
    const provider = resolveBaaSClientProvider('mock-custom-baas');
    setClientDatabaseProvider(provider);

    const dataset = await loadAppDataset('2026-10-01', '2026-10-31', true);
    expect(dataset).toBeDefined();
    expect(dataset.isDemo).toBe(true);
    expect(dataset.demoReason).toContain('dados simulados de demonstração');
    expect(dataset.carteira.length).toBeGreaterThan(0);
  });

  it('integra fachadas cliente (realtime.service): subscribeToRealtimeUpdates consolida disparos com debounce 450ms', () => {
    vi.useFakeTimers();

    const provider = resolveBaaSClientProvider('mock-custom-baas');
    setClientDatabaseProvider(provider);

    const onChangeSpy = vi.fn();
    const unsubscribe = subscribeToRealtimeUpdates(onChangeSpy);

    expect(mockConnector.realtimeListener).toBeDefined();

    // Simula 3 disparos em rajada de eventos do BaaS
    mockConnector.realtimeListener!();
    mockConnector.realtimeListener!();
    mockConnector.realtimeListener!();

    // Antes de 450ms: nenhum callback executado
    vi.advanceTimersByTime(400);
    expect(onChangeSpy).not.toHaveBeenCalled();

    // Ao atingir 450ms: callback consolidado executado exatamente 1 vez
    vi.advanceTimersByTime(50);
    expect(onChangeSpy).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(mockConnector.realtimeListener).toBeNull();
  });
});
