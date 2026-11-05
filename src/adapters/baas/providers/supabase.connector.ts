// ==============================================================================
// Adaptador de Conector Supabase (BaaS Connector)
// Implementa BaaSConnectorPort comunicando-se com o Supabase (PostgreSQL 17, GoTrue, Edge Functions)
// ==============================================================================

import { supabase } from '../../../services/supabase';
import type { BaaSConnectorPort, RawBaaSDatasetPayload } from '../../../ports/baas-connector.port';
import type {
  AdminManageUserResult,
  AuthSessionResult,
  AuthenticatedUserScope
} from '../../../ports/auth.port';
import type {
  ContractConfig,
  PapelOperacional,
  Pessoa,
  SystemAuditLog,
  SystemRole,
  UserOnboarding,
  UserProfile,
  UserPreferences,
  UsoffUnWeight
} from '../../../domain/types';
import { DEFAULT_USER_PREFERENCES } from '../../../config/constants';

const PAGE_SIZE = 1000;

/**
 * Busca todas as páginas de uma query PostgREST acima do limite padrão de 1.000 linhas.
 */
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/**
 * Traduz mensagens técnicas do GoTrue ao atualizar senha.
 */
function translatePasswordError(rawMsg: string): string {
  if (rawMsg.includes('should be different from the old password')) {
    return 'A nova senha deve ser diferente da senha atual/provisória.';
  }
  if (rawMsg.includes('Password should be at least')) {
    return 'A nova senha deve ter no mínimo 8 caracteres.';
  }
  return rawMsg || 'Erro ao alterar senha.';
}

export const supabaseBaaSConnector: BaaSConnectorPort = {
  providerId: 'supabase',

  // ============================================================================
  // 1. AUTENTICAÇÃO PRIMITIVA
  // ============================================================================

  async signIn(cleanEmail: string, password: string): Promise<AuthSessionResult> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password
    });

    if (error) {
      let msg = error.message;
      if (msg.includes('Invalid login credentials')) {
        msg = 'E-mail ou senha incorretos.';
      } else if (msg.includes('Email not confirmed')) {
        msg = 'E-mail ainda não confirmado. Contate o administrador do contrato.';
      } else if (msg.includes('User is banned')) {
        msg = 'Seu acesso está inativo ou bloqueado pela administração.';
      }
      throw new Error(msg);
    }

    return {
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
      session: data.session
        ? {
            access_token: data.session.access_token,
            expires_at: data.session.expires_at
          }
        : null
    };
  },

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async changePasswordAndConfirmFirstLogin(newPassword: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      throw new Error(translatePasswordError(error.message));
    }

    const { error: rpcError } = await supabase.rpc('complete_first_login_password_change');
    if (rpcError) {
      throw new Error(
        rpcError.message || 'Senha alterada, mas houve falha ao confirmar registro de primeiro acesso.'
      );
    }
  },

  async updateOwnProfile(cleanNome: string, preferencias?: UserPreferences): Promise<void> {
    const { error } = await supabase.rpc('update_own_profile', {
      p_nome: cleanNome,
      p_preferencias: preferencias ? JSON.parse(JSON.stringify(preferencias)) : undefined
    });

    if (error) {
      throw new Error(error.message || 'Erro ao salvar configurações do perfil.');
    }
  },

  async fetchCurrentUserScope(): Promise<AuthenticatedUserScope | null> {
    const { data: sessionData, error: sError } = await supabase.auth.getSession();
    if (sError || !sessionData?.session?.user) {
      return null;
    }

    const userId = sessionData.session.user.id;

    const [profileRes, pessoaRes, onbRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, email, nome, role, ativo')
        .eq('id', userId)
        .maybeSingle(),
      supabase
        .from('pessoas')
        .select(`
          id,
          slug,
          nome,
          papel,
          email,
          user_id,
          pessoa_plataformas (plataforma_sigla),
          pessoa_unidades (unidade_negocio)
        `)
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('user_onboarding')
        .select('user_id, primeiro_login, obriga_troca_senha, senha_trocada_em, preferencias')
        .eq('user_id', userId)
        .maybeSingle()
    ]);

    const profileRow = profileRes.data;
    if (profileRes.error || !profileRow || !profileRow.ativo) {
      return null;
    }

    const profile: UserProfile = {
      id: profileRow.id,
      email: profileRow.email,
      nome: profileRow.nome,
      role: profileRow.role as SystemRole,
      ativo: profileRow.ativo
    };

    let pessoa: Pessoa | null = null;
    const pessoaRow = pessoaRes.data;

    if (pessoaRow) {
      const plats: string[] = Array.isArray(pessoaRow.pessoa_plataformas)
        ? pessoaRow.pessoa_plataformas
            .map((item: any) => String(item.plataforma_sigla || ''))
            .filter(Boolean)
        : [];

      const uns: string[] = Array.isArray(pessoaRow.pessoa_unidades)
        ? pessoaRow.pessoa_unidades
            .map((item: any) => String(item.unidade_negocio || ''))
            .filter(Boolean)
        : [];

      pessoa = {
        id: pessoaRow.id,
        slug: pessoaRow.slug,
        nome: pessoaRow.nome,
        papel: pessoaRow.papel as PapelOperacional,
        email: pessoaRow.email,
        user_id: pessoaRow.user_id,
        plats,
        uns
      };
    }

    let onboarding: UserOnboarding;
    const onbRow = onbRes.data;

    if (onbRow) {
      const rawPref =
        onbRow.preferencias && typeof onbRow.preferencias === 'object'
          ? (onbRow.preferencias as Partial<UserPreferences>)
          : {};
      onboarding = {
        user_id: onbRow.user_id,
        primeiro_login: Boolean(onbRow.primeiro_login),
        obriga_troca_senha: Boolean(onbRow.obriga_troca_senha),
        senha_trocada_em: onbRow.senha_trocada_em || null,
        preferencias: {
          ...DEFAULT_USER_PREFERENCES,
          ...rawPref
        }
      };
    } else {
      // Correção da dívida de erros silenciosos: checa erro no upsert de user_onboarding
      const { error: onbUpsertErr } = await supabase.from('user_onboarding').upsert(
        {
          user_id: userId,
          primeiro_login: true,
          obriga_troca_senha: true
        },
        { onConflict: 'user_id' }
      );
      if (onbUpsertErr) throw onbUpsertErr;

      onboarding = {
        user_id: userId,
        primeiro_login: true,
        obriga_troca_senha: true,
        senha_trocada_em: null,
        preferencias: { ...DEFAULT_USER_PREFERENCES }
      };
    }

    return { profile, pessoa, onboarding };
  },

  async invokeAdminUsers(payload: Record<string, unknown>): Promise<AdminManageUserResult> {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: payload
      });

      if (error) {
        let friendlyMsg = error.message;

        // Se o erro for FunctionsHttpError, extrai a mensagem detalhada do corpo retornado pela Edge Function
        if ('context' in error && error.context) {
          try {
            const resClone =
              typeof (error as any).context.clone === 'function'
                ? (error as any).context.clone()
                : (error as any).context;
            if (typeof resClone.json === 'function') {
              const body = await resClone.json();
              if (body && (body.message || body.error)) {
                friendlyMsg = body.message || body.error;
              }
            }
          } catch {
            // Corpo de contexto não pôde ser desserializado em JSON
          }
        }

        if (
          friendlyMsg.includes('Failed to send a request') ||
          friendlyMsg.includes('FunctionsFetchError')
        ) {
          friendlyMsg =
            'Não foi possível conectar à Edge Function administrativa. Verifique sua rede.';
        }
        return { ok: false, message: friendlyMsg };
      }

      if (!data || data.ok === false) {
        return {
          ok: false,
          message:
            data?.message ||
            (payload.action === 'delete-user'
              ? 'Falha ao processar a exclusão da conta.'
              : 'Falha ao processar solicitação de usuário.')
        };
      }

      return {
        ok: true,
        userId: data.userId,
        message: data.message
      };
    } catch (err: any) {
      return {
        ok: false,
        message: err.message || 'Erro inesperado na chamada administrativa.'
      };
    }
  },

  // ============================================================================
  // 2. DADOS PRIMITIVOS
  // ============================================================================

  async fetchRawDataset(
    queryIni: string,
    queryFim: string,
    isGlobal: boolean
  ): Promise<RawBaaSDatasetPayload> {
    const [
      cfgRes,
      usoffWeightsRes,
      platRows,
      pessoasRes,
      tecRows,
      cartRows,
      cartOpRows,
      hhRows,
      justRows,
      wmRes,
      globalExtraRes
    ] = await Promise.all([
      supabase.from('configuracoes').select('*').eq('id', 'geral').maybeSingle(),
      supabase.from('config_usoff_un').select('*'),
      fetchAllPages<any>((from, to) =>
        supabase.from('plataformas').select('*').order('sigla', { ascending: true }).range(from, to)
      ),
      supabase.from('pessoas').select(`
        id,
        slug,
        nome,
        papel,
        email,
        user_id,
        pessoa_plataformas (plataforma_sigla),
        pessoa_unidades (unidade_negocio)
      `),
      fetchAllPages<any>((from, to) =>
        supabase.from('tecnicos').select('*').order('matricula', { ascending: true }).range(from, to)
      ),
      fetchAllPages<any>((from, to) =>
        supabase
          .from('carteira_embarques')
          .select('*')
          .gte('data_fim', queryIni)
          .lte('data_inicio', queryFim)
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllPages<any>((from, to) =>
        (supabase.from('carteira_operacoes') as any)
          .select('*')
          .gte('data_fim', queryIni)
          .lte('data_inicio', queryFim)
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllPages<any>((from, to) =>
        supabase
          .from('apontamentos_hh')
          .select('*')
          .gte('data', queryIni)
          .lte('data', queryFim)
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllPages<any>((from, to) =>
        supabase
          .from('justificativas')
          .select('*')
          .gte('data', queryIni)
          .lte('data', queryFim)
          .order('id', { ascending: true })
          .range(from, to)
      ),
      supabase.rpc('get_watermark_status'),
      isGlobal
        ? Promise.all([
            supabase.from('profiles').select('*'),
            supabase.from('configuracoes_notificacao').select('*').eq('id', 'geral').maybeSingle(),
            supabase
              .from('fluxo_importacoes')
              .select('*')
              .order('criado_em', { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase.from('user_onboarding').select('*')
          ])
        : Promise.all([
            supabase.rpc('get_external_covered_days', { p_ini: queryIni, p_fim: queryFim }),
            null
          ])
    ]);

    let profileRows: any[] | null = null;
    let emailsResumo: string[] | null = null;
    let latestFluxoRow: any = null;
    let onboardingRows: any[] | null = null;
    let externalCoveredRows: any[] | null = null;

    if (isGlobal && Array.isArray(globalExtraRes)) {
      const [profilesQuery, notifQuery, fluxoQuery, onboardingQuery] = globalExtraRes as any[];
      profileRows = profilesQuery?.data || [];
      emailsResumo = notifQuery?.data?.emails_resumo || null;
      latestFluxoRow = fluxoQuery?.data || null;
      onboardingRows = onboardingQuery?.data || [];
    } else if (!isGlobal && Array.isArray(globalExtraRes)) {
      const [extDaysQuery] = globalExtraRes as any[];
      externalCoveredRows = extDaysQuery?.data || [];
    }

    return {
      configRow: cfgRes.data,
      usoffWeightRows: usoffWeightsRes.data || [],
      plataformaRows: platRows,
      pessoaRows: pessoasRes.data || [],
      tecnicoRows: tecRows,
      carteiraRows: cartRows,
      carteiraOperacaoRows: cartOpRows || [],
      hhRows,
      justificativaRows: justRows,
      watermarkRow: wmRes.data,
      profileRows,
      onboardingRows,
      emailsResumo,
      latestFluxoRow,
      externalCoveredRows,
      resolveSharedOps: async (uniqueOps: string[]) => {
        const { data } = await supabase.rpc('get_shared_ops', { p_ops: uniqueOps });
        return Array.isArray(data) ? (data as string[]) : [];
      }
    };
  },

  async upsertJustificativa(cleanRecord: {
    matricula: string;
    data: string;
    motivo: string;
    horas_gangway: number;
    descricao: string;
    responsavel_nome: string;
  }): Promise<void> {
    const { error } = await supabase.from('justificativas').upsert(cleanRecord, {
      onConflict: 'matricula,data'
    });
    if (error) throw error;
  },

  async saveConfiguracoesBundle(
    cfg: ContractConfig,
    unWeights: UsoffUnWeight[],
    emailsResumo: string[]
  ): Promise<void> {
    const { error: cfgErr } = await supabase.from('configuracoes').upsert({
      id: 'geral',
      hh_dia: cfg.hh_dia,
      meta_percentual: cfg.meta_percentual,
      atencao_percentual: cfg.atencao_percentual,
      dias_embarque: cfg.dias_embarque,
      dia_corte_medicao: cfg.dia_corte_medicao,
      prazo_justificativa_dias: cfg.prazo_justificativa_dias,
      med_criterio: cfg.med_criterio,
      us_pe_padrao: cfg.us_pe_padrao,
      us_ex_padrao: cfg.us_ex_padrao,
      slogan: cfg.slogan,
      regionais_extras: cfg.regionais_extras,
      updated_at: new Date().toISOString()
    });

    if (cfgErr) throw cfgErr;

    if (unWeights && unWeights.length > 0) {
      const rows = unWeights.map(w => ({
        unidade_negocio: w.unidade_negocio,
        pe: w.pe,
        ex: w.ex,
        updated_at: new Date().toISOString()
      }));

      const { error: wErr } = await supabase
        .from('config_usoff_un')
        .upsert(rows, { onConflict: 'unidade_negocio' });

      if (wErr) throw wErr;
    }

    if (emailsResumo) {
      const { error: notifErr } = await supabase.from('configuracoes_notificacao').upsert({
        id: 'geral',
        emails_resumo: emailsResumo,
        updated_at: new Date().toISOString()
      });

      if (notifErr) throw notifErr;
    }
  },

  async upsertPlataformasChunk(rows: Array<Record<string, unknown>>): Promise<void> {
    // Correção da dívida de erros silenciosos: checa erro no upsert de plataformas
    const { error } = await supabase.from('plataformas').upsert(rows as any, {
      onConflict: 'sigla'
    });
    if (error) throw error;
  },

  async deletePlataforma(sigla: string): Promise<void> {
    const { error } = await supabase.from('plataformas').delete().eq('sigla', sigla);
    if (error) throw error;
  },

  async savePessoaWithScopes(input: {
    id?: string;
    slug: string;
    nome: string;
    papel: PapelOperacional;
    email: string;
    plats: string[];
    uns: string[];
  }): Promise<Pessoa> {
    let pessoaId = input.id;

    if (pessoaId) {
      const { error: updErr } = await supabase
        .from('pessoas')
        .update({
          nome: input.nome,
          papel: input.papel,
          email: input.email,
          updated_at: new Date().toISOString()
        })
        .eq('id', pessoaId);

      if (updErr) throw updErr;
    } else {
      const { data: insData, error: insErr } = await supabase
        .from('pessoas')
        .insert({
          nome: input.nome,
          slug: input.slug,
          papel: input.papel,
          email: input.email
        })
        .select('id')
        .single();

      if (insErr) throw insErr;
      pessoaId = insData.id;
    }

    // Correção da dívida de erros silenciosos: checa erro na limpeza e inserção de escopos de plataformas
    const { error: delPlatErr } = await supabase
      .from('pessoa_plataformas')
      .delete()
      .eq('pessoa_id', pessoaId);
    if (delPlatErr) throw delPlatErr;

    if (input.plats && input.plats.length > 0) {
      const rowsPlat = Array.from(new Set(input.plats)).map(sigla => ({
        pessoa_id: pessoaId!,
        plataforma_sigla: sigla
      }));
      const { error: plErr } = await supabase.from('pessoa_plataformas').insert(rowsPlat);
      if (plErr) throw plErr;
    }

    // Correção da dívida de erros silenciosos: checa erro na limpeza e inserção de escopos de UNs
    const { error: delUnErr } = await supabase
      .from('pessoa_unidades')
      .delete()
      .eq('pessoa_id', pessoaId);
    if (delUnErr) throw delUnErr;

    if (input.uns && input.uns.length > 0) {
      const rowsUn = Array.from(new Set(input.uns)).map(un => ({
        pessoa_id: pessoaId!,
        unidade_negocio: un
      }));
      const { error: unErr } = await supabase.from('pessoa_unidades').insert(rowsUn);
      if (unErr) throw unErr;
    }

    return {
      id: pessoaId!,
      slug: input.slug,
      nome: input.nome,
      papel: input.papel,
      email: input.email,
      user_id: null,
      plats: input.plats || [],
      uns: input.uns || []
    };
  },

  async deletePessoa(id: string): Promise<void> {
    // 1. Busca a pessoa para identificar se possui user_id vinculado ou perfil associado
    const { data: pessoa, error: pesErr } = await supabase
      .from('pessoas')
      .select('id, user_id, email')
      .eq('id', id)
      .maybeSingle();

    if (pesErr) throw pesErr;

    let targetUserId = pessoa?.user_id;

    // Se user_id não estava salvo diretamente na pessoa, verifica correspondência em profiles pelo e-mail
    if (!targetUserId && pessoa?.email) {
      const cleanEmail = pessoa.email.trim().toLowerCase();
      if (cleanEmail) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', cleanEmail)
          .maybeSingle();
        if (prof?.id) {
          targetUserId = prof.id;
        }
      }
    }

    // 2. Se possuir credenciais vinculadas, remove primeiro as credenciais via Edge Function admin-users
    if (targetUserId) {
      const res = await this.invokeAdminUsers({
        action: 'delete-user',
        userId: targetUserId
      });
      // Se não der ok e o erro não for de usuário já inexistente, aborta para não deixar estado inconsistente
      if (!res.ok && !res.message?.toLowerCase().includes('não encontrado')) {
        throw new Error(res.message || 'Falha ao remover credenciais vinculadas ao usuário.');
      }
    }

    // 3. Exclui a pessoa da tabela pessoas (pessoa_plataformas e pessoa_unidades sofrem CASCADE automático)
    const { error } = await supabase.from('pessoas').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertTecnicosChunk(
    rows: Array<{ matricula: string; nome: string; funcao: string }>
  ): Promise<void> {
    // Correção da dívida de erros silenciosos: checa erro no upsert de técnicos
    const { error } = await supabase.from('tecnicos').upsert(rows, { onConflict: 'matricula' });
    if (error) throw error;
  },

  async upsertApontamentosChunk(rows: Array<Record<string, unknown>>): Promise<void> {
    const { error } = await supabase
      .from('apontamentos_hh')
      .upsert(rows as any, { onConflict: 'matricula,data' });
    if (error) throw error;
  },

  async upsertCarteiraChunk(rows: Array<Record<string, unknown>>): Promise<void> {
    // Sanitização para Supabase: remove coluna 'operacao' (removida fisicamente na migration 013)
    const sanitized = rows.map(({ operacao, ...rest }) => rest);
    const { error } = await supabase
      .from('carteira_embarques')
      .upsert(sanitized as any, { onConflict: 'matricula,data_inicio' });
    if (error) throw error;
  },

  async upsertCarteiraOperacoesChunk(rows: Array<Record<string, unknown>>): Promise<void> {
    const { error } = await (supabase.from('carteira_operacoes') as any)
      .upsert(rows, { onConflict: 'matricula,data_inicio,ordem,operacao' });
    if (error) throw error;
  },

  async upsertConfirmacoesSAPChunk(rows: Array<Record<string, unknown>>): Promise<void> {
    const { error } = await (supabase.from('confirmacoes_sap') as any)
      .upsert(rows, { onConflict: 'matricula,data_criacao,data_lancamento,data_fim_real,ordem,operacao,horas_confirmadas,contador_confirmacao' });
    if (error) throw error;
  },

  async reconciliarConfirmacoesSAPRPC(): Promise<any> {
    const { data, error } = await supabase.rpc('reconciliar_confirmacoes_sap');
    if (error) throw error;
    return data;
  },

  async resetCarteiraEmbarquesRPC(): Promise<{ deleted_operacoes: number; deleted_embarques: number }> {
    const { data, error } = await supabase.rpc('reset_carteira_embarques');
    if (error) throw error;
    return data as any;
  },

  async insertFluxoImportacao(row: {
    tipo_fluxo: 'hh' | 'carteira';
    origem: string;
    total_linhas: number;
    data_maxima: string | null;
    observacao: string;
  }): Promise<void> {
    // Correção da dívida de erros silenciosos: checa erro no registro de fluxo
    const { error } = await supabase.from('fluxo_importacoes').insert(row);
    if (error) throw error;
  },

  async fetchRawAuditLogs(filters?: { category?: string; limit?: number }): Promise<SystemAuditLog[]> {
    try {
      let query = supabase
        .from('system_audit_logs')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.category && filters.category !== 'all') {
        query = query.eq('category', filters.category);
      }

      const maxLimit = filters?.limit && filters.limit > 0 ? filters.limit : 100;
      query = query.limit(maxLimit);

      const { data, error } = await query;
      if (error) {
        console.warn('Erro ao consultar system_audit_logs:', error.message);
        return [];
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        actor_id: row.actor_id ?? null,
        actor_nome: row.actor_nome ?? null,
        actor_email: row.actor_email ?? null,
        actor_role: row.actor_role ?? null,
        action: row.action,
        category: row.category,
        target_id: row.target_id ?? null,
        target_label: row.target_label ?? null,
        details: row.details && typeof row.details === 'object' ? row.details : {},
        ip_address: row.ip_address ?? null,
        created_at: row.created_at
      }));
    } catch (err) {
      console.warn('Falha inesperada ao buscar logs de auditoria:', err);
      return [];
    }
  },

  async insertAuditLog(event: Partial<SystemAuditLog>): Promise<void> {
    try {
      let actorId = event.actor_id;
      let actorNome = event.actor_nome;
      let actorEmail = event.actor_email;
      let actorRole = event.actor_role;

      if (!actorId || !actorEmail) {
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          actorId = actorId || data.user.id;
          actorEmail = actorEmail || data.user.email || null;
          actorNome = actorNome || data.user.user_metadata?.nome || null;
          actorRole = actorRole || data.user.user_metadata?.role || null;
        }
      }

      const payload = {
        actor_id: actorId || null,
        actor_nome: actorNome || null,
        actor_email: actorEmail || null,
        actor_role: actorRole || null,
        action: event.action || 'evento',
        category: event.category || 'operacional',
        target_id: event.target_id || null,
        target_label: event.target_label || null,
        details: event.details || {},
        ip_address: event.ip_address || null
      };

      const { error } = await supabase.from('system_audit_logs').insert(payload);
      if (error) {
        console.warn('Não foi possível gravar o log de auditoria no Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Erro ao disparar logSystemEvent:', err);
    }
  },

  // ============================================================================
  // 3. TEMPO REAL PRIMITIVO
  // ============================================================================

  subscribeRawChanges(trigger: () => void): () => void {
    const channel = supabase
      .channel('realtime-hh-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'justificativas' },
        () => {
          trigger();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_heartbeat' },
        () => {
          trigger();
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('Realtime channel error — tentando reconectar automaticamente...');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }
};
