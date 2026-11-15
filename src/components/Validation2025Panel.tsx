import React, { useMemo, useState } from 'react';
import { usePipelineSsot } from '../data/pipelineSsotContext';
import type {
  HourlyValidation2025Point,
  ModelABenchmarkRow,
  ModelBBenchmarkRow,
  ModelCBenchmarkRow,
} from '../data/pipelineTypes';
import type { FeaturesAnovaKpis } from './featuresAnovaKpis';

type ValidationChartMetric = 'load_mw' | 'wind_cf' | 'curtailment_mw';

interface Validation2025PanelProps {
  trainHours: number;
  testHours: number;
  hourly2025: HourlyValidation2025Point[];
  modelABenchmark: ModelABenchmarkRow[];
  modelBBenchmark: ModelBBenchmarkRow[];
  modelCBenchmark: ModelCBenchmarkRow[];
  kpis: FeaturesAnovaKpis;
  downloadFeedback: string | null;
  onExportBenchmarks: () => void;
}

function computeDomain(values: number[], paddingRatio: number, floorZero = false, minFloor?: number, maxCeil?: number): [number, number] {
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

export const Validation2025Panel: React.FC<Validation2025PanelProps> = ({
  trainHours,
  testHours,
  hourly2025,
  modelABenchmark,
  modelBBenchmark,
  modelCBenchmark,
  kpis,
  downloadFeedback,
  onExportBenchmarks,
}) => {
  const { ssot } = usePipelineSsot();
  const cfg = ssot.config;
  const padRatio = cfg.uiThresholds.chartPaddingRatio;
  const [valChartMetric, setValChartMetric] = useState<ValidationChartMetric>('load_mw');

  const domains = useMemo(() => {
    const loadVals = hourly2025.flatMap((p) => [p.realLoadMW, p.predLoadNonLinearMW]);
    const windVals = hourly2025.flatMap((p) => [p.realWindCfPct, p.predWindCfNonLinearPct]);
    const curtVals = hourly2025.flatMap((p) => [
      p.realSolarMW,
      p.realCurtailmentMW,
      p.predCurtailmentNonLinearMW,
      p.predCurtailmentLinearMW,
    ]);
    return {
      load: computeDomain(loadVals, padRatio, false, 0),
      wind: computeDomain(windVals, padRatio, false, 0, 100),
      curt: computeDomain(curtVals, padRatio, true),
    };
  }, [hourly2025, padRatio]);

  const activeDomain =
    valChartMetric === 'load_mw'
      ? domains.load
      : valChartMetric === 'wind_cf'
        ? domains.wind
        : domains.curt;

  const svgW = 860;
  const svgH = 260;
  const padL = 56;
  const padR = 24;
  const padT = 20;
  const padB = 34;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const maxHour = Math.max(1, cfg.hoursPerDay - 1);
  const xForH = (h: number) => padL + (h / maxHour) * plotW;

  const buildHourlyPoints = (getter: (pt: HourlyValidation2025Point) => number, minV: number, maxV: number) =>
    hourly2025
      .map((pt) => {
        const x = xForH(pt.hour);
        const y = padT + ((maxV - getter(pt)) / Math.max(1e-6, maxV - minV)) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <div className="space-y-6">
      {/* Gráfico Interativo de 24h: Real vs Predito Out-of-Time */}
      <section aria-labelledby="heading-hourly-2025" className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 id="heading-hourly-2025" className="text-lg font-bold text-slate-900">
              Perfil Horário Médio de {cfg.baselineYear}: Verificado ONS vs. Previsto Out-of-Time (
              {testHours.toLocaleString('pt-BR')} horas)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Comparação direta entre os valores reais medidos pelo ONS em {cfg.baselineYear} e a previsão cega dos
              modelos treinados de {cfg.historyStartYear} a {cfg.historyEndYear - 1}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setValChartMetric('load_mw')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  valChartMetric === 'load_mw' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Modelo A · Carga (MW)
              </button>
              <button
                type="button"
                onClick={() => setValChartMetric('wind_cf')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  valChartMetric === 'wind_cf' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Modelo B · CF Eólico (%)
              </button>
              <button
                type="button"
                onClick={() => setValChartMetric('curtailment_mw')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  valChartMetric === 'curtailment_mw' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
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
                const label =
                  valChartMetric === 'wind_cf'
                    ? `${v.toFixed(1)}%`
                    : `${(v / 1000).toFixed(1)} GW`;
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
                  <polyline
                    fill="none"
                    stroke="#0f172a"
                    strokeWidth="2.4"
                    points={buildHourlyPoints((p) => p.realLoadMW, domains.load[0], domains.load[1])}
                  />
                  <polyline
                    fill="none"
                    stroke="#0284c7"
                    strokeWidth="2"
                    strokeDasharray="6 3"
                    points={buildHourlyPoints((p) => p.predLoadNonLinearMW, domains.load[0], domains.load[1])}
                  />
                </>
              )}

              {valChartMetric === 'wind_cf' && (
                <>
                  <polyline
                    fill="none"
                    stroke="#0f172a"
                    strokeWidth="2.4"
                    points={buildHourlyPoints((p) => p.realWindCfPct, domains.wind[0], domains.wind[1])}
                  />
                  <polyline
                    fill="none"
                    stroke="#059669"
                    strokeWidth="2"
                    strokeDasharray="6 3"
                    points={buildHourlyPoints((p) => p.predWindCfNonLinearPct, domains.wind[0], domains.wind[1])}
                  />
                </>
              )}

              {valChartMetric === 'curtailment_mw' && (
                <>
                  <polyline
                    fill="none"
                    stroke="#d97706"
                    strokeWidth="1.8"
                    points={buildHourlyPoints((p) => p.realSolarMW, domains.curt[0], domains.curt[1])}
                  />
                  <polyline
                    fill="none"
                    stroke="#be123c"
                    strokeWidth="2.4"
                    points={buildHourlyPoints((p) => p.realCurtailmentMW, domains.curt[0], domains.curt[1])}
                  />
                  <polyline
                    fill="none"
                    stroke="#0f172a"
                    strokeWidth="2"
                    strokeDasharray="5 3"
                    points={buildHourlyPoints((p) => p.predCurtailmentNonLinearMW, domains.curt[0], domains.curt[1])}
                  />
                  <polyline
                    fill="none"
                    stroke="#0284c7"
                    strokeWidth="1.6"
                    strokeDasharray="2 3"
                    points={buildHourlyPoints((p) => p.predCurtailmentLinearMW, domains.curt[0], domains.curt[1])}
                  />
                </>
              )}

              <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="#cbd5e1" strokeWidth="1" />
            </svg>
          </div>
        </div>
      </section>

      {/* Tabelas Comparativas de Modelos Lineares vs. Não-Lineares (Modelos A, B e C) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section aria-labelledby="heading-bench-a" className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="pb-4 border-b border-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
              Script 04 · Modelo A (Demanda Base Normal {cfg.subsystemId})
            </p>
            <h3 id="heading-bench-a" className="text-lg font-bold text-slate-900 mt-0.5">
              Benchmark Out-of-Time {cfg.baselineYear}: Linear vs. Redes Neurais & GBDT
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Treino: {cfg.historyStartYear}–{cfg.historyEndYear - 1} ({trainHours.toLocaleString('pt-BR')} h) · Teste
              cego: {cfg.baselineYear} ({testHours.toLocaleString('pt-BR')} h) · Projeção PDE {cfg.targetEndYear}:{' '}
              {kpis.projPde2035LoadMW > 0
                ? `${kpis.projPde2035LoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW médios`
                : '—'}.
            </p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                  <th className="py-2.5 pr-3">Horizonte</th>
                  <th className="py-2.5 px-2">Arquitetura / Família</th>
                  <th className="py-2.5 px-2 font-mono">MAE (MW)</th>
                  <th className="py-2.5 px-2 font-mono">RMSE (MW)</th>
                  <th className="py-2.5 px-2 font-mono">MAPE</th>
                  <th className="py-2.5 pl-2 font-mono">R²</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {modelABenchmark.map((row) => {
                  const isBest = row.architecture.includes('ResMLP');
                  return (
                    <tr key={`${row.horizon}-${row.architecture}`} className={isBest ? 'bg-sky-50/50' : 'hover:bg-slate-50'}>
                      <td className="py-3 pr-3 font-medium text-slate-800 whitespace-nowrap">
                        {row.horizon.includes('1h') ? '1h-Ahead (Operativo)' : '24h Day-Ahead (PDO)'}
                      </td>
                      <td className="py-3 px-2">
                        <div className="font-semibold text-slate-900">{row.architecture}</div>
                        <div className="text-[11px] text-slate-500">{row.family}</div>
                      </td>
                      <td className="py-3 px-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {row.maeMW.toFixed(1)}
                      </td>
                      <td className="py-3 px-2 font-mono text-slate-700 whitespace-nowrap">
                        {row.rmseMW.toFixed(1)}
                      </td>
                      <td className="py-3 px-2 font-mono font-semibold text-sky-900 whitespace-nowrap">
                        {row.mapePct.toFixed(2)}%
                      </td>
                      <td className="py-3 pl-2 font-mono font-bold text-emerald-800 whitespace-nowrap">
                        {row.r2Score.toFixed(4)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="heading-bench-b" className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="pb-4 border-b border-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
              Script 05 · Modelo B (Fator de Capacidade Eólico CF_pot)
            </p>
            <h3 id="heading-bench-b" className="text-lg font-bold text-slate-900 mt-0.5">
              Benchmark Out-of-Time {cfg.baselineYear}: CF(t) Reconstituído (Sem Viés de Corte)
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Treinado sobre CF potencial = (G_verificada + Curtailment) / Cap_SIGA(t) com termos aerodinâmicos de Betz (v³).
            </p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                  <th className="py-2.5 pr-3">Horizonte</th>
                  <th className="py-2.5 px-2">Arquitetura / Família</th>
                  <th className="py-2.5 px-2 font-mono">MAE (CF)</th>
                  <th className="py-2.5 px-2 font-mono">RMSE (CF)</th>
                  <th className="py-2.5 px-2 font-mono">Equiv. MW</th>
                  <th className="py-2.5 pl-2 font-mono">R²</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {modelBBenchmark.map((row) => {
                  const isBest = row.architecture.includes('ResMLP');
                  return (
                    <tr key={`${row.horizon}-${row.architecture}`} className={isBest ? 'bg-emerald-50/40' : 'hover:bg-slate-50'}>
                      <td className="py-3 pr-3 font-medium text-slate-800 whitespace-nowrap">
                        {row.horizon.includes('1h') ? '1h-Ahead (Curto Prazo)' : '24h Day-Ahead (Sinóptico)'}
                      </td>
                      <td className="py-3 px-2">
                        <div className="font-semibold text-slate-900">{row.architecture}</div>
                        <div className="text-[11px] text-slate-500">{row.family}</div>
                      </td>
                      <td className="py-3 px-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {row.maeCF.toFixed(4)}
                      </td>
                      <td className="py-3 px-2 font-mono text-slate-700 whitespace-nowrap">
                        {row.rmseCF.toFixed(4)}
                      </td>
                      <td className="py-3 px-2 font-mono text-slate-700 whitespace-nowrap">
                        {row.equivPowerMaeMW.toFixed(1)} MW
                      </td>
                      <td className="py-3 pl-2 font-mono font-bold text-emerald-800 whitespace-nowrap">
                        {row.r2Score.toFixed(4)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Benchmark Modelo C */}
      <section aria-labelledby="heading-bench-c" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="pb-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
              Script 05 · Modelo C (Restrição de Operação Constrained-Off Eólico Real ONS)
            </p>
            <h3 id="heading-bench-c" className="text-lg font-bold text-slate-900 mt-0.5">
              Arquitetura Hurdle em 2 Estágios: Probabilidade P(Corte &gt; {cfg.curtailmentFlagThresholdMW} MW) e Volume Cortado (MWh)
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums">
            {cfg.baselineYear - 1} Real:{' '}
            {kpis.ind2024 ? `${kpis.ind2024.annualCurtailmentLossTWh.toFixed(2).replace('.', ',')} TWh` : '—'} ·{' '}
            {cfg.baselineYear} Real:{' '}
            {kpis.ind2025 ? `${kpis.ind2025.annualCurtailmentLossTWh.toFixed(2).replace('.', ',')} TWh` : '—'}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                <th className="py-3 pr-4">Arquitetura Hurdle (Estágio 1 + Estágio 2)</th>
                <th className="py-3 px-3">Família</th>
                <th className="py-3 px-3 font-mono">ROC-AUC (Detecção)</th>
                <th className="py-3 px-3 font-mono">Brier Score</th>
                <th className="py-3 px-3 font-mono">F1-Score</th>
                <th className="py-3 px-3 font-mono">MAE Global (MW)</th>
                <th className="py-3 pl-3 font-mono">R² Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {modelCBenchmark.map((row) => (
                <tr
                  key={row.architecture}
                  className={row.architecture.includes('ResMLP') ? 'bg-amber-50/40' : 'hover:bg-slate-50'}
                >
                  <td className="py-3.5 pr-4 font-semibold text-slate-900">{row.architecture}</td>
                  <td className="py-3.5 px-3 text-slate-600">{row.family}</td>
                  <td className="py-3.5 px-3 font-mono font-bold text-sky-900">{row.rocAuc.toFixed(4)}</td>
                  <td className="py-3.5 px-3 font-mono font-semibold text-emerald-800">{row.brierScore.toFixed(4)}</td>
                  <td className="py-3.5 px-3 font-mono text-slate-800">{row.f1Score.toFixed(4)}</td>
                  <td className="py-3.5 px-3 font-mono font-semibold text-slate-900">
                    {row.maeGlobalMW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW
                  </td>
                  <td className="py-3.5 pl-3 font-mono font-bold text-slate-900">{row.r2Volume.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
