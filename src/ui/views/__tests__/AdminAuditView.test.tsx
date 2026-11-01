// ==============================================================================
// Suíte de Testes Unitários: AdminAuditView
// Governança, Trilha de Auditoria WORM, Gestão de Contas & Salvaguardas Anti-Lockout
// ==============================================================================

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminAuditView } from '../AdminAuditView';
import { useApp } from '../../state/AppContext';
import { ToastProvider } from '../../components/ToastContext';
import {
  fetchSystemAuditLogs,
  deleteUserAccount,
  logSystemEvent
} from '../../../services/data.service';
import { adminManageUser } from '../../../services/auth.service';
import type { AppDataset, SystemAuditLog, UserProfile } from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/data.service', () => ({
  fetchSystemAuditLogs: vi.fn(),
  deleteUserAccount: vi.fn(),
  logSystemEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../../services/auth.service', () => ({
  adminManageUser: vi.fn()
}));

const MOCK_PROFILES: Record<string, UserProfile> = {
  'usr-admin-1': {
    id: 'usr-admin-1',
    nome: 'Admin Primário',
    email: 'admin1@infotec.com.br',
    role: 'admin',
    ativo: true
  },
  'usr-admin-2': {
    id: 'usr-admin-2',
    nome: 'Admin Secundário',
    email: 'admin2@infotec.com.br',
    role: 'admin',
    ativo: true
  },
  'usr-gestor': {
    id: 'usr-gestor',
    nome: 'Gestor Operacional',
    email: 'gestor@infotec.com.br',
    role: 'gestor',
    ativo: true
  },
  'usr-inativo': {
    id: 'usr-inativo',
    nome: 'Usuário Inativo',
    email: 'inativo@infotec.com.br',
    role: 'preposto',
    ativo: false
  }
};

const MOCK_LOGS: SystemAuditLog[] = [
  {
    id: 'log-1',
    actor_id: 'usr-admin-1',
    actor_nome: 'Admin Primário',
    actor_email: 'admin1@infotec.com.br',
    actor_role: 'admin',
    action: 'reset-password',
    category: 'seguranca',
    target_id: 'usr-gestor',
    target_label: 'Gestor Operacional (gestor@infotec.com.br)',
    details: { forceChange: true },
    ip_address: '192.168.1.100',
    created_at: new Date().toISOString()
  },
  {
    id: 'log-2',
    actor_id: 'usr-gestor',
    actor_nome: 'Gestor Operacional',
    actor_email: 'gestor@infotec.com.br',
    actor_role: 'gestor',
    action: 'create-pessoa',
    category: 'cadastros',
    target_id: 'pes-1',
    target_label: 'Técnico Fulano',
    details: { matricula: '12345' },
    ip_address: '10.0.0.50',
    created_at: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: 'log-3',
    actor_id: 'usr-admin-1',
    actor_nome: 'Admin Primário',
    actor_email: 'admin1@infotec.com.br',
    actor_role: 'admin',
    action: 'update-config',
    category: 'configuracoes',
    target_id: 'geral',
    target_label: 'Configurações do Contrato',
    details: { hh_dia: 11 },
    ip_address: '192.168.1.100',
    created_at: new Date(Date.now() - 86400000).toISOString()
  }
];

const MOCK_DATASET: Partial<AppDataset> = {
  profiles: MOCK_PROFILES,
  onboardingMap: {
    'usr-admin-1': {
      user_id: 'usr-admin-1',
      primeiro_login: false,
      obriga_troca_senha: false,
      senha_trocada_em: '2026-01-01',
      preferencias: { themeMode: 'light', density: 'comfortable', defaultTab: 'ger', pageSize: 50 }
    },
    'usr-admin-2': {
      user_id: 'usr-admin-2',
      primeiro_login: true,
      obriga_troca_senha: true,
      senha_trocada_em: null,
      preferencias: { themeMode: 'light', density: 'comfortable', defaultTab: 'ger', pageSize: 50 }
    }
  }
};

function renderAdminAuditView(overrideApp?: Record<string, unknown>) {
  const defaultApp = {
    dataset: MOCK_DATASET,
    isGlobal: true,
    isAdmin: true,
    userProfile: MOCK_PROFILES['usr-admin-1'],
    refreshData: vi.fn().mockResolvedValue(undefined),
    ...overrideApp
  };
  (useApp as unknown as ReturnType<typeof vi.fn>).mockReturnValue(defaultApp);

  return render(
    <ToastProvider>
      <AdminAuditView />
    </ToastProvider>
  );
}

describe('AdminAuditView - Painel de Governança, Contas & Auditoria', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchSystemAuditLogs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_LOGS);
    (deleteUserAccount as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      message: 'Conta de usuário excluída com sucesso.'
    });
    (adminManageUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      message: 'Operação realizada com sucesso.'
    });
  });

  it('1. Bloqueia acesso quando o usuário não possui permissão de administrador ou visão global', () => {
    renderAdminAuditView({ isGlobal: false, isAdmin: false });

    expect(screen.getAllByText(/Acesso Restrito/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Painel de Governança, Contas & Auditoria/i)).toBeNull();
  });

  it('2. Renderiza cabeçalho, selos de segurança WORM, KPIs e abas para Administrador', async () => {
    renderAdminAuditView();

    expect(screen.getByText(/Painel de Governança, Contas & Auditoria/i)).not.toBeNull();
    expect(screen.getByText(/WORM Imutável/i)).not.toBeNull();
    expect(screen.getByText(/Audit Trail Ativo/i)).not.toBeNull();
    expect(screen.getAllByText(/Anti-Lockout/i).length).toBeGreaterThan(0);

    // KPIs
    expect(screen.getByText(/Total de Eventos Rastreados/i)).not.toBeNull();
    expect(screen.getByText(/Alertas de Segurança/i)).not.toBeNull();
    expect(screen.getByText(/Administradores Ativos/i)).not.toBeNull();
    expect(screen.getByText(/Total de Contas de Acesso/i)).not.toBeNull();

    // Abas de navegação
    expect(screen.getByRole('tab', { name: /Trilha de Auditoria/i })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /Gestão Global de Administradores/i })).not.toBeNull();
  });

  it('3. Carrega e exibe os registros de auditoria na tabela com atores e categorias', async () => {
    renderAdminAuditView();

    await waitFor(() => {
      expect(fetchSystemAuditLogs).toHaveBeenCalled();
    });

    // Registros mockados
    expect(await screen.findByText('reset-password')).not.toBeNull();
    expect(screen.getByText('create-pessoa')).not.toBeNull();
    expect(screen.getByText('update-config')).not.toBeNull();
    expect(screen.getAllByText('Admin Primário').length).toBeGreaterThan(0);
  });

  it('4. Permite filtrar logs por categoria via SegmentedControl', async () => {
    renderAdminAuditView();

    await waitFor(() => {
      expect(fetchSystemAuditLogs).toHaveBeenCalled();
    });

    const segurancaTab = screen.getByRole('tab', { name: /Segurança/i });
    fireEvent.click(segurancaTab);

    await waitFor(() => {
      expect(fetchSystemAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'seguranca' })
      );
    });
  });

  it('5. Permite buscar logs por texto (ação, ator ou IP)', async () => {
    renderAdminAuditView();

    await waitFor(() => {
      expect(screen.getByText('reset-password')).not.toBeNull();
    });

    const searchInput = screen.getByPlaceholderText(/Buscar ação, ator, alvo ou IP/i);
    fireEvent.change(searchInput, { target: { value: 'create-pessoa' } });

    expect(screen.getByText('create-pessoa')).not.toBeNull();
    expect(screen.queryByText('update-config')).toBeNull();
  });

  it('6. Abre modal de detalhes de log ao clicar no botão inspecionar', async () => {
    renderAdminAuditView();

    await waitFor(() => {
      expect(screen.getByText('reset-password')).not.toBeNull();
    });

    const viewDetailBtns = screen.getAllByTitle(/Inspecionar payload/i);
    fireEvent.click(viewDetailBtns[0]);

    // Modal aberto
    expect(screen.getByText(/Registro de Auditoria · reset-password/i)).not.toBeNull();
    expect(screen.getByText(/Identificador \(UUID\):/i)).not.toBeNull();
    expect(screen.getByText(/log-1/i)).not.toBeNull();

    // Fechar modal
    const closeBtn = screen.getByRole('button', { name: 'Fechar' });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Identificador \(UUID\):/i)).toBeNull();
    });
  });

  it('7. Alterna para a aba de Gestão Global de Administradores & Acessos e lista usuários', async () => {
    renderAdminAuditView();

    const usersTab = screen.getByRole('tab', { name: /Gestão Global de Administradores/i });
    fireEvent.click(usersTab);

    // Lista de usuários
    expect(screen.getByText('Admin Primário')).not.toBeNull();
    expect(screen.getByText('admin1@infotec.com.br')).not.toBeNull();
    expect(screen.getByText('Admin Secundário')).not.toBeNull();
    expect(screen.getByText('Gestor Operacional')).not.toBeNull();
    expect(screen.getByText('Usuário Inativo')).not.toBeNull();
  });

  it('8. Salvaguarda Anti-Lockout: desabilita botões de desativar e excluir para a própria conta (isSelf)', async () => {
    renderAdminAuditView();

    const usersTab = screen.getByRole('tab', { name: /Gestão Global de Administradores/i });
    fireEvent.click(usersTab);

    // Botão de desativar da própria conta (usr-admin-1) deve estar desabilitado
    const deactivateOwnBtn = screen.getByTitle(/Você não pode desativar seu próprio acesso \(Anti-Lockout\)/i);
    expect(deactivateOwnBtn).toHaveProperty('disabled', true);

    // Botão de excluir da própria conta deve estar desabilitado
    const deleteOwnBtn = screen.getByTitle(/Auto-exclusão bloqueada \(Anti-Lockout\)/i);
    expect(deleteOwnBtn).toHaveProperty('disabled', true);
  });

  it('9. Abre modal de redefinição de senha e executa adminManageUser com sucesso', async () => {
    renderAdminAuditView();

    const usersTab = screen.getByRole('tab', { name: /Gestão Global de Administradores/i });
    fireEvent.click(usersTab);

    const resetPwBtn = screen.getByTitle(/Redefinir senha provisória de Admin Secundário/i);
    fireEvent.click(resetPwBtn);

    expect(screen.getByText(/Redefinir Senha Provisória · Admin Secundário/i)).not.toBeNull();

    const pwInput = screen.getByPlaceholderText(/Digite a nova senha temporária/i);
    fireEvent.change(pwInput, { target: { value: 'NovaSenhaForte@2026' } });

    const confirmBtn = screen.getByRole('button', { name: /Confirmar Nova Senha/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(adminManageUser).toHaveBeenCalledWith({
        action: 'reset-password',
        userId: 'usr-admin-2',
        newPassword: 'NovaSenhaForte@2026',
        forceChange: true
      });
      expect(logSystemEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reset-password', category: 'seguranca' })
      );
    });
  });

  it('10. Abre modal de exclusão e bloqueia se a confirmação por digitação estiver incorreta', async () => {
    renderAdminAuditView();

    const usersTab = screen.getByRole('tab', { name: /Gestão Global de Administradores/i });
    fireEvent.click(usersTab);

    const deleteBtn = screen.getByTitle(/Excluir conta definitivamente \(gestor@infotec.com.br\)/i);
    fireEvent.click(deleteBtn);

    expect(screen.getByText(/Exclusão Definitiva de Conta/i)).not.toBeNull();

    // Botão deve iniciar desabilitado
    const submitDeleteBtn = screen.getByRole('button', { name: /Excluir Definitivamente/i });
    expect(submitDeleteBtn).toHaveProperty('disabled', true);

    // Digita e-mail correto
    const confirmInput = screen.getByPlaceholderText(/Digite o e-mail para confirmar/i);
    fireEvent.change(confirmInput, { target: { value: 'gestor@infotec.com.br' } });

    expect(submitDeleteBtn).toHaveProperty('disabled', false);

    fireEvent.click(submitDeleteBtn);

    await waitFor(() => {
      expect(deleteUserAccount).toHaveBeenCalledWith('usr-gestor');
      expect(logSystemEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete-user', category: 'usuarios' })
      );
    });
  });

  it('11. Anti-Lockout do último admin: bloqueia exclusão quando resta apenas 1 administrador ativo', async () => {
    // Cria cenário com apenas 1 admin ativo no sistema
    const SINGLE_ADMIN_DATASET: Partial<AppDataset> = {
      profiles: {
        'usr-admin-1': MOCK_PROFILES['usr-admin-1']
      },
      onboardingMap: {}
    };

    renderAdminAuditView({
      dataset: SINGLE_ADMIN_DATASET,
      userProfile: {
        id: 'usr-other',
        nome: 'Super Usuário',
        email: 'super@infotec.com.br',
        role: 'admin',
        ativo: true
      }
    });

    const usersTab = screen.getByRole('tab', { name: /Gestão Global de Administradores/i });
    fireEvent.click(usersTab);

    const deleteBtn = screen.getByTitle(/Excluir conta definitivamente \(admin1@infotec.com.br\)/i);
    fireEvent.click(deleteBtn);

    // Modal deve alertar sobre salvaguarda anti-lockout e manter botão desabilitado
    expect(screen.getByText(/Salvaguarda Anti-Lockout Ativa/i)).not.toBeNull();
    const submitDeleteBtn = screen.getByRole('button', { name: /Excluir Definitivamente/i });
    expect(submitDeleteBtn).toHaveProperty('disabled', true);
  });
});
