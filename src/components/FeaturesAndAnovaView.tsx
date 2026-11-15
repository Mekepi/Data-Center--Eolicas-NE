import React, { useMemo, useState } from 'react';
import { usePipelineSsot } from '../data/pipelineSsotContext';
import { downloadDelimitedCsv, downloadTextFile } from '../utils/csvExport';
import { AnovaCorrelationsPanel } from './AnovaCorrelationsPanel';
import { computeFeaturesAnovaKpis } from './featuresAnovaKpis';
import { MonteCarlo2035Panel } from './MonteCarlo2035Panel';
import { SensitivityPasso5Panel } from './SensitivityPasso5Panel';
import { Validation2025Panel } from './Validation2025Panel';

type SubViewMode = 'validation_2025' | 'monte_carlo_2035' | 'passo5_sensitivity' | 'features_anova';

export const FeaturesAndAnovaView: React.FC = () => {
  const { ssot } = usePipelineSsot();
  const anovaResults = ssot.anovaTestResults;
  const monthlyProfiles = ssot.monthlyWindProfiles;
  const featureCorrelations = ssot.featureCorrelations;
  const modelABenchmark = ssot.modelABenchmark2025;
  const modelBBenchmark = ssot.modelBBenchmark2025;
  const modelCBenchmark = ssot.modelCBenchmark2025;
  const hourly2025 = ssot.hourlyValidation2025Profile;
  const mc12Scenarios = ssot.monteCarlo12Scenarios2035;
  const compWindCurve = ssot.compensatoryWindCurve2035;
  const annualTimeline = ssot.annualRiskTimeline2026_2035;
  const txSensitivity = ssot.transmissionSensitivity2035;
  const h2vSensitivity = ssot.h2vSynergySensitivity2035;
  const aneelVsOns = ssot.aneelVsOnsWindIndicators2015_2035;
  const finalReportMd = ssot.passo5FinalExecutiveReportMd;

  const [subView, setSubView] = useState<SubViewMode>('validation_2025');
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);

  const kpis = useMemo(() => computeFeaturesAnovaKpis(ssot), [ssot]);

  const notifyDownload = (filename: string) => {
    setDownloadFeedback(`Arquivo ${filename} baixado`);
    window.setTimeout(() => setDownloadFeedback(null), 2500);
  };

  const handleExportCsv = (
    type: 'anova' | 'monthly' | 'correlation' | 'benchmarks2025' | 'mc2035' | 'passo5_csv' | 'passo5_md'
  ) => {
    let filename = '';

    if (type === 'anova') {
      filename = 'relatorio_anova_significancia.csv';
      downloadDelimitedCsv(
        filename,
        [
          'variavel_analisada',
          'fator_agrupador',
          'estatistica_f',
          'p_valor',
          'eta_squared_pct',
          'significativo_alpha_01',
          'conclusao_tecnica',
        ],
        anovaResults.map((r) => [
          r.targetVariable,
          r.groupingFactor,
          r.fStatistic,
          r.pValue,
          r.etaSquaredPct,
          r.isSignificantAlpha01,
          r.technicalInterpretation,
        ])
      );
    } else if (type === 'monthly') {
      filename = 'perfil_mensal_sazonalidade_eolica_ne.csv';
      downloadDelimitedCsv(
        filename,
        [
          'mes',
          'nome_mes',
          'cf_medio',
          'cf_desvio_padrao',
          'cf_p10',
          'cf_p50_mediana',
          'cf_p90',
          'carga_base_media_mw',
          'curtailment_medio_mw',
          'regime_sazonal',
        ],
        monthlyProfiles.map((m) => [
          m.month,
          m.monthName,
          m.avgCapacityFactor,
          m.stdCapacityFactor,
          m.p10CapacityFactor,
          m.p50MedianCapacityFactor,
          m.p90CapacityFactor,
          m.avgBaseLoadMW,
          m.avgCurtailmentMW,
          m.seasonalRegime,
        ])
      );
    } else if (type === 'benchmarks2025') {
      filename = 'validacao_out_of_time_2025_modelos_a_b_c.csv';
      const rowsA = modelABenchmark.map((m) => [
        'Modelo A (Demanda MW)',
        m.horizon,
        m.architecture,
        m.family,
        m.maeMW,
        m.rmseMW,
        m.mapePct,
        m.r2Score,
        m.peakHourMaeMW,
        null,
        null,
        null,
        null,
        null,
      ]);
      const rowsB = modelBBenchmark.map((m) => [
        'Modelo B (CF Eolico)',
        m.horizon,
        m.architecture,
        m.family,
        m.maeCF,
        m.rmseCF,
        null,
        m.r2Score,
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
      const rowsC = modelCBenchmark.map((m) => [
        'Modelo C (Curtailment Hurdle 2 Estagios)',
        'Out-of-Time 2025 (Horário)',
        m.architecture,
        m.family,
        m.maeGlobalMW,
        null,
        null,
        m.r2Volume,
        null,
        m.rocAuc,
        m.brierScore,
        m.f1Score,
        m.realCurtailed2025TWh,
        m.predCurtailed2025TWh,
      ]);
      downloadDelimitedCsv(
        filename,
        [
          'bloco',
          'horizonte',
          'arquitetura',
          'familia',
          'mae',
          'rmse',
          'mape_pct',
          'r2',
          'mae_ponta_18h_21h_mw',
          'roc_auc',
          'brier_score',
          'f1_score',
          'curtailment_real_2025_twh',
          'curtailment_pred_2025_twh',
        ],
        [...rowsA, ...rowsB, ...rowsC]
      );
    } else if (type === 'mc2035') {
      filename = 'matriz_cenarios_monte_carlo_2035.csv';
      downloadDelimitedCsv(
        filename,
        [
          'cenario_completo',
          'id_dc',
          'carga_dc_2035_mw',
          'cap_eolica_2035_mw',
          'prob_import_critica_pct',
          'lole_horas_ano',
          'import_p50_mw',
          'import_p95_mw',
          'curtailment_twh_ano',
          'curtailment_absorvido_dc_gwh',
          'gw_eolico_compensatorio',
        ],
        mc12Scenarios.map((s) => [
          s.scenarioName,
          s.dcScenarioId,
          s.dcLoadMW,
          s.windCapacityMW,
          s.probExceedInterchangePct,
          s.loleCriticalHoursYear,
          s.importP50MW,
          s.importP95MW,
          s.curtailmentWithDcTWh,
          s.curtailmentAvoidedGWh,
          s.compensatoryWindExpansionGW,
        ])
      );
    } else if (type === 'passo5_csv') {
      filename = 'sensibilidade_transmissao_h2v_aneel_ons_2035.csv';
      const txRows = txSensitivity.map((r) => [
        'Transmissao_SIN',
        r.configId,
        r.importLimitMW,
        r.exportLimitMW,
        r.probCriticalImportPct,
        r.importP95MW,
        r.curtailmentWithDcTWh,
        `${r.curtailmentAvoidedGWh} GWh`,
        r.compensatoryWindGW,
      ]);
      const h2vRows = h2vSensitivity.map((r) => [
        'H2V_vs_DataCenters',
        r.scenarioId,
        r.dcLoadMW,
        r.h2vNominalMW,
        r.probCriticalImportPct,
        r.importP95MW,
        r.remainingCurtailmentTWh,
        `${r.totalAbsorbedCurtailmentTWh} TWh`,
        r.compensatoryWindGW,
      ]);
      downloadDelimitedCsv(
        filename,
        [
          'secao',
          'identificador',
          'limite_import_ou_dc_mw',
          'limite_export_ou_h2v_mw',
          'prob_import_critica_pct',
          'import_p95_mw',
          'curtailment_restante_twh',
          'curtailment_evitado_ou_absorvido',
          'eolica_extra_req_gw',
        ],
        [...txRows, ...h2vRows]
      );
    } else if (type === 'passo5_md') {
      filename = 'relatorio_final_consolidado_ptc3567_grupo6.md';
      downloadTextFile(finalReportMd, filename, 'text/markdown;charset=utf-8;');
    } else {
      filename = 'matriz_correlacao_features.csv';
      downloadDelimitedCsv(
        filename,
        ['feature', 'descricao', 'categoria', 'corr_carga_base', 'corr_cf_eolica', 'corr_curtailment'],
        featureCorrelations.map((c) => [
          c.featureName,
          c.featureDescription,
          c.roleInModel,
          c.corrBaseLoad,
          c.corrWindCF,
          c.corrCurtailment,
        ])
      );
    }

    notifyDownload(filename);
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho Unificado Passos 3, 4 e 5 com Seletor de Abas */}
      <section aria-labelledby="heading-passo34-intro" className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="space-y-1.5 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
              Passos 03, 04 & 05 Concluídos · Dados Reais ONS/ANEEL {ssot.config.historyStartYear}–
              {ssot.config.historyEndYear}, Monte Carlo & Sensibilidade {ssot.config.targetEndYear}
            </p>
            <h1 id="heading-passo34-intro" className="text-xl lg:text-2xl font-bold tracking-tight text-slate-900">
              Validação Out-of-Time {ssot.config.baselineYear}, Monte Carlo {ssot.config.targetEndYear} & Sensibilidade
              (Transmissão / H2V)
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Modelos lineares e não-lineares (<span className="font-mono">{ssot.lineage.comparativeNonLinearArchitecture}</span>,{' '}
              <span className="font-mono">ResidualMLPClassifier</span> L-BFGS-B e{' '}
              <span className="font-mono">HistogramGBDT</span> em <span className="font-mono">numpy/scipy</span>)
              treinados em{' '}
              <strong>
                {ssot.config.historyStartYear}–{ssot.config.historyEndYear - 1} (
                {ssot.lineage.trainHours.toLocaleString('pt-BR')} h)
              </strong>
              , validados às cegas nas{' '}
              <strong>
                {ssot.lineage.testHours.toLocaleString('pt-BR')} h de {ssot.config.baselineYear}
              </strong>
              , acoplados ao <strong>Monte Carlo {ssot.config.targetEndYear}</strong> e à{' '}
              <strong>Análise de Sensibilidade de Intercâmbio e Hidrogênio Verde (Passo 5)</strong>.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Subseções de Modelagem, Monte Carlo e Sensibilidade"
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start xl:self-center shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={subView === 'validation_2025'}
              onClick={() => setSubView('validation_2025')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                subView === 'validation_2025' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              1. Validação Cega 2025
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subView === 'monte_carlo_2035'}
              onClick={() => setSubView('monte_carlo_2035')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                subView === 'monte_carlo_2035' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              2. Matriz Monte Carlo 2035
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subView === 'passo5_sensitivity'}
              onClick={() => setSubView('passo5_sensitivity')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                subView === 'passo5_sensitivity' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              3. Passo 5 · Sensibilidade & Relatório
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subView === 'features_anova'}
              onClick={() => setSubView('features_anova')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                subView === 'features_anova' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              4. Features & ANOVA
            </button>
          </div>
        </div>

        {/* Faixa de 4 KPIs Consolidados dos Passos 3 e 4 (calculados dinamicamente via SSOT) */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500 block">Modelo A · Demanda 2025 (ResMLP)</span>
            <span className="text-xl font-bold font-mono text-slate-900 mt-0.5 block">
              MAPE {kpis.a1h ? kpis.a1h.mapePct.toFixed(2).replace('.', ',') : '—'}%
            </span>
            <span className="text-xs text-slate-600 mt-0.5 block">
              {kpis.a1h && kpis.a24h
                ? `MAE ${kpis.a1h.maeMW.toFixed(1).replace('.', ',')} MW (1h) e ${kpis.a24h.mapePct.toFixed(2).replace('.', ',')}% (24h) · R² = ${kpis.a1h.r2Score.toFixed(4).replace('.', ',')}`
                : 'SSOT Model A'}
            </span>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500 block">Modelo B · CF Eólico 2025 (ResMLP)</span>
            <span className="text-xl font-bold font-mono text-sky-800 mt-0.5 block">
              R² = {kpis.b1h ? kpis.b1h.r2Score.toFixed(4).replace('.', ',') : '—'}
            </span>
            <span className="text-xs text-slate-600 mt-0.5 block">
              {kpis.b1h
                ? `MAE = ${kpis.b1h.maeCF.toFixed(4).replace('.', ',')} (${kpis.b1h.equivPowerMaeMW.toFixed(1).replace('.', ',')} MW equiv.) sem viés de corte`
                : 'SSOT Model B'}
            </span>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500 block">Modelo C · Curtailment Real 2025</span>
            <span className="text-xl font-bold font-mono text-amber-700 mt-0.5 block">
              AUC = {kpis.cBest ? kpis.cBest.rocAuc.toFixed(4).replace('.', ',') : '—'}
            </span>
            <span className="text-xs text-slate-600 mt-0.5 block">
              {kpis.cBest
                ? `Brier = ${kpis.cBest.brierScore.toFixed(4).replace('.', ',')} · F1 = ${kpis.cBest.f1Score.toFixed(4).replace('.', ',')} (${kpis.cBest.realCurtailed2025TWh.toFixed(2).replace('.', ',')} TWh em 2025)`
                : 'SSOT Model C'}
            </span>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500 block">Passo 4 · Expansão Compensatória 2035</span>
            <span className="text-xl font-bold font-mono text-emerald-800 mt-0.5 block">
              +{kpis.mcCentral ? kpis.mcCentral.compensatoryWindExpansionGW.toFixed(2).replace('.', ',') : '—'} GW
            </span>
            <span className="text-xs text-slate-600 mt-0.5 block">
              {kpis.mcCentral
                ? `Cenário Central DC (${(kpis.mcCentral.dcLoadMW / 1000).toFixed(2).replace('.', ',')} GW) + SIGA Interm. (−${(kpis.mcCentral.curtailmentAvoidedGWh / 1000).toFixed(2).replace('.', ',')} TWh)`
                : 'SSOT Monte Carlo'}
            </span>
          </div>
        </div>
      </section>

      {subView === 'validation_2025' && (
        <Validation2025Panel
          trainHours={ssot.lineage.trainHours}
          testHours={ssot.lineage.testHours}
          hourly2025={hourly2025}
          modelABenchmark={modelABenchmark}
          modelBBenchmark={modelBBenchmark}
          modelCBenchmark={modelCBenchmark}
          kpis={kpis}
          downloadFeedback={downloadFeedback}
          onExportBenchmarks={() => handleExportCsv('benchmarks2025')}
        />
      )}

      {subView === 'monte_carlo_2035' && (
        <MonteCarlo2035Panel
          mc12Scenarios={mc12Scenarios}
          compWindCurve={compWindCurve}
          annualTimeline={annualTimeline}
          kpis={kpis}
          downloadFeedback={downloadFeedback}
          onExportMc2035={() => handleExportCsv('mc2035')}
        />
      )}

      {subView === 'passo5_sensitivity' && (
        <SensitivityPasso5Panel
          interchangeImportLimitMW={ssot.config.interchangeImportLimitMW}
          txSensitivity={txSensitivity}
          h2vSensitivity={h2vSensitivity}
          aneelVsOns={aneelVsOns}
          kpis={kpis}
          downloadFeedback={downloadFeedback}
          onExportPasso5Csv={() => handleExportCsv('passo5_csv')}
          onExportPasso5Md={() => handleExportCsv('passo5_md')}
        />
      )}

      {subView === 'features_anova' && (
        <AnovaCorrelationsPanel
          anovaResults={anovaResults}
          monthlyProfiles={monthlyProfiles}
          featureCorrelations={featureCorrelations}
          downloadFeedback={downloadFeedback}
          onExportAnova={() => handleExportCsv('anova')}
          onExportMonthly={() => handleExportCsv('monthly')}
          onExportCorrelations={() => handleExportCsv('correlation')}
        />
      )}
    </div>
  );
};
