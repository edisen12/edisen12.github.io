// ==============================================================================
// Driver de Armazenamento em Memória (com persistência JSON opcional)
// Referência Universal e Ambiente de Testes Integrados Zero-Infra
// ==============================================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  FieldCondition,
  LogicalCollection,
  StorageFilter,
  StorageQueryOptions,
  UniversalStorageDriverPort
} from '../ports/universal-storage.port';

export interface InMemoryDriverOptions {
  /** Caminho de arquivo local para salvar/carregar snapshots (ex: './data/hhoff-data.json') */
  persistFilePath?: string;
}

export class InMemoryStorageDriver implements UniversalStorageDriverPort {
  readonly driverId: string;
  private readonly persistFilePath?: string;
  private readonly store: Map<LogicalCollection, Array<Record<string, any>>> = new Map();
  private isInitialized = false;

  constructor(options?: InMemoryDriverOptions) {
    this.persistFilePath = options?.persistFilePath;
    this.driverId = this.persistFilePath ? 'json-file' : 'in-memory';
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    if (this.persistFilePath) {
      try {
        const raw = await readFile(this.persistFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [col, items] of Object.entries(parsed)) {
            if (Array.isArray(items)) {
              this.store.set(col as LogicalCollection, items);
            }
          }
        }
      } catch (err: any) {
        // Arquivo ainda não existe na primeira inicialização: comportamento normal
        if (err?.code !== 'ENOENT') {
          console.warn(`[InMemoryDriver] Aviso ao ler persistFilePath (${this.persistFilePath}):`, err?.message);
        }
      }
    }

    this.isInitialized = true;
  }

  async close(): Promise<void> {
    if (this.persistFilePath) {
      await this.flushToDisk();
    }
  }

  private async flushToDisk(): Promise<void> {
    if (!this.persistFilePath) return;

    try {
      const dir = dirname(this.persistFilePath);
      if (dir && dir !== '.') {
        await mkdir(dir, { recursive: true });
      }

      const dump: Record<string, any[]> = {};
      for (const [col, list] of this.store.entries()) {
        dump[col] = list;
      }

      const json = JSON.stringify(dump, null, 2);
      await writeFile(this.persistFilePath, json, 'utf8');
    } catch (err: any) {
      console.error(`[InMemoryDriver] Falha ao persistir em disco (${this.persistFilePath}):`, err?.message);
      throw err;
    }
  }

  private getCollection(col: LogicalCollection): Array<Record<string, any>> {
    let list = this.store.get(col);
    if (!list) {
      list = [];
      this.store.set(col, list);
    }
    return list;
  }

  private matchesCondition(rowVal: unknown, cond: FieldCondition<unknown>): boolean {
    if (cond === undefined) return true;

    // Condição complexa com operadores
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const obj = cond as { eq?: unknown; in?: unknown[]; gte?: string | number; lte?: string | number };
      const hasOperators = 'eq' in obj || 'in' in obj || 'gte' in obj || 'lte' in obj;

      if (hasOperators) {
        if ('eq' in obj && obj.eq !== undefined) {
          if (rowVal !== obj.eq) return false;
        }
        if ('in' in obj && Array.isArray(obj.in)) {
          if (!obj.in.includes(rowVal)) return false;
        }
        if ('gte' in obj && obj.gte !== undefined) {
          if (rowVal == null) return false;
          if (typeof rowVal === 'number' || typeof rowVal === 'string') {
            if (rowVal < obj.gte) return false;
          } else {
            return false;
          }
        }
        if ('lte' in obj && obj.lte !== undefined) {
          if (rowVal == null) return false;
          if (typeof rowVal === 'number' || typeof rowVal === 'string') {
            if (rowVal > obj.lte) return false;
          } else {
            return false;
          }
        }
        return true;
      }
    }

    // Igualdade direta
    return rowVal === cond;
  }

  private matchesFilter(row: Record<string, any>, filter?: StorageFilter): boolean {
    if (!filter) return true;
    for (const [key, cond] of Object.entries(filter)) {
      if (!this.matchesCondition(row[key], cond)) {
        return false;
      }
    }
    return true;
  }

  async findOne<T extends Record<string, any>>(
    collection: LogicalCollection,
    filter: StorageFilter
  ): Promise<T | null> {
    const rows = await this.findMany<T>(collection, { filter, limit: 1 });
    return rows[0] ?? null;
  }

  async findMany<T extends Record<string, any>>(
    collection: LogicalCollection,
    options?: StorageQueryOptions
  ): Promise<T[]> {
    const list = this.getCollection(collection);
    let results = list.filter(item => this.matchesFilter(item, options?.filter));

    // Ordenação
    if (options?.orderBy) {
      const { field, direction } = options.orderBy;
      const mult = direction === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        const va = a[field];
        const vb = b[field];
        if (va == null && vb == null) return 0;
        if (va == null) return 1 * mult;
        if (vb == null) return -1 * mult;
        if (va < vb) return -1 * mult;
        if (va > vb) return 1 * mult;
        return 0;
      });
    }

    // Paginação
    if (options?.offset != null && options.offset > 0) {
      results = results.slice(options.offset);
    }
    if (options?.limit != null && options.limit >= 0) {
      results = results.slice(0, options.limit);
    }

    // Retorna clones para proteger a imutabilidade do store interno
    return results.map(item => structuredClone(item) as T);
  }

  async upsertMany<T extends Record<string, any>>(
    collection: LogicalCollection,
    rows: T[],
    conflictKeys: string[]
  ): Promise<void> {
    // 1. Imposição de Política WORM
    if (collection === 'system_audit_logs') {
      throw new Error('Política WORM: registros de system_audit_logs são estritamente imutáveis.');
    }

    if (rows.length === 0) return;

    if (conflictKeys.length === 0) {
      throw new Error(`upsertMany exige ao menos uma conflictKey para a coleção "${collection}".`);
    }

    const list = this.getCollection(collection);

    const makeKey = (item: Record<string, any>): string =>
      conflictKeys.map(k => String(item[k] ?? '')).join('::');

    // Dedup determinístico no próprio conjunto de entrada (último vence)
    const dedupedIncoming = new Map<string, Record<string, any>>();
    for (const r of rows) {
      const key = makeKey(r);
      dedupedIncoming.set(key, structuredClone(r));
    }

    // Atualiza existentes ou anexa novos
    const existingIndexMap = new Map<string, number>();
    for (let i = 0; i < list.length; i++) {
      existingIndexMap.set(makeKey(list[i]), i);
    }

    for (const [key, incomingRow] of dedupedIncoming.entries()) {
      const existingIdx = existingIndexMap.get(key);
      if (existingIdx !== undefined) {
        // Atualiza campos
        list[existingIdx] = {
          ...list[existingIdx],
          ...incomingRow
        };
      } else {
        list.push(incomingRow);
        existingIndexMap.set(key, list.length - 1);
      }
    }

    if (this.persistFilePath) {
      await this.flushToDisk();
    }
  }

  async deleteMany(
    collection: LogicalCollection,
    filter: StorageFilter
  ): Promise<number> {
    // 1. Imposição de Política WORM
    if (collection === 'system_audit_logs') {
      throw new Error('Política WORM: registros de system_audit_logs são estritamente imutáveis.');
    }

    const list = this.getCollection(collection);
    const initialLen = list.length;

    const remaining = list.filter(item => !this.matchesFilter(item, filter));
    const deletedCount = initialLen - remaining.length;

    this.store.set(collection, remaining);

    if (deletedCount > 0 && this.persistFilePath) {
      await this.flushToDisk();
    }

    return deletedCount;
  }

  async appendImmutable<T extends Record<string, any>>(
    collection: LogicalCollection,
    row: T
  ): Promise<void> {
    const list = this.getCollection(collection);
    list.push(structuredClone(row));

    if (this.persistFilePath) {
      await this.flushToDisk();
    }
  }

  async runInTransaction<T>(
    work: (txDriver: UniversalStorageDriverPort) => Promise<T>
  ): Promise<T> {
    // Para driver em memória, execução direta
    return work(this);
  }
}
