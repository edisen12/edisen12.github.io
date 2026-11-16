// ==============================================================================
// Utilitários de Simulação de Usuário (Admin Impersonation)
// Espelha 1:1 o escopo RLS e RPCs de usuário restrito em memória para validação
// ==============================================================================

import type {
  AppDataset,
  ApontamentoHH,
  Justificativa,
  Pessoa,
  Plataforma,
  SystemRole,
  UserProfile,
  UsoffUnWeight
} from '../domain/types';
import { lookupPlatform, resolvePersonUns } from '../domain/calculations';
import { normalizeSapCode, platformKey, sanitizePlatformCode } from './format';

export interface ImpersonationTarget {
  key: string; // 'pessoa:<id>' | 'profile:<id>'
  profile: UserProfile;
  pessoa: Pessoa | null;
  hasLoginAccount: boolean;
}

const ROLE_ORDER: Record<SystemRole, number> = {
  preposto: 0,
  controlador: 1,
  gestor: 2,
  admin: 3
};

function createVirtualProfileForPessoa(pessoa: Pessoa): UserProfile {
  return {
    id: `sim-pessoa-${pessoa.id}`,
    nome: pessoa.nome,
    email: pessoa.email || 'sem-email@simulacao.local',
    role: pessoa.papel,
    ativo: true
  };
}

/**
 * Unifica todas as pessoas e perfis de acesso cadastrados em alvos selecionáveis
 * para visualização/simulação administrativa (excluindo o próprio admin logado).
 */
export function buildImpersonationTargets(
  dataset: AppDataset,
  realUserId?: string
): ImpersonationTarget[] {
  const profilesList = Object.values(dataset.profiles || {});
  const profilesById = new Map<string, UserProfile>();
  const profilesByEmail = new Map<string, UserProfile>();

  for (const prof of profilesList) {
    profilesById.set(prof.id, prof);
    const cleanEmail = String(prof.email || '').trim().toLowerCase();
    if (cleanEmail && !profilesByEmail.has(cleanEmail)) {
      profilesByEmail.set(cleanEmail, prof);
    }
  }

  const targets: ImpersonationTarget[] = [];
  const usedProfileIds = new Set<string>();

  for (const pessoa of Object.values(dataset.pessoas || {})) {
    const cleanPessoaEmail = String(pessoa.email || '').trim().toLowerCase();
    const matchedProfile =
      (pessoa.user_id ? profilesById.get(pessoa.user_id) : undefined) ||
      (cleanPessoaEmail ? profilesByEmail.get(cleanPessoaEmail) : undefined);

    if (matchedProfile) {
      if (realUserId && matchedProfile.id === realUserId) {
        usedProfileIds.add(matchedProfile.id);
        continue;
      }
      usedProfileIds.add(matchedProfile.id);
      targets.push({
        key: `pessoa:${pessoa.id}`,
        profile: matchedProfile,
        pessoa,
        hasLoginAccount: true
      });
    } else {
      targets.push({
        key: `pessoa:${pessoa.id}`,
        profile: createVirtualProfileForPessoa(pessoa),
        pessoa,
        hasLoginAccount: false
      });
    }
  }

  for (const prof of profilesList) {
    if (usedProfileIds.has(prof.id)) continue;
    if (realUserId && prof.id === realUserId) continue;

    targets.push({
      key: `profile:${prof.id}`,
      profile: prof,
      pessoa: null,
      hasLoginAccount: true
    });
  }

  return targets.sort((a, b) => {
    const rDiff = (ROLE_ORDER[a.profile.role] ?? 99) - (ROLE_ORDER[b.profile.role] ?? 99);
    if (rDiff !== 0) return rDiff;
    return a.profile.nome.localeCompare(b.profile.nome, 'pt-BR');
  });
}

/**
 * Resolve o alvo de simulação diretamente a partir de um registro de Pessoa.
 */
export function resolveImpersonationFromPessoa(
  pessoa: Pessoa,
  dataset: AppDataset
): ImpersonationTarget {
  const cleanEmail = String(pessoa.email || '').trim().toLowerCase();
  const matchedProfile = Object.values(dataset.profiles || {}).find(
    prof =>
      (pessoa.user_id && prof.id === pessoa.user_id) ||
      (cleanEmail && String(prof.email || '').trim().toLowerCase() === cleanEmail)
  );

  return {
    key: `pessoa:${pessoa.id}`,
    profile: matchedProfile || createVirtualProfileForPessoa(pessoa),
    pessoa,
    hasLoginAccount: Boolean(matchedProfile)
  };
}

/**
 * Resolve o alvo de simulação diretamente a partir de um UserProfile.
 */
export function resolveImpersonationFromProfile(
  profile: UserProfile,
  dataset: AppDataset
): ImpersonationTarget {
  const cleanEmail = String(profile.email || '').trim().toLowerCase();
  const matchedPessoa =
    Object.values(dataset.pessoas || {}).find(
      p =>
        p.user_id === profile.id ||
        (cleanEmail && String(p.email || '').trim().toLowerCase() === cleanEmail)
    ) || null;

  return {
    key: matchedPessoa ? `pessoa:${matchedPessoa.id}` : `profile:${profile.id}`,
    profile,
    pessoa: matchedPessoa,
    hasLoginAccount: true
  };
}

/**
 * Projeta o dataset global completo para a visão exata de um usuário alvo,
 * replicando 1:1 as políticas RLS do PostgreSQL e RPCs de transbordo/OP compartilhada.
 */
export function scopeDatasetForUser(
  fullDataset: AppDataset,
  target: ImpersonationTarget,
  fullPidx: Record<string, Plataforma>
): AppDataset {
  const isTargetGlobal = target.profile.role === 'admin' || target.profile.role === 'gestor';
  if (isTargetGlobal) {
    return fullDataset;
  }

  const allowedUNs = new Set<string>(
    (target.pessoa?.uns || []).map(u => String(u || '').trim()).filter(Boolean)
  );

  const allowedPlatformKeys = new Set<string>();
  const allowedPlatformSiglas = new Set<string>();

  const registerPlatformSigla = (rawSigla: string) => {
    const trimmed = String(rawSigla || '').trim();
    if (!trimmed) return;
    allowedPlatformSiglas.add(trimmed);
    const sanitized = sanitizePlatformCode(trimmed);
    if (sanitized) allowedPlatformSiglas.add(sanitized);

    const kRaw = platformKey(trimmed);
    if (kRaw) allowedPlatformKeys.add(kRaw);
    const kSanitized = platformKey(sanitized);
    if (kSanitized) allowedPlatformKeys.add(kSanitized);

    const lookedUp = lookupPlatform(fullPidx, trimmed);
    if (lookedUp?.sigla) {
      allowedPlatformSiglas.add(lookedUp.sigla);
      const kLookedUp = platformKey(lookedUp.sigla);
      if (kLookedUp) allowedPlatformKeys.add(kLookedUp);
    }
  };

  (target.pessoa?.plats || []).forEach(registerPlatformSigla);

  Object.values(fullDataset.plataformas || {}).forEach(plat => {
    if (plat.un && allowedUNs.has(plat.un.trim())) {
      registerPlatformSigla(plat.sigla);
    }
  });

  const isPlatformAllowed = (rawSigla?: string | null): boolean => {
    if (!rawSigla) return false;
    const trimmed = String(rawSigla).trim();
    if (!trimmed) return false;
    if (allowedPlatformSiglas.has(trimmed)) return true;

    const kRaw = platformKey(trimmed);
    if (kRaw && allowedPlatformKeys.has(kRaw)) return true;

    const kSanitized = platformKey(sanitizePlatformCode(trimmed));
    if (kSanitized && allowedPlatformKeys.has(kSanitized)) return true;

    const lookedUp = lookupPlatform(fullPidx, trimmed);
    if (lookedUp?.sigla) {
      if (allowedPlatformSiglas.has(lookedUp.sigla)) return true;
      const kLooked = platformKey(lookedUp.sigla);
      if (kLooked && allowedPlatformKeys.has(kLooked)) return true;
    }

    return false;
  };

  const isPlaceInScope = (platSigla?: string | null, un?: string | null): boolean => {
    if (isPlatformAllowed(platSigla)) return true;
    if (un && allowedUNs.has(un.trim())) return true;
    return false;
  };

  // 1. Plataformas visíveis (RLS: auth_allowed_platforms)
  const scopedPlataformas: Record<string, Plataforma> = {};
  Object.entries(fullDataset.plataformas || {}).forEach(([k, plat]) => {
    if (isPlatformAllowed(plat.sigla)) {
      scopedPlataformas[k] = plat;
    }
  });

  // 2. Pesos USOFF por UN (UNs diretas + UNs derivadas das plataformas da carteira)
  const allowedWeightUNs = new Set<string>(allowedUNs);
  if (target.pessoa) {
    resolvePersonUns(target.pessoa, fullPidx).forEach(un => allowedWeightUNs.add(un));
  }
  const scopedUsoffUnWeights: Record<string, UsoffUnWeight> = {};
  Object.entries(fullDataset.usoffUnWeights || {}).forEach(([un, weight]) => {
    if (allowedWeightUNs.has(un)) {
      scopedUsoffUnWeights[un] = weight;
    }
  });

  // 3. Pessoas, Perfis e Onboarding restritos ao próprio usuário
  const scopedPessoas: Record<string, Pessoa> = target.pessoa
    ? { [target.pessoa.id]: target.pessoa }
    : {};

  const scopedProfiles: Record<string, UserProfile> = {
    [target.profile.id]: target.profile
  };

  const ownOnboarding = fullDataset.onboardingMap?.[target.profile.id];
  const scopedOnboardingMap = ownOnboarding
    ? { [target.profile.id]: ownOnboarding }
    : {};

  // 4. Carteira de embarques e operações granulares
  const scopedCarteira = (fullDataset.carteira || []).filter(c =>
    isPlaceInScope(c.plataforma_sigla, c.unidade_negocio)
  );

  const scopedCarteiraOperacoes = (fullDataset.carteiraOperacoes || []).filter(co =>
    isPlaceInScope(co.plataforma_sigla, co.unidade_negocio)
  );

  // 5. Confirmações SAP (RLS: técnicos presentes na carteira visível)
  const visibleCartMats = new Set<string>();
  const visibleCartNormMats = new Set<string>();
  scopedCarteira.forEach(c => {
    if (c.matricula) {
      visibleCartMats.add(c.matricula);
      visibleCartNormMats.add(normalizeSapCode(c.matricula));
    }
  });
  const scopedConfirmacoesSap = (fullDataset.confirmacoesSap || []).filter(
    cs =>
      visibleCartMats.has(cs.matricula) ||
      visibleCartNormMats.has(normalizeSapCode(cs.matricula))
  );

  // 6. Apontamentos HH
  const scopedHhMap: Record<string, ApontamentoHH> = {};
  Object.entries(fullDataset.hhMap || {}).forEach(([k, h]) => {
    if (isPlaceInScope(h.plataforma_sigla, h.unidade_negocio)) {
      scopedHhMap[k] = h;
    }
  });

  // 7. Justificativas (RLS: auth_can_access_justificativa)
  const scopedJustMap: Record<string, Justificativa> = {};
  Object.entries(fullDataset.justMap || {}).forEach(([k, j]) => {
    const hasHh = Boolean(scopedHhMap[`${j.matricula}|${j.data}`]);
    const hasCart = scopedCarteira.some(
      c => c.matricula === j.matricula && j.data >= c.data_inicio && j.data <= c.data_fim
    );
    if (hasHh || hasCart) {
      scopedJustMap[k] = j;
    }
  });

  // 8. Transbordo Zero-Knowledge (RPC: get_external_covered_days)
  const externalCoveredSet = new Set<string>();
  Object.values(fullDataset.hhMap || {}).forEach(h => {
    if (!isPlaceInScope(h.plataforma_sigla, h.unidade_negocio)) {
      const coveredByVisibleCart = scopedCarteira.some(
        c => c.matricula === h.matricula && c.data_inicio <= h.data && h.data <= c.data_fim
      );
      if (coveredByVisibleCart) {
        externalCoveredSet.add(`${h.matricula}|${h.data}`);
      }
    }
  });

  // 9. OPs compartilhadas entre carteiras (RPC: get_shared_ops)
  const sharedOpsSet = new Set<string>();
  const userOps = new Set<string>();
  scopedCarteira.forEach(c => {
    const opCode = c.operacao || c.id_embarque || '';
    if (opCode) userOps.add(opCode);
  });
  if (userOps.size > 0) {
    (fullDataset.carteira || []).forEach(c => {
      const opCode = c.operacao || c.id_embarque || '';
      if (opCode && userOps.has(opCode) && !isPlaceInScope(c.plataforma_sigla, c.unidade_negocio)) {
        sharedOpsSet.add(opCode);
      }
    });
  }

  return {
    ...fullDataset,
    usoffUnWeights: scopedUsoffUnWeights,
    emailsResumo: [],
    plataformas: scopedPlataformas,
    pessoas: scopedPessoas,
    profiles: scopedProfiles,
    onboardingMap: scopedOnboardingMap,
    carteira: scopedCarteira,
    carteiraOperacoes: scopedCarteiraOperacoes,
    confirmacoesSap: scopedConfirmacoesSap,
    hhMap: scopedHhMap,
    justMap: scopedJustMap,
    externalCoveredSet,
    sharedOpsSet,
    latestFluxo: null
  };
}
