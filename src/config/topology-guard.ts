// ==============================================================================
// Guardas de Topologia e Auditoria Arquitetural (Topology Guard)
// Funções puras sem dependência direta de import.meta.env para uso em:
// - vite.config.ts (Node.js build-time)
// - CI/CD GitHub Actions
// - Testes unitários (Vitest)
// ==============================================================================

export const PURE_DATABASE_ENGINES: readonly string[] = [
  'postgres',
  'postgresql',
  'mariadb',
  'mysql',
  'mongodb',
  'mongo',
  'sqlite',
  'mssql',
  'sqlserver',
  'oracle',
  'cockroachdb',
  'redis',
  'cassandra',
  'dynamodb'
] as const;

export const FORBIDDEN_CLIENT_SECRET_PATTERNS: readonly string[] = [
  'DATABASE_URL',
  'DB_PASSWORD',
  'DB_PASS',
  'DB_USER',
  'PGPASSWORD',
  'MYSQL_PWD',
  'MONGO_URI',
  'MONGODB_URI',
  'CONNECTION_STRING',
  'JWT_SECRET',
  'SESSION_SECRET',
  'CSRF_SECRET',
  'SERVICE_ROLE',
  'PRIVATE_KEY'
] as const;

export interface TopologyConfigInput {
  topology: string;
  baasProvider?: string;
  envKeys: string[];
  isGitHubPagesWorkflow?: boolean;
}

/**
 * Valida a integridade da configuração de topologia:
 * 1. Restringe a topologia a 'baas' ou 'self-hosted';
 * 2. Impede vazamento de segredos de banco/servidor em variáveis com prefixo VITE_;
 * 3. Proíbe uso de bancos de dados puros diretamente no cliente na topologia 'baas';
 * 4. Bloqueia a compilação de 'self-hosted' em pipelines do GitHub Pages.
 */
export function assertValidTopologyConfig(input: {
  topology: string;
  baasProvider?: string;
  envKeys: string[];
  isGitHubPagesWorkflow?: boolean;
}): void {
  // 1. Verificação da topologia
  if (input.topology !== 'baas' && input.topology !== 'self-hosted') {
    throw new Error(
      `[TOPOLOGY ERROR] Topologia inválida: "${input.topology}". O sistema suporta exclusivamente "baas" (estático/Jamstack) ou "self-hosted" (servidor próprio VPS/Docker).`
    );
  }

  // 2. Auditoria de variáveis de ambiente com prefixo VITE_
  for (const key of input.envKeys) {
    if (key.startsWith('VITE_')) {
      const upperKey = key.toUpperCase();
      for (const pattern of FORBIDDEN_CLIENT_SECRET_PATTERNS) {
        if (upperKey.includes(pattern)) {
          throw new Error(
            `[SECURITY AUDIT FAILED] Variável de ambiente sensível exposta ao cliente com prefixo VITE_: "${key}". Segredos de conexão a banco ou chaves privadas jamais podem ser embutidos no bundle do frontend.`
          );
        }
      }
    }
  }

  // 3. Proibição de bancos de dados puros sem backend na topologia baas
  if (input.topology === 'baas') {
    const normalizedProvider = (input.baasProvider || '').trim().toLowerCase();
    if (normalizedProvider && (PURE_DATABASE_ENGINES as readonly string[]).includes(normalizedProvider)) {
      throw new Error(
        `[ARCHITECTURE GUARD FAILED] O provedor "${input.baasProvider}" é um banco de dados puro e não pode ser conectado diretamente no navegador na topologia "baas". Bancos puros exigem obrigatoriamente VITE_TOPOLOGY=self-hosted (Servidor Frontend + Backend Privado em VPS/Docker).`
      );
    }
  }

  // 4. Bloqueio de topologia self-hosted em deploy estático do GitHub Pages
  if (input.topology === 'self-hosted' && input.isGitHubPagesWorkflow === true) {
    throw new Error(
      `[BUILD GUARD FAILED] A topologia "self-hosted" exige infraestrutura própria com servidor Node/Docker e não pode ser publicada no GitHub Pages.`
    );
  }
}

/**
 * Constrói a diretiva CSP connect-src adequada à topologia ativa.
 */
export function buildConnectSrcDirective(input: {
  topology: 'baas' | 'self-hosted';
  baasProvider?: string;
  customConnectOrigins?: string;
}): string {
  if (input.topology === 'self-hosted') {
    return "connect-src 'self' data: blob:;";
  }

  // Topologia 'baas'
  if (input.customConnectOrigins && input.customConnectOrigins.trim()) {
    return `connect-src 'self' ${input.customConnectOrigins.trim()};`;
  }

  const provider = (input.baasProvider || 'supabase').trim().toLowerCase();
  if (provider === 'supabase') {
    return "connect-src 'self' https://fwdvrkfootvublicetim.supabase.co wss://fwdvrkfootvublicetim.supabase.co https://*.supabase.co wss://*.supabase.co;";
  }

  return "connect-src 'self';";
}

/**
 * Realiza auditoria estática nos assets gerados no build 'self-hosted' para garantir
 * que nenhuma URL, token ou SDK do Supabase permaneça no bundle de produção.
 */
export function auditSelfHostedBundleAssets(
  assets: Array<{ fileName: string; content?: string }>
): void {
  for (const asset of assets) {
    if (asset.fileName.toLowerCase().includes('supabase')) {
      throw new Error(
        `[BUNDLE LEAK DETECTED] Arquivo de bundle "${asset.fileName}" contém referência a Supabase em build self-hosted.`
      );
    }
    if (asset.content) {
      if (
        asset.content.includes('supabase.co') ||
        asset.content.includes('fwdvrkfootvublicetim')
      ) {
        throw new Error(
          `[BUNDLE LEAK DETECTED] Conteúdo de "${asset.fileName}" contém URLs ou identificadores do Supabase em build self-hosted.`
        );
      }
    }
  }
}
