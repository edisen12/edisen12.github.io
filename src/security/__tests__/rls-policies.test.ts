// ==============================================================================
// Suíte de Testes de Segurança: Row Level Security (RLS) & Controle de Roles/RBAC
// Sistema: hh-offshore-infotec (React 19 + TypeScript + Vite + Supabase Cloud)
// Ambiente: Teste 100% Isolado em Memória (Zero chamadas de rede ou produção)
// ==============================================================================

import { describe, expect, it, beforeEach } from 'vitest';
import {
  mockUsers,
  mockProfiles,
  mockPlataformasRows,
  mockPessoasRows,
  mockPessoaPlataformasRows,
  mockPessoaUnidadesRows,
  mockTecnicosRows,
  mockCarteiraRows,
  mockApontamentosHHRows,
  mockJustificativasRows,
  mockContractConfig,
  mockUsoffUnWeights,
  mockLatestFluxo,
  mockOnboardings,
  createInitialMockDatabaseState
} from '../../test/testFixtures';

// ------------------------------------------------------------------------------
// Lista Exaustiva das 15 Tabelas Públicas do Sistema com RLS Obrigatório
// ------------------------------------------------------------------------------
export const ALL_PUBLIC_TABLES = [
  'profiles',
  'plataformas',
  'pessoas',
  'pessoa_plataformas',
  'pessoa_unidades',
  'tecnicos',
  'carteira_embarques',
  'apontamentos_hh',
  'justificativas',
  'configuracoes',
  'config_usoff_un',
  'configuracoes_notificacao',
  'fluxo_importacoes',
  'sync_heartbeat',
  'user_onboarding'
] as const;

export type PublicTable = (typeof ALL_PUBLIC_TABLES)[number];

// ------------------------------------------------------------------------------
// Tipos e Estrutura do Estado do Banco de Dados Mock
// ------------------------------------------------------------------------------
export interface DatabaseState {
  tables: Record<string, any[]>;
}

export interface SecurityUserContext {
  id: string;
  email: string;
}

// ------------------------------------------------------------------------------
// Funções de Escopo e Segurança RLS (Fidelidade 1:1 a 002_rls_and_rpc_functions.sql)
// ------------------------------------------------------------------------------

export function auth_is_active(state: DatabaseState, uid: string | null): boolean {
  if (!uid) return false;
  const prof = (state.tables.profiles || []).find((p: any) => p.id === uid);
  return Boolean(prof && prof.ativo === true);
}

export function auth_is_admin(state: DatabaseState, uid: string | null): boolean {
  if (!auth_is_active(state, uid)) return false;
  const prof = (state.tables.profiles || []).find((p: any) => p.id === uid);
  return prof?.role === 'admin';
}

export function auth_is_global(state: DatabaseState, uid: string | null): boolean {
  if (!auth_is_active(state, uid)) return false;
  const prof = (state.tables.profiles || []).find((p: any) => p.id === uid);
  return prof?.role === 'admin' || prof?.role === 'gestor';
}

export function auth_allowed_uns(state: DatabaseState, uid: string | null): string[] {
  if (!uid) return [];
  const pessoas = (state.tables.pessoas || []).filter((p: any) => p.user_id === uid);
  const pessoaIds = pessoas.map((p: any) => p.id);
  const units = (state.tables.pessoa_unidades || [])
    .filter((u: any) => pessoaIds.includes(u.pessoa_id))
    .map((u: any) => u.unidade_negocio);
  return Array.from(new Set(units));
}

export function auth_allowed_platforms(state: DatabaseState, uid: string | null): string[] {
  if (!uid) return [];
  const pessoas = (state.tables.pessoas || []).filter((p: any) => p.user_id === uid);
  const pessoaIds = pessoas.map((p: any) => p.id);

  // 1. Plataformas atribuídas diretamente à pessoa
  const directPlats = (state.tables.pessoa_plataformas || [])
    .filter((pp: any) => pessoaIds.includes(pp.pessoa_id))
    .map((pp: any) => pp.plataforma_sigla);

  // 2. Plataformas derivadas das Unidades de Negócio atribuídas
  const allowedUns = auth_allowed_uns(state, uid);
  const unPlats = (state.tables.plataformas || [])
    .filter((plat: any) => allowedUns.includes(plat.un))
    .map((plat: any) => plat.sigla);

  return Array.from(new Set([...directPlats, ...unPlats]));
}

export function auth_can_access_justificativa(
  state: DatabaseState,
  uid: string | null,
  matricula: string,
  data: string
): boolean {
  if (!auth_is_active(state, uid)) return false;
  if (auth_is_global(state, uid)) return true;

  const allowedPlats = auth_allowed_platforms(state, uid);
  const allowedUns = auth_allowed_uns(state, uid);

  // 1. Verifica apontamento direto
  const hasApontamento = (state.tables.apontamentos_hh || []).some((a: any) => {
    return (
      a.matricula === matricula &&
      a.data === data &&
      (allowedPlats.includes(a.plataforma_sigla) || allowedUns.includes(a.unidade_negocio))
    );
  });
  if (hasApontamento) return true;

  // 2. Verifica carteira de embarque que cobre o dia
  const hasCarteira = (state.tables.carteira_embarques || []).some((c: any) => {
    return (
      c.matricula === matricula &&
      data >= c.data_inicio &&
      data <= c.data_fim &&
      (allowedPlats.includes(c.plataforma_sigla) || allowedUns.includes(c.unidade_negocio))
    );
  });
  if (hasCarteira) return true;

  return false;
}

// ------------------------------------------------------------------------------
// Mecanismo de Políticas RLS por Tabela (Simulador Fiel do PostgreSQL RLS)
// ------------------------------------------------------------------------------

export interface RlsPolicyResult {
  allowed: boolean;
  reason?: string;
}

export function evaluateRlsSelect(
  table: PublicTable,
  row: any,
  state: DatabaseState,
  uid: string | null
): boolean {
  if (!uid || !auth_is_active(state, uid)) return false;

  const isGlobal = auth_is_global(state, uid);

  switch (table) {
    case 'profiles':
      return isGlobal || row.id === uid;

    case 'plataformas':
      return isGlobal || auth_allowed_platforms(state, uid).includes(row.sigla);

    case 'pessoas':
      return isGlobal || row.user_id === uid;

    case 'pessoa_plataformas': {
      if (isGlobal) return true;
      const userPessoas = (state.tables.pessoas || [])
        .filter((p: any) => p.user_id === uid)
        .map((p: any) => p.id);
      return userPessoas.includes(row.pessoa_id);
    }

    case 'pessoa_unidades': {
      if (isGlobal) return true;
      const userPessoas = (state.tables.pessoas || [])
        .filter((p: any) => p.user_id === uid)
        .map((p: any) => p.id);
      return userPessoas.includes(row.pessoa_id);
    }

    case 'tecnicos':
      return true; // auth_is_active() já validado no topo

    case 'carteira_embarques':
      return (
        isGlobal ||
        auth_allowed_platforms(state, uid).includes(row.plataforma_sigla) ||
        auth_allowed_uns(state, uid).includes(row.unidade_negocio)
      );

    case 'apontamentos_hh':
      return (
        isGlobal ||
        auth_allowed_platforms(state, uid).includes(row.plataforma_sigla) ||
        auth_allowed_uns(state, uid).includes(row.unidade_negocio)
      );

    case 'justificativas':
      return isGlobal || auth_can_access_justificativa(state, uid, row.matricula, row.data);

    case 'configuracoes':
      return true; // auth_is_active() já validado no topo

    case 'config_usoff_un':
      return isGlobal || auth_allowed_uns(state, uid).includes(row.unidade_negocio);

    case 'configuracoes_notificacao':
      return isGlobal; // Preposto e controlador recebem 0 linhas

    case 'fluxo_importacoes':
      return isGlobal; // Apenas admin e gestor

    case 'sync_heartbeat':
      return true; // auth_is_active() já validado no topo

    case 'user_onboarding':
      return isGlobal || row.user_id === uid;

    default:
      return false;
  }
}

export function evaluateRlsInsert(
  table: PublicTable,
  payload: any,
  state: DatabaseState,
  uid: string | null
): RlsPolicyResult {
  if (!uid || !auth_is_active(state, uid)) {
    return { allowed: false, reason: 'Usuário não autenticado ou inativo' };
  }

  const isAdmin = auth_is_admin(state, uid);
  const isGlobal = auth_is_global(state, uid);

  switch (table) {
    case 'profiles':
      return isAdmin
        ? { allowed: true }
        : { allowed: false, reason: 'Apenas admin pode inserir perfis' };

    case 'plataformas':
    case 'pessoas':
    case 'pessoa_plataformas':
    case 'pessoa_unidades':
    case 'tecnicos':
    case 'carteira_embarques':
    case 'apontamentos_hh':
    case 'configuracoes':
    case 'config_usoff_un':
    case 'configuracoes_notificacao':
    case 'fluxo_importacoes':
    case 'sync_heartbeat':
      return isGlobal
        ? { allowed: true }
        : { allowed: false, reason: `Inserção em ${table} restrita a perfis globais (admin/gestor)` };

    case 'justificativas': {
      const canAccess = isGlobal || auth_can_access_justificativa(state, uid, payload.matricula, payload.data);
      return canAccess
        ? { allowed: true }
        : { allowed: false, reason: 'Preposto não tem permissão para inserir justificativa fora de suas plataformas' };
    }

    case 'user_onboarding': {
      const allowed = payload.user_id === uid || isAdmin;
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: 'Usuário só pode inserir onboarding próprio' };
    }

    default:
      return { allowed: false, reason: `Tabela ${table} não possui política de inserção definida` };
  }
}

export function evaluateRlsUpdate(
  table: PublicTable,
  existingRow: any,
  patch: any,
  state: DatabaseState,
  uid: string | null
): RlsPolicyResult {
  if (!uid || !auth_is_active(state, uid)) {
    return { allowed: false, reason: 'Usuário não autenticado ou inativo' };
  }

  const isAdmin = auth_is_admin(state, uid);
  const isGlobal = auth_is_global(state, uid);

  switch (table) {
    case 'profiles':
      return isAdmin
        ? { allowed: true }
        : { allowed: false, reason: 'Apenas admin pode atualizar tabela profiles diretamente' };

    case 'plataformas':
    case 'pessoas':
    case 'pessoa_plataformas':
    case 'pessoa_unidades':
    case 'tecnicos':
    case 'carteira_embarques':
    case 'apontamentos_hh':
    case 'configuracoes':
    case 'config_usoff_un':
    case 'configuracoes_notificacao':
    case 'fluxo_importacoes':
    case 'sync_heartbeat':
      return isGlobal
        ? { allowed: true }
        : { allowed: false, reason: `Atualização em ${table} restrita a perfis globais (admin/gestor)` };

    case 'justificativas': {
      const canAccessExisting = isGlobal || auth_can_access_justificativa(state, uid, existingRow.matricula, existingRow.data);
      const targetMat = patch.matricula ?? existingRow.matricula;
      const targetData = patch.data ?? existingRow.data;
      const canAccessNew = isGlobal || auth_can_access_justificativa(state, uid, targetMat, targetData);

      if (canAccessExisting && canAccessNew) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Preposto não pode adulterar justificativa de plataforma alheia' };
    }

    case 'user_onboarding': {
      const allowed = existingRow.user_id === uid || isAdmin;
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: 'Apenas o próprio usuário ou admin podem atualizar o onboarding' };
    }

    default:
      return { allowed: false, reason: `Tabela ${table} não possui política de atualização definida` };
  }
}

export function evaluateRlsDelete(
  table: PublicTable,
  existingRow: any,
  state: DatabaseState,
  uid: string | null
): RlsPolicyResult {
  if (!uid || !auth_is_active(state, uid)) {
    return { allowed: false, reason: 'Usuário não autenticado ou inativo' };
  }

  const isAdmin = auth_is_admin(state, uid);
  const isGlobal = auth_is_global(state, uid);

  switch (table) {
    case 'profiles':
    case 'user_onboarding':
      return isAdmin
        ? { allowed: true }
        : { allowed: false, reason: 'Apenas admin pode excluir perfis e onboardings' };

    case 'plataformas':
    case 'pessoas':
    case 'pessoa_plataformas':
    case 'pessoa_unidades':
    case 'tecnicos':
    case 'carteira_embarques':
    case 'apontamentos_hh':
    case 'justificativas':
    case 'configuracoes':
    case 'config_usoff_un':
    case 'configuracoes_notificacao':
    case 'fluxo_importacoes':
    case 'sync_heartbeat':
      return isGlobal
        ? { allowed: true }
        : { allowed: false, reason: `Exclusão em ${table} restrita a perfis globais (admin/gestor)` };

    default:
      return { allowed: false, reason: `Tabela ${table} não possui política de exclusão definida` };
  }
}

// ------------------------------------------------------------------------------
// Cliente Supabase com Enforçamento Estrito de RLS (Simulador de Camada REST)
// ------------------------------------------------------------------------------

export class RlsQueryBuilder {
  private table: PublicTable;
  private state: DatabaseState;
  private currentUser: SecurityUserContext | null;
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private selectedColumns: string = '*';
  private filters: Array<(row: any) => boolean> = [];
  private payload?: any;

  constructor(table: PublicTable, state: DatabaseState, currentUser: SecurityUserContext | null) {
    this.table = table;
    this.state = state;
    this.currentUser = currentUser;
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

  delete() {
    this.action = 'delete';
    return this;
  }

  async execute(): Promise<{ data: any; error: any }> {
    const uid = this.currentUser ? this.currentUser.id : null;

    // 1. Papel Anon: REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    if (!uid) {
      return {
        data: null,
        error: new Error(`permission denied for table "${this.table}"`)
      };
    }

    // 2. Usuário Inativo: Bloqueio imediato (0ms)
    if (!auth_is_active(this.state, uid)) {
      if (this.action === 'select') {
        return { data: [], error: null }; // RLS filtra 100% das linhas
      }
      return {
        data: null,
        error: new Error(`new row violates row-level security policy for table "${this.table}"`)
      };
    }

    const tableRows = this.state.tables[this.table] || [];

    switch (this.action) {
      case 'select': {
        // Aplica filtro RLS por linha
        const rlsFiltered = tableRows.filter(row => evaluateRlsSelect(this.table, row, this.state, uid));
        // Aplica filtros adicionais da query
        const queryFiltered = this.filters.length > 0
          ? rlsFiltered.filter(row => this.filters.every(f => f(row)))
          : rlsFiltered;
        return { data: JSON.parse(JSON.stringify(queryFiltered)), error: null };
      }

      case 'insert': {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const item of items) {
          const evalResult = evaluateRlsInsert(this.table, item, this.state, uid);
          if (!evalResult.allowed) {
            return {
              data: null,
              error: new Error(
                evalResult.reason || `new row violates row-level security policy for table "${this.table}"`
              )
            };
          }
        }
        // Inserção permitida
        items.forEach(item => tableRows.push(item));
        return { data: Array.isArray(this.payload) ? items : items[0], error: null };
      }

      case 'update': {
        // Encontra linhas correspondentes sob a política RLS SELECT
        const visibleRows = tableRows.filter(row => evaluateRlsSelect(this.table, row, this.state, uid));
        const targets = this.filters.length > 0
          ? visibleRows.filter(row => this.filters.every(f => f(row)))
          : visibleRows;

        if (targets.length === 0) {
          return { data: [], error: null };
        }

        for (const target of targets) {
          const evalResult = evaluateRlsUpdate(this.table, target, this.payload, this.state, uid);
          if (!evalResult.allowed) {
            return {
              data: null,
              error: new Error(
                evalResult.reason || `new row violates row-level security policy for table "${this.table}"`
              )
            };
          }
        }

        targets.forEach(target => Object.assign(target, this.payload));
        return { data: targets, error: null };
      }

      case 'delete': {
        const visibleRows = tableRows.filter(row => evaluateRlsSelect(this.table, row, this.state, uid));
        const targets = this.filters.length > 0
          ? visibleRows.filter(row => this.filters.every(f => f(row)))
          : visibleRows;

        if (targets.length === 0) {
          return { data: null, error: null };
        }

        for (const target of targets) {
          const evalResult = evaluateRlsDelete(this.table, target, this.state, uid);
          if (!evalResult.allowed) {
            return {
              data: null,
              error: new Error(
                evalResult.reason || `violates row-level security policy for table "${this.table}"`
              )
            };
          }
        }

        this.state.tables[this.table] = tableRows.filter(r => !targets.includes(r));
        return { data: null, error: null };
      }
    }
  }

  async maybeSingle(): Promise<{ data: any; error: any }> {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    if (!Array.isArray(data) || data.length === 0) return { data: null, error: null };
    return { data: data[0], error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createRlsClient(state: DatabaseState, currentUser: SecurityUserContext | null) {
  return {
    from(table: PublicTable) {
      return new RlsQueryBuilder(table, state, currentUser);
    },
    async rpc(name: string, params?: any) {
      const uid = currentUser ? currentUser.id : null;

      // 1. Healthcheck: Apenas ping_health é permitido a anônimos
      if (name === 'ping_health') {
        return { data: 'PONG', error: null };
      }

      // 2. RPCs protegidas exigem autenticação ativa
      if (!uid) {
        return { data: null, error: new Error(`permission denied for function "${name}"`) };
      }

      if (!auth_is_active(state, uid)) {
        return { data: null, error: new Error('Sessão inválida ou usuário inativo.') };
      }

      switch (name) {
        case 'get_watermark_status':
          return {
            data: [{ ultima_data_hh: '2026-10-06', ultima_importacao_em: '2026-10-06T18:30:00Z' }],
            error: null
          };
        case 'get_external_covered_days':
          return { data: [], error: null };
        case 'get_shared_ops':
          return { data: [], error: null };
        case 'complete_first_login_password_change':
          return { data: null, error: null };
        default:
          return { data: null, error: new Error(`Função desconhecida: ${name}`) };
      }
    }
  };
}

// ------------------------------------------------------------------------------
// Suíte de Testes Exaustiva
// ------------------------------------------------------------------------------

describe('Auditoria de Segurança & Políticas RLS (Row Level Security) - 15 Tabelas Públicas', () => {
  let dbState: DatabaseState;

  beforeEach(() => {
    const raw = createInitialMockDatabaseState();
    dbState = {
      tables: {
        ...raw.tables,
        // Garante que sync_heartbeat possui registro inicial
        sync_heartbeat: [{ id: 1, updated_at: '2026-10-06T18:30:00Z' }]
      }
    };
  });

  // ============================================================================
  // DIRETRIZ 1: Papel `anon` (Não autenticado)
  // ============================================================================
  describe('1. Papel anon (Não autenticado / Zero-Trust Total)', () => {
    const anonClient = () => createRlsClient(dbState, null);

    it('assegura que todas as 15 tabelas públicas rejeitam terminantemente SELECT para anon', async () => {
      const client = anonClient();
      for (const table of ALL_PUBLIC_TABLES) {
        const { data, error } = await client.from(table).select('*');
        expect(error, `A tabela ${table} deveria rejeitar SELECT para anon`).not.toBeNull();
        expect(error.message).toContain('permission denied');
        expect(data).toBeNull();
      }
    });

    it('assegura que todas as 15 tabelas públicas rejeitam terminantemente INSERT para anon', async () => {
      const client = anonClient();
      for (const table of ALL_PUBLIC_TABLES) {
        const { data, error } = await client.from(table).insert({ id: 'tentativa-anon' });
        expect(error, `A tabela ${table} deveria rejeitar INSERT para anon`).not.toBeNull();
        expect(error.message).toContain('permission denied');
        expect(data).toBeNull();
      }
    });

    it('assegura que todas as 15 tabelas públicas rejeitam terminantemente UPDATE para anon', async () => {
      const client = anonClient();
      for (const table of ALL_PUBLIC_TABLES) {
        const { data, error } = await client.from(table).update({ campo: 'hacked' }).eq('id', 'qualquer');
        expect(error, `A tabela ${table} deveria rejeitar UPDATE para anon`).not.toBeNull();
        expect(error.message).toContain('permission denied');
        expect(data).toBeNull();
      }
    });

    it('assegura que todas as 15 tabelas públicas rejeitam terminantemente DELETE para anon', async () => {
      const client = anonClient();
      for (const table of ALL_PUBLIC_TABLES) {
        const { data, error } = await client.from(table).delete().eq('id', 'qualquer');
        expect(error, `A tabela ${table} deveria rejeitar DELETE para anon`).not.toBeNull();
        expect(error.message).toContain('permission denied');
        expect(data).toBeNull();
      }
    });

    it('permite apenas a RPC ping_health para anon (Healthcheck Keep-Alive do GitHub Actions)', async () => {
      const client = anonClient();
      const healthRes = await client.rpc('ping_health');
      expect(healthRes.error).toBeNull();
      expect(healthRes.data).toBe('PONG');

      // Outras RPCs são estritamente rejeitadas
      const wmRes = await client.rpc('get_watermark_status');
      expect(wmRes.error).not.toBeNull();
      expect(wmRes.error?.message).toContain('permission denied');

      const passRes = await client.rpc('complete_first_login_password_change');
      expect(passRes.error).not.toBeNull();
      expect(passRes.error?.message).toContain('permission denied');
    });
  });

  // ============================================================================
  // DIRETRIZ 2: Usuário Desativado (`ativo = false`) & Revogação Imediata (0ms)
  // ============================================================================
  describe('2. Usuário Desativado (ativo = false) & Corte em 0ms', () => {
    it('auth_is_active retorna false para usuário com ativo = false', () => {
      expect(auth_is_active(dbState, mockUsers.inativo.id)).toBe(false);
      expect(auth_is_admin(dbState, mockUsers.inativo.id)).toBe(false);
      expect(auth_is_global(dbState, mockUsers.inativo.id)).toBe(false);
    });

    it('corta em 0ms o acesso de leitura retornando conjunto vazio para todas as tabelas', async () => {
      const inativoClient = createRlsClient(dbState, { id: mockUsers.inativo.id, email: mockUsers.inativo.email });

      for (const table of ALL_PUBLIC_TABLES) {
        const { data, error } = await inativoClient.from(table).select('*');
        expect(error).toBeNull();
        expect(data).toEqual([]); // Zero linhas vazadas
      }
    });

    it('corta em 0ms o acesso de escrita (INSERT, UPDATE, DELETE) para usuário inativo', async () => {
      const inativoClient = createRlsClient(dbState, { id: mockUsers.inativo.id, email: mockUsers.inativo.email });

      const insertRes = await inativoClient.from('justificativas').insert({
        matricula: '1001',
        data: '2026-10-03',
        motivo: 'Inativo tentando gravar'
      });
      expect(insertRes.error).not.toBeNull();
      expect(insertRes.error.message).toContain('violates row-level security policy');

      const updateRes = await inativoClient.from('profiles').update({ nome: 'Inativo' }).eq('id', mockUsers.inativo.id);
      expect(updateRes.error).not.toBeNull();
      expect(updateRes.error.message).toContain('violates row-level security policy');
    });

    it('desativação dinâmica: revoga o acesso imediatamente quando ativo muda para false', async () => {
      const prepostoContext = { id: mockUsers.preposto.id, email: mockUsers.preposto.email };
      const client = createRlsClient(dbState, prepostoContext);

      // 1. Enquanto ativo, lê apontamentos de suas plataformas
      const beforeRes = await client.from('apontamentos_hh').select('*');
      expect(beforeRes.error).toBeNull();
      expect(beforeRes.data.length).toBeGreaterThan(0);

      // 2. Administrador desativa o usuário no profiles
      const prof = dbState.tables.profiles.find((p: any) => p.id === mockUsers.preposto.id);
      prof.ativo = false;

      // 3. No mesmo instante (0ms), auth_is_active é false e SELECT retorna vazio
      expect(auth_is_active(dbState, mockUsers.preposto.id)).toBe(false);
      const afterRes = await client.from('apontamentos_hh').select('*');
      expect(afterRes.error).toBeNull();
      expect(afterRes.data).toEqual([]);
    });
  });

  // ============================================================================
  // DIRETRIZ 3: Isolamento de Escopo Local (`preposto` e `controlador`)
  // ============================================================================
  describe('3. Isolamento de Escopo Local (preposto e controlador)', () => {
    it('valida que o preposto possui estritamente as plataformas P50 e P74', () => {
      const allowedPlats = auth_allowed_platforms(dbState, mockUsers.preposto.id);
      expect(allowedPlats).toEqual(expect.arrayContaining(['P50', 'P74']));
      expect(allowedPlats).not.toContain('P25');
      expect(allowedPlats).not.toContain('P58');
    });

    it('preposto SÓ PODE LER carteira_embarques das suas plataformas (P50 e P74)', async () => {
      const client = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const { data, error } = await client.from('carteira_embarques').select('*');

      expect(error).toBeNull();
      expect(data.length).toBeGreaterThan(0);

      // Todas as linhas retornadas devem ser apenas de P50 ou P74
      for (const row of data) {
        expect(['P50', 'P74']).toContain(row.plataforma_sigla);
        expect(row.plataforma_sigla).not.toBe('P25');
      }
    });

    it('preposto SÓ PODE LER apontamentos_hh das suas plataformas (P50 e P74)', async () => {
      const client = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const { data, error } = await client.from('apontamentos_hh').select('*');

      expect(error).toBeNull();
      expect(data.length).toBeGreaterThan(0);

      for (const row of data) {
        expect(['P50', 'P74']).toContain(row.plataforma_sigla);
        expect(row.plataforma_sigla).not.toBe('P25');
      }
    });

    it('controlador vinculado à P25 e UN-BC NÃO VÊ dados da P50 ou P74', async () => {
      const client = createRlsClient(dbState, { id: mockUsers.controlador.id, email: mockUsers.controlador.email });

      const allowedPlats = auth_allowed_platforms(dbState, mockUsers.controlador.id);
      expect(allowedPlats).toContain('P25');
      expect(allowedPlats).not.toContain('P50');
      expect(allowedPlats).not.toContain('P74');

      const { data: cartData } = await client.from('carteira_embarques').select('*');
      for (const row of cartData) {
        expect(row.plataforma_sigla).toBe('P25');
        expect(row.plataforma_sigla).not.toBe('P50');
        expect(row.plataforma_sigla).not.toBe('P74');
      }
    });

    it('preposto e controlador NÃO PODEM inserir ou alterar carteira_embarques (escopo global)', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const res = await prepostoClient.from('carteira_embarques').insert({
        matricula: '1001',
        plataforma_sigla: 'P50',
        unidade_negocio: 'Espírito Santo (UN-ES)',
        data_inicio: '2026-11-01',
        data_fim: '2026-11-14',
        operacao: 'OP-NOVA'
      });
      expect(res.error).not.toBeNull();
      expect(res.error.message).toContain('restrita a perfis globais');
    });
  });

  // ============================================================================
  // DIRETRIZ 4: Isolamento de Dados Sensíveis da Administração
  // ============================================================================
  describe('4. Isolamento de Dados Sensíveis da Administração (configuracoes_notificacao & fluxo_importacoes)', () => {
    it('tabela configuracoes_notificacao (emails_resumo executivos): preposto e controlador têm ZERO ACESSO (0 linhas)', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const selPreposto = await prepostoClient.from('configuracoes_notificacao').select('*');
      expect(selPreposto.error).toBeNull();
      expect(selPreposto.data).toEqual([]); // Invisível

      const insPreposto = await prepostoClient.from('configuracoes_notificacao').insert({
        id: 'hack',
        emails_resumo: ['hacker@teste.com']
      });
      expect(insPreposto.error).not.toBeNull();
      expect(insPreposto.error.message).toContain('restrita a perfis globais');

      const controladorClient = createRlsClient(dbState, { id: mockUsers.controlador.id, email: mockUsers.controlador.email });
      const selCtrl = await controladorClient.from('configuracoes_notificacao').select('*');
      expect(selCtrl.error).toBeNull();
      expect(selCtrl.data).toEqual([]);
    });

    it('tabela configuracoes_notificacao: admin e gestor TÊM ACESSO total', async () => {
      const gestorClient = createRlsClient(dbState, { id: mockUsers.gestor.id, email: mockUsers.gestor.email });
      const selGestor = await gestorClient.from('configuracoes_notificacao').select('*');
      expect(selGestor.error).toBeNull();
      expect(selGestor.data.length).toBeGreaterThan(0);
      expect(selGestor.data[0].emails_resumo).toContain('gestor.teste@empresa.com.br');

      const adminClient = createRlsClient(dbState, { id: mockUsers.admin.id, email: mockUsers.admin.email });
      const updAdmin = await adminClient
        .from('configuracoes_notificacao')
        .update({ emails_resumo: ['diretoria@empresa.com.br'] })
        .eq('id', 'geral');
      expect(updAdmin.error).toBeNull();
    });

    it('tabela fluxo_importacoes: prepostos e controladores NÃO TÊM ACESSO à leitura ou gravação', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const selFluxo = await prepostoClient.from('fluxo_importacoes').select('*');
      expect(selFluxo.error).toBeNull();
      expect(selFluxo.data).toEqual([]); // 0 linhas

      const insFluxo = await prepostoClient.from('fluxo_importacoes').insert({
        tipo_fluxo: 'hh',
        total_linhas: 99
      });
      expect(insFluxo.error).not.toBeNull();
      expect(insFluxo.error.message).toContain('restrita a perfis globais');
    });

    it('tabela fluxo_importacoes: admin e gestor TÊM ACESSO para leitura e escrita', async () => {
      const gestorClient = createRlsClient(dbState, { id: mockUsers.gestor.id, email: mockUsers.gestor.email });
      const selFluxo = await gestorClient.from('fluxo_importacoes').select('*');
      expect(selFluxo.error).toBeNull();
      expect(selFluxo.data.length).toBeGreaterThan(0);

      const insFluxo = await gestorClient.from('fluxo_importacoes').insert({
        id: 'fluxo-002',
        tipo_fluxo: 'hh',
        origem: 'teste gestor',
        total_linhas: 10
      });
      expect(insFluxo.error).toBeNull();
    });
  });

  // ============================================================================
  // DIRETRIZ 5: Segurança de Justificativas (`justificativas`)
  // ============================================================================
  describe('5. Segurança de Justificativas (justificativas)', () => {
    beforeEach(() => {
      // Adiciona apontamento na P25 para testar segregação de justificativa
      dbState.tables.apontamentos_hh.push({
        id: 'hh-p25',
        matricula: '1003',
        data: '2026-10-10',
        plataforma_sigla: 'P25',
        unidade_negocio: 'Bacia de Campos (UN-BC)',
        horas_executadas: 0
      });

      // Justificativa na P25
      dbState.tables.justificativas.push({
        id: 'jus-p25',
        matricula: '1003',
        data: '2026-10-10',
        motivo: 'Manutenção P25',
        horas_gangway: 12,
        responsavel_nome: 'Controlador Teste',
        criado_por: mockUsers.controlador.id,
        criado_em: '2026-10-10T10:00:00Z',
        updated_by: null,
        updated_at: '2026-10-10T10:00:00Z'
      });
    });

    it('função auth_can_access_justificativa valida corretamente pertencimento à plataforma', () => {
      // Matrícula 1001 em 2026-10-03 está na P50 (pertence ao preposto)
      expect(auth_can_access_justificativa(dbState, mockUsers.preposto.id, '1001', '2026-10-03')).toBe(true);

      // Matrícula 1003 em 2026-10-10 está na P25 (NÃO pertence ao preposto)
      expect(auth_can_access_justificativa(dbState, mockUsers.preposto.id, '1003', '2026-10-10')).toBe(false);

      // Mas pertence ao controlador da P25
      expect(auth_can_access_justificativa(dbState, mockUsers.controlador.id, '1003', '2026-10-10')).toBe(true);
    });

    it('preposto só lê justificativas das suas plataformas (P50)', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const { data, error } = await prepostoClient.from('justificativas').select('*');

      expect(error).toBeNull();
      expect(data.some((j: any) => j.id === 'jus-001')).toBe(true);
      // Justificativa da P25 não deve aparecer
      expect(data.some((j: any) => j.id === 'jus-p25')).toBe(false);
    });

    it('preposto pode inserir justificativa para técnico de sua plataforma (P50 / P74)', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const res = await prepostoClient.from('justificativas').insert({
        id: 'jus-nova-p50',
        matricula: '1001',
        data: '2026-10-01', // Data com apontamento na P50
        motivo: 'Parada operacional autorizada',
        horas_gangway: 12
      });

      expect(res.error).toBeNull();
      expect(res.data).toBeDefined();
    });

    it('preposto é terminantemente REJEITADO ao tentar inserir justificativa para plataforma alheia (P25)', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const res = await prepostoClient.from('justificativas').insert({
        id: 'jus-invasao-p25',
        matricula: '1003', // Técnico na P25
        data: '2026-10-10',
        motivo: 'Tentativa indevida de preposto em plataforma alheia',
        horas_gangway: 12
      });

      expect(res.error).not.toBeNull();
      expect(res.error.message).toContain('Preposto não tem permissão para inserir justificativa fora de suas plataformas');
    });

    it('preposto é REJEITADO ao tentar alterar justificativa de plataforma alheia (P25)', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const res = await prepostoClient
        .from('justificativas')
        .update({ motivo: 'Adulteração maliciosa' })
        .eq('id', 'jus-p25');

      // Não localiza a linha pelo SELECT RLS (retorna vazio e não altera)
      expect(res.data).toEqual([]);
      const original = dbState.tables.justificativas.find((j: any) => j.id === 'jus-p25');
      expect(original.motivo).toBe('Manutenção P25');
    });

    it('preposto é REJEITADO ao tentar excluir qualquer justificativa (DELETE restrito a perfis globais)', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const delRes = await prepostoClient.from('justificativas').delete().eq('id', 'jus-001');

      expect(delRes.error).not.toBeNull();
      expect(delRes.error.message).toContain('restrita a perfis globais');
    });
  });

  // ============================================================================
  // DIRETRIZ 6: Segurança de Onboarding e Preferências (`user_onboarding`)
  // ============================================================================
  describe('6. Segurança de Onboarding e Preferências (user_onboarding)', () => {
    it('usuário só pode ler seu próprio registro de onboarding (ou admin/gestor vê todos)', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const { data, error } = await prepostoClient.from('user_onboarding').select('*');

      expect(error).toBeNull();
      expect(data.length).toBe(1);
      expect(data[0].user_id).toBe(mockUsers.preposto.id);
      expect(data.some((o: any) => o.user_id === mockUsers.admin.id)).toBe(false);

      // Admin e Gestor (global) lêem todos os onboardings para acompanhamento
      const gestorClient = createRlsClient(dbState, { id: mockUsers.gestor.id, email: mockUsers.gestor.email });
      const { data: gestorData } = await gestorClient.from('user_onboarding').select('*');
      expect(gestorData.length).toBeGreaterThanOrEqual(3);
    });

    it('usuário pode atualizar com sucesso seu próprio registro de onboarding', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const res = await prepostoClient
        .from('user_onboarding')
        .update({
          preferencias: { themeMode: 'dark', density: 'compact' }
        })
        .eq('user_id', mockUsers.preposto.id);

      expect(res.error).toBeNull();
      const updated = dbState.tables.user_onboarding.find((o: any) => o.user_id === mockUsers.preposto.id);
      expect(updated.preferencias.themeMode).toBe('dark');
    });

    it('tentativa de atualizar registro de onboarding de OUTRO usuário é bloqueada para não-administradores', async () => {
      // Preposto tentando atualizar o onboarding do Administrador
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const res = await prepostoClient
        .from('user_onboarding')
        .update({
          obriga_troca_senha: false
        })
        .eq('user_id', mockUsers.admin.id);

      // Pelo filtro RLS do SELECT o preposto nem enxerga o onboarding do admin (retorna vazio)
      expect(res.data).toEqual([]);

      // E se avaliado diretamente pelo evaluateRlsUpdate com a linha do admin
      const adminRow = dbState.tables.user_onboarding.find((o: any) => o.user_id === mockUsers.admin.id);
      const evalRes = evaluateRlsUpdate('user_onboarding', adminRow, { obriga_troca_senha: false }, dbState, mockUsers.preposto.id);
      expect(evalRes.allowed).toBe(false);
      expect(evalRes.reason).toContain('Apenas o próprio usuário ou admin');
    });

    it('gestor NÃO pode alterar onboarding de outro usuário (apenas o próprio usuário ou admin)', () => {
      const prepostoRow = dbState.tables.user_onboarding.find((o: any) => o.user_id === mockUsers.preposto.id);
      const evalRes = evaluateRlsUpdate('user_onboarding', prepostoRow, { obriga_troca_senha: false }, dbState, mockUsers.gestor.id);
      expect(evalRes.allowed).toBe(false);
      expect(evalRes.reason).toContain('Apenas o próprio usuário ou admin');
    });

    it('administrador PODE atualizar onboarding de qualquer usuário (ex: forçar redefinição de senha)', async () => {
      const adminClient = createRlsClient(dbState, { id: mockUsers.admin.id, email: mockUsers.admin.email });
      const res = await adminClient
        .from('user_onboarding')
        .update({
          obriga_troca_senha: true
        })
        .eq('user_id', mockUsers.preposto.id);

      expect(res.error).toBeNull();
      const prepostoOnb = dbState.tables.user_onboarding.find((o: any) => o.user_id === mockUsers.preposto.id);
      expect(prepostoOnb.obriga_troca_senha).toBe(true);
    });

    it('apenas administrador pode excluir registros de user_onboarding', () => {
      const row = dbState.tables.user_onboarding[0];
      expect(evaluateRlsDelete('user_onboarding', row, dbState, mockUsers.preposto.id).allowed).toBe(false);
      expect(evaluateRlsDelete('user_onboarding', row, dbState, mockUsers.gestor.id).allowed).toBe(false);
      expect(evaluateRlsDelete('user_onboarding', row, dbState, mockUsers.admin.id).allowed).toBe(true);
    });
  });

  // ============================================================================
  // Testes Adicionais das Tabelas Restantes (profiles, pessoas, tecnicos, config)
  // ============================================================================
  describe('7. Regras RLS Complementares das Demais Tabelas', () => {
    it('profiles: preposto só pode ver a si mesmo; admin e gestor vêem todos', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const { data } = await prepostoClient.from('profiles').select('*');
      expect(data.length).toBe(1);
      expect(data[0].id).toBe(mockUsers.preposto.id);

      const gestorClient = createRlsClient(dbState, { id: mockUsers.gestor.id, email: mockUsers.gestor.email });
      const { data: gData } = await gestorClient.from('profiles').select('*');
      expect(gData.length).toBeGreaterThanOrEqual(4);
    });

    it('profiles: escrita direta (INSERT/UPDATE/DELETE) permitida apenas para admin', () => {
      const profileRow = dbState.tables.profiles[0];
      expect(evaluateRlsInsert('profiles', { id: 'new-u' }, dbState, mockUsers.gestor.id).allowed).toBe(false);
      expect(evaluateRlsInsert('profiles', { id: 'new-u' }, dbState, mockUsers.admin.id).allowed).toBe(true);

      expect(evaluateRlsUpdate('profiles', profileRow, { nome: 'X' }, dbState, mockUsers.gestor.id).allowed).toBe(false);
      expect(evaluateRlsUpdate('profiles', profileRow, { nome: 'X' }, dbState, mockUsers.admin.id).allowed).toBe(true);
    });

    it('tecnicos: qualquer usuário ativo pode consultar, mas escrita é exclusiva de admin/gestor', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const selTec = await prepostoClient.from('tecnicos').select('*');
      expect(selTec.error).toBeNull();
      expect(selTec.data.length).toBeGreaterThan(0);

      const insTec = await prepostoClient.from('tecnicos').insert({
        matricula: '9999',
        nome: 'Tecnico Teste',
        funcao: 'Soldador'
      });
      expect(insTec.error).not.toBeNull();
      expect(insTec.error.message).toContain('restrita a perfis globais');
    });

    it('sync_heartbeat: leitura aberta a qualquer autenticado ativo, escrita restrita a admin/gestor', async () => {
      const prepostoClient = createRlsClient(dbState, { id: mockUsers.preposto.id, email: mockUsers.preposto.email });
      const selHeart = await prepostoClient.from('sync_heartbeat').select('*');
      expect(selHeart.error).toBeNull();
      expect(selHeart.data.length).toBe(1);

      const updHeart = await prepostoClient.from('sync_heartbeat').update({ updated_at: new Date().toISOString() });
      expect(updHeart.error).not.toBeNull();
      expect(updHeart.error.message).toContain('restrita a perfis globais');
    });
  });
});
