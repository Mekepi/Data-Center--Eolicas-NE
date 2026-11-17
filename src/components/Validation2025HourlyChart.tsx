import React, { useMemo, useState } from 'react';
import type { HourlyValidation2025Point, PipelineConfigSnapshot } from '../data/pipelineTypes';
import type { FeaturesAnovaKpis } from './featuresAnovaKpis';

type ValidationChartMetric = 'load_mw' | 'wind_cf' | 'curtailment_mw';

interface Validation2025HourlyChartProps {
  cfg: PipelineConfigSnapshot;
  testHours: number;
  hourly2025: HourlyValidation2025Point[];
  kpis: FeaturesAnovaKpis;
  downloadFeedback: string | null;
  onExportBenchmarks: () => void;
}

function computeDomain(
  values: number[],
  paddingRatio: number,
  floorZero = false,
  minFloor?: number,
  maxCeil?: number
): [number, number] {
  if (values.length === 0) return [0, 1];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(1e-3, rawMax - rawMin);
  const pad = span * paddingRatio;
  let lo = floorZero ? 0 : rawMin - pad;
  let hi = rawMax + pad;
  if (minFloor !== undefined) lo = Math.max(minFloor, lo);
  if (maxCeil !== undefined) hi = Math.min(maxCeil, hi);
  if (hi <= lo) hi = lo + 1;
  return [lo, hi];
}

export const Validation2025HourlyChart: React.FC<Validation2025HourlyChartProps> = ({
  cfg,
  testHours,
  hourly2025,
  kpis,
  downloadFeedback,
  onExportBenchmarks,
}) => {
  const padRatio = cfg.uiThresholds.chartPaddingRatio;
  const [valChartMetric, setValChartMetric] = useState<ValidationChartMetric>('load_mw');

  const svgW = 860;
  const svgH = 260;
  const padL = 56;
  const padR = 24;
  const padT = 20;
  const padB = 34;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const maxHour = Math.max(1, cfg.hoursPerDay - 1);

  const chartData = useMemo(() => {
    const loadVals = hourly2025.flatMap((p) => [p.realLoadMW, p.predLoadNonLinearMW]);
    const windVals = hourly2025.flatMap((p) => [p.realWindCfPct, p.predWindCfNonLinearPct]);
    const curtVals = hourly2025.flatMap((p) => [
      p.realSolarMW,
      p.realCurtailmentMW,
      p.predCurtailmentNonLinearMW,
      p.predCurtailmentLinearMW,
    ]);
    const domains = {
      load: computeDomain(loadVals, padRatio, false, 0),
      wind: computeDomain(windVals, padRatio, false, 0, 100),
      curt: computeDomain(curtVals, padRatio, true),
    };

    const buildPts = (getter: (pt: HourlyValidation2025Point) => number, [minV, maxV]: [number, number]) => {
      const denom = Math.max(1e-6, maxV - minV);
      return hourly2025
        .map((pt) => {
          const x = padL + (pt.hour / maxHour) * plotW;
          const y = padT + ((maxV - getter(pt)) / denom) * plotH;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    };

    return {
      domains,
      loadRealLine: buildPts((p) => p.realLoadMW, domains.load),
      loadPredLine: buildPts((p) => p.predLoadNonLinearMW, domains.load),
      windRealLine: buildPts((p) => p.realWindCfPct, domains.wind),
      windPredLine: buildPts((p) => p.predWindCfNonLinearPct, domains.wind),
      curtSolarLine: buildPts((p) => p.realSolarMW, domains.curt),
      curtRealLine: buildPts((p) => p.realCurtailmentMW, domains.curt),
      curtPredNonLinLine: buildPts((p) => p.predCurtailmentNonLinearMW, domains.curt),
      curtPredLinLine: buildPts((p) => p.predCurtailmentLinearMW, domains.curt),
    };
  }, [hourly2025, padRatio, maxHour, plotW, plotH]);

  const activeDomain =
    valChartMetric === 'load_mw'
      ? chartData.domains.load
      : valChartMetric === 'wind_cf'
        ? chartData.domains.wind
        : chartData.domains.curt;

  const xForH = (h: number) => padL + (h / maxHour) * plotW;

  return (
    <section aria-labelledby="heading-hourly-2025" className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
            Diagnóstico Histórico Empírico · Teste Cego {cfg.baselineYear} (Sem Dados de {cfg.targetEndYear})
          </p>
          <h2 id="heading-hourly-2025" className="text-lg font-bold text-slate-900 mt-0.5">
            Perfil Horário Médio de {cfg.baselineYear}: Verificado ONS vs. Previsto Out-of-Time (
            {testHours.toLocaleString('pt-BR')} horas)
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Comparação direta entre os valores reais medidos pelo ONS em {cfg.baselineYear} e a previsão cega dos
            modelos treinados de {cfg.historyStartYear} a {cfg.historyEndYear - 1}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="tablist"
            aria-label="Métrica de validação histórica 2025"
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
          >
            <button
              type="button"
              role="tab"
              aria-selected={valChartMetric === 'load_mw'}
              onClick={() => setValChartMetric('load_mw')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                valChartMetric === 'load_mw' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Modelo A · Carga (MW)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={valChartMetric === 'wind_cf'}
              onClick={() => setValChartMetric('wind_cf')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                valChartMetric === 'wind_cf' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Modelo B · CF Eólico (%)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={valChartMetric === 'curtailment_mw'}
              onClick={() => setValChartMetric('curtailment_mw')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                valChartMetric === 'curtailment_mw'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Modelo C · Curtailment (MW)
            </button>
          </div>

          <button
            type="button"
            onClick={onExportBenchmarks}
            className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {downloadFeedback ?? `Exportar Métricas ${cfg.baselineYear} (.csv)`}
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-5">
            {valChartMetric === 'load_mw' && (
              <>
                <span className="font-semibold text-slate-900">
                  Linha sólida escura: Carga Real ONS {cfg.baselineYear} (MW)
                </span>
                <span className="font-semibold text-sky-700">
                  Tracejada azul: Previsão Não-Linear {kpis.nonLinearArchLabel} (MAPE{' '}
                  {kpis.a1h ? `${kpis.a1h.mapePct.toFixed(2).replace('.', ',')}%` : '—'})
                </span>
              </>
            )}
            {valChartMetric === 'wind_cf' && (
              <>
                <span className="font-semibold text-slate-900">
                  Linha sólida escura: CF Potencial Real {cfg.baselineYear} (%)
                </span>
                <span className="font-semibold text-emerald-700">
                  Tracejada verde: Previsão Não-Linear {kpis.nonLinearArchLabel} (R² ={' '}
                  {kpis.b1h ? kpis.b1h.r2Score.toFixed(4).replace('.', ',') : '—'})
                </span>
              </>
            )}
            {valChartMetric === 'curtailment_mw' && (
              <>
                <span className="font-semibold text-rose-700">
                  Linha sólida vermelha: Curtailment Real ONS {cfg.baselineYear} (MWmed)
                </span>
                <span className="font-semibold text-slate-900">
                  Tracejada escura: Curtailment Predito Não-Linear (
                  {kpis.cBest ? kpis.cBest.architecture : kpis.nonLinearArchLabel})
                </span>
                <span className="text-sky-700">Pontilhada azul: Baseline Linear Hurdle</span>
                <span className="text-amber-600">Linha âmbar: Geração Solar Horária {cfg.baselineYear} (MW)</span>
              </>
            )}
          </div>
          <span className="font-mono text-slate-500">
            Média horária das {testHours.toLocaleString('pt-BR')}h de {cfg.baselineYear} (00h–
            {String(maxHour).padStart(2, '0')}h)
          </span>
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            role="img"
            aria-label={`Perfil horário médio de ${cfg.baselineYear} comparando valores verificados pelo ONS e predições cegas`}
            className="w-full h-auto min-w-[660px] select-none"
          >
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const y = padT + frac * plotH;
              const [lo, hi] = activeDomain;
              const v = hi - frac * (hi - lo);
              const label = valChartMetric === 'wind_cf' ? `${v.toFixed(1)}%` : `${(v / 1000).toFixed(1)} GW`;
              return (
                <g key={frac}>
                  <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                  <text x={padL - 8} y={y + 3} textAnchor="end" className="fill-slate-500 text-[10px] font-mono">
                    {label}
                  </text>
                </g>
              );
            })}

            {[0, 3, 6, 9, 12, 15, 18, 21, maxHour].map((h) => {
              const x = xForH(h);
              return (
                <g key={h}>
                  <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="#f1f5f9" strokeWidth="1" />
                  <text x={x} y={svgH - 10} textAnchor="middle" className="fill-slate-500 text-[10px] font-mono">
                    {String(h).padStart(2, '0')}h
                  </text>
                </g>
              );
            })}

            {valChartMetric === 'load_mw' && (
              <>
                <polyline fill="none" stroke="#0f172a" strokeWidth="2.4" points={chartData.loadRealLine} />
                <polyline
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth="2"
                  strokeDasharray="6 3"
                  points={chartData.loadPredLine}
                />
              </>
            )}

            {valChartMetric === 'wind_cf' && (
              <>
                <polyline fill="none" stroke="#0f172a" strokeWidth="2.4" points={chartData.windRealLine} />
                <polyline
                  fill="none"
                  stroke="#059669"
                  strokeWidth="2"
                  strokeDasharray="6 3"
                  points={chartData.windPredLine}
                />
              </>
            )}

            {valChartMetric === 'curtailment_mw' && (
              <>
                <polyline fill="none" stroke="#d97706" strokeWidth="1.8" points={chartData.curtSolarLine} />
                <polyline fill="none" stroke="#be123c" strokeWidth="2.4" points={chartData.curtRealLine} />
                <polyline
                  fill="none"
                  stroke="#0f172a"
                  strokeWidth="2"
                  strokeDasharray="5 3"
                  points={chartData.curtPredNonLinLine}
                />
                <polyline
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth="1.6"
                  strokeDasharray="2 3"
                  points={chartData.curtPredLinLine}
                />
              </>
            )}

            <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="#cbd5e1" strokeWidth="1" />
          </svg>
        </div>
      </div>
    </section>
  );
};
