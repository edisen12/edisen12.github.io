const NF1 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const NF0 = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0
});

const NF2 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export const formatHours = (v?: number | null): string =>
  v == null || isNaN(v) ? '—' : NF1.format(v) + ' h';

export const formatHoursInt = (v?: number | null): string =>
  v == null || isNaN(v) ? '—' : NF0.format(v) + ' h';

export const formatSignedHours = (v?: number | null): string =>
  v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + NF1.format(v) + ' h';

export const formatPct = (v?: number | null): string =>
  v == null || isNaN(v) ? '—' : NF0.format(v) + '%';

export const formatUs = (v?: number | null): string =>
  v == null || isNaN(v) ? '—' : NF2.format(v);

export const calcPct = (e: number, d: number): number | null =>
  d > 0 ? (e / d) * 100 : null;

export const normalizeText = (s: unknown): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const platformKey = (s: unknown): string =>
  normalizeText(s).replace(/[^a-z0-9]/g, '');

/**
 * Mapeamento determinístico de aliases conhecidos do Portal Offshore e SAP
 * para suas respectivas siglas canônicas no catálogo Petrobras / Infotec.
 */
export const PLATFORM_ALIASES: Record<string, string> = {
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

/**
 * Sanitiza siglas de plataformas/unidades vindas do Portal Offshore ou confirmações SAP.
 * - Trata de-para de aliases (ex.: PMXL1/PMXL -> MXL, PMLZ1 -> MLZ, PMNT1 -> PMNT).
 * - Trata zeros à esquerda em sufixos numéricos (ex.: PAG-02 -> PAG2, PCR-01 -> PCR1, PCM-09 -> PCM9).
 * - Remove pontuações/hífens desnecessários preservando convenção padrão Petrobras (ex.: P-09 -> P09, P-18 -> P18).
 */
export const sanitizePlatformCode = (raw?: unknown): string => {
  if (raw == null || raw === '') return '';
  const trimmed = String(raw).trim().toUpperCase();
  if (PLATFORM_ALIASES[trimmed]) {
    return PLATFORM_ALIASES[trimmed];
  }
  const withoutHyphenSpace = trimmed.replace(/[-\s]/g, '');
  if (PLATFORM_ALIASES[withoutHyphenSpace]) {
    return PLATFORM_ALIASES[withoutHyphenSpace];
  }
  // Normalização de zeros à esquerda em siglas com 2 ou mais letras + sufixo numérico com zero à esquerda (ex: PAG02 -> PAG2, PCR01 -> PCR1)
  const m = withoutHyphenSpace.match(/^([A-Z]{2,})0+(\d+)([A-Z]*)$/);
  if (m) {
    return m[1] + m[2] + m[3];
  }
  // Normalização padrão Petrobras P-XX -> PXX (ex: P-09 -> P09, P-18 -> P18)
  if (/^P-\d+$/i.test(trimmed)) {
    return trimmed.replace('-', '');
  }
  return trimmed;
};

export const safeKey = (s: unknown): string =>
  String(s ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_\-.~:@+]/g, '_');

export const slugify = (s: unknown): string =>
  normalizeText(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'item';

export const normalizeSapCode = (val: unknown): string => {
  const s = String(val ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) {
    return s.replace(/^0+(?=\d)/, '');
  }
  return s.toUpperCase();
};

export const isSapEstornoFlag = (val: unknown): boolean => {
  if (typeof val === 'boolean') return val;
  const norm = normalizeText(val);
  if (!norm) return false;
  return (
    norm === 'x' ||
    norm === 's' ||
    norm === 'sim' ||
    norm === 'y' ||
    norm === 'yes' ||
    norm === 'true' ||
    norm === '1' ||
    norm === 'estorno' ||
    norm === 'estornado' ||
    norm === 'storno' ||
    norm === 'cancelado'
  );
};

export const parseFlexibleHours = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (isNaN(v) || !isFinite(v)) return null;
    return Object.is(v, -0) ? 0 : v;
  }

  let s = String(v)
    .trim()
    .replace(/[\u2212\u2013\u2014\uFE63\uFF0D]/g, '-')
    .replace(/\s/g, '')
    .replace(/(?:hrs?|hs|h)(?=$|[)\-+])/gi, '');

  if (!s) return null;

  let sign = 1;
  // Formato contábil entre parênteses: (9,00), (09:30)
  if (/^\(.+\)$/.test(s)) {
    s = s.slice(1, -1);
    if (!s || /^[-+]|[-+]$/.test(s)) return null;
    sign = -1;
  } else {
    const hasLeadSign = /^[+-]/.test(s);
    const hasTrailSign = /[+-]$/.test(s);
    if (hasLeadSign && hasTrailSign) return null;
    if (hasLeadSign) {
      if (s.startsWith('-')) sign = -1;
      s = s.slice(1);
    } else if (hasTrailSign) {
      // Sinal negativo à direita típico de exportações SAP ALV (ex.: "9,00-", "09:30-")
      if (s.endsWith('-')) sign = -1;
      s = s.slice(0, -1);
    }
  }

  if (!s) return null;

  const timeMatch = s.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    const h = Number(timeMatch[1]);
    const m = Number(timeMatch[2]);
    const sec = timeMatch[3] ? Number(timeMatch[3]) : 0;
    if (m >= 60 || sec >= 60) return null;
    const total = sign * (h + m / 60 + sec / 3600);
    return Object.is(total, -0) ? 0 : total;
  }

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let numericStr: string;
  if (lastComma >= 0 && lastDot >= 0 && lastDot > lastComma) {
    // Formato EN/US com separador de milhar por vírgula (ex.: 1,250.50)
    numericStr = s.replace(/,/g, '');
  } else {
    // Formato PT-BR com milhar por ponto e decimal por vírgula (ex.: 1.250,50 -> 1250.50)
    numericStr = s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  }

  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(numericStr)) {
    return null;
  }

  const n = Number(numericStr) * sign;
  if (isNaN(n) || !isFinite(n)) return null;
  return Object.is(n, -0) ? 0 : n;
};

export const parseCounter = (v: unknown): number => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : Math.floor(v);
  const s = String(v).trim().replace(/\D/g, '');
  if (!s) return 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
};

/**
 * Converte identificador de embarque (portal_id / id_embarque) para string numérica limpa.
 * Protege contra inteiros de ID (na faixa de 40.000 a 70.000) que o SheetJS converte
 * indevidamente em Date (ex.: 55104 virando Date de 2050 ou string GMT).
 */
export const parseIdEmbarque = (val: unknown): string => {
  if (val == null || val === '') return '';
  if (val instanceof Date) {
    const utc = Date.UTC(val.getFullYear(), val.getMonth(), val.getDate());
    const epoch = Date.UTC(1899, 11, 30);
    const serial = Math.round((utc - epoch) / 86400000);
    return String(serial);
  }
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
        const day = parseInt(m[2], 10);
        const yr = parseInt(m[3], 10);
        const utc = Date.UTC(yr, mon, day);
        const epoch = Date.UTC(1899, 11, 30);
        const serial = Math.round((utc - epoch) / 86400000);
        if (serial > 0 && serial < 200000) {
          return String(serial);
        }
      }
    }
  }
  if (/^\d+\.0+$/.test(str)) {
    return str.replace(/\.0+$/, '');
  }
  return str;
};

export const plural = (n: number, sing: string, plur: string): string =>
  n + ' ' + (n === 1 ? sing : plur);
