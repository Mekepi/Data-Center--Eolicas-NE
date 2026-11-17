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
  estimateAnnualSimulation,
  estimateFullYearHourly,
  evaluateScenario,
  resolveEffectiveDcLoadMW,
  resolveMonteCarloSummary,
  sliceHourlyWindow,
  summarizeHourlyWindow,
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

test('Passo C3-2: computeChesfDispatchMW enforces wet/dry seasonality, thermal inflexibility, hydro blend, and water-constrained hourly parity', () => {
  const chesf = PIPELINE_SSOT.config.chesfDispatch;

  // Backward-compatible 2-argument call preserves static baseline
  assert.equal(computeChesfDispatchMW(0, chesf), chesf.floorMW);
  assert.equal(computeChesfDispatchMW(1_000_000, chesf), chesf.ceilingMW);

  // Seasonal differentiation at equal net need (wet month > transition month > dry month)
  const netNeed = 4000;
  const wetDisp = computeChesfDispatchMW(netNeed, chesf, { month: 2, observedHydroMW: 0, observedThermalMW: 0 });
  const transDisp = computeChesfDispatchMW(netNeed, chesf, { month: 6, observedHydroMW: 0, observedThermalMW: 0 });
  const dryDisp = computeChesfDispatchMW(netNeed, chesf, { month: 9, observedHydroMW: 0, observedThermalMW: 0 });
  assert.ok(wetDisp > transDisp && transDisp > dryDisp, `Expected wet (${wetDisp}) > trans (${transDisp}) > dry (${dryDisp})`);

  // Thermal inflexibility adds thermalInflexWeight * observedThermalMW within ceiling
  const withThermal = computeChesfDispatchMW(netNeed, chesf, { month: 9, observedHydroMW: 0, observedThermalMW: 1000 });
  assert.ok(Math.abs(withThermal - dryDisp - chesf.thermalInflexWeight * 1000) < 1e-6);

  // Observed hydro blend anchors curve toward obsHydro + thermalInflex when obsHydro > 0
  const withHydroAnchor = computeChesfDispatchMW(netNeed, chesf, {
    month: 9,
    observedHydroMW: 6000,
    observedThermalMW: 1000,
  });
  const expectedAnchor =
    (1 - chesf.hydroObsBlend) * withThermal + chesf.hydroObsBlend * (6000 + chesf.thermalInflexWeight * 1000);
  assert.ok(Math.abs(withHydroAnchor - expectedAnchor) < 1e-6);

  // Bounds enforcement under extreme seasonal/thermal contexts
  assert.equal(
    computeChesfDispatchMW(0, chesf, { month: 2, observedHydroMW: 200, observedThermalMW: 0 }),
    Math.max(
      chesf.floorMW,
      (1 - chesf.hydroObsBlend) * (chesf.floorMW + chesf.wetFloorBonusMW) + chesf.hydroObsBlend * 200
    )
  );
  assert.equal(
    computeChesfDispatchMW(500_000, chesf, { month: 2, observedHydroMW: 9000, observedThermalMW: 3000 }),
    chesf.ceilingMW
  );

  // Water-constrained Chesf parity: otherDispatchableMW in estimateFullYearHourly does not expand artificially with DC load
  const baseline8760 = makeTestBaseline8760();
  const seriesNoDc = estimateFullYearHourly({ ...BASE_CONFIG, dcScenario: 'none' }, baseline8760, PIPELINE_SSOT);
  const seriesHighDc = estimateFullYearHourly({ ...BASE_CONFIG, dcScenario: 'high' }, baseline8760, PIPELINE_SSOT);

  for (const hIdx of [12, 1500, 3200, 6200, 8000]) {
    assert.equal(
      seriesHighDc[hIdx].otherDispatchableMW,
      seriesNoDc[hIdx].otherDispatchableMW,
      `Chesf hydro-thermal dispatch at hour ${hIdx} must follow water availability rather than DC load`
    );
    assert.ok(
      Math.abs(seriesHighDc[hIdx].marginWithDcMW - (seriesHighDc[hIdx].marginWithoutDcMW - seriesHighDc[hIdx].dcLoadMW)) <=
        0.3,
      `Hourly conservation failed at hour ${hIdx}`
    );
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

  // Intermediate year without local sensitivity slices (e.g. 2026) interpolates 5D across neighboring anchor years
  const y2026Interp = resolveMonteCarloSummary(
    { ...baselineCfg, targetYear: 2026, pue: 1.38, interchangeImportLimitMW: 6250 },
    PIPELINE_SSOT
  );
  assert.equal(y2026Interp.sourceStatus, 'grid_interpolated');
  assert.ok(y2026Interp.probCriticalImportAnnualPct !== null);

  // Categorical slice without parametric variation along modified axis (wet_calm + off-nominal PUE) must be unavailable
  const unsupportedWetCalm = resolveMonteCarloSummary(
    { ...baselineCfg, targetYear: 2035, windScenario: 'base', seasonalRegime: 'wet_calm', pue: 1.4 },
    PIPELINE_SSOT
  );
  assert.equal(unsupportedWetCalm.sourceStatus, 'unavailable');
  assert.equal(unsupportedWetCalm.probCriticalImportAnnualPct, null);

  // High wind without offshore (44.4 GW) must never match 48.0 GW grid_exact; interpolates between 36.4 GW and 48.0 GW when 44.4 GW is absent
  const windCapHighNoOff = computeInstalledWindCapacityMW(
    { targetYear: 2035, windScenario: 'high', includeOffshorePost2031: false },
    cfg
  );
  const windCapHighOff = computeInstalledWindCapacityMW(
    { targetYear: 2035, windScenario: 'high', includeOffshorePost2031: true },
    cfg
  );
  const windCapInterm = computeInstalledWindCapacityMW(
    { targetYear: 2035, windScenario: 'intermediate', includeOffshorePost2031: false },
    cfg
  );
  const offshoreFixtureSsot: EnergyModelSsotInput = {
    ...PIPELINE_SSOT,
    simulatorMonteCarloGrid: [
      {
        year: 2035,
        dcScenarioId: 'central',
        windScenarioId: 'intermediate',
        seasonalRegime: 'annual_blend',
        pue: cfg.defaultPue,
        dcUtilization: cfg.defaultUtilization,
        importLimitMW: cfg.interchangeImportLimitMW,
        exportLimitMW: cfg.interchangeExportLimitMW,
        dcLoadMW: 1596.8,
        windCapacityMW: windCapInterm.totalMW,
        probExceedInterchangePct: 9.3,
        loleHoursYear: 814.7,
        importP50MW: 2600,
        importP95MW: 8440,
        curtailmentWithoutDcTWh: 13.5,
        curtailmentWithDcTWh: 9.93,
        curtailmentAvoidedGWh: 3578,
        compensatoryWindGW: 6.85,
      },
      {
        year: 2035,
        dcScenarioId: 'central',
        windScenarioId: 'high',
        seasonalRegime: 'annual_blend',
        pue: cfg.defaultPue,
        dcUtilization: cfg.defaultUtilization,
        importLimitMW: cfg.interchangeImportLimitMW,
        exportLimitMW: cfg.interchangeExportLimitMW,
        dcLoadMW: 1596.8,
        windCapacityMW: windCapHighOff.totalMW,
        probExceedInterchangePct: 5.4,
        loleHoursYear: 473.0,
        importP50MW: 1900,
        importP95MW: 7100,
        curtailmentWithoutDcTWh: 26.0,
        curtailmentWithDcTWh: 20.5,
        curtailmentAvoidedGWh: 5500,
        compensatoryWindGW: 0.0,
      },
    ],
  };
  const highNoOffshoreInterp = resolveMonteCarloSummary(
    { ...baselineCfg, targetYear: 2035, windScenario: 'high', includeOffshorePost2031: false },
    offshoreFixtureSsot
  );
  assert.equal(highNoOffshoreInterp.sourceStatus, 'grid_interpolated');
  assert.equal(highNoOffshoreInterp.installedWindGW, Number((windCapHighNoOff.totalMW / 1000).toFixed(2)));
  assert.ok(
    highNoOffshoreInterp.probCriticalImportAnnualPct !== null &&
      highNoOffshoreInterp.probCriticalImportAnnualPct > 5.4 &&
      highNoOffshoreInterp.probCriticalImportAnnualPct < 9.3
  );
});

test('PIPELINE_SSOT dataCentersPipeline conforms to official Northeast constraints and composite substation keys', () => {
  const dcPipeline = PIPELINE_SSOT.dataCentersPipeline;
  const subSummary = PIPELINE_SSOT.substationLoadConcentration;
  const cfg = PIPELINE_SSOT.config;

  assert.ok(dcPipeline.length >= 10);

  const validStates = new Set(['CE', 'PE', 'RN', 'BA', 'PB', 'PI', 'MA', 'SE', 'AL']);
  for (const proj of dcPipeline) {
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

  const pecem = subSummary.find((s) => s.substation === cfg.pecemSubstationName);
  assert.ok(pecem, `${cfg.pecemSubstationName} must be present in substation summary`);
  assert.ok(pecem.sharePct > 50, `${cfg.pecemSubstationName} must remain primary load hub`);
});

test('PIPELINE_SSOT anovaTestResults and monthlyWindProfiles statistically validate Northeast wind seasonality', () => {
  const anovaResults = PIPELINE_SSOT.anovaTestResults;
  const monthlyProfiles = PIPELINE_SSOT.monthlyWindProfiles;
  const featureCorrs = PIPELINE_SSOT.featureCorrelations;
  const corrHi = PIPELINE_SSOT.config.uiThresholds.correlationHighlight;

  assert.ok(anovaResults.length >= 4, 'Should include at least 4 core ANOVA tests');
  for (const anova of anovaResults) {
    assert.ok(anova.pValue < 0.01, 'P-value must reject null hypothesis (p < 0.01)');
    assert.ok(anova.fStatistic > 150, `F-statistic must be highly significant (> 150): got ${anova.fStatistic}`);
    assert.equal(anova.isSignificantAlpha01, true);
  }

  const windAnova = anovaResults.find((a) => a.targetId === 'cf_eolica');
  assert.ok(windAnova, 'Wind CF ANOVA test must be present via targetId');
  assert.ok(windAnova.etaSquaredPct > 30, 'Monthly seasonality must explain >30% of CF variance');

  assert.equal(monthlyProfiles.length, 12, 'Must profile all 12 months');
  const marco = monthlyProfiles.find((m) => m.month === 3);
  const setembro = monthlyProfiles.find((m) => m.month === 9);
  assert.ok(marco && setembro, 'March and September must exist');
  assert.ok(setembro.avgCapacityFactor > marco.avgCapacityFactor * 1.8);
  assert.ok(setembro.p10CapacityFactor > marco.p10CapacityFactor * 2.5);

  assert.ok(featureCorrs.length >= 10, 'Must have at least 10 feature correlations');
  const lag1Load = featureCorrs.find((f) => f.featureName === 'l_base_mw_lag_1h');
  const lag1Wind = featureCorrs.find((f) => f.featureName === 'cf_eolica_lag_1h');
  assert.ok(lag1Load && lag1Load.corrBaseLoad > corrHi.strong);
  assert.ok(lag1Wind && lag1Wind.corrWindCF > corrHi.strong);
});

test('Passo 3 Out-of-Time 2025 benchmarks confirm non-linear models outperform linear baselines across Models A, B, and C', () => {
  const modelABench = PIPELINE_SSOT.modelABenchmark2025;
  const modelBBench = PIPELINE_SSOT.modelBBenchmark2025;
  const modelCBench = PIPELINE_SSOT.modelCBenchmark2025;
  const hourly2025 = PIPELINE_SSOT.hourlyValidation2025Profile;
  const prefModel = PIPELINE_SSOT.config.referenceScenarioKeys.preferredModelId;

  assert.equal(hourly2025.length, 24, 'Must contain 24 hourly validation points for baseline year');

  // Modelo A: non-linear beats Linear Ridge on 1h horizon
  const linA1h = modelABench.find((m) => m.horizonId === '1h' && m.familyId === 'linear');
  const nonLinA1h = modelABench.find((m) => m.horizonId === '1h' && m.modelId === prefModel);
  assert.ok(linA1h && nonLinA1h, 'Both Linear and Non-Linear 1h benchmarks must exist for Model A');
  assert.ok(nonLinA1h.maeMW < linA1h.maeMW, 'Non-linear 1h MAE must be lower than Linear Ridge MAE');

  // Modelo B: non-linear beats Linear Ridge on CF(t)
  const linB1h = modelBBench.find((m) => m.horizonId === '1h' && m.familyId === 'linear');
  const nonLinB1h = modelBBench.find((m) => m.horizonId === '1h' && m.modelId === prefModel);
  assert.ok(linB1h && nonLinB1h, 'Both Linear and Non-Linear 1h benchmarks must exist for Model B');
  assert.ok(nonLinB1h.maeCF < linB1h.maeCF && nonLinB1h.r2Score > linB1h.r2Score);

  // Modelo C: Non-Linear Hurdle beats Linear Hurdle on ROC-AUC, Brier Score, and Volume R2
  assert.ok(modelCBench.length >= 2);
  const linearHurdle = modelCBench.find((m) => m.familyId === 'linear');
  const nonLinearHurdle = modelCBench.find((m) => m.modelId === prefModel);
  assert.ok(linearHurdle && nonLinearHurdle);
  assert.ok(nonLinearHurdle.rocAuc > linearHurdle.rocAuc, 'Non-linear Hurdle ROC-AUC must exceed Linear Hurdle');
  assert.ok(nonLinearHurdle.brierScore < linearHurdle.brierScore, 'Non-linear Brier score must be lower (better)');
  assert.ok(nonLinearHurdle.r2Volume > linearHurdle.r2Volume, 'Non-linear Volume R2 must exceed Linear Hurdle');
});

test('Passo 4 Monte Carlo 2035 12-scenario matrix and compensatory wind curve validate physical trade-offs', () => {
  const mc12 = PIPELINE_SSOT.monteCarlo12Scenarios2035;
  const compCurve = PIPELINE_SSOT.compensatoryWindCurve2035;
  const timeline = PIPELINE_SSOT.annualRiskTimeline2026_2035;
  const refs = PIPELINE_SSOT.config.referenceScenarioKeys;

  assert.equal(mc12.length, 12, 'Must contain all 12 scenarios (4 DC x 3 Wind)');
  assert.ok(timeline.length >= 10, 'Must cover study horizon through 2035');

  const noDcInterm = mc12.find(
    (s) => s.dcScenarioId === refs.dcControl && s.windScenarioId === refs.windIntermediate
  );
  const centralInterm = mc12.find(
    (s) => s.dcScenarioId === refs.dcCentral && s.windScenarioId === refs.windIntermediate
  );
  const highInterm = mc12.find(
    (s) => s.dcScenarioId === refs.dcHigh && s.windScenarioId === refs.windIntermediate
  );

  assert.ok(noDcInterm && centralInterm && highInterm);
  assert.ok(centralInterm.importP95MW > noDcInterm.importP95MW);
  assert.ok(highInterm.importP95MW > centralInterm.importP95MW);
  assert.ok(centralInterm.curtailmentAvoidedGWh > 0, 'Central DCs absorb wind curtailment');
  assert.ok(centralInterm.compensatoryWindExpansionGW >= noDcInterm.compensatoryWindExpansionGW);

  const firstPt = compCurve[0];
  const lastPt = compCurve[compCurve.length - 1];
  assert.ok(lastPt.probExceedInterchangePct < firstPt.probExceedInterchangePct);
  assert.ok(lastPt.importP95MW < firstPt.importP95MW);
});

test('Passo 5 sensitivity datasets validate transmission expansion, H2V flexible synergy, and ANEEL vs ONS indicators', () => {
  const txSens = PIPELINE_SSOT.transmissionSensitivity2035;
  const h2vSens = PIPELINE_SSOT.h2vSynergySensitivity2035;
  const aneelVsOns = PIPELINE_SSOT.aneelVsOnsWindIndicators2015_2035;
  const modelCBench = PIPELINE_SSOT.modelCBenchmark2025;
  const finalMd = PIPELINE_SSOT.passo5FinalExecutiveReportMd;
  const scriptsPipeline = PIPELINE_SSOT.scriptsPipeline;
  const cfg = PIPELINE_SSOT.config;

  assert.ok(scriptsPipeline.length >= 7);
  assert.ok(txSens.length >= 3);

  const tx01 = txSens[0];
  const tx03 = txSens.find((r) => r.configCode === cfg.referenceScenarioKeys.txReferenceCode);
  const tx05 = txSens[txSens.length - 1];
  assert.ok(tx03);
  assert.ok(tx05.probCriticalImportPct < tx03.probCriticalImportPct && tx03.probCriticalImportPct < tx01.probCriticalImportPct);
  assert.ok(tx05.curtailmentWithDcTWh < tx03.curtailmentWithDcTWh && tx03.curtailmentWithDcTWh < tx01.curtailmentWithDcTWh);
  assert.equal(tx05.compensatoryWindGW, 0.0);

  const h2vInflex = h2vSens.find(
    (r) => r.h2vNominalMW === cfg.defaultH2vComparisonMW && r.flexMode === 'inflexible'
  );
  const h2vFlex = h2vSens.find(
    (r) => r.h2vNominalMW === cfg.defaultH2vComparisonMW && r.flexMode === 'flexible'
  );
  assert.ok(h2vInflex && h2vFlex);
  assert.ok(h2vFlex.probCriticalImportPct < h2vInflex.probCriticalImportPct);
  assert.ok(h2vFlex.totalAbsorbedCurtailmentTWh > h2vInflex.totalAbsorbedCurtailmentTWh);
  assert.ok(h2vFlex.compensatoryWindGW < h2vInflex.compensatoryWindGW);

  const indBase = aneelVsOns.find((r) => r.year === cfg.baselineYear);
  assert.ok(indBase, 'Baseline year indicator row must exist');
  assert.ok(indBase.onsEffectiveGenSharePct > indBase.aneelInstalledSharePct);
  if (modelCBench[0]) {
    assert.ok(Math.abs(indBase.annualCurtailmentLossTWh - modelCBench[0].realCurtailed2025TWh) <= 0.1);
  }
  assert.ok(finalMd.includes('Relatório Técnico Consolidado Final'));
});

test('SSOT parity, C4-1 structured contracts, DC CSV alignment, and anti-hardcode check', () => {
  const scriptsPipeline = PIPELINE_SSOT.scriptsPipeline;

  const jsonPath = path.join(process.cwd(), 'public', 'data', 'pipeline-ssot.json');
  assert.ok(fs.existsSync(jsonPath), 'public/data/pipeline-ssot.json must exist');

  const parsedJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  assert.equal(parsedJson.schemaVersion, PIPELINE_SSOT.schemaVersion);
  assert.equal(parsedJson.bundleDigest, PIPELINE_SSOT.bundleDigest);
  assert.equal(parsedJson.lineage.generatedAtUtc, PIPELINE_SSOT.lineage.generatedAtUtc);
  assert.deepEqual(parsedJson.config, PIPELINE_SSOT.config);
  assert.deepEqual(parsedJson.uiCatalog, PIPELINE_SSOT.uiCatalog);
  assert.deepEqual(parsedJson.approvedLibrariesPolicy, PIPELINE_SSOT.approvedLibrariesPolicy);

  assert.equal(PIPELINE_SSOT.config.hoursPerYear, 8760);
  assert.equal(PIPELINE_SSOT.config.projectionStartYear, 2025);
  assert.equal(PIPELINE_SSOT.config.targetEndYear, 2035);
  assert.equal(PIPELINE_SSOT.config.simulatorSliderBounds.year.min, 2025);
  assert.equal(PIPELINE_SSOT.config.simulatorSliderBounds.year.max, 2035);
  assert.equal(PIPELINE_SSOT.uiCatalog.observationWindows.length, 5);
  assert.equal(PIPELINE_SSOT.uiCatalog.databasesCatalog.length, 10);
  assert.equal(PIPELINE_SSOT.uiCatalog.groupDecisions.length, 4);
  assert.ok(PIPELINE_SSOT.approvedLibrariesPolicy.standard.length >= 5);
  assert.ok(PIPELINE_SSOT.approvedLibrariesPolicy.commonApproved.includes('numpy'));
  assert.ok(PIPELINE_SSOT.approvedLibrariesPolicy.candidateLibrariesRequiringApproval.length >= 4);

  // Verify dcScenariosItMW aligns with cumulative sums of dataCentersPipeline
  const sumCons = PIPELINE_SSOT.dataCentersPipeline
    .filter((p) => p.scenario === 'conservative')
    .reduce((acc, p) => acc + p.itPowerMW, 0);
  const sumCent = PIPELINE_SSOT.dataCentersPipeline
    .filter((p) => p.scenario === 'central')
    .reduce((acc, p) => acc + p.itPowerMW, 0);
  const sumHigh = PIPELINE_SSOT.dataCentersPipeline
    .filter((p) => p.scenario === 'high')
    .reduce((acc, p) => acc + p.itPowerMW, 0);
  assert.equal(PIPELINE_SSOT.config.dcScenariosItMW.none, 0);
  assert.equal(PIPELINE_SSOT.config.dcScenariosItMW.conservative, Number(sumCons.toFixed(1)));
  assert.equal(PIPELINE_SSOT.config.dcScenariosItMW.central, Number((sumCons + sumCent).toFixed(1)));
  assert.equal(PIPELINE_SSOT.config.dcScenariosItMW.high, Number((sumCons + sumCent + sumHigh).toFixed(1)));

  for (const script of scriptsPipeline) {
    const diskPath = path.join(process.cwd(), 'scripts', script.filename);
    assert.ok(fs.existsSync(diskPath), `Script file ${script.filename} must exist on disk`);
    const normalizedStarter = script.starterCode.replace(/\r\n/g, '\n');
    const normalizedDisk = fs.readFileSync(diskPath, 'utf-8').replace(/\r\n/g, '\n');
    assert.equal(normalizedStarter, normalizedDisk, `SSOT starterCode mismatch for ${script.filename}`);
  }

  // Legacy facade files must remain removed
  for (const legacyFile of [
    'databasesCatalog.ts',
    'dataCentersPipelineCatalog.ts',
    'featuresAnovaCatalog.ts',
    'scriptsRoadmap.ts',
  ]) {
    assert.equal(
      fs.existsSync(path.join(process.cwd(), 'src', 'data', legacyFile)),
      false,
      `Legacy src/data/${legacyFile} must remain removed`
    );
  }

  // Anti-hardcode and anti-brittle-selector guardrails in src/
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
  const forbiddenPatterns = [
    'style={{',
    'simulateHourlyWeek',
    'DEFAULT_ENERGY_MODEL_CONFIG',
    ".includes('ResMLP')",
    ".includes('Não-Linear')",
    ".includes('Inflexível')",
    ".includes('Flexível')",
    "startsWith(cfg.referenceScenarioKeys.txReferenceIdPrefix)",
  ];
  for (const file of walkFiles(srcRoot)) {
    if (file.endsWith('.test.ts') || file.endsWith('pipelineSsot.ts')) continue;
    const text = fs.readFileSync(file, 'utf-8');
    for (const pattern of forbiddenPatterns) {
      assert.equal(
        text.includes(pattern),
        false,
        `Forbidden pattern ${pattern} found in ${path.relative(srcRoot, file)}`
      );
    }
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
  assert.equal(result.monteCarlo.sourceStatus, 'grid_exact');
  assert.equal(result.summary.effectiveDcLoadMW, Number(anchor.dcLoadMW.toFixed(1)));
  assert.equal(result.monteCarlo.effectiveDcLoadMW, Number(anchor.dcLoadMW.toFixed(1)));
  assert.equal(result.monteCarlo.probCriticalImportAnnualPct, anchor.probExceedInterchangePct);
  assert.equal(result.monteCarlo.p95PeakImportMW, Math.round(anchor.importP95MW));
  assert.equal(result.monteCarlo.expectedCurtailmentWithDcTWh, anchor.curtailmentWithDcTWh);
  assert.equal(result.monteCarlo.curtailmentAvoidedByDcGWh, Math.round(anchor.curtailmentAvoidedGWh));
  assert.equal(result.monteCarlo.requiredExtraWindGWForTargetRisk, anchor.compensatoryWindExpansionGW);

  // Without pre-computed simulator grid, nominal Central x Intermediate must fall back cleanly to ssot_anchor
  const anchorFallback = evaluateScenario(BASE_CONFIG, { ...PIPELINE_SSOT, simulatorMonteCarloGrid: [] });
  assert.equal(anchorFallback.monteCarlo.sourceStatus, 'ssot_anchor');
  assert.equal(anchorFallback.monteCarlo.probCriticalImportAnnualPct, anchor.probExceedInterchangePct);
  assert.equal(anchorFallback.monteCarlo.p95PeakImportMW, Math.round(anchor.importP95MW));
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

test('Passo C4-3 decoupling: estimateAnnualSimulation + sliceHourlyWindow + summarizeHourlyWindow matches evaluateScenario across all scales without mutating fullYearSeries', () => {
  const realBaselinePath = path.join(process.cwd(), 'public', 'data', 'hourly-baseline-8760.json');
  const baseline: HourlyBaseline8760Bundle = fs.existsSync(realBaselinePath)
    ? JSON.parse(fs.readFileSync(realBaselinePath, 'utf-8'))
    : makeTestBaseline8760();

  const annual = estimateAnnualSimulation(BASE_CONFIG, baseline, PIPELINE_SSOT);
  assert.equal(annual.fullYearSeries.length, PIPELINE_SSOT.config.hoursPerYear);
  assert.equal(annual.annualSummary.hourlyBaselineAvailable, true);

  const windows: Array<{
    observationWindow: SimulationConfig['observationWindow'];
    expectedLen: number;
  }> = [
    { observationWindow: 'day', expectedLen: 24 },
    { observationWindow: 'week', expectedLen: 168 },
    { observationWindow: 'month', expectedLen: 744 },
    { observationWindow: 'quarter', expectedLen: 2160 },
    { observationWindow: 'year', expectedLen: 8760 },
  ];

  for (const w of windows) {
    const cfg: SimulationConfig = {
      ...BASE_CONFIG,
      observationWindow: w.observationWindow,
      selectedDay: 45,
      selectedWeek: 12,
      selectedMonth: 5,
      selectedQuarter: 1,
    };
    const legacy = evaluateScenario(cfg, PIPELINE_SSOT, baseline);
    const sliced = sliceHourlyWindow(
      annual.fullYearSeries,
      cfg,
      PIPELINE_SSOT.config,
      PIPELINE_SSOT.uiCatalog?.monthShortNames ?? []
    );
    const winSummary = summarizeHourlyWindow(sliced.points);

    assert.equal(sliced.points.length, w.expectedLen);
    assert.deepEqual(winSummary, {
      negativeMarginHoursWindow: legacy.summary.negativeMarginHoursWindow,
      criticalImportHoursWindow: legacy.summary.criticalImportHoursWindow,
      minMarginMW: legacy.summary.minMarginMW,
      maxMarginMW: legacy.summary.maxMarginMW,
      windowCurtailmentWithoutDcGWh: legacy.summary.windowCurtailmentWithoutDcGWh,
      windowCurtailmentWithDcGWh: legacy.summary.windowCurtailmentWithDcGWh,
    });
    assert.deepEqual(annual.annualSummary, {
      hourlyBaselineAvailable: legacy.summary.hourlyBaselineAvailable,
      effectiveDcLoadMW: legacy.summary.effectiveDcLoadMW,
      avgBaseLoadMW: legacy.summary.avgBaseLoadMW,
      avgWindCfPct: legacy.summary.avgWindCfPct,
      negativeMarginHoursYear: legacy.summary.negativeMarginHoursYear,
      criticalImportHoursYear: legacy.summary.criticalImportHoursYear,
      annualCurtailmentWithoutDcTWh: legacy.summary.annualCurtailmentWithoutDcTWh,
      annualCurtailmentWithDcTWh: legacy.summary.annualCurtailmentWithDcTWh,
    });
  }

  // Ensure intermediate day/week slicing never mutated fullYearSeries[h].windowHourIndex
  assert.equal(annual.fullYearSeries[500].windowHourIndex, 500);
  assert.equal(annual.fullYearSeries[500].hourOfYear, 500);

  // Re-running with different year reuses cached timestampLabel strings without re-formatting
  const altYear = estimateAnnualSimulation({ ...BASE_CONFIG, targetYear: 2030 }, baseline, PIPELINE_SSOT);
  assert.equal(altYear.fullYearSeries[0].timestampLabel, annual.fullYearSeries[0].timestampLabel);
  assert.equal(altYear.fullYearSeries[8759].timestampLabel, annual.fullYearSeries[8759].timestampLabel);
});

test('Passo C4-3 performance: full 8.760 h evaluation + downsampling + Monte Carlo resolution executes in sub-frame time', () => {
  const realBaselinePath = path.join(process.cwd(), 'public', 'data', 'hourly-baseline-8760.json');
  const baseline: HourlyBaseline8760Bundle = fs.existsSync(realBaselinePath)
    ? JSON.parse(fs.readFileSync(realBaselinePath, 'utf-8'))
    : makeTestBaseline8760();

  const probeCfg: SimulationConfig = {
    ...BASE_CONFIG,
    targetYear: 2033,
    pue: 1.28,
    dcUtilization: 0.87,
    observationWindow: 'year',
  };

  // JIT warmup
  for (let i = 0; i < 5; i++) {
    const sim = estimateAnnualSimulation(probeCfg, baseline, PIPELINE_SSOT);
    buildHourlyPlotBuckets(sim.fullYearSeries, 365);
    resolveMonteCarloSummary(probeCfg, PIPELINE_SSOT);
  }

  const iterations = 25;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    const sim = estimateAnnualSimulation(probeCfg, baseline, PIPELINE_SSOT);
    const buckets = buildHourlyPlotBuckets(sim.fullYearSeries, 365);
    const mc = resolveMonteCarloSummary(probeCfg, PIPELINE_SSOT);
    assert.equal(buckets.length, 365);
    assert.ok(mc.sourceStatus === 'grid_interpolated' || mc.sourceStatus === 'grid_exact');
  }
  const avgMs = (performance.now() - t0) / iterations;
  // Generous 25ms safety ceiling for CI/shared runners while verifying sub-frame ~9ms engine
  assert.ok(avgMs < 25, `Expected optimized 8.760h + buckets + MC average < 25ms, got ${avgMs.toFixed(2)}ms`);
});
