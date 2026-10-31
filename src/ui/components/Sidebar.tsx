import React, { useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Ship,
  FileCheck,
  BarChart3,
  Calculator,
  Users,
  UploadCloud,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { NAV_TABS } from '../../config/constants';
import type { TabId } from '../../domain/types';

export interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const TAB_ICONS: Record<TabId, React.ComponentType<{ size?: number; className?: string }>> = {
  ger: LayoutDashboard,
  dia: CalendarDays,
  emb: Ship,
  jus: FileCheck,
  med: BarChart3,
  us: Calculator,
  pes: Users,
  imp: UploadCloud,
  cfg: Settings,
  perfil: Settings
};

interface GroupMeta {
  key: 'operacao' | 'medicao' | 'admin';
  title: string;
  tag: string;
}

const GROUPS_META: GroupMeta[] = [
  { key: 'operacao', title: 'Operação Diária', tag: 'OP' },
  { key: 'medicao', title: 'Medição Contratual', tag: 'MED' },
  { key: 'admin', title: 'Administração', tag: 'ADM' }
];

export function Sidebar({ mobileOpen = false, onCloseMobile }: SidebarProps) {
  const { activeTab, setActiveTab, isGlobal, userProfile, openUserSettings, logout } = useApp();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('hhoff_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('hhoff_sidebar_collapsed', String(next));
      } catch {
        // Ignora cota de armazenamento
      }
      return next;
    });
  };

  // Filtra itens por permissão global
  const visibleTabs = NAV_TABS.filter(tab => !tab.globalOnly || isGlobal);

  const visibleGroups = GROUPS_META.map(meta => ({
    ...meta,
    tabs: visibleTabs.filter(t => t.group === meta.key)
  })).filter(g => g.tabs.length > 0);

  const handleSelectTab = (id: TabId) => {
    setActiveTab(id);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const userFirstName = userProfile?.nome ? userProfile.nome.trim().split(' ')[0] : 'Usuário';
  const userInitials = userProfile?.nome
    ? userProfile.nome
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(p => p[0])
        .join('')
        .toUpperCase()
    : 'U';

  return (
    <>
      {mobileOpen && (
        <div
          className="mobile-overlay"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`app-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`.trim()}
        aria-label="Menu principal de navegação"
      >
        <div className="sidebar-header">
          {!collapsed ? (
            <span className="sidebar-header-title">MÓDULOS</span>
          ) : (
            <span className="sidebar-header-mini-dot" title="Infotec Brasil" />
          )}

          {/* Botão de colapsar no desktop */}
          <button
            type="button"
            className="btn-icon collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>

          {/* Botão de fechar no mobile */}
          {mobileOpen && (
            <button
              type="button"
              className="btn-icon mobile-menu-btn"
              onClick={onCloseMobile}
              aria-label="Fechar menu"
            >
              <X size={20} />
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          {visibleGroups.map((group, groupIdx) => (
            <div key={group.key} className="nav-group">
              {groupIdx > 0 && (
                <>
                  {!collapsed ? (
                    <div className="nav-group-header">
                      <div className="nav-group-title">{group.title}</div>
                    </div>
                  ) : (
                    <div className="nav-group-divider" title={group.title}>
                      <span className="nav-group-microtag">{group.tag}</span>
                    </div>
                  )}
                </>
              )}

              {groupIdx === 0 && !collapsed && (
                <div className="nav-group-title">{group.title}</div>
              )}

              <div className="nav-group-items">
                {group.tabs.map(tab => {
                  const Icon = TAB_ICONS[tab.id] || LayoutDashboard;
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`nav-item ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelectTab(tab.id)}
                      title={collapsed ? `${group.title} · ${tab.label}` : undefined}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <div className="nav-item-icon">
                        <Icon size={18} />
                      </div>
                      {!collapsed && (
                        <span className="nav-item-text">{tab.label}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Rodapé Modular da Sidebar com Perfil & Logout */}
        <div className="sidebar-footer">
          <button
            type="button"
            className={`sidebar-footer-btn profile-footer-btn ${activeTab === 'perfil' ? 'active' : ''}`}
            onClick={() => {
              openUserSettings('perfil');
              if (onCloseMobile) onCloseMobile();
            }}
            title={collapsed ? `Perfil de ${userProfile?.nome || 'Usuário'} · Configurações` : undefined}
            aria-label="Configurações do usuário"
          >
            <div className="sidebar-footer-avatar" aria-hidden="true">
              {userInitials}
            </div>
            {!collapsed && (
              <div className="sidebar-footer-info">
                <span className="sidebar-footer-name">{userFirstName}</span>
                <span className="sidebar-footer-sub">Configurações do usuário</span>
              </div>
            )}
          </button>

          <button
            type="button"
            className="sidebar-footer-btn logout-footer-btn"
            onClick={() => void logout()}
            title={collapsed ? 'Sair do sistema' : undefined}
            aria-label="Sair do sistema"
          >
            <div className="sidebar-footer-icon-box">
              <LogOut size={17} />
            </div>
            {!collapsed && <span className="sidebar-footer-logout-text">Sair do sistema</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
