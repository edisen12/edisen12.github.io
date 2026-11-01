// ==============================================================================
// Serviço de Dados: Queries Janeladas, Batch UPSERT em Chunks & Persistência
// Performance Otimizada, Isolamento Multi-Escopo e Contingência Offline
// ==============================================================================

import { supabase } from './supabase';
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
  Tecnico,
  UserOnboarding,
  UserProfile,
  UsoffUnWeight,
  WatermarkStatus
} from '../domain/types';
import { DEFAULT_CONFIG, DEFAULT_USER_PREFERENCES } from '../config/constants';
import { todayIso } from '../utils/date';
import { platformKey, slugify } from '../utils/format';
import { lookupPlatform } from '../domain/calculations';

const CHUNK_SIZE = 500;
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
 * Carrega em paralelo o dataset necessário para a janela de datas selecionada.
 * Respeita RLS estrito: usuários restritos recebem apenas sua carteira e usam RPCs
 * específicas para marca d'água e anti-falso-positivo de transbordo.
 */
export async function loadAppDataset(
  queryIni: string,
  queryFim: string,
  isGlobal: boolean
): Promise<AppDataset> {
  const [
    cfgRes,
    usoffWeightsRes,
    platRows,
    pessoasRes,
    tecRows,
    cartRows,
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
          supabase.from('fluxo_importacoes').select('*').order('criado_em', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('user_onboarding').select('*')
        ])
      : Promise.all([
          supabase.rpc('get_external_covered_days', { p_ini: queryIni, p_fim: queryFim }),
          null
        ])
  ]);

  // 1. Configurações gerais
  const config: ContractConfig = cfgRes.data
    ? {
        id: cfgRes.data.id,
        hh_dia: Number(cfgRes.data.hh_dia),
        meta_percentual: Number(cfgRes.data.meta_percentual),
        atencao_percentual: Number(cfgRes.data.atencao_percentual),
        dias_embarque: Number(cfgRes.data.dias_embarque),
        dia_corte_medicao: cfgRes.data.dia_corte_medicao as any,
        prazo_justificativa_dias: Number(cfgRes.data.prazo_justificativa_dias),
        med_criterio: cfgRes.data.med_criterio as any,
        us_pe_padrao: cfgRes.data.us_pe_padrao != null ? Number(cfgRes.data.us_pe_padrao) : null,
        us_ex_padrao: cfgRes.data.us_ex_padrao != null ? Number(cfgRes.data.us_ex_padrao) : null,
        slogan: cfgRes.data.slogan || '',
        regionais_extras: Array.isArray(cfgRes.data.regionais_extras) ? (cfgRes.data.regionais_extras as string[]) : []
      }
    : { ...DEFAULT_CONFIG };

  // 2. Pesos USOFF por UN
  const usoffUnWeights: Record<string, UsoffUnWeight> = {};
  (usoffWeightsRes.data || []).forEach(row => {
    usoffUnWeights[row.unidade_negocio] = {
      unidade_negocio: row.unidade_negocio,
      pe: row.pe != null ? Number(row.pe) : null,
      ex: row.ex != null ? Number(row.ex) : null
    };
  });

  // 3. Catálogo de plataformas
  const plataformas: Record<string, Plataforma> = {};
  platRows.forEach(row => {
    plataformas[row.sigla] = {
      sigla: row.sigla,
      chave_norm: row.chave_norm,
      nome: row.nome,
      un: row.un,
      armador: row.armador,
      gerencia: row.gerencia,
      tipo: row.tipo,
      situacao: row.situacao,
      cadastro_pendente: row.cadastro_pendente
    };
  });

  // 4. Catálogo de pessoas e atribuições
  const pessoas: Record<string, Pessoa> = {};
  (pessoasRes.data || []).forEach((row: any) => {
    const plats = Array.isArray(row.pessoa_plataformas)
      ? row.pessoa_plataformas.map((p: any) => String(p.plataforma_sigla || '')).filter(Boolean)
      : [];
    const uns = Array.isArray(row.pessoa_unidades)
      ? row.pessoa_unidades.map((u: any) => String(u.unidade_negocio || '')).filter(Boolean)
      : [];

    pessoas[row.id] = {
      id: row.id,
      slug: row.slug,
      nome: row.nome,
      papel: row.papel as PapelOperacional,
      email: row.email,
      user_id: row.user_id,
      plats,
      uns
    };
  });

  // 5. Técnicos
  const tecnicos: Record<string, Tecnico> = {};
  tecRows.forEach(row => {
    tecnicos[row.matricula] = {
      matricula: row.matricula,
      nome: row.nome,
      funcao: row.funcao
    };
  });

  // 6. Carteira de embarques
  const carteira: CarteiraEmbarque[] = cartRows.map(row => ({
    id: row.id,
    matricula: row.matricula,
    nome: tecnicos[row.matricula]?.nome || '',
    funcao: tecnicos[row.matricula]?.funcao || '',
    plataforma_sigla: row.plataforma_sigla || '',
    unidade_negocio: row.unidade_negocio || '',
    data_inicio: row.data_inicio,
    data_fim: row.data_fim,
    horas_programadas: row.horas_programadas != null ? Number(row.horas_programadas) : null,
    operacao: row.operacao || '',
    pe: row.pe != null ? Number(row.pe) : null,
    ex: row.ex != null ? Number(row.ex) : null,
    fonte: row.fonte || 'carteira'
  }));

  // 7. Apontamentos HH
  const hhMap: Record<string, ApontamentoHH> = {};
  hhRows.forEach(row => {
    const key = `${row.matricula}|${row.data}`;
    hhMap[key] = {
      id: row.id,
      matricula: row.matricula,
      data: row.data,
      plataforma_sigla: row.plataforma_sigla || '',
      unidade_negocio: row.unidade_negocio || '',
      horas_executadas: Number(row.horas_executadas)
    };
  });

  // 8. Justificativas
  const justMap: Record<string, Justificativa> = {};
  justRows.forEach(row => {
    const key = `${row.matricula}|${row.data}`;
    justMap[key] = {
      id: row.id,
      matricula: row.matricula,
      data: row.data,
      motivo: row.motivo,
      horas_gangway: Number(row.horas_gangway || 0),
      descricao: row.descricao || '',
      responsavel_nome: row.responsavel_nome || '',
      criado_por: row.criado_por,
      criado_em: row.criado_em,
      updated_by: row.updated_by,
      updated_at: row.updated_at
    };
  });

  // 9. Marca d'água global
  const wmFirst = Array.isArray(wmRes.data) && wmRes.data.length > 0 ? wmRes.data[0] : null;
  const watermark: WatermarkStatus = {
    ultima_data_hh: wmFirst?.ultima_data_hh || null,
    ultima_importacao_em: wmFirst?.ultima_importacao_em || null
  };

  // 10. Perfis, onboarding, notificações e RPCs de escopo
  const profiles: Record<string, UserProfile> = {};
  const onboardingMap: Record<string, UserOnboarding> = {};
  let emailsResumo: string[] = [];
  let latestFluxo: FluxoImportacao | null = null;
  const externalCoveredSet = new Set<string>();
  const sharedOpsSet = new Set<string>();

  if (isGlobal && Array.isArray(globalExtraRes)) {
    const [profilesQuery, notifQuery, fluxoQuery, onboardingQuery] = globalExtraRes as any[];

    (profilesQuery?.data || []).forEach((row: any) => {
      profiles[row.id] = {
        id: row.id,
        email: row.email,
        nome: row.nome,
        role: row.role,
        ativo: row.ativo
      };
    });

    (onboardingQuery?.data || []).forEach((row: any) => {
      const rawPref = (row.preferencias && typeof row.preferencias === 'object') ? row.preferencias : {};
      onboardingMap[row.user_id] = {
        user_id: row.user_id,
        primeiro_login: Boolean(row.primeiro_login),
        obriga_troca_senha: Boolean(row.obriga_troca_senha),
        senha_trocada_em: row.senha_trocada_em || null,
        preferencias: {
          ...DEFAULT_USER_PREFERENCES,
          ...rawPref
        }
      };
    });

    if (notifQuery?.data?.emails_resumo && Array.isArray(notifQuery.data.emails_resumo)) {
      emailsResumo = notifQuery.data.emails_resumo;
    }

    if (fluxoQuery?.data) {
      latestFluxo = {
        id: fluxoQuery.data.id,
        tipo_fluxo: fluxoQuery.data.tipo_fluxo as any,
        origem: fluxoQuery.data.origem,
        total_linhas: fluxoQuery.data.total_linhas,
        data_maxima: fluxoQuery.data.data_maxima,
        observacao: fluxoQuery.data.observacao,
        criado_em: fluxoQuery.data.criado_em
      };
    }
  } else if (!isGlobal && Array.isArray(globalExtraRes)) {
    const [extDaysQuery] = globalExtraRes as any[];

    (extDaysQuery?.data || []).forEach((row: any) => {
      externalCoveredSet.add(`${row.matricula}|${row.data}`);
    });

    // Busca operações compartilhadas se houver códigos OP nesta carteira
    const uniqueOps = Array.from(new Set(carteira.map(c => c.operacao).filter(Boolean)));
    if (uniqueOps.length > 0) {
      const { data: sharedOpsData } = await supabase.rpc('get_shared_ops', { p_ops: uniqueOps });
      if (Array.isArray(sharedOpsData)) {
        sharedOpsData.forEach(op => sharedOpsSet.add(op));
      }
    }
  }

  // 11. Checagem de modo demonstração (quando banco está totalmente zerado de dados operacionais)
  let isDemo = false;
  let demoReason = '';

  const hasRealData =
    Object.keys(hhMap).length > 0 ||
    carteira.length > 0 ||
    watermark.ultima_data_hh != null;

  if (!hasRealData) {
    try {
      const demoModule = await import('../domain/demo');
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
 * Salva ou atualiza uma justificativa via UPSERT (matricula, data).
 */
export async function saveJustificativa(just: Omit<Justificativa, 'id'>): Promise<void> {
  const { error } = await supabase.from('justificativas').upsert(
    {
      matricula: just.matricula,
      data: just.data,
      motivo: just.motivo,
      horas_gangway: just.horas_gangway || 0,
      descricao: just.descricao || '',
      responsavel_nome: just.responsavel_nome || ''
    },
    { onConflict: 'matricula,data' }
  );

  if (error) throw error;
}

/**
 * Salva configurações gerais, pesos de UNs para USOFF e lista de e-mails de notificação.
 */
export async function saveConfiguracoes(
  cfg: ContractConfig,
  unWeights: UsoffUnWeight[],
  emailsResumo: string[]
): Promise<void> {
  // 1. Configurações gerais
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

  // 2. Pesos USOFF por UN
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

  // 3. E-mails de resumo (acesso restrito a administradores)
  if (emailsResumo) {
    const { error: notifErr } = await supabase.from('configuracoes_notificacao').upsert({
      id: 'geral',
      emails_resumo: emailsResumo,
      updated_at: new Date().toISOString()
    });

    if (notifErr) throw notifErr;
  }
}

/**
 * Salva ou atualiza uma plataforma no catálogo.
 */
export async function savePlataforma(
  plat: Partial<Plataforma> & { sigla: string }
): Promise<void> {
  const siglaUpper = plat.sigla.trim().toUpperCase();
  const chaveNorm = platformKey(siglaUpper);

  const { error } = await supabase.from('plataformas').upsert(
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
    },
    { onConflict: 'sigla' }
  );

  if (error) throw error;
}

/**
 * Remove uma plataforma do catálogo.
 */
export async function deletePlataforma(sigla: string): Promise<void> {
  const { error } = await supabase.from('plataformas').delete().eq('sigla', sigla);
  if (error) throw error;
}

/**
 * Salva ou atualiza uma pessoa responsável e substitui suas atribuições de plataformas e UNs.
 */
export async function savePessoa(input: {
  id?: string;
  nome: string;
  papel: PapelOperacional;
  email: string;
  plats: string[];
  uns: string[];
}): Promise<Pessoa> {
  const cleanNome = input.nome.trim();
  const cleanEmail = input.email.trim().toLowerCase();
  const cleanSlug = slugify(cleanNome) + (input.id ? '' : `-${Date.now().toString().slice(-4)}`);

  let pessoaId = input.id;

  if (pessoaId) {
    const { error: updErr } = await supabase
      .from('pessoas')
      .update({
        nome: cleanNome,
        papel: input.papel,
        email: cleanEmail,
        updated_at: new Date().toISOString()
      })
      .eq('id', pessoaId);

    if (updErr) throw updErr;
  } else {
    const { data: insData, error: insErr } = await supabase
      .from('pessoas')
      .insert({
        nome: cleanNome,
        slug: cleanSlug,
        papel: input.papel,
        email: cleanEmail
      })
      .select('id')
      .single();

    if (insErr) throw insErr;
    pessoaId = insData.id;
  }

  // Substituição das plataformas vinculadas
  await supabase.from('pessoa_plataformas').delete().eq('pessoa_id', pessoaId);
  if (input.plats && input.plats.length > 0) {
    const rowsPlat = Array.from(new Set(input.plats)).map(sigla => ({
      pessoa_id: pessoaId!,
      plataforma_sigla: sigla
    }));
    const { error: plErr } = await supabase.from('pessoa_plataformas').insert(rowsPlat);
    if (plErr) throw plErr;
  }

  // Substituição das UNs vinculadas
  await supabase.from('pessoa_unidades').delete().eq('pessoa_id', pessoaId);
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
    slug: cleanSlug,
    nome: cleanNome,
    papel: input.papel,
    email: cleanEmail,
    user_id: null,
    plats: input.plats || [],
    uns: input.uns || []
  };
}

/**
 * Remove uma pessoa e suas relações associadas.
 */
export async function deletePessoa(id: string): Promise<void> {
  const { error } = await supabase.from('pessoas').delete().eq('id', id);
  if (error) throw error;
}

// ==============================================================================
// BATCH UPSERT EM CHUNKS (500 LINHAS) COM INTEGRIDADE REFERENCIAL
// ==============================================================================

/**
 * Importa lote de apontamentos HH diários:
 * 1. Normaliza siglas e auto-cadastra siglas inéditas como 'cadastro_pendente: true'
 * 2. Garante registro de todos os técnicos no banco (para FK de tecnicos)
 * 3. Grava apontamentos em chunks de 500 linhas reportando progresso real
 * 4. Registra histórico em fluxo_importacoes
 */
export async function batchImportHH(
  rows: Array<{
    mat: string;
    nome?: string;
    funcao?: string;
    p: string;
    r?: string;
    D: string;
    e: number;
  }>,
  pidx: Record<string, Plataforma>,
  onProgress?: (gravadas: number, total: number) => void,
  origem = 'planilha (manual)'
): Promise<void> {
  if (!rows.length) return;

  // 1. Resolução resiliente de plataformas e auto-cadastro se inédita
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

  // Grava previamente plataformas inéditas para não violar FK
  if (unknownPlats.size > 0) {
    const platInserts = Array.from(unknownPlats.entries()).map(([sigla, rawName]) => ({
      sigla,
      chave_norm: platformKey(sigla),
      nome: rawName || sigla,
      cadastro_pendente: true
    }));

    await supabase.from('plataformas').upsert(platInserts, { onConflict: 'sigla' });
  }

  // 2. Grava previamente todos os técnicos únicos para não violar FK
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

  const tecList = Array.from(tecMap.values()).sort((a, b) => a.matricula.localeCompare(b.matricula));
  for (let i = 0; i < tecList.length; i += CHUNK_SIZE) {
    const chunk = tecList.slice(i, i + CHUNK_SIZE);
    await supabase.from('tecnicos').upsert(chunk, { onConflict: 'matricula' });
  }

  // 3. Grava apontamentos em chunks de 500 linhas com ordenação determinística (anti-deadlock 40P01)
  const hhPayload = preparedRows.map(r => ({
    matricula: r.matricula,
    data: r.data,
    plataforma_sigla: r.plataforma_sigla,
    unidade_negocio: r.unidade_negocio,
    horas_executadas: r.horas_executadas,
    updated_at: new Date().toISOString()
  })).sort((a, b) => {
    const cmp = a.matricula.localeCompare(b.matricula);
    return cmp !== 0 ? cmp : a.data.localeCompare(b.data);
  });

  const total = hhPayload.length;
  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = hhPayload.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from('apontamentos_hh')
      .upsert(chunk, { onConflict: 'matricula,data' });

    if (error) throw error;
    onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
  }

  // 4. Marcação de auditoria em fluxo_importacoes
  const maxDate = rows.reduce((max, r) => (r.D > max ? r.D : max), '');
  await supabase.from('fluxo_importacoes').insert({
    tipo_fluxo: 'hh',
    origem,
    total_linhas: total,
    data_maxima: maxDate || null,
    observacao: `Importação em lote de ${total} apontamentos HH.`
  });
}

/**
 * Importa lote de programações da Carteira de Embarques do Portal Offshore.
 */
export async function batchImportCarteira(
  rows: Array<{
    mat: string;
    nome?: string;
    funcao?: string;
    plat: string;
    reg?: string;
    ini: string;
    fim: string;
    hp?: number | null;
    op?: string;
    pe?: number | null;
    ex?: number | null;
  }>,
  pidx: Record<string, Plataforma>,
  onProgress?: (gravadas: number, total: number) => void,
  origem = 'planilha (manual)'
): Promise<void> {
  if (!rows.length) return;

  // 1. Resolução resiliente de plataformas
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
      pe: r.pe != null ? Number(r.pe) : null,
      ex: r.ex != null ? Number(r.ex) : null
    };
  });

  if (unknownPlats.size > 0) {
    const platInserts = Array.from(unknownPlats.entries()).map(([sigla, rawName]) => ({
      sigla,
      chave_norm: platformKey(sigla),
      nome: rawName || sigla,
      cadastro_pendente: true
    }));

    await supabase.from('plataformas').upsert(platInserts, { onConflict: 'sigla' });
  }

  // 2. Garante técnicos
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

  const tecList = Array.from(tecMap.values()).sort((a, b) => a.matricula.localeCompare(b.matricula));
  for (let i = 0; i < tecList.length; i += CHUNK_SIZE) {
    const chunk = tecList.slice(i, i + CHUNK_SIZE);
    await supabase.from('tecnicos').upsert(chunk, { onConflict: 'matricula' });
  }

  // 3. Grava carteira em chunks de 500 linhas com ordenação determinística (anti-deadlock 40P01)
  const cartPayload = preparedRows.map(r => ({
    matricula: r.matricula,
    plataforma_sigla: r.plataforma_sigla,
    unidade_negocio: r.unidade_negocio,
    data_inicio: r.data_inicio,
    data_fim: r.data_fim,
    horas_programadas: r.horas_programadas,
    operacao: r.operacao,
    pe: r.pe,
    ex: r.ex,
    fonte: 'carteira',
    updated_at: new Date().toISOString()
  })).sort((a, b) => {
    const cmp = a.matricula.localeCompare(b.matricula);
    return cmp !== 0 ? cmp : a.data_inicio.localeCompare(b.data_inicio);
  });

  const total = cartPayload.length;
  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = cartPayload.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from('carteira_embarques')
      .upsert(chunk, { onConflict: 'matricula,data_inicio' });

    if (error) throw error;
    onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
  }

  // 4. Marcação de auditoria
  const maxDate = rows.reduce((max, r) => (r.fim > max ? r.fim : max), '');
  await supabase.from('fluxo_importacoes').insert({
    tipo_fluxo: 'carteira',
    origem,
    total_linhas: total,
    data_maxima: maxDate || null,
    observacao: `Importação em lote de ${total} registros de carteira.`
  });
}

/**
 * Importa catálogo de plataformas em lote.
 */
export async function batchImportPlataformas(
  rows: Array<{
    sigla: string;
    nome?: string;
    un?: string;
    armador?: string;
    tipo?: string;
    situacao?: string;
  }>,
  onProgress?: (gravadas: number, total: number) => void
): Promise<void> {
  if (!rows.length) return;

  const payload = rows.map(r => {
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

  const total = payload.length;
  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = payload.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from('plataformas')
      .upsert(chunk, { onConflict: 'sigla' });

    if (error) throw error;
    onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
  }
}

/**
 * Importa pessoas e suas atribuições de carteira em lote.
 */
export async function batchImportPessoas(
  rows: Array<{
    nome: string;
    papel: PapelOperacional;
    email: string;
    plats: string[];
    uns: string[];
  }>,
  onProgress?: (gravadas: number, total: number) => void
): Promise<void> {
  const total = rows.length;
  let count = 0;

  for (const r of rows) {
    await savePessoa(r);
    count++;
    onProgress?.(count, total);
  }
}

/**
 * Exporta snapshot JSON seguro para contingência offline.
 */
export function exportJsonSnapshot(dataset: AppDataset): void {
  const cleanSnapshot = {
    exportedAt: new Date().toISOString(),
    config: dataset.config,
    usoffUnWeights: dataset.usoffUnWeights,
    plataformas: dataset.plataformas,
    tecnicos: dataset.tecnicos,
    carteira: dataset.carteira,
    hhMap: dataset.hhMap,
    justMap: dataset.justMap,
    watermark: dataset.watermark
  };

  const jsonStr = JSON.stringify(cleanSnapshot, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `HH_Offshore_Backup_Contingencia_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
