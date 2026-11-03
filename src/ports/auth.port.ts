// ==============================================================================
// Porta de Autenticação do Cliente (Frontend Client Auth Port)
// Define os contratos de sessão, controle de primeiro login e gestão RBAC
// ==============================================================================

import type { Pessoa, UserOnboarding, UserPreferences, UserProfile } from '../domain/types';

export interface AuthSessionResult {
  user: { id: string; email?: string } | null;
  session: { access_token: string; expires_at?: number } | null;
}

export interface AuthenticatedUserScope {
  profile: UserProfile;
  pessoa: Pessoa | null;
  onboarding: UserOnboarding;
}

export interface AdminManageUserResult {
  ok: boolean;
  userId?: string;
  message?: string;
}

export interface ClientAuthPort {
  signInWithPassword(email: string, password: string): Promise<AuthSessionResult>;
  signOut(): Promise<void>;
  updateOwnPassword(newPassword: string): Promise<void>;
  completeFirstLoginPassword(newPassword: string): Promise<void>;
  saveOwnProfileAndPreferences(nome: string, preferencias?: UserPreferences): Promise<void>;
  fetchCurrentUserScope(): Promise<AuthenticatedUserScope | null>;
  adminManageUser(payload: Record<string, unknown>): Promise<AdminManageUserResult>;
}
