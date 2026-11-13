// ==============================================================================
// Testes dos Drivers Universais SQL/NoSQL e Integração Full-Stack Self-Hosted
// Parte 1: Abstração Universal de Bancos Puros (Registry, SQL Dialects, Document)
// Parte 2: Integração Full-Stack Real (Node.js HTTP Server, HttpOnly Cookies, CSRF, RBAC)
// ==============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Importações dos drivers e core do servidor Self-Hosted
import {
  registerStorageDriver,
  listRegisteredStorageDrivers,
  resolveStorageDriver,
  resetDriverRegistry
} from '../../../server/src/drivers/registry';
import {
  GenericSqlDialectDriver,
  createAnsiOnConflictDialect,
  createMySqlDuplicateKeyDialect,
  type SqlExecutor
} from '../../../server/src/drivers/generic-sql.driver';
import {
  GenericDocumentDriver,
  type DocumentStoreAdapter
} from '../../../server/src/drivers/generic-document.driver';
import { InMemoryStorageDriver } from '../../../server/src/drivers/in-memory.driver';
import type { UniversalStorageDriverPort } from '../../../server/src/ports/universal-storage.port';
import { SelfHostedDomainEngine } from '../../../server/src/core/domain-engine.service';
import { RealtimeSseHub } from '../../../server/src/core/realtime-hub';
import { createSelfHostedHttpHandler } from '../../../server/src/app';

// Importações do cliente frontend Self-Hosted
import { createSelfHostedClientProvider } from '../self-hosted/self-hosted.provider';
import { planSmartCarteiraImport, planSmartSapImport } from '../shared/client-pipeline';
import { DEFAULT_CONFIG } from '../../config/constants';
import type { Plataforma } from '../../domain/types';

// ==============================================================================
// PARTE 1: ABSTRAÇÃO UNIVERSAL DE BANCOS PUROS (server/src/drivers/*)
// ==============================================================================

describe('Parte 1: Abstração Universal de Bancos de Dados Puros', () => {
  describe('1.1 OpenDriverRegistry (Registro e Resolução Dinâmica)', () => {
    it('deve vir com os drivers padrão registrados ("memory" e "json-file")', () => {
      const drivers = listRegisteredStorageDrivers();
      expect(drivers).toContain('memory');
      expect(drivers).toContain('json-file');
    });

    it('deve permitir registrar dinamicamente novos bancos em tempo de execução sem alterar o core', async () => {
      // Registra simuladores de bancos modernos
      registerStorageDriver('cockroach-custom', () => new InMemoryStorageDriver());
      registerStorageDriver('turso-edge', () => new InMemoryStorageDriver());
      registerStorageDriver('dynamodb-doc', () => new InMemoryStorageDriver());

      const drivers = listRegisteredStorageDrivers();
      expect(drivers).toContain('cockroach-custom');
      expect(drivers).toContain('turso-edge');
      expect(drivers).toContain('dynamodb-doc');

      // Resolução via variável DB_DRIVER
      const driverCockroach = await resolveStorageDriver({ DB_DRIVER: 'cockroach-custom' });
      expect(driverCockroach.driverId).toBe('in-memory');

      const driverTurso = await resolveStorageDriver({ DB_DRIVER: 'turso-edge' });
      expect(driverTurso.driverId).toBe('in-memory');
    });

    it('deve lançar erro em pt-BR com lista de drivers disponíveis quando solicitar driver inexistente', async () => {
      await expect(resolveStorageDriver({ DB_DRIVER: 'banco-desconhecido' })).rejects.toThrow(
        /Driver de banco de dados não encontrado: "banco-desconhecido"/i
      );
    });

    it('deve restaurar o registry aos drivers padrão ao executar reset', () => {
      resetDriverRegistry();
      const drivers = listRegisteredStorageDrivers();
      expect(drivers).toEqual(['json-file', 'memory']);
    });
  });

  describe('1.2 GenericSqlDialectDriver (Qualquer Banco SQL)', () => {
    it('deve gerar SQL parametrizado compatível com ANSI/Postgres/SQLite com $1, $2 (zero interpolação de valores)', async () => {
      const executed: Array<{ sql: string; params: unknown[] }> = [];
      const spyExecutor: SqlExecutor = {
        async query(sql, params) {
          executed.push({ sql, params });
          return [];
        }
      };

      const driver = new GenericSqlDialectDriver({
        executor: spyExecutor,
        dialect: createAnsiOnConflictDialect('dollar')
      });

      await driver.upsertMany(
        'apontamentos_hh',
        [
          {
            matricula: '1001',
            data: '2026-10-01',
            horas_executadas: 11,
            unidade_negocio: 'UN-RIO'
          }
        ],
        ['matricula', 'data']
      );

      expect(executed.length).toBe(1);
      const query = executed[0];

      // Garante inserção com parâmetros numerados e cláusula ON CONFLICT
      expect(query.sql).toContain('INSERT INTO "apontamentos_hh"');
      expect(query.sql).toContain('VALUES ($1, $2, $3, $4)');
      expect(query.sql).toContain('ON CONFLICT ("matricula", "data") DO UPDATE SET');
      // Garante que os valores não foram interpolados na string SQL
      expect(query.sql).not.toContain('1001');
      expect(query.sql).not.toContain('2026-10-01');
      expect(query.params).toContain('1001');
      expect(query.params).toContain('2026-10-01');
      expect(query.params).toContain(11);
      expect(query.params).toContain('UN-RIO');
    });

    it('deve gerar SQL parametrizado compatível com MariaDB/MySQL com placeholders ? e ON DUPLICATE KEY UPDATE', async () => {
      const executed: Array<{ sql: string; params: unknown[] }> = [];
      const spyExecutor: SqlExecutor = {
        async query(sql, params) {
          executed.push({ sql, params });
          return [];
        }
      };

      const driver = new GenericSqlDialectDriver({
        executor: spyExecutor,
        dialect: createMySqlDuplicateKeyDialect()
      });

      await driver.upsertMany(
        'carteira_embarques',
        [
          {
            id: 'cart-1',
            matricula: '1001',
            operacao: 'OP-500'
          }
        ],
        ['id']
      );

      expect(executed.length).toBe(1);
      const query = executed[0];

      expect(query.sql).toContain('INSERT INTO `carteira_embarques`');
      expect(query.sql).toContain('VALUES (?, ?, ?)');
      expect(query.sql).toContain('ON DUPLICATE KEY UPDATE');
      expect(query.params).toContain('cart-1');
      expect(query.params).toContain('1001');
      expect(query.params).toContain('OP-500');
    });

    it('deve suportar estratégia customizada de UPSERT (ex: MERGE INTO para SQL Server / Oracle)', async () => {
      const executed: Array<{ sql: string; params: unknown[] }> = [];
      const spyExecutor: SqlExecutor = {
        async query(sql, params) {
          executed.push({ sql, params });
          return [];
        }
      };

      const driver = new GenericSqlDialectDriver({
        executor: spyExecutor,
        customBuildUpsertSql: (table, columns, conflictKeys) =>
          `MERGE INTO [${table}] WITH (HOLDLOCK) AS target USING ... ON (${conflictKeys.join(', ')})`
      });

      await driver.upsertMany(
        'tecnicos',
        [{ matricula: '1001', nome: 'Técnico 1001' }],
        ['matricula']
      );

      expect(executed.length).toBe(1);
      expect(executed[0].sql).toContain('MERGE INTO [tecnicos]');
      expect(executed[0].sql).toContain('ON (matricula)');
    });

    it('deve bloquear identificadores maliciosos imediatamente contra SQL Injection', async () => {
      const spyExecutor: SqlExecutor = {
        async query() {
          return [];
        }
      };

      const driver = new GenericSqlDialectDriver({ executor: spyExecutor });

      // Tentativa de injeção em nome de coluna
      await expect(
        driver.findMany('profiles', {
          filter: { 'id; DROP TABLE profiles--': '1' }
        })
      ).rejects.toThrow(/Identificador SQL inválido detectado/i);

      // Tentativa de injeção em conflictKey
      await expect(
        driver.upsertMany(
          'profiles',
          [{ id: 'usr-1', email: 'teste@local' }],
          ['id); DROP TABLE profiles; --']
        )
      ).rejects.toThrow(/Identificador SQL inválido detectado/i);
    });

    it('deve serializar e desserializar colunas JSON (plats, uns, preferencias) automaticamente', async () => {
      const executed: Array<{ sql: string; params: unknown[] }> = [];
      const spyExecutor: SqlExecutor = {
        async query(sql, params) {
          executed.push({ sql, params });
          if (sql.includes('SELECT')) {
            return [
              {
                id: 'p1',
                nome: 'Preposto P-50',
                plats: JSON.stringify(['P50', 'P74']),
                uns: JSON.stringify(['UN-RIO'])
              }
            ];
          }
          return [];
        }
      };

      const driver = new GenericSqlDialectDriver({ executor: spyExecutor });

      // Gravação: serializa array para string JSON nos parâmetros
      await driver.upsertMany(
        'pessoas',
        [
          {
            id: 'p1',
            nome: 'Preposto P-50',
            plats: ['P50', 'P74'],
            uns: ['UN-RIO']
          }
        ],
        ['id']
      );

      expect(executed[0].params).toContain(JSON.stringify(['P50', 'P74']));
      expect(executed[0].params).toContain(JSON.stringify(['UN-RIO']));

      // Leitura: desserializa string JSON de volta para array
      const rows = await driver.findMany<any>('pessoas', { filter: { id: 'p1' } });
      expect(rows.length).toBe(1);
      expect(rows[0].plats).toEqual(['P50', 'P74']);
      expect(rows[0].uns).toEqual(['UN-RIO']);
    });

    it('deve impor a Política WORM bloqueando upsert e delete em system_audit_logs', async () => {
      const spyExecutor: SqlExecutor = {
        async query() {
          return [];
        }
      };
      const driver = new GenericSqlDialectDriver({ executor: spyExecutor });

      await expect(
        driver.upsertMany('system_audit_logs', [{ id: 'log-1' }], ['id'])
      ).rejects.toThrow(/Política WORM: registros de system_audit_logs são estritamente imutáveis/i);

      await expect(
        driver.deleteMany('system_audit_logs', { id: 'log-1' })
      ).rejects.toThrow(/Política WORM: registros de system_audit_logs são estritamente imutáveis/i);
    });

    it('deve suportar operador neq gerando cláusula <> parametrizada (ex: { neq: \'\' })', async () => {
      const executed: Array<{ sql: string; params: unknown[] }> = [];
      const spyExecutor: SqlExecutor = {
        async query(sql, params) {
          executed.push({ sql, params });
          return [];
        }
      };
      const driver = new GenericSqlDialectDriver({ executor: spyExecutor });
      await driver.findMany('carteira_operacoes', {
        filter: { id_embarque: { neq: '' } }
      });

      expect(executed.length).toBe(1);
      expect(executed[0].sql).toContain('"id_embarque" <> $1');
      expect(executed[0].params).toEqual(['']);
    });
  });

  describe('1.3 GenericDocumentDriver (Qualquer Banco NoSQL / Documento)', () => {
    it('deve realizar upsert por chave composta, find com operadores e bloquear mutações WORM', async () => {
      const docStore = new Map<string, any[]>();

      const mockAdapter: DocumentStoreAdapter = {
        adapterId: 'in-memory-doc-adapter',
        async findDocuments(collection, query) {
          let list = docStore.get(collection) || [];
          if (query.filter) {
            list = list.filter(item => {
              for (const [k, v] of Object.entries(query.filter!)) {
                if (v && typeof v === 'object' && ('$gte' in (v as any) || '$lte' in (v as any) || '$in' in (v as any))) {
                  const cond = v as any;
                  if (cond.$gte !== undefined && item[k] < cond.$gte) return false;
                  if (cond.$lte !== undefined && item[k] > cond.$lte) return false;
                  if (cond.$in !== undefined && !cond.$in.includes(item[k])) return false;
                } else if (item[k] !== v) {
                  return false;
                }
              }
              return true;
            });
          }
          return list;
        },
        async bulkUpsertDocuments(collection, docs, conflictKeys) {
          let list = docStore.get(collection) || [];
          for (const doc of docs) {
            const idx = list.findIndex(item => conflictKeys.every(k => item[k] === doc[k]));
            if (idx >= 0) {
              list[idx] = { ...list[idx], ...doc };
            } else {
              list.push({ ...doc });
            }
          }
          docStore.set(collection, list);
        },
        async deleteDocuments(collection, filter) {
          let list = docStore.get(collection) || [];
          const initial = list.length;
          list = list.filter(item => !Object.entries(filter).every(([k, v]) => item[k] === v));
          docStore.set(collection, list);
          return initial - list.length;
        },
        async insertDocument(collection, doc) {
          let list = docStore.get(collection) || [];
          list.push({ ...doc });
          docStore.set(collection, list);
        }
      };

      const docDriver = new GenericDocumentDriver({ adapter: mockAdapter });

      // 1. Upsert por chave composta natural
      await docDriver.upsertMany(
        'apontamentos_hh',
        [
          {
            matricula: '1001',
            data: '2026-10-01',
            horas_executadas: 11,
            unidade_negocio: 'UN-RIO'
          }
        ],
        ['matricula', 'data']
      );

      // Atualiza horas mantendo mesma chave
      await docDriver.upsertMany(
        'apontamentos_hh',
        [
          {
            matricula: '1001',
            data: '2026-10-01',
            horas_executadas: 12,
            unidade_negocio: 'UN-RIO'
          }
        ],
        ['matricula', 'data']
      );

      const items = await docDriver.findMany<any>('apontamentos_hh', {
        filter: {
          data: { gte: '2026-10-01', lte: '2026-10-15' },
          matricula: { in: ['1001', '1002'] }
        }
      });

      expect(items.length).toBe(1);
      expect(items[0].horas_executadas).toBe(12);
      expect(typeof items[0].data).toBe('string');
      expect(items[0].data).toBe('2026-10-01'); // Preservado como string sem drift UTC

      // 2. Trava WORM
      await expect(
        docDriver.upsertMany('system_audit_logs', [{ id: 'log-1' }], ['id'])
      ).rejects.toThrow(/Política WORM: registros de system_audit_logs são estritamente imutáveis/i);

      await expect(
        docDriver.deleteMany('system_audit_logs', { id: 'log-1' })
      ).rejects.toThrow(/Política WORM: registros de system_audit_logs são estritamente imutáveis/i);
    });

    it('deve mapear operador neq para operador de documento $ne (ex: { neq: \'\' })', async () => {
      const capturedQueries: Array<Record<string, unknown> | undefined> = [];
      const mockAdapter: DocumentStoreAdapter = {
        adapterId: 'in-memory-doc-adapter',
        async findDocuments(_col, q) {
          capturedQueries.push(q.filter);
          return [];
        },
        async bulkUpsertDocuments() {},
        async insertDocument() {},
        async deleteDocuments() {
          return 0;
        }
      };

      const docDriver = new GenericDocumentDriver({ adapter: mockAdapter });
      await docDriver.findMany('carteira_operacoes', {
        filter: { id_embarque: { neq: '' } }
      });

      expect(capturedQueries.length).toBe(1);
      expect(capturedQueries[0]).toEqual({
        id_embarque: { $ne: '' }
      });
    });
  });

  describe('1.4 InMemoryStorageDriver (Driver em Memória / Referência)', () => {
    it('deve filtrar registros com operador neq (ex: { neq: \'\' })', async () => {
      const driver = new InMemoryStorageDriver();
      await driver.init();

      await driver.upsertMany(
        'carteira_operacoes',
        [
          { id: '1', matricula: '1001', id_embarque: '55104', operacao: 'OP-1' },
          { id: '2', matricula: '1002', id_embarque: '', operacao: 'OP-2' },
          { id: '3', matricula: '1003', id_embarque: '55105', operacao: 'OP-3' }
        ],
        ['id']
      );

      const res = await driver.findMany<any>('carteira_operacoes', {
        filter: { id_embarque: { neq: '' } }
      });

      expect(res.length).toBe(2);
      expect(res.map(r => r.id).sort()).toEqual(['1', '3']);
    });
  });
});

// ==============================================================================
// PARTE 2: INTEGRAÇÃO REAL FULL-STACK (Node.js HTTP Server ↔ Client Provider)
// ==============================================================================

describe('Parte 2: Integração Real Full-Stack (Server Node.js ↔ Client Provider)', () => {
  let server: Server;
  let baseUrl: string;
  let storage: UniversalStorageDriverPort;
  let engine: SelfHostedDomainEngine;
  let realtimeHub: RealtimeSseHub;

  /**
   * Cria um wrapper customFetch com Cookie Jar em memória simulando o navegador.
   * Utiliza node:http.request para evitar bloqueios de CORS simulados pelo happy-dom
   * e comprova que cookies HttpOnly são gerenciados fora do localStorage!
   */
  function createCookieJar() {
    let cookieHeader = '';

    const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as any).url;
      const parsedUrl = new URL(urlStr);
      const method = (init?.method || 'GET').toUpperCase();

      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = new Headers(init.headers);
        h.forEach((val, key) => {
          headers[key] = val;
        });
      }

      if (cookieHeader) {
        headers['cookie'] = cookieHeader;
      }

      const bodyData = init?.body;
      let bodyBuffer: Buffer | undefined;
      if (bodyData) {
        bodyBuffer = Buffer.from(
          typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData),
          'utf8'
        );
        headers['content-length'] = bodyBuffer.length.toString();
        if (!headers['content-type']) {
          headers['content-type'] = 'application/json';
        }
      }

      return new Promise<Response>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            method,
            headers
          },
          nodeRes => {
            const resChunks: Buffer[] = [];
            nodeRes.on('data', chunk => resChunks.push(chunk));
            nodeRes.on('end', () => {
              const rawBody = Buffer.concat(resChunks).toString('utf8');
              const resHeaders = new Headers();
              for (const [k, v] of Object.entries(nodeRes.headers)) {
                if (Array.isArray(v)) {
                  for (const item of v) resHeaders.append(k, item);
                } else if (v !== undefined) {
                  resHeaders.set(k, v);
                }
              }

              const setCookie = resHeaders.get('set-cookie');
              if (setCookie) {
                const cookiePart = setCookie.split(';')[0];
                if (setCookie.includes('Max-Age=0')) {
                  cookieHeader = '';
                } else if (cookiePart) {
                  cookieHeader = cookiePart;
                }
              }

              const response = new Response(rawBody, {
                status: nodeRes.statusCode || 200,
                statusText: nodeRes.statusMessage || '',
                headers: resHeaders
              });

              resolve(response);
            });
          }
        );

        req.on('error', reject);

        if (bodyBuffer) {
          req.write(bodyBuffer);
        }
        req.end();
      });
    };

    return {
      customFetch,
      getCookie: () => cookieHeader,
      setCookie: (val: string) => {
        cookieHeader = val;
      }
    };
  }

  beforeAll(async () => {
    storage = new InMemoryStorageDriver();
    await storage.init();
    realtimeHub = new RealtimeSseHub(0); // Sem timer periódico nos testes
    engine = new SelfHostedDomainEngine(storage, realtimeHub);

    const handler = createSelfHostedHttpHandler({
      engine,
      realtimeHub,
      secureCookies: false
    });

    server = createServer(handler);
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
  });

  afterAll(async () => {
    realtimeHub.close();
    await storage.close();
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  it('2.1 Bootstrap, Login com Cookie HttpOnly e Proteção Estrita contra CSRF', async () => {
    // 1. Bootstrap de credenciais sintéticas
    await engine.bootstrapInitialAdminIfNeeded(
      'admin.vps@teste.local',
      'AdminForte2026!',
      'Admin VPS'
    );

    const adminJar = createCookieJar();
    const adminProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: adminJar.customFetch
    });

    // 2. Login via fachada de cliente
    const loginResult = await adminProvider.auth.signInWithPassword(
      'admin.vps@teste.local',
      'AdminForte2026!'
    );

    expect(loginResult.user).toBeDefined();
    expect(loginResult.user?.email).toBe('admin.vps@teste.local');
    // Cookie capturado pelo Jar em memória
    expect(adminJar.getCookie()).toContain('hhoff_session=');

    // 3. Prova de proteção contra CSRF:
    // Uma requisição PUT direta sem o cabeçalho X-CSRF-Token (mesmo com o Cookie) deve ser bloqueada com 400!
    const csrfBypassRes = await adminJar.customFetch(`${baseUrl}/configuracoes`, {
      method: 'PUT',
      headers: {
        cookie: adminJar.getCookie(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        config: { ...DEFAULT_CONFIG, slogan: 'Ataque CSRF Falso' },
        unWeights: [],
        emailsResumo: []
      })
    });

    expect(csrfBypassRes.status).toBe(400);
    const csrfErr = await csrfBypassRes.json();
    expect(csrfErr.message).toMatch(/Token CSRF inválido ou ausente/i);

    // 4. Gravação legítima através do provedor (que anexa o X-CSRF-Token em memória)
    await adminProvider.data.saveConfiguracoes(
      { ...DEFAULT_CONFIG, slogan: 'Segurança Máxima Offshore' },
      [],
      ['notificacoes@teste.local']
    );

    const scope = await adminProvider.auth.fetchCurrentUserScope();
    expect(scope).not.toBeNull();
    expect(scope?.profile.role).toBe('admin');
  });

  it('2.2 Importação em Chunks, Criação de Preposto, First-Login Gate e Isolamento RBAC Zero-Knowledge', async () => {
    const adminJar = createCookieJar();
    const adminProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: adminJar.customFetch
    });
    await adminProvider.auth.signInWithPassword('admin.vps@teste.local', 'AdminForte2026!');

    // 1. Admin importa plataformas P50 e P74
    let platProgressCalled = false;
    await adminProvider.data.batchImportPlataformas(
      [
        { sigla: 'P50', nome: 'P-50', un: 'UN-RIO' },
        { sigla: 'P74', nome: 'P-74', un: 'UN-BZ' }
      ],
      (gravadas, total) => {
        platProgressCalled = true;
        expect(gravadas).toBe(total);
      }
    );
    expect(platProgressCalled).toBe(true);

    const pidx: Record<string, Plataforma> = {
      P50: {
        sigla: 'P50',
        chave_norm: 'P50',
        nome: 'P-50',
        un: 'UN-RIO',
        armador: '',
        gerencia: '',
        tipo: 'FPSO',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      },
      P74: {
        sigla: 'P74',
        chave_norm: 'P74',
        nome: 'P-74',
        un: 'UN-BZ',
        armador: '',
        gerencia: '',
        tipo: 'FPSO',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      }
    };

    // 2. Admin importa carteira:
    // Técnico 1001 em P50 com OP-500
    // Técnico 1002 em P74 com OP-500 (compartilhada) e OP-999 (confidencial fora do escopo de P50)
    let cartProgressCalled = false;
    await adminProvider.data.batchImportCarteira(
      [
        {
          mat: '1001',
          nome: 'Técnico 1001',
          funcao: 'Instrumentista',
          plat: 'P50',
          reg: 'UN-RIO',
          ini: '2026-10-01',
          fim: '2026-10-14',
          hp: 154,
          op: 'OP-500',
          pe: 1,
          ex: 1
        },
        {
          mat: '1002',
          nome: 'Técnico 1002',
          funcao: 'Mecânico',
          plat: 'P74',
          reg: 'UN-BZ',
          ini: '2026-10-01',
          fim: '2026-10-14',
          hp: 154,
          op: 'OP-500',
          pe: 1,
          ex: 1
        },
        {
          mat: '1002',
          nome: 'Técnico 1002',
          funcao: 'Mecânico',
          plat: 'P74',
          reg: 'UN-BZ',
          ini: '2026-10-15',
          fim: '2026-10-28',
          hp: 154,
          op: 'OP-999',
          pe: 1,
          ex: 1
        }
      ],
      pidx,
      (gravadas, total) => {
        cartProgressCalled = true;
        expect(gravadas).toBe(total);
      }
    );
    expect(cartProgressCalled).toBe(true);

    // 3. Admin importa apontamentos HH:
    // Técnico 1001 apontou em P50 no dia 2026-10-01
    // Técnico 1001 apontou em P74 no dia 2026-10-02 (transbordo para outra plataforma!)
    let hhProgressCalled = false;
    await adminProvider.data.batchImportHH(
      [
        {
          mat: '1001',
          nome: 'Técnico 1001',
          p: 'P50',
          D: '2026-10-01',
          e: 11,
          r: 'UN-RIO'
        },
        {
          mat: '1001',
          nome: 'Técnico 1001',
          p: 'P74',
          D: '2026-10-02',
          e: 11,
          r: 'UN-BZ'
        }
      ],
      pidx,
      (gravadas, total) => {
        hhProgressCalled = true;
        expect(gravadas).toBe(total);
      }
    );
    expect(hhProgressCalled).toBe(true);

    // 4. Cria conta de Preposto atribuído exclusivamente à plataforma P50
    const createRes = await adminProvider.auth.adminManageUser({
      action: 'create',
      email: 'preposto.p50@teste.local',
      password: 'TempPassword2026!',
      nome: 'Preposto P-50',
      role: 'preposto',
      plats: ['P50']
    });

    expect(createRes.ok).toBe(true);
    expect(createRes.userId).toBeDefined();

    // 5. Preposto realiza login
    const prepostoJar = createCookieJar();
    const prepostoProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: prepostoJar.customFetch
    });

    await prepostoProvider.auth.signInWithPassword('preposto.p50@teste.local', 'TempPassword2026!');

    const prepostoScope = await prepostoProvider.auth.fetchCurrentUserScope();
    expect(prepostoScope).not.toBeNull();
    expect(prepostoScope?.onboarding.primeiro_login).toBe(true);

    // 6. Prova do First-Login Gate:
    // Tentar acessar o dataset ANTES de redefinir a senha provisória é bloqueado com 403!
    await expect(
      prepostoProvider.data.loadAppDataset('2026-10-01', '2026-10-31', false)
    ).rejects.toThrow(/Primeiro login obrigatório/i);

    // Preposto conclui troca de senha
    await prepostoProvider.auth.completeFirstLoginPassword('NovaSenhaPreposto2026!');

    // 7. Carrega o dataset com a senha trocada e valida isolamento RBAC Zero-Knowledge
    const dataset = await prepostoProvider.data.loadAppDataset('2026-10-01', '2026-10-31', false);

    // Preposto vê apenas sua carteira (P50)
    expect(dataset.carteira.length).toBe(1);
    expect(dataset.carteira[0].matricula).toBe('1001');
    expect(dataset.carteira[0].plataforma_sigla).toBe('P50');

    // Zero vazamento da plataforma P74 ou da OP-999 da outra carteira
    expect(dataset.carteira.some(c => c.plataforma_sigla === 'P74')).toBe(false);
    expect(dataset.carteira.some(c => c.operacao === 'OP-999')).toBe(false);

    // Marca d'água global presente
    expect(dataset.watermark.ultima_data_hh).toBe('2026-10-02');

    // Anti-falso-positivo de transbordo (Zero-Knowledge):
    // Como o técnico 1001 apontou em P74 no dia 2026-10-02, o par é informado sem revelar dados confidenciais
    expect(dataset.externalCoveredSet.has('1001|2026-10-02')).toBe(true);

    // Trava anti-oráculo de OPs compartilhadas:
    // OP-500 existe nesta carteira e em outra -> marcado como compartilhado
    expect(dataset.sharedOpsSet.has('OP-500')).toBe(true);
    // OP-999 existe fora da carteira, mas NÃO nesta carteira -> não sinalizado
    expect(dataset.sharedOpsSet.has('OP-999')).toBe(false);
  });

  it('2.3 SLA Imutável em Justificativas, Salvaguardas Anti-Lockout, Corte 0ms e Auditoria WORM', async () => {
    const adminJar = createCookieJar();
    const adminProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: adminJar.customFetch
    });
    await adminProvider.auth.signInWithPassword('admin.vps@teste.local', 'AdminForte2026!');

    const prepostoJar = createCookieJar();
    const prepostoProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: prepostoJar.customFetch
    });
    await prepostoProvider.auth.signInWithPassword('preposto.p50@teste.local', 'NovaSenhaPreposto2026!');

    // 1. Preposto salva justificativa legítima na própria carteira
    await prepostoProvider.data.saveJustificativa({
      matricula: '1001',
      data: '2026-10-01',
      motivo: 'Gangway desconectada',
      horas_gangway: 2,
      descricao: 'Mar revolto na bacia',
      responsavel_nome: 'Preposto P-50'
    });

    const ds1 = await prepostoProvider.data.loadAppDataset('2026-10-01', '2026-10-31', false);
    const just1 = ds1.justMap['1001|2026-10-01'];
    expect(just1).toBeDefined();
    expect(just1.horas_gangway).toBe(2);
    const originalCriadoEm = just1.criado_em;
    expect(originalCriadoEm).toBeDefined();

    // 2. Preposto edita a justificativa: o criado_em deve permanecer CONGELADO (SLA Imutável)
    await new Promise(r => setTimeout(r, 20));
    await prepostoProvider.data.saveJustificativa({
      matricula: '1001',
      data: '2026-10-01',
      motivo: 'Gangway desconectada',
      horas_gangway: 4,
      descricao: 'Mar revolto e ventos fortes persistentes',
      responsavel_nome: 'Preposto P-50'
    });

    const ds2 = await prepostoProvider.data.loadAppDataset('2026-10-01', '2026-10-31', false);
    const just2 = ds2.justMap['1001|2026-10-01'];
    expect(just2.horas_gangway).toBe(4);
    expect(just2.criado_em).toBe(originalCriadoEm); // Preservado estritamente!

    // 3. Preposto tenta justificar técnico fora da carteira (1002 de P74) -> bloqueado!
    await expect(
      prepostoProvider.data.saveJustificativa({
        matricula: '1002',
        data: '2026-10-01',
        motivo: 'Outro',
        horas_gangway: 0,
        descricao: '',
        responsavel_nome: ''
      })
    ).rejects.toThrow(/Acesso negado/i);

    // Preposto tenta alterar configurações globais -> bloqueado!
    await expect(
      prepostoProvider.data.saveConfiguracoes(DEFAULT_CONFIG, [], [])
    ).rejects.toThrow(/Acesso negado/i);

    // 4. Salvaguardas Anti-Lockout para Administradores
    const adminScope = await adminProvider.auth.fetchCurrentUserScope();
    const adminId = adminScope?.profile.id!;

    // Auto-rebaixamento proibido
    const demoteRes = await adminProvider.auth.adminManageUser({
      action: 'update-role',
      userId: adminId,
      role: 'preposto'
    });
    expect(demoteRes.ok).toBe(false);
    expect(demoteRes.message).toMatch(/rebaixar/i);

    // Auto-desativação proibida
    const deactSelfRes = await adminProvider.auth.adminManageUser({
      action: 'toggle-active',
      userId: adminId,
      ativo: false
    });
    expect(deactSelfRes.ok).toBe(false);
    expect(deactSelfRes.message).toMatch(/desativar seu próprio acesso/i);

    // 5. Corte imediato (0 ms) de sessão ativa:
    // Admin desativa o Preposto
    const prepostoScopeBefore = await prepostoProvider.auth.fetchCurrentUserScope();
    const prepostoId = prepostoScopeBefore?.profile.id!;

    const deactPrepostoRes = await adminProvider.auth.adminManageUser({
      action: 'toggle-active',
      userId: prepostoId,
      ativo: false
    });
    expect(deactPrepostoRes.ok).toBe(true);

    // A sessão ativa do Preposto é invalidada imediatamente (0 ms)
    const prepostoScopeAfter = await prepostoProvider.auth.fetchCurrentUserScope();
    expect(prepostoScopeAfter).toBeNull();

    // Qualquer tentativa de chamada autenticada pelo Preposto falha na hora
    await expect(
      prepostoProvider.data.saveJustificativa({
        matricula: '1001',
        data: '2026-10-01',
        motivo: 'Outro',
        horas_gangway: 0,
        descricao: '',
        responsavel_nome: ''
      })
    ).rejects.toThrow();

    // 6. Auditoria WORM corporativa:
    // Confirma que todos os eventos críticos foram registrados de forma imutável
    const logs = await adminProvider.data.fetchSystemAuditLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some(l => l.action === 'system_bootstrap_admin')).toBe(true);
    expect(logs.some(l => l.action === 'user_created')).toBe(true);
    expect(logs.some(l => l.action === 'status_toggled')).toBe(true);
  });

  it('2.4 Ciclo Completo de Importação Granular, Reconciliação SAP (+4 dias PMB, contadores) e Reset Seguro', async () => {
    const adminJar = createCookieJar();
    const adminProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: adminJar.customFetch
    });
    await adminProvider.auth.signInWithPassword('admin.vps@teste.local', 'AdminForte2026!');

    // 1. Cria ou prepara um Preposto ativo com acesso restrito a P50
    const createPrepostoRes = await adminProvider.auth.adminManageUser({
      action: 'create',
      email: 'preposto.granular@teste.local',
      password: 'TempPasswordGranular2026!',
      nome: 'Preposto Granular P-50',
      role: 'preposto',
      plats: ['P50']
    });
    expect(createPrepostoRes.ok).toBe(true);

    const prepostoJar = createCookieJar();
    const prepostoProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: prepostoJar.customFetch
    });
    await prepostoProvider.auth.signInWithPassword('preposto.granular@teste.local', 'TempPasswordGranular2026!');
    await prepostoProvider.auth.completeFirstLoginPassword('NovaSenhaPrepostoGranular2026!');

    // 2. Importação Granular de Carteira com Aliases (PMXL -> MXL, PAG-02 -> PAG2) e os 3 status
    const pidx: Record<string, Plataforma> = {
      MXL: {
        sigla: 'MXL',
        chave_norm: 'MXL',
        nome: 'Mexilhão',
        un: 'UN-BS',
        gerencia: '',
        tipo: 'Fixa',
        armador: '',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      },
      PAG2: {
        sigla: 'PAG2',
        chave_norm: 'PAG2',
        nome: 'PAG 2',
        un: 'UN-RNCE',
        gerencia: '',
        tipo: 'Fixa',
        armador: '',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      }
    };

    await adminProvider.data.batchImportCarteira(
      [
        // Técnico 1003 em PMXL (deve normalizar para MXL) com os 3 status
        {
          mat: '1003',
          nome: 'Técnico 1003',
          plat: 'PMXL',
          reg: 'UN-BS',
          ini: '2026-10-01',
          fim: '2026-10-14',
          hp: 40,
          status_prog: 'Carteira',
          ordem: 'ORD-100',
          op: 'OP-01',
          id_embarque: '55100',
          hc_portal: 10
        },
        {
          mat: '1003',
          nome: 'Técnico 1003',
          plat: 'PMXL',
          reg: 'UN-BS',
          ini: '2026-10-01',
          fim: '2026-10-14',
          hp: 20,
          status_prog: 'Fora da carteira',
          ordem: 'ORD-200',
          op: 'OP-02',
          id_embarque: '55100',
          hc_portal: 20
        },
        {
          mat: '1003',
          nome: 'Técnico 1003',
          plat: 'PMXL',
          reg: 'UN-BS',
          ini: '2026-10-01',
          fim: '2026-10-14',
          hp: 10,
          status_prog: 'Cancelada',
          ordem: 'ORD-300',
          op: 'OP-03',
          id_embarque: '55100',
          hc_portal: 0
        },
        // Técnico 1004 em PAG-02 (deve normalizar para PAG2)
        {
          mat: '1004',
          nome: 'Técnico 1004',
          plat: 'PAG-02',
          reg: 'UN-RNCE',
          ini: '2026-10-05',
          fim: '2026-10-19',
          hp: 50,
          status_prog: 'Carteira',
          ordem: 'ORD-400',
          op: 'OP-04',
          id_embarque: '55101',
          hc_portal: 30
        }
      ],
      pidx
    );

    // Valida consolidação em carteira_embarques: horas_programadas = Carteira + Fora, hh_cancelado separado
    const adminDs = await adminProvider.data.loadAppDataset('2026-10-01', '2026-10-31', true);
    const emb1003 = adminDs.carteira.find(c => c.matricula === '1003');
    expect(emb1003).toBeDefined();
    expect(emb1003?.plataforma_sigla).toBe('MXL'); // Alias PMXL -> MXL
    expect(emb1003?.horas_programadas).toBe(60); // 40 (Carteira) + 20 (Fora da carteira)
    expect(emb1003?.hh_carteira).toBe(40);
    expect(emb1003?.hh_fora_carteira).toBe(20);
    expect(emb1003?.hh_cancelado).toBe(10); // Segregado
    expect(emb1003?.id_embarque).toBe('55100');

    const emb1004 = adminDs.carteira.find(c => c.matricula === '1004');
    expect(emb1004).toBeDefined();
    expect(emb1004?.plataforma_sigla).toBe('PAG2'); // Alias PAG-02 -> PAG2
    expect(emb1004?.horas_programadas).toBe(50);
    expect(emb1004?.hh_carteira).toBe(50);
    expect(emb1004?.hh_fora_carteira).toBe(0);
    expect(emb1004?.hh_cancelado).toBe(0);

    // 3. Importação SAP com contadores 1 e 2 no mesmo dia/ordem/horas e lançamento +4 dias pós-desembarque
    // Técnicos precisam existir na tabela tecnicos para reconciliação
    await adminProvider.data.batchImportHH(
      [
        { mat: '1003', p: 'MXL', D: '2026-10-02', e: 10, nome: 'Técnico 1003' },
        { mat: '1004', p: 'PAG2', D: '2026-10-06', e: 10, nome: 'Técnico 1004' }
      ],
      pidx
    );

    await adminProvider.data.batchImportConfirmacoesSAP!([
      // Duas confirmações no mesmo dia/ordem/horas para 1003 com contadores 1 e 2 (ambos devem ser preservados)
      {
        mat: '1003',
        cria: '2026-10-02',
        lanc: '2026-10-02',
        real: '2026-10-02',
        ordem: 'ORD-100',
        op: 'OP-01',
        hc: 5,
        contador: 1
      },
      {
        mat: '1003',
        cria: '2026-10-02',
        lanc: '2026-10-02',
        real: '2026-10-02',
        ordem: 'ORD-100',
        op: 'OP-01',
        hc: 5,
        contador: 2
      },
      // Confirmação lançada em 2026-10-17: desembarque foi 2026-10-14, logo 14 + 3 dias = dentro da tolerância de +4 dias PMB!
      {
        mat: '1003',
        cria: '2026-10-17',
        lanc: '2026-10-17',
        real: '2026-10-14',
        ordem: 'ORD-200',
        op: 'OP-02',
        hc: 15,
        contador: 1
      }
    ]);

    // 4. Executa reconciliação SAP em cascata
    const recResult = await adminProvider.data.reconciliarConfirmacoesSAP!();
    expect(recResult.total_confirmacoes_sap).toBeGreaterThanOrEqual(3);
    expect(recResult.vinculados_ao_embarque).toBeGreaterThanOrEqual(3);

    // Recarrega dataset e avalia status de confronto
    const dsReconciled = await adminProvider.data.loadAppDataset('2026-10-01', '2026-10-31', true);
    const confsReconciled = dsReconciled.confirmacoesSap ?? [];
    const opsReconciled = dsReconciled.carteiraOperacoes ?? [];
    expect(confsReconciled.length).toBeGreaterThanOrEqual(3);

    // Ambas as confirmações com contador 1 e 2 foram preservadas
    const c1 = confsReconciled.find(
      cs => cs.matricula === '1003' && cs.ordem === 'ORD-100' && cs.contador_confirmacao === 1
    );
    const c2 = confsReconciled.find(
      cs => cs.matricula === '1003' && cs.ordem === 'ORD-100' && cs.contador_confirmacao === 2
    );
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1?.id_embarque).toBe('55100');
    expect(c2?.id_embarque).toBe('55100');

    // Confirmação com lançamento em +3 dias pós-desembarque vinculada ao embarque 55100
    const cPmb = confsReconciled.find(
      cs => cs.matricula === '1003' && cs.ordem === 'ORD-200'
    );
    expect(cPmb).toBeDefined();
    expect(cPmb?.id_embarque).toBe('55100');

    // Status de confronto: ORD-100 tem Portal = 10 e SAP = 5 + 5 = 10 -> OK!
    const op1 = opsReconciled.find(
      o => o.matricula === '1003' && o.ordem === 'ORD-100'
    );
    expect(op1?.status_divergencia).toBe('OK');
    expect(op1?.hh_confirmado_sap).toBe(10);
    expect(op1?.divergencia_sap).toBe(0);

    // ORD-200 tem Portal = 20 e SAP = 15 -> Divergente (Portal > SAP)
    const op2 = opsReconciled.find(
      o => o.matricula === '1003' && o.ordem === 'ORD-200'
    );
    expect(op2?.status_divergencia).toBe('Divergente (Portal > SAP)');
    expect(op2?.divergencia_sap).toBe(5);

    // 5. Isolamento RBAC do Preposto (atribuído exclusivamente a P50)
    const prepostoDs = await prepostoProvider.data.loadAppDataset('2026-10-01', '2026-10-31', false);
    // Preposto não vê as carteiras de MXL e PAG2
    expect(prepostoDs.carteira.some(c => c.plataforma_sigla === 'MXL' || c.plataforma_sigla === 'PAG2')).toBe(false);
    // Preposto não vê operações detalhadas nem confirmações SAP de técnicos fora de sua carteira
    expect((prepostoDs.carteiraOperacoes ?? []).some(o => o.matricula === '1003' || o.matricula === '1004')).toBe(false);
    expect((prepostoDs.confirmacoesSap ?? []).some(cs => cs.matricula === '1003' || cs.matricula === '1004')).toBe(false);

    // 6. Reset de Carteira de Embarques:
    // Negado para Preposto (role restrita)
    await expect(
      prepostoProvider.data.resetCarteiraEmbarques!()
    ).rejects.toThrow(/Acesso negado: operação restrita a Administradores e Gestores/i);

    // Permitido para Admin com geração de auditoria WORM
    const resetRes = await adminProvider.data.resetCarteiraEmbarques!();
    expect(resetRes.deleted_embarques).toBeGreaterThan(0);
    expect(resetRes.deleted_operacoes).toBeGreaterThan(0);

    // Verifica que carteira foi limpa e confirmações SAP foram desvinculadas
    const dsAfterReset = await adminProvider.data.loadAppDataset('2026-10-01', '2026-10-31', true);
    expect(dsAfterReset.carteira.length).toBe(0);
    expect((dsAfterReset.carteiraOperacoes ?? []).length).toBe(0);

    // Confirmações SAP foram desvinculadas e voltaram para Pendente
    for (const cs of dsAfterReset.confirmacoesSap ?? []) {
      expect(cs.id_embarque).toBe('');
      expect(cs.status_reconciliacao).toBe('Pendente');
    }

    // Trilha WORM de auditoria registrou carteira_reset
    const logsAfter = await adminProvider.data.fetchSystemAuditLogs();
    const resetLog = logsAfter.find(l => l.action === 'carteira_reset');
    expect(resetLog).toBeDefined();
    expect(resetLog?.category).toBe('importacao');
  });

  it('2.5 Reconciliação SAP com estornos negativos ([+9, -9 tardio, +9, +9] = 18 na ordem 002032288155/0010), zeros à esquerda e irmão Fora da Carteira', async () => {
    const adminJar = createCookieJar();
    const adminProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: adminJar.customFetch
    });
    await adminProvider.auth.signInWithPassword('admin.vps@teste.local', 'AdminForte2026!');

    const pidx: Record<string, Plataforma> = {
      MXL: {
        sigla: 'MXL',
        chave_norm: 'MXL',
        nome: 'Mexilhão',
        un: 'UN-BS',
        gerencia: '',
        tipo: 'Fixa',
        armador: '',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      }
    };

    // Multi-embarque: mesmo técnico 1005 tem a ordem 2032288155 / 10 em dois embarques diferentes (56100 em out e 56200 em dez)
    await adminProvider.data.batchImportCarteira(
      [
        {
          mat: '1005',
          nome: 'Técnico 1005 Estorno',
          plat: 'MXL',
          reg: 'UN-BS',
          ini: '2026-10-01',
          fim: '2026-10-14',
          hp: 20,
          status_prog: 'Carteira',
          ordem: '2032288155', // sem zeros à esquerda no Portal
          op: '10',
          id_embarque: '56100',
          hc_portal: 18
        },
        {
          mat: '1005',
          nome: 'Técnico 1005 Estorno',
          plat: 'MXL',
          reg: 'UN-BS',
          ini: '2026-12-01',
          fim: '2026-12-14',
          hp: 10,
          status_prog: 'Carteira',
          ordem: '2032288155',
          op: '10',
          id_embarque: '56200',
          hc_portal: 0
        }
      ],
      pidx
    );

    await adminProvider.data.batchImportHH(
      [{ mat: '1005', p: 'MXL', D: '2026-10-05', e: 9, nome: 'Técnico 1005 Estorno' }],
      pidx
    );

    await adminProvider.data.batchImportConfirmacoesSAP!([
      // Ordem 002032288155 / 0010 com zeros à esquerda no SAP: [+9, -9 (estorno 11d pós-desembarque 56100), +9, +9] = 18
      { mat: '1005', cria: '2026-10-05', lanc: '2026-10-05', real: '2026-10-05', ordem: '002032288155', op: '0010', hc: 9, contador: 1 },
      { mat: '1005', cria: '2026-10-25', lanc: '2026-10-25', real: '2026-10-25', ordem: '002032288155', op: '0010', hc: -9, contador: 2 },
      { mat: '1005', cria: '2026-10-07', lanc: '2026-10-07', real: '2026-10-07', ordem: '002032288155', op: '0010', hc: 9, contador: 3 },
      { mat: '1005', cria: '2026-10-08', lanc: '2026-10-08', real: '2026-10-08', ordem: '002032288155', op: '0010', hc: 9, contador: 4 },
      // Ordem Fora da Carteira com +9 em 56100 e estorno tardio -9 (>4d após 14/10)
      { mat: '1005', cria: '2026-10-06', lanc: '2026-10-06', real: '2026-10-06', ordem: '00408888', op: '0010', hc: 9, contador: 5 },
      { mat: '1005', cria: '2026-10-26', lanc: '2026-10-26', real: '2026-10-26', ordem: '00408888', op: '0010', hc: -9, contador: 6 }
    ]);

    await adminProvider.data.reconciliarConfirmacoesSAP!();
    const ds = await adminProvider.data.loadAppDataset('2026-10-01', '2026-12-31', true);

    const opEmb1 = (ds.carteiraOperacoes ?? []).find(o => o.matricula === '1005' && o.id_embarque === '56100');
    const opEmb2 = (ds.carteiraOperacoes ?? []).find(o => o.matricula === '1005' && o.id_embarque === '56200');
    expect(opEmb1?.hh_confirmado_sap).toBe(18);
    expect(opEmb1?.divergencia_sap).toBe(0);
    expect(opEmb1?.status_divergencia).toBe('OK');
    expect(opEmb2?.hh_confirmado_sap).toBe(0);

    // Todas as 4 confirmações da 002032288155/0010 (incluindo o estorno tardio -9 de 25/10) vinculadas a 56100
    const sap155 = (ds.confirmacoesSap ?? []).filter(cs => cs.matricula === '1005' && cs.ordem === '002032288155');
    expect(sap155).toHaveLength(4);
    expect(sap155.every(cs => cs.id_embarque === '56100')).toBe(true);

    // Ordem Fora da Carteira 00408888 acoplou o estorno tardio -9 ao embarque 56100 somando 0 líquido
    const sapFora = (ds.confirmacoesSap ?? []).filter(cs => cs.matricula === '1005' && cs.ordem === '00408888');
    expect(sapFora).toHaveLength(2);
    expect(sapFora.every(cs => cs.id_embarque === '56100' && cs.status_reconciliacao === 'Fora da Carteira')).toBe(true);

    // Confirmações antigas de 2.4 ('1003') sem id_embarque permanecem visíveis no dataset em vez de filtradas por id_embarque != ''
    const sapSemEmb = (ds.confirmacoesSap ?? []).filter(cs => cs.matricula === '1003' && cs.id_embarque === '');
    expect(sapSemEmb.length).toBeGreaterThan(0);
  });

  it('2.6 Deduplicação inteligente Self-Hosted: poda de embarque deslocado, colapso intra-arquivo e estorno SAP sem stacking (18h em vez de 27h)', async () => {
    const adminJar = createCookieJar();
    const adminProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: adminJar.customFetch
    });
    await adminProvider.auth.signInWithPassword('admin.vps@teste.local', 'AdminForte2026!');

    const pidx: Record<string, Plataforma> = {
      P50: {
        sigla: 'P50',
        chave_norm: 'P50',
        nome: 'P-50',
        un: 'UN-RIO',
        armador: '',
        gerencia: '',
        tipo: 'FPSO',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      }
    };

    // 1. Portal Offshore Lote 1 com linha duplicada intra-arquivo na OP 0010 e uma segunda OP 0020 no embarque 56910
    await adminProvider.data.batchImportCarteira(
      [
        {
          mat: '1095',
          nome: 'Técnico Sintético 04',
          plat: 'P50',
          reg: 'UN-RIO',
          ini: '2026-10-05',
          fim: '2026-10-15',
          hp: 25,
          hc_portal: 0,
          status_prog: 'Carteira',
          ordem: '002099990003',
          op: '0010',
          id_embarque: '56910'
        },
        {
          // Duplicata exata na própria planilha: não pode empilhar
          mat: '1095',
          nome: 'Técnico Sintético 04',
          plat: 'P50',
          reg: 'UN-RIO',
          ini: '2026-10-05',
          fim: '2026-10-15',
          hp: 25,
          hc_portal: 0,
          status_prog: 'Carteira',
          ordem: '002099990003',
          op: '0010',
          id_embarque: '56910'
        },
        {
          mat: '1095',
          nome: 'Técnico Sintético 04',
          plat: 'P50',
          reg: 'UN-RIO',
          ini: '2026-10-05',
          fim: '2026-10-15',
          hp: 15,
          hc_portal: 0,
          status_prog: 'Carteira',
          ordem: '002099990003',
          op: '0020',
          id_embarque: '56910'
        }
      ],
      pidx
    );

    const snap1 = await adminProvider.data.fetchCarteiraDedupSnapshot!();
    expect(snap1).not.toBeNull();
    expect(snap1?.carteiraOperacoes.filter(o => o.id_embarque === '56910')).toHaveLength(2);
    expect(snap1?.carteira.filter(c => c.matricula === '1095' && c.id_embarque === '56910')).toHaveLength(1);

    // 2. Portal Offshore Lote 2 desloca 56910 para 2026-10-06 e remove OP 0020
    const portalLote2 = [
      {
        mat: '1095',
        nome: 'Técnico Sintético 04',
        plat: 'P50',
        reg: 'UN-RIO',
        ini: '2026-10-06',
        fim: '2026-10-16',
        hp: 25,
        hc_portal: 0,
        status_prog: 'Carteira',
        ordem: '002099990003',
        op: '0010',
        id_embarque: '56910'
      }
    ];
    const cartPlan2 = planSmartCarteiraImport(portalLote2, pidx, snap1?.carteiraOperacoes || [], snap1?.carteira || []);
    expect(cartPlan2.affectedPruneEmbarqueIds).toEqual(['56910']);

    await adminProvider.data.batchImportCarteira(cartPlan2.rowsToImport, pidx, undefined, 'portal-lote-2', {
      pruneEmbarqueIds: cartPlan2.affectedPruneEmbarqueIds,
      pruneKeepOps: cartPlan2.pruneKeepOps
    });

    const dsPortal2 = await adminProvider.data.loadAppDataset('2026-10-01', '2026-10-31', true);
    const ops56910 = (dsPortal2.carteiraOperacoes ?? []).filter(o => o.id_embarque === '56910');
    expect(ops56910).toHaveLength(1);
    expect(ops56910[0].data_inicio).toBe('2026-10-06');

    // Órfão 2026-10-05 em carteira_embarques foi removido pelo sync sem deixar empilhamento
    const embs1095 = dsPortal2.carteira.filter(c => c.matricula === '1095');
    expect(embs1095).toHaveLength(1);
    expect(embs1095[0].data_inicio).toBe('2026-10-06');
    expect(embs1095[0].horas_programadas).toBe(25);

    // 3. SAP Lote 1: 4 contadores (+9, +9, +9, +9); SAP Lote 2: contador 2 estornado (+9 -> -9)
    await adminProvider.data.batchImportConfirmacoesSAP!([
      { mat: '1095', cria: '2026-10-07', lanc: '2026-10-07', real: '2026-10-07', ordem: '002099990003', op: '0010', hc: 9, contador: 1 },
      { mat: '1095', cria: '2026-10-07', lanc: '2026-10-07', real: '2026-10-07', ordem: '002099990003', op: '0010', hc: 9, contador: 2 },
      { mat: '1095', cria: '2026-10-07', lanc: '2026-10-07', real: '2026-10-07', ordem: '002099990003', op: '0010', hc: 9, contador: 3 },
      { mat: '1095', cria: '2026-10-07', lanc: '2026-10-07', real: '2026-10-07', ordem: '002099990003', op: '0010', hc: 9, contador: 4 }
    ]);

    const dsSap1 = await adminProvider.data.loadAppDataset('2026-10-01', '2026-10-31', true);
    const sapPlan2 = planSmartSapImport(
      [
        { mat: '1095', cria: '2026-10-07', lanc: '2026-10-07', real: '2026-10-07', ordem: '002099990003', op: '0010', hc: 9, contador: 1 },
        { mat: '1095', cria: '2026-10-07', lanc: '2026-10-07', real: '2026-10-07', ordem: '002099990003', op: '0010', hc: -9, contador: 2 },
        { mat: '1095', cria: '2026-10-07', lanc: '2026-10-07', real: '2026-10-07', ordem: '002099990003', op: '0010', hc: 9, contador: 3 },
        { mat: '1095', cria: '2026-10-07', lanc: '2026-10-07', real: '2026-10-07', ordem: '002099990003', op: '0010', hc: 9, contador: 4 }
      ],
      dsSap1.confirmacoesSap || []
    );
    expect(sapPlan2.updatedCount).toBe(1);
    expect(sapPlan2.dbDuplicatesIgnored).toBe(3);

    await adminProvider.data.batchImportConfirmacoesSAP!(sapPlan2.rowsToImport);
    const dsSap2 = await adminProvider.data.loadAppDataset('2026-10-01', '2026-10-31', true);
    const sap1095 = (dsSap2.confirmacoesSap ?? []).filter(cs => cs.matricula === '1095' && cs.ordem === '002099990003');
    expect(sap1095).toHaveLength(4);
    expect(sap1095.reduce((acc, cs) => acc + Number(cs.horas_confirmadas || 0), 0)).toBe(18);

    const op0010 = (dsSap2.carteiraOperacoes ?? []).find(o => o.id_embarque === '56910' && o.operacao === '0010');
    expect(op0010?.hh_confirmado_sap).toBe(18);

    const sapSnapshot = await adminProvider.data.fetchSapDedupSnapshot?.();
    expect(sapSnapshot).toBeDefined();
    expect(sapSnapshot!.filter(cs => cs.matricula === '1095' && cs.ordem === '002099990003')).toHaveLength(4);
  });

  it('2.6 Reconciliação SAP rejeita confirmações pré-embarque (P3 único, P3B futuro, P6 irmã e Passo 4 apontamentos_hh)', async () => {
    const adminJar = createCookieJar();
    const adminProvider = createSelfHostedClientProvider({
      baseUrl,
      customFetch: adminJar.customFetch
    });
    await adminProvider.auth.signInWithPassword('admin.vps@teste.local', 'AdminForte2026!');

    const pidx: Record<string, Plataforma> = {
      P50: {
        sigla: 'P50',
        chave_norm: 'P50',
        nome: 'P-50',
        un: 'UN-RIO',
        armador: '',
        gerencia: '',
        tipo: 'FPSO',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      }
    };

    // Caso A (P3 único): ORD 002031549540 / op 0020 só aparece no embarque 57910 (10/10 a 20/10)
    // Caso B (P3B futuro): ORD 002031549599 / op 0010 aparece em 2 embarques futuros (57921 e 57922)
    await adminProvider.data.batchImportCarteira(
      [
        {
          mat: '1091',
          nome: 'Técnico Pré-Embarque A',
          plat: 'P50',
          reg: 'UN-RIO',
          ini: '2026-10-10',
          fim: '2026-10-20',
          hp: 5,
          hc_portal: 5,
          status_prog: 'Carteira',
          ordem: '002031549540',
          op: '0020',
          id_embarque: '57910'
        },
        {
          mat: '1092',
          nome: 'Técnico Pré-Embarque B',
          plat: 'P50',
          reg: 'UN-RIO',
          ini: '2026-10-18',
          fim: '2026-10-24',
          hp: 10,
          hc_portal: 0,
          status_prog: 'Carteira',
          ordem: '002031549599',
          op: '0010',
          id_embarque: '57921'
        },
        {
          mat: '1092',
          nome: 'Técnico Pré-Embarque B',
          plat: 'P50',
          reg: 'UN-RIO',
          ini: '2026-10-26',
          fim: '2026-11-05',
          hp: 10,
          hc_portal: 0,
          status_prog: 'Carteira',
          ordem: '002031549599',
          op: '0010',
          id_embarque: '57922'
        }
      ],
      pidx
    );

    await adminProvider.data.batchImportConfirmacoesSAP!([
      // Válido no embarque 57910 (5h)
      { mat: '1091', cria: '2026-10-12', lanc: '2026-10-12', real: '2026-10-12', ordem: '002031549540', op: '0020', hc: 5, contador: 2 },
      // Pré-embarque via data_lancamento (08/10 < 10/10) com data_fim_real 11/10 dentro da janela: P3 e P1 NÃO podem vincular nem Passo 4 somar em 11/10
      { mat: '1091', cria: '2026-10-11', lanc: '2026-10-08', real: '2026-10-11', ordem: '002031549540', op: '0020', hc: 1, contador: 1 },
      // Pré-embarque via data_fim_real (08/10 < 10/10): P2 e P3 NÃO podem vincular
      { mat: '1091', cria: '2026-10-11', lanc: '2026-10-11', real: '2026-10-08', ordem: '002031549540', op: '0020', hc: 3, contador: 3 },
      // Multi-embarque futuro (P3B) e irmã Fora da Carteira (P6): pré-embarque 05/10 não pode cair em 57921
      { mat: '1092', cria: '2026-10-05', lanc: '2026-10-05', real: '2026-10-05', ordem: '002031549599', op: '0010', hc: 4, contador: 1 },
      { mat: '1092', cria: '2026-10-05', lanc: '2026-10-05', real: '2026-10-05', ordem: '002031549599', op: '0099', hc: 2, contador: 1 }
    ]);

    const ds = await adminProvider.data.loadAppDataset('2026-10-01', '2026-10-31', true);
    const op0020 = (ds.carteiraOperacoes ?? []).find(o => o.id_embarque === '57910' && o.ordem === '002031549540' && o.operacao === '0020');
    expect(op0020?.hh_confirmado_sap).toBe(5);
    expect(op0020?.status_divergencia).toBe('OK');

    const sap1091 = (ds.confirmacoesSap ?? []).filter(s => s.matricula === '1091' && s.ordem === '002031549540');
    expect(sap1091.find(s => s.contador_confirmacao === 2)?.id_embarque).toBe('57910');
    expect(sap1091.find(s => s.contador_confirmacao === 2)?.status_reconciliacao).toBe('Em Carteira');
    expect(sap1091.find(s => s.contador_confirmacao === 1)?.id_embarque).toBe('');
    expect(sap1091.find(s => s.contador_confirmacao === 1)?.status_reconciliacao).toBe('Sem Embarque');
    expect(sap1091.find(s => s.contador_confirmacao === 3)?.id_embarque).toBe('');
    expect(sap1091.find(s => s.contador_confirmacao === 3)?.status_reconciliacao).toBe('Sem Embarque');

    const sap1092 = (ds.confirmacoesSap ?? []).filter(s => s.matricula === '1092' && s.ordem === '002031549599');
    expect(sap1092.every(s => s.id_embarque === '' && s.status_reconciliacao === 'Sem Embarque')).toBe(true);

    // Passo 4 (apontamentos_hh -> hhMap): dia 2026-10-12 tem 5h, dia 2026-10-11 NÃO pode absorver a confirmação 1h rejeitada por pré-embarque
    expect(ds.hhMap?.['1091|2026-10-12']?.horas_executadas ?? 0).toBe(5);
    expect(ds.hhMap?.['1091|2026-10-11']?.horas_executadas ?? 0).toBe(0);
  });
});
