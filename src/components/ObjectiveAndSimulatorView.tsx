import React, { useEffect, useMemo, useState } from 'react';
import {
  buildDefaultSimulationConfig,
  buildHourlyPlotBuckets,
  evaluateScenario,
  type DataCenterScenarioId,
  type HourlyPoint,
  type ObservationWindowId,
  type SeasonalRegimeId,
  type SimulationConfig,
  type WindExpansionScenarioId,
} from '../utils/energyModel';
import { downloadDelimitedCsv } from '../utils/csvExport';
import { usePipelineSsot } from '../data/pipelineSsotContext';

interface ObjectiveAndSimulatorViewProps {
  config: SimulationConfig;
  onChangeConfig: (next: SimulationConfig) => void;
  onNavigateToDatabases: () => void;
  onNavigateToScripts: () => void;
  onNavigateToModels?: () => void;
}

type ChartMode = 'margin' | 'supply_demand';

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
  const bounds = cfg.simulatorSliderBounds;
  const badges = cfg.uiThresholds.sensitivityBadges;
  const targetMaxPct = cfg.uiThresholds.targetImportProbMaxPct;
  const refs = cfg.referenceScenarioKeys;

  const [chartMode, setChartMode] = useState<ChartMode>('margin');
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
    const a1h = ssot.modelABenchmark2025.find((r) => r.horizon.includes('1h') && r.architecture.includes('ResMLP'));
    const a24h = ssot.modelABenchmark2025.find((r) => r.horizon.includes('24h') && r.architecture.includes('ResMLP'));
    const b1h = ssot.modelBBenchmark2025.find((r) => r.horizon.includes('1h') && r.architecture.includes('ResMLP'));
    const b24h = ssot.modelBBenchmark2025.find((r) => r.horizon.includes('24h') && r.architecture.includes('ResMLP'));
    const cBest = ssot.modelCBenchmark2025.find((r) => r.architecture.includes('ResMLP')) ?? ssot.modelCBenchmark2025[0];
    const txRefIdx = ssot.transmissionSensitivity2035.findIndex((r) => r.configId.startsWith(refs.txReferenceIdPrefix));
    const tx04 =
      txRefIdx >= 0 && txRefIdx + 1 < ssot.transmissionSensitivity2035.length
        ? ssot.transmissionSensitivity2035[txRefIdx + 1]
        : ssot.transmissionSensitivity2035[Math.max(0, ssot.transmissionSensitivity2035.length - 2)];
    const tx05 = ssot.transmissionSensitivity2035[ssot.transmissionSensitivity2035.length - 1];
    const h2v2Inflex = ssot.h2vSynergySensitivity2035.find(
      (r) => r.h2vNominalMW === cfg.defaultH2vComparisonMW && r.scenarioId.includes('Inflexível')
    );
    const h2v2Flex = ssot.h2vSynergySensitivity2035.find(
      (r) => r.h2vNominalMW === cfg.defaultH2vComparisonMW && r.scenarioId.includes('Flexível')
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
    };
  }, [ssot, cfg, refs]);

  const result = useMemo(
    () => evaluateScenario(config, ssot, hourlyBaseline),
    [config, ssot, hourlyBaseline]
  );

  const windowLength = result.hourlySeries.length;
  useEffect(() => {
    if (windowLength === 0) {
      setInspectedHour(0);
    } else if (inspectedHour >= windowLength) {
      setInspectedHour(Math.max(0, windowLength - 1));
    }
  }, [windowLength, inspectedHour]);

  const activePoint: HourlyPoint | undefined = result.hourlySeries[inspectedHour] ?? result.hourlySeries[0];
  const plotBuckets = useMemo(() => buildHourlyPlotBuckets(result.hourlySeries, 365), [result.hourlySeries]);

  // SVG Layout
  const svgWidth = 880;
  const svgHeight = 290;
  const padLeft = 58;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 34;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const xForFrac = (frac: number) => padLeft + frac * plotW;

  const minSeriesMargin = result.summary.minMarginMW ?? -config.interchangeImportLimitMW;
  const maxSeriesMargin = result.summary.maxMarginMW ?? config.interchangeExportLimitMW;
  const marginSpan = Math.max(2000, maxSeriesMargin - minSeriesMargin);
  const marginPad = marginSpan * cfg.uiThresholds.chartPaddingRatio;
  const marginMinBound = Math.min(-config.interchangeImportLimitMW - marginPad, minSeriesMargin - marginPad);
  const marginMaxBound = Math.max(config.interchangeExportLimitMW + marginPad, maxSeriesMargin + marginPad);
  const yForMargin = (val: number) =>
    padTop + ((marginMaxBound - val) / Math.max(1, marginMaxBound - marginMinBound)) * plotH;

  const powerValues = result.hourlySeries.flatMap((p) => [p.totalGenPotentialMW, p.totalLoadMW, p.baseLoadMW]);
  const rawPowerMax = powerValues.length > 0 ? Math.max(...powerValues) : cfg.interchangeExportLimitMW * 2;
  const rawPowerMin = powerValues.length > 0 ? Math.min(...powerValues) : 0;
  const powerSpan = Math.max(2000, rawPowerMax - rawPowerMin);
  const maxPowerBound = rawPowerMax + powerSpan * cfg.uiThresholds.chartPaddingRatio;
  const minPowerBound = Math.max(0, rawPowerMin - powerSpan * cfg.uiThresholds.chartPaddingRatio);
  const yForPower = (val: number) =>
    padTop + ((maxPowerBound - val) / Math.max(1, maxPowerBound - minPowerBound)) * plotH;

  const buildBucketLine = (getter: (b: (typeof plotBuckets)[number]) => number, scaleY: (v: number) => number) =>
    plotBuckets.map((b) => `${xForFrac(b.xFrac).toFixed(1)},${scaleY(getter(b)).toFixed(1)}`).join(' ');

  const buildEnvelopePolygon = () => {
    if (plotBuckets.length === 0) return '';
    const upper = plotBuckets.map(
      (b) => `${xForFrac(b.xFrac).toFixed(1)},${yForMargin(b.maxMarginWithDcMW).toFixed(1)}`
    );
    const lower = [...plotBuckets]
      .reverse()
      .map((b) => `${xForFrac(b.xFrac).toFixed(1)},${yForMargin(b.minMarginWithDcMW).toFixed(1)}`);
    return [...upper, ...lower].join(' ');
  };

  const zeroY = yForMargin(0);
  const importLimitY = yForMargin(-config.interchangeImportLimitMW);
  const exportLimitY = yForMargin(config.interchangeExportLimitMW);

  const xTicks = useMemo(() => {
    if (result.hourlySeries.length === 0) return [];
    const n = result.hourlySeries.length;
    const denom = Math.max(1, n - 1);

    if (config.observationWindow === 'day') {
      return [0, 3, 6, 9, 12, 15, 18, 21, 23]
        .filter((h) => h < n)
        .map((h) => ({ xFrac: h / denom, label: `${String(h).padStart(2, '0')}h` }));
    }
    if (config.observationWindow === 'week') {
      const ticks: Array<{ xFrac: number; label: string }> = [];
      for (let d = 0; d < 7 && d * cfg.hoursPerDay < n; d++) {
        const idx = d * cfg.hoursPerDay;
        ticks.push({
          xFrac: idx / denom,
          label: result.hourlySeries[idx]?.timestampLabel.split(' · ')[0] ?? `D+${d + 1}`,
        });
      }
      return ticks;
    }
    if (config.observationWindow === 'month') {
      const ticks: Array<{ xFrac: number; label: string }> = [];
      for (let i = 0; i < n; i += cfg.hoursPerDay * 5) {
        ticks.push({
          xFrac: i / denom,
          label: result.hourlySeries[i]?.timestampLabel.split(' · ')[0] ?? `${i}h`,
        });
      }
      return ticks;
    }
    // quarter ou year: marcar início de cada mês presente na janela
    const seenMonths = new Set<number>();
    const ticks: Array<{ xFrac: number; label: string }> = [];
    for (let i = 0; i < n; i++) {
      const m = result.hourlySeries[i].month;
      if (!seenMonths.has(m)) {
        seenMonths.add(m);
        ticks.push({
          xFrac: i / denom,
          label: ui.monthShortNames[m - 1] ?? `M${m}`,
        });
      }
    }
    return ticks;
  }, [result.hourlySeries, config.observationWindow, cfg.hoursPerDay, ui.monthShortNames]);

  const handleExportSeriesCsv = (scope: 'window' | 'annual') => {
    const targetRows = scope === 'annual' ? result.fullYearSeries : result.hourlySeries;
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

  const mcSourceBadgeText =
    result.monteCarlo.sourceStatus === 'grid_exact'
      ? 'Monte Carlo Python (Ponto Exato da Grade)'
      : result.monteCarlo.sourceStatus === 'grid_interpolated'
        ? 'Monte Carlo Python (Interpolado na Grade)'
        : result.monteCarlo.sourceStatus === 'ssot_anchor'
          ? 'Monte Carlo Python (Âncora Oficial SSOT)'
          : 'Grade Monte Carlo indisponível para esta combinação fora das âncoras';

  const activeWindowMeta = ui.observationWindows.find((w) => w.id === config.observationWindow);

  return (
    <div className="space-y-10">
      {/* Seção 1: Resposta Estruturada à Pergunta 1 */}
      <section aria-labelledby="heading-objetivo" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="max-w-4xl space-y-3">
          <p className="text-xs font-medium text-sky-800">
            PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6 · Horizonte {cfg.projectionStartYear}–
            {cfg.targetEndYear} ({cfg.hoursPerYear.toLocaleString('pt-BR')} h/ano)
          </p>
          <h1 id="heading-objetivo" className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
            Qual é a resposta exata que o modelo de predição busca encontrar até {cfg.targetEndYear}?
          </h1>
          <p className="text-base text-slate-700 leading-relaxed">
            <strong>Não é apenas encontrar quando faltará energia puramente eólica isolada para os data centers.</strong>{' '}
            Como o {cfg.subsystemId} opera integrado ao Sistema Interligado Nacional (SIN) e conta também com geração
            solar, hidrelétrica e térmica, o alvo real do projeto é estimar a distribuição probabilística da{' '}
            <strong>Margem Horária de Geração do Subsistema {cfg.subsystemId}</strong> ao longo de todas as{' '}
            <strong>{cfg.hoursPerYear.toLocaleString('pt-BR')} horas</strong> de cada ano entre{' '}
            <strong>
              {cfg.projectionStartYear} e {cfg.targetEndYear}
            </strong>
            :
          </p>
        </div>

        <div className="mt-6 py-4 px-5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="font-mono text-sm lg:text-base font-semibold text-slate-900 sm:whitespace-nowrap shrink-0">
            M(t) = G_{cfg.subsystemId}(t) − [ L_base(t) + L_DC(t) ]
          </div>
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>G_{cfg.subsystemId}(t): geração horária provável no {cfg.subsystemId}</span>
            <span aria-hidden="true">·</span>
            <span>L_base(t): demanda normal prevista</span>
            <span aria-hidden="true">·</span>
            <span>L_DC(t): carga em rampa dos data centers</span>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">01. Déficit horário vs. Limite do SIN</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Uma margem negativa (<span className="font-mono">M(t) &lt; 0</span>) em horas de calmaria eólica{' '}
              <strong>não significa blecaute imediato</strong>: indica necessidade de importar energia do restante do
              SIN. O <strong>evento crítico</strong> medido é superar o limite físico de intercâmbio (
              {cfg.interchangeImportLimitMW.toLocaleString('pt-BR')} MW nominais).
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">02. Assimetria: alívio de curtailment</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              O estudo avalia os <strong>dois lados</strong> do problema. Em horas de vento forte e sol alto (
              <span className="font-mono">M(t) &gt;&gt; 0</span>), o {cfg.subsystemId} sofreu{' '}
              <strong>
                {ssotSummary.cBest
                  ? `${ssotSummary.cBest.realCurtailed2025TWh.toFixed(2).replace('.', ',')} TWh`
                  : ssotSummary.ind2025
                    ? `${ssotSummary.ind2025.annualCurtailmentLossTWh.toFixed(2).replace('.', ',')} TWh`
                    : '—'}{' '}
                de cortes eólicos em {cfg.baselineYear}
              </strong>{' '}
              (<em>constrained-off</em> real ONS). A carga firme 24/7 dos data centers (Cenário Central) absorve de{' '}
              <strong>
                {ssotSummary.minCentralAvoidedTWh !== null && ssotSummary.maxCentralAvoidedTWh !== null
                  ? `${ssotSummary.minCentralAvoidedTWh.toFixed(2).replace('.', ',')} a ${ssotSummary.maxCentralAvoidedTWh.toFixed(2).replace('.', ',')} TWh/ano`
                  : '—'}
              </strong>{' '}
              desse excedente local, mas agrava o déficit nas madrugadas/meses de pouco vento.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">03. Expansão eólica via CF(t), não MW bruto</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Não se compara MW eólico instalado diretamente com MW de data center. O modelo prevê o{' '}
              <strong>Fator de Capacidade horário</strong>{' '}
              <span className="font-mono">CF(t) = G_pot(t) / Cap(t)</span>, multiplica pela trajetória futura de GW
              instalados e responde via Monte Carlo{' '}
              <strong>
                quantos GW eólicos extras (
                {ssotSummary.mcCentral
                  ? `+${ssotSummary.mcCentral.compensatoryWindExpansionGW.toFixed(2).replace('.', ',')} GW`
                  : '—'}{' '}
                no cenário Central)
              </strong>{' '}
              mantêm o risco de importação até {targetMaxPct.toFixed(1).replace('.', ',')}%.
            </p>
          </div>
        </div>

        {/* Matriz sintética dos 4 blocos */}
        <div className="mt-8 pt-6 border-t border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Resultados Empíricos dos Modelos Preditivos (Teste Cego {cfg.baselineYear}) e Monte Carlo{' '}
              {cfg.targetEndYear}
            </h2>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {onNavigateToModels && (
                <button
                  type="button"
                  onClick={onNavigateToModels}
                  className="font-semibold text-sky-800 hover:text-sky-950 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Ver Validação {cfg.baselineYear} & Matriz Monte Carlo {cfg.targetEndYear} →
                </button>
              )}
              <button
                type="button"
                onClick={onNavigateToDatabases}
                className="font-medium text-slate-700 hover:text-slate-900 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Ver os {ui.databasesCatalog.length} bancos de dados oficiais →
              </button>
              <button
                type="button"
                onClick={onNavigateToScripts}
                className="font-medium text-slate-700 hover:text-slate-900 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Ver esteira de scripts (.py) →
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-4">Bloco do Estudo</th>
                  <th className="py-2.5 px-4">Variável-Alvo (Y)</th>
                  <th className="py-2.5 px-4">Algoritmo Vencedor (NumPy/SciPy)</th>
                  <th className="py-2.5 pl-4">
                    Resultado Out-of-Time {cfg.baselineYear} / Projeção {cfg.targetEndYear}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                <tr className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">Modelo A · Demanda</td>
                  <td className="py-3 px-4 font-mono text-xs">L_base(t) horária {cfg.subsystemId} (MW)</td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    {ssot.lineage.comparativeNonLinearArchitecture} (L-BFGS-B) vs. GBDT e Ridge L2
                  </td>
                  <td className="py-3 pl-4 font-mono text-xs font-semibold text-slate-900">
                    {ssotSummary.a1h && ssotSummary.a24h
                      ? `MAPE ${ssotSummary.a1h.mapePct.toFixed(2)}% (1h: MAE ${ssotSummary.a1h.maeMW.toFixed(1)} MW, R² ${ssotSummary.a1h.r2Score.toFixed(4)}) · ${ssotSummary.a24h.mapePct.toFixed(2)}% (24h: R² ${ssotSummary.a24h.r2Score.toFixed(4)})`
                      : 'Sincronizado via SSOT'}
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">Modelo B · Eólica</td>
                  <td className="py-3 px-4 font-mono text-xs">CF(t) = G_pot(t) / Cap(t)</td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    {ssot.lineage.comparativeNonLinearArchitecture} L-BFGS-B com não-linearidades aerodinâmicas (v³)
                  </td>
                  <td className="py-3 pl-4 font-mono text-xs font-semibold text-emerald-800">
                    {ssotSummary.b1h && ssotSummary.b24h
                      ? `R² = ${ssotSummary.b1h.r2Score.toFixed(4)} (1h: MAE ${ssotSummary.b1h.maeCF.toFixed(4)} / ${ssotSummary.b1h.equivPowerMaeMW.toFixed(1)} MW) · R² = ${ssotSummary.b24h.r2Score.toFixed(4)} (24h)`
                      : 'Sincronizado via SSOT'}
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">Modelo C · Curtailment</td>
                  <td className="py-3 px-4 font-mono text-xs">
                    P(corte &gt; {cfg.curtailmentFlagThresholdMW} MW) & MWh
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    {ssotSummary.cBest?.architecture ?? `Hurdle 2-Estágios (${ssot.lineage.comparativeNonLinearArchitecture})`}
                  </td>
                  <td className="py-3 pl-4 font-mono text-xs font-semibold text-amber-800">
                    {ssotSummary.cBest
                      ? `ROC-AUC = ${ssotSummary.cBest.rocAuc.toFixed(4)} · Brier = ${ssotSummary.cBest.brierScore.toFixed(4)} · F1 = ${ssotSummary.cBest.f1Score.toFixed(4)} · R² Vol = ${ssotSummary.cBest.r2Volume.toFixed(4)}`
                      : 'Sincronizado via SSOT'}
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">Passo 4 · Monte Carlo</td>
                  <td className="py-3 px-4 font-mono text-xs">
                    P(Import &gt; {(cfg.interchangeImportLimitMW / 1000).toFixed(1)} GW) & GW Extra
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    Block-Bootstrap Sazonal + Modulação Chesf + {ssot.dataCentersPipeline.length} Projetos Bottom-Up
                  </td>
                  <td className="py-3 pl-4 font-mono text-xs font-semibold text-sky-900">
                    {ssotSummary.mcCentral
                      ? `Central DC: P95 = ${ssotSummary.mcCentral.importP95MW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW (+${ssotSummary.mcCentral.compensatoryWindExpansionGW.toFixed(2)} GW eólicos extras; −${(ssotSummary.mcCentral.curtailmentAvoidedGWh / 1000).toFixed(2)} TWh corte)`
                      : 'Sincronizado via SSOT'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Seção 2: Simulador Real-Time de Ano Completo (8.760 h, 2025–2035) e Janelas Multi-Escala */}
      <section aria-labelledby="heading-simulador" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <span>
                Estimativa Real-Time de Ano Completo ({cfg.hoursPerYear.toLocaleString('pt-BR')} h) · Subsistema{' '}
                {cfg.subsystemId}
              </span>
              {config.targetYear === cfg.baselineYear && (
                <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-semibold">
                  Ano-Base Empírico ONS ({cfg.baselineYear})
                </span>
              )}
            </div>
            <h2 id="heading-simulador" className="text-xl lg:text-2xl font-bold text-slate-900">
              Simulador Horário Anual M(t) ({config.targetYear}) · {result.windowSlice.windowLabel}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start lg:self-auto max-w-full">
            <button
              type="button"
              onClick={() => setChartMode('margin')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMode === 'margin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Margem Horária M(t) & Limites
            </button>
            <button
              type="button"
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

        {/* Painel de Controles de Cenário */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 py-6 border-b border-slate-200">
          <div className="space-y-2">
            <label htmlFor="select-dc-scenario" className="block text-xs font-medium text-slate-700">
              Cenário de Expansão de Data Centers
            </label>
            <select
              id="select-dc-scenario"
              value={config.dcScenario}
              onChange={(e) => onChangeConfig({ ...config, dcScenario: e.target.value as DataCenterScenarioId })}
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value={refs.dcControl}>Sem Data Centers (Baseline Controle)</option>
              <option value={refs.dcConservative}>
                Conservador (~{(cfg.dcScenariosItMW.conservative / 1000).toFixed(2)} GW TI · Confirmados)
              </option>
              <option value={refs.dcCentral}>
                Central (~{(cfg.dcScenariosItMW.central / 1000).toFixed(2)} GW TI · Ponderado)
              </option>
              <option value={refs.dcHigh}>
                Alto / Stress Test (~{(cfg.dcScenariosItMW.high / 1000).toFixed(2)} GW TI · Pipeline)
              </option>
            </select>
            <p className="text-xs text-slate-500 tabular-nums">
              Carga DC efetiva em {config.targetYear}:{' '}
              <strong className="text-slate-800">
                {result.summary.effectiveDcLoadMW.toLocaleString('pt-BR', {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{' '}
                MW
              </strong>
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="select-wind-scenario" className="block text-xs font-medium text-slate-700">
              Trajetória de Expansão Eólica (SIGA)
            </label>
            <select
              id="select-wind-scenario"
              value={config.windScenario}
              onChange={(e) => onChangeConfig({ ...config, windScenario: e.target.value as WindExpansionScenarioId })}
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value={refs.windBase}>
                Base (Apenas Operação ~{(cfg.baseWindOnshore2026MW / 1000).toFixed(1)} GW)
              </option>
              <option value={refs.windIntermediate}>
                Intermediário (+{(cfg.windExpansionOnshoreMW.intermediate / 1000).toFixed(1)} GW Construção SIGA)
              </option>
              <option value={refs.windHigh}>
                Alto (+{(cfg.windExpansionOnshoreMW.high / 1000).toFixed(1)} GW Construção e Outorgados)
              </option>
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-700 pt-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.includeOffshorePost2031}
                onChange={(e) => onChangeConfig({ ...config, includeOffshorePost2031: e.target.checked })}
                className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
              />
              <span>
                Somar Eólica Offshore pós-{cfg.offshoreStartYear} ({result.monteCarlo.offshoreWindGW} GW)
              </span>
            </label>
          </div>

          <div className="space-y-2">
            <label htmlFor="select-regime" className="block text-xs font-medium text-slate-700">
              Ênfase Sazonal na Base Real ONS ({cfg.hoursPerYear.toLocaleString('pt-BR')} h)
            </label>
            <select
              id="select-regime"
              value={config.seasonalRegime}
              onChange={(e) => onChangeConfig({ ...config, seasonalRegime: e.target.value as SeasonalRegimeId })}
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              {ui.seasonalRegimes.map((reg) => (
                <option key={reg.id} value={reg.id}>
                  {reg.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 tabular-nums">
              Eólica total: <strong className="text-slate-800">{result.monteCarlo.installedWindGW} GW</strong> · CF médio:{' '}
              <strong className="text-slate-800">
                {result.summary.avgWindCfPct !== null ? `${result.summary.avgWindCfPct}%` : '—'}
              </strong>
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1">
                <label htmlFor="range-target-year">
                  Ano Alvo ({bounds.year.min}–{bounds.year.max})
                </label>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">{config.targetYear}</span>
              </div>
              <input
                id="range-target-year"
                type="range"
                min={bounds.year.min}
                max={bounds.year.max}
                step={bounds.year.step}
                value={config.targetYear}
                onChange={(e) => onChangeConfig({ ...config, targetYear: Number(e.target.value) })}
                className="w-full accent-sky-700 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1">
                <label htmlFor="range-import-limit">Limite Importação SIN</label>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {config.interchangeImportLimitMW.toLocaleString('pt-BR')} MW
                </span>
              </div>
              <input
                id="range-import-limit"
                type="range"
                min={bounds.interchangeImportLimitMW.min}
                max={bounds.interchangeImportLimitMW.max}
                step={bounds.interchangeImportLimitMW.step}
                value={config.interchangeImportLimitMW}
                onChange={(e) => onChangeConfig({ ...config, interchangeImportLimitMW: Number(e.target.value) })}
                className="w-full accent-sky-700 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Barra de Escala de Observação Multi-Escala (Dia | Semana | Mês | Trimestre | Ano) */}
        <div className="py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-700">Escala de Observação (Granularidade Horária):</span>
              <div role="tablist" aria-label="Escala temporal da estimativa anual" className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {ui.observationWindows.map((win) => {
                  const active = config.observationWindow === win.id;
                  return (
                    <button
                      key={win.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => onChangeConfig({ ...config, observationWindow: win.id as ObservationWindowId })}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {win.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {activeWindowMeta && <p className="text-xs text-slate-500">{activeWindowMeta.description}</p>}
          </div>

          {/* Sub-seletor contextual da janela */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {config.observationWindow === 'day' && (
              <div className="flex items-center gap-2">
                <label htmlFor="range-select-day" className="font-medium text-slate-700 whitespace-nowrap">
                  Dia do ano (1–{cfg.daysPerYear}):
                </label>
                <input
                  id="range-select-day"
                  type="range"
                  min={1}
                  max={cfg.daysPerYear}
                  step={1}
                  value={config.selectedDay}
                  onChange={(e) => onChangeConfig({ ...config, selectedDay: Number(e.target.value) })}
                  className="w-32 accent-sky-700 cursor-pointer"
                />
                <span className="font-mono font-semibold text-slate-900 tabular-nums">Dia {config.selectedDay}</span>
              </div>
            )}

            {config.observationWindow === 'week' && (
              <div className="flex items-center gap-2">
                <label htmlFor="range-select-week" className="font-medium text-slate-700 whitespace-nowrap">
                  Semana do ano (1–{cfg.weeksPerYear}):
                </label>
                <input
                  id="range-select-week"
                  type="range"
                  min={1}
                  max={cfg.weeksPerYear}
                  step={1}
                  value={config.selectedWeek}
                  onChange={(e) => onChangeConfig({ ...config, selectedWeek: Number(e.target.value) })}
                  className="w-32 accent-sky-700 cursor-pointer"
                />
                <span className="font-mono font-semibold text-slate-900 tabular-nums">Sem {config.selectedWeek}</span>
              </div>
            )}

            {config.observationWindow === 'month' && (
              <div className="flex items-center gap-2">
                <label htmlFor="select-month-window" className="font-medium text-slate-700">
                  Mês do ano:
                </label>
                <select
                  id="select-month-window"
                  value={config.selectedMonth}
                  onChange={(e) => onChangeConfig({ ...config, selectedMonth: Number(e.target.value) })}
                  className="h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                >
                  {ui.monthShortNames.map((mName, idx) => (
                    <option key={mName} value={idx + 1}>
                      {String(idx + 1).padStart(2, '0')} · {mName}/{config.targetYear}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {config.observationWindow === 'quarter' && (
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onChangeConfig({ ...config, selectedQuarter: q })}
                    className={`px-2.5 py-1 text-xs font-mono font-semibold rounded border cursor-pointer ${
                      config.selectedQuarter === q
                        ? 'bg-sky-700 text-white border-sky-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Q{q}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={!result.summary.hourlyBaselineAvailable}
              onClick={() => handleExportSeriesCsv('annual')}
              className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              {exportFeedback ?? `Exportar ${cfg.hoursPerYear.toLocaleString('pt-BR')}h (.csv)`}
            </button>
          </div>
        </div>

        {/* Barra secundária de parâmetros de Data Center */}
        <div className="py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-6 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <label htmlFor="range-pue" className="font-medium text-slate-700">
                PUE médio:
              </label>
              <input
                id="range-pue"
                type="range"
                min={bounds.pue.min}
                max={bounds.pue.max}
                step={bounds.pue.step}
                disabled={config.isPublishedPowerTotalGrid}
                value={config.pue}
                onChange={(e) => onChangeConfig({ ...config, pue: Number(e.target.value) })}
                className="w-24 accent-sky-700 cursor-pointer disabled:opacity-40"
              />
              <span className="font-mono font-semibold text-slate-900 tabular-nums">{config.pue.toFixed(2)}</span>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="range-util" className="font-medium text-slate-700">
                Utilização TI:
              </label>
              <input
                id="range-util"
                type="range"
                min={bounds.dcUtilization.min}
                max={bounds.dcUtilization.max}
                step={bounds.dcUtilization.step}
                value={config.dcUtilization}
                onChange={(e) => onChangeConfig({ ...config, dcUtilization: Number(e.target.value) })}
                className="w-24 accent-sky-700 cursor-pointer"
              />
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {Math.round(config.dcUtilization * 100)}%
              </span>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={config.isPublishedPowerTotalGrid}
                onChange={(e) => onChangeConfig({ ...config, isPublishedPowerTotalGrid: e.target.checked })}
                className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
              />
              <span>Potência publicada já é carga total na rede (omissão de PUE · Seção 5)</span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => onChangeConfig(buildDefaultSimulationConfig(cfg))}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Restaurar parâmetros padrão
          </button>
        </div>

        {/* Faixa de 4 Indicadores Principais */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 py-6 border-b border-slate-200">
          <div className="pb-4 sm:pb-0 sm:pr-6 space-y-1">
            <p className="text-xs text-slate-500">Risco Anual Importação &gt; Limite ({mcSourceBadgeText})</p>
            <p
              className={`text-2xl font-bold font-mono tabular-nums ${
                result.monteCarlo.probCriticalImportAnnualPct === null
                  ? 'text-slate-500'
                  : result.monteCarlo.probCriticalImportAnnualPct >= badges.highRiskPct
                    ? 'text-red-700'
                    : result.monteCarlo.probCriticalImportAnnualPct > badges.lowRiskPct
                      ? 'text-amber-700'
                      : 'text-emerald-700'
              }`}
            >
              {result.monteCarlo.probCriticalImportAnnualPct !== null
                ? `${result.monteCarlo.probCriticalImportAnnualPct.toFixed(1)}%`
                : '—'}
            </p>
            <p className="text-xs text-slate-600 tabular-nums">
              {result.monteCarlo.probCriticalImportAnnualPct !== null
                ? `${result.monteCarlo.probCriticalWithoutDcPct !== null ? `Sem DCs: ${result.monteCarlo.probCriticalWithoutDcPct.toFixed(1)}% · ` : ''}${
                    result.monteCarlo.probCriticalImportAnnualPct >= badges.highRiskPct
                      ? 'Alerta crítico de intercâmbio'
                      : result.monteCarlo.probCriticalImportAnnualPct > badges.lowRiskPct
                        ? 'Atenção moderada'
                        : 'Dentro da meta segura SIN'
                  }`
                : 'Aguardando grade MC Python p/ esta combinação'}
            </p>
          </div>

          <div className="py-4 sm:py-0 sm:px-6 space-y-1">
            <p className="text-xs text-slate-500">Importação Máxima P95 (Monte Carlo)</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {result.monteCarlo.p95PeakImportMW !== null
                ? `${result.monteCarlo.p95PeakImportMW.toLocaleString('pt-BR')} MW`
                : '—'}
            </p>
            <p className="text-xs text-slate-600 tabular-nums">
              {result.monteCarlo.p50PeakImportMW !== null
                ? `Mediana P50: ${result.monteCarlo.p50PeakImportMW.toLocaleString('pt-BR')} MW`
                : 'P50 N/D'}{' '}
              · M(t)&lt;0 no ano:{' '}
              {result.summary.negativeMarginHoursYear !== null
                ? `${result.summary.negativeMarginHoursYear.toLocaleString('pt-BR')}h`
                : '—'}
            </p>
          </div>

          <div className="py-4 sm:py-0 sm:px-6 space-y-1">
            <p className="text-xs text-slate-500">Curtailment Eólico Anual vs. Absorvido</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {result.monteCarlo.expectedCurtailmentWithDcTWh !== null
                ? `${result.monteCarlo.expectedCurtailmentWithDcTWh.toFixed(2)} TWh/ano`
                : result.summary.annualCurtailmentWithDcTWh !== null
                  ? `${result.summary.annualCurtailmentWithDcTWh.toFixed(2)} TWh/ano`
                  : '—'}
            </p>
            <p className="text-xs text-slate-600 tabular-nums">
              {result.monteCarlo.curtailmentAvoidedByDcGWh !== null
                ? `Absorção DC (MC): −${result.monteCarlo.curtailmentAvoidedByDcGWh.toLocaleString('pt-BR')} GWh/ano`
                : result.summary.windowCurtailmentWithDcGWh !== null
                  ? `Na janela ativa: ${result.summary.windowCurtailmentWithDcGWh.toLocaleString('pt-BR')} GWh`
                  : 'Aguardando série 8.760 h'}
            </p>
          </div>

          <div className="pt-4 sm:pt-0 sm:pl-6 space-y-1">
            <p className="text-xs text-slate-500">
              Expansão Eólica Extra p/ Meta (&le; {targetMaxPct.toFixed(1).replace('.', ',')}%)
            </p>
            <p className="text-2xl font-bold font-mono tabular-nums text-sky-800">
              {result.monteCarlo.requiredExtraWindGWForTargetRisk !== null
                ? `+${result.monteCarlo.requiredExtraWindGWForTargetRisk.toFixed(2)} GW`
                : '—'}
            </p>
            <p className="text-xs text-slate-600 tabular-nums">
              Convertido pelo CF firme em calmaria · LOLE:{' '}
              {result.monteCarlo.loleCriticalHoursYear !== null
                ? `${result.monteCarlo.loleCriticalHoursYear.toFixed(1)} h/ano`
                : '—'}
            </p>
          </div>
        </div>

        {/* Gráfico Multi-Escala (8.760 h reais ONS sem fallback sintético) */}
        <div className="pt-6 space-y-4">
          {!result.summary.hourlyBaselineAvailable ? (
            <div className="p-6 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-amber-950">
                  Série Base Horária Real de {cfg.hoursPerYear.toLocaleString('pt-BR')} h (
                  {hourlyBaselineStatus === 'loading' ? 'carregando...' : 'aguardando geração física em Python'})
                </h3>
                <span className="text-xs font-mono text-amber-800">{cfg.hourlyBaselineJsonUrl}</span>
              </div>
              <p className="text-xs text-amber-900 leading-relaxed">
                O simulador não gera curvas trigonométricas artificiais. Para habilitar o gráfico horário em tempo real
                das {cfg.hoursPerYear.toLocaleString('pt-BR')} horas de {cfg.projectionStartYear}–{cfg.targetEndYear} em
                todas as escalas (<span className="font-mono">Dia | Semana | Mês | Trimestre | Ano</span>), execute a
                esteira científica <span className="font-mono">python3 scripts/run_pipeline.py --skip-ingest</span> em
                ambiente com <span className="font-mono">numpy/pandas/scipy</span> para materializar{' '}
                <span className="font-mono">{cfg.hourlyBaselineJsonUrl}</span> e{' '}
                <span className="font-mono">reports/grade_simulador_monte_carlo_2025_2035.csv</span>.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-4">
                  {chartMode === 'margin' ? (
                    <>
                      <span className="font-medium text-slate-900">
                        Linha azul: Margem com Data Centers M(t){' '}
                        {windowLength > 365 ? '(média + envelope mín/máx horário)' : '(resolução horária)'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Tracejada cinza: Margem sem DCs</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-red-700 font-medium">
                        Vermelha: Limite importação (−{config.interchangeImportLimitMW.toLocaleString('pt-BR')} MW)
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-emerald-800">
                        Linha verde: Oferta horária G_{cfg.subsystemId}(t)
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-sky-900">Linha escura: Carga Total L_base + L_DC</span>
                      <span aria-hidden="true">·</span>
                      <span>Tracejada: Carga Base sem DCs</span>
                    </>
                  )}
                </div>
                {activePoint && (
                  <div className="font-mono text-xs text-slate-700 tabular-nums">
                    Hora inspecionada: <strong>{activePoint.timestampLabel}</strong> (#
                    {activePoint.hourOfYear + 1}/{cfg.hoursPerYear}h do ano)
                  </div>
                )}
              </div>

              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  role="img"
                  aria-label={`Gráfico horário (${result.windowSlice.windowLabel}) do balanço elétrico do ${cfg.subsystemId}`}
                  className="w-full h-auto min-w-[680px] select-none"
                >
                  {chartMode === 'margin' && (
                    <>
                      <rect
                        x={padLeft}
                        y={padTop}
                        width={plotW}
                        height={Math.max(0, exportLimitY - padTop)}
                        fill="#fef3c7"
                        fillOpacity="0.45"
                      />
                      <rect
                        x={padLeft}
                        y={Math.min(padTop + plotH, importLimitY)}
                        width={plotW}
                        height={Math.max(0, padTop + plotH - importLimitY)}
                        fill="#fee2e2"
                        fillOpacity="0.55"
                      />
                      <line x1={padLeft} y1={zeroY} x2={padLeft + plotW} y2={zeroY} stroke="#64748b" strokeWidth="1" />
                      <text x={padLeft - 8} y={zeroY + 4} textAnchor="end" className="fill-slate-600 text-[10px] font-mono">
                        0 MW
                      </text>

                      <line
                        x1={padLeft}
                        y1={exportLimitY}
                        x2={padLeft + plotW}
                        y2={exportLimitY}
                        stroke="#d97706"
                        strokeDasharray="4 4"
                        strokeWidth="1"
                      />
                      <text
                        x={padLeft + 6}
                        y={Math.max(padTop + 11, exportLimitY - 4)}
                        className="fill-amber-800 text-[10px] font-mono"
                      >
                        Excedente &gt; Escoamento (+{config.interchangeExportLimitMW} MW → Risco Curtailment)
                      </text>

                      <line
                        x1={padLeft}
                        y1={importLimitY}
                        x2={padLeft + plotW}
                        y2={importLimitY}
                        stroke="#dc2626"
                        strokeDasharray="5 3"
                        strokeWidth="1.4"
                      />
                      <text
                        x={padLeft + 6}
                        y={Math.min(padTop + plotH - 5, importLimitY + 12)}
                        className="fill-red-800 text-[10px] font-mono font-medium"
                      >
                        Limite Crítico Importação (−{config.interchangeImportLimitMW} MW)
                      </text>

                      {windowLength > 365 && (
                        <polygon fill="#0369a1" fillOpacity="0.14" points={buildEnvelopePolygon()} />
                      )}

                      <polyline
                        fill="none"
                        stroke="#94a3b8"
                        strokeWidth="1.4"
                        strokeDasharray="3 3"
                        points={buildBucketLine((b) => b.meanMarginWithoutDcMW, yForMargin)}
                      />
                      <polyline
                        fill="none"
                        stroke="#0369a1"
                        strokeWidth="2.1"
                        points={buildBucketLine((b) => b.meanMarginWithDcMW, yForMargin)}
                      />
                    </>
                  )}

                  {chartMode === 'supply_demand' && (
                    <>
                      {[0.25, 0.5, 0.75].map((frac) => {
                        const val = minPowerBound + frac * (maxPowerBound - minPowerBound);
                        const y = yForPower(val);
                        return (
                          <g key={frac}>
                            <line x1={padLeft} y1={y} x2={padLeft + plotW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                            <text x={padLeft - 8} y={y + 3} textAnchor="end" className="fill-slate-500 text-[10px] font-mono">
                              {(val / 1000).toFixed(1)} GW
                            </text>
                          </g>
                        );
                      })}

                      <polyline
                        fill="none"
                        stroke="#94a3b8"
                        strokeWidth="1.4"
                        strokeDasharray="3 3"
                        points={buildBucketLine((b) => b.meanBaseLoadMW, yForPower)}
                      />
                      <polyline
                        fill="none"
                        stroke="#0f172a"
                        strokeWidth="2"
                        points={buildBucketLine((b) => b.meanTotalLoadMW, yForPower)}
                      />
                      <polyline
                        fill="none"
                        stroke="#059669"
                        strokeWidth="2.1"
                        points={buildBucketLine((b) => b.meanTotalGenPotentialMW, yForPower)}
                      />
                    </>
                  )}

                  {xTicks.map((tk) => {
                    const x = xForFrac(tk.xFrac);
                    return (
                      <g key={`${tk.xFrac}-${tk.label}`}>
                        <line
                          x1={x}
                          y1={padTop}
                          x2={x}
                          y2={padTop + plotH}
                          stroke="#cbd5e1"
                          strokeOpacity="0.6"
                          strokeWidth="1"
                        />
                        <text x={x + 3} y={svgHeight - 10} className="fill-slate-500 text-[10px] font-mono">
                          {tk.label}
                        </text>
                      </g>
                    );
                  })}

                  {activePoint && (
                    <>
                      <line
                        x1={xForFrac(activePoint.windowHourIndex / Math.max(1, windowLength - 1))}
                        y1={padTop}
                        x2={xForFrac(activePoint.windowHourIndex / Math.max(1, windowLength - 1))}
                        y2={padTop + plotH}
                        stroke="#0f172a"
                        strokeWidth="1.2"
                      />
                      <circle
                        cx={xForFrac(activePoint.windowHourIndex / Math.max(1, windowLength - 1))}
                        cy={
                          chartMode === 'margin'
                            ? yForMargin(activePoint.marginWithDcMW)
                            : yForPower(activePoint.totalGenPotentialMW)
                        }
                        r="4.5"
                        fill="#0369a1"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                    </>
                  )}

                  <rect x={padLeft} y={padTop} width={plotW} height={plotH} fill="none" stroke="#cbd5e1" strokeWidth="1" />
                </svg>
              </div>

              {activePoint && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <label htmlFor="range-inspect-hour" className="text-xs font-medium text-slate-700 whitespace-nowrap">
                      Inspecionar hora na janela (0–{Math.max(0, windowLength - 1)}):
                    </label>
                    <input
                      id="range-inspect-hour"
                      type="range"
                      min={0}
                      max={Math.max(0, windowLength - 1)}
                      value={inspectedHour}
                      onChange={(e) => setInspectedHour(Number(e.target.value))}
                      className="w-full accent-slate-900 cursor-pointer"
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-1 text-xs tabular-nums">
                    <div>
                      <span className="text-slate-500 block">Instante ({config.targetYear})</span>
                      <span className="font-mono font-semibold text-slate-900">{activePoint.timestampLabel}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Carga Base + DCs</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {activePoint.baseLoadMW.toLocaleString('pt-BR')} + {activePoint.dcLoadMW.toLocaleString('pt-BR')}{' '}
                        MW
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">
                        Eólica (CF {Math.round(activePoint.windCapacityFactor * 100)}%)
                      </span>
                      <span className="font-mono font-semibold text-slate-900">
                        {activePoint.windGenPotentialMW.toLocaleString('pt-BR')} MW
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Solar + Chesf Desp.</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {(activePoint.solarGenMW + activePoint.otherDispatchableMW).toLocaleString('pt-BR')} MW
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Margem M(t)</span>
                      <span
                        className={`font-mono font-semibold ${
                          activePoint.marginWithDcMW < 0 ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {activePoint.marginWithDcMW > 0 ? '+' : ''}
                        {activePoint.marginWithDcMW.toLocaleString('pt-BR')} MW
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Diagnóstico Operativo</span>
                      <span className="font-medium text-slate-900">
                        {activePoint.exceedsImportLimit
                          ? 'Déficit > Intercâmbio!'
                          : activePoint.marginWithDcMW < 0
                            ? 'Importando do SIN'
                            : activePoint.curtailmentWithDcMW > 0
                              ? `Curtailment (${activePoint.curtailmentWithDcMW} MW)`
                              : 'Exportando normal'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Seção 3: Entrega Executiva Final (Passos 4 e 5) */}
      <section aria-labelledby="heading-exec-mc2035" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
              Passos 04 & 05 Concluídos · Entrega Executiva Final (06_monte_carlo + 07_sensitivity_and_final_report.py)
            </p>
            <h2 id="heading-exec-mc2035" className="text-xl font-bold text-slate-900 mt-0.5">
              Síntese Monte Carlo {cfg.targetEndYear}, Expansão da Transmissão & Sinergia com Hidrogênio Verde (H2V)
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Comparativo direto em {cfg.targetEndYear} para a trajetória eólica Intermediária SIGA (
              {(ssotSummary.intermWindMW / 1000).toFixed(1).replace('.', ',')} GW instalados) frente aos 4 cenários de
              Data Centers e às sensibilidades de rede do Passo 5.
            </p>
          </div>
          {onNavigateToModels && (
            <button
              type="button"
              onClick={onNavigateToModels}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors sm:whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto text-left"
            >
              Explorar Passo 5, {ssot.monteCarlo12Scenarios2035.length} Cenários & Relatório (.md) →
            </button>
          )}
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                <th className="py-3 pr-3">Cenário de Data Centers ({cfg.targetEndYear})</th>
                <th className="py-3 px-3 font-mono">Carga Firme Rede</th>
                <th className="py-3 px-3 font-mono">Parque Eólico (SIGA)</th>
                <th className="py-3 px-3 font-mono">
                  Risco P(Import &gt; {(cfg.interchangeImportLimitMW / 1000).toFixed(0)} GW)
                </th>
                <th className="py-3 px-3 font-mono">Importação P95</th>
                <th className="py-3 px-3 font-mono">Curtailment Absorvido</th>
                <th className="py-3 pl-3 font-mono">Expansão Eólica Compensatória</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {ssotSummary.mcInterm.map((s) => (
                <tr
                  key={s.scenarioName}
                  className={s.dcScenarioId === refs.dcCentral ? 'bg-sky-50/50' : 'hover:bg-slate-50'}
                >
                  <td className="py-3.5 pr-3 font-semibold text-slate-900 whitespace-nowrap">{s.scenarioName}</td>
                  <td className="py-3.5 px-3 font-mono text-slate-800 whitespace-nowrap">
                    {s.dcLoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} MW
                  </td>
                  <td className="py-3.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                    {(s.windCapacityMW / 1000).toFixed(1)} GW
                  </td>
                  <td
                    className={`py-3.5 px-3 font-mono font-bold whitespace-nowrap ${
                      s.probExceedInterchangePct >= badges.highRiskPct
                        ? 'text-red-700'
                        : s.probExceedInterchangePct > badges.lowRiskPct
                          ? 'text-amber-700'
                          : 'text-emerald-800'
                    }`}
                  >
                    {s.probExceedInterchangePct.toFixed(1)}% ({s.loleCriticalHoursYear.toFixed(0)} h/ano)
                  </td>
                  <td className="py-3.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {s.importP95MW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW
                  </td>
                  <td className="py-3.5 px-3 font-mono font-semibold text-emerald-800 whitespace-nowrap">
                    {s.curtailmentAvoidedGWh > 0
                      ? `−${(s.curtailmentAvoidedGWh / 1000).toFixed(2)} TWh/ano`
                      : `Referência (${s.curtailmentWithDcTWh.toFixed(2)} TWh)`}
                  </td>
                  <td className="py-3.5 pl-3 font-mono font-bold text-sky-900 whitespace-nowrap">
                    {s.compensatoryWindExpansionGW > 0
                      ? `+${s.compensatoryWindExpansionGW.toFixed(2)} GW extras`
                      : '0,00 GW (Dentro da meta)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4 tabular-nums">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-800 block">
              Passo 5 · Expansão da Transmissão ({ssotSummary.tx04?.configId.split(' ')[0] ?? 'TX'} /{' '}
              {ssotSummary.tx05?.configId.split(' ')[0] ?? 'TX'})
            </span>
            <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">
              A entrada das novas LTs 500 kV e Bipolo HVDC (elevando o limite de importação para{' '}
              <strong>
                {ssotSummary.tx04 && ssotSummary.tx05
                  ? `${(ssotSummary.tx04.importLimitMW / 1000).toFixed(1).replace('.', ',')}–${(ssotSummary.tx05.importLimitMW / 1000).toFixed(1).replace('.', ',')} GW`
                  : '—'}
              </strong>{' '}
              e exportação para{' '}
              <strong>
                {ssotSummary.tx04 && ssotSummary.tx05
                  ? `${(ssotSummary.tx04.exportLimitMW / 1000).toFixed(1).replace('.', ',')}–${(ssotSummary.tx05.exportLimitMW / 1000).toFixed(1).replace('.', ',')} GW`
                  : '—'}
              </strong>
              ) reduz o requisito de expansão eólica compensatória de{' '}
              <strong>
                {ssotSummary.mcCentral
                  ? `+${ssotSummary.mcCentral.compensatoryWindExpansionGW.toFixed(2).replace('.', ',')} GW`
                  : '—'}
              </strong>{' '}
              para{' '}
              <strong>
                {ssotSummary.tx04
                  ? `+${ssotSummary.tx04.compensatoryWindGW.toFixed(2).replace('.', ',')} GW`
                  : '—'}
              </strong>{' '}
              ou{' '}
              <strong>
                {ssotSummary.tx05 ? `${ssotSummary.tx05.compensatoryWindGW.toFixed(2).replace('.', ',')} GW` : '—'}
              </strong>
              .
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 block">
              Passo 5 · Disputa vs. Sinergia H2V ({cfg.pecemSubstationName} & {ui.secondarySubstationFocus})
            </span>
            <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">
              Se {(cfg.defaultH2vComparisonMW / 1000).toFixed(1).replace('.', ',')} GW de H2V operarem inflexíveis 24/7
              junto aos DCs, o risco crítico salta para{' '}
              <strong>
                {ssotSummary.h2v2Inflex
                  ? `${ssotSummary.h2v2Inflex.probCriticalImportPct.toFixed(2).replace('.', ',')}%`
                  : '—'}
              </strong>{' '}
              (
              {ssotSummary.h2v2Inflex
                ? `+${ssotSummary.h2v2Inflex.compensatoryWindGW.toFixed(2).replace('.', ',')} GW`
                : '—'}{' '}
              eólicos). Com{' '}
              <strong>modulação flexível ({Math.round(cfg.h2vFlex.flexLowFactor * 100)}% na calmaria)</strong>, o H2V
              absorve{' '}
              <strong>
                {ssotSummary.h2v2Flex
                  ? `${ssotSummary.h2v2Flex.totalAbsorbedCurtailmentTWh.toFixed(2).replace('.', ',')} TWh/ano`
                  : '—'}
              </strong>{' '}
              de <em>curtailment</em> mantendo o risco em{' '}
              <strong>
                {ssotSummary.h2v2Flex
                  ? `${ssotSummary.h2v2Flex.probCriticalImportPct.toFixed(2).replace('.', ',')}%`
                  : '—'}
              </strong>
              .
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-800 block">
              Passo 5 · Capacidade ANEEL vs. Geração Efetiva ONS
            </span>
            <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">
              Em {cfg.baselineYear}, a fonte eólica representou{' '}
              <strong>
                {ssotSummary.ind2025
                  ? `${ssotSummary.ind2025.aneelInstalledSharePct.toFixed(2).replace('.', ',')}%`
                  : '—'}{' '}
                da capacidade instalada
              </strong>{' '}
              no {cfg.subsystemId} (ANEEL), mas entregou{' '}
              <strong>
                {ssotSummary.ind2025
                  ? `${ssotSummary.ind2025.onsEffectiveGenSharePct.toFixed(2).replace('.', ',')}%`
                  : '—'}{' '}
                da geração elétrica efetiva
              </strong>{' '}
              (ONS), apesar da perda de{' '}
              <strong>
                {ssotSummary.ind2025
                  ? (ssotSummary.ind2025.potentialUnconstrainedCfPct - ssotSummary.ind2025.onsEffectiveCfPct)
                      .toFixed(2)
                      .replace('.', ',')
                  : '—'}{' '}
                p.p. de fator de capacidade
              </strong>{' '}
              por <em>constrained-off</em> (
              {ssotSummary.ind2025
                ? `${ssotSummary.ind2025.annualCurtailmentLossTWh.toFixed(2).replace('.', ',')} TWh`
                : '—'}
              ).
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
