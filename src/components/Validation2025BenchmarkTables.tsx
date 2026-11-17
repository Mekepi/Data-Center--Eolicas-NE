import React from 'react';
import type {
  ModelABenchmarkRow,
  ModelBBenchmarkRow,
  ModelCBenchmarkRow,
  PipelineConfigSnapshot,
} from '../data/pipelineTypes';
import type { FeaturesAnovaKpis } from './featuresAnovaKpis';

interface Validation2025BenchmarkTablesProps {
  cfg: PipelineConfigSnapshot;
  trainHours: number;
  testHours: number;
  modelABenchmark: ModelABenchmarkRow[];
  modelBBenchmark: ModelBBenchmarkRow[];
  modelCBenchmark: ModelCBenchmarkRow[];
  kpis: FeaturesAnovaKpis;
}

export const Validation2025BenchmarkTables: React.FC<Validation2025BenchmarkTablesProps> = ({
  cfg,
  trainHours,
  testHours,
  modelABenchmark,
  modelBBenchmark,
  modelCBenchmark,
  kpis,
}) => {
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section aria-labelledby="heading-bench-a" className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="pb-4 border-b border-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
              Script 04 · Modelo A · Diagnóstico Histórico {cfg.baselineYear} (Demanda Base {cfg.subsystemId})
            </p>
            <h3 id="heading-bench-a" className="text-lg font-bold text-slate-900 mt-0.5">
              Benchmark Out-of-Time {cfg.baselineYear}: Linear vs. Redes Neurais & GBDT
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Treino causal: {cfg.historyStartYear}–{cfg.historyEndYear - 1} ({trainHours.toLocaleString('pt-BR')} h) ·
              Teste cego exclusivo {cfg.baselineYear} ({testHours.toLocaleString('pt-BR')} h).
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
                  const isBest = row.modelId === cfg.referenceScenarioKeys.preferredModelId;
                  return (
                    <tr key={`${row.horizonId}-${row.modelId}`} className={isBest ? 'bg-sky-50/50' : 'hover:bg-slate-50'}>
                      <td className="py-3 pr-3 font-medium text-slate-800 whitespace-nowrap">
                        {row.horizonId === '1h' ? '1h-Ahead (Operativo)' : '24h Day-Ahead (PDO)'}
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

          <p className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
            Referência separada de projeção (EPE PDE +{(cfg.annualLoadGrowthRate * 100).toFixed(1).replace('.', ',')}% a.a.):{' '}
            carga base projetada para {cfg.targetEndYear} ={' '}
            <strong className="font-mono text-slate-700">
              {kpis.projPde2035LoadMW > 0
                ? `${kpis.projPde2035LoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW médios`
                : '—'}
            </strong>
            .
          </p>
        </section>

        <section aria-labelledby="heading-bench-b" className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="pb-4 border-b border-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
              Script 05 · Modelo B · Diagnóstico Histórico {cfg.baselineYear} (Fator de Capacidade Eólico CF_pot)
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
                  const isBest = row.modelId === cfg.referenceScenarioKeys.preferredModelId;
                  return (
                    <tr key={`${row.horizonId}-${row.modelId}`} className={isBest ? 'bg-emerald-50/40' : 'hover:bg-slate-50'}>
                      <td className="py-3 pr-3 font-medium text-slate-800 whitespace-nowrap">
                        {row.horizonId === '1h' ? '1h-Ahead (Curto Prazo)' : '24h Day-Ahead (Sinóptico)'}
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
              Script 05 · Modelo C · Diagnóstico Histórico {cfg.baselineYear} (Constrained-Off Eólico Real ONS)
            </p>
            <h3 id="heading-bench-c" className="text-lg font-bold text-slate-900 mt-0.5">
              Arquitetura Hurdle em 2 Estágios: Probabilidade P(Corte &gt; {cfg.curtailmentFlagThresholdMW} MW) e Volume Cortado (MWh)
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Estágio C1 (classificador calibrado por Platt out-of-fold) acoplado ao Estágio C2 (regressor de volume com ativação{' '}
              <span className="font-mono">SiLU</span> para caudas de excedente).
            </p>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums shrink-0">
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
                <th className="py-3 px-3 font-mono">ROC-AUC</th>
                <th className="py-3 px-3 font-mono">Brier</th>
                <th className="py-3 px-3 font-mono">F1-Score</th>
                <th className="py-3 px-3 font-mono">MAE Global</th>
                <th className="py-3 px-3 font-mono">R² Volume</th>
                <th className="py-3 pl-3 font-mono">Energia {cfg.baselineYear} (Pred. / Real)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {modelCBenchmark.map((row) => (
                <tr
                  key={row.modelId}
                  className={
                    row.modelId === cfg.referenceScenarioKeys.preferredModelId ? 'bg-amber-50/40' : 'hover:bg-slate-50'
                  }
                >
                  <td className="py-3.5 pr-4 font-semibold text-slate-900">{row.architecture}</td>
                  <td className="py-3.5 px-3 text-slate-600">{row.family}</td>
                  <td className="py-3.5 px-3 font-mono font-bold text-sky-900">{row.rocAuc.toFixed(4)}</td>
                  <td className="py-3.5 px-3 font-mono font-semibold text-emerald-800">{row.brierScore.toFixed(4)}</td>
                  <td className="py-3.5 px-3 font-mono text-slate-800">{row.f1Score.toFixed(4)}</td>
                  <td className="py-3.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {row.maeGlobalMW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW
                  </td>
                  <td className="py-3.5 px-3 font-mono font-bold text-slate-900">{row.r2Volume.toFixed(4)}</td>
                  <td className="py-3.5 pl-3 font-mono font-semibold text-amber-900 whitespace-nowrap">
                    {row.predCurtailed2025TWh.toFixed(2).replace('.', ',')} /{' '}
                    {row.realCurtailed2025TWh.toFixed(2).replace('.', ',')} TWh
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};
