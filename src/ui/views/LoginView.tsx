import React, { useState } from 'react';
import { Lock, Mail, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { signInWithPassword } from '../../services/auth.service';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';

export function LoginView() {
  const { refreshAuth } = useApp();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!email.trim() || !password) {
      setErrorMsg('Informe seu e-mail corporativo e senha.');
      return;
    }

    setLoading(true);
    try {
      await signInWithPassword(email, password);
      showToast('Login realizado com sucesso!', 'success');
      await refreshAuth();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao autenticar.';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell" style={{ justifyContent: 'center', padding: '16px' }}>
      <div className="login-card" style={{ maxWidth: '420px', padding: '26px 24px', gap: '16px' }}>
        <div className="login-logo-box" style={{ gap: '10px' }}>
          <img
            src="./infotec-logo.png"
            alt="Infotec Brasil"
            className="login-logo"
            style={{ height: '46px' }}
          />
          <div>
            <div className="login-title" style={{ fontSize: '1.2rem' }}>Gestão de HH Offshore</div>
            <div className="login-subtitle" style={{ fontSize: '0.82rem', marginTop: '2px' }}>
              Acesso Restrito e Seguro · Zero-Trust
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="note note-bad" style={{ fontSize: '0.84rem', padding: '10px 12px' }} role="alert">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form" style={{ gap: '14px' }}>
          <div className="login-field">
            <label className="login-label" htmlFor="login-email">
              E-mail Corporativo
            </label>
            <div style={{ position: 'relative' }}>
              <Mail
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
                id="login-email"
                type="email"
                className="filter-input"
                style={{ width: '100%', paddingLeft: '36px' }}
                placeholder="seu.email@infotecbrasil.com.br"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
                autoFocus
              />
            </div>
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="login-password">
              Senha de Acesso
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
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="filter-input"
                style={{ width: '100%', paddingLeft: '36px', paddingRight: '36px' }}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="btn-icon"
                onClick={() => setShowPassword(p => !p)}
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
                title={showPassword ? 'Ocultar senha' : 'Ver senha'}
                aria-label={showPassword ? 'Ocultar senha' : 'Ver senha'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', marginTop: '4px', minHeight: '40px', fontSize: '0.94rem' }}
          >
            {loading ? (
              'Autenticando...'
            ) : (
              <>
                Entrar no Sistema
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div
          style={{
            textAlign: 'center',
            fontSize: '0.76rem',
            color: 'var(--ink-muted)',
            borderTop: '1px solid var(--line)',
            paddingTop: '14px',
            marginTop: '2px'
          }}
        >
          Infotec Brasil · Gestão de Contratos Offshore
          <div style={{ marginTop: '2px', fontStyle: 'italic' }}>Criado por Luanna de Abreu Teixeira</div>
        </div>
      </div>
    </div>
  );
}
