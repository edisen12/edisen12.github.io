import type { FilterState, PeriodWindow } from './types';
import {
  addDays,
  formatBrShort,
  lastDayOfMonth,
  mesNome,
  mesOf,
  nextMonth,
  pad,
  prevMonth,
  todayIso
} from '../utils/date';

export const periodOf = (ym: string, diaCorte: number): PeriodWindow => {
  const corte = Number(diaCorte) || 1;
  if (corte === 1) {
    return {
      ini: `${ym}-01`,
      fim: lastDayOfMonth(ym),
      m: ym
    };
  }
  const pm = prevMonth(ym);
  return {
    ini: `${pm}-${pad(corte)}`,
    fim: `${ym}-${pad(corte - 1)}`,
    m: ym
  };
};

export const perContaining = (dateIso: string, diaCorte: number): string => {
  const corte = Number(diaCorte) || 1;
  const m = mesOf(dateIso);
  if (corte === 1) return m;
  const day = Number(dateIso.slice(8, 10));
  return day >= corte ? nextMonth(m) : m;
};

export const resolveActivePeriod = (
  filters: FilterState,
  diaCorte: number,
  today?: string
): PeriodWindow => {
  if (filters.fPer === 'custom' && filters.cIni && filters.cFim && filters.cIni <= filters.cFim) {
    return {
      ini: filters.cIni,
      fim: filters.cFim,
      m: mesOf(filters.cFim),
      custom: true
    };
  }
  const ref = filters.fDate || today || todayIso();
  const ym = filters.fPer && filters.fPer !== 'custom' ? filters.fPer : perContaining(ref, diaCorte);
  return periodOf(ym, diaCorte);
};

export const periodDisplayName = (P: PeriodWindow): string =>
  P.custom ? 'Período livre' : `Medição de ${mesNome(P.m)}`;

export const periodFileSlug = (P: PeriodWindow): string =>
  P.custom ? `${P.ini} a ${P.fim}` : P.m;

export const listMeasurementOptions = (
  refDateIso: string,
  diaCorte: number,
  count = 13
): Array<{ value: string; label: string; window: PeriodWindow }> => {
  const cur = perContaining(refDateIso, diaCorte);
  const options: Array<{ value: string; label: string; window: PeriodWindow }> = [];
  let m = nextMonth(cur);

  for (let i = 0; i < count; i++) {
    const P = periodOf(m, diaCorte);
    options.push({
      value: m,
      label: `Medição ${mesNome(m)} (${formatBrShort(P.ini)} a ${formatBrShort(P.fim)})`,
      window: P
    });
    m = prevMonth(m);
  }

  return options;
};

export const eachDay = (ini: string, fim: string, fn: (d: string) => void): void => {
  for (let x = ini; x <= fim; x = addDays(x, 1)) {
    fn(x);
  }
};

export const neededQueryWindow = (
  P: PeriodWindow,
  refDate: string
): { queryIni: string; queryFim: string } => {
  const minDate = P.ini < refDate ? P.ini : refDate;
  const maxDate = P.fim > refDate ? P.fim : refDate;
  return {
    queryIni: addDays(minDate, -45),
    queryFim: maxDate
  };
};
