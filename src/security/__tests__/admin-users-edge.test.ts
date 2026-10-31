// ==============================================================================
// Suíte de Testes de Segurança: Supabase Edge Function 'admin-users'
// Validação Estrita de RBAC, Anti-Lockout, Anti-Elevação e Rollback Compensatório
// GARANTIA: 100% isolado, zero chamadas de rede para ambiente de produção
// ==============================================================================

import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

// Tipagem dos perfis da Edge Function
interface CallerProfile {
  id: string;
  email: string;
  nome: string;
  role: 'admin' | 'gestor' | 'controlador' | 'preposto';
  ativo: boolean;
}

// Estado em memória do Supabase Admin
interface MockAdminState {
  users: Record<string, { id: string; email: string; password?: string; user_metadata?: any }>;
  tokens: Record<string, string>; // jwt -> userId
  tables: Record<string, Record<string, any>>;
  deletedUserIds: string[];
  updatedUsers: Record<string, any>;
  forceSqlInsertError: boolean;
}

let state: MockAdminState;

function createFreshState(): MockAdminState {
  return {
    users: {
      'usr-admin-1': { id: 'usr-admin-1', email: 'admin1@empresa.com.br' },
      'usr-admin-2': { id: 'usr-admin-2', email: 'admin2@empresa.com.br' },
      'usr-gestor': { id: 'usr-gestor', email: 'gestor@empresa.com.br' },
      'usr-controlador': { id: 'usr-controlador', email: 'controlador@empresa.com.br' },
      'usr-preposto': { id: 'usr-preposto', email: 'preposto@empresa.com.br' },
      'usr-inativo': { id: 'usr-inativo', email: 'inativo@empresa.com.br' }
    },
    tokens: {
      'jwt-admin-1': 'usr-admin-1',
      'jwt-admin-2': 'usr-admin-2',
      'jwt-gestor': 'usr-gestor',
      'jwt-controlador': 'usr-controlador',
      'jwt-preposto': 'usr-preposto',
      'jwt-inativo': 'usr-inativo'
    },
    tables: {
      profiles: {
        'usr-admin-1': {
          id: 'usr-admin-1',
          email: 'admin1@empresa.com.br',
          nome: 'Admin Primário',
          role: 'admin',
          ativo: true
        },
        'usr-admin-2': {
          id: 'usr-admin-2',
          email: 'admin2@empresa.com.br',
          nome: 'Admin Secundário',
          role: 'admin',
          ativo: true
        },
        'usr-gestor': {
          id: 'usr-gestor',
          email: 'gestor@empresa.com.br',
          nome: 'Gestor Operacional',
          role: 'gestor',
          ativo: true
        },
        'usr-controlador': {
          id: 'usr-controlador',
          email: 'controlador@empresa.com.br',
          nome: 'Controlador Medição',
          role: 'controlador',
          ativo: true
        },
        'usr-preposto': {
          id: 'usr-preposto',
          email: 'preposto@empresa.com.br',
          nome: 'Preposto Embarque',
          role: 'preposto',
          ativo: true
        },
        'usr-inativo': {
          id: 'usr-inativo',
          email: 'inativo@empresa.com.br',
          nome: 'Usuário Desativado',
          role: 'preposto',
          ativo: false
        }
      },
      user_onboarding: {
        'usr-preposto': {
          user_id: 'usr-preposto',
          primeiro_login: true,
          obriga_troca_senha: true
        }
      },
      pessoas: {},
      pessoa_plataformas: {},
      pessoa_unidades: {}
    },
    deletedUserIds: [],
    updatedUsers: {},
    forceSqlInsertError: false
  };
}

class MockTableQuery {
  private tableName: string;
  private filters: Array<(row: any) => boolean> = [];
  private isCountExact = false;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count === 'exact' && opts?.head) {
      this.isCountExact = true;
    }
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push(row => row && row[col] === val);
    return this;
  }

  private getRows(): any[] {
    const tableDict = (state.tables[this.tableName] ||= {});
    const all = Object.values(tableDict);
    if (this.filters.length === 0) return all;
    return all.filter(r => this.filters.every(fn => fn(r)));
  }

  async single() {
    const rows = this.getRows();
    if (rows.length === 0) {
      return { data: null, error: new Error(`Row not found in ${this.tableName}`) };
    }
    return { data: rows[0], error: null };
  }

  async maybeSingle() {
    const rows = this.getRows();
    return { data: rows[0] || null, error: null };
  }

  insert(values: any | any[]) {
    if (this.tableName === 'profiles' && state.forceSqlInsertError) {
      const err = new Error('Postgres foreign key / constraint violation (simulated)');
      return {
        select: () => ({
          single: async () => ({ data: null, error: err }),
          maybeSingle: async () => ({ data: null, error: err })
        }),
        then: (resolve: any) => resolve({ data: null, error: err })
      };
    }

    const items = Array.isArray(values) ? values : [values];
    const tableDict = (state.tables[this.tableName] ||= {});
    const inserted: any[] = [];

    for (const item of items) {
      const id = item.id || item.user_id || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const saved = { id, ...item };
      tableDict[id] = saved;
      inserted.push(saved);
    }

    const res = { data: inserted, error: null };
    return {
      select: () => ({
        single: async () => ({ data: inserted[0], error: null }),
        maybeSingle: async () => ({ data: inserted[0] || null, error: null })
      }),
      then: (resolve: any) => resolve(res)
    };
  }

  update(values: any) {
    const execute = () => {
      const rows = this.getRows();
      for (const row of rows) {
        Object.assign(row, values);
      }
      return { data: rows, error: null };
    };

    return {
      eq: (col: string, val: any) => {
        this.eq(col, val);
        const res = execute();
        return {
          select: () => ({
            then: (resolve: any) => resolve({ data: res.data, error: null })
          }),
          then: (resolve: any) => resolve(res)
        };
      }
    };
  }

  upsert(values: any | any[], _opts?: any) {
    const items = Array.isArray(values) ? values : [values];
    const tableDict = (state.tables[this.tableName] ||= {});
    for (const item of items) {
      const key = item.user_id || item.id || `up-${Date.now()}`;
      tableDict[key] = { ...(tableDict[key] || {}), ...item };
    }
    const res = { data: items, error: null };
    return {
      select: () => ({
        then: (resolve: any) => resolve(res)
      }),
      then: (resolve: any) => resolve(res)
    };
  }

  delete() {
    return {
      eq: (col: string, val: any) => {
        this.eq(col, val);
        const tableDict = (state.tables[this.tableName] ||= {});
        for (const [k, v] of Object.entries(tableDict)) {
          if (v && (v as any)[col] === val) {
            delete tableDict[k];
          }
        }
        return {
          then: (resolve: any) => resolve({ error: null })
        };
      }
    };
  }

  then(resolve: any) {
    if (this.isCountExact) {
      const rows = this.getRows();
      resolve({ count: rows.length, data: null, error: null });
    } else {
      const rows = this.getRows();
      resolve({ count: rows.length, data: rows, error: null });
    }
  }
}

function buildMockSupabaseAdmin() {
  return {
    auth: {
      getUser: async (jwt: string) => {
        const userId = state.tokens[jwt];
        if (!userId || !state.users[userId]) {
          return { data: { user: null }, error: new Error('Invalid JWT or expired session') };
        }
        return { data: { user: state.users[userId] }, error: null };
      },
      admin: {
        createUser: async (payload: any) => {
          const newId = `new-user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          state.users[newId] = {
            id: newId,
            email: payload.email,
            password: payload.password,
            user_metadata: payload.user_metadata
          };
          return { data: { user: state.users[newId] }, error: null };
        },
        deleteUser: async (userId: string) => {
          state.deletedUserIds.push(userId);
          delete state.users[userId];
          if (state.tables.profiles) delete state.tables.profiles[userId];
          return { error: null };
        },
        updateUserById: async (userId: string, updates: any) => {
          state.updatedUsers[userId] = {
            ...(state.updatedUsers[userId] || {}),
            ...updates
          };
          if (state.users[userId]) {
            if (updates.password) state.users[userId].password = updates.password;
            if (updates.user_metadata) state.users[userId].user_metadata = updates.user_metadata;
          }
          return { data: { user: state.users[userId] }, error: null };
        }
      }
    },
    from: (table: string) => new MockTableQuery(table)
  };
}

let edgeHandler: ((req: Request) => Promise<Response>) | null = null;

// Mock do supabase client para Deno
vi.mock('npm:@supabase/supabase-js@2', () => ({
  createClient: () => buildMockSupabaseAdmin(),
  default: { createClient: () => buildMockSupabaseAdmin() }
}));

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: {
      get: (key: string) => {
        if (key === 'SUPABASE_URL') return 'https://mock.supabase.co';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'mock-service-role-key';
        return undefined;
      }
    },
    serve: (handler: (req: Request) => Promise<Response>) => {
      edgeHandler = handler;
    }
  };

  // Carrega a Edge Function real sob teste
  await import('../../../supabase/functions/admin-users/index');
});

// Helper para invocar a Edge Function com uma requisição Web padrão
async function callEdge(
  body: any,
  options: {
    jwt?: string;
    method?: string;
    origin?: string;
    skipAuth?: boolean;
  } = {}
): Promise<{ status: number; body: any; headers: Headers }> {
  if (!edgeHandler) throw new Error('Edge Handler não inicializado');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: options.origin || 'http://localhost:5173'
  };

  if (!options.skipAuth) {
    headers['Authorization'] = `Bearer ${options.jwt || 'jwt-admin-1'}`;
  }

  const method = options.method || 'POST';
  const isBodyless = ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

  const req = new Request('https://mock.supabase.co/functions/v1/admin-users', {
    method,
    headers,
    body: isBodyless ? undefined : JSON.stringify(body)
  });

  const res = await edgeHandler(req);
  const json = res.status !== 200 || res.headers.get('content-type')?.includes('application/json')
    ? await res.json().catch(() => null)
    : null;

  return {
    status: res.status,
    body: json,
    headers: res.headers
  };
}

describe('Segurança & Anti-Lockout: Edge Function admin-users', () => {
  beforeEach(() => {
    state = createFreshState();
  });

  // ----------------------------------------------------------------------------
  // 1. REJEIÇÃO SEM TOKEN JWT & AUTENTICAÇÃO BÁSICA
  // ----------------------------------------------------------------------------
  describe('1. Rejeição sem Token JWT & Sessão Inválida', () => {
    it('Requisição sem header Authorization retorna 401 Unauthorized', async () => {
      const res = await callEdge({ action: 'create' }, { skipAuth: true });
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Token de autorização não fornecido.');
    });

    it('Requisição com token expirado ou inválido retorna 401 Unauthorized', async () => {
      const res = await callEdge({ action: 'create' }, { jwt: 'jwt-inexistente-ou-expirado' });
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Sessão inválida ou expirada. Faça login novamente.');
    });

    it('Requisição cujo perfil não existe no banco retorna 403 Forbidden', async () => {
      state.users['usr-sem-perfil'] = { id: 'usr-sem-perfil', email: 'orfa@empresa.com.br' };
      state.tokens['jwt-sem-perfil'] = 'usr-sem-perfil';

      const res = await callEdge({ action: 'create' }, { jwt: 'jwt-sem-perfil' });
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Perfil do usuário não encontrado no sistema.');
    });
  });

  // ----------------------------------------------------------------------------
  // 2. REJEIÇÃO DE USUÁRIO DESATIVADO
  // ----------------------------------------------------------------------------
  describe('2. Rejeição de Usuário Desativado (ativo = false)', () => {
    it('Solicitante com ativo = false retorna 403 Forbidden com mensagem de bloqueio', async () => {
      const res = await callEdge({ action: 'create' }, { jwt: 'jwt-inativo' });
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Seu acesso foi desativado pela administração.');
    });
  });

  // ----------------------------------------------------------------------------
  // 3. CONTROLE DE AUTORIZAÇÃO DE PAPEL (RBAC DA EDGE FUNCTION)
  // ----------------------------------------------------------------------------
  describe('3. Controle Estrito de Autorização de Papel', () => {
    it('Invocação por "preposto" retorna 403 Forbidden', async () => {
      const res = await callEdge({ action: 'create' }, { jwt: 'jwt-preposto' });
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Apenas Administradores e Gestores podem gerenciar acessos.');
    });

    it('Invocação por "controlador" retorna 403 Forbidden', async () => {
      const res = await callEdge({ action: 'create' }, { jwt: 'jwt-controlador' });
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Apenas Administradores e Gestores podem gerenciar acessos.');
    });

    it('Invocação por "gestor" é autorizada para gerenciamento operacional', async () => {
      const res = await callEdge(
        {
          action: 'create',
          email: 'novo.operador@empresa.com.br',
          nome: 'Operador Teste',
          password: 'SenhaForte123!',
          role: 'preposto'
        },
        { jwt: 'jwt-gestor' }
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.userId).toBeDefined();
    });
  });

  // ----------------------------------------------------------------------------
  // 4. ANTI-ELEVAÇÃO DE PRIVILÉGIOS (GESTOR NÃO PODE CRIAR OU PROMOVER ADMIN)
  // ----------------------------------------------------------------------------
  describe('4. Anti-Elevação de Privilégio (Gestor vs Papel Administrador)', () => {
    it('Gestor tentando criar usuário com papel "admin" retorna 403 Forbidden', async () => {
      const res = await callEdge(
        {
          action: 'create',
          email: 'tentativa.admin@empresa.com.br',
          nome: 'Invasor Admin',
          password: 'SenhaForte123!',
          role: 'admin'
        },
        { jwt: 'jwt-gestor' }
      );

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Apenas Administradores podem criar novos Administradores.');
    });

    it('Gestor tentando promover outro usuário para "admin" retorna 403 Forbidden', async () => {
      const res = await callEdge(
        {
          action: 'update-role',
          userId: 'usr-preposto',
          role: 'admin'
        },
        { jwt: 'jwt-gestor' }
      );

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Apenas Administradores podem gerenciar o papel de Administrador.');
    });

    it('Gestor tentando alterar papel de um usuário que já é "admin" retorna 403 Forbidden', async () => {
      const res = await callEdge(
        {
          action: 'update-role',
          userId: 'usr-admin-2',
          role: 'gestor'
        },
        { jwt: 'jwt-gestor' }
      );

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Apenas Administradores podem gerenciar o papel de Administrador.');
    });

    it('Gestor tentando redefinir a senha de um "admin" retorna 403 Forbidden', async () => {
      const res = await callEdge(
        {
          action: 'reset-password',
          userId: 'usr-admin-1',
          newPassword: 'NovaSenhaSegura123!'
        },
        { jwt: 'jwt-gestor' }
      );

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Apenas Administradores podem redefinir a senha de outro Administrador.');
    });

    it('Gestor tentando desativar ou ativar um "admin" retorna 403 Forbidden', async () => {
      const res = await callEdge(
        {
          action: 'toggle-active',
          userId: 'usr-admin-2',
          ativo: false
        },
        { jwt: 'jwt-gestor' }
      );

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Apenas Administradores podem alterar a ativação de um Administrador.');
    });
  });

  // ----------------------------------------------------------------------------
  // 5. TRAVA ANTI-LOCKOUT 1: AUTO-REBAIXAMENTO DE ADMINISTRADOR
  // ----------------------------------------------------------------------------
  describe('5. Trava Anti-Lockout 1: Auto-Rebaixamento', () => {
    it('Administrador tentando rebaixar a si mesmo para outro papel retorna 400 Bad Request', async () => {
      const res = await callEdge(
        {
          action: 'update-role',
          userId: 'usr-admin-1', // O próprio solicitante
          role: 'gestor'
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Você não pode rebaixar seu próprio papel de Administrador.');
    });
  });

  // ----------------------------------------------------------------------------
  // 6. TRAVA ANTI-LOCKOUT 2: AUTO-DESATIVAÇÃO DE ADMINISTRADOR
  // ----------------------------------------------------------------------------
  describe('6. Trava Anti-Lockout 2: Auto-Desativação', () => {
    it('Administrador tentando desativar seu próprio acesso (ativo: false) retorna 400 Bad Request', async () => {
      const res = await callEdge(
        {
          action: 'toggle-active',
          userId: 'usr-admin-1', // O próprio solicitante
          ativo: false
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Você não pode desativar seu próprio acesso.');
    });
  });

  // ----------------------------------------------------------------------------
  // 7. TRAVA ANTI-LOCKOUT 3: PROTEÇÃO DO ÚLTIMO ADMINISTRADOR ATIVO
  // ----------------------------------------------------------------------------
  describe('7. Trava Anti-Lockout 3: Último Administrador Ativo', () => {
    it('Tentativa de auto-desativação do único admin bloqueia com 400', async () => {
      // Deixa apenas usr-admin-1 ativo
      delete state.tables.profiles['usr-admin-2'];

      const res = await callEdge(
        {
          action: 'toggle-active',
          userId: 'usr-admin-1',
          ativo: false
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Você não pode desativar seu próprio acesso.');
    });

    it('Com 2 admins ativos, admin 1 pode desativar admin 2 com sucesso', async () => {
      const res = await callEdge(
        {
          action: 'toggle-active',
          userId: 'usr-admin-2',
          ativo: false
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.message).toContain('desativado com sucesso');
      expect(state.tables.profiles['usr-admin-2'].ativo).toBe(false);
      expect(state.updatedUsers['usr-admin-2'].ban_duration).toBe('876000h');
    });

    it('Se restar apenas 1 admin ativo no sistema, desativar outro admin bloqueia com 400', async () => {
      // usr-admin-1 está ativo, usr-admin-2 já está inativo (ativo = false)
      state.tables.profiles['usr-admin-2'].ativo = false;

      // Se admin 1 tentar desativar usr-admin-2 (que já é admin, ativo: false), countActiveAdmins() retorna 1
      const res = await callEdge(
        {
          action: 'toggle-active',
          userId: 'usr-admin-2',
          ativo: false
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
    });

    it('Se restar apenas 1 admin ativo no sistema, rebaixar outro admin bloqueia com 400', async () => {
      // usr-admin-1 está ativo, usr-admin-2 já está inativo
      state.tables.profiles['usr-admin-2'].ativo = false;

      // Admin 1 tenta rebaixar usr-admin-2 para gestor. countActiveAdmins() é 1
      const res = await callEdge(
        {
          action: 'update-role',
          userId: 'usr-admin-2',
          role: 'gestor'
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
    });
  });

  // ----------------------------------------------------------------------------
  // 8. VALIDAÇÃO DE SENHA FORTE (MÍNIMO 8 CARACTERES)
  // ----------------------------------------------------------------------------
  describe('8. Validação de Senha Forte (mínimo 8 caracteres)', () => {
    it('Tentativa de criar usuário com senha menor que 8 caracteres retorna 400 Bad Request', async () => {
      const res = await callEdge(
        {
          action: 'create',
          email: 'fraca@empresa.com.br',
          nome: 'Senha Curta',
          password: '123',
          role: 'preposto'
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('A senha provisória deve conter no mínimo 8 caracteres.');
    });

    it('Tentativa de redefinir senha com menos de 8 caracteres retorna 400 Bad Request', async () => {
      const res = await callEdge(
        {
          action: 'reset-password',
          userId: 'usr-preposto',
          newPassword: 'curta'
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Usuário inválido ou nova senha com menos de 8 caracteres.');
    });
  });

  // ----------------------------------------------------------------------------
  // 9. FORÇAMENTO DE TROCA DE SENHA NO ONBOARDING
  // ----------------------------------------------------------------------------
  describe('9. Forçamento de Troca de Senha (user_onboarding)', () => {
    it('Ação reset-password atualiza senha no GoTrue e grava obriga_troca_senha = true', async () => {
      const res = await callEdge(
        {
          action: 'reset-password',
          userId: 'usr-preposto',
          newPassword: 'NovaSenhaForte2026!'
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.message).toContain('O usuário deverá trocá-la no próximo login.');

      // Verifica se a senha foi atualizada no auth.admin
      expect(state.updatedUsers['usr-preposto'].password).toBe('NovaSenhaForte2026!');

      // Verifica registro no user_onboarding
      expect(state.tables.user_onboarding['usr-preposto'].obriga_troca_senha).toBe(true);
    });

    it('Criação de novo usuário grava obriga_troca_senha = true e primeiro_login = true', async () => {
      const res = await callEdge(
        {
          action: 'create',
          email: 'novo.membro@empresa.com.br',
          nome: 'Novo Membro Equipe',
          password: 'SenhaProvisoria2026!',
          role: 'preposto'
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const newUserId = res.body.userId;
      expect(newUserId).toBeDefined();

      // Onboarding deve ser criado com flags obrigatórias
      const onb = state.tables.user_onboarding[newUserId];
      expect(onb).toBeDefined();
      expect(onb.primeiro_login).toBe(true);
      expect(onb.obriga_troca_senha).toBe(true);
    });
  });

  // ----------------------------------------------------------------------------
  // 10. ROLLBACK COMPENSATÓRIO (PREVENÇÃO DE CONTAS ÓRFÃS NO GOTRUE)
  // ----------------------------------------------------------------------------
  describe('10. Rollback Compensatório (Anti-Contas Órfãs)', () => {
    it('Falha no SQL pós-GoTrue aciona deleteUser no GoTrue e retorna 500', async () => {
      // Simula falha na persistência SQL pós-criação da credencial
      state.forceSqlInsertError = true;

      const res = await callEdge(
        {
          action: 'create',
          email: 'rollback.teste@empresa.com.br',
          nome: 'Teste Rollback',
          password: 'SenhaValida123!',
          role: 'preposto'
        },
        { jwt: 'jwt-admin-1' }
      );

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toContain('Erro ao vincular dados do usuário');

      // Garante que o rollback compensatório chamou deleteUser
      expect(state.deletedUserIds.length).toBe(1);
      const deletedId = state.deletedUserIds[0];
      expect(state.users[deletedId]).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------------------
  // 11. CORS E VALIDAÇÃO DE PROTOCOLO HTTP
  // ----------------------------------------------------------------------------
  describe('11. Validações de Protocolo HTTP, Ações e CORS', () => {
    it('Preflight OPTIONS retorna 200 com headers CORS permissivos para origens autorizadas', async () => {
      const res = await callEdge({}, { method: 'OPTIONS', origin: 'https://edisen12.github.io' });
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://edisen12.github.io');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('Método HTTP diferente de POST retorna 405 Method Not Allowed', async () => {
      const res = await callEdge({}, { method: 'GET' });
      expect(res.status).toBe(405);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toContain('Utilize POST');
    });

    it('Requisição sem parâmetro "action" retorna 400 Bad Request', async () => {
      const res = await callEdge({}, { jwt: 'jwt-admin-1' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Ação não especificada na requisição.');
    });

    it('Requisição com "action" desconhecida retorna 400 Bad Request', async () => {
      const res = await callEdge({ action: 'acao-maliciosa' }, { jwt: 'jwt-admin-1' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('Ação desconhecida: "acao-maliciosa".');
    });

    it('Ação "create" rejeita e-mail inválido ou sem arroba', async () => {
      const res = await callEdge(
        {
          action: 'create',
          email: 'email-invalido-sem-arroba',
          nome: 'Nome Valido',
          password: 'SenhaForte123!',
          role: 'preposto'
        },
        { jwt: 'jwt-admin-1' }
      );
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('E-mail inválido ou não informado.');
    });

    it('Ação "create" rejeita nome vazio', async () => {
      const res = await callEdge(
        {
          action: 'create',
          email: 'valido@empresa.com.br',
          nome: '   ',
          password: 'SenhaForte123!',
          role: 'preposto'
        },
        { jwt: 'jwt-admin-1' }
      );
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Nome completo obrigatório.');
    });
  });
});
