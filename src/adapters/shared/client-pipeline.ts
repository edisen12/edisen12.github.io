// ==============================================================================
// Pipeline de Cliente Compartilhado (Shared Client Pipeline)
// Lógica agnóstica de preparação topológica, batch chunking anti-deadlock,
// validação de políticas, montagem de AppDataset e subscrição Realtime
// ==============================================================================

import type {
  AppDataset,
  ApontamentoHH,
  CarteiraEmbarque,
  CarteiraOperacao,
  ConfirmacaoSAP,
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
import { parseIdEmbarque, platformKey, sanitizePlatformCode, slugify } from '../../utils/format';
import { lookupPlatform } from '../../domain/calculations';
import type { ClientDatabaseProvider } from '../../ports/client-provider.port';
import type { BaaSConnectorPort, RawBaaSDatasetPayload } from '../../ports/baas-connector.port';
import type { ClientAuthPort } from '../../ports/auth.port';
import type {
  AuditLogFilterInput,
  BatchImportCarteiraRow,
  BatchImportConfirmacaoSAPRow,
  BatchImportHHRow,
  BatchImportPlataformaRow,
  ClientDataPort,
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
    const resolvedSigla = pFound ? pFound.sigla : sanitizePlatformCode(r.p);
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
    hh_carteira?: number;
    hh_fora_carteira?: number;
    hh_cancelado?: number;
    operacao: string;
    id_embarque: string;
    pe: number | null;
    ex: number | null;
    fonte: string;
    updated_at: string;
  }>;
  opsPayload: Array<{
    portal_id: string;
    id_embarque: string;
    matricula: string;
    chave_petrobras: string;
    nome: string;
    empresa: string;
    estrutura: string;
    unidade_negocio: string;
    plataforma_sigla: string | null;
    data_inicio: string;
    data_fim: string;
    ordem: string;
    operacao: string;
    status_processamento: string;
    prioridade: string;
    status_programacao: string;
    hh_programado: number;
    hh_confirmado: number;
    recursos: number;
    fonte: string;
    updated_at: string;
  }>;
  isGranular: boolean;
  maxDate: string;
} {
  const unknownPlats = new Map<string, string>();
  const preparedRows = rows.map(r => {
    const pFound = lookupPlatform(pidx, r.plat);
    const resolvedSigla = pFound ? pFound.sigla : sanitizePlatformCode(r.plat);
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
      status_programacao: String(r.status_prog || '').trim(),
      operacao: r.op?.trim() || '',
      id_embarque: parseIdEmbarque(r.id_embarque || r.op || ''),
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

  // Consolidação para carteira_embarques (1 linha por técnico e início de embarque)
  const cartMap = new Map<string, any>();
  preparedRows.forEach(r => {
    const key = `${r.matricula}_${r.data_inicio}`;
    const isCanc = r.status_programacao === 'Cancelada';
    const isFora = r.status_programacao === 'Fora da carteira';
    const hasHp = r.horas_programadas != null;
    const hpNum = hasHp ? Number(r.horas_programadas) : 0;

    if (!cartMap.has(key)) {
      const entry: Record<string, any> = {
        matricula: r.matricula,
        plataforma_sigla: r.plataforma_sigla,
        unidade_negocio: r.unidade_negocio,
        data_inicio: r.data_inicio,
        data_fim: r.data_fim,
        horas_programadas: hasHp ? (isCanc ? 0 : hpNum) : null,
        operacao: r.operacao || r.id_embarque || '',
        id_embarque: r.id_embarque || r.operacao || '',
        pe: r.pe,
        ex: r.ex,
        fonte: 'carteira',
        updated_at: new Date().toISOString()
      };
      if (hasHp) {
        entry.hh_carteira = !isCanc && !isFora ? hpNum : 0;
        entry.hh_fora_carteira = isFora ? hpNum : 0;
        entry.hh_cancelado = isCanc ? hpNum : 0;
      }
      cartMap.set(key, entry);
    } else {
      const existing = cartMap.get(key);
      if (r.data_fim > existing.data_fim) existing.data_fim = r.data_fim;
      if (hasHp) {
        if (!isCanc) {
          existing.horas_programadas = (existing.horas_programadas || 0) + hpNum;
        } else if (existing.horas_programadas == null) {
          existing.horas_programadas = 0;
        }
        existing.hh_carteira = (existing.hh_carteira || 0) + (!isCanc && !isFora ? hpNum : 0);
        existing.hh_fora_carteira = (existing.hh_fora_carteira || 0) + (isFora ? hpNum : 0);
        existing.hh_cancelado = (existing.hh_cancelado || 0) + (isCanc ? hpNum : 0);
      }
      if (!existing.id_embarque && (r.id_embarque || r.operacao)) existing.id_embarque = r.id_embarque || r.operacao;
    }
  });

  const cartPayload = Array.from(cartMap.values()).sort((a, b) => {
    const cmp = a.matricula.localeCompare(b.matricula);
    return cmp !== 0 ? cmp : a.data_inicio.localeCompare(b.data_inicio);
  });

  // Operações granulares da carteira (Portal Offshore ou múltiplas operações por embarque)
  const isGranular =
    rows.some(
      r =>
        (r.ordem && r.ordem.trim() !== '') ||
        (r.id_embarque && r.id_embarque.trim() !== '') ||
        (r.status_prog && r.status_prog.trim() !== '') ||
        r.hc_portal != null
    ) ||
    (rows.length > cartPayload.length && rows.some(r => r.op && r.op.trim() !== ''));

  const opsMap = new Map<string, any>();
  if (isGranular) {
    rows.forEach(r => {
      const mat = r.mat.trim();
      if (!mat || !r.ini || !r.fim) return;
      const pFound = lookupPlatform(pidx, r.plat);
      const resolvedSigla = pFound ? pFound.sigla : sanitizePlatformCode(r.plat);
      const resolvedUn = pFound ? pFound.un : r.reg?.trim() || '';

      const cleanOrdem = String(r.ordem || '').trim() || (r.op ? 'ORDEM_AVULSA' : 'SEM_ORDEM');
      const cleanOp = String(r.op || '').trim() || (r.id_embarque ? `EMB_${parseIdEmbarque(r.id_embarque)}` : 'SEM_OP');
      const key = `${mat}_${r.ini}_${cleanOrdem}_${cleanOp}`;
      const cleanId = parseIdEmbarque(r.id_embarque || (!r.ordem ? r.op : '') || '');

      opsMap.set(key, {
        portal_id: cleanId,
        id_embarque: cleanId,
        matricula: mat,
        chave_petrobras: String(r.chave || '').trim(),
        nome: String(r.nome || '').trim(),
        empresa: String(r.empresa || '').trim(),
        estrutura: String(r.reg || '').trim(),
        unidade_negocio: resolvedUn,
        plataforma_sigla: resolvedSigla || null,
        data_inicio: r.ini,
        data_fim: r.fim,
        ordem: cleanOrdem,
        operacao: cleanOp,
        status_processamento: 'Pendente',
        prioridade: 'Regular',
        status_programacao: String(r.status_prog || 'Carteira').trim(),
        hh_programado: r.hp != null ? Number(r.hp) : 0,
        hh_confirmado: r.hc_portal != null ? Number(r.hc_portal) : 0,
        recursos: parseInt(String(r.recursos || '1'), 10) || 1,
        fonte: 'portal_offshore',
        updated_at: new Date().toISOString()
      });
    });
  }

  const opsPayload = Array.from(opsMap.values()).sort((a, b) => {
    const cmpMat = a.matricula.localeCompare(b.matricula);
    if (cmpMat !== 0) return cmpMat;
    const cmpIni = a.data_inicio.localeCompare(b.data_inicio);
    if (cmpIni !== 0) return cmpIni;
    const cmpOrd = a.ordem.localeCompare(b.ordem);
    if (cmpOrd !== 0) return cmpOrd;
    return a.operacao.localeCompare(b.operacao);
  });

  const maxDate = rows.reduce((max, r) => (r.fim > max ? r.fim : max), '');

  return { pendingPlataformas, uniqueTecnicos, cartPayload, opsPayload, isGranular, maxDate };
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
    const sigla = sanitizePlatformCode(r.sigla);
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
 * Prepara o lote de confirmações/apontamentos do SAP ordenados por chave natural.
 */
export function prepareBatchConfirmacoesSAP(
  rows: BatchImportConfirmacaoSAPRow[]
): Array<{
  matricula: string;
  data_criacao: string;
  data_lancamento: string;
  data_fim_real: string;
  ordem: string;
  operacao: string;
  horas_confirmadas: number;
  contador_confirmacao: number;
  updated_at: string;
}> {
  const map = new Map<string, any>();
  rows.forEach(r => {
    const mat = String(r.mat || '').trim();
    const cria = String(r.cria || '').trim();
    const lanc = String(r.lanc || '').trim() || cria;
    const real = String(r.real || '').trim() || lanc;
    const ordem = String(r.ordem || '').trim();
    const op = String(r.op || '').trim();
    const hc = Number(r.hc) || 0;
    const contador = Number(r.contador) || 0;
    if (!mat || !cria || !ordem) return;

    const key = `${mat}_${cria}_${lanc}_${real}_${ordem}_${op}_${hc}_${contador}`;
    map.set(key, {
      matricula: mat,
      data_criacao: cria,
      data_lancamento: lanc,
      data_fim_real: real,
      ordem,
      operacao: op,
      horas_confirmadas: hc,
      contador_confirmacao: contador,
      updated_at: new Date().toISOString()
    });
  });

  return Array.from(map.values()).sort((a, b) => {
    const cmpMat = a.matricula.localeCompare(b.matricula);
    if (cmpMat !== 0) return cmpMat;
    const cmpOrd = a.ordem.localeCompare(b.ordem);
    if (cmpOrd !== 0) return cmpOrd;
    const cmpOp = a.operacao.localeCompare(b.operacao);
    if (cmpOp !== 0) return cmpOp;
    if (a.contador_confirmacao !== b.contador_confirmacao) {
      return a.contador_confirmacao - b.contador_confirmacao;
    }
    return a.data_lancamento.localeCompare(b.data_lancamento);
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
    const idEmb = parseIdEmbarque(row.id_embarque || (row as any).operacao || '');
    const rawHp = row.horas_programadas != null ? Number(row.horas_programadas) : null;
    const rawHhCart = row.hh_carteira != null ? Number(row.hh_carteira) : undefined;
    const rawHhFora = row.hh_fora_carteira != null ? Number(row.hh_fora_carteira) : 0;
    const rawHhCanc = row.hh_cancelado != null ? Number(row.hh_cancelado) : 0;
    const fonte = String(row.fonte || 'carteira');
    const resolvedHhCarteira =
      rawHhCart === undefined
        ? undefined
        : fonte !== 'portal_offshore' && rawHhCart === 0 && rawHhFora === 0 && rawHhCanc === 0 && (rawHp == null || rawHp > 0)
          ? undefined
          : rawHhCart;
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
      horas_programadas: rawHp,
      hh_carteira: resolvedHhCarteira,
      hh_fora_carteira: rawHhFora,
      hh_cancelado: rawHhCanc,
      hh_confirmado_portal: row.hh_confirmado_portal != null ? Number(row.hh_confirmado_portal) : 0,
      hh_confirmado_sap: row.hh_confirmado_sap != null ? Number(row.hh_confirmado_sap) : 0,
      divergencia_confirmada: row.divergencia_confirmada != null ? Number(row.divergencia_confirmada) : 0,
      operacao: idEmb,
      pe: row.pe != null ? Number(row.pe) : null,
      ex: row.ex != null ? Number(row.ex) : null,
      fonte
    };
  });

  // 6.1. Operações detalhadas da Carteira (com conciliação SAP)
  const carteiraOperacoes: CarteiraOperacao[] = (raw.carteiraOperacaoRows || []).map(row => {
    const cleanId = parseIdEmbarque((row as any).id_embarque || row.portal_id || '');
    return {
      id: String(row.id || ''),
      portal_id: cleanId,
      id_embarque: cleanId,
      matricula: String(row.matricula || ''),
    chave_petrobras: String(row.chave_petrobras || ''),
    nome: tecnicos[String(row.matricula || '')]?.nome || String(row.nome || ''),
    empresa: String(row.empresa || ''),
    estrutura: String(row.estrutura || ''),
    unidade_negocio: String(row.unidade_negocio || ''),
    plataforma_sigla: row.plataforma_sigla ? String(row.plataforma_sigla) : null,
    data_inicio: String(row.data_inicio || ''),
    data_fim: String(row.data_fim || ''),
    ordem: String(row.ordem || ''),
    operacao: String(row.operacao || ''),
    status_processamento: String(row.status_processamento || 'Pendente'),
    prioridade: String(row.prioridade || 'Regular'),
    status_programacao: String(row.status_programacao || 'Carteira'),
    hh_programado: row.hh_programado != null ? Number(row.hh_programado) : 0,
    hh_confirmado: row.hh_confirmado != null ? Number(row.hh_confirmado) : 0,
    hh_confirmado_sap: row.hh_confirmado_sap != null ? Number(row.hh_confirmado_sap) : 0,
    divergencia_sap: row.divergencia_sap != null ? Number(row.divergencia_sap) : 0,
    status_divergencia: String(row.status_divergencia || 'Não Confirmado'),
    recursos: row.recursos != null ? Number(row.recursos) : 1,
    fonte: String(row.fonte || 'portal_offshore')
  };});

  // 6.2. Confirmações do SAP vinculadas a embarques
  const confirmacoesSap: ConfirmacaoSAP[] = (raw.confirmacaoSapRows || []).map(row => ({
    id: String(row.id || ''),
    matricula: String(row.matricula || ''),
    data_criacao: String(row.data_criacao || ''),
    data_lancamento: String(row.data_lancamento || ''),
    data_fim_real: String(row.data_fim_real || ''),
    ordem: String(row.ordem || ''),
    operacao: String(row.operacao || ''),
    horas_confirmadas: Number(row.horas_confirmadas) || 0,
    contador_confirmacao: row.contador_confirmacao != null ? Number(row.contador_confirmacao) : 0,
    id_embarque: parseIdEmbarque((row as any).id_embarque || ''),
    status_reconciliacao: (row.status_reconciliacao as any) || 'Pendente',
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || '')
  }));

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
  const maxHhDate = Object.values(hhMap).reduce((acc, h) => (h.data > acc ? h.data : acc), '');
  const watermark: WatermarkStatus = {
    ultima_data_hh: wmFirst?.ultima_data_hh ? String(wmFirst.ultima_data_hh) : (maxHhDate || null),
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
    carteiraOperacoes,
    confirmacoesSap,
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
      const siglaUpper = sanitizePlatformCode(plat.sigla);
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

      if (prepared.isGranular && typeof connector.upsertCarteiraOperacoesChunk === 'function') {
        const total = prepared.opsPayload.length;
        for (let i = 0; i < total; i += CHUNK_SIZE) {
          const chunk = prepared.opsPayload.slice(i, i + CHUNK_SIZE);
          await connector.upsertCarteiraOperacoesChunk(chunk);
          onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
        }
      } else {
        const total = prepared.cartPayload.length;
        for (let i = 0; i < total; i += CHUNK_SIZE) {
          const chunk = prepared.cartPayload.slice(i, i + CHUNK_SIZE);
          await connector.upsertCarteiraChunk(chunk);
          onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
        }
      }

      const totalRowsRecorded = prepared.isGranular ? prepared.opsPayload.length : prepared.cartPayload.length;
      await connector.insertFluxoImportacao({
        tipo_fluxo: 'carteira',
        origem,
        total_linhas: totalRowsRecorded,
        data_maxima: prepared.maxDate || null,
        observacao: `Importação em lote de ${totalRowsRecorded} registros de carteira.`
      });

      if (typeof connector.reconciliarConfirmacoesSAPRPC === 'function') {
        try {
          await connector.reconciliarConfirmacoesSAPRPC();
        } catch (rErr) {
          console.warn('Reconciliação automática disparada após importação de carteira:', rErr);
        }
      }
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
    async batchImportConfirmacoesSAP(rows, onProgress) {
      if (!rows.length) return;
      if (typeof connector.upsertConfirmacoesSAPChunk !== 'function') {
        throw new Error('O conector BaaS ativo não suporta importação de confirmações do SAP.');
      }
      const prepared = prepareBatchConfirmacoesSAP(rows);
      const total = prepared.length;
      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = prepared.slice(i, i + CHUNK_SIZE);
        await connector.upsertConfirmacoesSAPChunk(chunk);
        onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
      }
      if (typeof connector.reconciliarConfirmacoesSAPRPC === 'function') {
        return connector.reconciliarConfirmacoesSAPRPC();
      }
    },
    async reconciliarConfirmacoesSAP() {
      if (typeof connector.reconciliarConfirmacoesSAPRPC === 'function') {
        return connector.reconciliarConfirmacoesSAPRPC();
      }
    },
    async resetCarteiraEmbarques() {
      if (typeof connector.resetCarteiraEmbarquesRPC === 'function') {
        return await connector.resetCarteiraEmbarquesRPC();
      }
      return { deleted_operacoes: 0, deleted_embarques: 0 };
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
