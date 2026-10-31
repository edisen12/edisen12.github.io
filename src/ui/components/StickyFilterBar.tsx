import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Clock, RotateCcw } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { addDays, formatBr, todayIso } from '../../utils/date';
import { listMeasurementOptions } from '../../domain/periods';
import { listAvailablePlatforms, listAvailableUnits } from '../../domain/calculations';

export function StickyFilterBar() {
  const { filters, updateFilter, resetFilters, dataset, pidx, isGlobal } = useApp();

  const today = todayIso();
  const currentDate = filters.fDate || today;

  // Unidades e plataformas disponíveis
  const availableUnits = useMemo(() => {
    return listAvailableUnits(dataset, pidx);
  }, [dataset, pidx]);

  const availablePlatforms = useMemo(() => {
    return listAvailablePlatforms(dataset, pidx, filters.fReg);
  }, [dataset, pidx, filters.fReg]);

  // Opções de Medição
  const measurementOptions = useMemo(() => {
    return listMeasurementOptions(currentDate, dataset.config.dia_corte_medicao, 12);
  }, [currentDate, dataset.config.dia_corte_medicao]);

  // Pessoas agrupadas por papel operacional (para usuários com escopo global)
  const groupedPessoas = useMemo(() => {
    const list = Object.values(dataset.pessoas);
    return {
      prepostos: list.filter(p => p.papel === 'preposto').sort((a, b) => a.nome.localeCompare(b.nome)),
      controladores: list.filter(p => p.papel === 'controlador').sort((a, b) => a.nome.localeCompare(b.nome)),
      gestores: list.filter(p => p.papel === 'gestor').sort((a, b) => a.nome.localeCompare(b.nome))
    };
  }, [dataset.pessoas]);

  const handlePrevDay = () => {
    updateFilter('fDate', addDays(currentDate, -1));
  };

  const handleNextDay = () => {
    updateFilter('fDate', addDays(currentDate, 1));
  };

  const handleToday = () => {
    updateFilter('fDate', today);
  };

  const isFiltered = Boolean(
    filters.fReg ||
    filters.fPlat ||
    filters.fResp ||
    filters.fPer ||
    (filters.fDate && filters.fDate !== today)
  );

  const watermarkFormatted = dataset.watermark.ultima_data_hh
    ? formatBr(dataset.watermark.ultima_data_hh)
    : 'Sem dados';

  return (
    <div className="sticky-filter-bar" role="region" aria-label="Filtros globais">
      <div className="filter-bar-inner">
        {/* Dia do Apontamento */}
        <div className="filter-group filter-group-date">
          <label className="filter-label" htmlFor="filter-date">
            Data
          </label>
          <div className="filter-date-nav">
            <button
              type="button"
              className="filter-date-btn"
              onClick={handlePrevDay}
              title="Dia anterior"
              aria-label="Dia anterior"
            >
              <ChevronLeft size={15} />
            </button>
            <input
              id="filter-date"
              type="date"
              className="filter-input filter-input-date"
              value={currentDate}
              onChange={e => updateFilter('fDate', e.target.value)}
            />
            <button
              type="button"
              className="filter-date-btn"
              onClick={handleNextDay}
              title="Próximo dia"
              aria-label="Próximo dia"
            >
              <ChevronRight size={15} />
            </button>
            {currentDate !== today && (
              <button
                type="button"
                className="filter-today-btn"
                onClick={handleToday}
                title="Voltar para a data de hoje"
              >
                Hoje
              </button>
            )}
          </div>
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
            onChange={e => updateFilter('fReg', e.target.value)}
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
              value={filters.fResp}
              onChange={e => updateFilter('fResp', e.target.value)}
            >
              <option value="">Todos os responsáveis</option>
              {groupedPessoas.prepostos.length > 0 && (
                <optgroup label="Prepostos">
                  {groupedPessoas.prepostos.map(p => (
                    <option key={p.id} value={p.nome}>
                      {p.nome}
                    </option>
                  ))}
                </optgroup>
              )}
              {groupedPessoas.controladores.length > 0 && (
                <optgroup label="Controladores">
                  {groupedPessoas.controladores.map(p => (
                    <option key={p.id} value={p.nome}>
                      {p.nome}
                    </option>
                  ))}
                </optgroup>
              )}
              {groupedPessoas.gestores.length > 0 && (
                <optgroup label="Gestores">
                  {groupedPessoas.gestores.map(p => (
                    <option key={p.id} value={p.nome}>
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
            onChange={e => updateFilter('fPer', e.target.value)}
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
                onChange={e => updateFilter('cIni', e.target.value)}
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
                onChange={e => updateFilter('cFim', e.target.value)}
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
