import React, { useState, useMemo } from 'react';
import { ShieldCheck, Lock, Eye, EyeOff, Check, X, ArrowRight, LogOut, Mail } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { ROLES_LABEL } from '../../config/constants';
import { completeFirstLoginPassword } from '../../services/auth.service';

export function FirstLoginGate() {
  const { userProfile, userOnboarding, refreshAuth, logout } = useApp();
  const { showToast } = useToast();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const userName = userProfile?.nome || 'Usuário';
  const userEmail = userProfile?.email || '—';
  const roleBadge = userProfile ? (ROLES_LABEL[userProfile.role] || userProfile.role) : 'Usuário';

  const isPrimeiroLogin = Boolean(userOnboarding?.primeiro_login);

  // 4 Requisitos Obrigatórios
  const hasMinLength = newPassword.length >= 8;
  const hasLetter = /[A-Za-z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const passwordsMatch = Boolean(newPassword.length > 0 && newPassword === confirmPassword);

  // Medidor Visual de Força (0 a 4)
  const score = useMemo(() => {
    let s = 0;
    if (hasMinLength) s += 1;
    if (hasLetter) s += 1;
    if (hasNumber) s += 1;
    if (passwordsMatch) s += 1;
    return s;
  }, [hasMinLength, hasLetter, hasNumber, passwordsMatch]);

  const { strengthLabel, strengthColor } = useMemo(() => {
    if (!newPassword) {
      return { strengthLabel: 'Aguardando senha', strengthColor: 'var(--ink-muted)' };
    }
    switch (score) {
      case 1:
        return { strengthLabel: 'Muito fraca', strengthColor: 'var(--bad)' };
      case 2:
        return { strengthLabel: 'Fraca', strengthColor: 'var(--warn)' };
      case 3:
        return { strengthLabel: 'Quase pronta', strengthColor: 'var(--blue)' };
      case 4:
        return { strengthLabel: 'Excelente / Válida', strengthColor: 'var(--ok)' };
      default:
        return { strengthLabel: 'Insegura', strengthColor: 'var(--bad)' };
    }
  }, [score, newPassword]);

  const isFormValid = hasMinLength && hasLetter && hasNumber && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!hasMinLength || !hasLetter || !hasNumber) {
      setErrorMsg('A nova senha deve ter no mínimo 8 caracteres e conter letras e números.');
      return;
    }

    if (!passwordsMatch) {
      setErrorMsg('A confirmação da nova senha não coincide com a senha digitada.');
      return;
    }

    setLoading(true);
    try {
      await completeFirstLoginPassword(newPassword);
      showToast('Senha atualizada com sucesso! Bem-vindo(a).', 'success');
      await refreshAuth();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao atualizar a senha.';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell" style={{ justifyContent: 'center', padding: '16px' }}>
      <div
        className="login-card"
        style={{
          maxWidth: '480px',
          padding: '24px 26px',
          gap: '14px',
          boxSizing: 'border-box'
        }}
      >
        {/* Cabeçalho Institucional & Badge de Segurança */}
        <div className="login-logo-box" style={{ gap: '8px' }}>
          <img
            src="./infotec-logo.png"
            alt="Infotec Brasil"
            className="login-logo"
            style={{ height: '42px' }}
          />

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--orange-soft)',
              color: 'var(--orange-dark)',
              border: '1px solid var(--warn-border)',
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            <ShieldCheck size={14} color="var(--orange-dark)" />
            Segurança Zero-Trust Infotec
          </div>

          <div>
            <div
              className="login-title"
              style={{ fontSize: '1.14rem', lineHeight: 1.3, marginTop: '2px' }}
            >
              {isPrimeiroLogin
                ? 'Primeiro acesso detectado — troque sua senha agora'
                : 'Troca obrigatória de senha'}
            </div>
            <div
              className="login-subtitle"
              style={{ fontSize: '0.82rem', marginTop: '4px', lineHeight: 1.4 }}
            >
              {isPrimeiroLogin
                ? `Olá, ${userName}! Este é o seu primeiro login no sistema. Por segurança, defina uma nova senha pessoal exclusiva para liberar seu acesso.`
                : 'Sua senha foi redefinida pela administração. Defina uma nova senha pessoal agora para prosseguir.'}
            </div>
          </div>
        </div>

        {/* Resumo da Conta Autenticada */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'var(--surface-alt)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--line)',
            fontSize: '0.82rem',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <Mail size={15} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
            <span
              style={{
                fontWeight: 600,
                color: 'var(--ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={userEmail}
            >
              {userEmail}
            </span>
          </div>
          <span className="pill pill-info" style={{ flexShrink: 0 }}>
            {roleBadge}
          </span>
        </div>

        {/* Notificação de Erro */}
        {errorMsg && (
          <div
            className="note note-bad"
            style={{ fontSize: '0.82rem', padding: '10px 12px' }}
            role="alert"
          >
            {errorMsg}
          </div>
        )}

        {/* Formulário de Troca Obrigatória */}
        <form onSubmit={handleSubmit} className="login-form" style={{ gap: '12px' }}>
          <div className="login-field">
            <label className="login-label" htmlFor="first-login-new-password">
              Nova Senha Pessoal
            </label>
            <div style={{ position: 'relative' }}>
              <Lock
                size={16}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ink-muted)'
                }}
              />
              <input
                id="first-login-new-password"
                type={showNewPassword ? 'text' : 'password'}
                className="filter-input"
                style={{ width: '100%', paddingLeft: '36px', paddingRight: '36px' }}
                placeholder="Defina sua nova senha pessoal"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
                autoFocus
              />
              <button
                type="button"
                className="btn-icon"
                onClick={() => setShowNewPassword(p => !p)}
                style={{
                  position: 'absolute',
                  right: '4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--ink-muted)',
                  cursor: 'pointer',
                  padding: '4px'
                }}
                title={showNewPassword ? 'Ocultar senha' : 'Ver senha'}
                aria-label={showNewPassword ? 'Ocultar senha' : 'Ver senha'}
              >
                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="first-login-confirm-password">
              Confirmar Nova Senha
            </label>
            <div style={{ position: 'relative' }}>
              <Lock
                size={16}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ink-muted)'
                }}
              />
              <input
                id="first-login-confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                className="filter-input"
                style={{ width: '100%', paddingLeft: '36px', paddingRight: '36px' }}
                placeholder="Repita a nova senha para confirmar"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="btn-icon"
                onClick={() => setShowConfirmPassword(p => !p)}
                style={{
                  position: 'absolute',
                  right: '4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--ink-muted)',
                  cursor: 'pointer',
                  padding: '4px'
                }}
                title={showConfirmPassword ? 'Ocultar confirmação' : 'Ver confirmação'}
                aria-label={showConfirmPassword ? 'Ocultar confirmação' : 'Ver confirmação'}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Medidor Visual de Força da Senha (4 Barras Progressivas) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.72rem',
                color: 'var(--ink-muted)'
              }}
            >
              <span>Força da senha:</span>
              <span style={{ fontWeight: 700, color: strengthColor }}>{strengthLabel}</span>
            </div>
            <div style={{ display: 'flex', gap: '5px', height: '4px' }}>
              {[1, 2, 3, 4].map(barIndex => (
                <div
                  key={barIndex}
                  style={{
                    flex: 1,
                    borderRadius: '2px',
                    height: '100%',
                    backgroundColor: barIndex <= score ? strengthColor : 'var(--line)',
                    transition: 'background-color 200ms ease'
                  }}
                />
              ))}
            </div>
          </div>

          {/* Checklist Compacto em 2 Colunas */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px 12px',
              marginTop: '4px',
              background: 'var(--surface-alt)',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--line)'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.76rem',
                color: hasMinLength ? 'var(--ok)' : 'var(--ink-muted)',
                fontWeight: hasMinLength ? 600 : 400
              }}
            >
              {hasMinLength ? (
                <Check size={14} color="var(--ok)" style={{ flexShrink: 0 }} />
              ) : (
                <X size={14} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
              )}
              <span>Mínimo de 8 caracteres</span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.76rem',
                color: hasLetter ? 'var(--ok)' : 'var(--ink-muted)',
                fontWeight: hasLetter ? 600 : 400
              }}
            >
              {hasLetter ? (
                <Check size={14} color="var(--ok)" style={{ flexShrink: 0 }} />
              ) : (
                <X size={14} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
              )}
              <span>Contém letras (A-Z)</span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.76rem',
                color: hasNumber ? 'var(--ok)' : 'var(--ink-muted)',
                fontWeight: hasNumber ? 600 : 400
              }}
            >
              {hasNumber ? (
                <Check size={14} color="var(--ok)" style={{ flexShrink: 0 }} />
              ) : (
                <X size={14} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
              )}
              <span>Contém números (0-9)</span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.76rem',
                color: passwordsMatch ? 'var(--ok)' : 'var(--ink-muted)',
                fontWeight: passwordsMatch ? 600 : 400
              }}
            >
              {passwordsMatch ? (
                <Check size={14} color="var(--ok)" style={{ flexShrink: 0 }} />
              ) : (
                <X size={14} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
              )}
              <span>Senhas coincidem</span>
            </div>
          </div>

          {/* Botão de Envio */}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !isFormValid}
            style={{
              width: '100%',
              marginTop: '4px',
              minHeight: '40px',
              fontSize: '0.94rem'
            }}
          >
            {loading ? (
              'Atualizando senha segura...'
            ) : (
              <>
                Definir Nova Senha e Acessar
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Ação Secundária: Sair */}
        <div style={{ textAlign: 'center', marginTop: '2px' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={logout}
            disabled={loading}
            style={{
              color: 'var(--ink-muted)',
              fontSize: '0.78rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <LogOut size={14} />
            Sair e voltar ao login
          </button>
        </div>

        {/* Rodapé Institucional */}
        <div
          style={{
            textAlign: 'center',
            fontSize: '0.74rem',
            color: 'var(--ink-muted)',
            borderTop: '1px solid var(--line)',
            paddingTop: '12px',
            marginTop: '2px'
          }}
        >
          Infotec Brasil · Gestão de Contratos Offshore
          <div style={{ marginTop: '2px', fontStyle: 'italic' }}>
            Criado por Luanna de Abreu Teixeira
          </div>
        </div>
      </div>
    </div>
  );
}
