import type { AppDataset, FilterState, PeriodWindow } from './types';
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
import { isArmadorDiariaSemProg } from './calculations';

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

export interface MeasurementOption {
  value: string;
  label: string;
  window: PeriodWindow;
}

export interface DatasetPeriodAvailability {
  datesWithData: Set<string>;
  sortedDatesWithData: string[];
  minDatasetDate: string | null;
  maxDatasetDate: string | null;
  availablePeriods: MeasurementOption[];
}

export interface PeriodDateBounds {
  minDate: string;
  maxDate: string;
  defaultDate: string;
  prevDateWithData: string | null;
  nextDateWithData: string | null;
  periodDatesWithData: string[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Calcula quais datas e períodos de medição realmente possuem dados no dataset carregado,
 * evitando oferecer meses sem medição (ex.: setembro sem embarques encerrados em setembro)
 * e identificando dias exatos sem dados para bloqueio/destaque no calendário.
 */
export const computeDatasetAvailability = (
  dataset: AppDataset,
  diaCorte: number,
  selectedPer?: string
): DatasetPeriodAvailability => {
  const datesWithData = new Set<string>();
  const hhList = Object.values(dataset.hhMap || {});
  const justList = Object.values(dataset.justMap || {});
  const carteiraList = dataset.carteira || [];
  const opsList = dataset.carteiraOperacoes || [];

  let maxHhOrWatermark = dataset.watermark?.ultima_data_hh || '';
  for (const h of hhList) {
    if (ISO_DATE_RE.test(h.data)) {
      datesWithData.add(h.data);
      if (!maxHhOrWatermark || h.data > maxHhOrWatermark) {
        maxHhOrWatermark = h.data;
      }
    }
  }

  for (const j of justList) {
    if (ISO_DATE_RE.test(j.data)) {
      datesWithData.add(j.data);
    }
  }

  for (const c of carteiraList) {
    if (isArmadorDiariaSemProg(c, dataset.plataformas, dataset.usoffUnWeights)) {
      continue;
    }
    if (!ISO_DATE_RE.test(c.data_inicio) || !ISO_DATE_RE.test(c.data_fim)) {
      continue;
    }
    const endCap =
      maxHhOrWatermark && maxHhOrWatermark < c.data_fim ? maxHhOrWatermark : c.data_fim;
    if (c.data_inicio <= endCap) {
      eachDay(c.data_inicio, endCap, d => datesWithData.add(d));
    }
  }

  if (datesWithData.size === 0 && dataset.watermark?.ultima_data_hh && ISO_DATE_RE.test(dataset.watermark.ultima_data_hh)) {
    datesWithData.add(dataset.watermark.ultima_data_hh);
  }

  const sortedDatesWithData = Array.from(datesWithData).sort();
  const minDatasetDate = sortedDatesWithData[0] ?? null;
  const maxDatasetDate = sortedDatesWithData[sortedDatesWithData.length - 1] ?? null;

  const periodHasData = (ym: string): boolean => {
    const win = periodOf(ym, diaCorte);
    return sortedDatesWithData.some(d => d >= win.ini && d <= win.fim);
  };

  const periodKeys = new Set<string>();
  const hasCarteira = carteiraList.length > 0 || opsList.length > 0;
  const isEnc = (dataset.config?.med_criterio || 'enc') === 'enc';

  if (hasCarteira) {
    if (isEnc) {
      for (const c of carteiraList) {
        if (!ISO_DATE_RE.test(c.data_fim)) continue;
        const ym = perContaining(c.data_fim, diaCorte);
        if (!maxHhOrWatermark || c.data_fim <= maxHhOrWatermark || periodHasData(ym)) {
          periodKeys.add(ym);
        }
      }
      for (const op of opsList) {
        if (op.status_programacao === 'Cancelada' || !ISO_DATE_RE.test(op.data_fim)) continue;
        const ym = perContaining(op.data_fim, diaCorte);
        if (!maxHhOrWatermark || op.data_fim <= maxHhOrWatermark || periodHasData(ym)) {
          periodKeys.add(ym);
        }
      }
      // Apontamentos em hhMap só adicionam período próprio se NÃO pertencerem a um embarque
      // já presente na carteira (evita criar medição de setembro só por início de embarque de outubro).
      for (const hh of hhList) {
        if (!ISO_DATE_RE.test(hh.data)) continue;
        const insideCarteira = carteiraList.some(
          c => c.matricula === hh.matricula && c.data_inicio <= hh.data && hh.data <= c.data_fim
        );
        if (!insideCarteira) {
          periodKeys.add(perContaining(hh.data, diaCorte));
        }
      }
    } else {
      for (const d of sortedDatesWithData) {
        periodKeys.add(perContaining(d, diaCorte));
      }
      if (!maxHhOrWatermark) {
        for (const c of carteiraList) {
          if (!ISO_DATE_RE.test(c.data_inicio) || !ISO_DATE_RE.test(c.data_fim)) continue;
          const startYm = perContaining(c.data_inicio, diaCorte);
          const endYm = perContaining(c.data_fim, diaCorte);
          let curYm = startYm;
          for (let guard = 0; guard < 24 && curYm <= endYm; guard++) {
            periodKeys.add(curYm);
            curYm = nextMonth(curYm);
          }
        }
      }
    }
  } else {
    for (const d of sortedDatesWithData) {
      periodKeys.add(perContaining(d, diaCorte));
    }
    if (dataset.watermark?.ultima_data_hh && ISO_DATE_RE.test(dataset.watermark.ultima_data_hh)) {
      periodKeys.add(perContaining(dataset.watermark.ultima_data_hh, diaCorte));
    }
  }

  if (selectedPer && ISO_MONTH_RE.test(selectedPer)) {
    periodKeys.add(selectedPer);
  }

  if (periodKeys.size === 0) {
    const fallbackIso =
      dataset.watermark?.ultima_data_hh && ISO_DATE_RE.test(dataset.watermark.ultima_data_hh)
        ? dataset.watermark.ultima_data_hh
        : todayIso();
    periodKeys.add(perContaining(fallbackIso, diaCorte));
  }

  const availablePeriods: MeasurementOption[] = Array.from(periodKeys)
    .sort((a, b) => b.localeCompare(a))
    .map(m => {
      const P = periodOf(m, diaCorte);
      return {
        value: m,
        label: `Medição ${mesNome(m)} (${formatBrShort(P.ini)} a ${formatBrShort(P.fim)})`,
        window: P
      };
    });

  return {
    datesWithData,
    sortedDatesWithData,
    minDatasetDate,
    maxDatasetDate,
    availablePeriods
  };
};

/**
 * Resolve o período ativo considerando a disponibilidade real de medições no dataset
 * quando fPer está no modo automático ('').
 */
export const resolveEffectivePeriod = (
  filters: FilterState,
  diaCorte: number,
  availability: DatasetPeriodAvailability,
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
  if (filters.fPer && filters.fPer !== 'custom') {
    return periodOf(filters.fPer, diaCorte);
  }

  const ref = filters.fDate || today || todayIso();
  const candidateYm = perContaining(ref, diaCorte);
  if (availability.availablePeriods.length > 0) {
    const matched = availability.availablePeriods.find(opt => opt.value === candidateYm);
    if (matched) return matched.window;
    return availability.availablePeriods[0].window;
  }
  return periodOf(candidateYm, diaCorte);
};

/**
 * Resolve limites navegáveis de datas dentro de um período P com base nos dias que possuem dados.
 * Impede voltar antes do primeiro dia disponível ou avançar para dias vazios futuros.
 */
export const resolvePeriodDateBounds = (
  P: PeriodWindow,
  currentDate: string,
  availability: DatasetPeriodAvailability,
  today?: string
): PeriodDateBounds => {
  const refToday = today || todayIso();
  const periodDatesWithData = availability.sortedDatesWithData.filter(
    d => d >= P.ini && d <= P.fim
  );

  if (periodDatesWithData.length > 0) {
    const minDate = periodDatesWithData[0];
    const maxDate = periodDatesWithData[periodDatesWithData.length - 1];
    const defaultDate = maxDate;
    const effCurrent = currentDate || defaultDate;

    let prevDateWithData: string | null = null;
    for (let i = periodDatesWithData.length - 1; i >= 0; i--) {
      if (periodDatesWithData[i] < effCurrent) {
        prevDateWithData = periodDatesWithData[i];
        break;
      }
    }

    let nextDateWithData: string | null = null;
    for (let i = 0; i < periodDatesWithData.length; i++) {
      if (periodDatesWithData[i] > effCurrent) {
        nextDateWithData = periodDatesWithData[i];
        break;
      }
    }

    return {
      minDate,
      maxDate,
      defaultDate,
      prevDateWithData,
      nextDateWithData,
      periodDatesWithData
    };
  }

  const minDate = P.ini;
  const maxCandidate = P.fim < refToday ? P.fim : refToday;
  const maxDate = maxCandidate >= minDate ? maxCandidate : P.fim;
  const defaultDate = maxDate;
  const effCurrent = currentDate || defaultDate;

  const prevCandidate = effCurrent > minDate ? addDays(effCurrent, -1) : null;
  const prevDateWithData =
    prevCandidate && prevCandidate >= minDate
      ? prevCandidate > maxDate
        ? maxDate
        : prevCandidate
      : null;

  const nextCandidate = effCurrent < maxDate ? addDays(effCurrent, 1) : null;
  const nextDateWithData =
    nextCandidate && nextCandidate <= maxDate
      ? nextCandidate < minDate
        ? minDate
        : nextCandidate
      : null;

  return {
    minDate,
    maxDate,
    defaultDate,
    prevDateWithData,
    nextDateWithData,
    periodDatesWithData: []
  };
};

/**
 * Garante que qualquer data selecionada permaneça dentro dos limites válidos do período
 * e, quando houver dias com dados no período, encaixa no dia com dados mais próximo <= targetDate.
 */
export const clampDateToPeriodBounds = (
  targetDate: string,
  bounds: PeriodDateBounds
): string => {
  if (!targetDate || !ISO_DATE_RE.test(targetDate)) {
    return bounds.defaultDate;
  }

  if (bounds.periodDatesWithData.length > 0) {
    if (bounds.periodDatesWithData.includes(targetDate)) {
      return targetDate;
    }
    if (targetDate <= bounds.minDate) {
      return bounds.minDate;
    }
    if (targetDate >= bounds.maxDate) {
      return bounds.maxDate;
    }
    for (let i = bounds.periodDatesWithData.length - 1; i >= 0; i--) {
      if (bounds.periodDatesWithData[i] < targetDate) {
        return bounds.periodDatesWithData[i];
      }
    }
    return bounds.minDate;
  }

  if (targetDate < bounds.minDate) return bounds.minDate;
  if (targetDate > bounds.maxDate) return bounds.maxDate;
  return targetDate;
};

/**
 * Resolve defensivamente a data de referência exibida nas views operacionais:
 * quando um período de medição (fPer) está filtrado e fDate está fora da janela [P.ini, P.fim],
 * retorna a última data válida com dados dentro do período em vez de exibir "hoje".
 */
export const resolveDisplayDateForPeriod = (
  P: PeriodWindow | undefined,
  filters: FilterState,
  dataset: AppDataset,
  availability?: DatasetPeriodAvailability,
  today?: string
): string => {
  const rawD = filters.fDate || '';
  if (!P || !filters.fPer || (rawD && rawD >= P.ini && rawD <= P.fim)) {
    return rawD;
  }
  const avail =
    availability ??
    computeDatasetAvailability(dataset, dataset.config.dia_corte_medicao, filters.fPer);
  return resolvePeriodDateBounds(P, rawD, avail, today).defaultDate;
};
