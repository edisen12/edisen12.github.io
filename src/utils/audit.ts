import type { SystemAuditLog } from '../domain/types';

/**
 * Registra evento de auditoria no cliente de forma resiliente (sem bloquear UI ou mocks parciais em testes).
 */
export async function emitAuditEventBestEffort(
  event: Partial<SystemAuditLog>
): Promise<void> {
  try {
    const mod = await import('../services/data.service');
    if (typeof mod.logSystemEvent === 'function') {
      await mod.logSystemEvent(event);
    }
  } catch {
    // Falha silenciosa para não interromper fluxos operacionais nem testes com mocks parciais
  }
}
