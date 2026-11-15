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
  return Math.max(min, Math.min(max, val));
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
    return Number((params.itPowerMW * util * ramp).toFixed(1));
  }
  return Number((params.itPowerMW * util * pue * ramp).toFixed(1));
}

export function computeWindGenerationMW(capacityFactor: number, installedMW: number): number {
  const cf = clamp(capacityFactor, 0, 1);
  return Number((cf * Math.max(0, installedMW)).toFixed(1));
}

export function computeDcRampFactor(targetYear: number, ssotConfig: PipelineConfigSnapshot): number {
  if (targetYear < ssotConfig.rampStartYear) return 0;
  const totalRampYears = Math.max(1, ssotConfig.targetEndYear - ssotConfig.rampStartYear + 1);
  const progress = clamp((targetYear - ssotConfig.rampStartYear + 1) / totalRampYears, 0, 1);
  return Number(Math.pow(progress, ssotConfig.windRampExponent).toFixed(4));
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

    return Number((baseNominalLoadMW * utilFactor * pueFactor).toFixed(1));
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

export function estimateFullYearHourly(
  config: SimulationConfig,
  hourlyBaseline: HourlyBaseline8760Bundle | null,
  ssot: EnergyModelSsotInput
): HourlyPoint[] {
  if (!hourlyBaseline || hourlyBaseline.hoursCount <= 0) {
    return [];
  }

  const ssotCfg = ssot.config;
  const regData = hourlyBaseline.regimes[config.seasonalRegime] ?? hourlyBaseline.regimes.annual_blend;
  if (!regData) return [];

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
  const dcLoadMW = resolveEffectiveDcLoadMW(config, ssot);

  const series: HourlyPoint[] = new Array(totalHours);

  for (let h = 0; h < totalHours; h++) {
    const month = hourlyBaseline.month[h] ?? 1;
    const dayOfMonth = hourlyBaseline.day[h] ?? 1;
    const hourOfDay = hourlyBaseline.hour[h] ?? h % ssotCfg.hoursPerDay;
    const monthLabel = monthNames[month - 1] ?? `M${String(month).padStart(2, '0')}`;
    const timestampLabel = `${String(dayOfMonth).padStart(2, '0')}/${monthLabel} · ${String(hourOfDay).padStart(2, '0')}h`;

    const baseLoadMW = regData.lBaseMW[h] * loadGrowth;
    const totalLoadMW = baseLoadMW + dcLoadMW;
    const windCf = clamp(regData.cfWind[h], 0, 1);
    const windGenPotentialMW = windCf * windCap.totalMW;
    const solarGenMW = regData.gSolarMW[h] * solarGrowth;

    const netNeedBaseMW = Math.max(0, baseLoadMW - (windGenPotentialMW + solarGenMW));
    const chesfDispatchMW = computeChesfDispatchMW(netNeedBaseMW, ssotCfg.chesfDispatch, {
      month,
      observedHydroMW: regData.gHydroMW[h] ?? 0,
      observedThermalMW: regData.gThermalMW[h] ?? 0,
    });
    const totalGenPotentialMW = windGenPotentialMW + solarGenMW + chesfDispatchMW;
    const marginWithoutDcMW = totalGenPotentialMW - baseLoadMW;
    const marginWithDcMW = totalGenPotentialMW - totalLoadMW;

    const exportThresholdMW = Math.max(0, config.interchangeExportLimitMW - ssotCfg.exportSolarCurtailmentCoef * solarGenMW);
    const curtailmentWithoutDcMW = Math.max(0, marginWithoutDcMW - exportThresholdMW);
    const curtailmentWithDcMW = Math.max(0, marginWithDcMW - exportThresholdMW);

    series[h] = {
      hourOfYear: h,
      windowHourIndex: h,
      month,
      dayOfMonth,
      hourOfDay,
      timestampLabel,
      baseLoadMW: Number(baseLoadMW.toFixed(1)),
      dcLoadMW: Number(dcLoadMW.toFixed(1)),
      totalLoadMW: Number(totalLoadMW.toFixed(1)),
      windCapacityFactor: Number(windCf.toFixed(4)),
      windGenPotentialMW: Number(windGenPotentialMW.toFixed(1)),
      solarGenMW: Number(solarGenMW.toFixed(1)),
      otherDispatchableMW: Number(chesfDispatchMW.toFixed(1)),
      totalGenPotentialMW: Number(totalGenPotentialMW.toFixed(1)),
      marginWithoutDcMW: Number(marginWithoutDcMW.toFixed(1)),
      marginWithDcMW: Number(marginWithDcMW.toFixed(1)),
      exceedsImportLimit: marginWithDcMW < -config.interchangeImportLimitMW,
      curtailmentWithoutDcMW: Number(curtailmentWithoutDcMW.toFixed(1)),
      curtailmentWithDcMW: Number(curtailmentWithDcMW.toFixed(1)),
    };
  }

  return series;
}

export function sliceHourlyWindow(
  fullYearSeries: HourlyPoint[],
  config: SimulationConfig,
  ssotConfig: PipelineConfigSnapshot,
  monthShortNames: string[] = []
): WindowSliceResult {
  const windowId = config.observationWindow;
  if (fullYearSeries.length === 0) {
    return {
      windowId,
      windowLabel: `${config.targetYear}`,
      hoursCount: 0,
      points: [],
    };
  }

  let rawSlice: HourlyPoint[] = fullYearSeries;
  let windowLabel = `Ano Completo ${config.targetYear}`;

  if (windowId === 'day') {
    const dayIdx = clamp(Math.round(config.selectedDay), 1, ssotConfig.daysPerYear);
    const start = Math.min(Math.max(0, fullYearSeries.length - ssotConfig.hoursPerDay), (dayIdx - 1) * ssotConfig.hoursPerDay);
    const end = Math.min(fullYearSeries.length, start + ssotConfig.hoursPerDay);
    rawSlice = fullYearSeries.slice(start, end);
    const datePart = rawSlice[0]?.timestampLabel.split(' · ')[0] ?? `Dia ${dayIdx}`;
    windowLabel = `Dia ${dayIdx}/${ssotConfig.daysPerYear} (${datePart}/${config.targetYear}) · ${rawSlice.length} h`;
  } else if (windowId === 'week') {
    const weekLen = ssotConfig.blockSizeHours;
    const weekIdx = clamp(Math.round(config.selectedWeek), 1, ssotConfig.weeksPerYear);
    const start = Math.min(Math.max(0, fullYearSeries.length - weekLen), (weekIdx - 1) * weekLen);
    const end = Math.min(fullYearSeries.length, start + weekLen);
    rawSlice = fullYearSeries.slice(start, end);
    const d0 = rawSlice[0]?.timestampLabel.split(' · ')[0] ?? '';
    const d1 = rawSlice[rawSlice.length - 1]?.timestampLabel.split(' · ')[0] ?? '';
    windowLabel = `Semana ${weekIdx}/${ssotConfig.weeksPerYear} (${d0}–${d1}) · ${rawSlice.length} h`;
  } else if (windowId === 'month') {
    const monthIdx = clamp(Math.round(config.selectedMonth), 1, 12);
    rawSlice = fullYearSeries.filter((p) => p.month === monthIdx);
    const mName = monthShortNames[monthIdx - 1] ?? `Mês ${monthIdx}`;
    windowLabel = `${mName}/${config.targetYear} · ${rawSlice.length} h`;
  } else if (windowId === 'quarter') {
    const qIdx = clamp(Math.round(config.selectedQuarter), 1, ssotConfig.quartersPerYear);
    const mStart = (qIdx - 1) * 3 + 1;
    const mEnd = qIdx * 3;
    rawSlice = fullYearSeries.filter((p) => p.month >= mStart && p.month <= mEnd);
    const mStartLabel = monthShortNames[mStart - 1] ?? `M${mStart}`;
    const mEndLabel = monthShortNames[mEnd - 1] ?? `M${mEnd}`;
    windowLabel = `Q${qIdx} (${mStartLabel}–${mEndLabel}/${config.targetYear}) · ${rawSlice.length.toLocaleString('pt-BR')} h`;
  } else {
    windowLabel = `Ano Completo ${config.targetYear} · ${rawSlice.length.toLocaleString('pt-BR')} h`;
  }

  const points = rawSlice.map((pt, idx) => ({
    ...pt,
    windowHourIndex: idx,
  }));

  return {
    windowId,
    windowLabel,
    hoursCount: points.length,
    points,
  };
}

export function buildHourlyPlotBuckets(series: HourlyPoint[], maxBuckets = 365): HourlyPlotBucket[] {
  const n = series.length;
  if (n === 0) return [];

  if (n <= maxBuckets) {
    const denom = Math.max(1, n - 1);
    return series.map((pt, i) => ({
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
    }));
  }

  const buckets: HourlyPlotBucket[] = [];
  const step = n / maxBuckets;
  const denom = Math.max(1, n - 1);

  for (let b = 0; b < maxBuckets; b++) {
    const start = Math.floor(b * step);
    const end = Math.min(n - 1, Math.floor((b + 1) * step) - 1);
    const effectiveEnd = Math.max(start, end);
    let sumMargin = 0;
    let minMargin = Infinity;
    let maxMargin = -Infinity;
    let sumMarginNoDc = 0;
    let sumBase = 0;
    let sumTotal = 0;
    let sumGen = 0;
    const count = effectiveEnd - start + 1;

    for (let i = start; i <= effectiveEnd; i++) {
      const pt = series[i];
      sumMargin += pt.marginWithDcMW;
      if (pt.marginWithDcMW < minMargin) minMargin = pt.marginWithDcMW;
      if (pt.marginWithDcMW > maxMargin) maxMargin = pt.marginWithDcMW;
      sumMarginNoDc += pt.marginWithoutDcMW;
      sumBase += pt.baseLoadMW;
      sumTotal += pt.totalLoadMW;
      sumGen += pt.totalGenPotentialMW;
    }

    const center = Math.round((start + effectiveEnd) / 2);
    buckets.push({
      indexStart: start,
      indexEnd: effectiveEnd,
      indexCenter: center,
      xFrac: center / denom,
      meanMarginWithDcMW: sumMargin / count,
      minMarginWithDcMW: minMargin,
      maxMarginWithDcMW: maxMargin,
      meanMarginWithoutDcMW: sumMarginNoDc / count,
      meanBaseLoadMW: sumBase / count,
      meanTotalLoadMW: sumTotal / count,
      meanTotalGenPotentialMW: sumGen / count,
    });
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
    loleCriticalHoursYear: Number(row.loleHoursYear.toFixed(1)),
    p95PeakImportMW: Math.round(row.importP95MW),
    p50PeakImportMW: Math.round(row.importP50MW),
    expectedCurtailmentWithoutDcTWh: Number(row.curtailmentWithoutDcTWh.toFixed(2)),
    expectedCurtailmentWithDcTWh: Number(row.curtailmentWithDcTWh.toFixed(2)),
    curtailmentAvoidedByDcGWh: Math.round(row.curtailmentAvoidedGWh),
    requiredExtraWindGWForTargetRisk: Number(row.compensatoryWindGW.toFixed(2)),
  };
}

export function resolveMonteCarloSummary(
  config: SimulationConfig,
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
    return rows.some((r) => Math.abs(getter(r) - first) >= tol);
  };

  const buildInterpolatedIdw = (
    pool: SimulatorMonteCarloGridRow[],
    includeYearAxis: boolean
  ): MonteCarloSummary => {
    const bounds = ssotCfg.simulatorSliderBounds;
    const yearSpan = Math.max(1, bounds.year.max - bounds.year.min);
    const pueSpan = Math.max(0.05, bounds.pue.max - bounds.pue.min);
    const utilSpan = Math.max(0.05, bounds.dcUtilization.max - bounds.dcUtilization.min);
    const impSpan = Math.max(500, bounds.interchangeImportLimitMW.max - bounds.interchangeImportLimitMW.min);
    const expSpan = Math.max(500, bounds.interchangeExportLimitMW.max - bounds.interchangeExportLimitMW.min);

    const weighted = pool
      .map((row) => {
        const dYear = includeYearAxis ? (row.year - config.targetYear) / yearSpan : 0;
        const dPue = (row.pue - matchPue) / pueSpan;
        const dUtil = (row.dcUtilization - matchUtil) / utilSpan;
        const dImp = (row.importLimitMW - config.interchangeImportLimitMW) / impSpan;
        const dExp = (row.exportLimitMW - config.interchangeExportLimitMW) / expSpan;
        const dist = Math.sqrt(dYear * dYear + dPue * dPue + dUtil * dUtil + dImp * dImp + dExp * dExp);
        return { row, dist, weight: 1 / Math.max(1e-6, dist * dist) };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 4);

    const sumW = weighted.reduce((acc, item) => acc + item.weight, 0);
    const avg = (getter: (r: SimulatorMonteCarloGridRow) => number) =>
      weighted.reduce((acc, item) => acc + getter(item.row) * item.weight, 0) / Math.max(1e-9, sumW);

    return {
      ...baseInfo,
      sourceStatus: 'grid_interpolated',
      probCriticalImportAnnualPct: Number(avg((r) => r.probExceedInterchangePct).toFixed(2)),
      probCriticalWithoutDcPct: null,
      loleCriticalHoursYear: Number(avg((r) => r.loleHoursYear).toFixed(1)),
      p95PeakImportMW: Math.round(avg((r) => r.importP95MW)),
      p50PeakImportMW: Math.round(avg((r) => r.importP50MW)),
      expectedCurtailmentWithoutDcTWh: Number(avg((r) => r.curtailmentWithoutDcTWh).toFixed(2)),
      expectedCurtailmentWithDcTWh: Number(avg((r) => r.curtailmentWithDcTWh).toFixed(2)),
      curtailmentAvoidedByDcGWh: Math.round(avg((r) => r.curtailmentAvoidedGWh)),
      requiredExtraWindGWForTargetRisk: Number(avg((r) => r.compensatoryWindGW).toFixed(2)),
    };
  };

  const grid = ssot.simulatorMonteCarloGrid ?? [];
  if (grid.length > 0) {
    const categoricalMatches = grid.filter(
      (r) =>
        r.year === config.targetYear &&
        r.dcScenarioId === config.dcScenario &&
        r.windScenarioId === config.windScenario &&
        r.seasonalRegime === config.seasonalRegime
    );

    const windMatched = categoricalMatches.filter((r) => Math.abs(r.windCapacityMW - windCap.totalMW) <= 150);

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

      // Para anos intermediários sem fatia paramétrica local (ex.: 2026/2027), interpola 5D com anos-âncora vizinhos
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
      // Caso a capacidade eólica (ex.: High sem offshore = 44,4 GW) esteja entre trajetórias da grade, interpola por GW
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
        const lower = [...sameYearParamsPool].reverse().find((r) => r.windCapacityMW <= windCap.totalMW);
        const upper = sameYearParamsPool.find((r) => r.windCapacityMW >= windCap.totalMW);
        if (lower && upper && upper.windCapacityMW > lower.windCapacityMW) {
          const t = (windCap.totalMW - lower.windCapacityMW) / (upper.windCapacityMW - lower.windCapacityMW);
          const lerp = (getter: (r: SimulatorMonteCarloGridRow) => number) =>
            getter(lower) * (1 - t) + getter(upper) * t;
          return {
            ...baseInfo,
            sourceStatus: 'grid_interpolated',
            probCriticalImportAnnualPct: Number(lerp((r) => r.probExceedInterchangePct).toFixed(2)),
            probCriticalWithoutDcPct: null,
            loleCriticalHoursYear: Number(lerp((r) => r.loleHoursYear).toFixed(1)),
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
  const fullYearSeries = estimateFullYearHourly(config, hourlyBaseline, ssot);
  const windowSlice = sliceHourlyWindow(
    fullYearSeries,
    config,
    ssot.config,
    ssot.uiCatalog?.monthShortNames ?? []
  );
  const windowSeries = windowSlice.points;
  const effectiveDcLoadMW = resolveEffectiveDcLoadMW(config, ssot);
  const monteCarlo = resolveMonteCarloSummary(config, ssot);

  if (fullYearSeries.length === 0) {
    return {
      fullYearSeries,
      windowSlice,
      hourlySeries: windowSeries,
      summary: {
        hourlyBaselineAvailable: false,
        effectiveDcLoadMW,
        avgBaseLoadMW: null,
        avgWindCfPct: null,
        negativeMarginHoursYear: null,
        criticalImportHoursYear: null,
        negativeMarginHoursWindow: null,
        criticalImportHoursWindow: null,
        minMarginMW: null,
        maxMarginMW: null,
        annualCurtailmentWithoutDcTWh: null,
        annualCurtailmentWithDcTWh: null,
        windowCurtailmentWithoutDcGWh: null,
        windowCurtailmentWithDcGWh: null,
      },
      monteCarlo,
    };
  }

  let sumBaseLoad = 0;
  let sumWindCf = 0;
  let negMarginYear = 0;
  let critImportYear = 0;
  let curtNoDcYearMWh = 0;
  let curtWithDcYearMWh = 0;

  for (const pt of fullYearSeries) {
    sumBaseLoad += pt.baseLoadMW;
    sumWindCf += pt.windCapacityFactor;
    if (pt.marginWithDcMW < 0) negMarginYear++;
    if (pt.exceedsImportLimit) critImportYear++;
    curtNoDcYearMWh += pt.curtailmentWithoutDcMW;
    curtWithDcYearMWh += pt.curtailmentWithDcMW;
  }

  let negMarginWindow = 0;
  let critImportWindow = 0;
  let minMarginWindow = Infinity;
  let maxMarginWindow = -Infinity;
  let curtNoDcWindowMWh = 0;
  let curtWithDcWindowMWh = 0;

  for (const pt of windowSeries) {
    if (pt.marginWithDcMW < 0) negMarginWindow++;
    if (pt.exceedsImportLimit) critImportWindow++;
    if (pt.marginWithDcMW < minMarginWindow) minMarginWindow = pt.marginWithDcMW;
    if (pt.marginWithDcMW > maxMarginWindow) maxMarginWindow = pt.marginWithDcMW;
    curtNoDcWindowMWh += pt.curtailmentWithoutDcMW;
    curtWithDcWindowMWh += pt.curtailmentWithDcMW;
  }

  const invHours = 1 / fullYearSeries.length;

  return {
    fullYearSeries,
    windowSlice,
    hourlySeries: windowSeries,
    summary: {
      hourlyBaselineAvailable: true,
      effectiveDcLoadMW,
      avgBaseLoadMW: Math.round(sumBaseLoad * invHours),
      avgWindCfPct: Number(((sumWindCf * invHours) * 100).toFixed(1)),
      negativeMarginHoursYear: negMarginYear,
      criticalImportHoursYear: critImportYear,
      negativeMarginHoursWindow: negMarginWindow,
      criticalImportHoursWindow: critImportWindow,
      minMarginMW: Number.isFinite(minMarginWindow) ? Math.round(minMarginWindow) : null,
      maxMarginMW: Number.isFinite(maxMarginWindow) ? Math.round(maxMarginWindow) : null,
      annualCurtailmentWithoutDcTWh: Number((curtNoDcYearMWh / 1_000_000).toFixed(2)),
      annualCurtailmentWithDcTWh: Number((curtWithDcYearMWh / 1_000_000).toFixed(2)),
      windowCurtailmentWithoutDcGWh: Number((curtNoDcWindowMWh / 1000).toFixed(1)),
      windowCurtailmentWithDcGWh: Number((curtWithDcWindowMWh / 1000).toFixed(1)),
    },
    monteCarlo,
  };
}
