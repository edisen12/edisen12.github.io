import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PessoasPlataformasView } from '../PessoasPlataformasView';
import { ToastProvider } from '../../components/ToastContext';
import { useApp } from '../../state/AppContext';
import { savePessoa } from '../../../services/data.service';
import { DEFAULT_CONFIG } from '../../../config/constants';
import { buildPlatformIndex } from '../../../domain/calculations';
import type { AppDataset, Plataforma, UserProfile } from '../../../domain/types';

vi.mock('../../state/AppContext', () => ({
  useApp: vi.fn()
}));

vi.mock('../../../services/auth.service', () => ({
  adminManageUser: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock('../../../services/data.service', () => ({
  savePessoa: vi.fn().mockResolvedValue({
    id: 'pes-new',
    slug: 'novo-responsavel',
    nome: 'Novo Responsável Teste',
    papel: 'preposto',
    email: 'novo.teste@infotecbrasil.com.br',
    user_id: null,
    plats: ['P51', 'P58'],
    uns: []
  }),
  deletePessoa: vi.fn().mockResolvedValue(undefined),
  savePlataforma: vi.fn().mockResolvedValue(undefined),
  deletePlataforma: vi.fn().mockResolvedValue(undefined),
  deleteUserAccount: vi.fn().mockResolvedValue({ ok: true, message: 'OK' }),
  batchImportPlataformas: vi.fn().mockResolvedValue(undefined),
  batchImportPessoas: vi.fn().mockResolvedValue(undefined),
  logSystemEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../../services/excel.service', () => ({
  parseSpreadsheetFile: vi.fn(),
  rebuildPreviewRows: vi.fn(),
  IMPORT_COLUMNS_DEF: {},
  exportModeloXlsx: vi.fn().mockResolvedValue(undefined)
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

const MOCK_USER: UserProfile = {
  id: 'usr-gestor-1',
  email: 'gestor.teste@infotecbrasil.com.br',
  nome: 'Gestor Teste',
  role: 'gestor',
  ativo: true
};

function createDataset(): AppDataset {
  return {
    config: { ...DEFAULT_CONFIG },
    usoffUnWeights: {},
    emailsResumo: [],
    plataformas: MOCK_PLATFORMS,
    pessoas: {
      'pes-1': {
        id: 'pes-1',
        slug: 'camila-rocha',
        nome: 'Camila Rocha Sintética',
        papel: 'preposto',
        email: 'camila.teste@infotecbrasil.com.br',
        user_id: null,
        plats: ['P51'],
        uns: []
      }
    },
    profiles: {},
    tecnicos: {},
    carteira: [],
    carteiraOperacoes: [],
    confirmacoesSap: [],
    hhMap: {},
    justMap: {},
    externalCoveredSet: new Set<string>(),
    sharedOpsSet: new Set<string>(),
    watermark: { ultima_data_hh: '2026-06-15', ultima_importacao_em: '2026-06-16T08:00:00Z' },
    latestFluxo: null,
    isDemo: false,
    demoReason: ''
  };
}

describe('PessoasPlataformasView - Modal sem Regional e De-Para Automático de UN', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exibe UN derivada na listagem, remove seletor manual de UN no PessoaModal e salva uns=[]', async () => {
    const refreshData = vi.fn().mockResolvedValue(true);
    const dataset = createDataset();

    vi.mocked(useApp).mockReturnValue({
      dataset,
      pidx: buildPlatformIndex(MOCK_PLATFORMS),
      refreshData,
      isGlobal: true,
      isAdmin: false,
      userProfile: MOCK_USER,
      setFilter: vi.fn(),
      setActiveTab: vi.fn()
    } as unknown as ReturnType<typeof useApp>);

    render(
      <ToastProvider>
        <PessoasPlataformasView />
      </ToastProvider>
    );

    // Listagem já mostra UN derivada automaticamente da plataforma P51
    expect(screen.getByText('UNs (de-para): UN-BS')).not.toBeNull();

    // Abre modal Nova pessoa
    fireEvent.click(screen.getByRole('button', { name: /Nova pessoa/i }));
    expect(screen.getByText('Cadastrar Nova Pessoa')).not.toBeNull();

    // Confirma que a seleção manual de "Unidades de negócio inteiras" foi removida
    expect(screen.queryByText(/Unidades de negócio inteiras/i)).toBeNull();
    expect(screen.getByText(/Unidades de negócio \(de-para automático\)/i)).not.toBeNull();

    // Preenche nome, e-mail e seleciona plataformas de UNs distintas (P51 e P58)
    fireEvent.change(screen.getByPlaceholderText('Nome completo do colaborador'), {
      target: { value: 'Novo Responsável Teste' }
    });
    fireEvent.change(screen.getByPlaceholderText('colaborador@empresa.com.br'), {
      target: { value: 'novo.teste@infotecbrasil.com.br' }
    });

    const p51Checkbox = screen.getByLabelText('P51') as HTMLInputElement;
    const p58Checkbox = screen.getByLabelText('P58') as HTMLInputElement;
    fireEvent.click(p51Checkbox);
    fireEvent.click(p58Checkbox);

    // Confirma preview de-para atualizado antes de gravar
    expect(screen.getAllByText('UN-BS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('UN-ES').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: /Salvar pessoa/i }));

    await waitFor(() => {
      expect(savePessoa).toHaveBeenCalledTimes(1);
    });

    expect(savePessoa).toHaveBeenCalledWith({
      id: undefined,
      nome: 'Novo Responsável Teste',
      papel: 'preposto',
      email: 'novo.teste@infotecbrasil.com.br',
      plats: ['P51', 'P58'],
      uns: []
    });
    expect(refreshData).toHaveBeenCalledTimes(1);
  });
});
