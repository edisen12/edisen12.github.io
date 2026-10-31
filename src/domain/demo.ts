import type {
  ApontamentoHH,
  CarteiraEmbarque,
  ContractConfig,
  Justificativa,
  Pessoa,
  Plataforma,
  Tecnico,
  WatermarkStatus
} from './types';
import { addDays, diffDays, todayIso } from '../utils/date';
import { platformKey, slugify } from '../utils/format';
import { eachDay } from './periods';

export interface DemoOverlayResult {
  tecnicos: Record<string, Tecnico>;
  carteira: CarteiraEmbarque[];
  hhMap: Record<string, ApontamentoHH>;
  justMap: Record<string, Justificativa>;
  plataformas: Record<string, Plataforma>;
  pessoas: Record<string, Pessoa>;
  watermark: WatermarkStatus;
  isDemo: boolean;
  demoReason: string;
}

export function buildDemoOverlay(
  todayRef?: string,
  existingPlataformas?: Record<string, Plataforma>,
  existingPessoas?: Record<string, Pessoa>
): DemoOverlayResult;
export function buildDemoOverlay(
  config: ContractConfig,
  existingPlataformas?: Record<string, Plataforma>,
  queryIni?: string,
  queryFim?: string
): DemoOverlayResult;
export function buildDemoOverlay(
  arg0?: ContractConfig | string,
  arg1?: Record<string, Plataforma>,
  arg2?: string | Record<string, Pessoa>,
  arg3?: string
): DemoOverlayResult {
  let todayRef: string;
  let existingPlataformas: Record<string, Plataforma> = {};
  let existingPessoas: Record<string, Pessoa> = {};

  if (typeof arg0 === 'string') {
    todayRef = arg0;
    existingPlataformas = arg1 || {};
    if (typeof arg2 === 'object' && arg2 !== null) {
      existingPessoas = arg2;
    }
  } else if (typeof arg0 === 'object' && arg0 !== null) {
    existingPlataformas = arg1 || {};
    todayRef = (typeof arg3 === 'string' && arg3) || todayIso();
  } else {
    todayRef = todayIso();
    existingPlataformas = arg1 || {};
  }
  const TODAY = todayRef;
  const D0 = addDays(TODAY, -1);

  const UES = 'Espírito Santo (UN-ES)';
  const UBC = 'Bacia de Campos (UN-BC)';
  const UBS = 'Bacia de Santos (UN-BS)';
  const UBZ = 'Búzios (UN-BUZ)';

  const T: ReadonlyArray<[string, string, string, string, string]> = [
    ['10231', 'Ana Paula Ribeiro', 'Técnico de Automação', 'P-58', UES],
    ['10418', 'Bruno Carvalho Lima', 'Técnico de Instrumentação', 'P-57', UES],
    ['10577', 'Carla Menezes', 'Técnico de Telecom', 'P-25', UBC],
    ['10602', 'Diego Fonseca', 'Técnico de Automação', 'P-31', UBC],
    ['10733', 'Eduarda Pires', 'Técnico de TI', 'P-66', UBS],
    ['10859', 'Felipe Antunes', 'Técnico de Telecom', 'P-69', UBS],
    ['10914', 'Gabriel Rocha', 'Técnico de Instrumentação', 'P-74', UBZ],
    ['11027', 'Helena Duarte', 'Técnico de Automação', 'P-77', UBZ],
    ['11135', 'Igor Mendes', 'Técnico de Telecom', 'CBO-PRT', 'Armador']
  ];

  const pessoas: Record<string, Pessoa> = { ...existingPessoas };
  if (!Object.keys(pessoas).length) {
    pessoas['ex-a'] = {
      id: 'ex-a',
      slug: slugify('Preposto Exemplo A'),
      nome: 'Preposto Exemplo A',
      papel: 'preposto',
      email: '',
      user_id: null,
      plats: ['P58', 'P57', 'P25', 'P31'],
      uns: []
    };
    pessoas['ex-b'] = {
      id: 'ex-b',
      slug: slugify('Preposto Exemplo B'),
      nome: 'Preposto Exemplo B',
      papel: 'preposto',
      email: '',
      user_id: null,
      plats: ['P66', 'P69', 'P74', 'P77'],
      uns: []
    };
    pessoas['ex-c'] = {
      id: 'ex-c',
      slug: slugify('Controlador Exemplo'),
      nome: 'Controlador Exemplo',
      papel: 'controlador',
      email: '',
      user_id: null,
      plats: ['P69'],
      uns: []
    };
  }

  const plataformas: Record<string, Plataforma> = { ...existingPlataformas };
  if (!Object.keys(plataformas).length) {
    T.forEach(t => {
      const sg = t[3].replace('-', '');
      plataformas[sg] = {
        sigla: sg,
        chave_norm: platformKey(sg),
        nome: sg === 'CBOPRT' ? 'CBO PARINTINS' : sg,
        un: t[4],
        armador: sg === 'CBOPRT' ? 'CBO' : '',
        gerencia: '',
        tipo: sg === 'CBOPRT' ? 'Embarcação afretada' : 'UEP',
        situacao: 'Mobilizada',
        cadastro_pendente: false
      };
    });
  }

  const PAT = [
    [11, 11, 10.5, 11, 11, 12, 11, 9, 11, 11, 11.5, 11, 10, 11],
    [11, 8, 11, 11, 12, 11, 11, 11, 7.5, 11, 11, 11, 11, 11],
    [11, 11, 11, 4, 11, 11, 10, 11, 11, 12, 11, 11, 11, 8],
    [9, 11, 11, 11, 11, 11, 11.5, 11, 10, 11, 11, 6, 11, 11],
    [11, 12, 11, 11, 10, 11, 11, 11, 11, 11, 9, 11, 11, 7],
    [11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11],
    [11, 10, 11, 11, 11, 3, 11, 11, 12, 11, 11, 11, 9.5, 11],
    [12, 11, 11, 10, 11, 11, 11, 11, 11, 8, 11, 11, 11, 11],
    [11, 11, 9, 11, 11, 11, 10, 11, 11, 11, 7, 11, 11, 11]
  ];

  const offs = [2, 5, 8, 11, 0, 3, 6, 9, 4];
  const tecnicos: Record<string, Tecnico> = {};
  const carteira: CarteiraEmbarque[] = [];
  const hhMap: Record<string, ApontamentoHH> = {};
  const justMap: Record<string, Justificativa> = {};

  T.forEach((t, i) => {
    const [mat, nome, fn, platRaw, reg] = t;
    const plat = platRaw.replace('-', '');
    tecnicos[mat] = { matricula: mat, nome, funcao: fn };

    const ini = addDays(D0, -offs[i]);
    const fim = addDays(ini, 13);
    carteira.push({
      id: `${mat}_${ini}`,
      matricula: mat,
      nome,
      funcao: fn,
      plataforma_sigla: plat,
      unidade_negocio: reg,
      data_inicio: ini,
      data_fim: fim,
      horas_programadas: i % 3 === 0 ? 140 : null,
      operacao: i < 3 ? `OP-${2041 + i}` : '',
      pe: null,
      ex: null,
      fonte: 'Portal Offshore (exemplo)'
    });

    const ini0 = addDays(ini, -28);
    const fim0 = addDays(ini0, 13);
    carteira.push({
      id: `${mat}_${ini0}`,
      matricula: mat,
      nome,
      funcao: fn,
      plataforma_sigla: plat,
      unidade_negocio: reg,
      data_inicio: ini0,
      data_fim: fim0,
      horas_programadas: null,
      operacao: '',
      pe: null,
      ex: null,
      fonte: 'Portal Offshore (exemplo)'
    });

    const shifts: Array<[string, string, number]> = [
      [ini0, fim0, 1],
      [ini, fim, 0]
    ];

    shifts.forEach(([a, b, shift]) => {
      const maxDay = b < D0 ? b : D0;
      eachDay(a, maxDay, x => {
        const e = PAT[i][(diffDays(a, x) + shift * 3) % 14];
        hhMap[`${mat}|${x}`] = {
          matricula: mat,
          data: x,
          plataforma_sigla: plat,
          unidade_negocio: reg,
          horas_executadas: e
        };

        if (e < 11 && x < D0) {
          const gw = e <= 4 ? 11 - e : 0;
          if (gw > 0) {
            justMap[`${mat}|${x}`] = {
              matricula: mat,
              data: x,
              motivo: 'Gangway desconectada',
              horas_gangway: gw,
              descricao:
                'Gangway desconectada por mar agitado; equipe sem acesso à plataforma.',
              responsavel_nome: 'Exemplo',
              criado_em: `${x}T20:00:00`
            };
          } else if (e < 8) {
            justMap[`${mat}|${x}`] = {
              matricula: mat,
              data: x,
              motivo: 'Aguardando permissão de trabalho',
              horas_gangway: 0,
              descricao: 'PT liberada só após as 11h.',
              responsavel_nome: 'Exemplo',
              criado_em: `${x}T20:00:00`
            };
          }
        }
      });
    });
  });

  // Especial: 10859 no dia D0 não tem HH (testa a condição de "Não chegou")
  delete hhMap[`10859|${D0}`];

  return {
    tecnicos,
    carteira,
    hhMap,
    justMap,
    plataformas,
    pessoas,
    watermark: {
      ultima_data_hh: D0,
      ultima_importacao_em: `${D0}T07:00:00`
    },
    isDemo: true,
    demoReason:
      'Ainda não há programação de embarque nem HH executado cadastrado. Os dados abaixo são de exemplo.'
  };
};
