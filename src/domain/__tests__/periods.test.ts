import { describe, expect, it } from 'vitest';
import type { FilterState, PeriodWindow } from '../types';
import {
  eachDay,
  listMeasurementOptions,
  neededQueryWindow,
  perContaining,
  periodDisplayName,
  periodFileSlug,
  periodOf,
  resolveActivePeriod
} from '../periods';
import { diffDays } from '../../utils/date';

describe('src/domain/periods.ts - Gestão de Períodos Contratuais & Janelas de Medição', () => {
  describe('Cortes de medição contratuais (1, 16, 21, 26)', () => {
    describe('Corte dia 21 (Padrão contratual: dia 21 do mês anterior ao dia 20 do mês referência)', () => {
      it('calcula corretamente o período normal do dia 21 ao 20', () => {
        const P = periodOf('2026-10', 21);
        expect(P).toEqual({
          ini: '2026-09-21',
          fim: '2026-10-20',
          m: '2026-10'
        });
      });

      it('perContaining mapeia datas <= 20 para o mês corrente e >= 21 para o mês seguinte', () => {
        expect(perContaining('2026-10-20', 21)).toBe('2026-10');
        expect(perContaining('2026-10-21', 21)).toBe('2026-11');
        expect(perContaining('2026-09-21', 21)).toBe('2026-10');
        expect(perContaining('2026-10-01', 21)).toBe('2026-10');
      });
    });

    describe('Corte dia 1 (Mês civil cheio: 1º ao último dia do mês)', () => {
      it('calcula o mês de 01 até o último dia (30, 31 ou 28/29)', () => {
        const pOut = periodOf('2026-10', 1);
        expect(pOut).toEqual({
          ini: '2026-10-01',
          fim: '2026-10-31',
          m: '2026-10'
        });

        const pAbr = periodOf('2026-04', 1);
        expect(pAbr).toEqual({
          ini: '2026-04-01',
          fim: '2026-04-30',
          m: '2026-04'
        });

        const pFev = periodOf('2026-02', 1);
        expect(pFev).toEqual({
          ini: '2026-02-01',
          fim: '2026-02-28',
          m: '2026-02'
        });
      });

      it('perContaining para corte dia 1 retorna sempre o próprio mês da data', () => {
        expect(perContaining('2026-10-01', 1)).toBe('2026-10');
        expect(perContaining('2026-10-15', 1)).toBe('2026-10');
        expect(perContaining('2026-10-31', 1)).toBe('2026-10');
      });
    });

    describe('Corte dia 16 (Dia 16 do mês anterior ao dia 15 do mês referência)', () => {
      it('calcula janela do dia 16 ao dia 15', () => {
        const P = periodOf('2026-05', 16);
        expect(P).toEqual({
          ini: '2026-04-16',
          fim: '2026-05-15',
          m: '2026-05'
        });
      });

      it('perContaining para corte dia 16', () => {
        expect(perContaining('2026-05-15', 16)).toBe('2026-05');
        expect(perContaining('2026-05-16', 16)).toBe('2026-06');
        expect(perContaining('2026-04-16', 16)).toBe('2026-05');
      });
    });

    describe('Corte dia 26 (Dia 26 do mês anterior ao dia 25 do mês referência)', () => {
      it('calcula janela do dia 26 ao dia 25', () => {
        const P = periodOf('2026-08', 26);
        expect(P).toEqual({
          ini: '2026-07-26',
          fim: '2026-08-25',
          m: '2026-08'
        });
      });

      it('perContaining para corte dia 26', () => {
        expect(perContaining('2026-08-25', 26)).toBe('2026-08');
        expect(perContaining('2026-08-26', 26)).toBe('2026-09');
        expect(perContaining('2026-07-26', 26)).toBe('2026-08');
      });
    });
  });

  describe('Viradas de ano e anos bissextos', () => {
    it('trata virada de ano em Dezembro -> Janeiro para diaCorte = 21', () => {
      const pJan = periodOf('2026-01', 21);
      expect(pJan).toEqual({
        ini: '2025-12-21',
        fim: '2026-01-20',
        m: '2026-01'
      });

      expect(perContaining('2025-12-21', 21)).toBe('2026-01');
      expect(perContaining('2025-12-31', 21)).toBe('2026-01');
      expect(perContaining('2026-01-20', 21)).toBe('2026-01');
      expect(perContaining('2026-01-21', 21)).toBe('2026-02');
    });

    it('trata virada de ano para diaCorte = 16 e diaCorte = 26', () => {
      const p16 = periodOf('2026-01', 16);
      expect(p16.ini).toBe('2025-12-16');
      expect(p16.fim).toBe('2026-01-15');

      const p26 = periodOf('2026-01', 26);
      expect(p26.ini).toBe('2025-12-26');
      expect(p26.fim).toBe('2026-01-25');
    });

    it('ano bissexto: fevereiro com 29 dias (2024)', () => {
      const pFev2024 = periodOf('2024-02', 1);
      expect(pFev2024.ini).toBe('2024-02-01');
      expect(pFev2024.fim).toBe('2024-02-29');

      // Medição de Março/2024 com corte 21 inclui 29/02/2024
      const pMar2024 = periodOf('2024-03', 21);
      expect(pMar2024.ini).toBe('2024-02-21');
      expect(pMar2024.fim).toBe('2024-03-20');

      let daysCount = 0;
      let viuBissexto = false;
      eachDay(pMar2024.ini, pMar2024.fim, d => {
        daysCount++;
        if (d === '2024-02-29') viuBissexto = true;
      });

      expect(viuBissexto).toBe(true);
      expect(daysCount).toBe(diffDays(pMar2024.ini, pMar2024.fim) + 1);
    });
  });

  describe('resolveActivePeriod', () => {
    it('retorna janela personalizada quando fPer === "custom" com cIni e cFim válidos', () => {
      const filters: FilterState = {
        fDate: '',
        fReg: '',
        fPlat: '',
        fResp: '',
        fPer: 'custom',
        cIni: '2026-03-10',
        cFim: '2026-04-05'
      };

      const P = resolveActivePeriod(filters, 21);
      expect(P).toEqual({
        ini: '2026-03-10',
        fim: '2026-04-05',
        m: '2026-04',
        custom: true
      });
    });

    it('ignora custom e faz fallback se cIni for maior que cFim', () => {
      const filters: FilterState = {
        fDate: '2026-10-15',
        fReg: '',
        fPlat: '',
        fResp: '',
        fPer: 'custom',
        cIni: '2026-10-20',
        cFim: '2026-10-10' // Inválido: fim antes de início
      };

      const P = resolveActivePeriod(filters, 21);
      expect(P.custom).toBeUndefined();
      expect(P.m).toBe('2026-10');
      expect(P.ini).toBe('2026-09-21');
      expect(P.fim).toBe('2026-10-20');
    });

    it('retorna o mês selecionado explicitamente em fPer', () => {
      const filters: FilterState = {
        fDate: '2026-10-15',
        fReg: '',
        fPlat: '',
        fResp: '',
        fPer: '2026-07',
        cIni: '',
        cFim: ''
      };

      const P = resolveActivePeriod(filters, 21);
      expect(P).toEqual({
        ini: '2026-06-21',
        fim: '2026-07-20',
        m: '2026-07'
      });
    });

    it('infere o período a partir de fDate se fPer estiver vazio', () => {
      const filters: FilterState = {
        fDate: '2026-10-25', // >= 21 com corte 21 pertence à medição de 2026-11
        fReg: '',
        fPlat: '',
        fResp: '',
        fPer: '',
        cIni: '',
        cFim: ''
      };

      const P = resolveActivePeriod(filters, 21);
      expect(P.m).toBe('2026-11');
      expect(P.ini).toBe('2026-10-21');
      expect(P.fim).toBe('2026-11-20');
    });

    it('usa a data today injetada se nem fPer nem fDate forem informados', () => {
      const filters: FilterState = {
        fDate: '',
        fReg: '',
        fPlat: '',
        fResp: '',
        fPer: '',
        cIni: '',
        cFim: ''
      };

      const P = resolveActivePeriod(filters, 21, '2026-05-10');
      expect(P.m).toBe('2026-05');
      expect(P.ini).toBe('2026-04-21');
      expect(P.fim).toBe('2026-05-20');
    });
  });

  describe('periodDisplayName e periodFileSlug', () => {
    it('formata nome e slug para período padrão', () => {
      const P: PeriodWindow = {
        ini: '2026-09-21',
        fim: '2026-10-20',
        m: '2026-10'
      };

      expect(periodDisplayName(P)).toBe('Medição de outubro/2026');
      expect(periodFileSlug(P)).toBe('2026-10');
    });

    it('formata nome e slug para período customizado', () => {
      const P: PeriodWindow = {
        ini: '2026-10-01',
        fim: '2026-10-15',
        m: '2026-10',
        custom: true
      };

      expect(periodDisplayName(P)).toBe('Período livre');
      expect(periodFileSlug(P)).toBe('2026-10-01 a 2026-10-15');
    });
  });

  describe('listMeasurementOptions', () => {
    it('gera lista de opções de medição em ordem decrescente', () => {
      const options = listMeasurementOptions('2026-10-15', 21, 6);
      expect(options).toHaveLength(6);

      // cur = perContaining('2026-10-15', 21) = '2026-10'
      // Primeiro item é nextMonth('2026-10') = '2026-11'
      expect(options[0].value).toBe('2026-11');
      expect(options[0].label).toContain('Medição');
      expect(options[0].window).toEqual({
        ini: '2026-10-21',
        fim: '2026-11-20',
        m: '2026-11'
      });

      expect(options[1].value).toBe('2026-10');
      expect(options[2].value).toBe('2026-09');
      expect(options[3].value).toBe('2026-08');
      expect(options[4].value).toBe('2026-07');
      expect(options[5].value).toBe('2026-06');
    });

    it('gera 13 opções por padrão quando count não é especificado', () => {
      const options = listMeasurementOptions('2026-10-15', 21);
      expect(options).toHaveLength(13);
    });
  });

  describe('eachDay', () => {
    it('itera por cada dia inclusivo entre ini e fim', () => {
      const days: string[] = [];
      eachDay('2026-10-01', '2026-10-05', d => days.push(d));
      expect(days).toEqual([
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
        '2026-10-04',
        '2026-10-05'
      ]);
    });

    it('itera apenas uma vez quando ini === fim', () => {
      const days: string[] = [];
      eachDay('2026-10-01', '2026-10-01', d => days.push(d));
      expect(days).toEqual(['2026-10-01']);
    });

    it('não executa nenhuma iteração quando ini > fim', () => {
      const days: string[] = [];
      eachDay('2026-10-05', '2026-10-01', d => days.push(d));
      expect(days).toHaveLength(0);
    });
  });

  describe('neededQueryWindow (Janela de lookback de 45 dias)', () => {
    it('aplica recuo de 45 dias na data inicial para não truncar embarques encerrados no período', () => {
      const P: PeriodWindow = {
        ini: '2026-09-21',
        fim: '2026-10-20',
        m: '2026-10'
      };
      const refDate = '2026-10-15';

      const window = neededQueryWindow(P, refDate);
      // minDate = min('2026-09-21', '2026-10-15') = '2026-09-21'
      // maxDate = max('2026-10-20', '2026-10-15') = '2026-10-20'
      // 45 dias antes de 2026-09-21:
      // Setembro tem 30 dias -> 21 dias em Setembro + 24 dias em Agosto (31 - 24 = 7) -> 2026-08-07
      expect(window.queryFim).toBe('2026-10-20');
      expect(diffDays(window.queryIni, '2026-09-21')).toBe(45);
      expect(window.queryIni).toBe('2026-08-07');
    });

    it('expande queryFim se refDate for posterior a P.fim', () => {
      const P: PeriodWindow = {
        ini: '2026-05-21',
        fim: '2026-06-20',
        m: '2026-06'
      };
      const refDate = '2026-07-01'; // Posterior ao fim da medição

      const window = neededQueryWindow(P, refDate);
      expect(window.queryFim).toBe('2026-07-01');
      expect(diffDays(window.queryIni, '2026-05-21')).toBe(45);
    });

    it('expande queryIni se refDate for anterior a P.ini', () => {
      const P: PeriodWindow = {
        ini: '2026-09-21',
        fim: '2026-10-20',
        m: '2026-10'
      };
      const refDate = '2026-09-01'; // Anterior ao início

      const window = neededQueryWindow(P, refDate);
      expect(diffDays(window.queryIni, '2026-09-01')).toBe(45);
    });
  });
});
