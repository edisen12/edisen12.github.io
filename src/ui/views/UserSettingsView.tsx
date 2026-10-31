import React, { useState, useEffect, useMemo } from 'react';
import {
  User,
  Palette,
  Shield,
  Sun,
  Moon,
  Laptop,
  Lock,
  Mail,
  Check,
  X,
  Eye,
  EyeOff,
  Save,
  LogOut,
  Globe,
  Anchor,
  Building2,
  Rows,
  LayoutList,
  CheckCircle2,
  ShieldCheck,
  Clock
} from 'lucide-react';
import { useApp, type UserSettingsSection } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import { ROLES_LABEL, NAV_TABS } from '../../config/constants';
import { saveOwnProfileAndPreferences, updateOwnPassword } from '../../services/auth.service';
import type { ThemeMode, TableDensity, TabId } from '../../domain/types';

function getInitials(name?: string): string {
  if (!name || !name.trim()) return 'IB';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatSenhaTrocada(isoString: string | null | undefined): string {
  if (!isoString) return 'Definida nesta sessão';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Definida nesta sessão';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'Definida nesta sessão';
  }
}

export function UserSettingsView() {
  const {
    userProfile,
    userOnboarding,
    pessoaScope,
    isGlobal,
    userPreferences,
    updateUserPreferences,
    userSettingsSection,
    openUserSettings,
    refreshAuth,
    logout
  } = useApp();

  const { showToast } = useToast();

  // Estados locais da aba Perfil
  const [nomeInput, setNomeInput] = useState(userProfile?.nome || '');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (userProfile?.nome) {
      setNomeInput(userProfile.nome);
    }
  }, [userProfile?.nome]);

  // Estados locais da aba Segurança
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // 4 Requisitos de Segurança
  const hasMinLength = newPassword.length >= 8;
  const hasLetter = /[A-Za-z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const passwordsMatch = Boolean(newPassword.length > 0 && newPassword === confirmPassword);

  const passwordScore = useMemo(() => {
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
    switch (passwordScore) {
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
  }, [passwordScore, newPassword]);

  const isPasswordFormValid = hasMinLength && hasLetter && hasNumber && passwordsMatch;

  const roleLabel = userProfile ? (ROLES_LABEL[userProfile.role] || userProfile.role) : 'Visitante';

  // Configuração das abas via SegmentedControl
  const sectionOptions: SegmentedOption<UserSettingsSection>[] = [
    { value: 'perfil', label: 'Perfil & Carteira', icon: <User size={16} /> },
    { value: 'aparencia', label: 'Tema & Exibição', icon: <Palette size={16} /> },
    { value: 'seguranca', label: 'Segurança & Senha', icon: <Shield size={16} /> }
  ];

  // Abas disponíveis para página inicial
  const availableTabs = useMemo(() => {
    return NAV_TABS.filter(t => !t.globalOnly || isGlobal);
  }, [isGlobal]);

  // Manipuladores de ação
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNome = nomeInput.trim();
    if (!cleanNome) {
      showToast('O nome de exibição não pode ficar vazio.', 'error');
      return;
    }

    setSavingProfile(true);
    try {
      await saveOwnProfileAndPreferences(cleanNome, userPreferences);
      await refreshAuth();
      showToast('Perfil atualizado com sucesso!', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar dados do perfil.';
      showToast(msg, 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleThemeChange = async (themeMode: ThemeMode) => {
    try {
      await updateUserPreferences({ themeMode });
      const label =
        themeMode === 'light'
          ? 'Claro Executivo'
          : themeMode === 'dark'
          ? 'Escuro Offshore'
          : 'Automático do Sistema';
      showToast(`Tema alterado para ${label}.`, 'info');
    } catch {
      showToast('Erro ao atualizar tema.', 'error');
    }
  };

  const handleDensityChange = async (density: TableDensity) => {
    try {
      await updateUserPreferences({ density });
      showToast(
        density === 'compact'
          ? 'Densidade compacta ativada (ideal para 1366×768).'
          : 'Densidade confortável ativada.',
        'info'
      );
    } catch {
      showToast('Erro ao atualizar densidade.', 'error');
    }
  };

  const handleDefaultTabChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as Exclude<TabId, 'perfil'>;
    try {
      await updateUserPreferences({ defaultTab: val });
      showToast('Aba inicial padrão atualizada.', 'info');
    } catch {
      showToast('Erro ao salvar aba padrão.', 'error');
    }
  };

  const handlePageSizeChange = async (val: string) => {
    const pageSize = Number(val) as 25 | 50 | 100;
    try {
      await updateUserPreferences({ pageSize });
      showToast(`Exibição ajustada para ${pageSize} linhas por página.`, 'info');
    } catch {
      showToast('Erro ao alterar paginação.', 'error');
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (!hasMinLength || !hasLetter || !hasNumber) {
      setPasswordError('A nova senha deve ter no mínimo 8 caracteres e conter letras e números.');
      return;
    }

    if (!passwordsMatch) {
      setPasswordError('As senhas digitadas não coincidem.');
      return;
    }

    setPasswordLoading(true);
    try {
      await updateOwnPassword(newPassword);
      await refreshAuth();
      setNewPassword('');
      setConfirmPassword('');
      showToast('Senha alterada com sucesso!', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao atualizar senha.';
      setPasswordError(msg);
      showToast(msg, 'error');
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="view-user-settings" style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {/* Card Cabeçalho do Perfil Compacto & Executivo */}
      <div
        className="card"
        style={{
          padding: '18px 22px',
          marginBottom: '20px',
          borderTop: 'var(--signature-stripe)',
          background: 'var(--surface)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
            {/* Avatar com Iniciais */}
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--blue) 0%, var(--blue-dark) 100%)',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--f-display)',
                fontSize: '1.2rem',
                fontWeight: 800,
                boxShadow: '0 0 0 3px var(--blue-soft)',
                flexShrink: 0
              }}
            >
              {getInitials(userProfile?.nome)}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h2
                  style={{
                    margin: 0,
                    fontFamily: 'var(--f-display)',
                    fontSize: '1.2rem',
                    fontWeight: 800,
                    color: 'var(--ink)'
                  }}
                >
                  {userProfile?.nome || 'Usuário'}
                </h2>
                <span className="pill pill-info">{roleLabel}</span>
                <span className="pill pill-ok">Ativo</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginTop: '4px',
                  fontSize: '0.82rem',
                  color: 'var(--ink-muted)',
                  flexWrap: 'wrap'
                }}
              >
                <span>{userProfile?.email || '—'}</span>
                <span>•</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={13} />
                  Última troca de senha:{' '}
                  <b>{formatSenhaTrocada(userOnboarding?.senha_trocada_em)}</b>
                </span>
              </div>
            </div>
          </div>

          {/* Botão de Encerramento de Sessão */}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={logout}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--bad)',
              borderColor: 'var(--line)'
            }}
            title="Encerrar sessão no dispositivo"
          >
            <LogOut size={15} />
            Encerrar sessão (Sair)
          </button>
        </div>
      </div>

      {/* Navegação por Abas via SegmentedControl */}
      <div style={{ marginBottom: '20px' }}>
        <SegmentedControl<UserSettingsSection>
          options={sectionOptions}
          value={userSettingsSection}
          onChange={val => openUserSettings(val)}
          size="md"
        />
      </div>

      {/* =====================================================================
          SEÇÃO 1: PERFIL & CARTEIRA
          ===================================================================== */}
      {userSettingsSection === 'perfil' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '20px'
          }}
        >
          {/* Coluna 1: Dados de Identificação */}
          <div className="card">
            <div className="card-title">
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={18} />
                Dados de Identificação
              </span>
            </div>

            <form
              onSubmit={handleSaveProfile}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <div className="login-field">
                <label className="login-label" htmlFor="profile-nome">
                  Nome de exibição
                </label>
                <input
                  id="profile-nome"
                  type="text"
                  className="filter-input"
                  value={nomeInput}
                  onChange={e => setNomeInput(e.target.value)}
                  required
                  disabled={savingProfile}
                  placeholder="Seu nome completo"
                  style={{ width: '100%' }}
                />
              </div>

              <div className="login-field">
                <label className="login-label" htmlFor="profile-email">
                  E-mail corporativo (somente leitura)
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
                    id="profile-email"
                    type="email"
                    className="filter-input"
                    value={userProfile?.email || ''}
                    readOnly
                    disabled
                    style={{
                      width: '100%',
                      paddingLeft: '36px',
                      background: 'var(--surface-alt)',
                      cursor: 'not-allowed',
                      color: 'var(--ink-secondary)'
                    }}
                  />
                </div>
                <span className="sub">
                  O e-mail é gerido pela governança de TI e autenticação centralizada.
                </span>
              </div>

              <div className="login-field">
                <label className="login-label">Papel no sistema</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    className="pill pill-info"
                    style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                  >
                    {roleLabel}
                  </span>
                  <span className="sub">Nível de permissões de acordo com o contrato.</span>
                </div>
              </div>

              <div style={{ marginTop: '8px' }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    savingProfile ||
                    !nomeInput.trim() ||
                    nomeInput.trim() === userProfile?.nome
                  }
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <Save size={16} />
                  {savingProfile ? 'Salvando...' : 'Salvar Alterações de Perfil'}
                </button>
              </div>
            </form>
          </div>

          {/* Coluna 2: Escopo Operacional Vinculado */}
          <div className="card">
            <div className="card-title">
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isGlobal ? <Globe size={18} /> : <Anchor size={18} />}
                Escopo Operacional Vinculado
              </span>
            </div>

            {isGlobal ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div
                  className="note"
                  style={{
                    borderLeftColor: 'var(--ok)',
                    background: 'var(--ok-soft)'
                  }}
                >
                  <CheckCircle2
                    size={20}
                    color="var(--ok)"
                    style={{ flexShrink: 0, marginTop: '2px' }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                      Acesso Global (Administrador / Gestor)
                    </div>
                    <div
                      style={{
                        fontSize: '0.84rem',
                        color: 'var(--ink-secondary)',
                        marginTop: '4px',
                        lineHeight: 1.4
                      }}
                    >
                      Seu perfil possui visão abrangente e controle irrestrito sobre todas as
                      Unidades de Negócio (UNs) e Plataformas marítimas do contrato.
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    fontSize: '0.86rem',
                    color: 'var(--ink-secondary)'
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--ink)' }}>Privilégios ativos:</div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <li>Visão panorâmica de todas as bases e plataformas em operação</li>
                    <li>Acesso sem restrição a medições de HH e relatórios de conformidade</li>
                    <li>Administração de acessos, regras de contrato e importações de dados</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ fontSize: '0.86rem', color: 'var(--ink-secondary)' }}>
                  Sua conta está associada ao seguinte escopo operacional. Os dados, gráficos e
                  técnicos exibidos no sistema são filtrados com base nesta carteira:
                </div>

                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: 'var(--ink-muted)',
                      marginBottom: '8px'
                    }}
                  >
                    <Building2 size={15} />
                    Unidades de Negócio (UNs) Atribuídas
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {pessoaScope?.uns && pessoaScope.uns.length > 0 ? (
                      pessoaScope.uns.map(un => (
                        <span key={un} className="pill pill-info">
                          {un}
                        </span>
                      ))
                    ) : (
                      <span className="pill pill-sem">Nenhuma UN vinculada à carteira</span>
                    )}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: 'var(--ink-muted)',
                      marginBottom: '8px'
                    }}
                  >
                    <Anchor size={15} />
                    Plataformas Atribuídas
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      maxHeight: '160px',
                      overflowY: 'auto'
                    }}
                  >
                    {pessoaScope?.plats && pessoaScope.plats.length > 0 ? (
                      pessoaScope.plats.map(plat => (
                        <span key={plat} className="pill pill-ok">
                          {plat}
                        </span>
                      ))
                    ) : (
                      <span className="pill pill-sem">Nenhuma plataforma vinculada</span>
                    )}
                  </div>
                </div>

                <div
                  className="sub"
                  style={{ borderTop: '1px solid var(--line)', paddingTop: '10px' }}
                >
                  * Para solicitar expansão de carteira ou inclusão de plataformas, contate a
                  coordenação do contrato.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SEÇÃO 2: TEMA & EXIBIÇÃO
          ===================================================================== */}
      {userSettingsSection === 'aparencia' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Tema da Interface */}
          <div className="card">
            <div className="card-title">
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Palette size={18} />
                Tema da Interface
              </span>
            </div>
            <div
              className="sub"
              style={{ marginBottom: '16px', color: 'var(--ink-secondary)' }}
            >
              Escolha o estilo visual ideal para o seu ambiente de trabalho ou estação de monitoramento.
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '14px'
              }}
            >
              {/* Tema 1: Light */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleThemeChange('light')}
                onKeyDown={e => e.key === 'Enter' && handleThemeChange('light')}
                style={{
                  border:
                    userPreferences.themeMode === 'light'
                      ? '2px solid var(--blue)'
                      : '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  background:
                    userPreferences.themeMode === 'light'
                      ? 'var(--blue-soft)'
                      : 'var(--surface)',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  position: 'relative'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius-sm)',
                      background: '#FFFFFF',
                      border: '1px solid var(--line)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--orange)'
                    }}
                  >
                    <Sun size={20} />
                  </div>
                  {userPreferences.themeMode === 'light' && (
                    <span className="pill pill-ok" style={{ fontSize: '0.68rem' }}>
                      Ativo
                    </span>
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--ink)' }}>
                    Claro Executivo
                  </div>
                  <div className="sub" style={{ fontSize: '0.75rem', marginTop: '1px' }}>
                    Padrão Infotec
                  </div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--ink-secondary)',
                      marginTop: '6px',
                      lineHeight: 1.35
                    }}
                  >
                    Fundo claro de alto contraste e legibilidade para escritórios e uso diurno.
                  </div>
                </div>
              </div>

              {/* Tema 2: Dark */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleThemeChange('dark')}
                onKeyDown={e => e.key === 'Enter' && handleThemeChange('dark')}
                style={{
                  border:
                    userPreferences.themeMode === 'dark'
                      ? '2px solid var(--blue)'
                      : '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  background:
                    userPreferences.themeMode === 'dark'
                      ? 'var(--blue-soft)'
                      : 'var(--surface)',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  position: 'relative'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius-sm)',
                      background: '#1A2A45',
                      border: '1px solid #2B3D5D',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#7AA6EC'
                    }}
                  >
                    <Moon size={20} />
                  </div>
                  {userPreferences.themeMode === 'dark' && (
                    <span className="pill pill-ok" style={{ fontSize: '0.68rem' }}>
                      Ativo
                    </span>
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--ink)' }}>
                    Escuro Offshore
                  </div>
                  <div className="sub" style={{ fontSize: '0.75rem', marginTop: '1px' }}>
                    Alta Eficiência Noturna
                  </div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--ink-secondary)',
                      marginTop: '6px',
                      lineHeight: 1.35
                    }}
                  >
                    Fundo escuro para ambientes com pouca luz, operações noturnas ou salas de controle.
                  </div>
                </div>
              </div>

              {/* Tema 3: System */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleThemeChange('system')}
                onKeyDown={e => e.key === 'Enter' && handleThemeChange('system')}
                style={{
                  border:
                    userPreferences.themeMode === 'system'
                      ? '2px solid var(--blue)'
                      : '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  background:
                    userPreferences.themeMode === 'system'
                      ? 'var(--blue-soft)'
                      : 'var(--surface)',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  position: 'relative'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-alt)',
                      border: '1px solid var(--line)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--ink-secondary)'
                    }}
                  >
                    <Laptop size={20} />
                  </div>
                  {userPreferences.themeMode === 'system' && (
                    <span className="pill pill-ok" style={{ fontSize: '0.68rem' }}>
                      Ativo
                    </span>
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--ink)' }}>
                    Automático do Sistema
                  </div>
                  <div className="sub" style={{ fontSize: '0.75rem', marginTop: '1px' }}>
                    Sincronização Dinâmica
                  </div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--ink-secondary)',
                      marginTop: '6px',
                      lineHeight: 1.35
                    }}
                  >
                    Acompanha automaticamente a configuração do Windows ou navegador.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Densidade e Preferências de Exibição */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '20px'
            }}
          >
            {/* Densidade das Tabelas e Painéis */}
            <div className="card">
              <div className="card-title">
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Rows size={18} />
                  Densidade das Tabelas e Painéis
                </span>
              </div>
              <div
                className="sub"
                style={{ marginBottom: '14px', color: 'var(--ink-secondary)' }}
              >
                Ajuste a altura das linhas para otimizar a visualização na sua resolução de tela.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleDensityChange('comfortable')}
                  onKeyDown={e => e.key === 'Enter' && handleDensityChange('comfortable')}
                  style={{
                    border:
                      userPreferences.density === 'comfortable'
                        ? '2px solid var(--blue)'
                        : '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 14px',
                    background:
                      userPreferences.density === 'comfortable'
                        ? 'var(--blue-soft)'
                        : 'var(--surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <LayoutList size={18} color="var(--blue)" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--ink)' }}>
                        Confortável
                      </div>
                      <div className="sub" style={{ fontSize: '0.76rem' }}>
                        Espaçamento padrão para leitura relaxada
                      </div>
                    </div>
                  </div>
                  {userPreferences.density === 'comfortable' && (
                    <Check size={16} color="var(--blue)" />
                  )}
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleDensityChange('compact')}
                  onKeyDown={e => e.key === 'Enter' && handleDensityChange('compact')}
                  style={{
                    border:
                      userPreferences.density === 'compact'
                        ? '2px solid var(--blue)'
                        : '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 14px',
                    background:
                      userPreferences.density === 'compact'
                        ? 'var(--blue-soft)'
                        : 'var(--surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Rows size={18} color="var(--orange-dark)" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--ink)' }}>
                        Compacta (Recomendado para 1366×768)
                      </div>
                      <div className="sub" style={{ fontSize: '0.76rem' }}>
                        Reduz altura das linhas para exibir mais técnicos por tela
                      </div>
                    </div>
                  </div>
                  {userPreferences.density === 'compact' && (
                    <Check size={16} color="var(--blue)" />
                  )}
                </div>
              </div>
            </div>

            {/* Preferências de Navegação & Paginação */}
            <div className="card">
              <div className="card-title">
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={18} />
                  Aba Inicial & Paginação
                </span>
              </div>
              <div
                className="sub"
                style={{ marginBottom: '14px', color: 'var(--ink-secondary)' }}
              >
                Defina o módulo inicial ao entrar no sistema e o volume padrão de registros.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="login-field">
                  <label className="login-label" htmlFor="user-pref-default-tab">
                    Aba Inicial ao Abrir o Sistema
                  </label>
                  <select
                    id="user-pref-default-tab"
                    className="filter-select"
                    value={userPreferences.defaultTab}
                    onChange={handleDefaultTabChange}
                    style={{ width: '100%' }}
                  >
                    {availableTabs.map(tab => (
                      <option key={tab.id} value={tab.id}>
                        {tab.label}
                      </option>
                    ))}
                  </select>
                  <span className="sub">
                    Tela exibida imediatamente após o login do usuário.
                  </span>
                </div>

                <div className="login-field">
                  <label className="login-label">
                    Linhas por Página Padrão nas Tabelas
                  </label>
                  <SegmentedControl<string>
                    options={[
                      { value: '25', label: '25 linhas' },
                      { value: '50', label: '50 linhas' },
                      { value: '100', label: '100 linhas' }
                    ]}
                    value={String(userPreferences.pageSize)}
                    onChange={handlePageSizeChange}
                    size="sm"
                    fullWidth
                  />
                  <span className="sub">
                    Tamanho do lote padrão carregado nas tabelas do sistema.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SEÇÃO 3: SEGURANÇA & SENHA
          ===================================================================== */}
      {userSettingsSection === 'seguranca' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '20px'
          }}
        >
          {/* Coluna 1: Formulário de Troca Voluntária de Senha */}
          <div className="card">
            <div className="card-title">
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lock size={18} />
                Troca de Senha Pessoal
              </span>
            </div>
            <div
              className="sub"
              style={{ marginBottom: '14px', color: 'var(--ink-secondary)' }}
            >
              Defina uma nova senha forte para manter seu acesso operacional protegido.
            </div>

            {passwordError && (
              <div
                className="note note-bad"
                style={{ fontSize: '0.82rem', padding: '10px 12px', marginBottom: '14px' }}
                role="alert"
              >
                {passwordError}
              </div>
            )}

            <form
              onSubmit={handlePasswordSubmit}
              className="login-form"
              style={{ gap: '12px' }}
            >
              <div className="login-field">
                <label className="login-label" htmlFor="user-settings-new-password">
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
                    id="user-settings-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    className="filter-input"
                    style={{ width: '100%', paddingLeft: '36px', paddingRight: '36px' }}
                    placeholder="Digite a nova senha"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    disabled={passwordLoading}
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
                <label className="login-label" htmlFor="user-settings-confirm-password">
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
                    id="user-settings-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    className="filter-input"
                    style={{ width: '100%', paddingLeft: '36px', paddingRight: '36px' }}
                    placeholder="Repita a nova senha para confirmar"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    disabled={passwordLoading}
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

              {/* Medidor Visual de Força da Senha */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  marginTop: '2px'
                }}
              >
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
                  <span style={{ fontWeight: 700, color: strengthColor }}>
                    {strengthLabel}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '5px', height: '4px' }}>
                  {[1, 2, 3, 4].map(barIndex => (
                    <div
                      key={barIndex}
                      style={{
                        flex: 1,
                        borderRadius: '2px',
                        height: '100%',
                        backgroundColor:
                          barIndex <= passwordScore ? strengthColor : 'var(--line)',
                        transition: 'background-color 200ms ease'
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Checklist em 2 Colunas */}
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
                  <span>Mínimo 8 caracteres</span>
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

              <div style={{ marginTop: '6px' }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={passwordLoading || !isPasswordFormValid}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    justifyContent: 'center'
                  }}
                >
                  <Lock size={16} />
                  {passwordLoading ? 'Alterando senha...' : 'Atualizar Minha Senha'}
                </button>
              </div>
            </form>
          </div>

          {/* Coluna 2: Boas Práticas Zero-Trust e Sessão */}
          <div className="card">
            <div className="card-title">
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={18} color="var(--blue)" />
                Diretrizes de Segurança Zero-Trust
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                className="note"
                style={{
                  borderLeftColor: 'var(--blue)',
                  background: 'var(--blue-soft)'
                }}
              >
                <Shield size={20} color="var(--blue)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.84rem', lineHeight: 1.4 }}>
                  <b>Acesso Seguro e Auditado:</b> Toda alteração de dados, importações e
                  justificativas offshore são rastreadas com carimbo de auditoria em conformidade
                  com as normas da Petrobras e LGPD.
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  fontSize: '0.84rem',
                  color: 'var(--ink-secondary)',
                  lineHeight: 1.4
                }}
              >
                <div>
                  <b>1. Credencial Pessoal e Intransferível</b>
                  <div className="sub" style={{ marginTop: '2px' }}>
                    Nunca compartilhe sua senha com outros colaboradores ou terceiros.
                  </div>
                </div>

                <div>
                  <b>2. Estações de Bordo Compartilhadas</b>
                  <div className="sub" style={{ marginTop: '2px' }}>
                    Em computadores de cabine offshore ou salas de controle, sempre encerre sua
                    sessão ao se afastar do terminal.
                  </div>
                </div>

                <div>
                  <b>3. Senhas Fortes e Exclusivas</b>
                  <div className="sub" style={{ marginTop: '2px' }}>
                    Utilize uma combinação que não seja utilizada em outros e-mails ou redes pessoais.
                  </div>
                </div>
              </div>

              <div
                style={{
                  borderTop: '1px solid var(--line)',
                  paddingTop: '14px',
                  marginTop: '6px'
                }}
              >
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--ink-muted)',
                    marginBottom: '8px'
                  }}
                >
                  Deseja sair desta estação de trabalho agora?
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={logout}
                  style={{
                    width: '100%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    color: 'var(--bad)',
                    borderColor: 'var(--line)'
                  }}
                >
                  <LogOut size={16} />
                  Encerrar sessão com segurança
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
