import React, { useEffect, useMemo, useState } from 'react';
import {
  computeInstalledWindCapacityMW,
  estimateAnnualSimulation,
  resolveMonteCarloSummary,
  sliceHourlyWindow,
  summarizeHourlyWindow,
  type SimulationConfig,
} from '../utils/energyModel';
import { downloadDelimitedCsv } from '../utils/csvExport';
import { usePipelineSsot } from '../data/pipelineSsotContext';
import { StudySynthesisSection } from './StudySynthesisSection';
import { SimulatorControlsPanel } from './SimulatorControlsPanel';
import { SimulatorHourlyChartSection, type SimulatorChartMode } from './SimulatorHourlyChartSection';
import { ExecutiveDeliverySection } from './ExecutiveDeliverySection';

interface ObjectiveAndSimulatorViewProps {
  config: SimulationConfig;
  onChangeConfig: (next: SimulationConfig) => void;
  onNavigateToDatabases: () => void;
  onNavigateToScripts: () => void;
  onNavigateToModels?: () => void;
}

export const ObjectiveAndSimulatorView: React.FC<ObjectiveAndSimulatorViewProps> = ({
  config,
  onChangeConfig,
  onNavigateToDatabases,
  onNavigateToScripts,
  onNavigateToModels,
}) => {
  const { ssot, hourlyBaseline, hourlyBaselineStatus } = usePipelineSsot();
  const cfg = ssot.config;
  const ui = ssot.uiCatalog;
  const refs = cfg.referenceScenarioKeys;

  const [chartMode, setChartMode] = useState<SimulatorChartMode>('margin');
  const [inspectedHour, setInspectedHour] = useState<number>(0);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  const ssotSummary = useMemo(() => {
    const intermWindMW = cfg.baseWindOnshore2026MW + cfg.windExpansionOnshoreMW[refs.windIntermediate];
    const mcInterm = ssot.monteCarlo12Scenarios2035.filter(
      (s) => s.windScenarioId === refs.windIntermediate || Math.abs(s.windCapacityMW - intermWindMW) < 100
    );
    const mcCentral = mcInterm.find((s) => s.dcScenarioId === refs.dcCentral);
    const centralAvoidedTWhList = ssot.monteCarlo12Scenarios2035
      .filter((s) => s.dcScenarioId === refs.dcCentral && s.curtailmentAvoidedGWh > 0)
      .map((s) => s.curtailmentAvoidedGWh / 1000);
    const minCentralAvoidedTWh = centralAvoidedTWhList.length > 0 ? Math.min(...centralAvoidedTWhList) : null;
    const maxCentralAvoidedTWh = centralAvoidedTWhList.length > 0 ? Math.max(...centralAvoidedTWhList) : null;
    const prefModel = refs.preferredModelId;
    const a1h = ssot.modelABenchmark2025.find((r) => r.horizonId === '1h' && r.modelId === prefModel);
    const a24h = ssot.modelABenchmark2025.find((r) => r.horizonId === '24h' && r.modelId === prefModel);
    const b1h = ssot.modelBBenchmark2025.find((r) => r.horizonId === '1h' && r.modelId === prefModel);
    const b24h = ssot.modelBBenchmark2025.find((r) => r.horizonId === '24h' && r.modelId === prefModel);
    const cBest = ssot.modelCBenchmark2025.find((r) => r.modelId === prefModel) ?? ssot.modelCBenchmark2025[0];
    const tx04 =
      ssot.transmissionSensitivity2035.find((r) => r.configCode === refs.txExpansionCode) ??
      ssot.transmissionSensitivity2035[Math.max(0, ssot.transmissionSensitivity2035.length - 2)];
    const tx05 = ssot.transmissionSensitivity2035[ssot.transmissionSensitivity2035.length - 1];
    const h2v2Inflex = ssot.h2vSynergySensitivity2035.find(
      (r) => r.h2vNominalMW === cfg.defaultH2vComparisonMW && r.flexMode === 'inflexible'
    );
    const h2v2Flex = ssot.h2vSynergySensitivity2035.find(
      (r) => r.h2vNominalMW === cfg.defaultH2vComparisonMW && r.flexMode === 'flexible'
    );
    const ind2025 = ssot.aneelVsOnsWindIndicators2015_2035.find((r) => r.year === cfg.baselineYear);
    return {
      intermWindMW,
      mcInterm,
      mcCentral,
      minCentralAvoidedTWh,
      maxCentralAvoidedTWh,
      a1h,
      a24h,
      b1h,
      b24h,
      cBest,
      tx04,
      tx05,
      h2v2Inflex,
      h2v2Flex,
      ind2025,
      totalMcScenariosCount: ssot.monteCarlo12Scenarios2035.length,
    };
  }, [ssot, cfg, refs]);

  // Memoização desacoplada: a série anual de 8.760 h e o Monte Carlo não dependem
  // de mudanças de janela (`Dia|Semana|Mês|Trimestre|Ano`) ou de `inspectedHour`.
  const annualSim = useMemo(
    () =>
      estimateAnnualSimulation(
        {
          targetYear: config.targetYear,
          dcScenario: config.dcScenario,
          windScenario: config.windScenario,
          includeOffshorePost2031: config.includeOffshorePost2031,
          seasonalRegime: config.seasonalRegime,
          pue: config.pue,
          dcUtilization: config.dcUtilization,
          isPublishedPowerTotalGrid: config.isPublishedPowerTotalGrid,
          interchangeImportLimitMW: config.interchangeImportLimitMW,
          interchangeExportLimitMW: config.interchangeExportLimitMW,
        },
        hourlyBaseline,
        ssot
      ),
    [
      config.targetYear,
      config.dcScenario,
      config.windScenario,
      config.includeOffshorePost2031,
      config.seasonalRegime,
      config.pue,
      config.dcUtilization,
      config.isPublishedPowerTotalGrid,
      config.interchangeImportLimitMW,
      config.interchangeExportLimitMW,
      hourlyBaseline,
      ssot,
    ]
  );

  const monteCarlo = useMemo(
    () =>
      resolveMonteCarloSummary(
        {
          targetYear: config.targetYear,
          dcScenario: config.dcScenario,
          windScenario: config.windScenario,
          includeOffshorePost2031: config.includeOffshorePost2031,
          seasonalRegime: config.seasonalRegime,
          pue: config.pue,
          dcUtilization: config.dcUtilization,
          isPublishedPowerTotalGrid: config.isPublishedPowerTotalGrid,
          interchangeImportLimitMW: config.interchangeImportLimitMW,
          interchangeExportLimitMW: config.interchangeExportLimitMW,
        },
        ssot
      ),
    [
      config.targetYear,
      config.dcScenario,
      config.windScenario,
      config.includeOffshorePost2031,
      config.seasonalRegime,
      config.pue,
      config.dcUtilization,
      config.isPublishedPowerTotalGrid,
      config.interchangeImportLimitMW,
      config.interchangeExportLimitMW,
      ssot,
    ]
  );

  const windowSlice = useMemo(
    () =>
      sliceHourlyWindow(
        annualSim.fullYearSeries,
        {
          targetYear: config.targetYear,
          observationWindow: config.observationWindow,
          selectedDay: config.selectedDay,
          selectedWeek: config.selectedWeek,
          selectedMonth: config.selectedMonth,
          selectedQuarter: config.selectedQuarter,
        },
        cfg,
        ui.monthShortNames
      ),
    [
      annualSim.fullYearSeries,
      config.targetYear,
      config.observationWindow,
      config.selectedDay,
      config.selectedWeek,
      config.selectedMonth,
      config.selectedQuarter,
      cfg,
      ui.monthShortNames,
    ]
  );

  const windowSummary = useMemo(() => summarizeHourlyWindow(windowSlice.points), [windowSlice.points]);

  const combinedSummary = useMemo(
    () => ({
      ...annualSim.annualSummary,
      ...windowSummary,
    }),
    [annualSim.annualSummary, windowSummary]
  );

  const potentialOffshoreGW = useMemo(
    () =>
      Number(
        (
          computeInstalledWindCapacityMW(
            {
              targetYear: config.targetYear,
              windScenario: config.windScenario,
              includeOffshorePost2031: true,
            },
            cfg
          ).offshoreMW / 1000
        ).toFixed(1)
      ),
    [config.targetYear, config.windScenario, cfg]
  );

  const windowLength = windowSlice.points.length;
  useEffect(() => {
    if (windowLength === 0) {
      setInspectedHour(0);
    } else if (inspectedHour >= windowLength) {
      setInspectedHour(Math.max(0, windowLength - 1));
    }
  }, [windowLength, inspectedHour]);

  const handleExportSeriesCsv = (scope: 'window' | 'annual') => {
    const targetRows = scope === 'annual' ? annualSim.fullYearSeries : windowSlice.points;
    if (targetRows.length === 0) return;
    const suffix = scope === 'annual' ? '8760h_anual' : config.observationWindow;
    const filename = `estimativa_horaria_ne_${config.targetYear}_${config.dcScenario}_${suffix}.csv`;
    downloadDelimitedCsv(
      filename,
      [
        'hora_do_ano_0_8759',
        'mes',
        'dia',
        'hora_dia',
        'instante',
        'carga_base_mw',
        'carga_dc_mw',
        'carga_total_mw',
        'cf_eolico',
        'eolica_potencial_mw',
        'solar_mw',
        'chesf_despachavel_mw',
        'geracao_total_mw',
        'margem_sem_dc_mw',
        'margem_com_dc_mw',
        'excede_importacao',
        'curtailment_sem_dc_mw',
        'curtailment_com_dc_mw',
      ],
      targetRows.map((p) => [
        p.hourOfYear,
        p.month,
        p.dayOfMonth,
        p.hourOfDay,
        p.timestampLabel,
        p.baseLoadMW,
        p.dcLoadMW,
        p.totalLoadMW,
        p.windCapacityFactor,
        p.windGenPotentialMW,
        p.solarGenMW,
        p.otherDispatchableMW,
        p.totalGenPotentialMW,
        p.marginWithoutDcMW,
        p.marginWithDcMW,
        p.exceedsImportLimit,
        p.curtailmentWithoutDcMW,
        p.curtailmentWithDcMW,
      ])
    );
    setExportFeedback(`CSV ${scope === 'annual' ? '8.760 h' : 'janela'} baixado`);
    window.setTimeout(() => setExportFeedback(null), 2500);
  };

  return (
    <div className="space-y-10">
      <StudySynthesisSection
        cfg={cfg}
        lineage={ssot.lineage}
        ui={ui}
        summary={ssotSummary}
        onNavigateToDatabases={onNavigateToDatabases}
        onNavigateToScripts={onNavigateToScripts}
        onNavigateToModels={onNavigateToModels}
      />

      {/* Seção 2: Simulador Real-Time de Ano Completo (8.760 h, 2025–2035) e Janelas Multi-Escala */}
      <section aria-labelledby="heading-simulador" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <span>
                Estimativa Real-Time de Ano Completo ({cfg.hoursPerYear.toLocaleString('pt-BR')} h) · Subsistema{' '}
                {cfg.subsystemId}
              </span>
              {config.targetYear === cfg.baselineYear ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-sky-800 font-semibold">
                    Diagnóstico Histórico Empírico ONS ({cfg.baselineYear})
                  </span>
                </>
              ) : (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-800 font-semibold">
                    Projeção Paramétrica ({config.targetYear})
                  </span>
                </>
              )}
            </div>
            <h2 id="heading-simulador" className="text-xl lg:text-2xl font-bold text-slate-900">
              Simulador Horário Anual M(t) ({config.targetYear}) · {windowSlice.windowLabel}
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Modo de visualização do simulador horário"
            className="flex flex-wrap sm:flex-nowrap shrink-0 items-center gap-1 p-1 bg-slate-100 rounded-lg self-start lg:self-auto max-w-full"
          >
            <button
              type="button"
              role="tab"
              aria-selected={chartMode === 'margin'}
              onClick={() => setChartMode('margin')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMode === 'margin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Margem Horária M(t) & Limites
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chartMode === 'supply_demand'}
              onClick={() => setChartMode('supply_demand')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMode === 'supply_demand'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Oferta G_{cfg.subsystemId}(t) vs. Carga Total
            </button>
          </div>
        </div>

        <SimulatorControlsPanel
          config={config}
          cfg={cfg}
          ui={ui}
          effectiveDcLoadMW={combinedSummary.effectiveDcLoadMW}
          installedWindGW={monteCarlo.installedWindGW}
          offshoreWindGW={monteCarlo.offshoreWindGW}
          potentialOffshoreGW={potentialOffshoreGW}
          avgWindCfPct={combinedSummary.avgWindCfPct}
          hourlyBaselineAvailable={combinedSummary.hourlyBaselineAvailable}
          exportFeedback={exportFeedback}
          onChangeConfig={onChangeConfig}
          onExportAnnualCsv={() => handleExportSeriesCsv('annual')}
        />

        <SimulatorHourlyChartSection
          config={config}
          cfg={cfg}
          ui={ui}
          chartMode={chartMode}
          summary={combinedSummary}
          monteCarlo={monteCarlo}
          windowSlice={windowSlice}
          hourlyBaselineStatus={hourlyBaselineStatus}
          inspectedHour={inspectedHour}
          onChangeInspectedHour={setInspectedHour}
        />
      </section>

      <ExecutiveDeliverySection
        cfg={cfg}
        ui={ui}
        summary={ssotSummary}
        onNavigateToModels={onNavigateToModels}
      />
    </div>
  );
};
