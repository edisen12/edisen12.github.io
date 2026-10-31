import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';
import { StickyFilterBar } from './StickyFilterBar';
import { ScopeBanner } from './ScopeBanner';
import { useApp } from '../state/AppContext';

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isLoading, activeTab } = useApp();
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0;
    }
  }, [activeTab]);

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

      <style>{`
        @keyframes loading-bar {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
