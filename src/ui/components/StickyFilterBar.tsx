import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, RotateCcw, SlidersHorizontal, ChevronDown, Calendar, X } from 'lucide-react';
import { useApp } from '../state/AppContext';
import {
  formatBr,
  formatBrShort,
  lastDayOfMonth,
  mesNome,
  mesOf,
  nextMonth,
  pad,
  prevMonth,
  toDate,
  todayIso
} from '../../utils/date';
import {
  clampDateToPeriodBounds,
  computeDatasetAvailability,
  eachDay,
  periodDisplayName,
  periodOf,
  resolveEffectivePeriod,
  resolvePeriodDateBounds
} from '../../domain/periods';
import { listAvailablePlatforms, listAvailableUnits, lookupPlatform, resolvePersonFilter } from '../../domain/calculations';

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function StickyFilterBar() {
  const {
    filters,
    updateFilter,
    setFilters,
    resetFilters,
    dataset,
    pidx,
    isGlobal,
    activePeriod,
    availability: ctxAvailability
  } = useApp();
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarContainerRef = useRef<HTMLDivElement | null>(null);

  const today = todayIso();

  const availability = useMemo(() => {
    return (
      ctxAvailability ??
      computeDatasetAvailability(dataset, dataset.config.dia_corte_medicao, filters.fPer)
    );
  }, [ctxAvailability, dataset, filters.fPer]);

  const effectivePeriod = useMemo(() => {
    return (
      activePeriod ??
      resolveEffectivePeriod(filters, dataset.config.dia_corte_medicao, availability, today)
    );
  }, [activePeriod, filters, dataset.config.dia_corte_medicao, availability, today]);

  const rawDate = filters.fDate || today;
  const basePeriodBounds = useMemo(() => {
    return resolvePeriodDateBounds(effectivePeriod, rawDate, availability, today);
  }, [effectivePeriod, rawDate, availability, today]);

  const currentDate =
    filters.fPer && (rawDate < effectivePeriod.ini || rawDate > effectivePeriod.fim)
      ? basePeriodBounds.defaultDate
      : rawDate;

  const periodBounds = useMemo(() => {
    if (currentDate === rawDate) return basePeriodBounds;
    return resolvePeriodDateBounds(effectivePeriod, currentDate, availability, today);
  }, [currentDate, rawDate, basePeriodBounds, effectivePeriod, availability, today]);

  const [calendarMonth, setCalendarMonth] = useState<string>(() => mesOf(currentDate));

  useEffect(() => {
    if (!calendarOpen) return;
    const targetMonth = mesOf(currentDate);
    const minMonth = mesOf(periodBounds.minDate);
    const maxMonth = mesOf(periodBounds.maxDate);
    if (targetMonth < minMonth) setCalendarMonth(minMonth);
    else if (targetMonth > maxMonth) setCalendarMonth(maxMonth);
    else setCalendarMonth(targetMonth);
  }, [calendarOpen, currentDate, periodBounds.minDate, periodBounds.maxDate]);

  useEffect(() => {
    if (!calendarOpen) return;
    const handleMouseDown = (ev: MouseEvent) => {
      if (
        calendarContainerRef.current &&
        !calendarContainerRef.current.contains(ev.target as Node)
      ) {
        setCalendarOpen(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [calendarOpen]);

  // Unidades e plataformas disponíveis
  const availableUnits = useMemo(() => {
    return listAvailableUnits(dataset, pidx);
  }, [dataset, pidx]);

  const availablePlatforms = useMemo(() => {
    return listAvailablePlatforms(dataset, pidx, filters.fReg);
  }, [dataset, pidx, filters.fReg]);

  // Opções de Medição (apenas períodos com dados reais no contrato)
  const measurementOptions = availability.availablePeriods;

  // Pessoas agrupadas por papel operacional (para usuários com escopo global)
  const groupedPessoas = useMemo(() => {
    const list = Object.values(dataset.pessoas);
    return {
      prepostos: list.filter(p => p.papel === 'preposto').sort((a, b) => a.nome.localeCompare(b.nome)),
      controladores: list.filter(p => p.papel === 'controlador').sort((a, b) => a.nome.localeCompare(b.nome)),
      gestores: list.filter(p => p.papel === 'gestor').sort((a, b) => a.nome.localeCompare(b.nome))
    };
  }, [dataset.pessoas]);

  const selectedRespValue = useMemo(() => {
    if (!filters.fResp) return '';
    return resolvePersonFilter(filters.fResp, dataset.pessoas)?.id ?? filters.fResp;
  }, [filters.fResp, dataset.pessoas]);

  const handlePrevDay = () => {
    if (periodBounds.prevDateWithData) {
      updateFilter('fDate', periodBounds.prevDateWithData);
    }
  };

  const handleNextDay = () => {
    if (periodBounds.nextDateWithData) {
      updateFilter('fDate', periodBounds.nextDateWithData);
    }
  };

  const handleToday = () => {
    updateFilter('fDate', today);
  };

  const handlePeriodChange = (nextPer: string) => {
    const diaCorte = dataset.config.dia_corte_medicao;
    const nextAvail =
      nextPer && nextPer !== 'custom' && /^\d{4}-\d{2}$/.test(nextPer)
        ? computeDatasetAvailability(dataset, diaCorte, nextPer)
        : availability;
    const nextPeriod =
      nextPer === 'custom'
        ? filters.cIni && filters.cFim && filters.cIni <= filters.cFim
          ? resolveEffectivePeriod({ ...filters, fPer: nextPer }, diaCorte, nextAvail, today)
          : effectivePeriod
        : nextPer === ''
          ? nextAvail.availablePeriods[0]?.window || effectivePeriod
          : periodOf(nextPer, diaCorte);
    const nextBounds = resolvePeriodDateBounds(nextPeriod, currentDate, nextAvail, today);

    if (typeof setFilters === 'function') {
      setFilters(prev => ({
        ...prev,
        fPer: nextPer,
        fDate: nextBounds.defaultDate
      }));
      return;
    }
    updateFilter('fPer', nextPer);
  };

  const handleCustomRangeChange = (field: 'cIni' | 'cFim', value: string) => {
    const nextIni = field === 'cIni' ? value : filters.cIni;
    const nextFim = field === 'cFim' ? value : filters.cFim;
    if (
      typeof setFilters === 'function' &&
      filters.fPer === 'custom' &&
      nextIni &&
      nextFim &&
      nextIni <= nextFim
    ) {
      const nextPeriod = resolveEffectivePeriod(
        { ...filters, fPer: 'custom', cIni: nextIni, cFim: nextFim },
        dataset.config.dia_corte_medicao,
        availability,
        today
      );
      const nextBounds = resolvePeriodDateBounds(nextPeriod, currentDate, availability, today);
      setFilters(prev => ({
        ...prev,
        [field]: value,
        fDate:
          !prev.fDate ||
          prev.fDate < nextPeriod.ini ||
          prev.fDate > nextPeriod.fim ||
          (availability.datesWithData.size > 0 && !availability.datesWithData.has(prev.fDate))
            ? nextBounds.defaultDate
            : prev.fDate
      }));
      return;
    }
    updateFilter(field, value);
  };

  const periodDayStats = useMemo(() => {
    let totalDays = 0;
    let withData = 0;
    const hasSpecificDates = availability.datesWithData.size > 0;
    eachDay(effectivePeriod.ini, effectivePeriod.fim, d => {
      totalDays++;
      const hasD = hasSpecificDates
        ? availability.datesWithData.has(d)
        : d >= periodBounds.minDate && d <= periodBounds.maxDate;
      if (hasD) withData++;
    });
    return { totalDays, withData, withoutData: Math.max(0, totalDays - withData) };
  }, [effectivePeriod.ini, effectivePeriod.fim, availability.datesWithData, periodBounds.minDate, periodBounds.maxDate]);

  const calendarCells = useMemo(() => {
    const firstIso = `${calendarMonth}-01`;
    const lastIso = lastDayOfMonth(calendarMonth);
    const totalDaysInMonth = Number(lastIso.slice(8, 10));
    const leadingEmpty = toDate(firstIso).getDay();
    const hasSpecificDates = availability.datesWithData.size > 0;

    const cells: Array<{
      iso: string;
      dayNum: number;
      inPeriod: boolean;
      hasData: boolean;
      isSelected: boolean;
    } | null> = [];

    for (let i = 0; i < leadingEmpty; i++) {
      cells.push(null);
    }

    for (let d = 1; d <= totalDaysInMonth; d++) {
      const iso = `${calendarMonth}-${pad(d)}`;
      const inPeriod = iso >= effectivePeriod.ini && iso <= effectivePeriod.fim;
      const inBounds = iso >= periodBounds.minDate && iso <= periodBounds.maxDate;
      const hasData = hasSpecificDates ? availability.datesWithData.has(iso) : inBounds;
      cells.push({
        iso,
        dayNum: d,
        inPeriod,
        hasData,
        isSelected: iso === currentDate
      });
    }

    return cells;
  }, [calendarMonth, effectivePeriod.ini, effectivePeriod.fim, periodBounds.minDate, periodBounds.maxDate, availability.datesWithData, currentDate]);

  const minCalendarMonth = mesOf(periodBounds.minDate);
  const maxCalendarMonth = mesOf(periodBounds.maxDate);
  const canPrevMonth = calendarMonth > minCalendarMonth;
  const canNextMonth = calendarMonth < maxCalendarMonth;

  const isCustomDateActive = Boolean(
    filters.fDate &&
    filters.fDate !== today &&
    filters.fDate !== dataset.watermark.ultima_data_hh &&
    filters.fDate !== periodBounds.defaultDate
  );

  const isFiltered = Boolean(
    filters.fReg ||
    filters.fPlat ||
    filters.fResp ||
    filters.fPer ||
    isCustomDateActive
  );

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.fReg) count++;
    if (filters.fPlat) count++;
    if (filters.fResp) count++;
    if (filters.fPer) count++;
    if (isCustomDateActive) count++;
    return count;
  }, [filters.fReg, filters.fPlat, filters.fResp, filters.fPer, isCustomDateActive]);

  const watermarkFormatted = dataset.watermark.ultima_data_hh
    ? formatBr(dataset.watermark.ultima_data_hh)
    : 'Sem dados';

  const canShowTodayBtn =
    availability.datesWithData.has(today) &&
    today >= periodBounds.minDate &&
    today <= periodBounds.maxDate &&
    currentDate !== today;

  return (
    <div className="sticky-filter-bar" role="region" aria-label="Filtros globais">
      {/* Barra Compacta Superior para Telas Móveis e Tablets (<= 860px) */}
      <div className="filter-mobile-bar">
        <div className="filter-mobile-summary">
          <Calendar size={14} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span className="filter-mobile-date">
            {formatBr(currentDate)}
            {filters.fPer && (
              <span className="filter-mobile-period"> · {periodDisplayName(effectivePeriod)}</span>
            )}
          </span>
          {activeFiltersCount > 0 && (
            <span className="filter-mobile-badge" title={`${activeFiltersCount} filtros ativos`}>
              {activeFiltersCount}
            </span>
          )}
        </div>

        <div className="filter-mobile-actions">
          {isFiltered && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={resetFilters}
              title="Limpar todos os filtros aplicados"
              aria-label="Limpar filtros"
              style={{ padding: '3px 8px', fontSize: '0.75rem', minHeight: '30px' }}
            >
              <RotateCcw size={12} />
              <span>Limpar</span>
            </button>
          )}

          <button
            type="button"
            className={`filter-mobile-toggle-btn ${mobileExpanded ? 'open' : ''}`}
            onClick={() => setMobileExpanded(prev => !prev)}
            aria-expanded={mobileExpanded}
            aria-controls="filter-fields-container"
            aria-label="Alternar painel de filtros"
          >
            <SlidersHorizontal size={14} />
            <span>Filtros</span>
            <ChevronDown
              size={13}
              style={{
                transform: mobileExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform var(--transition-fast)'
              }}
            />
          </button>
        </div>
      </div>

      {/* Grade de Campos de Filtro (Em desktop sempre visível; em <= 860px expande sob demanda) */}
      <div
        id="filter-fields-container"
        className={`filter-bar-inner ${mobileExpanded ? 'mobile-expanded' : 'mobile-collapsed'}`.trim()}
      >
        {/* Dia do Apontamento + Calendário Visual de Disponibilidade */}
        <div className="filter-group filter-group-date" ref={calendarContainerRef}>
          <label className="filter-label" htmlFor="filter-date">
            Data
          </label>
          <div className="filter-date-nav">
            <button
              type="button"
              className="filter-date-btn"
              onClick={handlePrevDay}
              disabled={!periodBounds.prevDateWithData}
              title={
                periodBounds.prevDateWithData
                  ? `Dia anterior com dados (${formatBr(periodBounds.prevDateWithData)})`
                  : 'Não há dias anteriores com dados neste período'
              }
              aria-label="Dia anterior"
            >
              <ChevronLeft size={15} />
            </button>
            <input
              id="filter-date"
              type="date"
              className="filter-input filter-input-date"
              value={currentDate}
              min={periodBounds.minDate}
              max={periodBounds.maxDate}
              onChange={e => updateFilter('fDate', clampDateToPeriodBounds(e.target.value, periodBounds))}
            />
            <button
              type="button"
              className="filter-date-btn"
              onClick={handleNextDay}
              disabled={!periodBounds.nextDateWithData}
              title={
                periodBounds.nextDateWithData
                  ? `Próximo dia com dados (${formatBr(periodBounds.nextDateWithData)})`
                  : 'Não há dias posteriores com dados neste período'
              }
              aria-label="Próximo dia"
            >
              <ChevronRight size={15} />
            </button>
            <button
              type="button"
              className={`filter-date-btn filter-calendar-toggle ${calendarOpen ? 'open' : ''}`.trim()}
              onClick={() => setCalendarOpen(prev => !prev)}
              title="Abrir calendário do período (ver dias com e sem dados)"
              aria-label="Abrir calendário do período"
              aria-expanded={calendarOpen}
              aria-haspopup="dialog"
            >
              <Calendar size={14} />
            </button>
            {canShowTodayBtn && (
              <button
                type="button"
                className="filter-today-btn"
                onClick={handleToday}
                title="Voltar para a data de hoje"
              >
                Hoje
              </button>
            )}
            {periodBounds.maxDate && currentDate !== periodBounds.maxDate && (
              <button
                type="button"
                className="filter-today-btn"
                onClick={() => updateFilter('fDate', periodBounds.maxDate)}
                title={`Ir para o último dia com dados no período (${formatBr(periodBounds.maxDate)})`}
              >
                Último dado
              </button>
            )}
          </div>

          {calendarOpen && (
            <div
              className="filter-calendar-popover"
              role="dialog"
              aria-label={`Calendário do período ${periodDisplayName(effectivePeriod)}`}
            >
              <div className="cal-popover-header">
                <button
                  type="button"
                  className="cal-nav-btn"
                  onClick={() => canPrevMonth && setCalendarMonth(prevMonth(calendarMonth))}
                  disabled={!canPrevMonth}
                  aria-label="Mês anterior"
                  title={canPrevMonth ? 'Mês anterior' : 'Não há dados em meses anteriores deste período'}
                >
                  <ChevronLeft size={15} />
                </button>
                <div className="cal-header-titles">
                  <span className="cal-month-title">{mesNome(calendarMonth)}</span>
                  <span className="cal-period-sub">
                    Período: {formatBrShort(effectivePeriod.ini)} a {formatBrShort(effectivePeriod.fim)}
                  </span>
                </div>
                <div className="cal-header-right-btns">
                  <button
                    type="button"
                    className="cal-nav-btn"
                    onClick={() => canNextMonth && setCalendarMonth(nextMonth(calendarMonth))}
                    disabled={!canNextMonth}
                    aria-label="Próximo mês"
                    title={canNextMonth ? 'Próximo mês' : 'Não há dados em meses posteriores deste período'}
                  >
                    <ChevronRight size={15} />
                  </button>
                  <button
                    type="button"
                    className="cal-nav-btn cal-close-btn"
                    onClick={() => setCalendarOpen(false)}
                    aria-label="Fechar calendário"
                    title="Fechar calendário"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="cal-stats-bar">
                <span className="cal-stat-with">{periodDayStats.withData} dias com dados</span>
                <span className="cal-stat-sep">·</span>
                <span className="cal-stat-without">{periodDayStats.withoutData} sem dados</span>
              </div>

              <div className="cal-weekdays" aria-hidden="true">
                {WEEKDAY_LABELS.map(w => (
                  <span key={w} className="cal-weekday">{w}</span>
                ))}
              </div>

              <div className="cal-grid">
                {calendarCells.map((cell, idx) => {
                  if (!cell) {
                    return <div key={`empty-${idx}`} className="cal-day cal-day-blank" aria-hidden="true" />;
                  }
                  const clickable = cell.inPeriod && cell.hasData;
                  const stateClass = !cell.inPeriod
                    ? 'outside-period'
                    : cell.hasData
                      ? 'has-data'
                      : 'no-data';
                  const titleText = !cell.inPeriod
                    ? `${formatBr(cell.iso)} — Fora do período (${formatBrShort(effectivePeriod.ini)} a ${formatBrShort(effectivePeriod.fim)})`
                    : cell.hasData
                      ? `${formatBr(cell.iso)} — Dia com dados`
                      : `${formatBr(cell.iso)} — Sem dados (bloqueado)`;

                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      className={`cal-day ${stateClass} ${cell.isSelected ? 'selected' : ''}`.trim()}
                      disabled={!clickable}
                      aria-disabled={!clickable}
                      aria-pressed={cell.isSelected}
                      aria-label={titleText}
                      title={titleText}
                      onClick={() => {
                        if (!clickable) return;
                        updateFilter('fDate', cell.iso);
                        setCalendarOpen(false);
                      }}
                    >
                      <span className="cal-day-num">{cell.dayNum}</span>
                      {cell.inPeriod && (
                        cell.hasData ? (
                          <span className="cal-day-dot" aria-hidden="true" />
                        ) : (
                          <span className="cal-day-empty-tag" aria-hidden="true">s/ dados</span>
                        )
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="cal-legend">
                <span className="cal-legend-item">
                  <span className="cal-legend-swatch has-data" aria-hidden="true" />
                  Com dados
                </span>
                <span className="cal-legend-item">
                  <span className="cal-legend-swatch no-data" aria-hidden="true" />
                  Sem dados (bloqueado)
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Unidade de Negócio */}
        <div className="filter-group filter-group-reg">
          <label className="filter-label" htmlFor="filter-reg">
            UN
          </label>
          <select
            id="filter-reg"
            className="filter-select"
            value={filters.fReg}
            onChange={e => {
              const nextUn = e.target.value;
              if (nextUn && filters.fPlat && typeof setFilters === 'function') {
                const platObj = lookupPlatform(pidx, filters.fPlat);
                if (platObj && platObj.un !== nextUn) {
                  setFilters(prev => ({ ...prev, fReg: nextUn, fPlat: '' }));
                  return;
                }
              }
              updateFilter('fReg', nextUn);
            }}
          >
            <option value="">Todas as UNs</option>
            {availableUnits.map(un => (
              <option key={un} value={un}>
                {un}
              </option>
            ))}
          </select>
        </div>

        {/* Plataforma */}
        <div className="filter-group filter-group-plat">
          <label className="filter-label" htmlFor="filter-plat">
            Plataforma
          </label>
          <select
            id="filter-plat"
            className="filter-select"
            value={filters.fPlat}
            onChange={e => updateFilter('fPlat', e.target.value)}
          >
            <option value="">Todas as plataformas</option>
            {availablePlatforms.map(plat => (
              <option key={plat} value={plat}>
                {plat}
              </option>
            ))}
          </select>
        </div>

        {/* Responsável (Exibido apenas em escopo global) */}
        {isGlobal && (
          <div className="filter-group filter-group-resp">
            <label className="filter-label" htmlFor="filter-resp">
              Responsável
            </label>
            <select
              id="filter-resp"
              className="filter-select"
              value={selectedRespValue}
              onChange={e => updateFilter('fResp', e.target.value)}
            >
              <option value="">Todos os responsáveis</option>
              {groupedPessoas.prepostos.length > 0 && (
                <optgroup label="Prepostos">
                  {groupedPessoas.prepostos.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </optgroup>
              )}
              {groupedPessoas.controladores.length > 0 && (
                <optgroup label="Controladores">
                  {groupedPessoas.controladores.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </optgroup>
              )}
              {groupedPessoas.gestores.length > 0 && (
                <optgroup label="Gestores">
                  {groupedPessoas.gestores.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}

        {/* Período de Medição */}
        <div className="filter-group filter-group-per">
          <label className="filter-label" htmlFor="filter-per">
            Período
          </label>
          <select
            id="filter-per"
            className="filter-select"
            value={filters.fPer}
            onChange={e => handlePeriodChange(e.target.value)}
          >
            <option value="">Medição atual (automática)</option>
            {measurementOptions.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            <option value="custom">Personalizado…</option>
          </select>
        </div>

        {/* Datas Personalizadas se 'custom' */}
        {filters.fPer === 'custom' && (
          <>
            <div className="filter-group filter-group-custom-date">
              <label className="filter-label" htmlFor="filter-cini">
                De
              </label>
              <input
                id="filter-cini"
                type="date"
                className="filter-input filter-input-date"
                value={filters.cIni}
                max={filters.cFim || undefined}
                onChange={e => handleCustomRangeChange('cIni', e.target.value)}
              />
            </div>
            <div className="filter-group filter-group-custom-date">
              <label className="filter-label" htmlFor="filter-cfim">
                Até
              </label>
              <input
                id="filter-cfim"
                type="date"
                className="filter-input filter-input-date"
                value={filters.cFim}
                min={filters.cIni || undefined}
                onChange={e => handleCustomRangeChange('cFim', e.target.value)}
              />
            </div>
          </>
        )}

        {/* Botão Limpar Filtros */}
        {isFiltered && (
          <button
            type="button"
            className="filter-clear-btn"
            onClick={resetFilters}
            title="Limpar todos os filtros aplicados"
            aria-label="Limpar filtros"
          >
            <RotateCcw size={13} />
            <span>Limpar</span>
          </button>
        )}

        {/* Indicador de Watermark */}
        <div className="watermark-pill" title="Última data de apontamento com carga no sistema">
          <Clock size={13} className="watermark-icon" />
          <span>Dados até: <strong>{watermarkFormatted}</strong></span>
        </div>
      </div>
    </div>
  );
}
