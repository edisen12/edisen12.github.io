// ==============================================================================
// Ponto de Entrada Principal: Servidor Backend Universal Self-Hosted
// Inicialização de Drivers, Bootstrap Seguro e Ciclo de Vida Gracioso
// ==============================================================================

import { createServer } from 'node:http';

import { resolveStorageDriver } from './drivers/registry';
import { RealtimeSseHub } from './core/realtime-hub';
import { SelfHostedDomainEngine } from './core/domain-engine.service';
import { createSelfHostedHttpHandler } from './app';

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const isProd = process.env.NODE_ENV === 'production';
  const secureCookies = process.env.SECURE_COOKIES === 'true' || isProd;

  console.log('[SelfHostedServer] Resolvendo driver de armazenamento...');
  const storageDriver = await resolveStorageDriver(process.env);
  await storageDriver.init();
  console.log(`[SelfHostedServer] Driver de armazenamento inicializado: ${storageDriver.driverId}`);

  const realtimeHub = new RealtimeSseHub();
  const engine = new SelfHostedDomainEngine(storageDriver, realtimeHub);

  // Bootstrap opcional de primeiro administrador via variáveis de ambiente
  if (process.env.INITIAL_ADMIN_EMAIL && process.env.INITIAL_ADMIN_PASSWORD) {
    await engine.bootstrapInitialAdminIfNeeded(
      process.env.INITIAL_ADMIN_EMAIL,
      process.env.INITIAL_ADMIN_PASSWORD,
      process.env.INITIAL_ADMIN_NAME
    );
  }

  const handler = createSelfHostedHttpHandler({
    engine,
    realtimeHub,
    secureCookies
  });

  const server = createServer(handler);

  server.listen(port, host, () => {
    console.log(`[SelfHostedServer] Servidor ativo em http://${host}:${port} (Topologia: self-hosted)`);
    console.log(`[SelfHostedServer] Endpoints da API: http://${host}:${port}/api/v1/health`);
  });

  // Encerramento gracioso em sinais de parada do container ou processo
  const shutdown = async (signal: string) => {
    console.log(`\n[SelfHostedServer] Recebido sinal ${signal}. Encerrando conexões graciosamente...`);
    realtimeHub.close();
    server.close(async () => {
      try {
        await storageDriver.close();
        console.log('[SelfHostedServer] Conexões de banco finalizadas.');
      } catch (err: any) {
        console.error('[SelfHostedServer] Erro ao fechar driver:', err?.message);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch(err => {
  console.error('[SelfHostedServer] Falha fatal na inicialização do servidor:', err);
  process.exit(1);
});
