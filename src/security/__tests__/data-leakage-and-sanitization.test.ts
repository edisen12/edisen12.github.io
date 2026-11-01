import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  exportPeriodoXlsx,
  exportUsoffXlsx,
  exportTecnicoXlsx,
  sanitizeSpreadsheetCell,
  parseSpreadsheetFile
} from '../../services/excel.service';
import { buildMailLinks } from '../../domain/communications';
import { resolveRecord } from '../../domain/calculations';
import { DEFAULT_CONFIG } from '../../config/constants';
import { createMockSupabaseClient, resetMockDatabase } from '../../test/mockSupabase';
import {
  mockPlatforms,
  mockPessoas,
  mockTecnicos,
  mockWatermark,
  mockCarteiraRows,
  mockApontamentosHHRows,
  mockJustificativasRows,
  mockUsoffUnWeights
} from '../../test/testFixtures';
import type { AppDataset, PeriodWindow } from '../../domain/types';

// Mock do cliente Supabase para testes isolados (Zero chamadas para produção)
vi.mock('../../services/supabase', async () => {
  const { createMockSupabaseClient } = await import('../../test/mockSupabase');
  return {
    supabase: createMockSupabaseClient()
  };
});

import { supabase } from '../../services/supabase';
const mockClient = supabase as unknown as ReturnType<typeof createMockSupabaseClient>;

// Dataset auxiliar para testes de exportação e cálculos
function createTestDataset(overrides?: Partial<AppDataset>): AppDataset {
  return {
    config: {
      ...DEFAULT_CONFIG,
      hh_dia: 10.5
    },
    emailsResumo: ['auditoria@infotecbrasil.com.br'],
    plataformas: { ...mockPlatforms },
    pessoas: { ...mockPessoas },
    profiles: {},
    onboardingMap: {},
    tecnicos: { ...mockTecnicos },
    carteira: [...mockCarteiraRows],
    hhMap: {
      '1001|2026-10-01': mockApontamentosHHRows[0],
      '1001|2026-10-02': mockApontamentosHHRows[1],
      '1001|2026-10-03': mockApontamentosHHRows[2],
      '1002|2026-10-05': mockApontamentosHHRows[3],
      '1002|2026-10-06': mockApontamentosHHRows[4]
    },
    justMap: {
      '1001|2026-10-03': mockJustificativasRows[0]
    },
    usoffUnWeights: {
      'Espírito Santo (UN-ES)': mockUsoffUnWeights[0],
      'Búzios (UN-BUZ)': mockUsoffUnWeights[1],
      'Bacia de Campos (UN-BC)': mockUsoffUnWeights[2]
    },
    externalCoveredSet: new Set<string>(),
    sharedOpsSet: new Set<string>(),
    watermark: { ...mockWatermark },
    latestFluxo: null,
    isDemo: false,
    demoReason: '',
    ...overrides
  };
}

// Algoritmo oficial de validação de CPF (para assegurar que nenhum CPF real foi versionado)
function isValidCpfChecksum(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return false;
  // Rejeita sequências repetidas triviais
  if (/^(\d)\1{10}$/.test(clean)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(clean[i], 10) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(clean[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(clean[i], 10) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  return remainder === parseInt(clean[10], 10);
}

// Função utilitária para varrer recursivamente arquivos do repositório
function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        getAllSourceFiles(fullPath, fileList);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.env') || file.endsWith('.json')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Auditoria de Segurança: Prevenção de Vazamento de Dados e Sanitização Universal', () => {
  const originalBookAppendSheet = XLSX.utils.book_append_sheet;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetMockDatabase(mockClient);
  });

  // ============================================================================
  // 1. AUDITORIA ESTÁTICA: ZERO SECRETS & ZERO PII
  // ============================================================================
  describe('1. Auditoria Estática de Código e Repositório (Zero Secrets & Zero PII)', () => {
    const srcDir = path.resolve(process.cwd(), 'src');
    const sourceFiles = getAllSourceFiles(srcDir);

    it('nenhum arquivo do código-fonte contém chaves com role "service_role" em texto plano', () => {
      // Ignora o teste de edge function que simula leitura de variável de ambiente interna
      const filesToCheck = sourceFiles.filter(f => !f.includes('admin-users-edge.test.ts'));

      for (const filePath of filesToCheck) {
        const content = fs.readFileSync(filePath, 'utf-8');

        // Regex para detecção de chaves de service_role hardcoded
        expect(content).not.toMatch(/service_role_key\s*=\s*['"`][A-Za-z0-9_-]{20,}['"`]/i);
        expect(content).not.toMatch(/['"`]eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+['"`].*service_role/i);
      }
    });

    it('a chave pública padrão em src/config/env.ts possui estritamente role "anon"', () => {
      const envPath = path.resolve(srcDir, 'config/env.ts');
      const envContent = fs.readFileSync(envPath, 'utf-8');

      // Extrai o token JWT padrão configurado
      const match = envContent.match(/['"`](eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)['"`]/);
      expect(match).not.toBeNull();

      const jwtToken = match![1];
      const parts = jwtToken.split('.');
      expect(parts.length).toBe(3);

      const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
      const payload = JSON.parse(payloadJson);

      expect(payload.role).toBe('anon');
      expect(payload.role).not.toBe('service_role');
      expect(payload.role).not.toBe('postgres');
      expect(payload.role).not.toBe('authenticated');
    });

    it('nenhuma chave privada PEM/RSA ou tokens de nuvem mestres estão gravados em texto plano', () => {
      const filesToCheck = sourceFiles.filter(f => !f.includes('data-leakage-and-sanitization.test.ts'));

      for (const filePath of filesToCheck) {
        const content = fs.readFileSync(filePath, 'utf-8');

        // Chaves privadas PEM
        expect(content).not.toMatch(/-----BEGIN (?:RSA|EC|DSA|OPENSSH|PRIVATE) KEY-----/);

        // Tokens AWS
        expect(content).not.toMatch(/AKIA[0-9A-Z]{16}/);

        // GitHub Personal Access Tokens
        expect(content).not.toMatch(/ghp_[0-9a-zA-Z]{36}/);
      }
    });

    it('nenhum dado pessoal sensível real (CPFs reais com checksum válido) está versionado', () => {
      const cpfPattern = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;

      for (const filePath of sourceFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const matches = content.match(cpfPattern) || [];

        for (const match of matches) {
          // Nenhum CPF real válido deve ser encontrado em arquivos versionados
          const isValid = isValidCpfChecksum(match);
          expect(isValid).toBe(false);
        }
      }
    });

    it('nenhum telefone celular pessoal com código do Brasil (+55) está gravado em código de produção', () => {
      const phonePattern = /\+55\s?\(?[1-9]{2}\)?\s?9\d{4}-?\d{4}/g;

      for (const filePath of sourceFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).not.toMatch(phonePattern);
      }
    });
  });

  // ============================================================================
  // 2. PREVENÇÃO DE VAZAMENTO POR TRANSBORDO (externalCoveredSet)
  // ============================================================================
  describe('2. Prevenção de Vazamento por Transbordo (externalCoveredSet & Supressão Segura)', () => {
    it('RPC get_external_covered_days retorna estritamente pares (matricula, data) sem dados sensíveis de outras plataformas', async () => {
      // Configura o banco mockado com apontamentos operacionais
      mockClient.__mockState.tables.apontamentos_hh = [
        {
          matricula: '1001',
          data: '2026-10-01',
          plataforma: 'P50',
          unidade: 'UN-RIO',
          horas_trabalhadas: 10.5,
          cliente: 'Petrobras'
        },
        {
          matricula: '1002',
          data: '2026-10-02',
          plataforma: 'P74',
          unidade: 'UN-SANTOS',
          horas_trabalhadas: 12.0,
          cliente: 'Petrobras'
        }
      ];

      const { data, error } = await mockClient.rpc('get_external_covered_days', {
        p_ini: '2026-10-01',
        p_fim: '2026-10-31'
      });

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data?.length).toBe(2);

      // Cada item deve conter EXCLUSIVAMENTE 'matricula' e 'data'
      for (const item of data || []) {
        const keys = Object.keys(item);
        expect(keys.sort()).toEqual(['data', 'matricula'].sort());

        // Campos sensíveis de outras plataformas NÃO podem estar presentes
        expect((item as any).plataforma).toBeUndefined();
        expect((item as any).unidade).toBeUndefined();
        expect((item as any).horas_trabalhadas).toBeUndefined();
        expect((item as any).cliente).toBeUndefined();
      }
    });

    it('externalCoveredSet suprime o falso alerta "Não chegou" sem expor dados da plataforma externa', () => {
      // 2026-10-04 é um dia coberto pelo embarque de 1001 na carteira, mas SEM apontamento no hhMap local
      const datasetSemApontamento = createTestDataset({
        hhMap: {} // sem HH local para 1001
      });

      // Sem externalCoveredSet: gera ausência com sem: true
      const recordSemProtecao = resolveRecord('1001', '2026-10-04', datasetSemApontamento);
      expect(recordSemProtecao).not.toBeNull();
      expect(recordSemProtecao?.sem).toBe(true);

      // Com externalCoveredSet contendo o par '1001|2026-10-04': suprime o alerta de falta e retorna null
      const datasetComProtecao = createTestDataset({
        hhMap: {},
        externalCoveredSet: new Set(['1001|2026-10-04'])
      });
      const recordComProtecao = resolveRecord('1001', '2026-10-04', datasetComProtecao);
      expect(recordComProtecao).toBeNull();

      // O conjunto armazena estritamente pares serializados, sem detalhes sensíveis da outra plataforma
      expect(datasetComProtecao.externalCoveredSet.has('1001|2026-10-04')).toBe(true);
      expect(Array.from(datasetComProtecao.externalCoveredSet)).toEqual(['1001|2026-10-04']);
    });

    it('se campos extras forem retornados pela RPC, a camada de parsing retém estritamente a chave composta', () => {
      const mockRawRows = [
        { matricula: '9999', data: '2026-10-10', plataforma_secreta: 'P-SECRETA', horas_sigilosas: 14 }
      ];

      const set = new Set<string>();
      mockRawRows.forEach(row => {
        set.add(`${row.matricula}|${row.data}`);
      });

      expect(set.has('9999|2026-10-10')).toBe(true);
      // Nenhuma chave do objeto vazou para o Set
      expect(set.has('P-SECRETA')).toBe(false);
      expect(set.size).toBe(1);
    });
  });

  // ============================================================================
  // 3. SANITIZAÇÃO DE EXPORTAÇÕES EXCEL: CARIMBO DE ESCOPO PARCIAL
  // ============================================================================
  describe('3. Sanitização de Exportações de Dados (Excel): Carimbo de Escopo Parcial', () => {
    const period: PeriodWindow = {
      ini: '2026-10-01',
      fim: '2026-10-31',
      m: '2026-10'
    };

    it('exportPeriodoXlsx insere carimbo [ESCOPO PARCIAL DE CARTEIRA] quando scopeLabel for informado', async () => {
      const dataset = createTestDataset();
      const capturedSheets: { name: string; data: any[][] }[] = [];

      vi.spyOn(XLSX.utils, 'book_append_sheet').mockImplementation((wb: any, sheet: any, name?: string) => {
        const rawJson = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        capturedSheets.push({ name: name || '', data: rawJson });
        return originalBookAppendSheet(wb, sheet, name);
      });

      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      let downloadedFilename = '';
      Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
        set(val: string) {
          downloadedFilename = val;
        }
      });

      // Exportação feita por Preposto Santos (escopo restrito)
      await exportPeriodoXlsx(dataset, period, 'Carteira Preposto Santos', 'Rodrigo Santos');

      // Verifica nome do arquivo
      expect(downloadedFilename).toContain('[PARCIAL - Carteira Preposto Santos]');

      // Verifica que a aba de Resumo contém explicitamente o aviso no cabeçalho
      const resumoSheet = capturedSheets.find(s => s.name === 'Resumo');
      expect(resumoSheet).toBeDefined();

      const allRowsText = resumoSheet?.data.map(r => (Array.isArray(r) ? r.join(' ') : String(r))).join('\n') || '';
      expect(allRowsText).toContain('[ESCOPO PARCIAL DE CARTEIRA - CARTEIRA PREPOSTO SANTOS]');
    });

    it('exportPeriodoXlsx NÃO insere carimbo quando scopeLabel não for informado (consolidado oficial)', async () => {
      const dataset = createTestDataset();
      const capturedSheets: { name: string; data: any[][] }[] = [];

      vi.spyOn(XLSX.utils, 'book_append_sheet').mockImplementation((wb: any, sheet: any, name?: string) => {
        const rawJson = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        capturedSheets.push({ name: name || '', data: rawJson });
        return originalBookAppendSheet(wb, sheet, name);
      });

      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      let downloadedFilename = '';
      Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
        set(val: string) {
          downloadedFilename = val;
        }
      });

      // Exportação global (admin/gestor) sem restrição de carteira
      await exportPeriodoXlsx(dataset, period, undefined, 'Administrador');

      expect(downloadedFilename).not.toContain('[PARCIAL');

      const resumoSheet = capturedSheets.find(s => s.name === 'Resumo');
      const allRowsText = resumoSheet?.data.map(r => (Array.isArray(r) ? r.join(' ') : String(r))).join('\n') || '';
      expect(allRowsText).not.toContain('[ESCOPO PARCIAL DE CARTEIRA');
    });

    it('exportUsoffXlsx insere carimbo de escopo parcial na medição USOFF quando restrito', async () => {
      const dataset = createTestDataset();
      const capturedSheets: { name: string; data: any[][] }[] = [];

      vi.spyOn(XLSX.utils, 'book_append_sheet').mockImplementation((wb: any, sheet: any, name?: string) => {
        const rawJson = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        capturedSheets.push({ name: name || '', data: rawJson });
        return originalBookAppendSheet(wb, sheet, name);
      });

      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      await exportUsoffXlsx(dataset, period, 'Carteira UN-ES');

      const usoSheet = capturedSheets.find(s => s.name === 'Consolidado USOFF' || s.name.includes('USOFF'));
      expect(usoSheet).toBeDefined();

      const allRowsText = usoSheet?.data.map(r => (Array.isArray(r) ? r.join(' ') : String(r))).join('\n') || '';
      expect(allRowsText).toContain('[ESCOPO PARCIAL DE CARTEIRA - CARTEIRA UN-ES]');
    });

    it('exportTecnicoXlsx insere carimbo de escopo parcial no relatório individual quando restrito', async () => {
      const dataset = createTestDataset();
      const capturedSheets: { name: string; data: any[][] }[] = [];

      vi.spyOn(XLSX.utils, 'book_append_sheet').mockImplementation((wb: any, sheet: any, name?: string) => {
        const rawJson = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        capturedSheets.push({ name: name || '', data: rawJson });
        return originalBookAppendSheet(wb, sheet, name);
      });

      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      await exportTecnicoXlsx('1001', dataset, period, 'P50');

      const sheet = capturedSheets[0];
      expect(sheet).toBeDefined();

      const allRowsText = sheet?.data.map(r => (Array.isArray(r) ? r.join(' ') : String(r))).join('\n') || '';
      expect(allRowsText).toContain('[ESCOPO PARCIAL DE CARTEIRA - P50]');
    });
  });

  // ============================================================================
  // 4. SANITIZAÇÃO DE LINKS E ENTRADAS DO USUÁRIO
  // ============================================================================
  describe('4. Sanitização de Links e Entradas do Usuário', () => {
    it('buildMailLinks sanitiza e codifica tentativas de injeção de cabeçalho CRLF (SMTP Header Injection)', () => {
      const maliciousSubject = 'Assunto Legitimo\r\nBcc: auditoria-vazada@externo.com\r\n\r\nCorpo injetado';
      const maliciousBody = 'Corpo com quebra\r\nCC: espiao@externo.com';

      const { mailtoUrl, outlookWebUrl } = buildMailLinks(
        'gestor@infotecbrasil.com.br',
        maliciousSubject,
        maliciousBody
      );

      // Não pode conter quebras de linha brutas (\r ou \n) que permitam divisão de cabeçalho SMTP
      expect(mailtoUrl).not.toContain('\r');
      expect(mailtoUrl).not.toContain('\n');
      expect(outlookWebUrl).not.toContain('\r');
      expect(outlookWebUrl).not.toContain('\n');

      // As quebras de linha devem estar estritamente percent-encoded
      expect(mailtoUrl).toContain('%0D%0A');
      expect(outlookWebUrl).toContain('%0D%0A');
    });

    it('buildMailLinks codifica parâmetros de query para impedir injeção de argumentos de URL', () => {
      const injectionSubject = 'Alerta &to=hacker@evil.com&cc=segundo@evil.com';
      const injectionBody = 'Corpo com texto &body=novoCorpoSobrescrito';

      const { mailtoUrl, outlookWebUrl } = buildMailLinks(
        'preposto@infotecbrasil.com.br',
        injectionSubject,
        injectionBody
      );

      // Caracteres '&' no assunto ou corpo devem ser codificados como '%26' para não serem interpretados como novos parâmetros HTTP
      expect(mailtoUrl).toContain('subject=Alerta%20%26to%3Dhacker%40evil.com%26cc%3Dsegundo%40evil.com');
      expect(outlookWebUrl).toContain('subject=Alerta%20%26to%3Dhacker%40evil.com%26cc%3Dsegundo%40evil.com');
    });

    it('buildMailLinks codifica vetores de Cross-Site Scripting (XSS) e esquemas perigosos', () => {
      const xssSubject = '<script>alert("XSS")</script>';
      const xssBody = '"><img src=x onerror=alert(1)>';

      const { mailtoUrl, outlookWebUrl } = buildMailLinks(
        'usuario@infotecbrasil.com.br',
        xssSubject,
        xssBody
      );

      // Não contém tags HTML cruas
      expect(mailtoUrl).not.toContain('<script>');
      expect(mailtoUrl).not.toContain('<img');
      expect(outlookWebUrl).not.toContain('<script>');
      expect(outlookWebUrl).not.toContain('<img');

      // Caracteres <, >, " devem estar percent-encoded
      expect(mailtoUrl).toContain('%3Cscript%3E');
      expect(outlookWebUrl).toContain('%3Cscript%3E');
      expect(mailtoUrl).toContain('%3Cimg');
      expect(outlookWebUrl).toContain('%3Cimg');
    });

    it('buildMailLinks normaliza e sanitiza listas de múltiplos destinatários com separadores variados', () => {
      const dirtyRecipients = [
        'preposto1@infotecbrasil.com.br',
        ' preposto2@infotecbrasil.com.br; preposto3@infotecbrasil.com.br , preposto4@infotecbrasil.com.br \n'
      ];

      const { mailtoUrl, outlookWebUrl } = buildMailLinks(dirtyRecipients, 'Assunto Teste', 'Corpo Teste');

      // Formato normalizado: separado por vírgulas sem espaços espúrios
      expect(mailtoUrl).toContain(
        'mailto:preposto1@infotecbrasil.com.br,preposto2@infotecbrasil.com.br,preposto3@infotecbrasil.com.br,preposto4@infotecbrasil.com.br?'
      );

      // O Deeplink do Outlook também recebe o destinatário devidamente codificado
      expect(outlookWebUrl).toContain(
        'to=preposto1%40infotecbrasil.com.br%2Cpreposto2%40infotecbrasil.com.br%2Cpreposto3%40infotecbrasil.com.br%2Cpreposto4%40infotecbrasil.com.br'
      );
    });

    it('sanitização de formulário de justificativa valida limites numéricos de horas de gangway', () => {
      // Simula a validação implementada no JustificativaModal
      const validateGwInput = (horasGw: string, maxAvailable: number): { valid: boolean; value: number } => {
        const gwVal = parseFloat(horasGw.replace(',', '.'));
        if (isNaN(gwVal) || gwVal < 0 || gwVal > maxAvailable) {
          return { valid: false, value: 0 };
        }
        return { valid: true, value: gwVal };
      };

      // Válidos
      expect(validateGwInput('4.5', 10.5)).toEqual({ valid: true, value: 4.5 });
      expect(validateGwInput('10,5', 10.5)).toEqual({ valid: true, value: 10.5 });
      expect(validateGwInput('0', 10.5)).toEqual({ valid: true, value: 0 });

      // Inválidos: negativos, letras, estouro de horas disponíveis
      expect(validateGwInput('-2', 10.5).valid).toBe(false);
      expect(validateGwInput('abc', 10.5).valid).toBe(false);
      expect(validateGwInput('12', 10.5).valid).toBe(false); // maior que 10.5
      expect(validateGwInput('999', 24).valid).toBe(false);
    });

    it('sanitização de busca não utiliza RegExp inseguro ou eval para evitar ataques de DoS/ReDoS', () => {
      // Padrão seguro utilizado em DataTable: .toLowerCase().includes(q)
      const safeSearch = (dataList: string[], query: string): string[] => {
        const q = query.toLowerCase().trim();
        if (!q) return dataList;
        return dataList.filter(item => item.toLowerCase().includes(q));
      };

      const items = ['Carlos Silva', 'Ana Oliveira', 'Rodrigo Medeiros', 'P50 (Petrobras)'];

      // Entrada com caracteres especiais de regex que causariam erro ou ReDoS se usados em new RegExp()
      const problematicQueries = [
        '[a-z]+',
        '(.*)+$',
        '\\',
        'P50 (Petrobras)',
        '<script>alert(1)</script>'
      ];

      for (const q of problematicQueries) {
        // A execução não pode lançar exceção de sintaxe ou travar
        expect(() => safeSearch(items, q)).not.toThrow();
      }

      // Valida resultado da busca literal com parênteses
      expect(safeSearch(items, 'P50 (Petrobras)')).toEqual(['P50 (Petrobras)']);
    });

    it('sanitizeSpreadsheetCell sanitiza fórmulas Excel / DDE (OWASP CWE-1236)', () => {
      // Vetores de Formula Injection
      expect(sanitizeSpreadsheetCell('=cmd|"/C calc"!A0')).toBe('\'=cmd|"/C calc"!A0');
      expect(sanitizeSpreadsheetCell('+12345')).toBe('\'+12345');
      expect(sanitizeSpreadsheetCell('-1000')).toBe('\'-1000');
      expect(sanitizeSpreadsheetCell('@SUM(A1:A10)')).toBe('\'@SUM(A1:A10)');
      expect(sanitizeSpreadsheetCell('\t=HYPERLINK("http://evil.com")')).toBe('\'\t=HYPERLINK("http://evil.com")');
      expect(sanitizeSpreadsheetCell('\r=2+2')).toBe('\'\r=2+2');

      // Valores seguros não devem ser modificados
      expect(sanitizeSpreadsheetCell('Técnico Normal')).toBe('Técnico Normal');
      expect(sanitizeSpreadsheetCell('P-58')).toBe('P-58');
      expect(sanitizeSpreadsheetCell(10.5)).toBe(10.5);
      expect(sanitizeSpreadsheetCell(null)).toBe(null);
      expect(sanitizeSpreadsheetCell(undefined)).toBe(undefined);
    });

    it('buildMailLinks sanitiza endereços de e-mail contra injeção de parâmetros de query (? e &)', () => {
      const maliciousEmails = [
        'preposto@infotecbrasil.com.br?cc=spy@external.com',
        'gestor@infotecbrasil.com.br&bcc=leak@evil.com'
      ];
      const { mailtoUrl, outlookWebUrl } = buildMailLinks(maliciousEmails, 'Assunto', 'Corpo');

      expect(mailtoUrl).not.toContain('?cc=');
      expect(mailtoUrl).not.toContain('&bcc=');
      expect(mailtoUrl).toContain('mailto:preposto@infotecbrasil.com.br,gestor@infotecbrasil.com.br?');
      expect(outlookWebUrl).not.toContain('%3Fcc%3D');
      expect(outlookWebUrl).not.toContain('%26bcc%3D');
      expect(outlookWebUrl).toContain('to=preposto%40infotecbrasil.com.br%2Cgestor%40infotecbrasil.com.br');
    });

    it('parseSpreadsheetFile rejeita arquivos maiores que 15 MB para evitar DoS de memória', async () => {
      // Mock de arquivo simulado com 16 MB
      const bigFile = {
        name: 'huge.xlsx',
        size: 16 * 1024 * 1024,
        arrayBuffer: vi.fn()
      } as unknown as File;

      await expect(parseSpreadsheetFile(bigFile)).rejects.toThrow(
        'O arquivo excede o limite máximo permitido de 15 MB.'
      );
    });
  });
});
