import type {
  AneelVsOnsWindIndicatorRow,
  ModelABenchmarkRow,
  ModelBBenchmarkRow,
  ModelCBenchmarkRow,
  MonteCarloScenario2035Row,
  PipelineSsotBundle,
  ScenarioRampPoint,
} from '../data/pipelineTypes';

export interface FeaturesAnovaKpis {
  a1h: ModelABenchmarkRow | undefined;
  a24h: ModelABenchmarkRow | undefined;
  b1h: ModelBBenchmarkRow | undefined;
  cBest: ModelCBenchmarkRow | undefined;
  mcCentral: MonteCarloScenario2035Row | undefined;
  intermWindMW: number;
  ind2024: AneelVsOnsWindIndicatorRow | undefined;
  ind2025: AneelVsOnsWindIndicatorRow | undefined;
  ramp2035: ScenarioRampPoint | undefined;
  projPde2035LoadMW: number;
  baseWind2026GW: number;
  importLimitGW: number;
  txMinImportGW: number;
  txMaxImportGW: number;
  txMinExportGW: number;
  txMaxExportGW: number;
}

export function computeFeaturesAnovaKpis(ssot: PipelineSsotBundle): FeaturesAnovaKpis {
  const a1h = ssot.modelABenchmark2025.find((r) => r.horizon.includes('1h') && r.architecture.includes('ResMLP'));
  const a24h = ssot.modelABenchmark2025.find((r) => r.horizon.includes('24h') && r.architecture.includes('ResMLP'));
  const b1h = ssot.modelBBenchmark2025.find((r) => r.horizon.includes('1h') && r.architecture.includes('ResMLP'));
  const cBest = ssot.modelCBenchmark2025.find((r) => r.architecture.includes('ResMLP')) ?? ssot.modelCBenchmark2025[0];
  const intermWindMW = ssot.config.baseWindOnshore2026MW + ssot.config.windExpansionOnshoreMW.intermediate;
  const mcCentral = ssot.monteCarlo12Scenarios2035.find(
    (s) => s.dcScenarioId === 'central' && Math.abs(s.windCapacityMW - intermWindMW) < 100
  );
  const ind2024 = ssot.aneelVsOnsWindIndicators2015_2035.find((r) => r.year === 2024);
  const ind2025 = ssot.aneelVsOnsWindIndicators2015_2035.find((r) => r.year === 2025);
  const ramp2035 = ssot.scenarioAnnualRamp.find((r) => r.year === 2035);
  const hourly2025 = ssot.hourlyValidation2025Profile;
  const avgLoad2025MW =
    hourly2025.length > 0 ? hourly2025.reduce((acc, pt) => acc + pt.realLoadMW, 0) / hourly2025.length : 0;
  const projPde2035LoadMW = avgLoad2025MW * Math.pow(1.031, 10);
  const baseWind2026GW = ssot.config.baseWindOnshore2026MW / 1000;
  const importLimitGW = ssot.config.interchangeImportLimitMW / 1000;
  const txSensitivity = ssot.transmissionSensitivity2035;
  const txMinImportGW = txSensitivity.length > 0 ? Math.min(...txSensitivity.map((r) => r.importLimitMW)) / 1000 : 0;
  const txMaxImportGW = txSensitivity.length > 0 ? Math.max(...txSensitivity.map((r) => r.importLimitMW)) / 1000 : 0;
  const txMinExportGW = txSensitivity.length > 0 ? Math.min(...txSensitivity.map((r) => r.exportLimitMW)) / 1000 : 0;
  const txMaxExportGW = txSensitivity.length > 0 ? Math.max(...txSensitivity.map((r) => r.exportLimitMW)) / 1000 : 0;

  return {
    a1h,
    a24h,
    b1h,
    cBest,
    mcCentral,
    intermWindMW,
    ind2024,
    ind2025,
    ramp2035,
    projPde2035LoadMW,
    baseWind2026GW,
    importLimitGW,
    txMinImportGW,
    txMaxImportGW,
    txMinExportGW,
    txMaxExportGW,
  };
}
