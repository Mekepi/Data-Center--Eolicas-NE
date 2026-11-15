import React, { useEffect, useState } from 'react';
import { PipelineSsotProvider, usePipelineSsot } from './data/pipelineSsotContext';
import { ObjectiveAndSimulatorView } from './components/ObjectiveAndSimulatorView';
import { DatabasesExplorerView } from './components/DatabasesExplorerView';
import { DataCentersPipelineView } from './components/DataCentersPipelineView';
import { FeaturesAndAnovaView } from './components/FeaturesAndAnovaView';
import { ScriptsPipelineView } from './components/ScriptsPipelineView';
import { DecisionsAndPdfView } from './components/DecisionsAndPdfView';
import { buildDefaultSimulationConfig, type SimulationConfig } from './utils/energyModel';
import { downloadDelimitedCsv } from './utils/csvExport';

type TabId =
  | 'simulador'
  | 'bases'
  | 'datacenters'
  | 'features_anova'
  | 'scripts'
  | 'decisoes';

function buildStorageKeyPrefix(subsystemId: string): string {
  return `ptc3567_${subsystemId.toLowerCase()}`;
}

function buildDefaultDecisions(ssotDecisions: Array<{ id: string; options: Array<{ value: string }> }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of ssotDecisions) {
    if (item.options[0]) {
      result[item.id] = item.options[0].value;
    }
  }
  return result;
}

const AppShell: React.FC = () => {
  const { ssot } = usePipelineSsot();
  const [activeTab, setActiveTab] = useState<TabId>('simulador');
  const [simConfig, setSimConfig] = useState<SimulationConfig>(() => buildDefaultSimulationConfig(ssot.config));
  const [hasUserEditedSimConfig, setHasUserEditedSimConfig] = useState<boolean>(false);

  useEffect(() => {
    if (!hasUserEditedSimConfig) {
      setSimConfig(buildDefaultSimulationConfig(ssot.config));
    }
  }, [ssot.bundleDigest, ssot.config, hasUserEditedSimConfig]);

  const handleUpdateSimConfig = (next: SimulationConfig) => {
    setHasUserEditedSimConfig(true);
    setSimConfig(next);
  };

  const storagePrefix = buildStorageKeyPrefix(ssot.config.subsystemId);
  const storageKeyDecisions = `${storagePrefix}_decisions_v1`;
  const storageKeyChecklist = `${storagePrefix}_db_checklist_v1`;

  const [decisions, setDecisions] = useState<Record<string, string>>(() => {
    const defaults = buildDefaultDecisions(ssot.uiCatalog.groupDecisions);
    try {
      const saved = localStorage.getItem(storageKeyDecisions);
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  });

  const [checkedDbs, setCheckedDbs] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const dbId of ssot.uiCatalog.defaultCheckedDatabaseIds) {
      initial[dbId] = true;
    }
    try {
      const saved = localStorage.getItem(storageKeyChecklist);
      return saved ? { ...initial, ...JSON.parse(saved) } : initial;
    } catch {
      return initial;
    }
  });

  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  const handleSelectDecision = (decisionId: string, value: string) => {
    setDecisions((prev) => {
      const next = { ...prev, [decisionId]: value };
      try {
        localStorage.setItem(storageKeyDecisions, JSON.stringify(next));
      } catch {
        // Ignore storage errors inside restricted frames
      }
      return next;
    });
  };

  const handleToggleDb = (dbId: string) => {
    setCheckedDbs((prev) => {
      const next = { ...prev, [dbId]: !prev[dbId] };
      try {
        localStorage.setItem(storageKeyChecklist, JSON.stringify(next));
      } catch {
        // Ignore storage errors inside restricted frames
      }
      return next;
    });
  };

  const handleExportCatalogCsv = () => {
    const headers = [
      'id',
      'pilar',
      'instituicao',
      'base_de_dados',
      'granularidade',
      'prioridade',
      'uso_no_modelo',
      'portal_ou_endpoint',
    ];
    const rows = ssot.uiCatalog.databasesCatalog.map((db) => [
      db.id,
      db.pillarLabel,
      db.institution,
      db.datasetName,
      db.granularity,
      db.priority,
      db.targetModelRole,
      db.portalOrEndpoint,
    ]);
    downloadDelimitedCsv('bases_oficiais_data_centers_eolica_ne.csv', headers, rows);
    setExportFeedback('CSV exportado!');
    window.setTimeout(() => setExportFeedback(null), 2500);
  };

  const checkedCount = Object.values(checkedDbs).filter(Boolean).length;
  const totalCatalogDbs = ssot.uiCatalog.databasesCatalog.length;

  const navItems: Array<{ id: TabId; label: string }> = [
    { id: 'simulador', label: '1. Objetivo & Simulador NE' },
    { id: 'bases', label: `2. Bancos de Dados (${totalCatalogDbs})` },
    { id: 'datacenters', label: `3. Pipeline Data Centers (${ssot.dataCentersPipeline.length})` },
    { id: 'features_anova', label: '4. Modelos, Monte Carlo & Passo 5' },
    { id: 'scripts', label: `5. Scripts Python (${ssot.scriptsPipeline.length})` },
    { id: 'decisoes', label: '6. Decisões & Plano PDF' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col overflow-x-clip">
      {/* Cabeçalho Principal Limpo e Científico */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium">
                <span>PTC3567 · Grupo 6</span>
                <span aria-hidden="true">·</span>
                <span>Subsistema {ssot.config.subsystemId}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-sky-800">
                  Data Centers × Eólica ({ssot.config.projectionStartYear}–{ssot.config.targetEndYear})
                </span>
              </div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 mt-0.5">
                Energia Eólica e Expansão de Data Centers no Nordeste
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="px-3 py-1.5 bg-slate-100 rounded-md text-slate-700 font-medium tabular-nums">
                Checklist de Bases: {checkedCount}/{totalCatalogDbs} verificadas
              </div>
              <button
                type="button"
                onClick={handleExportCatalogCsv}
                className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {exportFeedback ?? 'Exportar Guia de Fontes (.csv)'}
              </button>
            </div>
          </div>

          {/* Barra de Navegação */}
          <nav aria-label="Navegação principal" className="mt-4 flex flex-wrap gap-2">
            {navItems.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-sky-700 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Área de Conteúdo */}
      <main className="flex-1 min-w-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'simulador' && (
          <ObjectiveAndSimulatorView
            config={simConfig}
            onChangeConfig={handleUpdateSimConfig}
            onNavigateToDatabases={() => setActiveTab('bases')}
            onNavigateToScripts={() => setActiveTab('scripts')}
            onNavigateToModels={() => setActiveTab('features_anova')}
          />
        )}

        {activeTab === 'bases' && (
          <DatabasesExplorerView checkedDbs={checkedDbs} onToggleDb={handleToggleDb} />
        )}

        {activeTab === 'datacenters' && <DataCentersPipelineView />}

        {activeTab === 'features_anova' && <FeaturesAndAnovaView />}

        {activeTab === 'scripts' && <ScriptsPipelineView />}

        {activeTab === 'decisoes' && (
          <DecisionsAndPdfView decisions={decisions} onSelectDecision={handleSelectDecision} />
        )}
      </main>

      {/* Rodapé Técnico Discreto */}
      <footer className="bg-white border-t border-slate-200 py-5 px-4 sm:px-6 lg:px-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <span>
            Guia Técnico de Modelagem · PTC3567 Grupo 6 · Horizonte {ssot.config.projectionStartYear}–
            {ssot.config.targetEndYear} ({ssot.config.hoursPerYear.toLocaleString('pt-BR')} h/ano)
          </span>
          <span className="font-mono text-slate-400">
            Fontes: ONS · ANEEL SIGA · MME · EPE PDE {ssot.config.targetEndYear} · IBAMA LAF
          </span>
        </div>
      </footer>
    </div>
  );
};

export function App() {
  return (
    <PipelineSsotProvider>
      <AppShell />
    </PipelineSsotProvider>
  );
}

export default App;
