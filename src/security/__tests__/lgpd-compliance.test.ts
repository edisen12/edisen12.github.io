import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { MOTIVOS_JUSTIFICATIVA, NAV_TABS } from '../../config/constants';
import { PrivacyNoticeModal } from '../../ui/modals/PrivacyNoticeModal';
import {
  LGPD_HEALTH_EXPORT_PLACEHOLDER,
  collectVisibleTecnicoMatriculas,
  containsSensitiveHealthTerms,
  filterScopedConfirmacoesSap,
  isHealthJustificationMotivo,
  maskHealthDescriptionForExport,
  maskPetrobrasKey,
  validateStrongPasswordPolicy
} from '../../utils/lgpd';
import { buildMailLinks } from '../../domain/communications';
import { prepareBatchCarteira } from '../../adapters/shared/client-pipeline';
import { exportPeriodoXlsx, exportUsoffPortalOffshoreXlsx } from '../../services/excel.service';
import {
  mockContractConfig,
  mockPlatforms,
  mockPessoas,
  mockTecnicos,
  mockUsoffUnWeights,
  mockWatermark,
  mockUsers
} from '../../test/testFixtures';
import { InMemoryStorageDriver } from '../../../server/src/drivers/in-memory.driver';
import {
  SelfHostedDomainEngine,
  type AuthenticatedActor
} from '../../../server/src/core/domain-engine.service';
import type { AppDataset, PeriodWindow } from '../../domain/types';

const createLgpdDataset = (): AppDataset => ({
  config: { ...mockContractConfig },
  usoffUnWeights: {
    'Espírito Santo (UN-ES)': mockUsoffUnWeights[0],
    'Bacia de Campos (UN-BC)': mockUsoffUnWeights[2]
  },
  emailsResumo: [],
  plataformas: { ...mockPlatforms },
  pessoas: { ...mockPessoas },
  profiles: {},
  onboardingMap: {},
  tecnicos: { ...mockTecnicos },
  carteira: [
    {
      id: 'c-es-1',
      id_embarque: '55101',
      matricula: '1001',
      plataforma_sigla: 'P50',
      unidade_negocio: 'Espírito Santo (UN-ES)',
      data_inicio: '2026-10-01',
      data_fim: '2026-10-14',
      horas_programadas: 168,
      operacao: 'OP-100',
      pe: 1,
      ex: 1,
      fonte: 'carteira'
    }
  ],
  carteiraOperacoes: [
    {
      id: 'op-1',
      portal_id: '55101',
      id_embarque: '55101',
      matricula: '1001',
      chave_petrobras: 'CHV-SECRETA',
      nome: 'Carlos Silva',
      empresa: 'Infotec Brasil',
      estrutura: 'UN-ES',
      unidade_negocio: 'Espírito Santo (UN-ES)',
      plataforma_sigla: 'P50',
      data_inicio: '2026-10-01',
      data_fim: '2026-10-14',
      ordem: '400010',
      operacao: '0010',
      status_processamento: 'Concluído',
      prioridade: 'Regular',
      status_programacao: 'Carteira',
      hh_programado: 20,
      hh_confirmado: 20,
      hh_confirmado_sap: 20,
      divergencia_sap: 0,
      status_divergencia: 'OK',
      recursos: 1,
      fonte: 'portal_offshore'
    }
  ],
  confirmacoesSap: [],
  hhMap: {
    '1001|2026-10-03': {
      matricula: '1001',
      data: '2026-10-03',
      plataforma_sigla: 'P50',
      unidade_negocio: 'Espírito Santo (UN-ES)',
      horas_executadas: 0
    }
  },
  justMap: {
    '1001|2026-10-03': {
      id: 'jus-health-1',
      matricula: '1001',
      data: '2026-10-03',
      motivo: 'Afastamento / Atestado (sem detalhes clínicos)',
      horas_gangway: 0,
      descricao: 'Afastado por orientação do RH',
      responsavel_nome: 'Preposto ES'
    }
  },
  externalCoveredSet: new Set<string>(),
  sharedOpsSet: new Set<string>(),
  watermark: { ...mockWatermark },
  latestFluxo: null,
  isDemo: false,
  demoReason: ''
});

describe('Conformidade LGPD — Minimização, Sigilo de Saúde, RBAC e Sessão', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Separa motivos operacionais de atestado de saúde preservando exatamente "Gangway desconectada"', () => {
    expect(MOTIVOS_JUSTIFICATIVA).toContain('Gangway desconectada');
    expect(MOTIVOS_JUSTIFICATIVA).toContain('Desembarque antecipado (operacional)');
    expect(MOTIVOS_JUSTIFICATIVA).toContain('Afastamento / Atestado (sem detalhes clínicos)');
    expect(MOTIVOS_JUSTIFICATIVA).not.toContain('Atestado ou desembarque antecipado');

    expect(isHealthJustificationMotivo('Afastamento / Atestado (sem detalhes clínicos)')).toBe(true);
    expect(isHealthJustificationMotivo('Atestado ou desembarque antecipado')).toBe(true);
    expect(isHealthJustificationMotivo('Gangway desconectada')).toBe(false);
  });

  it('2. Detecta termos clínicos/CID e mascara descrições de saúde em planilhas Excel e Portal Chave', async () => {
    expect(containsSensitiveHealthTerms('Apresentou CID J11 por gripe')).toBe(true);
    expect(containsSensitiveHealthTerms('Diagnóstico médico informado')).toBe(true);
    expect(containsSensitiveHealthTerms('Aguardando liberação da permissão de trabalho')).toBe(false);

    expect(
      maskHealthDescriptionForExport('Afastamento / Atestado (sem detalhes clínicos)', 'Texto operacional')
    ).toBe(LGPD_HEALTH_EXPORT_PLACEHOLDER);
    expect(maskHealthDescriptionForExport('Outro', 'CID M54.5')).toBe(LGPD_HEALTH_EXPORT_PLACEHOLDER);
    expect(maskHealthDescriptionForExport('Outro', 'Falta de PT no convés')).toBe('Falta de PT no convés');
    expect(maskPetrobrasKey('CHV991')).toBe('***');
    expect(maskPetrobrasKey('')).toBe('');

    const capturedBlobs: Blob[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
      capturedBlobs.push(obj as Blob);
      return 'blob:lgpd-excel';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
      configurable: true,
      set() {}
    });

    const ds = createLgpdDataset();
    const period: PeriodWindow = { ini: '2026-09-21', fim: '2026-10-20', m: '2026-10' };

    await exportPeriodoXlsx(ds, period);
    const wbPeriodo = XLSX.read(await capturedBlobs[0].arrayBuffer(), { type: 'array' });
    const diarioAoa = XLSX.utils.sheet_to_json<any[]>(wbPeriodo.Sheets['Diário e justificativas'], {
      header: 1
    });
    const justRow = diarioAoa.find(r => r && r[1] === '1001' && r[9] === 'Afastamento / Atestado (sem detalhes clínicos)')!;
    expect(justRow[11]).toBe(LGPD_HEALTH_EXPORT_PLACEHOLDER);

    await exportUsoffPortalOffshoreXlsx(ds, period, {
      fDate: '',
      fReg: '',
      fPlat: '',
      fResp: '',
      fPer: '',
      cIni: '',
      cFim: ''
    });
    const wbUsoff = XLSX.read(await capturedBlobs[1].arrayBuffer(), { type: 'array' });
    const usoffAoa = XLSX.utils.sheet_to_json<any[]>(wbUsoff.Sheets['Portal Offshore + USOFF'], {
      header: 1
    });
    const header = usoffAoa[0];
    const chaveIdx = header.indexOf('Chave');
    expect(chaveIdx).toBeGreaterThanOrEqual(0);
    expect(usoffAoa[1][chaveIdx]).toBe('***');
  });

  it('3. prepareBatchCarteira descarta chave_petrobras na ingestão de Portal Offshore', () => {
    const batch = prepareBatchCarteira(
      [
        {
          id_embarque: '55101',
          mat: '1001',
          chave: 'KEY-SENSIVEL-123',
          nome: 'Carlos Silva',
          empresa: 'Infotec Brasil',
          reg: 'Espírito Santo (UN-ES)',
          plat: 'P50',
          ini: '2026-10-01',
          fim: '2026-10-14',
          ordem: '400010',
          op: '0010',
          status_prog: 'Carteira',
          hp: 20,
          hc_portal: 20,
          recursos: 1
        }
      ],
      mockPlatforms
    );
    expect(batch.opsPayload[0].chave_petrobras).toBe('');
  });

  it('4. buildMailLinks com omitBodyInWebUrl=true omite corpo nominal da querystring do Outlook Web', () => {
    const links = buildMailLinks(
      ['preposto@infotecbrasil.com.br'],
      'Assunto Seguro',
      'Carlos Silva (mat. 1001) fez apenas 4,0 h de 11,0 h',
      { omitBodyInWebUrl: true }
    );
    expect(links.outlookWebUrl).not.toContain('Carlos');
    expect(links.outlookWebUrl).not.toContain('1001');
    expect(decodeURIComponent(links.outlookWebUrl)).toContain('omitido da URL por política LGPD');
  });

  it('5. Backend Self-Hosted minimiza tecnicos, pessoas, SAP e justificativas para não-globais e restringe fetchAuditLogs ao admin', async () => {
    const storage = new InMemoryStorageDriver();
    const engine = new SelfHostedDomainEngine(storage);

    await storage.upsertMany(
      'plataformas',
      [
        { sigla: 'P50', chave_norm: 'p50', nome: 'P-50', un: 'UN-ES', armador: 'Petrobras', gerencia: '', tipo: 'FPSO', situacao: 'Mobilizada', cadastro_pendente: false },
        { sigla: 'P25', chave_norm: 'p25', nome: 'P-25', un: 'UN-BC', armador: 'Petrobras', gerencia: '', tipo: 'UEP', situacao: 'Mobilizada', cadastro_pendente: false }
      ],
      ['sigla']
    );
    await storage.upsertMany(
      'pessoas',
      [
        { id: 'p-prep', slug: 'prep', nome: 'Preposto ES', papel: 'preposto', email: 'prep@teste.local', user_id: 'u-prep', plats: ['P50'], uns: [] },
        { id: 'p-ctrl-p50', slug: 'ctrl-p50', nome: 'Controlador P50', papel: 'controlador', email: 'ctrl50@teste.local', user_id: 'u-ctrl-50', plats: ['P50'], uns: [] },
        { id: 'p-ctrl-p25', slug: 'ctrl-p25', nome: 'Controlador P25', papel: 'controlador', email: 'ctrl25@teste.local', user_id: 'u-ctrl-25', plats: ['P25'], uns: [] },
        { id: 'p-other', slug: 'other', nome: 'Outro Preposto BC', papel: 'preposto', email: 'other@teste.local', user_id: 'u-other', plats: ['P25'], uns: [] },
        { id: 'p-prep-p50', slug: 'prep-p50', nome: 'Outro Preposto ES', papel: 'preposto', email: 'prep2@teste.local', user_id: 'u-prep-2', plats: ['P50'], uns: [] }
      ],
      ['id']
    );
    await storage.upsertMany(
      'tecnicos',
      [
        { matricula: '1001', nome: 'Carlos Silva', funcao: 'Automação' },
        { matricula: '1003', nome: 'Roberto Dias', funcao: 'Mecânica' }
      ],
      ['matricula']
    );
    await storage.upsertMany(
      'carteira_embarques',
      [
        { id: 'c1', id_embarque: '55101', matricula: '1001', plataforma_sigla: 'P50', unidade_negocio: 'UN-ES', data_inicio: '2026-10-01', data_fim: '2026-10-14', horas_programadas: 154, operacao: '55101', pe: 1, ex: 1, fonte: 'carteira' },
        { id: 'c2', id_embarque: '55202', matricula: '1001', plataforma_sigla: 'P25', unidade_negocio: 'UN-BC', data_inicio: '2026-10-16', data_fim: '2026-10-25', horas_programadas: 100, operacao: '55202', pe: 1, ex: 1, fonte: 'carteira' }
      ],
      ['id']
    );
    await storage.upsertMany(
      'confirmacoes_sap',
      [
        { id: 's1', matricula: '1001', data_criacao: '2026-10-03', data_lancamento: '2026-10-03', data_fim_real: '2026-10-03', ordem: '1', operacao: '10', horas_confirmadas: 11, id_embarque: '55101', status_reconciliacao: 'Em Carteira' },
        { id: 's2', matricula: '1001', data_criacao: '2026-10-18', data_lancamento: '2026-10-18', data_fim_real: '2026-10-18', ordem: '2', operacao: '20', horas_confirmadas: 11, id_embarque: '55202', status_reconciliacao: 'Em Carteira' }
      ],
      ['id']
    );
    await storage.upsertMany(
      'justificativas',
      [
        { id: 'j1', matricula: '1001', data: '2026-10-03', motivo: 'Outro', horas_gangway: 0, descricao: 'Em P50', responsavel_nome: 'Preposto ES' },
        { id: 'j2', matricula: '1001', data: '2026-10-19', motivo: 'Outro', horas_gangway: 0, descricao: 'Em P25 (fora do escopo)', responsavel_nome: 'Outro' }
      ],
      ['id']
    );
    await storage.upsertMany(
      'user_onboarding',
      [{ user_id: 'u-prep', primeiro_login: false, obriga_troca_senha: false, senha_trocada_em: '2026-10-01T00:00:00Z' }],
      ['user_id']
    );

    const prepActor: AuthenticatedActor = {
      id: 'u-prep',
      email: 'prep@teste.local',
      nome: 'Preposto ES',
      role: 'preposto',
      ativo: true,
      sessionId: 'sess-prep',
      csrfToken: 'csrf-prep'
    };
    const prepRaw = await engine.fetchRawDataset(prepActor, '2026-10-01', '2026-10-31');

    expect(prepRaw.pessoaRows.map(p => p.id).sort()).toEqual(['p-ctrl-p50', 'p-prep']);
    expect(prepRaw.tecnicoRows.map(t => t.matricula)).toEqual(['1001']);
    expect(prepRaw.confirmacaoSapRows.map(s => s.id)).toEqual(['s1']);
    expect(prepRaw.justificativaRows.map(j => j.id)).toEqual(['j1']);

    // Controlador enxerga estritamente o próprio cadastro
    const ctrlActor: AuthenticatedActor = {
      id: 'u-ctrl-50',
      email: 'ctrl50@teste.local',
      nome: 'Controlador P50',
      role: 'controlador',
      ativo: true,
      sessionId: 'sess-ctrl',
      csrfToken: 'csrf-ctrl'
    };
    const ctrlRaw = await engine.fetchRawDataset(ctrlActor, '2026-10-01', '2026-10-31');
    expect(ctrlRaw.pessoaRows.map(p => p.id)).toEqual(['p-ctrl-p50']);

    // Administrador do sistema é bloqueado ao tentar registrar justificativa operacional
    const adminActor: AuthenticatedActor = {
      id: mockUsers.admin.id,
      email: mockUsers.admin.email,
      nome: 'Admin',
      role: 'admin',
      ativo: true,
      sessionId: 'sess-admin',
      csrfToken: 'csrf-admin'
    };
    await expect(
      engine.saveJustificativa(adminActor, {
        matricula: '1001',
        data: '2026-10-04',
        motivo: 'Outro',
        descricao: 'Teste'
      })
    ).rejects.toThrow(/administradores do sistema não registram/i);

    const gestorActor: AuthenticatedActor = {
      id: mockUsers.gestor.id,
      email: mockUsers.gestor.email,
      nome: 'Gestor',
      role: 'gestor',
      ativo: true,
      sessionId: 'sess-gestor',
      csrfToken: 'csrf-gestor'
    };
    await expect(engine.fetchAuditLogs(gestorActor)).rejects.toThrow(/exclusivamente a Administradores/i);

    await expect(
      engine.adminManageUser(gestorActor, {
        action: 'create',
        email: 'novo@teste.local',
        nome: 'Novo Teste',
        password: '12345678',
        role: 'preposto'
      })
    ).rejects.toThrow(/letras e números/i);
  });

  it('6. NAV_TABS restringe aba adm com adminOnly=true e política de senha rejeita combinações apenas numéricas', () => {
    const admTab = NAV_TABS.find(t => t.id === 'adm');
    expect(admTab?.adminOnly).toBe(true);
    expect(validateStrongPasswordPolicy('12345678')).toMatch(/letras e números/i);
    expect(validateStrongPasswordPolicy('Infotec2026')).toBeNull();
  });

  it('7. Migration 029 existe e protege tecnicos, confirmacoes_sap, audit logs e anonimização LGPD', () => {
    const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/029_lgpd_hardening.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    expect(sql).toContain('tecnicos_select_policy');
    expect(sql).toContain('confirmacoes_sap_select_policy');
    expect(sql).toContain('anonimizar_tecnico_lgpd');
    expect(sql).toContain('app.lgpd_anonymizing');

    const visibleMats = collectVisibleTecnicoMatriculas(
      [{ matricula: '1001' }],
      [],
      [{ matricula: '1002' }]
    );
    expect(Array.from(visibleMats).sort()).toEqual(['1001', '1002']);

    const sapScoped = filterScopedConfirmacoesSap(
      [
        { id_embarque: '55101', matricula: '1001', data_fim_real: '2026-10-05', data_lancamento: '2026-10-05' },
        { id_embarque: '', matricula: '1001', data_fim_real: '2026-10-18', data_lancamento: '2026-10-18' },
        { id_embarque: '', matricula: '1001', data_fim_real: '2026-10-19', data_lancamento: '2026-10-19' }
      ],
      [{ id_embarque: '55101', matricula: '1001', data_inicio: '2026-10-01', data_fim: '2026-10-14' }]
    );
    expect(sapScoped).toHaveLength(2);
  });

  it('8. PrivacyNoticeModal exibe diretrizes LGPD obrigatórias e encerra com Entendi', () => {
    const onClose = vi.fn();
    render(React.createElement(PrivacyNoticeModal, { open: true, onClose }));
    expect(screen.getByText(/Aviso de Privacidade e Conformidade LGPD/i)).not.toBeNull();
    expect(screen.getByText(/30 minutos de inatividade/i)).not.toBeNull();
    expect(screen.getByText(/proibido registrar códigos CID/i)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('9. SelfHostedDomainEngine respeita SESSION_TTL_HOURS configurável (limites 1h..24h)', () => {
    const storage = new InMemoryStorageDriver();
    const engine8h = new SelfHostedDomainEngine(storage, undefined, { sessionTtlHours: 8 });
    expect(engine8h.getSessionTtlSeconds()).toBe(8 * 3600);

    const engineFallback = new SelfHostedDomainEngine(storage, undefined, { sessionTtlHours: 999 });
    expect(engineFallback.getSessionTtlSeconds()).toBe(12 * 3600);
  });

  it('10. PrivacyNoticeModal exibe canal DPO configurado e interface empacota fontes localmente sem CDN Google', () => {
    const onClose = vi.fn();
    render(React.createElement(PrivacyNoticeModal, { open: true, onClose, dpoContato: 'dpo@empresa-exemplo.local' }));
    expect(screen.getByText(/Canal configurado:/i)).not.toBeNull();
    expect(screen.getByText(/dpo@empresa-exemplo\.local/i)).not.toBeNull();

    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
    const swJs = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf-8');
    const mainTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/main.tsx'), 'utf-8');

    expect(indexHtml).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/i);
    expect(swJs).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|isGoogleFonts/i);
    expect(mainTsx).toContain('@fontsource/montserrat/');
    expect(mainTsx).toContain('@fontsource/source-sans-3/');
  });

  it('11. SelfHostedDomainEngine anonimizarTecnicoLgpd e executarRetencaoLgpd protegem RBAC, limpam PII e registram auditoria WORM', async () => {
    const storage = new InMemoryStorageDriver();
    const engine = new SelfHostedDomainEngine(storage);

    await storage.upsertMany(
      'tecnicos',
      [{ matricula: '8888', nome: 'Nome Original Sensivel', funcao: 'Instrumentista' }],
      ['matricula']
    );
    await storage.upsertMany(
      'carteira_operacoes',
      [
        {
          id: 'op-1',
          portal_id: 'P-1',
          matricula: '8888',
          chave_petrobras: '',
          nome: 'Nome Original Sensivel',
          empresa: 'Infotec',
          estrutura: 'Mero',
          unidade_negocio: 'Búzios (UN-BUZ)',
          plataforma_sigla: 'FPSO',
          data_inicio: '2026-01-01',
          data_fim: '2026-01-14',
          ordem: '9001',
          operacao: '0010',
          status_processamento: 'OK',
          prioridade: 'Regular',
          status_programacao: 'Carteira',
          hh_programado: 44,
          hh_confirmado: 44,
          recursos: 1,
          fonte: 'SAP'
        }
      ],
      ['matricula', 'data_inicio', 'ordem', 'operacao']
    );
    await storage.upsertMany(
      'justificativas',
      [
        {
          id: 'j-old',
          matricula: '9999',
          data: '2018-03-15',
          motivo: 'Outros',
          horas_gangway: 0,
          descricao: 'Observacao operacional antiga',
          responsavel_nome: 'Gestor'
        },
        {
          id: 'j-8888',
          matricula: '8888',
          data: '2026-05-01',
          motivo: 'Outros',
          horas_gangway: 0,
          descricao: 'Detalhe textual do colaborador 8888',
          responsavel_nome: 'Gestor'
        }
      ],
      ['matricula', 'data']
    );

    const gestorActor: AuthenticatedActor = {
      id: 'usr-gestor',
      email: 'gestor@teste.local',
      nome: 'Gestor Teste',
      role: 'gestor',
      ativo: true,
      sessionId: 'sess-g',
      csrfToken: 'csrf-g'
    };
    const adminActor: AuthenticatedActor = {
      id: 'usr-admin',
      email: 'admin@teste.local',
      nome: 'Admin Teste',
      role: 'admin',
      ativo: true,
      sessionId: 'sess-a',
      csrfToken: 'csrf-a'
    };

    await expect(engine.anonimizarTecnicoLgpd(gestorActor, '8888')).rejects.toThrow(/Acesso negado/i);
    await expect(engine.executarRetencaoLgpd(gestorActor, 5, 12)).rejects.toThrow(/Acesso negado/i);
    await expect(engine.executarRetencaoLgpd(adminActor, 2, 12)).rejects.toThrow(/mínimo de retenção operacional/i);
    await expect(engine.executarRetencaoLgpd(adminActor, 5, 3)).rejects.toThrow(/mínimo de retenção de IPs/i);

    const anonRes = await engine.anonimizarTecnicoLgpd(adminActor, '8888', '10.0.0.1');
    expect(anonRes.ok).toBe(true);
    expect(anonRes.operacoes_anonimizadas).toBe(1);
    expect(anonRes.justificativas_higienizadas).toBe(1);

    const tecAfter = await storage.findOne<any>('tecnicos', { matricula: '8888' });
    expect(tecAfter.nome).toBe('Técnico Anonimizado (LGPD)');
    const opsAfter = await storage.findMany<any>('carteira_operacoes', { filter: { matricula: '8888' } });
    expect(opsAfter[0].nome).toBe('Técnico Anonimizado (LGPD)');
    expect(opsAfter[0].hh_programado).toBe(44);

    const retRes = await engine.executarRetencaoLgpd(adminActor, 5, 12, '10.0.0.1');
    expect(retRes.ok).toBe(true);
    expect(retRes.justificativas_higienizadas).toBe(1);

    const oldJustAfter = await storage.findOne<any>('justificativas', { matricula: '9999' });
    expect(oldJustAfter.descricao).toBe('[Expurgado por retenção LGPD]');

    const auditLogs = await engine.fetchAuditLogs(adminActor, { limit: 10 });
    expect(auditLogs.some(l => l.action === 'lgpd_anonymization')).toBe(true);
    expect(auditLogs.some(l => l.action === 'lgpd_retention_executed')).toBe(true);
  });

  it('12. Documentação formal LGPD (ROPA, RIPD, Resposta a Incidentes) e workflows de DR/Retenção existem sem PII', () => {
    const requiredFiles = [
      'docs/lgpd/ROPA_REGISTRO_OPERACOES.md',
      'docs/lgpd/RIPD_RELATORIO_IMPACTO.md',
      'docs/lgpd/PLANO_RESPOSTA_INCIDENTES_E_TITULARES.md',
      '.github/workflows/database-backup-verify.yml',
      '.github/workflows/lgpd-retention-monthly.yml'
    ];
    for (const rel of requiredFiles) {
      const fullPath = path.resolve(process.cwd(), rel);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content).not.toMatch(/@infotecbrasil\.com\.br/i);
      expect(content).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    }
  });
});
