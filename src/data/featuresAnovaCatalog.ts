import { PIPELINE_SSOT } from './generated/pipelineSsot';

export type {
  AneelVsOnsWindIndicatorRow,
  AnnualRiskTimelinePoint,
  AnovaTestResult,
  CompensatoryWindPoint,
  FeatureCorrelationItem,
  H2VSynergySensitivityRow,
  HourlyValidation2025Point,
  ModelABenchmarkRow,
  ModelBBenchmarkRow,
  ModelCBenchmarkRow,
  MonthlyWindProfile,
  MonteCarloScenario2035Row,
  TransmissionSensitivityRow,
} from './pipelineTypes';

export const ANOVA_TEST_RESULTS = PIPELINE_SSOT.anovaTestResults;
export const MONTHLY_WIND_PROFILES = PIPELINE_SSOT.monthlyWindProfiles;
export const FEATURE_CORRELATIONS = PIPELINE_SSOT.featureCorrelations;
export const MODEL_A_BENCHMARK_2025 = PIPELINE_SSOT.modelABenchmark2025;
export const MODEL_B_BENCHMARK_2025 = PIPELINE_SSOT.modelBBenchmark2025;
export const MODEL_C_BENCHMARK_2025 = PIPELINE_SSOT.modelCBenchmark2025;
export const HOURLY_VALIDATION_2025_PROFILE = PIPELINE_SSOT.hourlyValidation2025Profile;
export const MONTE_CARLO_12_SCENARIOS_2035 = PIPELINE_SSOT.monteCarlo12Scenarios2035;
export const COMPENSATORY_WIND_CURVE_2035 = PIPELINE_SSOT.compensatoryWindCurve2035;
export const ANNUAL_RISK_TIMELINE_2026_2035 = PIPELINE_SSOT.annualRiskTimeline2026_2035;
export const TRANSMISSION_SENSITIVITY_2035 = PIPELINE_SSOT.transmissionSensitivity2035;
export const H2V_SYNERGY_SENSITIVITY_2035 = PIPELINE_SSOT.h2vSynergySensitivity2035;
export const ANEEL_VS_ONS_WIND_INDICATORS_2015_2035 = PIPELINE_SSOT.aneelVsOnsWindIndicators2015_2035;
export const PASSO5_FINAL_EXECUTIVE_REPORT_MD = PIPELINE_SSOT.passo5FinalExecutiveReportMd;
