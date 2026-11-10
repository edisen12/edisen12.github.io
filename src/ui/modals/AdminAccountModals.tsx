// ==============================================================================
// MODAIS DE CONTAS ADMINISTRATIVAS & SALVAGUARDAS ANTI-LOCKOUT
// Componentes modais compartilhados para gestão de administradores e credenciais
// ==============================================================================

import React, { useState } from 'react';
import {
  ShieldCheck,
  KeyRound,
  UserCheck,
  UserX,
  AlertTriangle,
  Trash2,
  Lock,
  Eye,
  EyeOff,
  User,
  Mail,
  Check
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastContext';
import { adminManageUser } from '../../services/auth.service';
import { deleteUserAccount, logSystemEvent } from '../../services/data.service';
import { ROLES_LABEL } from '../../config/constants';
import type { UserProfile } from '../../domain/types';

// ==============================================================================
// 1. SUB-MODAL: NOVO ADMINISTRADOR
// ==============================================================================
export interface NovoAdminModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export const NovoAdminModal: React.FC<NovoAdminModalProps> = ({
  open,
  onClose,
  onCreated
}) => {
  const { showToast } = useToast();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isPasswordValid = password.length >= 8;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!nome.trim() || !email.trim() || password.length < 8) {
      setErrorMsg('Preencha todos os campos obrigatórios. A senha deve ter no mínimo 8 caracteres.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await adminManageUser({
        action: 'create',
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        password,
        role: 'admin'
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao criar administrador.');
      }

      try {
        await logSystemEvent({
          action: 'create-admin',
          category: 'usuarios',
          target_id: res.userId || null,
          target_label: `${nome.trim()} (${email.trim().toLowerCase()})`,
          details: { role: 'admin' }
        });
      } catch (logErr) {
        console.warn('Falha secundária ao registrar log de auditoria:', logErr);
      }

      showToast('Novo administrador criado com sucesso!', 'success');
      await onCreated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao criar administrador.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<ShieldCheck size={20} />}
      title="Novo Administrador do Sistema"
      subtitle="Acesso e governança global irrestrita"
      maxWidth="500px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit()}
            disabled={loading || password.length < 8}
          >
            <ShieldCheck size={16} />
            {loading ? 'Criando…' : 'Criar Administrador'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p className="sub" style={{ margin: 0, fontSize: '0.84rem' }}>
          Administradores possuem privilégios totais de governança no sistema: visão irrestrita, configurações, importação e gestão de credenciais.
        </p>

        <div className="note note-warn" style={{ fontSize: '0.82rem', margin: 0 }}>
          Esta é uma senha provisória. No primeiro acesso, o novo administrador será obrigado a definir uma senha pessoal forte.
        </div>

        <div className="form-grid-2" style={{ gap: '12px' }}>
          <label className="fld">
            <span>
              <span>Nome completo</span>
              <span className="fld-hint">Obrigatório</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon-left">
                <User size={16} />
              </span>
              <input
                type="text"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Nome do administrador"
                required
                disabled={loading}
                autoComplete="name"
              />
            </div>
          </label>

          <label className="fld">
            <span>
              <span>E-mail institucional</span>
              <span className="fld-hint">Login corporativo</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon-left">
                <Mail size={16} />
              </span>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@infotecbrasil.com.br"
                required
                disabled={loading}
                autoComplete="email"
              />
            </div>
          </label>
        </div>

        <label className="fld">
          <span>
            <span>Senha inicial provisória</span>
            <span className="fld-hint">Mínimo 8 caracteres</span>
          </span>
          <div className="input-with-icon">
            <span className="input-icon-left">
              <Lock size={16} />
            </span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Defina uma senha temporária forte"
              required
              disabled={loading}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="input-action-right touch-target"
              onClick={() => setShowPassword(p => !p)}
              title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
              aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
              style={{ minWidth: '36px', minHeight: '36px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        {password.length > 0 && (
          <div className="password-requirements-card">
            <div className={`password-req-item ${isPasswordValid ? 'met' : ''}`}>
              <Check size={13} style={{ color: isPasswordValid ? 'var(--ok)' : 'var(--ink-muted)' }} />
              <span>Mínimo de 8 caracteres {isPasswordValid ? '(OK)' : `(faltam ${8 - password.length})`}</span>
            </div>
          </div>
        )}

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </form>
    </Modal>
  );
};

// ==============================================================================
// 2. SUB-MODAL: REDEFINIR SENHA PROVISÓRIA
// ==============================================================================
export interface ResetPasswordModalProps {
  user: UserProfile;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  user,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isPasswordValid = password.length >= 8;

  const handleResetPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (password.length < 8) {
      setErrorMsg('A senha provisória deve conter no mínimo 8 caracteres.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await adminManageUser({
        action: 'reset-password',
        userId: user.id,
        newPassword: password,
        forceChange: true
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao redefinir senha do usuário.');
      }

      try {
        await logSystemEvent({
          action: 'reset-password',
          category: 'seguranca',
          target_id: user.id,
          target_label: `${user.nome} (${user.email})`,
          details: { forceChange: true }
        });
      } catch (logErr) {
        console.warn('Falha secundária ao registrar log de auditoria:', logErr);
      }

      showToast(`Senha provisória de ${user.nome} redefinida com sucesso!`, 'success');
      await onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao redefinir senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      icon={<KeyRound size={20} />}
      title={`Redefinir Senha Provisória · ${user.nome}`}
      subtitle="Definição de credencial temporária para primeiro login"
      maxWidth="480px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleResetPassword()}
            disabled={loading || password.length < 8}
          >
            <KeyRound size={16} />
            {loading ? 'Redefinindo…' : 'Confirmar Nova Senha'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="note note-warn" style={{ margin: 0, fontSize: '0.82rem' }}>
          Esta é uma credencial provisória. O sistema obrigará o usuário a definir uma nova senha pessoal no próximo login.
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            background: 'var(--surface-alt)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)'
          }}
        >
          <User size={18} style={{ color: 'var(--blue)' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{user.nome}</div>
            <div className="sub" style={{ fontSize: '0.78rem' }}>{user.email}</div>
          </div>
        </div>

        <label className="fld">
          <span>
            <span>Nova senha provisória</span>
            <span className="fld-hint">Mínimo 8 caracteres</span>
          </span>
          <div className="input-with-icon">
            <span className="input-icon-left">
              <Lock size={16} />
            </span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Digite a nova senha temporária"
              autoFocus
              required
              disabled={loading}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="input-action-right touch-target"
              onClick={() => setShowPassword(p => !p)}
              title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
              aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
              style={{ minWidth: '36px', minHeight: '36px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        {password.length > 0 && (
          <div className="password-requirements-card">
            <div className={`password-req-item ${isPasswordValid ? 'met' : ''}`}>
              <Check size={13} style={{ color: isPasswordValid ? 'var(--ok)' : 'var(--ink-muted)' }} />
              <span>Mínimo de 8 caracteres {isPasswordValid ? '(OK)' : `(faltam ${8 - password.length})`}</span>
            </div>
          </div>
        )}

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </form>
    </Modal>
  );
};

// ==============================================================================
// 3. SUB-MODAL: ATIVAR / DESATIVAR ACESSO (ANTI-LOCKOUT)
// ==============================================================================
export interface ToggleActiveModalProps {
  user: UserProfile;
  activeAdminsCount: number;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export const ToggleActiveModal: React.FC<ToggleActiveModalProps> = ({
  user,
  activeAdminsCount,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const willDeactivate = user.ativo;
  const isLastActiveAdmin = user.role === 'admin' && willDeactivate && activeAdminsCount <= 1;

  const handleToggle = async () => {
    if (isLastActiveAdmin) {
      setErrorMsg('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await adminManageUser({
        action: 'toggle-active',
        userId: user.id,
        ativo: !user.ativo
      });

      if (!res.ok) {
        throw new Error(res.message || 'Falha ao alterar status de acesso do usuário.');
      }

      try {
        await logSystemEvent({
          action: willDeactivate ? 'deactivate-user' : 'activate-user',
          category: 'usuarios',
          target_id: user.id,
          target_label: `${user.nome} (${user.email})`,
          details: { novo_status: !user.ativo }
        });
      } catch (logErr) {
        console.warn('Falha secundária ao registrar log de auditoria:', logErr);
      }

      showToast(`Acesso de ${user.nome} ${willDeactivate ? 'desativado' : 'ativado'} com sucesso!`, 'success');
      await onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao processar alteração.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      icon={willDeactivate ? <UserX size={20} color="var(--bad)" /> : <UserCheck size={20} color="var(--ok)" />}
      title={`${willDeactivate ? 'Desativar Acesso' : 'Reativar Acesso'} · ${user.nome}`}
      subtitle={`Gestão do status de autenticação (${user.email})`}
      maxWidth="480px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="button"
            className={`btn ${willDeactivate ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleToggle}
            disabled={loading || isLastActiveAdmin}
          >
            {willDeactivate ? <UserX size={16} /> : <UserCheck size={16} />}
            {loading ? 'Processando…' : willDeactivate ? 'Confirmar Desativação' : 'Confirmar Reativação'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {isLastActiveAdmin ? (
          <div className="note note-bad" style={{ margin: 0 }}>
            <strong>Salvaguarda Anti-Lockout Ativa:</strong>
            <p style={{ margin: '4px 0 0' }}>
              Este é o único Administrador ativo no sistema. Desativá-lo bloquearia permanentemente o painel de governança. Cadastre outro administrador antes de desativar esta conta.
            </p>
          </div>
        ) : willDeactivate ? (
          <div className="note note-warn" style={{ margin: 0 }}>
            <strong>Atenção:</strong> Ao desativar o acesso de <b>{user.nome}</b>, o token de sessão será imediatamente revogado no banco de dados e a conta será bloqueada para login.
          </div>
        ) : (
          <div className="note note-info" style={{ margin: 0 }}>
            Ao reativar o acesso, <b>{user.nome}</b> poderá efetuar login normalmente com suas credenciais vigentes.
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 14px',
            background: 'var(--surface-alt)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)'
          }}
        >
          <User size={20} style={{ color: 'var(--blue)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user.nome}</div>
            <div className="sub" style={{ fontSize: '0.8rem' }}>{user.email} · Papel: {ROLES_LABEL[user.role] || user.role}</div>
          </div>
          <span className={`pill ${user.ativo ? 'pill-ok' : 'pill-bad'}`}>
            {user.ativo ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </div>
    </Modal>
  );
};

// ==============================================================================
// 4. SUB-MODAL: EXCLUIR CONTA DE USUÁRIO (SALVAGUARDA ANTI-LOCKOUT)
// ==============================================================================
export interface DeleteUserModalProps {
  user: UserProfile;
  activeAdminsCount: number;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export const DeleteUserModal: React.FC<DeleteUserModalProps> = ({
  user,
  activeAdminsCount,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  const [confirmInput, setConfirmInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isLastActiveAdmin = user.role === 'admin' && activeAdminsCount <= 1;
  const isMatch =
    confirmInput.trim().toLowerCase() === user.email.toLowerCase() ||
    confirmInput.trim().toLowerCase() === user.nome.toLowerCase();

  const handleDelete = async () => {
    if (isLastActiveAdmin) {
      setErrorMsg('Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.');
      return;
    }

    if (!isMatch) {
      setErrorMsg('A confirmação digitada não confere com o e-mail ou nome do usuário.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await deleteUserAccount(user.id);
      if (!res.ok) {
        throw new Error(res.message || 'Falha ao excluir conta de usuário.');
      }

      try {
        await logSystemEvent({
          action: 'delete-user',
          category: 'usuarios',
          target_id: user.id,
          target_label: `${user.nome} (${user.email})`,
          details: { role: user.role }
        });
      } catch (logErr) {
        console.warn('Falha secundária ao registrar log de auditoria:', logErr);
      }

      showToast(`Conta de ${user.nome} excluída definitivamente.`, 'success');
      await onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao excluir conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      icon={<AlertTriangle size={20} color="var(--bad)" />}
      title="Exclusão Definitiva de Conta"
      subtitle={`Remoção de credenciais de acesso (${user.email})`}
      maxWidth="500px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleDelete}
            disabled={loading || isLastActiveAdmin || !isMatch}
          >
            <Trash2 size={16} />
            {loading ? 'Excluindo…' : 'Excluir Definitivamente'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {isLastActiveAdmin ? (
          <div className="note note-bad" style={{ margin: 0 }}>
            <strong>Salvaguarda Anti-Lockout Ativa:</strong>
            <p style={{ margin: '4px 0 0' }}>
              Este é o único Administrador ativo no sistema. A exclusão desta conta bloquearia irremediavelmente a governança do sistema. Crie outro administrador antes de prosseguir.
            </p>
          </div>
        ) : (
          <>
            <div className="note note-bad" style={{ margin: 0 }}>
              <strong>Atenção: Ação Irreversível!</strong>
              <p style={{ margin: '4px 0 0' }}>
                A exclusão removerá as credenciais de autenticação no Supabase GoTrue, o perfil de acesso e os registros de onboarding do usuário <b>{user.nome}</b>. Lançamentos operacionais e justificativas históricas serão preservados com desvinculação segura.
              </p>
            </div>

            <label className="fld">
              <span>
                <span>Para confirmar a exclusão, digite o e-mail ou nome exato do usuário:</span>
                <span className="fld-hint">Confirmação</span>
              </span>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
                  background: 'var(--surface-alt)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--ink)'
                }}
              >
                <Mail size={14} style={{ color: 'var(--ink-muted)' }} />
                {user.email}
              </div>
              <div className="input-with-icon">
                <span className="input-icon-left">
                  <Trash2 size={16} />
                </span>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={e => setConfirmInput(e.target.value)}
                  placeholder="Digite o e-mail para confirmar"
                  autoFocus
                  disabled={loading}
                />
              </div>
            </label>
          </>
        )}

        {errorMsg && <div className="note note-bad">{errorMsg}</div>}
      </div>
    </Modal>
  );
};

// Aliases retrocompatíveis
export {
  ResetPasswordModal as AdminResetPasswordModal,
  ToggleActiveModal as AdminToggleActiveModal,
  DeleteUserModal as AdminDeleteUserModal
};
