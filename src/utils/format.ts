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

export const plural = (n: number, sing: string, plur: string): string =>
  n + ' ' + (n === 1 ? sing : plur);
