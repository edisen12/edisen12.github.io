// ==============================================================================
// Handler HTTP e Roteamento RESTful para Backend Universal Self-Hosted
// Rotas Same-Origin sob /api/v1, Segurança Anti-DoS, Cookies HttpOnly e CSRF
// ==============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';

import type { SelfHostedDomainEngine, AuthenticatedActor } from './core/domain-engine.service';
import type { RealtimeSseHub } from './core/realtime-hub';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  parseCookieHeader,
  SESSION_COOKIE_NAME
} from './core/crypto';

export interface AppHandlerDependencies {
  engine: SelfHostedDomainEngine;
  realtimeHub?: RealtimeSseHub;
  secureCookies?: boolean;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Lê e analisa o corpo da requisição HTTP como JSON com proteção anti-DoS por limite de bytes.
 */
async function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_BODY_BYTES
): Promise<any> {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        const err = new Error('O volume de dados da requisição excede o limite permitido (5 MB).');
        (err as any).statusCode = 413;
        return reject(err);
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch {
        const err = new Error('Formato JSON inválido no corpo da requisição.');
        (err as any).statusCode = 400;
        reject(err);
      }
    });

    req.on('error', err => {
      reject(err);
    });
  });
}

/**
 * Envia resposta formatada em JSON com cabeçalhos de segurança padrão.
 */
function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: Record<string, any>,
  extraHeaders?: Record<string, string>
): void {
  const body = JSON.stringify(data);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8').toString(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extraHeaders
  };

  res.writeHead(statusCode, headers);
  res.end(body);
}

/**
 * Cria o listener de requisições HTTP para o servidor Node.js ou testes integrados.
 */
export function createSelfHostedHttpHandler(deps: AppHandlerDependencies) {
  const { engine, realtimeHub, secureCookies = false } = deps;

  return async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    // Helper: Autenticação da requisição via Cookie HttpOnly
    const authenticate = async (requireCsrf = false): Promise<AuthenticatedActor> => {
      const cookies = parseCookieHeader(req.headers.cookie);
      const sessionId = cookies[SESSION_COOKIE_NAME];
      if (!sessionId) {
        const err = new Error('Sessão não autenticada. Faça login para continuar.');
        (err as any).statusCode = 401;
        throw err;
      }

      const csrfHeader = (req.headers['x-csrf-token'] as string) || undefined;
      return engine.authenticateSession(sessionId, csrfHeader, requireCsrf);
    };

    try {
      // ------------------------------------------------------------------------
      // 1. HEALTH CHECK
      // ------------------------------------------------------------------------
      if (method === 'GET' && pathname === '/api/v1/health') {
        return sendJson(res, 200, {
          ok: true,
          topology: 'self-hosted',
          timestamp: new Date().toISOString()
        });
      }

      // ------------------------------------------------------------------------
      // 2. AUTENTICAÇÃO: LOGIN
      // ------------------------------------------------------------------------
      if (method === 'POST' && pathname === '/api/v1/auth/login') {
        const body = await readJsonBody(req);
        const { email, password } = body;
        const result = await engine.login(email, password, clientIp);

        const cookieHeader = buildSessionCookie(result.sessionId, {
          secure: secureCookies,
          maxAgeSeconds: 7 * 24 * 60 * 60
        });

        return sendJson(
          res,
          200,
          {
            ok: true,
            user: result.user,
            csrfToken: result.csrfToken
          },
          {
            'Set-Cookie': cookieHeader,
            'X-CSRF-Token': result.csrfToken
          }
        );
      }

      // ------------------------------------------------------------------------
      // 3. AUTENTICAÇÃO: LOGOUT
      // ------------------------------------------------------------------------
      if (method === 'POST' && pathname === '/api/v1/auth/logout') {
        const cookies = parseCookieHeader(req.headers.cookie);
        const sessionId = cookies[SESSION_COOKIE_NAME];
        if (sessionId) {
          await engine.logout(sessionId);
        }

        const clearCookie = buildClearSessionCookie(secureCookies);
        return sendJson(
          res,
          200,
          { ok: true, message: 'Sessão encerrada com sucesso.' },
          { 'Set-Cookie': clearCookie }
        );
      }

      // ------------------------------------------------------------------------
      // 4. ESCOPO DO USUÁRIO LOGADO
      // ------------------------------------------------------------------------
      if (method === 'GET' && pathname === '/api/v1/auth/scope') {
        const cookies = parseCookieHeader(req.headers.cookie);
        const sessionId = cookies[SESSION_COOKIE_NAME];
        if (!sessionId) {
          return sendJson(res, 200, { ok: true, scope: null });
        }

        try {
          const actor = await engine.authenticateSession(sessionId, undefined, false);
          const scope = await engine.getCurrentUserScope(actor);
          return sendJson(res, 200, {
            ok: true,
            scope,
            csrfToken: actor.csrfToken
          });
        } catch {
          return sendJson(res, 200, { ok: true, scope: null });
        }
      }

      // ------------------------------------------------------------------------
      // 5. TROCA DE SENHA PRÓPRIA
      // ------------------------------------------------------------------------
      if (method === 'POST' && pathname === '/api/v1/auth/password') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        await engine.updateOwnPassword(actor, body.newPassword);
        return sendJson(res, 200, { ok: true, message: 'Senha atualizada com sucesso.' });
      }

      // ------------------------------------------------------------------------
      // 6. ATUALIZAÇÃO DO PRÓPRIO PERFIL / PREFERÊNCIAS
      // ------------------------------------------------------------------------
      if (method === 'PUT' && pathname === '/api/v1/auth/profile') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        await engine.updateOwnProfile(actor, body.nome, body.preferencias);
        return sendJson(res, 200, { ok: true, message: 'Perfil atualizado com sucesso.' });
      }

      // ------------------------------------------------------------------------
      // 7. DATASET COMPLETO JANELADO
      // ------------------------------------------------------------------------
      if (method === 'GET' && pathname === '/api/v1/dataset') {
        const actor = await authenticate(false);
        const ini = parsedUrl.searchParams.get('ini') || '';
        const fim = parsedUrl.searchParams.get('fim') || '';
        if (!ini || !fim) {
          return sendJson(res, 400, {
            ok: false,
            message: 'Parâmetros "ini" e "fim" (datas YYYY-MM-DD) são obrigatórios.'
          });
        }

        const dataset = await engine.fetchRawDataset(actor, ini, fim);
        return sendJson(res, 200, { ok: true, data: dataset });
      }

      // ------------------------------------------------------------------------
      // 8. REGISTRO DE JUSTIFICATIVA COM SLA IMUTÁVEL
      // ------------------------------------------------------------------------
      if (method === 'PUT' && pathname === '/api/v1/justificativas') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        await engine.saveJustificativa(actor, body, clientIp);
        return sendJson(res, 200, { ok: true, message: 'Justificativa salva com sucesso.' });
      }

      // ------------------------------------------------------------------------
      // 9. CONFIGURAÇÕES CONTRATUAIS
      // ------------------------------------------------------------------------
      if (method === 'PUT' && pathname === '/api/v1/configuracoes') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        await engine.saveConfiguracoes(actor, body.config, body.unWeights, body.emailsResumo);
        return sendJson(res, 200, { ok: true, message: 'Configurações salvas com sucesso.' });
      }

      // ------------------------------------------------------------------------
      // 10. PLATAFORMAS: SALVAR E EXCLUIR
      // ------------------------------------------------------------------------
      if (method === 'PUT' && pathname === '/api/v1/plataformas') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        await engine.savePlataforma(actor, body);
        return sendJson(res, 200, { ok: true, message: 'Plataforma salva com sucesso.' });
      }

      if (method === 'DELETE' && pathname.startsWith('/api/v1/plataformas/')) {
        const actor = await authenticate(true);
        const sigla = decodeURIComponent(pathname.slice('/api/v1/plataformas/'.length));
        await engine.deletePlataforma(actor, sigla);
        return sendJson(res, 200, { ok: true, message: 'Plataforma removida com sucesso.' });
      }

      // ------------------------------------------------------------------------
      // 10.1 TÉCNICOS: SALVAR E EXCLUIR
      // ------------------------------------------------------------------------
      if (method === 'PUT' && pathname === '/api/v1/tecnicos') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        await engine.saveTecnico(actor, body);
        return sendJson(res, 200, { ok: true, message: 'Técnico salvo com sucesso.' });
      }

      if (method === 'DELETE' && pathname.startsWith('/api/v1/tecnicos/')) {
        const actor = await authenticate(true);
        const matricula = decodeURIComponent(pathname.slice('/api/v1/tecnicos/'.length));
        const cascade = parsedUrl.searchParams.get('cascade') === 'true';
        await engine.deleteTecnico(actor, matricula, cascade);
        return sendJson(res, 200, { ok: true, message: 'Técnico removido com sucesso.' });
      }

      // ------------------------------------------------------------------------
      // 11. PESSOAS: SALVAR E EXCLUIR
      // ------------------------------------------------------------------------
      if (method === 'POST' && pathname === '/api/v1/pessoas') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        const pessoa = await engine.savePessoa(actor, body);
        return sendJson(res, 200, { ok: true, pessoa, message: 'Pessoa salva com sucesso.' });
      }

      if (method === 'DELETE' && pathname.startsWith('/api/v1/pessoas/')) {
        const actor = await authenticate(true);
        const id = decodeURIComponent(pathname.slice('/api/v1/pessoas/'.length));
        await engine.deletePessoa(actor, id);
        return sendJson(res, 200, { ok: true, message: 'Pessoa removida com sucesso.' });
      }

      // ------------------------------------------------------------------------
      // 12. IMPORTAÇÕES EM LOTE, RECONCILIAÇÃO SAP E RESET DE CARTEIRA
      // ------------------------------------------------------------------------
      if (method === 'POST' && pathname === '/api/v1/imports/batch') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        const result = await engine.batchImportChunks(actor, body);
        return sendJson(res, 200, { ok: true, count: result.count });
      }

      if (method === 'POST' && pathname === '/api/v1/sap/reconcile') {
        const actor = await authenticate(true);
        const result = await engine.reconciliarConfirmacoesSAP(actor);
        return sendJson(res, 200, { ok: true, result });
      }

      if (method === 'GET' && pathname === '/api/v1/carteira/dedup-snapshot') {
        const actor = await authenticate(false);
        const data = await engine.fetchCarteiraDedupSnapshot(actor);
        return sendJson(res, 200, { ok: true, data });
      }

      if (method === 'POST' && pathname === '/api/v1/carteira/reset') {
        const actor = await authenticate(true);
        const result = await engine.resetCarteiraEmbarques(actor, clientIp);
        return sendJson(res, 200, {
          ok: true,
          deleted_operacoes: result.deleted_operacoes,
          deleted_embarques: result.deleted_embarques,
          message: result.message
        });
      }

      // ------------------------------------------------------------------------
      // 13. AUDITORIA: CONSULTA E LOG MANUAL
      // ------------------------------------------------------------------------
      if (method === 'GET' && pathname === '/api/v1/audit/logs') {
        const actor = await authenticate(false);
        const limit = parsedUrl.searchParams.get('limit')
          ? Number(parsedUrl.searchParams.get('limit'))
          : undefined;
        const search = parsedUrl.searchParams.get('search') || undefined;

        const logs = await engine.fetchAuditLogs(actor, { limit, search });
        return sendJson(res, 200, { ok: true, logs });
      }

      if (method === 'POST' && pathname === '/api/v1/audit/events') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        await engine.logSystemEvent(actor, { ...body, ip_address: clientIp });
        return sendJson(res, 200, { ok: true });
      }

      // ------------------------------------------------------------------------
      // 14. ADMINISTRAÇÃO DE USUÁRIOS
      // ------------------------------------------------------------------------
      if (method === 'POST' && pathname === '/api/v1/admin/users') {
        const actor = await authenticate(true);
        const body = await readJsonBody(req);
        const result = await engine.adminManageUser(actor, body, clientIp);
        return sendJson(res, 200, result);
      }

      if (method === 'DELETE' && pathname.startsWith('/api/v1/admin/users/')) {
        const actor = await authenticate(true);
        const targetUserId = decodeURIComponent(pathname.slice('/api/v1/admin/users/'.length));
        const result = await engine.deleteUserAccount(actor, targetUserId, clientIp);
        return sendJson(res, 200, result);
      }

      // ------------------------------------------------------------------------
      // 15. CANAL REALTIME SSE
      // ------------------------------------------------------------------------
      if (method === 'GET' && pathname === '/api/v1/realtime/events') {
        const actor = await authenticate(false);
        if (!realtimeHub) {
          return sendJson(res, 501, {
            ok: false,
            message: 'Hub de realtime não habilitado neste servidor.'
          });
        }
        realtimeHub.addClient(actor.id, res);
        return; // Mantém conexão SSE aberta
      }

      // Rota não encontrada
      return sendJson(res, 404, {
        ok: false,
        message: `Endpoint não encontrado: ${method} ${pathname}`
      });
    } catch (err: any) {
      const errMsg = typeof err?.message === 'string' ? err.message : '';
      const statusCode =
        err?.statusCode ||
        (errMsg.includes('Acesso negado') || errMsg.includes('Primeiro login')
          ? 403
          : errMsg.includes('Sessão') || errMsg.includes('não autenticada')
            ? 401
            : 400);

      // Proteção CWE-209: nunca expõe stack trace interno em respostas de erro
      const isExpected = statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 413;

      if (!isExpected) {
        console.error('[SelfHostedServer] Erro interno 500 não tratado:', err);
      }

      const clientMessage = isExpected
        ? errMsg || 'Erro ao processar solicitação.'
        : 'Ocorreu um erro interno no servidor ao processar a operação.';

      return sendJson(res, isExpected ? statusCode : 500, {
        ok: false,
        message: clientMessage
      });
    }
  };
}
