/**
 * Utilitário para travamento de scroll com contagem de referências e pilha
 * de fechamento por Escape (último overlay aberto fecha primeiro).
 */

let scrollLockCount = 0;
let previousBodyOverflow = '';

interface EscapeEntry {
  id: symbol;
  priority: number;
  onClose: () => void;
}

const escapeStack: EscapeEntry[] = [];
let globalKeyListenerAttached = false;

function handleGlobalKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || escapeStack.length === 0) return;
  let top = escapeStack[0];
  for (let i = 1; i < escapeStack.length; i += 1) {
    const candidate = escapeStack[i];
    if (candidate && top && candidate.priority >= top.priority) {
      top = candidate;
    }
  }
  top?.onClose();
}

/**
 * Adquire uma trava de scroll no body com contagem de referências.
 * Retorna função idempotente para liberar apenas esta aquisição.
 */
export function acquireScrollLock(): () => void {
  if (typeof document === 'undefined' || !document.body) {
    return () => {};
  }

  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0 && typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = previousBodyOverflow;
      previousBodyOverflow = '';
    }
  };
}

/**
 * Registra uma camada na pilha global de Escape; apenas a camada de maior
 * prioridade (e mais recente em caso de empate) responde ao Escape.
 */
export function registerEscapeLayer(onClose: () => void, priority = 120): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const entry: EscapeEntry = { id: Symbol('overlay-layer'), priority, onClose };
  escapeStack.push(entry);

  if (!globalKeyListenerAttached) {
    window.addEventListener('keydown', handleGlobalKeyDown);
    globalKeyListenerAttached = true;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const idx = escapeStack.findIndex(item => item.id === entry.id);
    if (idx !== -1) {
      escapeStack.splice(idx, 1);
    }
    if (escapeStack.length === 0 && globalKeyListenerAttached && typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      globalKeyListenerAttached = false;
    }
  };
}
