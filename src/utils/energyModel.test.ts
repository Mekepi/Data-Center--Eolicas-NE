import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PIPELINE_SSOT } from '../data/generated/pipelineSsot';
import type { HourlyBaseline8760Bundle } from '../data/pipelineTypes';
import {
  buildDefaultSimulationConfig,
  buildHourlyPlotBuckets,
  computeChesfDispatchMW,
  computeDataCenterLoadMW,
  computeDcRampFactor,
  computeInstalledWindCapacityMW,
  computeWindGenerationMW,
  estimateFullYearHourly,
  evaluateScenario,
  resolveEffectiveDcLoadMW,
  resolveMonteCarloSummary,
  sliceHourlyWindow,
  type EnergyModelSsotInput,
  type SimulationConfig,
} from './energyModel';

const BASE_CONFIG: SimulationConfig = buildDefaultSimulationConfig(PIPELINE_SSOT.config);

function makeTestBaseline8760(): HourlyBaseline8760Bundle {
  const hoursCount = PIPELINE_SSOT.config.hoursPerYear;
  const month = new Array<number>(hoursCount);
  const day = new Array<number>(hoursCount);
  const hour = new Array<number>(hoursCount);
  const lBaseAnnual = new Array<number>(hoursCount);
  const cfAnnual = new Array<number>(hoursCount);
  const lBaseDry = new Array<number>(hoursCount);
  const cfDry = new Array<number>(hoursCount);
  const lBaseCalm = new Array<number>(hoursCount);
  const cfCalm = new Array<number>(hoursCount);
  const solarArr = new Array<number>(hoursCount);
  const hydroArr = new Array<number>(hoursCount);
  const thermArr = new Array<number>(hoursCount);
  const curtArr = new Array<number>(hoursCount);

  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let idx = 0;
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= monthDays[m]; d++) {
      for (let h = 0; h < 24; h++) {
        month[idx] = m + 1;
        day[idx] = d;
        hour[idx] = h;
        const isDay = h >= 8 && h <= 16;
        const isSafra = m + 1 >= 8 && m + 1 <= 11;
        lBaseDry[idx] = 12200 + (h >= 18 && h <= 21 ? 1200 : 0);
        cfDry[idx] = 0.62;
        lBaseCalm[idx] = 13200 + (h >= 18 && h <= 21 ? 1500 : 0);
        cfCalm[idx] = 0.14;
        lBaseAnnual[idx] = isSafra ? lBaseDry[idx] : lBaseCalm[idx];
        cfAnnual[idx] = isSafra ? 0.56 : 0.24;
        solarArr[idx] = isDay ? 3800 : 0;
        hydroArr[idx] = 3500;
        thermArr[idx] = 900;
        curtArr[idx] = isDay ? 900 : 200;
        idx++;
      }
    }
  }

  return {
    schemaVersion: '1.0.0',
    hoursCount,
    baselineYear: PIPELINE_SSOT.config.baselineYear,
    sourceWindow: 'test-fixture',
    generatedAtUtc: '2026-11-14T00:00:00Z',
    digest: 'test000000000000',
    month,
    day,
    hour,
    regimes: {
      annual_blend: {
        lBaseMW: lBaseAnnual,
        cfWind: cfAnnual,
        gSolarMW: solarArr,
        gHydroMW: hydroArr,
        gThermalMW: thermArr,
        curtailmentMW: curtArr,
      },
      dry_windy: {
        lBaseMW: lBaseDry,
        cfWind: cfDry,
        gSolarMW: solarArr,
        gHydroMW: hydroArr,
        gThermalMW: thermArr,
        curtailmentMW: curtArr,
      },
      wet_calm: {
        lBaseMW: lBaseCalm,
        cfWind: cfCalm,
        gSolarMW: solarArr,
        gHydroMW: hydroArr,
        gThermalMW: thermArr,
        curtailmentMW: curtArr,
      },
    },
  };
}

test('computeDataCenterLoadMW applies PUE only when power is IT load, avoiding double PUE when total grid power is published', () => {
  const loadFromIt = computeDataCenterLoadMW({
    itPowerMW: 1000,
    utilization: 0.8,
    pue: 1.25,
    rampFactor: 1.0,
    isPublishedPowerTotalGrid: false,
  });
  assert.equal(loadFromIt, 1000);

  const loadFromGridTotal = computeDataCenterLoadMW({
    itPowerMW: 1000,
    utilization: 0.8,
    pue: 1.25,
    rampFactor: 1.0,
    isPublishedPowerTotalGrid: true,
  });
  assert.equal(loadFromGridTotal, 800);
});

test('computeWindGenerationMW converts capacity factor and installed MW properly', () => {
  assert.equal(computeWindGenerationMW(0.45, 30000), 13500);
  assert.equal(computeWindGenerationMW(-0.2, 30000), 0);
  assert.equal(computeWindGenerationMW(1.4, 10000), 10000);
});

test('computeDcRampFactor grows monotonically across configured horizon', () => {
  const cfg = PIPELINE_SSOT.config;
  const rStart = computeDcRampFactor(cfg.projectionStartYear, cfg);
  const rRampStart = computeDcRampFactor(cfg.rampStartYear, cfg);
  const rMid = computeDcRampFactor(Math.round((cfg.rampStartYear + cfg.targetEndYear) / 2), cfg);
  const rEnd = computeDcRampFactor(cfg.targetEndYear, cfg);
  assert.equal(rStart, 0);
  assert.ok(rRampStart < rMid && rMid < rEnd);
  assert.equal(rEnd, 1);
});

test('computeInstalledWindCapacityMW includes offshore wind only from offshoreCommercialStartYear onward when enabled', () => {
  const cfg = PIPELINE_SSOT.config;
  const preOffshore = computeInstalledWindCapacityMW(
    {
      targetYear: cfg.offshoreCommercialStartYear - 1,
      windScenario: 'high',
      includeOffshorePost2031: true,
    },
    cfg
  );
  assert.equal(preOffshore.offshoreMW, 0);

  const atEnd = computeInstalledWindCapacityMW(
    {
      targetYear: cfg.targetEndYear,
      windScenario: 'high',
      includeOffshorePost2031: true,
    },
    cfg
  );
  assert.ok(atEnd.offshoreMW > 0);
  assert.equal(atEnd.totalMW, atEnd.onshoreMW + atEnd.offshoreMW);
});

test('evaluateScenario generates exact 8760h real-time series for every year 2025..2035 and preserves hourly fidelity across multi-scale slices', () => {
  const cfg = PIPELINE_SSOT.config;

  // Without baseline JSON on disk, engine must return empty hourly series (never synthetic curves)
  const withoutBaseline = evaluateScenario(BASE_CONFIG, PIPELINE_SSOT, null);
  assert.equal(withoutBaseline.fullYearSeries.length, 0);
  assert.equal(withoutBaseline.summary.hourlyBaselineAvailable, false);

  const baseline8760 = makeTestBaseline8760();
  let previousYearAvgLoad = 0;

  // Test every year in [projectionStartYear..targetEndYear] (2025..2035)
  for (let yr = cfg.projectionStartYear; yr <= cfg.targetEndYear; yr++) {
    const yearEval = evaluateScenario(
      { ...BASE_CONFIG, targetYear: yr, observationWindow: 'year' },
      PIPELINE_SSOT,
      baseline8760
    );
    assert.equal(yearEval.fullYearSeries.length, cfg.hoursPerYear, `Year ${yr} must produce 8760 points`);
    assert.equal(yearEval.hourlySeries.length, cfg.hoursPerYear);
    assert.equal(yearEval.summary.hourlyBaselineAvailable, true);

    const avgLoad = yearEval.summary.avgBaseLoadMW ?? 0;
    assert.ok(avgLoad > previousYearAvgLoad, `Year ${yr} base load must grow vs ${yr - 1}`);
    previousYearAvgLoad = avgLoad;

    // Spot-check physical conservation and Chesf dispatch bounds at sample hours
    for (const hIdx of [0, 12, 2000, 5000, 8759]) {
      const pt = yearEval.fullYearSeries[hIdx];
      assert.equal(pt.hourOfYear, hIdx);
      assert.ok(Number.isFinite(pt.marginWithDcMW));
      assert.ok(
        pt.otherDispatchableMW >= cfg.chesfDispatch.floorMW - 0.1 &&
          pt.otherDispatchableMW <= cfg.chesfDispatch.ceilingMW + 0.1
      );
      assert.ok(Math.abs(pt.marginWithDcMW - (pt.totalGenPotentialMW - pt.totalLoadMW)) <= 0.3);
    }
  }

  // Chesf dispatch monotonicity helper check
  const lowDisp = computeChesfDispatchMW(0, cfg.chesfDispatch);
  const highDisp = computeChesfDispatchMW(1_000_000, cfg.chesfDispatch);
  assert.equal(lowDisp, cfg.chesfDispatch.floorMW);
  assert.equal(highDisp, cfg.chesfDispatch.ceilingMW);

  // Verify exact hourly preservation across Day | Week | Month | Quarter | Year windows
  const yearRef = estimateFullYearHourly(BASE_CONFIG, baseline8760, PIPELINE_SSOT);
  const monthNames = PIPELINE_SSOT.uiCatalog.monthShortNames;

  const daySlice = sliceHourlyWindow(yearRef, { ...BASE_CONFIG, observationWindow: 'day', selectedDay: 60 }, cfg, monthNames);
  const weekSlice = sliceHourlyWindow(yearRef, { ...BASE_CONFIG, observationWindow: 'week', selectedWeek: 10 }, cfg, monthNames);
  const monthSlice = sliceHourlyWindow(yearRef, { ...BASE_CONFIG, observationWindow: 'month', selectedMonth: 2 }, cfg, monthNames);
  const q1 = sliceHourlyWindow(yearRef, { ...BASE_CONFIG, observationWindow: 'quarter', selectedQuarter: 1 }, cfg, monthNames);
  const q2 = sliceHourlyWindow(yearRef, { ...BASE_CONFIG, observationWindow: 'quarter', selectedQuarter: 2 }, cfg, monthNames);
  const q3 = sliceHourlyWindow(yearRef, { ...BASE_CONFIG, observationWindow: 'quarter', selectedQuarter: 3 }, cfg, monthNames);
  const q4 = sliceHourlyWindow(yearRef, { ...BASE_CONFIG, observationWindow: 'quarter', selectedQuarter: 4 }, cfg, monthNames);

  assert.equal(daySlice.hoursCount, 24);
  assert.equal(weekSlice.hoursCount, cfg.blockSizeHours);
  assert.equal(monthSlice.hoursCount, 28 * 24);
  assert.equal(q1.hoursCount + q2.hoursCount + q3.hoursCount + q4.hoursCount, cfg.hoursPerYear);

  for (const slice of [daySlice, weekSlice, monthSlice, q1]) {
    for (const pt of slice.points) {
      const orig = yearRef[pt.hourOfYear];
      assert.equal(pt.baseLoadMW, orig.baseLoadMW);
      assert.equal(pt.marginWithDcMW, orig.marginWithDcMW);
      assert.equal(pt.curtailmentWithDcMW, orig.curtailmentWithDcMW);
    }
  }

  // Verify plot bucket downsampling bounds envelope cleanly
  const buckets = buildHourlyPlotBuckets(yearRef, 365);
  assert.equal(buckets.length, 365);
  for (const b of buckets) {
    assert.ok(b.minMarginWithDcMW <= b.meanMarginWithDcMW + 1e-6);
    assert.ok(b.meanMarginWithDcMW <= b.maxMarginWithDcMW + 1e-6);
  }
});

test('resolveMonteCarloSummary uses Python grid (exact + IDW interpolation) or SSOT anchors, never synthetic JS fallback', () => {
  const cfg = PIPELINE_SSOT.config;
  const baselineCfg = buildDefaultSimulationConfig(cfg);

  // Off-nominal configuration with empty grid -> strictly unavailable with null stochastic metrics
  const offNominalEmpty = resolveMonteCarloSummary(
    { ...baselineCfg, seasonalRegime: 'dry_windy', pue: 1.4 },
    { ...PIPELINE_SSOT, simulatorMonteCarloGrid: [] }
  );
  assert.equal(offNominalEmpty.sourceStatus, 'unavailable');
  assert.equal(offNominalEmpty.probCriticalImportAnnualPct, null);
  assert.equal(offNominalEmpty.p95PeakImportMW, null);
  assert.equal(offNominalEmpty.requiredExtraWindGWForTargetRisk, null);

  // Build synthetic grid fixture representing two Python grid points for 2030 and verify exact & IDW resolution
  const windCap2030 = computeInstalledWindCapacityMW(
    { targetYear: 2030, windScenario: 'intermediate', includeOffshorePost2031: false },
    cfg
  );
  const dc2030 = resolveEffectiveDcLoadMW({ ...baselineCfg, targetYear: 2030 }, PIPELINE_SSOT);
  const gridSsot: EnergyModelSsotInput = {
    ...PIPELINE_SSOT,
    simulatorMonteCarloGrid: [
      {
        year: 2030,
        dcScenarioId: 'central',
        windScenarioId: 'intermediate',
        seasonalRegime: 'dry_windy',
        pue: 1.2,
        dcUtilization: 0.8,
        importLimitMW: 7000,
        exportLimitMW: 9500,
        dcLoadMW: dc2030,
        windCapacityMW: windCap2030.totalMW,
        probExceedInterchangePct: 4.0,
        loleHoursYear: 20.0,
        importP50MW: 2200,
        importP95MW: 6200,
        curtailmentWithoutDcTWh: 12.0,
        curtailmentWithDcTWh: 9.0,
        curtailmentAvoidedGWh: 3000,
        compensatoryWindGW: 0.0,
      },
      {
        year: 2030,
        dcScenarioId: 'central',
        windScenarioId: 'intermediate',
        seasonalRegime: 'dry_windy',
        pue: 1.4,
        dcUtilization: 0.8,
        importLimitMW: 7000,
        exportLimitMW: 9500,
        dcLoadMW: dc2030,
        windCapacityMW: windCap2030.totalMW,
        probExceedInterchangePct: 8.0,
        loleHoursYear: 60.0,
        importP50MW: 3000,
        importP95MW: 7800,
        curtailmentWithoutDcTWh: 12.0,
        curtailmentWithDcTWh: 8.0,
        curtailmentAvoidedGWh: 4000,
        compensatoryWindGW: 4.0,
      },
    ],
  };

  const exactRes = resolveMonteCarloSummary(
    { ...baselineCfg, targetYear: 2030, seasonalRegime: 'dry_windy', pue: 1.2, dcUtilization: 0.8 },
    gridSsot
  );
  assert.equal(exactRes.sourceStatus, 'grid_exact');
  assert.equal(exactRes.probCriticalImportAnnualPct, 4.0);

  const interpRes = resolveMonteCarloSummary(
    { ...baselineCfg, targetYear: 2030, seasonalRegime: 'dry_windy', pue: 1.3, dcUtilization: 0.8 },
    gridSsot
  );
  assert.equal(interpRes.sourceStatus, 'grid_interpolated');
  assert.ok(
    interpRes.probCriticalImportAnnualPct !== null &&
      interpRes.probCriticalImportAnnualPct > 4.0 &&
      interpRes.probCriticalImportAnnualPct < 8.0
  );
  assert.ok(interpRes.p95PeakImportMW !== null && interpRes.p95PeakImportMW > 6200 && interpRes.p95PeakImportMW < 7800);
});

test('DATA_CENTER_PIPELINE conforms to official Northeast constraints and composite substation keys', async () => {
  const { DATA_CENTER_PIPELINE, SUBSTATION_LOAD_CONCENTRATION } = await import(
    '../data/dataCentersPipelineCatalog'
  );
  const cfg = PIPELINE_SSOT.config;

  assert.equal(DATA_CENTER_PIPELINE.length, PIPELINE_SSOT.dataCentersPipeline.length);
  assert.ok(DATA_CENTER_PIPELINE.length >= 10);

  const validStates = new Set(['CE', 'PE', 'RN', 'BA', 'PB', 'PI', 'MA', 'SE', 'AL']);
  for (const proj of DATA_CENTER_PIPELINE) {
    assert.ok(validStates.has(proj.state), `State ${proj.state} must be in the Northeast`);
    assert.ok(proj.itPowerMW > 0, 'IT power must be positive');
    assert.ok(
      proj.estimatedPUE >= cfg.simulatorSliderBounds.pue.min &&
        proj.estimatedPUE <= cfg.simulatorSliderBounds.pue.max,
      'PUE must be within configured slider bounds'
    );
    assert.ok(
      proj.expectedStartYear >= cfg.rampStartYear && proj.expectedStartYear <= cfg.targetEndYear,
      'Start year must fall inside ramp horizon'
    );
    assert.ok(proj.rampMonths >= 12, 'Ramp must be at least 12 months');
    assert.ok(proj.realizationProbability > 0 && proj.realizationProbability <= 1.0, 'Valid probability');
  }

  const pecem = SUBSTATION_LOAD_CONCENTRATION.find((s) => s.substation === cfg.pecemSubstationName);
  assert.ok(pecem, `${cfg.pecemSubstationName} must be present in substation summary`);
  assert.ok(pecem.sharePct > 50, `${cfg.pecemSubstationName} must remain primary load hub`);
});

test('ANOVA_TEST_RESULTS and MONTHLY_WIND_PROFILES statistically validate Northeast wind seasonality', async () => {
  const { ANOVA_TEST_RESULTS, MONTHLY_WIND_PROFILES, FEATURE_CORRELATIONS } = await import(
    '../data/featuresAnovaCatalog'
  );
  const corrHi = PIPELINE_SSOT.config.uiThresholds.correlationHighlight;

  assert.ok(ANOVA_TEST_RESULTS.length >= 4, 'Should include at least 4 core ANOVA tests');
  for (const anova of ANOVA_TEST_RESULTS) {
    assert.ok(anova.pValue < 0.01, 'P-value must reject null hypothesis (p < 0.01)');
    assert.ok(anova.fStatistic > 150, `F-statistic must be highly significant (> 150): got ${anova.fStatistic}`);
    assert.equal(anova.isSignificantAlpha01, true);
  }

  const windAnova = ANOVA_TEST_RESULTS.find((a) => a.targetVariable.includes('cf_eolica'));
  assert.ok(windAnova, 'Wind CF ANOVA test must be present');
  assert.ok(windAnova.etaSquaredPct > 30, 'Monthly seasonality must explain >30% of CF variance');

  assert.equal(MONTHLY_WIND_PROFILES.length, 12, 'Must profile all 12 months');
  const marco = MONTHLY_WIND_PROFILES.find((m) => m.month === 3);
  const setembro = MONTHLY_WIND_PROFILES.find((m) => m.month === 9);
  assert.ok(marco && setembro, 'March and September must exist');
  assert.ok(setembro.avgCapacityFactor > marco.avgCapacityFactor * 1.8);
  assert.ok(setembro.p10CapacityFactor > marco.p10CapacityFactor * 2.5);

  assert.ok(FEATURE_CORRELATIONS.length >= 10, 'Must have at least 10 feature correlations');
  const lag1Load = FEATURE_CORRELATIONS.find((f) => f.featureName === 'l_base_mw_lag_1h');
  const lag1Wind = FEATURE_CORRELATIONS.find((f) => f.featureName === 'cf_eolica_lag_1h');
  assert.ok(lag1Load && lag1Load.corrBaseLoad > corrHi.strong);
  assert.ok(lag1Wind && lag1Wind.corrWindCF > corrHi.strong);
});

test('Passo 3 Out-of-Time 2025 benchmarks confirm non-linear models outperform linear baselines across Models A, B, and C', async () => {
  const {
    MODEL_A_BENCHMARK_2025,
    MODEL_B_BENCHMARK_2025,
    MODEL_C_BENCHMARK_2025,
    HOURLY_VALIDATION_2025_PROFILE,
  } = await import('../data/featuresAnovaCatalog');

  assert.equal(HOURLY_VALIDATION_2025_PROFILE.length, 24, 'Must contain 24 hourly validation points for baseline year');

  // Modelo A: non-linear beats Linear Ridge on 1h horizon
  const linA1h = MODEL_A_BENCHMARK_2025.find((m) => m.horizon.includes('1h') && m.family === 'Linear');
  const nonLinA1h = MODEL_A_BENCHMARK_2025.find((m) => m.horizon.includes('1h') && m.family.includes('Não-Linear'));
  assert.ok(linA1h && nonLinA1h, 'Both Linear and Non-Linear 1h benchmarks must exist for Model A');
  assert.ok(nonLinA1h.maeMW < linA1h.maeMW, 'Non-linear 1h MAE must be lower than Linear Ridge MAE');

  // Modelo B: non-linear beats Linear Ridge on CF(t)
  const linB1h = MODEL_B_BENCHMARK_2025.find((m) => m.horizon.includes('1h') && m.family === 'Linear');
  const nonLinB1h = MODEL_B_BENCHMARK_2025.find((m) => m.horizon.includes('1h') && m.family.includes('Não-Linear'));
  assert.ok(linB1h && nonLinB1h, 'Both Linear and Non-Linear 1h benchmarks must exist for Model B');
  assert.ok(nonLinB1h.maeCF < linB1h.maeCF && nonLinB1h.r2Score > linB1h.r2Score);

  // Modelo C: Non-Linear Hurdle beats Linear Hurdle on ROC-AUC, Brier Score, and Volume R2 (Ciclo 3 scientific tuning check)
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
  const refs = PIPELINE_SSOT.config.referenceScenarioKeys;

  assert.equal(MONTE_CARLO_12_SCENARIOS_2035.length, 12, 'Must contain all 12 scenarios (4 DC x 3 Wind)');
  assert.ok(ANNUAL_RISK_TIMELINE_2026_2035.length >= 10, 'Must cover study horizon through 2035');

  const noDcInterm = MONTE_CARLO_12_SCENARIOS_2035.find(
    (s) => s.dcScenarioId === refs.dcControl && s.windScenarioId === refs.windIntermediate
  );
  const centralInterm = MONTE_CARLO_12_SCENARIOS_2035.find(
    (s) => s.dcScenarioId === refs.dcCentral && s.windScenarioId === refs.windIntermediate
  );
  const highInterm = MONTE_CARLO_12_SCENARIOS_2035.find(
    (s) => s.dcScenarioId === refs.dcHigh && s.windScenarioId === refs.windIntermediate
  );

  assert.ok(noDcInterm && centralInterm && highInterm);
  assert.ok(centralInterm.importP95MW > noDcInterm.importP95MW);
  assert.ok(highInterm.importP95MW > centralInterm.importP95MW);
  assert.ok(centralInterm.curtailmentAvoidedGWh > 0, 'Central DCs absorb wind curtailment');
  assert.ok(centralInterm.compensatoryWindExpansionGW >= noDcInterm.compensatoryWindExpansionGW);

  const firstPt = COMPENSATORY_WIND_CURVE_2035[0];
  const lastPt = COMPENSATORY_WIND_CURVE_2035[COMPENSATORY_WIND_CURVE_2035.length - 1];
  assert.ok(lastPt.probExceedInterchangePct < firstPt.probExceedInterchangePct);
  assert.ok(lastPt.importP95MW < firstPt.importP95MW);
});

test('Passo 5 sensitivity datasets validate transmission expansion, H2V flexible synergy, and ANEEL vs ONS indicators', async () => {
  const {
    TRANSMISSION_SENSITIVITY_2035,
    H2V_SYNERGY_SENSITIVITY_2035,
    ANEEL_VS_ONS_WIND_INDICATORS_2015_2035,
    MODEL_C_BENCHMARK_2025,
    PASSO5_FINAL_EXECUTIVE_REPORT_MD,
  } = await import('../data/featuresAnovaCatalog');
  const { SCRIPTS_PIPELINE } = await import('../data/scriptsRoadmap');
  const cfg = PIPELINE_SSOT.config;

  assert.equal(SCRIPTS_PIPELINE.length, PIPELINE_SSOT.scriptsPipeline.length);
  assert.ok(SCRIPTS_PIPELINE.length >= 7);
  assert.equal(TRANSMISSION_SENSITIVITY_2035.length, PIPELINE_SSOT.transmissionSensitivity2035.length);
  assert.ok(TRANSMISSION_SENSITIVITY_2035.length >= 3);

  const tx01 = TRANSMISSION_SENSITIVITY_2035[0];
  const tx03 = TRANSMISSION_SENSITIVITY_2035.find((r) => r.configId.startsWith(cfg.referenceScenarioKeys.txReferenceIdPrefix));
  const tx05 = TRANSMISSION_SENSITIVITY_2035[TRANSMISSION_SENSITIVITY_2035.length - 1];
  assert.ok(tx03);
  assert.ok(tx05.probCriticalImportPct < tx03.probCriticalImportPct && tx03.probCriticalImportPct < tx01.probCriticalImportPct);
  assert.ok(tx05.curtailmentWithDcTWh < tx03.curtailmentWithDcTWh && tx03.curtailmentWithDcTWh < tx01.curtailmentWithDcTWh);
  assert.equal(tx05.compensatoryWindGW, 0.0);

  const h2vInflex = H2V_SYNERGY_SENSITIVITY_2035.find(
    (r) => r.h2vNominalMW === cfg.defaultH2vComparisonMW && r.scenarioId.includes('Inflexível')
  );
  const h2vFlex = H2V_SYNERGY_SENSITIVITY_2035.find(
    (r) => r.h2vNominalMW === cfg.defaultH2vComparisonMW && r.scenarioId.includes('Flexível')
  );
  assert.ok(h2vInflex && h2vFlex);
  assert.ok(h2vFlex.probCriticalImportPct < h2vInflex.probCriticalImportPct);
  assert.ok(h2vFlex.totalAbsorbedCurtailmentTWh > h2vInflex.totalAbsorbedCurtailmentTWh);
  assert.ok(h2vFlex.compensatoryWindGW < h2vInflex.compensatoryWindGW);

  const indBase = ANEEL_VS_ONS_WIND_INDICATORS_2015_2035.find((r) => r.year === cfg.baselineYear);
  assert.ok(indBase, 'Baseline year indicator row must exist');
  assert.ok(indBase.onsEffectiveGenSharePct > indBase.aneelInstalledSharePct);
  if (MODEL_C_BENCHMARK_2025[0]) {
    assert.ok(Math.abs(indBase.annualCurtailmentLossTWh - MODEL_C_BENCHMARK_2025[0].realCurtailed2025TWh) <= 0.1);
  }
  assert.ok(PASSO5_FINAL_EXECUTIVE_REPORT_MD.includes('Relatório Técnico Consolidado Final'));
});

test('SSOT parity and anti-hardcode check: JSON, TS bundle, live Python scripts, config, and uiCatalog stay synchronized', async () => {
  const { SCRIPTS_PIPELINE } = await import('../data/scriptsRoadmap');

  const jsonPath = path.join(process.cwd(), 'public', 'data', 'pipeline-ssot.json');
  assert.ok(fs.existsSync(jsonPath), 'public/data/pipeline-ssot.json must exist');

  const parsedJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  assert.equal(parsedJson.schemaVersion, PIPELINE_SSOT.schemaVersion);
  assert.equal(parsedJson.bundleDigest, PIPELINE_SSOT.bundleDigest);
  assert.equal(parsedJson.lineage.generatedAtUtc, PIPELINE_SSOT.lineage.generatedAtUtc);
  assert.deepEqual(parsedJson.config, PIPELINE_SSOT.config);
  assert.deepEqual(parsedJson.uiCatalog, PIPELINE_SSOT.uiCatalog);

  assert.equal(PIPELINE_SSOT.config.hoursPerYear, 8760);
  assert.equal(PIPELINE_SSOT.config.projectionStartYear, 2025);
  assert.equal(PIPELINE_SSOT.config.targetEndYear, 2035);
  assert.equal(PIPELINE_SSOT.config.simulatorSliderBounds.year.min, 2025);
  assert.equal(PIPELINE_SSOT.config.simulatorSliderBounds.year.max, 2035);
  assert.equal(PIPELINE_SSOT.uiCatalog.observationWindows.length, 5);
  assert.equal(PIPELINE_SSOT.uiCatalog.databasesCatalog.length, 10);
  assert.equal(PIPELINE_SSOT.uiCatalog.groupDecisions.length, 4);

  for (const script of SCRIPTS_PIPELINE) {
    const diskPath = path.join(process.cwd(), 'scripts', script.filename);
    assert.ok(fs.existsSync(diskPath), `Script file ${script.filename} must exist on disk`);
    const normalizedStarter = script.starterCode.replace(/\r\n/g, '\n');
    const normalizedDisk = fs.readFileSync(diskPath, 'utf-8').replace(/\r\n/g, '\n');
    assert.equal(normalizedStarter, normalizedDisk, `SSOT starterCode mismatch for ${script.filename}`);
  }

  // Anti-hardcode guardrails in src/
  assert.equal(
    fs.existsSync(path.join(process.cwd(), 'src', 'data', 'databasesCatalog.ts')),
    false,
    'Legacy src/data/databasesCatalog.ts must remain removed'
  );
  const srcRoot = path.join(process.cwd(), 'src');
  const walkFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkFiles(full));
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
    }
    return out;
  };
  for (const file of walkFiles(srcRoot)) {
    if (file.endsWith('.test.ts') || file.endsWith('pipelineSsot.ts')) continue;
    const text = fs.readFileSync(file, 'utf-8');
    assert.equal(text.includes('style={{'), false, `Inline style forbidden in ${path.relative(srcRoot, file)}`);
    assert.equal(text.includes('simulateHourlyWeek'), false, `Legacy simulateHourlyWeek forbidden in ${file}`);
    assert.equal(
      text.includes('DEFAULT_ENERGY_MODEL_CONFIG'),
      false,
      `Legacy DEFAULT_ENERGY_MODEL_CONFIG forbidden in ${file}`
    );
  }
});

test('Passo 4 convergence: evaluateScenario(BASE_CONFIG, PIPELINE_SSOT) converges dynamically to live SSOT Central x Intermediate anchor', () => {
  const cfg = PIPELINE_SSOT.config;
  const refs = cfg.referenceScenarioKeys;
  const anchor = PIPELINE_SSOT.monteCarlo12Scenarios2035.find(
    (s) => s.dcScenarioId === refs.dcCentral && s.windScenarioId === refs.windIntermediate
  );
  assert.ok(anchor, 'Central x Intermediate reference row must exist in SSOT');

  const result = evaluateScenario(BASE_CONFIG, PIPELINE_SSOT);
  assert.equal(result.monteCarlo.sourceStatus, 'ssot_anchor');
  assert.equal(result.summary.effectiveDcLoadMW, Number(anchor.dcLoadMW.toFixed(1)));
  assert.equal(result.monteCarlo.effectiveDcLoadMW, Number(anchor.dcLoadMW.toFixed(1)));
  assert.equal(result.monteCarlo.probCriticalImportAnnualPct, anchor.probExceedInterchangePct);
  assert.equal(result.monteCarlo.p95PeakImportMW, Math.round(anchor.importP95MW));
  assert.equal(result.monteCarlo.expectedCurtailmentWithDcTWh, anchor.curtailmentWithDcTWh);
  assert.equal(result.monteCarlo.curtailmentAvoidedByDcGWh, Math.round(anchor.curtailmentAvoidedGWh));
  assert.equal(result.monteCarlo.requiredExtraWindGWForTargetRisk, anchor.compensatoryWindExpansionGW);
});

test('Passo 4 dynamic SSOT scaling: resolveEffectiveDcLoadMW matches scenarioAnnualRamp, scales with PUE/utilization without double PUE, and computeInstalledWindCapacityMW honors injected config', () => {
  for (const row of PIPELINE_SSOT.scenarioAnnualRamp) {
    const resolved = resolveEffectiveDcLoadMW(
      {
        targetYear: row.year,
        dcScenario: 'central',
        pue: PIPELINE_SSOT.config.defaultPue,
        dcUtilization: PIPELINE_SSOT.config.defaultUtilization,
        isPublishedPowerTotalGrid: false,
      },
      PIPELINE_SSOT
    );
    assert.equal(resolved, Number(row.centralMW.toFixed(1)), `Year ${row.year} must match scenarioAnnualRamp centralMW`);
  }

  const loadItWithPue = resolveEffectiveDcLoadMW(BASE_CONFIG, PIPELINE_SSOT);
  const loadTotalGrid = resolveEffectiveDcLoadMW(
    { ...BASE_CONFIG, isPublishedPowerTotalGrid: true },
    PIPELINE_SSOT
  );
  assert.ok(loadTotalGrid < loadItWithPue);
  assert.equal(loadTotalGrid, Number((loadItWithPue / PIPELINE_SSOT.config.defaultPue).toFixed(1)));

  const loadHalfUtil = resolveEffectiveDcLoadMW(
    { ...BASE_CONFIG, dcUtilization: PIPELINE_SSOT.config.defaultUtilization * 0.5 },
    PIPELINE_SSOT
  );
  assert.equal(loadHalfUtil, Number((loadItWithPue * 0.5).toFixed(1)));

  const customCfg = {
    ...PIPELINE_SSOT.config,
    baseWindOnshore2026MW: 31000,
    windExpansionOnshoreMW: { base: 0, intermediate: 5000, high: 12000 },
  };
  const customWind = computeInstalledWindCapacityMW(
    { targetYear: PIPELINE_SSOT.config.targetEndYear, windScenario: 'intermediate', includeOffshorePost2031: false },
    customCfg
  );
  assert.equal(customWind.onshoreMW, 36000);
  assert.equal(customWind.totalMW, 36000);
});

test('Passo 5 csvExport helpers escape quotes, preserve nullish blanks, and prepend UTF-8 BOM with semicolon delimiter', async () => {
  const { escapeCsvCell, buildDelimitedCsvContent } = await import('./csvExport');

  assert.equal(escapeCsvCell('SE Pecém "II"'), '"SE Pecém ""II"""');
  assert.equal(escapeCsvCell(1596.8), '1596.8');
  assert.equal(escapeCsvCell(true), 'true');
  assert.equal(escapeCsvCell(null), '');
  assert.equal(escapeCsvCell(undefined), '');

  const csv = buildDelimitedCsvContent(
    ['id', 'subestacao;zona', 'valor'],
    [
      ['DC-01', 'SE Pecém "II"', 700],
      ['DC-02', null, 300.5],
    ]
  );

  assert.ok(csv.startsWith('\uFEFF'), 'CSV output must start with UTF-8 BOM');
  const lines = csv.slice(1).split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'id;"subestacao;zona";valor');
  assert.equal(lines[1], '"DC-01";"SE Pecém ""II""";700');
  assert.equal(lines[2], '"DC-02";;300.5');
});

test('Passo 5 computeFeaturesAnovaKpis derives consistent SSOT KPIs for panel subcomponents', async () => {
  const { computeFeaturesAnovaKpis } = await import('../components/featuresAnovaKpis');
  const cfg = PIPELINE_SSOT.config;
  const kpis = computeFeaturesAnovaKpis(PIPELINE_SSOT);
  const c0 = PIPELINE_SSOT.modelCBenchmark2025[0];
  const mcAnchor = PIPELINE_SSOT.monteCarlo12Scenarios2035.find(
    (s) => s.dcScenarioId === cfg.referenceScenarioKeys.dcCentral && s.windScenarioId === cfg.referenceScenarioKeys.windIntermediate
  );

  assert.ok(kpis.a1h && kpis.a1h.mapePct < 1.5);
  assert.ok(kpis.b1h && kpis.b1h.r2Score > 0.98);
  assert.ok(kpis.cBest && c0 && kpis.cBest.realCurtailed2025TWh === c0.realCurtailed2025TWh);
  assert.ok(kpis.mcCentral && mcAnchor && kpis.mcCentral.compensatoryWindExpansionGW === mcAnchor.compensatoryWindExpansionGW);
  assert.equal(kpis.baseWind2026GW, Number((cfg.baseWindOnshore2026MW / 1000).toFixed(1)));
  assert.equal(kpis.importLimitGW, Number((cfg.interchangeImportLimitMW / 1000).toFixed(1)));

  const hourlyBase = PIPELINE_SSOT.hourlyValidation2025Profile;
  const avgLoad2025MW =
    hourlyBase.reduce((acc, pt) => acc + pt.realLoadMW, 0) / Math.max(1, hourlyBase.length);
  const expectedPde =
    avgLoad2025MW * Math.pow(1 + cfg.annualLoadGrowthRate, cfg.targetEndYear - cfg.baselineYear);
  assert.equal(kpis.projPde2035LoadMW, expectedPde);
});
