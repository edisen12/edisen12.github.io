// ============================================================================
// Modal de Instalação PWA — HH Offshore · Infotec Brasil
// Guia interativo para instalação direta sem APK (Android WebAPK, iOS Safari e Desktop)
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Share,
  PlusSquare,
  Download,
  CheckCircle2,
  MoreVertical,
  Laptop,
  Check,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { usePwaInstall } from '../../utils/pwa';

export interface PwaInstallModalProps {
  open: boolean;
  onClose: () => void;
}

type TabType = 'ios' | 'android';

export function PwaInstallModal({ open, onClose }: PwaInstallModalProps) {
  const { isIos, canPromptDirectly, triggerInstall, isInstalled } = usePwaInstall();
  const [activeTab, setActiveTab] = useState<TabType>(isIos ? 'ios' : 'android');
  const [isInstalling, setIsInstalling] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  // Sincroniza a aba padrão com o SO detectado ao abrir
  useEffect(() => {
    if (open) {
      setActiveTab(isIos ? 'ios' : 'android');
      setIsInstalling(false);
      setInstallSuccess(false);
    }
  }, [open, isIos]);

  const handleDirectInstall = async () => {
    setIsInstalling(true);
    try {
      const outcome = await triggerInstall();
      if (outcome === 'accepted') {
        setInstallSuccess(true);
        setTimeout(() => {
          onClose();
        }, 1800);
      }
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Instalar Aplicativo HH Offshore"
      subtitle="Acesse com 1 toque na sua tela inicial, em tela cheia e sem ocupar espaço de APK"
      icon={<Smartphone size={20} />}
      maxWidth={580}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Card de Apresentação do App */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px',
            backgroundColor: 'var(--surface-alt)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--line)'
          }}
        >
          <img
            src="./icons/icon-192.png"
            alt="Ícone HH Offshore"
            style={{
              width: '64px',
              height: '64px',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              objectFit: 'contain',
              backgroundColor: '#ffffff'
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                fontSize: '1.05rem',
                color: 'var(--ink)'
              }}
            >
              HH Offshore · Infotec Brasil
            </div>
            <div
              style={{
                fontSize: '0.82rem',
                color: 'var(--ink-muted)',
                marginTop: '2px',
                lineHeight: 1.35
              }}
            >
              Gestão de Homem-Hora e Medição Contratual USOFF
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '6px',
                fontSize: '0.75rem',
                color: 'var(--ok)',
                fontWeight: 600
              }}
            >
              <ShieldCheck size={14} /> Aplicativo Web Seguro (PWA)
            </div>
          </div>
        </div>

        {/* Sucesso na Instalação Direta */}
        {installSuccess ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '24px 16px',
              textAlign: 'center',
              backgroundColor: 'var(--ok-soft)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--ok-border)',
              color: 'var(--ok)'
            }}
          >
            <CheckCircle2 size={42} style={{ marginBottom: '8px' }} />
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--ink)' }}>
              Aplicativo instalado com sucesso!
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--ink-secondary)', marginTop: '4px' }}>
              O ícone já está disponível na tela inicial do seu dispositivo.
            </div>
          </div>
        ) : (
          <>
            {/* Ação Direta para Navegadores com Prompt Automático (Android / Chrome / Edge) */}
            {canPromptDirectly && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  padding: '16px',
                  backgroundColor: 'var(--blue-soft)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--line-strong)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Zap size={18} style={{ color: 'var(--blue)' }} />
                  <span style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--ink)' }}>
                    Instalação automática disponível para seu navegador!
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleDirectInstall}
                  disabled={isInstalling}
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    padding: '12px 18px',
                    fontSize: '0.95rem'
                  }}
                >
                  <Download size={18} />
                  {isInstalling ? 'Instalando aplicativo...' : 'Instalar Agora no Dispositivo'}
                </button>
              </div>
            )}

            {/* Alternador de Plataforma (iOS Safari vs Android / Desktop) */}
            <div>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  borderBottom: '1px solid var(--line)',
                  paddingBottom: '8px',
                  marginBottom: '16px'
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab('ios')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: activeTab === 'ios' ? 'var(--blue)' : 'transparent',
                    color: activeTab === 'ios' ? 'var(--on-blue)' : 'var(--ink-muted)',
                    fontFamily: 'var(--f-display)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)'
                  }}
                >
                  <Smartphone size={16} /> iPhone & iPad (Safari)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('android')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: activeTab === 'android' ? 'var(--blue)' : 'transparent',
                    color: activeTab === 'android' ? 'var(--on-blue)' : 'var(--ink-muted)',
                    fontFamily: 'var(--f-display)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)'
                  }}
                >
                  <Laptop size={16} /> Android, Chrome & Edge
                </button>
              </div>

              {/* Guia iOS Safari */}
              {activeTab === 'ios' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      backgroundColor: 'var(--surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--line)'
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--blue-soft)',
                        color: 'var(--blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        flexShrink: 0
                      }}
                    >
                      1
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--ink)', lineHeight: 1.4 }}>
                      Toque no botão <strong>Compartilhar</strong>{' '}
                      <span
                        style={{
                          display: 'inline-flex',
                          verticalAlign: 'middle',
                          padding: '2px 4px',
                          backgroundColor: 'var(--surface-alt)',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--line)'
                        }}
                      >
                        <Share size={15} />
                      </span>{' '}
                      na barra inferior do <strong>Safari</strong>.
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      backgroundColor: 'var(--surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--line)'
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--blue-soft)',
                        color: 'var(--blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        flexShrink: 0
                      }}
                    >
                      2
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--ink)', lineHeight: 1.4 }}>
                      Role a lista de opções para baixo e toque em{' '}
                      <strong>Adicionar à Tela de Início</strong>{' '}
                      <span
                        style={{
                          display: 'inline-flex',
                          verticalAlign: 'middle',
                          padding: '2px 4px',
                          backgroundColor: 'var(--surface-alt)',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--line)'
                        }}
                      >
                        <PlusSquare size={15} />
                      </span>.
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      backgroundColor: 'var(--surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--line)'
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--blue-soft)',
                        color: 'var(--blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        flexShrink: 0
                      }}
                    >
                      3
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--ink)', lineHeight: 1.4 }}>
                      Toque em <strong>Adicionar</strong> no canto superior direito. Pronto! O app
                      será aberto em tela cheia como um aplicativo nativo.
                    </div>
                  </div>
                </div>
              )}

              {/* Guia Android & Desktop */}
              {activeTab === 'android' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      backgroundColor: 'var(--surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--line)'
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--blue-soft)',
                        color: 'var(--blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        flexShrink: 0
                      }}
                    >
                      1
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--ink)', lineHeight: 1.4 }}>
                      Toque ou clique no menu de opções <strong>Mais (⋮)</strong>{' '}
                      <span
                        style={{
                          display: 'inline-flex',
                          verticalAlign: 'middle',
                          padding: '2px 4px',
                          backgroundColor: 'var(--surface-alt)',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--line)'
                        }}
                      >
                        <MoreVertical size={15} />
                      </span>{' '}
                      no canto superior do navegador (Chrome, Edge ou Samsung Internet).
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      backgroundColor: 'var(--surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--line)'
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--blue-soft)',
                        color: 'var(--blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        flexShrink: 0
                      }}
                    >
                      2
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--ink)', lineHeight: 1.4 }}>
                      Selecione <strong>Instalar aplicativo</strong> ou{' '}
                      <strong>Adicionar à tela inicial</strong>{' '}
                      <span
                        style={{
                          display: 'inline-flex',
                          verticalAlign: 'middle',
                          padding: '2px 4px',
                          backgroundColor: 'var(--surface-alt)',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--line)'
                        }}
                      >
                        <Download size={15} />
                      </span>.
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      backgroundColor: 'var(--surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--line)'
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--blue-soft)',
                        color: 'var(--blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        flexShrink: 0
                      }}
                    >
                      3
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--ink)', lineHeight: 1.4 }}>
                      Confirme a instalação no diálogo de confirmação. O WebAPK ou atalho standalone
                      será integrado ao menu de aplicativos do seu sistema operacional.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Vantagens do PWA */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '8px',
                paddingTop: '8px'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.78rem',
                  color: 'var(--ink-secondary)'
                }}
              >
                <Check size={14} style={{ color: 'var(--ok)' }} />
                <span>Zero APK / ~0 MB</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.78rem',
                  color: 'var(--ink-secondary)'
                }}
              >
                <Check size={14} style={{ color: 'var(--ok)' }} />
                <span>Atualizações silenciosas</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.78rem',
                  color: 'var(--ink-secondary)'
                }}
              >
                <Check size={14} style={{ color: 'var(--ok)' }} />
                <span>Tela cheia independente</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          gap: '10px',
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: '1px solid var(--line)'
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          style={{ minWidth: '100px' }}
        >
          {isInstalled || installSuccess ? 'Concluir' : 'Entendi'}
        </button>
      </div>
    </Modal>
  );
}
