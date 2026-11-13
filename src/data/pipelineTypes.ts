export interface PipelineConfigSnapshot {
  subsystemId: string;
  baseWindOnshore2026MW: number;
  baseHydroThermalMW: number;
  interchangeImportLimitMW: number;
  interchangeExportLimitMW: number;
  defaultPue: number;
  defaultUtilization: number;
  dcScenariosItMW: {
    none: number;
    conservative: number;
    central: number;
    high: number;
  };
  windExpansionOnshoreMW: {
    base: number;
    intermediate: number;
    high: number;
  };
  officialDataUrls: Record<string, string>;
}

export interface PipelineLineageSnapshot {
  generatedAtUtc: string;
  windowLabel: string;
  trainHours: number;
  testHours: number;
  rawOnsFilesCount: number;
  rawDataTotalMb: number;
  yearsCovered: number[];
  reportFilesCount: number;
  sourceFiles: string[];
}

export interface DataCenterProject {
  id: string;
  name: string;
  developer: string;
  state: 'CE' | 'PE' | 'RN' | 'BA' | 'PB';
  municipality: string;
  substation: string;
  voltageKV: number;
  itPowerMW: number;
  totalGridPowerMW: number;
  estimatedPUE: number;
  publicationType: 'potencia_it' | 'potencia_total_rede';
  expectedStartYear: number;
  rampMonths: number;
  maturityStage: string;
  scenario: 'conservative' | 'central' | 'high';
  realizationProbability: number;
  expectedDelayYears: number;
  officialSource: string;
  notes: string;
}

export interface SubstationLoadSummary {
  substation: string;
  state: string;
  voltageKV: number;
  projectCount: number;
  itPowerTotalMW: number;
  effectiveDemand2035MW: number;
  sharePct: number;
  p95MonteCarloMW: number;
  congestionRisk: 'Crítico' | 'Elevado' | 'Moderado' | 'Baixo';
}

export interface ScenarioRampPoint {
  year: number;
  conservativeMW: number;
  centralMW: number;
  highMW: number;
  activeProjectsHigh: number;
}

export interface AnovaTestResult {
  targetVariable: string;
  groupingFactor: string;
  fStatistic: number;
  pValue: number;
  etaSquaredPct: number;
  isSignificantAlpha01: boolean;
  technicalInterpretation: string;
}

export interface MonthlyWindProfile {
  month: number;
  monthName: string;
  avgCapacityFactor: number;
  stdCapacityFactor: number;
  p10CapacityFactor: number;
  p50MedianCapacityFactor: number;
  p90CapacityFactor: number;
  avgBaseLoadMW: number;
  avgCurtailmentMW: number;
  seasonalRegime: 'Safra dos Ventos' | 'Estação Chuvosa / Calmaria' | 'Transição';
}

export interface FeatureCorrelationItem {
  featureName: string;
  featureDescription: string;
  corrBaseLoad: number;
  corrWindCF: number;
  corrCurtailment: number;
  roleInModel:
    | 'Autoregressiva (Lag)'
    | 'Harmônica (Fourier)'
    | 'Calendário'
    | 'Não-Linearidade Aerodinâmica'
    | 'Balanço Físico Exógeno';
}

export interface ModelABenchmarkRow {
  horizon: string;
  architecture: string;
  family: string;
  maeMW: number;
  rmseMW: number;
  mapePct: number;
  r2Score: number;
  peakHourMaeMW: number;
}

export interface ModelBBenchmarkRow {
  horizon: string;
  architecture: string;
  family: string;
  maeCF: number;
  rmseCF: number;
  r2Score: number;
  equivPowerMaeMW: number;
}

export interface ModelCBenchmarkRow {
  architecture: string;
  family: string;
  rocAuc: number;
  brierScore: number;
  f1Score: number;
  maeGlobalMW: number;
  r2Volume: number;
  realCurtailed2025TWh: number;
  predCurtailed2025TWh: number;
}

export interface HourlyValidation2025Point {
  hour: number;
  hourLabel: string;
  realLoadMW: number;
  predLoadNonLinearMW: number;
  realWindCfPct: number;
  predWindCfNonLinearPct: number;
  realSolarMW: number;
  realCurtailmentMW: number;
  predCurtailmentLinearMW: number;
  predCurtailmentNonLinearMW: number;
}

export interface MonteCarloScenario2035Row {
  scenarioName: string;
  dcScenarioId: 'none' | 'conservative' | 'central' | 'high';
  dcLoadMW: number;
  windOnshoreMW: number;
  windOffshoreMW: number;
  windCapacityMW: number;
  probExceedInterchangePct: number;
  loleCriticalHoursYear: number;
  importP50MW: number;
  importP90MW: number;
  importP95MW: number;
  curtailmentWithoutDcTWh: number;
  curtailmentWithDcTWh: number;
  curtailmentAvoidedGWh: number;
  curtailmentReductionPct: number;
  compensatoryWindExpansionGW: number;
}

export interface CompensatoryWindPoint {
  extraWindGW: number;
  totalWindGW: number;
  probExceedInterchangePct: number;
  loleHoursYear: number;
  importP95MW: number;
  curtailmentWithDcTWh: number;
  curtailmentAvoidedGWh: number;
  remainingExtraWindNeededGW: number;
}

export interface AnnualRiskTimelinePoint {
  year: number;
  dcLoadMW: number;
  windCapacityMW: number;
  probExceedInterchangePct: number;
  loleHoursYear: number;
  importP50MW: number;
  importP95MW: number;
  curtailmentWithDcTWh: number;
  curtailmentAvoidedGWh: number;
  compensatoryWindGW: number;
}

export interface TransmissionSensitivityRow {
  configId: string;
  importLimitMW: number;
  exportLimitMW: number;
  infrastructureDescription: string;
  probCriticalImportPct: number;
  loleHoursYear: number;
  importP95MW: number;
  curtailmentWithDcTWh: number;
  curtailmentWithoutDcTWh: number;
  curtailmentAvoidedGWh: number;
  compensatoryWindGW: number;
}

export interface H2VSynergySensitivityRow {
  scenarioId: string;
  dcLoadMW: number;
  h2vNominalMW: number;
  h2vEffectiveAvgMW: number;
  operatingRegime: string;
  probCriticalImportPct: number;
  importP95MW: number;
  remainingCurtailmentTWh: number;
  totalAbsorbedCurtailmentTWh: number;
  pecemSubstationLoadMW: number;
  compensatoryWindGW: number;
}

export interface AneelVsOnsWindIndicatorRow {
  year: number;
  periodLabel: string;
  installedWindGW: number;
  totalSubsystemCapGW: number;
  aneelInstalledSharePct: number;
  onsEffectiveGenSharePct: number;
  onsEffectiveCfPct: number;
  potentialUnconstrainedCfPct: number;
  annualCurtailmentLossTWh: number;
}

export interface ScriptSpec {
  id: string;
  order: string;
  filename: string;
  title: string;
  stageLabel: string;
  purpose: string;
  approvedLibraries: string[];
  multiprocessingStrategy: string;
  inputs: string[];
  outputs: string[];
  keyDecisionsForGroup: string[];
  starterCode: string;
}

export interface PipelineSsotBundle {
  schemaVersion: string;
  config: PipelineConfigSnapshot;
  lineage: PipelineLineageSnapshot;
  dataCentersPipeline: DataCenterProject[];
  substationLoadConcentration: SubstationLoadSummary[];
  scenarioAnnualRamp: ScenarioRampPoint[];
  anovaTestResults: AnovaTestResult[];
  monthlyWindProfiles: MonthlyWindProfile[];
  featureCorrelations: FeatureCorrelationItem[];
  modelABenchmark2025: ModelABenchmarkRow[];
  modelBBenchmark2025: ModelBBenchmarkRow[];
  modelCBenchmark2025: ModelCBenchmarkRow[];
  hourlyValidation2025Profile: HourlyValidation2025Point[];
  monteCarlo12Scenarios2035: MonteCarloScenario2035Row[];
  compensatoryWindCurve2035: CompensatoryWindPoint[];
  annualRiskTimeline2026_2035: AnnualRiskTimelinePoint[];
  transmissionSensitivity2035: TransmissionSensitivityRow[];
  h2vSynergySensitivity2035: H2VSynergySensitivityRow[];
  aneelVsOnsWindIndicators2015_2035: AneelVsOnsWindIndicatorRow[];
  passo5FinalExecutiveReportMd: string;
  scriptsPipeline: ScriptSpec[];
}
