import React, { useMemo, useState } from 'react';
import { usePipelineSsot } from '../data/pipelineSsotContext';

type SubViewMode = 'validation_2025' | 'monte_carlo_2035' | 'passo5_sensitivity' | 'features_anova';
type ValidationChartMetric = 'load_mw' | 'wind_cf' | 'curtailment_mw';

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
  const [valChartMetric, setValChartMetric] = useState<ValidationChartMetric>('load_mw');
  const [selectedDcFilter, setSelectedDcFilter] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);

  const kpis = useMemo(() => {
    const a1h = modelABenchmark.find((r) => r.horizon.includes('1h') && r.architecture.includes('ResMLP'));
    const a24h = modelABenchmark.find((r) => r.horizon.includes('24h') && r.architecture.includes('ResMLP'));
    const b1h = modelBBenchmark.find((r) => r.horizon.includes('1h') && r.architecture.includes('ResMLP'));
    const cBest = modelCBenchmark.find((r) => r.architecture.includes('ResMLP')) ?? modelCBenchmark[0];
    const intermWindMW = ssot.config.baseWindOnshore2026MW + ssot.config.windExpansionOnshoreMW.intermediate;
    const mcCentral = mc12Scenarios.find(
      (s) => s.dcScenarioId === 'central' && Math.abs(s.windCapacityMW - intermWindMW) < 100
    );
    const ind2024 = aneelVsOns.find((r) => r.year === 2024);
    const ind2025 = aneelVsOns.find((r) => r.year === 2025);
    return { a1h, a24h, b1h, cBest, mcCentral, intermWindMW, ind2024, ind2025 };
  }, [modelABenchmark, modelBBenchmark, modelCBenchmark, mc12Scenarios, aneelVsOns, ssot.config]);

  const filteredCorrelations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return featureCorrelations.filter((item) => {
      if (selectedCategory !== 'all' && item.roleInModel !== selectedCategory) return false;
      if (!q) return true;
      return (
        item.featureName.toLowerCase().includes(q) ||
        item.featureDescription.toLowerCase().includes(q) ||
        item.roleInModel.toLowerCase().includes(q)
      );
    });
  }, [featureCorrelations, selectedCategory, searchQuery]);

  const filteredMcScenarios = useMemo(() => {
    if (selectedDcFilter === 'all') return mc12Scenarios;
    return mc12Scenarios.filter((s) => s.dcScenarioId === selectedDcFilter);
  }, [mc12Scenarios, selectedDcFilter]);

  const handleExportCsv = (
    type: 'anova' | 'monthly' | 'correlation' | 'benchmarks2025' | 'mc2035' | 'passo5_csv' | 'passo5_md'
  ) => {
    let filename = '';
    let content = '';
    const escape = (val: string | number | boolean) => `"${String(val).replace(/"/g, '""')}"`;

    if (type === 'anova') {
      filename = 'relatorio_anova_significancia.csv';
      const headers = [
        'variavel_analisada',
        'fator_agrupador',
        'estatistica_f',
        'p_valor',
        'eta_squared_pct',
        'significativo_alpha_01',
        'conclusao_tecnica',
      ];
      const rows = anovaResults.map((r) =>
        [
          escape(r.targetVariable),
          escape(r.groupingFactor),
          r.fStatistic,
          r.pValue,
          r.etaSquaredPct,
          r.isSignificantAlpha01,
          escape(r.technicalInterpretation),
        ].join(';')
      );
      content = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    } else if (type === 'monthly') {
      filename = 'perfil_mensal_sazonalidade_eolica_ne.csv';
      const headers = [
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
      ];
      const rows = monthlyProfiles.map((m) =>
        [
          m.month,
          escape(m.monthName),
          m.avgCapacityFactor,
          m.stdCapacityFactor,
          m.p10CapacityFactor,
          m.p50MedianCapacityFactor,
          m.p90CapacityFactor,
          m.avgBaseLoadMW,
          m.avgCurtailmentMW,
          escape(m.seasonalRegime),
        ].join(';')
      );
      content = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    } else if (type === 'benchmarks2025') {
      filename = 'validacao_out_of_time_2025_modelos_a_b_c.csv';
      const headers = ['bloco', 'horizonte', 'arquitetura', 'familia', 'mae', 'rmse', 'r2'];
      const rowsA = modelABenchmark.map((m) =>
        ['Modelo A (Demanda MW)', escape(m.horizon), escape(m.architecture), escape(m.family), m.maeMW, m.rmseMW, m.r2Score].join(';')
      );
      const rowsB = modelBBenchmark.map((m) =>
        ['Modelo B (CF Eolico)', escape(m.horizon), escape(m.architecture), escape(m.family), m.maeCF, m.rmseCF, m.r2Score].join(';')
      );
      content = '\uFEFF' + [headers.join(';'), ...rowsA, ...rowsB].join('\n');
    } else if (type === 'mc2035') {
      filename = 'matriz_cenarios_monte_carlo_2035.csv';
      const headers = [
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
      ];
      const rows = mc12Scenarios.map((s) =>
        [
          escape(s.scenarioName),
          escape(s.dcScenarioId),
          s.dcLoadMW,
          s.windCapacityMW,
          s.probExceedInterchangePct,
          s.loleCriticalHoursYear,
          s.importP50MW,
          s.importP95MW,
          s.curtailmentWithDcTWh,
          s.curtailmentAvoidedGWh,
          s.compensatoryWindExpansionGW,
        ].join(';')
      );
      content = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    } else if (type === 'passo5_csv') {
      filename = 'sensibilidade_transmissao_h2v_aneel_ons_2035.csv';
      const txHeaders = [
        'secao',
        'identificador',
        'limite_import_ou_dc_mw',
        'limite_export_ou_h2v_mw',
        'prob_import_critica_pct',
        'import_p95_mw',
        'curtailment_restante_twh',
        'curtailment_evitado_ou_absorvido',
        'eolica_extra_req_gw',
      ];
      const txRows = txSensitivity.map((r) =>
        [
          escape('Transmissao_SIN'),
          escape(r.configId),
          r.importLimitMW,
          r.exportLimitMW,
          r.probCriticalImportPct,
          r.importP95MW,
          r.curtailmentWithDcTWh,
          `${r.curtailmentAvoidedGWh} GWh`,
          r.compensatoryWindGW,
        ].join(';')
      );
      const h2vRows = h2vSensitivity.map((r) =>
        [
          escape('H2V_vs_DataCenters'),
          escape(r.scenarioId),
          r.dcLoadMW,
          r.h2vNominalMW,
          r.probCriticalImportPct,
          r.importP95MW,
          r.remainingCurtailmentTWh,
          `${r.totalAbsorbedCurtailmentTWh} TWh`,
          r.compensatoryWindGW,
        ].join(';')
      );
      content = '\uFEFF' + [txHeaders.join(';'), ...txRows, ...h2vRows].join('\n');
    } else if (type === 'passo5_md') {
      filename = 'relatorio_final_consolidado_ptc3567_grupo6.md';
      content = finalReportMd;
    } else {
      filename = 'matriz_correlacao_features.csv';
      const headers = ['feature', 'descricao', 'categoria', 'corr_carga_base', 'corr_cf_eolica', 'corr_curtailment'];
      const rows = featureCorrelations.map((c) =>
        [
          escape(c.featureName),
          escape(c.featureDescription),
          escape(c.roleInModel),
          c.corrBaseLoad,
          c.corrWindCF,
          c.corrCurtailment,
        ].join(';')
      );
      content = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    }

    const mimeType = type === 'passo5_md' ? 'text/markdown;charset=utf-8;' : 'text/csv;charset=utf-8;';
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setDownloadFeedback(`Arquivo ${filename} baixado`);
    window.setTimeout(() => setDownloadFeedback(null), 2500);
  };

  // Configuração do gráfico SVG de 24h da validação cega de 2025
  const svgW = 860;
  const svgH = 260;
  const padL = 56;
  const padR = 24;
  const padT = 20;
  const padB = 34;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const xForH = (h: number) => padL + (h / 23) * plotW;

  const buildHourlyPoints = (getter: (pt: (typeof hourly2025)[0]) => number, minV: number, maxV: number) =>
    hourly2025.map((pt) => {
      const x = xForH(pt.hour);
      const y = padT + ((maxV - getter(pt)) / Math.max(1e-6, maxV - minV)) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

  return (
    <div className="space-y-6">
      {/* Cabeçalho Unificado Passos 3 e 4 com Seletor de Abas */}
      <section aria-labelledby="heading-passo34-intro" className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="space-y-1.5 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
              Passos 03, 04 & 05 Concluídos · Dados Reais ONS/ANEEL 2015–2025, Monte Carlo & Sensibilidade 2035
            </p>
            <h1 id="heading-passo34-intro" className="text-xl lg:text-2xl font-bold tracking-tight text-slate-900">
              Validação Out-of-Time 2025, Monte Carlo 2035 & Sensibilidade (Transmissão / H2V)
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Modelos lineares e não-lineares (<span className="font-mono">ResidualMLPRegressor</span> L-BFGS-B e{' '}
              <span className="font-mono">HistogramGBDT</span> em <span className="font-mono">numpy/scipy</span>)
              treinados em <strong>2015–2024 ({ssot.lineage.trainHours.toLocaleString('pt-BR')} h)</strong>, validados às
              cegas nas <strong>{ssot.lineage.testHours.toLocaleString('pt-BR')} h de 2025</strong>, acoplados ao{' '}
              <strong>Monte Carlo 2035</strong> e à{' '}
              <strong>Análise de Sensibilidade de Intercâmbio e Hidrogênio Verde (Passo 5)</strong>.
            </p>
          </div>

          {/* Navegação interna entre os 4 módulos dos Passos 3, 4 e 5 */}
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

      {/* ===================================================================== */}
      {/* SUBVIEW 1: VALIDAÇÃO OUT-OF-TIME CEGA 2025 (MODELOS A, B e C)         */}
      {/* ===================================================================== */}
      {subView === 'validation_2025' && (
        <div className="space-y-6">
          {/* Gráfico Interativo de 24h: Real 2025 vs Predito Out-of-Time 2025 */}
          <section aria-labelledby="heading-hourly-2025" className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 id="heading-hourly-2025" className="text-lg font-bold text-slate-900">
                  Perfil Horário Médio de 2025: Verificado ONS vs. Previsto Out-of-Time (8.760 horas)
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Comparação direta entre os valores reais medidos pelo ONS em 2025 e a previsão cega dos modelos treinados até 2024.
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
                  onClick={() => handleExportCsv('benchmarks2025')}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {downloadFeedback ?? 'Exportar Métricas 2025 (.csv)'}
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-5">
                  {valChartMetric === 'load_mw' && (
                    <>
                      <span className="font-semibold text-slate-900">Linha sólida escura: Carga Real ONS 2025 (MW)</span>
                      <span className="font-semibold text-sky-700">Tracejada azul: Previsão Não-Linear ResMLP (MAPE 1,22%)</span>
                    </>
                  )}
                  {valChartMetric === 'wind_cf' && (
                    <>
                      <span className="font-semibold text-slate-900">Linha sólida escura: CF Potencial Real 2025 (%)</span>
                      <span className="font-semibold text-emerald-700">Tracejada verde: Previsão Não-Linear ResMLP (R² = 0,9853)</span>
                    </>
                  )}
                  {valChartMetric === 'curtailment_mw' && (
                    <>
                      <span className="font-semibold text-rose-700">Linha sólida vermelha: Curtailment Real ONS 2025 (MWmed)</span>
                      <span className="font-semibold text-slate-900">Tracejada escura: Curtailment Predito Não-Linear (GBDT+ResMLP)</span>
                      <span className="text-sky-700">Pontilhada azul: Baseline Linear Hurdle</span>
                      <span className="text-amber-600">Linha âmbar: Geração Solar Horária 2025 (MW)</span>
                    </>
                  )}
                </div>
                <span className="font-mono text-slate-500">Média horária das 8.760h de 2025 (00h–23h)</span>
              </div>

              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${svgW} ${svgH}`}
                  role="img"
                  aria-label="Perfil horário médio de 2025 comparando valores verificados pelo ONS e predições cegas"
                  className="w-full h-auto min-w-[660px] select-none"
                >
                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                    const y = padT + frac * plotH;
                    let label = '';
                    if (valChartMetric === 'load_mw') {
                      const v = 15000 - frac * (15000 - 11500);
                      label = `${(v / 1000).toFixed(1)} GW`;
                    } else if (valChartMetric === 'wind_cf') {
                      const v = 60 - frac * (60 - 30);
                      label = `${v.toFixed(0)}%`;
                    } else {
                      const v = 7200 - frac * 7200;
                      label = `${(v / 1000).toFixed(1)} GW`;
                    }
                    return (
                      <g key={frac}>
                        <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                        <text x={padL - 8} y={y + 3} textAnchor="end" className="fill-slate-500 text-[10px] font-mono">
                          {label}
                        </text>
                      </g>
                    );
                  })}

                  {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((h) => {
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
                        points={buildHourlyPoints((p) => p.realLoadMW, 11500, 15000)}
                      />
                      <polyline
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth="2"
                        strokeDasharray="6 3"
                        points={buildHourlyPoints((p) => p.predLoadNonLinearMW, 11500, 15000)}
                      />
                    </>
                  )}

                  {valChartMetric === 'wind_cf' && (
                    <>
                      <polyline
                        fill="none"
                        stroke="#0f172a"
                        strokeWidth="2.4"
                        points={buildHourlyPoints((p) => p.realWindCfPct, 30, 60)}
                      />
                      <polyline
                        fill="none"
                        stroke="#059669"
                        strokeWidth="2"
                        strokeDasharray="6 3"
                        points={buildHourlyPoints((p) => p.predWindCfNonLinearPct, 30, 60)}
                      />
                    </>
                  )}

                  {valChartMetric === 'curtailment_mw' && (
                    <>
                      <polyline
                        fill="none"
                        stroke="#d97706"
                        strokeWidth="1.8"
                        points={buildHourlyPoints((p) => p.realSolarMW, 0, 7200)}
                      />
                      <polyline
                        fill="none"
                        stroke="#be123c"
                        strokeWidth="2.4"
                        points={buildHourlyPoints((p) => p.realCurtailmentMW, 0, 7200)}
                      />
                      <polyline
                        fill="none"
                        stroke="#0f172a"
                        strokeWidth="2"
                        strokeDasharray="5 3"
                        points={buildHourlyPoints((p) => p.predCurtailmentNonLinearMW, 0, 7200)}
                      />
                      <polyline
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth="1.6"
                        strokeDasharray="2 3"
                        points={buildHourlyPoints((p) => p.predCurtailmentLinearMW, 0, 7200)}
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
            {/* Benchmark Modelo A (Demanda Base NE) */}
            <section aria-labelledby="heading-bench-a" className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="pb-4 border-b border-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
                  Script 04 · Modelo A (Demanda Base Normal NE)
                </p>
                <h3 id="heading-bench-a" className="text-lg font-bold text-slate-900 mt-0.5">
                  Benchmark Out-of-Time 2025: Linear vs. Redes Neurais & GBDT
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Treino: 2015–2024 (87.476 h) · Teste cego: 2025 (8.760 h) · Projeção PDE 2035: 18.003,4 MW médios.
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

            {/* Benchmark Modelo B (Fator de Capacidade Eólico Potencial) */}
            <section aria-labelledby="heading-bench-b" className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="pb-4 border-b border-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                  Script 05 · Modelo B (Fator de Capacidade Eólico CF_pot)
                </p>
                <h3 id="heading-bench-b" className="text-lg font-bold text-slate-900 mt-0.5">
                  Benchmark Out-of-Time 2025: CF(t) Reconstituído (Sem Viés de Corte)
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

          {/* Benchmark Modelo C (Curtailment Hurdle 2 Estágios sobre Dados Reais ONS 2023-2025) */}
          <section aria-labelledby="heading-bench-c" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
            <div className="pb-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                  Script 05 · Modelo C (Restrição de Operação Constrained-Off Eólico Real ONS)
                </p>
                <h3 id="heading-bench-c" className="text-lg font-bold text-slate-900 mt-0.5">
                  Arquitetura Hurdle em 2 Estágios: Probabilidade P(Corte &gt; 50 MW) e Volume Cortado (MWh)
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-600 tabular-nums">
                2024 Real: {kpis.ind2024 ? `${kpis.ind2024.annualCurtailmentLossTWh.toFixed(2).replace('.', ',')} TWh` : '—'} · 2025 Real:{' '}
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
      )}

      {/* ===================================================================== */}
      {/* SUBVIEW 2: SIMULAÇÃO MONTE CARLO 2035 & EXPANSÃO EÓLICA COMPENSATÓRIA */}
      {/* ===================================================================== */}
      {subView === 'monte_carlo_2035' && (
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
                  <option value="conservative">2. DC Conservador (469 MW rede)</option>
                  <option value="central">3. DC Central (1.597 MW rede)</option>
                  <option value="high">4. DC Stress Test / IA (3.414 MW rede)</option>
                </select>

                <button
                  type="button"
                  onClick={() => handleExportCsv('mc2035')}
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
                    <th className="py-3 px-2 font-mono">P(Import &gt; 7 GW)</th>
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
                      s.dcScenarioId === 'central' && Math.abs(s.windCapacityMW - 36400) < 100;
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
                  Trade-Off Fundamental do Estudo (Cenário Central DC · 1.596,8 MW)
                </p>
                <h3 id="heading-comp-curve" className="text-lg font-bold text-slate-900 mt-0.5">
                  Curva de Expansão Eólica Compensatória vs. Curtailment em 2035
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Quantos GW eólicos extras acima da base (29,6 GW) são exigidos para reconduzir o risco de importação P(Import &gt; 7 GW) à meta segura (&le; 5%).
                </p>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                      <th className="py-2.5 pr-2 font-mono">Adição Eólica</th>
                      <th className="py-2.5 px-2 font-mono">Parque Total</th>
                      <th className="py-2.5 px-2 font-mono">P(Import &gt; 7 GW)</th>
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
                      <th className="py-2 px-2 font-mono">P(Import &gt; 7 GW)</th>
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
      )}

      {/* ===================================================================== */}
      {/* SUBVIEW 3: PASSO 5 · SENSIBILIDADE (TRANSMISSÃO & H2V) E RELATÓRIO    */}
      {/* ===================================================================== */}
      {subView === 'passo5_sensitivity' && (
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
                  Efeito da capacidade de importação (5,5 a 9,0 GW) e exportação (8,0 a 12,5 GW) sobre o risco de déficit e sobre a expansão eólica compensatória no Cenário Central (DC = 1.596,8 MW, Eólica = 36,4 GW).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleExportCsv('passo5_csv')}
                  className="px-3.5 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  Exportar Sensibilidades (.csv)
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCsv('passo5_md')}
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
                    const isBaseRef = row.importLimitMW === ssot.config.interchangeImportLimitMW;
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
                    <th className="py-3 px-2 font-mono">P(Import &gt; 7 GW)</th>
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
                  {kpis.ind2025 ? kpis.ind2025.aneelInstalledSharePct.toFixed(2).replace('.', ',') : '51,46'}% da potência instalada
                </strong>{' '}
                no Nordeste, mas responde por{' '}
                <strong>
                  {kpis.ind2025 ? kpis.ind2025.onsEffectiveGenSharePct.toFixed(2).replace('.', ',') : '62,41'}% da geração elétrica efetiva
                </strong>{' '}
                (apesar de perder{' '}
                {kpis.ind2025
                  ? (kpis.ind2025.potentialUnconstrainedCfPct - kpis.ind2025.onsEffectiveCfPct).toFixed(2).replace('.', ',')
                  : '9,80'}{' '}
                pontos percentuais de fator de capacidade para o <em>constrained-off</em> de{' '}
                {kpis.ind2025 ? kpis.ind2025.annualCurtailmentLossTWh.toFixed(2).replace('.', ',') : '25,70'} TWh).
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
      )}

      {/* ===================================================================== */}
      {/* SUBVIEW 4: FEATURES, SAZONALIDADE & ANOVA (PASSO 3 ESTATÍSTICO)       */}
      {/* ===================================================================== */}
      {subView === 'features_anova' && (
        <div className="space-y-8">
          <section aria-labelledby="heading-anova-results" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
              <div>
                <h2 id="heading-anova-results" className="text-xl font-bold text-slate-900">
                  Diagnóstico de Significância Estatística via ANOVA (SciPy f_oneway)
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Testes de hipótese exatos avaliando a variância explicada (η²) pelos agrupadores sazonais, horários e de calendário (2015–2025).
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleExportCsv('anova')}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
              >
                Exportar Resultados ANOVA (.csv)
              </button>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 pr-4">Variável Analisada</th>
                    <th className="py-3 px-3">Fator Agrupador</th>
                    <th className="py-3 px-3">Estatística F</th>
                    <th className="py-3 px-3">p-valor</th>
                    <th className="py-3 px-3">Variância Explicada (η²)</th>
                    <th className="py-3 px-3">Decisão (α = 0,01)</th>
                    <th className="py-3 pl-4">Interpretação e Conclusão Técnica</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700 text-xs">
                  {anovaResults.map((r) => (
                    <tr key={r.targetVariable} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 pr-4 font-semibold text-slate-900 whitespace-nowrap">
                        {r.targetVariable}
                      </td>
                      <td className="py-3.5 px-3 whitespace-nowrap font-medium text-slate-800">
                        {r.groupingFactor}
                      </td>
                      <td className="py-3.5 px-3 font-mono font-bold text-sky-900 whitespace-nowrap">
                        {r.fStatistic.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-emerald-800 font-bold whitespace-nowrap">
                        {r.pValue === 0 ? '< 10⁻¹⁵' : r.pValue.toFixed(4)}
                      </td>
                      <td className="py-3.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {r.etaSquaredPct.toFixed(2)}%
                      </td>
                      <td className="py-3.5 px-3 font-semibold text-emerald-800 whitespace-nowrap">
                        Rejeita H₀ (p &lt; 0,01)
                      </td>
                      <td className="py-3.5 pl-4 text-slate-600 leading-relaxed max-w-md">
                        {r.technicalInterpretation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="heading-monthly-profile" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
              <div>
                <h2 id="heading-monthly-profile" className="text-xl font-bold text-slate-900">
                  Sazonalidade Mensal do Fator de Capacidade Eólico Potencial e Curtailment Real
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Consolidado dos 11 anos históricos reais (2015–2025) com reconstituição do constrained-off do ONS (2023–2025).
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleExportCsv('monthly')}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
              >
                Exportar Perfil Mensal (.csv)
              </button>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 pr-3">Mês</th>
                    <th className="py-3 px-3">Regime Sazonal</th>
                    <th className="py-3 px-4">Fator de Capacidade Médio (CF)</th>
                    <th className="py-3 px-3">CF P10 (Firme)</th>
                    <th className="py-3 px-3">Mediana P50</th>
                    <th className="py-3 px-3">CF P90</th>
                    <th className="py-3 px-3">Curtailment 23–25</th>
                    <th className="py-3 pl-3">Demanda Média NE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700 text-xs font-mono">
                  {monthlyProfiles.map((m) => {
                    const isSafra = m.seasonalRegime === 'Safra dos Ventos';
                    const isCalmaria = m.seasonalRegime === 'Estação Chuvosa / Calmaria';

                    return (
                      <tr key={m.month} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 pr-3 font-sans font-bold text-slate-900 whitespace-nowrap">
                          {m.month.toString().padStart(2, '0')} · {m.monthName}
                        </td>
                        <td
                          className={`py-3 px-3 font-sans font-semibold whitespace-nowrap ${
                            isSafra ? 'text-amber-800' : isCalmaria ? 'text-sky-800' : 'text-slate-600'
                          }`}
                        >
                          {m.seasonalRegime}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  isSafra ? 'bg-amber-600' : isCalmaria ? 'bg-sky-600' : 'bg-slate-500'
                                }`}
                                style={{ width: `${Math.round(m.avgCapacityFactor * 100)}%` }}
                              />
                            </div>
                            <span className="font-bold text-slate-900">
                              {(m.avgCapacityFactor * 100).toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-rose-700 font-semibold whitespace-nowrap">
                          {(m.p10CapacityFactor * 100).toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 text-slate-800 whitespace-nowrap">
                          {(m.p50MedianCapacityFactor * 100).toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 text-emerald-800 font-semibold whitespace-nowrap">
                          {(m.p90CapacityFactor * 100).toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 font-semibold text-amber-900 whitespace-nowrap">
                          {m.avgCurtailmentMW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MWmed
                        </td>
                        <td className="py-3 pl-3 font-sans font-medium text-slate-800 whitespace-nowrap">
                          {m.avgBaseLoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="heading-correlations" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
              <div>
                <h2 id="heading-correlations" className="text-xl font-bold text-slate-900">
                  Matriz de Correlação de Pearson com as Variáveis-Alvo (Incluindo Curtailment Real)
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Avaliação empírica das features para os Modelos A (Carga), B (Vento Potencial) e C (Curtailment 2023–2025).
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleExportCsv('correlation')}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer self-start lg:self-auto"
              >
                {downloadFeedback ?? 'Baixar Correlações (.csv)'}
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="filter-corr-search" className="block text-xs font-medium text-slate-700 mb-1">
                  Buscar Feature ou Descrição
                </label>
                <input
                  id="filter-corr-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Ex.: lag, fourier, excedente, solar..."
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div>
                <label htmlFor="filter-corr-category" className="block text-xs font-medium text-slate-700 mb-1">
                  Categoria da Feature
                </label>
                <select
                  id="filter-corr-category"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                >
                  <option value="all">Todas as Categorias</option>
                  <option value="Autoregressiva (Lag)">Autoregressiva (Lags 1h, 24h, 168h)</option>
                  <option value="Balanço Físico Exógeno">Balanço Físico Exógeno (Geração vs. Carga)</option>
                  <option value="Harmônica (Fourier)">Harmônica (Fourier Cíclico)</option>
                  <option value="Calendário">Calendário e Operativa</option>
                  <option value="Não-Linearidade Aerodinâmica">Não-Linearidade Aerodinâmica (v³, P²)</option>
                </select>
              </div>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 pr-3">Nome da Feature</th>
                    <th className="py-3 px-3">Papel Modelar</th>
                    <th className="py-3 px-3">Descrição Técnica</th>
                    <th className="py-3 px-4 font-mono">Corr(r) Carga Base</th>
                    <th className="py-3 px-4 font-mono">Corr(r) CF Eólico</th>
                    <th className="py-3 pl-4 font-mono">Corr(r) Curtailment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700 text-xs">
                  {filteredCorrelations.map((c) => (
                    <tr key={c.featureName} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 pr-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {c.featureName}
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-700 whitespace-nowrap">
                        {c.roleInModel}
                      </td>
                      <td className="py-3 px-3 text-slate-600 max-w-xs">
                        {c.featureDescription}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                        <span
                          className={
                            Math.abs(c.corrBaseLoad) > 0.7
                              ? 'text-sky-800 font-bold'
                              : Math.abs(c.corrBaseLoad) > 0.3
                                ? 'text-slate-900'
                                : 'text-slate-500'
                          }
                        >
                          {c.corrBaseLoad > 0 ? `+${c.corrBaseLoad.toFixed(3)}` : c.corrBaseLoad.toFixed(3)}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                        <span
                          className={
                            Math.abs(c.corrWindCF) > 0.7
                              ? 'text-emerald-800 font-bold'
                              : Math.abs(c.corrWindCF) > 0.3
                                ? 'text-slate-900'
                                : 'text-slate-500'
                          }
                        >
                          {c.corrWindCF > 0 ? `+${c.corrWindCF.toFixed(3)}` : c.corrWindCF.toFixed(3)}
                        </span>
                      </td>
                      <td className="py-3 pl-4 font-mono font-semibold whitespace-nowrap">
                        <span
                          className={
                            Math.abs(c.corrCurtailment) > 0.35
                              ? 'text-amber-800 font-bold'
                              : Math.abs(c.corrCurtailment) > 0.15
                                ? 'text-slate-800'
                                : 'text-slate-400'
                          }
                        >
                          {c.corrCurtailment > 0 ? `+${c.corrCurtailment.toFixed(3)}` : c.corrCurtailment.toFixed(3)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
