export type ObservationWindowId = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type DatabasePillarId =
  | 'all'
  | 'offshore'
  | 'datacenters'
  | 'capacidade_atual'
  | 'consumo_atual'
  | 'curtailment_clima';

export interface OfficialDatabaseEntry {
  id: string;
  pillar: Exclude<DatabasePillarId, 'all'>;
  pillarLabel: string;
  institution: string;
  datasetName: string;
  portalOrEndpoint: string;
  granularity: 'Horária' | 'Mensal / Anual' | 'Cadastral / Projetos';
  priority: 'Escopo Mínimo (Obrigatório)' | 'Cenário Estendido / Stress Test';
  targetModelRole: string;
  keyColumnsAndFilters: string[];
  methodologicalNotes: string;
  accessUrlLabel: string;
}

export interface GroupDecisionOption {
  value: string;
  label: string;
  rationale: string;
}

export interface GroupDecisionItem {
  id: string;
  topic: string;
  question: string;
  options: GroupDecisionOption[];
}

export interface SliderBoundSpec {
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface PipelineConfigSnapshot {
  subsystemId: string;
  baselineYear: number;
  historyStartYear: number;
  historyEndYear: number;
  coffStartYear: number;
  coffRegimeStartDate: string;
  modernBlockStartYear: number;
  projectionStartYear: number;
  rampStartYear: number;
  targetEndYear: number;
  offshoreStartYear: number;
  offshoreCommercialStartYear: number;
  hoursPerYear: number;
  daysPerYear: number;
  hoursPerDay: number;
  weeksPerYear: number;
  quartersPerYear: number;
  blockSizeHours: number;
  baseWindOnshore2026MW: number;
  baseHydroThermalMW: number;
  interchangeImportLimitMW: number;
  interchangeExportLimitMW: number;
  defaultPue: number;
  defaultUtilization: number;
  annualLoadGrowthRate: number;
  annualSolarGrowthRate: number;
  exportSolarCurtailmentCoef: number;
  curtailmentFlagThresholdMW: number;
  windRampExponent: number;
  offshoreScenarioMwPost2031: Record<'base' | 'intermediate' | 'high', number>;
  chesfDispatch: {
    floorMW: number;
    netNeedSlope: number;
    ceilingMW: number;
    wetMonths: number[];
    dryMonths: number[];
    wetFloorBonusMW: number;
    wetSlope: number;
    drySlope: number;
    thermalInflexWeight: number;
    hydroObsBlend: number;
  };
  thermalHydroInstalledCapMW: number;
  aneelProjectedYears: number[];
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
  referenceScenarioKeys: {
    dcControl: 'none';
    dcConservative: 'conservative';
    dcCentral: 'central';
    dcHigh: 'high';
    windBase: 'base';
    windIntermediate: 'intermediate';
    windHigh: 'high';
    txReferenceCode: string;
    txExpansionCode: string;
    h2vBaselineCode: string;
    txReferenceIdPrefix: string;
    h2vBaselineIdPrefix: string;
    preferredModelId: 'ridge' | 'logistic_ridge' | 'resmlp' | 'gbdt';
    preferredHorizonId: '1h' | '24h';
    preferredFamilyId: 'linear' | 'nonlinear';
  };
  pecemSubstationName: string;
  pecemH2vHubShare: number;
  defaultH2vComparisonMW: number;
  monteCarlo: {
    iterationsMain: number;
    iterationsTimeline: number;
    iterationsBottomUp: number;
    seed: number;
    maxWorkers: number;
    loadNoiseStd: number;
    windCompletionMin: number;
    windCompletionMax: number;
    windRegimeMin: number;
    windRegimeMax: number;
    offshoreCfGain: number;
    cfCeiling: number;
    dcLoadJitterMin: number;
    dcLoadJitterMax: number;
    projectDelayMultiplier: number;
    projectUtilMin: number;
    projectUtilMax: number;
    firmWindCfBase: number;
    firmWindCfDryWindy: number;
    firmWindCfWetCalm: number;
    firmWindCfOffshoreBonus: number;
    firmWindCfOffshoreMarginal: number;
    offshoreMarginalBlendMult: number;
    extraWindGwGrid: number[];
    iterationsSimulatorGrid: number;
    gridSensitivityYears: number[];
    gridPueValues: number[];
    gridUtilizationValues: number[];
  };
  h2vFlex: {
    inflexibleLoadFactor: number;
    flexHighCfThreshold: number;
    flexSolarHourMin: number;
    flexSolarHourMax: number;
    flexSolarCfThreshold: number;
    flexLowCfThreshold: number;
    flexPeakHourMin: number;
    flexPeakHourMax: number;
    flexHighFactor: number;
    flexMidFactor: number;
    flexLowFactor: number;
  };
  simulatorSliderBounds: {
    year: SliderBoundSpec;
    interchangeImportLimitMW: SliderBoundSpec;
    interchangeExportLimitMW: SliderBoundSpec;
    pue: SliderBoundSpec;
    dcUtilization: SliderBoundSpec;
    defaultDcScenario: 'none' | 'conservative' | 'central' | 'high';
    defaultWindScenario: 'base' | 'intermediate' | 'high';
    defaultSeasonalRegime: 'annual_blend' | 'dry_windy' | 'wet_calm';
    defaultObservationWindow: ObservationWindowId;
  };
  uiThresholds: {
    substationRisk: {
      criticalSharePct: number;
      criticalP95MW: number;
      highSharePct: number;
      highP95MW: number;
      moderateSharePct: number;
      moderateP95MW: number;
    };
    targetImportProbMaxPct: number;
    sensitivityBadges: {
      highRiskPct: number;
      lowRiskPct: number;
      highCompGw: number;
    };
    correlationHighlight: {
      strong: number;
      moderate: number;
      curtailmentStrong: number;
      curtailmentModerate: number;
    };
    substationShareBars: {
      criticalPct: number;
      highPct: number;
      scaleFactor: number;
    };
    ssotValidationTolerances: {
      probPct: number;
      importMW: number;
      curtailmentTWh: number;
      compGw: number;
    };
    chartPaddingRatio: number;
  };
  hourlyBaselineJsonUrl: string;
  officialDataUrls: Record<string, string>;
}

export interface PipelineUiCatalog {
  pdfAssetPath: string;
  pdfDownloadFilename: string;
  defaultExpandedDatabaseId: string;
  defaultPipelineProjectId: string;
  defaultSubstationFocus: string;
  secondarySubstationFocus: string;
  defaultCheckedDatabaseIds: string[];
  monthShortNames: string[];
  observationWindows: Array<{ id: ObservationWindowId; label: string; description: string }>;
  seasonalRegimes: Array<{ id: 'annual_blend' | 'dry_windy' | 'wet_calm'; label: string }>;
  anovaCategories: Array<{ id: string; label: string }>;
  dcScenarioCards: Record<
    'conservative' | 'central' | 'high',
    { title: string; subtitleSuffix: string; description: string }
  >;
  databasePillarLabels: Record<DatabasePillarId, string>;
  databasesCatalog: OfficialDatabaseEntry[];
  groupDecisions: GroupDecisionItem[];
}

export interface ApprovedLibrariesPolicy {
  standard: string[];
  commonApproved: string[];
  candidateLibrariesRequiringApproval: Array<{
    name: string;
    role: string;
    status: string;
  }>;
}

export interface PipelineLineageSnapshot {
  generatedAtUtc: string;
  windowLabel: string;
  trainHours: number;
  testHours: number;
  localRawCachePresent: boolean;
  comparativeNonLinearArchitecture: string;
  hourlyBaselineAvailable: boolean;
  hourlyBaselineUrl: string;
  hourlyBaselineDigest: string;
  hourlyBaselineHoursCount: number;
  simulatorGridAvailable: boolean;
  simulatorGridRowsCount: number;
  rawOnsFilesCount: number;
  rawDataTotalMb: number;
  yearsCovered: number[];
  reportFilesCount: number;
  sourceFiles: string[];
}

export interface HourlyBaselineRegimeData {
  lBaseMW: number[];
  cfWind: number[];
  gSolarMW: number[];
  gHydroMW: number[];
  gThermalMW: number[];
  curtailmentMW: number[];
}

export interface HourlyBaseline8760Bundle {
  schemaVersion: string;
  hoursCount: number;
  baselineYear: number;
  sourceWindow: string;
  generatedAtUtc: string;
  digest: string;
  month: number[];
  day: number[];
  hour: number[];
  regimes: Record<'annual_blend' | 'dry_windy' | 'wet_calm', HourlyBaselineRegimeData>;
}

export interface SimulatorMonteCarloGridRow {
  year: number;
  dcScenarioId: 'none' | 'conservative' | 'central' | 'high';
  windScenarioId: 'base' | 'intermediate' | 'high';
  seasonalRegime: 'annual_blend' | 'dry_windy' | 'wet_calm';
  pue: number;
  dcUtilization: number;
  importLimitMW: number;
  exportLimitMW: number;
  dcLoadMW: number;
  windCapacityMW: number;
  probExceedInterchangePct: number;
  loleHoursYear: number;
  importP50MW: number;
  importP95MW: number;
  curtailmentWithoutDcTWh: number;
  curtailmentWithDcTWh: number;
  curtailmentAvoidedGWh: number;
  compensatoryWindGW: number;
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

export type AnovaTargetId =
  | 'cf_eolica'
  | 'l_base_mw'
  | 'intercambio_liquido_mw'
  | 'curtailment_mw'
  | 'other';

export interface AnovaTestResult {
  targetId: AnovaTargetId;
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

export type BenchmarkHorizonId = '1h' | '24h' | 'exogenous_structural';
export type BenchmarkModelId = 'ridge' | 'logistic_ridge' | 'resmlp' | 'gbdt';
export type BenchmarkFamilyId = 'linear' | 'nonlinear';

export interface ModelABenchmarkRow {
  horizonId: BenchmarkHorizonId;
  modelId: BenchmarkModelId;
  familyId: BenchmarkFamilyId;
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
  horizonId: BenchmarkHorizonId;
  modelId: BenchmarkModelId;
  familyId: BenchmarkFamilyId;
  horizon: string;
  architecture: string;
  family: string;
  maeCF: number;
  rmseCF: number;
  r2Score: number;
  equivPowerMaeMW: number;
}

export interface ModelCBenchmarkRow {
  horizonId: BenchmarkHorizonId;
  modelId: BenchmarkModelId;
  familyId: BenchmarkFamilyId;
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
  windScenarioId: 'base' | 'intermediate' | 'high';
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
  configCode: string;
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

export type H2VFlexMode = 'none' | 'inflexible' | 'flexible';

export interface H2VSynergySensitivityRow {
  scenarioCode: string;
  flexMode: H2VFlexMode;
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
  bundleDigest: string;
  config: PipelineConfigSnapshot;
  uiCatalog: PipelineUiCatalog;
  approvedLibrariesPolicy: ApprovedLibrariesPolicy;
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
  simulatorMonteCarloGrid: SimulatorMonteCarloGridRow[];
  compensatoryWindCurve2035: CompensatoryWindPoint[];
  annualRiskTimeline2026_2035: AnnualRiskTimelinePoint[];
  transmissionSensitivity2035: TransmissionSensitivityRow[];
  h2vSynergySensitivity2035: H2VSynergySensitivityRow[];
  aneelVsOnsWindIndicators2015_2035: AneelVsOnsWindIndicatorRow[];
  passo5FinalExecutiveReportMd: string;
  scriptsPipeline: ScriptSpec[];
}
