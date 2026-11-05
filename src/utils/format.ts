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

export const safeKey = (s: unknown): string =>
  String(s ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_\-.~:@+]/g, '_');

export const slugify = (s: unknown): string =>
  normalizeText(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'item';

export const parseFlexibleHours = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).trim().replace(/\s|h/gi, '');
  if (/^\d{1,3}:\d{2}$/.test(s)) {
    const [a, b] = s.split(':');
    return +a + +b / 60;
  }
  const n = parseFloat(s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
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
