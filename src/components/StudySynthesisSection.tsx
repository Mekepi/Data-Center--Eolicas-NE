import React from 'react';
import type {
  ModelABenchmarkRow,
  ModelBBenchmarkRow,
  ModelCBenchmarkRow,
  MonteCarloScenario2035Row,
  PipelineConfigSnapshot,
  PipelineLineageSnapshot,
  PipelineUiCatalog,
  AneelVsOnsWindIndicatorRow,
} from '../data/pipelineTypes';

export interface StudySynthesisSummaryData {
  mcCentral?: MonteCarloScenario2035Row;
  minCentralAvoidedTWh: number | null;
  maxCentralAvoidedTWh: number | null;
  a1h?: ModelABenchmarkRow;
  a24h?: ModelABenchmarkRow;
  b1h?: ModelBBenchmarkRow;
  b24h?: ModelBBenchmarkRow;
  cBest?: ModelCBenchmarkRow;
  ind2025?: AneelVsOnsWindIndicatorRow;
}

interface StudySynthesisSectionProps {
  cfg: PipelineConfigSnapshot;
  lineage: PipelineLineageSnapshot;
  ui: PipelineUiCatalog;
  summary: StudySynthesisSummaryData;
  onNavigateToDatabases: () => void;
  onNavigateToScripts: () => void;
  onNavigateToModels?: () => void;
}

export const StudySynthesisSection: React.FC<StudySynthesisSectionProps> = ({
  cfg,
  lineage,
  ui,
  summary,
  onNavigateToDatabases,
  onNavigateToScripts,
  onNavigateToModels,
}) => {
  const targetMaxPct = cfg.uiThresholds.targetImportProbMaxPct;

  return (
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
            <strong>não significa blecaute imediato</strong>: indica necessidade de importar energia do restante do SIN.
            O <strong>evento crítico</strong> medido é superar o limite físico de intercâmbio (
            {cfg.interchangeImportLimitMW.toLocaleString('pt-BR')} MW nominais).
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">02. Assimetria: alívio de curtailment</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            O estudo avalia os <strong>dois lados</strong> do problema. Em horas de vento forte e sol alto (
            <span className="font-mono">M(t) &gt;&gt; 0</span>), o {cfg.subsystemId} sofreu{' '}
            <strong>
              {summary.cBest
                ? `${summary.cBest.realCurtailed2025TWh.toFixed(2).replace('.', ',')} TWh`
                : summary.ind2025
                  ? `${summary.ind2025.annualCurtailmentLossTWh.toFixed(2).replace('.', ',')} TWh`
                  : '—'}{' '}
              de cortes eólicos em {cfg.baselineYear}
            </strong>{' '}
            (<em>constrained-off</em> real ONS). A carga firme 24/7 dos data centers (Cenário Central) absorve de{' '}
            <strong>
              {summary.minCentralAvoidedTWh !== null && summary.maxCentralAvoidedTWh !== null
                ? `${summary.minCentralAvoidedTWh.toFixed(2).replace('.', ',')} a ${summary.maxCentralAvoidedTWh.toFixed(2).replace('.', ',')} TWh/ano`
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
              {summary.mcCentral
                ? `+${summary.mcCentral.compensatoryWindExpansionGW.toFixed(2).replace('.', ',')} GW`
                : '—'}{' '}
              no cenário Central)
            </strong>{' '}
            mantêm o risco de importação até {targetMaxPct.toFixed(1).replace('.', ',')}%.
          </p>
        </div>
      </div>

      {/* Matriz sintética separando Diagnóstico Histórico 2025 vs. Projeção 2035 */}
      <div className="mt-8 pt-6 border-t border-slate-200">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2 mb-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Síntese: Diagnóstico Histórico Out-of-Time ({cfg.baselineYear}) vs. Projeção Estocástica ({cfg.targetEndYear})
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs shrink-0">
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
                <th className="py-2.5 pr-4">Bloco · Domínio Temporal</th>
                <th className="py-2.5 px-4">Variável-Alvo (Y)</th>
                <th className="py-2.5 px-4">Algoritmo Vencedor (NumPy/SciPy)</th>
                <th className="py-2.5 pl-4">
                  Métrica Cega {cfg.baselineYear} / Cenário {cfg.targetEndYear}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              <tr className="hover:bg-slate-50/80">
                <td className="py-3 pr-4 whitespace-nowrap">
                  <span className="font-medium text-slate-900">Modelo A · Demanda</span>
                  <span className="block text-[11px] font-medium text-sky-800">
                    Histórico Out-of-Time {cfg.baselineYear}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono text-xs">L_base(t) horária {cfg.subsystemId} (MW)</td>
                <td className="py-3 px-4 text-xs text-slate-600">
                  {lineage.comparativeNonLinearArchitecture} (L-BFGS-B) vs. GBDT e Ridge L2
                </td>
                <td className="py-3 pl-4 font-mono text-xs font-semibold text-slate-900">
                  {summary.a1h && summary.a24h
                    ? `MAPE ${summary.a1h.mapePct.toFixed(2)}% (1h: MAE ${summary.a1h.maeMW.toFixed(1)} MW, R² ${summary.a1h.r2Score.toFixed(4)}) · ${summary.a24h.mapePct.toFixed(2)}% (24h: R² ${summary.a24h.r2Score.toFixed(4)})`
                    : 'Sincronizado via SSOT'}
                </td>
              </tr>
              <tr className="hover:bg-slate-50/80">
                <td className="py-3 pr-4 whitespace-nowrap">
                  <span className="font-medium text-slate-900">Modelo B · Eólica</span>
                  <span className="block text-[11px] font-medium text-sky-800">
                    Histórico Out-of-Time {cfg.baselineYear}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono text-xs">CF(t) = G_pot(t) / Cap(t)</td>
                <td className="py-3 px-4 text-xs text-slate-600">
                  {lineage.comparativeNonLinearArchitecture} L-BFGS-B com não-linearidades aerodinâmicas (v³)
                </td>
                <td className="py-3 pl-4 font-mono text-xs font-semibold text-emerald-800">
                  {summary.b1h && summary.b24h
                    ? `R² = ${summary.b1h.r2Score.toFixed(4)} (1h: MAE ${summary.b1h.maeCF.toFixed(4)} / ${summary.b1h.equivPowerMaeMW.toFixed(1)} MW) · R² = ${summary.b24h.r2Score.toFixed(4)} (24h)`
                    : 'Sincronizado via SSOT'}
                </td>
              </tr>
              <tr className="hover:bg-slate-50/80">
                <td className="py-3 pr-4 whitespace-nowrap">
                  <span className="font-medium text-slate-900">Modelo C · Curtailment</span>
                  <span className="block text-[11px] font-medium text-sky-800">
                    Histórico Out-of-Time {cfg.baselineYear}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono text-xs">
                  P(corte &gt; {cfg.curtailmentFlagThresholdMW} MW) & MWh
                </td>
                <td className="py-3 px-4 text-xs text-slate-600">
                  {summary.cBest?.architecture ?? `Hurdle 2-Estágios (${lineage.comparativeNonLinearArchitecture})`}
                </td>
                <td className="py-3 pl-4 font-mono text-xs font-semibold text-amber-800">
                  {summary.cBest
                    ? `ROC-AUC = ${summary.cBest.rocAuc.toFixed(4)} · Brier = ${summary.cBest.brierScore.toFixed(4)} · F1 = ${summary.cBest.f1Score.toFixed(4)} · R² Vol = ${summary.cBest.r2Volume.toFixed(4)} (${summary.cBest.predCurtailed2025TWh.toFixed(2)} vs ${summary.cBest.realCurtailed2025TWh.toFixed(2)} TWh)`
                    : 'Sincronizado via SSOT'}
                </td>
              </tr>
              <tr className="hover:bg-slate-50/80">
                <td className="py-3 pr-4 whitespace-nowrap">
                  <span className="font-medium text-slate-900">Passo 4 · Monte Carlo</span>
                  <span className="block text-[11px] font-medium text-emerald-800">
                    Projeção Estocástica {cfg.targetEndYear}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono text-xs">
                  P(Import &gt; {(cfg.interchangeImportLimitMW / 1000).toFixed(1)} GW) & GW Extra
                </td>
                <td className="py-3 px-4 text-xs text-slate-600">
                  Block-Bootstrap Sazonal + Modulação Chesf + Pipeline Bottom-Up
                </td>
                <td className="py-3 pl-4 font-mono text-xs font-semibold text-sky-900">
                  {summary.mcCentral
                    ? `Central DC: P95 = ${summary.mcCentral.importP95MW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW (+${summary.mcCentral.compensatoryWindExpansionGW.toFixed(2)} GW eólicos extras; −${(summary.mcCentral.curtailmentAvoidedGWh / 1000).toFixed(2)} TWh corte)`
                    : 'Sincronizado via SSOT'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
