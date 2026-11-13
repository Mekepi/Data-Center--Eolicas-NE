import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDataCenterLoadMW,
  computeDcRampFactor,
  computeInstalledWindCapacityMW,
  computeWindGenerationMW,
  evaluateScenario,
  type SimulationConfig,
} from './energyModel';

const BASE_CONFIG: SimulationConfig = {
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
};

test('computeDataCenterLoadMW applies PUE only when power is IT load, avoiding double PUE when total grid power is published', () => {
  const loadFromIt = computeDataCenterLoadMW({
    itPowerMW: 1000,
    utilization: 0.8,
    pue: 1.25,
    rampFactor: 1.0,
    isPublishedPowerTotalGrid: false,
  });
  assert.equal(loadFromIt, 1000); // 1000 * 0.8 * 1.25 * 1.0 = 1000 MW

  const loadFromGridTotal = computeDataCenterLoadMW({
    itPowerMW: 1000,
    utilization: 0.8,
    pue: 1.25,
    rampFactor: 1.0,
    isPublishedPowerTotalGrid: true,
  });
  assert.equal(loadFromGridTotal, 800); // PUE skipped when already published as total grid power
});

test('computeWindGenerationMW converts capacity factor and installed MW properly', () => {
  assert.equal(computeWindGenerationMW(0.45, 30000), 13500);
  assert.equal(computeWindGenerationMW(-0.2, 30000), 0);
  assert.equal(computeWindGenerationMW(1.4, 10000), 10000);
});

test('computeDcRampFactor grows monotonically from 2026 to 2035', () => {
  const r2026 = computeDcRampFactor(2026);
  const r2030 = computeDcRampFactor(2030);
  const r2035 = computeDcRampFactor(2035);
  assert.ok(r2026 < r2030 && r2030 < r2035);
  assert.equal(r2035, 1);
});

test('computeInstalledWindCapacityMW includes offshore wind only post-2031 when enabled', () => {
  const pre2031 = computeInstalledWindCapacityMW({
    targetYear: 2030,
    windScenario: 'high',
    includeOffshorePost2031: true,
  });
  assert.equal(pre2031.offshoreMW, 0);

  const post2031 = computeInstalledWindCapacityMW({
    targetYear: 2035,
    windScenario: 'high',
    includeOffshorePost2031: true,
  });
  assert.ok(post2031.offshoreMW > 0);
  assert.equal(post2031.totalMW, post2031.onshoreMW + post2031.offshoreMW);
});

test('evaluateScenario captures both sides of the problem: DC load increases import risk in calm hours and reduces curtailment in windy hours', () => {
  const withoutDc = evaluateScenario({
    ...BASE_CONFIG,
    dcScenario: 'none',
    seasonalRegime: 'dry_windy',
  });
  const withHighDc = evaluateScenario({
    ...BASE_CONFIG,
    dcScenario: 'high',
    seasonalRegime: 'dry_windy',
  });

  assert.equal(withoutDc.hourlySeries.length, 168);
  assert.ok(
    withHighDc.summary.weeklyCurtailmentWithDcGWh <= withoutDc.summary.weeklyCurtailmentWithoutDcGWh,
    'Data centers should absorb surplus wind energy and reduce curtailment during windy hours'
  );

  const calmNoDc = evaluateScenario({
    ...BASE_CONFIG,
    dcScenario: 'none',
    seasonalRegime: 'wet_calm',
  });
  const calmHighDc = evaluateScenario({
    ...BASE_CONFIG,
    dcScenario: 'high',
    seasonalRegime: 'wet_calm',
  });

  assert.ok(
    calmHighDc.summary.minMarginMW < calmNoDc.summary.minMarginMW,
    'Data centers should deepen negative generation margin during calm wind periods'
  );
  assert.ok(
    calmHighDc.monteCarlo.probCriticalImportAnnualPct >= calmNoDc.monteCarlo.probCriticalImportAnnualPct,
    'Monte Carlo critical import probability should increase or stay equal under high DC load'
  );
});

test('DATA_CENTER_PIPELINE contains exactly 14 nominal projects conforming to official Northeast constraints', async () => {
  const { DATA_CENTER_PIPELINE, SUBSTATION_LOAD_CONCENTRATION } = await import(
    '../data/dataCentersPipelineCatalog'
  );

  assert.equal(DATA_CENTER_PIPELINE.length, 14, 'Should catalog exactly 14 nominal projects');

  const validStates = new Set(['CE', 'PE', 'RN', 'BA', 'PB']);
  let totalItMW = 0;

  for (const proj of DATA_CENTER_PIPELINE) {
    assert.ok(validStates.has(proj.state), `State ${proj.state} must be in the Northeast`);
    assert.ok(proj.itPowerMW > 0, 'IT power must be positive');
    assert.ok(proj.estimatedPUE >= 1.15 && proj.estimatedPUE <= 1.40, 'PUE must be in realistic range 1.15-1.40');
    assert.ok(proj.expectedStartYear >= 2026 && proj.expectedStartYear <= 2033, 'Start year in study horizon');
    assert.ok(proj.rampMonths >= 12, 'Ramp must be at least 12 months (non-instantaneous entry)');
    assert.ok(proj.realizationProbability > 0 && proj.realizationProbability <= 1.0, 'Valid probability');
    totalItMW += proj.itPowerMW;
  }

  assert.equal(totalItMW, 3495, 'Total declared IT capacity across 14 projects should equal 3,495 MW');

  // Validação da concentração em SE Pecém II
  const pecem = SUBSTATION_LOAD_CONCENTRATION.find((s) => s.substation === 'SE Pecém II');
  assert.ok(pecem, 'SE Pecém II must be present in substation summary');
  assert.ok(pecem.sharePct > 50, 'SE Pecém II must represent over 50% of the total 2035 load');
  assert.equal(pecem.voltageKV, 500, 'SE Pecém II is connected at 500 kV trunk line');
});

test('ANOVA_TEST_RESULTS and MONTHLY_WIND_PROFILES statistically validate Northeast wind seasonality', async () => {
  const { ANOVA_TEST_RESULTS, MONTHLY_WIND_PROFILES, FEATURE_CORRELATIONS } = await import(
    '../data/featuresAnovaCatalog'
  );

  // Validação dos testes ANOVA
  assert.ok(ANOVA_TEST_RESULTS.length >= 4, 'Should include at least 4 core ANOVA tests');
  for (const anova of ANOVA_TEST_RESULTS) {
    assert.equal(anova.pValue, 0.0, 'P-value must reject null hypothesis (p < 0.01)');
    assert.ok(anova.fStatistic > 150, `F-statistic must be highly significant (> 150): got ${anova.fStatistic}`);
    assert.equal(anova.isSignificantAlpha01, true);
  }

  const windAnova = ANOVA_TEST_RESULTS.find((a) => a.targetVariable.includes('cf_eolica'));
  assert.ok(windAnova, 'Wind CF ANOVA test must be present');
  assert.ok(windAnova.etaSquaredPct > 30, 'Monthly seasonality must explain >30% of CF variance');

  // Validação da Safra dos Ventos (12 meses)
  assert.equal(MONTHLY_WIND_PROFILES.length, 12, 'Must profile all 12 months');
  const marco = MONTHLY_WIND_PROFILES.find((m) => m.month === 3);
  const setembro = MONTHLY_WIND_PROFILES.find((m) => m.month === 9);
  assert.ok(marco && setembro, 'March and September must exist');
  assert.ok(
    setembro.avgCapacityFactor > marco.avgCapacityFactor * 1.8,
    'September wind CF must be at least 1.8x March CF (demonstrating Safra dos Ventos)'
  );
  assert.ok(setembro.p10CapacityFactor > marco.p10CapacityFactor * 2.5, 'Firm P10 in September is much higher');

  // Validação das correlações
  assert.ok(FEATURE_CORRELATIONS.length >= 10, 'Must have at least 10 feature correlations');
  const lag1Load = FEATURE_CORRELATIONS.find((f) => f.featureName === 'l_base_mw_lag_1h');
  const lag1Wind = FEATURE_CORRELATIONS.find((f) => f.featureName === 'cf_eolica_lag_1h');
  assert.ok(lag1Load && lag1Load.corrBaseLoad > 0.95, 'Lag 1h load correlation must exceed 0.95');
  assert.ok(lag1Wind && lag1Wind.corrWindCF > 0.95, 'Lag 1h wind CF correlation must exceed 0.95');
});

test('Passo 3 Out-of-Time 2025 benchmarks confirm non-linear models outperform linear baselines across Models A, B, and C', async () => {
  const {
    MODEL_A_BENCHMARK_2025,
    MODEL_B_BENCHMARK_2025,
    MODEL_C_BENCHMARK_2025,
    HOURLY_VALIDATION_2025_PROFILE,
  } = await import('../data/featuresAnovaCatalog');

  assert.equal(HOURLY_VALIDATION_2025_PROFILE.length, 24, 'Must contain 24 hourly validation points for 2025');

  // Modelo A: ResMLP beats Linear Ridge on both 1h and 24h horizons
  const linA1h = MODEL_A_BENCHMARK_2025.find((m) => m.horizon.includes('1h') && m.family === 'Linear');
  const mlpA1h = MODEL_A_BENCHMARK_2025.find((m) => m.horizon.includes('1h') && m.architecture.includes('ResMLP'));
  assert.ok(linA1h && mlpA1h, 'Both Linear and ResMLP 1h benchmarks must exist for Model A');
  assert.ok(mlpA1h.maeMW < linA1h.maeMW, 'ResMLP 1h MAE must be lower than Linear Ridge MAE');
  assert.ok(mlpA1h.mapePct < 1.5, 'ResMLP 1h MAPE on 2025 must be under 1.5%');

  // Modelo B: ResMLP beats Linear Ridge on CF(t)
  const linB1h = MODEL_B_BENCHMARK_2025.find((m) => m.horizon.includes('1h') && m.family === 'Linear');
  const mlpB1h = MODEL_B_BENCHMARK_2025.find((m) => m.horizon.includes('1h') && m.architecture.includes('ResMLP'));
  assert.ok(linB1h && mlpB1h, 'Both Linear and ResMLP 1h benchmarks must exist for Model B');
  assert.ok(mlpB1h.r2Score > 0.98 && mlpB1h.maeCF < linB1h.maeCF, 'ResMLP 1h R2 must exceed 0.98 and beat Linear');

  // Modelo C: Non-Linear Hurdle beats Linear Hurdle on ROC-AUC, Brier Score, and Volume R2
  assert.ok(MODEL_C_BENCHMARK_2025.length >= 2);
  const linearHurdle = MODEL_C_BENCHMARK_2025.find((m) => m.family === 'Linear');
  const nonLinearHurdle = MODEL_C_BENCHMARK_2025.find((m) => m.family.includes('Não-Linear'));
  assert.ok(linearHurdle && nonLinearHurdle);
  assert.ok(nonLinearHurdle.rocAuc > linearHurdle.rocAuc, 'Non-linear Hurdle ROC-AUC must exceed Linear Hurdle');
  assert.ok(nonLinearHurdle.brierScore < linearHurdle.brierScore, 'Non-linear Brier score must be lower (better)');
  assert.ok(nonLinearHurdle.r2Volume > linearHurdle.r2Volume, 'Non-linear Volume R2 must exceed Linear Hurdle');
});

test('Passo 4 Monte Carlo 2035 12-scenario matrix and compensatory wind curve validate physical trade-offs', async () => {
  const {
    MONTE_CARLO_12_SCENARIOS_2035,
    COMPENSATORY_WIND_CURVE_2035,
    ANNUAL_RISK_TIMELINE_2026_2035,
  } = await import('../data/featuresAnovaCatalog');

  assert.equal(MONTE_CARLO_12_SCENARIOS_2035.length, 12, 'Must contain all 12 scenarios (4 DC x 3 Wind)');
  assert.equal(ANNUAL_RISK_TIMELINE_2026_2035.length, 10, 'Must cover 10 years from 2026 to 2035');

  const noDcInterm = MONTE_CARLO_12_SCENARIOS_2035.find(
    (s) => s.dcScenarioId === 'none' && Math.abs(s.windCapacityMW - 36400) < 100
  );
  const centralInterm = MONTE_CARLO_12_SCENARIOS_2035.find(
    (s) => s.dcScenarioId === 'central' && Math.abs(s.windCapacityMW - 36400) < 100
  );
  const highInterm = MONTE_CARLO_12_SCENARIOS_2035.find(
    (s) => s.dcScenarioId === 'high' && Math.abs(s.windCapacityMW - 36400) < 100
  );

  assert.ok(noDcInterm && centralInterm && highInterm);
  // Adding Data Centers increases P95 import and critical risk, while reducing wind curtailment
  assert.ok(centralInterm.importP95MW > noDcInterm.importP95MW);
  assert.ok(highInterm.importP95MW > centralInterm.importP95MW);
  assert.ok(centralInterm.curtailmentAvoidedGWh > 3000, 'Central DCs absorb > 3,000 GWh/yr of wind curtailment');
  assert.ok(centralInterm.compensatoryWindExpansionGW > 0, 'Central DCs under Intermediate wind require extra compensatory GW');

  // Compensatory wind curve monotonically reduces P(Import > 7 GW) and P95 import as extra GW are added
  const firstPt = COMPENSATORY_WIND_CURVE_2035[0];
  const lastPt = COMPENSATORY_WIND_CURVE_2035[COMPENSATORY_WIND_CURVE_2035.length - 1];
  assert.ok(lastPt.probExceedInterchangePct < firstPt.probExceedInterchangePct);
  assert.ok(lastPt.importP95MW < firstPt.importP95MW - 1800, 'At +18.4 GW extra wind, P95 import drops by > 1,800 MW');
});

test('Passo 5 sensitivity datasets validate transmission expansion (TX-01..05), H2V flexible synergy, and ANEEL vs ONS indicators', async () => {
  const {
    TRANSMISSION_SENSITIVITY_2035,
    H2V_SYNERGY_SENSITIVITY_2035,
    ANEEL_VS_ONS_WIND_INDICATORS_2015_2035,
    PASSO5_FINAL_EXECUTIVE_REPORT_MD,
  } = await import('../data/featuresAnovaCatalog');
  const { SCRIPTS_PIPELINE } = await import('../data/scriptsRoadmap');

  assert.equal(SCRIPTS_PIPELINE.length, 7, 'Pipeline must include all 7 executed Python scripts (01 through 07)');
  assert.equal(TRANSMISSION_SENSITIVITY_2035.length, 5, 'Must include 5 transmission configurations TX-01..TX-05');

  // Higher import & export limits monotonically reduce critical import probability, curtailment, and required compensatory wind GW
  const tx01 = TRANSMISSION_SENSITIVITY_2035[0];
  const tx03 = TRANSMISSION_SENSITIVITY_2035[2];
  const tx05 = TRANSMISSION_SENSITIVITY_2035[4];
  assert.ok(tx05.probCriticalImportPct < tx03.probCriticalImportPct && tx03.probCriticalImportPct < tx01.probCriticalImportPct);
  assert.ok(tx05.curtailmentWithDcTWh < tx03.curtailmentWithDcTWh && tx03.curtailmentWithDcTWh < tx01.curtailmentWithDcTWh);
  assert.equal(tx05.compensatoryWindGW, 0.0, 'Full HVDC Bipole (TX-05) eliminates extra wind requirement under Central DC');

  // H2V flexible demand-response absorbs more curtailment and requires far less compensatory wind than inflexible H2V
  const h2v2gwInflex = H2V_SYNERGY_SENSITIVITY_2035.find((r) => r.h2vNominalMW === 2000 && r.scenarioId.includes('Inflexível'));
  const h2v2gwFlex = H2V_SYNERGY_SENSITIVITY_2035.find((r) => r.h2vNominalMW === 2000 && r.scenarioId.includes('Flexível'));
  assert.ok(h2v2gwInflex && h2v2gwFlex);
  assert.ok(h2v2gwFlex.probCriticalImportPct < h2v2gwInflex.probCriticalImportPct, 'Flexible H2V has much lower critical import risk');
  assert.ok(
    h2v2gwFlex.totalAbsorbedCurtailmentTWh > h2v2gwInflex.totalAbsorbedCurtailmentTWh,
    'Flexible H2V absorbs more renewable surplus than inflexible baseload H2V'
  );
  assert.ok(h2v2gwFlex.compensatoryWindGW < h2v2gwInflex.compensatoryWindGW - 7.0);

  // ANEEL vs ONS indicator series covers 2015–2035 and confirms 2025 constrained-off gap
  const ind2025 = ANEEL_VS_ONS_WIND_INDICATORS_2015_2035.find((r) => r.year === 2025);
  assert.ok(ind2025, '2025 indicator row must exist');
  assert.ok(ind2025.onsEffectiveGenSharePct > ind2025.aneelInstalledSharePct, 'Wind generation share exceeds installed capacity share in NE');
  assert.equal(ind2025.annualCurtailmentLossTWh, 25.7, '2025 verified curtailment loss equals 25.70 TWh');
  assert.ok(PASSO5_FINAL_EXECUTIVE_REPORT_MD.includes('Relatório Técnico Consolidado Final'));
});

test('SSOT parity: public/data/pipeline-ssot.json, generated TS bundle, live Python scripts, and energyModel config stay synchronized', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { PIPELINE_SSOT } = await import('../data/generated/pipelineSsot');
  const { SCRIPTS_PIPELINE } = await import('../data/scriptsRoadmap');

  const jsonPath = path.join(process.cwd(), 'public', 'data', 'pipeline-ssot.json');
  assert.ok(fs.existsSync(jsonPath), 'public/data/pipeline-ssot.json must exist');

  const parsedJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  assert.equal(parsedJson.schemaVersion, PIPELINE_SSOT.schemaVersion);
  assert.equal(parsedJson.lineage.generatedAtUtc, PIPELINE_SSOT.lineage.generatedAtUtc);
  assert.equal(parsedJson.lineage.trainHours, 87476);
  assert.equal(parsedJson.lineage.testHours, 8760);
  assert.equal(parsedJson.dataCentersPipeline.length, 14);
  assert.equal(parsedJson.substationLoadConcentration.length, 9);
  assert.equal(parsedJson.scriptsPipeline.length, 7);
  assert.equal(parsedJson.monteCarlo12Scenarios2035.length, 12);

  for (const script of SCRIPTS_PIPELINE) {
    const diskPath = path.join(process.cwd(), 'scripts', script.filename);
    assert.ok(fs.existsSync(diskPath), `Script file ${script.filename} must exist on disk`);
    const normalizedStarter = script.starterCode.replace(/\r\n/g, '\n');
    const normalizedDisk = fs.readFileSync(diskPath, 'utf-8').replace(/\r\n/g, '\n');
    assert.ok(
      normalizedStarter === normalizedDisk,
      `SSOT starterCode for ${script.filename} must match scripts/${script.filename} (lengths: ${normalizedStarter.length} vs ${normalizedDisk.length})`
    );
  }

  assert.deepEqual(parsedJson.config, PIPELINE_SSOT.config);
  assert.equal(PIPELINE_SSOT.config.baseWindOnshore2026MW, 29600);
  assert.equal(PIPELINE_SSOT.config.interchangeImportLimitMW, 7000);
  assert.equal(PIPELINE_SSOT.config.dcScenariosItMW.central, 2200);
  assert.equal(PIPELINE_SSOT.config.dcScenariosItMW.high, 4100);

  const wind2026 = computeInstalledWindCapacityMW({
    targetYear: 2026,
    windScenario: 'base',
    includeOffshorePost2031: false,
  });
  assert.equal(wind2026.onshoreMW, PIPELINE_SSOT.config.baseWindOnshore2026MW);
});





