import type { PipelineConfigSnapshot, PipelineSsotBundle } from '../data/pipelineTypes';

export type DataCenterScenarioId = 'none' | 'conservative' | 'central' | 'high';
export type WindExpansionScenarioId = 'base' | 'intermediate' | 'high';
export type SeasonalRegimeId = 'dry_windy' | 'wet_calm' | 'annual_blend';

export type EnergyModelSsotInput = Pick<
  PipelineSsotBundle,
  'config' | 'scenarioAnnualRamp' | 'monteCarlo12Scenarios2035' | 'annualRiskTimeline2026_2035'
>;

export const DEFAULT_ENERGY_MODEL_CONFIG: PipelineConfigSnapshot = {
  subsystemId: 'NE',
  baseWindOnshore2026MW: 29600.0,
  baseHydroThermalMW: 4150.0,
  interchangeImportLimitMW: 7000.0,
  interchangeExportLimitMW: 9500.0,
  defaultPue: 1.28,
  defaultUtilization: 0.8,
  dcScenariosItMW: {
    none: 0.0,
    conservative: 950.0,
    central: 2200.0,
    high: 4100.0,
  },
  windExpansionOnshoreMW: {
    base: 0.0,
    intermediate: 6800.0,
    high: 14800.0,
  },
  officialDataUrls: {},
};

export interface SimulationConfig {
  targetYear: number; // 2026..2035
  dcScenario: DataCenterScenarioId;
  windScenario: WindExpansionScenarioId;
  includeOffshorePost2031: boolean;
  seasonalRegime: SeasonalRegimeId;
  pue: number; // e.g., 1.28
  dcUtilization: number; // 0.50 .. 0.95
  isPublishedPowerTotalGrid: boolean; // if true, do not multiply by PUE again (PDF Sec. 5 rule)
  interchangeImportLimitMW: number; // e.g., 7000 MW import limit into NE
  interchangeExportLimitMW: number; // e.g., 9500 MW export limit out of NE
}

export interface HourlyPoint {
  hourIndex: number; // 0..167 (7 days)
  dayLabel: string;
  hourOfDay: number;
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
  importRequiredMW: number;
  exceedsImportLimit: boolean;
  curtailmentWithoutDcMW: number;
  curtailmentWithDcMW: number;
}

export interface MonteCarloSummary {
  iterations: number;
  p50PeakImportMW: number;
  p95PeakImportMW: number;
  probCriticalImportAnnualPct: number;
  probCriticalWithoutDcPct: number;
  expectedCurtailmentWithDcTWh: number;
  expectedCurtailmentWithoutDcTWh: number;
  curtailmentAvoidedByDcGWh: number;
  requiredExtraWindGWForTargetRisk: number;
  effectiveDcLoadMW: number;
  installedWindGW: number;
  offshoreWindGW: number;
}

export interface SimulationResult {
  config: SimulationConfig;
  hourlySeries: HourlyPoint[];
  summary: {
    avgBaseLoadMW: number;
    effectiveDcLoadMW: number;
    peakTotalLoadMW: number;
    avgWindCfPct: number;
    minMarginMW: number;
    maxMarginMW: number;
    negativeMarginHoursPerWeek: number;
    negativeMarginHoursWithoutDcPerWeek: number;
    criticalImportHoursPerWeek: number;
    weeklyImportEnergyGWh: number;
    weeklyCurtailmentWithDcGWh: number;
    weeklyCurtailmentWithoutDcGWh: number;
    curtailmentReductionPct: number;
  };
  monteCarlo: MonteCarloSummary;
}

/**
 * Calcula a rampa logística/progressiva de entrada dos data centers entre 2026 e 2035.
 * Usada como fallback paramétrico quando a série `scenarioAnnualRamp` do SSOT não é fornecida.
 */
export function computeDcRampFactor(targetYear: number): number {
  const clampedYear = Math.max(2026, Math.min(2035, targetYear));
  const progress = (clampedYear - 2026) / (2035 - 2026);
  const sCurve = 0.14 + 0.86 * Math.pow(progress, 1.35);
  return Number(Math.min(1, Math.max(0, sCurve)).toFixed(4));
}

/**
 * Calcula L_DC(t) = P_IT * utilizacao * PUE * ramp(t).
 * Se a potência publicada já representar carga total na rede, não multiplica por PUE novamente.
 */
export function computeDataCenterLoadMW(params: {
  itPowerMW: number;
  utilization: number;
  pue: number;
  rampFactor: number;
  isPublishedPowerTotalGrid: boolean;
}): number {
  const { itPowerMW, utilization, pue, rampFactor, isPublishedPowerTotalGrid } = params;
  if (itPowerMW <= 0 || utilization <= 0 || rampFactor <= 0) {
    return 0;
  }
  const effectivePue = isPublishedPowerTotalGrid ? 1.0 : Math.max(1.0, pue);
  return Math.round(itPowerMW * utilization * effectivePue * rampFactor);
}

/**
 * Resolve a carga efetiva média na rede elétrica (MW) dos Data Centers usando a rampa bottom-up
 * oficial do SSOT (`scenarioAnnualRamp`) quando disponível e escalando pelos parâmetros interativos
 * (`pue`, `dcUtilization` e `isPublishedPowerTotalGrid`) sem dupla contagem de PUE.
 */
export function resolveEffectiveDcLoadMW(
  config: Pick<
    SimulationConfig,
    'targetYear' | 'dcScenario' | 'pue' | 'dcUtilization' | 'isPublishedPowerTotalGrid'
  >,
  ssot?: EnergyModelSsotInput
): number {
  if (config.dcScenario === 'none') {
    return 0;
  }

  const ssotCfg = ssot?.config ?? DEFAULT_ENERGY_MODEL_CONFIG;
  const rampRow = ssot?.scenarioAnnualRamp?.find((r) => r.year === config.targetYear);

  if (rampRow) {
    const baseGridMW =
      config.dcScenario === 'conservative'
        ? rampRow.conservativeMW
        : config.dcScenario === 'central'
          ? rampRow.centralMW
          : rampRow.highMW;
    const basePue = Math.max(1.0, ssotCfg.defaultPue);
    const baseUtil = Math.max(0.01, ssotCfg.defaultUtilization);
    const pueFactor = config.isPublishedPowerTotalGrid ? 1.0 / basePue : Math.max(1.0, config.pue) / basePue;
    const utilFactor = Math.max(0, config.dcUtilization) / baseUtil;
    return Number((baseGridMW * pueFactor * utilFactor).toFixed(1));
  }

  const rampFactor = computeDcRampFactor(config.targetYear);
  return computeDataCenterLoadMW({
    itPowerMW: ssotCfg.dcScenariosItMW[config.dcScenario],
    utilization: config.dcUtilization,
    pue: config.pue,
    rampFactor,
    isPublishedPowerTotalGrid: config.isPublishedPowerTotalGrid,
  });
}

/**
 * Converte Fator de Capacidade previsto CF(t) e capacidade instalada futura em geração horária (MW).
 * Regra central do Plano Orientador: G_eolica(t) = CF(t) * Capacidade_Instalada(t).
 */
export function computeWindGenerationMW(capacityFactor: number, installedWindMW: number): number {
  const clampedCf = Math.max(0, Math.min(1, capacityFactor));
  return Math.round(clampedCf * Math.max(0, installedWindMW));
}

/**
 * Calcula a capacidade eólica instalada (MW) no ano-alvo separando Onshore (SIGA) e Offshore (IBAMA).
 */
export function computeInstalledWindCapacityMW(
  config: Pick<SimulationConfig, 'targetYear' | 'windScenario' | 'includeOffshorePost2031'>,
  ssotConfig: PipelineConfigSnapshot = DEFAULT_ENERGY_MODEL_CONFIG
): { onshoreMW: number; offshoreMW: number; totalMW: number } {
  const yearFrac = Math.max(0, Math.min(1, (config.targetYear - 2026) / 9));
  const onshoreAddition = Math.round(
    ssotConfig.windExpansionOnshoreMW[config.windScenario] * Math.pow(yearFrac, 0.9)
  );
  const onshoreMW = ssotConfig.baseWindOnshore2026MW + onshoreAddition;

  // Parques eólicos offshore no IBAMA possuem lead time ambiental/portuário longo, entrando gradualmente apenas pós-2031
  let offshoreMW = 0;
  if (config.includeOffshorePost2031 && config.targetYear >= 2032) {
    const offshoreProgress = (config.targetYear - 2031) / 4; // 2032..2035
    const scenarioMultiplier =
      config.windScenario === 'high' ? 3600 : config.windScenario === 'intermediate' ? 1800 : 800;
    offshoreMW = Math.round(scenarioMultiplier * offshoreProgress);
  }

  return {
    onshoreMW,
    offshoreMW,
    totalMW: onshoreMW + offshoreMW,
  };
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

/**
 * Simula uma semana representativa (168 horas) do balanço elétrico do Subsistema Nordeste:
 * M(t) = G_NE(t) - [L_base(t) + L_DC(t)]
 */
export function simulateHourlyWeek(config: SimulationConfig, ssot?: EnergyModelSsotInput): HourlyPoint[] {
  const ssotCfg = ssot?.config ?? DEFAULT_ENERGY_MODEL_CONFIG;
  const yearsFrom2026 = Math.max(0, config.targetYear - 2026);
  // Crescimento vegetativo estrutural da carga base NE (~3.1% a.a. ancorado em EPE/PDE)
  const structuralLoadGrowth = Math.pow(1.031, yearsFrom2026);

  const baseDcMW = resolveEffectiveDcLoadMW(config, ssot);
  const windCap = computeInstalledWindCapacityMW(config, ssotCfg);

  // Capacidade solar centralizada + MMGD equivalente no NE cresce no horizonte 2035
  const solarPeakMW = Math.round(8200 * (1 + 0.055 * yearsFrom2026));
  const baseHydroThermalMW = ssotCfg.baseHydroThermalMW;

  const series: HourlyPoint[] = [];

  for (let h = 0; h < 168; h++) {
    const dayIdx = Math.floor(h / 24);
    const hour = h % 24;
    const isWeekend = dayIdx >= 5;

    // Perfil horário realista da carga base NE (pico noturno 19h–22h + rampa vespertina comercial)
    const diurnalLoadShape =
      0.84 +
      0.11 * Math.sin(((hour - 9) * Math.PI) / 12) +
      0.14 * Math.exp(-Math.pow((hour - 20) / 2.8, 2)) -
      0.08 * Math.exp(-Math.pow((hour - 4) / 3.0, 2));

    const weekendFactor = isWeekend ? 0.91 : 1.0;
    const baseLoad2026 = 13100 * diurnalLoadShape * weekendFactor;
    const baseLoadMW = Math.round(baseLoad2026 * structuralLoadGrowth);

    // Carga firme 24/7 dos data centers (alinhada à premissa baseload contínua do Script 06)
    const dcLoadMW = Math.round(baseDcMW);
    const totalLoadMW = baseLoadMW + dcLoadMW;

    // Fator de capacidade eólico horário no NE (ventos alísios mais intensos à noite/madrugada e na estação seca Ago-Nov)
    let regimeBaseCf = 0.44;
    let regimeAmplitude = 0.15;
    if (config.seasonalRegime === 'dry_windy') {
      regimeBaseCf = 0.58;
      regimeAmplitude = 0.16;
    } else if (config.seasonalRegime === 'wet_calm') {
      regimeBaseCf = 0.27;
      regimeAmplitude = 0.13;
    }

    // Variação sinóptica de vários dias (frentes/calmarias nos dias 3 e 4 — horas 52..96)
    const synopticDip = -0.11 * Math.exp(-Math.pow((h - 76) / 19, 2)) + 0.07 * Math.sin((2 * Math.PI * h) / 84);
    // Ciclo diurno típico do vento nordestino (mais forte entre 20h e 03h, menor entre 10h e 15h)
    const nocturnalWindWave = regimeAmplitude * Math.cos(((hour - 23) * 2 * Math.PI) / 24);

    // Offshore possui CF ligeiramente mais firme (+0.08) quando presente
    const offshoreShare = windCap.totalMW > 0 ? windCap.offshoreMW / windCap.totalMW : 0;
    const rawCf = regimeBaseCf + nocturnalWindWave + synopticDip + offshoreShare * 0.08;
    const windCapacityFactor = Number(Math.max(0.06, Math.min(0.88, rawCf)).toFixed(3));

    const windGenPotentialMW = computeWindGenerationMW(windCapacityFactor, windCap.totalMW);

    // Perfil solar entre 06h e 18h com pico às 12h
    let solarGenMW = 0;
    if (hour >= 6 && hour <= 17) {
      const solarCurve = Math.sin(((hour - 5.5) * Math.PI) / 12.5);
      const cloudFactor = dayIdx === 2 ? 0.76 : 0.94;
      solarGenMW = Math.round(Math.max(0, solarPeakMW * solarCurve * cloudFactor));
    }

    // Despacho hidrotérmico complementar modula na ponta noturna
    const hydroPeakSupport = hour >= 18 && hour <= 22 ? 650 : 0;
    const otherDispatchableMW = baseHydroThermalMW + hydroPeakSupport;

    const totalGenPotentialMW = windGenPotentialMW + solarGenMW + otherDispatchableMW;

    const marginWithoutDcMW = totalGenPotentialMW - baseLoadMW;
    const marginWithDcMW = totalGenPotentialMW - totalLoadMW;

    const importRequiredMW = Math.max(0, -marginWithDcMW);
    const exceedsImportLimit = importRequiredMW > config.interchangeImportLimitMW;

    // Curtailment estimado quando o excedente local supera a capacidade de escoamento/exportação do NE
    const curtailmentWithoutDcMW = Math.max(0, marginWithoutDcMW - config.interchangeExportLimitMW);
    const curtailmentWithDcMW = Math.max(0, marginWithDcMW - config.interchangeExportLimitMW);

    series.push({
      hourIndex: h,
      dayLabel: `${DAY_NAMES[dayIdx]} ${String(hour).padStart(2, '0')}h`,
      hourOfDay: hour,
      baseLoadMW,
      dcLoadMW,
      totalLoadMW,
      windCapacityFactor,
      windGenPotentialMW,
      solarGenMW,
      otherDispatchableMW,
      totalGenPotentialMW,
      marginWithoutDcMW,
      marginWithDcMW,
      importRequiredMW,
      exceedsImportLimit,
      curtailmentWithoutDcMW,
      curtailmentWithDcMW,
    });
  }

  return series;
}

/**
 * Executa simulação de Monte Carlo por blocos meteorológicos e incertezas de projetos (Seção 7 do PDF),
 * ancorando automaticamente aos resultados oficiais do Script 06 (SSOT) quando a configuração coincide
 * com os cenários nominais oficiais de 2035 ou com a trajetória decenal 2026–2035.
 */
export function runMonteCarloSimulation(
  config: SimulationConfig,
  baseSeries: HourlyPoint[],
  iterations = 240,
  ssot?: EnergyModelSsotInput
): MonteCarloSummary {
  const ssotCfg = ssot?.config ?? DEFAULT_ENERGY_MODEL_CONFIG;
  const windCap = computeInstalledWindCapacityMW(config, ssotCfg);
  const nominalDcMW = resolveEffectiveDcLoadMW(config, ssot);

  const isOfficialNominalParams =
    Boolean(ssot) &&
    config.seasonalRegime === 'annual_blend' &&
    Math.abs(config.pue - ssotCfg.defaultPue) < 1e-6 &&
    Math.abs(config.dcUtilization - ssotCfg.defaultUtilization) < 1e-6 &&
    !config.isPublishedPowerTotalGrid &&
    Math.abs(config.interchangeImportLimitMW - ssotCfg.interchangeImportLimitMW) < 1e-6 &&
    Math.abs(config.interchangeExportLimitMW - ssotCfg.interchangeExportLimitMW) < 1e-6;

  // Ancoragem direta aos 12 cenários oficiais do Script 06 (2035)
  if (isOfficialNominalParams && ssot && config.targetYear === 2035) {
    const officialMatch = ssot.monteCarlo12Scenarios2035.find(
      (row) =>
        row.dcScenarioId === config.dcScenario &&
        Math.abs(row.windCapacityMW - windCap.totalMW) < 50
    );
    if (officialMatch) {
      const noDcMatch = ssot.monteCarlo12Scenarios2035.find(
        (row) =>
          row.dcScenarioId === 'none' &&
          Math.abs(row.windCapacityMW - windCap.totalMW) < 50
      );
      return {
        iterations: 1000,
        p50PeakImportMW: Math.round(officialMatch.importP50MW),
        p95PeakImportMW: Math.round(officialMatch.importP95MW),
        probCriticalImportAnnualPct: officialMatch.probExceedInterchangePct,
        probCriticalWithoutDcPct: noDcMatch
          ? noDcMatch.probExceedInterchangePct
          : officialMatch.probExceedInterchangePct,
        expectedCurtailmentWithDcTWh: officialMatch.curtailmentWithDcTWh,
        expectedCurtailmentWithoutDcTWh: officialMatch.curtailmentWithoutDcTWh,
        curtailmentAvoidedByDcGWh: Math.round(officialMatch.curtailmentAvoidedGWh),
        requiredExtraWindGWForTargetRisk: officialMatch.compensatoryWindExpansionGW,
        effectiveDcLoadMW: officialMatch.dcLoadMW,
        installedWindGW: Number((officialMatch.windCapacityMW / 1000).toFixed(2)),
        offshoreWindGW: Number((officialMatch.windOffshoreMW / 1000).toFixed(2)),
      };
    }
  }

  // Ancoragem à evolução anual oficial (2026–2035) no cenário Central × SIGA Intermediário
  if (
    isOfficialNominalParams &&
    ssot &&
    config.dcScenario === 'central' &&
    config.windScenario === 'intermediate' &&
    !config.includeOffshorePost2031
  ) {
    const timelineMatch = ssot.annualRiskTimeline2026_2035.find(
      (row) => row.year === config.targetYear
    );
    if (timelineMatch) {
      const avoidedTWh = timelineMatch.curtailmentAvoidedGWh / 1000;
      const noDcBase = ssot.monteCarlo12Scenarios2035.find(
        (row) => row.dcScenarioId === 'none' && Math.abs(row.windCapacityMW - timelineMatch.windCapacityMW) < 250
      );
      return {
        iterations: 1000,
        p50PeakImportMW: Math.round(timelineMatch.importP50MW),
        p95PeakImportMW: Math.round(timelineMatch.importP95MW),
        probCriticalImportAnnualPct: timelineMatch.probExceedInterchangePct,
        probCriticalWithoutDcPct: noDcBase
          ? noDcBase.probExceedInterchangePct
          : Number(Math.max(1.5, timelineMatch.probExceedInterchangePct - 4.0).toFixed(1)),
        expectedCurtailmentWithDcTWh: timelineMatch.curtailmentWithDcTWh,
        expectedCurtailmentWithoutDcTWh: Number((timelineMatch.curtailmentWithDcTWh + avoidedTWh).toFixed(2)),
        curtailmentAvoidedByDcGWh: Math.round(timelineMatch.curtailmentAvoidedGWh),
        requiredExtraWindGWForTargetRisk: timelineMatch.compensatoryWindGW,
        effectiveDcLoadMW: timelineMatch.dcLoadMW,
        installedWindGW: Number((timelineMatch.windCapacityMW / 1000).toFixed(2)),
        offshoreWindGW: 0,
      };
    }
  }

  const rng = createSeededRng(
    config.targetYear * 97 +
      Math.round(config.pue * 100) * 13 +
      Math.round(config.dcUtilization * 100) * 7 +
      config.interchangeImportLimitMW
  );

  const peakImportsWithDc: number[] = [];
  let criticalRunsWithDc = 0;
  let criticalRunsWithoutDc = 0;
  let sumCurtailmentWithDcMWh = 0;
  let sumCurtailmentWithoutDcMWh = 0;

  for (let sim = 0; sim < iterations; sim++) {
    // 1. Incerteza do crescimento de carga normal e erro do modelo A (+/- 4.5%)
    const loadMultiplier = 0.955 + rng() * 0.09;

    // 2. Atraso / concretização de projetos eólicos no SIGA/IBAMA (entre 76% e 104% do previsto)
    const windProjectCompletion =
      config.windScenario === 'base' ? 0.98 + rng() * 0.03 : 0.78 + rng() * 0.25;

    // 3. Concretização e rampa efetiva de Data Centers (atraso de subestação ou entrada acelerada)
    const dcRealization =
      config.dcScenario === 'none'
        ? 0
        : config.dcScenario === 'conservative'
          ? 0.85 + rng() * 0.2
          : 0.68 + rng() * 0.42;

    // 4. Sorteio de bloco meteorológico anual/sazonal (preservando autocorrelação da série base)
    const windRegimeMultiplier = 0.72 + rng() * 0.48;

    // 5. Disponibilidade operacional de intercâmbio SIN (+/- 8% por restrições de malha)
    const effectiveImportLimit = config.interchangeImportLimitMW * (0.92 + rng() * 0.12);

    let maxImportRunWithDc = 0;
    let maxImportRunWithoutDc = 0;
    let weeklyCurtWithDc = 0;
    let weeklyCurtWithoutDc = 0;

    for (let i = 0; i < baseSeries.length; i++) {
      const pt = baseSeries[i];
      const simBaseLoad = pt.baseLoadMW * loadMultiplier;
      const simDcLoad = nominalDcMW * dcRealization * (pt.dcLoadMW / Math.max(1, nominalDcMW || 1));
      const simWindGen = Math.min(
        windCap.totalMW * windProjectCompletion * 0.9,
        pt.windGenPotentialMW * windProjectCompletion * windRegimeMultiplier
      );
      const simTotalGen = simWindGen + pt.solarGenMW + pt.otherDispatchableMW;

      const marginNoDc = simTotalGen - simBaseLoad;
      const marginDc = simTotalGen - (simBaseLoad + simDcLoad);

      const impNoDc = Math.max(0, -marginNoDc);
      const impDc = Math.max(0, -marginDc);

      if (impDc > maxImportRunWithDc) maxImportRunWithDc = impDc;
      if (impNoDc > maxImportRunWithoutDc) maxImportRunWithoutDc = impNoDc;

      weeklyCurtWithoutDc += Math.max(0, marginNoDc - config.interchangeExportLimitMW);
      weeklyCurtWithDc += Math.max(0, marginDc - config.interchangeExportLimitMW);
    }

    peakImportsWithDc.push(maxImportRunWithDc);
    if (maxImportRunWithDc > effectiveImportLimit) criticalRunsWithDc++;
    if (maxImportRunWithoutDc > effectiveImportLimit) criticalRunsWithoutDc++;

    // Extrapolação para 52 semanas ponderada por sazonalidade
    const annualScale = config.seasonalRegime === 'wet_calm' ? 36 : config.seasonalRegime === 'dry_windy' ? 38 : 52;
    sumCurtailmentWithDcMWh += weeklyCurtWithDc * annualScale;
    sumCurtailmentWithoutDcMWh += weeklyCurtWithoutDc * annualScale;
  }

  peakImportsWithDc.sort((a, b) => a - b);
  const p50Idx = Math.floor(iterations * 0.5);
  const p95Idx = Math.min(iterations - 1, Math.floor(iterations * 0.95));

  const p50PeakImportMW = Math.round(peakImportsWithDc[p50Idx] ?? 0);
  const p95PeakImportMW = Math.round(peakImportsWithDc[p95Idx] ?? 0);

  const excessImportOverLimitMW = Math.max(0, p95PeakImportMW - config.interchangeImportLimitMW);
  const lowWindFirmCf = config.includeOffshorePost2031 && config.targetYear >= 2032 ? 0.25 : 0.19;
  const requiredExtraWindMW = excessImportOverLimitMW > 0
    ? excessImportOverLimitMW / lowWindFirmCf
    : nominalDcMW > 0
      ? (nominalDcMW * 0.35) / lowWindFirmCf
      : 0;

  const avgCurtWithDcTWh = sumCurtailmentWithDcMWh / iterations / 1_000_000;
  const avgCurtWithoutDcTWh = sumCurtailmentWithoutDcMWh / iterations / 1_000_000;

  return {
    iterations,
    p50PeakImportMW,
    p95PeakImportMW,
    probCriticalImportAnnualPct: Number(((criticalRunsWithDc / iterations) * 100).toFixed(1)),
    probCriticalWithoutDcPct: Number(((criticalRunsWithoutDc / iterations) * 100).toFixed(1)),
    expectedCurtailmentWithDcTWh: Number(avgCurtWithDcTWh.toFixed(2)),
    expectedCurtailmentWithoutDcTWh: Number(avgCurtWithoutDcTWh.toFixed(2)),
    curtailmentAvoidedByDcGWh: Math.max(
      0,
      Math.round(((sumCurtailmentWithoutDcMWh - sumCurtailmentWithDcMWh) / iterations) / 1000)
    ),
    requiredExtraWindGWForTargetRisk: Number((requiredExtraWindMW / 1000).toFixed(2)),
    effectiveDcLoadMW: nominalDcMW,
    installedWindGW: Number((windCap.totalMW / 1000).toFixed(2)),
    offshoreWindGW: Number((windCap.offshoreMW / 1000).toFixed(2)),
  };
}

export function evaluateScenario(config: SimulationConfig, ssot?: EnergyModelSsotInput): SimulationResult {
  const hourlySeries = simulateHourlyWeek(config, ssot);
  const n = hourlySeries.length;

  let sumBaseLoad = 0;
  let sumDcLoad = 0;
  let peakTotalLoadMW = 0;
  let sumCf = 0;
  let minMarginMW = Number.POSITIVE_INFINITY;
  let maxMarginMW = Number.NEGATIVE_INFINITY;
  let negativeMarginHoursPerWeek = 0;
  let negativeMarginHoursWithoutDcPerWeek = 0;
  let criticalImportHoursPerWeek = 0;
  let sumImportMWh = 0;
  let sumCurtWithDcMWh = 0;
  let sumCurtWithoutDcMWh = 0;

  for (const pt of hourlySeries) {
    sumBaseLoad += pt.baseLoadMW;
    sumDcLoad += pt.dcLoadMW;
    if (pt.totalLoadMW > peakTotalLoadMW) peakTotalLoadMW = pt.totalLoadMW;
    sumCf += pt.windCapacityFactor;
    if (pt.marginWithDcMW < minMarginMW) minMarginMW = pt.marginWithDcMW;
    if (pt.marginWithDcMW > maxMarginMW) maxMarginMW = pt.marginWithDcMW;
    if (pt.marginWithDcMW < 0) negativeMarginHoursPerWeek++;
    if (pt.marginWithoutDcMW < 0) negativeMarginHoursWithoutDcPerWeek++;
    if (pt.exceedsImportLimit) criticalImportHoursPerWeek++;
    sumImportMWh += pt.importRequiredMW;
    sumCurtWithDcMWh += pt.curtailmentWithDcMW;
    sumCurtWithoutDcMWh += pt.curtailmentWithoutDcMW;
  }

  const curtailmentReductionPct =
    sumCurtWithoutDcMWh > 0
      ? Number((((sumCurtWithoutDcMWh - sumCurtWithDcMWh) / sumCurtWithoutDcMWh) * 100).toFixed(1))
      : 0;

  const monteCarlo = runMonteCarloSimulation(config, hourlySeries, 240, ssot);

  return {
    config,
    hourlySeries,
    summary: {
      avgBaseLoadMW: Math.round(sumBaseLoad / n),
      effectiveDcLoadMW: Number(monteCarlo.effectiveDcLoadMW.toFixed(1)) || Math.round(sumDcLoad / n),
      peakTotalLoadMW,
      avgWindCfPct: Number(((sumCf / n) * 100).toFixed(1)),
      minMarginMW,
      maxMarginMW,
      negativeMarginHoursPerWeek,
      negativeMarginHoursWithoutDcPerWeek,
      criticalImportHoursPerWeek,
      weeklyImportEnergyGWh: Number((sumImportMWh / 1000).toFixed(1)),
      weeklyCurtailmentWithDcGWh: Number((sumCurtWithDcMWh / 1000).toFixed(1)),
      weeklyCurtailmentWithoutDcGWh: Number((sumCurtWithoutDcMWh / 1000).toFixed(1)),
      curtailmentReductionPct,
    },
    monteCarlo,
  };
}
