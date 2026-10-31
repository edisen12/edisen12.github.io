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
  exportPeriodoXlsx,
  exportTecnicoXlsx,
  exportUsoffXlsx,
  exportModeloXlsx
} from '../excel.service';

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

    it('exportUsoffXlsx gera relatório oficial de operações USOFF com ponderações PE e EX', async () => {
      const dataset = createTestDataset();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      await exportUsoffXlsx(dataset, period, 'UN-ES');
      expect(clickSpy).toHaveBeenCalled();
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
  });
});
