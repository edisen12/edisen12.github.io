import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, Download, X, AlertTriangle, RefreshCw, Eye, RotateCcw, Users } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';
import { StickyFilterBar } from './StickyFilterBar';
import { ScopeBanner } from './ScopeBanner';
import { PwaInstallModal } from '../modals/PwaInstallModal';
import { ImpersonateUserModal } from '../modals/ImpersonateUserModal';
import { useApp } from '../state/AppContext';
import { usePwaInstall } from '../../utils/pwa';
import { ROLES_LABEL } from '../../config/constants';
import { resolvePersonUns } from '../../domain/calculations';

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pwaModalOpen, setPwaModalOpen] = useState(false);
  const {
    isLoading,
    loadError,
    reloadDataset,
    activeTab,
    isImpersonating,
    impersonatedTarget,
    openImpersonateModal,
    stopImpersonation,
    pidx
  } = useApp();
  const { isMobile, canShowInstallOption, bannerDismissed, triggerInstall, dismissBanner } = usePwaInstall();
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  // Escuta evento customizado de abertura do modal de instalação PWA disparado por outros componentes
  useEffect(() => {
    const handleOpenModal = () => setPwaModalOpen(true);
    window.addEventListener('open-pwa-install-modal', handleOpenModal);
    return () => window.removeEventListener('open-pwa-install-modal', handleOpenModal);
  }, []);

  const handleBannerInstall = () => {
    setPwaModalOpen(true);
  };

  const showFilterBar =
    activeTab !== 'pes' &&
    activeTab !== 'imp' &&
    activeTab !== 'cfg' &&
    activeTab !== 'perfil';

  const impersonatedSummary = (() => {
    if (!impersonatedTarget) return '';
    const role = impersonatedTarget.profile.role;
    if (role === 'admin' || role === 'gestor') {
      return 'Acesso Global ao Contrato';
    }
    const plats = impersonatedTarget.pessoa?.plats || [];
    const uns = impersonatedTarget.pessoa ? resolvePersonUns(impersonatedTarget.pessoa, pidx) : [];
    if (plats.length === 0 && uns.length === 0) {
      return 'Carteira vazia (0 plataformas)';
    }
    const platPreview =
      plats.length > 0
        ? `${plats.length} plat. (${plats.slice(0, 4).join(', ')}${plats.length > 4 ? '…' : ''})`
        : '';
    const unPreview = uns.length > 0 ? `UNs: ${uns.join(', ')}` : '';
    return [platPreview, unPreview].filter(Boolean).join(' · ');
  })();

  return (
    <div className="app-shell">
      {/* Sidebar Lateral */}
      <Sidebar
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Conteúdo e Cabeçalho Principal Viewport-Locked */}
      <div className="app-main-wrapper">
        <TopHeader
          onToggleMobileMenu={() => setMobileMenuOpen(prev => !prev)}
        />

        {/* Banner Permanente de Modo de Validação / Simulação de Usuário */}
        {isImpersonating && impersonatedTarget && (
          <div
            role="status"
            aria-label="Modo de validação de usuário ativo"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
              padding: '8px 16px',
              background: 'var(--warn-soft, #fef3c7)',
              borderBottom: '2px solid var(--orange, #d97706)',
              color: 'var(--ink)',
              fontSize: '0.84rem',
              flexShrink: 0
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Eye size={16} style={{ color: 'var(--orange, #d97706)', flexShrink: 0 }} />
              <span>
                <strong>Modo de Validação Ativo:</strong> Visualizando e usando o sistema como{' '}
                <strong>{impersonatedTarget.profile.nome}</strong> (
                {ROLES_LABEL[impersonatedTarget.profile.role] || impersonatedTarget.profile.role})
              </span>
              {impersonatedSummary && (
                <span
                  className="pill"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    fontSize: '0.76rem'
                  }}
                >
                  {impersonatedSummary}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => openImpersonateModal?.()}
                style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
              >
                <Users size={14} />
                <span>Trocar usuário</span>
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => stopImpersonation?.()}
              >
                <RotateCcw size={14} />
                <span>Voltar para Admin</span>
              </button>
            </div>
          </div>
        )}

        {/* Banner Móvel Compacto de Instalação PWA */}
        {isMobile && canShowInstallOption && !bannerDismissed && (
          <div className="pwa-mobile-banner" role="region" aria-label="Aviso de instalação do aplicativo">
            <div className="pwa-mobile-banner-content">
              <span className="pwa-mobile-banner-icon" aria-hidden="true">
                <Smartphone size={17} />
              </span>
              <span className="pwa-mobile-banner-text">
                Instale o app HH Offshore no celular
              </span>
            </div>
            <div className="pwa-mobile-banner-actions">
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={handleBannerInstall}
              >
                <Download size={14} />
                <span>Instalar</span>
              </button>
              <button
                type="button"
                className="btn-icon"
                onClick={dismissBanner}
                title="Dispensar aviso de instalação"
                aria-label="Dispensar aviso de instalação"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ink-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  minHeight: '28px',
                  minWidth: '28px'
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {showFilterBar && <StickyFilterBar />}

        {/* Indicador sutil de carregamento em background */}
        {isLoading && (
          <div
            style={{
              height: '3px',
              width: '100%',
              background: 'linear-gradient(90deg, var(--blue) 0%, var(--orange) 50%, var(--blue) 100%)',
              backgroundSize: '200% 100%',
              animation: 'loading-bar 1.5s infinite linear',
              flexShrink: 0
            }}
          />
        )}

        {/* Área rolável de dados (mantém Header e FilterBar congelados no topo) */}
        <div className="main-scroll-area" ref={scrollAreaRef}>
          <main className="main-content" id="main-content">
            {loadError && (
              <div
                className="note note-bad"
                role="alert"
                style={{
                  marginBottom: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.86rem' }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <span>{loadError}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={isLoading}
                  onClick={() => void reloadDataset()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <RefreshCw size={14} />
                  <span>{isLoading ? 'Recarregando…' : 'Recarregar dados'}</span>
                </button>
              </div>
            )}
            <ScopeBanner />
            {children}
          </main>

          {/* Rodapé Institucional Obrigatório */}
          <footer className="foot" role="contentinfo">
            <div className="foot-brand">
              Infotec Brasil · Gestão de HH Offshore
            </div>
            <div className="foot-author">
              Criado por Luanna de Abreu Teixeira
            </div>
          </footer>
        </div>
      </div>

      {/* Modal Interativo de Instruções PWA */}
      <PwaInstallModal
        open={pwaModalOpen}
        onClose={() => setPwaModalOpen(false)}
      />

      {/* Modal Administrativo: Ver e usar o sistema como outro usuário */}
      <ImpersonateUserModal />

      <style>{`
        @keyframes loading-bar {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
