// ==============================================================================
// Serviço Excel: Importação Heurística, Remapeamento e as 6 Exportações Oficiais
// Carregamento EXCLUSIVO via Lazy-Import Dinâmico (const XLSX = await import('xlsx'))
// ==============================================================================

import type {
  AppDataset,
  CarteiraOperacao,
  ConfirmacaoSAP,
  DayTechRow,
  FilterState,
  ImportKind,
  PeriodWindow,
  Plataforma,
  UsoffOperationRow
} from '../domain/types';
import {
  addDays,
  diffDays,
  formatBr,
  parseExcelOrStringDate,
  todayIso
} from '../utils/date';
import {
  normalizeText,
  parseCounter,
  parseFlexibleHours,
  parseIdEmbarque,
  slugify
} from '../utils/format';
import { eachDay, periodDisplayName, periodFileSlug } from '../domain/periods';
import {
  accumulateEmbarkation,
  armadorOf,
  buildPlatformIndex,
  calcHpCarteiraInInterval,
  calcHpInInterval,
  computeCobrancaStats,
  computeDataAte,
  computeMeasurementDays,
  computePeriodDays,
  computePeriodTechs,
  findCarteira,
  findResponsiblePeople,
  getClosedEmbarkations,
  groupDaysByField,
  inferEmbarkation,
  isArmadorPlatform,
  lookupPlatform,
  mergeConfrontoOperations,
  passesFilter,
  prazoOf,
  resolveLocation,
  resolvePlace,
  resolveRecord,
  resolveTechName
} from '../domain/calculations';
import {
  computeUsoffOperations,
  hasGangwayJustification,
  resolveUsoffWeights,
  summarizeUsoff
} from '../domain/usoff';

// ------------------------------------------------------------------------------
// Definições de Colunas e Sinônimos para Detecção Automática
// ------------------------------------------------------------------------------

export interface ImportColumnDef {
  key: string;
  label: string;
  synonyms: string[];
}

export const IMPORT_COLUMNS_DEF: Record<ImportKind, ImportColumnDef[]> = {
  hh: [
    { key: 'D', label: 'Data', synonyms: ['data', 'dia'] },
    { key: 'mat', label: 'Matrícula', synonyms: ['matric', 'chapa', 'registro'] },
    { key: 'nome', label: 'Nome', synonyms: ['nome', 'colaborador', 'tecnico', 'empregado'] },
    { key: 'funcao', label: 'Função', synonyms: ['funcao', 'cargo'] },
    { key: 'p', label: 'Plataforma', synonyms: ['plataforma', 'unidade maritima', 'embarcacao', 'ues', 'instalacao'] },
    { key: 'r', label: 'Unidade de negócio', synonyms: ['unidade de neg', 'negocio', 'regional', 'bacia', 'un'] },
    { key: 'e', label: 'HH executado', synonyms: ['execut', 'realiz', 'apont', 'trabalh', 'hh'] }
  ],
  cart: [
    { key: 'mat', label: 'Matrícula', synonyms: ['matric', 'chapa', 'registro'] },
    { key: 'nome', label: 'Nome', synonyms: ['nome', 'colaborador', 'tecnico', 'empregado'] },
    { key: 'funcao', label: 'Função', synonyms: ['funcao', 'cargo'] },
    { key: 'plat', label: 'Plataforma', synonyms: ['unidade', 'plataforma', 'unidade maritima', 'embarcacao', 'ues', 'instalacao'] },
    { key: 'reg', label: 'Unidade de negócio', synonyms: ['estrutura', 'unidade de neg', 'negocio', 'regional', 'bacia', 'un'] },
    { key: 'hp', label: 'Horas programadas', synonyms: ['hh programado', 'horas prog', 'hh prog', 'programad', 'hp'] },
    { key: 'op', label: 'Operação (cruzamento SAP)', synonyms: ['operacao', 'cod. op', 'op'] },
    { key: 'pe', label: 'PE (ponderação da programação)', synonyms: ['pond. prog', 'ponderacao da prog', 'ponderacao prog', 'pe'] },
    { key: 'ex', label: 'EX (ponderação da execução)', synonyms: ['pond. exec', 'ponderacao da exec', 'ponderacao exec', 'ex'] },
    { key: 'fim', label: 'Desembarque', synonyms: ['fim', 'desembarque', 'descida', 'retorno', 'termino'] },
    { key: 'ini', label: 'Embarque', synonyms: ['inicio', 'embarque', 'subida'] },
    { key: 'id_embarque', label: 'ID Embarque / Carteira', synonyms: ['id', 'id embarque', 'portal id', 'id_embarque'] },
    { key: 'ordem', label: 'Ordem', synonyms: ['ordem', 'num ordem'] },
    { key: 'status_prog', label: 'Status Programação', synonyms: ['status programacao', 'status prog'] },
    { key: 'hc_portal', label: 'HH Confirmado (Portal)', synonyms: ['hh confirmado', 'hc portal'] },
    { key: 'chave', label: 'Chave Petrobras', synonyms: ['chave', 'chave petrobras'] },
    { key: 'empresa', label: 'Empresa', synonyms: ['empresa'] },
    { key: 'recursos', label: 'Recursos', synonyms: ['recursos'] }
  ],
  plat: [
    { key: 'sigla', label: 'Sigla', synonyms: ['sigla', 'codigo'] },
    { key: 'un', label: 'Unidade de negócio', synonyms: ['unidade de neg', 'negocio', 'regional', 'bacia', 'un'] },
    { key: 'nome', label: 'Nome', synonyms: ['nome', 'plataforma', 'descricao'] },
    { key: 'armador', label: 'Armador', synonyms: ['armador', 'empresa'] },
    { key: 'tipo', label: 'Tipo', synonyms: ['tipo', 'categoria'] },
    { key: 'medicao', label: 'Regime de medição', synonyms: ['regime', 'medicao', 'medição', 'tipo medicao', 'tipo medição', 'diaria', 'diária'] }
  ],
  pes: [
    { key: 'nome', label: 'Nome', synonyms: ['nome', 'pessoa'] },
    { key: 'papel', label: 'Papel', synonyms: ['papel', 'perfil', 'funcao', 'cargo'] },
    { key: 'email', label: 'E-mail', synonyms: ['mail'] },
    { key: 'plats', label: 'Plataformas', synonyms: ['plataforma'] },
    { key: 'uns', label: 'Unidades de negócio', synonyms: ['unidade', 'regional', 'un'] }
  ],
  sap: [
    { key: 'mat', label: 'Matrícula', synonyms: ['matric', 'chapa', 'registro'] },
    { key: 'cria', label: 'Data Criação', synonyms: ['data_criacao', 'criacao', 'data criacao'] },
    { key: 'lanc', label: 'Data Lançamento', synonyms: ['data_lancamento', 'lancamento', 'data lancamento'] },
    { key: 'real', label: 'Data Fim Real', synonyms: ['data_fim_real', 'fim_real', 'data real', 'real'] },
    { key: 'ordem', label: 'Ordem', synonyms: ['ordem', 'num ordem'] },
    { key: 'op', label: 'Operação', synonyms: ['operacao', 'op'] },
    { key: 'contador', label: 'Contador Confirmação', synonyms: ['contador confirmacao', 'contador de confirmacao', 'contador_confirmacao', 'contador', 'num confirmacao', 'confirmacao', 'confirmação', 'rmzhl', 'rueck'] },
    { key: 'hc', label: 'Horas Confirmadas', synonyms: ['hc', 'horas confirmadas', 'horas'] }
  ],
  tec: [
    { key: 'mat', label: 'Matrícula', synonyms: ['matric', 'chapa', 'registro', 'id'] },
    { key: 'nome', label: 'Nome', synonyms: ['nome', 'colaborador', 'tecnico', 'empregado'] },
    { key: 'funcao', label: 'Função', synonyms: ['funcao', 'cargo', 'especialidade', 'função', 'ocupacao'] }
  ]
};

const REQUIRED_KEY_BY_KIND: Record<ImportKind, string> = {
  hh: 'mat',
  cart: 'mat',
  plat: 'sigla',
  pes: 'nome',
  sap: 'mat',
  tec: 'mat'
};

export interface ParsedPreviewState {
  kind: ImportKind;
  fileName: string;
  sheetName: string;
  headers: string[];
  colMap: Record<string, number | undefined>;
  rows: any[];
  errors: string[];
  rawSheetData?: any[][];
  headerIndex?: number;
}

// ------------------------------------------------------------------------------
// Helpers Internos de Planilha
// ------------------------------------------------------------------------------

const r1 = (v?: number | null): number | string =>
  v == null || isNaN(v) ? '' : Math.round(v * 10) / 10;

const rp = (v?: number | null): number | string =>
  v == null || isNaN(v) ? '' : Math.round(v * 10) / 1000;

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

function applyDecimalFormatting(
  XLSX: any,
  ws: any,
  colIndices: number[],
  startRow: number,
  numFmt = '#,##0.00',
  endRow?: number
) {
  if (!ws || !ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const maxRow = endRow != null ? Math.min(endRow, range.e.r) : range.e.r;
  colIndices.forEach(c => {
    for (let r = startRow; r <= maxRow; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'number') {
        cell.z = numFmt;
      }
    }
  });
}

/**
 * Sanitiza células de texto contra Injeção de Fórmulas / DDE (OWASP CWE-1236).
 * Se o valor textual começar com '=', '+', '-', '@', '\t', '\r' ou '\n' (ou contiver
 * espaços iniciais seguidos de '=', '+', '-', '@'), adiciona o prefixo seguro de texto (').
 */
export function sanitizeSpreadsheetCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r\n]/.test(value) || /^[=+\-@]/.test(value.trimStart())) {
    return `'${value}`;
  }
  return value;
}

/**
 * Sanitiza nomes dinâmicos de abas Excel removendo caracteres proibidos e limitando a 31 chars.
 */
function sanitizeSheetName(name: string): string {
  const cleaned = String(name || '')
    .replace(/[:\\/?*[\]]/g, '-')
    .trim()
    .slice(0, 31);
  return cleaned || 'Planilha';
}

function createSheet(XLSX: any, rows: any[][], widths?: number[]) {
  const safeRows = rows.map(row =>
    Array.isArray(row) ? row.map(sanitizeSpreadsheetCell) : row
  );
  const ws = XLSX.utils.aoa_to_sheet(safeRows);
  if (widths && widths.length > 0) {
    ws['!cols'] = widths.map(w => ({ wch: w }));
  }
  return ws;
}

function applyPercentageFormatting(XLSX: any, wb: any) {
  wb.SheetNames.forEach((sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const pctCols: number[] = [];

    // Localiza colunas de porcentagem na primeira ou segunda linha
    for (let c = range.s.c; c <= range.e.c; c++) {
      for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'string') {
          const val = cell.v.trim();
          if (
            val === 'Execução' ||
            val === '% do dia' ||
            val === 'Execução sem gangway' ||
            val === '% justificado' ||
            val === 'HC ÷ HD' ||
            val.startsWith('HC ÷ HP') ||
            val === '%'
          ) {
            pctCols.push(c);
            break;
          }
        }
      }
    }

    // Formata valores numéricos dessas colunas com 0.0%
    pctCols.forEach(c => {
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'number') {
          cell.z = '0.0%';
        }
      }
    });

    // Casos específicos de células isoladas no resumo
    if (sheetName === 'Resumo') {
      const b6 = ws['B6'];
      if (b6 && typeof b6.v === 'number') b6.z = '0.0%';
      const b11 = ws['B11'];
      if (b11 && typeof b11.v === 'number') b11.z = '0.0%';
    } else if (sheetName === 'Resumo USOFF') {
      const b11 = ws['B11'];
      if (b11 && typeof b11.v === 'number') b11.z = '0.0%';
      const b12 = ws['B12'];
      if (b12 && typeof b12.v === 'number') b12.z = '0.0%';
    }
  });
}

function saveWorkbook(XLSX: any, wb: any, filename: string): void {
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------------------
// Motor Heurístico de Leitura e Mapeamento
// ------------------------------------------------------------------------------

export function guessImportKind(headers: string[]): ImportKind {
  const joined = headers.map(h => normalizeText(h)).join('|');
  if (/data_criacao|criacao|data_lancamento|lancamento|data_fim_real|fim_real|\bhc\b|contador|rmzhl|rueck/.test(joined)) {
    return 'sap';
  }
  if (
    /(desembarque|embarque|status.*prog|hh.*prog|id_embarque|\bportal\b)/.test(joined) ||
    (/inicio/.test(joined) && /fim/.test(joined) && !/execut/.test(joined)) ||
    (/ordem/.test(joined) && /operacao/.test(joined) && /hh/.test(joined))
  ) {
    return 'cart';
  }
  if (/armador/.test(joined) || (/sigla/.test(joined) && /tipo/.test(joined))) {
    return 'plat';
  }
  if (/papel/.test(joined) || (/email/.test(joined) && /plat/.test(joined))) {
    return 'pes';
  }
  if (
    (/funcao|cargo|especialidade/.test(joined) || /tecnico/.test(joined)) &&
    !/data|embarque|desembarque|execut|horas|hh/.test(joined)
  ) {
    return 'tec';
  }
  return 'hh';
}

export function mapColumns(headers: string[], kind: ImportKind): Record<string, number | undefined> {
  const normHeaders = headers.map(h => normalizeText(h));
  const used = new Set<number>();
  const mapping: Record<string, number | undefined> = {};

  const colDefs = IMPORT_COLUMNS_DEF[kind] || [];
  colDefs.forEach(({ key, synonyms }) => {
    for (const syn of synonyms) {
      const idx = normHeaders.findIndex(
        (h, index) =>
          !used.has(index) &&
          (syn.length <= 2 ? h === syn : h.includes(syn))
      );
      if (idx >= 0) {
        mapping[key] = idx;
        used.add(idx);
        break;
      }
    }
  });

  return mapping;
}

function extractRowsFromSheet(
  sheetData: any[][],
  headerIndex: number,
  kind: ImportKind,
  colMap: Record<string, number | undefined>,
  _pidx?: Record<string, Plataforma>
): { rows: any[]; errors: string[] } {
  const rows: any[] = [];
  const errors: string[] = [];

  for (let i = headerIndex + 1; i < sheetData.length; i++) {
    const rawRow = sheetData[i] || [];
    const getVal = (k: string) => {
      const colIdx = colMap[k];
      return colIdx != null && colIdx < rawRow.length ? rawRow[colIdx] : '';
    };

    if (kind === 'plat') {
      const sigla = String(getVal('sigla') || '').trim();
      if (!sigla) continue;
      const rawTipo = String(getVal('tipo') || '').trim();
      const rawMed = String(getVal('medicao') || '').trim().toLowerCase();
      const isDiaria = rawMed.includes('diaria') || rawMed.includes('diária') || /di[áa]ria/i.test(rawTipo);
      rows.push({
        sigla,
        nome: String(getVal('nome') || sigla).trim(),
        un: String(getVal('un') || '').trim(),
        armador: String(getVal('armador') || '').trim(),
        tipo: rawTipo,
        tipo_medicao: isDiaria ? 'diaria' : 'hh'
      });
      continue;
    }

    if (kind === 'pes') {
      const nome = String(getVal('nome') || '').trim();
      if (!nome) continue;
      const papelNorm = normalizeText(getVal('papel'));
      const papel = papelNorm.includes('contr')
        ? 'controlador'
        : papelNorm.includes('gest') || papelNorm.includes('geren')
        ? 'gestor'
        : 'preposto';

      const rawPlats = String(getVal('plats') || '')
        .split(/[,;\/|\n]+/)
        .map(s => s.trim())
        .filter(Boolean);

      const resolvedPlats: string[] = [];
      rawPlats.forEach(p => {
        const pUpper = p.toUpperCase();
        resolvedPlats.push(pUpper);
      });

      const uns = String(getVal('uns') || '')
        .split(/[,;|\n]+/)
        .map(s => s.trim())
        .filter(Boolean);

      rows.push({
        nome,
        papel,
        email: String(getVal('email') || '').trim(),
        plats: Array.from(new Set(resolvedPlats)),
        uns: Array.from(new Set(uns))
      });
      continue;
    }

    const mat = String(getVal('mat') ?? '').trim();
    if (!mat) continue;

    if (kind === 'hh') {
      const dParsed = parseExcelOrStringDate(getVal('D'));
      const eParsed = parseFlexibleHours(getVal('e'));

      if (!dParsed || eParsed == null) {
        errors.push(
          `Linha ${i + 1}: ${!dParsed ? 'data inválida' : 'HH executado vazio ou inválido'}`
        );
        continue;
      }

      rows.push({
        mat,
        nome: String(getVal('nome') || '').trim(),
        funcao: String(getVal('funcao') || '').trim(),
        D: dParsed,
        p: String(getVal('p') || '').trim(),
        r: String(getVal('r') || '').trim(),
        e: eParsed
      });
    } else if (kind === 'cart') {
      const ini = parseExcelOrStringDate(getVal('ini'));
      const fim = parseExcelOrStringDate(getVal('fim'));

      if (!ini || !fim || fim < ini) {
        errors.push(`Linha ${i + 1}: datas de embarque inválidas (${ini} a ${fim})`);
        continue;
      }

      rows.push({
        mat,
        nome: String(getVal('nome') || '').trim(),
        funcao: String(getVal('funcao') || '').trim(),
        plat: String(getVal('plat') || '').trim(),
        reg: String(getVal('reg') || '').trim(),
        ini,
        fim,
        hp: parseFlexibleHours(getVal('hp')),
        op: String(getVal('op') || '').trim(),
        pe: parseFlexibleHours(getVal('pe')),
        ex: parseFlexibleHours(getVal('ex')),
        id_embarque: parseIdEmbarque(getVal('id_embarque')),
        ordem: String(getVal('ordem') || '').trim(),
        status_prog: String(getVal('status_prog') || '').trim(),
        hc_portal: parseFlexibleHours(getVal('hc_portal')),
        chave: String(getVal('chave') || '').trim(),
        empresa: String(getVal('empresa') || '').trim(),
        recursos: getVal('recursos')
      });
    } else if (kind === 'sap') {
      const cria = parseExcelOrStringDate(getVal('cria'));
      const lanc = parseExcelOrStringDate(getVal('lanc')) || cria;
      const real = parseExcelOrStringDate(getVal('real')) || lanc;
      const ordem = String(getVal('ordem') || '').trim();
      const op = String(getVal('op') || '').trim();
      const hc = parseFlexibleHours(getVal('hc'));
      const contador = parseCounter(getVal('contador'));

      if (!mat || !ordem || !cria) {
        errors.push(`Linha ${i + 1}: campos obrigatórios ausentes no extrato SAP (matrícula, ordem ou data)`);
        continue;
      }

      rows.push({
        mat,
        cria,
        lanc,
        real,
        ordem,
        op,
        hc: hc != null ? hc : 0,
        contador
      });
    } else if (kind === 'tec') {
      const nome = String(getVal('nome') || '').trim();
      if (!mat || !nome) {
        errors.push(`Linha ${i + 1}: matrícula ou nome do técnico ausente`);
        continue;
      }
      rows.push({
        mat,
        nome,
        funcao: String(getVal('funcao') || '').trim() || 'Técnico Offshore'
      });
    }
  }

  return { rows, errors };
}

/**
 * Lê arquivo Excel / CSV via lazy-import do SheetJS e detecta tipo e mapeamento de colunas.
 */
export async function parseSpreadsheetFile(
  file: File,
  forcedKind?: ImportKind
): Promise<ParsedPreviewState> {
  // Limitação de tamanho de arquivo (máximo 15 MB) contra ataques de exaustão de memória/ReDoS
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('O arquivo excede o limite máximo permitido de 15 MB.');
  }

  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, WTF: false });

  let bestMatch: {
    sheetName: string;
    sheetData: any[][];
    headerIndex: number;
    kind: ImportKind;
    colMap: Record<string, number | undefined>;
    score: number;
  } | null = null;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const sheetData: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: ''
    });

    for (let i = 0; i < Math.min(8, sheetData.length); i++) {
      const rowStrings = (sheetData[i] || []).map(cell => String(cell || ''));
      const kind = forcedKind || guessImportKind(rowStrings);
      const colMap = mapColumns(rowStrings, kind);
      const score = Object.keys(colMap).length;
      const reqKey = REQUIRED_KEY_BY_KIND[kind];

      if (colMap[reqKey] != null && (!bestMatch || score > bestMatch.score)) {
        bestMatch = {
          sheetName,
          sheetData,
          headerIndex: i,
          kind,
          colMap,
          score
        };
      }
    }
  }

  if (!bestMatch) {
    const targetKind = forcedKind || 'hh';
    const reqLabel =
      targetKind === 'hh' || targetKind === 'cart' || targetKind === 'sap'
        ? 'de matrícula'
        : targetKind === 'plat'
        ? 'de sigla'
        : 'de nome';
    throw new Error(
      `Não encontramos a coluna obrigatória ${reqLabel} nesta planilha. Verifique o cabeçalho ou use o modelo padrão.`
    );
  }

  const headers = (bestMatch.sheetData[bestMatch.headerIndex] || []).map(cell =>
    String(cell || '')
  );

  const { rows, errors } = extractRowsFromSheet(
    bestMatch.sheetData,
    bestMatch.headerIndex,
    bestMatch.kind,
    bestMatch.colMap
  );

  return {
    kind: bestMatch.kind,
    fileName: file.name,
    sheetName: bestMatch.sheetName,
    headers,
    colMap: bestMatch.colMap,
    rows,
    errors,
    rawSheetData: bestMatch.sheetData,
    headerIndex: bestMatch.headerIndex
  };
}

/**
 * Reconstrói as linhas do preview após alteração de tipo ou mapeamento de coluna.
 */
export function rebuildPreviewRows(
  preview: ParsedPreviewState,
  pidx: Record<string, Plataforma> = {},
  changeKind?: ImportKind
): ParsedPreviewState {
  const activeKind = changeKind || preview.kind;
  let activeColMap = preview.colMap;

  if (changeKind && changeKind !== preview.kind) {
    activeColMap = mapColumns(preview.headers, activeKind);
  }

  if (!preview.rawSheetData || preview.headerIndex == null) {
    return { ...preview, kind: activeKind, colMap: activeColMap };
  }

  const { rows, errors } = extractRowsFromSheet(
    preview.rawSheetData,
    preview.headerIndex,
    activeKind,
    activeColMap,
    pidx
  );

  return {
    ...preview,
    kind: activeKind,
    colMap: activeColMap,
    rows,
    errors
  };
}

// ------------------------------------------------------------------------------
// 1. Exportação Excel: Período de Medição (7 Abas Completas)
// ------------------------------------------------------------------------------

export async function exportPeriodoXlsx(
  dataset: AppDataset,
  period: PeriodWindow,
  scopeLabel?: string,
  userName?: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const pidx = buildPlatformIndex(dataset.plataformas);
  const emptyFilters = { fDate: '', fReg: '', fPlat: '', fResp: '', fPer: '', cIni: '', cFim: '' };

  const days = computeMeasurementDays(period, dataset, emptyFilters, pidx);
  const tecs = computePeriodTechs(period, true, dataset, emptyFilters, pidx);

  const isEnc = dataset.config.med_criterio === 'enc';
  const totalD = days.reduce((s, x) => s + x.d, 0);
  const totalE = days.reduce((s, x) => s + x.e, 0);
  const totalProg = tecs.reduce((s, x) => s + x.prog, 0);
  const totalGw = tecs.reduce((s, x) => s + x.gw, 0);
  const totalPend = tecs.reduce((s, x) => s + x.pend, 0);
  const pctExec = totalD > 0 ? (totalE / totalD) * 100 : 0;

  // Cabeçalho institucional padronizado
  const headerLines: any[][] = [
    ['Infotec Brasil · Gestão de HH Offshore'],
    scopeLabel
      ? [`[ESCOPO PARCIAL DE CARTEIRA - ${scopeLabel.toUpperCase()}]`]
      : [],
    [
      `${periodDisplayName(period)} (${formatBr(period.ini)} a ${formatBr(period.fim)}) · meta ${dataset.config.hh_dia} h por dia embarcado`
    ],
    [
      isEnc
        ? 'Critério: técnicos com desembarque no período; o embarque entra inteiro'
        : 'Critério: dias trabalhados no período'
    ],
    [`Gerado em ${formatBr(todayIso())}${userName ? ` por ${userName}` : ''}`],
    []
  ].filter(line => line.length > 0);

  // Aba 1: Resumo
  const resumoRows: any[][] = [
    ...headerLines,
    ['Indicador', 'Valor'],
    [isEnc ? 'Técnicos com desembarque no período' : 'Técnicos', tecs.length],
    ['HH programado (carteira)', r1(totalProg)],
    ['HH disponível', r1(totalD)],
    ['HH executado', r1(totalE)],
    ['Execução', rp(pctExec)],
    ['Horas de gangway desconectada', r1(totalGw)],
    ['Justificativas pendentes', totalPend],
    [],
    ['Criado por Luanna de Abreu Teixeira']
  ];
  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, resumoRows, [36, 20]), 'Resumo');

  // Aba 2: Por unidade
  const unGroup = groupDaysByField(days, 'r', dataset.config);
  const unRows: any[][] = [
    ['Unidade de negócio', 'Técnicos', 'HH disponível', 'HH executado', 'Execução', 'Gangway (h)', 'Pendentes'],
    ...unGroup.map(g => [
      g.k,
      g.mats.size,
      r1(g.d),
      r1(g.e),
      rp(g.p),
      r1(g.gw),
      g.pend
    ])
  ];
  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, unRows, [26, 10, 14, 14, 10, 12, 10]), 'Por unidade');

  // Aba 3: Por plataforma
  const platGroup = groupDaysByField(days, 'p', dataset.config);
  const platRows: any[][] = [
    ['Plataforma', 'Técnicos', 'HH disponível', 'HH executado', 'Execução', 'Gangway (h)', 'Pendentes'],
    ...platGroup.map(g => [
      g.k,
      g.mats.size,
      r1(g.d),
      r1(g.e),
      rp(g.p),
      r1(g.gw),
      g.pend
    ])
  ];
  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, platRows, [26, 10, 14, 14, 10, 12, 10]), 'Por plataforma');

  // Aba 4: Por técnico
  const tecRows: any[][] = [
    [
      'Matrícula',
      'Técnico',
      'Plataformas',
      'Unidades',
      'Dias na carteira',
      'HH programado',
      'Dias com executado',
      'HH disponível',
      'HH executado',
      'Execução',
      'Gangway (h)',
      'Execução sem gangway',
      'Justificados',
      'Pendentes',
      'Atingiu a meta?',
      'Embarques medidos'
    ],
    ...tecs.map(t => [
      t.mat,
      t.nome,
      Array.from(t.plats).join(', '),
      Array.from(t.regs).join(', '),
      t.cartDias,
      r1(t.prog),
      t.dias,
      r1(t.d),
      r1(t.e),
      rp(t.p),
      r1(t.gw),
      rp(t.pAj),
      t.jus,
      t.pend,
      t.p == null ? '' : t.p >= dataset.config.meta_percentual - 0.0001 ? 'Sim' : 'Não',
      t.embs || ''
    ])
  ];
  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, tecRows, [10, 26, 22, 20, 10, 12, 10, 12, 12, 10, 10, 12, 10, 10, 12, 20]), 'Por técnico');

  // Aba 5: Cobrança por responsável
  const belowTargetDays = days.filter(x => x.e < x.d - 0.001);
  const pessoasList = Object.values(dataset.pessoas);

  const cobRows: any[][] = [
    [
      'Responsável',
      'Papel',
      'E-mail',
      'A justificar',
      'Justificados',
      '% justificado',
      'Pendentes no prazo',
      'Vencidas',
      'Mais antiga pendente',
      'Justificados fora do prazo',
      'Tempo médio (dias)'
    ],
    ...pessoasList
      .map(p => {
        const respDays = belowTargetDays.filter(x => {
          const plats = p.plats || [];
          const uns = p.uns || [];
          return plats.includes(x.p) || uns.includes(x.r);
        });
        const stats = computeCobrancaStats(respDays, dataset.config);
        return { p, stats };
      })
      .filter(r => r.stats.need > 0)
      .sort((a, b) => b.stats.venc - a.stats.venc || b.stats.pend - a.stats.pend)
      .map(r => [
        r.p.nome,
        r.p.papel === 'controlador' ? 'Controlador' : r.p.papel === 'gestor' ? 'Gestor' : 'Preposto',
        r.p.email || '',
        r.stats.need,
        r.stats.ok,
        rp(r.stats.pJ),
        r.stats.noPrazo,
        r.stats.venc,
        r.stats.oldest ? formatBr(r.stats.oldest) : '',
        r.stats.fora,
        r.stats.tMed != null ? r1(r.stats.tMed) : ''
      ])
  ];
  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, cobRows, [26, 12, 30, 12, 12, 12, 14, 10, 16, 16, 14]), 'Cobrança por responsável');

  // Aba 6: Pendências
  const pendRows: any[][] = [
    [
      'Data',
      'Matrícula',
      'Técnico',
      'Plataforma',
      'Unidade',
      'Armador',
      'HH executado',
      'Prazo',
      'Situação',
      'Responsáveis'
    ],
    ...belowTargetDays
      .filter(x => !x.j)
      .map(x => {
        const prazo = prazoOf(x.D, dataset.config);
        const vencida = todayIso() > prazo;
        const respList = findResponsiblePeople(dataset.pessoas, [x.p], [x.r]).map(p => p.nome).join(', ');
        return [
          formatBr(x.D),
          x.mat,
          resolveTechName(x.mat, dataset),
          x.p,
          x.r,
          armadorOf(pidx, x.p),
          r1(x.e),
          formatBr(prazo),
          vencida ? 'Vencida' : 'No prazo',
          respList
        ];
      })
  ];
  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, pendRows, [11, 10, 26, 14, 22, 18, 10, 11, 10, 40]), 'Pendências');

  // Aba 7: Diário e justificativas
  const diarioRows: any[][] = [
    [
      'Data',
      'Matrícula',
      'Técnico',
      'Plataforma',
      'Unidade',
      'Dia do embarque',
      'HH disponível',
      'HH executado',
      '% do dia',
      'Motivo',
      'Gangway (h)',
      'Descrição',
      'Responsável',
      'Situação',
      'Atingiu a meta de horas?'
    ],
    ...days.map(x => {
      const emb = inferEmbarkation(x.mat, x.D, dataset);
      const need = x.e < x.d - 0.001;
      const pc = x.d > 0 ? (x.e / x.d) * 100 : null;
      return [
        formatBr(x.D),
        x.mat,
        resolveTechName(x.mat, dataset),
        x.p,
        x.r,
        emb ? `${emb.dia} de ${emb.n}` : '',
        r1(x.d),
        r1(x.e),
        rp(pc),
        x.j ? x.j.motivo : '',
        x.j ? r1(x.j.horas_gangway) : '',
        x.j ? x.j.descricao || '' : '',
        x.j ? x.j.responsavel_nome || '' : '',
        (x.sem ? 'Sem HH executado informado · ' : '') +
          (need ? (x.j ? 'Justificado' : 'Pendente') : 'Na meta'),
        need ? 'Não' : 'Sim'
      ];
    })
  ];
  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, diarioRows, [11, 10, 26, 22, 18, 10, 10, 10, 10, 26, 10, 40, 20, 12, 12]), 'Diário e justificativas');

  applyPercentageFormatting(XLSX, wb);

  const fileSuffix = periodFileSlug(period);
  const scopeTag = scopeLabel ? ` [PARCIAL - ${scopeLabel}]` : '';
  saveWorkbook(XLSX, wb, `HH Offshore ${fileSuffix}${scopeTag}.xlsx`);
}

// ------------------------------------------------------------------------------
// 2. Exportação Excel: Medição USOFF (2 Abas Completas)
// ------------------------------------------------------------------------------

export async function exportUsoffXlsx(
  dataset: AppDataset,
  period: PeriodWindow,
  scopeLabel?: string,
  filters?: FilterState
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const pidx = buildPlatformIndex(dataset.plataformas);
  const activeFilters: FilterState = filters || {
    fDate: '',
    fReg: '',
    fPlat: '',
    fResp: '',
    fPer: '',
    cIni: '',
    cFim: ''
  };

  const embarques = computeUsoffOperations(period, dataset, activeFilters, pidx, 'embarque');
  const T = summarizeUsoff(embarques);
  const ate = computeDataAte(period, dataset.watermark.ultima_data_hh);
  const isEnc = dataset.config.med_criterio === 'enc';

  // Cabeçalho institucional padronizado
  const headerLines: any[][] = [
    ['Infotec Brasil · Medição USOFF'],
    scopeLabel
      ? [`[ESCOPO PARCIAL DE CARTEIRA - ${scopeLabel.toUpperCase()}]`]
      : [],
    [
      `${periodDisplayName(period)} (${formatBr(period.ini)} a ${formatBr(period.fim)}) · executado até ${formatBr(ate)}`
    ],
    [
      isEnc
        ? 'Critério: embarques com desembarque no período; o embarque entra inteiro'
        : 'Critério: dias trabalhados no período'
    ],
    ['USoff = Σ [(PE × HP Carteira) + (EX × HC)]'],
    []
  ].filter(line => line.length > 0);

  // Aba 1: Resumo USOFF
  const resumoRows: any[][] = [
    ...headerLines,
    ['Indicador', 'Valor'],
    ['Embarques', T.n],
    ['HP · horas programadas no período', r1(T.hp)],
    ['HP Carteira (≥ 12 dias)', r1(T.hpCarteira ?? T.hp)],
    ['HP Fora da carteira (< 12 dias)', r1(T.hpForaCarteira ?? 0)],
    ['HD · horas disponíveis', r1(T.hd)],
    ['HC · horas confirmadas (executadas)', r1(T.hc)],
    ['HC ÷ HD', rp(T.pD)],
    [`HC ÷ HP (até ${formatBr(ate)})`, rp(T.pP)],
    ['Σ PE × HP', T.falta ? 'falta PE/EX' : r1(T.peHp)],
    ['Σ EX × HC', T.falta ? 'falta PE/EX' : r1(T.exHc)],
    ['USoff', T.us == null ? 'falta PE/EX' : r1(T.us)],
    [],
    ['Criado por Luanna de Abreu Teixeira']
  ];
  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, resumoRows, [42, 20]), 'Resumo USOFF');

  // Aba 2: Por embarque (ID)
  const embRows: any[][] = [
    [
      'ID Embarque',
      'Embarque',
      'Tipo',
      'Matrículas',
      'Técnicos',
      'Plataformas',
      'Unidades',
      isEnc ? 'Embarque' : 'Início no período',
      isEnc ? 'Desembarque' : 'Fim no período',
      'Dias',
      'Operações',
      'Fonte do HP',
      'HP',
      'HP Carteira (≥12d)',
      'HP Fora (<12d)',
      `HP até ${formatBr(ate)}`,
      'HD',
      'HC',
      'HC ÷ HD',
      'HC ÷ HP',
      'PE',
      'EX',
      'PE × HP',
      'EX × HC',
      'USoff'
    ],
    ...embarques.map(x => [
      x.id_embarque || '',
      x.op || (x.sharedAcrossPortfolios ? '[COMPARTILHADA]' : ''),
      x.tipo,
      Array.from(x.mats).join(', '),
      Array.from(x.mats).map(m => resolveTechName(m, dataset)).join(', '),
      Array.from(x.plats).join(', '),
      Array.from(x.regs).join(', '),
      formatBr(x.ini),
      formatBr(x.fim),
      x.dias,
      x.totalOps ?? '',
      x.fonte,
      r1(x.hp),
      r1(x.hpCarteira ?? x.hp),
      r1(x.hpForaCarteira ?? 0),
      r1(x.hpAte),
      r1(x.hd),
      r1(x.hc),
      rp(x.pD),
      rp(x.pP),
      x.falta ? '' : Array.from(x.pes).join(' / '),
      x.falta ? '' : Array.from(x.exs).join(' / '),
      x.falta ? '' : r1(x.peHp),
      x.falta ? '' : r1(x.exHc),
      x.us == null ? '' : r1(x.us)
    ])
  ];
  XLSX.utils.book_append_sheet(
    wb,
    createSheet(XLSX, embRows, [14, 18, 14, 14, 30, 16, 22, 12, 12, 6, 10, 16, 10, 16, 14, 12, 10, 10, 9, 9, 8, 8, 10, 10, 10]),
    'Por embarque'
  );

  applyPercentageFormatting(XLSX, wb);

  const fileSuffix = periodFileSlug(period);
  const scopeTag = scopeLabel ? ` [PARCIAL - ${scopeLabel}]` : '';
  saveWorkbook(XLSX, wb, `USOFF ${fileSuffix}${scopeTag}.xlsx`);
}

// ------------------------------------------------------------------------------
// 2B. Exportação Excel: Formato Portal Offshore + Cálculo USOFF ao Lado
// ------------------------------------------------------------------------------

interface EvaluatedUsoffLine {
  peVal: number | string;
  exVal: number | string;
  opPeHp: number | null;
  opExHc: number | null;
  opUsoff: number | null;
  regra: string;
  bucket: string;
  consumedDiaria: boolean;
}

function evaluateOperationUsoff(params: {
  statusProg: string;
  isDiaria: boolean;
  hasGw: boolean;
  hp: number;
  hpCart: number;
  hc: number;
  weights: { pe: number | null; ex: number | null };
  embDias: number;
  embId: string;
  alreadyCountedDiaria: boolean;
}): EvaluatedUsoffLine {
  const {
    statusProg,
    isDiaria,
    hasGw,
    hp,
    hpCart,
    hc,
    weights,
    embDias,
    embId,
    alreadyCountedDiaria
  } = params;

  if (statusProg === 'Cancelada') {
    return {
      peVal: isDiaria ? 'Diária' : weights.pe ?? '',
      exVal: isDiaria ? 'Diária' : weights.ex ?? '',
      opPeHp: 0,
      opExHc: 0,
      opUsoff: 0,
      regra: 'Cancelada (desconsiderada no USOFF)',
      bucket: 'Cancelada (desconsiderada)',
      consumedDiaria: false
    };
  }

  if (isDiaria) {
    if (!alreadyCountedDiaria) {
      const diariaUs = embDias * 10;
      return {
        peVal: 'Diária',
        exVal: 'Diária',
        opPeHp: 0,
        opExHc: diariaUs,
        opUsoff: diariaUs,
        regra: `Diária (${embDias} ${embDias === 1 ? 'dia' : 'dias'} × 10 — cobrado 1× no embarque)`,
        bucket: 'Diária (Armador / UMS / Afretadas)',
        consumedDiaria: true
      };
    }
    return {
      peVal: 'Diária',
      exVal: 'Diária',
      opPeHp: 0,
      opExHc: 0,
      opUsoff: 0,
      regra: `Diária (já computada na 1ª linha do ${embId ? `ID ${embId}` : 'embarque'})`,
      bucket: 'Diária (Armador / UMS / Afretadas)',
      consumedDiaria: false
    };
  }

  if (weights.pe == null || weights.ex == null) {
    return {
      peVal: weights.pe ?? 'Falta',
      exVal: weights.ex ?? 'Falta',
      opPeHp: null,
      opExHc: null,
      opUsoff: null,
      regra: 'Falta PE/EX',
      bucket: 'Falta PE/EX',
      consumedDiaria: false
    };
  }

  const isCarteira = statusProg === 'Carteira';

  if (hc === 0) {
    if (hasGw) {
      const peHp = weights.pe * hpCart;
      return {
        peVal: weights.pe,
        exVal: weights.ex,
        opPeHp: peHp,
        opExHc: 0,
        opUsoff: peHp,
        regra: isCarteira
          ? 'Gangway desconectada (PE × HP Carteira)'
          : 'Gangway desconectada (Fora da carteira: PE=0)',
        bucket: isCarteira ? 'Carteira (Gangway HC = 0)' : 'Fora da carteira (Execução Zero HC = 0)',
        consumedDiaria: false
      };
    }
    return {
      peVal: weights.pe,
      exVal: weights.ex,
      opPeHp: 0,
      opExHc: 0,
      opUsoff: 0,
      regra: hp > 0 ? 'Execução Zero (HC=0 ⇒ USOFF=0)' : 'Sem horas programadas nem executadas',
      bucket: isCarteira ? 'Carteira (Execução Zero HC = 0)' : 'Fora da carteira (Execução Zero HC = 0)',
      consumedDiaria: false
    };
  }

  const opPeHp = weights.pe * hpCart;
  const opExHc = weights.ex * hc;
  const opUsoff = opPeHp + opExHc;

  if (statusProg === 'Não Cadastrado no Portal') {
    return {
      peVal: weights.pe,
      exVal: weights.ex,
      opPeHp,
      opExHc,
      opUsoff,
      regra: 'SAP não cadastrado no Portal (Apenas EX × HC)',
      bucket: 'Não Cadastrado no Portal (SAP)',
      consumedDiaria: false
    };
  }

  if (statusProg === 'Sem programação') {
    return {
      peVal: weights.pe,
      exVal: weights.ex,
      opPeHp,
      opExHc,
      opUsoff,
      regra: 'Sem programação (Apenas EX × HC)',
      bucket: 'Sem programação',
      consumedDiaria: false
    };
  }

  return {
    peVal: weights.pe,
    exVal: weights.ex,
    opPeHp,
    opExHc,
    opUsoff,
    regra: isCarteira ? 'Carteira (PE × HP + EX × HC)' : 'Fora da carteira (Apenas EX × HC)',
    bucket: isCarteira ? 'Carteira (com execução HC > 0)' : 'Fora da carteira (com execução HC > 0)',
    consumedDiaria: false
  };
}

function resolveConfrontoStatus(
  statusProg: string,
  statusDivergencia: string | undefined,
  hcPortal: number,
  hcSap: number
): string {
  if (statusProg === 'Cancelada') return 'Cancelada';
  if (statusProg === 'Não Cadastrado no Portal') return 'Não Cadastrado no Portal';
  if (statusDivergencia && statusDivergencia !== 'Pendente') return statusDivergencia;
  if (hcPortal === 0 && hcSap === 0) return 'Não Confirmado';
  if (hcPortal > 0 && hcSap === 0) return 'Não Apontado no SAP';
  if (hcPortal === 0 && hcSap > 0) return 'Não Confirmado no Portal';
  if (Math.abs(hcPortal - hcSap) < 0.01) return 'OK';
  return hcPortal > hcSap ? 'Divergente (Portal > SAP)' : 'Divergente (SAP > Portal)';
}

/**
 * Exporta o relatório no mesmo formato tabular do Portal Offshore focado por ID de Embarque
 * (sem agrupar/colapsar ordens e operações), trazendo todas as informações do embarque,
 * horas programadas/confirmadas do Portal, executado no SAP (incluindo Não Cadastrado no Portal)
 * e o cálculo detalhado de USOFF ao lado, mais aba consolidada Por Embarque (ID) e Resumo Validação.
 */
export async function exportUsoffPortalOffshoreXlsx(
  dataset: AppDataset,
  period: PeriodWindow,
  filters: FilterState,
  scopeLabel?: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const pidx = buildPlatformIndex(dataset.plataformas);
  const ate = computeDataAte(period, dataset.watermark.ultima_data_hh);
  const enc = dataset.config.med_criterio === 'enc';

  const embarques = computeUsoffOperations(period, dataset, filters, pidx, 'embarque');
  const summary = summarizeUsoff(embarques);
  const embByKey = new Map<string, UsoffOperationRow>();
  embarques.forEach(e => embByKey.set(e.key, e));

  const headers = [
    // 17 colunas no mesmo formato do download oficial do Portal Offshore
    'ID',
    'Matrícula',
    'Chave',
    'Nome',
    'Empresa',
    'Estrutura',
    'Unidade',
    'Início',
    'Fim',
    'Ordem',
    'Operação',
    'Status Processamento',
    'Prioridade',
    'Status Programação',
    'HH Programado',
    'HH Confirmado',
    'Recursos',
    // Confronto SAP executado por ordem/operação
    'HH Confirmado (SAP)',
    'Divergência (Portal − SAP)',
    'Status Confronto SAP',
    // Contexto do ID de Embarque e Cálculo de USOFF ao lado
    'UN (Sistema)',
    'Plataforma (Sistema)',
    'Regime',
    'Início Embarque',
    'Fim Embarque',
    'Dias Embarque',
    'Qtd Ops Embarque',
    'HC Considerado (USOFF)',
    'HP Carteira (≥12d)',
    'Gangway',
    'PE',
    'EX',
    'PE × HP',
    'EX × HC',
    'USoff',
    'Total USoff do Embarque',
    'Regra / Observação USoff'
  ];

  interface BucketAgg {
    linhas: number;
    hp: number;
    hcPortal: number;
    hcSap: number;
    hcUsado: number;
    peHp: number;
    exHc: number;
    us: number;
  }

  interface EmbAuditAgg {
    opsCount: number;
    naoCadastradasSap: number;
    hpTotal: number;
    hpCart: number;
    hpFora: number;
    hcPortal: number;
    hcSap: number;
    hcUsado: number;
    sumPeHp: number;
    sumExHc: number;
    sumUsoff: number;
    hasFalta: boolean;
  }

  interface PreparedExportRow {
    opKey: string;
    embId: string;
    embIni: string;
    embFim: string;
    id: string;
    mat: string;
    chave: string;
    nome: string;
    empresa: string;
    estrutura: string;
    unidadeRaw: string;
    ini: string;
    fim: string;
    ordem: string;
    operacao: string;
    statusProc: string;
    prioridade: string;
    statusProg: string;
    hp: number;
    hcPortal: number;
    recursos: number;
    hcSap: number;
    divPortalSap: number;
    statusConfronto: string;
    unSistema: string;
    platSistema: string;
    isDiaria: boolean;
    embDias: number;
    hcUsado: number;
    hpCart: number;
    hasGw: boolean;
    evalRes: EvaluatedUsoffLine;
  }

  const bucketOrder = [
    'Carteira (com execução HC > 0)',
    'Carteira (Execução Zero HC = 0)',
    'Carteira (Gangway HC = 0)',
    'Fora da carteira (com execução HC > 0)',
    'Fora da carteira (Execução Zero HC = 0)',
    'Não Cadastrado no Portal (SAP)',
    'Diária (Armador / UMS / Afretadas)',
    'Cancelada (desconsiderada)',
    'Sem programação',
    'Falta PE/EX'
  ];
  const buckets = new Map<string, BucketAgg>();
  const ensureBucket = (name: string): BucketAgg => {
    let b = buckets.get(name);
    if (!b) {
      b = { linhas: 0, hp: 0, hcPortal: 0, hcSap: 0, hcUsado: 0, peHp: 0, exHc: 0, us: 0 };
      buckets.set(name, b);
    }
    return b;
  };
  bucketOrder.slice(0, 8).forEach(ensureBucket);

  const preparedRows: PreparedExportRow[] = [];
  const embAggMap = new Map<string, EmbAuditAgg>();
  const ensureEmbAgg = (opKey: string): EmbAuditAgg => {
    let a = embAggMap.get(opKey);
    if (!a) {
      a = {
        opsCount: 0,
        naoCadastradasSap: 0,
        hpTotal: 0,
        hpCart: 0,
        hpFora: 0,
        hcPortal: 0,
        hcSap: 0,
        hcUsado: 0,
        sumPeHp: 0,
        sumExHc: 0,
        sumUsoff: 0,
        hasFalta: false
      };
      embAggMap.set(opKey, a);
    }
    return a;
  };

  const diariaAccountedKeys = new Set<string>();
  let sumPeHp = 0;
  let sumExHc = 0;
  let sumUsoff = 0;
  let faltaRowCount = 0;

  const pushEvaluatedRow = (args: Omit<PreparedExportRow, 'divPortalSap'> & { statusProg: string }) => {
    const { evalRes } = args;
    const isCancelada = args.statusProg === 'Cancelada';
    if (evalRes.opUsoff == null) {
      faltaRowCount++;
    } else {
      sumPeHp += evalRes.opPeHp || 0;
      sumExHc += evalRes.opExHc || 0;
      sumUsoff += evalRes.opUsoff;
    }

    const agg = ensureBucket(evalRes.bucket);
    agg.linhas += 1;
    agg.hp += args.hp;
    agg.hcPortal += args.hcPortal;
    agg.hcSap += args.hcSap;
    agg.hcUsado += args.hcUsado;
    agg.peHp += evalRes.opPeHp || 0;
    agg.exHc += evalRes.opExHc || 0;
    agg.us += evalRes.opUsoff || 0;

    const embAgg = ensureEmbAgg(args.opKey);
    embAgg.opsCount += 1;
    if (args.statusProg === 'Não Cadastrado no Portal') {
      embAgg.naoCadastradasSap += 1;
    }
    if (!isCancelada) {
      embAgg.hpTotal += args.hp;
      embAgg.hpCart += args.hpCart;
      embAgg.hpFora += Math.max(0, args.hp - args.hpCart);
      embAgg.hcPortal += args.hcPortal;
      embAgg.hcSap += args.hcSap;
      embAgg.hcUsado += args.hcUsado;
    }
    if (evalRes.opUsoff == null) {
      embAgg.hasFalta = true;
    } else {
      embAgg.sumPeHp += evalRes.opPeHp || 0;
      embAgg.sumExHc += evalRes.opExHc || 0;
      embAgg.sumUsoff += evalRes.opUsoff;
    }

    preparedRows.push({
      ...args,
      divPortalSap: round4(args.hcPortal - args.hcSap)
    });
  };

  const hasGranularOps = Boolean(dataset.carteiraOperacoes && dataset.carteiraOperacoes.length > 0);

  if (hasGranularOps) {
    const rawOps = mergeConfrontoOperations(
      dataset.carteiraOperacoes || [],
      dataset.confirmacoesSap || [],
      dataset.carteira || [],
      dataset.tecnicos || {}
    );

    const enrichedOps = rawOps
      .filter(op => {
        const a = op.data_inicio;
        const b = op.data_fim;
        if (enc) {
          if (b < period.ini || b > period.fim) return false;
        } else {
          if (a > period.fim || b < period.ini) return false;
        }
        const l = resolvePlace(pidx, op.plataforma_sigla || undefined, op.unidade_negocio);
        return passesFilter(l, filters, dataset.pessoas);
      })
      .map(op => {
        const a = op.data_inicio;
        const b = op.data_fim;
        const embRef =
          dataset.carteira.find(
            ce =>
              (op.id_embarque && ce.id_embarque === op.id_embarque) ||
              (op.portal_id && ce.id_embarque === op.portal_id) ||
              (ce.matricula === op.matricula && (ce.data_inicio === a || (ce.data_inicio <= b && ce.data_fim >= a)))
          ) || dataset.carteira.find(ce => ce.matricula === op.matricula);
        const embId = op.id_embarque || op.portal_id || embRef?.id_embarque || '';
        const opKey = embId ? `emb:${embId}` : `emb:${op.matricula}_${a}_${op.plataforma_sigla || ''}`;
        const embSummary = embByKey.get(opKey);
        const embIni = embSummary?.ini || embRef?.data_inicio || a || '';
        const embFim = embSummary?.fim || embRef?.data_fim || b || '';
        return { op, embRef, embId, opKey, embSummary, embIni, embFim };
      })
      .sort((x, y) => {
        // Mantém TODAS as ordens/operações do mesmo ID de Embarque em bloco contíguo
        const cmpEmbIni = x.embIni.localeCompare(y.embIni);
        if (cmpEmbIni !== 0) return cmpEmbIni;
        const cmpId = x.embId.localeCompare(y.embId, undefined, { numeric: true });
        if (cmpId !== 0) return cmpId;
        const cmpKey = x.opKey.localeCompare(y.opKey);
        if (cmpKey !== 0) return cmpKey;
        const rank = (s: string) => (s === 'Cancelada' ? 2 : s === 'Não Cadastrado no Portal' ? 1 : 0);
        const cmpRank = rank(x.op.status_programacao) - rank(y.op.status_programacao);
        if (cmpRank !== 0) return cmpRank;
        const cmpOrd = (x.op.ordem || '').localeCompare(y.op.ordem || '', undefined, { numeric: true });
        if (cmpOrd !== 0) return cmpOrd;
        return (x.op.operacao || '').localeCompare(y.op.operacao || '', undefined, { numeric: true });
      });

    enrichedOps.forEach(({ op, embRef, embId, opKey, embSummary, embIni, embFim }) => {
      const a = op.data_inicio;
      const b = op.data_fim;
      const l = resolvePlace(pidx, op.plataforma_sigla || undefined, op.unidade_negocio);
      const platObj = lookupPlatform(pidx, op.plataforma_sigla || undefined);
      const isDiaria = isArmadorPlatform(platObj, op.plataforma_sigla || undefined, op.unidade_negocio, dataset.usoffUnWeights);
      const hasGw = hasGangwayJustification(op.matricula, a, b, dataset.justMap);

      const hp = Number(op.hh_programado) || 0;
      const hcPortal = Number(op.hh_confirmado) || 0;
      const hcSap = Number(op.hh_confirmado_sap) || 0;
      const hc = Math.max(hcSap, hcPortal);
      const isCarteira = op.status_programacao === 'Carteira';
      const hpCart = isCarteira ? hp : 0;

      const weights = resolveUsoffWeights(embRef || null, l, dataset.config, dataset.usoffUnWeights);
      const embDias = embSummary?.dias ?? (embIni && embFim ? diffDays(embIni, embFim) + 1 : a && b ? diffDays(a, b) + 1 : 0);

      const evalRes = evaluateOperationUsoff({
        statusProg: op.status_programacao,
        isDiaria,
        hasGw,
        hp,
        hpCart,
        hc,
        weights,
        embDias,
        embId,
        alreadyCountedDiaria: diariaAccountedKeys.has(opKey)
      });
      if (evalRes.consumedDiaria) {
        diariaAccountedKeys.add(opKey);
      }

      pushEvaluatedRow({
        opKey,
        embId,
        embIni,
        embFim,
        id: embId,
        mat: op.matricula,
        chave: op.chave_petrobras || '',
        nome: op.nome || resolveTechName(op.matricula, dataset),
        empresa: op.empresa || '',
        estrutura: op.estrutura || op.unidade_negocio || '',
        unidadeRaw: op.plataforma_sigla || '',
        ini: a,
        fim: b,
        ordem: op.ordem || '',
        operacao: op.operacao || '',
        statusProc: op.status_processamento || '',
        prioridade: op.prioridade || '',
        statusProg: op.status_programacao || '',
        hp,
        hcPortal,
        recursos: op.recursos != null ? Number(op.recursos) : 1,
        hcSap,
        statusConfronto: resolveConfrontoStatus(op.status_programacao || '', op.status_divergencia, hcPortal, hcSap),
        unSistema: l.r,
        platSistema: l.p,
        isDiaria,
        embDias,
        hcUsado: hc,
        hpCart,
        hasGw,
        evalRes
      });
    });
  } else {
    const listEmbarkations = (enc ? getClosedEmbarkations(period, dataset, filters, pidx) : dataset.carteira)
      .slice()
      .sort((x, y) => {
        const cmpIni = (x.data_inicio || '').localeCompare(y.data_inicio || '');
        if (cmpIni !== 0) return cmpIni;
        return (x.id_embarque || x.id || '').localeCompare(y.id_embarque || y.id || '', undefined, { numeric: true });
      });

    listEmbarkations.forEach(c => {
      const a = enc ? c.data_inicio : c.data_inicio > period.ini ? c.data_inicio : period.ini;
      const b = enc ? c.data_fim : c.data_fim < period.fim ? c.data_fim : period.fim;
      if (a > b) return;

      const l = resolvePlace(pidx, c.plataforma_sigla, c.unidade_negocio);
      if (!passesFilter(l, filters, dataset.pessoas)) return;

      let hc = 0;
      const bb = b < ate ? b : ate;
      eachDay(a, bb, D => {
        const r = resolveRecord(c.matricula, D, dataset);
        if (r) hc += r.e;
      });

      const platObj = lookupPlatform(pidx, c.plataforma_sigla);
      const isDiaria = isArmadorPlatform(platObj, c.plataforma_sigla, c.unidade_negocio, dataset.usoffUnWeights);
      const hasGw = hasGangwayJustification(c.matricula, a, b, dataset.justMap);
      const weights = resolveUsoffWeights(c, l, dataset.config, dataset.usoffUnWeights);
      const embId = c.id_embarque || c.id || '';
      const opKey = embId ? `emb:${embId}` : `emb:${c.matricula}_${a}_${c.plataforma_sigla || ''}`;
      const embSummary = embByKey.get(opKey);
      const embDias = embSummary?.dias ?? diffDays(a, b) + 1;

      const hp = calcHpInInterval(c, a, b, dataset.config, dataset.plataformas);
      const hpCart = calcHpCarteiraInInterval(c, a, b, dataset.config, dataset.plataformas);
      const statusProg = hpCart === 0 && hp > 0 ? 'Fora da carteira' : 'Carteira';

      const evalRes = evaluateOperationUsoff({
        statusProg,
        isDiaria,
        hasGw,
        hp,
        hpCart,
        hc,
        weights,
        embDias,
        embId,
        alreadyCountedDiaria: diariaAccountedKeys.has(opKey)
      });
      if (evalRes.consumedDiaria) {
        diariaAccountedKeys.add(opKey);
      }

      pushEvaluatedRow({
        opKey,
        embId,
        embIni: embSummary?.ini || a,
        embFim: embSummary?.fim || b,
        id: embId,
        mat: c.matricula,
        chave: '',
        nome: c.nome || resolveTechName(c.matricula, dataset),
        empresa: '',
        estrutura: c.unidade_negocio || '',
        unidadeRaw: c.plataforma_sigla || '',
        ini: a,
        fim: b,
        ordem: '',
        operacao: c.operacao || '',
        statusProc: '',
        prioridade: '',
        statusProg,
        hp,
        hcPortal: 0,
        recursos: 1,
        hcSap: 0,
        statusConfronto: 'Legado (HH diário)',
        unSistema: l.r,
        platSistema: l.p,
        isDiaria,
        embDias,
        hcUsado: hc,
        hpCart,
        hasGw,
        evalRes
      });
    });
  }

  if (!enc) {
    embarques
      .filter(e => e.tipo === 'Sem programação')
      .forEach(e => {
        const mat = Array.from(e.mats)[0] || '';
        const plat = Array.from(e.plats)[0] || '';
        const reg = Array.from(e.regs)[0] || '';
        const isDiaria = e.fonte.includes('Diária');
        const hasGw = hasGangwayJustification(mat, e.ini, e.fim, dataset.justMap);
        const peVal = isDiaria ? 'Diária' : e.falta ? 'Falta' : Array.from(e.pes)[0] ?? '';
        const exVal = isDiaria ? 'Diária' : e.falta ? 'Falta' : Array.from(e.exs)[0] ?? '';

        pushEvaluatedRow({
          opKey: e.key,
          embId: e.id_embarque || '',
          embIni: e.ini,
          embFim: e.fim,
          id: e.id_embarque || '',
          mat,
          chave: '',
          nome: resolveTechName(mat, dataset),
          empresa: '',
          estrutura: reg,
          unidadeRaw: plat,
          ini: e.ini,
          fim: e.fim,
          ordem: '',
          operacao: '',
          statusProc: '',
          prioridade: '',
          statusProg: 'Sem programação',
          hp: 0,
          hcPortal: 0,
          recursos: 1,
          hcSap: 0,
          statusConfronto: 'Sem programação (HH diário)',
          unSistema: reg,
          platSistema: plat,
          isDiaria,
          embDias: e.dias,
          hcUsado: e.hc,
          hpCart: 0,
          hasGw,
          evalRes: {
            peVal,
            exVal,
            opPeHp: e.falta ? null : e.peHp,
            opExHc: e.falta ? null : e.exHc,
            opUsoff: e.us,
            regra: isDiaria
              ? `Diária (${e.dias} ${e.dias === 1 ? 'dia' : 'dias'} × 10 — sem programação)`
              : e.falta
              ? 'Falta PE/EX'
              : 'Sem programação (Apontamento HH sem carteira)',
            bucket: e.falta ? 'Falta PE/EX' : isDiaria ? 'Diária (Armador / UMS / Afretadas)' : 'Sem programação',
            consumedDiaria: false
          }
        });
      });
  }

  // Monta matriz da Aba 1 preenchendo Qtd Ops Embarque e Total USoff do Embarque na 1ª linha de cada bloco
  const seenEmbFirstRow = new Set<string>();
  const dataRows: any[][] = preparedRows.map(row => {
    const embSummary = embByKey.get(row.opKey);
    const embAgg = embAggMap.get(row.opKey);
    const isFirstOfEmb = !seenEmbFirstRow.has(row.opKey);
    if (isFirstOfEmb) {
      seenEmbFirstRow.add(row.opKey);
    }
    const embTotalValue: number | string = !isFirstOfEmb
      ? ''
      : embSummary
      ? embSummary.falta || embSummary.us == null
        ? 'Falta PE/EX'
        : round4(embSummary.us)
      : embAgg?.hasFalta
      ? 'Falta PE/EX'
      : round4(embAgg?.sumUsoff || 0);

    return [
      row.id,
      row.mat,
      row.chave,
      row.nome,
      row.empresa,
      row.estrutura,
      row.unidadeRaw,
      row.ini ? formatBr(row.ini) : '',
      row.fim ? formatBr(row.fim) : '',
      row.ordem,
      row.operacao,
      row.statusProc,
      row.prioridade,
      row.statusProg,
      round4(row.hp),
      round4(row.hcPortal),
      row.recursos,
      round4(row.hcSap),
      row.divPortalSap,
      row.statusConfronto,
      row.unSistema,
      row.platSistema,
      row.isDiaria ? 'Diária' : 'HH',
      row.embIni ? formatBr(row.embIni) : '',
      row.embFim ? formatBr(row.embFim) : '',
      row.embDias,
      embAgg?.opsCount ?? 1,
      round4(row.hcUsado),
      round4(row.hpCart),
      row.hasGw ? 'Sim' : 'Não',
      row.evalRes.peVal,
      row.evalRes.exVal,
      row.evalRes.opPeHp != null ? round4(row.evalRes.opPeHp) : '',
      row.evalRes.opExHc != null ? round4(row.evalRes.opExHc) : '',
      row.evalRes.opUsoff != null ? round4(row.evalRes.opUsoff) : '',
      embTotalValue,
      row.evalRes.regra
    ];
  });

  const bannerRows = scopeLabel
    ? [[`[ESCOPO PARCIAL DE CARTEIRA - ${scopeLabel.toUpperCase()}]`], []]
    : [];

  const widths = [
    12, 12, 12, 28, 18, 20, 12, 12, 12, 14, 10, 20, 12, 22, 14, 14, 10,
    18, 20, 24,
    24, 16, 10, 14, 14, 14, 14, 20, 18, 10, 9, 9, 12, 12, 12, 20, 38
  ];
  const sheet1StartDataRow = bannerRows.length + 1;
  const wsPortal = createSheet(XLSX, [...bannerRows, headers, ...dataRows], widths);
  applyDecimalFormatting(XLSX, wsPortal, [14, 15, 17, 18, 27, 28, 30, 31, 32, 33, 34, 35], sheet1StartDataRow);
  XLSX.utils.book_append_sheet(wb, wsPortal, 'Portal Offshore + USOFF');

  // Aba 2: Consolidado por ID de Embarque (1 linha por embarque batendo 100% com a Aba 1 e o painel)
  const sortedEmbarques = embarques.slice().sort((a, b) => {
    const cmpIni = (a.ini || '').localeCompare(b.ini || '');
    if (cmpIni !== 0) return cmpIni;
    const idA = a.id_embarque || a.op || '';
    const idB = b.id_embarque || b.op || '';
    return idA.localeCompare(idB, undefined, { numeric: true });
  });

  const embSheetHeaders = [
    'ID Embarque',
    'Embarque',
    'Tipo',
    'Matrículas',
    'Técnicos',
    'Plataformas',
    'Unidades',
    'Regime',
    'Início Embarque',
    'Fim Embarque',
    'Dias',
    'Qtd Operações',
    'Não Cadastradas SAP',
    'Fonte do HP',
    'HP Total',
    'HP Carteira (≥12d)',
    'HP Fora (<12d)',
    'HC Portal',
    'HH Confirmado (SAP)',
    'HC Considerado (USOFF)',
    'Divergência (Portal − SAP)',
    'PE',
    'EX',
    'PE × HP',
    'EX × HC',
    'USoff (Painel)',
    'Soma USoff (Aba 1)',
    'Diferença'
  ];

  const embSheetRows: any[][] = sortedEmbarques.map(e => {
    const agg = embAggMap.get(e.key);
    const isDiaria = e.fonte.includes('Diária');
    const hcPortal = agg ? agg.hcPortal : 0;
    const hcSap = agg ? agg.hcSap : 0;
    const pesArr = Array.from(e.pes);
    const exsArr = Array.from(e.exs);
    const painelUs = e.falta || e.us == null ? null : round4(e.us);
    const opsUs = agg ? (agg.hasFalta ? null : round4(agg.sumUsoff)) : 0;
    const diffUs = painelUs != null && opsUs != null ? round4(painelUs - opsUs) : '—';

    return [
      e.id_embarque || '',
      e.op,
      e.tipo,
      Array.from(e.mats).join(', '),
      Array.from(e.mats).map(m => resolveTechName(m, dataset)).join(', '),
      Array.from(e.plats).join(', '),
      Array.from(e.regs).join(', '),
      isDiaria ? 'Diária' : 'HH',
      formatBr(e.ini),
      formatBr(e.fim),
      e.dias,
      agg?.opsCount ?? e.totalOps ?? 0,
      agg?.naoCadastradasSap ?? 0,
      e.fonte,
      round4(e.hp),
      round4(e.hpCarteira ?? e.hp),
      round4(e.hpForaCarteira ?? 0),
      round4(hcPortal),
      round4(hcSap),
      round4(e.hc),
      round4(hcPortal - hcSap),
      isDiaria ? 'Diária' : e.falta ? 'Falta' : pesArr.length === 1 ? pesArr[0] : pesArr.join(' / '),
      isDiaria ? 'Diária' : e.falta ? 'Falta' : exsArr.length === 1 ? exsArr[0] : exsArr.join(' / '),
      e.falta ? 'Falta PE/EX' : round4(e.peHp),
      e.falta ? 'Falta PE/EX' : round4(e.exHc),
      painelUs != null ? painelUs : 'Falta PE/EX',
      opsUs != null ? opsUs : 'Falta PE/EX',
      diffUs
    ];
  });

  const wsPorEmb = createSheet(
    XLSX,
    [...bannerRows, embSheetHeaders, ...embSheetRows],
    [14, 16, 14, 14, 28, 16, 22, 10, 14, 14, 8, 14, 18, 18, 12, 16, 14, 12, 18, 20, 20, 9, 9, 12, 12, 14, 18, 12]
  );
  applyDecimalFormatting(XLSX, wsPorEmb, [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27], sheet1StartDataRow);
  XLSX.utils.book_append_sheet(wb, wsPorEmb, 'Por Embarque (ID)');

  // Aba 3: Resumo de Validação (Painel vs Soma das Linhas)
  const filterTags = [
    filters.fReg ? `UN: ${filters.fReg}` : '',
    filters.fPlat ? `Plataforma: ${filters.fPlat}` : '',
    filters.fResp ? `Responsável: ${dataset.pessoas[filters.fResp]?.nome || filters.fResp}` : ''
  ].filter(Boolean);

  const hasFalta = summary.falta > 0 || faltaRowCount > 0;
  const resumoRows: any[][] = [
    ['Infotec Brasil · Validação Portal Offshore + USOFF'],
    ...(scopeLabel ? [[`[ESCOPO PARCIAL DE CARTEIRA - ${scopeLabel.toUpperCase()}]`]] : []),
    [`${periodDisplayName(period)} (${formatBr(period.ini)} a ${formatBr(period.fim)}) · executado até ${formatBr(ate)}`],
    [enc ? 'Critério: embarques com desembarque no período; o embarque entra inteiro' : 'Critério: dias trabalhados no período'],
    ...(filterTags.length > 0 ? [[`Filtros ativos: ${filterTags.join(' | ')}`]] : []),
    [],
    ['Confronto do Total USOFF', 'Valor'],
    ['Total USoff apresentado no painel', summary.us == null ? 'falta PE/EX' : round4(summary.us)],
    ['Soma da coluna USoff (Aba 1)', hasFalta ? `falta PE/EX (${faltaRowCount} linha(s) · parcial: ${round4(sumUsoff)})` : round4(sumUsoff)],
    ['Diferença (Painel − Soma da Aba 1)', hasFalta || summary.us == null ? '—' : round4(summary.us - sumUsoff)],
    ['Parcela Programação (Σ PE × HP) — Painel', summary.falta ? 'falta PE/EX' : round4(summary.peHp)],
    ['Parcela Programação (Σ PE × HP) — Soma Aba 1', hasFalta ? 'falta PE/EX' : round4(sumPeHp)],
    ['Parcela Execução (Σ EX × HC) — Painel', summary.falta ? 'falta PE/EX' : round4(summary.exHc)],
    ['Parcela Execução (Σ EX × HC) — Soma Aba 1', hasFalta ? 'falta PE/EX' : round4(sumExHc)],
    ['Embarques considerados no painel', summary.n],
    ['Total de linhas exportadas na Aba 1', dataRows.length],
    [],
    ['Classificação / Regra', 'Linhas', 'HH Programado', 'HH Conf. Portal', 'HH Conf. SAP', 'HC Considerado', 'PE × HP', 'EX × HC', 'USoff'],
    ...bucketOrder
      .filter(name => buckets.has(name))
      .map(name => {
        const b = buckets.get(name)!;
        return [
          name,
          b.linhas,
          round4(b.hp),
          round4(b.hcPortal),
          round4(b.hcSap),
          round4(b.hcUsado),
          round4(b.peHp),
          round4(b.exHc),
          round4(b.us)
        ];
      })
  ];

  const wsResumo = createSheet(XLSX, resumoRows, [46, 12, 16, 16, 16, 18, 14, 14, 14]);
  const confrontoStartRow = resumoRows.findIndex(r => r[0] === 'Total USoff apresentado no painel');
  const bucketStartRow = resumoRows.findIndex(r => r[0] === 'Classificação / Regra') + 1;
  if (confrontoStartRow >= 0) {
    applyDecimalFormatting(XLSX, wsResumo, [1], confrontoStartRow, '#,##0.00', confrontoStartRow + 6);
  }
  if (bucketStartRow > 0) {
    applyDecimalFormatting(XLSX, wsResumo, [2, 3, 4, 5, 6, 7, 8], bucketStartRow, '#,##0.00');
  }
  XLSX.utils.book_append_sheet(wb, wsResumo, sanitizeSheetName('Resumo Validação'));

  const fileSuffix = periodFileSlug(period);
  const scopeTag = scopeLabel ? ` [PARCIAL - ${scopeLabel}]` : '';
  saveWorkbook(XLSX, wb, `Portal Offshore + USOFF ${fileSuffix}${scopeTag}.xlsx`);
}

// ------------------------------------------------------------------------------
// 3. Exportação Excel: Relatório Individual do Técnico (1 Aba)
// ------------------------------------------------------------------------------

export async function exportTecnicoXlsx(
  mat: string,
  dataset: AppDataset,
  period: PeriodWindow,
  scopeLabel?: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const pidx = buildPlatformIndex(dataset.plataformas);
  const emptyFilters = { fDate: '', fReg: '', fPlat: '', fResp: '', fPer: '', cIni: '', cFim: '' };

  const isEnc = dataset.config.med_criterio === 'enc';
  const closedEmbList = isEnc
    ? getClosedEmbarkations(period, dataset, emptyFilters, pidx).filter(c => c.matricula === mat)
    : [];

  const effectiveWindow: { ini: string; fim: string } = closedEmbList.length
    ? {
        ini: closedEmbList.reduce((min, c) => (c.data_inicio < min ? c.data_inicio : min), period.ini),
        fim: closedEmbList.reduce((max, c) => (c.data_fim > max ? c.data_fim : max), period.fim)
      }
    : { ini: period.ini, fim: period.fim };

  // Resumo do período para o cabeçalho
  const tecs = computePeriodTechs(period, true, dataset, emptyFilters, pidx);
  const tecSummary = tecs.find(t => t.mat === mat) || {
    cartDias: 0,
    prog: 0,
    d: 0,
    e: 0,
    p: null,
    gw: 0,
    jus: 0,
    pend: 0
  };

  const techName = resolveTechName(mat, dataset);

  const headerLines: any[][] = [
    ['Infotec Brasil · Relatório do técnico'],
    scopeLabel
      ? [`[ESCOPO PARCIAL DE CARTEIRA - ${scopeLabel.toUpperCase()}]`]
      : [],
    [`${techName} · Mat. ${mat}`],
    [`${periodDisplayName(period)} (${formatBr(period.ini)} a ${formatBr(period.fim)})`],
    [],
    ['Dias na carteira', tecSummary.cartDias],
    ['HH programado', r1(tecSummary.prog)],
    ['HH disponível', r1(tecSummary.d)],
    ['HH executado', r1(tecSummary.e)],
    ['Execução', rp(tecSummary.p)],
    ['Gangway (h)', r1(tecSummary.gw)],
    ['Justificados', tecSummary.jus],
    ['Pendentes', tecSummary.pend],
    [
      'Atingiu a meta no período?',
      tecSummary.p == null
        ? ''
        : tecSummary.p >= dataset.config.meta_percentual - 0.0001
        ? 'Sim'
        : 'Não'
    ],
    []
  ].filter(line => line.length > 0);

  const tableHeader = [
    'Data',
    'Plataforma',
    'Unidade',
    'Dia do embarque',
    'HH disponível',
    'HH executado',
    '% do dia',
    'Acumulado do embarque',
    'Saldo acumulado (h)',
    'Motivo',
    'Gangway (h)',
    'Descrição',
    'Responsável',
    'Atingiu a meta de horas?'
  ];

  const dailyRows: any[][] = [];

  for (let d = effectiveWindow.ini; d <= effectiveWindow.fim; d = addDays(d, 1)) {
    // Se critério 'enc' e há embarques fechados, filtra para dias dentro de algum embarque
    if (closedEmbList.length > 0) {
      const inClosed = closedEmbList.some(c => c.data_inicio <= d && d <= c.data_fim);
      if (!inClosed) {
        continue;
      }
    }

    const rec = resolveRecord(mat, d, dataset);
    const loc = resolveLocation(mat, d, dataset, pidx);
    const emb = inferEmbarkation(mat, d, dataset);
    const acc = emb ? accumulateEmbarkation(mat, d, emb, dataset) : null;
    const just = dataset.justMap[`${mat}|${d}`] || null;

    if (rec) {
      const pc = rec.d > 0 ? (rec.e / rec.d) * 100 : null;
      dailyRows.push([
        formatBr(d),
        loc.p,
        loc.r,
        emb ? `${emb.dia} de ${emb.n}` : '',
        r1(rec.d),
        rec.sem ? '0 (não informado)' : r1(rec.e),
        rp(pc),
        acc ? rp(acc.p) : '',
        acc ? r1(acc.saldo) : '',
        just ? just.motivo : '',
        just ? r1(just.horas_gangway) : '',
        just ? just.descricao || '' : '',
        just ? just.responsavel_nome || '' : '',
        rec.e >= rec.d - 0.001 ? 'Sim' : 'Não'
      ]);
    }
  }

  const aoa: any[][] = [
    ...headerLines,
    tableHeader,
    ...dailyRows,
    [],
    ['Criado por Luanna de Abreu Teixeira']
  ];

  const ws = createSheet(XLSX, aoa, [12, 16, 20, 14, 12, 12, 10, 14, 14, 30, 10, 40, 20, 14]);
  applyPercentageFormatting(XLSX, { SheetNames: ['Relatório'], Sheets: { Relatório: ws } });
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório');

  // Aba 2: Detalhamento de Confirmações e Ordens do SAP
  const sapList = (dataset.confirmacoesSap || []).filter(cs => cs.matricula === mat);
  if (sapList.length > 0) {
    const sapHeaders = [
      'Data Fim Real',
      'Ordem',
      'Operação',
      'Horas Confirmadas (SAP)',
      'Contador Confirmação',
      'ID Embarque',
      'Situação no Portal Offshore',
      'Data de Criação',
      'Data de Lançamento'
    ];
    const sapRows = sapList.map(cs => [
      formatBr(cs.data_fim_real),
      cs.ordem,
      cs.operacao,
      cs.horas_confirmadas,
      cs.contador_confirmacao || 0,
      cs.id_embarque || '',
      cs.status_reconciliacao === 'Em Carteira' ? 'Cadastrada no Portal' : 'Não Cadastrada no Portal',
      formatBr(cs.data_criacao),
      formatBr(cs.data_lancamento)
    ]);
    const sapWs = createSheet(XLSX, [sapHeaders, ...sapRows], [16, 16, 10, 16, 14, 14, 34, 16, 16]);
    XLSX.utils.book_append_sheet(wb, sapWs, 'Confirmações SAP');
  }

  const fileSuffix = periodFileSlug(period);
  saveWorkbook(XLSX, wb, `HH Offshore ${fileSuffix} ${techName}.xlsx`);
}

// ------------------------------------------------------------------------------
// 4, 5 e 6. Modelos de Planilha para Importação (Cadastro, HH e Carteira)
// ------------------------------------------------------------------------------

export async function exportModeloXlsx(
  kind: 'cad' | 'hh' | 'cart' | 'sap' | 'tec',
  dataset?: AppDataset
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const today = todayIso();

  if (kind === 'cad') {
    // 1. Aba Plataformas pré-populada
    const platList = dataset
      ? Object.values(dataset.plataformas).sort(
          (a, b) => (a.un || '').localeCompare(b.un || '') || a.sigla.localeCompare(b.sigla, undefined, { numeric: true })
        )
      : [];

    const platRows: any[][] = [
      ['Sigla', 'Nome', 'Unidade de negócio', 'Armador', 'Tipo', 'Regime de medição', 'Situação'],
      ...(platList.length > 0
        ? platList.map(p => [
            p.sigla,
            p.nome || '',
            p.un || '',
            p.armador || '',
            p.tipo || '',
            p.tipo_medicao === 'diaria' || /di[áa]ria/i.test(p.tipo || '') ? 'Diária' : 'HH',
            p.situacao || 'Mobilizada'
          ])
        : [
            ['P58', 'Plataforma P-58', 'UN-BSPS', 'Petrobras', 'FPSO', 'HH', 'Mobilizada'],
            ['P74', 'Plataforma P-74', 'UN-BUZIOS', 'Petrobras', 'FPSO', 'HH', 'Mobilizada']
          ])
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, platRows, [10, 40, 26, 24, 24, 18, 14]), 'Plataformas');

    // 2. Aba Pessoas pré-populada
    const pessoasList = dataset
      ? Object.values(dataset.pessoas).sort((a, b) => a.nome.localeCompare(b.nome))
      : [];

    const pessoasRows: any[][] = [
      ['Nome', 'Papel', 'E-mail', 'Plataformas', 'Unidades de negócio'],
      ...(pessoasList.length > 0
        ? pessoasList.map(p => [
            p.nome,
            p.papel === 'controlador' ? 'Controlador' : p.papel === 'gestor' ? 'Gestor' : 'Preposto',
            p.email || '',
            (p.plats || []).join(', '),
            (p.uns || []).join(', ')
          ])
        : [
            ['Nome do Responsável', 'Preposto', 'preposto@infotecbrasil.com.br', 'P58, P74', ''],
            ['Nome do Gestor', 'Gestor', 'gestor@infotecbrasil.com.br', '', 'UN-BSPS, UN-BUZIOS']
          ])
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, pessoasRows, [26, 14, 30, 50, 30]), 'Pessoas');

    // 3. Aba Instruções
    const instrRows: any[][] = [
      ['Instruções de Preenchimento do Cadastro'],
      ['Plataformas: a sigla identifica a plataforma. Unidade de negócio padronizada para todas da mesma bacia/regional.'],
      ['Pessoas: Papel = Preposto, Controlador ou Gestor.'],
      ['Plataformas: siglas separadas por vírgula (ex.: P58, P74).'],
      ['Unidades de negócio: preencha apenas se a pessoa responder pela regional inteira.'],
      ['Importe cada aba individualmente pela tela Pessoas, Plataformas e Acessos.'],
      [],
      ['Criado por Luanna de Abreu Teixeira']
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, instrRows, [110]), 'Instruções');

    saveWorkbook(XLSX, wb, 'Cadastro plataformas e pessoas HH Offshore.xlsx');
    return;
  }

  if (kind === 'hh') {
    const hhRows: any[][] = [
      ['Data', 'Matrícula', 'Nome', 'Função', 'Plataforma', 'HH executado'],
      [formatBr(today), '10231', 'Técnico de Automação Exemplo', 'Técnico de Automação', 'P58', 8.5]
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, hhRows, [12, 10, 30, 22, 16, 14]), 'HH executado');

    const instrRows: any[][] = [
      ['Instruções para Apontamento de HH Executado'],
      ['Uma linha por técnico por dia trabalhado.'],
      ['Data no formato dd/mm/aaaa ou aaaa-mm-dd.'],
      ['Plataforma pela sigla do cadastro (ex.: P58, P74, FPAG). A unidade de negócio o app associa automaticamente.'],
      [
        `HH executado em decimal (ex.: 8,5 ou 8.5) ou hh:mm (08:30). O HH disponível não vai na planilha: o app utiliza ${
          dataset?.config.hh_dia || 11
        } h por dia embarcado.`
      ],
      ['Enviar a mesma data e matrícula atualiza o valor sem duplicar.'],
      [],
      ['Criado por Luanna de Abreu Teixeira']
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, instrRows, [100]), 'Instruções');

    saveWorkbook(XLSX, wb, 'Modelo HH executado offshore.xlsx');
    return;
  }

  if (kind === 'cart') {
    const cartRows: any[][] = [
      ['Matrícula', 'Nome', 'Função', 'Plataforma', 'Embarque', 'Desembarque', 'Horas programadas', 'Operação', 'PE', 'EX'],
      ['10231', 'Técnico de Automação Exemplo', 'Técnico de Automação', 'P58', formatBr(today), formatBr(today), 154, 'OP-2026-01', 1.0, 1.0]
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, cartRows, [10, 30, 22, 16, 12, 12, 18, 14, 8, 8]), 'Programação');

    const instrRows: any[][] = [
      ['Instruções para Carteira de Embarques (Portal Offshore)'],
      ['Uma linha por embarque programado.'],
      ['Datas de Embarque e Desembarque no formato dd/mm/aaaa.'],
      ['Horas programadas: total de horas previstas para o embarque inteiro.'],
      ['Operação, PE e EX são opcionais (utilizados no cálculo da medição USOFF).'],
      ['Mesma matrícula e mesma data de embarque atualizam o registro sem duplicar.'],
      [],
      ['Criado por Luanna de Abreu Teixeira']
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, instrRows, [100]), 'Instruções');

    saveWorkbook(XLSX, wb, 'Modelo carteira de embarque.xlsx');
    return;
  }

  if (kind === 'sap') {
    const sapRows: any[][] = [
      ['Matricula', 'Data_criacao', 'Data_lancamento', 'Data_fim_real', 'Ordem', 'Operacao', 'Contador_confirmacao', 'HC'],
      ['10231', formatBr(today), formatBr(today), formatBr(today), '100085421', '0010', '00000001', 8.5]
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, sapRows, [14, 16, 16, 16, 18, 12, 22, 12]), 'Confirmacoes_SAP');

    const instrRows: any[][] = [
      ['Instruções para Confirmações / Apontamentos do SAP'],
      ['Uma linha por apontamento/confirmação realizada no SAP.'],
      ['Colunas: Matricula, Data_criacao, Data_lancamento, Data_fim_real, Ordem, Operacao, Contador_confirmacao (opcional), HC.'],
      ['Datas no formato dd/mm/aaaa ou aaaa-mm-dd.'],
      ['Contador de confirmação: numeração sequencial/zeros à esquerda que distingue apontamentos múltiplos de um mesmo dia.'],
      ['O sistema realiza a reconciliação e o vínculo com o embarque físico (+4 dias de tolerância e estornos retroativos).'],
      ['Confronto automático com o HH confirmado do Portal Offshore.'],
      [],
      ['Criado por Luanna de Abreu Teixeira']
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, instrRows, [100]), 'Instruções');

    saveWorkbook(XLSX, wb, 'Modelo confirmacoes SAP.xlsx');
    return;
  }

  if (kind === 'tec') {
    const tecList = dataset
      ? Object.values(dataset.tecnicos).sort((a, b) => a.nome.localeCompare(b.nome))
      : [];

    const tecRows: any[][] = [
      ['Matrícula', 'Nome', 'Função'],
      ...(tecList.length > 0
        ? tecList.map(t => [t.matricula, t.nome, t.funcao || 'Técnico Offshore'])
        : [
            ['10231', 'Técnico de Manutenção Exemplo', 'Técnico de Manutenção'],
            ['10232', 'Instrumentista Exemplo', 'Instrumentista']
          ])
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, tecRows, [14, 35, 26]), 'Técnicos Offshore');

    const instrRows: any[][] = [
      ['Instruções para Cadastro de Técnicos Offshore'],
      ['Uma linha por colaborador / técnico embarcado.'],
      ['Matrícula: identificador único e numérico/alfanumérico do técnico.'],
      ['Nome: nome completo do técnico.'],
      ['Função: especialidade offshore (ex.: Técnico Offshore, Instrumentista, Caldeireiro, Delineador).'],
      ['Enviar a mesma matrícula atualiza os dados cadastrais (nome e função) sem duplicar.'],
      [],
      ['Criado por Luanna de Abreu Teixeira']
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, instrRows, [100]), 'Instruções');

    saveWorkbook(XLSX, wb, 'Modelo tecnicos offshore.xlsx');
  }
}

/**
 * Exporta a lista completa de técnicos offshore com contadores de apontamentos e embarques.
 */
export async function exportTecnicosListXlsx(dataset: AppDataset): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const hhCounts: Record<string, number> = {};
  Object.values(dataset.hhMap || {}).forEach(r => {
    if (r?.matricula) {
      hhCounts[r.matricula] = (hhCounts[r.matricula] || 0) + 1;
    }
  });

  const cartCounts: Record<string, number> = {};
  (dataset.carteira || []).forEach(emb => {
    cartCounts[emb.matricula] = (cartCounts[emb.matricula] || 0) + 1;
  });

  const tecList = Object.values(dataset.tecnicos || {}).sort((a, b) =>
    a.nome.localeCompare(b.nome) || a.matricula.localeCompare(b.matricula)
  );

  const rows: any[][] = [
    ['Matrícula', 'Nome do Colaborador', 'Função / Cargo Offshore', 'Apontamentos HH Registrados', 'Embarques em Carteira'],
    ...tecList.map(t => [
      sanitizeSpreadsheetCell(t.matricula),
      sanitizeSpreadsheetCell(t.nome),
      sanitizeSpreadsheetCell(t.funcao || 'Técnico Offshore'),
      hhCounts[t.matricula] || 0,
      cartCounts[t.matricula] || 0
    ])
  ];

  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, rows, [14, 38, 28, 26, 22]), 'Técnicos Offshore');
  saveWorkbook(XLSX, wb, `Tecnicos Offshore - ${todayIso()}.xlsx`);
}

/**
 * Exporta o relatório completo de confronto entre o Portal Offshore e o SAP.
 */
export async function exportConfrontoSAPXlsx(
  operations: CarteiraOperacao[],
  periodLabel: string,
  scopeLabel?: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const headers = [
    'ID Embarque',
    'Matrícula',
    'Técnico',
    'Plataforma',
    'Unidade de Negócio',
    'Início Embarque',
    'Fim Embarque',
    'Ordem',
    'Operação',
    'Status Programação',
    'HH Programado',
    'HH Confirmado (Portal)',
    'HH Confirmado (SAP)',
    'Divergência (Portal - SAP)',
    'Status do Confronto'
  ];

  const dataRows = operations.map(op => [
    op.id_embarque || op.portal_id || '',
    op.matricula,
    op.nome,
    op.plataforma_sigla || '',
    op.unidade_negocio,
    formatBr(op.data_inicio),
    formatBr(op.data_fim),
    op.ordem,
    op.operacao,
    op.status_programacao,
    op.hh_programado,
    op.hh_confirmado,
    op.hh_confirmado_sap || 0,
    op.divergencia_sap || 0,
    op.status_divergencia || 'Não Confirmado'
  ]);

  const bannerRows = scopeLabel
    ? [[`[ESCOPO PARCIAL DE CARTEIRA - ${scopeLabel.toUpperCase()}]`], []]
    : [];

  const widths = [14, 12, 30, 14, 18, 14, 14, 16, 10, 22, 14, 16, 16, 18, 26];
  const ws = createSheet(XLSX, [...bannerRows, headers, ...dataRows], widths);
  XLSX.utils.book_append_sheet(wb, ws, 'Confronto SAP x Portal');

  saveWorkbook(XLSX, wb, `confronto_sap_portal_${slugify(periodLabel)}.xlsx`);
}

/**
 * Exporta o relatório detalhado de apontamentos e ordens confirmadas no SAP em uma data específica.
 */
export async function exportPainelDiaOrdensXlsx(params: {
  date: string;
  dataset: AppDataset;
  rows: DayTechRow[];
  scopeLabel?: string;
}): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const { date, dataset, rows, scopeLabel } = params;
  const sapList = dataset.confirmacoesSap || [];
  const sapByTechDate = new Map<string, ConfirmacaoSAP[]>();
  sapList.forEach(cs => {
    if (cs.matricula && cs.data_fim_real) {
      const key = `${cs.matricula}|${cs.data_fim_real}`;
      const list = sapByTechDate.get(key) || [];
      list.push(cs);
      sapByTechDate.set(key, list);
    }
  });

  const headers = [
    'Data',
    'Matrícula',
    'Técnico',
    'Plataforma',
    'Unidade de Negócio',
    'ID Embarque',
    'Ordem',
    'Operação',
    'Horas SAP',
    'Contador',
    'Situação no Portal',
    'Horas Totais do Dia',
    'Disponível do Dia',
    'Status do Dia',
    'Justificativa'
  ];

  const dataRows: any[][] = [];

  rows.forEach(r => {
    const key = `${r.mat}|${date}`;
    const confirmations = sapByTechDate.get(key) || [];

    if (confirmations.length > 0) {
      confirmations.forEach(c => {
        dataRows.push([
          formatBr(date),
          r.mat,
          r.nome,
          r.p,
          r.r,
          c.id_embarque || (r.emb ? (r.emb as any).id_embarque : '') || '',
          c.ordem,
          c.operacao,
          c.horas_confirmadas,
          c.contador_confirmacao || 0,
          c.status_reconciliacao === 'Em Carteira'
            ? 'Cadastrada no Portal'
            : 'Não Cadastrada no Portal',
          r.e,
          r.d,
          r.st.toUpperCase(),
          r.j ? `${r.j.motivo}${r.j.descricao ? ' - ' + r.j.descricao : ''}` : ''
        ]);
      });
    } else {
      dataRows.push([
        formatBr(date),
        r.mat,
        r.nome,
        r.p,
        r.r,
        r.emb ? (r.emb as any).id_embarque || '' : '',
        '—',
        '—',
        0,
        0,
        r.sem ? 'Sem apontamento (Não Chegou)' : 'Sem ordens no extrato SAP',
        r.e,
        r.d,
        r.st.toUpperCase(),
        r.j ? `${r.j.motivo}${r.j.descricao ? ' - ' + r.j.descricao : ''}` : ''
      ]);
    }
  });

  const bannerRows = scopeLabel
    ? [[`[ESCOPO PARCIAL DE CARTEIRA - ${scopeLabel.toUpperCase()}]`], []]
    : [];

  const widths = [12, 12, 28, 14, 18, 14, 16, 10, 12, 12, 34, 14, 14, 14, 30];
  const ws = createSheet(XLSX, [...bannerRows, headers, ...dataRows], widths);
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(`Apontamentos ${date}`));

  saveWorkbook(XLSX, wb, `apontamentos_ordens_dia_${slugify(date)}.xlsx`);
}
