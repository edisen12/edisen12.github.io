// ==============================================================================
// Provedor de Banco de Dados Self-Hosted (Frontend Client Database Provider)
// Conecta o frontend ao backend privado Node.js via API RESTful (/api/v1)
// ==============================================================================

import type { ClientDatabaseProvider } from '../../ports/client-provider.port';
import type { ClientAuthPort, AdminManageUserResult } from '../../ports/auth.port';
import type {
  ClientDataPort,
  SavePessoaInput,
  BatchImportHHRow,
  BatchImportCarteiraRow,
  BatchImportConfirmacaoSAPRow,
  BatchImportPlataformaRow,
  BatchImportPessoaRow,
  AuditLogFilterInput,
  ProgressCallback
} from '../../ports/data.port';
import type { ClientRealtimePort } from '../../ports/realtime.port';
import type {
  ContractConfig,
  Pessoa,
  Plataforma,
  SystemAuditLog,
  Tecnico,
  UserPreferences,
  UsoffUnWeight
} from '../../domain/types';
import { platformKey, sanitizePlatformCode, slugify } from '../../utils/format';
import {
  CHUNK_SIZE,
  assembleAppDataset,
  createDebouncedRealtimeSubscriber,
  filterAuditLogsClientSide,
  normalizeEmail,
  prepareBatchCarteira,
  prepareBatchConfirmacoesSAP,
  prepareBatchHH,
  prepareBatchPlataformas,
  validateNewPasswordPolicy
} from '../shared/client-pipeline';
import { SelfHostedHttpClient, type HttpClientOptions } from './http.client';
import type { RawBaaSDatasetPayload } from '../../ports/baas-connector.port';

export interface SelfHostedProviderOptions extends HttpClientOptions {
  createEventSource?: (url: string) => EventSource;
}

/**
 * Cria a implementação completa de ClientDatabaseProvider para ambiente VPS/Docker (Self-Hosted).
 */
export function createSelfHostedClientProvider(
  options?: SelfHostedProviderOptions
): ClientDatabaseProvider {
  const http = new SelfHostedHttpClient({
    baseUrl: options?.baseUrl,
    customFetch: options?.customFetch
  });

  const auth: ClientAuthPort = {
    async signInWithPassword(email: string, password: string) {
      const cleanEmail = normalizeEmail(email);
      const res = await http.post<{
        ok: boolean;
        user: { id: string; email?: string };
        csrfToken?: string;
      }>('/auth/login', { email: cleanEmail, password });

      return {
        user: res.user || null,
        session: { access_token: 'httponly-cookie' }
      };
    },

    async signOut(): Promise<void> {
      try {
        await http.post('/auth/logout');
      } finally {
        http.clearCsrfToken();
      }
    },

    async updateOwnPassword(newPassword: string): Promise<void> {
      validateNewPasswordPolicy(newPassword);
      await http.post('/auth/password', { newPassword });
    },

    async completeFirstLoginPassword(newPassword: string): Promise<void> {
      await this.updateOwnPassword(newPassword);
    },

    async saveOwnProfileAndPreferences(
      nome: string,
      preferencias?: UserPreferences
    ): Promise<void> {
      await http.put('/auth/profile', {
        nome: nome.trim(),
        preferencias
      });
    },

    async fetchCurrentUserScope() {
      const res = await http.get<{
        ok: boolean;
        scope: any;
        csrfToken?: string;
      }>('/auth/scope');
      return res.scope || null;
    },

    async adminManageUser(payload: Record<string, unknown>): Promise<AdminManageUserResult> {
      try {
        const res = await http.post<AdminManageUserResult>('/admin/users', payload);
        return {
          ok: res.ok,
          userId: res.userId,
          message: res.message
        };
      } catch (err: any) {
        return {
          ok: false,
          message: err.message || 'Falha ao processar solicitação de usuário.'
        };
      }
    }
  };

  const data: ClientDataPort = {
    async loadAppDataset(queryIni: string, queryFim: string, isGlobal: boolean) {
      const res = await http.get<{ ok: boolean; data: RawBaaSDatasetPayload }>(
        `/dataset?ini=${encodeURIComponent(queryIni)}&fim=${encodeURIComponent(queryFim)}`
      );
      return assembleAppDataset(res.data, isGlobal);
    },

    async saveJustificativa(just) {
      await http.put('/justificativas', {
        matricula: String(just.matricula).trim(),
        data: String(just.data).trim(),
        motivo: String(just.motivo).trim(),
        horas_gangway: Math.max(0, Number(just.horas_gangway || 0)),
        descricao: String(just.descricao || '').trim(),
        responsavel_nome: String(just.responsavel_nome || '').trim()
      });
    },

    async saveConfiguracoes(
      cfg: ContractConfig,
      unWeights: UsoffUnWeight[],
      emailsResumo: string[]
    ): Promise<void> {
      await http.put('/configuracoes', {
        config: cfg,
        unWeights,
        emailsResumo
      });
    },

    async savePlataforma(plat: Partial<Plataforma> & { sigla: string }): Promise<void> {
      const siglaUpper = sanitizePlatformCode(plat.sigla);
      const chaveNorm = platformKey(siglaUpper);
      await http.put('/plataformas', {
        sigla: siglaUpper,
        chave_norm: chaveNorm,
        nome: plat.nome?.trim() || siglaUpper,
        un: plat.un?.trim() || '',
        armador: plat.armador?.trim() || '',
        gerencia: plat.gerencia?.trim() || '',
        tipo: plat.tipo?.trim() || '',
        situacao: plat.situacao || 'Mobilizada',
        cadastro_pendente: false
      });
    },

    async deletePlataforma(sigla: string): Promise<void> {
      await http.delete(`/plataformas/${encodeURIComponent(sigla)}`);
    },

    async saveTecnico(tec: Tecnico): Promise<void> {
      const cleanMat = (tec.matricula || '').trim();
      const cleanNome = (tec.nome || '').trim();
      const cleanFuncao = (tec.funcao || '').trim() || 'Técnico Offshore';
      if (!cleanMat) throw new Error('A matrícula do técnico é obrigatória.');
      if (!cleanNome) throw new Error('O nome do técnico é obrigatório.');
      await http.put('/tecnicos', {
        matricula: cleanMat,
        nome: cleanNome,
        funcao: cleanFuncao
      });
    },

    async deleteTecnico(matricula: string): Promise<void> {
      const cleanMat = (matricula || '').trim();
      if (!cleanMat) throw new Error('Matrícula inválida para exclusão.');
      await http.delete(`/tecnicos/${encodeURIComponent(cleanMat)}`);
    },

    async savePessoa(input: SavePessoaInput): Promise<Pessoa> {
      const cleanNome = input.nome.trim();
      const cleanEmail = normalizeEmail(input.email);
      const cleanSlug =
        slugify(cleanNome) + (input.id ? '' : `-${Date.now().toString().slice(-4)}`);

      const res = await http.post<{ ok: boolean; pessoa: Pessoa }>('/pessoas', {
        id: input.id,
        slug: cleanSlug,
        nome: cleanNome,
        papel: input.papel,
        email: cleanEmail,
        plats: input.plats || [],
        uns: input.uns || []
      });

      return res.pessoa;
    },

    async deletePessoa(id: string): Promise<void> {
      await http.delete(`/pessoas/${encodeURIComponent(id)}`);
    },

    async batchImportHH(
      rows: BatchImportHHRow[],
      pidx: Record<string, Plataforma>,
      onProgress?: ProgressCallback,
      origem = 'planilha (manual)'
    ): Promise<void> {
      if (!rows.length) return;
      const prepared = prepareBatchHH(rows, pidx);

      if (prepared.pendingPlataformas.length > 0) {
        await http.post('/imports/batch', {
          kind: 'plataformas',
          rows: prepared.pendingPlataformas
        });
      }

      for (let i = 0; i < prepared.uniqueTecnicos.length; i += CHUNK_SIZE) {
        const chunk = prepared.uniqueTecnicos.slice(i, i + CHUNK_SIZE);
        await http.post('/imports/batch', {
          kind: 'tecnicos',
          rows: chunk
        });
      }

      const total = prepared.hhPayload.length;
      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = prepared.hhPayload.slice(i, i + CHUNK_SIZE);
        const isLast = i + CHUNK_SIZE >= total;
        const fluxo = isLast
          ? {
              tipo_fluxo: 'hh' as const,
              origem,
              total_linhas: total,
              data_maxima: prepared.maxDate || null,
              observacao: `Importação em lote de ${total} apontamentos HH.`
            }
          : undefined;

        await http.post('/imports/batch', {
          kind: 'hh',
          rows: chunk,
          fluxo
        });

        onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
      }
    },

    async batchImportCarteira(
      rows: BatchImportCarteiraRow[],
      pidx: Record<string, Plataforma>,
      onProgress?: ProgressCallback,
      origem = 'planilha (manual)'
    ): Promise<void> {
      if (!rows.length) return;
      const prepared = prepareBatchCarteira(rows, pidx);

      if (prepared.pendingPlataformas.length > 0) {
        await http.post('/imports/batch', {
          kind: 'plataformas',
          rows: prepared.pendingPlataformas
        });
      }

      for (let i = 0; i < prepared.uniqueTecnicos.length; i += CHUNK_SIZE) {
        const chunk = prepared.uniqueTecnicos.slice(i, i + CHUNK_SIZE);
        await http.post('/imports/batch', {
          kind: 'tecnicos',
          rows: chunk
        });
      }

      const targetKind = prepared.isGranular ? 'carteira_operacoes' : 'carteira';
      const payloadRows = prepared.isGranular ? prepared.opsPayload : prepared.cartPayload;
      const total = payloadRows.length;

      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = payloadRows.slice(i, i + CHUNK_SIZE);
        const isLast = i + CHUNK_SIZE >= total;
        const fluxo = isLast
          ? {
              tipo_fluxo: 'carteira' as const,
              origem,
              total_linhas: total,
              data_maxima: prepared.maxDate || null,
              observacao: `Importação em lote de ${total} registros de carteira.`
            }
          : undefined;

        await http.post('/imports/batch', {
          kind: targetKind,
          rows: chunk,
          fluxo
        });

        onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
      }

      try {
        await http.post('/sap/reconcile');
      } catch (rErr) {
        console.warn('Reconciliação automática disparada após importação de carteira:', rErr);
      }
    },

    async batchImportPlataformas(
      rows: BatchImportPlataformaRow[],
      onProgress?: ProgressCallback
    ): Promise<void> {
      if (!rows.length) return;
      const prepared = prepareBatchPlataformas(rows);
      const total = prepared.length;

      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = prepared.slice(i, i + CHUNK_SIZE);
        await http.post('/imports/batch', {
          kind: 'plataformas',
          rows: chunk
        });
        onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
      }
    },

    async batchImportPessoas(
      rows: BatchImportPessoaRow[],
      onProgress?: ProgressCallback
    ): Promise<void> {
      const total = rows.length;
      let count = 0;

      for (const r of rows) {
        await this.savePessoa(r);
        count++;
        onProgress?.(count, total);
      }
    },

    async batchImportTecnicos(
      rows: Array<{ matricula: string; nome: string; funcao: string }>,
      onProgress?: ProgressCallback
    ): Promise<void> {
      if (!rows.length) return;
      const cleanRows = rows
        .map(r => ({
          matricula: (r.matricula || '').trim(),
          nome: (r.nome || '').trim(),
          funcao: (r.funcao || '').trim() || 'Técnico Offshore'
        }))
        .filter(r => r.matricula && r.nome);
      const total = cleanRows.length;

      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = cleanRows.slice(i, i + CHUNK_SIZE);
        await http.post('/imports/batch', {
          kind: 'tecnicos',
          rows: chunk
        });
        onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
      }
    },

    async batchImportConfirmacoesSAP(
      rows: BatchImportConfirmacaoSAPRow[],
      onProgress?: ProgressCallback
    ): Promise<any> {
      if (!rows.length) return;
      const prepared = prepareBatchConfirmacoesSAP(rows);
      const total = prepared.length;

      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = prepared.slice(i, i + CHUNK_SIZE);
        await http.post('/imports/batch', {
          kind: 'confirmacoes_sap',
          rows: chunk
        });
        onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
      }

      const recRes = await http.post<{ ok: boolean; result: any }>('/sap/reconcile');
      return recRes.result;
    },

    async reconciliarConfirmacoesSAP(): Promise<any> {
      const recRes = await http.post<{ ok: boolean; result: any }>('/sap/reconcile');
      return recRes.result;
    },

    async resetCarteiraEmbarques(): Promise<{ deleted_operacoes: number; deleted_embarques: number }> {
      const res = await http.post<{
        ok: boolean;
        deleted_operacoes?: number;
        deleted_embarques?: number;
      }>('/carteira/reset');
      return {
        deleted_operacoes: Number(res.deleted_operacoes || 0),
        deleted_embarques: Number(res.deleted_embarques || 0)
      };
    },

    async fetchSystemAuditLogs(filters?: AuditLogFilterInput): Promise<SystemAuditLog[]> {
      const params = new URLSearchParams();
      if (filters?.limit) params.set('limit', String(filters.limit));
      if (filters?.search) params.set('search', filters.search);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await http.get<{ ok: boolean; logs: SystemAuditLog[] }>(`/audit/logs${qs}`);

      let logs = res.logs || [];
      if (filters?.category && filters.category !== 'all') {
        logs = logs.filter(l => l.category === filters.category);
      }

      return filterAuditLogsClientSide(logs, filters?.search);
    },

    async deleteUserAccount(userId: string): Promise<{ ok: boolean; message: string }> {
      try {
        const res = await http.delete<{ ok: boolean; message?: string }>(
          `/admin/users/${encodeURIComponent(userId)}`
        );
        return {
          ok: res.ok,
          message: res.message || 'Conta de usuário excluída com sucesso.'
        };
      } catch (err: any) {
        return {
          ok: false,
          message: err.message || 'Falha ao processar a exclusão da conta.'
        };
      }
    },

    async logSystemEvent(event: Partial<SystemAuditLog>): Promise<void> {
      try {
        await http.post('/audit/events', event);
      } catch (err) {
        console.warn('Erro ao disparar logSystemEvent:', err);
      }
    }
  };

  const subscribeRaw = (notify: () => void): (() => void) => {
    const createES =
      options?.createEventSource ||
      (typeof EventSource !== 'undefined' ? (url: string) => new EventSource(url) : null);

    if (!createES) {
      return () => {};
    }

    try {
      const es = createES(`${http.baseUrl}/realtime/events`);
      es.onmessage = () => notify();
      es.addEventListener('sync_heartbeat', () => notify());
      es.addEventListener('justificativas', () => notify());
      es.onerror = () => {
        // EventSource gerencia reconexão automaticamente
      };

      return () => {
        es.close();
      };
    } catch {
      return () => {};
    }
  };

  const realtime: ClientRealtimePort = {
    subscribeToRealtimeUpdates: createDebouncedRealtimeSubscriber(subscribeRaw, 450)
  };

  return {
    topology: 'self-hosted',
    providerId: 'self-hosted-api',
    auth,
    data,
    realtime
  };
}
