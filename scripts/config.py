"""
Módulo de Configuração Central e Parâmetros do Projeto
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6
Impacto da expansão de data centers no balanço elétrico do Nordeste

Fonte única (Single Source of Truth) de parâmetros físicos, janelas temporais,
especificações de cenários, hiperparâmetros e limiares operacionais/UI.
"""

import csv
from pathlib import Path
from typing import Any, Dict, List, Optional

# Diretórios base do projeto
ROOT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT_DIR / "scripts"
DATA_DIR = ROOT_DIR / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
SCENARIOS_DATA_DIR = DATA_DIR / "scenarios"
REPORTS_DIR = ROOT_DIR / "reports"
PUBLIC_DATA_DIR = ROOT_DIR / "public" / "data"
HOURLY_BASELINE_JSON_URL = "/data/hourly-baseline-8760.json"
HOURLY_BASELINE_JSON_PATH = PUBLIC_DATA_DIR / "hourly-baseline-8760.json"
HOURLY_BASELINE_CSV_FILENAME = "serie_base_horaria_8760h_ons.csv"
SIMULATOR_GRID_CSV_FILENAME = "grade_simulador_monte_carlo_2025_2035.csv"

# Garantir existência das pastas de trabalho
for _dir in [DATA_DIR, RAW_DATA_DIR, PROCESSED_DATA_DIR, SCENARIOS_DATA_DIR, REPORTS_DIR, PUBLIC_DATA_DIR]:
    _dir.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# 1. Janelas Temporais e Resolução Anual (2015–2035)
# ---------------------------------------------------------------------------
SUBSYSTEM_ID = "NE"
BASELINE_YEAR = 2025
HISTORY_START_YEAR = 2015
HISTORY_END_YEAR = 2025
COFF_START_YEAR = 2023
COFF_REGIME_START_DATE = "2023-09-01"
MODERN_BLOCK_START_YEAR = 2022
TRAIN_CUTOFF_YEAR = 2025
FALLBACK_OPERATION_START_DATE = "2014-01-01"

PROJECTION_START_YEAR = 2025
RAMP_START_YEAR = 2026
TARGET_END_YEAR = 2035
OFFSHORE_START_YEAR = 2031
OFFSHORE_COMMERCIAL_START_YEAR = 2032

HOURS_PER_YEAR = 8760
DAYS_PER_YEAR = 365
HOURS_PER_DAY = 24
WEEKS_PER_YEAR = 52
QUARTERS_PER_YEAR = 4
BLOCK_SIZE_HOURS = 168

# ---------------------------------------------------------------------------
# 2. Parâmetros Elétricos, Físicos e Taxas Estruturais do Subsistema NE
# ---------------------------------------------------------------------------
BASE_WIND_ONSHORE_2026_MW = 29600.0   # Capacidade eólica onshore em operação comercial (SIGA/ONS)
BASE_HYDRO_THERMAL_MW = 4150.0        # Despacho médio hidrotérmico firme no NE (Chesf/São Francisco + biomassa)
INTERCHANGE_IMPORT_LIMIT_MW = 7000.0  # Limite crítico de importação líquida pelo SIN (linhas SE/CO -> NE e N -> NE)
INTERCHANGE_EXPORT_LIMIT_MW = 9500.0  # Limite máximo de exportação líquida (acima disso, há constrained-off forçado)

ANNUAL_LOAD_GROWTH_RATE = 0.031       # Taxa estrutural EPE/PDE 2035 (+3,1% a.a.)
ANNUAL_SOLAR_GROWTH_RATE = 0.045      # Taxa estrutural de expansão solar (+4,5% a.a. sobre 2025)
EXPORT_SOLAR_CURTAILMENT_COEF = 0.18  # Redução da folga de exportação durante rampa solar diurna
CURTAILMENT_FLAG_THRESHOLD_MW = 50.0  # Limiar operacional para caracterizar evento de corte (MWmed)
WIND_POTENTIAL_FALLBACK_CAPACITY_MW = 3300.0  # Fallback auditável caso registro histórico antigo não possua cap. inicial

CHESF_DISPATCH_PARAMS: Dict[str, Any] = {
    "floorMW": 2600.0,
    "netNeedSlope": 0.56,
    "ceilingMW": 9850.0,
    "wetMonths": [12, 1, 2, 3, 4, 5],
    "dryMonths": [8, 9, 10, 11],
    "wetFloorBonusMW": 650.0,
    "wetSlope": 0.62,
    "drySlope": 0.50,
    "thermalInflexWeight": 0.35,
    "hydroObsBlend": 0.25,
}

# Parâmetros macro para indicadores separados ANEEL (capacidade) vs. ONS (geração)
THERMAL_HYDRO_INSTALLED_CAP_MW = 15350.0
SOLAR_CAP_FROM_MEAN_FACTOR = 3.85
SOLAR_CAP_MIN_MW = 120.0
ANEEL_PROJECTED_YEARS: List[int] = [2028, 2030, 2032, 2035]

# ---------------------------------------------------------------------------
# 3. Cenários de Data Centers & Trajetórias Eólicas Onshore/Offshore
# ---------------------------------------------------------------------------
def compute_dc_scenarios_it_mw(csv_path: Optional[Path] = None) -> Dict[str, float]:
    """Deriva a potência acumulada de TI por cenário diretamente de data_centers_pipeline_ne.csv."""
    fallback: Dict[str, float] = {
        "none": 0.0,
        "conservative": 465.0,
        "central": 1595.0,
        "high": 3495.0,
    }
    target = csv_path or (RAW_DATA_DIR / "data_centers_pipeline_ne.csv")
    if not target.exists():
        return fallback
    sums = {"conservative": 0.0, "central": 0.0, "high": 0.0}
    try:
        with open(target, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                scen = str(row.get("cenario_enquadramento") or "").strip().lower()
                raw_it = str(row.get("potencia_it_mw") or "").strip().replace(",", ".")
                if not raw_it:
                    continue
                val = float(raw_it)
                if scen in sums:
                    sums[scen] += val
    except Exception:
        return fallback
    cons = round(sums["conservative"], 1)
    cent = round(cons + sums["central"], 1)
    high = round(cent + sums["high"], 1)
    if high <= 0.0:
        return fallback
    return {
        "none": 0.0,
        "conservative": cons,
        "central": cent,
        "high": high,
    }


DC_SCENARIOS_IT_MW: Dict[str, float] = compute_dc_scenarios_it_mw()

WIND_EXPANSION_ONSHORE_MW: Dict[str, float] = {
    "base": 0.0,             # Apenas usinas em operação
    "intermediate": 6800.0,  # Operação + Em Construção no SIGA
    "high": 14800.0,         # Operação + Construção + Parcela outorgada viável
}

OFFSHORE_SCENARIO_MW_POST_2031: Dict[str, float] = {
    "base": 800.0,
    "intermediate": 1800.0,
    "high": 3600.0,
}
WIND_RAMP_EXPONENT = 0.9

DEFAULT_PUE = 1.28
DEFAULT_UTILIZATION = 0.80

REFERENCE_SCENARIO_KEYS: Dict[str, str] = {
    "dcControl": "none",
    "dcConservative": "conservative",
    "dcCentral": "central",
    "dcHigh": "high",
    "windBase": "base",
    "windIntermediate": "intermediate",
    "windHigh": "high",
    "txReferenceCode": "TX-03",
    "txExpansionCode": "TX-04",
    "h2vBaselineCode": "H2V-01",
    "txReferenceIdPrefix": "TX-03",
    "h2vBaselineIdPrefix": "H2V-01",
    "preferredModelId": "resmlp",
    "preferredHorizonId": "1h",
    "preferredFamilyId": "nonlinear",
}

# ---------------------------------------------------------------------------
# 4. Motor Estocástico Monte Carlo & Sensibilidades (TX / H2V)
# ---------------------------------------------------------------------------
MONTE_CARLO_PARAMS: Dict[str, Any] = {
    "iterationsMain": 1000,
    "iterationsTimeline": 1000,
    "iterationsBottomUp": 1000,
    "seed": 42,
    "maxWorkers": 6,
    "loadNoiseStd": 0.032,
    "windCompletionMin": 0.86,
    "windCompletionMax": 1.02,
    "windRegimeMin": 0.76,
    "windRegimeMax": 1.24,
    "offshoreCfGain": 0.09,
    "cfCeiling": 0.98,
    "dcLoadJitterMin": 0.90,
    "dcLoadJitterMax": 1.08,
    "projectDelayMultiplier": 1.5,
    "projectUtilMin": 0.72,
    "projectUtilMax": 0.94,
    "firmWindCfBase": 0.21,
    "firmWindCfDryWindy": 0.34,
    "firmWindCfWetCalm": 0.14,
    "firmWindCfOffshoreBonus": 0.06,
    "firmWindCfOffshoreMarginal": 0.36,
    "offshoreMarginalBlendMult": 3.0,
    "extraWindGwGrid": [0.0, 2.0, 4.0, 6.8, 10.0, 14.8, 18.4],
    "iterationsSimulatorGrid": 400,
    "gridSensitivityYears": [2025, 2028, 2030, 2032, 2035],
    "gridPueValues": [1.18, DEFAULT_PUE, 1.40],
    "gridUtilizationValues": [0.65, DEFAULT_UTILIZATION, 0.90],
}

SEASONAL_REGIME_MONTHS: Dict[str, List[int]] = {
    "annual_blend": list(range(1, 13)),
    "dry_windy": [8, 9, 10, 11],
    "wet_calm": [3, 4, 5],
}

H2V_FLEX_PARAMS: Dict[str, Any] = {
    "inflexibleLoadFactor": 0.92,
    "flexHighCfThreshold": 0.42,
    "flexSolarHourMin": 9,
    "flexSolarHourMax": 15,
    "flexSolarCfThreshold": 0.30,
    "flexLowCfThreshold": 0.27,
    "flexPeakHourMin": 18,
    "flexPeakHourMax": 22,
    "flexHighFactor": 1.00,
    "flexMidFactor": 0.55,
    "flexLowFactor": 0.12,
}

PECEM_SUBSTATION_NAME = "SE Pecém II"
PECEM_H2V_HUB_SHARE = 0.75
DEFAULT_H2V_COMPARISON_MW = 2000.0

TX_SENSITIVITY_SPECS: List[Dict[str, Any]] = [
    {
        "configCode": "TX-01",
        "configId": "TX-01 (Restrição Severa / Atraso de Obras)",
        "importLimitMW": 5500.0,
        "exportLimitMW": 8000.0,
        "description": "Malha atual sob contingência N-1 sem novos reforços de 500 kV",
    },
    {
        "configCode": "TX-02",
        "configId": "TX-02 (Limite Conservador Operativo)",
        "importLimitMW": 6250.0,
        "exportLimitMW": 8750.0,
        "description": "Reforços parciais de compensação síncrona/estática sem novas LTs",
    },
    {
        "configCode": "TX-03",
        "configId": "TX-03 (Referência Base PDE / ONS 2035)",
        "importLimitMW": float(INTERCHANGE_IMPORT_LIMIT_MW),
        "exportLimitMW": float(INTERCHANGE_EXPORT_LIMIT_MW),
        "description": (
            f"Malha de referência do estudo "
            f"(Import {INTERCHANGE_IMPORT_LIMIT_MW / 1000.0:.1f} GW / Export {INTERCHANGE_EXPORT_LIMIT_MW / 1000.0:.1f} GW)"
        ).replace(".", ","),
    },
    {
        "configCode": "TX-04",
        "configId": "TX-04 (Expansão 500 kV NE–SE/CO Planejada)",
        "importLimitMW": 8000.0,
        "exportLimitMW": 11000.0,
        "description": "Entrada das novas LTs 500 kV Graça Aranha–Silvânia e reforços Chesf",
    },
    {
        "configCode": "TX-05",
        "configId": "TX-05 (Bipolo HVDC + Malha 500 kV Completa)",
        "importLimitMW": 9000.0,
        "exportLimitMW": 12500.0,
        "description": "Expansão plena HVDC Bipolo Nordeste–Sudeste + escoamento de 12,5 GW",
    },
]

H2V_SENSITIVITY_SPECS: List[Dict[str, Any]] = [
    {
        "scenarioCode": "H2V-01",
        "flexMode": "none",
        "scenarioId": "H2V-01 · Somente Data Centers 24/7 (Escopo Puro Grupo 6)",
        "h2vNominalMW": 0.0,
        "h2vFlexible": False,
        "operatingRegime": "Sem H2V (Isolamento de Data Centers)",
    },
    {
        "scenarioCode": "H2V-02",
        "flexMode": "inflexible",
        "scenarioId": "H2V-02 · DC Central + H2V Pecém/Suape 1,0 GW (Inflexível 24/7)",
        "h2vNominalMW": 1000.0,
        "h2vFlexible": False,
        "operatingRegime": "Baseload Inflexível (92% contínuo)",
    },
    {
        "scenarioCode": "H2V-03",
        "flexMode": "flexible",
        "scenarioId": "H2V-03 · DC Central + H2V Pecém/Suape 1,0 GW (Flexível / Demand-Response)",
        "h2vNominalMW": 1000.0,
        "h2vFlexible": True,
        "operatingRegime": "Modulação Dinâmica (12% na calmaria / 100% no excedente)",
    },
    {
        "scenarioCode": "H2V-04",
        "flexMode": "inflexible",
        "scenarioId": "H2V-04 · DC Central + H2V Pecém/Suape 2,0 GW (Inflexível 24/7)",
        "h2vNominalMW": 2000.0,
        "h2vFlexible": False,
        "operatingRegime": "Baseload Inflexível (92% contínuo)",
    },
    {
        "scenarioCode": "H2V-05",
        "flexMode": "flexible",
        "scenarioId": "H2V-05 · DC Central + H2V Pecém/Suape 2,0 GW (Flexível / Sinergia Eólica)",
        "h2vNominalMW": 2000.0,
        "h2vFlexible": True,
        "operatingRegime": "Modulação Dinâmica (12% na calmaria / 100% no excedente)",
    },
]

# ---------------------------------------------------------------------------
# 5. Hiperparâmetros dos Modelos Preditivos (Etapas 04 e 05)
# ---------------------------------------------------------------------------
ML_MODEL_PARAMS: Dict[str, Any] = {
    "seed": 42,
    "backtestSplits": 4,
    "backtestValHours": 24 * 90,
    "backtestMinTrainHours": 24 * 365,
    "backtestEmbargoHours": 168,
    "cvEmbargoHours": 48,
    "ridgeAlpha": 10.0,
    "modelABacktestResMlp": {"hiddenUnits": 20, "regL2": 1e-3, "maxIter": 100},
    "modelAResMlp": {"hiddenUnits": 24, "regL2": 1e-3, "maxIter": 140},
    "modelAGbdt": {"nEstimators": 85, "learningRate": 0.08, "maxDepth": 4, "minSamplesLeaf": 45},
    "modelBResMlp": {"hiddenUnits": 20, "regL2": 1e-3, "maxIter": 130},
    "modelBGbdt": {"nEstimators": 80, "learningRate": 0.08, "maxDepth": 4, "minSamplesLeaf": 45},
    "modelCStageC1Logistic": {"regL2": 1e-3, "maxIter": 180},
    "modelCStageC1ResMlp": {
        "hiddenUnits": 16,
        "regL2": 4e-3,
        "regL2Skip": 1e-3,
        "regL2Grid": [5e-4, 2e-3, 8e-3, 3e-2],
        "cvFolds": 4,
        "nEnsemble": 3,
        "maxIter": 180,
    },
    "modelCStageC1Gbdt": {
        "nEstimators": 90,
        "learningRate": 0.06,
        "maxDepth": 3,
        "minSamplesLeaf": 40,
        "l2LeafReg": 12.0,
    },
    "modelCStageC2ResMlp": {
        "hiddenUnits": 16,
        "activation": "silu",
        "regL2": 1.5e-2,
        "regL2Skip": 4e-3,
        "regL2Grid": [3e-3, 1e-2, 3e-2, 8e-2, 2e-1, 4e-1],
        "cvFolds": 4,
        "nEnsemble": 3,
        "maxIter": 200,
    },
    "modelCStageC2Gbdt": {
        "nEstimators": 90,
        "learningRate": 0.06,
        "maxDepth": 4,
        "minSamplesLeaf": 30,
        "l2LeafReg": 10.0,
    },
    "modelCProbThreshold": 0.45,
    "modelCRecencyMinWeight": 0.35,
}

# ---------------------------------------------------------------------------
# 6. Contratos de Sliders, Limiares de UI e Validação SSOT
# ---------------------------------------------------------------------------
SIMULATOR_SLIDER_BOUNDS: Dict[str, Any] = {
    "year": {"min": PROJECTION_START_YEAR, "max": TARGET_END_YEAR, "step": 1, "default": TARGET_END_YEAR},
    "interchangeImportLimitMW": {"min": 4500, "max": 10000, "step": 250, "default": int(INTERCHANGE_IMPORT_LIMIT_MW)},
    "interchangeExportLimitMW": {"min": 7000, "max": 13500, "step": 250, "default": int(INTERCHANGE_EXPORT_LIMIT_MW)},
    "pue": {"min": 1.15, "max": 1.50, "step": 0.01, "default": DEFAULT_PUE},
    "dcUtilization": {"min": 0.50, "max": 0.95, "step": 0.01, "default": DEFAULT_UTILIZATION},
    "defaultDcScenario": REFERENCE_SCENARIO_KEYS["dcCentral"],
    "defaultWindScenario": REFERENCE_SCENARIO_KEYS["windIntermediate"],
    "defaultSeasonalRegime": "annual_blend",
    "defaultObservationWindow": "year",
}

UI_THRESHOLDS: Dict[str, Any] = {
    "substationRisk": {
        "criticalSharePct": 20.0,
        "criticalP95MW": 700.0,
        "highSharePct": 6.0,
        "highP95MW": 230.0,
        "moderateSharePct": 2.0,
        "moderateP95MW": 100.0,
    },
    "targetImportProbMaxPct": 5.5,
    "sensitivityBadges": {
        "highRiskPct": 15.0,
        "lowRiskPct": 5.0,
        "highCompGw": 18.0,
    },
    "correlationHighlight": {
        "strong": 0.7,
        "moderate": 0.3,
        "curtailmentStrong": 0.35,
        "curtailmentModerate": 0.15,
    },
    "substationShareBars": {
        "criticalPct": 40.0,
        "highPct": 15.0,
        "scaleFactor": 1.8,
    },
    "ssotValidationTolerances": {
        "probPct": 0.1,
        "importMW": 0.2,
        "curtailmentTWh": 0.02,
        "compGw": 0.02,
    },
    "chartPaddingRatio": 0.08,
}

# ---------------------------------------------------------------------------
# 7. URLs Oficiais e Templates ONS AWS Open Data S3
# ---------------------------------------------------------------------------
ONS_S3_URL_TEMPLATES: Dict[str, str] = {
    "curva_carga_ano": "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/curva-carga-ho/CURVA_CARGA_{year}.csv",
    "balanco_energia_ano": "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/balanco_energia_subsistema_ho/BALANCO_ENERGIA_SUBSISTEMA_{year}.csv",
    "capacidade_geracao": "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/capacidade-geracao/CAPACIDADE_GERACAO.csv",
    "restricao_coff_eolica_mes": "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/restricao_coff_eolica_tm/RESTRICAO_COFF_EOLICA_{year}_{month:02d}.csv",
}


def build_ons_urls(
    end_year: int = HISTORY_END_YEAR,
    coff_month: int = 12,
) -> Dict[str, str]:
    """Constrói o mapa oficial de endpoints ONS de acordo com a janela histórica configurada."""
    return {
        f"ons_curva_carga_{end_year}": ONS_S3_URL_TEMPLATES["curva_carga_ano"].format(year=end_year),
        f"ons_balanco_{end_year}": ONS_S3_URL_TEMPLATES["balanco_energia_ano"].format(year=end_year),
        "ons_capacidade_geracao": ONS_S3_URL_TEMPLATES["capacidade_geracao"],
        f"ons_constrained_off_eolica_{end_year}_{coff_month:02d}": ONS_S3_URL_TEMPLATES[
            "restricao_coff_eolica_mes"
        ].format(year=end_year, month=coff_month),
    }


OFFICIAL_DATA_URLS: Dict[str, str] = build_ons_urls()


def export_frontend_config_dict() -> Dict[str, Any]:
    """Serializa toda a configuração central para consumo pelo SSOT Frontend."""
    return {
        "subsystemId": SUBSYSTEM_ID,
        "baselineYear": BASELINE_YEAR,
        "historyStartYear": HISTORY_START_YEAR,
        "historyEndYear": HISTORY_END_YEAR,
        "coffStartYear": COFF_START_YEAR,
        "coffRegimeStartDate": COFF_REGIME_START_DATE,
        "modernBlockStartYear": MODERN_BLOCK_START_YEAR,
        "projectionStartYear": PROJECTION_START_YEAR,
        "rampStartYear": RAMP_START_YEAR,
        "targetEndYear": TARGET_END_YEAR,
        "offshoreStartYear": OFFSHORE_START_YEAR,
        "offshoreCommercialStartYear": OFFSHORE_COMMERCIAL_START_YEAR,
        "hoursPerYear": HOURS_PER_YEAR,
        "daysPerYear": DAYS_PER_YEAR,
        "hoursPerDay": HOURS_PER_DAY,
        "weeksPerYear": WEEKS_PER_YEAR,
        "quartersPerYear": QUARTERS_PER_YEAR,
        "blockSizeHours": BLOCK_SIZE_HOURS,
        "baseWindOnshore2026MW": BASE_WIND_ONSHORE_2026_MW,
        "baseHydroThermalMW": BASE_HYDRO_THERMAL_MW,
        "interchangeImportLimitMW": INTERCHANGE_IMPORT_LIMIT_MW,
        "interchangeExportLimitMW": INTERCHANGE_EXPORT_LIMIT_MW,
        "defaultPue": DEFAULT_PUE,
        "defaultUtilization": DEFAULT_UTILIZATION,
        "annualLoadGrowthRate": ANNUAL_LOAD_GROWTH_RATE,
        "annualSolarGrowthRate": ANNUAL_SOLAR_GROWTH_RATE,
        "exportSolarCurtailmentCoef": EXPORT_SOLAR_CURTAILMENT_COEF,
        "curtailmentFlagThresholdMW": CURTAILMENT_FLAG_THRESHOLD_MW,
        "windRampExponent": WIND_RAMP_EXPONENT,
        "offshoreScenarioMwPost2031": dict(OFFSHORE_SCENARIO_MW_POST_2031),
        "chesfDispatch": dict(CHESF_DISPATCH_PARAMS),
        "thermalHydroInstalledCapMW": THERMAL_HYDRO_INSTALLED_CAP_MW,
        "aneelProjectedYears": list(ANEEL_PROJECTED_YEARS),
        "dcScenariosItMW": dict(DC_SCENARIOS_IT_MW),
        "windExpansionOnshoreMW": dict(WIND_EXPANSION_ONSHORE_MW),
        "referenceScenarioKeys": dict(REFERENCE_SCENARIO_KEYS),
        "pecemSubstationName": PECEM_SUBSTATION_NAME,
        "pecemH2vHubShare": PECEM_H2V_HUB_SHARE,
        "defaultH2vComparisonMW": DEFAULT_H2V_COMPARISON_MW,
        "monteCarlo": dict(MONTE_CARLO_PARAMS),
        "h2vFlex": dict(H2V_FLEX_PARAMS),
        "simulatorSliderBounds": dict(SIMULATOR_SLIDER_BOUNDS),
        "uiThresholds": dict(UI_THRESHOLDS),
        "hourlyBaselineJsonUrl": HOURLY_BASELINE_JSON_URL,
        "officialDataUrls": dict(OFFICIAL_DATA_URLS),
    }
