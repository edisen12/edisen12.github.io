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

export interface RawDatasetResponse {
  configRow: ContractConfig | null;
  usoffWeightRows: UsoffUnWeight[];
  plataformaRows: Plataforma[];
  pessoaRows: Pessoa[];
  tecnicoRows: Tecnico[];
  carteiraRows: CarteiraEmbarque[];
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
    ipAddress?: string
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
    const nowIso = new Date().toISOString();

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
      const userOps = new Set<string>(carteiraRows.map(c => c.operacao).filter(Boolean));
      if (userOps.size > 0) {
        for (const c of allCartRows) {
          if (c.operacao && userOps.has(c.operacao)) {
            const isInsideScope =
              (c.plataforma_sigla && scope.allowedPlatforms.has(c.plataforma_sigla)) ||
              (c.unidade_negocio && scope.allowedUNs.has(c.unidade_negocio));

            if (!isInsideScope) {
              sharedOps.push(c.operacao);
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
    ipAddress?: string
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
  }

  async savePlataforma(
    actor: AuthenticatedActor,
    plat: Plataforma
  ): Promise<void> {
    this.assertGlobalRole(actor);
    const siglaUpper = plat.sigla.trim().toUpperCase();
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
  }

  async deletePlataforma(
    actor: AuthenticatedActor,
    sigla: string
  ): Promise<void> {
    this.assertGlobalRole(actor);
    const siglaUpper = sigla.trim().toUpperCase();

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
    }
  }

  // ============================================================================
  // IMPORTAÇÃO EM CHUNKS COM INTEGRIDADE REFERENCIAL
  // ============================================================================

  async batchImportChunks(
    actor: AuthenticatedActor,
    payload: {
      kind: 'plataformas' | 'tecnicos' | 'hh' | 'carteira' | 'fluxo';
      rows: any[];
      fluxo?: Partial<FluxoImportacao>;
    }
  ): Promise<{ ok: boolean; count: number }> {
    this.assertGlobalRole(actor);
    const { kind, rows, fluxo } = payload;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: true, count: 0 };
    }

    if (kind === 'plataformas') {
      await this.storage.upsertMany('plataformas', rows, ['sigla']);
    } else if (kind === 'tecnicos') {
      await this.storage.upsertMany('tecnicos', rows, ['matricula']);
    } else if (kind === 'hh') {
      const hhWithIds = rows.map(r => ({ ...r, id: r.id || generateUuid() }));
      await this.storage.upsertMany('apontamentos_hh', hhWithIds, ['matricula', 'data']);
    } else if (kind === 'carteira') {
      const cartWithIds = rows.map(r => ({ ...r, id: r.id || generateUuid() }));
      await this.storage.upsertMany('carteira_embarques', cartWithIds, ['matricula', 'data_inicio']);
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
