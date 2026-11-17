import type {
  AnnualRiskTimelinePoint,
  HourlyBaseline8760Bundle,
  MonteCarloScenario2035Row,
  ObservationWindowId,
  PipelineConfigSnapshot,
  PipelineUiCatalog,
  ScenarioRampPoint,
  SimulatorMonteCarloGridRow,
  TransmissionSensitivityRow,
} from '../data/pipelineTypes';

export type DataCenterScenarioId = 'none' | 'conservative' | 'central' | 'high';
export type WindExpansionScenarioId = 'base' | 'intermediate' | 'high';
export type SeasonalRegimeId = 'annual_blend' | 'dry_windy' | 'wet_calm';
export type { ObservationWindowId };

export type EnergyModelCoreConfig = PipelineConfigSnapshot;

export interface EnergyModelSsotInput {
  config: PipelineConfigSnapshot;
  uiCatalog?: Pick<PipelineUiCatalog, 'monthShortNames'>;
  lineage?: {
    hourlyBaselineAvailable?: boolean;
    simulatorGridAvailable?: boolean;
  };
  scenarioAnnualRamp?: ScenarioRampPoint[];
  monteCarlo12Scenarios2035?: MonteCarloScenario2035Row[];
  annualRiskTimeline2026_2035?: AnnualRiskTimelinePoint[];
  transmissionSensitivity2035?: TransmissionSensitivityRow[];
  simulatorMonteCarloGrid?: SimulatorMonteCarloGridRow[];
}

export interface SimulationConfig {
  targetYear: number;
  dcScenario: DataCenterScenarioId;
  windScenario: WindExpansionScenarioId;
  includeOffshorePost2031: boolean;
  seasonalRegime: SeasonalRegimeId;
  pue: number;
  dcUtilization: number;
  isPublishedPowerTotalGrid: boolean;
  interchangeImportLimitMW: number;
  interchangeExportLimitMW: number;
  observationWindow: ObservationWindowId;
  selectedDay: number;
  selectedWeek: number;
  selectedMonth: number;
  selectedQuarter: number;
}

export interface HourlyPoint {
  hourOfYear: number;
  windowHourIndex: number;
  month: number;
  dayOfMonth: number;
  hourOfDay: number;
  timestampLabel: string;
  baseLoadMW: number;
  dcLoadMW: number;
  totalLoadMW: number;
  windCapacityFactor: number;
  windGenPotentialMW: number;
  solarGenMW: number;
  otherDispatchableMW: number;
  totalGenPotentialMW: number;
  marginWithoutDcMW: number;
  marginWithDcMW: number;
  exceedsImportLimit: boolean;
  curtailmentWithoutDcMW: number;
  curtailmentWithDcMW: number;
}

export interface HourlyPlotBucket {
  indexStart: number;
  indexEnd: number;
  indexCenter: number;
  xFrac: number;
  meanMarginWithDcMW: number;
  minMarginWithDcMW: number;
  maxMarginWithDcMW: number;
  meanMarginWithoutDcMW: number;
  meanBaseLoadMW: number;
  meanTotalLoadMW: number;
  meanTotalGenPotentialMW: number;
}

export interface WindowSliceResult {
  windowId: ObservationWindowId;
  windowLabel: string;
  hoursCount: number;
  points: HourlyPoint[];
}

export type MonteCarloSourceStatus =
  | 'grid_exact'
  | 'grid_interpolated'
  | 'ssot_anchor'
  | 'unavailable';

export interface MonteCarloSummary {
  sourceStatus: MonteCarloSourceStatus;
  effectiveDcLoadMW: number;
  installedWindGW: number;
  onshoreWindGW: number;
  offshoreWindGW: number;
  probCriticalImportAnnualPct: number | null;
  probCriticalWithoutDcPct: number | null;
  loleCriticalHoursYear: number | null;
  p95PeakImportMW: number | null;
  p50PeakImportMW: number | null;
  expectedCurtailmentWithoutDcTWh: number | null;
  expectedCurtailmentWithDcTWh: number | null;
  curtailmentAvoidedByDcGWh: number | null;
  requiredExtraWindGWForTargetRisk: number | null;
}

export interface EvaluationSummary {
  hourlyBaselineAvailable: boolean;
  effectiveDcLoadMW: number;
  avgBaseLoadMW: number | null;
  avgWindCfPct: number | null;
  negativeMarginHoursYear: number | null;
  criticalImportHoursYear: number | null;
  negativeMarginHoursWindow: number | null;
  criticalImportHoursWindow: number | null;
  minMarginMW: number | null;
  maxMarginMW: number | null;
  annualCurtailmentWithoutDcTWh: number | null;
  annualCurtailmentWithDcTWh: number | null;
  windowCurtailmentWithoutDcGWh: number | null;
  windowCurtailmentWithDcGWh: number | null;
}

export interface EvaluationResult {
  fullYearSeries: HourlyPoint[];
  windowSlice: WindowSliceResult;
  hourlySeries: HourlyPoint[];
  summary: EvaluationSummary;
  monteCarlo: MonteCarloSummary;
}

export function buildDefaultSimulationConfig(config: PipelineConfigSnapshot): SimulationConfig {
  const bounds = config.simulatorSliderBounds;
  return {
    targetYear: bounds.year.default,
    dcScenario: bounds.defaultDcScenario,
    windScenario: bounds.defaultWindScenario,
    includeOffshorePost2031: false,
    seasonalRegime: bounds.defaultSeasonalRegime,
    pue: bounds.pue.default,
    dcUtilization: bounds.dcUtilization.default,
    isPublishedPowerTotalGrid: false,
    interchangeImportLimitMW: bounds.interchangeImportLimitMW.default,
    interchangeExportLimitMW: bounds.interchangeExportLimitMW.default,
    observationWindow: bounds.defaultObservationWindow,
    selectedDay: 1,
    selectedWeek: 1,
    selectedMonth: 1,
    selectedQuarter: 1,
  };
}

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

interface CachedBaselineLabels {
  monthNamesKey: string;
  labels: string[];
}

const baselineLabelCache = new WeakMap<HourlyBaseline8760Bundle, CachedBaselineLabels>();
const canonicalFullYearSeriesSet = new WeakSet<HourlyPoint[]>();

function getBaselineTimestampLabels(
  hourlyBaseline: HourlyBaseline8760Bundle,
  monthShortNames: string[]
): string[] {
  const key = monthShortNames.join('|');
  const cached = baselineLabelCache.get(hourlyBaseline);
  if (cached && cached.monthNamesKey === key && cached.labels.length === hourlyBaseline.hoursCount) {
    return cached.labels;
  }

  const totalHours = hourlyBaseline.hoursCount;
  const labels = new Array<string>(totalHours);
  const months = hourlyBaseline.month;
  const days = hourlyBaseline.day;
  const hours = hourlyBaseline.hour;

  const paddedTwo = new Array<string>(32);
  for (let i = 0; i < 32; i++) {
    paddedTwo[i] = i < 10 ? `0${i}` : `${i}`;
  }

  for (let h = 0; h < totalHours; h++) {
    const m = months[h] ?? 1;
    const d = days[h] ?? 1;
    const hr = hours[h] ?? h % 24;
    const mLabel = monthShortNames[m - 1] ?? `M${m < 10 ? `0${m}` : `${m}`}`;
    const dStr = d >= 0 && d < 32 ? paddedTwo[d] : String(d).padStart(2, '0');
    const hStr = hr >= 0 && hr < 32 ? paddedTwo[hr] : String(hr).padStart(2, '0');
    labels[h] = `${dStr}/${mLabel} · ${hStr}h`;
  }

  baselineLabelCache.set(hourlyBaseline, { monthNamesKey: key, labels });
  return labels;
}

export function computeDataCenterLoadMW(params: {
  itPowerMW: number;
  utilization: number;
  pue: number;
  rampFactor: number;
  isPublishedPowerTotalGrid: boolean;
}): number {
  const util = clamp(params.utilization, 0, 1);
  const ramp = clamp(params.rampFactor, 0, 1);
  const pue = Math.max(1.0, params.pue);
  if (params.isPublishedPowerTotalGrid) {
    return round1(params.itPowerMW * util * ramp);
  }
  return round1(params.itPowerMW * util * pue * ramp);
}

export function computeWindGenerationMW(capacityFactor: number, installedMW: number): number {
  const cf = clamp(capacityFactor, 0, 1);
  return round1(cf * Math.max(0, installedMW));
}

export function computeDcRampFactor(targetYear: number, ssotConfig: PipelineConfigSnapshot): number {
  if (targetYear < ssotConfig.rampStartYear) return 0;
  const totalRampYears = Math.max(1, ssotConfig.targetEndYear - ssotConfig.rampStartYear + 1);
  const progress = clamp((targetYear - ssotConfig.rampStartYear + 1) / totalRampYears, 0, 1);
  return round4(Math.pow(progress, ssotConfig.windRampExponent));
}

export function resolveEffectiveDcLoadMW(
  config: Pick<SimulationConfig, 'targetYear' | 'dcScenario' | 'pue' | 'dcUtilization' | 'isPublishedPowerTotalGrid'>,
  ssot: EnergyModelSsotInput
): number {
  if (config.dcScenario === 'none') return 0;

  const ssotCfg = ssot.config;
  const rampRows = ssot.scenarioAnnualRamp ?? [];
  const exactRamp = rampRows.find((r) => r.year === config.targetYear);

  if (exactRamp) {
    const baseNominalLoadMW =
      config.dcScenario === 'conservative'
        ? exactRamp.conservativeMW
        : config.dcScenario === 'central'
          ? exactRamp.centralMW
          : exactRamp.highMW;

    const utilFactor = ssotCfg.defaultUtilization > 0 ? config.dcUtilization / ssotCfg.defaultUtilization : 1;
    const pueFactor = config.isPublishedPowerTotalGrid
      ? ssotCfg.defaultPue > 0
        ? 1 / ssotCfg.defaultPue
        : 1
      : ssotCfg.defaultPue > 0
        ? config.pue / ssotCfg.defaultPue
        : 1;

    return round1(baseNominalLoadMW * utilFactor * pueFactor);
  }

  if (config.targetYear < ssotCfg.rampStartYear) {
    return 0;
  }

  return computeDataCenterLoadMW({
    itPowerMW: ssotCfg.dcScenariosItMW[config.dcScenario],
    utilization: config.dcUtilization,
    pue: config.pue,
    rampFactor: computeDcRampFactor(config.targetYear, ssotCfg),
    isPublishedPowerTotalGrid: config.isPublishedPowerTotalGrid,
  });
}

export function computeInstalledWindCapacityMW(
  params: {
    targetYear: number;
    windScenario: WindExpansionScenarioId;
    includeOffshorePost2031: boolean;
  },
  ssotConfig: PipelineConfigSnapshot
): { onshoreMW: number; offshoreMW: number; totalMW: number } {
  const onshoreSpan = Math.max(1, ssotConfig.targetEndYear - ssotConfig.rampStartYear);
  const onshoreProgress = clamp((params.targetYear - ssotConfig.rampStartYear) / onshoreSpan, 0, 1);
  const onshoreExpansion =
    ssotConfig.windExpansionOnshoreMW[params.windScenario] *
    Math.pow(onshoreProgress, ssotConfig.windRampExponent);
  const onshoreMW = Math.round(ssotConfig.baseWindOnshore2026MW + onshoreExpansion);

  let offshoreMW = 0;
  if (params.includeOffshorePost2031 && params.targetYear >= ssotConfig.offshoreCommercialStartYear) {
    const offshoreSpan = Math.max(1, ssotConfig.targetEndYear - ssotConfig.offshoreStartYear);
    const offshoreProgress = clamp((params.targetYear - ssotConfig.offshoreStartYear) / offshoreSpan, 0, 1);
    offshoreMW = Math.round(ssotConfig.offshoreScenarioMwPost2031[params.windScenario] * offshoreProgress);
  }

  return {
    onshoreMW,
    offshoreMW,
    totalMW: onshoreMW + offshoreMW,
  };
}

export interface ChesfDispatchContext {
  month?: number;
  observedHydroMW?: number;
  observedThermalMW?: number;
}

export function computeChesfDispatchMW(
  netNeedMW: number,
  chesfConfig: PipelineConfigSnapshot['chesfDispatch'],
  context?: ChesfDispatchContext
): number {
  const positiveNeed = Math.max(0, netNeedMW);
  if (
    !context ||
    (context.month === undefined &&
      context.observedHydroMW === undefined &&
      context.observedThermalMW === undefined)
  ) {
    const raw = chesfConfig.floorMW + chesfConfig.netNeedSlope * positiveNeed;
    return clamp(raw, chesfConfig.floorMW, chesfConfig.ceilingMW);
  }

  let seasonalFloor = chesfConfig.floorMW;
  let seasonalSlope = chesfConfig.netNeedSlope;
  if (context.month !== undefined) {
    const isWet = chesfConfig.wetMonths.includes(context.month);
    const isDry = chesfConfig.dryMonths.includes(context.month);
    if (isWet) {
      seasonalFloor = chesfConfig.floorMW + chesfConfig.wetFloorBonusMW;
      seasonalSlope = chesfConfig.wetSlope;
    } else if (isDry) {
      seasonalFloor = chesfConfig.floorMW;
      seasonalSlope = chesfConfig.drySlope;
    } else {
      seasonalFloor = chesfConfig.floorMW + 0.5 * chesfConfig.wetFloorBonusMW;
      seasonalSlope = chesfConfig.netNeedSlope;
    }
  }

  const obsThermal = Math.max(0, context.observedThermalMW ?? 0);
  const thermalInflex = chesfConfig.thermalInflexWeight * obsThermal;
  const modelCurve = seasonalFloor + seasonalSlope * positiveNeed + thermalInflex;

  const obsHydro = context.observedHydroMW ?? 0;
  let modulated = modelCurve;
  if (obsHydro > 0) {
    const obsAnchor = obsHydro + thermalInflex;
    modulated = (1 - chesfConfig.hydroObsBlend) * modelCurve + chesfConfig.hydroObsBlend * obsAnchor;
  }
  return clamp(modulated, chesfConfig.floorMW, chesfConfig.ceilingMW);
}

export type AnnualSimulationConfig = Pick<
  SimulationConfig,
  | 'targetYear'
  | 'dcScenario'
  | 'windScenario'
  | 'includeOffshorePost2031'
  | 'seasonalRegime'
  | 'pue'
  | 'dcUtilization'
  | 'isPublishedPowerTotalGrid'
  | 'interchangeImportLimitMW'
  | 'interchangeExportLimitMW'
>;

export interface AnnualMetricsSummary {
  hourlyBaselineAvailable: boolean;
  effectiveDcLoadMW: number;
  avgBaseLoadMW: number | null;
  avgWindCfPct: number | null;
  negativeMarginHoursYear: number | null;
  criticalImportHoursYear: number | null;
  annualCurtailmentWithoutDcTWh: number | null;
  annualCurtailmentWithDcTWh: number | null;
}

export interface AnnualSimulationResult {
  fullYearSeries: HourlyPoint[];
  annualSummary: AnnualMetricsSummary;
}

export function estimateAnnualSimulation(
  config: AnnualSimulationConfig,
  hourlyBaseline: HourlyBaseline8760Bundle | null,
  ssot: EnergyModelSsotInput
): AnnualSimulationResult {
  const dcLoadMW = resolveEffectiveDcLoadMW(config, ssot);
  if (!hourlyBaseline || hourlyBaseline.hoursCount <= 0) {
    return {
      fullYearSeries: [],
      annualSummary: {
        hourlyBaselineAvailable: false,
        effectiveDcLoadMW: dcLoadMW,
        avgBaseLoadMW: null,
        avgWindCfPct: null,
        negativeMarginHoursYear: null,
        criticalImportHoursYear: null,
        annualCurtailmentWithoutDcTWh: null,
        annualCurtailmentWithDcTWh: null,
      },
    };
  }

  const ssotCfg = ssot.config;
  const regData = hourlyBaseline.regimes[config.seasonalRegime] ?? hourlyBaseline.regimes.annual_blend;
  if (!regData) {
    return {
      fullYearSeries: [],
      annualSummary: {
        hourlyBaselineAvailable: false,
        effectiveDcLoadMW: dcLoadMW,
        avgBaseLoadMW: null,
        avgWindCfPct: null,
        negativeMarginHoursYear: null,
        criticalImportHoursYear: null,
        annualCurtailmentWithoutDcTWh: null,
        annualCurtailmentWithDcTWh: null,
      },
    };
  }

  const monthNames = ssot.uiCatalog?.monthShortNames ?? [];
  const totalHours = hourlyBaseline.hoursCount;
  const yearsFromBaseline = Math.max(0, config.targetYear - ssotCfg.baselineYear);
  const loadGrowth = Math.pow(1 + ssotCfg.annualLoadGrowthRate, yearsFromBaseline);
  const solarGrowth = 1 + ssotCfg.annualSolarGrowthRate * yearsFromBaseline;

  const windCap = computeInstalledWindCapacityMW(
    {
      targetYear: config.targetYear,
      windScenario: config.windScenario,
      includeOffshorePost2031: config.includeOffshorePost2031,
    },
    ssotCfg
  );
  const windTotalMW = windCap.totalMW;
  const roundedDcLoadMW = round1(dcLoadMW);
  const timestampLabels = getBaselineTimestampLabels(hourlyBaseline, monthNames);

  const chesf = ssotCfg.chesfDispatch;
  const chesfFloor = chesf.floorMW;
  const chesfCeiling = chesf.ceilingMW;
  const thermalWeight = chesf.thermalInflexWeight;
  const hydroBlend = chesf.hydroObsBlend;
  const oneMinusHydroBlend = 1 - hydroBlend;
  const exportCoef = ssotCfg.exportSolarCurtailmentCoef;
  const exportLimitMW = config.interchangeExportLimitMW;
  const importLimitNegMW = -config.interchangeImportLimitMW;
  const hoursPerDay = ssotCfg.hoursPerDay;

  // Lookup tables O(1) por mês (1..12) evitando array.includes() e alocações por hora
  const monthFloor = new Float64Array(13);
  const monthSlope = new Float64Array(13);
  for (let m = 1; m <= 12; m++) {
    if (chesf.wetMonths.includes(m)) {
      monthFloor[m] = chesfFloor + chesf.wetFloorBonusMW;
      monthSlope[m] = chesf.wetSlope;
    } else if (chesf.dryMonths.includes(m)) {
      monthFloor[m] = chesfFloor;
      monthSlope[m] = chesf.drySlope;
    } else {
      monthFloor[m] = chesfFloor + 0.5 * chesf.wetFloorBonusMW;
      monthSlope[m] = chesf.netNeedSlope;
    }
  }

  const monthsArr = hourlyBaseline.month;
  const daysArr = hourlyBaseline.day;
  const hoursArr = hourlyBaseline.hour;
  const lBaseArr = regData.lBaseMW;
  const cfWindArr = regData.cfWind;
  const gSolarArr = regData.gSolarMW;
  const gHydroArr = regData.gHydroMW;
  const gThermalArr = regData.gThermalMW;

  const series: HourlyPoint[] = new Array<HourlyPoint>(totalHours);
  let sumBaseLoad = 0;
  let sumWindCf = 0;
  let negMarginYear = 0;
  let critImportYear = 0;
  let curtNoDcYearMWh = 0;
  let curtWithDcYearMWh = 0;

  for (let h = 0; h < totalHours; h++) {
    const month = monthsArr[h] ?? 1;
    const dayOfMonth = daysArr[h] ?? 1;
    const hourOfDay = hoursArr[h] ?? h % hoursPerDay;

    const baseLoadRaw = lBaseArr[h] * loadGrowth;
    const totalLoadRaw = baseLoadRaw + dcLoadMW;
    const rawCf = cfWindArr[h];
    const windCfRaw = rawCf < 0 ? 0 : rawCf > 1 ? 1 : rawCf;
    const windGenRaw = windCfRaw * windTotalMW;
    const solarGenRaw = gSolarArr[h] * solarGrowth;

    const netNeedBaseMW = baseLoadRaw - (windGenRaw + solarGenRaw);
    const positiveNeed = netNeedBaseMW > 0 ? netNeedBaseMW : 0;

    const mIdx = month >= 1 && month <= 12 ? month : 0;
    const sFloor = mIdx > 0 ? monthFloor[mIdx] : chesfFloor + 0.5 * chesf.wetFloorBonusMW;
    const sSlope = mIdx > 0 ? monthSlope[mIdx] : chesf.netNeedSlope;

    const rawThermal = gThermalArr[h] ?? 0;
    const obsThermal = rawThermal > 0 ? rawThermal : 0;
    const thermalInflex = thermalWeight * obsThermal;
    const modelCurve = sFloor + sSlope * positiveNeed + thermalInflex;

    const obsHydro = gHydroArr[h] ?? 0;
    const modulated =
      obsHydro > 0 ? oneMinusHydroBlend * modelCurve + hydroBlend * (obsHydro + thermalInflex) : modelCurve;
    const chesfRaw = modulated < chesfFloor ? chesfFloor : modulated > chesfCeiling ? chesfCeiling : modulated;

    const totalGenRaw = windGenRaw + solarGenRaw + chesfRaw;
    const marginNoDcRaw = totalGenRaw - baseLoadRaw;
    const marginWithDcRaw = totalGenRaw - totalLoadRaw;

    const baseLoadMW = round1(baseLoadRaw);
    const totalLoadMW = round1(totalLoadRaw);
    const windCapacityFactor = round4(windCfRaw);
    const windGenPotentialMW = round1(windGenRaw);
    const solarGenMW = round1(solarGenRaw);
    const exportThresholdMW = Math.max(0, config.interchangeExportLimitMW - ssotCfg.exportSolarCurtailmentCoef * solarGenMW);
    const curtNoDcDiff = marginNoDcRaw - exportThresholdMW;
    const curtWithDcDiff = marginWithDcRaw - exportThresholdMW;
    const curtNoDcRaw = curtNoDcDiff > 0 ? curtNoDcDiff : 0;
    const curtWithDcRaw = curtWithDcDiff > 0 ? curtWithDcDiff : 0;
    const otherDispatchableMW = round1(chesfRaw);
    const totalGenPotentialMW = round1(totalGenRaw);
    const marginWithoutDcMW = round1(marginNoDcRaw);
    const marginWithDcMW = round1(marginWithDcRaw);
    const exceedsImportLimit = marginWithDcMW < importLimitNegMW;
    const curtailmentWithoutDcMW = round1(curtNoDcRaw);
    const curtailmentWithDcMW = round1(curtWithDcRaw);

    sumBaseLoad += baseLoadMW;
    sumWindCf += windCapacityFactor;
    if (marginWithDcMW < 0) negMarginYear++;
    if (exceedsImportLimit) critImportYear++;
    curtNoDcYearMWh += curtailmentWithoutDcMW;
    curtWithDcYearMWh += curtailmentWithDcMW;

    series[h] = {
      hourOfYear: h,
      windowHourIndex: h,
      month,
      dayOfMonth,
      hourOfDay,
      timestampLabel: timestampLabels[h],
      baseLoadMW,
      dcLoadMW: roundedDcLoadMW,
      totalLoadMW,
      windCapacityFactor,
      windGenPotentialMW,
      solarGenMW,
      otherDispatchableMW,
      totalGenPotentialMW,
      marginWithoutDcMW,
      marginWithDcMW,
      exceedsImportLimit,
      curtailmentWithoutDcMW,
      curtailmentWithDcMW,
    };
  }

  canonicalFullYearSeriesSet.add(series);

  const invHours = 1 / totalHours;
  return {
    fullYearSeries: series,
    annualSummary: {
      hourlyBaselineAvailable: true,
      effectiveDcLoadMW: dcLoadMW,
      avgBaseLoadMW: Math.round(sumBaseLoad * invHours),
      avgWindCfPct: round1(sumWindCf * invHours * 100),
      negativeMarginHoursYear: negMarginYear,
      criticalImportHoursYear: critImportYear,
      annualCurtailmentWithoutDcTWh: Number((curtNoDcYearMWh / 1_000_000).toFixed(2)),
      annualCurtailmentWithDcTWh: Number((curtWithDcYearMWh / 1_000_000).toFixed(2)),
    },
  };
}

export function estimateFullYearHourly(
  config: SimulationConfig,
  hourlyBaseline: HourlyBaseline8760Bundle | null,
  ssot: EnergyModelSsotInput
): HourlyPoint[] {
  return estimateAnnualSimulation(config, hourlyBaseline, ssot).fullYearSeries;
}

export function sliceHourlyWindow(
  fullYearSeries: HourlyPoint[],
  config: Pick<
    SimulationConfig,
    'targetYear' | 'observationWindow' | 'selectedDay' | 'selectedWeek' | 'selectedMonth' | 'selectedQuarter'
  >,
  ssotConfig: PipelineConfigSnapshot,
  monthShortNames: string[] = []
): WindowSliceResult {
  const windowId = config.observationWindow;
  const totalLen = fullYearSeries.length;
  if (totalLen === 0) {
    return {
      windowId,
      windowLabel: `${config.targetYear}`,
      hoursCount: 0,
      points: [],
    };
  }

  if (windowId === 'year') {
    const windowLabel = `Ano Completo ${config.targetYear} · ${totalLen.toLocaleString('pt-BR')} h`;
    if (canonicalFullYearSeriesSet.has(fullYearSeries)) {
      return {
        windowId,
        windowLabel,
        hoursCount: totalLen,
        points: fullYearSeries,
      };
    }
    const points = new Array<HourlyPoint>(totalLen);
    for (let i = 0; i < totalLen; i++) {
      const pt = fullYearSeries[i];
      points[i] = pt.windowHourIndex === i ? pt : { ...pt, windowHourIndex: i };
    }
    return {
      windowId,
      windowLabel,
      hoursCount: totalLen,
      points,
    };
  }

  if (windowId === 'day') {
    const dayIdx = clamp(Math.round(config.selectedDay), 1, ssotConfig.daysPerYear);
    const start = Math.min(Math.max(0, totalLen - ssotConfig.hoursPerDay), (dayIdx - 1) * ssotConfig.hoursPerDay);
    const end = Math.min(totalLen, start + ssotConfig.hoursPerDay);
    const count = Math.max(0, end - start);
    const points = new Array<HourlyPoint>(count);
    for (let idx = 0; idx < count; idx++) {
      points[idx] = { ...fullYearSeries[start + idx], windowHourIndex: idx };
    }
    const datePart = points[0]?.timestampLabel.split(' · ')[0] ?? `Dia ${dayIdx}`;
    return {
      windowId,
      windowLabel: `Dia ${dayIdx}/${ssotConfig.daysPerYear} (${datePart}/${config.targetYear}) · ${count} h`,
      hoursCount: count,
      points,
    };
  }

  if (windowId === 'week') {
    const weekLen = ssotConfig.blockSizeHours;
    const weekIdx = clamp(Math.round(config.selectedWeek), 1, ssotConfig.weeksPerYear);
    const start = Math.min(Math.max(0, totalLen - weekLen), (weekIdx - 1) * weekLen);
    const end = Math.min(totalLen, start + weekLen);
    const count = Math.max(0, end - start);
    const points = new Array<HourlyPoint>(count);
    for (let idx = 0; idx < count; idx++) {
      points[idx] = { ...fullYearSeries[start + idx], windowHourIndex: idx };
    }
    const d0 = points[0]?.timestampLabel.split(' · ')[0] ?? '';
    const d1 = points[count - 1]?.timestampLabel.split(' · ')[0] ?? '';
    return {
      windowId,
      windowLabel: `Semana ${weekIdx}/${ssotConfig.weeksPerYear} (${d0}–${d1}) · ${count} h`,
      hoursCount: count,
      points,
    };
  }

  if (windowId === 'month') {
    const monthIdx = clamp(Math.round(config.selectedMonth), 1, 12);
    const points: HourlyPoint[] = [];
    for (let i = 0; i < totalLen; i++) {
      const pt = fullYearSeries[i];
      if (pt.month === monthIdx) {
        points.push({ ...pt, windowHourIndex: points.length });
      }
    }
    const mName = monthShortNames[monthIdx - 1] ?? `Mês ${monthIdx}`;
    return {
      windowId,
      windowLabel: `${mName}/${config.targetYear} · ${points.length} h`,
      hoursCount: points.length,
      points,
    };
  }

  // quarter
  const qIdx = clamp(Math.round(config.selectedQuarter), 1, ssotConfig.quartersPerYear);
  const mStart = (qIdx - 1) * 3 + 1;
  const mEnd = qIdx * 3;
  const points: HourlyPoint[] = [];
  for (let i = 0; i < totalLen; i++) {
    const pt = fullYearSeries[i];
    if (pt.month >= mStart && pt.month <= mEnd) {
      points.push({ ...pt, windowHourIndex: points.length });
    }
  }
  const mStartLabel = monthShortNames[mStart - 1] ?? `M${mStart}`;
  const mEndLabel = monthShortNames[mEnd - 1] ?? `M${mEnd}`;
  return {
    windowId,
    windowLabel: `Q${qIdx} (${mStartLabel}–${mEndLabel}/${config.targetYear}) · ${points.length.toLocaleString('pt-BR')} h`,
    hoursCount: points.length,
    points,
  };
}

export interface WindowMetricsSummary {
  negativeMarginHoursWindow: number | null;
  criticalImportHoursWindow: number | null;
  minMarginMW: number | null;
  maxMarginMW: number | null;
  windowCurtailmentWithoutDcGWh: number | null;
  windowCurtailmentWithDcGWh: number | null;
}

export function summarizeHourlyWindow(windowSeries: HourlyPoint[]): WindowMetricsSummary {
  const n = windowSeries.length;
  if (n === 0) {
    return {
      negativeMarginHoursWindow: null,
      criticalImportHoursWindow: null,
      minMarginMW: null,
      maxMarginMW: null,
      windowCurtailmentWithoutDcGWh: null,
      windowCurtailmentWithDcGWh: null,
    };
  }

  let negMarginWindow = 0;
  let critImportWindow = 0;
  let minMarginWindow = Infinity;
  let maxMarginWindow = -Infinity;
  let curtNoDcWindowMWh = 0;
  let curtWithDcWindowMWh = 0;

  for (let i = 0; i < n; i++) {
    const pt = windowSeries[i];
    const m = pt.marginWithDcMW;
    if (m < 0) negMarginWindow++;
    if (pt.exceedsImportLimit) critImportWindow++;
    if (m < minMarginWindow) minMarginWindow = m;
    if (m > maxMarginWindow) maxMarginWindow = m;
    curtNoDcWindowMWh += pt.curtailmentWithoutDcMW;
    curtWithDcWindowMWh += pt.curtailmentWithDcMW;
  }

  return {
    negativeMarginHoursWindow: negMarginWindow,
    criticalImportHoursWindow: critImportWindow,
    minMarginMW: Number.isFinite(minMarginWindow) ? Math.round(minMarginWindow) : null,
    maxMarginMW: Number.isFinite(maxMarginWindow) ? Math.round(maxMarginWindow) : null,
    windowCurtailmentWithoutDcGWh: round1(curtNoDcWindowMWh / 1000),
    windowCurtailmentWithDcGWh: round1(curtWithDcWindowMWh / 1000),
  };
}

export function buildHourlyPlotBuckets(series: HourlyPoint[], maxBuckets = 365): HourlyPlotBucket[] {
  const n = series.length;
  if (n === 0) return [];

  if (n <= maxBuckets) {
    const denom = Math.max(1, n - 1);
    const out = new Array<HourlyPlotBucket>(n);
    for (let i = 0; i < n; i++) {
      const pt = series[i];
      out[i] = {
        indexStart: i,
        indexEnd: i,
        indexCenter: i,
        xFrac: i / denom,
        meanMarginWithDcMW: pt.marginWithDcMW,
        minMarginWithDcMW: pt.marginWithDcMW,
        maxMarginWithDcMW: pt.marginWithDcMW,
        meanMarginWithoutDcMW: pt.marginWithoutDcMW,
        meanBaseLoadMW: pt.baseLoadMW,
        meanTotalLoadMW: pt.totalLoadMW,
        meanTotalGenPotentialMW: pt.totalGenPotentialMW,
      };
    }
    return out;
  }

  const buckets = new Array<HourlyPlotBucket>(maxBuckets);
  const step = n / maxBuckets;
  const denom = Math.max(1, n - 1);

  for (let b = 0; b < maxBuckets; b++) {
    const start = Math.floor(b * step);
    const end = Math.min(n - 1, Math.floor((b + 1) * step) - 1);
    const effectiveEnd = end > start ? end : start;
    let sumMargin = 0;
    let minMargin = Infinity;
    let maxMargin = -Infinity;
    let sumMarginNoDc = 0;
    let sumBase = 0;
    let sumTotal = 0;
    let sumGen = 0;
    const count = effectiveEnd - start + 1;
    const invCount = 1 / count;

    for (let i = start; i <= effectiveEnd; i++) {
      const pt = series[i];
      const m = pt.marginWithDcMW;
      sumMargin += m;
      if (m < minMargin) minMargin = m;
      if (m > maxMargin) maxMargin = m;
      sumMarginNoDc += pt.marginWithoutDcMW;
      sumBase += pt.baseLoadMW;
      sumTotal += pt.totalLoadMW;
      sumGen += pt.totalGenPotentialMW;
    }

    const center = Math.round((start + effectiveEnd) * 0.5);
    buckets[b] = {
      indexStart: start,
      indexEnd: effectiveEnd,
      indexCenter: center,
      xFrac: center / denom,
      meanMarginWithDcMW: sumMargin * invCount,
      minMarginWithDcMW: minMargin,
      maxMarginWithDcMW: maxMargin,
      meanMarginWithoutDcMW: sumMarginNoDc * invCount,
      meanBaseLoadMW: sumBase * invCount,
      meanTotalLoadMW: sumTotal * invCount,
      meanTotalGenPotentialMW: sumGen * invCount,
    };
  }

  return buckets;
}

function fromGridRow(
  row: SimulatorMonteCarloGridRow,
  effectiveDcLoadMW: number,
  windCap: { onshoreMW: number; offshoreMW: number; totalMW: number },
  sourceStatus: 'grid_exact' | 'grid_interpolated'
): MonteCarloSummary {
  return {
    sourceStatus,
    effectiveDcLoadMW,
    installedWindGW: Number((windCap.totalMW / 1000).toFixed(2)),
    onshoreWindGW: Number((windCap.onshoreMW / 1000).toFixed(2)),
    offshoreWindGW: Number((windCap.offshoreMW / 1000).toFixed(2)),
    probCriticalImportAnnualPct: Number(row.probExceedInterchangePct.toFixed(2)),
    probCriticalWithoutDcPct: null,
    loleCriticalHoursYear: round1(row.loleHoursYear),
    p95PeakImportMW: Math.round(row.importP95MW),
    p50PeakImportMW: Math.round(row.importP50MW),
    expectedCurtailmentWithoutDcTWh: Number(row.curtailmentWithoutDcTWh.toFixed(2)),
    expectedCurtailmentWithDcTWh: Number(row.curtailmentWithDcTWh.toFixed(2)),
    curtailmentAvoidedByDcGWh: Math.round(row.curtailmentAvoidedGWh),
    requiredExtraWindGWForTargetRisk: Number(row.compensatoryWindGW.toFixed(2)),
  };
}

export function resolveMonteCarloSummary(
  config: AnnualSimulationConfig,
  ssot: EnergyModelSsotInput
): MonteCarloSummary {
  const ssotCfg = ssot.config;
  const windCap = computeInstalledWindCapacityMW(
    {
      targetYear: config.targetYear,
      windScenario: config.windScenario,
      includeOffshorePost2031: config.includeOffshorePost2031,
    },
    ssotCfg
  );
  const effectiveDcLoadMW = resolveEffectiveDcLoadMW(config, ssot);

  const baseInfo = {
    effectiveDcLoadMW,
    installedWindGW: Number((windCap.totalMW / 1000).toFixed(2)),
    onshoreWindGW: Number((windCap.onshoreMW / 1000).toFixed(2)),
    offshoreWindGW: Number((windCap.offshoreMW / 1000).toFixed(2)),
  };

  const effectivePue = config.isPublishedPowerTotalGrid ? 1.0 : config.pue;
  const matchPue = config.dcScenario === 'none' ? ssotCfg.defaultPue : effectivePue;
  const matchUtil = config.dcScenario === 'none' ? ssotCfg.defaultUtilization : config.dcUtilization;

  const isExactParams = (r: SimulatorMonteCarloGridRow) =>
    Math.abs(r.pue - matchPue) < 1e-3 &&
    Math.abs(r.dcUtilization - matchUtil) < 1e-3 &&
    Math.abs(r.importLimitMW - config.interchangeImportLimitMW) < 5 &&
    Math.abs(r.exportLimitMW - config.interchangeExportLimitMW) < 5;

  const spansAxis = (
    rows: SimulatorMonteCarloGridRow[],
    getter: (r: SimulatorMonteCarloGridRow) => number,
    tol: number
  ) => {
    if (rows.length < 2) return false;
    const first = getter(rows[0]);
    for (let i = 1; i < rows.length; i++) {
      if (Math.abs(getter(rows[i]) - first) >= tol) return true;
    }
    return false;
  };

  const buildInterpolatedIdw = (
    pool: SimulatorMonteCarloGridRow[],
    includeYearAxis: boolean
  ): MonteCarloSummary => {
    const bounds = ssotCfg.simulatorSliderBounds;
    const invYearSpan = 1 / Math.max(1, bounds.year.max - bounds.year.min);
    const invPueSpan = 1 / Math.max(0.05, bounds.pue.max - bounds.pue.min);
    const invUtilSpan = 1 / Math.max(0.05, bounds.dcUtilization.max - bounds.dcUtilization.min);
    const invImpSpan = 1 / Math.max(500, bounds.interchangeImportLimitMW.max - bounds.interchangeImportLimitMW.min);
    const invExpSpan = 1 / Math.max(500, bounds.interchangeExportLimitMW.max - bounds.interchangeExportLimitMW.min);

    // Seleção top-4 O(N) em uma única varredura, sem alocações por linha nem sort()
    let d0 = Infinity,
      d1 = Infinity,
      d2 = Infinity,
      d3 = Infinity;
    let r0: SimulatorMonteCarloGridRow | null = null;
    let r1: SimulatorMonteCarloGridRow | null = null;
    let r2: SimulatorMonteCarloGridRow | null = null;
    let r3: SimulatorMonteCarloGridRow | null = null;

    for (let i = 0; i < pool.length; i++) {
      const row = pool[i];
      const dYear = includeYearAxis ? (row.year - config.targetYear) * invYearSpan : 0;
      const dPue = (row.pue - matchPue) * invPueSpan;
      const dUtil = (row.dcUtilization - matchUtil) * invUtilSpan;
      const dImp = (row.importLimitMW - config.interchangeImportLimitMW) * invImpSpan;
      const dExp = (row.exportLimitMW - config.interchangeExportLimitMW) * invExpSpan;
      const distSq = dYear * dYear + dPue * dPue + dUtil * dUtil + dImp * dImp + dExp * dExp;

      if (distSq < d0) {
        d3 = d2; r3 = r2;
        d2 = d1; r2 = r1;
        d1 = d0; r1 = r0;
        d0 = distSq; r0 = row;
      } else if (distSq < d1) {
        d3 = d2; r3 = r2;
        d2 = d1; r2 = r1;
        d1 = distSq; r1 = row;
      } else if (distSq < d2) {
        d3 = d2; r3 = r2;
        d2 = distSq; r2 = row;
      } else if (distSq < d3) {
        d3 = distSq; r3 = row;
      }
    }

    const topRows = [r0, r1, r2, r3];
    const topDistSq = [d0, d1, d2, d3];
    let sumW = 0;
    let accProb = 0;
    let accLole = 0;
    let accP95 = 0;
    let accP50 = 0;
    let accCurtNoDc = 0;
    let accCurtWithDc = 0;
    let accAvoided = 0;
    let accComp = 0;

    for (let k = 0; k < 4; k++) {
      const row = topRows[k];
      if (!row) continue;
      const w = 1 / Math.max(1e-6, topDistSq[k]);
      sumW += w;
      accProb += row.probExceedInterchangePct * w;
      accLole += row.loleHoursYear * w;
      accP95 += row.importP95MW * w;
      accP50 += row.importP50MW * w;
      accCurtNoDc += row.curtailmentWithoutDcTWh * w;
      accCurtWithDc += row.curtailmentWithDcTWh * w;
      accAvoided += row.curtailmentAvoidedGWh * w;
      accComp += row.compensatoryWindGW * w;
    }

    const invSumW = 1 / Math.max(1e-9, sumW);
    return {
      ...baseInfo,
      sourceStatus: 'grid_interpolated',
      probCriticalImportAnnualPct: Number((accProb * invSumW).toFixed(2)),
      probCriticalWithoutDcPct: null,
      loleCriticalHoursYear: round1(accLole * invSumW),
      p95PeakImportMW: Math.round(accP95 * invSumW),
      p50PeakImportMW: Math.round(accP50 * invSumW),
      expectedCurtailmentWithoutDcTWh: Number((accCurtNoDc * invSumW).toFixed(2)),
      expectedCurtailmentWithDcTWh: Number((accCurtWithDc * invSumW).toFixed(2)),
      curtailmentAvoidedByDcGWh: Math.round(accAvoided * invSumW),
      requiredExtraWindGWForTargetRisk: Number((accComp * invSumW).toFixed(2)),
    };
  };

  const grid = ssot.simulatorMonteCarloGrid ?? [];
  if (grid.length > 0) {
    const windMatched: SimulatorMonteCarloGridRow[] = [];
    for (let i = 0; i < grid.length; i++) {
      const r = grid[i];
      if (
        r.year === config.targetYear &&
        r.dcScenarioId === config.dcScenario &&
        r.windScenarioId === config.windScenario &&
        r.seasonalRegime === config.seasonalRegime &&
        Math.abs(r.windCapacityMW - windCap.totalMW) <= 150
      ) {
        windMatched.push(r);
      }
    }

    if (windMatched.length > 0) {
      const exact = windMatched.find(isExactParams);
      if (exact) {
        const noDcCounterpart = grid.find(
          (r) =>
            r.year === config.targetYear &&
            r.dcScenarioId === ssotCfg.referenceScenarioKeys.dcControl &&
            r.windScenarioId === config.windScenario &&
            r.seasonalRegime === config.seasonalRegime &&
            Math.abs(r.windCapacityMW - windCap.totalMW) <= 150 &&
            Math.abs(r.importLimitMW - config.interchangeImportLimitMW) < 5 &&
            Math.abs(r.exportLimitMW - config.interchangeExportLimitMW) < 5
        );
        const res = fromGridRow(exact, effectiveDcLoadMW, windCap, 'grid_exact');
        res.probCriticalWithoutDcPct = noDcCounterpart ? noDcCounterpart.probExceedInterchangePct : null;
        return res;
      }

      const refRow = windMatched[0];
      const pueDiffers = Math.abs(matchPue - refRow.pue) >= 1e-3;
      const utilDiffers = Math.abs(matchUtil - refRow.dcUtilization) >= 1e-3;
      const impDiffers = Math.abs(config.interchangeImportLimitMW - refRow.importLimitMW) >= 5;
      const expDiffers = Math.abs(config.interchangeExportLimitMW - refRow.exportLimitMW) >= 5;

      const supportsAxes = (rows: SimulatorMonteCarloGridRow[]) =>
        (!pueDiffers || spansAxis(rows, (r) => r.pue, 1e-3)) &&
        (!utilDiffers || spansAxis(rows, (r) => r.dcUtilization, 1e-3)) &&
        (!impDiffers || spansAxis(rows, (r) => r.importLimitMW, 5)) &&
        (!expDiffers || spansAxis(rows, (r) => r.exportLimitMW, 5));

      if (windMatched.length > 1 && supportsAxes(windMatched)) {
        return buildInterpolatedIdw(windMatched, false);
      }

      const sameCategoryAcrossYears = grid.filter((r) => {
        if (
          r.dcScenarioId !== config.dcScenario ||
          r.windScenarioId !== config.windScenario ||
          r.seasonalRegime !== config.seasonalRegime
        ) {
          return false;
        }
        const expectedYearWind = computeInstalledWindCapacityMW(
          {
            targetYear: r.year,
            windScenario: config.windScenario,
            includeOffshorePost2031: config.includeOffshorePost2031,
          },
          ssotCfg
        );
        return Math.abs(r.windCapacityMW - expectedYearWind.totalMW) <= 150;
      });

      if (sameCategoryAcrossYears.length > 1 && supportsAxes(sameCategoryAcrossYears)) {
        return buildInterpolatedIdw(sameCategoryAcrossYears, true);
      }
    } else {
      const sameYearParamsPool = grid
        .filter(
          (r) =>
            r.year === config.targetYear &&
            r.dcScenarioId === config.dcScenario &&
            r.seasonalRegime === config.seasonalRegime &&
            isExactParams(r)
        )
        .sort((a, b) => a.windCapacityMW - b.windCapacityMW);

      if (sameYearParamsPool.length >= 2) {
        let lower: SimulatorMonteCarloGridRow | undefined;
        let upper: SimulatorMonteCarloGridRow | undefined;
        for (let i = 0; i < sameYearParamsPool.length; i++) {
          const row = sameYearParamsPool[i];
          if (row.windCapacityMW <= windCap.totalMW) lower = row;
          if (!upper && row.windCapacityMW >= windCap.totalMW) upper = row;
        }
        if (lower && upper && upper.windCapacityMW > lower.windCapacityMW) {
          const t = (windCap.totalMW - lower.windCapacityMW) / (upper.windCapacityMW - lower.windCapacityMW);
          const oneMinusT = 1 - t;
          const lerp = (getter: (r: SimulatorMonteCarloGridRow) => number) =>
            getter(lower!) * oneMinusT + getter(upper!) * t;
          return {
            ...baseInfo,
            sourceStatus: 'grid_interpolated',
            probCriticalImportAnnualPct: Number(lerp((r) => r.probExceedInterchangePct).toFixed(2)),
            probCriticalWithoutDcPct: null,
            loleCriticalHoursYear: round1(lerp((r) => r.loleHoursYear)),
            p95PeakImportMW: Math.round(lerp((r) => r.importP95MW)),
            p50PeakImportMW: Math.round(lerp((r) => r.importP50MW)),
            expectedCurtailmentWithoutDcTWh: Number(lerp((r) => r.curtailmentWithoutDcTWh).toFixed(2)),
            expectedCurtailmentWithDcTWh: Number(lerp((r) => r.curtailmentWithDcTWh).toFixed(2)),
            curtailmentAvoidedByDcGWh: Math.round(lerp((r) => r.curtailmentAvoidedGWh)),
            requiredExtraWindGWForTargetRisk: Number(lerp((r) => r.compensatoryWindGW).toFixed(2)),
          };
        }
      }
    }
  }

  // Fallback exclusivo para âncoras nominais oficiais presentes no SSOT (sem simulação sintética em JS)
  const isNominalPueUtil =
    !config.isPublishedPowerTotalGrid &&
    Math.abs(config.pue - ssotCfg.defaultPue) < 1e-3 &&
    Math.abs(config.dcUtilization - ssotCfg.defaultUtilization) < 1e-3;
  const isNominalLimits =
    Math.abs(config.interchangeImportLimitMW - ssotCfg.interchangeImportLimitMW) < 5 &&
    Math.abs(config.interchangeExportLimitMW - ssotCfg.interchangeExportLimitMW) < 5;

  if (config.seasonalRegime === 'annual_blend' && isNominalPueUtil && isNominalLimits) {
    if (config.targetYear === ssotCfg.targetEndYear && (ssot.monteCarlo12Scenarios2035?.length ?? 0) > 0) {
      const exactRow = ssot.monteCarlo12Scenarios2035!.find(
        (r) => r.dcScenarioId === config.dcScenario && Math.abs(r.windCapacityMW - windCap.totalMW) <= 150
      );
      if (exactRow) {
        const noDcRow = ssot.monteCarlo12Scenarios2035!.find(
          (r) =>
            r.dcScenarioId === ssotCfg.referenceScenarioKeys.dcControl &&
            r.windScenarioId === exactRow.windScenarioId
        );
        return {
          ...baseInfo,
          sourceStatus: 'ssot_anchor',
          probCriticalImportAnnualPct: exactRow.probExceedInterchangePct,
          probCriticalWithoutDcPct: noDcRow ? noDcRow.probExceedInterchangePct : null,
          loleCriticalHoursYear: exactRow.loleCriticalHoursYear,
          p95PeakImportMW: Math.round(exactRow.importP95MW),
          p50PeakImportMW: Math.round(exactRow.importP50MW),
          expectedCurtailmentWithoutDcTWh: exactRow.curtailmentWithoutDcTWh,
          expectedCurtailmentWithDcTWh: exactRow.curtailmentWithDcTWh,
          curtailmentAvoidedByDcGWh: Math.round(exactRow.curtailmentAvoidedGWh),
          requiredExtraWindGWForTargetRisk: exactRow.compensatoryWindExpansionGW,
        };
      }
    }

    if (
      config.dcScenario === ssotCfg.referenceScenarioKeys.dcCentral &&
      config.windScenario === ssotCfg.referenceScenarioKeys.windIntermediate &&
      !config.includeOffshorePost2031 &&
      (ssot.annualRiskTimeline2026_2035?.length ?? 0) > 0
    ) {
      const timelineRow = ssot.annualRiskTimeline2026_2035!.find((r) => r.year === config.targetYear);
      if (timelineRow) {
        return {
          ...baseInfo,
          sourceStatus: 'ssot_anchor',
          probCriticalImportAnnualPct: timelineRow.probExceedInterchangePct,
          probCriticalWithoutDcPct: null,
          loleCriticalHoursYear: timelineRow.loleHoursYear,
          p95PeakImportMW: Math.round(timelineRow.importP95MW),
          p50PeakImportMW: Math.round(timelineRow.importP50MW),
          expectedCurtailmentWithoutDcTWh: Number(
            (timelineRow.curtailmentWithDcTWh + timelineRow.curtailmentAvoidedGWh / 1000).toFixed(2)
          ),
          expectedCurtailmentWithDcTWh: timelineRow.curtailmentWithDcTWh,
          curtailmentAvoidedByDcGWh: Math.round(timelineRow.curtailmentAvoidedGWh),
          requiredExtraWindGWForTargetRisk: timelineRow.compensatoryWindGW,
        };
      }
    }
  }

  if (
    config.seasonalRegime === 'annual_blend' &&
    isNominalPueUtil &&
    config.targetYear === ssotCfg.targetEndYear &&
    config.dcScenario === ssotCfg.referenceScenarioKeys.dcCentral &&
    config.windScenario === ssotCfg.referenceScenarioKeys.windIntermediate &&
    !config.includeOffshorePost2031 &&
    (ssot.transmissionSensitivity2035?.length ?? 0) > 0
  ) {
    const txMatch = ssot.transmissionSensitivity2035!.find(
      (r) =>
        Math.abs(r.importLimitMW - config.interchangeImportLimitMW) < 5 &&
        Math.abs(r.exportLimitMW - config.interchangeExportLimitMW) < 5
    );
    if (txMatch) {
      return {
        ...baseInfo,
        sourceStatus: 'ssot_anchor',
        probCriticalImportAnnualPct: txMatch.probCriticalImportPct,
        probCriticalWithoutDcPct: null,
        loleCriticalHoursYear: txMatch.loleHoursYear,
        p95PeakImportMW: Math.round(txMatch.importP95MW),
        p50PeakImportMW: null,
        expectedCurtailmentWithoutDcTWh: txMatch.curtailmentWithoutDcTWh,
        expectedCurtailmentWithDcTWh: txMatch.curtailmentWithDcTWh,
        curtailmentAvoidedByDcGWh: Math.round(txMatch.curtailmentAvoidedGWh),
        requiredExtraWindGWForTargetRisk: txMatch.compensatoryWindGW,
      };
    }
  }

  return {
    ...baseInfo,
    sourceStatus: 'unavailable',
    probCriticalImportAnnualPct: null,
    probCriticalWithoutDcPct: null,
    loleCriticalHoursYear: null,
    p95PeakImportMW: null,
    p50PeakImportMW: null,
    expectedCurtailmentWithoutDcTWh: null,
    expectedCurtailmentWithDcTWh: null,
    curtailmentAvoidedByDcGWh: null,
    requiredExtraWindGWForTargetRisk: null,
  };
}

export function evaluateScenario(
  config: SimulationConfig,
  ssot: EnergyModelSsotInput,
  hourlyBaseline: HourlyBaseline8760Bundle | null = null
): EvaluationResult {
  const { fullYearSeries, annualSummary } = estimateAnnualSimulation(config, hourlyBaseline, ssot);
  const windowSlice = sliceHourlyWindow(
    fullYearSeries,
    config,
    ssot.config,
    ssot.uiCatalog?.monthShortNames ?? []
  );
  const windowSeries = windowSlice.points;
  const windowSummary = summarizeHourlyWindow(windowSeries);
  const monteCarlo = resolveMonteCarloSummary(config, ssot);

  return {
    fullYearSeries,
    windowSlice,
    hourlySeries: windowSeries,
    summary: {
      ...annualSummary,
      ...windowSummary,
    },
    monteCarlo,
  };
}
