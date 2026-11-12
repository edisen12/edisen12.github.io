import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { acquireScrollLock, registerEscapeLayer } from '../scrollLock';

describe('scrollLock & registerEscapeLayer', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('mantém trava de overflow no body enquanto houver overlays abertos e restaura ao liberar o último', () => {
    document.body.style.overflow = 'auto';

    const releaseOuter = acquireScrollLock();
    expect(document.body.style.overflow).toBe('hidden');

    const releaseInner = acquireScrollLock();
    expect(document.body.style.overflow).toBe('hidden');

    // Liberar apenas a camada interna não deve desbloquear o scroll da página
    releaseInner();
    // Chamada dupla idempotente não pode decrementar duas vezes
    releaseInner();
    expect(document.body.style.overflow).toBe('hidden');

    releaseOuter();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('dispara Escape apenas na camada de maior prioridade e depois na subjacente', () => {
    const closeDrawer = vi.fn();
    const closeModal = vi.fn();

    const unregisterDrawer = registerEscapeLayer(closeDrawer, 101);
    const unregisterModal = registerEscapeLayer(closeModal, 120);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();

    unregisterModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeDrawer).toHaveBeenCalledTimes(1);

    unregisterDrawer();
  });
});
