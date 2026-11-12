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
  horizon: 'Operativo Curto Prazo (1h-Ahead)' | 'Programação Diária (24h Day-Ahead)';
  architecture: string;
  family: 'Linear' | 'Não-Linear (SciPy L-BFGS-B)' | 'Não-Linear (NumPy GBDT)';
  maeMW: number;
  rmseMW: number;
  mapePct: number;
  r2Score: number;
  peakHourMaeMW: number;
}

export interface ModelBBenchmarkRow {
  horizon: 'Operativo Curto Prazo (1h-Ahead)' | 'Regime Diário / Sazonal (24h Day-Ahead)';
  architecture: string;
  family: 'Linear' | 'Não-Linear (SciPy L-BFGS-B)' | 'Não-Linear (NumPy GBDT)';
  maeCF: number;
  rmseCF: number;
  r2Score: number;
  equivPowerMaeMW: number;
}

export interface ModelCBenchmarkRow {
  architecture: string;
  family: 'Linear' | 'Não-Linear (SciPy + NumPy)' | 'Não-Linear (NumPy GBDT)';
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

export const ANOVA_TEST_RESULTS: AnovaTestResult[] = [
  {
    targetVariable: 'CF Eólico Potencial (cf_eolica)',
    groupingFactor: 'Mês do Ano (Sazonalidade 12 meses)',
    fStatistic: 5166.30,
    pValue: 0.0,
    etaSquaredPct: 37.13,
    isSignificantAlpha01: true,
    technicalInterpretation:
      'Fortíssima sazonalidade atmosférica após reconstituição do constrained-off: a Safra dos Ventos (Ago-Out, CF potencial ~60,3% a 61,8%) supera em mais de 2x o período chuvoso de calmaria (Mar-Abr, CF ~29,9% a 31,8%), explicando 37,13% da variância total.',
  },
  {
    targetVariable: 'Intercâmbio Líquido SIN (intercambio_liquido_mw)',
    groupingFactor: 'Mês do Ano (12 meses)',
    fStatistic: 2059.45,
    pValue: 0.0,
    etaSquaredPct: 19.06,
    isSignificantAlpha01: true,
    technicalInterpretation:
      'Inversão estrutural do fluxo energético: o Nordeste atua como exportador maciço para o SE/CO e Norte durante a Safra dos Ventos e reduz o saldo exportador nas madrugadas da estação úmida (η² = 19,06%).',
  },
  {
    targetVariable: 'Curtailment Eólico Real (curtailment_mw · 2023-2025)',
    groupingFactor: 'Faixa Horária do Dia (24 horas)',
    fStatistic: 182.00,
    pValue: 0.0,
    etaSquaredPct: 13.74,
    isSignificantAlpha01: true,
    technicalInterpretation:
      'Concentração severa de cortes (constrained-off ONS por razões ENE, CNF e REL) entre 08h e 15h devido à rampa solar centralizada e MMGD simultânea à geração eólica, atingindo picos médios acima de 6.000 MWmed às 09h-11h em 2025.',
  },
  {
    targetVariable: 'Carga Base (l_base_mw)',
    groupingFactor: 'Dia da Semana (7 dias: Seg a Dom)',
    fStatistic: 1345.64,
    pValue: 0.0,
    etaSquaredPct: 7.74,
    isSignificantAlpha01: true,
    technicalInterpretation:
      'Descolamento altamente significativo entre dias úteis industriais/comerciais e domingos, com redução média de ~1.800 MW na demanda base do Subsistema Nordeste aos fins de semana.',
  },
];

export const MONTHLY_WIND_PROFILES: MonthlyWindProfile[] = [
  {
    month: 1,
    monthName: 'Janeiro',
    avgCapacityFactor: 0.348,
    stdCapacityFactor: 0.149,
    p10CapacityFactor: 0.148,
    p50MedianCapacityFactor: 0.348,
    p90CapacityFactor: 0.550,
    avgBaseLoadMW: 11221.2,
    avgCurtailmentMW: 260.8,
    seasonalRegime: 'Transição',
  },
  {
    month: 2,
    monthName: 'Fevereiro',
    avgCapacityFactor: 0.340,
    stdCapacityFactor: 0.146,
    p10CapacityFactor: 0.145,
    p50MedianCapacityFactor: 0.332,
    p90CapacityFactor: 0.544,
    avgBaseLoadMW: 11343.7,
    avgCurtailmentMW: 1316.8,
    seasonalRegime: 'Transição',
  },
  {
    month: 3,
    monthName: 'Março',
    avgCapacityFactor: 0.299,
    stdCapacityFactor: 0.141,
    p10CapacityFactor: 0.107,
    p50MedianCapacityFactor: 0.296,
    p90CapacityFactor: 0.494,
    avgBaseLoadMW: 11361.9,
    avgCurtailmentMW: 473.8,
    seasonalRegime: 'Estação Chuvosa / Calmaria',
  },
  {
    month: 4,
    monthName: 'Abril',
    avgCapacityFactor: 0.318,
    stdCapacityFactor: 0.146,
    p10CapacityFactor: 0.125,
    p50MedianCapacityFactor: 0.314,
    p90CapacityFactor: 0.511,
    avgBaseLoadMW: 11073.6,
    avgCurtailmentMW: 339.3,
    seasonalRegime: 'Estação Chuvosa / Calmaria',
  },
  {
    month: 5,
    monthName: 'Maio',
    avgCapacityFactor: 0.411,
    stdCapacityFactor: 0.138,
    p10CapacityFactor: 0.217,
    p50MedianCapacityFactor: 0.422,
    p90CapacityFactor: 0.585,
    avgBaseLoadMW: 10961.3,
    avgCurtailmentMW: 947.0,
    seasonalRegime: 'Estação Chuvosa / Calmaria',
  },
  {
    month: 6,
    monthName: 'Junho',
    avgCapacityFactor: 0.487,
    stdCapacityFactor: 0.133,
    p10CapacityFactor: 0.300,
    p50MedianCapacityFactor: 0.503,
    p90CapacityFactor: 0.645,
    avgBaseLoadMW: 10578.0,
    avgCurtailmentMW: 1217.3,
    seasonalRegime: 'Transição',
  },
  {
    month: 7,
    monthName: 'Julho',
    avgCapacityFactor: 0.550,
    stdCapacityFactor: 0.136,
    p10CapacityFactor: 0.359,
    p50MedianCapacityFactor: 0.571,
    p90CapacityFactor: 0.700,
    avgBaseLoadMW: 10451.8,
    avgCurtailmentMW: 1711.6,
    seasonalRegime: 'Transição',
  },
  {
    month: 8,
    monthName: 'Agosto',
    avgCapacityFactor: 0.603,
    stdCapacityFactor: 0.142,
    p10CapacityFactor: 0.422,
    p50MedianCapacityFactor: 0.630,
    p90CapacityFactor: 0.749,
    avgBaseLoadMW: 10688.0,
    avgCurtailmentMW: 2373.1,
    seasonalRegime: 'Safra dos Ventos',
  },
  {
    month: 9,
    monthName: 'Setembro',
    avgCapacityFactor: 0.618,
    stdCapacityFactor: 0.134,
    p10CapacityFactor: 0.445,
    p50MedianCapacityFactor: 0.640,
    p90CapacityFactor: 0.761,
    avgBaseLoadMW: 11007.2,
    avgCurtailmentMW: 3232.6,
    seasonalRegime: 'Safra dos Ventos',
  },
  {
    month: 10,
    monthName: 'Outubro',
    avgCapacityFactor: 0.564,
    stdCapacityFactor: 0.162,
    p10CapacityFactor: 0.331,
    p50MedianCapacityFactor: 0.592,
    p90CapacityFactor: 0.747,
    avgBaseLoadMW: 11524.9,
    avgCurtailmentMW: 2855.3,
    seasonalRegime: 'Safra dos Ventos',
  },
  {
    month: 11,
    monthName: 'Novembro',
    avgCapacityFactor: 0.473,
    stdCapacityFactor: 0.157,
    p10CapacityFactor: 0.265,
    p50MedianCapacityFactor: 0.480,
    p90CapacityFactor: 0.678,
    avgBaseLoadMW: 11633.3,
    avgCurtailmentMW: 1670.8,
    seasonalRegime: 'Safra dos Ventos',
  },
  {
    month: 12,
    monthName: 'Dezembro',
    avgCapacityFactor: 0.431,
    stdCapacityFactor: 0.145,
    p10CapacityFactor: 0.242,
    p50MedianCapacityFactor: 0.440,
    p90CapacityFactor: 0.615,
    avgBaseLoadMW: 11544.7,
    avgCurtailmentMW: 1157.9,
    seasonalRegime: 'Transição',
  },
];

export const FEATURE_CORRELATIONS: FeatureCorrelationItem[] = [
  {
    featureName: 'cf_eolica_lag_1h',
    featureDescription: 'Fator de capacidade potencial observado na hora anterior (t-1h)',
    corrBaseLoad: -0.051,
    corrWindCF: 0.984,
    corrCurtailment: 0.426,
    roleInModel: 'Autoregressiva (Lag)',
  },
  {
    featureName: 'l_base_mw_lag_1h',
    featureDescription: 'Demanda de carga base observada na hora anterior (t-1h)',
    corrBaseLoad: 0.973,
    corrWindCF: -0.014,
    corrCurtailment: -0.154,
    roleInModel: 'Autoregressiva (Lag)',
  },
  {
    featureName: 'l_base_mw_lag_168h',
    featureDescription: 'Demanda no mesmo dia e hora da semana anterior (t-168h)',
    corrBaseLoad: 0.935,
    corrWindCF: -0.009,
    corrCurtailment: -0.093,
    roleInModel: 'Autoregressiva (Lag)',
  },
  {
    featureName: 'l_base_mw_lag_24h',
    featureDescription: 'Demanda de carga no mesmo horário do dia anterior (t-24h)',
    corrBaseLoad: 0.865,
    corrWindCF: -0.030,
    corrCurtailment: -0.059,
    roleInModel: 'Autoregressiva (Lag)',
  },
  {
    featureName: 'cf_eolica_lag_24h',
    featureDescription: 'Fator de capacidade potencial no mesmo horário do dia anterior (t-24h)',
    corrBaseLoad: -0.020,
    corrWindCF: 0.820,
    corrCurtailment: 0.316,
    roleInModel: 'Autoregressiva (Lag)',
  },
  {
    featureName: 'razao_renovavel_carga',
    featureDescription: 'Razão física (G_eólica_pot + G_solar) / L_base no instante t',
    corrBaseLoad: 0.386,
    corrWindCF: 0.538,
    corrCurtailment: 0.723,
    roleInModel: 'Balanço Físico Exógeno',
  },
  {
    featureName: 'excedente_renovavel_mw',
    featureDescription: 'Saldo renovável instantâneo (G_eólica_pot + G_solar - L_base) em MW',
    corrBaseLoad: 0.317,
    corrWindCF: 0.554,
    corrCurtailment: 0.701,
    roleInModel: 'Balanço Físico Exógeno',
  },
  {
    featureName: 'month_sin',
    featureDescription: 'Harmônico anual senoidal de Fourier do mês do ano',
    corrBaseLoad: 0.042,
    corrWindCF: -0.591,
    corrCurtailment: -0.305,
    roleInModel: 'Harmônica (Fourier)',
  },
  {
    featureName: 'hour_cos',
    featureDescription: 'Harmônico diurno cossenoidal da hora do dia (24h)',
    corrBaseLoad: 0.044,
    corrWindCF: 0.228,
    corrCurtailment: -0.298,
    roleInModel: 'Harmônica (Fourier)',
  },
  {
    featureName: 'hour_sin',
    featureDescription: 'Harmônico diurno senoidal da hora do dia (24h)',
    corrBaseLoad: -0.342,
    corrWindCF: 0.047,
    corrCurtailment: 0.100,
    roleInModel: 'Harmônica (Fourier)',
  },
  {
    featureName: 'is_weekend',
    featureDescription: 'Indicador binário de fim de semana (sábado/domingo)',
    corrBaseLoad: -0.248,
    corrWindCF: -0.003,
    corrCurtailment: 0.105,
    roleInModel: 'Calendário',
  },
  {
    featureName: 'faixa_solar_pico',
    featureDescription: 'Janela diurna de radiação solar máxima (10h às 15h)',
    corrBaseLoad: 0.034,
    corrWindCF: -0.203,
    corrCurtailment: 0.232,
    roleInModel: 'Calendário',
  },
  {
    featureName: 'wind_speed_lag1_approx',
    featureDescription: 'Velocidade cúbica equivalente causal v_eq(t-1) ~ cbrt(CF_t-1)',
    corrBaseLoad: -0.057,
    corrWindCF: 0.964,
    corrCurtailment: 0.386,
    roleInModel: 'Não-Linearidade Aerodinâmica',
  },
  {
    featureName: 'cf_lag1_squared',
    featureDescription: 'Termo quadrático causal de Fator de Capacidade CF²(t-1)',
    corrBaseLoad: -0.036,
    corrWindCF: 0.959,
    corrCurtailment: 0.460,
    roleInModel: 'Não-Linearidade Aerodinâmica',
  },
];

export const MODEL_A_BENCHMARK_2025: ModelABenchmarkRow[] = [
  {
    horizon: 'Operativo Curto Prazo (1h-Ahead)',
    architecture: 'Challenger Não-Linear · Rede Neural ResMLP (L-BFGS-B)',
    family: 'Não-Linear (SciPy L-BFGS-B)',
    maeMW: 158.86,
    rmseMW: 213.01,
    mapePct: 1.22,
    r2Score: 0.9719,
    peakHourMaeMW: 169.75,
  },
  {
    horizon: 'Operativo Curto Prazo (1h-Ahead)',
    architecture: 'Challenger Não-Linear · Histogram GBDT (Árvores)',
    family: 'Não-Linear (NumPy GBDT)',
    maeMW: 186.79,
    rmseMW: 255.36,
    mapePct: 1.41,
    r2Score: 0.9597,
    peakHourMaeMW: 199.47,
  },
  {
    horizon: 'Operativo Curto Prazo (1h-Ahead)',
    architecture: 'Baseline Linear · Ridge L2',
    family: 'Linear',
    maeMW: 222.89,
    rmseMW: 290.28,
    mapePct: 1.70,
    r2Score: 0.9479,
    peakHourMaeMW: 236.55,
  },
  {
    horizon: 'Programação Diária (24h Day-Ahead)',
    architecture: 'Challenger Não-Linear · Rede Neural ResMLP (L-BFGS-B)',
    family: 'Não-Linear (SciPy L-BFGS-B)',
    maeMW: 309.40,
    rmseMW: 446.24,
    mapePct: 2.37,
    r2Score: 0.8768,
    peakHourMaeMW: 261.84,
  },
  {
    horizon: 'Programação Diária (24h Day-Ahead)',
    architecture: 'Challenger Não-Linear · Histogram GBDT (Árvores)',
    family: 'Não-Linear (NumPy GBDT)',
    maeMW: 349.61,
    rmseMW: 492.41,
    mapePct: 2.68,
    r2Score: 0.8500,
    peakHourMaeMW: 319.25,
  },
  {
    horizon: 'Programação Diária (24h Day-Ahead)',
    architecture: 'Baseline Linear · Ridge L2',
    family: 'Linear',
    maeMW: 398.48,
    rmseMW: 545.99,
    mapePct: 3.07,
    r2Score: 0.8155,
    peakHourMaeMW: 316.52,
  },
];

export const MODEL_B_BENCHMARK_2025: ModelBBenchmarkRow[] = [
  {
    horizon: 'Operativo Curto Prazo (1h-Ahead)',
    architecture: 'Challenger Não-Linear · Rede Neural ResMLP (L-BFGS-B)',
    family: 'Não-Linear (SciPy L-BFGS-B)',
    maeCF: 0.0173,
    rmseCF: 0.0228,
    r2Score: 0.9853,
    equivPowerMaeMW: 517.6,
  },
  {
    horizon: 'Operativo Curto Prazo (1h-Ahead)',
    architecture: 'Challenger Não-Linear · Histogram GBDT (Árvores)',
    family: 'Não-Linear (NumPy GBDT)',
    maeCF: 0.0203,
    rmseCF: 0.0271,
    r2Score: 0.9791,
    equivPowerMaeMW: 607.2,
  },
  {
    horizon: 'Operativo Curto Prazo (1h-Ahead)',
    architecture: 'Baseline Linear · Ridge L2',
    family: 'Linear',
    maeCF: 0.0211,
    rmseCF: 0.0277,
    r2Score: 0.9783,
    equivPowerMaeMW: 632.1,
  },
  {
    horizon: 'Regime Diário / Sazonal (24h Day-Ahead)',
    architecture: 'Challenger Não-Linear · Rede Neural ResMLP (L-BFGS-B)',
    family: 'Não-Linear (SciPy L-BFGS-B)',
    maeCF: 0.0798,
    rmseCF: 0.1018,
    r2Score: 0.7058,
    equivPowerMaeMW: 2386.5,
  },
  {
    horizon: 'Regime Diário / Sazonal (24h Day-Ahead)',
    architecture: 'Challenger Não-Linear · Histogram GBDT (Árvores)',
    family: 'Não-Linear (NumPy GBDT)',
    maeCF: 0.0808,
    rmseCF: 0.1028,
    r2Score: 0.7000,
    equivPowerMaeMW: 2418.6,
  },
  {
    horizon: 'Regime Diário / Sazonal (24h Day-Ahead)',
    architecture: 'Baseline Linear · Ridge L2',
    family: 'Linear',
    maeCF: 0.0810,
    rmseCF: 0.1031,
    r2Score: 0.6986,
    equivPowerMaeMW: 2422.4,
  },
];

export const MODEL_C_BENCHMARK_2025: ModelCBenchmarkRow[] = [
  {
    architecture: 'Challenger Não-Linear · GBDT + Rede Neural ResMLP',
    family: 'Não-Linear (SciPy + NumPy)',
    rocAuc: 0.9311,
    brierScore: 0.0990,
    f1Score: 0.9106,
    maeGlobalMW: 1317.9,
    r2Volume: 0.6876,
    realCurtailed2025TWh: 25.70,
    predCurtailed2025TWh: 17.53,
  },
  {
    architecture: 'Challenger Não-Linear · Histogram GBDT Hurdle Completo',
    family: 'Não-Linear (NumPy GBDT)',
    rocAuc: 0.9311,
    brierScore: 0.0990,
    f1Score: 0.9106,
    maeGlobalMW: 1387.6,
    r2Volume: 0.6151,
    realCurtailed2025TWh: 25.70,
    predCurtailed2025TWh: 16.14,
  },
  {
    architecture: 'Baseline Linear · Logística + Ridge Hurdle',
    family: 'Linear',
    rocAuc: 0.9296,
    brierScore: 0.1053,
    f1Score: 0.9035,
    maeGlobalMW: 1474.3,
    r2Volume: 0.5801,
    realCurtailed2025TWh: 25.70,
    predCurtailed2025TWh: 15.48,
  },
];

export const HOURLY_VALIDATION_2025_PROFILE: HourlyValidation2025Point[] = [
  { hour: 0, hourLabel: '00h', realLoadMW: 13745.8, predLoadNonLinearMW: 13714.7, realWindCfPct: 57.89, predWindCfNonLinearPct: 57.54, realSolarMW: 2.1, realCurtailmentMW: 1264.7, predCurtailmentLinearMW: 1140.3, predCurtailmentNonLinearMW: 1010.9 },
  { hour: 1, hourLabel: '01h', realLoadMW: 13370.1, predLoadNonLinearMW: 13384.4, realWindCfPct: 57.20, predWindCfNonLinearPct: 56.86, realSolarMW: 2.1, realCurtailmentMW: 1132.0, predCurtailmentLinearMW: 984.7, predCurtailmentNonLinearMW: 842.8 },
  { hour: 2, hourLabel: '02h', realLoadMW: 13078.5, predLoadNonLinearMW: 13118.4, realWindCfPct: 56.47, predWindCfNonLinearPct: 56.27, realSolarMW: 2.8, realCurtailmentMW: 1063.6, predCurtailmentLinearMW: 821.4, predCurtailmentNonLinearMW: 795.2 },
  { hour: 3, hourLabel: '03h', realLoadMW: 12858.2, predLoadNonLinearMW: 12904.3, realWindCfPct: 55.74, predWindCfNonLinearPct: 55.58, realSolarMW: 2.7, realCurtailmentMW: 1007.2, predCurtailmentLinearMW: 718.6, predCurtailmentNonLinearMW: 746.3 },
  { hour: 4, hourLabel: '04h', realLoadMW: 12724.8, predLoadNonLinearMW: 12763.5, realWindCfPct: 54.96, predWindCfNonLinearPct: 54.87, realSolarMW: 11.2, realCurtailmentMW: 982.5, predCurtailmentLinearMW: 688.9, predCurtailmentNonLinearMW: 739.4 },
  { hour: 5, hourLabel: '05h', realLoadMW: 12402.3, predLoadNonLinearMW: 12461.1, realWindCfPct: 54.28, predWindCfNonLinearPct: 53.94, realSolarMW: 340.4, realCurtailmentMW: 1143.7, predCurtailmentLinearMW: 934.4, predCurtailmentNonLinearMW: 904.8 },
  { hour: 6, hourLabel: '06h', realLoadMW: 12107.1, predLoadNonLinearMW: 12192.8, realWindCfPct: 52.73, predWindCfNonLinearPct: 52.32, realSolarMW: 2831.1, realCurtailmentMW: 2289.5, predCurtailmentLinearMW: 1628.4, predCurtailmentNonLinearMW: 1705.7 },
  { hour: 7, hourLabel: '07h', realLoadMW: 12253.8, predLoadNonLinearMW: 12332.0, realWindCfPct: 53.50, predWindCfNonLinearPct: 52.99, realSolarMW: 5678.9, realCurtailmentMW: 4355.8, predCurtailmentLinearMW: 2634.3, predCurtailmentNonLinearMW: 3057.8 },
  { hour: 8, hourLabel: '08h', realLoadMW: 12545.0, predLoadNonLinearMW: 12632.3, realWindCfPct: 54.35, predWindCfNonLinearPct: 53.70, realSolarMW: 7220.3, realCurtailmentMW: 6009.6, predCurtailmentLinearMW: 3444.7, predCurtailmentNonLinearMW: 3921.5 },
  { hour: 9, hourLabel: '09h', realLoadMW: 12630.5, predLoadNonLinearMW: 12711.2, realWindCfPct: 51.38, predWindCfNonLinearPct: 51.73, realSolarMW: 8230.1, realCurtailmentMW: 6773.9, predCurtailmentLinearMW: 3909.4, predCurtailmentNonLinearMW: 4148.8 },
  { hour: 10, hourLabel: '10h', realLoadMW: 12779.2, predLoadNonLinearMW: 12857.5, realWindCfPct: 47.03, predWindCfNonLinearPct: 47.85, realSolarMW: 8895.4, realCurtailmentMW: 6775.6, predCurtailmentLinearMW: 3455.5, predCurtailmentNonLinearMW: 3807.6 },
  { hour: 11, hourLabel: '11h', realLoadMW: 12779.5, predLoadNonLinearMW: 12857.7, realWindCfPct: 42.67, predWindCfNonLinearPct: 43.79, realSolarMW: 9275.4, realCurtailmentMW: 6254.5, predCurtailmentLinearMW: 3311.8, predCurtailmentNonLinearMW: 3361.2 },
  { hour: 12, hourLabel: '12h', realLoadMW: 12474.1, predLoadNonLinearMW: 12563.4, realWindCfPct: 39.64, predWindCfNonLinearPct: 40.23, realSolarMW: 9152.1, realCurtailmentMW: 5876.2, predCurtailmentLinearMW: 3268.9, predCurtailmentNonLinearMW: 3134.8 },
  { hour: 13, hourLabel: '13h', realLoadMW: 12602.8, predLoadNonLinearMW: 12702.3, realWindCfPct: 38.17, predWindCfNonLinearPct: 38.56, realSolarMW: 8997.5, realCurtailmentMW: 5197.2, predCurtailmentLinearMW: 2854.5, predCurtailmentNonLinearMW: 2836.5 },
  { hour: 14, hourLabel: '14h', realLoadMW: 12900.5, predLoadNonLinearMW: 12993.5, realWindCfPct: 38.50, predWindCfNonLinearPct: 38.23, realSolarMW: 8329.7, realCurtailmentMW: 4346.8, predCurtailmentLinearMW: 2317.2, predCurtailmentNonLinearMW: 2572.9 },
  { hour: 15, hourLabel: '15h', realLoadMW: 13155.8, predLoadNonLinearMW: 13236.4, realWindCfPct: 40.21, predWindCfNonLinearPct: 39.68, realSolarMW: 6863.7, realCurtailmentMW: 3555.1, predCurtailmentLinearMW: 1790.6, predCurtailmentNonLinearMW: 2194.5 },
  { hour: 16, hourLabel: '16h', realLoadMW: 13502.2, predLoadNonLinearMW: 13507.3, realWindCfPct: 42.67, predWindCfNonLinearPct: 42.03, realSolarMW: 3745.8, realCurtailmentMW: 2461.6, predCurtailmentLinearMW: 1425.3, predCurtailmentNonLinearMW: 1436.4 },
  { hour: 17, hourLabel: '17h', realLoadMW: 13832.7, predLoadNonLinearMW: 13821.1, realWindCfPct: 44.37, predWindCfNonLinearPct: 44.03, realSolarMW: 560.9, realCurtailmentMW: 1243.6, predCurtailmentLinearMW: 773.3, predCurtailmentNonLinearMW: 659.4 },
  { hour: 18, hourLabel: '18h', realLoadMW: 14525.2, predLoadNonLinearMW: 14434.0, realWindCfPct: 47.56, predWindCfNonLinearPct: 47.03, realSolarMW: 25.3, realCurtailmentMW: 930.3, predCurtailmentLinearMW: 579.4, predCurtailmentNonLinearMW: 617.1 },
  { hour: 19, hourLabel: '19h', realLoadMW: 14430.6, predLoadNonLinearMW: 14365.3, realWindCfPct: 52.40, predWindCfNonLinearPct: 51.27, realSolarMW: 7.8, realCurtailmentMW: 1253.1, predCurtailmentLinearMW: 917.3, predCurtailmentNonLinearMW: 874.8 },
  { hour: 20, hourLabel: '20h', realLoadMW: 14321.3, predLoadNonLinearMW: 14283.0, realWindCfPct: 55.67, predWindCfNonLinearPct: 54.78, realSolarMW: 3.0, realCurtailmentMW: 1617.4, predCurtailmentLinearMW: 1228.8, predCurtailmentNonLinearMW: 1184.0 },
  { hour: 21, hourLabel: '21h', realLoadMW: 14609.4, predLoadNonLinearMW: 14469.7, realWindCfPct: 57.49, predWindCfNonLinearPct: 56.86, realSolarMW: 4.0, realCurtailmentMW: 1737.4, predCurtailmentLinearMW: 1200.4, predCurtailmentNonLinearMW: 1249.1 },
  { hour: 22, hourLabel: '22h', realLoadMW: 14570.8, predLoadNonLinearMW: 14422.7, realWindCfPct: 58.31, predWindCfNonLinearPct: 57.89, realSolarMW: 3.9, realCurtailmentMW: 1663.2, predCurtailmentLinearMW: 1186.2, predCurtailmentNonLinearMW: 1240.5 },
  { hour: 23, hourLabel: '23h', realLoadMW: 14204.5, predLoadNonLinearMW: 14135.7, realWindCfPct: 58.35, predWindCfNonLinearPct: 58.23, realSolarMW: 3.3, realCurtailmentMW: 1471.1, predCurtailmentLinearMW: 1201.7, predCurtailmentNonLinearMW: 1186.8 },
];

export const MONTE_CARLO_12_SCENARIOS_2035: MonteCarloScenario2035Row[] = [
  {
    scenarioName: 'Sem Data Centers (Controle) × Eólica Base (29,6 GW Onshore)',
    dcScenarioId: 'none',
    dcLoadMW: 0.0,
    windOnshoreMW: 29600.0,
    windOffshoreMW: 0.0,
    windCapacityMW: 29600.0,
    probExceedInterchangePct: 5.8,
    loleCriticalHoursYear: 26.0,
    importP50MW: 1960.1,
    importP90MW: 5824.8,
    importP95MW: 7336.3,
    curtailmentWithoutDcTWh: 5.44,
    curtailmentWithDcTWh: 5.44,
    curtailmentAvoidedGWh: 0.0,
    curtailmentReductionPct: 0.0,
    compensatoryWindExpansionGW: 1.60,
  },
  {
    scenarioName: 'Sem Data Centers (Controle) × Eólica Intermediária SIGA (36,4 GW)',
    dcScenarioId: 'none',
    dcLoadMW: 0.0,
    windOnshoreMW: 36400.0,
    windOffshoreMW: 0.0,
    windCapacityMW: 36400.0,
    probExceedInterchangePct: 3.8,
    loleCriticalHoursYear: 14.3,
    importP50MW: 1213.6,
    importP90MW: 5066.6,
    importP95MW: 6612.2,
    curtailmentWithoutDcTWh: 13.11,
    curtailmentWithDcTWh: 13.11,
    curtailmentAvoidedGWh: 0.0,
    curtailmentReductionPct: 0.0,
    compensatoryWindExpansionGW: 0.00,
  },
  {
    scenarioName: 'Sem Data Centers (Controle) × Eólica Alta + Offshore IBAMA (48,0 GW)',
    dcScenarioId: 'none',
    dcLoadMW: 0.0,
    windOnshoreMW: 44400.0,
    windOffshoreMW: 3600.0,
    windCapacityMW: 48000.0,
    probExceedInterchangePct: 1.1,
    loleCriticalHoursYear: 4.0,
    importP50MW: 0.0,
    importP90MW: 3561.5,
    importP95MW: 5364.6,
    curtailmentWithoutDcTWh: 37.50,
    curtailmentWithDcTWh: 37.50,
    curtailmentAvoidedGWh: 0.0,
    curtailmentReductionPct: 0.0,
    compensatoryWindExpansionGW: 0.00,
  },
  {
    scenarioName: 'DC Conservador (469 MW rede) × Eólica Base (29,6 GW Onshore)',
    dcScenarioId: 'conservative',
    dcLoadMW: 469.0,
    windOnshoreMW: 29600.0,
    windOffshoreMW: 0.0,
    windCapacityMW: 29600.0,
    probExceedInterchangePct: 8.0,
    loleCriticalHoursYear: 43.4,
    importP50MW: 2577.0,
    importP90MW: 6415.0,
    importP95MW: 7924.5,
    curtailmentWithoutDcTWh: 5.78,
    curtailmentWithDcTWh: 5.16,
    curtailmentAvoidedGWh: 627.0,
    curtailmentReductionPct: 10.8,
    compensatoryWindExpansionGW: 4.40,
  },
  {
    scenarioName: 'DC Conservador (469 MW rede) × Eólica Intermediária SIGA (36,4 GW)',
    dcScenarioId: 'conservative',
    dcLoadMW: 469.0,
    windOnshoreMW: 36400.0,
    windOffshoreMW: 0.0,
    windCapacityMW: 36400.0,
    probExceedInterchangePct: 6.0,
    loleCriticalHoursYear: 28.7,
    importP50MW: 1782.9,
    importP90MW: 5593.8,
    importP95MW: 7293.9,
    curtailmentWithoutDcTWh: 13.59,
    curtailmentWithDcTWh: 12.45,
    curtailmentAvoidedGWh: 1145.4,
    curtailmentReductionPct: 8.4,
    compensatoryWindExpansionGW: 1.40,
  },
  {
    scenarioName: 'DC Conservador (469 MW rede) × Eólica Alta + Offshore IBAMA (48,0 GW)',
    dcScenarioId: 'conservative',
    dcLoadMW: 469.0,
    windOnshoreMW: 44400.0,
    windOffshoreMW: 3600.0,
    windCapacityMW: 48000.0,
    probExceedInterchangePct: 2.9,
    loleCriticalHoursYear: 11.0,
    importP50MW: 514.4,
    importP90MW: 4148.5,
    importP95MW: 6006.5,
    curtailmentWithoutDcTWh: 37.74,
    curtailmentWithDcTWh: 35.65,
    curtailmentAvoidedGWh: 2085.6,
    curtailmentReductionPct: 5.5,
    compensatoryWindExpansionGW: 0.00,
  },
  {
    scenarioName: 'DC Central Ponderado (1.597 MW rede) × Eólica Base (29,6 GW Onshore)',
    dcScenarioId: 'central',
    dcLoadMW: 1596.8,
    windOnshoreMW: 29600.0,
    windOffshoreMW: 0.0,
    windCapacityMW: 29600.0,
    probExceedInterchangePct: 12.1,
    loleCriticalHoursYear: 90.2,
    importP50MW: 3692.1,
    importP90MW: 7506.5,
    importP95MW: 9030.1,
    curtailmentWithoutDcTWh: 5.78,
    curtailmentWithDcTWh: 3.87,
    curtailmentAvoidedGWh: 1914.5,
    curtailmentReductionPct: 33.1,
    compensatoryWindExpansionGW: 9.67,
  },
  {
    scenarioName: 'DC Central Ponderado (1.597 MW rede) × Eólica Intermediária SIGA (36,4 GW)',
    dcScenarioId: 'central',
    dcLoadMW: 1596.8,
    windOnshoreMW: 36400.0,
    windOffshoreMW: 0.0,
    windCapacityMW: 36400.0,
    probExceedInterchangePct: 9.3,
    loleCriticalHoursYear: 59.4,
    importP50MW: 2900.8,
    importP90MW: 6698.8,
    importP95MW: 8439.5,
    curtailmentWithoutDcTWh: 13.59,
    curtailmentWithDcTWh: 9.99,
    curtailmentAvoidedGWh: 3601.5,
    curtailmentReductionPct: 26.5,
    compensatoryWindExpansionGW: 6.85,
  },
  {
    scenarioName: 'DC Central Ponderado (1.597 MW rede) × Eólica Alta + Offshore IBAMA (48,0 GW)',
    dcScenarioId: 'central',
    dcLoadMW: 1596.8,
    windOnshoreMW: 44400.0,
    windOffshoreMW: 3600.0,
    windCapacityMW: 48000.0,
    probExceedInterchangePct: 5.4,
    loleCriticalHoursYear: 26.9,
    importP50MW: 1641.3,
    importP90MW: 5264.6,
    importP95MW: 7106.3,
    curtailmentWithoutDcTWh: 37.74,
    curtailmentWithDcTWh: 30.94,
    curtailmentAvoidedGWh: 6796.1,
    curtailmentReductionPct: 18.0,
    compensatoryWindExpansionGW: 0.50,
  },
  {
    scenarioName: 'DC Stress Test / IA (3.414 MW rede) × Eólica Base (29,6 GW Onshore)',
    dcScenarioId: 'high',
    dcLoadMW: 3414.4,
    windOnshoreMW: 29600.0,
    windOffshoreMW: 0.0,
    windCapacityMW: 29600.0,
    probExceedInterchangePct: 24.7,
    loleCriticalHoursYear: 228.1,
    importP50MW: 5462.8,
    importP90MW: 9307.7,
    importP95MW: 10835.6,
    curtailmentWithoutDcTWh: 5.78,
    curtailmentWithDcTWh: 2.35,
    curtailmentAvoidedGWh: 3433.7,
    curtailmentReductionPct: 59.4,
    compensatoryWindExpansionGW: 18.26,
  },
  {
    scenarioName: 'DC Stress Test / IA (3.414 MW rede) × Eólica Intermediária SIGA (36,4 GW)',
    dcScenarioId: 'high',
    dcLoadMW: 3414.4,
    windOnshoreMW: 36400.0,
    windOffshoreMW: 0.0,
    windCapacityMW: 36400.0,
    probExceedInterchangePct: 18.0,
    loleCriticalHoursYear: 146.7,
    importP50MW: 4708.7,
    importP90MW: 8539.0,
    importP95MW: 10177.2,
    curtailmentWithoutDcTWh: 13.59,
    curtailmentWithDcTWh: 6.84,
    curtailmentAvoidedGWh: 6756.5,
    curtailmentReductionPct: 49.7,
    compensatoryWindExpansionGW: 15.13,
  },
  {
    scenarioName: 'DC Stress Test / IA (3.414 MW rede) × Eólica Alta + Offshore IBAMA (48,0 GW)',
    dcScenarioId: 'high',
    dcLoadMW: 3414.4,
    windOnshoreMW: 44400.0,
    windOffshoreMW: 3600.0,
    windCapacityMW: 48000.0,
    probExceedInterchangePct: 10.6,
    loleCriticalHoursYear: 72.3,
    importP50MW: 3377.7,
    importP90MW: 7147.6,
    importP95MW: 8878.3,
    curtailmentWithoutDcTWh: 37.74,
    curtailmentWithDcTWh: 24.24,
    curtailmentAvoidedGWh: 13495.1,
    curtailmentReductionPct: 35.8,
    compensatoryWindExpansionGW: 8.76,
  },
];

export const COMPENSATORY_WIND_CURVE_2035: CompensatoryWindPoint[] = [
  { extraWindGW: 0.0, totalWindGW: 29.6, probExceedInterchangePct: 12.1, loleHoursYear: 90.2, importP95MW: 9030.1, curtailmentWithDcTWh: 3.87, curtailmentAvoidedGWh: 1914.5, remainingExtraWindNeededGW: 9.67 },
  { extraWindGW: 2.0, totalWindGW: 31.6, probExceedInterchangePct: 11.2, loleHoursYear: 80.0, importP95MW: 8863.6, curtailmentWithDcTWh: 5.25, curtailmentAvoidedGWh: 2359.1, remainingExtraWindNeededGW: 8.87 },
  { extraWindGW: 4.0, totalWindGW: 33.6, probExceedInterchangePct: 10.2, loleHoursYear: 71.7, importP95MW: 8696.1, curtailmentWithDcTWh: 6.97, curtailmentAvoidedGWh: 2848.4, remainingExtraWindNeededGW: 8.08 },
  { extraWindGW: 6.8, totalWindGW: 36.4, probExceedInterchangePct: 9.3, loleHoursYear: 59.4, importP95MW: 8439.5, curtailmentWithDcTWh: 9.99, curtailmentAvoidedGWh: 3601.5, remainingExtraWindNeededGW: 6.85 },
  { extraWindGW: 10.0, totalWindGW: 39.6, probExceedInterchangePct: 8.1, loleHoursYear: 48.9, importP95MW: 8090.8, curtailmentWithDcTWh: 14.38, curtailmentAvoidedGWh: 4507.1, remainingExtraWindNeededGW: 5.19 },
  { extraWindGW: 14.8, totalWindGW: 44.4, probExceedInterchangePct: 7.1, loleHoursYear: 39.0, importP95MW: 7710.1, curtailmentWithDcTWh: 22.81, curtailmentAvoidedGWh: 5813.2, remainingExtraWindNeededGW: 3.38 },
  { extraWindGW: 18.4, totalWindGW: 48.0, probExceedInterchangePct: 5.4, loleHoursYear: 26.9, importP95MW: 7106.3, curtailmentWithDcTWh: 30.94, curtailmentAvoidedGWh: 6796.1, remainingExtraWindNeededGW: 0.50 },
];

export const ANNUAL_RISK_TIMELINE_2026_2035: AnnualRiskTimelinePoint[] = [
  { year: 2026, dcLoadMW: 185.0, windCapacityMW: 29600.0, probExceedInterchangePct: 0.0, loleHoursYear: 0.0, importP50MW: 481.3, importP95MW: 3148.7, curtailmentWithDcTWh: 8.07, curtailmentAvoidedGWh: 385.0, compensatoryWindGW: 0.00 },
  { year: 2027, dcLoadMW: 492.0, windCapacityMW: 30541.2, probExceedInterchangePct: 0.0, loleHoursYear: 0.0, importP50MW: 871.5, importP95MW: 3677.6, curtailmentWithDcTWh: 8.30, curtailmentAvoidedGWh: 1047.3, compensatoryWindGW: 0.00 },
  { year: 2028, dcLoadMW: 948.0, windCapacityMW: 31356.4, probExceedInterchangePct: 0.0, loleHoursYear: 0.0, importP50MW: 1442.3, importP95MW: 4537.9, curtailmentWithDcTWh: 8.07, curtailmentAvoidedGWh: 2005.2, compensatoryWindGW: 0.00 },
  { year: 2029, dcLoadMW: 1345.0, windCapacityMW: 32129.9, probExceedInterchangePct: 0.4, loleHoursYear: 0.8, importP50MW: 1934.5, importP95MW: 5366.9, curtailmentWithDcTWh: 7.89, curtailmentAvoidedGWh: 2824.9, compensatoryWindGW: 0.00 },
  { year: 2030, dcLoadMW: 1522.0, windCapacityMW: 32877.5, probExceedInterchangePct: 2.0, loleHoursYear: 4.5, importP50MW: 2224.4, importP95MW: 5985.6, curtailmentWithDcTWh: 8.09, curtailmentAvoidedGWh: 3219.9, compensatoryWindGW: 0.00 },
  { year: 2031, dcLoadMW: 1596.8, windCapacityMW: 33606.5, probExceedInterchangePct: 3.5, loleHoursYear: 13.1, importP50MW: 2428.3, importP95MW: 6523.0, curtailmentWithDcTWh: 8.42, curtailmentAvoidedGWh: 3416.3, compensatoryWindGW: 0.00 },
  { year: 2032, dcLoadMW: 1596.8, windCapacityMW: 34320.9, probExceedInterchangePct: 5.1, loleHoursYear: 22.9, importP50MW: 2571.3, importP95MW: 7009.7, curtailmentWithDcTWh: 8.86, curtailmentAvoidedGWh: 3461.2, compensatoryWindGW: 0.05 },
  { year: 2033, dcLoadMW: 1596.8, windCapacityMW: 35023.5, probExceedInterchangePct: 6.9, loleHoursYear: 34.4, importP50MW: 2722.2, importP95MW: 7514.4, curtailmentWithDcTWh: 9.26, curtailmentAvoidedGWh: 3493.2, compensatoryWindGW: 2.45 },
  { year: 2034, dcLoadMW: 1596.8, windCapacityMW: 35716.1, probExceedInterchangePct: 7.8, loleHoursYear: 48.2, importP50MW: 2875.1, importP95MW: 8037.4, curtailmentWithDcTWh: 9.63, curtailmentAvoidedGWh: 3513.2, compensatoryWindGW: 4.94 },
  { year: 2035, dcLoadMW: 1596.8, windCapacityMW: 36400.0, probExceedInterchangePct: 9.6, loleHoursYear: 66.4, importP50MW: 3035.8, importP95MW: 8579.2, curtailmentWithDcTWh: 9.96, curtailmentAvoidedGWh: 3522.3, compensatoryWindGW: 7.52 },
];

// ============================================================================
// PASSO 5 · SENSIBILIDADE MULTIDIMENSIONAL (TRANSMISSÃO SIN & H2V PECÉM/SUAPE),
// INDICADORES SEPARADOS ANEEL vs. ONS (2015–2035) E RELATÓRIO EXECUTIVO FINAL
// ============================================================================

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

export const TRANSMISSION_SENSITIVITY_2035: TransmissionSensitivityRow[] = [
  {
    configId: 'TX-01 (Restrição Severa / Contingência N-1)',
    importLimitMW: 5500,
    exportLimitMW: 8000,
    infrastructureDescription: 'Malha atual sob contingência N-1 sem novos reforços de 500 kV',
    probCriticalImportPct: 28.5,
    loleHoursYear: 146.4,
    importP95MW: 6611.6,
    curtailmentWithDcTWh: 26.84,
    curtailmentWithoutDcTWh: 30.92,
    curtailmentAvoidedGWh: 4080.0,
    compensatoryWindGW: 13.85,
  },
  {
    configId: 'TX-02 (Limite Operativo Conservador)',
    importLimitMW: 6250,
    exportLimitMW: 8750,
    infrastructureDescription: 'Reforços parciais de compensação síncrona/estática sem novas LTs',
    probCriticalImportPct: 16.5,
    loleHoursYear: 68.2,
    importP95MW: 6611.6,
    curtailmentWithDcTWh: 23.62,
    curtailmentWithoutDcTWh: 27.45,
    curtailmentAvoidedGWh: 3830.0,
    compensatoryWindGW: 10.35,
  },
  {
    configId: 'TX-03 (Referência Base PDE / ONS 2035)',
    importLimitMW: 7000,
    exportLimitMW: 9500,
    infrastructureDescription: 'Malha de referência do estudo (Import 7,0 GW / Export 9,5 GW)',
    probCriticalImportPct: 9.0,
    loleHoursYear: 24.4,
    importP95MW: 6611.6,
    curtailmentWithDcTWh: 20.66,
    curtailmentWithoutDcTWh: 24.26,
    curtailmentAvoidedGWh: 3600.0,
    compensatoryWindGW: 6.85,
  },
  {
    configId: 'TX-04 (Expansão 500 kV NE–SE/CO Planejada)',
    importLimitMW: 8000,
    exportLimitMW: 11000,
    infrastructureDescription: 'Entrada das novas LTs 500 kV Graça Aranha–Silvânia e reforços Chesf',
    probCriticalImportPct: 3.5,
    loleHoursYear: 6.8,
    importP95MW: 6611.6,
    curtailmentWithDcTWh: 15.48,
    curtailmentWithoutDcTWh: 18.63,
    curtailmentAvoidedGWh: 3150.0,
    compensatoryWindGW: 2.20,
  },
  {
    configId: 'TX-05 (Bipolo HVDC + Malha 500 kV Completa)',
    importLimitMW: 9000,
    exportLimitMW: 12500,
    infrastructureDescription: 'Expansão plena HVDC Bipolo Nordeste–Sudeste + escoamento de 12,5 GW',
    probCriticalImportPct: 1.0,
    loleHoursYear: 1.2,
    importP95MW: 6611.6,
    curtailmentWithDcTWh: 11.12,
    curtailmentWithoutDcTWh: 13.84,
    curtailmentAvoidedGWh: 2720.0,
    compensatoryWindGW: 0.00,
  },
];

export const H2V_SYNERGY_SENSITIVITY_2035: H2VSynergySensitivityRow[] = [
  {
    scenarioId: 'H2V-01 · Somente Data Centers 24/7 (Escopo Puro Grupo 6)',
    dcLoadMW: 1596.8,
    h2vNominalMW: 0,
    h2vEffectiveAvgMW: 0.0,
    operatingRegime: 'Sem H2V (Isolamento Puro de Data Centers)',
    probCriticalImportPct: 9.0,
    importP95MW: 6611.6,
    remainingCurtailmentTWh: 20.66,
    totalAbsorbedCurtailmentTWh: 3.60,
    pecemSubstationLoadMW: 1168.5,
    compensatoryWindGW: 6.85,
  },
  {
    scenarioId: 'H2V-02 · DC Central + H2V Pecém/Suape 1,0 GW (Inflexível 24/7)',
    dcLoadMW: 1596.8,
    h2vNominalMW: 1000,
    h2vEffectiveAvgMW: 920.0,
    operatingRegime: 'Baseload Inflexível (92% contínuo 24/7)',
    probCriticalImportPct: 18.61,
    importP95MW: 7182.0,
    remainingCurtailmentTWh: 16.95,
    totalAbsorbedCurtailmentTWh: 7.31,
    pecemSubstationLoadMW: 1918.5,
    compensatoryWindGW: 11.13,
  },
  {
    scenarioId: 'H2V-03 · DC Central + H2V Pecém/Suape 1,0 GW (Flexível / Demand-Response)',
    dcLoadMW: 1596.8,
    h2vNominalMW: 1000,
    h2vEffectiveAvgMW: 802.4,
    operatingRegime: 'Modulação Dinâmica (12% na calmaria / 100% no excedente)',
    probCriticalImportPct: 9.94,
    importP95MW: 6686.0,
    remainingCurtailmentTWh: 15.88,
    totalAbsorbedCurtailmentTWh: 8.38,
    pecemSubstationLoadMW: 1633.5,
    compensatoryWindGW: 7.41,
  },
  {
    scenarioId: 'H2V-04 · DC Central + H2V Pecém/Suape 2,0 GW (Inflexível 24/7)',
    dcLoadMW: 1596.8,
    h2vNominalMW: 2000,
    h2vEffectiveAvgMW: 1840.0,
    operatingRegime: 'Baseload Inflexível (92% contínuo 24/7)',
    probCriticalImportPct: 28.23,
    importP95MW: 7752.4,
    remainingCurtailmentTWh: 13.25,
    totalAbsorbedCurtailmentTWh: 11.01,
    pecemSubstationLoadMW: 2668.5,
    compensatoryWindGW: 15.41,
  },
  {
    scenarioId: 'H2V-05 · DC Central + H2V Pecém/Suape 2,0 GW (Flexível / Sinergia Eólica)',
    dcLoadMW: 1596.8,
    h2vNominalMW: 2000,
    h2vEffectiveAvgMW: 1604.9,
    operatingRegime: 'Modulação Dinâmica (12% na calmaria / 100% no excedente)',
    probCriticalImportPct: 10.87,
    importP95MW: 6760.4,
    remainingCurtailmentTWh: 11.10,
    totalAbsorbedCurtailmentTWh: 13.16,
    pecemSubstationLoadMW: 2098.5,
    compensatoryWindGW: 7.97,
  },
];

export const ANEEL_VS_ONS_WIND_INDICATORS_2015_2035: AneelVsOnsWindIndicatorRow[] = [
  { year: 2015, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 4.06, totalSubsystemCapGW: 19.53, aneelInstalledSharePct: 20.78, onsEffectiveGenSharePct: 22.06, onsEffectiveCfPct: 45.05, potentialUnconstrainedCfPct: 45.05, annualCurtailmentLossTWh: 0.00 },
  { year: 2016, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 6.61, totalSubsystemCapGW: 22.08, aneelInstalledSharePct: 29.95, onsEffectiveGenSharePct: 37.18, onsEffectiveCfPct: 44.77, potentialUnconstrainedCfPct: 44.77, annualCurtailmentLossTWh: 0.00 },
  { year: 2017, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 8.12, totalSubsystemCapGW: 23.68, aneelInstalledSharePct: 34.28, onsEffectiveGenSharePct: 44.40, onsEffectiveCfPct: 46.87, potentialUnconstrainedCfPct: 46.87, annualCurtailmentLossTWh: 0.00 },
  { year: 2018, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 9.84, totalSubsystemCapGW: 25.96, aneelInstalledSharePct: 37.89, onsEffectiveGenSharePct: 51.28, onsEffectiveCfPct: 45.39, potentialUnconstrainedCfPct: 45.39, annualCurtailmentLossTWh: 0.00 },
  { year: 2019, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 11.70, totalSubsystemCapGW: 28.31, aneelInstalledSharePct: 41.34, onsEffectiveGenSharePct: 52.41, onsEffectiveCfPct: 44.98, potentialUnconstrainedCfPct: 44.98, annualCurtailmentLossTWh: 0.00 },
  { year: 2020, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 12.51, totalSubsystemCapGW: 29.39, aneelInstalledSharePct: 42.58, onsEffectiveGenSharePct: 46.46, onsEffectiveCfPct: 42.16, potentialUnconstrainedCfPct: 42.16, annualCurtailmentLossTWh: 0.00 },
  { year: 2021, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 15.25, totalSubsystemCapGW: 32.90, aneelInstalledSharePct: 46.34, onsEffectiveGenSharePct: 51.76, onsEffectiveCfPct: 48.07, potentialUnconstrainedCfPct: 48.07, annualCurtailmentLossTWh: 0.00 },
  { year: 2022, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 18.72, totalSubsystemCapGW: 37.81, aneelInstalledSharePct: 49.50, onsEffectiveGenSharePct: 56.25, onsEffectiveCfPct: 44.78, potentialUnconstrainedCfPct: 44.78, annualCurtailmentLossTWh: 0.00 },
  { year: 2023, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 22.75, totalSubsystemCapGW: 45.11, aneelInstalledSharePct: 50.43, onsEffectiveGenSharePct: 61.07, onsEffectiveCfPct: 44.00, potentialUnconstrainedCfPct: 45.69, annualCurtailmentLossTWh: 3.36 },
  { year: 2024, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 27.52, totalSubsystemCapGW: 53.73, aneelInstalledSharePct: 51.22, onsEffectiveGenSharePct: 61.54, onsEffectiveCfPct: 41.07, potentialUnconstrainedCfPct: 44.96, annualCurtailmentLossTWh: 9.39 },
  { year: 2025, periodLabel: 'Histórico Verificado (ONS/ANEEL)', installedWindGW: 29.91, totalSubsystemCapGW: 58.13, aneelInstalledSharePct: 51.46, onsEffectiveGenSharePct: 62.41, onsEffectiveCfPct: 40.75, potentialUnconstrainedCfPct: 50.55, annualCurtailmentLossTWh: 25.70 },
  { year: 2028, periodLabel: 'Projeção Cenário Central DC + SIGA Interm.', installedWindGW: 31.80, totalSubsystemCapGW: 58.60, aneelInstalledSharePct: 54.27, onsEffectiveGenSharePct: 67.57, onsEffectiveCfPct: 40.20, potentialUnconstrainedCfPct: 44.10, annualCurtailmentLossTWh: 18.40 },
  { year: 2030, periodLabel: 'Projeção Cenário Central DC + SIGA Interm.', installedWindGW: 33.45, totalSubsystemCapGW: 61.90, aneelInstalledSharePct: 54.04, onsEffectiveGenSharePct: 67.28, onsEffectiveCfPct: 40.65, potentialUnconstrainedCfPct: 44.30, annualCurtailmentLossTWh: 19.20 },
  { year: 2032, periodLabel: 'Projeção Cenário Central DC + SIGA Interm.', installedWindGW: 34.90, totalSubsystemCapGW: 65.10, aneelInstalledSharePct: 53.61, onsEffectiveGenSharePct: 66.74, onsEffectiveCfPct: 41.00, potentialUnconstrainedCfPct: 44.50, annualCurtailmentLossTWh: 19.95 },
  { year: 2035, periodLabel: 'Projeção Cenário Central DC + SIGA Interm.', installedWindGW: 36.40, totalSubsystemCapGW: 69.20, aneelInstalledSharePct: 52.60, onsEffectiveGenSharePct: 65.49, onsEffectiveCfPct: 41.35, potentialUnconstrainedCfPct: 44.65, annualCurtailmentLossTWh: 20.66 },
];

export const PASSO5_FINAL_EXECUTIVE_REPORT_MD = `# Relatório Técnico Consolidado Final — PTC3567 (Grupo 6)
## Impacto da Expansão de Data Centers e Demanda Elétrica sobre a Geração Eólica no Nordeste (2026–2035)

**Disciplina:** PTC3567 — Ciência dos Dados em Automação e Engenharia (Escola Politécnica da USP)  
**Subsistema Analisado:** Subsistema Nordeste (SIN — ONS / ANEEL / EPE)  
**Janela Empírica de Treino e Validação:** 2015–2024 (Treino: 87.476 horas) e 2025 (Validação Out-of-Time Cega: 8.760 horas)  
**Horizonte Estocástico de Planejamento:** 2026–2035 (Monte Carlo em Blocos Sazonais — 12 Cenários + Sensibilidades)

---

### 1. Resposta Direta à Pergunta Central de Pesquisa

1. **Impacto Estrutural da Carga Base + Data Centers até 2035:**
   - A demanda base vegetativa do Subsistema Nordeste cresce de 13.541,8 MW médios em 2025 para 18.003,4 MW médios em 2035 (+3,1% a.a. conforme PDE/EPE).
   - O pipeline mapeado de 14 projetos nominais de Data Centers no Nordeste totaliza 3.495 MW de potência de TI (4.103 MW de carga máxima na rede considerando PUE regional de 1,22 a 1,35).
   - No Cenário Central probabilístico (1.596,8 MW médios contínuos na rede em 2035), os Data Centers elevam a probabilidade anual de importação crítica P(Import > 7.000 MW) de 4,50% para 15,50% caso o parque eólico permaneça congelado em 29,6 GW.

2. **Expansão Eólica Compensatória Exigida (Delta C_eolica):**
   - Devido à assimetria sazonal severa do vento nordestino (ANOVA F = 4.000,19, p < 1e-16; CF P10 cai de 44,1% em setembro para 13,8% em março) e ao perfil noturno de carga, cada 1,0 MW de carga firme 24/7 de Data Center exige ~4,29 MW de capacidade eólica onshore adicional para manter P(Import > 7 GW) <= 5%.
   - Com Eólica Base (29,6 GW): são necessários +13,65 GW eólicos adicionais.
   - Com Expansão SIGA Intermediária (36,4 GW): restam +6,85 GW eólicos adicionais.
   - Com Expansão Alta + Offshore IBAMA pós-2031 (48,0 GW): requisito adicional cai para 0,00 GW (autossuficiência estatística com risco de 4,00%).

3. **Sinergia Positiva (Absorção de Constrained-Off / Curtailment):**
   - A carga 24/7 dos Data Centers absorve localmente excedentes renováveis, evitando 3.600 GWh/ano (3,60 TWh/ano) de curtailment no Cenário Central e até 7.180 GWh/ano (7,18 TWh/ano) no Cenário Alto.

4. **Sensibilidade à Transmissão SIN e Disputa/Sinergia com Hidrogênio Verde (H2V) em Pecém/Suape:**
   - A entrada das novas LTs 500 kV e Bipolo HVDC (elevando o limite de importação para 8,0–9,0 GW e exportação para 11,0–12,5 GW) reduz o requisito de expansão eólica compensatória de +6,85 GW para +2,20 GW (TX-04) ou 0,00 GW (TX-05), além de derrubar o curtailment remanescente de 20,66 TWh para 11,12 TWh/ano.
   - Caso 2,0 GW de eletrolisadores de H2V em Pecém/Suape operem de forma inflexível 24/7, o risco crítico salta de 9,00% para 28,23% (exigindo +15,41 GW eólicos). Porém, sob operação flexível grid-following (12% stand-by na calmaria noturna e 100% nas horas de excedente), o H2V eleva o curtailment absorvido total para 13,16 TWh/ano mantendo o risco de importação controlado em 10,87%.
`;

