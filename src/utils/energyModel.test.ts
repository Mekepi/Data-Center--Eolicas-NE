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

