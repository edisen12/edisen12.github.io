import React from 'react';
import { ToastProvider } from './ui/components/ToastContext';
import { AppProvider, useApp } from './ui/state/AppContext';
import { AppShell } from './ui/components/AppShell';
import { LoginView } from './ui/views/LoginView';
import { FirstLoginGate } from './ui/views/FirstLoginGate';
import { UserSettingsView } from './ui/views/UserSettingsView';
import { VisaoGeralView } from './ui/views/VisaoGeralView';
import { PainelDiaView } from './ui/views/PainelDiaView';
import { EmbarqueAtualView } from './ui/views/EmbarqueAtualView';
import { JustificativasView } from './ui/views/JustificativasView';
import { MedicaoRelatoriosView } from './ui/views/MedicaoRelatoriosView';
import { MedicaoUsoffView } from './ui/views/MedicaoUsoffView';
import { PessoasPlataformasView } from './ui/views/PessoasPlataformasView';
import { ImportarDadosView } from './ui/views/ImportarDadosView';
import { ConfiguracoesView } from './ui/views/ConfiguracoesView';
import { JustificativaModal } from './ui/modals/JustificativaModal';
import { FichaTecnicoDrawer } from './ui/modals/FichaTecnicoDrawer';
import { EmailComposerModal } from './ui/modals/EmailComposerModal';

function ActiveTabRouter() {
  const { activeTab, isGlobal } = useApp();

  switch (activeTab) {
    case 'ger':
      return <VisaoGeralView />;
    case 'dia':
      return <PainelDiaView />;
    case 'emb':
      return <EmbarqueAtualView />;
    case 'jus':
      return <JustificativasView />;
    case 'med':
      return <MedicaoRelatoriosView />;
    case 'us':
      return <MedicaoUsoffView />;
    case 'pes':
      return isGlobal ? <PessoasPlataformasView /> : <VisaoGeralView />;
    case 'imp':
      return isGlobal ? <ImportarDadosView /> : <VisaoGeralView />;
    case 'cfg':
      return isGlobal ? <ConfiguracoesView /> : <VisaoGeralView />;
    case 'perfil':
      return <UserSettingsView />;
    default:
      return <VisaoGeralView />;
  }
}

function AppGate() {
  const { authInitialized, userProfile, requiresPasswordChange } = useApp();

  if (!authInitialized) {
    return (
      <div className="login-shell" aria-busy="true">
        <div className="login-card" style={{ textAlign: 'center', padding: '40px 28px' }}>
          <img
            src="./infotec-logo.png"
            alt="Infotec Brasil"
            className="login-logo"
            style={{ margin: '0 auto 16px' }}
          />
          <div className="login-title">Gestão de HH Offshore</div>
          <div className="login-subtitle" style={{ marginTop: '8px' }}>
            Verificando sessão segura...
          </div>
        </div>
      </div>
    );
  }

  if (!userProfile || !userProfile.ativo) {
    return <LoginView />;
  }

  // Bloqueio obrigatório de primeiro acesso ou redefinição administrativa de senha
  if (requiresPasswordChange) {
    return <FirstLoginGate />;
  }

  return (
    <AppShell>
      <ActiveTabRouter />
      <JustificativaModal />
      <FichaTecnicoDrawer />
      <EmailComposerModal />
    </AppShell>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <AppGate />
      </AppProvider>
    </ToastProvider>
  );
}

export default App;
