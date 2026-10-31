import type {
  AppDataset,
  DayTechRow,
  FilterState,
  PeriodDayEntry,
  PeriodWindow,
  Pessoa,
  Plataforma
} from './types';
import { PAPEIS_LABEL } from '../config/constants';
import {
  diffDays,
  formatBr,
  formatBrShort,
  todayIso
} from '../utils/date';
import {
  formatHours,
  formatPct,
  formatSignedHours,
  plural
} from '../utils/format';
import { periodDisplayName } from './periods';
import {
  armadorOf,
  computeCobrancaStats,
  computeDayRows,
  computePeriodDays,
  findResponsiblePeople,
  gestorOfUn,
  groupDaysByField,
  isPersonResponsible,
  passesFilter,
  prazoOf,
  resolvePlace,
  resolveTechName
} from './calculations';

export const buildCobrancaDetailsText = (
  pend: PeriodDayEntry[],
  dataset: AppDataset,
  pidx: Record<string, Plataforma>,
  today?: string
): string => {
  const refToday = today || todayIso();
  const by: Record<string, PeriodDayEntry[]> = {};
  pend.forEach(x => {
    (by[x.p] = by[x.p] || []).push(x);
  });
  const H = formatHours(dataset.config.hh_dia);
  let t = '';

  Object.keys(by)
    .sort()
    .forEach(p => {
      const u = (by[p][0] || {}).r || '';
      const arm = armadorOf(pidx, p);
      t += `\n${p} (${u}${arm ? ' · Armador ' + arm : ''}):\n`;
      by[p]
        .sort((a, b) => (a.D < b.D ? -1 : 1))
        .forEach(x => {
          const pz = prazoOf(x.D, dataset.config);
          const v = refToday > pz;
          const atraso = diffDays(pz, refToday);
          t += `- ${formatBr(x.D)} · ${resolveTechName(x.mat, dataset)} (mat. ${x.mat}): ${
            x.sem
              ? 'sem HH executado informado'
              : `${formatHours(x.e)} de ${H}`
          } · prazo ${formatBrShort(pz)}${
            v ? ` (vencido há ${plural(atraso, 'dia', 'dias')})` : ''
          }\n`;
        });
    });

  return t;
};

export const buildDailyMailPayload = (
  dateIso: string,
  platforms: string[],
  dataset: AppDataset,
  pidx: Record<string, Plataforma>,
  senderName?: string
): {
  rows: DayTechRow[];
  ppl: Pessoa[];
  body: string;
  subj: string;
  to: string[];
} => {
  const all = computeDayRows(dateIso, dataset, pidx);
  const rows = all.filter(r => platforms.includes(r.p) && r.e < r.d - 0.001);
  const uns = [
    ...new Set(
      platforms
        .map(p => resolvePlace(pidx, p, '').r)
        .concat(rows.map(r => r.r))
    )
  ].filter(u => u && u !== 'Sem unidade');

  const ppl = findResponsiblePeople(dataset.pessoas, platforms, uns);
  const H = formatHours(dataset.config.hh_dia);
  const by: Record<string, DayTechRow[]> = {};
  rows.forEach(r => {
    (by[r.p] = by[r.p] || []).push(r);
  });

  let body = `Prezados,\n\nEm ${formatBr(dateIso)}, os técnicos abaixo não executaram as ${H} disponíveis do dia (meta de ${dataset.config.meta_percentual}%).\n`;

  Object.keys(by)
    .sort()
    .forEach(p => {
      body += `\n${p} (${by[p][0].r}):\n`;
      by[p].forEach(r => {
        body += `- ${r.nome} (mat. ${r.mat}): ${
          r.sem
            ? 'sem HH executado informado'
            : `${formatHours(r.e)} de ${H} (${formatPct(r.pc)})`
        }${
          r.emb ? `; dia ${r.emb.dia} de ${r.emb.n} do embarque` : ''
        }${
          r.acc
            ? `; acumulado do embarque ${formatPct(r.acc.p)} (${formatSignedHours(
                r.acc.saldo
              )})`
            : ''
        }${r.j ? `; já justificado: ${r.j.motivo}` : ''}\n`;
      });
    });

  if (!rows.length) {
    body += '\nNão há técnico abaixo das horas disponíveis nessas plataformas neste dia.\n';
  }

  body += `\nFavor registrar a justificativa de cada caso no app Gestão de HH Offshore até ${formatBr(
    prazoOf(dateIso, dataset.config)
  )}. Se a gangway ficou desconectada, informar por quantas horas.\n\nAtenciosamente,\n${
    senderName || 'Gestão do contrato'
  }\nInfotec Brasil`;

  const subj = `HH Offshore · ${
    platforms.length === 1 ? platforms[0] : platforms.length + ' plataformas'
  } · ${formatBr(dateIso)} · favor justificar`;

  const to = ppl.filter(p => p.email).map(p => p.email);

  return {
    rows,
    ppl,
    body,
    subj,
    to
  };
};

export const buildCobrancaMailPayload = (
  target: Pessoa | '*' | null,
  P: PeriodWindow,
  dataset: AppDataset,
  pidx: Record<string, Plataforma>,
  senderName?: string,
  today?: string
): {
  ppl: Pessoa[];
  body: string;
  subj: string;
  to: string[];
  vencidosCount: number;
  pendentesCount: number;
} => {
  const refToday = today || todayIso();
  const emptyFilters: FilterState = {
    fDate: '',
    fReg: '',
    fPlat: '',
    fResp: '',
    fPer: '',
    cIni: '',
    cFim: ''
  };

  const daysBelow = computePeriodDays(P, dataset, emptyFilters, pidx).filter(
    x => x.e < x.d - 0.001
  );
  const pend = daysBelow.filter(x => !x.j);

  let ppl: Pessoa[];
  let list: PeriodDayEntry[];

  if (target === '*' || target === null) {
    ppl = Object.values(dataset.pessoas).filter(p =>
      pend.some(x => isPersonResponsible(p, { p: x.p, r: x.r }))
    );
    list = pend;
  } else {
    ppl = [target];
    list = pend.filter(x => isPersonResponsible(target, { p: x.p, r: x.r }));
  }

  const venc = list.filter(x => refToday > prazoOf(x.D, dataset.config)).length;
  const subj = `HH Offshore · justificativas pendentes · ${periodDisplayName(
    P
  )} (${formatBr(P.ini)} a ${formatBr(P.fim)})`;

  let body = `${
    ppl.length > 1 ? 'Prezados' : `Prezado(a) ${ppl[0].nome.split(' ')[0]}`
  },\n\nNo período de ${formatBr(P.ini)} a ${formatBr(P.fim)}, ${
    list.length === 1 ? 'há 1 dia' : `há ${list.length} dias`
  } de técnicos abaixo da meta de ${formatHours(
    dataset.config.hh_dia
  )} sem justificativa registrada no app Gestão de HH Offshore${
    venc ? `, ${venc} já com prazo vencido` : ''
  }.\n`;

  if (ppl.length > 1) {
    ppl.forEach(p => {
      const l = list.filter(x => isPersonResponsible(p, { p: x.p, r: x.r }));
      body += `\n== ${p.nome} (${
        PAPEIS_LABEL[p.papel] || 'Preposto'
      }) · ${plural(l.length, 'pendente', 'pendentes')} ==\n${buildCobrancaDetailsText(
        l,
        dataset,
        pidx,
        refToday
      )}`;
    });
  } else {
    body += buildCobrancaDetailsText(list, dataset, pidx, refToday);
  }

  body += `\nFavor registrar as justificativas no app o quanto antes. Se a gangway ficou desconectada, informar por quantas horas.\n\nAtenciosamente,\n${
    senderName || 'Gestão do contrato'
  }\nInfotec Brasil`;

  const to = ppl.filter(p => p.email).map(p => p.email);

  return {
    ppl,
    body,
    subj,
    to,
    vencidosCount: venc,
    pendentesCount: list.length
  };
};

export const buildCobrancaListText = (
  P: PeriodWindow,
  dataset: AppDataset,
  pidx: Record<string, Plataforma>,
  today?: string
): string => {
  const emptyFilters: FilterState = {
    fDate: '',
    fReg: '',
    fPlat: '',
    fResp: '',
    fPer: '',
    cIni: '',
    cFim: ''
  };

  const days = computePeriodDays(P, dataset, emptyFilters, pidx).filter(
    x => x.e < x.d - 0.001
  );
  const pes = Object.values(dataset.pessoas);
  const lines = [
    'Cobrança de justificativas · HH Offshore',
    `Período: ${formatBr(P.ini)} a ${formatBr(P.fim)}`,
    ''
  ];

  pes
    .map(p => ({
      p,
      M: computeCobrancaStats(
        days.filter(x => isPersonResponsible(p, { p: x.p, r: x.r })),
        dataset.config,
        today
      )
    }))
    .filter(r => r.M.need)
    .sort((a, b) => b.M.venc - a.M.venc || b.M.pend - a.M.pend)
    .forEach(r =>
      lines.push(
        `${r.p.nome} (${PAPEIS_LABEL[r.p.papel] || 'Preposto'}): ${r.M.ok} de ${
          r.M.need
        } justificados (${formatPct(r.M.pJ)}) · ${r.M.pend} pendentes, ${
          r.M.venc
        } vencidos${r.M.oldest ? ' · mais antiga ' + formatBr(r.M.oldest) : ''}`
      )
    );

  return lines.join('\n');
};

export const buildDailyAlertText = (
  dateIso: string,
  dataset: AppDataset,
  filters: FilterState,
  pidx: Record<string, Plataforma>
): string => {
  const all = computeDayRows(dateIso, dataset, pidx).filter(r =>
    passesFilter({ p: r.p, r: r.r }, filters, dataset.pessoas)
  );

  const lines = [
    `Alerta de HH Offshore · ${formatBr(dateIso)}`,
    `Meta: ${dataset.config.meta_percentual}% das horas disponíveis`,
    ''
  ];

  const daysAsEntries: PeriodDayEntry[] = all.map(r => ({
    mat: r.mat,
    D: dateIso,
    p: r.p,
    r: r.r,
    d: r.d,
    e: r.e,
    sem: r.sem,
    j: r.j
  }));

  const regs = groupDaysByField(daysAsEntries, 'r', dataset.config);

  regs.forEach(g => {
    const gestor = gestorOfUn(g.k, dataset.plataformas, dataset.pessoas);
    lines.push(
      `${g.k}: ${formatPct(g.p)} (${formatHours(g.e)} de ${formatHours(g.d)})${
        gestor ? ' · Gestor: ' + gestor : ''
      }`
    );

    const platRows = daysAsEntries.filter(x => x.r === g.k);
    const plats = groupDaysByField(platRows, 'p', dataset.config).filter(
      p => p.st !== 'ok'
    );

    plats.forEach(p => {
      lines.push(
        `  - ${p.k}: ${formatPct(p.p)}, ${p.abaixo} técnico(s) abaixo das horas`
      );
    });

    all
      .filter(x => x.r === g.k && x.e < x.d - 0.001)
      .forEach(x => {
        lines.push(
          `    · ${x.nome} (${x.p}): ${
            x.sem ? 'sem HH executado informado, ' : ''
          }${formatHours(x.e)} de ${formatHours(x.d)}, ${formatPct(
            x.pc
          )} no dia; acumulado do embarque ${
            x.acc ? formatPct(x.acc.p) : '—'
          }${x.j ? ' · justificado: ' + x.j.motivo : ' · FAVOR JUSTIFICAR'}`
        );
      });

    lines.push('');
  });

  return lines.join('\n');
};

export const buildMailLinks = (
  to: string[] | string,
  subject: string,
  body: string
): { mailtoUrl: string; outlookWebUrl: string } => {
  const toStr = Array.isArray(to) ? to.join('; ') : to;
  const su = encodeURIComponent(subject);
  const bo = encodeURIComponent(body);
  const toClean = toStr
    .split(/[;,\s]+/)
    .filter(Boolean)
    .join(',');

  return {
    mailtoUrl: `mailto:${toClean}?subject=${su}&body=${bo}`,
    outlookWebUrl: `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(
      toClean
    )}&subject=${su}&body=${bo}`
  };
};
