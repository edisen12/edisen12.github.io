// ==============================================================================
// Serviço de Autenticação, Onboarding de Primeiro Login e Gestão de Usuários
// Suporte a Sessão, Perfil RBAC, Escopo de Carteira, Preferências e Edge Function
// ==============================================================================

import { supabase } from './supabase';
import { DEFAULT_USER_PREFERENCES } from '../config/constants';
import type {
  UserProfile,
  Pessoa,
  SystemRole,
  PapelOperacional,
  UserOnboarding,
  UserPreferences
} from '../domain/types';

/**
 * Realiza autenticação via E-mail e Senha no Supabase Auth (GoTrue).
 */
export async function signInWithPassword(email: string, password: string) {
  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password
  });

  if (error) {
    let msg = error.message;
    if (msg.includes('Invalid login credentials')) {
      msg = 'E-mail ou senha incorretos.';
    } else if (msg.includes('Email not confirmed')) {
      msg = 'E-mail ainda não confirmado. Contate o administrador do contrato.';
    } else if (msg.includes('User is banned')) {
      msg = 'Seu acesso está inativo ou bloqueado pela administração.';
    }
    throw new Error(msg);
  }

  return data;
}

/**
 * Encerra a sessão ativa do usuário atual.
 */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Traduz erros comuns do GoTrue ao redefinir senha.
 */
function translatePasswordError(rawMsg: string): string {
  if (rawMsg.includes('should be different from the old password')) {
    return 'A nova senha deve ser diferente da senha atual/provisória.';
  }
  if (rawMsg.includes('Password should be at least')) {
    return 'A nova senha deve ter no mínimo 8 caracteres.';
  }
  return rawMsg || 'Erro ao alterar senha.';
}

/**
 * Permite ao usuário logado alterar sua própria senha e registra o carimbo de auditoria.
 */
export async function updateOwnPassword(newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('A nova senha deve ter no mínimo 8 caracteres.');
  }
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    throw new Error('A nova senha deve combinar letras e números para sua segurança.');
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword
  });

  if (error) {
    throw new Error(translatePasswordError(error.message));
  }

  // Atualiza user_onboarding (primeiro_login = false, obriga_troca_senha = false, senha_trocada_em = now())
  const { error: rpcError } = await supabase.rpc('complete_first_login_password_change');
  if (rpcError) {
    throw new Error(rpcError.message || 'Senha alterada, mas houve falha ao confirmar registro de primeiro acesso.');
  }
}

/**
 * Conclui a troca obrigatória de senha no primeiro login ou após reset administrativo.
 */
export async function completeFirstLoginPassword(newPassword: string): Promise<void> {
  await updateOwnPassword(newPassword);
}

/**
 * Atualiza o nome de exibição do próprio usuário (profiles + pessoas) e/ou suas preferências de UI.
 */
export async function saveOwnProfileAndPreferences(
  nome: string,
  preferencias?: UserPreferences
): Promise<void> {
  const { error } = await supabase.rpc('update_own_profile', {
    p_nome: nome.trim(),
    p_preferencias: preferencias ? JSON.parse(JSON.stringify(preferencias)) : undefined
  });

  if (error) {
    throw new Error(error.message || 'Erro ao salvar configurações do perfil.');
  }
}

/**
 * Carrega o perfil do usuário logado, seu estado de primeiro login/preferências e sua carteira (se houver).
 */
export async function fetchCurrentUserScope(): Promise<{
  profile: UserProfile;
  pessoa: Pessoa | null;
  onboarding: UserOnboarding;
} | null> {
  const { data: sessionData, error: sError } = await supabase.auth.getSession();
  if (sError || !sessionData?.session?.user) {
    return null;
  }

  const userId = sessionData.session.user.id;

  const [profileRes, pessoaRes, onbRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, nome, role, ativo')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('pessoas')
      .select(`
        id,
        slug,
        nome,
        papel,
        email,
        user_id,
        pessoa_plataformas (plataforma_sigla),
        pessoa_unidades (unidade_negocio)
      `)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('user_onboarding')
      .select('user_id, primeiro_login, obriga_troca_senha, senha_trocada_em, preferencias')
      .eq('user_id', userId)
      .maybeSingle()
  ]);

  const profileRow = profileRes.data;
  if (profileRes.error || !profileRow || !profileRow.ativo) {
    return null;
  }

  const profile: UserProfile = {
    id: profileRow.id,
    email: profileRow.email,
    nome: profileRow.nome,
    role: profileRow.role as SystemRole,
    ativo: profileRow.ativo
  };

  let pessoa: Pessoa | null = null;
  const pessoaRow = pessoaRes.data;

  if (pessoaRow) {
    const plats: string[] = Array.isArray(pessoaRow.pessoa_plataformas)
      ? pessoaRow.pessoa_plataformas.map((item: any) => String(item.plataforma_sigla || '')).filter(Boolean)
      : [];

    const uns: string[] = Array.isArray(pessoaRow.pessoa_unidades)
      ? pessoaRow.pessoa_unidades.map((item: any) => String(item.unidade_negocio || '')).filter(Boolean)
      : [];

    pessoa = {
      id: pessoaRow.id,
      slug: pessoaRow.slug,
      nome: pessoaRow.nome,
      papel: pessoaRow.papel as PapelOperacional,
      email: pessoaRow.email,
      user_id: pessoaRow.user_id,
      plats,
      uns
    };
  }

  let onboarding: UserOnboarding;
  const onbRow = onbRes.data;

  if (onbRow) {
    const rawPref = (onbRow.preferencias && typeof onbRow.preferencias === 'object')
      ? (onbRow.preferencias as Partial<UserPreferences>)
      : {};
    onboarding = {
      user_id: onbRow.user_id,
      primeiro_login: Boolean(onbRow.primeiro_login),
      obriga_troca_senha: Boolean(onbRow.obriga_troca_senha),
      senha_trocada_em: onbRow.senha_trocada_em || null,
      preferencias: {
        ...DEFAULT_USER_PREFERENCES,
        ...rawPref
      }
    };
  } else {
    // Caso não exista linha ainda, cria como primeiro login obrigatório
    await supabase.from('user_onboarding').upsert(
      {
        user_id: userId,
        primeiro_login: true,
        obriga_troca_senha: true
      },
      { onConflict: 'user_id' }
    );
    onboarding = {
      user_id: userId,
      primeiro_login: true,
      obriga_troca_senha: true,
      senha_trocada_em: null,
      preferencias: { ...DEFAULT_USER_PREFERENCES }
    };
  }

  return { profile, pessoa, onboarding };
}

/**
 * Invoca a Edge Function 'admin-users' com payload de administração (create, update-role, etc.).
 */
export async function adminManageUser(
  payload: Record<string, unknown>
): Promise<{ ok: boolean; userId?: string; message?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: payload
    });

    if (error) {
      let friendlyMsg = error.message;
      if (friendlyMsg.includes('Failed to send a request') || friendlyMsg.includes('FunctionsFetchError')) {
        friendlyMsg = 'Não foi possível conectar à Edge Function administrativa. Verifique sua rede.';
      }
      return { ok: false, message: friendlyMsg };
    }

    if (!data || data.ok === false) {
      return {
        ok: false,
        message: data?.message || 'Falha ao processar solicitação de usuário.'
      };
    }

    return {
      ok: true,
      userId: data.userId,
      message: data.message
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err.message || 'Erro inesperado na chamada administrativa.'
    };
  }
}
