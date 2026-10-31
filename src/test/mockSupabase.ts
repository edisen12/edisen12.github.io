// ==============================================================================
// Mock Completo em Memória do Cliente Supabase para Ambiente de Testes
// GARANTIA: 100% isolado, zero chamadas de rede, fidelidade total ao Supabase JS v2
// ==============================================================================

import { createInitialMockDatabaseState } from './testFixtures';

export interface MockDatabaseState {
  authUsers: Array<{
    id: string;
    email: string;
    password: string;
    ativo?: boolean;
    banned?: boolean;
    user_metadata?: Record<string, any>;
  }>;
  currentUser: {
    id: string;
    email: string;
    user_metadata?: Record<string, any>;
  } | null;
  tables: Record<string, any[]>;
  rpcHandlers?: Record<string, (params?: any) => Promise<any> | any>;
  edgeFunctions?: Record<string, (body: any) => Promise<any> | any>;
}

export class MockQueryBuilder {
  private table: string;
  private state: MockDatabaseState;
  private action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private selectedColumns: string = '*';
  private filters: Array<(row: any) => boolean> = [];
  private orderConfig?: { column: string; ascending: boolean };
  private rangeConfig?: { from: number; to: number };
  private limitConfig?: number;
  private payload?: any;
  private upsertOptions?: { onConflict?: string };

  constructor(table: string, state: MockDatabaseState) {
    this.table = table;
    this.state = state;
  }

  select(columns: string = '*') {
    this.selectedColumns = columns;
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push(row => row[column] === value);
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push(row => row[column] != null && row[column] >= value);
    return this;
  }

  lte(column: string, value: any) {
    this.filters.push(row => row[column] != null && row[column] <= value);
    return this;
  }

  order(column: string, options: { ascending?: boolean } = { ascending: true }) {
    this.orderConfig = { column, ascending: options.ascending !== false };
    return this;
  }

  range(from: number, to: number) {
    this.rangeConfig = { from, to };
    return this;
  }

  limit(count: number) {
    this.limitConfig = count;
    return this;
  }

  insert(values: any | any[]) {
    this.action = 'insert';
    this.payload = values;
    return this;
  }

  update(values: any) {
    this.action = 'update';
    this.payload = values;
    return this;
  }

  upsert(values: any | any[], options?: { onConflict?: string }) {
    this.action = 'upsert';
    this.payload = values;
    this.upsertOptions = options;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  private applyFilters(rows: any[]): any[] {
    if (this.filters.length === 0) return rows;
    return rows.filter(row => this.filters.every(filter => filter(row)));
  }

  private resolveRelationships(row: any): any {
    if (this.table === 'pessoas') {
      const cloned = { ...row };
      if (this.selectedColumns.includes('pessoa_plataformas')) {
        const pPlats = this.state.tables.pessoa_plataformas || [];
        cloned.pessoa_plataformas = pPlats
          .filter((p: any) => p.pessoa_id === row.id)
          .map((p: any) => ({ plataforma_sigla: p.plataforma_sigla }));
      }
      if (this.selectedColumns.includes('pessoa_unidades')) {
        const pUns = this.state.tables.pessoa_unidades || [];
        cloned.pessoa_unidades = pUns
          .filter((u: any) => u.pessoa_id === row.id)
          .map((u: any) => ({ unidade_negocio: u.unidade_negocio }));
      }
      return cloned;
    }
    return { ...row };
  }

  async execute(): Promise<{ data: any; error: any }> {
    if (!this.state.tables[this.table]) {
      this.state.tables[this.table] = [];
    }

    const currentRows = this.state.tables[this.table];

    switch (this.action) {
      case 'insert': {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        const insertedItems: any[] = [];

        items.forEach(item => {
          const newItem = {
            id: item.id || `gen-${Math.random().toString(36).substring(2, 9)}`,
            ...item
          };
          currentRows.push(newItem);
          insertedItems.push(this.resolveRelationships(newItem));
        });

        const resultData = Array.isArray(this.payload) ? insertedItems : insertedItems[0];
        return { data: resultData, error: null };
      }

      case 'update': {
        const matching = this.applyFilters(currentRows);
        matching.forEach(row => {
          Object.assign(row, this.payload);
        });
        return { data: matching, error: null };
      }

      case 'upsert': {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        const conflictKeys = this.upsertOptions?.onConflict
          ? this.upsertOptions.onConflict.split(',').map(s => s.trim())
          : ['id'];

        const upsertedItems: any[] = [];

        items.forEach(item => {
          const existingIndex = currentRows.findIndex(r =>
            conflictKeys.every(k => r[k] === item[k])
          );

          if (existingIndex >= 0) {
            currentRows[existingIndex] = {
              ...currentRows[existingIndex],
              ...item
            };
            upsertedItems.push(currentRows[existingIndex]);
          } else {
            const newItem = {
              id: item.id || (!conflictKeys.includes('id') ? `gen-${Math.random().toString(36).substring(2, 9)}` : undefined),
              ...item
            };
            currentRows.push(newItem);
            upsertedItems.push(newItem);
          }
        });

        const resultData = Array.isArray(this.payload) ? upsertedItems : upsertedItems[0];
        return { data: resultData, error: null };
      }

      case 'delete': {
        if (this.filters.length === 0) {
          this.state.tables[this.table] = [];
        } else {
          this.state.tables[this.table] = currentRows.filter(
            row => !this.filters.every(filter => filter(row))
          );
        }
        return { data: null, error: null };
      }

      case 'select':
      default: {
        let results = this.applyFilters(currentRows).map(row => this.resolveRelationships(row));

        if (this.orderConfig) {
          const { column, ascending } = this.orderConfig;
          results.sort((a, b) => {
            const valA = a[column];
            const valB = b[column];
            if (valA === valB) return 0;
            if (valA == null) return ascending ? -1 : 1;
            if (valB == null) return ascending ? 1 : -1;
            if (valA < valB) return ascending ? -1 : 1;
            return ascending ? 1 : -1;
          });
        }

        if (this.rangeConfig) {
          results = results.slice(this.rangeConfig.from, this.rangeConfig.to + 1);
        } else if (this.limitConfig != null) {
          results = results.slice(0, this.limitConfig);
        }

        return { data: results, error: null };
      }
    }
  }

  async maybeSingle(): Promise<{ data: any; error: any }> {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    if (!Array.isArray(data) || data.length === 0) {
      return { data: null, error: null };
    }
    return { data: data[0], error: null };
  }

  async single(): Promise<{ data: any; error: any }> {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    if (!Array.isArray(data)) {
      return { data, error: null };
    }
    if (data.length === 0) {
      return {
        data: null,
        error: new Error('JSON object requested, multiple (or no) rows returned')
      };
    }
    if (data.length > 1) {
      return {
        data: null,
        error: new Error('JSON object requested, multiple rows returned')
      };
    }
    return { data: data[0], error: null };
  }

  // Permite que o construtor de query seja aguardado diretamente com 'await'
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createMockSupabaseClient(customInitialState?: Partial<MockDatabaseState>) {
  const baseState = createInitialMockDatabaseState();
  const state: MockDatabaseState = {
    authUsers: customInitialState?.authUsers || baseState.authUsers,
    currentUser: customInitialState?.currentUser !== undefined ? customInitialState.currentUser : baseState.currentUser,
    tables: customInitialState?.tables || baseState.tables,
    rpcHandlers: customInitialState?.rpcHandlers || {},
    edgeFunctions: customInitialState?.edgeFunctions || {}
  };

  const client = {
    // Acesso ao estado interno do banco mock nos testes
    __mockState: state,

    auth: {
      async getSession() {
        if (!state.currentUser) {
          return { data: { session: null }, error: null };
        }
        return {
          data: {
            session: {
              access_token: 'mock-jwt-token',
              token_type: 'bearer',
              expires_in: 3600,
              user: {
                id: state.currentUser.id,
                email: state.currentUser.email,
                app_metadata: {},
                user_metadata: state.currentUser.user_metadata || {},
                aud: 'authenticated',
                created_at: new Date().toISOString()
              }
            }
          },
          error: null
        };
      },

      async getUser() {
        if (!state.currentUser) {
          return { data: { user: null }, error: null };
        }
        return {
          data: {
            user: {
              id: state.currentUser.id,
              email: state.currentUser.email,
              app_metadata: {},
              user_metadata: state.currentUser.user_metadata || {},
              aud: 'authenticated',
              created_at: new Date().toISOString()
            }
          },
          error: null
        };
      },

      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const cleanEmail = email.trim().toLowerCase();
        const user = state.authUsers.find(
          u => u.email.toLowerCase() === cleanEmail && u.password === password
        );

        if (!user) {
          return {
            data: { user: null, session: null },
            error: new Error('Invalid login credentials')
          };
        }

        if (user.banned || user.ativo === false) {
          return {
            data: { user: null, session: null },
            error: new Error('User is banned')
          };
        }

        state.currentUser = {
          id: user.id,
          email: user.email,
          user_metadata: user.user_metadata || {}
        };

        return {
          data: {
            user: {
              id: user.id,
              email: user.email,
              app_metadata: {},
              user_metadata: user.user_metadata || {},
              aud: 'authenticated',
              created_at: new Date().toISOString()
            },
            session: {
              access_token: 'mock-jwt-token',
              token_type: 'bearer',
              expires_in: 3600,
              user: {
                id: user.id,
                email: user.email,
                app_metadata: {},
                user_metadata: user.user_metadata || {},
                aud: 'authenticated',
                created_at: new Date().toISOString()
              }
            }
          },
          error: null
        };
      },

      async signOut() {
        state.currentUser = null;
        return { error: null };
      },

      async updateUser(attributes: { password?: string; data?: any }) {
        if (!state.currentUser) {
          return { data: { user: null }, error: new Error('No user logged in') };
        }

        const user = state.authUsers.find(u => u.id === state.currentUser?.id);
        if (user) {
          if (attributes.password) {
            user.password = attributes.password;
          }
          if (attributes.data) {
            user.user_metadata = { ...user.user_metadata, ...attributes.data };
          }
        }

        return {
          data: {
            user: {
              id: state.currentUser.id,
              email: state.currentUser.email,
              app_metadata: {},
              user_metadata: state.currentUser.user_metadata || {},
              aud: 'authenticated',
              created_at: new Date().toISOString()
            }
          },
          error: null
        };
      }
    },

    from(table: string) {
      return new MockQueryBuilder(table, state);
    },

    async rpc(name: string, params?: any) {
      // 1. Checa se há handler customizado registrado
      if (state.rpcHandlers && state.rpcHandlers[name]) {
        return state.rpcHandlers[name](params);
      }

      // 2. Handlers integrados das RPCs do sistema
      switch (name) {
        case 'get_watermark_status': {
          const hhRows = state.tables.apontamentos_hh || [];
          const sorted = [...hhRows].sort((a, b) => (a.data < b.data ? 1 : -1));
          const latestHH = sorted[0]?.data || null;

          const fluxoRows = state.tables.fluxo_importacoes || [];
          const sortedFluxo = [...fluxoRows].sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1));
          const latestImport = sortedFluxo[0]?.criado_em || null;

          return {
            data: latestHH ? [{ ultima_data_hh: latestHH, ultima_importacao_em: latestImport }] : [],
            error: null
          };
        }

        case 'complete_first_login_password_change': {
          if (!state.currentUser) {
            return { data: null, error: new Error('Usuário não autenticado') };
          }
          const onboardings = state.tables.user_onboarding || [];
          const userOnb = onboardings.find(o => o.user_id === state.currentUser?.id);
          const now = new Date().toISOString();

          if (userOnb) {
            userOnb.primeiro_login = false;
            userOnb.obriga_troca_senha = false;
            userOnb.senha_trocada_em = now;
          } else {
            onboardings.push({
              user_id: state.currentUser.id,
              primeiro_login: false,
              obriga_troca_senha: false,
              senha_trocada_em: now,
              preferencias: {}
            });
          }
          return { data: null, error: null };
        }

        case 'update_own_profile': {
          if (!state.currentUser) {
            return { data: null, error: new Error('Usuário não autenticado') };
          }
          const { p_nome, p_preferencias } = params || {};
          const userId = state.currentUser.id;

          // Atualiza profiles
          const prof = (state.tables.profiles || []).find(p => p.id === userId);
          if (prof && p_nome) {
            prof.nome = p_nome;
          }

          // Atualiza pessoas se houver
          const pes = (state.tables.pessoas || []).find(p => p.user_id === userId);
          if (pes && p_nome) {
            pes.nome = p_nome;
          }

          // Atualiza preferencias no onboarding
          if (p_preferencias) {
            const onboardings = state.tables.user_onboarding || [];
            let userOnb = onboardings.find(o => o.user_id === userId);
            if (!userOnb) {
              userOnb = {
                user_id: userId,
                primeiro_login: false,
                obriga_troca_senha: false,
                senha_trocada_em: null,
                preferencias: {}
              };
              onboardings.push(userOnb);
            }
            userOnb.preferencias = {
              ...userOnb.preferencias,
              ...p_preferencias
            };
          }

          return { data: null, error: null };
        }

        case 'get_external_covered_days': {
          const { p_ini, p_fim } = params || {};
          const hhList = (state.tables.apontamentos_hh || []).filter(
            r => (!p_ini || r.data >= p_ini) && (!p_fim || r.data <= p_fim)
          );
          const covered = hhList.map(h => ({ matricula: h.matricula, data: h.data }));
          return { data: covered, error: null };
        }

        case 'get_shared_ops': {
          const { p_ops } = params || {};
          const opsArray: string[] = Array.isArray(p_ops) ? p_ops : [];
          // Retorna as OPs fornecidas para simulação de compartilhamento
          return { data: opsArray, error: null };
        }

        case 'ping_health': {
          return { data: 'PONG', error: null };
        }

        default:
          return { data: null, error: new Error(`RPC desconhecida: ${name}`) };
      }
    },

    functions: {
      async invoke(name: string, { body }: { body: any }) {
        if (state.edgeFunctions && state.edgeFunctions[name]) {
          return state.edgeFunctions[name](body);
        }

        if (name === 'admin-users') {
          if (body?.simulateError) {
            return {
              data: null,
              error: new Error('FunctionsFetchError: Failed to send a request to Edge Function')
            };
          }

          if (body?.simulateFail) {
            return {
              data: { ok: false, message: body.message || 'Falha de validação administrativa' },
              error: null
            };
          }

          return {
            data: {
              ok: true,
              userId: body.userId || `user-${Date.now()}`,
              message: 'Operação de usuário executada com sucesso.'
            },
            error: null
          };
        }

        return { data: null, error: new Error(`Edge Function desconhecida: ${name}`) };
      }
    }
  };

  return client;
}

export function resetMockDatabase(
  client: ReturnType<typeof createMockSupabaseClient>,
  newState?: Partial<MockDatabaseState>
) {
  const fresh = createInitialMockDatabaseState();
  client.__mockState.authUsers = newState?.authUsers || fresh.authUsers;
  client.__mockState.currentUser = newState?.currentUser !== undefined ? newState.currentUser : fresh.currentUser;
  client.__mockState.tables = newState?.tables || fresh.tables;
  client.__mockState.rpcHandlers = newState?.rpcHandlers || {};
  client.__mockState.edgeFunctions = newState?.edgeFunctions || {};
}
