// ==============================================================================
// Pipeline de Cliente Compartilhado (Shared Client Pipeline)
// Lógica agnóstica de preparação topológica, batch chunking anti-deadlock,
// validação de políticas, montagem de AppDataset e subscrição Realtime
// ==============================================================================

import type {
  AppDataset,
  ApontamentoHH,
  CarteiraEmbarque,
  ContractConfig,
  FluxoImportacao,
  Justificativa,
  PapelOperacional,
  Pessoa,
  Plataforma,
  SystemAuditLog,
  Tecnico,
  UserOnboarding,
  UserProfile,
  UserPreferences,
  UsoffUnWeight,
  WatermarkStatus
} from '../../domain/types';
import { DEFAULT_CONFIG, DEFAULT_USER_PREFERENCES } from '../../config/constants';
import { todayIso } from '../../utils/date';
import { platformKey, slugify } from '../../utils/format';
import { lookupPlatform } from '../../domain/calculations';
import type { ClientDatabaseProvider } from '../../ports/client-provider.port';
import type { BaaSConnectorPort, RawBaaSDatasetPayload } from '../../ports/baas-connector.port';
import type { ClientAuthPort } from '../../ports/auth.port';
import type {
  AuditLogFilterInput,
  BatchImportCarteiraRow,
  BatchImportHHRow,
  BatchImportPessoaRow,
  BatchImportPlataformaRow,
  ClientDataPort,
  ProgressCallback,
  SavePessoaInput
} from '../../ports/data.port';
import type { ClientRealtimePort } from '../../ports/realtime.port';

export const CHUNK_SIZE = 500;

/**
 * Normaliza e sanitiza endereço de e-mail para comparações seguras.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Valida a política corporativa de senhas (mínimo 8 caracteres, letras e números).
 * Lança exatamente as mensagens padronizadas em pt-BR.
 */
export function validateNewPasswordPolicy(newPassword: string): void {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('A nova senha deve ter no mínimo 8 caracteres.');
  }
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    throw new Error('A nova senha deve combinar letras e números para sua segurança.');
  }
}

/**
 * Prepara o lote de apontamentos HH diários:
 * - Identifica plataformas inéditas para pré-cadastro como pendentes;
 * - Extrai lista única de técnicos para integridade referencial;
 * - Ordena apontamentos de forma determinística por (matricula, data) anti-deadlock (40P01).
 */
export function prepareBatchHH(
  rows: BatchImportHHRow[],
  pidx: Record<string, Plataforma>
): {
  pendingPlataformas: Array<{
    sigla: string;
    chave_norm: string;
    nome: string;
    cadastro_pendente: boolean;
  }>;
  uniqueTecnicos: Array<{
    matricula: string;
    nome: string;
    funcao: string;
  }>;
  hhPayload: Array<{
    matricula: string;
    data: string;
    plataforma_sigla: string | null;
    unidade_negocio: string;
    horas_executadas: number;
    updated_at: string;
  }>;
  maxDate: string;
} {
  const unknownPlats = new Map<string, string>();
  const preparedRows = rows.map(r => {
    const pFound = lookupPlatform(pidx, r.p);
    const resolvedSigla = pFound ? pFound.sigla : r.p.trim().toUpperCase();
    const resolvedUn = pFound ? pFound.un : r.r?.trim() || '';

    if (!pFound && resolvedSigla) {
      unknownPlats.set(resolvedSigla, r.p.trim());
    }

    return {
      matricula: r.mat.trim(),
      nome: r.nome?.trim() || '',
      funcao: r.funcao?.trim() || '',
      plataforma_sigla: resolvedSigla || null,
      unidade_negocio: resolvedUn,
      data: r.D,
      horas_executadas: r.e
    };
  });

  const pendingPlataformas = Array.from(unknownPlats.entries()).map(([sigla, rawName]) => ({
    sigla,
    chave_norm: platformKey(sigla),
    nome: rawName || sigla,
    cadastro_pendente: true
  }));

  const tecMap = new Map<string, { matricula: string; nome: string; funcao: string }>();
  preparedRows.forEach(r => {
    if (r.matricula && !tecMap.has(r.matricula)) {
      tecMap.set(r.matricula, {
        matricula: r.matricula,
        nome: r.nome || `Técnico ${r.matricula}`,
        funcao: r.funcao || 'Técnico'
      });
    }
  });

  const uniqueTecnicos = Array.from(tecMap.values()).sort((a, b) =>
    a.matricula.localeCompare(b.matricula)
  );

  const hhPayload = preparedRows
    .map(r => ({
      matricula: r.matricula,
      data: r.data,
      plataforma_sigla: r.plataforma_sigla,
      unidade_negocio: r.unidade_negocio,
      horas_executadas: r.horas_executadas,
      updated_at: new Date().toISOString()
    }))
    .sort((a, b) => {
      const cmp = a.matricula.localeCompare(b.matricula);
      return cmp !== 0 ? cmp : a.data.localeCompare(b.data);
    });

  const maxDate = rows.reduce((max, r) => (r.D > max ? r.D : max), '');

  return { pendingPlataformas, uniqueTecnicos, hhPayload, maxDate };
}

/**
 * Prepara o lote de registros de carteira de embarques:
 * - Identifica plataformas inéditas para pré-cadastro como pendentes;
 * - Extrai lista única de técnicos para integridade referencial;
 * - Ordena registros por (matricula, data_inicio) anti-deadlock.
 */
export function prepareBatchCarteira(
  rows: BatchImportCarteiraRow[],
  pidx: Record<string, Plataforma>
): {
  pendingPlataformas: Array<{
    sigla: string;
    chave_norm: string;
    nome: string;
    cadastro_pendente: boolean;
  }>;
  uniqueTecnicos: Array<{
    matricula: string;
    nome: string;
    funcao: string;
  }>;
  cartPayload: Array<{
    matricula: string;
    plataforma_sigla: string | null;
    unidade_negocio: string;
    data_inicio: string;
    data_fim: string;
    horas_programadas: number | null;
    operacao: string;
    pe: number | null;
    ex: number | null;
    fonte: string;
    updated_at: string;
  }>;
  maxDate: string;
} {
  const unknownPlats = new Map<string, string>();
  const preparedRows = rows.map(r => {
    const pFound = lookupPlatform(pidx, r.plat);
    const resolvedSigla = pFound ? pFound.sigla : r.plat.trim().toUpperCase();
    const resolvedUn = pFound ? pFound.un : r.reg?.trim() || '';

    if (!pFound && resolvedSigla) {
      unknownPlats.set(resolvedSigla, r.plat.trim());
    }

    return {
      matricula: r.mat.trim(),
      nome: r.nome?.trim() || '',
      funcao: r.funcao?.trim() || '',
      plataforma_sigla: resolvedSigla || null,
      unidade_negocio: resolvedUn,
      data_inicio: r.ini,
      data_fim: r.fim,
      horas_programadas: r.hp != null ? Number(r.hp) : null,
      operacao: r.op?.trim() || '',
      id_embarque: r.id_embarque?.trim() || r.op?.trim() || '',
      pe: r.pe != null ? Number(r.pe) : null,
      ex: r.ex != null ? Number(r.ex) : null
    };
  });

  const pendingPlataformas = Array.from(unknownPlats.entries()).map(([sigla, rawName]) => ({
    sigla,
    chave_norm: platformKey(sigla),
    nome: rawName || sigla,
    cadastro_pendente: true
  }));

  const tecMap = new Map<string, { matricula: string; nome: string; funcao: string }>();
  preparedRows.forEach(r => {
    if (r.matricula && !tecMap.has(r.matricula)) {
      tecMap.set(r.matricula, {
        matricula: r.matricula,
        nome: r.nome || `Técnico ${r.matricula}`,
        funcao: r.funcao || 'Técnico'
      });
    }
  });

  const uniqueTecnicos = Array.from(tecMap.values()).sort((a, b) =>
    a.matricula.localeCompare(b.matricula)
  );

  const cartPayload = preparedRows
    .map(r => ({
      matricula: r.matricula,
      plataforma_sigla: r.plataforma_sigla,
      unidade_negocio: r.unidade_negocio,
      data_inicio: r.data_inicio,
      data_fim: r.data_fim,
      horas_programadas: r.horas_programadas,
      operacao: r.operacao,
      id_embarque: r.id_embarque,
      pe: r.pe,
      ex: r.ex,
      fonte: 'carteira',
      updated_at: new Date().toISOString()
    }))
    .sort((a, b) => {
      const cmp = a.matricula.localeCompare(b.matricula);
      return cmp !== 0 ? cmp : a.data_inicio.localeCompare(b.data_inicio);
    });

  const maxDate = rows.reduce((max, r) => (r.fim > max ? r.fim : max), '');

  return { pendingPlataformas, uniqueTecnicos, cartPayload, maxDate };
}

/**
 * Prepara o lote de plataformas sanitizando siglas e normalizando chaves.
 */
export function prepareBatchPlataformas(
  rows: BatchImportPlataformaRow[]
): Array<{
  sigla: string;
  chave_norm: string;
  nome: string;
  un: string;
  armador: string;
  tipo: string;
  situacao: string;
  cadastro_pendente: boolean;
  updated_at: string;
}> {
  return rows.map(r => {
    const sigla = r.sigla.trim().toUpperCase();
    return {
      sigla,
      chave_norm: platformKey(sigla),
      nome: r.nome?.trim() || sigla,
      un: r.un?.trim() || '',
      armador: r.armador?.trim() || '',
      tipo: r.tipo?.trim() || '',
      situacao: r.situacao || 'Mobilizada',
      cadastro_pendente: false,
      updated_at: new Date().toISOString()
    };
  });
}

/**
 * Filtra registros de auditoria em memória por termo de busca.
 */
export function filterAuditLogsClientSide(
  rows: SystemAuditLog[],
  search?: string
): SystemAuditLog[] {
  if (!search || !search.trim()) return rows;
  const term = search.trim().toLowerCase();
  return rows.filter(
    r =>
      (r.action && r.action.toLowerCase().includes(term)) ||
      (r.actor_nome && r.actor_nome.toLowerCase().includes(term)) ||
      (r.actor_email && r.actor_email.toLowerCase().includes(term)) ||
      (r.target_label && r.target_label.toLowerCase().includes(term)) ||
      (r.category && r.category.toLowerCase().includes(term))
  );
}

/**
 * Cria função de subscrição com debounce para eventos de realtime.
 */
export function createDebouncedRealtimeSubscriber(
  subscribeRaw: (notify: () => void) => () => void,
  debounceMs = 450
): (onChange: () => void) => () => void {
  return (onChange: () => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const debouncedOnChange = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        try {
          onChange();
        } catch (err) {
          console.error('Erro ao executar callback do Realtime:', err);
        }
      }, debounceMs);
    };

    const unsubscribe = subscribeRaw(debouncedOnChange);

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe();
    };
  };
}

/**
 * Monta o dataset completo da aplicação a partir de dados brutos retornados pelo BaaS.
 * Garante compatibilidade 100% com o formato consumido pelo AppContext e motor de domínio.
 */
export async function assembleAppDataset(
  raw: RawBaaSDatasetPayload,
  isGlobal: boolean
): Promise<AppDataset> {
  // 1. Configurações gerais
  const cfg = raw.configRow;
  const config: ContractConfig = cfg
    ? {
        id: String(cfg.id ?? 'geral'),
        hh_dia: Number(cfg.hh_dia),
        meta_percentual: Number(cfg.meta_percentual),
        atencao_percentual: Number(cfg.atencao_percentual),
        dias_embarque: Number(cfg.dias_embarque),
        dia_corte_medicao: cfg.dia_corte_medicao as any,
        prazo_justificativa_dias: Number(cfg.prazo_justificativa_dias),
        med_criterio: cfg.med_criterio as any,
        us_pe_padrao: cfg.us_pe_padrao != null ? Number(cfg.us_pe_padrao) : null,
        us_ex_padrao: cfg.us_ex_padrao != null ? Number(cfg.us_ex_padrao) : null,
        slogan: String(cfg.slogan || ''),
        regionais_extras: Array.isArray(cfg.regionais_extras) ? (cfg.regionais_extras as string[]) : []
      }
    : { ...DEFAULT_CONFIG };

  // 2. Pesos USOFF por UN
  const usoffUnWeights: Record<string, UsoffUnWeight> = {};
  (raw.usoffWeightRows || []).forEach(row => {
    const un = String(row.unidade_negocio || '');
    if (un) {
      usoffUnWeights[un] = {
        unidade_negocio: un,
        pe: row.pe != null ? Number(row.pe) : null,
        ex: row.ex != null ? Number(row.ex) : null
      };
    }
  });

  // 3. Catálogo de plataformas
  const plataformas: Record<string, Plataforma> = {};
  (raw.plataformaRows || []).forEach(row => {
    const sigla = String(row.sigla || '');
    if (sigla) {
      plataformas[sigla] = {
        sigla,
        chave_norm: String(row.chave_norm || platformKey(sigla)),
        nome: String(row.nome || sigla),
        un: String(row.un || ''),
        armador: String(row.armador || ''),
        gerencia: String(row.gerencia || ''),
        tipo: String(row.tipo || ''),
        situacao: String(row.situacao || 'Mobilizada'),
        cadastro_pendente: Boolean(row.cadastro_pendente)
      };
    }
  });

  // 4. Catálogo de pessoas e atribuições
  const pessoas: Record<string, Pessoa> = {};
  (raw.pessoaRows || []).forEach((row: any) => {
    const id = String(row.id || '');
    if (!id) return;
    const plats = Array.isArray(row.pessoa_plataformas)
      ? row.pessoa_plataformas.map((p: any) => String(p.plataforma_sigla || '')).filter(Boolean)
      : Array.isArray(row.plats)
        ? row.plats.map((p: any) => String(p || '')).filter(Boolean)
        : [];
    const uns = Array.isArray(row.pessoa_unidades)
      ? row.pessoa_unidades.map((u: any) => String(u.unidade_negocio || '')).filter(Boolean)
      : Array.isArray(row.uns)
        ? row.uns.map((u: any) => String(u || '')).filter(Boolean)
        : [];

    pessoas[id] = {
      id,
      slug: String(row.slug || ''),
      nome: String(row.nome || ''),
      papel: row.papel as PapelOperacional,
      email: String(row.email || ''),
      user_id: row.user_id ? String(row.user_id) : null,
      plats,
      uns
    };
  });

  // 5. Técnicos
  const tecnicos: Record<string, Tecnico> = {};
  (raw.tecnicoRows || []).forEach(row => {
    const mat = String(row.matricula || '');
    if (mat) {
      tecnicos[mat] = {
        matricula: mat,
        nome: String(row.nome || ''),
        funcao: String(row.funcao || '')
      };
    }
  });

  // 6. Carteira de embarques
  const carteira: CarteiraEmbarque[] = (raw.carteiraRows || []).map(row => {
    const mat = String(row.matricula || '');
    const idEmb = String(row.id_embarque || (row as any).operacao || '');
    return {
      id: String(row.id || ''),
      id_embarque: idEmb,
      matricula: mat,
      nome: tecnicos[mat]?.nome || String(row.nome || ''),
      funcao: tecnicos[mat]?.funcao || String(row.funcao || ''),
      plataforma_sigla: String(row.plataforma_sigla || ''),
      unidade_negocio: String(row.unidade_negocio || ''),
      data_inicio: String(row.data_inicio || ''),
      data_fim: String(row.data_fim || ''),
      horas_programadas: row.horas_programadas != null ? Number(row.horas_programadas) : null,
      hh_carteira: row.hh_carteira != null ? Number(row.hh_carteira) : 0,
      hh_fora_carteira: row.hh_fora_carteira != null ? Number(row.hh_fora_carteira) : 0,
      hh_cancelado: row.hh_cancelado != null ? Number(row.hh_cancelado) : 0,
      operacao: idEmb,
      pe: row.pe != null ? Number(row.pe) : null,
      ex: row.ex != null ? Number(row.ex) : null,
      fonte: String(row.fonte || 'carteira')
    };
  });

  // 7. Apontamentos HH
  const hhMap: Record<string, ApontamentoHH> = {};
  (raw.hhRows || []).forEach(row => {
    const mat = String(row.matricula || '');
    const data = String(row.data || '');
    const key = `${mat}|${data}`;
    hhMap[key] = {
      id: row.id ? String(row.id) : undefined,
      matricula: mat,
      data,
      plataforma_sigla: String(row.plataforma_sigla || ''),
      unidade_negocio: String(row.unidade_negocio || ''),
      horas_executadas: Number(row.horas_executadas || 0)
    };
  });

  // 8. Justificativas
  const justMap: Record<string, Justificativa> = {};
  (raw.justificativaRows || []).forEach(row => {
    const mat = String(row.matricula || '');
    const data = String(row.data || '');
    const key = `${mat}|${data}`;
    justMap[key] = {
      id: row.id ? String(row.id) : undefined,
      matricula: mat,
      data,
      motivo: String(row.motivo || ''),
      horas_gangway: Number(row.horas_gangway || 0),
      descricao: String(row.descricao || ''),
      responsavel_nome: String(row.responsavel_nome || ''),
      criado_por: row.criado_por ? String(row.criado_por) : null,
      criado_em: row.criado_em ? String(row.criado_em) : undefined,
      updated_by: row.updated_by ? String(row.updated_by) : null,
      updated_at: row.updated_at ? String(row.updated_at) : undefined
    };
  });

  // 9. Marca d'água
  const wmFirst = Array.isArray(raw.watermarkRow)
    ? (raw.watermarkRow.length > 0 ? raw.watermarkRow[0] : null)
    : raw.watermarkRow;
  const watermark: WatermarkStatus = {
    ultima_data_hh: wmFirst?.ultima_data_hh ? String(wmFirst.ultima_data_hh) : null,
    ultima_importacao_em: wmFirst?.ultima_importacao_em ? String(wmFirst.ultima_importacao_em) : null
  };

  // 10. Perfis, onboarding, notificações e escopo restrito
  const profiles: Record<string, UserProfile> = {};
  const onboardingMap: Record<string, UserOnboarding> = {};
  let emailsResumo: string[] = [];
  let latestFluxo: FluxoImportacao | null = null;
  const externalCoveredSet = new Set<string>();
  const sharedOpsSet = new Set<string>();

  if (isGlobal) {
    (raw.profileRows || []).forEach((row: any) => {
      const id = String(row.id || '');
      if (id) {
        profiles[id] = {
          id,
          email: String(row.email || ''),
          nome: String(row.nome || ''),
          role: row.role,
          ativo: Boolean(row.ativo)
        };
      }
    });

    (raw.onboardingRows || []).forEach((row: any) => {
      const uid = String(row.user_id || '');
      if (uid) {
        const rawPref = (row.preferencias && typeof row.preferencias === 'object') ? row.preferencias : {};
        onboardingMap[uid] = {
          user_id: uid,
          primeiro_login: Boolean(row.primeiro_login),
          obriga_troca_senha: Boolean(row.obriga_troca_senha),
          senha_trocada_em: row.senha_trocada_em ? String(row.senha_trocada_em) : null,
          preferencias: {
            ...DEFAULT_USER_PREFERENCES,
            ...rawPref
          }
        };
      }
    });

    if (Array.isArray(raw.emailsResumo)) {
      emailsResumo = raw.emailsResumo;
    }

    if (raw.latestFluxoRow) {
      latestFluxo = {
        id: String(raw.latestFluxoRow.id || ''),
        tipo_fluxo: raw.latestFluxoRow.tipo_fluxo as any,
        origem: String(raw.latestFluxoRow.origem || ''),
        total_linhas: Number(raw.latestFluxoRow.total_linhas || 0),
        data_maxima: raw.latestFluxoRow.data_maxima ? String(raw.latestFluxoRow.data_maxima) : null,
        observacao: String(raw.latestFluxoRow.observacao || ''),
        criado_em: String(raw.latestFluxoRow.criado_em || '')
      };
    }
  } else {
    (raw.externalCoveredRows || []).forEach(row => {
      if (row.matricula && row.data) {
        externalCoveredSet.add(`${row.matricula}|${row.data}`);
      }
    });

    if (Array.isArray(raw.sharedOps)) {
      raw.sharedOps.forEach(op => {
        if (op) sharedOpsSet.add(op);
      });
    } else {
      const uniqueOps = Array.from(new Set(carteira.map(c => c.operacao).filter(Boolean)));
      if (uniqueOps.length > 0 && typeof raw.resolveSharedOps === 'function') {
        try {
          const sharedOps = await raw.resolveSharedOps(uniqueOps);
          if (Array.isArray(sharedOps)) {
            sharedOps.forEach(op => sharedOpsSet.add(op));
          }
        } catch (err) {
          console.warn('Erro ao resolver sharedOps no BaaS:', err);
        }
      }
    }
  }

  // 11. Checagem de modo demonstração (quando banco está vazio)
  let isDemo = false;
  let demoReason = '';

  const hasRealData =
    Object.keys(hhMap).length > 0 ||
    carteira.length > 0 ||
    watermark.ultima_data_hh != null;

  if (!hasRealData) {
    try {
      const demoModule = await import('../../domain/demo');
      if (typeof demoModule.buildDemoOverlay === 'function') {
        const demoOverlay = demoModule.buildDemoOverlay(todayIso(), plataformas, pessoas);

        if (demoOverlay.carteira) {
          carteira.push(...demoOverlay.carteira);
        }
        if (demoOverlay.hhMap) {
          Object.assign(hhMap, demoOverlay.hhMap);
        }
        if (demoOverlay.tecnicos) {
          Object.assign(tecnicos, demoOverlay.tecnicos);
        }
        if (demoOverlay.justMap) {
          Object.assign(justMap, demoOverlay.justMap);
        }
        if (demoOverlay.plataformas) {
          Object.assign(plataformas, demoOverlay.plataformas);
        }
        if (demoOverlay.watermark) {
          Object.assign(watermark, demoOverlay.watermark);
        }

        isDemo = true;
        demoReason = 'Sem apontamentos ou embarques reais cadastrados. Exibindo dados simulados de demonstração.';
      }
    } catch (err) {
      console.warn('buildDemoOverlay não carregou:', err);
    }
  }

  return {
    config,
    usoffUnWeights,
    emailsResumo,
    plataformas,
    pessoas,
    profiles,
    onboardingMap,
    tecnicos,
    carteira,
    hhMap,
    justMap,
    externalCoveredSet,
    sharedOpsSet,
    watermark,
    latestFluxo,
    isDemo,
    demoReason
  };
}

/**
 * Cria uma instância de ClientDatabaseProvider sobre qualquer BaaSConnectorPort.
 * Aplica automaticamente validações de senha, batching anti-deadlock e debounce Realtime.
 */
export function createBaaSClientProvider(connector: BaaSConnectorPort): ClientDatabaseProvider {
  const auth: ClientAuthPort = {
    async signInWithPassword(email: string, password: string) {
      const cleanEmail = normalizeEmail(email);
      return connector.signIn(cleanEmail, password);
    },
    async signOut() {
      await connector.signOut();
    },
    async updateOwnPassword(newPassword: string) {
      validateNewPasswordPolicy(newPassword);
      await connector.changePasswordAndConfirmFirstLogin(newPassword);
    },
    async completeFirstLoginPassword(newPassword: string) {
      await this.updateOwnPassword(newPassword);
    },
    async saveOwnProfileAndPreferences(nome: string, preferencias?: UserPreferences) {
      await connector.updateOwnProfile(nome.trim(), preferencias);
    },
    async fetchCurrentUserScope() {
      return connector.fetchCurrentUserScope();
    },
    async adminManageUser(payload: Record<string, unknown>) {
      return connector.invokeAdminUsers(payload);
    }
  };

  const data: ClientDataPort = {
    async loadAppDataset(queryIni: string, queryFim: string, isGlobal: boolean) {
      const raw = await connector.fetchRawDataset(queryIni, queryFim, isGlobal);
      return assembleAppDataset(raw, isGlobal);
    },
    async saveJustificativa(just) {
      await connector.upsertJustificativa({
        matricula: String(just.matricula).trim(),
        data: String(just.data).trim(),
        motivo: String(just.motivo).trim(),
        horas_gangway: Math.max(0, Number(just.horas_gangway || 0)),
        descricao: String(just.descricao || '').trim(),
        responsavel_nome: String(just.responsavel_nome || '').trim()
      });
    },
    async saveConfiguracoes(cfg, unWeights, emailsResumo) {
      await connector.saveConfiguracoesBundle(cfg, unWeights, emailsResumo);
    },
    async savePlataforma(plat) {
      const siglaUpper = plat.sigla.trim().toUpperCase();
      const chaveNorm = platformKey(siglaUpper);
      await connector.upsertPlataformasChunk([
        {
          sigla: siglaUpper,
          chave_norm: chaveNorm,
          nome: plat.nome?.trim() || siglaUpper,
          un: plat.un?.trim() || '',
          armador: plat.armador?.trim() || '',
          gerencia: plat.gerencia?.trim() || '',
          tipo: plat.tipo?.trim() || '',
          situacao: plat.situacao || 'Mobilizada',
          cadastro_pendente: false,
          updated_at: new Date().toISOString()
        }
      ]);
    },
    async deletePlataforma(sigla: string) {
      await connector.deletePlataforma(sigla);
    },
    async savePessoa(input: SavePessoaInput) {
      const cleanNome = input.nome.trim();
      const cleanEmail = normalizeEmail(input.email);
      const cleanSlug = slugify(cleanNome) + (input.id ? '' : `-${Date.now().toString().slice(-4)}`);
      return connector.savePessoaWithScopes({
        id: input.id,
        slug: cleanSlug,
        nome: cleanNome,
        papel: input.papel,
        email: cleanEmail,
        plats: input.plats || [],
        uns: input.uns || []
      });
    },
    async deletePessoa(id: string) {
      await connector.deletePessoa(id);
    },
    async batchImportHH(rows, pidx, onProgress, origem = 'planilha (manual)') {
      if (!rows.length) return;
      const prepared = prepareBatchHH(rows, pidx);

      if (prepared.pendingPlataformas.length > 0) {
        await connector.upsertPlataformasChunk(prepared.pendingPlataformas);
      }

      for (let i = 0; i < prepared.uniqueTecnicos.length; i += CHUNK_SIZE) {
        const chunk = prepared.uniqueTecnicos.slice(i, i + CHUNK_SIZE);
        await connector.upsertTecnicosChunk(chunk);
      }

      const total = prepared.hhPayload.length;
      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = prepared.hhPayload.slice(i, i + CHUNK_SIZE);
        await connector.upsertApontamentosChunk(chunk);
        onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
      }

      await connector.insertFluxoImportacao({
        tipo_fluxo: 'hh',
        origem,
        total_linhas: total,
        data_maxima: prepared.maxDate || null,
        observacao: `Importação em lote de ${total} apontamentos HH.`
      });
    },
    async batchImportCarteira(rows, pidx, onProgress, origem = 'planilha (manual)') {
      if (!rows.length) return;
      const prepared = prepareBatchCarteira(rows, pidx);

      if (prepared.pendingPlataformas.length > 0) {
        await connector.upsertPlataformasChunk(prepared.pendingPlataformas);
      }

      for (let i = 0; i < prepared.uniqueTecnicos.length; i += CHUNK_SIZE) {
        const chunk = prepared.uniqueTecnicos.slice(i, i + CHUNK_SIZE);
        await connector.upsertTecnicosChunk(chunk);
      }

      const total = prepared.cartPayload.length;
      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = prepared.cartPayload.slice(i, i + CHUNK_SIZE);
        await connector.upsertCarteiraChunk(chunk);
        onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
      }

      await connector.insertFluxoImportacao({
        tipo_fluxo: 'carteira',
        origem,
        total_linhas: total,
        data_maxima: prepared.maxDate || null,
        observacao: `Importação em lote de ${total} registros de carteira.`
      });
    },
    async batchImportPlataformas(rows, onProgress) {
      if (!rows.length) return;
      const prepared = prepareBatchPlataformas(rows);
      const total = prepared.length;
      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = prepared.slice(i, i + CHUNK_SIZE);
        await connector.upsertPlataformasChunk(chunk);
        onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
      }
    },
    async batchImportPessoas(rows, onProgress) {
      const total = rows.length;
      let count = 0;
      for (const r of rows) {
        const cleanNome = r.nome.trim();
        const cleanEmail = normalizeEmail(r.email);
        const cleanSlug = slugify(cleanNome) + `-${Date.now().toString().slice(-4)}`;
        await connector.savePessoaWithScopes({
          slug: cleanSlug,
          nome: cleanNome,
          papel: r.papel,
          email: cleanEmail,
          plats: r.plats || [],
          uns: r.uns || []
        });
        count++;
        onProgress?.(count, total);
      }
    },
    async fetchSystemAuditLogs(filters?: AuditLogFilterInput) {
      const rawLogs = await connector.fetchRawAuditLogs({
        category: filters?.category,
        limit: filters?.limit
      });
      return filterAuditLogsClientSide(rawLogs, filters?.search);
    },
    async deleteUserAccount(userId: string) {
      try {
        const res = await connector.invokeAdminUsers({ action: 'delete-user', userId });
        return {
          ok: res.ok,
          message:
            res.message ||
            (res.ok ? 'Conta de usuário excluída com sucesso.' : 'Falha ao processar a exclusão da conta.')
        };
      } catch (err: any) {
        return {
          ok: false,
          message: err.message || 'Erro inesperado ao excluir conta de usuário.'
        };
      }
    },
    async logSystemEvent(event: Partial<SystemAuditLog>) {
      try {
        await connector.insertAuditLog(event);
      } catch (err) {
        console.warn('Erro ao disparar logSystemEvent:', err);
      }
    }
  };

  const realtime: ClientRealtimePort = {
    subscribeToRealtimeUpdates: createDebouncedRealtimeSubscriber(
      connector.subscribeRawChanges.bind(connector)
    )
  };

  return {
    topology: 'baas',
    providerId: connector.providerId,
    auth,
    data,
    realtime
  };
}
