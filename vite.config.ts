import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import {
  assertValidTopologyConfig,
  buildConnectSrcDirective,
  auditSelfHostedBundleAssets
} from './src/config/topology-guard';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const topology = env.VITE_TOPOLOGY === 'self-hosted' ? 'self-hosted' : 'baas';
  const baasProvider = env.VITE_BAAS_PROVIDER || 'supabase';
  const customConnectOrigins = env.VITE_BAAS_CONNECT_ORIGINS;
  const isGitHubPagesWorkflow = Boolean(
    process.env.GITHUB_ACTIONS &&
      (process.env.GITHUB_WORKFLOW?.includes('Pages') ||
        process.env.GITHUB_JOB?.includes('deploy'))
  );

  // Validação topológica antecipada no momento de compilação
  assertValidTopologyConfig({
    topology,
    baasProvider,
    envKeys: Object.keys(env),
    isGitHubPagesWorkflow
  });

  const activeAdapterPath =
    topology === 'self-hosted'
      ? path.resolve(__dirname, 'src/adapters/self-hosted/index.ts')
      : path.resolve(__dirname, 'src/adapters/baas/index.ts');

  return {
    base: topology === 'self-hosted' ? (env.VITE_BASE_PATH || '/') : './',
    resolve: {
      alias: {
        '@active-adapter': activeAdapterPath
      }
    },
    plugins: [
      react(),
      {
        name: 'topology-guard-plugin',
        transformIndexHtml(html) {
          const connectSrcDirective = buildConnectSrcDirective({
            topology,
            baasProvider,
            customConnectOrigins
          });
          return html.replace(/connect-src\s+[^;]+;/, connectSrcDirective);
        },
        closeBundle() {
          if (topology === 'self-hosted') {
            const assetsDir = path.resolve(__dirname, 'dist/assets');
            if (fs.existsSync(assetsDir)) {
              const files = fs.readdirSync(assetsDir);
              const assets = files.map(file => {
                const filePath = path.join(assetsDir, file);
                const isJs = file.endsWith('.js') || file.endsWith('.mjs');
                const content = isJs ? fs.readFileSync(filePath, 'utf-8') : undefined;
                return { fileName: file, content };
              });
              auditSelfHostedBundleAssets(assets);
            }
          }
        }
      }
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/xlsx')) return 'xlsx-vendor';
            if (topology === 'baas' && id.includes('node_modules/@supabase')) {
              return 'supabase-vendor';
            }
            if (
              id.includes('node_modules/react') ||
              id.includes('node_modules/lucide-react')
            ) {
              return 'ui-vendor';
            }
          }
        }
      }
    },
    server: {
      port: 5173,
      open: false,
      proxy:
        topology === 'self-hosted'
          ? {
              '/api/v1': {
                target: env.VITE_DEV_BACKEND_ORIGIN || 'http://localhost:3000',
                changeOrigin: true
              }
            }
          : undefined
    }
  };
});
