import React, { useState, useMemo, useEffect } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import { useApp } from '../state/AppContext';

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'center' | 'right';
  width?: string;
  className?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string;
  searchable?: boolean;
  searchPlaceholder?: string;
  getSearchString?: (row: T) => string;
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  emptyMessage?: string;
  className?: string;
  pageSizeOptions?: number[];
  initialPageSize?: number;
  pageSize?: number;
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  rowClassName,
  searchable = false,
  searchPlaceholder = 'Buscar...',
  getSearchString,
  defaultSortKey,
  defaultSortDir = 'asc',
  emptyMessage = 'Nenhum registro encontrado.',
  className = '',
  pageSizeOptions = [25, 50, 100],
  initialPageSize,
  pageSize: propPageSize
}: DataTableProps<T>) {
  const { userPreferences, updateUserPreferences } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);

  // Fallback: prop pageSize -> initialPageSize -> userPreferences.pageSize -> 50
  const [pageSize, setPageSize] = useState<number>(() => {
    if (propPageSize !== undefined) return propPageSize;
    if (initialPageSize !== undefined) return initialPageSize;
    return userPreferences?.pageSize ?? 50;
  });
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Sincroniza estado interno caso userPreferences.pageSize mude (e pageSize não tenha sido fixada via prop)
  useEffect(() => {
    if (propPageSize === undefined && userPreferences?.pageSize) {
      setPageSize(userPreferences.pageSize);
    }
  }, [userPreferences?.pageSize, propPageSize]);

  // Se o chamador alterar a prop pageSize
  useEffect(() => {
    if (propPageSize !== undefined) {
      setPageSize(propPageSize);
    }
  }, [propPageSize]);

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
    if (propPageSize === undefined && (newSize === 25 || newSize === 50 || newSize === 100)) {
      updateUserPreferences?.({ pageSize: newSize as 25 | 50 | 100 }).catch(() => {});
    }
  };

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Filtragem
  const filteredData = useMemo(() => {
    if (!debouncedSearch.trim() || !searchable) return data;
    const q = debouncedSearch.toLowerCase().trim();

    return data.filter(row => {
      if (getSearchString) {
        return getSearchString(row).toLowerCase().includes(q);
      }
      // Fallback: procura em todas as colunas
      return columns.some(col => {
        if (col.sortValue) {
          const val = col.sortValue(row);
          return val != null && String(val).toLowerCase().includes(q);
        }
        return false;
      });
    });
  }, [data, debouncedSearch, searchable, getSearchString, columns]);

  // Ordenação
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    const col = columns.find(c => c.key === sortKey);
    if (!col || !col.sortValue) return filteredData;

    return [...filteredData].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);

      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;

      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, sortKey, sortDir, columns]);

  // Paginação
  const totalItems = sortedData.length;
  const isPaged = pageSize > 0 && totalItems > pageSize;
  const totalPages = pageSize > 0 ? Math.ceil(totalItems / pageSize) : 1;

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  const paginatedData = useMemo(() => {
    if (!isPaged) return sortedData;
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, isPaged, currentPage, pageSize]);

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = pageSize > 0 ? Math.min(currentPage * pageSize, totalItems) : totalItems;

  const handleSort = (key: string) => {
    const col = columns.find(c => c.key === key);
    if (!col?.sortValue) return;

    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className={`datatable-container ${className}`.trim()} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Barra de Filtro e Busca */}
      {searchable && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', maxWidth: '320px', width: '100%' }}>
            <Search
              size={16}
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }}
            />
            <input
              type="text"
              className="filter-input"
              style={{ width: '100%', paddingLeft: '32px' }}
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          {debouncedSearch.trim() && (
            <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
              {totalItems} {totalItems === 1 ? 'registro encontrado' : 'registros encontrados'}
            </span>
          )}
        </div>
      )}

      {/* Tabela com Sticky Header */}
      <div className="table-wrap">
        <table className="tb">
          <thead>
            <tr>
              {columns.map(col => {
                const isSortable = !!col.sortValue;
                const isSorted = sortKey === col.key;
                const alignClass = col.align === 'right' ? 'num' : col.align === 'center' ? 'center' : '';

                return (
                  <th
                    key={col.key}
                    className={`${alignClass} ${col.className || ''}`.trim()}
                    style={{
                      width: col.width,
                      minWidth: col.width,
                      cursor: isSortable ? 'pointer' : 'default',
                      userSelect: 'none'
                    }}
                    onClick={() => isSortable && handleSort(col.key)}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start',
                        width: '100%'
                      }}
                    >
                      <span>{col.header}</span>
                      {isSortable && (
                        <span style={{ color: isSorted ? 'var(--blue)' : 'var(--ink-light)', display: 'inline-flex' }}>
                          {isSorted ? (
                            sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
                          ) : (
                            <ArrowUpDown size={12} opacity={0.6} />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-muted)' }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedData.map((row, rowIdx) => {
                const k = rowKey(row, rowIdx);
                const rClass = rowClassName ? rowClassName(row, rowIdx) : '';

                return (
                  <tr key={k} className={rClass}>
                    {columns.map(col => {
                      const alignClass = col.align === 'right' ? 'num' : col.align === 'center' ? 'center' : '';
                      return (
                        <td
                          key={col.key}
                          className={`${alignClass} ${col.className || ''}`.trim()}
                          style={{
                            width: col.width,
                            minWidth: col.width,
                            verticalAlign: 'middle',
                            textAlign: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left'
                          }}
                        >
                          {col.render ? col.render(row, rowIdx) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Controles de Paginação (quando sortedData.length > 25) */}
      {totalItems > 25 && (
        <div
          className="datatable-footer"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 4px',
            fontSize: '0.82rem',
            flexWrap: 'wrap',
            gap: '12px',
            borderTop: '1px solid var(--line)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--ink-muted)' }}>
              Exibindo <strong style={{ color: 'var(--ink)' }}>{startItem}–{endItem}</strong> de <strong style={{ color: 'var(--ink)' }}>{totalItems}</strong> registros
            </span>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--ink-muted)' }}>
              <span>Linhas por página:</span>
              <div
                className="segmented-control segmented-sm"
                role="group"
                aria-label="Linhas por página"
                style={{ padding: '2px', display: 'inline-flex' }}
              >
                {[25, 50, 100].map(sz => {
                  const isActive = pageSize === sz;
                  return (
                    <button
                      key={sz}
                      type="button"
                      className={`segmented-btn${isActive ? ' active' : ''}`}
                      style={{ padding: '2px 8px', fontSize: '0.78rem', minHeight: '24px' }}
                      onClick={() => handlePageSizeChange(sz)}
                    >
                      {sz}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>
              Página {currentPage} de {Math.max(1, totalPages)}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              >
                Próxima
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
