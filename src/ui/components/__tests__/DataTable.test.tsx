import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DataTable, type DataTableColumn } from '../DataTable';
import { useApp } from '../../state/AppContext';

// Mock do hook useApp para isolamento total de dados e preferências
vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

interface SampleRow {
  id: string;
  nome: string;
  funcao: string;
  horas: number;
}

const SAMPLE_COLUMNS: DataTableColumn<SampleRow>[] = [
  {
    key: 'nome',
    header: 'Nome do Colaborador',
    sortValue: r => r.nome
  },
  {
    key: 'funcao',
    header: 'Função Operacional',
    sortValue: r => r.funcao
  },
  {
    key: 'horas',
    header: 'Horas Realizadas',
    align: 'right',
    sortValue: r => r.horas,
    render: r => <span>{r.horas}h</span>
  }
];

const SAMPLE_DATA: SampleRow[] = [
  { id: '1', nome: 'Carlos Silva', funcao: 'Eletricista Offshore', horas: 168 },
  { id: '2', nome: 'Ana Souza', funcao: 'Supervisora de Operações', horas: 180 },
  { id: '3', nome: 'Bruno Rocha', funcao: 'Técnico de Instrumentação', horas: 154 }
];

describe('DataTable (Componente de Tabelas Corporativas)', () => {
  const mockUpdateUserPreferences = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      userPreferences: {
        pageSize: 50,
        themeMode: 'light',
        density: 'comfortable',
        defaultTab: 'ger'
      },
      updateUserPreferences: mockUpdateUserPreferences
    } as unknown as ReturnType<typeof useApp>);
  });

  it('renderiza as colunas e linhas a partir dos dados fornecidos', () => {
    render(
      <DataTable
        data={SAMPLE_DATA}
        columns={SAMPLE_COLUMNS}
        rowKey={r => r.id}
      />
    );

    // Cabeçalhos
    expect(screen.getByText('Nome do Colaborador')).not.toBeNull();
    expect(screen.getByText('Função Operacional')).not.toBeNull();
    expect(screen.getByText('Horas Realizadas')).not.toBeNull();

    // Linhas
    expect(screen.getByText('Carlos Silva')).not.toBeNull();
    expect(screen.getByText('Supervisora de Operações')).not.toBeNull();
    expect(screen.getByText('154h')).not.toBeNull();
  });

  it('exibe a mensagem customizada de estado vazio quando não há registros', () => {
    render(
      <DataTable
        data={[]}
        columns={SAMPLE_COLUMNS}
        rowKey={r => r.id}
        emptyMessage="Nenhum colaborador encontrado na plataforma."
      />
    );

    expect(screen.getByText('Nenhum colaborador encontrado na plataforma.')).not.toBeNull();
  });

  it('ordena ascendente e descendente ao clicar no cabeçalho ordenável', () => {
    const { container } = render(
      <DataTable
        data={SAMPLE_DATA}
        columns={SAMPLE_COLUMNS}
        rowKey={r => r.id}
        defaultSortKey="nome"
        defaultSortDir="asc"
      />
    );

    // Inicialmente ordenado por nome asc: Ana Souza, Bruno Rocha, Carlos Silva
    let rows = container.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Ana Souza');
    expect(rows[1].textContent).toContain('Bruno Rocha');
    expect(rows[2].textContent).toContain('Carlos Silva');

    // Clica no cabeçalho 'Nome do Colaborador' para inverter a direção (desc)
    const headerNome = screen.getByText('Nome do Colaborador');
    fireEvent.click(headerNome);

    rows = container.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Carlos Silva');
    expect(rows[1].textContent).toContain('Bruno Rocha');
    expect(rows[2].textContent).toContain('Ana Souza');

    // Clica no cabeçalho 'Horas Realizadas' para ordenar por horas asc: 154, 168, 180
    const headerHoras = screen.getByText('Horas Realizadas');
    fireEvent.click(headerHoras);

    rows = container.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Bruno Rocha'); // 154h
    expect(rows[1].textContent).toContain('Carlos Silva'); // 168h
    expect(rows[2].textContent).toContain('Ana Souza'); // 180h
  });

  it('respeita a paginação padrão (pageSize) e exibe os controles quando totalItems > 25', () => {
    // Gerar 30 itens para acionar paginação com pageSize = 25
    const largeDataset: SampleRow[] = Array.from({ length: 30 }, (_, idx) => ({
      id: `id-${idx + 1}`,
      nome: `Colaborador ${String(idx + 1).padStart(2, '0')}`,
      funcao: 'Técnico Offshore',
      horas: 160 + idx
    }));

    render(
      <DataTable
        data={largeDataset}
        columns={SAMPLE_COLUMNS}
        rowKey={r => r.id}
        pageSize={25}
      />
    );

    expect(screen.getByText(/Exibindo/i)).not.toBeNull();
    expect(screen.getByText('1–25')).not.toBeNull();
    expect(screen.getByText('30')).not.toBeNull();
    expect(screen.getByText('Página 1 de 2')).not.toBeNull();

    // Primeiro item deve ser visível, 26º item não
    expect(screen.getByText('Colaborador 01')).not.toBeNull();
    expect(screen.queryByText('Colaborador 26')).toBeNull();
  });

  it('navega entre páginas usando os botões "Próxima" e "Anterior"', () => {
    const largeDataset: SampleRow[] = Array.from({ length: 30 }, (_, idx) => ({
      id: `id-${idx + 1}`,
      nome: `Colaborador ${String(idx + 1).padStart(2, '0')}`,
      funcao: 'Técnico Offshore',
      horas: 160 + idx
    }));

    render(
      <DataTable
        data={largeDataset}
        columns={SAMPLE_COLUMNS}
        rowKey={r => r.id}
        pageSize={25}
      />
    );

    const btnNext = screen.getByRole('button', { name: /Próxima/i });
    const btnPrev = screen.getByRole('button', { name: /Anterior/i });

    // Página 1: Anterior desabilitado, Próxima habilitado
    expect((btnPrev as HTMLButtonElement).disabled).toBe(true);
    expect((btnNext as HTMLButtonElement).disabled).toBe(false);

    // Clica em Próxima -> vai para Página 2
    fireEvent.click(btnNext);
    expect(screen.getByText('Página 2 de 2')).not.toBeNull();
    expect(screen.getByText('Colaborador 26')).not.toBeNull();
    expect(screen.queryByText('Colaborador 01')).toBeNull();

    // Página 2: Próxima desabilitado, Anterior habilitado
    expect((btnNext as HTMLButtonElement).disabled).toBe(true);
    expect((btnPrev as HTMLButtonElement).disabled).toBe(false);

    // Clica em Anterior -> volta para Página 1
    fireEvent.click(btnPrev);
    expect(screen.getByText('Página 1 de 2')).not.toBeNull();
    expect(screen.getByText('Colaborador 01')).not.toBeNull();
  });

  it('permite alternar o tamanho da página e salva nas preferências do usuário', () => {
    const largeDataset: SampleRow[] = Array.from({ length: 60 }, (_, idx) => ({
      id: `id-${idx + 1}`,
      nome: `Colaborador ${idx + 1}`,
      funcao: 'Operador',
      horas: 168
    }));

    render(
      <DataTable
        data={largeDataset}
        columns={SAMPLE_COLUMNS}
        rowKey={r => r.id}
        initialPageSize={25}
      />
    );

    // Encontra os botões de paginação por tamanho (25, 50, 100)
    const btn50 = screen.getByRole('button', { name: '50' });
    fireEvent.click(btn50);

    expect(mockUpdateUserPreferences).toHaveBeenCalledWith({ pageSize: 50 });
    expect(screen.getByText('Página 1 de 2')).not.toBeNull(); // 60 / 50 = 2 páginas
  });

  it('filtra registros por termo de busca debounced quando searchable={true}', () => {
    vi.useFakeTimers();

    render(
      <DataTable
        data={SAMPLE_DATA}
        columns={SAMPLE_COLUMNS}
        rowKey={r => r.id}
        searchable
        searchPlaceholder="Filtrar colaboradores..."
      />
    );

    const input = screen.getByPlaceholderText('Filtrar colaboradores...');
    fireEvent.change(input, { target: { value: 'Supervisora' } });

    // Antes do debounce (250ms), ainda exibe todos
    expect(screen.getByText('Carlos Silva')).not.toBeNull();

    // Avança o timer
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Agora deve exibir apenas Ana Souza
    expect(screen.getByText('Ana Souza')).not.toBeNull();
    expect(screen.queryByText('Carlos Silva')).toBeNull();
    expect(screen.getByText(/1 registro encontrado/i)).not.toBeNull();

    vi.useRealTimers();
  });
});
