import { MESES_PT } from '../config/constants';

export const pad = (n: number | string): string => String(n).padStart(2, '0');

export const isoOf = (d: Date): string =>
  d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

export const todayIso = (): string => isoOf(new Date());

export const toDate = (iso: string): Date =>
  new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12);

export const addDays = (iso: string, n: number): string => {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};

export const diffDays = (a: string, b: string): number =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / 864e5);

export const formatBr = (iso?: string | null): string =>
  iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';

export const formatBrShort = (iso?: string | null): string =>
  iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—';

export const mesOf = (iso: string): string => iso.slice(0, 7);

export const mesNome = (ym: string): string => {
  const mIdx = +ym.slice(5, 7) - 1;
  const mes = MESES_PT[mIdx] || '';
  return mes + '/' + ym.slice(0, 4);
};

export const lastDayOfMonth = (ym: string): string => {
  const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0);
  return ym + '-' + pad(d.getDate());
};

export const prevMonth = (ym: string): string => {
  const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
};

export const nextMonth = (ym: string): string => {
  const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
};

export const parseExcelOrStringDate = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return isoOf(new Date(v.getFullYear(), v.getMonth(), v.getDate(), 12));
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 864e5));
    return isoOf(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
  }
  const s = String(v).trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  }
  if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/))) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return y + '-' + pad(m[2]) + '-' + pad(m[1]);
  }
  return null;
};
