import React, { useMemo } from 'react';
import {
  buildHourlyPlotBuckets,
  type EvaluationSummary,
  type HourlyPoint,
  type MonteCarloSummary,
  type SimulationConfig,
  type WindowSliceResult,
} from '../utils/energyModel';
import type { PipelineConfigSnapshot, PipelineUiCatalog } from '../data/pipelineTypes';
import type { HourlyBaselineStatus } from '../data/pipelineSsotContext';

export type SimulatorChartMode = 'margin' | 'supply_demand';

interface SimulatorHourlyChartSectionProps {
  config: SimulationConfig;
  cfg: PipelineConfigSnapshot;
  ui: PipelineUiCatalog;
  chartMode: SimulatorChartMode;
  summary: EvaluationSummary;
  monteCarlo: MonteCarloSummary;
  windowSlice: WindowSliceResult;
  hourlyBaselineStatus: HourlyBaselineStatus;
  inspectedHour: number;
  onChangeInspectedHour: (hour: number) => void;
}

export const SimulatorHourlyChartSection: React.FC<SimulatorHourlyChartSectionProps> = ({
  config,
  cfg,
  ui,
  chartMode,
  summary,
  monteCarlo,
  windowSlice,
  hourlyBaselineStatus,
  inspectedHour,
  onChangeInspectedHour,
}) => {
  const badges = cfg.uiThresholds.sensitivityBadges;
  const targetMaxPct = cfg.uiThresholds.targetImportProbMaxPct;
  const hourlySeries = windowSlice.points;
  const windowLength = hourlySeries.length;
  const activePoint: HourlyPoint | undefined = hourlySeries[inspectedHour] ?? hourlySeries[0];

  const mcSourceLabel =
    monteCarlo.sourceStatus === 'grid_exact'
      ? 'Monte Carlo Python (Ponto Exato da Grade)'
      : monteCarlo.sourceStatus === 'grid_interpolated'
        ? 'Monte Carlo Python (Interpolado na Grade)'
        : monteCarlo.sourceStatus === 'ssot_anchor'
          ? 'Monte Carlo Python (Âncora Oficial SSOT)'
          : 'Grade Monte Carlo indisponível para esta combinação fora das âncoras';

  const svgWidth = 880;
  const svgHeight = 290;
  const padLeft = 58;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 34;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  // Pré-calcula buckets e strings de polylines SVG apenas quando a janela/parâmetros mudam,
  // mantendo a varredura de `inspectedHour` estritamente O(1) sem re-processar 8.760 h ou polylines.
  const chartGeometry = useMemo(() => {
    const plotBuckets = buildHourlyPlotBuckets(hourlySeries, 365);
    const xForFrac = (frac: number) => padLeft + frac * plotW;

    const minSeriesMargin = summary.minMarginMW ?? -config.interchangeImportLimitMW;
    const maxSeriesMargin = summary.maxMarginMW ?? config.interchangeExportLimitMW;
    const marginSpan = Math.max(2000, maxSeriesMargin - minSeriesMargin);
    const marginPad = marginSpan * cfg.uiThresholds.chartPaddingRatio;
    const marginMinBound = Math.min(-config.interchangeImportLimitMW - marginPad, minSeriesMargin - marginPad);
    const marginMaxBound = Math.max(config.interchangeExportLimitMW + marginPad, maxSeriesMargin + marginPad);
    const marginRange = Math.max(1, marginMaxBound - marginMinBound);
    const yForMargin = (val: number) => padTop + ((marginMaxBound - val) / marginRange) * plotH;

    let rawPowerMax = -Infinity;
    let rawPowerMin = Infinity;
    for (let i = 0; i < hourlySeries.length; i++) {
      const pt = hourlySeries[i];
      if (pt.totalGenPotentialMW > rawPowerMax) rawPowerMax = pt.totalGenPotentialMW;
      if (pt.totalLoadMW > rawPowerMax) rawPowerMax = pt.totalLoadMW;
      if (pt.baseLoadMW > rawPowerMax) rawPowerMax = pt.baseLoadMW;
      if (pt.totalGenPotentialMW < rawPowerMin) rawPowerMin = pt.totalGenPotentialMW;
      if (pt.totalLoadMW < rawPowerMin) rawPowerMin = pt.totalLoadMW;
      if (pt.baseLoadMW < rawPowerMin) rawPowerMin = pt.baseLoadMW;
    }
    if (!Number.isFinite(rawPowerMax)) rawPowerMax = cfg.interchangeExportLimitMW * 2;
    if (!Number.isFinite(rawPowerMin)) rawPowerMin = 0;

    const powerSpan = Math.max(2000, rawPowerMax - rawPowerMin);
    const maxPowerBound = rawPowerMax + powerSpan * cfg.uiThresholds.chartPaddingRatio;
    const minPowerBound = Math.max(0, rawPowerMin - powerSpan * cfg.uiThresholds.chartPaddingRatio);
    const powerRange = Math.max(1, maxPowerBound - minPowerBound);
    const yForPower = (val: number) => padTop + ((maxPowerBound - val) / powerRange) * plotH;

    const nBuckets = plotBuckets.length;
    const marginWithoutDcPts = new Array<string>(nBuckets);
    const marginWithDcPts = new Array<string>(nBuckets);
    const baseLoadPts = new Array<string>(nBuckets);
    const totalLoadPts = new Array<string>(nBuckets);
    const totalGenPts = new Array<string>(nBuckets);
    const envelopeUpper = new Array<string>(nBuckets);
    const envelopeLower = new Array<string>(nBuckets);

    for (let i = 0; i < nBuckets; i++) {
      const b = plotBuckets[i];
      const xStr = xForFrac(b.xFrac).toFixed(1);
      marginWithoutDcPts[i] = `${xStr},${yForMargin(b.meanMarginWithoutDcMW).toFixed(1)}`;
      marginWithDcPts[i] = `${xStr},${yForMargin(b.meanMarginWithDcMW).toFixed(1)}`;
      baseLoadPts[i] = `${xStr},${yForPower(b.meanBaseLoadMW).toFixed(1)}`;
      totalLoadPts[i] = `${xStr},${yForPower(b.meanTotalLoadMW).toFixed(1)}`;
      totalGenPts[i] = `${xStr},${yForPower(b.meanTotalGenPotentialMW).toFixed(1)}`;
      envelopeUpper[i] = `${xStr},${yForMargin(b.maxMarginWithDcMW).toFixed(1)}`;
      envelopeLower[nBuckets - 1 - i] = `${xStr},${yForMargin(b.minMarginWithDcMW).toFixed(1)}`;
    }

    const n = hourlySeries.length;
    const denom = Math.max(1, n - 1);
    let xTicks: Array<{ xFrac: number; label: string }> = [];
    if (n > 0) {
      if (config.observationWindow === 'day') {
        xTicks = [0, 3, 6, 9, 12, 15, 18, 21, 23]
          .filter((h) => h < n)
          .map((h) => ({ xFrac: h / denom, label: `${String(h).padStart(2, '0')}h` }));
      } else if (config.observationWindow === 'week') {
        for (let d = 0; d < 7 && d * cfg.hoursPerDay < n; d++) {
          const idx = d * cfg.hoursPerDay;
          xTicks.push({
            xFrac: idx / denom,
            label: hourlySeries[idx]?.timestampLabel.split(' · ')[0] ?? `D+${d + 1}`,
          });
        }
      } else if (config.observationWindow === 'month') {
        for (let i = 0; i < n; i += cfg.hoursPerDay * 5) {
          xTicks.push({
            xFrac: i / denom,
            label: hourlySeries[i]?.timestampLabel.split(' · ')[0] ?? `${i}h`,
          });
        }
      } else {
        const seenMonths = new Set<number>();
        for (let i = 0; i < n; i++) {
          const m = hourlySeries[i].month;
          if (!seenMonths.has(m)) {
            seenMonths.add(m);
            xTicks.push({
              xFrac: i / denom,
              label: ui.monthShortNames[m - 1] ?? `M${m}`,
            });
          }
        }
      }
    }

    return {
      marginWithoutDcLine: marginWithoutDcPts.join(' '),
      marginWithDcLine: marginWithDcPts.join(' '),
      baseLoadLine: baseLoadPts.join(' '),
      totalLoadLine: totalLoadPts.join(' '),
      totalGenLine: totalGenPts.join(' '),
      envelopePolygon: nBuckets > 0 ? `${envelopeUpper.join(' ')} ${envelopeLower.join(' ')}` : '',
      zeroY: yForMargin(0),
      importLimitY: yForMargin(-config.interchangeImportLimitMW),
      exportLimitY: yForMargin(config.interchangeExportLimitMW),
      minPowerBound,
      maxPowerBound,
      marginMaxBound,
      marginRange,
      powerRange,
      xTicks,
    };
  }, [
    hourlySeries,
    summary.minMarginMW,
    summary.maxMarginMW,
    config.interchangeImportLimitMW,
    config.interchangeExportLimitMW,
    config.observationWindow,
    cfg.uiThresholds.chartPaddingRatio,
    cfg.hoursPerDay,
    ui.monthShortNames,
    plotW,
    plotH,
  ]);

  const activeX = activePoint
    ? padLeft + (activePoint.windowHourIndex / Math.max(1, windowLength - 1)) * plotW
    : padLeft;
  const activeY = activePoint
    ? chartMode === 'margin'
      ? padTop + ((chartGeometry.marginMaxBound - activePoint.marginWithDcMW) / chartGeometry.marginRange) * plotH
      : padTop + ((chartGeometry.maxPowerBound - activePoint.totalGenPotentialMW) / chartGeometry.powerRange) * plotH
    : padTop;

  return (
    <>
      {/* Faixa de 4 Indicadores Principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 py-6 border-b border-slate-200">
        <div className="pb-4 sm:pb-0 sm:pr-6 space-y-1">
          <p className="text-xs text-slate-500">Risco Anual Importação &gt; Limite ({mcSourceLabel})</p>
          <p
            className={`text-2xl font-bold font-mono tabular-nums ${
              monteCarlo.probCriticalImportAnnualPct === null
                ? 'text-slate-500'
                : monteCarlo.probCriticalImportAnnualPct >= badges.highRiskPct
                  ? 'text-red-700'
                  : monteCarlo.probCriticalImportAnnualPct > badges.lowRiskPct
                    ? 'text-amber-700'
                    : 'text-emerald-700'
            }`}
          >
            {monteCarlo.probCriticalImportAnnualPct !== null
              ? `${monteCarlo.probCriticalImportAnnualPct.toFixed(1)}%`
              : '—'}
          </p>
          <p className="text-xs text-slate-600 tabular-nums">
            {monteCarlo.probCriticalImportAnnualPct !== null
              ? `${monteCarlo.probCriticalWithoutDcPct !== null ? `Sem DCs: ${monteCarlo.probCriticalWithoutDcPct.toFixed(1)}% · ` : ''}${
                  monteCarlo.probCriticalImportAnnualPct >= badges.highRiskPct
                    ? 'Alerta crítico de intercâmbio'
                    : monteCarlo.probCriticalImportAnnualPct > badges.lowRiskPct
                      ? 'Atenção moderada'
                      : 'Dentro da meta segura SIN'
                }`
              : 'Aguardando grade MC Python p/ esta combinação'}
          </p>
        </div>

        <div className="py-4 sm:py-0 sm:px-6 space-y-1">
          <p className="text-xs text-slate-500">Importação Máxima P95 (Monte Carlo)</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {monteCarlo.p95PeakImportMW !== null ? `${monteCarlo.p95PeakImportMW.toLocaleString('pt-BR')} MW` : '—'}
          </p>
          <p className="text-xs text-slate-600 tabular-nums">
            {monteCarlo.p50PeakImportMW !== null
              ? `Mediana P50: ${monteCarlo.p50PeakImportMW.toLocaleString('pt-BR')} MW`
              : 'P50 N/D'}{' '}
            · M(t)&lt;0 no ano:{' '}
            {summary.negativeMarginHoursYear !== null ? `${summary.negativeMarginHoursYear.toLocaleString('pt-BR')}h` : '—'}
          </p>
        </div>

        <div className="py-4 sm:py-0 sm:px-6 space-y-1">
          <p className="text-xs text-slate-500">Curtailment Eólico Anual vs. Absorvido</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {monteCarlo.expectedCurtailmentWithDcTWh !== null
              ? `${monteCarlo.expectedCurtailmentWithDcTWh.toFixed(2)} TWh/ano`
              : summary.annualCurtailmentWithDcTWh !== null
                ? `${summary.annualCurtailmentWithDcTWh.toFixed(2)} TWh/ano`
                : '—'}
          </p>
          <p className="text-xs text-slate-600 tabular-nums">
            {monteCarlo.curtailmentAvoidedByDcGWh !== null
              ? `Absorção DC (MC): −${monteCarlo.curtailmentAvoidedByDcGWh.toLocaleString('pt-BR')} GWh/ano`
              : summary.windowCurtailmentWithDcGWh !== null
                ? `Na janela ativa: ${summary.windowCurtailmentWithDcGWh.toLocaleString('pt-BR')} GWh`
                : 'Aguardando série 8.760 h'}
          </p>
        </div>

        <div className="pt-4 sm:pt-0 sm:pl-6 space-y-1">
          <p className="text-xs text-slate-500">
            Expansão Eólica Extra p/ Meta (&le; {targetMaxPct.toFixed(1).replace('.', ',')}%)
          </p>
          <p className="text-2xl font-bold font-mono tabular-nums text-sky-800">
            {monteCarlo.requiredExtraWindGWForTargetRisk !== null
              ? `+${monteCarlo.requiredExtraWindGWForTargetRisk.toFixed(2)} GW`
              : '—'}
          </p>
          <p className="text-xs text-slate-600 tabular-nums">
            Convertido pelo CF firme em calmaria · LOLE:{' '}
            {monteCarlo.loleCriticalHoursYear !== null ? `${monteCarlo.loleCriticalHoursYear.toFixed(1)} h/ano` : '—'}
          </p>
        </div>
      </div>

      {/* Gráfico Multi-Escala (8.760 h reais ONS sem fallback sintético) */}
      <div className="pt-6 space-y-4">
        {!summary.hourlyBaselineAvailable ? (
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
                aria-label={`Gráfico horário (${windowSlice.windowLabel}) do balanço elétrico do ${cfg.subsystemId}`}
                className="w-full h-auto min-w-[680px] select-none"
              >
                {chartMode === 'margin' && (
                  <>
                    <rect
                      x={padLeft}
                      y={padTop}
                      width={plotW}
                      height={Math.max(0, chartGeometry.exportLimitY - padTop)}
                      fill="#fef3c7"
                      fillOpacity="0.45"
                    />
                    <rect
                      x={padLeft}
                      y={Math.min(padTop + plotH, chartGeometry.importLimitY)}
                      width={plotW}
                      height={Math.max(0, padTop + plotH - chartGeometry.importLimitY)}
                      fill="#fee2e2"
                      fillOpacity="0.55"
                    />
                    <line
                      x1={padLeft}
                      y1={chartGeometry.zeroY}
                      x2={padLeft + plotW}
                      y2={chartGeometry.zeroY}
                      stroke="#64748b"
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={chartGeometry.zeroY + 4}
                      textAnchor="end"
                      className="fill-slate-600 text-[10px] font-mono"
                    >
                      0 MW
                    </text>

                    <line
                      x1={padLeft}
                      y1={chartGeometry.exportLimitY}
                      x2={padLeft + plotW}
                      y2={chartGeometry.exportLimitY}
                      stroke="#d97706"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft + 6}
                      y={Math.max(padTop + 11, chartGeometry.exportLimitY - 4)}
                      className="fill-amber-800 text-[10px] font-mono"
                    >
                      Excedente &gt; Escoamento (+{config.interchangeExportLimitMW} MW → Risco Curtailment)
                    </text>

                    <line
                      x1={padLeft}
                      y1={chartGeometry.importLimitY}
                      x2={padLeft + plotW}
                      y2={chartGeometry.importLimitY}
                      stroke="#dc2626"
                      strokeDasharray="5 3"
                      strokeWidth="1.4"
                    />
                    <text
                      x={padLeft + 6}
                      y={Math.min(padTop + plotH - 5, chartGeometry.importLimitY + 12)}
                      className="fill-red-800 text-[10px] font-mono font-medium"
                    >
                      Limite Crítico Importação (−{config.interchangeImportLimitMW} MW)
                    </text>

                    {windowLength > 365 && chartGeometry.envelopePolygon && (
                      <polygon fill="#0369a1" fillOpacity="0.14" points={chartGeometry.envelopePolygon} />
                    )}

                    <polyline
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="1.4"
                      strokeDasharray="3 3"
                      points={chartGeometry.marginWithoutDcLine}
                    />
                    <polyline
                      fill="none"
                      stroke="#0369a1"
                      strokeWidth="2.1"
                      points={chartGeometry.marginWithDcLine}
                    />
                  </>
                )}

                {chartMode === 'supply_demand' && (
                  <>
                    {[0.25, 0.5, 0.75].map((frac) => {
                      const val =
                        chartGeometry.minPowerBound + frac * (chartGeometry.maxPowerBound - chartGeometry.minPowerBound);
                      const y = padTop + ((chartGeometry.maxPowerBound - val) / chartGeometry.powerRange) * plotH;
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
                      points={chartGeometry.baseLoadLine}
                    />
                    <polyline
                      fill="none"
                      stroke="#0f172a"
                      strokeWidth="2"
                      points={chartGeometry.totalLoadLine}
                    />
                    <polyline
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2.1"
                      points={chartGeometry.totalGenLine}
                    />
                  </>
                )}

                {chartGeometry.xTicks.map((tk) => {
                  const x = padLeft + tk.xFrac * plotW;
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
                      x1={activeX}
                      y1={padTop}
                      x2={activeX}
                      y2={padTop + plotH}
                      stroke="#0f172a"
                      strokeWidth="1.2"
                    />
                    <circle cx={activeX} cy={activeY} r="4.5" fill="#0369a1" stroke="#ffffff" strokeWidth="1.5" />
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
                    onChange={(e) => onChangeInspectedHour(Number(e.target.value))}
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
                      {activePoint.baseLoadMW.toLocaleString('pt-BR')} + {activePoint.dcLoadMW.toLocaleString('pt-BR')} MW
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
                    <span className="text-slate-500 block">Solar + Chesf (Sazonal)</span>
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
    </>
  );
};
