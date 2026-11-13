// ==============================================================================
// Motor de Domínio e Segurança Self-Hosted (Universal Storage Architecture)
// Implementa RBAC, Sessões Stateful, Gate de Primeiro Login, SLA e Auditoria WORM
// ==============================================================================

import type {
  ContractConfig,
  UsoffUnWeight,
  Plataforma,
  Pessoa,
  Tecnico,
  CarteiraEmbarque,
  CarteiraOperacao,
  ConfirmacaoSAP,
  ApontamentoHH,
  Justificativa,
  FluxoImportacao,
  UserProfile,
  UserOnboarding,
  SystemAuditLog,
  SystemRole,
  PapelOperacional,
  UserPreferences,
  WatermarkStatus
} from '../../../src/domain/types';

import type {
  UniversalStorageDriverPort,
  AuthCredentialRow,
  AuthSessionRow,
  ConfiguracoesNotificacaoRow,
  JustificativaAuditLogRow
} from '../ports/universal-storage.port';

import {
  generateRandomToken,
  generateUuid,
  hashPassword,
  safeCompareTokens,
  verifyPassword
} from './crypto';

import type { RealtimeSseHub } from './realtime-hub';

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  themeMode: 'light',
  density: 'comfortable',
  defaultTab: 'ger',
  pageSize: 50
};

export const DEFAULT_CONFIG: ContractConfig = {
  id: 'geral',
  hh_dia: 11,
  meta_percentual: 100,
  atencao_percentual: 90,
  dias_embarque: 14,
  dia_corte_medicao: 21,
  prazo_justificativa_dias: 2,
  med_criterio: 'enc',
  us_pe_padrao: null,
  us_ex_padrao: null,
  slogan: '',
  regionais_extras: []
};

export interface AuthenticatedActor {
  id: string;
  email: string;
  nome: string;
  role: SystemRole;
  ativo: boolean;
  sessionId: string;
  csrfToken: string;
}

const SERVER_PLATFORM_ALIASES: Record<string, string> = {
  PMXL1: 'MXL',
  PMXL: 'MXL',
  PMLZ1: 'MLZ',
  PMLZ: 'MLZ',
  PMNT1: 'PMNT',
  PAG01: 'PAG1',
  'PAG-01': 'PAG1',
  PAG02: 'PAG2',
  'PAG-02': 'PAG2',
  PAG03: 'PAG3',
  'PAG-03': 'PAG3',
  PCR01: 'PCR1',
  'PCR-01': 'PCR1',
  PCM09: 'PCM9',
  'PCM-09': 'PCM9',
  'PCM-9': 'PCM9',
  'PPE-01A': 'PPE1A',
  'PPE-1A': 'PPE1A',
  'PRA-01': 'PRA1',
  'PRA-1': 'PRA1',
  'MOP-01': 'MOP1',
  'MOP-1': 'MOP1'
};

function sanitizeServerPlatformCode(raw?: unknown): string {
  if (raw == null || raw === '') return '';
  const trimmed = String(raw).trim().toUpperCase();
  if (SERVER_PLATFORM_ALIASES[trimmed]) {
    return SERVER_PLATFORM_ALIASES[trimmed];
  }
  const withoutHyphenSpace = trimmed.replace(/[-\s]/g, '');
  if (SERVER_PLATFORM_ALIASES[withoutHyphenSpace]) {
    return SERVER_PLATFORM_ALIASES[withoutHyphenSpace];
  }
  const m = withoutHyphenSpace.match(/^([A-Z]{2,})0+(\d+)([A-Z]*)$/);
  if (m) {
    return m[1] + m[2] + m[3];
  }
  if (/^P-\d+$/i.test(trimmed)) {
    return trimmed.replace('-', '');
  }
  return trimmed;
}

function normalizeServerIdEmbarque(val: unknown): string {
  if (val == null || val === '') return '';
  const str = String(val).trim();
  if (str.includes('GMT') || str.includes('Brasília') || str.includes('UTC')) {
    const m = str.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d+)\s+(\d{4})/);
    if (m) {
      const monthMap: Record<string, number> = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
      };
      const mon = monthMap[m[1]];
      if (mon !== undefined) {
        const utc = Date.UTC(parseInt(m[3], 10), mon, parseInt(m[2], 10));
        const epoch = Date.UTC(1899, 11, 30);
        const serial = Math.round((utc - epoch) / 86400000);
        if (serial > 0 && serial < 200000) return String(serial);
      }
    }
  }
  if (/^\d+\.0+$/.test(str)) {
    return str.replace(/\.0+$/, '');
  }
  return str;
}

/** Normaliza códigos SAP numéricos removendo zeros à esquerda ('002032288155' -> '2032288155', '0010' -> '10'). */
function normalizeServerSapCode(val: unknown): string {
  const s = String(val ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) {
    return s.replace(/^0+(?=\d)/, '');
  }
  return s.toUpperCase();
}

function round2(n: number): number {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
}

function resolveServerDivergenciaStatus(hhConf: number, totalSap: number): string {
  const p = round2(hhConf);
  const s = round2(totalSap);
  if (Math.abs(p) < 0.01 && Math.abs(s) < 0.01) return 'Não Confirmado';
  if (p > 0 && Math.abs(s) < 0.01) return 'Não Apontado no SAP';
  if (Math.abs(p) < 0.01 && s > 0) return 'Não Confirmado no Portal';
  if (Math.abs(p) < 0.01 && s < 0) return 'Divergente (Portal > SAP)';
  if (Math.abs(p - s) < 0.01) return 'OK';
  return p > s ? 'Divergente (Portal > SAP)' : 'Divergente (SAP > Portal)';
}

function addIsoDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function isoDaysAbsDiff(isoA: string, isoB: string): number {
  const [y1, m1, d1] = isoA.split('-').map(Number);
  const [y2, m2, d2] = isoB.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.abs(Math.round((t1 - t2) / 86400000));
}

export interface RawDatasetResponse {
  configRow: ContractConfig | null;
  usoffWeightRows: UsoffUnWeight[];
  plataformaRows: Plataforma[];
  pessoaRows: Pessoa[];
  tecnicoRows: Tecnico[];
  carteiraRows: CarteiraEmbarque[];
  carteiraOperacaoRows: CarteiraOperacao[];
  confirmacaoSapRows: ConfirmacaoSAP[];
  hhRows: ApontamentoHH[];
  justificativaRows: Justificativa[];
  watermarkRow: WatermarkStatus;
  externalCoveredRows: Array<{ matricula: string; data: string }>;
  sharedOps: string[];
  profileRows?: UserProfile[];
  onboardingRows?: UserOnboarding[];
  emailsResumo?: string[];
  latestFluxoRow?: FluxoImportacao | null;
}

export class SelfHostedDomainEngine {
  constructor(
    private readonly storage: UniversalStorageDriverPort,
    private readonly realtimeHub?: RealtimeSseHub
  ) {}

  // ============================================================================
  // BOOTSTRAP INICIAL
  // ============================================================================

  async bootstrapInitialAdminIfNeeded(
    email?: string,
    password?: string,
    nome?: string
  ): Promise<void> {
    if (!email || !password) return;

    const existingProfiles = await this.storage.findMany<UserProfile>('profiles', { limit: 1 });
    if (existingProfiles.length > 0) return;

    const userId = generateUuid();
    const cleanEmail = email.trim().toLowerCase();
    const cleanNome = nome?.trim() || 'Administrador';
    const passwordHash = await hashPassword(password);
    const nowIso = new Date().toISOString();

    const cred: AuthCredentialRow = {
      user_id: userId,
      email: cleanEmail,
      password_hash: passwordHash,
      created_at: nowIso,
      updated_at: nowIso
    };

    const prof: UserProfile = {
      id: userId,
      email: cleanEmail,
      nome: cleanNome,
      role: 'admin',
      ativo: true
    };

    const onb: UserOnboarding = {
      user_id: userId,
      primeiro_login: false,
      obriga_troca_senha: false,
      senha_trocada_em: nowIso,
      preferencias: DEFAULT_USER_PREFERENCES
    };

    await this.storage.upsertMany('auth_credentials', [cred], ['user_id']);
    await this.storage.upsertMany('profiles', [prof], ['id']);
    await this.storage.upsertMany('user_onboarding', [onb], ['user_id']);

    // Trilha WORM imutável de auditoria
    await this.storage.appendImmutable('system_audit_logs', {
      id: generateUuid(),
      actor_id: userId,
      actor_nome: 'Sistema',
      actor_email: cleanEmail,
      actor_role: 'admin',
      action: 'system_bootstrap_admin',
      category: 'seguranca',
      target_id: userId,
      target_label: `${cleanNome} (${cleanEmail})`,
      details: { initialBootstrap: true },
      ip_address: '127.0.0.1',
      created_at: nowIso
    });
  }

  // ============================================================================
  // AUTENTICAÇÃO E SESSÕES STATEFUL
  // ============================================================================

  async login(
    email: string,
    password: string,
    _ipAddress?: string
  ): Promise<{
    sessionId: string;
    csrfToken: string;
    user: { id: string; email: string; nome: string; role: SystemRole };
  }> {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      throw new Error('E-mail e senha são obrigatórios.');
    }

    const cred = await this.storage.findOne<AuthCredentialRow>('auth_credentials', {
      email: cleanEmail
    });

    if (!cred) {
      throw new Error('E-mail ou senha incorretos.');
    }

    const isValid = await verifyPassword(password, cred.password_hash);
    if (!isValid) {
      throw new Error('E-mail ou senha incorretos.');
    }

    const profile = await this.storage.findOne<UserProfile>('profiles', {
      id: cred.user_id
    });

    if (!profile || !profile.ativo) {
      throw new Error('Seu acesso está inativo ou bloqueado pela administração.');
    }

    const sessionId = generateRandomToken(32);
    const csrfToken = generateRandomToken(32);
    const nowIso = new Date().toISOString();
    // 7 dias de validade
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const session: AuthSessionRow = {
      id: sessionId,
      user_id: profile.id,
      csrf_token: csrfToken,
      expires_at: expiresAt,
      created_at: nowIso
    };

    await this.storage.upsertMany('auth_sessions', [session], ['id']);

    return {
      sessionId,
      csrfToken,
      user: {
        id: profile.id,
        email: profile.email,
        nome: profile.nome,
        role: profile.role
      }
    };
  }

  async authenticateSession(
    sessionId: string,
    csrfToken?: string,
    requireCsrf = false
  ): Promise<AuthenticatedActor> {
    if (!sessionId) {
      throw new Error('Sessão não informada. Faça login novamente.');
    }

    const session = await this.storage.findOne<AuthSessionRow>('auth_sessions', {
      id: sessionId
    });

    if (!session) {
      throw new Error('Sessão inválida ou expirada. Faça login novamente.');
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await this.storage.deleteMany('auth_sessions', { id: sessionId });
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    if (requireCsrf) {
      if (!safeCompareTokens(session.csrf_token, csrfToken)) {
        throw new Error('Token CSRF inválido ou ausente.');
      }
    }

    const profile = await this.storage.findOne<UserProfile>('profiles', {
      id: session.user_id
    });

    if (!profile) {
      throw new Error('Perfil de usuário não encontrado.');
    }

    // Corte imediato 0ms: se inativo, invalida sessões imediatamente
    if (!profile.ativo) {
      await this.storage.deleteMany('auth_sessions', { user_id: profile.id });
      throw new Error('Seu acesso foi desativado pela administração.');
    }

    return {
      id: profile.id,
      email: profile.email,
      nome: profile.nome,
      role: profile.role,
      ativo: profile.ativo,
      sessionId,
      csrfToken: session.csrf_token
    };
  }

  async logout(sessionId: string): Promise<void> {
    if (sessionId) {
      await this.storage.deleteMany('auth_sessions', { id: sessionId });
    }
  }

  // ============================================================================
  // ESCOPO DO USUÁRIO LOGADO E PERFIL
  // ============================================================================

  async getCurrentUserScope(actor: AuthenticatedActor): Promise<{
    profile: UserProfile;
    pessoa: Pessoa | null;
    onboarding: UserOnboarding;
  }> {
    const profile: UserProfile = {
      id: actor.id,
      email: actor.email,
      nome: actor.nome,
      role: actor.role,
      ativo: actor.ativo
    };

    const pessoa = await this.storage.findOne<Pessoa>('pessoas', {
      user_id: actor.id
    });

    let onboarding = await this.storage.findOne<UserOnboarding>('user_onboarding', {
      user_id: actor.id
    });

    if (!onboarding) {
      onboarding = {
        user_id: actor.id,
        primeiro_login: true,
        obriga_troca_senha: true,
        senha_trocada_em: null,
        preferencias: DEFAULT_USER_PREFERENCES
      };
      await this.storage.upsertMany('user_onboarding', [onboarding], ['user_id']);
    }

    return { profile, pessoa: pessoa ?? null, onboarding };
  }

  async updateOwnPassword(
    actor: AuthenticatedActor,
    newPassword: string
  ): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('A nova senha deve ter no mínimo 8 caracteres.');
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      throw new Error('A nova senha deve combinar letras e números para sua segurança.');
    }

    const cred = await this.storage.findOne<AuthCredentialRow>('auth_credentials', {
      user_id: actor.id
    });

    if (cred) {
      const isSame = await verifyPassword(newPassword, cred.password_hash);
      if (isSame) {
        throw new Error('A nova senha deve ser diferente da senha atual/provisória.');
      }
    }

    const newHash = await hashPassword(newPassword);
    const nowIso = new Date().toISOString();

    await this.storage.upsertMany(
      'auth_credentials',
      [
        {
          user_id: actor.id,
          email: actor.email,
          password_hash: newHash,
          created_at: cred?.created_at || nowIso,
          updated_at: nowIso
        }
      ],
      ['user_id']
    );

    const onboarding = await this.storage.findOne<UserOnboarding>('user_onboarding', {
      user_id: actor.id
    });

    const updatedOnb: UserOnboarding = {
      user_id: actor.id,
      primeiro_login: false,
      obriga_troca_senha: false,
      senha_trocada_em: nowIso,
      preferencias: onboarding?.preferencias ?? DEFAULT_USER_PREFERENCES
    };

    await this.storage.upsertMany('user_onboarding', [updatedOnb], ['user_id']);

    await this.storage.appendImmutable('system_audit_logs', {
      id: generateUuid(),
      actor_id: actor.id,
      actor_nome: actor.nome,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'password_changed',
      category: 'seguranca',
      target_id: actor.id,
      target_label: `${actor.nome} (${actor.email})`,
      details: { selfService: true },
      created_at: nowIso
    });
  }

  async updateOwnProfile(
    actor: AuthenticatedActor,
    nome?: string,
    preferencias?: Partial<UserPreferences>
  ): Promise<void> {
    if (typeof nome === 'string') {
      const cleanNome = nome.trim();
      if (!cleanNome || cleanNome.length > 120) {
        throw new Error('O nome deve conter entre 1 e 120 caracteres.');
      }

      await this.storage.upsertMany(
        'profiles',
        [
          {
            id: actor.id,
            email: actor.email,
            nome: cleanNome,
            role: actor.role,
            ativo: actor.ativo
          }
        ],
        ['id']
      );

      const pessoa = await this.storage.findOne<Pessoa>('pessoas', {
        user_id: actor.id
      });

      if (pessoa) {
        await this.storage.upsertMany(
          'pessoas',
          [
            {
              ...pessoa,
              nome: cleanNome
            }
          ],
          ['id']
        );
      }
    }

    if (preferencias && typeof preferencias === 'object') {
      const serialized = JSON.stringify(preferencias);
      if (serialized.length > 32768) {
        throw new Error('O volume de preferências excede o limite máximo de 32 KB.');
      }

      const onboarding = await this.storage.findOne<UserOnboarding>('user_onboarding', {
        user_id: actor.id
      });

      const updatedOnb: UserOnboarding = {
        user_id: actor.id,
        primeiro_login: onboarding?.primeiro_login ?? false,
        obriga_troca_senha: onboarding?.obriga_troca_senha ?? false,
        senha_trocada_em: onboarding?.senha_trocada_em ?? null,
        preferencias: {
          ...(onboarding?.preferencias ?? DEFAULT_USER_PREFERENCES),
          ...preferencias
        }
      };

      await this.storage.upsertMany('user_onboarding', [updatedOnb], ['user_id']);
    }
  }

  // ============================================================================
  // TRAVAS DE SEGURANÇA E RESOLUÇÃO DE ESCOPO RBAC
  // ============================================================================

  private async assertFirstLoginCompleted(actor: AuthenticatedActor): Promise<void> {
    const onboarding = await this.storage.findOne<UserOnboarding>('user_onboarding', {
      user_id: actor.id
    });

    if (onboarding && (onboarding.primeiro_login || onboarding.obriga_troca_senha)) {
      throw new Error(
        'Primeiro login obrigatório: é necessário redefinir sua senha antes de acessar as funcionalidades operacionais.'
      );
    }
  }

  private assertGlobalRole(actor: AuthenticatedActor): void {
    if (actor.role !== 'admin' && actor.role !== 'gestor') {
      throw new Error('Acesso negado: operação restrita a Administradores e Gestores.');
    }
  }

  private async resolveUserScope(actor: AuthenticatedActor): Promise<{
    isGlobal: boolean;
    allowedUNs: Set<string>;
    allowedPlatforms: Set<string>;
    pessoa: Pessoa | null;
  }> {
    const isGlobal = actor.role === 'admin' || actor.role === 'gestor';
    if (isGlobal) {
      return {
        isGlobal: true,
        allowedUNs: new Set<string>(),
        allowedPlatforms: new Set<string>(),
        pessoa: null
      };
    }

    const pessoa = await this.storage.findOne<Pessoa>('pessoas', {
      user_id: actor.id
    });

    const allowedUNs = new Set<string>(pessoa?.uns ?? []);
    const allowedPlatforms = new Set<string>(pessoa?.plats ?? []);

    // Adiciona plataformas cuja UN esteja no escopo da pessoa
    if (allowedUNs.size > 0) {
      const allPlats = await this.storage.findMany<Plataforma>('plataformas');
      for (const p of allPlats) {
        if (p.un && allowedUNs.has(p.un)) {
          allowedPlatforms.add(p.sigla);
        }
      }
    }

    return {
      isGlobal: false,
      allowedUNs,
      allowedPlatforms,
      pessoa: pessoa ?? null
    };
  }

  // ============================================================================
  // DATASET COMPLETO E FILTRAGEM POR ESCOPO
  // ============================================================================

  async fetchRawDataset(
    actor: AuthenticatedActor,
    queryIni: string,
    queryFim: string
  ): Promise<RawDatasetResponse> {
    await this.assertFirstLoginCompleted(actor);
    const scope = await this.resolveUserScope(actor);

    // 1. Configurações gerais
    const configRow = await this.storage.findOne<ContractConfig>('configuracoes', { id: 'geral' });

    // 2. Pesos USOFF por UN
    const allUsoffWeights = await this.storage.findMany<UsoffUnWeight>('config_usoff_un');
    const usoffWeightRows = scope.isGlobal
      ? allUsoffWeights
      : allUsoffWeights.filter(w => scope.allowedUNs.has(w.unidade_negocio));

    // 3. Plataformas
    const allPlats = await this.storage.findMany<Plataforma>('plataformas', {
      orderBy: { field: 'sigla', direction: 'asc' }
    });
    const plataformaRows = scope.isGlobal
      ? allPlats
      : allPlats.filter(p => scope.allowedPlatforms.has(p.sigla));

    // 4. Pessoas
    const pessoaRows = await this.storage.findMany<Pessoa>('pessoas');

    // 5. Técnicos
    const tecnicoRows = await this.storage.findMany<Tecnico>('tecnicos', {
      orderBy: { field: 'matricula', direction: 'asc' }
    });

    // 6. Carteira de Embarques dentro da janela
    const allCartRows = await this.storage.findMany<CarteiraEmbarque>('carteira_embarques', {
      filter: {
        data_fim: { gte: queryIni },
        data_inicio: { lte: queryFim }
      },
      orderBy: { field: 'data_inicio', direction: 'asc' }
    });

    const carteiraRows = scope.isGlobal
      ? allCartRows
      : allCartRows.filter(
          c =>
            (c.plataforma_sigla && scope.allowedPlatforms.has(c.plataforma_sigla)) ||
            (c.unidade_negocio && scope.allowedUNs.has(c.unidade_negocio))
        );

    // 6.1. Operações granulares da Carteira (Portal Offshore) dentro da janela
    const allCartOpRows = await this.storage.findMany<CarteiraOperacao>('carteira_operacoes', {
      filter: {
        data_fim: { gte: queryIni },
        data_inicio: { lte: queryFim }
      },
      orderBy: { field: 'data_inicio', direction: 'asc' }
    });

    const carteiraOperacaoRows = scope.isGlobal
      ? allCartOpRows
      : allCartOpRows.filter(
          co =>
            (co.plataforma_sigla && scope.allowedPlatforms.has(co.plataforma_sigla)) ||
            (co.unidade_negocio && scope.allowedUNs.has(co.unidade_negocio))
        );

    // 6.2. Confirmações do SAP vinculadas a embarques
    const allSapRows = await this.storage.findMany<ConfirmacaoSAP>('confirmacoes_sap', {
      orderBy: { field: 'data_fim_real', direction: 'desc' }
    });

    let confirmacaoSapRows = allSapRows;
    if (!scope.isGlobal) {
      const visibleCartMats = new Set<string>(carteiraRows.map(c => c.matricula));
      confirmacaoSapRows = allSapRows.filter(cs => visibleCartMats.has(cs.matricula));
    }

    // 7. Apontamentos HH
    const allHhRows = await this.storage.findMany<ApontamentoHH>('apontamentos_hh', {
      filter: {
        data: { gte: queryIni, lte: queryFim }
      },
      orderBy: { field: 'data', direction: 'asc' }
    });

    const hhRows = scope.isGlobal
      ? allHhRows
      : allHhRows.filter(
          h =>
            (h.plataforma_sigla && scope.allowedPlatforms.has(h.plataforma_sigla)) ||
            (h.unidade_negocio && scope.allowedUNs.has(h.unidade_negocio))
        );

    // 8. Justificativas
    const allJustRows = await this.storage.findMany<Justificativa>('justificativas', {
      filter: {
        data: { gte: queryIni, lte: queryFim }
      },
      orderBy: { field: 'data', direction: 'asc' }
    });

    let justificativaRows: Justificativa[] = allJustRows;
    if (!scope.isGlobal) {
      // Filtra justificativas que pertençam a técnicos/dias presentes na carteira ou HH visíveis
      const visibleTechDays = new Set<string>();
      for (const c of carteiraRows) {
        visibleTechDays.add(c.matricula);
      }
      for (const h of hhRows) {
        visibleTechDays.add(`${h.matricula}|${h.data}`);
      }
      justificativaRows = allJustRows.filter(
        j => visibleTechDays.has(`${j.matricula}|${j.data}`) || visibleTechDays.has(j.matricula)
      );
    }

    // 9. Marca d'água (calculada sobre todos os apontamentos reais no banco)
    const allGlobalHh = await this.storage.findMany<ApontamentoHH>('apontamentos_hh', {
      orderBy: { field: 'data', direction: 'desc' },
      limit: 1
    });
    const latestFluxos = await this.storage.findMany<FluxoImportacao>('fluxo_importacoes', {
      orderBy: { field: 'criado_em', direction: 'desc' },
      limit: 1
    });

    const watermarkRow: WatermarkStatus = {
      ultima_data_hh: allGlobalHh[0]?.data ?? null,
      ultima_importacao_em: latestFluxos[0]?.criado_em ?? null
    };

    // 10. Transbordo Zero-Knowledge e Detecção de OPs Compartilhadas
    let externalCoveredRows: Array<{ matricula: string; data: string }> = [];
    let sharedOps: string[] = [];

    if (!scope.isGlobal) {
      // Coleta matrículas visíveis nesta carteira
      const visibleMats = new Set<string>(carteiraRows.map(c => c.matricula));

      // Busca apontamentos externos desses técnicos na mesma janela
      for (const h of allHhRows) {
        if (visibleMats.has(h.matricula)) {
          const isInsideScope =
            (h.plataforma_sigla && scope.allowedPlatforms.has(h.plataforma_sigla)) ||
            (h.unidade_negocio && scope.allowedUNs.has(h.unidade_negocio));

          if (!isInsideScope) {
            // Zero-Knowledge: devolve apenas matricula e data
            externalCoveredRows.push({ matricula: h.matricula, data: h.data });
          }
        }
      }

      // Detecção de OPs compartilhadas com trava anti-oráculo
      const userOps = new Set<string>(
        carteiraRows.map(c => c.operacao || c.id_embarque || '').filter(Boolean)
      );
      if (userOps.size > 0) {
        for (const c of allCartRows) {
          const opCode = c.operacao || c.id_embarque || '';
          if (opCode && userOps.has(opCode)) {
            const isInsideScope =
              (c.plataforma_sigla && scope.allowedPlatforms.has(c.plataforma_sigla)) ||
              (c.unidade_negocio && scope.allowedUNs.has(c.unidade_negocio));

            if (!isInsideScope) {
              sharedOps.push(opCode);
            }
          }
        }
        sharedOps = Array.from(new Set(sharedOps));
      }
    }

    const response: RawDatasetResponse = {
      configRow: configRow ?? null,
      usoffWeightRows,
      plataformaRows,
      pessoaRows,
      tecnicoRows,
      carteiraRows,
      carteiraOperacaoRows,
      confirmacaoSapRows,
      hhRows,
      justificativaRows,
      watermarkRow,
      externalCoveredRows,
      sharedOps
    };

    // Dados restritos ao escopo Global
    if (scope.isGlobal) {
      response.profileRows = await this.storage.findMany<UserProfile>('profiles');
      response.onboardingRows = await this.storage.findMany<UserOnboarding>('user_onboarding');
      const notif = await this.storage.findOne<ConfiguracoesNotificacaoRow>(
        'configuracoes_notificacao',
        { id: 'geral' }
      );
      response.emailsResumo = notif?.emails_resumo ?? [];
      response.latestFluxoRow = latestFluxos[0] ?? null;
    }

    return response;
  }

  // ============================================================================
  // OPERAÇÕES DE JUSTIFICATIVAS E SLA IMUTÁVEL
  // ============================================================================

  async saveJustificativa(
    actor: AuthenticatedActor,
    input: {
      matricula: string;
      data: string;
      motivo: string;
      horas_gangway?: number;
      descricao?: string;
      responsavel_nome?: string;
    },
    _ipAddress?: string
  ): Promise<void> {
    await this.assertFirstLoginCompleted(actor);

    const matricula = String(input.matricula || '').trim();
    const data = String(input.data || '').trim();
    const motivo = String(input.motivo || '').trim();
    const horasGangway = Math.max(0, Number(input.horas_gangway || 0));
    const descricao = String(input.descricao || '').trim();
    const responsavelNome = String(input.responsavel_nome || actor.nome).trim();

    if (!matricula || !data || !motivo) {
      throw new Error('Matrícula, data e motivo são obrigatórios para registrar justificativa.');
    }

    const scope = await this.resolveUserScope(actor);
    if (!scope.isGlobal) {
      // Valida se o técnico ou dia pertence à carteira visível
      const cart = await this.storage.findMany<CarteiraEmbarque>('carteira_embarques', {
        filter: { matricula }
      });
      const inScope = cart.some(
        c =>
          (c.plataforma_sigla && scope.allowedPlatforms.has(c.plataforma_sigla)) ||
          (c.unidade_negocio && scope.allowedUNs.has(c.unidade_negocio))
      );
      if (!inScope) {
        throw new Error('Acesso negado: o técnico não pertence à sua carteira de embarques atribuída.');
      }
    }

    const existing = await this.storage.findOne<Justificativa>('justificativas', {
      matricula,
      data
    });

    const nowIso = new Date().toISOString();

    // SLA Imutável: autoria e carimbo original nunca são sobrescritos
    const rowToSave: Justificativa = {
      id: existing?.id || generateUuid(),
      matricula,
      data,
      motivo,
      horas_gangway: horasGangway,
      descricao,
      responsavel_nome: responsavelNome,
      criado_por: existing?.criado_por ?? actor.id,
      criado_em: existing?.criado_em ?? nowIso,
      updated_by: actor.id,
      updated_at: nowIso
    };

    await this.storage.upsertMany('justificativas', [rowToSave], ['matricula', 'data']);

    // Trilha de auditoria histórica de alterações
    if (existing) {
      const auditLog: JustificativaAuditLogRow = {
        id: generateUuid(),
        justificativa_id: rowToSave.id,
        matricula,
        data,
        action: 'update',
        motivo_antigo: existing.motivo,
        motivo_novo: motivo,
        horas_gangway_antigo: existing.horas_gangway,
        horas_gangway_novo: horasGangway,
        descricao_antiga: existing.descricao,
        descricao_nova: descricao,
        alterado_por: actor.id,
        alterado_em: nowIso
      };
      await this.storage.appendImmutable('justificativas_audit_log', auditLog);
    }

    // Emite SSE para sincronização instantânea de outros usuários conectados
    this.realtimeHub?.broadcast('justificativas', { matricula, data });
  }

  // ============================================================================
  // OPERAÇÕES GLOBAIS (ADMIN / GESTOR)
  // ============================================================================

  async saveConfiguracoes(
    actor: AuthenticatedActor,
    cfg: ContractConfig,
    unWeights: UsoffUnWeight[],
    emailsResumo: string[]
  ): Promise<void> {
    this.assertGlobalRole(actor);
    const nowIso = new Date().toISOString();

    const configRow: ContractConfig = {
      id: 'geral',
      hh_dia: Number(cfg.hh_dia || 11),
      meta_percentual: Number(cfg.meta_percentual || 100),
      atencao_percentual: Number(cfg.atencao_percentual || 90),
      dias_embarque: Number(cfg.dias_embarque || 14),
      dia_corte_medicao: cfg.dia_corte_medicao || 21,
      prazo_justificativa_dias: Number(cfg.prazo_justificativa_dias || 2),
      med_criterio: cfg.med_criterio || 'enc',
      us_pe_padrao: cfg.us_pe_padrao != null ? Number(cfg.us_pe_padrao) : null,
      us_ex_padrao: cfg.us_ex_padrao != null ? Number(cfg.us_ex_padrao) : null,
      slogan: cfg.slogan || '',
      regionais_extras: Array.isArray(cfg.regionais_extras) ? cfg.regionais_extras : []
    };

    await this.storage.upsertMany('configuracoes', [configRow], ['id']);

    if (Array.isArray(unWeights) && unWeights.length > 0) {
      await this.storage.upsertMany('config_usoff_un', unWeights, ['unidade_negocio']);
    }

    if (Array.isArray(emailsResumo)) {
      const notifRow: ConfiguracoesNotificacaoRow = {
        id: 'geral',
        emails_resumo: emailsResumo.map(e => e.trim().toLowerCase()).filter(Boolean),
        updated_at: nowIso
      };
      await this.storage.upsertMany('configuracoes_notificacao', [notifRow], ['id']);
    }

    await this.storage.appendImmutable('system_audit_logs', {
      id: generateUuid(),
      actor_id: actor.id,
      actor_nome: actor.nome,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'config_updated',
      category: 'configuracoes',
      target_id: 'geral',
      target_label: 'Configurações Contratuais',
      details: { dia_corte: cfg.dia_corte_medicao, med_criterio: cfg.med_criterio },
      created_at: nowIso
    });

    this.realtimeHub?.broadcast('sync_heartbeat');
  }

  async savePlataforma(
    actor: AuthenticatedActor,
    plat: Plataforma
  ): Promise<void> {
    this.assertGlobalRole(actor);
    const siglaUpper = sanitizeServerPlatformCode(plat.sigla);
    const chaveNorm = siglaUpper.replace(/[^A-Z0-9]/g, '');

    const row: Plataforma = {
      sigla: siglaUpper,
      chave_norm: chaveNorm,
      nome: plat.nome?.trim() || siglaUpper,
      un: plat.un?.trim() || '',
      armador: plat.armador?.trim() || '',
      gerencia: plat.gerencia?.trim() || '',
      tipo: plat.tipo?.trim() || '',
      situacao: plat.situacao || 'Mobilizada',
      cadastro_pendente: Boolean(plat.cadastro_pendente)
    };

    await this.storage.upsertMany('plataformas', [row], ['sigla']);

    await this.storage.appendImmutable('system_audit_logs', {
      id: generateUuid(),
      actor_id: actor.id,
      actor_nome: actor.nome,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'plataforma_saved',
      category: 'cadastros',
      target_id: siglaUpper,
      target_label: row.nome,
      details: { situacao: row.situacao, un: row.un },
      created_at: new Date().toISOString()
    });

    this.realtimeHub?.broadcast('sync_heartbeat');
  }

  async deletePlataforma(
    actor: AuthenticatedActor,
    sigla: string
  ): Promise<void> {
    this.assertGlobalRole(actor);
    const siglaUpper = sanitizeServerPlatformCode(sigla);

    const deleted = await this.storage.deleteMany('plataformas', { sigla: siglaUpper });
    if (deleted > 0) {
      await this.storage.appendImmutable('system_audit_logs', {
        id: generateUuid(),
        actor_id: actor.id,
        actor_nome: actor.nome,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'plataforma_deleted',
        category: 'cadastros',
        target_id: siglaUpper,
        target_label: siglaUpper,
        details: {},
        created_at: new Date().toISOString()
      });
      this.realtimeHub?.broadcast('sync_heartbeat');
    }
  }

  async saveTecnico(
    actor: AuthenticatedActor,
    tec: Tecnico
  ): Promise<void> {
    this.assertGlobalRole(actor);
    const matricula = (tec.matricula || '').trim();
    const nome = (tec.nome || '').trim();
    const funcao = (tec.funcao || '').trim() || 'Técnico Offshore';

    if (!matricula) throw new Error('A matrícula do técnico é obrigatória.');
    if (!nome) throw new Error('O nome do técnico é obrigatório.');

    const row: Tecnico = {
      matricula,
      nome,
      funcao
    };

    await this.storage.upsertMany('tecnicos', [row], ['matricula']);

    await this.storage.appendImmutable('system_audit_logs', {
      id: generateUuid(),
      actor_id: actor.id,
      actor_nome: actor.nome,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'tecnico_saved',
      category: 'cadastros',
      target_id: matricula,
      target_label: `${nome} (${matricula})`,
      details: { funcao },
      created_at: new Date().toISOString()
    });

    this.realtimeHub?.broadcast('sync_heartbeat');
  }

  async deleteTecnico(
    actor: AuthenticatedActor,
    matricula: string,
    cascade: boolean = false
  ): Promise<void> {
    this.assertGlobalRole(actor);
    const cleanMat = (matricula || '').trim();
    if (!cleanMat) throw new Error('Matrícula inválida.');

    if (cascade) {
      await this.storage.deleteMany('justificativas', { matricula: cleanMat });
      await this.storage.deleteMany('carteira_operacoes', { matricula: cleanMat });
      await this.storage.deleteMany('carteira_embarques', { matricula: cleanMat });
      await this.storage.deleteMany('apontamentos_hh', { matricula: cleanMat });
      await this.storage.deleteMany('confirmacoes_sap', { matricula: cleanMat });
    }

    const deleted = await this.storage.deleteMany('tecnicos', { matricula: cleanMat });
    if (deleted > 0) {
      await this.storage.appendImmutable('system_audit_logs', {
        id: generateUuid(),
        actor_id: actor.id,
        actor_nome: actor.nome,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'tecnico_deleted',
        category: 'cadastros',
        target_id: cleanMat,
        target_label: cleanMat,
        details: { cascade },
        created_at: new Date().toISOString()
      });
      this.realtimeHub?.broadcast('sync_heartbeat');
    }
  }

  async savePessoa(
    actor: AuthenticatedActor,
    input: {
      id?: string;
      nome: string;
      papel: PapelOperacional;
      email: string;
      plats: string[];
      uns: string[];
      user_id?: string | null;
    }
  ): Promise<Pessoa> {
    this.assertGlobalRole(actor);
    const cleanNome = input.nome.trim();
    const cleanEmail = input.email.trim().toLowerCase();
    const pessoaId = input.id || generateUuid();

    const baseSlug = cleanNome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;

    const row: Pessoa = {
      id: pessoaId,
      slug,
      nome: cleanNome,
      papel: input.papel,
      email: cleanEmail,
      user_id: input.user_id ?? null,
      plats: Array.from(new Set(input.plats || [])),
      uns: Array.from(new Set(input.uns || []))
    };

    await this.storage.upsertMany('pessoas', [row], ['id']);

    await this.storage.appendImmutable('system_audit_logs', {
      id: generateUuid(),
      actor_id: actor.id,
      actor_nome: actor.nome,
      actor_email: actor.email,
      actor_role: actor.role,
      action: input.id ? 'pessoa_updated' : 'pessoa_created',
      category: 'cadastros',
      target_id: pessoaId,
      target_label: `${cleanNome} (${cleanEmail})`,
      details: { papel: input.papel, platsCount: row.plats.length, unsCount: row.uns.length },
      created_at: new Date().toISOString()
    });

    this.realtimeHub?.broadcast('sync_heartbeat');
    return row;
  }

  async deletePessoa(actor: AuthenticatedActor, id: string): Promise<void> {
    this.assertGlobalRole(actor);
    const existing = await this.storage.findOne<Pessoa>('pessoas', { id });
    if (!existing) return;

    let targetUserId = existing.user_id;
    if (!targetUserId && existing.email) {
      const cleanEmail = existing.email.trim().toLowerCase();
      if (cleanEmail) {
        const prof = await this.storage.findOne<UserProfile>('profiles', { email: cleanEmail });
        if (prof) {
          targetUserId = prof.id;
        }
      }
    }

    // Se a pessoa possuir credencial de acesso vinculada, remove as credenciais e sessões
    if (targetUserId) {
      try {
        await this.adminManageUser(actor, {
          action: 'delete-user',
          userId: targetUserId
        });
      } catch (err: any) {
        // Se o erro for de usuário não encontrado, já foi removido; outros erros abortam a operação
        if (!err.message?.toLowerCase().includes('não encontrado')) {
          throw err;
        }
      }
    }

    const deleted = await this.storage.deleteMany('pessoas', { id });

    if (deleted > 0 && existing) {
      await this.storage.appendImmutable('system_audit_logs', {
        id: generateUuid(),
        actor_id: actor.id,
        actor_nome: actor.nome,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'pessoa_deleted',
        category: 'cadastros',
        target_id: id,
        target_label: `${existing.nome} (${existing.email})`,
        details: {},
        created_at: new Date().toISOString()
      });
      this.realtimeHub?.broadcast('sync_heartbeat');
    }
  }

  // ============================================================================
  // IMPORTAÇÃO EM CHUNKS, RECONCILIAÇÃO SAP E RESET DE CARTEIRA
  // ============================================================================

  async fetchCarteiraDedupSnapshot(actor: AuthenticatedActor): Promise<{
    carteiraRows: CarteiraEmbarque[];
    carteiraOperacaoRows: CarteiraOperacao[];
  }> {
    this.assertGlobalRole(actor);
    const [carteiraRows, carteiraOperacaoRows] = await Promise.all([
      this.storage.findMany<CarteiraEmbarque>('carteira_embarques', {
        orderBy: { field: 'data_inicio', direction: 'asc' }
      }),
      this.storage.findMany<CarteiraOperacao>('carteira_operacoes', {
        orderBy: { field: 'data_inicio', direction: 'asc' }
      })
    ]);
    return { carteiraRows, carteiraOperacaoRows };
  }

  async fetchSapDedupSnapshot(actor: AuthenticatedActor): Promise<ConfirmacaoSAP[]> {
    this.assertGlobalRole(actor);
    return this.storage.findMany<ConfirmacaoSAP>('confirmacoes_sap', {
      orderBy: { field: 'data_fim_real', direction: 'desc' }
    });
  }

  private async pruneStaleCarteiraByEmbarques(
    embarqueIds: string[],
    keepOps: Array<{
      id_embarque: string;
      matricula: string;
      data_inicio: string;
      ordem: string;
      operacao: string;
    }>
  ): Promise<number> {
    const normIds = new Set(embarqueIds.map(id => normalizeServerSapCode(normalizeServerIdEmbarque(id))).filter(Boolean));
    if (normIds.size === 0) return 0;

    const keepSet = new Set(
      (keepOps || [])
        .filter(k => k && String(k.id_embarque || '').trim())
        .map(
          k =>
            `${normalizeServerSapCode(normalizeServerIdEmbarque(k.id_embarque))}::${String(k.matricula || '').trim()}::${String(k.data_inicio || '').trim()}::${String(k.ordem || '').trim()}::${String(k.operacao || '').trim()}`
        )
    );

    const existingOps = await this.storage.findMany<CarteiraOperacao>('carteira_operacoes');
    const idsToDelete: string[] = [];
    for (const co of existingOps) {
      const coEid = normalizeServerSapCode(normalizeServerIdEmbarque(co.id_embarque || co.portal_id || ''));
      if (!coEid || !normIds.has(coEid)) continue;
      const coKey = `${coEid}::${String(co.matricula || '').trim()}::${String(co.data_inicio || '').trim()}::${String(co.ordem || '').trim()}::${String(co.operacao || '').trim()}`;
      if (!keepSet.has(coKey) && co.id) {
        idsToDelete.push(co.id);
      }
    }

    if (idsToDelete.length === 0) return 0;
    return await this.storage.deleteMany('carteira_operacoes', { id: { in: idsToDelete } });
  }

  private async syncCarteiraEmbarquesFromOperacoes(): Promise<void> {
    const allOps = await this.storage.findMany<CarteiraOperacao>('carteira_operacoes');
    const existingCart = await this.storage.findMany<CarteiraEmbarque>('carteira_embarques');
    const activeMatIniKeys = new Set(allOps.map(co => `${co.matricula}::${co.data_inicio}`));

    const orphanPortalIds = existingCart
      .filter(c => c.fonte === 'portal_offshore' && !activeMatIniKeys.has(`${c.matricula}::${c.data_inicio}`))
      .map(c => c.id)
      .filter(Boolean);

    if (orphanPortalIds.length > 0) {
      await this.storage.deleteMany('carteira_embarques', { id: { in: orphanPortalIds } });
    }

    if (allOps.length === 0) return;
    const existingByKey = new Map<string, CarteiraEmbarque>();
    for (const c of existingCart) {
      existingByKey.set(`${c.matricula}::${c.data_inicio}`, c);
    }

    const grouped = new Map<
      string,
      {
        id_embarque: string;
        matricula: string;
        plataforma_sigla: string;
        unidade_negocio: string;
        data_inicio: string;
        data_fim: string;
        horas_programadas: number;
        hh_carteira: number;
        hh_fora_carteira: number;
        hh_cancelado: number;
      }
    >();

    for (const co of allOps) {
      const key = `${co.matricula}::${co.data_inicio}`;
      const cleanId = normalizeServerIdEmbarque(co.id_embarque || co.portal_id || '');
      const cleanPlat = co.plataforma_sigla ? sanitizeServerPlatformCode(co.plataforma_sigla) : '';
      const cleanUn = String(co.unidade_negocio || '').trim();
      const hhProg = Number(co.hh_programado || 0);
      const stProg = String(co.status_programacao || 'Carteira').trim();

      let acc = grouped.get(key);
      if (!acc) {
        acc = {
          id_embarque: cleanId,
          matricula: co.matricula,
          plataforma_sigla: cleanPlat,
          unidade_negocio: cleanUn,
          data_inicio: co.data_inicio,
          data_fim: co.data_fim,
          horas_programadas: 0,
          hh_carteira: 0,
          hh_fora_carteira: 0,
          hh_cancelado: 0
        };
        grouped.set(key, acc);
      } else {
        if (cleanId && cleanId > acc.id_embarque) acc.id_embarque = cleanId;
        if (cleanPlat && cleanPlat > acc.plataforma_sigla) acc.plataforma_sigla = cleanPlat;
        if (cleanUn && cleanUn > acc.unidade_negocio) acc.unidade_negocio = cleanUn;
        if (co.data_fim > acc.data_fim) acc.data_fim = co.data_fim;
      }

      if (stProg === 'Carteira' || stProg === 'Fora da carteira') {
        acc.horas_programadas += hhProg;
      }
      if (stProg === 'Carteira') {
        acc.hh_carteira += hhProg;
      } else if (stProg === 'Fora da carteira') {
        acc.hh_fora_carteira += hhProg;
      } else if (stProg === 'Cancelada') {
        acc.hh_cancelado += hhProg;
      }
    }

    const nowIso = new Date().toISOString();
    const rowsToUpsert: CarteiraEmbarque[] = [];
    for (const [key, g] of grouped.entries()) {
      const prev = existingByKey.get(key);
      rowsToUpsert.push({
        id: prev?.id || generateUuid(),
        id_embarque: g.id_embarque,
        matricula: g.matricula,
        plataforma_sigla: g.plataforma_sigla,
        unidade_negocio: g.unidade_negocio,
        data_inicio: g.data_inicio,
        data_fim: g.data_fim,
        horas_programadas: g.horas_programadas,
        hh_carteira: g.hh_carteira,
        hh_fora_carteira: g.hh_fora_carteira,
        hh_cancelado: g.hh_cancelado,
        hh_confirmado_portal: prev?.hh_confirmado_portal ?? 0,
        hh_confirmado_sap: prev?.hh_confirmado_sap ?? 0,
        divergencia_confirmada: prev?.divergencia_confirmada ?? 0,
        operacao: g.id_embarque,
        pe: prev?.pe ?? null,
        ex: prev?.ex ?? null,
        fonte: 'portal_offshore',
        ...( { updated_at: nowIso } as any )
      });
    }

    await this.storage.upsertMany('carteira_embarques', rowsToUpsert, ['matricula', 'data_inicio']);
  }

  async batchImportChunks(
    actor: AuthenticatedActor,
    payload: {
      kind:
        | 'plataformas'
        | 'tecnicos'
        | 'hh'
        | 'carteira'
        | 'carteira_operacoes'
        | 'confirmacoes_sap'
        | 'fluxo';
      rows: any[];
      fluxo?: Partial<FluxoImportacao>;
      pruneEmbarqueIds?: string[];
      pruneKeepOps?: Array<{
        id_embarque: string;
        matricula: string;
        data_inicio: string;
        ordem: string;
        operacao: string;
      }>;
    }
  ): Promise<{ ok: boolean; count: number }> {
    this.assertGlobalRole(actor);
    const { kind, rows, fluxo, pruneEmbarqueIds, pruneKeepOps } = payload;
    const hasPruneTargets = kind === 'carteira_operacoes' && Array.isArray(pruneEmbarqueIds) && pruneEmbarqueIds.length > 0;
    if ((!Array.isArray(rows) || rows.length === 0) && !hasPruneTargets) {
      return { ok: true, count: 0 };
    }

    if (kind === 'plataformas') {
      const sanitizedPlats = rows.map(r => ({
        ...r,
        sigla: sanitizeServerPlatformCode(r.sigla)
      }));
      await this.storage.upsertMany('plataformas', sanitizedPlats, ['sigla']);
    } else if (kind === 'tecnicos') {
      await this.storage.upsertMany('tecnicos', rows, ['matricula']);
    } else if (kind === 'hh') {
      const hhWithIds = rows.map(r => ({
        ...r,
        id: r.id || generateUuid(),
        plataforma_sigla: r.plataforma_sigla
          ? sanitizeServerPlatformCode(r.plataforma_sigla)
          : r.plataforma_sigla
      }));
      await this.storage.upsertMany('apontamentos_hh', hhWithIds, ['matricula', 'data']);
    } else if (kind === 'carteira') {
      const cartWithIds = rows.map(r => {
        const cleanId = normalizeServerIdEmbarque(r.id_embarque || r.operacao || '');
        return {
          ...r,
          id: r.id || generateUuid(),
          id_embarque: cleanId,
          operacao: r.operacao || cleanId,
          plataforma_sigla: r.plataforma_sigla
            ? sanitizeServerPlatformCode(r.plataforma_sigla)
            : r.plataforma_sigla
        };
      });
      await this.storage.upsertMany('carteira_embarques', cartWithIds, ['matricula', 'data_inicio']);
    } else if (kind === 'carteira_operacoes') {
      let prunedCount = 0;
      if (hasPruneTargets && pruneEmbarqueIds) {
        prunedCount = await this.pruneStaleCarteiraByEmbarques(pruneEmbarqueIds, pruneKeepOps || []);
      }

      // Deduplicação intra-lote por chave natural normalizada + skip de idênticos já gravados
      const existingOps = await this.storage.findMany<CarteiraOperacao>('carteira_operacoes');
      const existingByKey = new Map<string, CarteiraOperacao>();
      for (const co of existingOps) {
        existingByKey.set(
          `${normalizeServerSapCode(co.matricula)}::${co.data_inicio}::${normalizeServerSapCode(co.ordem)}::${normalizeServerSapCode(co.operacao)}`,
          co
        );
      }

      const dedupedOpsMap = new Map<string, any>();
      for (const r of rows) {
        const cleanId = normalizeServerIdEmbarque(r.id_embarque || r.portal_id || '');
        const cleanPlat = r.plataforma_sigla
          ? sanitizeServerPlatformCode(r.plataforma_sigla)
          : null;
        const mat = String(r.matricula || '').trim();
        const ordem = String(r.ordem || '').trim();
        const operacao = String(r.operacao || '').trim();
        const normKey = `${normalizeServerSapCode(mat)}::${r.data_inicio}::${normalizeServerSapCode(ordem)}::${normalizeServerSapCode(operacao)}`;
        const prev = existingByKey.get(normKey);

        dedupedOpsMap.set(normKey, {
          ...r,
          id: prev?.id || r.id || generateUuid(),
          portal_id: cleanId,
          id_embarque: cleanId,
          matricula: mat,
          ordem,
          operacao,
          plataforma_sigla: cleanPlat,
          hh_confirmado_sap: prev ? Number(prev.hh_confirmado_sap || 0) : Number(r.hh_confirmado_sap || 0),
          divergencia_sap: prev ? Number(prev.divergencia_sap || 0) : Number(r.divergencia_sap || 0),
          status_divergencia: prev?.status_divergencia || r.status_divergencia || 'Não Apontado no SAP'
        });
      }

      const opsToUpsert = Array.from(dedupedOpsMap.values()).filter(item => {
        const normKey = `${normalizeServerSapCode(item.matricula)}::${item.data_inicio}::${normalizeServerSapCode(item.ordem)}::${normalizeServerSapCode(item.operacao)}`;
        const prev = existingByKey.get(normKey);
        if (!prev) return true;
        return !(
          String(prev.matricula || '').trim() === item.matricula &&
          String(prev.ordem || '').trim() === item.ordem &&
          String(prev.operacao || '').trim() === item.operacao &&
          normalizeServerSapCode(normalizeServerIdEmbarque(prev.id_embarque || prev.portal_id || '')) ===
            normalizeServerSapCode(item.id_embarque || '') &&
          (prev.plataforma_sigla || null) === (item.plataforma_sigla || null) &&
          (prev.unidade_negocio || '') === (item.unidade_negocio || '') &&
          prev.data_fim === item.data_fim &&
          (prev.status_programacao || 'Carteira') === (item.status_programacao || 'Carteira') &&
          Math.abs((Number(prev.hh_programado) || 0) - (Number(item.hh_programado) || 0)) < 0.0001 &&
          Math.abs((Number(prev.hh_confirmado) || 0) - (Number(item.hh_confirmado) || 0)) < 0.0001 &&
          (Number(prev.recursos) || 1) === (Number(item.recursos) || 1)
        );
      });

      if (opsToUpsert.length > 0) {
        await this.storage.upsertMany(
          'carteira_operacoes',
          opsToUpsert,
          ['matricula', 'data_inicio', 'ordem', 'operacao']
        );
      }
      if (opsToUpsert.length > 0 || prunedCount > 0) {
        await this.syncCarteiraEmbarquesFromOperacoes();
      }
    } else if (kind === 'confirmacoes_sap') {
      const nowIso = new Date().toISOString();
      const existingSap = await this.storage.findMany<ConfirmacaoSAP>('confirmacoes_sap');
      const existingByNorm = new Map<string, ConfirmacaoSAP>();
      for (const cs of existingSap) {
        existingByNorm.set(
          `${normalizeServerSapCode(cs.matricula)}::${cs.data_criacao}::${cs.data_lancamento}::${cs.data_fim_real}::${normalizeServerSapCode(cs.ordem)}::${normalizeServerSapCode(cs.operacao)}::${Number(cs.contador_confirmacao) || 0}`,
          cs
        );
      }

      const dedupedSapMap = new Map<string, any>();
      for (const r of rows) {
        const mat = String(r.matricula || '').trim();
        const ordem = String(r.ordem || '').trim();
        const operacao = String(r.operacao || '').trim();
        const hc = Number(r.horas_confirmadas || 0);
        const contador = Number(r.contador_confirmacao || 0);
        const normKey = `${normalizeServerSapCode(mat)}::${r.data_criacao}::${r.data_lancamento}::${r.data_fim_real}::${normalizeServerSapCode(ordem)}::${normalizeServerSapCode(operacao)}::${contador}`;
        const prev = existingByNorm.get(normKey);

        dedupedSapMap.set(normKey, {
          ...r,
          id: prev?.id || r.id || generateUuid(),
          matricula: prev?.matricula || mat,
          ordem: prev?.ordem || ordem,
          operacao: prev?.operacao || operacao,
          horas_confirmadas: hc,
          contador_confirmacao: contador,
          id_embarque: normalizeServerIdEmbarque(r.id_embarque || prev?.id_embarque || ''),
          status_reconciliacao: r.status_reconciliacao || prev?.status_reconciliacao || 'Pendente',
          created_at: r.created_at || prev?.created_at || nowIso,
          updated_at: r.updated_at || nowIso
        });
      }

      const sapToUpsert = Array.from(dedupedSapMap.values()).filter(item => {
        const normKey = `${normalizeServerSapCode(item.matricula)}::${item.data_criacao}::${item.data_lancamento}::${item.data_fim_real}::${normalizeServerSapCode(item.ordem)}::${normalizeServerSapCode(item.operacao)}::${Number(item.contador_confirmacao) || 0}`;
        const prev = existingByNorm.get(normKey);
        if (!prev) return true;
        return Math.abs((Number(prev.horas_confirmadas) || 0) - Number(item.horas_confirmadas || 0)) >= 0.0001;
      });

      if (sapToUpsert.length > 0) {
        await this.storage.upsertMany(
          'confirmacoes_sap',
          sapToUpsert,
          [
            'matricula',
            'data_criacao',
            'data_lancamento',
            'data_fim_real',
            'ordem',
            'operacao',
            'contador_confirmacao'
          ]
        );
      }
    }

    if (fluxo && fluxo.tipo_fluxo) {
      const fluxoRow: FluxoImportacao = {
        id: fluxo.id || generateUuid(),
        tipo_fluxo: fluxo.tipo_fluxo as any,
        origem: fluxo.origem || 'importacao',
        total_linhas: Number(fluxo.total_linhas || rows.length),
        data_maxima: fluxo.data_maxima || null,
        observacao: fluxo.observacao || '',
        criado_em: fluxo.criado_em || new Date().toISOString()
      };
      await this.storage.upsertMany('fluxo_importacoes', [fluxoRow], ['id']);
    }

    // Emite SSE Heartbeat único para os clientes recarregarem dados sem flood
    this.realtimeHub?.broadcast('sync_heartbeat');

    return { ok: true, count: rows.length };
  }

  async reconciliarConfirmacoesSAP(actor: AuthenticatedActor): Promise<{
    total_confirmacoes_sap: number;
    vinculados_ao_embarque: number;
    sem_embarque_associado: number;
    operacoes_com_batimento_ok: number;
    operacoes_com_divergencia: number;
    dias_apontados_sincronizados: number;
  }> {
    this.assertGlobalRole(actor);
    const nowIso = new Date().toISOString();

    const [allSap, allOps, allCart, allTecs] = await Promise.all([
      this.storage.findMany<ConfirmacaoSAP>('confirmacoes_sap'),
      this.storage.findMany<CarteiraOperacao>('carteira_operacoes'),
      this.storage.findMany<CarteiraEmbarque>('carteira_embarques'),
      this.storage.findMany<Tecnico>('tecnicos')
    ]);

    const tecMats = new Set<string>(allTecs.map(t => t.matricula));

    // Passo 1: Vincular cada confirmação SAP ao id_embarque em 2 passadas
    // (1A: P1..P5 normalizados sem zeros à esquerda; 1B: desempate multi-embarque e irmãs de estorno tardio)
    const sapKey3 = (mat: unknown, ordem: unknown, op: unknown) =>
      `${normalizeServerSapCode(mat)}::${normalizeServerSapCode(ordem)}::${normalizeServerSapCode(op)}`;
    const opIdOf = (co: CarteiraOperacao) =>
      normalizeServerIdEmbarque(co.id_embarque || co.portal_id || '');
    const embIdOf = (ce: CarteiraEmbarque) =>
      normalizeServerIdEmbarque(ce.id_embarque || ce.operacao || '');
    const embMetaById = new Map<string, CarteiraEmbarque>();
    for (const ce of allCart) {
      const eid = embIdOf(ce);
      if (eid) embMetaById.set(eid, ce);
    }

    const pickByDatePreference = <T extends { data_inicio: string }>(
      candidates: T[],
      refDate: string,
      preferredIds?: Set<string>,
      idGetter?: (c: T) => string
    ): T | undefined => {
      if (candidates.length === 0) return undefined;
      const started = refDate ? candidates.filter(c => c.data_inicio <= refDate) : candidates;
      const basePool = started.length > 0 ? started : candidates;
      if (preferredIds && idGetter) {
        const prefPool = basePool.filter(c => preferredIds.has(idGetter(c)));
        if (prefPool.length > 0) {
          return [...prefPool].sort((a, b) => b.data_inicio.localeCompare(a.data_inicio))[0];
        }
      }
      return started.length > 0
        ? [...started].sort((a, b) => b.data_inicio.localeCompare(a.data_inicio))[0]
        : [...candidates].sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))[0];
    };

    interface Pass1Draft {
      cs: ConfirmacaoSAP;
      k3: string;
      refDate: string;
      matchingOps: CarteiraOperacao[];
      matchingEmbs: CarteiraEmbarque[];
      resolvedId: string;
    }

    const posSumByKey3Emb = new Map<string, number>();
    const linkedIdsByKey3 = new Map<string, Set<string>>();

    const drafts: Pass1Draft[] = allSap.map(cs => {
      const k3 = sapKey3(cs.matricula, cs.ordem, cs.operacao);
      const matchingOps = allOps
        .filter(
          co =>
            normalizeServerSapCode(co.matricula) === normalizeServerSapCode(cs.matricula) &&
            normalizeServerSapCode(co.ordem) === normalizeServerSapCode(cs.ordem) &&
            normalizeServerSapCode(co.operacao) === normalizeServerSapCode(cs.operacao)
        )
        .sort((a, b) => b.data_inicio.localeCompare(a.data_inicio));

      const matchingEmbs = allCart
        .filter(ce => normalizeServerSapCode(ce.matricula) === normalizeServerSapCode(cs.matricula))
        .sort((a, b) => b.data_inicio.localeCompare(a.data_inicio));

      let resolvedId = '';

      // Prioridade 1: Ordem/Operação com data_fim_real exatamente no embarque
      const p1 = matchingOps.find(
        co => cs.data_fim_real >= co.data_inicio && cs.data_fim_real <= co.data_fim
      );
      if (p1) resolvedId = opIdOf(p1);

      // Prioridade 2: Ordem/Operação com data_lancamento até +4 dias após desembarque
      if (!resolvedId) {
        const p2 = matchingOps.find(
          co =>
            cs.data_lancamento >= co.data_inicio &&
            cs.data_lancamento <= addIsoDays(co.data_fim, 4)
        );
        if (p2) resolvedId = opIdOf(p2);
      }

      // Prioridade 3 (passada 1A): Ordem/Operação existente em único embarque do técnico
      if (!resolvedId && matchingOps.length > 0) {
        const distinctIds = Array.from(new Set(matchingOps.map(opIdOf).filter(Boolean)));
        if (distinctIds.length === 1) {
          resolvedId = distinctIds[0];
        }
      }

      // Prioridade 4: Sem ordem na carteira, mas data_fim_real dentro de embarque físico
      if (!resolvedId) {
        const p4 = matchingEmbs.find(
          ce => cs.data_fim_real >= ce.data_inicio && cs.data_fim_real <= ce.data_fim
        );
        if (p4) resolvedId = embIdOf(p4);
      }

      // Prioridade 5: Lançamento nos 4 dias de tolerância pós-desembarque (PMB)
      if (!resolvedId) {
        const p5 = matchingEmbs.find(
          ce =>
            cs.data_lancamento >= ce.data_inicio &&
            cs.data_lancamento <= addIsoDays(ce.data_fim, 4)
        );
        if (p5) resolvedId = embIdOf(p5);
      }

      const refDate = cs.data_fim_real || cs.data_lancamento || cs.data_criacao || '';
      if (resolvedId) {
        const set = linkedIdsByKey3.get(k3) || new Set<string>();
        set.add(resolvedId);
        linkedIdsByKey3.set(k3, set);
        const h = Number(cs.horas_confirmadas || 0);
        if (h > 0) {
          const pk = `${k3}::${resolvedId}`;
          posSumByKey3Emb.set(pk, (posSumByKey3Emb.get(pk) || 0) + h);
        }
      }

      return { cs, k3, refDate, matchingOps, matchingEmbs, resolvedId };
    });

    const updatedSap: ConfirmacaoSAP[] = drafts.map(d => {
      let { resolvedId } = d;
      const { cs, k3, refDate, matchingOps, matchingEmbs } = d;

      // Passada 1B: Estorno ou lançamento tardio (> 4d) com múltiplos embarques ou fora da carteira
      if (!resolvedId) {
        const posSet = new Set<string>();
        for (const eid of linkedIdsByKey3.get(k3) || []) {
          if ((posSumByKey3Emb.get(`${k3}::${eid}`) || 0) > 0) posSet.add(eid);
        }

        if (matchingOps.length > 0) {
          const picked = pickByDatePreference(
            matchingOps.filter(co => opIdOf(co) !== ''),
            refDate,
            Number(cs.horas_confirmadas || 0) < 0 && posSet.size > 0 ? posSet : undefined,
            opIdOf
          );
          if (picked) resolvedId = opIdOf(picked);
        } else {
          // Prioridade 6: Confirmação irmã já vinculada para a mesma ordem/operação fora da carteira
          const siblingIds = Array.from(linkedIdsByKey3.get(k3) || []);
          if (siblingIds.length === 1) {
            resolvedId = siblingIds[0];
          } else if (siblingIds.length > 1) {
            const sibEmbs = siblingIds.map(id => ({
              id,
              data_inicio: embMetaById.get(id)?.data_inicio || matchingEmbs[0]?.data_inicio || ''
            }));
            const picked = pickByDatePreference(
              sibEmbs,
              refDate,
              Number(cs.horas_confirmadas || 0) < 0 && posSet.size > 0 ? posSet : undefined,
              s => s.id
            );
            if (picked) resolvedId = picked.id;
          }
        }
      }

      let statusRec: ConfirmacaoSAP['status_reconciliacao'] = 'Sem Embarque';
      if (matchingOps.length > 0) {
        statusRec = 'Em Carteira';
      } else if (
        resolvedId !== '' ||
        matchingEmbs.some(
          ce =>
            (cs.data_fim_real >= ce.data_inicio && cs.data_fim_real <= ce.data_fim) ||
            (cs.data_lancamento >= ce.data_inicio &&
              cs.data_lancamento <= addIsoDays(ce.data_fim, 4))
        )
      ) {
        statusRec = 'Fora da Carteira';
      }

      return {
        ...cs,
        id_embarque: resolvedId,
        status_reconciliacao: statusRec,
        updated_at: nowIso
      };
    });

    if (updatedSap.length > 0) {
      await this.storage.upsertMany(
        'confirmacoes_sap',
        updatedSap,
        [
          'matricula',
          'data_criacao',
          'data_lancamento',
          'data_fim_real',
          'ordem',
          'operacao',
          'contador_confirmacao'
        ]
      );
    }

    // Passo 2: Atualizar indicadores de confronto em carteira_operacoes (soma líquida + e estornos -)
    const sapAggMap = new Map<string, number>();
    for (const cs of updatedSap) {
      const k = `${sapKey3(cs.matricula, cs.ordem, cs.operacao)}::${cs.id_embarque}`;
      sapAggMap.set(k, (sapAggMap.get(k) || 0) + Number(cs.horas_confirmadas || 0));
    }

    const updatedOps: CarteiraOperacao[] = allOps.map(co => {
      const idEmb = normalizeServerIdEmbarque(co.id_embarque || co.portal_id || '');
      const k = `${sapKey3(co.matricula, co.ordem, co.operacao)}::${idEmb}`;
      const totalSap = round2(sapAggMap.get(k) || 0);
      const hhConf = round2(Number(co.hh_confirmado || 0));
      const div = round2(hhConf - totalSap);
      const statusDiv = resolveServerDivergenciaStatus(hhConf, totalSap);

      return {
        ...co,
        hh_confirmado_sap: totalSap,
        divergencia_sap: div,
        status_divergencia: statusDiv
      };
    });

    if (updatedOps.length > 0) {
      await this.storage.upsertMany(
        'carteira_operacoes',
        updatedOps,
        ['matricula', 'data_inicio', 'ordem', 'operacao']
      );
    }

    // Passo 3: Consolidar totais de confirmação em carteira_embarques
    const embConfMap = new Map<string, { confPortal: number; confSap: number }>();
    for (const co of updatedOps) {
      const idEmb = normalizeServerIdEmbarque(co.id_embarque || co.portal_id || '');
      const key = idEmb ? `id::${idEmb}` : `mat::${co.matricula}::${co.data_inicio}`;
      const cur = embConfMap.get(key) || { confPortal: 0, confSap: 0 };
      cur.confPortal += Number(co.hh_confirmado || 0);
      cur.confSap += Number(co.hh_confirmado_sap || 0);
      embConfMap.set(key, cur);
    }

    const updatedCart: CarteiraEmbarque[] = [];
    for (const ce of allCart) {
      const idEmb = normalizeServerIdEmbarque(ce.id_embarque || ce.operacao || '');
      const agg =
        (idEmb ? embConfMap.get(`id::${idEmb}`) : undefined) ||
        embConfMap.get(`mat::${ce.matricula}::${ce.data_inicio}`);
      if (agg) {
        const confPortal = round2(agg.confPortal);
        const confSap = round2(agg.confSap);
        updatedCart.push({
          ...ce,
          hh_confirmado_portal: confPortal,
          hh_confirmado_sap: confSap,
          divergencia_confirmada: round2(confPortal - confSap)
        });
      }
    }

    if (updatedCart.length > 0) {
      await this.storage.upsertMany('carteira_embarques', updatedCart, ['matricula', 'data_inicio']);
    }

    // Passo 4: Sincronizar apontamentos_hh diários a partir das confirmações do SAP (teto [0, 24])
    const cartByIdEmb = new Map<string, CarteiraEmbarque>();
    for (const ce of allCart) {
      const idEmb = normalizeServerIdEmbarque(ce.id_embarque || ce.operacao || '');
      if (idEmb) cartByIdEmb.set(idEmb, ce);
    }

    const dailySapAgg = new Map<
      string,
      { matricula: string; data: string; totalHoras: number; directPlats: string[]; directUns: string[] }
    >();

    for (const cs of updatedSap) {
      if (!cs.data_fim_real || !tecMats.has(cs.matricula)) continue;
      const key = `${cs.matricula}::${cs.data_fim_real}`;
      let entry = dailySapAgg.get(key);
      if (!entry) {
        entry = {
          matricula: cs.matricula,
          data: cs.data_fim_real,
          totalHoras: 0,
          directPlats: [],
          directUns: []
        };
        dailySapAgg.set(key, entry);
      }
      entry.totalHoras += Number(cs.horas_confirmadas || 0);
      if (cs.id_embarque) {
        const ceDirect = cartByIdEmb.get(cs.id_embarque);
        if (ceDirect?.plataforma_sigla) entry.directPlats.push(ceDirect.plataforma_sigla);
        if (ceDirect?.unidade_negocio) entry.directUns.push(ceDirect.unidade_negocio);
      }
    }

    const hhToUpsert: ApontamentoHH[] = [];
    for (const entry of dailySapAgg.values()) {
      const nearCe = allCart
        .filter(ce => ce.matricula === entry.matricula)
        .sort((a, b) => isoDaysAbsDiff(a.data_inicio, entry.data) - isoDaysAbsDiff(b.data_inicio, entry.data))[0];

      const maxPlat = entry.directPlats.sort().at(-1) || nearCe?.plataforma_sigla || '';
      const maxUn = entry.directUns.sort().at(-1) || nearCe?.unidade_negocio || 'UN-DESCONHECIDA';
      const clampedHoras = Math.min(24, Math.max(0, Math.round(entry.totalHoras * 100) / 100));

      hhToUpsert.push({
        id: generateUuid(),
        matricula: entry.matricula,
        data: entry.data,
        plataforma_sigla: maxPlat,
        unidade_negocio: maxUn,
        horas_executadas: clampedHoras
      });
    }

    if (hhToUpsert.length > 0) {
      await this.storage.upsertMany('apontamentos_hh', hhToUpsert, ['matricula', 'data']);
    }

    // Passo 5: Atualizar marca d'água em fluxo_importacoes quando houver apontamentos sincronizados
    if (hhToUpsert.length > 0) {
      const allHhAfter = await this.storage.findMany<ApontamentoHH>('apontamentos_hh');
      const maxHhDate = allHhAfter.reduce((mx, r) => (r.data > mx ? r.data : mx), '');
      const fluxoRow: FluxoImportacao = {
        id: generateUuid(),
        tipo_fluxo: 'hh',
        origem: `Reconciliação SAP (${allHhAfter.length} dias)`,
        total_linhas: allHhAfter.length,
        data_maxima: maxHhDate || null,
        observacao: 'Sincronizado automaticamente das confirmações do SAP',
        criado_em: nowIso
      };
      await this.storage.upsertMany('fluxo_importacoes', [fluxoRow], ['id']);
    }

    this.realtimeHub?.broadcast('sync_heartbeat');

    const vinculados = updatedSap.filter(cs => cs.id_embarque !== '').length;
    const opsOk = updatedOps.filter(co => co.status_divergencia === 'OK').length;
    const opsDiv = updatedOps.filter(co =>
      String(co.status_divergencia || '').startsWith('Divergente')
    ).length;

    return {
      total_confirmacoes_sap: updatedSap.length,
      vinculados_ao_embarque: vinculados,
      sem_embarque_associado: updatedSap.length - vinculados,
      operacoes_com_batimento_ok: opsOk,
      operacoes_com_divergencia: opsDiv,
      dias_apontados_sincronizados: hhToUpsert.length
    };
  }

  async resetCarteiraEmbarques(
    actor: AuthenticatedActor,
    ipAddress?: string
  ): Promise<{
    success: boolean;
    deleted_operacoes: number;
    deleted_embarques: number;
    message: string;
  }> {
    this.assertGlobalRole(actor);
    const nowIso = new Date().toISOString();

    const deletedOperacoes = await this.storage.deleteMany('carteira_operacoes', {});
    const deletedEmbarques = await this.storage.deleteMany('carteira_embarques', {});

    const allSap = await this.storage.findMany<ConfirmacaoSAP>('confirmacoes_sap');
    const sapToUnlink = allSap
      .filter(cs => cs.id_embarque !== '' || cs.status_reconciliacao !== 'Pendente')
      .map(cs => ({
        ...cs,
        id_embarque: '',
        status_reconciliacao: 'Pendente' as const,
        updated_at: nowIso
      }));

    if (sapToUnlink.length > 0) {
      await this.storage.upsertMany(
        'confirmacoes_sap',
        sapToUnlink,
        [
          'matricula',
          'data_criacao',
          'data_lancamento',
          'data_fim_real',
          'ordem',
          'operacao',
          'contador_confirmacao'
        ]
      );
    }

    await this.storage.appendImmutable('system_audit_logs', {
      id: generateUuid(),
      actor_id: actor.id,
      actor_nome: actor.nome,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'carteira_reset',
      category: 'importacao',
      target_id: 'carteira',
      target_label: 'Carteira de Embarques e Operações',
      details: {
        deleted_operacoes: deletedOperacoes,
        deleted_embarques: deletedEmbarques
      },
      ip_address: ipAddress || null,
      created_at: nowIso
    });

    this.realtimeHub?.broadcast('sync_heartbeat');

    return {
      success: true,
      deleted_operacoes: deletedOperacoes,
      deleted_embarques: deletedEmbarques,
      message: 'Carteira de operações e embarques resetadas com sucesso para reimportação limpa.'
    };
  }

  // ============================================================================
  // AUDITORIA WORM
  // ============================================================================

  async fetchAuditLogs(
    actor: AuthenticatedActor,
    options?: { limit?: number; search?: string }
  ): Promise<SystemAuditLog[]> {
    this.assertGlobalRole(actor);

    const logs = await this.storage.findMany<SystemAuditLog>('system_audit_logs', {
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: options?.limit ?? 500
    });

    if (options?.search && options.search.trim()) {
      const term = options.search.trim().toLowerCase();
      return logs.filter(
        l =>
          (l.action && l.action.toLowerCase().includes(term)) ||
          (l.actor_nome && l.actor_nome.toLowerCase().includes(term)) ||
          (l.actor_email && l.actor_email.toLowerCase().includes(term)) ||
          (l.target_label && l.target_label.toLowerCase().includes(term))
      );
    }

    return logs;
  }

  async logSystemEvent(
    actor: AuthenticatedActor,
    event: Partial<SystemAuditLog>
  ): Promise<void> {
    const log: SystemAuditLog = {
      id: generateUuid(),
      actor_id: event.actor_id || actor.id,
      actor_nome: event.actor_nome || actor.nome,
      actor_email: event.actor_email || actor.email,
      actor_role: event.actor_role || actor.role,
      action: event.action || 'evento',
      category: event.category || 'operacional',
      target_id: event.target_id || null,
      target_label: event.target_label || null,
      details: event.details || {},
      ip_address: event.ip_address || null,
      created_at: new Date().toISOString()
    };

    await this.storage.appendImmutable('system_audit_logs', log);
  }

  // ============================================================================
  // GESTÃO ADMINISTRATIVA DE USUÁRIOS (COM TRAVAS ANTI-LOCKOUT & CORTE 0MS)
  // ============================================================================

  private async countActiveAdmins(): Promise<number> {
    const admins = await this.storage.findMany<UserProfile>('profiles', {
      filter: { role: 'admin', ativo: true }
    });
    return admins.length;
  }

  async adminManageUser(
    actor: AuthenticatedActor,
    payload: {
      action: 'create' | 'update-role' | 'reset-password' | 'toggle-active' | 'delete-user';
      userId?: string;
      email?: string;
      password?: string;
      nome?: string;
      role?: SystemRole;
      pessoaId?: string;
      plats?: string[];
      uns?: string[];
      forceChange?: boolean;
      newPassword?: string;
      ativo?: boolean;
    },
    ipAddress?: string
  ): Promise<{ ok: boolean; message: string; userId?: string }> {
    this.assertGlobalRole(actor);
    const { action } = payload;
    const nowIso = new Date().toISOString();

    // --------------------------------------------------------------------------
    // AÇÃO: 'create'
    // --------------------------------------------------------------------------
    if (action === 'create') {
      const cleanEmail = (payload.email || '').trim().toLowerCase();
      const cleanNome = (payload.nome || '').trim();
      const role = payload.role || 'preposto';
      const password = payload.password;

      if (!cleanEmail || !cleanEmail.includes('@')) {
        throw new Error('E-mail inválido ou não informado.');
      }
      if (!cleanNome) {
        throw new Error('Nome completo obrigatório.');
      }
      if (!password || password.length < 8) {
        throw new Error('A senha provisória deve conter no mínimo 8 caracteres.');
      }

      // Regra: Somente admin cria outro admin
      if (role === 'admin' && actor.role !== 'admin') {
        throw new Error('Apenas Administradores podem criar novos Administradores.');
      }

      const existingCred = await this.storage.findOne<AuthCredentialRow>('auth_credentials', {
        email: cleanEmail
      });
      if (existingCred) {
        throw new Error('Já existe um usuário cadastrado com este e-mail.');
      }

      const newUserId = generateUuid();
      const passwordHash = await hashPassword(password);

      const cred: AuthCredentialRow = {
        user_id: newUserId,
        email: cleanEmail,
        password_hash: passwordHash,
        created_at: nowIso,
        updated_at: nowIso
      };

      const prof: UserProfile = {
        id: newUserId,
        email: cleanEmail,
        nome: cleanNome,
        role,
        ativo: true
      };

      const onb: UserOnboarding = {
        user_id: newUserId,
        primeiro_login: true,
        obriga_troca_senha: true,
        senha_trocada_em: null,
        preferencias: DEFAULT_USER_PREFERENCES
      };

      await this.storage.upsertMany('auth_credentials', [cred], ['user_id']);
      await this.storage.upsertMany('profiles', [prof], ['id']);
      await this.storage.upsertMany('user_onboarding', [onb], ['user_id']);

      // Vínculo com cadastro em pessoas
      if (payload.pessoaId) {
        const pessoa = await this.storage.findOne<Pessoa>('pessoas', { id: payload.pessoaId });
        if (pessoa) {
          await this.storage.upsertMany(
            'pessoas',
            [
              {
                ...pessoa,
                user_id: newUserId,
                email: cleanEmail,
                nome: cleanNome,
                papel: role === 'admin' ? 'gestor' : (role as PapelOperacional)
              }
            ],
            ['id']
          );
        }
      } else if (role !== 'admin') {
        const baseSlug = cleanNome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
        const pessoa: Pessoa = {
          id: generateUuid(),
          slug,
          nome: cleanNome,
          papel: role as PapelOperacional,
          email: cleanEmail,
          user_id: newUserId,
          plats: payload.plats || [],
          uns: payload.uns || []
        };
        await this.storage.upsertMany('pessoas', [pessoa], ['id']);
      }

      await this.storage.appendImmutable('system_audit_logs', {
        id: generateUuid(),
        actor_id: actor.id,
        actor_nome: actor.nome,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'user_created',
        category: 'usuarios',
        target_id: newUserId,
        target_label: `${cleanNome} (${cleanEmail})`,
        details: { role, email: cleanEmail, nome: cleanNome },
        ip_address: ipAddress || null,
        created_at: nowIso
      });

      return {
        ok: true,
        userId: newUserId,
        message: `Usuário ${cleanNome} criado com sucesso.`
      };
    }

    // --------------------------------------------------------------------------
    // AÇÃO: 'update-role'
    // --------------------------------------------------------------------------
    if (action === 'update-role') {
      const { userId, role, nome } = payload;
      if (!userId || !role) {
        throw new Error('Identificador do usuário e novo papel são obrigatórios.');
      }

      const target = await this.storage.findOne<UserProfile>('profiles', { id: userId });
      if (!target) {
        throw new Error('Usuário alvo não encontrado.');
      }

      // Regra: Somente admin mexe em admin ou promove para admin
      if ((target.role === 'admin' || role === 'admin') && actor.role !== 'admin') {
        throw new Error('Apenas Administradores podem gerenciar o papel de Administrador.');
      }

      // Anti-lockout 1: Proibir auto-rebaixamento
      if (actor.id === userId && target.role === 'admin' && role !== 'admin') {
        throw new Error('Você não pode rebaixar seu próprio papel de Administrador.');
      }

      // Anti-lockout 2: Garantir ao menos 1 admin ativo
      if (target.role === 'admin' && role !== 'admin') {
        const activeAdmins = await this.countActiveAdmins();
        if (activeAdmins <= 1) {
          throw new Error('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
        }
      }

      const updatedNome = typeof nome === 'string' && nome.trim() ? nome.trim() : target.nome;
      const updatedProfile: UserProfile = {
        ...target,
        role,
        nome: updatedNome
      };

      await this.storage.upsertMany('profiles', [updatedProfile], ['id']);

      const pessoa = await this.storage.findOne<Pessoa>('pessoas', { user_id: userId });
      if (pessoa) {
        await this.storage.upsertMany(
          'pessoas',
          [
            {
              ...pessoa,
              nome: updatedNome,
              papel: role === 'admin' ? 'gestor' : (role as PapelOperacional)
            }
          ],
          ['id']
        );
      }

      await this.storage.appendImmutable('system_audit_logs', {
        id: generateUuid(),
        actor_id: actor.id,
        actor_nome: actor.nome,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'role_changed',
        category: 'seguranca',
        target_id: userId,
        target_label: `${target.nome} (${target.email})`,
        details: { previousRole: target.role, newRole: role, updatedNome },
        ip_address: ipAddress || null,
        created_at: nowIso
      });

      return {
        ok: true,
        message: `Papel do usuário atualizado para "${role}".`
      };
    }

    // --------------------------------------------------------------------------
    // AÇÃO: 'reset-password'
    // --------------------------------------------------------------------------
    if (action === 'reset-password') {
      const { userId, newPassword, forceChange = true } = payload;
      if (!userId || !newPassword || newPassword.length < 8) {
        throw new Error('Usuário inválido ou nova senha com menos de 8 caracteres.');
      }

      const target = await this.storage.findOne<UserProfile>('profiles', { id: userId });
      if (!target) {
        throw new Error('Usuário alvo não encontrado.');
      }

      // Somente admin redefine senha de outro admin
      if (target.role === 'admin' && actor.role !== 'admin') {
        throw new Error('Apenas Administradores podem redefinir a senha de outro Administrador.');
      }

      const newHash = await hashPassword(newPassword);

      const cred = await this.storage.findOne<AuthCredentialRow>('auth_credentials', {
        user_id: userId
      });

      await this.storage.upsertMany(
        'auth_credentials',
        [
          {
            user_id: userId,
            email: target.email,
            password_hash: newHash,
            created_at: cred?.created_at || nowIso,
            updated_at: nowIso
          }
        ],
        ['user_id']
      );

      const onb = await this.storage.findOne<UserOnboarding>('user_onboarding', {
        user_id: userId
      });

      await this.storage.upsertMany(
        'user_onboarding',
        [
          {
            user_id: userId,
            primeiro_login: true,
            obriga_troca_senha: forceChange,
            senha_trocada_em: onb?.senha_trocada_em || null,
            preferencias: onb?.preferencias || DEFAULT_USER_PREFERENCES
          }
        ],
        ['user_id']
      );

      // Invalida sessões ativas do usuário alvo para forçar re-login com nova senha provisória
      await this.storage.deleteMany('auth_sessions', { user_id: userId });

      await this.storage.appendImmutable('system_audit_logs', {
        id: generateUuid(),
        actor_id: actor.id,
        actor_nome: actor.nome,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'password_reset',
        category: 'seguranca',
        target_id: userId,
        target_label: `${target.nome} (${target.email})`,
        details: { forceChange, targetRole: target.role },
        ip_address: ipAddress || null,
        created_at: nowIso
      });

      return {
        ok: true,
        message: 'Senha provisória definida. O usuário deverá trocá-la no próximo login.'
      };
    }

    // --------------------------------------------------------------------------
    // AÇÃO: 'toggle-active'
    // --------------------------------------------------------------------------
    if (action === 'toggle-active') {
      const { userId, ativo } = payload;
      if (!userId || typeof ativo !== 'boolean') {
        throw new Error('Parâmetros userId e ativo (booleano) são obrigatórios.');
      }

      const target = await this.storage.findOne<UserProfile>('profiles', { id: userId });
      if (!target) {
        throw new Error('Usuário alvo não encontrado.');
      }

      // Somente admin altera ativação de outro admin
      if (target.role === 'admin' && actor.role !== 'admin') {
        throw new Error('Apenas Administradores podem alterar a ativação de um Administrador.');
      }

      // Anti-lockout 1: Proibir auto-desativação
      if (actor.id === userId && !ativo) {
        throw new Error('Você não pode desativar seu próprio acesso.');
      }

      // Anti-lockout 2: Garantir ao menos 1 admin ativo
      if (target.role === 'admin' && !ativo) {
        const activeAdmins = await this.countActiveAdmins();
        if (activeAdmins <= 1) {
          throw new Error('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
        }
      }

      await this.storage.upsertMany(
        'profiles',
        [
          {
            ...target,
            ativo
          }
        ],
        ['id']
      );

      // Corte 0ms: se desativado, revoga imediatamente todas as sessões em auth_sessions
      if (!ativo) {
        await this.storage.deleteMany('auth_sessions', { user_id: userId });
      }

      await this.storage.appendImmutable('system_audit_logs', {
        id: generateUuid(),
        actor_id: actor.id,
        actor_nome: actor.nome,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'status_toggled',
        category: 'seguranca',
        target_id: userId,
        target_label: `${target.nome} (${target.email})`,
        details: { previousStatus: target.ativo, newStatus: ativo, targetRole: target.role },
        ip_address: ipAddress || null,
        created_at: nowIso
      });

      return {
        ok: true,
        message: `Acesso do usuário ${ativo ? 'ativado' : 'desativado'} com sucesso.`
      };
    }

    if (action === 'delete-user') {
      if (!payload.userId) {
        throw new Error('Identificador do usuário (userId) é obrigatório.');
      }
      return this.deleteUserAccount(actor, payload.userId, ipAddress);
    }

    throw new Error(`Ação administrativa desconhecida: "${action}".`);
  }

  async deleteUserAccount(
    actor: AuthenticatedActor,
    targetUserId: string,
    ipAddress?: string
  ): Promise<{ ok: boolean; message: string }> {
    this.assertGlobalRole(actor);

    if (!targetUserId) {
      throw new Error('Identificador do usuário (userId) é obrigatório.');
    }

    const target = await this.storage.findOne<UserProfile>('profiles', { id: targetUserId });
    if (!target) {
      throw new Error('Usuário alvo não encontrado.');
    }

    // Anti-lockout 1: Proibir auto-exclusão
    if (actor.id === targetUserId) {
      throw new Error('Você não pode remover sua própria conta de Administrador.');
    }

    // Regra: Somente admin remove outro admin
    if (target.role === 'admin' && actor.role !== 'admin') {
      throw new Error('Apenas Administradores podem remover contas de Administrador.');
    }

    // Anti-lockout 2: Garantir ao menos 1 admin ativo
    if (target.role === 'admin') {
      const activeAdmins = await this.countActiveAdmins();
      if (activeAdmins <= 1) {
        throw new Error('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
      }
    }

    // 1. Corte 0ms: Revoga sessões ativas
    await this.storage.deleteMany('auth_sessions', { user_id: targetUserId });

    // 2. Remove credenciais e onboarding
    await this.storage.deleteMany('auth_credentials', { user_id: targetUserId });
    await this.storage.deleteMany('user_onboarding', { user_id: targetUserId });

    // 3. Remove perfil
    await this.storage.deleteMany('profiles', { id: targetUserId });

    // 4. Desvincula de pessoas
    const pessoa = await this.storage.findOne<Pessoa>('pessoas', { user_id: targetUserId });
    if (pessoa) {
      await this.storage.upsertMany(
        'pessoas',
        [
          {
            ...pessoa,
            user_id: null
          }
        ],
        ['id']
      );
    }

    // 5. Trilha WORM imutável
    await this.storage.appendImmutable('system_audit_logs', {
      id: generateUuid(),
      actor_id: actor.id,
      actor_nome: actor.nome,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'user_deleted',
      category: 'usuarios',
      target_id: targetUserId,
      target_label: `${target.nome} (${target.email})`,
      details: { targetRole: target.role, targetEmail: target.email, reason: 'Exclusão definitiva de conta' },
      ip_address: ipAddress || null,
      created_at: new Date().toISOString()
    });

    return {
      ok: true,
      message: `Usuário ${target.nome} removido do sistema com sucesso.`
    };
  }
}
