// ==============================================================================
// Hub SSE Realtime (Server-Sent Events)
// Gerenciamento de conexões ativas, Heartbeat Keep-Alive e Broadcast de Eventos
// ==============================================================================

import type { ServerResponse } from 'node:http';

export interface SseClient {
  id: string;
  userId: string;
  res: ServerResponse;
  connectedAt: Date;
}

export class RealtimeSseHub {
  private readonly clients: Map<string, SseClient> = new Map();
  private heartbeatIntervalTimer: NodeJS.Timeout | null = null;
  private clientIdCounter = 0;

  constructor(heartbeatIntervalMs = 25000) {
    if (heartbeatIntervalMs > 0) {
      this.heartbeatIntervalTimer = setInterval(() => {
        this.sendHeartbeat();
      }, heartbeatIntervalMs);
      // Evita impedir encerramento do processo Node.js
      this.heartbeatIntervalTimer.unref();
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Registra uma resposta HTTP como canal SSE streaming persistente.
   */
  addClient(userId: string, res: ServerResponse): string {
    const clientId = `sse-${++this.clientIdCounter}-${Date.now()}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Desativa buffering no proxy reverso Nginx
    });

    // Envia comentário inicial para confirmar conexão imediata
    res.write(`: connected (clientId: ${clientId})\n\n`);

    const client: SseClient = {
      id: clientId,
      userId,
      res,
      connectedAt: new Date()
    };

    this.clients.set(clientId, client);

    res.on('close', () => {
      this.clients.delete(clientId);
    });

    return clientId;
  }

  /**
   * Remove explicitamente um cliente SSE e finaliza a stream.
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.res.end();
      } catch {
        // Ignora erros ao fechar conexão já encerrada
      }
      this.clients.delete(clientId);
    }
  }

  /**
   * Envia ping keep-alive para todos os clientes conectados.
   */
  private sendHeartbeat(): void {
    const deadClientIds: string[] = [];

    for (const [id, client] of this.clients.entries()) {
      try {
        const canWrite = client.res.write(': keepalive\n\n');
        if (!canWrite) {
          // Socket cheio ou fechado
        }
      } catch {
        deadClientIds.push(id);
      }
    }

    for (const deadId of deadClientIds) {
      this.clients.delete(deadId);
    }
  }

  /**
   * Realiza broadcast de um evento para todos os clientes conectados.
   */
  broadcast(
    eventType: 'sync_heartbeat' | 'justificativas',
    payload?: Record<string, any>
  ): void {
    const message = `event: ${eventType}\ndata: ${JSON.stringify(payload ?? {})}\n\n`;
    const deadClientIds: string[] = [];

    for (const [id, client] of this.clients.entries()) {
      try {
        client.res.write(message);
      } catch {
        deadClientIds.push(id);
      }
    }

    for (const deadId of deadClientIds) {
      this.clients.delete(deadId);
    }
  }

  /**
   * Finaliza o hub e fecha todas as conexões abertas.
   */
  close(): void {
    if (this.heartbeatIntervalTimer) {
      clearInterval(this.heartbeatIntervalTimer);
      this.heartbeatIntervalTimer = null;
    }

    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch {
        // Ignora
      }
    }
    this.clients.clear();
  }
}
