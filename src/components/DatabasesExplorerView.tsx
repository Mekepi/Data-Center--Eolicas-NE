import React, { useMemo, useState } from 'react';
import {
  OFFICIAL_DATABASES,
  PILLAR_LABELS,
  type DatabasePillarId,
  type OfficialDatabaseEntry,
} from '../data/databasesCatalog';

interface DatabasesExplorerViewProps {
  checkedIds: Record<string, boolean>;
  onToggleChecked: (id: string) => void;
  onExportCsv: () => void;
}

export const DatabasesExplorerView: React.FC<DatabasesExplorerViewProps> = ({
  checkedIds,
  onToggleChecked,
  onExportCsv,
}) => {
  const [selectedPillar, setSelectedPillar] = useState<DatabasePillarId>('all');
  const [granularityFilter, setGranularityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string>('ibama-offshore-laf');

  const filteredDatabases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return OFFICIAL_DATABASES.filter((db) => {
      if (selectedPillar !== 'all' && db.pillar !== selectedPillar) return false;
      if (granularityFilter !== 'all' && db.granularity !== granularityFilter) return false;
      if (!q) return true;
      return (
        db.datasetName.toLowerCase().includes(q) ||
        db.institution.toLowerCase().includes(q) ||
        db.portalOrEndpoint.toLowerCase().includes(q) ||
        db.targetModelRole.toLowerCase().includes(q) ||
        db.methodologicalNotes.toLowerCase().includes(q)
      );
    });
  }, [selectedPillar, granularityFilter, searchQuery]);

  const completedCount = useMemo(
    () => OFFICIAL_DATABASES.filter((d) => checkedIds[d.id]).length,
    [checkedIds]
  );

  const resetFilters = () => {
    setSelectedPillar('all');
    setGranularityFilter('all');
    setSearchQuery('');
  };

  return (
    <div className="space-y-8">
      {/* Cabeçalho e Resumo das 4 Frentes Solicitadas */}
      <section aria-labelledby="heading-bancos" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 pb-6 border-b border-slate-200">
          <div className="max-w-3xl space-y-2">
            <p className="text-xs font-medium text-sky-800">
              Mapeamento de Dados Públicos · ONS · ANEEL · EPE · MME · IBAMA
            </p>
            <h1 id="heading-bancos" className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
              Bancos de Dados Oficiais Necessários para o Estudo
            </h1>
            <p className="text-sm lg:text-base text-slate-600 leading-relaxed">
              Abaixo estão mapeadas as fontes oficiais brasileiras para os quatro eixos levantados —{' '}
              <strong>eólicas offshore em aprovação</strong>, <strong>projetos de data centers no Nordeste</strong>,{' '}
              <strong>capacidade de geração atual/futura</strong> e <strong>consumo/carga atual da região</strong> —
              acrescidas da base obrigatória de <strong>constrained-off (curtailment)</strong> do ONS.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end gap-3 shrink-0">
            <div className="text-xs text-slate-600 tabular-nums">
              Checklist de coleta do grupo:{' '}
              <strong className="font-mono text-slate-900">
                {completedCount}/{OFFICIAL_DATABASES.length}
              </strong>{' '}
              bases validadas
            </div>
            <button
              type="button"
              onClick={onExportCsv}
              className="px-4 py-2 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Baixar Matriz de Dados (.CSV)
            </button>
          </div>
        </div>

        {/* Síntese Executiva das 4 Perguntas de Dados */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pt-6">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-slate-900">1. Eólicas Offshore (Aprovação)</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>IBAMA (LAF/SEI – Mapa de Complexos Eólicos Offshore)</strong> e <strong>MME PUG-Offshore</strong>{' '}
              (Lei 15.097/2025). Filtrar costa de CE, RN, PI e MA, eliminando sobreposições de áreas e aplicando janela
              realista pós-2031 no Monte Carlo.
            </p>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-slate-900">2. Data Centers no Nordeste</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>Portarias de Acesso à Rede Básica do MME</strong> (projetos firmes &gt;50 MW),{' '}
              <strong>Fila PAR/PEL do ONS + Estudo de Cargas Eletrointensivas da EPE</strong> e licenças estaduais{' '}
              <strong>ZPE Pecém / Hub Fortaleza / Suape</strong>.
            </p>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-slate-900">3. Capacidade Atual & Pipeline</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>ANEEL – SIGA</strong> (potência fiscalizada/outorgada por UF e fase: Operação, Construção, Não
              Iniciada) cruzado via código CEG com a <strong>Geração Horária por Usina/Subsistema do ONS</strong>.
            </p>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-slate-900">4. Consumo & Carga Atual NE</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>ONS Curva de Carga Horária</strong> (<span className="font-mono">id_subsistema = NE</span>) +{' '}
              <strong>Fluxos de Intercâmbio SIN</strong> para a dinâmica horária, ancorados no{' '}
              <strong>Consumo Mensal e PDE 2035 da EPE</strong>.
            </p>
          </div>
        </div>
      </section>

      {/* Barra de Filtros e Busca */}
      <section aria-label="Filtros do catálogo de bases" className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit max-w-full overflow-x-auto">
          {(Object.keys(PILLAR_LABELS) as DatabasePillarId[]).map((pillarKey) => (
            <button
              key={pillarKey}
              type="button"
              onClick={() => setSelectedPillar(pillarKey)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedPillar === pillarKey
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {PILLAR_LABELS[pillarKey]}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="flex-1 max-w-md">
            <label htmlFor="search-databases" className="block text-xs font-medium text-slate-700 mb-1">
              Buscar por órgão, tabela, coluna ou palavra-chave (ex.: SIGA, IBAMA, Pecém, constrained-off)
            </label>
            <input
              id="search-databases"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Digite para filtrar bases oficiais..."
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="filter-granularity" className="block text-xs font-medium text-slate-700 mb-1">
                Granularidade Temporal
              </label>
              <select
                id="filter-granularity"
                value={granularityFilter}
                onChange={(e) => setGranularityFilter(e.target.value)}
                className="h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
              >
                <option value="all">Todas as granularidades</option>
                <option value="Horária">Horária</option>
                <option value="Mensal / Anual">Mensal / Anual</option>
                <option value="Cadastral / Projetos">Cadastral / Projetos</option>
              </select>
            </div>

            <div className="text-xs text-slate-500 pb-2.5 tabular-nums">
              Exibindo <strong>{filteredDatabases.length}</strong> de {OFFICIAL_DATABASES.length} bases
            </div>
          </div>
        </div>

        {/* Lista de Bases ou Estado Vazio */}
        {filteredDatabases.length === 0 ? (
          <div className="py-12 text-center border-t border-slate-200 space-y-3">
            <p className="text-sm font-medium text-slate-900">
              Nenhuma base de dados encontrada para os filtros selecionados.
            </p>
            <p className="text-xs text-slate-500">
              Tente remover o filtro de granularidade ou pesquisar por termos como ONS, ANEEL, IBAMA, EPE ou MME.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Limpar todos os filtros
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 border-t border-slate-200">
            {filteredDatabases.map((db: OfficialDatabaseEntry) => {
              const isExpanded = expandedId === db.id;
              const isChecked = Boolean(checkedIds[db.id]);
              return (
                <article key={db.id} className="py-5 space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-1.5">
                      {/* Metadados limpos sem pílulas estáticas (Zero-Pill Discipline) */}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-medium text-sky-800">{db.pillarLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>{db.institution}</span>
                        <span aria-hidden="true">·</span>
                        <span>Granularidade: {db.granularity}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            db.priority.includes('Obrigatório') ? 'font-medium text-slate-800' : 'text-slate-500'
                          }
                        >
                          {db.priority}
                        </span>
                      </div>

                      <h3 className="text-base font-semibold text-slate-900">{db.datasetName}</h3>
                      <p className="text-xs font-mono text-slate-600">{db.portalOrEndpoint}</p>
                      <p className="text-sm text-slate-700">
                        <strong className="font-medium text-slate-900">Papel no modelo:</strong> {db.targetModelRole}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onToggleChecked(db.id)}
                          aria-label={`Marcar base ${db.datasetName} como coletada`}
                          className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                        />
                        <span>{isChecked ? 'Base mapeada' : 'Marcar coleta'}</span>
                      </label>

                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedId(isExpanded ? '' : db.id)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {isExpanded ? 'Ocultar especificações' : 'Ver colunas & cuidados'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="pt-3 mt-3 border-t border-slate-100 grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
                      <div className="space-y-1.5">
                        <p className="font-semibold text-slate-900">
                          Filtros e Colunas-Chave para o Script de Ingestão:
                        </p>
                        <ul className="list-disc pl-4 space-y-1 text-slate-600">
                          {db.keyColumnsAndFilters.map((col, idx) => (
                            <li key={idx}>{col}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-2">
                        <p className="font-semibold text-slate-900">Cuidado Metodológico (Atenção na Modelagem):</p>
                        <p className="text-slate-600 leading-relaxed">{db.methodologicalNotes}</p>
                        <p className="text-slate-500 pt-1">
                          Referência oficial: <span className="font-medium text-slate-800">{db.accessUrlLabel}</span>
                        </p>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Chave de Relacionamento (Join Keys) entre ONS, ANEEL, EPE e IBAMA */}
      <section aria-labelledby="heading-joins" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <h2 id="heading-joins" className="text-lg font-bold text-slate-900 mb-2">
          Chaves de Cruzamento (Data Joins) entre os Bancos de Dados
        </h2>
        <p className="text-sm text-slate-600 mb-5">
          Para evitar erros clássicos de desalinhamento espacial ou temporal quando formos escrever os scripts Python,
          estas são as quatro regras de junção que unificam as bases:
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 pr-4">Cruzamento</th>
                <th className="py-2.5 px-4">Chave Primária</th>
                <th className="py-2.5 pl-4">Regra de Ouro para o Nordeste</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs text-slate-700">
              <tr>
                <td className="py-3 pr-4 font-medium text-slate-900">ONS Geração × ANEEL SIGA</td>
                <td className="py-3 px-4 font-mono">cod_ceg (núcleo de 6 dígitos)</td>
                <td className="py-3 pl-4">
                  Usar submercado elétrico do ONS (<span className="font-mono">id_subsistema == &apos;NE&apos;</span>),
                  pois parte do Maranhão pertence ao Subsistema Norte.
                </td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium text-slate-900">Carga × Eólica × Constrained-off</td>
                <td className="py-3 px-4 font-mono">din_instante (1h UTC-3)</td>
                <td className="py-3 pl-4">
                  Reamostrar dados semi-horários de constrained-off para média horária (<span className="font-mono">MWmed</span>) antes do merge.
                </td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium text-slate-900">Portarias MME (DCs) × Subsistema</td>
                <td className="py-3 px-4 font-mono">Subestação Rede Básica + Ano</td>
                <td className="py-3 pl-4">
                  Somar apenas cargas conectadas em barramentos do NE (CE, PE, RN, BA, PI, PB, AL, SE) e converter degraus anuais em rampa suave.
                </td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium text-slate-900">IBAMA Offshore × SIGA Onshore</td>
                <td className="py-3 px-4 font-mono">Polígono Costeiro UF + Fase LAF</td>
                <td className="py-3 pl-4">
                  Manter em tabelas separadas: projetos offshore não possuem código CEG ativo de operação e entram apenas pós-2031 nos cenários estocásticos.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
