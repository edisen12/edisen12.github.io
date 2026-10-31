import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Menu,
  RefreshCw,
  ChevronDown,
  UserCog,
  Palette,
  KeyRound,
  LogOut,
  ShieldCheck
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { ROLES_LABEL, TAB_TITLES } from '../../config/constants';
import { formatBr } from '../../utils/date';

export interface TopHeaderProps {
  onToggleMobileMenu?: () => void;
}

export function TopHeader({ onToggleMobileMenu }: TopHeaderProps) {
  const {
    userProfile,
    isGlobal,
    scopeLabel,
    activeTab,
    activePeriod,
    themeMode,
    isLoading,
    refreshData,
    openUserSettings,
    logout
  } = useApp();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  const currentTitle = TAB_TITLES[activeTab] || 'Gestão de HH Offshore';
  const isOperationalOrMedicao = ['ger', 'dia', 'emb', 'jus', 'med', 'us'].includes(activeTab);
  const roleName = userProfile ? ROLES_LABEL[userProfile.role] || userProfile.role : 'Usuário';

  const periodSubtitle = useMemo(() => {
    if (!activePeriod?.ini || !activePeriod?.fim) return '';
    return `${formatBr(activePeriod.ini)} a ${formatBr(activePeriod.fim)}`;
  }, [activePeriod?.ini, activePeriod?.fim]);

  const userInitials = useMemo(() => {
    if (!userProfile?.nome) return 'U';
    return userProfile.nome
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }, [userProfile?.nome]);

  const themeBadgeText = useMemo(() => {
    if (themeMode === 'system') return 'Sistema';
    if (themeMode === 'dark') return 'Escuro';
    return 'Claro';
  }, [themeMode]);

  const scopeSummary = isGlobal
    ? 'Acesso Global ao Contrato'
    : scopeLabel || 'Carteira Restrita';

  return (
    <header className="top-header" role="banner">
      <div className="header-brand">
        {onToggleMobileMenu && (
          <button
            type="button"
            className="btn-icon mobile-menu-btn"
            onClick={onToggleMobileMenu}
            aria-label="Abrir menu de navegação"
          >
            <Menu size={20} />
          </button>
        )}

        <img
          src="./infotec-logo.png"
          alt="Infotec Brasil"
          className="header-logo"
        />

        <div className="header-titles">
          <h1>{currentTitle}</h1>
          {isOperationalOrMedicao && periodSubtitle && (
            <div className="header-slogan">
              Período de Medição: <strong>{periodSubtitle}</strong>
            </div>
          )}
        </div>
      </div>

      <div className="header-actions">
        {/* Botão de Atualizar Dados */}
        <button
          type="button"
          className="btn btn-ghost btn-sm refresh-btn"
          onClick={() => void refreshData()}
          disabled={isLoading}
          title="Atualizar dados do contrato"
          aria-label="Atualizar dados"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          <span className="refresh-btn-text">Atualizar</span>
        </button>

        {/* Menu Dropdown de Perfil do Usuário */}
        {userProfile && (
          <div className="profile-menu-container" ref={dropdownRef}>
            <button
              type="button"
              className={`profile-trigger-btn ${dropdownOpen ? 'open' : ''}`}
              onClick={() => setDropdownOpen(prev => !prev)}
              aria-expanded={dropdownOpen}
              aria-haspopup="menu"
              title={`Conta de ${userProfile.nome}`}
            >
              <div className="profile-avatar-circle" aria-hidden="true">
                {userInitials}
              </div>

              <div className="profile-trigger-info">
                <span className="profile-trigger-name">{userProfile.nome}</span>
                <span className="profile-trigger-role">{roleName}</span>
              </div>

              <ChevronDown
                size={15}
                className={`profile-chevron ${dropdownOpen ? 'rotated' : ''}`}
                aria-hidden="true"
              />
            </button>

            {dropdownOpen && (
              <div className="profile-dropdown" role="menu">
                {/* Cabeçalho do Menu */}
                <div className="profile-dropdown-header">
                  <div className="profile-dropdown-user">
                    <span className="profile-dropdown-fullname">{userProfile.nome}</span>
                    <span className="profile-dropdown-email">{userProfile.email}</span>
                  </div>
                  <div className="profile-dropdown-tags">
                    <span className="profile-role-badge">{roleName}</span>
                    <div className="profile-scope-hint" title={scopeSummary}>
                      <ShieldCheck size={12} />
                      <span>{scopeSummary}</span>
                    </div>
                  </div>
                </div>

                <div className="profile-menu-divider" />

                {/* Itens de Navegação */}
                <button
                  type="button"
                  role="menuitem"
                  className="profile-menu-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    openUserSettings('perfil');
                  }}
                >
                  <UserCog size={16} className="profile-item-icon" />
                  <span>Configurações do perfil</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="profile-menu-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    openUserSettings('aparencia');
                  }}
                >
                  <Palette size={16} className="profile-item-icon" />
                  <span className="profile-item-label-flex">
                    <span>Tema e exibição</span>
                    <span className="profile-item-badge">{themeBadgeText}</span>
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="profile-menu-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    openUserSettings('seguranca');
                  }}
                >
                  <KeyRound size={16} className="profile-item-icon" />
                  <span>Alterar minha senha</span>
                </button>

                <div className="profile-menu-divider" />

                <button
                  type="button"
                  role="menuitem"
                  className="profile-menu-item logout-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    void logout();
                  }}
                >
                  <LogOut size={16} className="profile-item-icon" />
                  <span>Sair da conta</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
