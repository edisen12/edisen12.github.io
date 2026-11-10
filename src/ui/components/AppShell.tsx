import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, Download, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';
import { StickyFilterBar } from './StickyFilterBar';
import { ScopeBanner } from './ScopeBanner';
import { PwaInstallModal } from '../modals/PwaInstallModal';
import { useApp } from '../state/AppContext';
import { usePwaInstall } from '../../utils/pwa';

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pwaModalOpen, setPwaModalOpen] = useState(false);
  const { isLoading, activeTab } = useApp();
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

      <style>{`
        @keyframes loading-bar {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
