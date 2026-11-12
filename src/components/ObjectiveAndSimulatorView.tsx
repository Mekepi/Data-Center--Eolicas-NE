import React, { useMemo, useState } from 'react';
import {
  evaluateScenario,
  type DataCenterScenarioId,
  type HourlyPoint,
  type SeasonalRegimeId,
  type SimulationConfig,
  type WindExpansionScenarioId,
} from '../utils/energyModel';

interface ObjectiveAndSimulatorViewProps {
  config: SimulationConfig;
  onChangeConfig: (next: SimulationConfig) => void;
  onNavigateToDatabases: () => void;
  onNavigateToScripts: () => void;
}

type ChartMode = 'margin' | 'supply_demand';

export const ObjectiveAndSimulatorView: React.FC<ObjectiveAndSimulatorViewProps> = ({
  config,
  onChangeConfig,
  onNavigateToDatabases,
  onNavigateToScripts,
}) => {
  const [chartMode, setChartMode] = useState<ChartMode>('margin');
  const [inspectedHour, setInspectedHour] = useState<number>(76); // Quinta 04h/tarde na depressão sinóptica

  const result = useMemo(() => evaluateScenario(config), [config]);
  const activePoint: HourlyPoint = result.hourlySeries[inspectedHour] ?? result.hourlySeries[0];

  // Escalas SVG para 168 horas
  const svgWidth = 880;
  const svgHeight = 290;
  const padLeft = 58;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 34;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const xForHour = (h: number) => padLeft + (h / 167) * plotW;

  // Escala para modo Margem M(t)
  const marginMinBound = Math.min(-config.interchangeImportLimitMW - 2500, result.summary.minMarginMW - 1500);
  const marginMaxBound = Math.max(config.interchangeExportLimitMW + 2500, result.summary.maxMarginMW + 1500);
  const yForMargin = (val: number) =>
    padTop + ((marginMaxBound - val) / Math.max(1, marginMaxBound - marginMinBound)) * plotH;

  // Escala para modo Oferta vs. Demanda
  const maxPowerBound = Math.max(
    ...result.hourlySeries.map((p) => Math.max(p.totalGenPotentialMW, p.totalLoadMW)),
    24000
  ) * 1.08;
  const minPowerBound = 6000;
  const yForPower = (val: number) =>
    padTop + ((maxPowerBound - val) / Math.max(1, maxPowerBound - minPowerBound)) * plotH;

  const buildPolyline = (getter: (pt: HourlyPoint) => number, scaleY: (v: number) => number) =>
    result.hourlySeries.map((pt) => `${xForHour(pt.hourIndex).toFixed(1)},${scaleY(getter(pt)).toFixed(1)}`).join(' ');

  const zeroY = yForMargin(0);
  const importLimitY = yForMargin(-config.interchangeImportLimitMW);
  const exportLimitY = yForMargin(config.interchangeExportLimitMW);

  return (
    <div className="space-y-10">
      {/* Seção 1: Resposta Estruturada à Pergunta 1 (Objetivo do Modelo de Predição) */}
      <section aria-labelledby="heading-objetivo" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="max-w-4xl space-y-3">
          <p className="text-xs font-medium text-sky-800">
            PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6 · Alinhamento Conceitual
          </p>
          <h1 id="heading-objetivo" className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
            Qual é a resposta exata que o modelo de predição busca encontrar até 2035?
          </h1>
          <p className="text-base text-slate-700 leading-relaxed">
            <strong>Não é apenas encontrar quando faltará energia puramente eólica isolada para os data centers.</strong>{' '}
            Como o Nordeste opera integrado ao Sistema Interligado Nacional (SIN) e conta também com geração solar,
            hidrelétrica e térmica, o alvo real do projeto é estimar a distribuição probabilística da{' '}
            <strong>Margem Horária de Geração do Subsistema Nordeste</strong>:
          </p>
        </div>

        <div className="mt-6 py-4 px-5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="font-mono text-sm lg:text-base font-semibold text-slate-900 whitespace-nowrap shrink-0">
            M(t) = G_NE(t) − [ L_base(t) + L_DC(t) ]
          </div>
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>G_NE(t): geração horária provável no NE</span>
            <span aria-hidden="true">·</span>
            <span>L_base(t): demanda normal prevista</span>
            <span aria-hidden="true">·</span>
            <span>L_DC(t): carga em rampa dos data centers</span>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">
              01. Déficit horário vs. Limite do SIN
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Uma margem negativa (<span className="font-mono">M(t) &lt; 0</span>) em horas de calmaria eólica{' '}
              <strong>não significa blecaute imediato</strong>: indica necessidade de importar energia do restante do
              SIN. O <strong>evento crítico</strong> que o modelo mede é a probabilidade de essa importação superar o
              limite físico de intercâmbio das linhas de transmissão.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">
              02. Assimetria: alívio de curtailment
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              O estudo avalia os <strong>dois lados</strong> do problema. Em horas de vento forte e sol alto (
              <span className="font-mono">M(t) &gt;&gt; 0</span>), o Nordeste hoje sofre cortes forçados de geração
              eólica (<em>curtailment / constrained-off</em>). A carga firme 24/7 dos data centers absorve parte desse
              excedente local, mas agrava o déficit nas madrugadas/meses de pouco vento.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">
              03. Expansão eólica via CF(t), não MW bruto
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Não se compara MW eólico instalado diretamente com MW de data center. O modelo prevê o{' '}
              <strong>Fator de Capacidade horário</strong>{' '}
              <span className="font-mono">CF(t) = G_eólica(t) / Cap(t)</span>, multiplica pela trajetória futura de GW
              instalados e responde via Monte Carlo <strong>quantos GW eólicos extras</strong> reduzem o risco crítico.
            </p>
          </div>
        </div>

        {/* Matriz sintética dos 4 blocos de modelagem do Plano Orientador */}
        <div className="mt-8 pt-6 border-t border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Arquitetura de Modelos Preditivos e Camada Estocástica (Plano Orientador · Seções 4 e 7)
            </h2>
            <div className="flex items-center gap-4 text-xs">
              <button
                type="button"
                onClick={onNavigateToDatabases}
                className="font-medium text-sky-700 hover:text-sky-900 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Ver os 10 bancos de dados oficiais →
              </button>
              <button
                type="button"
                onClick={onNavigateToScripts}
                className="font-medium text-slate-700 hover:text-slate-900 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Ver arquitetura dos 6 scripts →
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-4">Bloco do Estudo</th>
                  <th className="py-2.5 px-4">Variável-Alvo (Y)</th>
                  <th className="py-2.5 px-4">Features Principais</th>
                  <th className="py-2.5 pl-4">Algoritmos & Validação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                <tr className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">Modelo A · Demanda</td>
                  <td className="py-3 px-4 font-mono text-xs">L_base(t) horária NE (MW)</td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    Hora, dia da semana, mês, feriados, lags 1/24/168h, médias móveis, temperatura, tendência EPE/PDE
                  </td>
                  <td className="py-3 pl-4 text-xs text-slate-600">
                    SARIMAX (baseline) · Random Forest / XGBoost · LSTM (challenger) · MAE, RMSE
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">Modelo B · Eólica</td>
                  <td className="py-3 px-4 font-mono text-xs">CF(t) = G_pot(t) / Cap(t)</td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    Lags 1/24/168h, média/desvio móvel, sazonalidade (ANOVA), vento ERA5 100m, correção de corte
                  </td>
                  <td className="py-3 pl-4 text-xs text-slate-600">
                    Random Forest / XGBoost ou MLP · LSTM · Backtesting temporal
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">Modelo C · Curtailment</td>
                  <td className="py-3 px-4 font-mono text-xs">P(corte) e Volume (MWh)</td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    Eólica potencial, solar, carga total, excedente local, limite de intercâmbio, hora/mês
                  </td>
                  <td className="py-3 pl-4 text-xs text-slate-600">
                    Classificador RF/XGBoost + Regressão de volume · ROC-AUC, Brier Score
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">Camada Monte Carlo</td>
                  <td className="py-3 px-4 font-mono text-xs">Risco P(Import &gt; Limite) & GW</td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    Blocos meteorológicos inteiros, atraso de usinas SIGA/IBAMA, rampa e utilização dos DCs
                  </td>
                  <td className="py-3 pl-4 text-xs text-slate-600">
                    Importação P95 (MW), MWh cortados e GW eólicos compensatórios até 2035
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Seção 2: Simulador Interativo do Balanço Horário & Monte Carlo 2026–2035 */}
      <section aria-labelledby="heading-simulador" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">
              Laboratório de Sensibilidade Paramétrica · Subsistema Nordeste
            </p>
            <h2 id="heading-simulador" className="text-xl lg:text-2xl font-bold text-slate-900">
              Simulador de Balanço Horário M(t) e Risco de Monte Carlo ({config.targetYear})
            </h2>
          </div>

          {/* Segmented Toggle do Modo de Gráfico */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start lg:self-auto">
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
              Oferta G_NE(t) vs. Carga Total
            </button>
          </div>
        </div>

        {/* Painel de Controles de Cenário */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 py-6 border-b border-slate-200">
          {/* Controle 1: Cenário de Data Centers */}
          <div className="space-y-2">
            <label htmlFor="select-dc-scenario" className="block text-xs font-medium text-slate-700">
              Cenário de Expansão de Data Centers
            </label>
            <select
              id="select-dc-scenario"
              value={config.dcScenario}
              onChange={(e) =>
                onChangeConfig({ ...config, dcScenario: e.target.value as DataCenterScenarioId })
              }
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="none">Sem Data Centers (Baseline Controle)</option>
              <option value="conservative">Conservador (~0.95 GW TI · Confirmados)</option>
              <option value="central">Central (~2.20 GW TI · Ponderado)</option>
              <option value="high">Alto / Stress Test (~4.10 GW TI · Pipeline)</option>
            </select>
            <p className="text-xs text-slate-500 tabular-nums">
              Carga efetiva em {config.targetYear}:{' '}
              <strong className="text-slate-800">{result.summary.effectiveDcLoadMW.toLocaleString('pt-BR')} MW</strong>
            </p>
          </div>

          {/* Controle 2: Expansão Eólica SIGA + IBAMA Offshore */}
          <div className="space-y-2">
            <label htmlFor="select-wind-scenario" className="block text-xs font-medium text-slate-700">
              Trajetória de Expansão Eólica (SIGA)
            </label>
            <select
              id="select-wind-scenario"
              value={config.windScenario}
              onChange={(e) =>
                onChangeConfig({ ...config, windScenario: e.target.value as WindExpansionScenarioId })
              }
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="base">Base (Apenas Operação ~29.6 GW)</option>
              <option value="intermediate">Intermediário (+ Construção SIGA)</option>
              <option value="high">Alto (+ Construção e Outorgados)</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-700 pt-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.includeOffshorePost2031}
                onChange={(e) => onChangeConfig({ ...config, includeOffshorePost2031: e.target.checked })}
                className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
              />
              <span>Somar Eólica Offshore pós-2031 ({result.monteCarlo.offshoreWindGW} GW)</span>
            </label>
          </div>

          {/* Controle 3: Sazonalidade do Vento NE */}
          <div className="space-y-2">
            <label htmlFor="select-regime" className="block text-xs font-medium text-slate-700">
              Regime Sazonal de Ventos no NE
            </label>
            <select
              id="select-regime"
              value={config.seasonalRegime}
              onChange={(e) =>
                onChangeConfig({ ...config, seasonalRegime: e.target.value as SeasonalRegimeId })
              }
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="annual_blend">Transição / Média Anual (CF ~44%)</option>
              <option value="wet_calm">Estação Úmida · Pouco Vento (Mar–Mai)</option>
              <option value="dry_windy">Safra dos Ventos · Seca (Ago–Nov)</option>
            </select>
            <p className="text-xs text-slate-500 tabular-nums">
              Capacidade eólica total: <strong className="text-slate-800">{result.monteCarlo.installedWindGW} GW</strong>{' '}
              · CF médio: <strong className="text-slate-800">{result.summary.avgWindCfPct}%</strong>
            </p>
          </div>

          {/* Controle 4: Ano-Alvo e Limite de Importação SIN */}
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1">
                <label htmlFor="range-target-year">Horizonte Temporal</label>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">{config.targetYear}</span>
              </div>
              <input
                id="range-target-year"
                type="range"
                min={2026}
                max={2035}
                step={1}
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
                min={4500}
                max={10000}
                step={250}
                value={config.interchangeImportLimitMW}
                onChange={(e) => onChangeConfig({ ...config, interchangeImportLimitMW: Number(e.target.value) })}
                className="w-full accent-sky-700 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Barra secundária de parâmetros de Data Center (Equação Seção 5 do PDF) */}
        <div className="py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-6 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <label htmlFor="range-pue" className="font-medium text-slate-700">
                PUE médio:
              </label>
              <input
                id="range-pue"
                type="range"
                min={1.15}
                max={1.5}
                step={0.01}
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
                min={0.5}
                max={0.95}
                step={0.05}
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
            onClick={() =>
              onChangeConfig({
                targetYear: 2035,
                dcScenario: 'central',
                windScenario: 'intermediate',
                includeOffshorePost2031: false,
                seasonalRegime: 'annual_blend',
                pue: 1.28,
                dcUtilization: 0.8,
                isPublishedPowerTotalGrid: false,
                interchangeImportLimitMW: 7000,
                interchangeExportLimitMW: 9500,
              })
            }
            className="text-xs font-medium text-slate-600 hover:text-slate-900 underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Restaurar parâmetros padrão
          </button>
        </div>

        {/* Faixa de 4 Indicadores Principais (Tabular Numerals, Sem Cards Aninhados com Sombra) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 py-6 border-b border-slate-200">
          <div className="pb-4 sm:pb-0 sm:pr-6 space-y-1">
            <p className="text-xs text-slate-500">Risco Anual Importação &gt; Limite (Monte Carlo)</p>
            <p
              className={`text-2xl font-bold font-mono tabular-nums ${
                result.monteCarlo.probCriticalImportAnnualPct >= 25
                  ? 'text-red-700'
                  : result.monteCarlo.probCriticalImportAnnualPct >= 10
                    ? 'text-amber-700'
                    : 'text-emerald-700'
              }`}
            >
              {result.monteCarlo.probCriticalImportAnnualPct.toFixed(1)}%
            </p>
            <p className="text-xs text-slate-600 tabular-nums">
              Sem DCs: {result.monteCarlo.probCriticalWithoutDcPct.toFixed(1)}% ·{' '}
              {result.monteCarlo.probCriticalImportAnnualPct >= 25
                ? 'Alerta de intercâmbio'
                : result.monteCarlo.probCriticalImportAnnualPct >= 10
                  ? 'Atenção moderada'
                  : 'Dentro da margem SIN'}
            </p>
          </div>

          <div className="py-4 sm:py-0 sm:px-6 space-y-1">
            <p className="text-xs text-slate-500">Importação Máxima P95 (Monte Carlo)</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {result.monteCarlo.p95PeakImportMW.toLocaleString('pt-BR')} MW
            </p>
            <p className="text-xs text-slate-600 tabular-nums">
              Mediana P50: {result.monteCarlo.p50PeakImportMW.toLocaleString('pt-BR')} MW · Horas M(t)&lt;0:{' '}
              {result.summary.negativeMarginHoursPerWeek}h/sem
            </p>
          </div>

          <div className="py-4 sm:py-0 sm:px-6 space-y-1">
            <p className="text-xs text-slate-500">Curtailment Eólico Estimado vs. Absorvido</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {result.monteCarlo.expectedCurtailmentWithDcTWh.toFixed(2)} TWh/ano
            </p>
            <p className="text-xs text-slate-600 tabular-nums">
              Redução pelos DCs: −{result.monteCarlo.curtailmentAvoidedByDcGWh.toLocaleString('pt-BR')} GWh/ano (
              {result.monteCarlo.expectedCurtailmentWithoutDcTWh > 0
                ? Math.round(
                    ((result.monteCarlo.expectedCurtailmentWithoutDcTWh -
                      result.monteCarlo.expectedCurtailmentWithDcTWh) /
                      result.monteCarlo.expectedCurtailmentWithoutDcTWh) *
                      100
                  )
                : 0}
              %)
            </p>
          </div>

          <div className="pt-4 sm:pt-0 sm:pl-6 space-y-1">
            <p className="text-xs text-slate-500">Expansão Eólica Extra p/ Compensar Risco</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-sky-800">
              +{result.monteCarlo.requiredExtraWindGWForTargetRisk.toFixed(2)} GW
            </p>
            <p className="text-xs text-slate-600 tabular-nums">
              Convertido pelo CF firme P10 em horas de pouco vento
            </p>
          </div>
        </div>

        {/* Gráfico SVG de 168 horas + Inspetor Horário */}
        <div className="pt-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-4">
              {chartMode === 'margin' ? (
                <>
                  <span className="font-medium text-slate-900">
                    Linha sólida azul: Margem com Data Centers M(t)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Linha tracejada cinza: Margem sem DCs</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-red-700 font-medium">
                    Linha vermelha: Limite crítico de importação (−
                    {config.interchangeImportLimitMW.toLocaleString('pt-BR')} MW)
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium text-emerald-800">Linha verde: Oferta horária G_NE(t)</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-sky-900">Linha escura: Carga Total L_base + L_DC</span>
                  <span aria-hidden="true">·</span>
                  <span>Tracejada: Carga Base sem DCs</span>
                </>
              )}
            </div>
            <div className="font-mono text-xs text-slate-700 tabular-nums">
              Hora selecionada: <strong>{activePoint.dayLabel}</strong> (#{activePoint.hourIndex + 1}/168h)
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              role="img"
              aria-label="Gráfico horário de 168 horas do balanço elétrico do Nordeste"
              className="w-full h-auto min-w-[680px] select-none"
            >
              {/* Fundo de zonas semânticas no modo Margem */}
              {chartMode === 'margin' && (
                <>
                  {/* Zona de Curtailment acima do limite de exportação */}
                  <rect
                    x={padLeft}
                    y={padTop}
                    width={plotW}
                    height={Math.max(0, exportLimitY - padTop)}
                    fill="#fef3c7"
                    fillOpacity="0.45"
                  />
                  {/* Zona crítica abaixo do limite de importação */}
                  <rect
                    x={padLeft}
                    y={Math.min(padTop + plotH, importLimitY)}
                    width={plotW}
                    height={Math.max(0, padTop + plotH - importLimitY)}
                    fill="#fee2e2"
                    fillOpacity="0.55"
                  />
                  {/* Linha Zero M(t) = 0 */}
                  <line
                    x1={padLeft}
                    y1={zeroY}
                    x2={padLeft + plotW}
                    y2={zeroY}
                    stroke="#64748b"
                    strokeWidth="1"
                  />
                  <text x={padLeft - 8} y={zeroY + 4} textAnchor="end" className="fill-slate-600 text-[10px] font-mono">
                    0 MW
                  </text>

                  {/* Linha Limite de Exportação / Curtailment */}
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

                  {/* Linha Limite de Importação SIN */}
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
                    Limite Crítico de Importação SIN (−{config.interchangeImportLimitMW} MW)
                  </text>

                  {/* Curva sem Data Centers */}
                  <polyline
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                    points={buildPolyline((p) => p.marginWithoutDcMW, yForMargin)}
                  />
                  {/* Curva com Data Centers */}
                  <polyline
                    fill="none"
                    stroke="#0369a1"
                    strokeWidth="2.2"
                    points={buildPolyline((p) => p.marginWithDcMW, yForMargin)}
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
                          {Math.round(val / 1000)} GW
                        </text>
                      </g>
                    );
                  })}

                  <polyline
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="1.4"
                    strokeDasharray="3 3"
                    points={buildPolyline((p) => p.baseLoadMW, yForPower)}
                  />
                  <polyline
                    fill="none"
                    stroke="#0f172a"
                    strokeWidth="2"
                    points={buildPolyline((p) => p.totalLoadMW, yForPower)}
                  />
                  <polyline
                    fill="none"
                    stroke="#059669"
                    strokeWidth="2.2"
                    points={buildPolyline((p) => p.totalGenPotentialMW, yForPower)}
                  />
                </>
              )}

              {/* Divisórias diárias (Seg..Dom) */}
              {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
                const x = xForHour(dayIdx * 24);
                return (
                  <g key={dayIdx}>
                    <line
                      x1={x}
                      y1={padTop}
                      x2={x}
                      y2={padTop + plotH}
                      stroke="#cbd5e1"
                      strokeOpacity="0.6"
                      strokeWidth="1"
                    />
                    <text x={x + 6} y={svgHeight - 10} className="fill-slate-500 text-[11px] font-sans">
                      {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][dayIdx]}
                    </text>
                  </g>
                );
              })}

              {/* Cursor da hora inspecionada */}
              <line
                x1={xForHour(activePoint.hourIndex)}
                y1={padTop}
                x2={xForHour(activePoint.hourIndex)}
                y2={padTop + plotH}
                stroke="#0f172a"
                strokeWidth="1.2"
              />
              <circle
                cx={xForHour(activePoint.hourIndex)}
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

              {/* Borda da área de plotagem */}
              <rect
                x={padLeft}
                y={padTop}
                width={plotW}
                height={plotH}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth="1"
              />
            </svg>
          </div>

          {/* Controle deslizante de inspeção horária + Leitura instantânea da hora */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label htmlFor="range-inspect-hour" className="text-xs font-medium text-slate-700 whitespace-nowrap">
                Inspecionar hora da semana (0h–167h):
              </label>
              <input
                id="range-inspect-hour"
                type="range"
                min={0}
                max={167}
                value={inspectedHour}
                onChange={(e) => setInspectedHour(Number(e.target.value))}
                className="w-full accent-slate-900 cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-1 text-xs tabular-nums">
              <div>
                <span className="text-slate-500 block">Instante</span>
                <span className="font-mono font-semibold text-slate-900">{activePoint.dayLabel}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Carga Base + DCs</span>
                <span className="font-mono font-semibold text-slate-900">
                  {activePoint.baseLoadMW.toLocaleString('pt-BR')} + {activePoint.dcLoadMW.toLocaleString('pt-BR')} MW
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Eólica (CF {Math.round(activePoint.windCapacityFactor * 100)}%)</span>
                <span className="font-mono font-semibold text-slate-900">
                  {activePoint.windGenPotentialMW.toLocaleString('pt-BR')} MW
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Solar + Hidro/Térm.</span>
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
                    ? ' Déficit > Intercâmbio!'
                    : activePoint.marginWithDcMW < 0
                      ? 'Importando do SIN'
                      : activePoint.curtailmentWithDcMW > 0
                        ? `Curtailment (${activePoint.curtailmentWithDcMW} MW)`
                        : 'Exportando normal'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
