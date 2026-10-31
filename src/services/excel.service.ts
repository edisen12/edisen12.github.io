// ==============================================================================
// Serviço Excel: Importação Heurística, Remapeamento e as 6 Exportações Oficiais
// Carregamento EXCLUSIVO via Lazy-Import Dinâmico (const XLSX = await import('xlsx'))
// ==============================================================================

import type {
  AppDataset,
  CarteiraEmbarque,
  ContractConfig,
  ImportKind,
  PeriodDayEntry,
  PeriodWindow,
  Pessoa,
  Plataforma
} from '../domain/types';
import {
  diffDays,
  formatBr,
  parseExcelOrStringDate,
  todayIso
} from '../utils/date';
import {
  normalizeText,
  parseFlexibleHours,
  platformKey
} from '../utils/format';
import { periodDisplayName, periodFileSlug } from '../domain/periods';
import {
  accumulateEmbarkation,
  armadorOf,
  buildPlatformIndex,
  computeCobrancaStats,
  computeDataAte,
  computeMeasurementDays,
  computePeriodDays,
  computePeriodTechs,
  findResponsiblePeople,
  getClosedEmbarkations,
  groupDaysByField,
  inferEmbarkation,
  prazoOf,
  resolveLocation,
  resolveRecord,
  resolveTechName
} from '../domain/calculations';
import { computeUsoffOperations, summarizeUsoff } from '../domain/usoff';

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
    { key: 'plat', label: 'Plataforma', synonyms: ['plataforma', 'unidade maritima', 'embarcacao', 'ues', 'instalacao'] },
    { key: 'reg', label: 'Unidade de negócio', synonyms: ['unidade de neg', 'negocio', 'regional', 'bacia', 'un'] },
    { key: 'hp', label: 'Horas programadas', synonyms: ['horas prog', 'hh prog', 'programad', 'hp'] },
    { key: 'op', label: 'Operação', synonyms: ['operacao', 'cod. op', 'op'] },
    { key: 'pe', label: 'PE (ponderação da programação)', synonyms: ['pond. prog', 'ponderacao da prog', 'ponderacao prog', 'pe'] },
    { key: 'ex', label: 'EX (ponderação da execução)', synonyms: ['pond. exec', 'ponderacao da exec', 'ponderacao exec', 'ex'] },
    { key: 'fim', label: 'Desembarque', synonyms: ['desembarque', 'descida', 'retorno', 'fim', 'termino'] },
    { key: 'ini', label: 'Embarque', synonyms: ['embarque', 'subida', 'inicio'] }
  ],
  plat: [
    { key: 'sigla', label: 'Sigla', synonyms: ['sigla', 'codigo'] },
    { key: 'un', label: 'Unidade de negócio', synonyms: ['unidade de neg', 'negocio', 'regional', 'bacia', 'un'] },
    { key: 'nome', label: 'Nome', synonyms: ['nome', 'plataforma', 'descricao'] },
    { key: 'armador', label: 'Armador', synonyms: ['armador', 'empresa'] },
    { key: 'tipo', label: 'Tipo', synonyms: ['tipo', 'categoria'] }
  ],
  pes: [
    { key: 'nome', label: 'Nome', synonyms: ['nome', 'pessoa'] },
    { key: 'papel', label: 'Papel', synonyms: ['papel', 'perfil', 'funcao', 'cargo'] },
    { key: 'email', label: 'E-mail', synonyms: ['mail'] },
    { key: 'plats', label: 'Plataformas', synonyms: ['plataforma'] },
    { key: 'uns', label: 'Unidades de negócio', synonyms: ['unidade', 'regional', 'un'] }
  ]
};

const REQUIRED_KEY_BY_KIND: Record<ImportKind, string> = {
  hh: 'mat',
  cart: 'mat',
  plat: 'sigla',
  pes: 'nome'
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

function createSheet(XLSX: any, rows: any[][], widths?: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
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
  if (/desembarque|embarque/.test(joined) && !/execut/.test(joined)) {
    return 'cart';
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
  pidx?: Record<string, Plataforma>
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
      rows.push({
        sigla,
        nome: String(getVal('nome') || sigla).trim(),
        un: String(getVal('un') || '').trim(),
        armador: String(getVal('armador') || '').trim(),
        tipo: String(getVal('tipo') || '').trim()
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
        ex: parseFlexibleHours(getVal('ex'))
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
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

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
      targetKind === 'hh' || targetKind === 'cart'
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
  pidx: Record<string, Plataforma>,
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
  scopeLabel?: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const pidx = buildPlatformIndex(dataset.plataformas);
  const emptyFilters = { fDate: '', fReg: '', fPlat: '', fResp: '', fPer: '', cIni: '', cFim: '' };

  const ops = computeUsoffOperations(period, dataset, emptyFilters, pidx);
  const T = summarizeUsoff(ops);
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
    ['USoff = Σ [(PE × HP) + (EX × HC)]'],
    []
  ].filter(line => line.length > 0);

  // Aba 1: Resumo USOFF
  const resumoRows: any[][] = [
    ...headerLines,
    ['Indicador', 'Valor'],
    ['Operações', T.n],
    ['HP · horas programadas no período', r1(T.hp)],
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

  // Aba 2: Por operação
  const operRows: any[][] = [
    [
      'Operação',
      'Tipo',
      'Matrículas',
      'Técnicos',
      'Plataformas',
      'Unidades',
      isEnc ? 'Embarque' : 'Início no período',
      isEnc ? 'Desembarque' : 'Fim no período',
      'Dias',
      'Fonte do HP',
      'HP',
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
    ...ops.map(x => [
      x.op || (x.sharedAcrossPortfolios ? '[COMPARTILHADA]' : ''),
      x.tipo,
      Array.from(x.mats).join(', '),
      Array.from(x.mats).map(m => resolveTechName(m, dataset)).join(', '),
      Array.from(x.plats).join(', '),
      Array.from(x.regs).join(', '),
      formatBr(x.ini),
      formatBr(x.fim),
      x.dias,
      x.fonte,
      r1(x.hp),
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
  XLSX.utils.book_append_sheet(wb, createSheet(XLSX, operRows, [16, 14, 14, 30, 16, 22, 12, 12, 6, 16, 10, 12, 10, 10, 9, 9, 8, 8, 10, 10, 10]), 'Por operação');

  applyPercentageFormatting(XLSX, wb);

  const fileSuffix = periodFileSlug(period);
  const scopeTag = scopeLabel ? ` [PARCIAL - ${scopeLabel}]` : '';
  saveWorkbook(XLSX, wb, `USOFF ${fileSuffix}${scopeTag}.xlsx`);
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

  for (let d = effectiveWindow.ini; d <= effectiveWindow.fim; d = String(d)) {
    // Se critério 'enc' e há embarques fechados, filtra para dias dentro de algum embarque
    if (closedEmbList.length > 0) {
      const inClosed = closedEmbList.some(c => c.data_inicio <= d && d <= c.data_fim);
      if (!inClosed) {
        // Incrementa dia
        const nextDate = new Date(d);
        nextDate.setDate(nextDate.getDate() + 1);
        d = nextDate.toISOString().slice(0, 10);
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

    const nextD = new Date(d);
    nextD.setDate(nextD.getDate() + 1);
    d = nextD.toISOString().slice(0, 10);
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

  const fileSuffix = periodFileSlug(period);
  saveWorkbook(XLSX, wb, `HH Offshore ${fileSuffix} ${techName}.xlsx`);
}

// ------------------------------------------------------------------------------
// 4, 5 e 6. Modelos de Planilha para Importação (Cadastro, HH e Carteira)
// ------------------------------------------------------------------------------

export async function exportModeloXlsx(
  kind: 'cad' | 'hh' | 'cart',
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
      ['Sigla', 'Nome', 'Unidade de negócio', 'Armador', 'Tipo', 'Situação'],
      ...(platList.length > 0
        ? platList.map(p => [
            p.sigla,
            p.nome || '',
            p.un || '',
            p.armador || '',
            p.tipo || '',
            p.situacao || 'Mobilizada'
          ])
        : [
            ['P58', 'Plataforma P-58', 'UN-BSPS', 'Petrobras', 'FPSO', 'Mobilizada'],
            ['P74', 'Plataforma P-74', 'UN-BUZIOS', 'Petrobras', 'FPSO', 'Mobilizada']
          ])
    ];
    XLSX.utils.book_append_sheet(wb, createSheet(XLSX, platRows, [10, 40, 26, 24, 30, 14]), 'Plataformas');

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
  }
}
