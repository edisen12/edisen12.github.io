// ==============================================================================
// Mock Completo em Memória do Cliente Supabase para Ambiente de Testes
// GARANTIA: 100% isolado, zero chamadas de rede, fidelidade total ao Supabase JS v2
// ==============================================================================

import { createInitialMockDatabaseState } from './testFixtures';
import { sanitizePlatformCode, parseIdEmbarque } from '../utils/format';

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

function addDaysIsoMock(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function syncMockCarteiraEmbarquesFromOperacoes(state: MockDatabaseState): void {
  const ops = state.tables.carteira_operacoes || [];
  if (ops.length === 0) return;

  for (const op of ops) {
    if (op.plataforma_sigla) {
      op.plataforma_sigla = sanitizePlatformCode(op.plataforma_sigla);
    }
    const cleanId = parseIdEmbarque(op.id_embarque || op.portal_id || '');
    op.id_embarque = cleanId;
    op.portal_id = cleanId;
  }

  if (!state.tables.carteira_embarques) state.tables.carteira_embarques = [];
  const existingCart = state.tables.carteira_embarques;

  const grouped = new Map<string, any>();
  for (const co of ops) {
    const key = `${co.matricula}::${co.data_inicio}`;
    const stProg = String(co.status_programacao || 'Carteira').trim();
    const hhProg = Number(co.hh_programado || 0);
    let acc = grouped.get(key);
    if (!acc) {
      acc = {
        id_embarque: co.id_embarque || '',
        matricula: co.matricula,
        plataforma_sigla: co.plataforma_sigla || '',
        unidade_negocio: co.unidade_negocio || '',
        data_inicio: co.data_inicio,
        data_fim: co.data_fim,
        horas_programadas: 0,
        hh_carteira: 0,
        hh_fora_carteira: 0,
        hh_cancelado: 0
      };
      grouped.set(key, acc);
    } else {
      if (co.data_fim > acc.data_fim) acc.data_fim = co.data_fim;
      if (co.id_embarque && co.id_embarque > acc.id_embarque) acc.id_embarque = co.id_embarque;
      if (co.plataforma_sigla && !acc.plataforma_sigla) acc.plataforma_sigla = co.plataforma_sigla;
    }

    if (stProg === 'Carteira' || stProg === 'Fora da carteira') {
      acc.horas_programadas += hhProg;
    }
    if (stProg === 'Carteira') acc.hh_carteira += hhProg;
    else if (stProg === 'Fora da carteira') acc.hh_fora_carteira += hhProg;
    else if (stProg === 'Cancelada') acc.hh_cancelado += hhProg;
  }

  for (const g of grouped.values()) {
    const idx = existingCart.findIndex(
      (c: any) => c.matricula === g.matricula && c.data_inicio === g.data_inicio
    );
    const merged = {
      id: idx >= 0 ? existingCart[idx].id : `cart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...(idx >= 0 ? existingCart[idx] : {}),
      id_embarque: g.id_embarque,
      matricula: g.matricula,
      plataforma_sigla: g.plataforma_sigla,
      unidade_negocio: g.unidade_negocio,
      data_inicio: g.data_inicio,
      data_fim: g.data_fim,
      horas_programadas: g.horas_programadas,
      hh_carteira: g.hh_carteira,
      hh_fora_carteira: g.hh_fora_carteira,
      hh_cancelado: g.hh_cancelado,
      operacao: g.id_embarque,
      fonte: 'portal_offshore'
    };
    if (idx >= 0) existingCart[idx] = merged;
    else existingCart.push(merged);
  }
}

function executeMockReconciliacaoSap(state: MockDatabaseState) {
  const allSap = state.tables.confirmacoes_sap || [];
  const allOps = state.tables.carteira_operacoes || [];
  const allCart = state.tables.carteira_embarques || [];
  const allTecs = state.tables.tecnicos || [];
  const tecMats = new Set(allTecs.map((t: any) => String(t.matricula)));

  if (allSap.length === 0 && allOps.length === 0) {
    return {
      total_confirmacoes_sap: 0,
      vinculados_ao_embarque: 0,
      sem_embarque_associado: 0,
      operacoes_com_batimento_ok: 0,
      operacoes_com_divergencia: 0,
      dias_apontados_sincronizados: 0
    };
  }

  for (const cs of allSap) {
    const matchingOps = allOps
      .filter((co: any) => co.matricula === cs.matricula && co.ordem === cs.ordem && co.operacao === cs.operacao)
      .sort((a: any, b: any) => b.data_inicio.localeCompare(a.data_inicio));
    const matchingEmbs = allCart
      .filter((ce: any) => ce.matricula === cs.matricula)
      .sort((a: any, b: any) => b.data_inicio.localeCompare(a.data_inicio));

    const opIdOf = (co: any) => parseIdEmbarque(co.id_embarque || co.portal_id || '');
    const embIdOf = (ce: any) => parseIdEmbarque(ce.id_embarque || ce.operacao || '');

    let resolvedId = '';
    const p1 = matchingOps.find((co: any) => cs.data_fim_real >= co.data_inicio && cs.data_fim_real <= co.data_fim);
    if (p1) resolvedId = opIdOf(p1);
    if (!resolvedId) {
      const p2 = matchingOps.find(
        (co: any) => cs.data_lancamento >= co.data_inicio && cs.data_lancamento <= addDaysIsoMock(co.data_fim, 4)
      );
      if (p2) resolvedId = opIdOf(p2);
    }
    if (!resolvedId && matchingOps.length > 0) {
      const distinctIds = Array.from(new Set(matchingOps.map(opIdOf)));
      if (distinctIds.length === 1) resolvedId = distinctIds[0];
    }
    if (!resolvedId) {
      const p4 = matchingEmbs.find((ce: any) => cs.data_fim_real >= ce.data_inicio && cs.data_fim_real <= ce.data_fim);
      if (p4) resolvedId = embIdOf(p4);
    }
    if (!resolvedId) {
      const p5 = matchingEmbs.find(
        (ce: any) => cs.data_lancamento >= ce.data_inicio && cs.data_lancamento <= addDaysIsoMock(ce.data_fim, 4)
      );
      if (p5) resolvedId = embIdOf(p5);
    }

    let statusRec = 'Sem Embarque';
    if (matchingOps.length > 0) {
      statusRec = 'Em Carteira';
    } else if (
      matchingEmbs.some(
        (ce: any) =>
          (cs.data_fim_real >= ce.data_inicio && cs.data_fim_real <= ce.data_fim) ||
          (cs.data_lancamento >= ce.data_inicio && cs.data_lancamento <= addDaysIsoMock(ce.data_fim, 4))
      )
    ) {
      statusRec = 'Fora da Carteira';
    }

    cs.id_embarque = resolvedId;
    cs.status_reconciliacao = statusRec;
  }

  const sapAggMap = new Map<string, number>();
  for (const cs of allSap) {
    const k = `${cs.matricula}::${cs.ordem}::${cs.operacao}::${cs.id_embarque}`;
    sapAggMap.set(k, (sapAggMap.get(k) || 0) + Number(cs.horas_confirmadas || 0));
  }

  for (const co of allOps) {
    const idEmb = parseIdEmbarque(co.id_embarque || co.portal_id || '');
    const k = `${co.matricula}::${co.ordem}::${co.operacao}::${idEmb}`;
    const totalSap = sapAggMap.get(k) || 0;
    const hhConf = Number(co.hh_confirmado || 0);
    const div = Math.round((hhConf - totalSap) * 100) / 100;

    let statusDiv = 'Divergente';
    if (hhConf === 0 && totalSap === 0) statusDiv = 'Não Confirmado';
    else if (hhConf === totalSap) statusDiv = 'OK';
    else if (totalSap === 0 && hhConf > 0) statusDiv = 'Não Apontado no SAP';
    else if (hhConf === 0 && totalSap > 0) statusDiv = 'Não Confirmado no Portal';
    else if (hhConf > totalSap) statusDiv = 'Divergente (Portal > SAP)';
    else if (hhConf < totalSap) statusDiv = 'Divergente (SAP > Portal)';

    co.hh_confirmado_sap = totalSap;
    co.divergencia_sap = div;
    co.status_divergencia = statusDiv;
  }

  // Sincroniza apontamentos_hh diários a partir das confirmações do SAP (teto [0, 24])
  const dailyMap = new Map<string, { matricula: string; data: string; total: number; plat: string; un: string }>();
  for (const cs of allSap) {
    if (!cs.data_fim_real || !tecMats.has(String(cs.matricula))) continue;
    const dk = `${cs.matricula}::${cs.data_fim_real}`;
    const ceRef = allCart.find(
      (ce: any) =>
        ce.matricula === cs.matricula &&
        (parseIdEmbarque(ce.id_embarque || ce.operacao || '') === cs.id_embarque ||
          (cs.data_fim_real >= ce.data_inicio && cs.data_fim_real <= ce.data_fim))
    );
    const entry = dailyMap.get(dk) || {
      matricula: cs.matricula,
      data: cs.data_fim_real,
      total: 0,
      plat: ceRef?.plataforma_sigla || '',
      un: ceRef?.unidade_negocio || 'UN-DESCONHECIDA'
    };
    entry.total += Number(cs.horas_confirmadas || 0);
    dailyMap.set(dk, entry);
  }

  if (!state.tables.apontamentos_hh) state.tables.apontamentos_hh = [];
  for (const d of dailyMap.values()) {
    const clamped = Math.min(24, Math.max(0, Math.round(d.total * 100) / 100));
    const idx = state.tables.apontamentos_hh.findIndex(
      (h: any) => h.matricula === d.matricula && h.data === d.data
    );
    const hhRow = {
      id: idx >= 0 ? state.tables.apontamentos_hh[idx].id : `hh-sap-${Math.random().toString(36).slice(2, 7)}`,
      matricula: d.matricula,
      data: d.data,
      plataforma_sigla: d.plat,
      unidade_negocio: d.un,
      horas_executadas: clamped
    };
    if (idx >= 0) state.tables.apontamentos_hh[idx] = hhRow;
    else state.tables.apontamentos_hh.push(hhRow);
  }

  const vinculados = allSap.filter((cs: any) => cs.id_embarque !== '').length;
  const opsOk = allOps.filter((co: any) => co.status_divergencia === 'OK').length;
  const opsDiv = allOps.filter((co: any) => String(co.status_divergencia || '').startsWith('Divergente')).length;

  return {
    total_confirmacoes_sap: allSap.length,
    vinculados_ao_embarque: vinculados,
    sem_embarque_associado: allSap.length - vinculados,
    operacoes_com_batimento_ok: opsOk,
    operacoes_com_divergencia: opsDiv,
    dias_apontados_sincronizados: dailyMap.size
  };
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

  neq(column: string, value: any) {
    this.filters.push(row => row[column] !== value);
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

  in(column: string, values: any[]) {
    const allowed = Array.isArray(values) ? values : [];
    this.filters.push(row => allowed.includes(row[column]));
    return this;
  }

  ilike(column: string, pattern: string) {
    const escaped = String(pattern ?? '')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.');
    const regex = new RegExp(`^${escaped}$`, 'i');
    this.filters.push(row => row[column] != null && regex.test(String(row[column])));
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
        if (this.table === 'carteira_operacoes') {
          syncMockCarteiraEmbarquesFromOperacoes(this.state);
        }
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

        case 'reconciliar_confirmacoes_sap': {
          return {
            data: executeMockReconciliacaoSap(state),
            error: null
          };
        }

        case 'reset_carteira_embarques': {
          if (!state.currentUser) {
            return {
              data: null,
              error: new Error('Acesso negado: apenas administradores e gestores globais podem resetar a carteira')
            };
          }
          const prof = (state.tables.profiles || []).find((p: any) => p.id === state.currentUser?.id);
          if (prof && (prof.ativo === false || (prof.role !== 'admin' && prof.role !== 'gestor'))) {
            return {
              data: null,
              error: new Error('Acesso negado: apenas administradores e gestores globais podem resetar a carteira')
            };
          }

          const deleted_operacoes = (state.tables.carteira_operacoes || []).length;
          const deleted_embarques = (state.tables.carteira_embarques || []).length;
          state.tables.carteira_operacoes = [];
          state.tables.carteira_embarques = [];

          const nowIso = new Date().toISOString();
          (state.tables.confirmacoes_sap || []).forEach((cs: any) => {
            if (cs.id_embarque !== '' || cs.status_reconciliacao !== 'Pendente') {
              cs.id_embarque = '';
              cs.status_reconciliacao = 'Pendente';
              cs.updated_at = nowIso;
            }
          });

          if (!state.tables.system_audit_logs) state.tables.system_audit_logs = [];
          state.tables.system_audit_logs.push({
            id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            actor_id: state.currentUser.id,
            actor_nome: prof?.nome || 'Administrador',
            actor_email: state.currentUser.email,
            actor_role: prof?.role || 'admin',
            action: 'carteira_reset',
            category: 'operacional',
            target_id: 'carteira',
            target_label: 'Carteira de Embarques e Operações',
            details: { deleted_operacoes, deleted_embarques },
            ip_address: null,
            created_at: nowIso
          });

          return {
            data: {
              success: true,
              deleted_operacoes,
              deleted_embarques,
              message: 'Carteira de operações e embarques resetadas com sucesso para reimportação limpa.'
            },
            error: null
          };
        }

        case 'log_system_event': {
          if (!state.currentUser) {
            return { data: null, error: new Error('Acesso não autorizado para emissão de auditoria.') };
          }
          const prof = (state.tables.profiles || []).find((p: any) => p.id === state.currentUser?.id);
          if (prof && prof.ativo === false) {
            return { data: null, error: new Error('Acesso não autorizado: usuário inativo ou suspenso.') };
          }
          const action = String(params?.p_action ?? '').trim();
          const category = String(params?.p_category ?? '').trim().toLowerCase();
          if (!action) {
            return { data: null, error: new Error('Ação de auditoria não pode ser vazia.') };
          }
          const validCats = ['usuarios', 'seguranca', 'configuracoes', 'cadastros', 'operacional'];
          if (!validCats.includes(category)) {
            return { data: null, error: new Error(`Categoria de auditoria inválida: ${category}`) };
          }
          const logId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          if (!state.tables.system_audit_logs) state.tables.system_audit_logs = [];
          state.tables.system_audit_logs.push({
            id: logId,
            actor_id: state.currentUser.id,
            actor_nome: prof?.nome || 'Usuário Autenticado',
            actor_email: state.currentUser.email,
            actor_role: prof?.role || 'authenticated',
            action,
            category,
            target_id: params?.p_target_id ?? null,
            target_label: params?.p_target_label ?? null,
            details: params?.p_details ?? {},
            ip_address: null,
            created_at: new Date().toISOString()
          });
          return { data: logId, error: null };
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

          if (body?.action === 'delete-user' && body?.userId) {
            state.tables.profiles = (state.tables.profiles || []).filter((p: any) => p.id !== body.userId);
            state.tables.user_onboarding = (state.tables.user_onboarding || []).filter((o: any) => o.user_id !== body.userId);
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
