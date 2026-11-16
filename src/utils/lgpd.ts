import type {
  CarteiraEmbarque,
  CarteiraOperacao,
  ConfirmacaoSAP,
  Justificativa,
  Tecnico
} from '../domain/types';

export const LGPD_HEALTH_EXPORT_PLACEHOLDER = '[Restrito — Sigilo Médico LGPD]';
export const LGPD_ANONYMIZED_TECH_NAME = 'Técnico Anonimizado (LGPD)';
export const LGPD_ANONYMIZED_DESC_PLACEHOLDER = '[Removido por anonimização LGPD]';

const HEALTH_MOTIVE_REGEX = /atestado|afastamento m[eé]dico|sa[uú]de|cid/i;
const SENSITIVE_CID_OR_CLINICAL_REGEX =
  /\b(?:cid(?:\s*-?\s*10)?[-:\s]*[a-z]\d{2}|[a-z]\d{2}\.\d|atestado\s+m[eé]dico|diagn[oó]stico|sintoma|fratura|cirurgia|interna[cç][aã]o|laudo\s+m[eé]dico|doen[cç]a|psicol[oó]g|psiqui[aá]tr)/i;

/**
 * Identifica motivos operacionais relacionados a afastamento de saúde/atestado (Art. 5º II e Art. 11 da LGPD).
 */
export function isHealthJustificationMotivo(motivo?: string | null): boolean {
  return Boolean(motivo && HEALTH_MOTIVE_REGEX.test(motivo));
}

/**
 * Detecta menção provável a CID, diagnóstico ou termos clínicos em texto livre operacional.
 */
export function containsSensitiveHealthTerms(text?: string | null): boolean {
  return Boolean(text && SENSITIVE_CID_OR_CLINICAL_REGEX.test(text));
}

/**
 * Mascara descrições livres em exportações quando associadas a atestado ou termos clínicos (Art. 6º III e Art. 11 LGPD).
 */
export function maskHealthDescriptionForExport(
  motivo?: string | null,
  descricao?: string | null
): string {
  const clean = (descricao || '').trim();
  if (!clean) return '';
  if (isHealthJustificationMotivo(motivo) || containsSensitiveHealthTerms(clean)) {
    return LGPD_HEALTH_EXPORT_PLACEHOLDER;
  }
  return descricao || '';
}

/**
 * Mascara chaves corporativas de sistemas do cliente em relatórios/exportações (Minimização LGPD).
 */
export function maskPetrobrasKey(chave?: string | null): string {
  return chave && chave.trim() ? '***' : '';
}

/**
 * Valida política unificada de senha forte (mínimo 8 caracteres, letras e números).
 */
export function validateStrongPasswordPolicy(password: string): string | null {
  if (!password || password.length < 8) {
    return 'A senha deve conter no mínimo 8 caracteres.';
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'A senha deve combinar letras e números (ex: Infotec@2026).';
  }
  return null;
}

export function addDaysToIso(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || '').trim());
  if (!match) return isoDate;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return dt.toISOString().slice(0, 10);
}

function normalizeSapMatricula(raw?: string | null): string {
  const trimmed = String(raw || '').trim();
  const stripped = trimmed.replace(/^0+/, '');
  return stripped || trimmed;
}

/**
 * Filtra confirmações SAP ao escopo permitido do usuário por ID de embarque ou janela [início, fim + 4d],
 * espelhando exatamente a política confirmacoes_sap_select_policy da Migration 029.
 */
export function filterScopedConfirmacoesSap<
  T extends Pick<ConfirmacaoSAP, 'id_embarque' | 'matricula' | 'data_fim_real' | 'data_lancamento'>
>(
  allSapRows: T[],
  scopedCarteira: Array<Pick<CarteiraEmbarque, 'id_embarque' | 'matricula' | 'data_inicio' | 'data_fim'>>,
  scopedOperacoes: Array<Pick<CarteiraOperacao, 'id_embarque' | 'portal_id'>> = []
): T[] {
  const visibleEmbIds = new Set<string>();
  const windowsByMat = new Map<string, Array<{ ini: string; fimPlus4: string }>>();

  const addWindow = (mat: string, ini: string, fim: string) => {
    const norm = normalizeSapMatricula(mat);
    const list = windowsByMat.get(norm) || [];
    list.push({ ini, fimPlus4: addDaysToIso(fim, 4) });
    windowsByMat.set(norm, list);
  };

  for (const c of scopedCarteira) {
    const embId = String(c.id_embarque || '').trim();
    if (embId) visibleEmbIds.add(embId);
    if (c.matricula && c.data_inicio && c.data_fim) {
      addWindow(c.matricula, c.data_inicio, c.data_fim);
    }
  }

  for (const co of scopedOperacoes) {
    const embId = String(co.id_embarque || co.portal_id || '').trim();
    if (embId) visibleEmbIds.add(embId);
  }

  return allSapRows.filter(cs => {
    const embId = String(cs.id_embarque || '').trim();
    if (embId) {
      return visibleEmbIds.has(embId);
    }
    const windows = windowsByMat.get(normalizeSapMatricula(cs.matricula));
    if (!windows || windows.length === 0) return false;
    return windows.some(
      w =>
        (cs.data_fim_real >= w.ini && cs.data_fim_real <= w.fimPlus4) ||
        (cs.data_lancamento >= w.ini && cs.data_lancamento <= w.fimPlus4)
    );
  });
}

/**
 * Coleta as matrículas de técnicos vinculadas ao escopo visível do usuário (Carteira, Operações ou HH).
 */
export function collectVisibleTecnicoMatriculas(
  scopedCarteira: Array<{ matricula: string }>,
  scopedOperacoes: Array<{ matricula: string }>,
  scopedHhRows: Array<{ matricula: string }>
): Set<string> {
  const visible = new Set<string>();
  for (const c of scopedCarteira) {
    if (c.matricula) visible.add(c.matricula);
  }
  for (const co of scopedOperacoes) {
    if (co.matricula) visible.add(co.matricula);
  }
  for (const h of scopedHhRows) {
    if (h.matricula) visible.add(h.matricula);
  }
  return visible;
}

export function filterTecnicosMapByMatriculas(
  tecnicos: Record<string, Tecnico>,
  visibleMats: Set<string>
): Record<string, Tecnico> {
  const result: Record<string, Tecnico> = {};
  for (const [mat, tec] of Object.entries(tecnicos)) {
    if (visibleMats.has(mat) || visibleMats.has(tec.matricula)) {
      result[mat] = tec;
    }
  }
  return result;
}

/**
 * Verifica se uma justificativa pertence a um dia/embarque visível ao usuário (sem vazar outras plataformas).
 */
export function isJustificativaInScope(
  j: Pick<Justificativa, 'matricula' | 'data'>,
  visibleHhKeys: Set<string>,
  scopedCarteira: Array<Pick<CarteiraEmbarque, 'matricula' | 'data_inicio' | 'data_fim'>>
): boolean {
  if (visibleHhKeys.has(`${j.matricula}|${j.data}`)) return true;
  return scopedCarteira.some(
    c => c.matricula === j.matricula && j.data >= c.data_inicio && j.data <= c.data_fim
  );
}
