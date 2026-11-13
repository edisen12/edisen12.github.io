import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { AppDataset, PeriodWindow } from '../../domain/types';
import {
  mockContractConfig,
  mockPlatforms,
  mockPessoas,
  mockTecnicos,
  mockCarteiraRows,
  mockApontamentosHHRows,
  mockJustificativasRows,
  mockUsoffUnWeights,
  mockWatermark
} from '../../test/testFixtures';
import {
  guessImportKind,
  mapColumns,
  parseSpreadsheetFile,
  rebuildPreviewRows,
  sanitizeSpreadsheetCell,
  exportPeriodoXlsx,
  exportTecnicoXlsx,
  exportUsoffXlsx,
  exportUsoffPortalOffshoreXlsx,
  exportModeloXlsx,
  exportConfrontoSAPXlsx,
  exportPainelDiaOrdensXlsx
} from '../excel.service';
import { buildPlatformIndex, mergeConfrontoOperations } from '../../domain/calculations';
import { computeUsoffOperations, summarizeUsoff } from '../../domain/usoff';

/**
 * Cria em memória um arquivo File contendo uma planilha Excel válida gerada pelo SheetJS
 */
function createExcelFile(
  sheetData: any[][],
  fileName = 'planilha_teste.xlsx',
  sheetName = 'Dados'
): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const u8 = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([u8], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

function createTestDataset(overrides?: Partial<AppDataset>): AppDataset {
  return {
    config: { ...mockContractConfig },
    usoffUnWeights: {
      'Espírito Santo (UN-ES)': mockUsoffUnWeights[0],
      'Búzios (UN-BUZ)': mockUsoffUnWeights[1],
      'Bacia de Campos (UN-BC)': mockUsoffUnWeights[2]
    },
    emailsResumo: ['gestor.teste@empresa.com.br'],
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
    externalCoveredSet: new Set<string>(),
    sharedOpsSet: new Set<string>(),
    watermark: { ...mockWatermark },
    latestFluxo: null,
    isDemo: false,
    demoReason: '',
    ...overrides
  };
}

describe('Excel Service - Importação Heurística, Parsing Universal e Exportações Oficiais', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Detecção e Mapeamento Heurístico de Cabeçalhos', () => {
    it('guessImportKind detecta tipo "cart" quando houver palavras de embarque/desembarque sem executado', () => {
      const headersCart = ['Matrícula', 'Nome', 'Plataforma', 'Embarque', 'Desembarque', 'Horas Prog'];
      expect(guessImportKind(headersCart)).toBe('cart');

      const headersSubidaDesembarque = ['Matrícula', 'Nome', 'Plataforma', 'Desembarque'];
      expect(guessImportKind(headersSubidaDesembarque)).toBe('cart');
    });

    it('guessImportKind detecta tipo "hh" quando houver apontamento/execução ou como fallback seguro', () => {
      const headersHH = ['Matrícula', 'Data', 'Plataforma', 'HH Executado'];
      expect(guessImportKind(headersHH)).toBe('hh');

      const headersGenerico = ['Matrícula', 'Data', 'Nome'];
      expect(guessImportKind(headersGenerico)).toBe('hh');
    });

    it('mapColumns mapeia colunas com tolerância a maiúsculas, minúsculas, acentuação e sinônimos operacionais', () => {
      // Teste para HH
      const headersHH = ['CHAPA', 'NOME DO COLABORADOR', 'CARGO', 'UNIDADE MARÍTIMA', 'REGIONAL', 'DIA', 'REALIZADO'];
      const mapHH = mapColumns(headersHH, 'hh');

      expect(mapHH.mat).toBe(0);
      expect(mapHH.nome).toBe(1);
      expect(mapHH.funcao).toBe(2);
      expect(mapHH.p).toBe(3);
      expect(mapHH.r).toBe(4);
      expect(mapHH.D).toBe(5);
      expect(mapHH.e).toBe(6);

      // Teste para Carteira
      const headersCart = ['REGISTRO', 'TECNICO', 'PLATAFORMA', 'BACIA', 'SUBIDA', 'RETORNO', 'PROGRAMAD', 'COD. OP', 'POND. PROG', 'POND. EXEC'];
      const mapCart = mapColumns(headersCart, 'cart');

      expect(mapCart.mat).toBe(0);
      expect(mapCart.nome).toBe(1);
      expect(mapCart.plat).toBe(2);
      expect(mapCart.reg).toBe(3);
      expect(mapCart.ini).toBe(4);
      expect(mapCart.fim).toBe(5);
      expect(mapCart.hp).toBe(6);
      expect(mapCart.op).toBe(7);
      expect(mapCart.pe).toBe(8);
      expect(mapCart.ex).toBe(9);

      // Teste para Plataformas
      const headersPlat = ['CÓDIGO', 'DESCRICAO', 'REGIONAL', 'EMPRESA', 'CATEGORIA'];
      const mapPlat = mapColumns(headersPlat, 'plat');
      expect(mapPlat.sigla).toBe(0);
      expect(mapPlat.nome).toBe(1);
      expect(mapPlat.un).toBe(2);
      expect(mapPlat.armador).toBe(3);
      expect(mapPlat.tipo).toBe(4);

      // Teste para Pessoas
      const headersPes = ['PESSOA', 'PERFIL', 'MAIL', 'PLATAFORMA', 'UNIDADE'];
      const mapPes = mapColumns(headersPes, 'pes');
      expect(mapPes.nome).toBe(0);
      expect(mapPes.papel).toBe(1);
      expect(mapPes.email).toBe(2);
      expect(mapPes.plats).toBe(3);
      expect(mapPes.uns).toBe(4);
    });
  });

  describe('2. Parsing Universal via parseSpreadsheetFile', () => {
    it('processa planilha de Apontamentos HH extraindo linhas válidas e acumulando erros em linhas corrompidas', async () => {
      const dataHH = [
        ['', '', ''], // Linha em branco inicial para testar tolerância
        ['Matrícula', 'Nome', 'Função', 'Plataforma', 'Regional', 'Data', 'HH Executado'],
        ['1001', 'Carlos Silva', 'Técnico Automação', 'P-50', 'UN-ES', '01/10/2026', '12:00'],
        ['1002', 'Mariana Costa', 'Instrumentista', 'P-74', 'UN-BUZ', '02/10/2026', '8,5'],
        ['1003', 'Invalido Data', 'Mecânico', 'P-25', 'UN-BC', 'DATA_INVALIDA', '10'], // Erro de data
        ['1004', 'Invalido Hora', 'Elétrica', 'P-58', 'UN-ES', '03/10/2026', 'NAO_NUMERICO'] // Erro de HH
      ];

      const file = createExcelFile(dataHH, 'apontamentos_hh.xlsx');
      const preview = await parseSpreadsheetFile(file);

      expect(preview.kind).toBe('hh');
      expect(preview.rows.length).toBe(2);
      expect(preview.rows[0].mat).toBe('1001');
      expect(preview.rows[0].D).toBe('2026-10-01');
      expect(preview.rows[0].e).toBe(12);

      expect(preview.rows[1].mat).toBe('1002');
      expect(preview.rows[1].D).toBe('2026-10-02');
      expect(preview.rows[1].e).toBe(8.5);

      // Duas linhas com erros acumulados
      expect(preview.errors.length).toBe(2);
      expect(preview.errors[0]).toContain('data inválida');
      expect(preview.errors[1]).toContain('HH executado vazio ou inválido');
    });

    it('processa planilha de Carteira de Embarques validando intervalo de datas', async () => {
      const dataCart = [
        ['Matrícula', 'Nome', 'Função', 'Plataforma', 'UN', 'Embarque', 'Desembarque', 'Horas Prog', 'OP'],
        ['1001', 'Carlos Silva', 'Técnico', 'P50', 'UN-ES', '01/10/2026', '14/10/2026', '168', 'OP-100'],
        ['1002', 'Data Invertida', 'Técnico', 'P74', 'UN-BUZ', '20/10/2026', '10/10/2026', '168', 'OP-200'] // Fim < Ini
      ];

      const file = createExcelFile(dataCart, 'carteira.xlsx');
      const preview = await parseSpreadsheetFile(file);

      expect(preview.kind).toBe('cart');
      expect(preview.rows.length).toBe(1);
      expect(preview.rows[0].mat).toBe('1001');
      expect(preview.rows[0].ini).toBe('2026-10-01');
      expect(preview.rows[0].fim).toBe('2026-10-14');
      expect(preview.rows[0].hp).toBe(168);

      expect(preview.errors.length).toBe(1);
      expect(preview.errors[0]).toContain('datas de embarque inválidas');
    });

    it('processa planilha de Catálogo de Plataformas', async () => {
      const dataPlat = [
        ['Sigla', 'Nome', 'Unidade de Negócio', 'Armador', 'Tipo'],
        ['P50', 'P-50 (Albacora Leste)', 'Espírito Santo (UN-ES)', 'Petrobras', 'FPSO'],
        ['P74', 'P-74 (Búzios)', 'Búzios (UN-BUZ)', 'Petrobras', 'FPSO']
      ];

      const file = createExcelFile(dataPlat, 'plataformas.xlsx');
      const preview = await parseSpreadsheetFile(file, 'plat');

      expect(preview.kind).toBe('plat');
      expect(preview.rows.length).toBe(2);
      expect(preview.rows[0].sigla).toBe('P50');
      expect(preview.rows[0].nome).toBe('P-50 (Albacora Leste)');
      expect(preview.rows[0].un).toBe('Espírito Santo (UN-ES)');
      expect(preview.rows[1].sigla).toBe('P74');
    });

    it('processa planilha de Pessoas e Atribuições com separadores múltiplos e mapeamento de papéis', async () => {
      const dataPes = [
        ['Nome', 'Papel', 'E-mail', 'Plataformas', 'Unidades de Negócio'],
        ['Preposto Offshore', 'Preposto', 'preposto@infotec.com.br', 'P50, P74; P58', ''],
        ['Gestor Operacional', 'Gestor', 'gestor@infotec.com.br', '', 'UN-ES | UN-BUZ'],
        ['Controlador Técnico', 'Controlador', 'controlador@infotec.com.br', 'P25', 'UN-BC']
      ];

      const file = createExcelFile(dataPes, 'pessoas.xlsx');
      const preview = await parseSpreadsheetFile(file, 'pes');

      expect(preview.kind).toBe('pes');
      expect(preview.rows.length).toBe(3);

      // Preposto
      expect(preview.rows[0].nome).toBe('Preposto Offshore');
      expect(preview.rows[0].papel).toBe('preposto');
      expect(preview.rows[0].plats).toEqual(expect.arrayContaining(['P50', 'P74', 'P58']));

      // Gestor
      expect(preview.rows[1].nome).toBe('Gestor Operacional');
      expect(preview.rows[1].papel).toBe('gestor');
      expect(preview.rows[1].uns).toEqual(expect.arrayContaining(['UN-ES', 'UN-BUZ']));

      // Controlador
      expect(preview.rows[2].nome).toBe('Controlador Técnico');
      expect(preview.rows[2].papel).toBe('controlador');
      expect(preview.rows[2].plats).toEqual(['P25']);
    });

    it('lança erro explicativo se a planilha não contiver a coluna obrigatória', async () => {
      const dataSemChave = [
        ['Coluna Inútil 1', 'Coluna Inútil 2'],
        ['Dado 1', 'Dado 2']
      ];

      const file = createExcelFile(dataSemChave, 'sem_chave.xlsx');
      await expect(parseSpreadsheetFile(file, 'hh')).rejects.toThrow(
        'Não encontramos a coluna obrigatória de matrícula nesta planilha'
      );
      await expect(parseSpreadsheetFile(file, 'sap')).rejects.toThrow(
        'Não encontramos a coluna obrigatória de matrícula nesta planilha'
      );
    });

    it('processa planilha de Confirmações SAP (kind "sap") extraindo contador e suportando estornos negativos', async () => {
      const dataSap = [
        ['Matricula', 'Data_criacao', 'Data_lancamento', 'Data_fim_real', 'Ordem', 'Operacao', 'Contador_confirmacao', 'HC'],
        ['1001', '10/10/2026', '10/10/2026', '10/10/2026', '20260001', '0010', '00000123', '8,5'],
        ['1001', '11/10/2026', '11/10/2026', '10/10/2026', '20260001', '0010', '00000124', '-2,5']
      ];

      const file = createExcelFile(dataSap, 'confirmacoes_sap.xlsx');
      const preview = await parseSpreadsheetFile(file);

      expect(preview.kind).toBe('sap');
      expect(preview.rows).toHaveLength(2);
      expect(preview.rows[0].mat).toBe('1001');
      expect(preview.rows[0].contador).toBe(123);
      expect(preview.rows[0].hc).toBe(8.5);
      expect(preview.rows[1].contador).toBe(124);
      expect(preview.rows[1].hc).toBe(-2.5);
    });
  });

  describe('3. rebuildPreviewRows (Reavaliação Dinâmica de Mapeamento)', () => {
    it('recalcula as linhas ao trocar o tipo de importação ou colunas mapeadas', async () => {
      const dataMista = [
        ['Matrícula', 'Data', 'Plataforma', 'HH Executado'],
        ['1001', '01/10/2026', 'P50', '12']
      ];

      const file = createExcelFile(dataMista, 'mista.xlsx');
      const initialPreview = await parseSpreadsheetFile(file);
      expect(initialPreview.kind).toBe('hh');
      expect(initialPreview.rows[0].e).toBe(12);

      // Altera mapeamento de forma personalizada
      const updated = rebuildPreviewRows(initialPreview, mockPlatforms);
      expect(updated.rows.length).toBe(1);
      expect(updated.rows[0].mat).toBe('1001');
    });
  });

  describe('4. Exportações Oficiais em Excel com Suporte a Escopo Global e Restrito', () => {
    const period: PeriodWindow = {
      ini: '2026-10-01',
      fim: '2026-10-31',
      m: '2026-10'
    };

    it('exportPeriodoXlsx gera arquivo de medição global sem disclaimer de restrição', async () => {
      const dataset = createTestDataset();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      let downloadedFilename = '';

      Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
        set(val: string) {
          downloadedFilename = val;
        }
      });

      await exportPeriodoXlsx(dataset, period);

      expect(clickSpy).toHaveBeenCalled();
      expect(downloadedFilename).toContain('.xlsx');
      expect(downloadedFilename).toContain('2026-10');
    });

    it('exportPeriodoXlsx inclui disclaimer de escopo parcial quando informado scopeLabel', async () => {
      const dataset = createTestDataset();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      await exportPeriodoXlsx(dataset, period, 'P50, P74', 'Preposto Santos');
      expect(clickSpy).toHaveBeenCalled();
    });

    it('exportTecnicoXlsx exporta relatório detalhado de técnico individual com e sem disclaimer', async () => {
      const dataset = createTestDataset();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      let downloadedFilename = '';

      Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
        set(val: string) {
          downloadedFilename = val;
        }
      });

      // Visão Global
      await exportTecnicoXlsx('1001', dataset, period);
      expect(clickSpy).toHaveBeenCalled();
      expect(downloadedFilename).toContain('Carlos Silva');

      // Visão Parcial / Restrita
      await exportTecnicoXlsx('1001', dataset, period, 'P50');
      expect(clickSpy).toHaveBeenCalledTimes(2);
    });

    it('exportUsoffXlsx gera relatório oficial USOFF agrupado Por embarque (com ID Embarque) e ponderações PE e EX', async () => {
      const dataset = createTestDataset();
      const capturedBlobs: Blob[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
        capturedBlobs.push(obj as Blob);
        return 'blob:mock-usoff';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      await exportUsoffXlsx(dataset, period, 'UN-ES');
      expect(capturedBlobs).toHaveLength(1);
      const wb = XLSX.read(await capturedBlobs[0].arrayBuffer(), { type: 'array' });
      expect(wb.SheetNames).toEqual(['Resumo USOFF', 'Por embarque']);
      const embAoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Por embarque'], { header: 1 });
      expect(embAoa[0][0]).toBe('ID Embarque');
    });

    it('exportModeloXlsx gera os templates padrão de importação (cad, hh, cart)', async () => {
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const downloadedFiles: string[] = [];

      Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
        set(val: string) {
          downloadedFiles.push(val);
        }
      });

      const dataset = createTestDataset();
      await exportModeloXlsx('cad', dataset);
      await exportModeloXlsx('hh', dataset);
      await exportModeloXlsx('cart', dataset);

      expect(clickSpy).toHaveBeenCalledTimes(3);
      expect(downloadedFiles.some(f => f.toLowerCase().includes('cadastro'))).toBe(true);
      expect(downloadedFiles.some(f => f.toLowerCase().includes('hh'))).toBe(true);
      expect(downloadedFiles.some(f => f.toLowerCase().includes('carteira'))).toBe(true);
    });

    it('sanitizeSpreadsheetCell neutraliza injeção de fórmulas e DDE (OWASP CWE-1236) contra \\t, \\r, \\n e espaços + @/=/+/-', () => {
      expect(sanitizeSpreadsheetCell('\tcmd')).toBe("'\tcmd");
      expect(sanitizeSpreadsheetCell('\rpayload')).toBe("'\rpayload");
      expect(sanitizeSpreadsheetCell('\nDDE')).toBe("'\nDDE");
      expect(sanitizeSpreadsheetCell('   @SUM(A1)')).toBe("'   @SUM(A1)");
      expect(sanitizeSpreadsheetCell('=HYPERLINK("http://evil")')).toBe("'=HYPERLINK(\"http://evil\")");
      expect(sanitizeSpreadsheetCell('+1+1')).toBe("'+1+1");
      expect(sanitizeSpreadsheetCell('-2+3')).toBe("'-2+3");
      // Valores normais e numéricos permanecem intactos
      expect(sanitizeSpreadsheetCell('Texto Seguro Offshore')).toBe('Texto Seguro Offshore');
      expect(sanitizeSpreadsheetCell(12.5)).toBe(12.5);
      expect(sanitizeSpreadsheetCell(-4)).toBe(-4);
    });

    it('exportConfrontoSAPXlsx e exportPainelDiaOrdensXlsx incluem banner de escopo parcial, sanitizam células maliciosas e removem "/" do nome da aba', async () => {
      const capturedBlobs: Blob[] = [];
      const capturedNames: string[] = [];

      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
        capturedBlobs.push(obj as Blob);
        return 'blob:mock-excel';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
        configurable: true,
        set(val: string) {
          capturedNames.push(val);
        }
      });

      // 1. exportConfrontoSAPXlsx com scopeLabel e payload malicioso no nome
      await exportConfrontoSAPXlsx(
        [
          {
            id: 'op-1',
            portal_id: '55104',
            id_embarque: '55104',
            matricula: '1001',
            chave_petrobras: 'CHV1',
            nome: '\t=CMD|"/C calc"!A0',
            empresa: 'Infotec Brasil',
            estrutura: 'UN-ES',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            plataforma_sigla: 'P50',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: '   @SUM(A1)',
            operacao: '0010',
            status_processamento: 'Concluído',
            prioridade: 'Regular',
            status_programacao: 'Carteira',
            hh_programado: 12,
            hh_confirmado: 12,
            hh_confirmado_sap: 10,
            divergencia_sap: 2,
            status_divergencia: 'Divergente (Portal > SAP)',
            recursos: 1,
            fonte: 'portal_offshore'
          }
        ],
        'Outubro 2026',
        'Carteira Preposto Teste'
      );

      expect(capturedBlobs).toHaveLength(1);
      const confrontoBuf = await capturedBlobs[0].arrayBuffer();
      const confrontoWb = XLSX.read(confrontoBuf, { type: 'array' });
      expect(confrontoWb.SheetNames).toContain('Confronto SAP x Portal');
      const confrontoAoa = XLSX.utils.sheet_to_json<any[]>(
        confrontoWb.Sheets['Confronto SAP x Portal'],
        { header: 1 }
      );
      expect(confrontoAoa[0][0]).toBe('[ESCOPO PARCIAL DE CARTEIRA - CARTEIRA PREPOSTO TESTE]');
      // Células maliciosas receberam prefixo seguro (')
      const dataRowConfronto = confrontoAoa.find(r => r && r[1] === '1001')!;
      expect(String(dataRowConfronto[2]).startsWith("'")).toBe(true);
      expect(String(dataRowConfronto[7]).startsWith("'")).toBe(true);

      // 2. exportPainelDiaOrdensXlsx com "/" na data para validar sanitizeSheetName e células maliciosas
      const dsComSap = createTestDataset({
        confirmacoesSap: [
          {
            id: 'sap-dia-1',
            matricula: '1001',
            data_criacao: '2026/10/01',
            data_lancamento: '2026/10/01',
            data_fim_real: '2026/10/01',
            ordem: '\rpayload_ordem',
            operacao: '0010',
            horas_confirmadas: 11,
            contador_confirmacao: 2,
            id_embarque: '55104',
            status_reconciliacao: 'Em Carteira'
          }
        ]
      });

      await exportPainelDiaOrdensXlsx({
        date: '2026/10/01',
        dataset: dsComSap,
        rows: [
          {
            mat: '1001',
            nome: '\nDDE_TECNICO',
            D: '2026-10-01',
            p: 'P50',
            r: 'Espírito Santo (UN-ES)',
            d: 12,
            e: 11,
            sem: false,
            pc: 91.6,
            st: 'ok',
            emb: null,
            acc: null,
            j: null
          }
        ],
        scopeLabel: 'P50'
      });

      expect(capturedBlobs).toHaveLength(2);
      const diaBuf = await capturedBlobs[1].arrayBuffer();
      const diaWb = XLSX.read(diaBuf, { type: 'array' });
      // "/" na data foi substituído por "-" em sanitizeSheetName
      expect(diaWb.SheetNames[0]).toBe('Apontamentos 2026-10-01');
      expect(diaWb.SheetNames[0]).not.toContain('/');

      const diaAoa = XLSX.utils.sheet_to_json<any[]>(diaWb.Sheets[diaWb.SheetNames[0]], { header: 1 });
      expect(diaAoa[0][0]).toBe('[ESCOPO PARCIAL DE CARTEIRA - P50]');
      const rowDia = diaAoa.find(r => r && r[1] === '1001')!;
      expect(String(rowDia[2]).startsWith("'")).toBe(true);
      expect(String(rowDia[6]).startsWith("'")).toBe(true);
      expect(rowDia[9]).toBe(2); // Contador
    });

    it('exportTecnicoXlsx gera 2ª aba "Confirmações SAP" quando há confirmações e exportModeloXlsx("sap") gera template oficial SAP', async () => {
      const capturedBlobs: Blob[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
        capturedBlobs.push(obj as Blob);
        return 'blob:mock-sap';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const dsComSap = createTestDataset({
        confirmacoesSap: [
          {
            id: 'sap-tec-1',
            matricula: '1001',
            data_criacao: '2026-10-02',
            data_lancamento: '2026-10-02',
            data_fim_real: '2026-10-02',
            ordem: '40001234',
            operacao: '0010',
            horas_confirmadas: 12,
            contador_confirmacao: 1,
            id_embarque: '55104',
            status_reconciliacao: 'Em Carteira'
          }
        ]
      });

      await exportTecnicoXlsx('1001', dsComSap, period);
      expect(capturedBlobs).toHaveLength(1);
      const tecWb = XLSX.read(await capturedBlobs[0].arrayBuffer(), { type: 'array' });
      expect(tecWb.SheetNames).toEqual(['Relatório', 'Confirmações SAP']);
      const sapSheetRows = XLSX.utils.sheet_to_json<any[]>(tecWb.Sheets['Confirmações SAP'], { header: 1 });
      expect(sapSheetRows[0]).toContain('Contador Confirmação');
      expect(sapSheetRows[1]).toContain('40001234');
      expect(sapSheetRows[1]).toContain('Cadastrada no Portal');

      await exportModeloXlsx('sap', dsComSap);
      expect(capturedBlobs).toHaveLength(2);
      const modSapWb = XLSX.read(await capturedBlobs[1].arrayBuffer(), { type: 'array' });
      expect(modSapWb.SheetNames).toEqual(['Confirmacoes_SAP', 'Instruções']);
      const modSapRows = XLSX.utils.sheet_to_json<any[]>(modSapWb.Sheets['Confirmacoes_SAP'], { header: 1 });
      expect(modSapRows[0]).toContain('Contador_confirmacao');
      expect(modSapRows[1]).toContain('00000001');
    });

    it('exportUsoffPortalOffshoreXlsx gera planilha no formato Portal Offshore com cálculo USOFF ao lado e soma 100% idêntica ao painel', async () => {
      const capturedBlobs: Blob[] = [];
      const capturedNames: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
        capturedBlobs.push(obj as Blob);
        return 'blob:mock-portal-usoff';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
        configurable: true,
        set(val: string) {
          capturedNames.push(val);
        }
      });

      const emptyFilters = { fDate: '', fReg: '', fPlat: '', fResp: '', fPer: '', cIni: '', cFim: '' };
      const ds = createTestDataset({
        config: {
          ...mockContractConfig,
          us_pe_padrao: 0.30,
          us_ex_padrao: 0.70,
          med_criterio: 'enc'
        },
        usoffUnWeights: {},
        hhMap: {},
        justMap: {},
        plataformas: {
          ...mockPlatforms,
          UMAC: {
            sigla: 'UMAC',
            chave_norm: 'UMAC',
            nome: 'UMS Diária Teste',
            un: 'Armador',
            armador: 'Armador Teste',
            gerencia: '',
            tipo: 'UMS (Diária)',
            situacao: 'Mobilizada',
            cadastro_pendente: false,
            tipo_medicao: 'diaria'
          }
        },
        carteira: [
          {
            id: 'emb-55104',
            id_embarque: '55104',
            matricula: '1001',
            plataforma_sigla: 'P50',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 130,
            operacao: '55104',
            pe: null,
            ex: null,
            fonte: 'portal_offshore'
          },
          {
            id: 'emb-55200',
            id_embarque: '55200',
            matricula: '1002',
            plataforma_sigla: 'UMAC',
            unidade_negocio: 'Armador',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-10',
            horas_programadas: 80,
            operacao: '55200',
            pe: null,
            ex: null,
            fonte: 'portal_offshore'
          }
        ],
        carteiraOperacoes: [
          // 1. Carteira com execução -> 0.30 * 10 + 0.70 * 10 = 10.00
          {
            id: 'op-cart-exec',
            portal_id: '55104',
            id_embarque: '55104',
            matricula: '1001',
            chave_petrobras: 'CH01',
            nome: '=CMD|"calc"',
            empresa: 'Infotec Brasil',
            estrutura: 'UN-ES',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            plataforma_sigla: 'P50',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: '400010',
            operacao: '0010',
            status_processamento: 'Confirmado',
            prioridade: 'Alta',
            status_programacao: 'Carteira',
            hh_programado: 10,
            hh_confirmado: 10,
            hh_confirmado_sap: 10,
            recursos: 1,
            fonte: 'portal_offshore'
          },
          // 2. Carteira com execução zero (HC=0) -> 0.00
          {
            id: 'op-cart-zero',
            portal_id: '55104',
            id_embarque: '55104',
            matricula: '1001',
            chave_petrobras: 'CH01',
            nome: 'Carlos Silva',
            empresa: 'Infotec Brasil',
            estrutura: 'UN-ES',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            plataforma_sigla: 'P50',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: '400020',
            operacao: '0020',
            status_processamento: 'Pendente',
            prioridade: 'Regular',
            status_programacao: 'Carteira',
            hh_programado: 100,
            hh_confirmado: 0,
            hh_confirmado_sap: 0,
            recursos: 1,
            fonte: 'portal_offshore'
          },
          // 3. Fora da carteira com execução -> apenas 0.70 * 20 = 14.00
          {
            id: 'op-fora-exec',
            portal_id: '55104',
            id_embarque: '55104',
            matricula: '1001',
            chave_petrobras: 'CH01',
            nome: 'Carlos Silva',
            empresa: 'Infotec Brasil',
            estrutura: 'UN-ES',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            plataforma_sigla: 'P50',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: '400030',
            operacao: '0030',
            status_processamento: 'Confirmado',
            prioridade: 'Regular',
            status_programacao: 'Fora da carteira',
            hh_programado: 20,
            hh_confirmado: 20,
            hh_confirmado_sap: 20,
            recursos: 1,
            fonte: 'portal_offshore'
          },
          // 4. Cancelada -> deve aparecer para conferência com USOFF = 0
          {
            id: 'op-cancelada',
            portal_id: '55104',
            id_embarque: '55104',
            matricula: '1001',
            chave_petrobras: 'CH01',
            nome: 'Carlos Silva',
            empresa: 'Infotec Brasil',
            estrutura: 'UN-ES',
            unidade_negocio: 'Espírito Santo (UN-ES)',
            plataforma_sigla: 'P50',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: '400040',
            operacao: '0040',
            status_processamento: 'Cancelado',
            prioridade: 'Regular',
            status_programacao: 'Cancelada',
            hh_programado: 40,
            hh_confirmado: 0,
            hh_confirmado_sap: 0,
            recursos: 1,
            fonte: 'portal_offshore'
          },
          // 5 e 6. Embarque em Diária (10 dias -> 100 USOFF cobrado 1x no embarque)
          {
            id: 'op-diaria-1',
            portal_id: '55200',
            id_embarque: '55200',
            matricula: '1002',
            chave_petrobras: 'CH02',
            nome: 'Mariana Costa',
            empresa: 'Infotec Brasil',
            estrutura: 'Armador',
            unidade_negocio: 'Armador',
            plataforma_sigla: 'UMAC',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-10',
            ordem: '500010',
            operacao: '0010',
            status_processamento: 'Confirmado',
            prioridade: 'Regular',
            status_programacao: 'Carteira',
            hh_programado: 40,
            hh_confirmado: 40,
            hh_confirmado_sap: 40,
            recursos: 1,
            fonte: 'portal_offshore'
          },
          {
            id: 'op-diaria-2',
            portal_id: '55200',
            id_embarque: '55200',
            matricula: '1002',
            chave_petrobras: 'CH02',
            nome: 'Mariana Costa',
            empresa: 'Infotec Brasil',
            estrutura: 'Armador',
            unidade_negocio: 'Armador',
            plataforma_sigla: 'UMAC',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-10',
            ordem: '500020',
            operacao: '0020',
            status_processamento: 'Confirmado',
            prioridade: 'Regular',
            status_programacao: 'Carteira',
            hh_programado: 40,
            hh_confirmado: 40,
            hh_confirmado_sap: 40,
            recursos: 1,
            fonte: 'portal_offshore'
          }
        ],
        confirmacoesSap: [
          // 7. Ordem do SAP não cadastrada no Portal -> apenas 0.70 * 10 = 7.00
          {
            id: 'sap-extra-1',
            matricula: '1001',
            data_criacao: '2026-10-05',
            data_lancamento: '2026-10-05',
            data_fim_real: '2026-10-05',
            ordem: '400099',
            operacao: '0090',
            horas_confirmadas: 10,
            contador_confirmacao: 1,
            id_embarque: '55104',
            status_reconciliacao: 'Fora da Carteira'
          }
        ]
      });

      const pidx = buildPlatformIndex(ds.plataformas);
      const expectedTotal = summarizeUsoff(
        computeUsoffOperations(period, ds, emptyFilters, pidx, 'embarque')
      ).us;
      // 10.00 (Carteira) + 0 (HC=0) + 14.00 (Fora) + 0 (Cancelada) + 100.00 (Diária 10d*10) + 7.00 (SAP extra) = 131.00
      expect(expectedTotal).toBe(131);

      await exportUsoffPortalOffshoreXlsx(ds, period, emptyFilters);
      expect(capturedBlobs).toHaveLength(1);
      expect(capturedNames[0]).toContain('Portal Offshore + USOFF');

      const wb = XLSX.read(await capturedBlobs[0].arrayBuffer(), { type: 'array' });
      expect(wb.SheetNames).toEqual(['Portal Offshore + USOFF', 'Por Embarque (ID)', 'Resumo Validação']);

      const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Portal Offshore + USOFF'], { header: 1 });
      const header = aoa[0];
      // Garante cabeçalhos Portal Offshore na esquerda + Confronto SAP + contexto de Embarque & USOFF ao lado
      expect(header.slice(0, 17)).toEqual([
        'ID', 'Matrícula', 'Chave', 'Nome', 'Empresa', 'Estrutura', 'Unidade',
        'Início', 'Fim', 'Ordem', 'Operação', 'Status Processamento', 'Prioridade',
        'Status Programação', 'HH Programado', 'HH Confirmado', 'Recursos'
      ]);
      expect(header.slice(17, 20)).toEqual([
        'HH Confirmado (SAP)', 'Divergência (Portal − SAP)', 'Status Confronto SAP'
      ]);
      expect(header.slice(32)).toEqual([
        'PE × HP', 'EX × HC', 'USoff', 'Total USoff do Embarque', 'Regra / Observação USoff'
      ]);

      const dataRows = aoa.slice(1);
      // 6 operações do Portal + 1 SAP não cadastrada no Portal = 7 linhas (não agrupadas)
      expect(dataRows).toHaveLength(7);

      // Blocos contíguos por ID Embarque (todas as 5 linhas do ID 55104 juntas, depois as 2 do ID 55200)
      const embIdsOrder = dataRows.map(r => r[0]);
      expect(embIdsOrder).toEqual(['55104', '55104', '55104', '55104', '55104', '55200', '55200']);

      const usColIdx = header.indexOf('USoff');
      const embTotalColIdx = header.indexOf('Total USoff do Embarque');
      const regraColIdx = header.indexOf('Regra / Observação USoff');
      const sapColIdx = header.indexOf('HH Confirmado (SAP)');
      const statusSapColIdx = header.indexOf('Status Confronto SAP');

      const sumExcelUsoff = dataRows.reduce((acc, r) => acc + (Number(r[usColIdx]) || 0), 0);
      expect(sumExcelUsoff).toBe(expectedTotal);

      // Soma da coluna Total USoff do Embarque (preenchida 1x por bloco de ID) também bate 100%
      const sumEmbCol = dataRows.reduce((acc, r) => acc + (Number(r[embTotalColIdx]) || 0), 0);
      expect(sumEmbCol).toBe(expectedTotal);
      expect(dataRows[0][embTotalColIdx]).toBe(31);
      expect(dataRows[5][embTotalColIdx]).toBe(100);

      // SAP não cadastrado no Portal está dentro do bloco 55104 com seu HC SAP
      const rowSapExtra = dataRows.find(r => r[9] === '400099')!;
      expect(rowSapExtra[0]).toBe('55104');
      expect(rowSapExtra[sapColIdx]).toBe(10);
      expect(rowSapExtra[statusSapColIdx]).toBe('Não Cadastrado no Portal');
      expect(rowSapExtra[usColIdx]).toBe(7);

      // Verifica sanitização CWE-1236
      const rowOp1 = dataRows.find(r => r[9] === '400010')!;
      expect(String(rowOp1[3]).startsWith("'")).toBe(true);

      // Verifica linha Cancelada presente dentro do bloco 55104 com USoff = 0
      const rowCanc = dataRows.find(r => r[13] === 'Cancelada')!;
      expect(rowCanc[usColIdx]).toBe(0);
      expect(rowCanc[regraColIdx]).toContain('Cancelada');

      // Verifica Diária cobrada 1x no embarque 55200
      const diariaRows = dataRows.filter(r => r[0] === '55200');
      expect(diariaRows).toHaveLength(2);
      expect(diariaRows[0][usColIdx]).toBe(100);
      expect(diariaRows[1][usColIdx]).toBe(0);

      // Verifica Aba 2 Por Embarque (ID) conciliada por embarque
      const embAoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Por Embarque (ID)'], { header: 1 });
      const embHeader = embAoa[0];
      expect(embHeader[0]).toBe('ID Embarque');
      const embDataRows = embAoa.slice(1);
      expect(embDataRows).toHaveLength(2);
      expect(embDataRows.map(r => r[0])).toEqual(['55104', '55200']);
      const embDiffIdx = embHeader.indexOf('Diferença');
      expect(embDataRows[0][embDiffIdx]).toBe(0);
      expect(embDataRows[1][embDiffIdx]).toBe(0);

      // Verifica Aba 3 Resumo Validação sem diferença
      const resumoAoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Resumo Validação'], { header: 1 });
      const diffRow = resumoAoa.find(r => r[0] === 'Diferença (Painel − Soma da Aba 1)')!;
      expect(diffRow[1]).toBe(0);

      // Validação com escopo parcial
      await exportUsoffPortalOffshoreXlsx(ds, period, emptyFilters, 'UN-ES');
      expect(capturedNames[1]).toContain('[PARCIAL - UN-ES]');
      const wbParcial = XLSX.read(await capturedBlobs[1].arrayBuffer(), { type: 'array' });
      const parcialAoa = XLSX.utils.sheet_to_json<any[]>(wbParcial.Sheets['Portal Offshore + USOFF'], { header: 1 });
      expect(parcialAoa[0][0]).toBe('[ESCOPO PARCIAL DE CARTEIRA - UN-ES]');
    });

    it('importa estornos SAP (9,00-, (9,00), coluna Estorno=X, Trabalho real/Oper.) somando 18 para [+9, -9, +9, +9] na ordem 002032288155/0010 e exporta 18h no Confronto e USOFF', async () => {
      // 1. Detecção IW47 com Trabalho real, Oper. e Estorno (Trabalho real não pode ser roubado por Data Fim Real)
      const headersIw47 = ['Pernr', 'Data Lançamento', 'Data Fim Real', 'Ordem', 'Oper.', 'Estorno', 'Trabalho real', 'Contador'];
      expect(guessImportKind(headersIw47)).toBe('sap');
      const colMap = mapColumns(headersIw47, 'sap');
      expect(colMap.hc).toBe(6);
      expect(colMap.op).toBe(4);
      expect(colMap.estorno).toBe(5);
      expect(colMap.real).toBe(2);

      // 2. Planilha IW47: ordem 002032288155 op 0010 com 4 lançamentos: [+9, 9,00-, 09:00, 9] = 18
      const fileSap = createExcelFile(
        [
          headersIw47,
          ['1001', '2026-10-05', '2026-10-05', '002032288155', '0010', '', '9,00', '0001'],
          ['1001', '2026-10-06', '2026-10-06', '002032288155', '0010', '', '9,00-', '0002'],
          ['1001', '2026-10-07', '2026-10-07', '002032288155', '0010', '', '09:00', '0003'],
          ['1001', '2026-10-08', '2026-10-08', '002032288155', '0010', '', '9', '0004'],
          // Caso extra: Estorno='X' com hora positiva + parênteses contábil
          ['1001', '2026-10-09', '2026-10-09', '002032288999', '0020', 'X', '9,00', '0005'],
          ['1001', '2026-10-10', '2026-10-10', '002032288999', '0020', '', '(4,50)', '0006']
        ],
        'iw47_estornos.xlsx',
        'IW47'
      );

      const parsed = await parseSpreadsheetFile(fileSap, 'sap');
      expect(parsed.kind).toBe('sap');
      expect(parsed.errors).toEqual([]);
      const rows = parsed.rows as Array<{ ordem: string; op: string; hc: number }>;
      expect(rows).toHaveLength(6);

      const sumOrd155 = rows
        .filter(r => r.ordem === '002032288155' && r.op === '0010')
        .reduce((acc, r) => acc + r.hc, 0);
      expect(rows.slice(0, 4).map(r => r.hc)).toEqual([9, -9, 9, 9]);
      expect(sumOrd155).toBe(18);
      expect(rows[4].hc).toBe(-9); // Estorno=X inverte +9 para -9
      expect(rows[5].hc).toBe(-4.5); // (4,50) contábil = -4.5

      // 3. Rejeita texto inválido explícito em hc sem derrubar a linha por silent 0
      const fileErr = createExcelFile(
        [
          ['Matrícula', 'Data Criação', 'Ordem', 'Operação', 'Horas Confirmadas'],
          ['1001', '2026-10-05', '002032288155', '0010', 'INVALIDO']
        ],
        'sap_erro.xlsx',
        'SAPErr'
      );
      const parsedErr = await parseSpreadsheetFile(fileErr, 'sap');
      expect(parsedErr.errors.length).toBeGreaterThan(0);

      // 4. Confronto e Exportação USOFF devem somar 18h mesmo com hh_confirmado_sap legado=27 na operação
      const capturedBlobs: Blob[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
        capturedBlobs.push(obj as Blob);
        return 'blob:mock-18h';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const ds18 = createTestDataset({
        config: { ...mockContractConfig, us_pe_padrao: 0.3, us_ex_padrao: 0.7 },
        carteira: [
          {
            id: 'emb-55104',
            matricula: '1001',
            nome: 'Técnico Teste',
            unidade_negocio: 'UN-ES',
            plataforma_sigla: 'P58',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            horas_programadas: 154,
            hh_carteira: 154,
            id_embarque: '55104',
            operacao: '55104',
            pe: 0.3,
            ex: 0.7,
            fonte: 'portal_offshore'
          }
        ],
        carteiraOperacoes: [
          {
            id: 'op-155',
            portal_id: '55104',
            id_embarque: '55104',
            matricula: '1001',
            chave_petrobras: 'CHV1',
            nome: 'Técnico Teste',
            empresa: 'Infotec Brasil',
            estrutura: 'Manutenção',
            unidade_negocio: 'UN-ES',
            plataforma_sigla: 'P58',
            data_inicio: '2026-10-01',
            data_fim: '2026-10-14',
            ordem: '2032288155',
            operacao: '10',
            status_processamento: 'Embarcado',
            prioridade: 'Alta',
            status_programacao: 'Carteira',
            hh_programado: 20,
            hh_confirmado: 18,
            hh_confirmado_sap: 27, // cache antigo sem descontar o estorno -9
            divergencia_sap: -9,
            status_divergencia: 'Divergente (SAP > Portal)',
            recursos: 1,
            fonte: 'portal_offshore'
          }
        ],
        confirmacoesSap: [
          {
            id: 's1',
            matricula: '1001',
            data_criacao: '2026-10-05',
            data_lancamento: '2026-10-05',
            data_fim_real: '2026-10-05',
            ordem: '002032288155',
            operacao: '0010',
            horas_confirmadas: 9,
            contador_confirmacao: 1,
            id_embarque: '55104',
            status_reconciliacao: 'Em Carteira'
          },
          {
            id: 's2',
            matricula: '1001',
            data_criacao: '2026-10-06',
            data_lancamento: '2026-10-25', // estorno tardio > 4d ainda sem id_embarque
            data_fim_real: '2026-10-06',
            ordem: '002032288155',
            operacao: '0010',
            horas_confirmadas: -9,
            contador_confirmacao: 2,
            id_embarque: '',
            status_reconciliacao: 'Em Carteira'
          },
          {
            id: 's3',
            matricula: '1001',
            data_criacao: '2026-10-07',
            data_lancamento: '2026-10-07',
            data_fim_real: '2026-10-07',
            ordem: '002032288155',
            operacao: '0010',
            horas_confirmadas: 9,
            contador_confirmacao: 3,
            id_embarque: '55104',
            status_reconciliacao: 'Em Carteira'
          },
          {
            id: 's4',
            matricula: '1001',
            data_criacao: '2026-10-08',
            data_lancamento: '2026-10-08',
            data_fim_real: '2026-10-08',
            ordem: '002032288155',
            operacao: '0010',
            horas_confirmadas: 9,
            contador_confirmacao: 4,
            id_embarque: '55104',
            status_reconciliacao: 'Em Carteira'
          }
        ]
      });

      const period: PeriodWindow = { ini: '2026-10-01', fim: '2026-10-31', m: '2026-10' };
      const emptyFilters = { fDate: '', fReg: '', fPlat: '', fResp: '', fPer: '', cIni: '', cFim: '' };

      const confrontoRows = mergeConfrontoOperations(
        ds18.carteiraOperacoes!,
        ds18.confirmacoesSap,
        ds18.carteira,
        ds18.tecnicos
      );
      await exportConfrontoSAPXlsx(confrontoRows, 'Outubro 2026');
      await exportUsoffPortalOffshoreXlsx(ds18, period, emptyFilters);
      expect(capturedBlobs).toHaveLength(2);

      const confWb = XLSX.read(await capturedBlobs[0].arrayBuffer(), { type: 'array' });
      const confAoa = XLSX.utils.sheet_to_json<any[]>(confWb.Sheets['Confronto SAP x Portal'], { header: 1 });
      const confHeader = confAoa[0];
      const confRow = confAoa.find(r => r && String(r[1]) === '1001')!;
      expect(confRow[confHeader.indexOf('HH Confirmado (SAP)')]).toBe(18);
      expect(confRow[confHeader.indexOf('Divergência (Portal - SAP)')]).toBe(0);
      expect(confRow[confHeader.indexOf('Status do Confronto')]).toBe('OK');

      const usoffWb = XLSX.read(await capturedBlobs[1].arrayBuffer(), { type: 'array' });
      const usoffAoa = XLSX.utils.sheet_to_json<any[]>(usoffWb.Sheets['Portal Offshore + USOFF'], { header: 1 });
      const usHeader = usoffAoa[0];
      const usRow = usoffAoa[1];
      expect(usRow[usHeader.indexOf('HH Confirmado (SAP)')]).toBe(18);
      expect(usRow[usHeader.indexOf('Status Confronto SAP')]).toBe('OK');
    });
  });
});
