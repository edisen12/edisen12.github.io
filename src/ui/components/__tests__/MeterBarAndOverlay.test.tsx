import React, { useState } from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeterBar } from '../MeterBar';
import { Modal } from '../Modal';
import { Drawer } from '../Drawer';

describe('MeterBar e Empilhamento Modal/Drawer', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('renderiza MeterBar com largura mínima visível para percentuais positivos baixos e sem largura mínima quando zero', () => {
    const { container, rerender } = render(<MeterBar pct={1.2} status="bad" />);

    const fill = container.querySelector('.meter-fill.bad') as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe('1.2%');
    expect(fill?.style.minWidth).toBe('4px');
    expect(screen.getByText('1%')).not.toBeNull();

    rerender(<MeterBar pct={0} status="bad" />);
    const zeroFill = container.querySelector('.meter-fill.bad') as HTMLElement | null;
    expect(zeroFill?.style.width).toBe('0%');
    expect(zeroFill?.style.minWidth).toBe('');

    rerender(<MeterBar pct={null} status="sem" />);
    expect(screen.getByText('—')).not.toBeNull();
  });

  it('fecha apenas o Modal do topo no Escape ao empilhar Modal sobre Drawer mantendo trava de scroll até fechar o Drawer', () => {
    function StackedDemo() {
      const [drawerOpen, setDrawerOpen] = useState(true);
      const [modalOpen, setModalOpen] = useState(true);

      return (
        <>
          <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Ficha Lateral">
            <span>Conteúdo da ficha</span>
          </Drawer>
          <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Modal Sobreposto">
            <span>Conteúdo do modal</span>
          </Modal>
        </>
      );
    }

    render(<StackedDemo />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByText('Ficha Lateral')).not.toBeNull();
    expect(screen.getByText('Modal Sobreposto')).not.toBeNull();

    // Primeiro Escape fecha apenas o Modal de prioridade superior
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Modal Sobreposto')).toBeNull();
    expect(screen.getByText('Ficha Lateral')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');

    // Segundo Escape fecha o Drawer e restaura o scroll do body
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Ficha Lateral')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
