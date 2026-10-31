import React, { useState, useEffect, useId } from 'react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ToastContext';
import { batchImportHH, batchImportCarteira } from '../../services/data.service';
import { todayIso, addDays } from '../../utils/date';
import { formatHours } from '../../utils/format';
import { Modal } from '../components/Modal';

export interface ManualHHModalProps {
  open: boolean;
  onClose: () => void;
  initialDate?: string;
}

export const ManualHHModal: React.FC<ManualHHModalProps> = ({
  open,
  onClose,
  initialDate
}) => {
  const { dataset, pidx, refreshData, filters } = useApp();
  const { showToast } = useToast();

  const dlTecId = useId();
  const dlPlatId = useId();

  const [date, setDate] = useState<string>(initialDate || filters.fDate || todayIso());
  const [matricula, setMatricula] = useState<string>('');
  const [nome, setNome] = useState<string>('');
  const [plataforma, setPlataforma] = useState<string>('');
  const [horas, setHoras] = useState<string>('11');
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (open) {
      setDate(initialDate || filters.fDate || todayIso());
      setMatricula('');
      setNome('');
      setPlataforma('');
      setHoras(String(dataset.config.hh_dia || 11));
      setErrorMsg('');
      setSaving(false);
    }
  }, [open, initialDate, filters.fDate, dataset.config.hh_dia]);

  const handleMatriculaChange = (mat: string) => {
    setMatricula(mat);
    const cleanMat = mat.trim();
    if (!cleanMat) return;

    // Busca nome existente no cadastro de técnicos
    const tec = dataset.tecnicos[cleanMat];
    if (tec && tec.nome && !nome) {
      setNome(tec.nome);
    }

    // Busca plataforma da carteira ativa na data
    const activeCart = dataset.carteira.find(
      c => c.matricula === cleanMat && c.data_inicio <= date && c.data_fim >= date
    );
    if (activeCart && activeCart.plataforma_sigla) {
      setPlataforma(activeCart.plataforma_sigla);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');

    const cleanMat = matricula.trim();
    const cleanPlat = plataforma.trim().toUpperCase();
    const cleanNome = nome.trim() || `Técnico ${cleanMat}`;
    const numHoras = parseFloat(horas.replace(',', '.'));

    if (!date) {
      setErrorMsg('Informe a data do apontamento.');
      return;
    }
    if (!cleanMat) {
      setErrorMsg('Informe a matrícula do técnico.');
      return;
    }
    if (!cleanPlat) {
      setErrorMsg('Informe a sigla da plataforma.');
      return;
    }
    if (isNaN(numHoras) || numHoras < 0 || numHoras > 24) {
      setErrorMsg('Informe um valor de HH executado válido entre 0 e 24 horas.');
      return;
    }

    setSaving(true);
    try {
      await batchImportHH(
        [
          {
            mat: cleanMat,
            nome: cleanNome,
            funcao: dataset.tecnicos[cleanMat]?.funcao || '',
            D: date,
            p: cleanPlat,
            r: pidx[cleanPlat]?.un || '',
            e: numHoras
          }
        ],
        pidx,
        undefined,
        'lançamento manual'
      );

      await refreshData();
      showToast('Lançamento de HH manual salvo com sucesso!', 'success');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao salvar lançamento manual.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lançar um dia à mão"
      maxWidth="540px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit()}
            disabled={saving}
          >
            {saving ? 'Gravando…' : 'Salvar apontamento'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink-secondary)' }}>
          Registre o HH executado de um técnico diretamente no sistema. Se a plataforma não constar no cadastro, será cadastrada automaticamente para revisão.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Data</span>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Matrícula</span>
            <input
              type="text"
              list={dlTecId}
              value={matricula}
              onChange={e => handleMatriculaChange(e.target.value)}
              placeholder="Ex: 10231"
              required
              disabled={saving}
            />
          </label>
        </div>

        <label className="fld">
          <span>Nome do colaborador</span>
          <input
            type="text"
            value={nome}
            onChange={e => setNome(e.target.value)}
            placeholder="Nome completo do técnico"
            disabled={saving}
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Plataforma</span>
            <input
              type="text"
              list={dlPlatId}
              value={plataforma}
              onChange={e => setPlataforma(e.target.value.toUpperCase())}
              placeholder="Ex: P58"
              required
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>HH executado</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="24"
              value={horas}
              onChange={e => setHoras(e.target.value)}
              placeholder="Ex: 11"
              required
              disabled={saving}
            />
          </label>
        </div>

        {errorMsg && (
          <div className="note note-bad" style={{ margin: 0, fontSize: '0.85rem' }}>
            {errorMsg}
          </div>
        )}

        {/* Datalists nativos para auto-completar */}
        <datalist id={dlTecId}>
          {Object.values(dataset.tecnicos).map(t => (
            <option key={t.matricula} value={t.matricula}>
              {t.nome} {t.funcao ? `· ${t.funcao}` : ''}
            </option>
          ))}
        </datalist>

        <datalist id={dlPlatId}>
          {Object.values(dataset.plataformas).map(p => (
            <option key={p.sigla} value={p.sigla}>
              {p.nome || p.sigla} {p.un ? `(${p.un})` : ''}
            </option>
          ))}
        </datalist>
      </form>
    </Modal>
  );
};

export interface ManualCartModalProps {
  open: boolean;
  onClose: () => void;
  initialMatricula?: string;
}

export const ManualCartModal: React.FC<ManualCartModalProps> = ({
  open,
  onClose,
  initialMatricula
}) => {
  const { dataset, pidx, refreshData } = useApp();
  const { showToast } = useToast();

  const dlTecId = useId();
  const dlPlatId = useId();

  const [matricula, setMatricula] = useState<string>(initialMatricula || '');
  const [nome, setNome] = useState<string>('');
  const [funcao, setFuncao] = useState<string>('');
  const [plataforma, setPlataforma] = useState<string>('');
  const [dataInicio, setDataInicio] = useState<string>(todayIso());
  const [dataFim, setDataFim] = useState<string>(addDays(todayIso(), 13));
  const [horasProgramadas, setHorasProgramadas] = useState<string>('');
  const [operacao, setOperacao] = useState<string>('');
  const [pe, setPe] = useState<string>('');
  const [ex, setEx] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (open) {
      setMatricula(initialMatricula || '');
      setNome('');
      setFuncao('');
      setPlataforma('');
      setDataInicio(todayIso());
      setDataFim(addDays(todayIso(), 13));
      setHorasProgramadas('');
      setOperacao('');
      setPe('');
      setEx('');
      setErrorMsg('');
      setSaving(false);

      if (initialMatricula && dataset.tecnicos[initialMatricula]) {
        const t = dataset.tecnicos[initialMatricula];
        setNome(t.nome || '');
        setFuncao(t.funcao || '');
      }
    }
  }, [open, initialMatricula, dataset.tecnicos]);

  const handleMatriculaChange = (mat: string) => {
    setMatricula(mat);
    const cleanMat = mat.trim();
    if (!cleanMat) return;
    const tec = dataset.tecnicos[cleanMat];
    if (tec) {
      if (tec.nome) setNome(tec.nome);
      if (tec.funcao) setFuncao(tec.funcao);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');

    const cleanMat = matricula.trim();
    const cleanPlat = plataforma.trim().toUpperCase();
    const cleanNome = nome.trim() || `Técnico ${cleanMat}`;

    if (!cleanMat) {
      setErrorMsg('Informe a matrícula.');
      return;
    }
    if (!cleanPlat) {
      setErrorMsg('Informe a plataforma.');
      return;
    }
    if (!dataInicio || !dataFim) {
      setErrorMsg('Informe as datas de início e fim do embarque.');
      return;
    }
    if (dataFim < dataInicio) {
      setErrorMsg('A data de desembarque não pode ser anterior à data de embarque.');
      return;
    }

    const hpNum = horasProgramadas.trim() ? parseFloat(horasProgramadas.replace(',', '.')) : null;
    const peNum = pe.trim() ? parseFloat(pe.replace(',', '.')) : null;
    const exNum = ex.trim() ? parseFloat(ex.replace(',', '.')) : null;

    setSaving(true);
    try {
      await batchImportCarteira(
        [
          {
            mat: cleanMat,
            nome: cleanNome,
            funcao: funcao.trim(),
            plat: cleanPlat,
            reg: pidx[cleanPlat]?.un || '',
            ini: dataInicio,
            fim: dataFim,
            hp: hpNum,
            op: operacao.trim(),
            pe: peNum,
            ex: exNum
          }
        ],
        pidx
      );

      await refreshData();
      showToast('Programação de embarque salva com sucesso!', 'success');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao cadastrar embarque.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cadastrar embarque à mão"
      maxWidth="620px"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit()}
            disabled={saving}
          >
            {saving ? 'Gravando…' : 'Salvar embarque'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink-secondary)' }}>
          Cadastre um período de embarque na carteira. Se horas programadas não forem especificadas, o sistema calculará automaticamente com base nos dias × {formatHours(dataset.config.hh_dia)}.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Matrícula</span>
            <input
              type="text"
              list={dlTecId}
              value={matricula}
              onChange={e => handleMatriculaChange(e.target.value)}
              placeholder="Ex: 10231"
              required
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Plataforma</span>
            <input
              type="text"
              list={dlPlatId}
              value={plataforma}
              onChange={e => setPlataforma(e.target.value.toUpperCase())}
              placeholder="Ex: P58"
              required
              disabled={saving}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Nome do colaborador</span>
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Nome do técnico"
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Função / Cargo</span>
            <input
              type="text"
              value={funcao}
              onChange={e => setFuncao(e.target.value)}
              placeholder="Ex: Téc. Automação"
              disabled={saving}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Data de embarque (início)</span>
            <input
              type="date"
              value={dataInicio}
              onChange={e => setDataInicio(e.target.value)}
              required
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Data de desembarque (fim)</span>
            <input
              type="date"
              value={dataFim}
              onChange={e => setDataFim(e.target.value)}
              required
              disabled={saving}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Horas programadas HP (opcional)</span>
            <input
              type="number"
              step="0.5"
              min="0"
              value={horasProgramadas}
              onChange={e => setHorasProgramadas(e.target.value)}
              placeholder={`Vazio = dias × ${formatHours(dataset.config.hh_dia)}`}
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Operação / Código OP (opcional)</span>
            <input
              type="text"
              value={operacao}
              onChange={e => setOperacao(e.target.value)}
              placeholder="Ex: OP-1049"
              disabled={saving}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label className="fld">
            <span>Ponderação PE (opcional)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={pe}
              onChange={e => setPe(e.target.value)}
              placeholder="Padrão da UN / Contrato"
              disabled={saving}
            />
          </label>

          <label className="fld">
            <span>Ponderação EX (opcional)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={ex}
              onChange={e => setEx(e.target.value)}
              placeholder="Padrão da UN / Contrato"
              disabled={saving}
            />
          </label>
        </div>

        {errorMsg && (
          <div className="note note-bad" style={{ margin: 0, fontSize: '0.85rem' }}>
            {errorMsg}
          </div>
        )}

        <datalist id={dlTecId}>
          {Object.values(dataset.tecnicos).map(t => (
            <option key={t.matricula} value={t.matricula}>
              {t.nome} {t.funcao ? `· ${t.funcao}` : ''}
            </option>
          ))}
        </datalist>

        <datalist id={dlPlatId}>
          {Object.values(dataset.plataformas).map(p => (
            <option key={p.sigla} value={p.sigla}>
              {p.nome || p.sigla} {p.un ? `(${p.un})` : ''}
            </option>
          ))}
        </datalist>
      </form>
    </Modal>
  );
};
