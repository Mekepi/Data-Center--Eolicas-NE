import React from 'react';
import type {
  AneelVsOnsWindIndicatorRow,
  H2VSynergySensitivityRow,
  MonteCarloScenario2035Row,
  PipelineConfigSnapshot,
  PipelineUiCatalog,
  TransmissionSensitivityRow,
} from '../data/pipelineTypes';

export interface ExecutiveDeliverySummaryData {
  intermWindMW: number;
  mcInterm: MonteCarloScenario2035Row[];
  mcCentral?: MonteCarloScenario2035Row;
  tx04?: TransmissionSensitivityRow;
  tx05?: TransmissionSensitivityRow;
  h2v2Inflex?: H2VSynergySensitivityRow;
  h2v2Flex?: H2VSynergySensitivityRow;
  ind2025?: AneelVsOnsWindIndicatorRow;
  totalMcScenariosCount: number;
}

interface ExecutiveDeliverySectionProps {
  cfg: PipelineConfigSnapshot;
  ui: PipelineUiCatalog;
  summary: ExecutiveDeliverySummaryData;
  onNavigateToModels?: () => void;
}

export const ExecutiveDeliverySection: React.FC<ExecutiveDeliverySectionProps> = ({
  cfg,
  ui,
  summary,
  onNavigateToModels,
}) => {
  const badges = cfg.uiThresholds.sensitivityBadges;
  const refs = cfg.referenceScenarioKeys;

  return (
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
            {(summary.intermWindMW / 1000).toFixed(1).replace('.', ',')} GW instalados) frente aos 4 cenários de Data
            Centers e às sensibilidades de rede do Passo 5.
          </p>
        </div>
        {onNavigateToModels && (
          <button
            type="button"
            onClick={onNavigateToModels}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
          >
            Explorar Passo 5, {summary.totalMcScenariosCount} Cenários & Relatório (.md) →
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
            {summary.mcInterm.map((s) => (
              <tr
                key={s.scenarioName}
                className={s.dcScenarioId === refs.dcCentral ? 'bg-sky-50/50' : 'hover:bg-slate-50'}
              >
                <td className="py-3.5 pr-3 font-semibold text-slate-900 min-w-[210px]">{s.scenarioName}</td>
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
            Projeção {cfg.targetEndYear} · Expansão da Transmissão ({summary.tx04?.configCode ?? 'TX-04'} /{' '}
            {summary.tx05?.configCode ?? 'TX-05'})
          </span>
          <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">
            A entrada das novas LTs 500 kV e Bipolo HVDC (elevando o limite de importação para{' '}
            <strong>
              {summary.tx04 && summary.tx05
                ? `${(summary.tx04.importLimitMW / 1000).toFixed(1).replace('.', ',')}–${(summary.tx05.importLimitMW / 1000).toFixed(1).replace('.', ',')} GW`
                : '—'}
            </strong>{' '}
            e exportação para{' '}
            <strong>
              {summary.tx04 && summary.tx05
                ? `${(summary.tx04.exportLimitMW / 1000).toFixed(1).replace('.', ',')}–${(summary.tx05.exportLimitMW / 1000).toFixed(1).replace('.', ',')} GW`
                : '—'}
            </strong>
            ) reduz o requisito de expansão eólica compensatória de{' '}
            <strong>
              {summary.mcCentral
                ? `+${summary.mcCentral.compensatoryWindExpansionGW.toFixed(2).replace('.', ',')} GW`
                : '—'}
            </strong>{' '}
            para{' '}
            <strong>
              {summary.tx04 ? `+${summary.tx04.compensatoryWindGW.toFixed(2).replace('.', ',')} GW` : '—'}
            </strong>{' '}
            ou{' '}
            <strong>
              {summary.tx05 ? `${summary.tx05.compensatoryWindGW.toFixed(2).replace('.', ',')} GW` : '—'}
            </strong>
            .
          </p>
        </div>

        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 block">
            Projeção {cfg.targetEndYear} · Disputa vs. Sinergia H2V ({cfg.pecemSubstationName} & {ui.secondarySubstationFocus})
          </span>
          <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">
            Se {(cfg.defaultH2vComparisonMW / 1000).toFixed(1).replace('.', ',')} GW de H2V operarem inflexíveis 24/7
            junto aos DCs, o risco crítico salta para{' '}
            <strong>
              {summary.h2v2Inflex
                ? `${summary.h2v2Inflex.probCriticalImportPct.toFixed(2).replace('.', ',')}%`
                : '—'}
            </strong>{' '}
            (
            {summary.h2v2Inflex
              ? `+${summary.h2v2Inflex.compensatoryWindGW.toFixed(2).replace('.', ',')} GW`
              : '—'}{' '}
            eólicos). Com{' '}
            <strong>modulação flexível ({Math.round(cfg.h2vFlex.flexLowFactor * 100)}% na calmaria)</strong>, o H2V
            absorve{' '}
            <strong>
              {summary.h2v2Flex
                ? `${summary.h2v2Flex.totalAbsorbedCurtailmentTWh.toFixed(2).replace('.', ',')} TWh/ano`
                : '—'}
            </strong>{' '}
            de <em>curtailment</em> mantendo o risco em{' '}
            <strong>
              {summary.h2v2Flex
                ? `${summary.h2v2Flex.probCriticalImportPct.toFixed(2).replace('.', ',')}%`
                : '—'}
            </strong>
            .
          </p>
        </div>

        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-800 block">
            Histórico {cfg.baselineYear} · Capacidade ANEEL vs. Geração Efetiva ONS
          </span>
          <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">
            Em {cfg.baselineYear}, a fonte eólica representou{' '}
            <strong>
              {summary.ind2025 ? `${summary.ind2025.aneelInstalledSharePct.toFixed(2).replace('.', ',')}%` : '—'} da
              capacidade instalada
            </strong>{' '}
            no {cfg.subsystemId} (ANEEL), mas entregou{' '}
            <strong>
              {summary.ind2025 ? `${summary.ind2025.onsEffectiveGenSharePct.toFixed(2).replace('.', ',')}%` : '—'} da
              geração elétrica efetiva
            </strong>{' '}
            (ONS), apesar da perda de{' '}
            <strong>
              {summary.ind2025
                ? (summary.ind2025.potentialUnconstrainedCfPct - summary.ind2025.onsEffectiveCfPct)
                    .toFixed(2)
                    .replace('.', ',')
                : '—'}{' '}
              p.p. de fator de capacidade
            </strong>{' '}
            por <em>constrained-off</em> (
            {summary.ind2025 ? `${summary.ind2025.annualCurtailmentLossTWh.toFixed(2).replace('.', ',')} TWh` : '—'}).
          </p>
        </div>
      </div>
    </section>
  );
};
