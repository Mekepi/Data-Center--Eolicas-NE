import React, { useMemo, useState } from 'react';
import type {
  AnnualRiskTimelinePoint,
  CompensatoryWindPoint,
  MonteCarloScenario2035Row,
} from '../data/pipelineTypes';
import type { FeaturesAnovaKpis } from './featuresAnovaKpis';

interface MonteCarlo2035PanelProps {
  mc12Scenarios: MonteCarloScenario2035Row[];
  compWindCurve: CompensatoryWindPoint[];
  annualTimeline: AnnualRiskTimelinePoint[];
  kpis: FeaturesAnovaKpis;
  downloadFeedback: string | null;
  onExportMc2035: () => void;
}

export const MonteCarlo2035Panel: React.FC<MonteCarlo2035PanelProps> = ({
  mc12Scenarios,
  compWindCurve,
  annualTimeline,
  kpis,
  downloadFeedback,
  onExportMc2035,
}) => {
  const [selectedDcFilter, setSelectedDcFilter] = useState<string>('all');

  const filteredMcScenarios = useMemo(() => {
    if (selectedDcFilter === 'all') return mc12Scenarios;
    return mc12Scenarios.filter((s) => s.dcScenarioId === selectedDcFilter);
  }, [mc12Scenarios, selectedDcFilter]);

  return (
    <div className="space-y-8">
      {/* Matriz dos 12 Cenários em 2035 */}
      <section aria-labelledby="heading-mc12-matrix" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
              Script 06 · Passo 4 Concluído · Block-Bootstrap Monte Carlo em Multiprocessing
            </p>
            <h2 id="heading-mc12-matrix" className="text-xl font-bold text-slate-900 mt-0.5">
              Matriz Completa de Risco Operativo e Expansão Compensatória em 2035 (12 Cenários)
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Cruzamento de 4 cenários de Data Centers × 3 trajetórias eólicas (SIGA + IBAMA Offshore pós-2031) com modulação hidrotérmica de ponta da Chesf (2.600–9.850 MW).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Filtrar por cenário de Data Center"
              value={selectedDcFilter}
              onChange={(e) => setSelectedDcFilter(e.target.value)}
              className="h-9 px-3 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="all">Todos os 12 Cenários (4 DC × 3 Eólica)</option>
              <option value="none">1. Sem Data Centers (Baseline Controle)</option>
              <option value="conservative">
                2. DC Conservador ({kpis.ramp2035 ? Math.round(kpis.ramp2035.conservativeMW).toLocaleString('pt-BR') : '—'} MW rede)
              </option>
              <option value="central">
                3. DC Central ({kpis.ramp2035 ? Math.round(kpis.ramp2035.centralMW).toLocaleString('pt-BR') : '—'} MW rede)
              </option>
              <option value="high">
                4. DC Stress Test / IA ({kpis.ramp2035 ? Math.round(kpis.ramp2035.highMW).toLocaleString('pt-BR') : '—'} MW rede)
              </option>
            </select>

            <button
              type="button"
              onClick={onExportMc2035}
              className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {downloadFeedback ?? 'Exportar Matriz 2035 (.csv)'}
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                <th className="py-3 pr-3">Combinação de Cenário (DC × Eólica)</th>
                <th className="py-3 px-2 font-mono">Carga DC</th>
                <th className="py-3 px-2 font-mono">Eólica Total</th>
                <th className="py-3 px-2 font-mono">P(Import &gt; {kpis.importLimitGW.toFixed(0)} GW)</th>
                <th className="py-3 px-2 font-mono">LOLE (h/ano)</th>
                <th className="py-3 px-2 font-mono">Import P95</th>
                <th className="py-3 px-2 font-mono">Curtailment</th>
                <th className="py-3 px-2 font-mono">Absorvido DC</th>
                <th className="py-3 pl-2 font-mono">Eólica Extra Req.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {filteredMcScenarios.map((s) => {
                const isReferenceCentral =
                  s.dcScenarioId === 'central' && Math.abs(s.windCapacityMW - kpis.intermWindMW) < 100;
                return (
                  <tr
                    key={s.scenarioName}
                    className={isReferenceCentral ? 'bg-sky-50/60' : 'hover:bg-slate-50'}
                  >
                    <td className="py-3 pr-3 font-semibold text-slate-900 whitespace-nowrap">{s.scenarioName}</td>
                    <td className="py-3 px-2 font-mono text-slate-800 whitespace-nowrap">
                      {s.dcLoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} MW
                    </td>
                    <td className="py-3 px-2 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {(s.windCapacityMW / 1000).toFixed(1)} GW
                    </td>
                    <td
                      className={`py-3 px-2 font-mono font-bold whitespace-nowrap ${
                        s.probExceedInterchangePct >= 15
                          ? 'text-red-700'
                          : s.probExceedInterchangePct > 5
                            ? 'text-amber-700'
                            : 'text-emerald-800'
                      }`}
                    >
                      {s.probExceedInterchangePct.toFixed(1)}%
                    </td>
                    <td className="py-3 px-2 font-mono text-slate-700 whitespace-nowrap">
                      {s.loleCriticalHoursYear.toFixed(1)} h
                    </td>
                    <td className="py-3 px-2 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {s.importP95MW.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} MW
                    </td>
                    <td className="py-3 px-2 font-mono text-slate-800 whitespace-nowrap">
                      {s.curtailmentWithDcTWh.toFixed(2)} TWh
                    </td>
                    <td className="py-3 px-2 font-mono font-semibold text-emerald-800 whitespace-nowrap">
                      {s.curtailmentAvoidedGWh > 0
                        ? `−${s.curtailmentAvoidedGWh.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} GWh`
                        : '0 GWh'}
                    </td>
                    <td className="py-3 pl-2 font-mono font-bold text-sky-900 whitespace-nowrap">
                      {s.compensatoryWindExpansionGW > 0 ? `+${s.compensatoryWindExpansionGW.toFixed(2)} GW` : '0,00 GW'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Curva de Expansão Eólica Compensatória + Trajetória Anual 2026-2035 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Curva de Expansão Eólica Compensatória */}
        <section aria-labelledby="heading-comp-curve" className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="pb-4 border-b border-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
              Trade-Off Fundamental do Estudo (Cenário Central DC ·{' '}
              {kpis.mcCentral
                ? `${kpis.mcCentral.dcLoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW`
                : '—'}
              )
            </p>
            <h3 id="heading-comp-curve" className="text-lg font-bold text-slate-900 mt-0.5">
              Curva de Expansão Eólica Compensatória vs. Curtailment em 2035
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Quantos GW eólicos extras acima da base ({kpis.baseWind2026GW.toFixed(1).replace('.', ',')} GW) são exigidos para reconduzir o risco de importação P(Import &gt; {kpis.importLimitGW.toFixed(0)} GW) à meta segura (&le; 5%).
            </p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                  <th className="py-2.5 pr-2 font-mono">Adição Eólica</th>
                  <th className="py-2.5 px-2 font-mono">Parque Total</th>
                  <th className="py-2.5 px-2 font-mono">P(Import &gt; {kpis.importLimitGW.toFixed(0)} GW)</th>
                  <th className="py-2.5 px-2 font-mono">Import P95</th>
                  <th className="py-2.5 pl-2 font-mono">Curtailment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {compWindCurve.map((pt) => {
                  const meetsTarget = pt.probExceedInterchangePct <= 5.5;
                  return (
                    <tr key={pt.extraWindGW} className={meetsTarget ? 'bg-emerald-50/40' : 'hover:bg-slate-50'}>
                      <td className="py-2.5 pr-2 font-mono font-bold text-sky-900">
                        +{pt.extraWindGW.toFixed(1)} GW
                      </td>
                      <td className="py-2.5 px-2 font-mono text-slate-800">{pt.totalWindGW.toFixed(1)} GW</td>
                      <td
                        className={`py-2.5 px-2 font-mono font-bold ${
                          meetsTarget ? 'text-emerald-800' : 'text-amber-800'
                        }`}
                      >
                        {pt.probExceedInterchangePct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-2 font-mono text-slate-900">
                        {pt.importP95MW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW
                      </td>
                      <td className="py-2.5 pl-2 font-mono text-slate-700">
                        {pt.curtailmentWithDcTWh.toFixed(2)} TWh/ano
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Evolução Anual do Risco 2026–2035 */}
        <section aria-labelledby="heading-annual-timeline" className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="pb-4 border-b border-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
              Horizonte Decenal 2026–2035 (Cenário Central DC + SIGA Intermediário)
            </p>
            <h3 id="heading-annual-timeline" className="text-lg font-bold text-slate-900 mt-0.5">
              Evolução Anual de Risco, Importação P95 e Curtailment Evitado
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Acompanhamento ano a ano do crescimento vegetativo do Nordeste (EPE PDE) somado à rampa dos Data Centers.
            </p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                  <th className="py-2 pr-2">Ano</th>
                  <th className="py-2 px-2 font-mono">Carga DC</th>
                  <th className="py-2 px-2 font-mono">P(Import &gt; {kpis.importLimitGW.toFixed(0)} GW)</th>
                  <th className="py-2 px-2 font-mono">Import P95</th>
                  <th className="py-2 pl-2 font-mono">GW Extra Req.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700 font-mono">
                {annualTimeline.map((yr) => (
                  <tr key={yr.year} className="hover:bg-slate-50">
                    <td className="py-2 pr-2 font-bold text-slate-900">{yr.year}</td>
                    <td className="py-2 px-2 text-slate-700">
                      {yr.dcLoadMW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW
                    </td>
                    <td className="py-2 px-2 font-semibold text-amber-800">
                      {yr.probExceedInterchangePct.toFixed(1)}% ({yr.loleHoursYear.toFixed(0)}h)
                    </td>
                    <td className="py-2 px-2 font-semibold text-slate-900">
                      {yr.importP95MW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW
                    </td>
                    <td className="py-2 pl-2 font-bold text-sky-900">
                      {yr.compensatoryWindGW > 0 ? `+${yr.compensatoryWindGW.toFixed(2)} GW` : '0,00 GW'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
