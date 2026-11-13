import React, { useEffect, useState } from 'react';
import { OFFICIAL_DATABASES } from './data/databasesCatalog';
import { DatabasesExplorerView } from './components/DatabasesExplorerView';
import { DataCentersPipelineView } from './components/DataCentersPipelineView';
import { FeaturesAndAnovaView } from './components/FeaturesAndAnovaView';
import { DecisionsAndPdfView, GROUP_DECISIONS } from './components/DecisionsAndPdfView';
import { ObjectiveAndSimulatorView } from './components/ObjectiveAndSimulatorView';
import { ScriptsPipelineView } from './components/ScriptsPipelineView';
import { type SimulationConfig } from './utils/energyModel';
import { PIPELINE_SSOT } from './data/generated/pipelineSsot';

type ActiveTab = 'objetivo' | 'pipeline-dc' | 'features-anova' | 'bancos' | 'scripts' | 'decisoes';

const STORAGE_KEY_CHECKED = 'ne_grid_2035_checked_dbs_v1';
const STORAGE_KEY_DECISIONS = 'ne_grid_2035_group_decisions_v1';

const DEFAULT_SIM_CONFIG: SimulationConfig = {
  targetYear: 2035,
  dcScenario: 'central',
  windScenario: 'intermediate',
  includeOffshorePost2031: false,
  seasonalRegime: 'annual_blend',
  pue: PIPELINE_SSOT.config.defaultPue,
  dcUtilization: PIPELINE_SSOT.config.defaultUtilization,
  isPublishedPowerTotalGrid: false,
  interchangeImportLimitMW: PIPELINE_SSOT.config.interchangeImportLimitMW,
  interchangeExportLimitMW: PIPELINE_SSOT.config.interchangeExportLimitMW,
};

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('objetivo');
  const [simConfig, setSimConfig] = useState<SimulationConfig>(DEFAULT_SIM_CONFIG);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  const [checkedDbs, setCheckedDbs] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_CHECKED);
      if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      // ignore storage errors
    }
    return {
      'ons-curva-carga-intercambio': true,
      'ons-geracao-usina-subsistema': true,
      'aneel-siga-capacidade': true,
    };
  });

  const [selectedDecisions, setSelectedDecisions] = useState<Record<string, string>>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_DECISIONS);
      if (raw) return JSON.parse(raw) as Record<string, string>;
    } catch {
      // ignore storage errors
    }
    const initial: Record<string, string> = {};
    for (const d of GROUP_DECISIONS) {
      initial[d.id] = d.options[0].value;
    }
    return initial;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY_CHECKED, JSON.stringify(checkedDbs));
    } catch {
      // ignore storage errors
    }
  }, [checkedDbs]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY_DECISIONS, JSON.stringify(selectedDecisions));
    } catch {
      // ignore storage errors
    }
  }, [selectedDecisions]);

  const handleToggleCheckedDb = (id: string) => {
    setCheckedDbs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSelectDecision = (decisionId: string, optionValue: string) => {
    setSelectedDecisions((prev) => ({ ...prev, [decisionId]: optionValue }));
  };

  const handleExportDatabasesCsv = () => {
    const headers = [
      'ID',
      'Eixo',
      'Instituicao',
      'Base_de_Dados',
      'Granularidade',
      'Prioridade',
      'Papel_no_Modelo',
      'Coletada_Grupo6',
    ];
    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const rows = OFFICIAL_DATABASES.map((db) =>
      [
        escapeCsv(db.id),
        escapeCsv(db.pillarLabel),
        escapeCsv(db.institution),
        escapeCsv(db.datasetName),
        escapeCsv(db.granularity),
        escapeCsv(db.priority),
        escapeCsv(db.targetModelRole),
        escapeCsv(checkedDbs[db.id] ? 'Sim' : 'Pendente'),
      ].join(';')
    );

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mapeamento_bancos_dados_eolica_datacenters_ne.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setExportFeedback('CSV exportado');
    window.setTimeout(() => setExportFeedback(null), 2200);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zonas estritas em linha única no desktop */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 lg:px-8 py-4">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('objetivo');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Balanço NE 2035
          </a>

          <nav aria-label="Navegação principal" className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('objetivo')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'objetivo'
                  ? 'border-sky-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Objetivo & Simulador
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pipeline-dc')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'pipeline-dc'
                  ? 'border-sky-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Pipeline Data Centers
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('features-anova')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'features-anova'
                  ? 'border-sky-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Modelos & Monte Carlo
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('bancos')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'bancos'
                  ? 'border-sky-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Bancos de Dados
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('scripts')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'scripts' || activeTab === 'decisoes'
                  ? 'border-sky-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Scripts & Plano PDF
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleExportDatabasesCsv}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {exportFeedback ?? 'Exportar Bases CSV'}
            </button>
          </div>
        </div>
      </header>

      {/* Navegação responsiva para telas menores */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2.5 overflow-x-auto">
        <div role="tablist" aria-label="Seções do estudo" className="flex items-center gap-2">
          {[
            { id: 'objetivo', label: 'Objetivo & Simulador' },
            { id: 'pipeline-dc', label: 'Pipeline Data Centers' },
            { id: 'features-anova', label: 'Modelos & Monte Carlo' },
            { id: 'bancos', label: 'Bancos de Dados' },
            { id: 'scripts', label: 'Scripts & Plano PDF' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id || (tab.id === 'scripts' && activeTab === 'decisoes')}
              onClick={() => setActiveTab(tab.id as ActiveTab)}
              className={`px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id || (tab.id === 'scripts' && activeTab === 'decisoes')
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Área Principal de Conteúdo */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'objetivo' && (
          <ObjectiveAndSimulatorView
            config={simConfig}
            onChangeConfig={setSimConfig}
            onNavigateToDatabases={() => setActiveTab('bancos')}
            onNavigateToScripts={() => setActiveTab('scripts')}
            onNavigateToModels={() => setActiveTab('features-anova')}
          />
        )}

        {activeTab === 'pipeline-dc' && <DataCentersPipelineView />}

        {activeTab === 'features-anova' && <FeaturesAndAnovaView />}

        {activeTab === 'bancos' && (
          <DatabasesExplorerView
            checkedIds={checkedDbs}
            onToggleChecked={handleToggleCheckedDb}
            onExportCsv={handleExportDatabasesCsv}
          />
        )}

        {(activeTab === 'scripts' || activeTab === 'decisoes') && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
                  Arquitetura de Código & Governança Metodológica
                </p>
                <p className="text-sm text-slate-600">
                  Alterne entre a esteira de scripts Python (<span className="font-mono">.py</span>) executados em{' '}
                  <span className="font-mono">multiprocessing</span> e o documento do Plano Orientador (PDF).
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('scripts')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === 'scripts' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pipeline de Scripts (.py)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('decisoes')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === 'decisoes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Decisões & Plano PDF
                </button>
              </div>
            </div>

            {activeTab === 'scripts' ? (
              <ScriptsPipelineView />
            ) : (
              <DecisionsAndPdfView
                selectedDecisions={selectedDecisions}
                onSelectDecision={handleSelectDecision}
              />
            )}
          </div>
        )}
      </main>

      {/* Rodapé limpo e institucional (sem telemetria artificial) */}
      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500">
          <div>
            PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6 · Balanço Elétrico do Nordeste até 2035
          </div>
          <div className="flex items-center gap-3">
            <span>Fontes de referência: ONS · ANEEL/SIGA · EPE/PDE · MME · IBAMA</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
