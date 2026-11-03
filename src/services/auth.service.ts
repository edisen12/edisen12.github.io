// ==============================================================================
// Serviço de Autenticação (Fachada Agnóstica de Topologia)
// Delega as operações de sessão e RBAC para a porta ativa do provedor
// ==============================================================================

import type { Pessoa, UserOnboarding, UserPreferences, UserProfile } from '../domain/types';
import { getClientDatabaseProvider } from './provider.registry';

/**
 * Realiza autenticação com e-mail e senha no provedor de banco ativo.
 */
export async function signInWithPassword(email: string, password: string) {
  return getClientDatabaseProvider().auth.signInWithPassword(email, password);
}

/**
 * Encerra a sessão ativa do usuário atual.
 */
export async function signOut(): Promise<void> {
  return getClientDatabaseProvider().auth.signOut();
}

/**
 * Permite ao usuário logado alterar sua própria senha.
 */
export async function updateOwnPassword(newPassword: string): Promise<void> {
  return getClientDatabaseProvider().auth.updateOwnPassword(newPassword);
}

/**
 * Conclui a troca obrigatória de senha no primeiro login ou após reset administrativo.
 */
export async function completeFirstLoginPassword(newPassword: string): Promise<void> {
  return getClientDatabaseProvider().auth.completeFirstLoginPassword(newPassword);
}

/**
 * Atualiza o nome de exibição do próprio usuário e/ou suas preferências de UI.
 */
export async function saveOwnProfileAndPreferences(
  nome: string,
  preferencias?: UserPreferences
): Promise<void> {
  return getClientDatabaseProvider().auth.saveOwnProfileAndPreferences(nome, preferencias);
}

/**
 * Carrega o perfil do usuário logado, seu estado de primeiro login/preferências e sua carteira.
 */
export async function fetchCurrentUserScope(): Promise<{
  profile: UserProfile;
  pessoa: Pessoa | null;
  onboarding: UserOnboarding;
} | null> {
  return getClientDatabaseProvider().auth.fetchCurrentUserScope();
}

/**
 * Invoca operações administrativas de gestão de usuários (criação, reset de senha, etc.).
 */
export async function adminManageUser(
  payload: Record<string, unknown>
): Promise<{ ok: boolean; userId?: string; message?: string }> {
  return getClientDatabaseProvider().auth.adminManageUser(payload);
}
