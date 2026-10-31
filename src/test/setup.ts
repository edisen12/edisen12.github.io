// Setup global de testes para ambiente de Desenvolvimento/Teste isolado
// GARANTIA: Nenhuma requisição atinge o banco de dados real em produção!

process.env.VITE_SUPABASE_URL = 'https://dev-test-isolated.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key-test-env-never-hits-production';

// Polyfills para ambiente DOM (happy-dom)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });

  // Polyfill para scrollTo
  window.scrollTo = () => {};
}
