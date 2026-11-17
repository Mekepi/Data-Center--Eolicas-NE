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

function buildStorageVersionToken(schemaVersion: string): string {
  return schemaVersion.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function sanitizePersistedDecisions(
  raw: unknown,
  ssotDecisions: Array<{ id: string; options: Array<{ value: string }> }>
): Record<string, string> {
  const defaults = buildDefaultDecisions(ssotDecisions);
  if (!raw || typeof raw !== 'object') return defaults;
  const record = raw as Record<string, unknown>;
  const validOptionsById = new Map<string, Set<string>>();
  for (const item of ssotDecisions) {
    validOptionsById.set(item.id, new Set(item.options.map((o) => o.value)));
  }
  for (const [key, val] of Object.entries(record)) {
    const allowed = validOptionsById.get(key);
    if (allowed && typeof val === 'string' && allowed.has(val)) {
      defaults[key] = val;
    }
  }
  return defaults;
}

function sanitizePersistedChecklist(
  raw: unknown,
  defaultCheckedIds: string[],
  validDbIds: Set<string>
): Record<string, boolean> {
  const sanitized: Record<string, boolean> = {};
  for (const dbId of defaultCheckedIds) {
    if (validDbIds.has(dbId)) {
      sanitized[dbId] = true;
    }
  }
  if (!raw || typeof raw !== 'object') return sanitized;
  const record = raw as Record<string, unknown>;
  for (const [key, val] of Object.entries(record)) {
    if (validDbIds.has(key) && typeof val === 'boolean') {
      sanitized[key] = val;
    }
  }
  return sanitized;
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
  const storageVersion = buildStorageVersionToken(ssot.schemaVersion);
  const storageKeyDecisions = `${storagePrefix}_decisions_v${storageVersion}`;
  const storageKeyChecklist = `${storagePrefix}_db_checklist_v${storageVersion}`;

  const [decisions, setDecisions] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(storageKeyDecisions);
      return sanitizePersistedDecisions(saved ? JSON.parse(saved) : null, ssot.uiCatalog.groupDecisions);
    } catch {
      return buildDefaultDecisions(ssot.uiCatalog.groupDecisions);
    }
  });

  const [checkedDbs, setCheckedDbs] = useState<Record<string, boolean>>(() => {
    const validDbIds = new Set(ssot.uiCatalog.databasesCatalog.map((d) => d.id));
    try {
      const saved = localStorage.getItem(storageKeyChecklist);
      return sanitizePersistedChecklist(
        saved ? JSON.parse(saved) : null,
        ssot.uiCatalog.defaultCheckedDatabaseIds,
        validDbIds
      );
    } catch {
      return sanitizePersistedChecklist(null, ssot.uiCatalog.defaultCheckedDatabaseIds, validDbIds);
    }
  });

  useEffect(() => {
    const validDbIds = new Set(ssot.uiCatalog.databasesCatalog.map((d) => d.id));
    setDecisions((prev) => sanitizePersistedDecisions(prev, ssot.uiCatalog.groupDecisions));
    setCheckedDbs((prev) =>
      sanitizePersistedChecklist(prev, ssot.uiCatalog.defaultCheckedDatabaseIds, validDbIds)
    );
  }, [ssot.schemaVersion, ssot.uiCatalog.groupDecisions, ssot.uiCatalog.databasesCatalog, ssot.uiCatalog.defaultCheckedDatabaseIds]);

  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  const handleSelectDecision = (decisionId: string, value: string) => {
    setDecisions((prev) => {
      const next = sanitizePersistedDecisions({ ...prev, [decisionId]: value }, ssot.uiCatalog.groupDecisions);
      try {
        localStorage.setItem(storageKeyDecisions, JSON.stringify(next));
      } catch {
        // Ignore storage errors inside restricted frames
      }
      return next;
    });
  };

  const handleToggleDb = (dbId: string) => {
    const validDbIds = new Set(ssot.uiCatalog.databasesCatalog.map((d) => d.id));
    setCheckedDbs((prev) => {
      const next = sanitizePersistedChecklist(
        { ...prev, [dbId]: !prev[dbId] },
        ssot.uiCatalog.defaultCheckedDatabaseIds,
        validDbIds
      );
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
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
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

            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <div className="px-3 py-1.5 bg-slate-100 rounded-md text-slate-700 font-medium tabular-nums">
                Checklist de Bases: {checkedCount}/{totalCatalogDbs} verificadas
              </div>
              <button
                type="button"
                onClick={handleExportCatalogCsv}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {exportFeedback ?? 'Exportar Guia de Fontes (.csv)'}
              </button>
            </div>
          </div>

          {/* Barra de Navegação */}
          <nav aria-label="Navegação principal" className="mt-3 flex flex-wrap gap-1.5">
            {navItems.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
