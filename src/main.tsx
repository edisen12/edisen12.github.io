import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/montserrat/latin-800.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/source-sans-3/latin-700.css';
import './styles/reset.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';
import { App } from './App';
import { initPwa } from './utils/pwa';

// Inicialização antecipada do PWA (Service Worker e beforeinstallprompt)
initPwa();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Elemento #root não encontrado em index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
