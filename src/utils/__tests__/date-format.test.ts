import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  formatBr,
  formatBrShort,
  isoOf,
  lastDayOfMonth,
  mesNome,
  mesOf,
  nextMonth,
  pad,
  parseExcelOrStringDate,
  prevMonth,
  toDate,
  todayIso
} from '../date';
import {
  calcPct,
  formatHours,
  formatHoursInt,
  formatPct,
  formatSignedHours,
  formatUs,
  normalizeText,
  parseFlexibleHours,
  platformKey,
  plural,
  safeKey,
  slugify
} from '../format';

describe('src/utils/date.ts - Utilitários de Data & Prevenção de Timezone Drift', () => {
  describe('pad', () => {
    it('adiciona zero à esquerda em números de 0 a 9', () => {
      expect(pad(0)).toBe('00');
      expect(pad(5)).toBe('05');
      expect(pad(9)).toBe('09');
    });

    it('mantém números com 2 dígitos inalterados', () => {
      expect(pad(10)).toBe('10');
      expect(pad(31)).toBe('31');
    });

    it('funciona corretamente com strings', () => {
      expect(pad('7')).toBe('07');
      expect(pad('12')).toBe('12');
    });
  });

  describe('isoOf e toDate (Invariante de Timezone)', () => {
    it('extrai corretamente YYYY-MM-DD de um Date', () => {
      const d = new Date(2026, 9, 31, 15, 30); // 31 de Outubro de 2026
      expect(isoOf(d)).toBe('2026-10-31');
    });

    it('instancia Date ao meio-dia (12h) para imunidade contra UTC / GMT-3 / Horário de Verão', () => {
      const d = toDate('2026-05-21');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(4); // Maio = index 4
      expect(d.getDate()).toBe(21);
      expect(d.getHours()).toBe(12);

      // Verificação bidirecional: toDate -> isoOf deve preservar exatamente a mesma data
      expect(isoOf(toDate('2026-05-21'))).toBe('2026-05-21');
      expect(isoOf(toDate('2026-01-01'))).toBe('2026-01-01');
      expect(isoOf(toDate('2026-12-31'))).toBe('2026-12-31');
    });

    it('nunca sofre drift de timezone recuando para o dia anterior (ex: 2026-05-21 não vira 2026-05-20)', () => {
      const dates = [
        '2026-01-01',
        '2026-02-28',
        '2024-02-29',
        '2026-05-21',
        '2026-10-20',
        '2026-12-31'
      ];
      dates.forEach(iso => {
        const d = toDate(iso);
        expect(isoOf(d)).toBe(iso);
      });
    });
  });

  describe('todayIso', () => {
    it('retorna uma string ISO válida no formato YYYY-MM-DD correspondente a hoje', () => {
      const today = todayIso();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const parsed = toDate(today);
      expect(isoOf(parsed)).toBe(today);
    });
  });

  describe('addDays', () => {
    it('adiciona dias dentro do mesmo mês', () => {
      expect(addDays('2026-10-10', 5)).toBe('2026-10-15');
      expect(addDays('2026-10-01', 1)).toBe('2026-10-02');
    });

    it('avança para o mês seguinte e ano seguinte', () => {
      expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    });

    it('subtrai dias (valores negativos) cruzando mês e ano', () => {
      expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
      expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    });

    it('respeita corretamente anos bissextos (29 de fevereiro)', () => {
      // 2024 é bissexto
      expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
      expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
      expect(addDays('2024-03-01', -1)).toBe('2024-02-29');

      // 2026 não é bissexto
      expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    });
  });

  describe('diffDays', () => {
    it('retorna 0 para a mesma data', () => {
      expect(diffDays('2026-10-15', '2026-10-15')).toBe(0);
    });

    it('calcula diferença positiva quando b > a', () => {
      expect(diffDays('2026-10-01', '2026-10-15')).toBe(14);
      expect(diffDays('2026-10-01', '2026-10-02')).toBe(1);
    });

    it('calcula diferença negativa quando b < a', () => {
      expect(diffDays('2026-10-15', '2026-10-01')).toBe(-14);
    });

    it('calcula diferença correta cruzando meses e anos bissextos', () => {
      expect(diffDays('2024-02-28', '2024-03-01')).toBe(2);
      expect(diffDays('2026-02-28', '2026-03-01')).toBe(1);
      expect(diffDays('2025-12-31', '2026-01-01')).toBe(1);
    });
  });

  describe('formatBr e formatBrShort', () => {
    it('formatBr formata ISO YYYY-MM-DD para DD/MM/YYYY', () => {
      expect(formatBr('2026-10-31')).toBe('31/10/2026');
      expect(formatBr('2026-01-05')).toBe('05/01/2026');
    });

    it('formatBr retorna travessão "—" para valores vazios ou nulos', () => {
      expect(formatBr(null)).toBe('—');
      expect(formatBr(undefined)).toBe('—');
      expect(formatBr('')).toBe('—');
    });

    it('formatBrShort formata ISO YYYY-MM-DD para DD/MM', () => {
      expect(formatBrShort('2026-10-31')).toBe('31/10');
      expect(formatBrShort('2026-05-02')).toBe('02/05');
    });

    it('formatBrShort retorna "—" para valores vazios ou nulos', () => {
      expect(formatBrShort(null)).toBe('—');
      expect(formatBrShort(undefined)).toBe('—');
      expect(formatBrShort('')).toBe('—');
    });
  });

  describe('mesOf, mesNome, lastDayOfMonth, prevMonth, nextMonth', () => {
    it('mesOf extrai YYYY-MM', () => {
      expect(mesOf('2026-10-31')).toBe('2026-10');
      expect(mesOf('2026-01-01')).toBe('2026-01');
    });

    it('mesNome traduz YYYY-MM para NomeDoMes/YYYY em português', () => {
      expect(mesNome('2026-10')).toBe('outubro/2026');
      expect(mesNome('2026-01')).toBe('janeiro/2026');
      expect(mesNome('2026-12')).toBe('dezembro/2026');
      expect(mesNome('2026-02')).toBe('fevereiro/2026');
    });

    it('lastDayOfMonth retorna o último dia do mês corretamente', () => {
      expect(lastDayOfMonth('2026-01')).toBe('2026-01-31');
      expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
      expect(lastDayOfMonth('2024-02')).toBe('2024-02-29'); // Bissexto
      expect(lastDayOfMonth('2026-04')).toBe('2026-04-30');
      expect(lastDayOfMonth('2026-12')).toBe('2026-12-31');
    });

    it('prevMonth recua 1 mês respeitando virada de ano', () => {
      expect(prevMonth('2026-10')).toBe('2026-09');
      expect(prevMonth('2026-01')).toBe('2025-12');
    });

    it('nextMonth avança 1 mês respeitando virada de ano', () => {
      expect(nextMonth('2026-09')).toBe('2026-10');
      expect(nextMonth('2026-12')).toBe('2027-01');
    });
  });

  describe('parseExcelOrStringDate', () => {
    it('retorna null para valores vazios, nulos ou indefinidos', () => {
      expect(parseExcelOrStringDate(null)).toBeNull();
      expect(parseExcelOrStringDate(undefined)).toBeNull();
      expect(parseExcelOrStringDate('')).toBeNull();
    });

    it('converte instância de Date para YYYY-MM-DD', () => {
      const d = new Date(2026, 4, 15, 10, 0);
      expect(parseExcelOrStringDate(d)).toBe('2026-05-15');
    });

    it('converte serial numérico do Excel (ex: ~45000) para data correta', () => {
      // 45580 = 2024-10-15
      const parsed = parseExcelOrStringDate(45580);
      expect(parsed).toMatch(/^2024-10-\d{2}$/);
    });

    it('ignora números fora do intervalo aceitável de datas Excel', () => {
      expect(parseExcelOrStringDate(100)).toBeNull();
      expect(parseExcelOrStringDate(150000)).toBeNull();
    });

    it('converte string ISO YYYY-MM-DD', () => {
      expect(parseExcelOrStringDate('2026-10-31')).toBe('2026-10-31');
      expect(parseExcelOrStringDate('2026-2-5')).toBe('2026-02-05');
      expect(parseExcelOrStringDate('2026-10-31T14:30:00')).toBe('2026-10-31');
    });

    it('converte datas no formato brasileiro DD/MM/YYYY ou DD/MM/YY', () => {
      expect(parseExcelOrStringDate('31/10/2026')).toBe('2026-10-31');
      expect(parseExcelOrStringDate('05-02-2026')).toBe('2026-02-05');
      expect(parseExcelOrStringDate('15.08.2026')).toBe('2026-08-15');
      // 2 dígitos de ano
      expect(parseExcelOrStringDate('31/10/26')).toBe('2026-10-31');
    });

    it('retorna null para formatos textuais inválidos', () => {
      expect(parseExcelOrStringDate('data-invalida')).toBeNull();
      expect(parseExcelOrStringDate('abc/def/ghij')).toBeNull();
    });
  });
});

describe('src/utils/format.ts - Formatação Numérica, Textual & Slugs', () => {
  describe('formatHours e formatHoursInt', () => {
    it('formatHours formata com 1 casa decimal e sufixo h', () => {
      expect(formatHours(11)).toBe('11,0 h');
      expect(formatHours(5.5)).toBe('5,5 h');
      expect(formatHours(0)).toBe('0,0 h');
    });

    it('formatHours retorna "—" para valores nulos ou NaN', () => {
      expect(formatHours(null)).toBe('—');
      expect(formatHours(undefined)).toBe('—');
      expect(formatHours(NaN)).toBe('—');
    });

    it('formatHoursInt arredonda para inteiro', () => {
      expect(formatHoursInt(11.4)).toBe('11 h');
      expect(formatHoursInt(11.6)).toBe('12 h');
      expect(formatHoursInt(null)).toBe('—');
    });
  });

  describe('formatSignedHours', () => {
    it('adiciona prefixo + para saldos positivos', () => {
      expect(formatSignedHours(5)).toBe('+5,0 h');
      expect(formatSignedHours(0.5)).toBe('+0,5 h');
    });

    it('formata valores negativos com sinal de menos', () => {
      expect(formatSignedHours(-5)).toBe('-5,0 h');
      expect(formatSignedHours(-0.5)).toBe('-0,5 h');
    });

    it('formata zero sem prefixo +', () => {
      expect(formatSignedHours(0)).toBe('0,0 h');
    });

    it('retorna "—" para nulo ou indefinido', () => {
      expect(formatSignedHours(null)).toBe('—');
      expect(formatSignedHours(undefined)).toBe('—');
    });
  });

  describe('formatPct e calcPct', () => {
    it('calcPct calcula percentual correto (e / d * 100)', () => {
      expect(calcPct(11, 11)).toBe(100);
      expect(calcPct(5.5, 11)).toBe(50);
      expect(calcPct(0, 11)).toBe(0);
    });

    it('calcPct retorna null se d <= 0 para evitar divisão por zero', () => {
      expect(calcPct(5, 0)).toBeNull();
      expect(calcPct(0, 0)).toBeNull();
      expect(calcPct(5, -1)).toBeNull();
    });

    it('formatPct formata valor inteiro com sufixo %', () => {
      expect(formatPct(100)).toBe('100%');
      expect(formatPct(95.4)).toBe('95%');
      expect(formatPct(95.6)).toBe('96%');
    });

    it('formatPct retorna "—" para nulo, indefinido ou NaN', () => {
      expect(formatPct(null)).toBe('—');
      expect(formatPct(undefined)).toBe('—');
      expect(formatPct(NaN)).toBe('—');
    });
  });

  describe('formatUs', () => {
    it('formata US com 2 casas decimais no padrão pt-BR', () => {
      expect(formatUs(1234.56)).toBe('1.234,56');
      expect(formatUs(100)).toBe('100,00');
    });

    it('retorna "—" para valores ausentes', () => {
      expect(formatUs(null)).toBe('—');
      expect(formatUs(undefined)).toBe('—');
    });
  });

  describe('normalizeText', () => {
    it('remove acentos, converte para minúsculas e remove espaços extras', () => {
      expect(normalizeText('  Atenção Operação ESPÍRITO SANTO  ')).toBe(
        'atencao operacao espirito santo'
      );
      expect(normalizeText('Búzios (UN-BUZ)')).toBe('buzios (un-buz)');
      expect(normalizeText(null)).toBe('');
      expect(normalizeText(undefined)).toBe('');
    });
  });

  describe('platformKey', () => {
    it('normaliza nome de plataforma removendo espaços, traços e pontuações', () => {
      expect(platformKey('P-58')).toBe('p58');
      expect(platformKey('P - 74')).toBe('p74');
      expect(platformKey('FPSO Carioca (MV-30)')).toBe('fpsocariocamv30');
      expect(platformKey('P-66 / P-67')).toBe('p66p67');
      expect(platformKey(null)).toBe('');
    });
  });

  describe('safeKey', () => {
    it('substitui caracteres perigosos por underscore preservando caracteres seguros', () => {
      expect(safeKey('P-58_v1.0')).toBe('P-58_v1.0');
      expect(safeKey('chave com espacos e / barras')).toBe('chave_com_espacos_e___barras');
    });
  });

  describe('slugify', () => {
    it('cria slug URL-friendly limpo', () => {
      expect(slugify('P-58 Espírito Santo')).toBe('p-58-espirito-santo');
      expect(slugify('---Relatório Mensal 2026---')).toBe('relatorio-mensal-2026');
      expect(slugify('')).toBe('item');
    });
  });

  describe('parseFlexibleHours', () => {
    it('retorna o número diretamente se já for number', () => {
      expect(parseFlexibleHours(11)).toBe(11);
      expect(parseFlexibleHours(5.5)).toBe(5.5);
      expect(parseFlexibleHours(NaN)).toBeNull();
    });

    it('faz parse de strings com notação de horas (ex: 11h, 11 h)', () => {
      expect(parseFlexibleHours('11h')).toBe(11);
      expect(parseFlexibleHours('11 h')).toBe(11);
      expect(parseFlexibleHours(' 5,5 h ')).toBe(5.5);
    });

    it('faz parse de formato de tempo HH:MM (ex: 10:30 -> 10.5h)', () => {
      expect(parseFlexibleHours('11:00')).toBe(11);
      expect(parseFlexibleHours('10:30')).toBe(10.5);
      expect(parseFlexibleHours('06:15')).toBe(6.25);
    });

    it('faz parse de decimais com vírgula ou ponto e separadores de milhar', () => {
      expect(parseFlexibleHours('1.250,5')).toBe(1250.5);
      expect(parseFlexibleHours('11,5')).toBe(11.5);
      expect(parseFlexibleHours('11.5')).toBe(11.5);
    });

    it('retorna null para valores nulos, vazios ou inválidos', () => {
      expect(parseFlexibleHours(null)).toBeNull();
      expect(parseFlexibleHours('')).toBeNull();
      expect(parseFlexibleHours('não-numérico')).toBeNull();
    });
  });

  describe('plural', () => {
    it('retorna forma singular para n = 1', () => {
      expect(plural(1, 'dia', 'dias')).toBe('1 dia');
      expect(plural(1, 'técnico', 'técnicos')).toBe('1 técnico');
    });

    it('retorna forma plural para n = 0 ou n > 1', () => {
      expect(plural(0, 'dia', 'dias')).toBe('0 dias');
      expect(plural(2, 'dia', 'dias')).toBe('2 dias');
      expect(plural(14, 'hora', 'horas')).toBe('14 horas');
    });
  });
});
