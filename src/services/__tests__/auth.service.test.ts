import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mockUsers, mockProfiles, mockOnboardings } from '../../test/testFixtures';
import { resetMockDatabase } from '../../test/mockSupabase';

vi.mock('../supabase', async () => {
  const { createMockSupabaseClient } = await import('../../test/mockSupabase');
  return {
    supabase: createMockSupabaseClient()
  };
});

// Importa o cliente mockado via módulo
import { supabase } from '../supabase';

const mockClient = supabase as any;

// Importa o serviço DEPOIS de configurar o mock do supabase
import {
  signInWithPassword,
  signOut,
  updateOwnPassword,
  completeFirstLoginPassword,
  saveOwnProfileAndPreferences,
  fetchCurrentUserScope,
  adminManageUser
} from '../auth.service';

describe('Auth Service - Autenticação, Onboarding e Escopo (Testes de Integração Isolados)', () => {
  beforeEach(() => {
    resetMockDatabase(mockClient);
  });

  describe('1. signInWithPassword', () => {
    it('realiza autenticação com sucesso para credenciais válidas e limpa espaços/letras maiúsculas no e-mail', async () => {
      const authResult = await signInWithPassword('  ADMIN.TESTE@empresa.com.br  ', mockUsers.admin.password);
      expect(authResult).toBeDefined();
      expect(authResult.user).toBeDefined();
      expect(authResult.user?.email).toBe(mockUsers.admin.email);
      expect(authResult.session?.access_token).toBeDefined();
    });

    it('retorna mensagem amigável para senha ou e-mail incorretos', async () => {
      await expect(
        signInWithPassword(mockUsers.admin.email, 'SenhaErrada999!')
      ).rejects.toThrow('E-mail ou senha incorretos.');
    });

    it('retorna mensagem clara quando usuário está inativo ou bloqueado', async () => {
      await expect(
        signInWithPassword(mockUsers.inativo.email, mockUsers.inativo.password)
      ).rejects.toThrow('Seu acesso está inativo ou bloqueado pela administração.');
    });

    it('retorna mensagem clara quando o e-mail ainda não foi confirmado', async () => {
      // Simula retorno de email não confirmado temporariamente no cliente mock
      const originalSignIn = mockClient.auth.signInWithPassword;
      mockClient.auth.signInWithPassword = async () => ({
        data: { user: null, session: null } as any,
        error: new Error('Email not confirmed')
      });

      await expect(
        signInWithPassword('novo@empresa.com.br', 'Qualquer123!')
      ).rejects.toThrow('E-mail ainda não confirmado. Contate o administrador do contrato.');

      mockClient.auth.signInWithPassword = originalSignIn;
    });
  });

  describe('2. signOut', () => {
    it('encerra a sessão ativa com sucesso', async () => {
      await signInWithPassword(mockUsers.admin.email, mockUsers.admin.password);
      expect(mockClient.__mockState.currentUser).not.toBeNull();

      await signOut();
      expect(mockClient.__mockState.currentUser).toBeNull();
    });

    it('repassa erro se o Supabase Auth falhar ao deslogar', async () => {
      const originalSignOut = mockClient.auth.signOut;
      mockClient.auth.signOut = async () => ({ error: new Error('Falha de rede ao deslogar') as any });

      await expect(signOut()).rejects.toThrow('Falha de rede ao deslogar');

      mockClient.auth.signOut = originalSignOut;
    });
  });

  describe('3. updateOwnPassword & completeFirstLoginPassword', () => {
    beforeEach(async () => {
      // Faz login como preposto (que está em primeiro login)
      await signInWithPassword(mockUsers.preposto.email, mockUsers.preposto.password);
    });

    it('rejeita senhas com menos de 8 caracteres', async () => {
      await expect(updateOwnPassword('Abc1!')).rejects.toThrow(
        'A nova senha deve ter no mínimo 8 caracteres.'
      );
    });

    it('rejeita senhas que não combinam letras e números', async () => {
      await expect(updateOwnPassword('somenteletras')).rejects.toThrow(
        'A nova senha deve combinar letras e números para sua segurança.'
      );
      await expect(updateOwnPassword('1234567890')).rejects.toThrow(
        'A nova senha deve combinar letras e números para sua segurança.'
      );
    });

    it('atualiza senha com sucesso e chama RPC de conclusão de primeiro login', async () => {
      const novaSenha = 'NovaSenhaSegura2026!';
      await updateOwnPassword(novaSenha);

      // Verifica se o estado de onboarding do preposto foi atualizado
      const onb = mockClient.__mockState.tables.user_onboarding.find(
        (o: any) => o.user_id === mockUsers.preposto.id
      );
      expect(onb).toBeDefined();
      expect(onb?.primeiro_login).toBe(false);
      expect(onb?.obriga_troca_senha).toBe(false);
      expect(onb?.senha_trocada_em).not.toBeNull();

      // Verifica se a senha no authUsers foi alterada
      const authUser = mockClient.__mockState.authUsers.find((u: any) => u.id === mockUsers.preposto.id);
      expect(authUser?.password).toBe(novaSenha);
    });

    it('traduz erro de senha idêntica à provisória', async () => {
      const originalUpdate = mockClient.auth.updateUser;
      mockClient.auth.updateUser = async () => ({
        data: { user: null } as any,
        error: new Error('New password should be different from the old password') as any
      });

      await expect(updateOwnPassword('NovaSenha123!')).rejects.toThrow(
        'A nova senha deve ser diferente da senha atual/provisória.'
      );

      mockClient.auth.updateUser = originalUpdate;
    });

    it('traduz erro de tamanho vindo do provedor GoTrue', async () => {
      const originalUpdate = mockClient.auth.updateUser;
      mockClient.auth.updateUser = async () => ({
        data: { user: null } as any,
        error: new Error('Password should be at least 8 characters') as any
      });

      await expect(updateOwnPassword('Valida123!')).rejects.toThrow(
        'A nova senha deve ter no mínimo 8 caracteres.'
      );

      mockClient.auth.updateUser = originalUpdate;
    });

    it('completeFirstLoginPassword executa com sucesso o fluxo completo', async () => {
      await completeFirstLoginPassword('OutraSenhaForte2026!');
      const onb = mockClient.__mockState.tables.user_onboarding.find(
        (o: any) => o.user_id === mockUsers.preposto.id
      );
      expect(onb?.primeiro_login).toBe(false);
    });

    it('lança erro se a RPC de confirmação de senha falhar', async () => {
      mockClient.__mockState.rpcHandlers = {
        complete_first_login_password_change: () => ({
          data: null,
          error: new Error('Erro ao salvar no banco de dados')
        })
      };

      await expect(updateOwnPassword('NovaSenhaForte2026!')).rejects.toThrow(
        'Erro ao salvar no banco de dados'
      );
    });
  });

  describe('4. saveOwnProfileAndPreferences', () => {
    beforeEach(async () => {
      await signInWithPassword(mockUsers.admin.email, mockUsers.admin.password);
    });

    it('salva o nome do usuário e suas preferências via RPC update_own_profile', async () => {
      const novoNome = 'Administrador Atualizado';
      const novasPrefs = {
        themeMode: 'light' as const,
        density: 'compact' as const,
        defaultTab: 'med' as const,
        pageSize: 50 as const
      };

      await saveOwnProfileAndPreferences(novoNome, novasPrefs);

      const prof = mockClient.__mockState.tables.profiles.find((p: any) => p.id === mockUsers.admin.id);
      expect(prof?.nome).toBe(novoNome);

      const onb = mockClient.__mockState.tables.user_onboarding.find(
        (o: any) => o.user_id === mockUsers.admin.id
      );
      expect(onb?.preferencias.density).toBe('compact');
      expect(onb?.preferencias.defaultTab).toBe('med');
    });

    it('lança erro caso a RPC update_own_profile falhe', async () => {
      mockClient.__mockState.rpcHandlers = {
        update_own_profile: () => ({
          data: null,
          error: new Error('Falha de permissão no PostgreSQL')
        })
      };

      await expect(
        saveOwnProfileAndPreferences('Nome', {
          themeMode: 'dark',
          density: 'comfortable',
          defaultTab: 'ger',
          pageSize: 25
        })
      ).rejects.toThrow('Falha de permissão no PostgreSQL');
    });
  });

  describe('5. fetchCurrentUserScope', () => {
    it('retorna null se não houver usuário logado', async () => {
      await signOut();
      const scope = await fetchCurrentUserScope();
      expect(scope).toBeNull();
    });

    it('retorna null se o perfil do usuário logado estiver inativo', async () => {
      // Simula sessão com usuário inativo
      mockClient.__mockState.currentUser = {
        id: mockUsers.inativo.id,
        email: mockUsers.inativo.email
      };

      const scope = await fetchCurrentUserScope();
      expect(scope).toBeNull();
    });

    it('carrega com sucesso o escopo de um Preposto com plataformas vinculadas e onboarding de primeiro login', async () => {
      await signInWithPassword(mockUsers.preposto.email, mockUsers.preposto.password);

      const scope = await fetchCurrentUserScope();
      expect(scope).not.toBeNull();
      expect(scope?.profile.id).toBe(mockUsers.preposto.id);
      expect(scope?.profile.role).toBe('preposto');

      // Verifica resolução da pessoa e plataformas
      expect(scope?.pessoa).not.toBeNull();
      expect(scope?.pessoa?.nome).toBe(mockUsers.preposto.nome);
      expect(scope?.pessoa?.plats).toEqual(expect.arrayContaining(['P50', 'P74']));
      expect(scope?.pessoa?.uns).toEqual([]);

      // Verifica onboarding
      expect(scope?.onboarding.primeiro_login).toBe(true);
      expect(scope?.onboarding.obriga_troca_senha).toBe(true);
    });

    it('cria automaticamente onboarding com primeiro_login=true se a linha ainda não existir no banco', async () => {
      // Cria um novo usuário sem onboarding pré-existente
      const novoUserId = 'user-novo-999';
      mockClient.__mockState.tables.profiles.push({
        id: novoUserId,
        email: 'novo@empresa.com.br',
        nome: 'Novo Usuário',
        role: 'preposto',
        ativo: true
      });
      mockClient.__mockState.currentUser = {
        id: novoUserId,
        email: 'novo@empresa.com.br'
      };

      const scope = await fetchCurrentUserScope();
      expect(scope).not.toBeNull();
      expect(scope?.onboarding.primeiro_login).toBe(true);
      expect(scope?.onboarding.obriga_troca_senha).toBe(true);

      const criado = mockClient.__mockState.tables.user_onboarding.find(
        (o: any) => o.user_id === novoUserId
      );
      expect(criado).toBeDefined();
    });
  });

  describe('6. adminManageUser (Edge Function)', () => {
    it('executa chamada à Edge Function com sucesso', async () => {
      const res = await adminManageUser({
        action: 'create-user',
        email: 'colaborador@empresa.com.br',
        role: 'preposto'
      });

      expect(res.ok).toBe(true);
      expect(res.userId).toBeDefined();
    });

    it('retorna mensagem amigável em caso de falha de conexão com a Edge Function', async () => {
      const res = await adminManageUser({
        simulateError: true
      });

      expect(res.ok).toBe(false);
      expect(res.message).toBe(
        'Não foi possível conectar à Edge Function administrativa. Verifique sua rede.'
      );
    });

    it('retorna ok: false com mensagem personalizada quando a função rejeita a requisição', async () => {
      const res = await adminManageUser({
        simulateFail: true,
        message: 'E-mail corporativo já cadastrado.'
      });

      expect(res.ok).toBe(false);
      expect(res.message).toBe('E-mail corporativo já cadastrado.');
    });
  });
});
