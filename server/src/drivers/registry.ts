// ==============================================================================
// Registry Aberto de Drivers de Armazenamento Universal
// Permite plugar novos bancos de dados dinamicamente sem alterar código do core
// ==============================================================================

import type { UniversalStorageDriverPort } from '../ports/universal-storage.port';
import { InMemoryStorageDriver } from './in-memory.driver';

export type StorageDriverFactory = (
  config: Record<string, string | undefined>
) => Promise<UniversalStorageDriverPort> | UniversalStorageDriverPort;

const driverRegistry = new Map<string, StorageDriverFactory>();

/**
 * Registra uma factory de driver de armazenamento no registry aberto.
 */
export function registerStorageDriver(
  driverId: string,
  factory: StorageDriverFactory
): void {
  const normalizedId = driverId.trim().toLowerCase();
  driverRegistry.set(normalizedId, factory);
}

/**
 * Lista todos os identificadores de drivers registrados no sistema.
 */
export function listRegisteredStorageDrivers(): string[] {
  return Array.from(driverRegistry.keys()).sort();
}

/**
 * Limpa todos os drivers (útil para testes isolados).
 */
export function resetDriverRegistry(): void {
  driverRegistry.clear();
  registerDefaultDrivers();
}

/**
 * Registra os drivers padrão que não requerem pacotes externos.
 */
function registerDefaultDrivers(): void {
  // 1. Driver volátil em memória (ideal para testes unitários e CI)
  registerStorageDriver('memory', () => new InMemoryStorageDriver());

  // 2. Driver com persistência local em arquivo JSON (zero-infra para VPS e desenvolvimento local)
  registerStorageDriver('json-file', config => {
    const persistFilePath = config.DB_PERSIST_FILE || './hhoff-data.json';
    return new InMemoryStorageDriver({ persistFilePath });
  });
}

// Inicializa drivers padrão
registerDefaultDrivers();

/**
 * Resolve e instancia o driver de armazenamento conforme variáveis de ambiente.
 *
 * Prioridades:
 * 1. `DB_DRIVER_MODULE`: caminho de módulo/pacote externo carregado via `import()` dinâmico.
 * 2. `DB_DRIVER`: identificador registrado no registry aberto ('memory', 'json-file', etc.).
 * 3. Default: 'json-file' se `DB_PERSIST_FILE` estiver presente, senão 'memory'.
 */
export async function resolveStorageDriver(
  env: Record<string, string | undefined> = process.env
): Promise<UniversalStorageDriverPort> {
  // 1. Carregamento dinâmico de módulo externo sem tocar o core
  if (env.DB_DRIVER_MODULE) {
    try {
      const modulePath = env.DB_DRIVER_MODULE.trim();
      const mod = await import(modulePath);
      const factory = mod.default || mod.createStorageDriver || mod.createDriver || mod.driverFactory;

      if (typeof factory === 'function') {
        const driver = await factory(env);
        return driver;
      }
      if (typeof mod.init === 'function' && typeof mod.findOne === 'function') {
        return mod as UniversalStorageDriverPort;
      }

      throw new Error(
        `O módulo externo especificado em DB_DRIVER_MODULE ("${modulePath}") não exporta uma factory válida (default ou createStorageDriver).`
      );
    } catch (err: any) {
      throw new Error(
        `Falha ao carregar driver dinâmico de DB_DRIVER_MODULE ("${env.DB_DRIVER_MODULE}"): ${err?.message}`
      );
    }
  }

  // 2. Resolução por identificador registrado
  const requestedId = env.DB_DRIVER?.trim().toLowerCase();

  if (requestedId) {
    const factory = driverRegistry.get(requestedId);
    if (!factory) {
      const available = listRegisteredStorageDrivers().join(', ');
      throw new Error(
        `Driver de banco de dados não encontrado: "${requestedId}". Drivers disponíveis: [${available}]. Ou utilize DB_DRIVER_MODULE para carregar um driver sob demanda.`
      );
    }
    return factory(env);
  }

  // 3. Resolução automática padrão
  if (env.DB_PERSIST_FILE) {
    const jsonFactory = driverRegistry.get('json-file')!;
    return jsonFactory(env);
  }

  const memoryFactory = driverRegistry.get('memory')!;
  return memoryFactory(env);
}
