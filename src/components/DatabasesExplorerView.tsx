import React, { useMemo, useState } from 'react';
import { usePipelineSsot } from '../data/pipelineSsotContext';
import type { DatabasePillarId } from '../data/pipelineTypes';

interface DatabasesExplorerViewProps {
  checkedDbs: Record<string, boolean>;
  onToggleDb: (id: string) => void;
}

export const DatabasesExplorerView: React.FC<DatabasesExplorerViewProps> = ({
  checkedDbs,
  onToggleDb,
}) => {
  const { ssot } = usePipelineSsot();
  const catalog = ssot.uiCatalog.databasesCatalog;
  const pillarLabels = ssot.uiCatalog.databasePillarLabels;

  const [selectedPillar, setSelectedPillar] = useState<DatabasePillarId>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyMinimumScope, setOnlyMinimumScope] = useState<boolean>(false);
  const [expandedId, setExpandedId] = useState<string | null>(
    ssot.uiCatalog.defaultExpandedDatabaseId ?? catalog[0]?.id ?? null
  );

  const filteredDatabases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.filter((db) => {
      if (selectedPillar !== 'all' && db.pillar !== selectedPillar) return false;
      if (onlyMinimumScope && db.priority !== 'Escopo Mínimo (Obrigatório)') return false;
      if (!q) return true;
      return (
        db.datasetName.toLowerCase().includes(q) ||
        db.institution.toLowerCase().includes(q) ||
        db.targetModelRole.toLowerCase().includes(q) ||
        db.portalOrEndpoint.toLowerCase().includes(q) ||
        db.methodologicalNotes.toLowerCase().includes(q)
      );
    });
  }, [catalog, selectedPillar, searchQuery, onlyMinimumScope]);

  const pillarOptions: DatabasePillarId[] = [
    'all',
    'offshore',
    'datacenters',
    'capacidade_atual',
    'consumo_atual',
    'curtailment_clima',
  ];

  const completedCount = catalog.filter((db) => checkedDbs[db.id]).length;

  return (
    <div className="space-y-8">
      <section aria-labelledby="heading-bases" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="max-w-3xl space-y-1.5">
            <p className="text-xs font-medium text-sky-800">
              Fontes Oficiais Brasileiras · Mapeamento Completo dos 5 Pilares (SSOT)
            </p>
            <h1 id="heading-bases" className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
              Onde obter os dados reais para cada etapa do pipeline
            </h1>
            <p className="text-sm lg:text-base text-slate-600 leading-relaxed">
              Catálogo exato das {catalog.length} bases públicas brasileiras necessárias para rodar os modelos do Plano
              Orientador sem suposições artificiais, filtradas por escopo e papel no balanço{' '}
              <span className="font-mono">M(t)</span>.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 shrink-0 tabular-nums">
            <span className="text-xs text-slate-500 block">Checklist de Coleta</span>
            <span className="text-xl font-bold font-mono text-slate-900">
              {completedCount} / {catalog.length}
            </span>
            <span className="text-xs text-slate-600 block">bases verificadas</span>
          </div>
        </div>

        {/* Filtros por Pilar e Busca */}
        <div className="py-5 border-b border-slate-200 space-y-4">
          <div className="flex flex-wrap gap-2">
            {pillarOptions.map((pillar) => {
              const active = selectedPillar === pillar;
              return (
                <button
                  key={pillar}
                  type="button"
                  onClick={() => setSelectedPillar(pillar)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {pillarLabels[pillar] ?? pillar}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <label htmlFor="search-databases" className="sr-only">
                Buscar base de dados
              </label>
              <input
                id="search-databases"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por ONS, ANEEL, IBAMA, MME, EPE, curtailment..."
                className="w-full h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyMinimumScope}
                onChange={(e) => setOnlyMinimumScope(e.target.checked)}
                className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
              />
              <span>Mostrar apenas Escopo Mínimo (Obrigatório)</span>
            </label>
          </div>
        </div>

        {/* Lista de Bancos de Dados (Tabela Estruturada com Detalhamento Expansível) */}
        <div className="divide-y divide-slate-200">
          {filteredDatabases.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-sm text-slate-600">Nenhuma base encontrada com os filtros atuais.</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedPillar('all');
                  setSearchQuery('');
                  setOnlyMinimumScope(false);
                }}
                className="text-xs font-medium text-sky-700 hover:underline cursor-pointer"
              >
                Limpar todos os filtros
              </button>
            </div>
          ) : (
            filteredDatabases.map((db) => {
              const isExpanded = expandedId === db.id;
              const isChecked = Boolean(checkedDbs[db.id]);
              return (
                <article key={db.id} className="py-5">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="flex items-start gap-3.5 flex-1">
                      <input
                        id={`chk-${db.id}`}
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleDb(db.id)}
                        aria-label={`Marcar ${db.datasetName} como verificado`}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600 cursor-pointer shrink-0"
                      />

                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="font-semibold text-sky-800">{db.pillarLabel}</span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="font-medium text-slate-700">{db.institution}</span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="font-mono text-slate-600">{db.granularity}</span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span
                            className={
                              db.priority === 'Escopo Mínimo (Obrigatório)'
                                ? 'font-medium text-emerald-700'
                                : 'font-medium text-amber-700'
                            }
                          >
                            {db.priority}
                          </span>
                        </div>

                        <h2 className="text-base font-bold text-slate-900">{db.datasetName}</h2>

                        <p className="text-sm text-slate-600">
                          <strong className="font-medium text-slate-800">Papel no modelo:</strong> {db.targetModelRole}
                        </p>

                        <p className="text-xs font-mono text-slate-500 break-all">
                          Endpoint / Portal: {db.portalOrEndpoint}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : db.id)}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start cursor-pointer"
                    >
                      {isExpanded ? 'Ocultar detalhes técnicos' : 'Colunas & Cuidados →'}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 ml-7.5 p-5 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
                      <div className="space-y-2">
                        <h3 className="font-semibold text-slate-900">Colunas, Filtros e Chaves de Cruzamento:</h3>
                        <ul className="list-disc pl-4 space-y-1.5 text-slate-700 leading-relaxed">
                          {db.keyColumnsAndFilters.map((col, idx) => (
                            <li key={idx}>{col}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-2">
                        <h3 className="font-semibold text-slate-900">Observação Metodológica Crítica:</h3>
                        <p className="text-slate-700 leading-relaxed">{db.methodologicalNotes}</p>
                        <div className="pt-2 text-slate-500">
                          Referência de acesso: <strong className="text-slate-800">{db.accessUrlLabel}</strong>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      {/* Guia de Cruzamento Temporal & Espacial (Regras de Ouro) */}
      <section aria-labelledby="heading-cruzamento" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <h2 id="heading-cruzamento" className="text-lg font-bold text-slate-900 pb-4 border-b border-slate-200">
          Regras de Cruzamento entre as Bases (Evitando Armadilhas Clássicas)
        </h2>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-slate-700 leading-relaxed">
          <div className="space-y-1.5">
            <h3 className="font-semibold text-slate-900">1. Submercado ONS NE ≠ Limite Estadual do Maranhão</h3>
            <p>
              No SIGA/ANEEL, parques filtrados apenas por UF podem incluir usinas no Maranhão eletricamente conectadas ao{' '}
              <strong>Subsistema Norte</strong> no critério do ONS. Cruze os códigos <span className="font-mono">CEG</span>{' '}
              com a tabela de usinas do ONS onde <span className="font-mono">id_subsistema == &quot;{ssot.config.subsystemId}&quot;</span>.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-slate-900">2. Geração Medida ≠ Vento Disponível (Constrained-off)</h3>
            <p>
              Especialmente a partir de {ssot.config.coffStartYear}, o ONS restringiu fortemente usinas eólicas no NE. Se você treinar o Modelo B
              usando apenas geração líquida medida, subestimará o potencial futuro. Some a energia não-realizada por
              corte ao gerar <span className="font-mono">CF(t)</span> potencial.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-slate-900">3. Nunca multiplicar PUE em duplicidade</h3>
            <p>
              Algumas notícias e portarias de MME citam MW totais de acesso à rede básica (já incluindo refrigeração),
              enquanto releases comerciais citam &quot;MW de TI&quot;. Padronize a coluna booleana{' '}
              <span className="font-mono">is_total_grid_power</span> antes de aplicar o fator PUE.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-slate-900">4. Recorte Temporal Único em UTC-3 (Horário de Brasília)</h3>
            <p>
              As séries do ONS utilizam horário de Brasília (UTC-3). Realinhe quaisquer covariáveis meteorológicas (quando
              acopladas) de UTC para <span className="font-mono">America/Fortaleza</span> antes de criar lags{' '}
              <span className="font-mono">t-1</span> e harmônicos horários, eliminando deslocamentos de fase solar.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
