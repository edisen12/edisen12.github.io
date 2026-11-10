// ==============================================================================
// Driver SQL Universal Parametrizado: Conexão a Qualquer Banco SQL Relacional
// Postgres, SQLite, MariaDB, MySQL, SQL Server, Oracle, CockroachDB, Turso/LibSQL
// ==============================================================================

import type {
  FieldCondition,
  LogicalCollection,
  StorageFilter,
  StorageQueryOptions,
  UniversalStorageDriverPort
} from '../ports/universal-storage.port';

export interface SqlExecutor {
  query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  beginTransaction?(): Promise<void>;
  commitTransaction?(): Promise<void>;
  rollbackTransaction?(): Promise<void>;
  close?(): Promise<void>;
}

export interface SqlDialectStrategy {
  readonly name: string;
  readonly placeholderStyle: 'dollar' | 'question';
  quoteIdentifier(identifier: string): string;
  buildUpsertSql?(
    table: string,
    columns: string[],
    conflictKeys: string[],
    rowsCount: number,
    placeholderGen: (colIdx: number, rowIdx: number, overallIdx: number) => string
  ): string;
}

/**
 * Dialeto padrão ANSI com ON CONFLICT (PostgreSQL, SQLite 3.24+, CockroachDB, Turso, LibSQL).
 */
export function createAnsiOnConflictDialect(
  placeholderStyle: 'dollar' | 'question' = 'dollar'
): SqlDialectStrategy {
  return {
    name: 'ansi-on-conflict',
    placeholderStyle,
    quoteIdentifier: (id: string) => `"${id}"`,
    buildUpsertSql: (table, columns, conflictKeys, rowsCount, placeholderGen) => {
      const qTable = `"${table}"`;
      const qCols = columns.map(c => `"${c}"`).join(', ');
      const qConflicts = conflictKeys.map(c => `"${c}"`).join(', ');

      const updateCols = columns.filter(c => !conflictKeys.includes(c));
      const doUpdateClause =
        updateCols.length > 0
          ? `DO UPDATE SET ${updateCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')}`
          : 'DO NOTHING';

      const valueRows: string[] = [];
      let overall = 1;
      for (let r = 0; r < rowsCount; r++) {
        const rowPlaceholders = columns.map((_, c) => placeholderGen(c, r, overall++));
        valueRows.push(`(${rowPlaceholders.join(', ')})`);
      }

      return `INSERT INTO ${qTable} (${qCols}) VALUES ${valueRows.join(', ')} ON CONFLICT (${qConflicts}) ${doUpdateClause}`;
    }
  };
}

/**
 * Dialeto MySQL/MariaDB com ON DUPLICATE KEY UPDATE.
 */
export function createMySqlDuplicateKeyDialect(): SqlDialectStrategy {
  return {
    name: 'mysql-duplicate-key',
    placeholderStyle: 'question',
    quoteIdentifier: (id: string) => `\`${id}\``,
    buildUpsertSql: (table, columns, conflictKeys, rowsCount, placeholderGen) => {
      const qTable = `\`${table}\``;
      const qCols = columns.map(c => `\`${c}\``).join(', ');

      const updateCols = columns.filter(c => !conflictKeys.includes(c));
      const doUpdateClause =
        updateCols.length > 0
          ? `ON DUPLICATE KEY UPDATE ${updateCols.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')}`
          : 'ON DUPLICATE KEY UPDATE ' + conflictKeys[0] + ' = ' + conflictKeys[0];

      const valueRows: string[] = [];
      let overall = 1;
      for (let r = 0; r < rowsCount; r++) {
        const rowPlaceholders = columns.map((_, c) => placeholderGen(c, r, overall++));
        valueRows.push(`(${rowPlaceholders.join(', ')})`);
      }

      return `INSERT INTO ${qTable} (${qCols}) VALUES ${valueRows.join(', ')} ${doUpdateClause}`;
    }
  };
}

export interface GenericSqlDialectDriverOptions {
  executor: SqlExecutor;
  dialect?: SqlDialectStrategy;
  customBuildUpsertSql?: (
    table: string,
    columns: string[],
    conflictKeys: string[],
    rowsCount: number,
    placeholderGen: (colIdx: number, rowIdx: number, overallIdx: number) => string
  ) => string;
}

const JSON_COLUMNS = new Set([
  'plats',
  'uns',
  'preferencias',
  'details',
  'emails_resumo',
  'regionais_extras'
]);

const IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/i;

export class GenericSqlDialectDriver implements UniversalStorageDriverPort {
  readonly driverId: string;
  private readonly executor: SqlExecutor;
  private readonly dialect: SqlDialectStrategy;
  private readonly customBuildUpsertSql?: GenericSqlDialectDriverOptions['customBuildUpsertSql'];

  constructor(options: GenericSqlDialectDriverOptions) {
    this.executor = options.executor;
    this.dialect = options.dialect ?? createAnsiOnConflictDialect('dollar');
    this.customBuildUpsertSql = options.customBuildUpsertSql;
    this.driverId = `generic-sql:${this.dialect.name}`;
  }

  async init(): Promise<void> {
    // Valida conexão básica com executor
    await this.executor.query('SELECT 1', []);
  }

  async close(): Promise<void> {
    if (this.executor.close) {
      await this.executor.close();
    }
  }

  private validateIdentifier(name: string): string {
    if (!IDENTIFIER_REGEX.test(name)) {
      throw new Error(`Identificador SQL inválido detectado: "${name}".`);
    }
    return name;
  }

  private quote(identifier: string): string {
    this.validateIdentifier(identifier);
    return this.dialect.quoteIdentifier(identifier);
  }

  private serializeValue(key: string, value: unknown): unknown {
    if (value === undefined) return null;
    if (JSON_COLUMNS.has(key)) {
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value);
      }
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return value;
  }

  private deserializeRow<T extends Record<string, any>>(rawRow: Record<string, any>): T {
    const deserialized: Record<string, any> = {};
    for (const [key, val] of Object.entries(rawRow)) {
      if (JSON_COLUMNS.has(key) && typeof val === 'string') {
        try {
          deserialized[key] = JSON.parse(val);
        } catch {
          deserialized[key] = val;
        }
      } else {
        deserialized[key] = val;
      }
    }
    return deserialized as T;
  }

  private buildWhereClause(
    filter?: StorageFilter,
    startParamIndex = 1
  ): { sql: string; params: unknown[]; nextParamIndex: number } {
    if (!filter || Object.keys(filter).length === 0) {
      return { sql: '', params: [], nextParamIndex: startParamIndex };
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    let currentIdx = startParamIndex;

    const getPlaceholder = (): string => {
      if (this.dialect.placeholderStyle === 'dollar') {
        return `$${currentIdx++}`;
      }
      currentIdx++;
      return '?';
    };

    for (const [key, rawCond] of Object.entries(filter)) {
      const cond: FieldCondition<unknown> = rawCond;
      const qKey = this.quote(key);

      if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
        const obj = cond as {
          eq?: unknown;
          neq?: unknown;
          in?: unknown[];
          gte?: string | number;
          lte?: string | number;
        };
        const hasOps =
          'eq' in obj || 'neq' in obj || 'in' in obj || 'gte' in obj || 'lte' in obj;

        if (hasOps) {
          if ('eq' in obj && obj.eq !== undefined) {
            clauses.push(`${qKey} = ${getPlaceholder()}`);
            params.push(this.serializeValue(key, obj.eq));
          }
          if ('neq' in obj && obj.neq !== undefined) {
            clauses.push(`${qKey} <> ${getPlaceholder()}`);
            params.push(this.serializeValue(key, obj.neq));
          }
          if ('in' in obj && Array.isArray(obj.in)) {
            if (obj.in.length === 0) {
              clauses.push('1 = 0');
            } else {
              const inPlaceholders = obj.in.map(() => getPlaceholder());
              clauses.push(`${qKey} IN (${inPlaceholders.join(', ')})`);
              for (const v of obj.in) {
                params.push(this.serializeValue(key, v));
              }
            }
          }
          if ('gte' in obj && obj.gte !== undefined) {
            clauses.push(`${qKey} >= ${getPlaceholder()}`);
            params.push(this.serializeValue(key, obj.gte));
          }
          if ('lte' in obj && obj.lte !== undefined) {
            clauses.push(`${qKey} <= ${getPlaceholder()}`);
            params.push(this.serializeValue(key, obj.lte));
          }
          continue;
        }
      }

      // Igualdade padrão
      if (cond === null) {
        clauses.push(`${qKey} IS NULL`);
      } else {
        clauses.push(`${qKey} = ${getPlaceholder()}`);
        params.push(this.serializeValue(key, cond));
      }
    }

    const sql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return { sql, params, nextParamIndex: currentIdx };
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
    const qTable = this.quote(collection);
    const where = this.buildWhereClause(options?.filter, 1);

    let querySql = `SELECT * FROM ${qTable} ${where.sql}`.trim();
    const params = [...where.params];
    let paramIdx = where.nextParamIndex;

    const getPlaceholder = (): string => {
      if (this.dialect.placeholderStyle === 'dollar') {
        return `$${paramIdx++}`;
      }
      paramIdx++;
      return '?';
    };

    if (options?.orderBy) {
      const qOrderField = this.quote(options.orderBy.field);
      const dir = options.orderBy.direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      querySql += ` ORDER BY ${qOrderField} ${dir}`;
    }

    if (options?.limit != null && options.limit >= 0) {
      querySql += ` LIMIT ${getPlaceholder()}`;
      params.push(options.limit);
    }

    if (options?.offset != null && options.offset > 0) {
      querySql += ` OFFSET ${getPlaceholder()}`;
      params.push(options.offset);
    }

    const rawRows = await this.executor.query(querySql, params);
    return rawRows.map(row => this.deserializeRow<T>(row));
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

    for (const ck of conflictKeys) {
      this.validateIdentifier(ck);
    }

    // Coleta todas as colunas presentes em qualquer linha
    const columnSet = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        this.validateIdentifier(k);
        columnSet.add(k);
      }
    }
    const columns = Array.from(columnSet);

    const placeholderGen = (_c: number, _r: number, overallIdx: number): string => {
      if (this.dialect.placeholderStyle === 'dollar') {
        return `$${overallIdx}`;
      }
      return '?';
    };

    const buildSql =
      this.customBuildUpsertSql ??
      this.dialect.buildUpsertSql ??
      createAnsiOnConflictDialect(this.dialect.placeholderStyle).buildUpsertSql!;

    const sql = buildSql(collection, columns, conflictKeys, rows.length, placeholderGen);

    const params: unknown[] = [];
    for (const r of rows) {
      for (const col of columns) {
        params.push(this.serializeValue(col, r[col] ?? null));
      }
    }

    await this.executor.query(sql, params);
  }

  async deleteMany(
    collection: LogicalCollection,
    filter: StorageFilter
  ): Promise<number> {
    // 1. Imposição de Política WORM
    if (collection === 'system_audit_logs') {
      throw new Error('Política WORM: registros de system_audit_logs são estritamente imutáveis.');
    }

    const qTable = this.quote(collection);
    const where = this.buildWhereClause(filter, 1);

    const sql = `DELETE FROM ${qTable} ${where.sql}`.trim();
    const result = await this.executor.query(sql, where.params);

    // Se o driver retornar contagem em result (ex: [{ affectedRows: N }]), retorna, senão 1
    if (Array.isArray(result) && result.length > 0) {
      const first = result[0];
      if (typeof first.affectedRows === 'number') return first.affectedRows;
      if (typeof first.count === 'number') return first.count;
    }
    return result.length;
  }

  async appendImmutable<T extends Record<string, any>>(
    collection: LogicalCollection,
    row: T
  ): Promise<void> {
    const qTable = this.quote(collection);
    const columns = Object.keys(row);
    for (const col of columns) {
      this.validateIdentifier(col);
    }

    const qCols = columns.map(c => this.quote(c)).join(', ');

    let current = 1;
    const placeholders = columns.map(() => {
      if (this.dialect.placeholderStyle === 'dollar') return `$${current++}`;
      return '?';
    });

    const params = columns.map(c => this.serializeValue(c, row[c] ?? null));
    const sql = `INSERT INTO ${qTable} (${qCols}) VALUES (${placeholders.join(', ')})`;

    await this.executor.query(sql, params);
  }

  async runInTransaction<T>(
    work: (txDriver: UniversalStorageDriverPort) => Promise<T>
  ): Promise<T> {
    if (!this.executor.beginTransaction || !this.executor.commitTransaction || !this.executor.rollbackTransaction) {
      return work(this);
    }

    await this.executor.beginTransaction();
    try {
      const result = await work(this);
      await this.executor.commitTransaction();
      return result;
    } catch (err) {
      try {
        await this.executor.rollbackTransaction();
      } catch (rollbackErr) {
        console.error('[GenericSqlDialectDriver] Erro no rollback da transação:', rollbackErr);
      }
      throw err;
    }
  }
}
