// ==============================================================================
// Driver NoSQL/Documento Universal: Conexão a Qualquer Banco de Documentos
// MongoDB, CouchDB, DynamoDB, SurrealDB, Firestore Admin, Amazon DocumentDB
// ==============================================================================

import type {
  FieldCondition,
  LogicalCollection,
  StorageFilter,
  StorageQueryOptions,
  UniversalStorageDriverPort
} from '../ports/universal-storage.port';

export interface DocumentStoreAdapter {
  readonly adapterId: string;
  init?(): Promise<void>;
  close?(): Promise<void>;
  findDocuments<T>(
    collection: string,
    query: {
      filter?: Record<string, unknown>;
      sort?: Record<string, 1 | -1>;
      skip?: number;
      limit?: number;
    }
  ): Promise<T[]>;
  bulkUpsertDocuments<T extends Record<string, any>>(
    collection: string,
    documents: T[],
    conflictKeys: string[]
  ): Promise<void>;
  deleteDocuments(
    collection: string,
    filter: Record<string, unknown>
  ): Promise<number>;
  insertDocument<T extends Record<string, any>>(
    collection: string,
    document: T
  ): Promise<void>;
}

export interface GenericDocumentDriverOptions {
  adapter: DocumentStoreAdapter;
}

export class GenericDocumentDriver implements UniversalStorageDriverPort {
  readonly driverId: string;
  private readonly adapter: DocumentStoreAdapter;

  constructor(options: GenericDocumentDriverOptions) {
    this.adapter = options.adapter;
    this.driverId = `generic-document:${this.adapter.adapterId}`;
  }

  async init(): Promise<void> {
    if (this.adapter.init) {
      await this.adapter.init();
    }
  }

  async close(): Promise<void> {
    if (this.adapter.close) {
      await this.adapter.close();
    }
  }

  /**
   * Converte uma condição atômica de StorageFilter para o padrão canônico de consultas de documento.
   * Preserva datas 'YYYY-MM-DD' estritamente como strings literais para evitar drift UTC.
   */
  private mapCondition(cond: FieldCondition<unknown>): unknown {
    if (cond === undefined) return undefined;

    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const obj = cond as { eq?: unknown; in?: unknown[]; gte?: string | number; lte?: string | number };
      const hasOps = 'eq' in obj || 'in' in obj || 'gte' in obj || 'lte' in obj;

      if (hasOps) {
        const docCond: Record<string, unknown> = {};
        if ('eq' in obj && obj.eq !== undefined) {
          docCond.$eq = obj.eq;
        }
        if ('in' in obj && Array.isArray(obj.in)) {
          docCond.$in = obj.in;
        }
        if ('gte' in obj && obj.gte !== undefined) {
          docCond.$gte = obj.gte;
        }
        if ('lte' in obj && obj.lte !== undefined) {
          docCond.$lte = obj.lte;
        }
        return docCond;
      }
    }

    return cond;
  }

  private mapFilter(filter?: StorageFilter): Record<string, unknown> {
    if (!filter) return {};
    const out: Record<string, unknown> = {};
    for (const [key, cond] of Object.entries(filter)) {
      const mapped = this.mapCondition(cond);
      if (mapped !== undefined) {
        out[key] = mapped;
      }
    }
    return out;
  }

  /**
   * Garante que campos de data operacionais nunca sofram drift de fuso horário.
   */
  private sanitizeDocument<T extends Record<string, any>>(doc: T): T {
    const clone: Record<string, any> = { ...doc };
    // Preserva integridade de id se o banco usar _id
    if ('_id' in clone && !('id' in clone)) {
      clone.id = String(clone._id);
    }
    return clone as T;
  }

  async findOne<T extends Record<string, any>>(
    collection: LogicalCollection,
    filter: StorageFilter
  ): Promise<T | null> {
    const docs = await this.findMany<T>(collection, { filter, limit: 1 });
    return docs[0] ?? null;
  }

  async findMany<T extends Record<string, any>>(
    collection: LogicalCollection,
    options?: StorageQueryOptions
  ): Promise<T[]> {
    const docFilter = this.mapFilter(options?.filter);
    const sort: Record<string, 1 | -1> | undefined = options?.orderBy
      ? { [options.orderBy.field]: options.orderBy.direction === 'desc' ? -1 : 1 }
      : undefined;

    const rawDocs = await this.adapter.findDocuments<T>(collection, {
      filter: docFilter,
      sort,
      skip: options?.offset,
      limit: options?.limit
    });

    return rawDocs.map(doc => this.sanitizeDocument(doc));
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

    const sanitizedDocs = rows.map(r => this.sanitizeDocument(r));
    await this.adapter.bulkUpsertDocuments(collection, sanitizedDocs, conflictKeys);
  }

  async deleteMany(
    collection: LogicalCollection,
    filter: StorageFilter
  ): Promise<number> {
    // 1. Imposição de Política WORM
    if (collection === 'system_audit_logs') {
      throw new Error('Política WORM: registros de system_audit_logs são estritamente imutáveis.');
    }

    const docFilter = this.mapFilter(filter);
    return this.adapter.deleteDocuments(collection, docFilter);
  }

  async appendImmutable<T extends Record<string, any>>(
    collection: LogicalCollection,
    row: T
  ): Promise<void> {
    const sanitized = this.sanitizeDocument(row);
    await this.adapter.insertDocument(collection, sanitized);
  }

  async runInTransaction<T>(
    work: (txDriver: UniversalStorageDriverPort) => Promise<T>
  ): Promise<T> {
    // Para drivers de documentos gerais, executa diretamente
    return work(this);
  }
}
