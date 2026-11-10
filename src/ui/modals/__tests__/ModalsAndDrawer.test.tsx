import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JustificativaModal } from '../JustificativaModal';
import { FichaTecnicoDrawer } from '../FichaTecnicoDrawer';
import { EmailComposerModal } from '../EmailComposerModal';
import { ManualHHModal, ManualCartModal } from '../ManualEntryModals';
import { ToastProvider } from '../../components/ToastContext';
import { useApp } from '../../state/AppContext';
import {
  saveJustificativa,
  batchImportHH,
  batchImportCarteira
} from '../../../services/data.service';
import { exportTecnicoXlsx } from '../../../services/excel.service';
import { DEFAULT_CONFIG } from '../../../config/constants';
import { buildPlatformIndex } from '../../../domain/calculations';
import type {
  AppDataset,
  FilterState,
  PeriodWindow,
  Plataforma,
  UserProfile
} from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/data.service', () => ({
  saveJustificativa: vi.fn().mockResolvedValue(undefined),
  batchImportHH: vi.fn().mockResolvedValue(undefined),
  batchImportCarteira: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../../services/excel.service', () => ({
  exportTecnicoXlsx: vi.fn().mockResolvedValue(undefined)
}));

const MOCK_PLATFORMS: Record<string, Plataforma> = {
  P51: {
    sigla: 'P51',
    chave_norm: 'P51',
    nome: 'Plataforma P-51',
    un: 'UN-BS',
    armador: '',
    gerencia: 'UO-BS',
    tipo: 'SS',
    situacao: 'Mobilizada',
    cadastro_pendente: false
  },
  P58: {
    sigla: 'P58',
    chave_norm: 'P58',
    nome: 'Plataforma P-58',
    un: 'UN-ES',
    armador: '',
    gerencia: 'UO-ES',
    tipo: 'FPSO',
    situacao: 'Mobilizada',
    cadastro_pendente: false
  }
};

const MOCK_PIDX = buildPlatformIndex(MOCK_PLATFORMS);

const MOCK_PERIOD: PeriodWindow = {
  ini: '2026-06-01',
  fim: '2026-06-10',
  m: '2026-06'
};

const MOCK_USER: UserProfile = {
  id: 'usr-prep-1',
  email: 'preposto.teste@infotecbrasil.com.br',
  nome: 'Camila Rocha Mendes',
  role: 'preposto',
  ativo: true
};

function createSyntheticDataset(): AppDataset {
  return {
    config: { ...DEFAULT_CONFIG, hh_dia: 11 },
    usoffUnWeights: {},
    emailsResumo: ['coordenacao.sintetica@infotecbrasil.com.br'],
    plataformas: MOCK_PLATFORMS,
    pessoas: {
      'pes-1': {
        id: 'pes-1',
        slug: 'camila-rocha-mendes',
        nome: 'Camila Rocha Mendes',
        papel: 'preposto',
        email: 'preposto.teste@infotecbrasil.com.br',
        user_id: 'usr-prep-1',
        plats: ['P51'],
        uns: ['UN-BS']
      },
      'pes-2': {
        id: 'pes-2',
        slug: 'bruno-alves-sintetico',
        nome: 'Bruno Alves Sintético',
        papel: 'controlador',
        email: '',
        user_id: null,
        plats: ['P51'],
        uns: []
      }
    },
    profiles: {},
    tecnicos: {
      '10231': {
        matricula: '10231',
        nome: 'Carlos Eduardo Sintético',
        funcao: 'Técnico de Automação'
      }
    },
    carteira: [
      {
        id: 'emb-1',
        id_embarque: '55104',
        matricula: '10231',
        nome: 'Carlos Eduardo Sintético',
        funcao: 'Técnico de Automação',
        plataforma_sigla: 'P51',
        unidade_negocio: 'UN-BS',
        data_inicio: '2026-06-01',
        data_fim: '2026-06-05',
        horas_programadas: 55,
        operacao: '0010',
        pe: 0.4,
        ex: 0.6,
        fonte: 'portal'
      }
    ],
    carteiraOperacoes: [],
    confirmacoesSap: [
      {
        id: 'sap-1',
        matricula: '10231',
        data_criacao: '2026-06-02',
        data_lancamento: '2026-06-02',
        data_fim_real: '2026-06-02',
        ordem: '20045001',
        operacao: '0010',
        horas_confirmadas: 4,
        contador_confirmacao: 1,
        id_embarque: '55104',
        status_reconciliacao: 'Em Carteira'
      },
      {
        id: 'sap-2',
        matricula: '10231',
        data_criacao: '2026-06-02',
        data_lancamento: '2026-06-02',
        data_fim_real: '2026-06-02',
        ordem: '20099988',
        operacao: '0020',
        horas_confirmadas: 3.5,
        contador_confirmacao: 2,
        id_embarque: '55104',
        status_reconciliacao: 'Fora da Carteira'
      }
    ],
    hhMap: {
      '10231|2026-06-01': {
        matricula: '10231',
        data: '2026-06-01',
        plataforma_sigla: 'P51',
        unidade_negocio: 'UN-BS',
        horas_executadas: 11
      },
      '10231|2026-06-02': {
        matricula: '10231',
        data: '2026-06-02',
        plataforma_sigla: 'P51',
        unidade_negocio: 'UN-BS',
        horas_executadas: 7.5
      }
    },
    justMap: {},
    externalCoveredSet: new Set<string>(),
    sharedOpsSet: new Set<string>(),
    watermark: { ultima_data_hh: '2026-06-02', ultima_importacao_em: '2026-06-03T08:00:00Z' },
    latestFluxo: null,
    isDemo: false,
    demoReason: ''
  };
}

function setupAppMock(overrides: Record<string, unknown> = {}) {
  const dataset = createSyntheticDataset();
  const filters: FilterState = {
    fDate: '2026-06-02',
    fReg: '',
    fPlat: '',
    fResp: '',
    fPer: '',
    cIni: '',
    cFim: ''
  };

  const ctx = {
    dataset,
    pidx: MOCK_PIDX,
    activePeriod: MOCK_PERIOD,
    filters,
    userProfile: MOCK_USER,
    isGlobal: false,
    isAdmin: false,
    scopeLabel: 'Carteira P51',
    justModal: null,
    openJustModal: vi.fn(),
    closeJustModal: vi.fn(),
    fichaMat: null,
    openFichaDrawer: vi.fn(),
    closeFichaDrawer: vi.fn(),
    emailModal: null,
    openEmailModal: vi.fn(),
    closeEmailModal: vi.fn(),
    reloadDataset: vi.fn().mockResolvedValue(undefined),
    refreshData: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };

  vi.mocked(useApp).mockReturnValue(ctx as unknown as ReturnType<typeof useApp>);
  return ctx;
}

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('Modais Operacionais e Ficha do Técnico', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('JustificativaModal', () => {
    it('exibe campo de horas de Gangway quando motivo é "Gangway desconectada" e valida limites [0, hh_dia]', () => {
      setupAppMock({ justModal: { mat: '10231', date: '2026-06-02' } });
      renderWithToast(<JustificativaModal />);

      expect(screen.getByText(/Justificar Apontamento · Carlos Eduardo Sintético/i)).not.toBeNull();

      // Por padrão abre com o 1º motivo ('Gangway desconectada') e sugere faltaHoras (11 - 7.5 = 3.5)
      const gwInput = screen.getByPlaceholderText('Ex: 4.5') as HTMLInputElement;
      expect(gwInput.value).toBe('3.5');

      // Valor acima do disponível (11h) deve bloquear submissão
      fireEvent.change(gwInput, { target: { value: '14' } });
      fireEvent.click(screen.getByRole('button', { name: /Salvar justificativa/i }));

      expect(screen.getByText(/Horas de gangway deve ser um valor entre 0 e 11 h\./i)).not.toBeNull();
      expect(saveJustificativa).not.toHaveBeenCalled();

      // Ao trocar motivo para outro, o campo de gangway desaparece
      const selectMotivo = screen.getByRole('combobox');
      fireEvent.change(selectMotivo, { target: { value: 'Condições de mar ou clima' } });
      expect(screen.queryByPlaceholderText('Ex: 4.5')).toBeNull();
    });

    it('exige descrição obrigatória quando motivo for "Outro"', () => {
      setupAppMock({ justModal: { mat: '10231', date: '2026-06-02' } });
      renderWithToast(<JustificativaModal />);

      const selectMotivo = screen.getByRole('combobox');
      fireEvent.change(selectMotivo, { target: { value: 'Outro' } });

      expect(screen.getByText(/\(obrigatória para "Outro"\)/i)).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Salvar justificativa/i }));
      expect(
        screen.getByText('A descrição é obrigatória quando o motivo for "Outro".')
      ).not.toBeNull();
      expect(saveJustificativa).not.toHaveBeenCalled();
    });

    it('submete com sucesso chamando saveJustificativa, reloadDataset e closeJustModal', async () => {
      const closeJustModal = vi.fn();
      const reloadDataset = vi.fn().mockResolvedValue(undefined);
      setupAppMock({
        justModal: { mat: '10231', date: '2026-06-02' },
        closeJustModal,
        reloadDataset
      });

      renderWithToast(<JustificativaModal />);

      const gwInput = screen.getByPlaceholderText('Ex: 4.5');
      fireEvent.change(gwInput, { target: { value: '3.5' } });

      const descTextarea = screen.getByPlaceholderText('O que aconteceu no dia…');
      fireEvent.change(descTextarea, { target: { value: 'Desconexão preventiva por swell elevado' } });

      fireEvent.click(screen.getByRole('button', { name: /Salvar justificativa/i }));

      await waitFor(() => {
        expect(saveJustificativa).toHaveBeenCalledWith({
          matricula: '10231',
          data: '2026-06-02',
          motivo: 'Gangway desconectada',
          horas_gangway: 3.5,
          descricao: 'Desconexão preventiva por swell elevado',
          responsavel_nome: 'Camila Rocha Mendes'
        });
        expect(reloadDataset).toHaveBeenCalledTimes(1);
        expect(closeJustModal).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('FichaTecnicoDrawer', () => {
    it('exibe resumo do técnico, histórico diário, expande ordens SAP destacando "Não Cadastrada no Portal" e dispara exportação Excel', async () => {
      const ctx = setupAppMock({ fichaMat: '10231', scopeLabel: 'Carteira P51' });
      renderWithToast(<FichaTecnicoDrawer />);

      // Cabeçalho e resumo do técnico
      expect(screen.getByText('Carlos Eduardo Sintético')).not.toBeNull();
      expect(screen.getByText(/Mat\. 10231 · Técnico de Automação/i)).not.toBeNull();
      expect(screen.getByText('Dias na carteira')).not.toBeNull();
      expect(screen.getByText('Extrato SAP')).not.toBeNull();
      expect(screen.getByText('Histórico diário')).not.toBeNull();

      // Datas no histórico
      expect(screen.getByText('01/06/2026')).not.toBeNull();
      expect(screen.getByText('02/06/2026')).not.toBeNull();

      // Expansão de ordens SAP do dia 02/06/2026 (2 ordens ⚠️)
      const expandSapBtn = screen.getByRole('button', { name: /2 ordens/i });
      expect(expandSapBtn.textContent).toContain('⚠️');
      fireEvent.click(expandSapBtn);

      expect(screen.getByText(/Ordens e Operações confirmadas no SAP em 02\/06\/2026/i)).not.toBeNull();
      expect(screen.getByText('20045001')).not.toBeNull();
      expect(screen.getByText('20099988')).not.toBeNull();
      expect(screen.getByText('Cadastrada no Portal')).not.toBeNull();
      expect(screen.getByText('Não Cadastrada no Portal')).not.toBeNull();

      // Disparo de exportação Excel individual
      const exportBtn = screen.getByRole('button', { name: /Baixar relatório do técnico/i });
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(exportTecnicoXlsx).toHaveBeenCalledTimes(1);
        expect(exportTecnicoXlsx).toHaveBeenCalledWith(
          '10231',
          ctx.dataset,
          MOCK_PERIOD,
          'Carteira P51'
        );
      });
    });
  });

  describe('EmailComposerModal', () => {
    it('preenche destinatários, assunto, corpo e alerta de pessoa sem e-mail no modo diário e cobrança', () => {
      setupAppMock({
        emailModal: { mode: 'daily', date: '2026-06-02', plats: ['P51'] }
      });

      const { unmount } = renderWithToast(<EmailComposerModal />);

      expect(screen.getByText('E-mail aos responsáveis')).not.toBeNull();
      expect(screen.getByText('Camila Rocha Mendes')).not.toBeNull();
      // Alerta para colaborador responsável sem e-mail cadastrado
      expect(screen.getByText(/Bruno Alves Sintético sem e-mail cadastrado/i)).not.toBeNull();

      const toField = screen.getByPlaceholderText('destinatario@empresa.com.br') as HTMLInputElement;
      expect(toField.value).toContain('preposto.teste@infotecbrasil.com.br');

      const outlookWebLink = screen.getByRole('link', { name: /Abrir no Outlook Web/i });
      expect(outlookWebLink.getAttribute('href')).toContain('outlook.office.com');

      unmount();

      // Modo cobrança global ('*')
      setupAppMock({
        emailModal: { mode: 'cobranca', targetRespId: '*' }
      });
      renderWithToast(<EmailComposerModal />);

      expect(screen.getByText('Cobrança de justificativas')).not.toBeNull();
      expect(screen.getByRole('link', { name: /Abrir no Outlook$/i }).getAttribute('href')).toContain('mailto:');
    });
  });

  describe('ManualEntryModals (ManualHHModal e ManualCartModal)', () => {
    it('ManualHHModal valida campos, autopreenche dados pela matrícula e envia via batchImportHH', async () => {
      const onClose = vi.fn();
      const refreshData = vi.fn().mockResolvedValue(undefined);
      setupAppMock({ refreshData });

      renderWithToast(<ManualHHModal open={true} onClose={onClose} initialDate="2026-06-02" />);

      // Submissão sem matrícula exibe erro
      fireEvent.click(screen.getByRole('button', { name: /Salvar apontamento/i }));
      expect(screen.getByText('Informe a matrícula do técnico.')).not.toBeNull();
      expect(batchImportHH).not.toHaveBeenCalled();

      // Digita matrícula cadastrada -> autopreenche nome e plataforma ativa na data
      const matInput = screen.getByPlaceholderText('Ex: 10231');
      fireEvent.change(matInput, { target: { value: '10231' } });

      const nomeInput = screen.getByPlaceholderText('Nome completo do técnico') as HTMLInputElement;
      const platInput = screen.getByPlaceholderText('Ex: P58') as HTMLInputElement;
      expect(nomeInput.value).toBe('Carlos Eduardo Sintético');
      expect(platInput.value).toBe('P51');

      // Horas acima de 24 -> erro de validação
      const horasInput = screen.getByPlaceholderText('Ex: 11');
      fireEvent.change(horasInput, { target: { value: '28' } });
      fireEvent.click(screen.getByRole('button', { name: /Salvar apontamento/i }));
      expect(
        screen.getByText('Informe um valor de HH executado válido entre 0 e 24 horas.')
      ).not.toBeNull();

      // Corrige horas e salva
      fireEvent.change(horasInput, { target: { value: '10.5' } });
      fireEvent.click(screen.getByRole('button', { name: /Salvar apontamento/i }));

      await waitFor(() => {
        expect(batchImportHH).toHaveBeenCalledTimes(1);
        expect(refreshData).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('ManualCartModal valida datas e campos obrigatórios e grava via batchImportCarteira', async () => {
      const onClose = vi.fn();
      const refreshData = vi.fn().mockResolvedValue(undefined);
      setupAppMock({ refreshData });

      renderWithToast(<ManualCartModal open={true} onClose={onClose} />);

      // Validação sem matrícula
      fireEvent.click(screen.getByRole('button', { name: /Salvar embarque/i }));
      expect(screen.getByText('Informe a matrícula.')).not.toBeNull();

      // Preenche matrícula mas deixa plataforma em branco
      fireEvent.change(screen.getByPlaceholderText('Ex: 10231'), { target: { value: '10231' } });
      fireEvent.click(screen.getByRole('button', { name: /Salvar embarque/i }));
      expect(screen.getByText('Informe a plataforma.')).not.toBeNull();

      // Preenche plataforma e testa data fim anterior à data início
      fireEvent.change(screen.getByPlaceholderText('Ex: P58'), { target: { value: 'p58' } });
      const iniInput = screen.getByLabelText(/Data de embarque \(início\)/i);
      const fimInput = screen.getByLabelText(/Data de desembarque \(fim\)/i);
      fireEvent.change(iniInput, { target: { value: '2026-06-15' } });
      fireEvent.change(fimInput, { target: { value: '2026-06-10' } });

      fireEvent.click(screen.getByRole('button', { name: /Salvar embarque/i }));
      expect(
        screen.getByText('A data de desembarque não pode ser anterior à data de embarque.')
      ).not.toBeNull();
      expect(batchImportCarteira).not.toHaveBeenCalled();

      // Corrige data fim e operação e salva
      fireEvent.change(fimInput, { target: { value: '2026-06-28' } });
      fireEvent.change(screen.getByPlaceholderText('Ex: OP-1049'), { target: { value: 'OP-2040' } });

      fireEvent.click(screen.getByRole('button', { name: /Salvar embarque/i }));

      await waitFor(() => {
        expect(batchImportCarteira).toHaveBeenCalledTimes(1);
        expect(refreshData).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });
  });
});
