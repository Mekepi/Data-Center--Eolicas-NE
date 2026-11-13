import React from 'react';
import type {
  AneelVsOnsWindIndicatorRow,
  H2VSynergySensitivityRow,
  TransmissionSensitivityRow,
} from '../data/pipelineTypes';
import type { FeaturesAnovaKpis } from './featuresAnovaKpis';

interface SensitivityPasso5PanelProps {
  interchangeImportLimitMW: number;
  txSensitivity: TransmissionSensitivityRow[];
  h2vSensitivity: H2VSynergySensitivityRow[];
  aneelVsOns: AneelVsOnsWindIndicatorRow[];
  kpis: FeaturesAnovaKpis;
  downloadFeedback: string | null;
  onExportPasso5Csv: () => void;
  onExportPasso5Md: () => void;
}

export const SensitivityPasso5Panel: React.FC<SensitivityPasso5PanelProps> = ({
  interchangeImportLimitMW,
  txSensitivity,
  h2vSensitivity,
  aneelVsOns,
  kpis,
  downloadFeedback,
  onExportPasso5Csv,
  onExportPasso5Md,
}) => {
  return (
    <div className="space-y-8">
      {/* Seção 1: Sensibilidade aos Limites de Intercâmbio do SIN (TX-01 a TX-05) */}
      <section aria-labelledby="heading-tx-sens" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
              Script 07 · Passo 5 Concluído · Sensibilidade de Malha de Transmissão (Seções 8 e 9 do PDF)
            </p>
            <h2 id="heading-tx-sens" className="text-xl font-bold text-slate-900 mt-0.5">
              Sensibilidade aos Limites de Intercâmbio SIN: Novas LTs 500 kV e Bipolo HVDC em 2035
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Efeito da capacidade de importação ({kpis.txMinImportGW.toFixed(1).replace('.', ',')} a{' '}
              {kpis.txMaxImportGW.toFixed(1).replace('.', ',')} GW) e exportação (
              {kpis.txMinExportGW.toFixed(1).replace('.', ',')} a {kpis.txMaxExportGW.toFixed(1).replace('.', ',')} GW) sobre o
              risco de déficit e sobre a expansão eólica compensatória no Cenário Central (DC ={' '}
              {kpis.mcCentral
                ? `${kpis.mcCentral.dcLoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW`
                : '—'}
              , Eólica ={' '}
              {kpis.mcCentral ? `${(kpis.mcCentral.windCapacityMW / 1000).toFixed(1).replace('.', ',')} GW` : '—'}).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onExportPasso5Csv}
              className="px-3.5 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Exportar Sensibilidades (.csv)
            </button>
            <button
              type="button"
              onClick={onExportPasso5Md}
              className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {downloadFeedback ?? 'Baixar Relatório Final (.md)'}
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                <th className="py-3 pr-3">Configuração de Transmissão SIN</th>
                <th className="py-3 px-2 font-mono">Limite Import.</th>
                <th className="py-3 px-2 font-mono">Limite Export.</th>
                <th className="py-3 px-2 font-mono">P(Import &gt; Lim.)</th>
                <th className="py-3 px-2 font-mono">LOLE (h/ano)</th>
                <th className="py-3 px-2 font-mono">Curtailment</th>
                <th className="py-3 px-2 font-mono">Absorvido DC</th>
                <th className="py-3 pl-2 font-mono">Eólica Extra Req.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {txSensitivity.map((row) => {
                const isBaseRef = row.importLimitMW === interchangeImportLimitMW;
                return (
                  <tr key={row.configId} className={isBaseRef ? 'bg-sky-50/60' : 'hover:bg-slate-50'}>
                    <td className="py-3.5 pr-3">
                      <div className="font-semibold text-slate-900">{row.configId}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{row.infrastructureDescription}</div>
                    </td>
                    <td className="py-3.5 px-2 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {row.importLimitMW.toLocaleString('pt-BR')} MW
                    </td>
                    <td className="py-3.5 px-2 font-mono text-slate-800 whitespace-nowrap">
                      {row.exportLimitMW.toLocaleString('pt-BR')} MW
                    </td>
                    <td
                      className={`py-3.5 px-2 font-mono font-bold whitespace-nowrap ${
                        row.probCriticalImportPct >= 15
                          ? 'text-red-700'
                          : row.probCriticalImportPct > 5
                            ? 'text-amber-700'
                            : 'text-emerald-800'
                      }`}
                    >
                      {row.probCriticalImportPct.toFixed(2)}%
                    </td>
                    <td className="py-3.5 px-2 font-mono text-slate-700 whitespace-nowrap">
                      {row.loleHoursYear.toFixed(1)} h
                    </td>
                    <td className="py-3.5 px-2 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {row.curtailmentWithDcTWh.toFixed(2)} TWh
                    </td>
                    <td className="py-3.5 px-2 font-mono text-emerald-800 font-semibold whitespace-nowrap">
                      −{row.curtailmentAvoidedGWh.toLocaleString('pt-BR')} GWh
                    </td>
                    <td className="py-3.5 pl-2 font-mono font-bold text-sky-900 whitespace-nowrap">
                      +{row.compensatoryWindGW.toFixed(2)} GW
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Seção 2: Disputa e Sinergia entre Data Centers 24/7 e Hidrogênio Verde (H2V) em Pecém/Suape */}
      <section aria-labelledby="heading-h2v-sens" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="pb-6 border-b border-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
            Seção 10 do Plano Orientador & Decisão 04 · Competição vs. Sinergia nos Barramentos 500 kV (Pecém II & Suape II)
          </p>
          <h2 id="heading-h2v-sens" className="text-xl font-bold text-slate-900 mt-0.5">
            Data Centers (Inflexíveis 24/7) vs. Hubs de Hidrogênio Verde (H2V Baseload vs. Flexível)
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Comparação entre a operação de eletrolisadores H2V em regime baseload contínuo (que agrava o déficit noturno na estação chuvosa) e em regime <em>grid-following</em> flexível (que reduz carga a 12% na calmaria e absorve <em>curtailment</em> renovável a 100%).
          </p>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                <th className="py-3 pr-3">Cenário de Cargas Eletrointensivas (2035)</th>
                <th className="py-3 px-2 font-mono">DC 24/7</th>
                <th className="py-3 px-2 font-mono">H2V Nominal (Média)</th>
                <th className="py-3 px-2 font-mono">P(Import &gt; {kpis.importLimitGW.toFixed(0)} GW)</th>
                <th className="py-3 px-2 font-mono">Import P95</th>
                <th className="py-3 px-2 font-mono">Curtailment Absorvido</th>
                <th className="py-3 px-2 font-mono">Pressão SE Pecém II</th>
                <th className="py-3 pl-2 font-mono">Eólica Extra Req.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {h2vSensitivity.map((row) => {
                const isPureDc = row.h2vNominalMW === 0;
                const isFlex = row.scenarioId.includes('Flexível');
                return (
                  <tr
                    key={row.scenarioId}
                    className={isPureDc ? 'bg-sky-50/50' : isFlex ? 'bg-emerald-50/40' : 'hover:bg-slate-50'}
                  >
                    <td className="py-3.5 pr-3">
                      <div className="font-semibold text-slate-900">{row.scenarioId}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{row.operatingRegime}</div>
                    </td>
                    <td className="py-3.5 px-2 font-mono text-slate-800 whitespace-nowrap">
                      {row.dcLoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} MW
                    </td>
                    <td className="py-3.5 px-2 font-mono text-slate-900 whitespace-nowrap">
                      {row.h2vNominalMW.toLocaleString('pt-BR')} MW ({row.h2vEffectiveAvgMW.toFixed(0)} MWmed)
                    </td>
                    <td
                      className={`py-3.5 px-2 font-mono font-bold whitespace-nowrap ${
                        row.probCriticalImportPct >= 18 ? 'text-red-700' : 'text-amber-800'
                      }`}
                    >
                      {row.probCriticalImportPct.toFixed(2)}%
                    </td>
                    <td className="py-3.5 px-2 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {row.importP95MW.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} MW
                    </td>
                    <td className="py-3.5 px-2 font-mono font-bold text-emerald-800 whitespace-nowrap">
                      {row.totalAbsorbedCurtailmentTWh.toFixed(2)} TWh/ano
                    </td>
                    <td className="py-3.5 px-2 font-mono text-slate-800 whitespace-nowrap">
                      {row.pecemSubstationLoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} MW
                    </td>
                    <td className="py-3.5 pl-2 font-mono font-bold text-sky-900 whitespace-nowrap">
                      +{row.compensatoryWindGW.toFixed(2)} GW
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Seção 3: Indicadores Separados da Seção 6 do PDF (Capacidade ANEEL vs. Geração Efetiva ONS 2015–2035) */}
      <section aria-labelledby="heading-aneel-ons-ind" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="pb-6 border-b border-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
            Seção 6 do Plano Orientador · Indicadores Separados de Participação Eólica (2015–2035)
          </p>
          <h2 id="heading-aneel-ons-ind" className="text-xl font-bold text-slate-900 mt-0.5">
            Participação Eólica na Capacidade Instalada (ANEEL/SIGA) vs. Geração Efetiva (ONS)
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Demonstra por que capacidade instalada física não equivale a geração efetiva entregável: em 2025, a eólica
            detém{' '}
            <strong>
              {kpis.ind2025 ? kpis.ind2025.aneelInstalledSharePct.toFixed(2).replace('.', ',') : '—'}% da potência instalada
            </strong>{' '}
            no Nordeste, mas responde por{' '}
            <strong>
              {kpis.ind2025 ? kpis.ind2025.onsEffectiveGenSharePct.toFixed(2).replace('.', ',') : '—'}% da geração elétrica efetiva
            </strong>{' '}
            (apesar de perder{' '}
            {kpis.ind2025
              ? (kpis.ind2025.potentialUnconstrainedCfPct - kpis.ind2025.onsEffectiveCfPct).toFixed(2).replace('.', ',')
              : '—'}{' '}
            pontos percentuais de fator de capacidade para o <em>constrained-off</em> de{' '}
            {kpis.ind2025 ? kpis.ind2025.annualCurtailmentLossTWh.toFixed(2).replace('.', ',') : '—'} TWh).
          </p>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                <th className="py-2.5 pr-3">Ano</th>
                <th className="py-2.5 px-2">Período / Regime</th>
                <th className="py-2.5 px-2 font-mono">Cap. Eólica NE</th>
                <th className="py-2.5 px-2 font-mono">Part. Capacidade (ANEEL)</th>
                <th className="py-2.5 px-2 font-mono">Part. Geração Efetiva (ONS)</th>
                <th className="py-2.5 px-2 font-mono">CF Potencial s/ Corte</th>
                <th className="py-2.5 px-2 font-mono">CF Efetivo ONS</th>
                <th className="py-2.5 pl-2 font-mono">Perda Curtailment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {aneelVsOns.map((row) => {
                const isProjected = row.year >= 2028;
                const is2025 = row.year === 2025;
                return (
                  <tr
                    key={row.year}
                    className={is2025 ? 'bg-amber-50/50' : isProjected ? 'bg-sky-50/30' : 'hover:bg-slate-50'}
                  >
                    <td className="py-2.5 pr-3 font-mono font-bold text-slate-900">{row.year}</td>
                    <td className="py-2.5 px-2 text-slate-600">{row.periodLabel}</td>
                    <td className="py-2.5 px-2 font-mono font-semibold text-slate-900">
                      {row.installedWindGW.toFixed(2)} GW
                    </td>
                    <td className="py-2.5 px-2 font-mono font-bold text-sky-900">
                      {row.aneelInstalledSharePct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-2 font-mono font-bold text-emerald-800">
                      {row.onsEffectiveGenSharePct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-2 font-mono text-slate-800">
                      {row.potentialUnconstrainedCfPct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-2 font-mono font-semibold text-slate-900">
                      {row.onsEffectiveCfPct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 pl-2 font-mono font-semibold text-rose-700">
                      {row.annualCurtailmentLossTWh.toFixed(2)} TWh
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
