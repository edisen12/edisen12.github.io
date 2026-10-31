import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl, type SegmentedOption } from '../SegmentedControl';

describe('SegmentedControl (Componente de Abas / Seleção)', () => {
  const defaultOptions: SegmentedOption<string>[] = [
    { value: 'tab1', label: 'Primeira Aba', count: 5 },
    { value: 'tab2', label: 'Segunda Aba', count: 12, badgeTone: 'warn' },
    { value: 'tab3', label: 'Terceira Aba', count: 0, badgeTone: 'bad' },
    { value: 'tab4', label: 'Quarta Aba', count: 99, badgeTone: 'ok' },
    { value: 'tab5', label: 'Quinta Aba' } // sem contagem
  ];

  it('renderiza todas as opções com rótulos e contadores numéricos', () => {
    const handleChange = vi.fn();
    render(
      <SegmentedControl
        options={defaultOptions}
        value="tab1"
        onChange={handleChange}
        ariaLabel="Navegação de abas"
      />
    );

    expect(screen.getByRole('tablist', { name: 'Navegação de abas' })).not.toBeNull();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(5);

    expect(screen.getByText('Primeira Aba')).not.toBeNull();
    expect(screen.getByText('5')).not.toBeNull();
    expect(screen.getByText('Segunda Aba')).not.toBeNull();
    expect(screen.getByText('12')).not.toBeNull();
    expect(screen.getByText('Quinta Aba')).not.toBeNull();
  });

  it('aplica aria-selected="true" e classe "active" exclusivamente na opção selecionada', () => {
    const handleChange = vi.fn();
    render(
      <SegmentedControl
        options={defaultOptions}
        value="tab2"
        onChange={handleChange}
      />
    );

    const tabs = screen.getAllByRole('tab');
    const tab1 = tabs[0];
    const tab2 = tabs[1];

    expect(tab1.getAttribute('aria-selected')).toBe('false');
    expect(tab1.classList.contains('active')).toBe(false);

    expect(tab2.getAttribute('aria-selected')).toBe('true');
    expect(tab2.classList.contains('active')).toBe(true);
  });

  it('dispara o callback onChange com o valor selecionado ao clicar em uma opção diferente', () => {
    const handleChange = vi.fn();
    render(
      <SegmentedControl
        options={defaultOptions}
        value="tab1"
        onChange={handleChange}
      />
    );

    const tab3 = screen.getByRole('tab', { name: /Terceira Aba/i });
    fireEvent.click(tab3);

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith('tab3');
  });

  it('renderiza corretamente os tons de badge (badgeTone: bad, warn, ok, default)', () => {
    const handleChange = vi.fn();
    render(
      <SegmentedControl
        options={defaultOptions}
        value="tab1"
        onChange={handleChange}
      />
    );

    const countTab1 = screen.getByText('5');
    expect(countTab1.className).toBe('segmented-count');

    const countWarn = screen.getByText('12');
    expect(countWarn.classList.contains('seg-count-warn')).toBe(true);

    const countBad = screen.getByText('0');
    expect(countBad.classList.contains('seg-count-bad')).toBe(true);

    const countOk = screen.getByText('99');
    expect(countOk.classList.contains('seg-count-ok')).toBe(true);
  });

  it('renderiza ícones e respeita variantes de tamanho e largura total', () => {
    const handleChange = vi.fn();
    const optionsWithIcon: SegmentedOption<string>[] = [
      {
        value: 'icon1',
        label: 'Com Ícone',
        icon: <span data-testid="mock-icon">★</span>
      }
    ];

    const { container } = render(
      <SegmentedControl
        options={optionsWithIcon}
        value="icon1"
        onChange={handleChange}
        size="sm"
        fullWidth
      />
    );

    expect(screen.getByTestId('mock-icon')).not.toBeNull();
    const tablist = container.querySelector('.segmented-control');
    expect(tablist?.classList.contains('segmented-sm')).toBe(true);
    expect(tablist?.classList.contains('segmented-full')).toBe(true);
  });
});
