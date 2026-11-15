"""
sync_frontend_ssot.py
Sincronizador Single Source of Truth (SSOT) entre a esteira Python (dados oficiais
ONS / ANEEL / EPE / MME em data/raw, data/scenarios e reports) e o Frontend React/TypeScript.

Gera dois artefatos estritamente sincronizados a partir da mesma carga estruturada:
  1. public/data/pipeline-ssot.json      -> Consumido em runtime pelo frontend (/data/pipeline-ssot.json)
  2. src/data/generated/pipelineSsot.ts  -> Snapshot tipado para build Vite e testes unitários (node:test)

Características de Engenharia de Dados:
  - Leitura defensiva de CSVs (trata células vazias, NaN/Inf, vírgula decimal PT-BR, colunas ausentes).
  - Metadados descritivos externalizados em scripts/pipeline_metadata.json.
  - Join espacial por chave composta (subestacao, estado, tensao_kv).
  - Incorporação literal dos scripts reais em scripts/*.py (eliminando divergência de starterCode).
  - Timestamp determinístico derivado do mtime mais recente dos artefatos de entrada.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from config import (
    BASE_WIND_ONSHORE_2026_MW,
    DEFAULT_H2V_COMPARISON_MW,
    DEFAULT_PUE,
    DEFAULT_UTILIZATION,
    HISTORY_END_YEAR,
    HISTORY_START_YEAR,
    HOURLY_BASELINE_JSON_PATH,
    HOURLY_BASELINE_JSON_URL,
    INTERCHANGE_EXPORT_LIMIT_MW,
    INTERCHANGE_IMPORT_LIMIT_MW,
    OFFSHORE_SCENARIO_MW_POST_2031,
    RAW_DATA_DIR,
    REFERENCE_SCENARIO_KEYS,
    REPORTS_DIR,
    ROOT_DIR,
    SCENARIOS_DATA_DIR,
    SCRIPTS_DIR,
    SIMULATOR_GRID_CSV_FILENAME,
    TARGET_END_YEAR,
    TRAIN_CUTOFF_YEAR,
    UI_THRESHOLDS,
    WIND_EXPANSION_ONSHORE_MW,
    export_frontend_config_dict,
)

PUBLIC_SSOT_JSON_PATH = ROOT_DIR / "public" / "data" / "pipeline-ssot.json"
PUBLIC_HOURLY_BASELINE_JSON_PATH = HOURLY_BASELINE_JSON_PATH
TS_SSOT_PATH = ROOT_DIR / "src" / "data" / "generated" / "pipelineSsot.ts"
PIPELINE_METADATA_PATH = SCRIPTS_DIR / "pipeline_metadata.json"


def safe_str(value: Any, default: str = "") -> str:
    """Normaliza string removendo espaços e tratando valores nulos/NaN."""
    if value is None:
        return default
    text = str(value).strip()
    if text.lower() in {"", "nan", "none", "null", "na", "n/a"}:
        return default
    return text


def safe_float(value: Any, default: float = 0.0) -> float:
    """Converte números em ponto flutuante tratando strings vazias, NaN, Inf e vírgula decimal."""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        fval = float(value)
        return default if (math.isnan(fval) or math.isinf(fval)) else fval
    text = str(value).strip()
    if text.lower() in {"", "nan", "none", "null", "na", "n/a", "-"}:
        return default
    # Normaliza separador decimal comparando a posição relativa de ',' e '.' (PT-BR vs EN)
    if "," in text and "." not in text:
        text = text.replace(",", ".")
    elif "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    try:
        fval = float(text)
        return default if (math.isnan(fval) or math.isinf(fval)) else fval
    except ValueError:
        return default


def safe_int(value: Any, default: int = 0) -> int:
    """Converte para inteiro via safe_float para tolerar strings como '2035.0' ou vazias."""
    return int(round(safe_float(value, float(default))))


def safe_bool(value: Any, default: bool = False) -> bool:
    """Converte strings booleanas heterogêneas ('True', 'sim', '1') com fallback seguro."""
    if isinstance(value, bool):
        return value
    text = safe_str(value).lower()
    if not text:
        return default
    return text in {"true", "1", "sim", "yes", "y", "verdadeiro"}


def _fmt_pt(value: float, decimals: int = 2) -> str:
    """Formata float no padrão PT-BR (ponto de milhar e vírgula decimal)."""
    raw = f"{float(value):,.{decimals}f}"
    return raw.replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_int_pt(value: int) -> str:
    """Formata inteiro com separador de milhar PT-BR."""
    return f"{int(value):,}".replace(",", ".")


def read_csv_records_safe(path: Path) -> List[Dict[str, str]]:
    """
    Lê CSV com detecção automática de delimitador (',' ou ';') e BOM UTF-8,
    descartando linhas totalmente vazias.
    """
    if not path.exists():
        raise FileNotFoundError(f"Artefato oficial ausente para sincronização SSOT: {path}")

    raw_text = path.read_text(encoding="utf-8-sig")
    lines = [ln for ln in raw_text.splitlines() if ln.strip()]
    if not lines:
        return []

    sample = "\n".join(lines[:5])
    delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(lines, delimiter=delimiter)
    records: List[Dict[str, str]] = []
    for row in reader:
        cleaned = {safe_str(k): (v if v is not None else "") for k, v in row.items() if k is not None}
        if any(safe_str(val) != "" for val in cleaned.values()):
            records.append(cleaned)
    return records


def load_pipeline_metadata(metadata_path: Optional[Path] = None) -> Dict[str, Any]:
    """Carrega metadados editoriais externalizados em scripts/pipeline_metadata.json."""
    target = metadata_path or PIPELINE_METADATA_PATH
    if not target.exists():
        raise FileNotFoundError(f"Arquivo de metadados não encontrado em: {target}")
    data = json.loads(target.read_text(encoding="utf-8"))
    for key in ("dcProjectNotes", "featureMetadata", "scriptsCatalog", "uiCatalog"):
        if key not in data:
            raise ValueError(f"Chave obrigatória '{key}' ausente em {target.name}")
    return data


def _infer_developer(
    proj_id: str,
    name: str,
    dc_project_notes: Dict[str, Dict[str, str]],
) -> str:
    if proj_id in dc_project_notes and dc_project_notes[proj_id].get("developer"):
        return dc_project_notes[proj_id]["developer"]
    return name.split(" ")[0] if name else "Desenvolvedor NE"


def _classify_congestion_risk(share_pct: float, p95_mw: float) -> str:
    thresholds = UI_THRESHOLDS["substationRisk"]
    if share_pct >= float(thresholds["criticalSharePct"]) or p95_mw >= float(thresholds["criticalP95MW"]):
        return "Crítico"
    if share_pct >= float(thresholds["highSharePct"]) or p95_mw >= float(thresholds["highP95MW"]):
        return "Elevado"
    if share_pct >= float(thresholds["moderateSharePct"]) or p95_mw >= float(thresholds["moderateP95MW"]):
        return "Moderado"
    return "Baixo"


def _format_scenario_name(raw_name: Any) -> str:
    """Normaliza nome do cenário mantendo compatibilidade com os filtros e UI."""
    return safe_str(raw_name)


def _infer_wind_scenario_id(row: Dict[str, str]) -> str:
    """Resolve o identificador semântico eólico ('base' | 'intermediate' | 'high')."""
    explicit = safe_str(row.get("cenario_eolica"))
    valid_keys = {
        REFERENCE_SCENARIO_KEYS["windBase"],
        REFERENCE_SCENARIO_KEYS["windIntermediate"],
        REFERENCE_SCENARIO_KEYS["windHigh"],
    }
    if explicit in valid_keys:
        return explicit

    wind_cap_mw = safe_float(row.get("wind_capacity_mw"))
    base_cap = BASE_WIND_ONSHORE_2026_MW + WIND_EXPANSION_ONSHORE_MW[REFERENCE_SCENARIO_KEYS["windBase"]]
    interm_cap = BASE_WIND_ONSHORE_2026_MW + WIND_EXPANSION_ONSHORE_MW[REFERENCE_SCENARIO_KEYS["windIntermediate"]]
    high_cap = (
        BASE_WIND_ONSHORE_2026_MW
        + WIND_EXPANSION_ONSHORE_MW[REFERENCE_SCENARIO_KEYS["windHigh"]]
        + OFFSHORE_SCENARIO_MW_POST_2031[REFERENCE_SCENARIO_KEYS["windHigh"]]
    )
    candidates = [
        (abs(wind_cap_mw - base_cap), REFERENCE_SCENARIO_KEYS["windBase"]),
        (abs(wind_cap_mw - interm_cap), REFERENCE_SCENARIO_KEYS["windIntermediate"]),
        (abs(wind_cap_mw - high_cap), REFERENCE_SCENARIO_KEYS["windHigh"]),
    ]
    return min(candidates, key=lambda item: item[0])[1]


def resolve_substations_with_p95(
    sub_scen_rows: List[Dict[str, str]],
    sub_risk_rows: List[Dict[str, str]],
) -> List[Dict[str, Any]]:
    """
    Executa join espacial por chave composta (subestacao, estado, tensao_kv) entre
    a concentração da Etapa 02 e o risco P95 Monte Carlo da Etapa 06.
    """
    p95_by_composite: Dict[Tuple[str, str, int], float] = {}
    p95_by_sub_state: Dict[Tuple[str, str], float] = {}
    p95_by_name: Dict[str, float] = {}

    for row in sub_risk_rows:
        r_sub = safe_str(row.get("subestacao"))
        r_state = safe_str(row.get("estado"))
        r_kv = safe_int(row.get("tensao_kv"), 0)
        r_p95 = round(safe_float(row.get("carga_p95_mw")), 1)
        if r_sub and r_state and r_kv > 0:
            p95_by_composite[(r_sub, r_state, r_kv)] = r_p95
        if r_sub and r_state:
            p95_by_sub_state.setdefault((r_sub, r_state), r_p95)
        if r_sub:
            p95_by_name.setdefault(r_sub, r_p95)

    substations: List[Dict[str, Any]] = []
    for row in sub_scen_rows:
        sub_name = safe_str(row.get("subestacao_conexao"))
        state = safe_str(row.get("estado"))
        voltage_kv = safe_int(row.get("tensao_conexao_kv"), 230)
        share_pct = round(safe_float(row.get("participacao_pct")), 1)
        eff_mw = round(safe_float(row.get("demanda_efetiva_2035_mw")), 1)

        composite_key = (sub_name, state, voltage_kv)
        if composite_key in p95_by_composite:
            p95_mw = p95_by_composite[composite_key]
        elif (sub_name, state) in p95_by_sub_state:
            p95_mw = p95_by_sub_state[(sub_name, state)]
        elif sub_name in p95_by_name:
            p95_mw = p95_by_name[sub_name]
        else:
            p95_mw = eff_mw

        substations.append({
            "substation": sub_name,
            "state": state,
            "voltageKV": voltage_kv,
            "projectCount": safe_int(row.get("n_projetos"), 1),
            "itPowerTotalMW": round(safe_float(row.get("potencia_it_total_mw")), 1),
            "effectiveDemand2035MW": eff_mw,
            "sharePct": share_pct,
            "p95MonteCarloMW": p95_mw,
            "congestionRisk": _classify_congestion_risk(share_pct, p95_mw),
        })
    return substations


def _inspect_hourly_baseline_metadata(baseline_path: Optional[Path] = None) -> Dict[str, Any]:
    """Lê metadados de integridade (digest SHA-256 e contagem horária) de hourly-baseline-8760.json."""
    target = baseline_path or PUBLIC_HOURLY_BASELINE_JSON_PATH
    if not target.exists():
        return {
            "available": False,
            "url": HOURLY_BASELINE_JSON_URL,
            "digest": "",
            "hoursCount": 0,
        }
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
        hours_count = safe_int(data.get("hoursCount"), 0)
        digest = safe_str(data.get("digest"))
        if not digest:
            digest = hashlib.sha256(target.read_bytes()).hexdigest()[:16]
        regimes = data.get("regimes") if isinstance(data.get("regimes"), dict) else {}
        valid_regimes = all(
            isinstance(regimes.get(r), dict)
            and len(regimes[r].get("lBaseMW", [])) == hours_count
            and len(regimes[r].get("cfWind", [])) == hours_count
            for r in ("annual_blend", "dry_windy", "wet_calm")
        )
        return {
            "available": bool(hours_count > 0 and valid_regimes),
            "url": HOURLY_BASELINE_JSON_URL,
            "digest": digest if valid_regimes else "",
            "hoursCount": hours_count if valid_regimes else 0,
        }
    except Exception:
        return {
            "available": False,
            "url": HOURLY_BASELINE_JSON_URL,
            "digest": "",
            "hoursCount": 0,
        }


def read_simulator_grid_records(grid_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """
    Lê a grade paramétrica pré-computada (reports/grade_simulador_monte_carlo_2025_2035.csv).
    Retorna lista vazia caso a execução científica de 06 ainda não tenha gerado o arquivo.
    """
    target = grid_path or (REPORTS_DIR / SIMULATOR_GRID_CSV_FILENAME)
    if not target.exists():
        return []
    return [
        {
            "year": safe_int(r.get("year")),
            "dcScenarioId": safe_str(r.get("dc_scenario"), REFERENCE_SCENARIO_KEYS["dcControl"]),
            "windScenarioId": safe_str(r.get("wind_scenario"), REFERENCE_SCENARIO_KEYS["windBase"]),
            "seasonalRegime": safe_str(r.get("seasonal_regime"), "annual_blend"),
            "pue": round(safe_float(r.get("pue"), DEFAULT_PUE), 2),
            "dcUtilization": round(safe_float(r.get("dc_utilization"), DEFAULT_UTILIZATION), 2),
            "importLimitMW": round(safe_float(r.get("import_limit_mw"), INTERCHANGE_IMPORT_LIMIT_MW), 1),
            "exportLimitMW": round(safe_float(r.get("export_limit_mw"), INTERCHANGE_EXPORT_LIMIT_MW), 1),
            "dcLoadMW": round(safe_float(r.get("dc_load_mw")), 1),
            "windCapacityMW": round(safe_float(r.get("wind_capacity_mw")), 1),
            "probExceedInterchangePct": round(safe_float(r.get("prob_exceder_intercambio_pct")), 1),
            "loleHoursYear": round(safe_float(r.get("lole_horas_criticas_ano")), 1),
            "importP50MW": round(safe_float(r.get("importacao_p50_mw")), 1),
            "importP95MW": round(safe_float(r.get("importacao_p95_mw")), 1),
            "curtailmentWithoutDcTWh": round(safe_float(r.get("curtailment_sem_dc_twh_ano")), 2),
            "curtailmentWithDcTWh": round(safe_float(r.get("curtailment_com_dc_twh_ano")), 2),
            "curtailmentAvoidedGWh": round(safe_float(r.get("curtailment_evitado_gwh_ano")), 1),
            "compensatoryWindGW": round(safe_float(r.get("expansao_eolica_compensatoria_gw")), 2),
        }
        for r in read_csv_records_safe(target)
    ]


def _compute_lineage(
    model_a_rows: List[Dict[str, str]],
    input_paths: Iterable[Path],
    baseline_meta: Optional[Dict[str, Any]] = None,
    simulator_grid_rows_count: int = 0,
) -> Dict[str, Any]:
    raw_ons_files = sorted(RAW_DATA_DIR.glob("ons_*.csv"))
    total_bytes = sum(p.stat().st_size for p in RAW_DATA_DIR.glob("*.csv") if p.is_file())
    years = sorted(
        {
            int(match.group(1))
            for p in raw_ons_files
            if (match := re.search(r"ons_curva_carga_(\d{4})\.csv$", p.name)) is not None
        }
    )

    train_hours = safe_int(model_a_rows[0].get("treino_horas"), 0) if model_a_rows else 0
    test_hours = safe_int(model_a_rows[0].get(f"teste_{TRAIN_CUTOFF_YEAR}_horas"), 0) if model_a_rows else 0

    mtimes = [p.stat().st_mtime for p in input_paths if p.exists()]
    latest_mtime = max(mtimes) if mtimes else dt.datetime.now(dt.timezone.utc).timestamp()
    generated_iso = dt.datetime.fromtimestamp(latest_mtime, tz=dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    report_files = sorted(p.name for p in REPORTS_DIR.iterdir() if p.is_file())
    start_yr = min(years) if years else HISTORY_START_YEAR
    train_end_yr = (max(years) - 1) if len(years) > 1 else (HISTORY_END_YEAR - 1)
    test_yr = max(years) if years else TRAIN_CUTOFF_YEAR
    b_meta = baseline_meta or _inspect_hourly_baseline_metadata()

    source_files = [
        "data/raw/data_centers_pipeline_ne.csv",
        "data/scenarios/dc_substation_load_concentration.csv",
        "data/scenarios/matriz_cenarios_dc_eolica_2026_2035.csv",
        *[f"reports/{name}" for name in report_files],
    ]
    if b_meta["available"]:
        source_files.append("public/data/hourly-baseline-8760.json")

    return {
        "generatedAtUtc": generated_iso,
        "windowLabel": f"{start_yr}–{train_end_yr} (Treino) · {test_yr} (Teste Cego Out-of-Time)",
        "trainHours": train_hours,
        "testHours": test_hours,
        "localRawCachePresent": bool(raw_ons_files),
        "comparativeNonLinearArchitecture": "Rede Neural ResMLP",
        "hourlyBaselineAvailable": bool(b_meta["available"]),
        "hourlyBaselineUrl": str(b_meta["url"]),
        "hourlyBaselineDigest": str(b_meta["digest"]),
        "hourlyBaselineHoursCount": int(b_meta["hoursCount"]),
        "simulatorGridAvailable": simulator_grid_rows_count > 0,
        "simulatorGridRowsCount": int(simulator_grid_rows_count),
        "rawOnsFilesCount": len(raw_ons_files),
        "rawDataTotalMb": round(total_bytes / (1024 * 1024), 2),
        "yearsCovered": years if years else list(range(HISTORY_START_YEAR, HISTORY_END_YEAR + 1)),
        "reportFilesCount": len(report_files),
        "sourceFiles": source_files,
    }


def _build_scripts_pipeline(
    scripts_catalog: List[Dict[str, Any]],
    train_hours: int,
    test_hours: int,
    model_a: List[Dict[str, Any]],
    model_b: List[Dict[str, Any]],
    model_c: List[Dict[str, Any]],
    mc_12: List[Dict[str, Any]],
    tx_rows: List[Dict[str, Any]],
    h2v_rows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Constrói a especificação da esteira de 7 scripts combinando o catálogo em
    pipeline_metadata.json, os indicadores reais dos relatórios e o código literal
    em scripts/*.py.
    """
    best_a_1h = next((r for r in model_a if "1h" in r["horizon"] and "ResMLP" in r["architecture"]), None)
    best_a_24h = next((r for r in model_a if "24h" in r["horizon"] and "ResMLP" in r["architecture"]), None)
    best_b_1h = next((r for r in model_b if "1h" in r["horizon"] and "ResMLP" in r["architecture"]), None)
    best_c_nl = next((r for r in model_c if "ResMLP" in r["architecture"]), None)
    mc_central = next(
        (
            r
            for r in mc_12
            if r["dcScenarioId"] == REFERENCE_SCENARIO_KEYS["dcCentral"]
            and r["windScenarioId"] == REFERENCE_SCENARIO_KEYS["windIntermediate"]
        ),
        None,
    )
    mc_high = next(
        (
            r
            for r in mc_12
            if r["dcScenarioId"] == REFERENCE_SCENARIO_KEYS["dcHigh"]
            and r["windScenarioId"] == REFERENCE_SCENARIO_KEYS["windHigh"]
        ),
        None,
    )
    tx_04 = next((r for r in tx_rows if r["configId"].startswith("TX-04")), None)
    h2v_inflex = next(
        (
            r
            for r in h2v_rows
            if abs(r["h2vNominalMW"] - DEFAULT_H2V_COMPARISON_MW) < 1e-3 and "Inflexível" in r["scenarioId"]
        ),
        None,
    )
    h2v_flex = next(
        (
            r
            for r in h2v_rows
            if abs(r["h2vNominalMW"] - DEFAULT_H2V_COMPARISON_MW) < 1e-3 and "Flexível" in r["scenarioId"]
        ),
        None,
    )

    available_refs: Dict[str, Any] = {
        "best_a_1h": best_a_1h,
        "best_a_24h": best_a_24h,
        "best_b_1h": best_b_1h,
        "best_c_nl": best_c_nl,
        "mc_central": mc_central,
        "mc_high": mc_high,
        "tx_04": tx_04,
        "h2v_inflex": h2v_inflex,
        "h2v_flex": h2v_flex,
    }

    template_vars: Dict[str, str] = {
        "train_hours_pt": _fmt_int_pt(train_hours),
        "test_hours_pt": _fmt_int_pt(test_hours),
    }
    if best_a_1h:
        template_vars.update({
            "best_a_1h_mae": f"{best_a_1h['maeMW']:.2f}",
            "best_a_1h_mape": f"{best_a_1h['mapePct']:.2f}",
            "best_a_1h_r2": f"{best_a_1h['r2Score']:.4f}",
        })
    if best_a_24h:
        template_vars.update({
            "best_a_24h_mae": f"{best_a_24h['maeMW']:.2f}",
            "best_a_24h_mape": f"{best_a_24h['mapePct']:.2f}",
            "best_a_24h_r2": f"{best_a_24h['r2Score']:.4f}",
        })
    if best_b_1h:
        template_vars.update({
            "best_b_1h_r2": f"{best_b_1h['r2Score']:.4f}",
            "best_b_1h_mae_cf": f"{best_b_1h['maeCF']:.4f}",
            "best_b_1h_equiv_mw": f"{best_b_1h['equivPowerMaeMW']:.1f}",
        })
    if best_c_nl:
        template_vars.update({
            "best_c_nl_roc_auc": f"{best_c_nl['rocAuc']:.4f}",
            "best_c_nl_brier": f"{best_c_nl['brierScore']:.4f}",
            "best_c_nl_f1": f"{best_c_nl['f1Score']:.4f}",
            "best_c_nl_r2_vol": f"{best_c_nl['r2Volume']:.4f}",
        })
    if mc_central:
        template_vars.update({
            "mc_central_dc_mw": f"{mc_central['dcLoadMW']:.1f}",
            "mc_central_avoided_twh": f"{mc_central['curtailmentAvoidedGWh'] / 1000.0:.2f}",
            "mc_central_comp_gw": f"{mc_central['compensatoryWindExpansionGW']:.2f}",
        })
    if mc_high:
        template_vars["mc_high_p95_mw"] = f"{mc_high['importP95MW']:.1f}"
    if tx_04:
        template_vars.update({
            "tx_04_id": str(tx_04["configId"]),
            "tx_04_comp_gw": f"{tx_04['compensatoryWindGW']:.2f}",
            "tx_04_curt_twh": f"{tx_04['curtailmentWithDcTWh']:.2f}",
        })
    if h2v_flex and h2v_inflex:
        template_vars.update({
            "h2v_flex_abs_twh": f"{h2v_flex['totalAbsorbedCurtailmentTWh']:.2f}",
            "h2v_flex_prob_pct": f"{h2v_flex['probCriticalImportPct']:.2f}",
            "h2v_inflex_prob_pct": f"{h2v_inflex['probCriticalImportPct']:.2f}",
        })

    def read_script_source(filename: str) -> str:
        path = SCRIPTS_DIR / filename
        if not path.exists():
            return f"# Script {filename} não encontrado."
        return path.read_text(encoding="utf-8").replace("\r\n", "\n")

    compiled: List[Dict[str, Any]] = []
    for entry in scripts_catalog:
        decisions: List[str] = []
        for rule in entry.get("keyDecisions", []):
            requires = rule.get("requires", [])
            if all(available_refs.get(req) is not None for req in requires):
                decisions.append(rule["template"].format(**template_vars))
            else:
                decisions.append(rule.get("fallback", rule["template"]))

        compiled.append({
            "id": entry["id"],
            "order": entry["order"],
            "filename": entry["filename"],
            "title": entry["title"],
            "stageLabel": entry["stageLabel"],
            "purpose": entry["purpose"].format(**template_vars),
            "approvedLibraries": list(entry["approvedLibraries"]),
            "multiprocessingStrategy": entry["multiprocessingStrategy"],
            "inputs": list(entry["inputs"]),
            "outputs": [out.format(**template_vars) for out in entry["outputs"]],
            "keyDecisionsForGroup": decisions,
            "starterCode": read_script_source(entry["filename"]),
        })
    return compiled


def validate_ssot_cross_consistency(payload: Dict[str, Any]) -> List[str]:
    """
    Audita a consistência cruzada do bundle SSOT pós-Passos 1–2:
      1. Unicidade de chave composta (substation, state, voltageKV) nas subestações.
      2. Paridade numérica entre TX-03, H2V-01 e mc_12 (Cenário Central × Eólica Intermediária).
      3. Consistência entre o relatório Markdown final e os números dos CSVs.
    Retorna lista de violações encontradas (lista vazia indica 100% consistente).
    """
    violations: List[str] = []

    # 1. Chaves compostas de subestação
    subs = payload.get("substationLoadConcentration", [])
    seen_keys: set[Tuple[str, str, int]] = set()
    for s in subs:
        key = (str(s.get("substation", "")), str(s.get("state", "")), int(s.get("voltageKV", 0)))
        if not key[0] or not key[1] or key[2] <= 0:
            violations.append(f"Chave composta de subestação inválida: {key}")
        elif key in seen_keys:
            violations.append(f"Chave composta duplicada em subestação: {key}")
        seen_keys.add(key)

    # 2. Paridade TX-03 == H2V-01 == mc_12 (Central × Intermediária)
    tx_rows = payload.get("transmissionSensitivity2035", [])
    h2v_rows = payload.get("h2vSynergySensitivity2035", [])
    mc_rows = payload.get("monteCarlo12Scenarios2035", [])
    tols = UI_THRESHOLDS["ssotValidationTolerances"]
    interm_cap = BASE_WIND_ONSHORE_2026_MW + WIND_EXPANSION_ONSHORE_MW[REFERENCE_SCENARIO_KEYS["windIntermediate"]]

    tx_03 = next(
        (r for r in tx_rows if str(r.get("configId", "")).startswith(REFERENCE_SCENARIO_KEYS["txReferenceIdPrefix"])),
        None,
    )
    h2v_01 = next(
        (
            r
            for r in h2v_rows
            if float(r.get("h2vNominalMW", -1)) == 0.0
            or str(r.get("scenarioId", "")).startswith(REFERENCE_SCENARIO_KEYS["h2vBaselineIdPrefix"])
        ),
        None,
    )
    mc_central_interm = next(
        (
            r
            for r in mc_rows
            if r.get("dcScenarioId") == REFERENCE_SCENARIO_KEYS["dcCentral"]
            and (
                r.get("windScenarioId") == REFERENCE_SCENARIO_KEYS["windIntermediate"]
                or abs(float(r.get("windCapacityMW", 0.0)) - interm_cap) < 150.0
            )
        ),
        None,
    )

    if not tx_03 or not h2v_01 or not mc_central_interm:
        violations.append("Registros de referência TX-03, H2V-01 ou Central×Intermediária ausentes.")
    else:
        prob_tol = float(tols["probPct"])
        imp_tol = float(tols["importMW"])
        curt_tol = float(tols["curtailmentTWh"])
        comp_tol = float(tols["compGw"])
        checks = [
            ("probCriticalImport", float(tx_03["probCriticalImportPct"]), float(mc_central_interm["probExceedInterchangePct"]), prob_tol),
            ("probCriticalImport H2V-01", float(h2v_01["probCriticalImportPct"]), float(mc_central_interm["probExceedInterchangePct"]), prob_tol),
            ("importP95MW TX-03", float(tx_03["importP95MW"]), float(mc_central_interm["importP95MW"]), imp_tol),
            ("importP95MW H2V-01", float(h2v_01["importP95MW"]), float(mc_central_interm["importP95MW"]), imp_tol),
            ("curtailmentWithDcTWh TX-03", float(tx_03["curtailmentWithDcTWh"]), float(mc_central_interm["curtailmentWithDcTWh"]), curt_tol),
            ("remainingCurtailmentTWh H2V-01", float(h2v_01["remainingCurtailmentTWh"]), float(mc_central_interm["curtailmentWithDcTWh"]), curt_tol),
            ("compensatoryWindGW TX-03", float(tx_03["compensatoryWindGW"]), float(mc_central_interm["compensatoryWindExpansionGW"]), comp_tol),
            ("compensatoryWindGW H2V-01", float(h2v_01["compensatoryWindGW"]), float(mc_central_interm["compensatoryWindExpansionGW"]), comp_tol),
        ]
        for label, a_val, b_val, tol in checks:
            if abs(a_val - b_val) > tol:
                violations.append(f"Divergência de paridade em {label}: {a_val} != {b_val} (tol {tol})")

    # 3. Paridade do Markdown final com os CSVs
    md_text = str(payload.get("passo5FinalExecutiveReportMd", ""))
    model_a_24h = next(
        (
            r
            for r in payload.get("modelABenchmark2025", [])
            if "24h" in str(r.get("horizon", "")) and "ResMLP" in str(r.get("architecture", ""))
        ),
        None,
    )
    model_c_nl = next(
        (
            r
            for r in payload.get("modelCBenchmark2025", [])
            if "ResMLP" in str(r.get("architecture", ""))
        ),
        None,
    )
    h2v_inflex = next(
        (
            r
            for r in h2v_rows
            if abs(float(r.get("h2vNominalMW", 0.0)) - DEFAULT_H2V_COMPARISON_MW) < 1e-3
            and "Inflexível" in str(r.get("scenarioId", ""))
        ),
        None,
    )
    h2v_flex = next(
        (
            r
            for r in h2v_rows
            if abs(float(r.get("h2vNominalMW", 0.0)) - DEFAULT_H2V_COMPARISON_MW) < 1e-3
            and "Flexível" in str(r.get("scenarioId", ""))
        ),
        None,
    )

    if model_a_24h:
        expected_r2_a24 = _fmt_pt(float(model_a_24h["r2Score"]), 4)
        if expected_r2_a24 not in md_text:
            violations.append(f"Relatório MD não reflete R² Modelo A 24h ({expected_r2_a24})")
    if model_c_nl:
        expected_r2_c = _fmt_pt(float(model_c_nl["r2Volume"]), 4)
        if expected_r2_c not in md_text:
            violations.append(f"Relatório MD não reflete R² Volume Modelo C ({expected_r2_c})")
    if h2v_inflex:
        expected_prob_inf = _fmt_pt(float(h2v_inflex["probCriticalImportPct"]), 2)
        expected_wind_inf = _fmt_pt(float(h2v_inflex["compensatoryWindGW"]), 2)
        if expected_prob_inf not in md_text or expected_wind_inf not in md_text:
            violations.append(
                f"Relatório MD não reflete H2V 2,0 GW Inflexível ({expected_prob_inf}% / +{expected_wind_inf} GW)"
            )
    if h2v_flex:
        expected_abs_flex = _fmt_pt(float(h2v_flex["totalAbsorbedCurtailmentTWh"]), 2)
        expected_prob_flex = _fmt_pt(float(h2v_flex["probCriticalImportPct"]), 2)
        if expected_abs_flex not in md_text or expected_prob_flex not in md_text:
            violations.append(
                f"Relatório MD não reflete H2V 2,0 GW Flexível ({expected_abs_flex} TWh / {expected_prob_flex}%)"
            )

    # 4. Paridade da grade Monte Carlo 2025-2035 com matriz_cenarios_monte_carlo_2035 (quando disponível)
    grid_rows = payload.get("simulatorMonteCarloGrid", [])
    if grid_rows and mc_rows:
        tols = UI_THRESHOLDS["ssotValidationTolerances"]
        mc_by_pair = {(r.get("dcScenarioId"), r.get("windScenarioId")): r for r in mc_rows}
        matched_nominal_rows = 0
        for gr in grid_rows:
            if (
                safe_int(gr.get("year")) == TARGET_END_YEAR
                and safe_str(gr.get("seasonalRegime")) == "annual_blend"
                and abs(safe_float(gr.get("pue")) - DEFAULT_PUE) < 1e-3
                and abs(safe_float(gr.get("dcUtilization")) - DEFAULT_UTILIZATION) < 1e-3
                and abs(safe_float(gr.get("importLimitMW")) - INTERCHANGE_IMPORT_LIMIT_MW) < 1.0
                and abs(safe_float(gr.get("exportLimitMW")) - INTERCHANGE_EXPORT_LIMIT_MW) < 1.0
            ):
                pair = (
                    safe_str(gr.get("dcScenarioId"), REFERENCE_SCENARIO_KEYS["dcControl"]),
                    safe_str(gr.get("windScenarioId")),
                )
                ref_mc = mc_by_pair.get(pair)
                if (
                    ref_mc is not None
                    and abs(safe_float(gr.get("windCapacityMW")) - safe_float(ref_mc.get("windCapacityMW"))) < 1.0
                ):
                    matched_nominal_rows += 1
                    if abs(float(gr["probExceedInterchangePct"]) - float(ref_mc["probExceedInterchangePct"])) > float(tols["probPct"]):
                        violations.append(f"Divergência grade vs MC12 em probExceedInterchangePct para {pair}")
                    if abs(float(gr["importP95MW"]) - float(ref_mc["importP95MW"])) > float(tols["importMW"]):
                        violations.append(f"Divergência grade vs MC12 em importP95MW para {pair}")
        if matched_nominal_rows < len(mc_rows):
            violations.append(
                f"Grade simulatorMonteCarloGrid incompleta para pontos nominais de {TARGET_END_YEAR}: "
                f"{matched_nominal_rows}/{len(mc_rows)}."
            )

    return violations


def build_ssot_payload(
    metadata_path: Optional[Path] = None,
    baseline_json_path: Optional[Path] = None,
    simulator_grid_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Lê todos os artefatos oficiais do pipeline Python e monta o dicionário canônico SSOT."""
    meta_bundle = load_pipeline_metadata(metadata_path)
    dc_project_notes: Dict[str, Dict[str, str]] = meta_bundle["dcProjectNotes"]
    feature_metadata: Dict[str, Dict[str, str]] = meta_bundle["featureMetadata"]
    scripts_catalog: List[Dict[str, Any]] = meta_bundle["scriptsCatalog"]
    ui_catalog: Dict[str, Any] = meta_bundle["uiCatalog"]

    dc_raw_path = RAW_DATA_DIR / "data_centers_pipeline_ne.csv"
    sub_scen_path = SCENARIOS_DATA_DIR / "dc_substation_load_concentration.csv"
    sub_risk_path = REPORTS_DIR / "risco_subestacoes_rede_basica_2035.csv"
    ramp_matrix_path = SCENARIOS_DATA_DIR / "matriz_cenarios_dc_eolica_2026_2035.csv"

    anova_path = REPORTS_DIR / "relatorio_anova_significancia.csv"
    monthly_path = REPORTS_DIR / "perfil_mensal_sazonalidade_eolica_ne.csv"
    corr_path = REPORTS_DIR / "matriz_correlacao_features.csv"
    model_a_path = REPORTS_DIR / "metricas_modelo_a_demanda.csv"
    model_bc_path = REPORTS_DIR / "metricas_modelos_b_c_eolica_curtailment.csv"
    hourly_path = REPORTS_DIR / "perfil_horario_2025_real_vs_predito.csv"

    mc_12_path = REPORTS_DIR / "matriz_cenarios_monte_carlo_2035.csv"
    comp_curve_path = REPORTS_DIR / "curva_expansao_eolica_compensatoria_2035.csv"
    timeline_path = REPORTS_DIR / "evolucao_anual_risco_2026_2035.csv"
    tx_path = REPORTS_DIR / "sensibilidade_transmissao_intercambio_2035.csv"
    h2v_path = REPORTS_DIR / "sensibilidade_h2v_eletrointensivos_2035.csv"
    ind_path = REPORTS_DIR / "indicadores_participacao_eolica_aneel_vs_ons_2015_2035.csv"
    report_md_path = REPORTS_DIR / "relatorio_final_consolidado_ptc3567_grupo6.md"
    sim_grid_target = simulator_grid_path or (REPORTS_DIR / SIMULATOR_GRID_CSV_FILENAME)
    baseline_target = baseline_json_path or PUBLIC_HOURLY_BASELINE_JSON_PATH

    tracked_inputs = [
        dc_raw_path, sub_scen_path, sub_risk_path, ramp_matrix_path,
        anova_path, monthly_path, corr_path, model_a_path, model_bc_path,
        hourly_path, mc_12_path, comp_curve_path, timeline_path, tx_path,
        h2v_path, ind_path, report_md_path, sim_grid_target, baseline_target,
        metadata_path or PIPELINE_METADATA_PATH,
        SCRIPTS_DIR / "config.py",
        *[SCRIPTS_DIR / f for f in sorted(p.name for p in SCRIPTS_DIR.glob("[0-9][0-9]_*.py"))],
    ]

    # 1. Pipeline de Data Centers (data/raw/data_centers_pipeline_ne.csv)
    dc_projects: List[Dict[str, Any]] = []
    for row in read_csv_records_safe(dc_raw_path):
        proj_id = safe_str(row.get("id_projeto"))
        name = safe_str(row.get("nome_projeto"))
        meta = dc_project_notes.get(proj_id, {})
        dc_projects.append({
            "id": proj_id,
            "name": name,
            "developer": _infer_developer(proj_id, name, dc_project_notes),
            "state": safe_str(row.get("estado"), "CE"),
            "municipality": safe_str(row.get("municipio")),
            "substation": safe_str(row.get("subestacao_conexao")),
            "voltageKV": safe_int(row.get("tensao_conexao_kv"), 230),
            "itPowerMW": round(safe_float(row.get("potencia_it_mw")), 1),
            "totalGridPowerMW": round(safe_float(row.get("potencia_total_rede_mw")), 1),
            "estimatedPUE": round(safe_float(row.get("pue_estimado"), DEFAULT_PUE), 2),
            "publicationType": safe_str(row.get("tipo_publicacao"), "potencia_it"),
            "expectedStartYear": safe_int(row.get("ano_inicio_previsto"), 2028),
            "rampMonths": safe_int(row.get("rampa_meses"), 24),
            "maturityStage": safe_str(row.get("estagio_maturidade")),
            "scenario": safe_str(row.get("cenario_enquadramento"), "central"),
            "realizationProbability": round(safe_float(row.get("probabilidade_concretizacao"), 0.5), 2),
            "expectedDelayYears": round(safe_float(row.get("atraso_esperado_anos"), 0.5), 1),
            "officialSource": safe_str(row.get("fonte_oficial")),
            "notes": meta.get(
                "notes",
                f"Projeto mapeado no subsistema NE com conexão prevista na {safe_str(row.get('subestacao_conexao'))}.",
            ),
        })

    # 2. Concentração por Subestação com Join por Chave Composta (Etapa 02 + Etapa 06)
    substations = resolve_substations_with_p95(
        read_csv_records_safe(sub_scen_path),
        read_csv_records_safe(sub_risk_path),
    )

    # 3. Rampa Anual 2026–2035 (data/scenarios/matriz_cenarios_dc_eolica_2026_2035.csv)
    ramp_by_year: Dict[int, Dict[str, Any]] = {}
    for row in read_csv_records_safe(ramp_matrix_path):
        yr = safe_int(row.get("ano"))
        dc_sc = safe_str(row.get("cenario_dc"))
        load_mw = round(safe_float(row.get("carga_efetiva_dc_mw")), 1)
        n_proj = safe_int(row.get("projetos_ativos"))
        entry = ramp_by_year.setdefault(
            yr,
            {"year": yr, "conservativeMW": 0.0, "centralMW": 0.0, "highMW": 0.0, "activeProjectsHigh": 0},
        )
        if dc_sc == "conservative":
            entry["conservativeMW"] = load_mw
        elif dc_sc == "central":
            entry["centralMW"] = load_mw
        elif dc_sc == "high":
            entry["highMW"] = load_mw
            entry["activeProjectsHigh"] = max(entry["activeProjectsHigh"], n_proj)
    annual_ramp = [ramp_by_year[y] for y in sorted(ramp_by_year)]

    # 4. ANOVA, Sazonalidade Mensal e Correlações (Etapa 03)
    anova_results = [
        {
            "targetVariable": safe_str(r.get("variavel_analisada")),
            "groupingFactor": safe_str(r.get("fator_agrupador")),
            "fStatistic": round(safe_float(r.get("estatistica_f")), 2),
            "pValue": safe_float(r.get("p_valor")),
            "etaSquaredPct": round(safe_float(r.get("eta_squared_pct")), 2),
            "isSignificantAlpha01": safe_bool(r.get("significativo_alpha_01"), True),
            "technicalInterpretation": safe_str(r.get("conclusao_tecnica")),
        }
        for r in read_csv_records_safe(anova_path)
    ]

    monthly_profiles = [
        {
            "month": safe_int(r.get("mes")),
            "monthName": safe_str(r.get("nome_mes")),
            "avgCapacityFactor": round(safe_float(r.get("cf_medio")), 3),
            "stdCapacityFactor": round(safe_float(r.get("cf_desvio_padrao")), 3),
            "p10CapacityFactor": round(safe_float(r.get("cf_p10")), 3),
            "p50MedianCapacityFactor": round(safe_float(r.get("cf_p50_mediana")), 3),
            "p90CapacityFactor": round(safe_float(r.get("cf_p90")), 3),
            "avgBaseLoadMW": round(safe_float(r.get("carga_base_media_mw")), 1),
            "avgCurtailmentMW": round(safe_float(r.get("curtailment_medio_mw")), 1),
            "seasonalRegime": safe_str(r.get("regime_sazonal"), "Transição"),
        }
        for r in read_csv_records_safe(monthly_path)
    ]

    feature_correlations = []
    for r in read_csv_records_safe(corr_path):
        fname = safe_str(r.get("feature"))
        meta = feature_metadata.get(fname, {})
        feature_correlations.append({
            "featureName": fname,
            "featureDescription": meta.get("description", fname),
            "corrBaseLoad": round(safe_float(r.get("corr_l_base_mw")), 3),
            "corrWindCF": round(safe_float(r.get("corr_cf_eolica")), 3),
            "corrCurtailment": round(safe_float(r.get("corr_curtailment_mw")), 3),
            "roleInModel": meta.get("role", "Autoregressiva (Lag)"),
        })

    # 5. Benchmarks 2025 (Etapas 04 e 05)
    raw_model_a = read_csv_records_safe(model_a_path)
    model_a_rows = [
        {
            "horizon": safe_str(r.get("horizonte")),
            "architecture": safe_str(r.get("arquitetura")),
            "family": safe_str(r.get("familia")),
            "maeMW": round(safe_float(r.get("mae_mw")), 2),
            "rmseMW": round(safe_float(r.get("rmse_mw")), 2),
            "mapePct": round(safe_float(r.get("mape_pct")), 2),
            "r2Score": round(safe_float(r.get("r2_score")), 4),
            "peakHourMaeMW": round(safe_float(r.get("mae_ponta_18h_21h_mw")), 2),
        }
        for r in raw_model_a
    ]

    raw_model_bc = read_csv_records_safe(model_bc_path)
    model_b_rows: List[Dict[str, Any]] = []
    model_c_rows: List[Dict[str, Any]] = []
    for r in raw_model_bc:
        etapa = safe_str(r.get("etapa"))
        if etapa.startswith("Modelo B"):
            model_b_rows.append({
                "horizon": safe_str(r.get("horizonte")),
                "architecture": safe_str(r.get("arquitetura")),
                "family": safe_str(r.get("familia")),
                "maeCF": round(safe_float(r.get("mae_cf")), 4),
                "rmseCF": round(safe_float(r.get("rmse_cf")), 4),
                "r2Score": round(safe_float(r.get("r2_score")), 4),
                "equivPowerMaeMW": round(safe_float(r.get("mae_potencia_equiv_mw")), 1),
            })
        elif etapa.startswith("Modelo C"):
            model_c_rows.append({
                "architecture": safe_str(r.get("arquitetura")),
                "family": safe_str(r.get("familia")),
                "rocAuc": round(safe_float(r.get("roc_auc")), 4),
                "brierScore": round(safe_float(r.get("brier_score")), 4),
                "f1Score": round(safe_float(r.get("f1_score")), 4),
                "maeGlobalMW": round(safe_float(r.get("mae_global_mw")), 1),
                "r2Volume": round(safe_float(r.get("r2_volume")), 4),
                "realCurtailed2025TWh": round(safe_float(r.get("energia_cortada_real_2025_twh")), 2),
                "predCurtailed2025TWh": round(safe_float(r.get("energia_cortada_pred_2025_twh")), 2),
            })

    hourly_2025 = [
        {
            "hour": safe_int(r.get("hora")),
            "hourLabel": safe_str(r.get("rotulo_hora")),
            "realLoadMW": round(safe_float(r.get("real_carga_mw")), 1),
            "predLoadNonLinearMW": round(safe_float(r.get("pred_carga_nonlin_24h_mw")), 1),
            "realWindCfPct": round(safe_float(r.get("real_cf_pct")), 2),
            "predWindCfNonLinearPct": round(safe_float(r.get("pred_cf_nonlin_pct")), 2),
            "realSolarMW": round(safe_float(r.get("real_solar_mw")), 1),
            "realCurtailmentMW": round(safe_float(r.get("real_curtailment_mw")), 1),
            "predCurtailmentLinearMW": round(safe_float(r.get("pred_curtailment_lin_mw")), 1),
            "predCurtailmentNonLinearMW": round(safe_float(r.get("pred_curtailment_nonlin_mw")), 1),
        }
        for r in read_csv_records_safe(hourly_path)
    ]

    # 6. Monte Carlo 2035 (Etapa 06)
    mc_12 = [
        {
            "scenarioName": _format_scenario_name(r.get("cenario_nome")),
            "dcScenarioId": safe_str(r.get("cenario_dc"), REFERENCE_SCENARIO_KEYS["dcControl"]),
            "windScenarioId": _infer_wind_scenario_id(r),
            "dcLoadMW": round(safe_float(r.get("dc_load_mw")), 1),
            "windOnshoreMW": round(safe_float(r.get("wind_onshore_mw")), 1),
            "windOffshoreMW": round(safe_float(r.get("wind_offshore_mw")), 1),
            "windCapacityMW": round(safe_float(r.get("wind_capacity_mw")), 1),
            "probExceedInterchangePct": round(safe_float(r.get("prob_exceder_intercambio_pct")), 1),
            "loleCriticalHoursYear": round(safe_float(r.get("lole_horas_criticas_ano")), 1),
            "importP50MW": round(safe_float(r.get("importacao_p50_mw")), 1),
            "importP90MW": round(safe_float(r.get("importacao_p90_mw")), 1),
            "importP95MW": round(safe_float(r.get("importacao_p95_mw")), 1),
            "curtailmentWithoutDcTWh": round(safe_float(r.get("curtailment_sem_dc_twh_ano")), 2),
            "curtailmentWithDcTWh": round(safe_float(r.get("curtailment_com_dc_twh_ano")), 2),
            "curtailmentAvoidedGWh": round(safe_float(r.get("curtailment_evitado_gwh_ano")), 1),
            "curtailmentReductionPct": round(safe_float(r.get("reducao_curtailment_pct")), 1),
            "compensatoryWindExpansionGW": round(safe_float(r.get("expansao_eolica_compensatoria_gw")), 2),
        }
        for r in read_csv_records_safe(mc_12_path)
    ]

    comp_curve = [
        {
            "extraWindGW": round(safe_float(r.get("expansao_adicional_gw")), 1),
            "totalWindGW": round(safe_float(r.get("wind_capacity_mw")) / 1000.0, 1),
            "probExceedInterchangePct": round(safe_float(r.get("prob_exceder_intercambio_pct")), 1),
            "loleHoursYear": round(safe_float(r.get("lole_horas_criticas_ano")), 1),
            "importP95MW": round(safe_float(r.get("importacao_p95_mw")), 1),
            "curtailmentWithDcTWh": round(safe_float(r.get("curtailment_com_dc_twh_ano")), 2),
            "curtailmentAvoidedGWh": round(safe_float(r.get("curtailment_evitado_gwh_ano")), 1),
            "remainingExtraWindNeededGW": round(safe_float(r.get("expansao_eolica_compensatoria_gw")), 2),
        }
        for r in read_csv_records_safe(comp_curve_path)
    ]

    annual_timeline = [
        {
            "year": safe_int(r.get("target_year")),
            "dcLoadMW": round(safe_float(r.get("dc_load_mw")), 1),
            "windCapacityMW": round(safe_float(r.get("wind_capacity_mw")), 1),
            "probExceedInterchangePct": round(safe_float(r.get("prob_exceder_intercambio_pct")), 1),
            "loleHoursYear": round(safe_float(r.get("lole_horas_criticas_ano")), 1),
            "importP50MW": round(safe_float(r.get("importacao_p50_mw")), 1),
            "importP95MW": round(safe_float(r.get("importacao_p95_mw")), 1),
            "curtailmentWithDcTWh": round(safe_float(r.get("curtailment_com_dc_twh_ano")), 2),
            "curtailmentAvoidedGWh": round(safe_float(r.get("curtailment_evitado_gwh_ano")), 1),
            "compensatoryWindGW": round(safe_float(r.get("expansao_eolica_compensatoria_gw")), 2),
        }
        for r in read_csv_records_safe(timeline_path)
    ]

    # 7. Passo 5 · Sensibilidade & ANEEL vs ONS (Etapa 07)
    tx_rows = [
        {
            "configId": safe_str(r.get("id_config")),
            "importLimitMW": round(safe_float(r.get("import_limit_mw")), 1),
            "exportLimitMW": round(safe_float(r.get("export_limit_mw")), 1),
            "infrastructureDescription": safe_str(r.get("descricao_infraestrutura")),
            "probCriticalImportPct": round(safe_float(r.get("prob_import_critica_pct")), 2),
            "loleHoursYear": round(safe_float(r.get("lole_horas_ano")), 1),
            "importP95MW": round(safe_float(r.get("import_p95_mw")), 1),
            "curtailmentWithDcTWh": round(safe_float(r.get("curtailment_com_dc_twh")), 2),
            "curtailmentWithoutDcTWh": round(safe_float(r.get("curtailment_sem_dc_twh")), 2),
            "curtailmentAvoidedGWh": round(safe_float(r.get("curtailment_evitado_dc_gwh")), 1),
            "compensatoryWindGW": round(safe_float(r.get("expansao_eolica_compensatoria_gw")), 2),
        }
        for r in read_csv_records_safe(tx_path)
    ]

    h2v_rows = [
        {
            "scenarioId": safe_str(r.get("cenario_id")),
            "dcLoadMW": round(safe_float(r.get("carga_dc_mw")), 1),
            "h2vNominalMW": round(safe_float(r.get("carga_h2v_nominal_mw")), 1),
            "h2vEffectiveAvgMW": round(safe_float(r.get("carga_h2v_media_efetiva_mw")), 1),
            "operatingRegime": safe_str(r.get("regime_operacional_h2v")),
            "probCriticalImportPct": round(safe_float(r.get("prob_import_critica_pct")), 2),
            "importP95MW": round(safe_float(r.get("import_p95_mw")), 1),
            "remainingCurtailmentTWh": round(safe_float(r.get("curtailment_restante_twh")), 2),
            "totalAbsorbedCurtailmentTWh": round(safe_float(r.get("curtailment_absorvido_total_twh")), 2),
            "pecemSubstationLoadMW": round(safe_float(r.get("pressao_se_pecem_ii_mw")), 1),
            "compensatoryWindGW": round(safe_float(r.get("expansao_eolica_compensatoria_gw")), 2),
        }
        for r in read_csv_records_safe(h2v_path)
    ]

    ind_rows = [
        {
            "year": safe_int(r.get("ano")),
            "periodLabel": safe_str(r.get("periodo")),
            "installedWindGW": round(safe_float(r.get("cap_eolica_instalada_gw")), 2),
            "totalSubsystemCapGW": round(safe_float(r.get("cap_total_subsistema_ne_gw")), 2),
            "aneelInstalledSharePct": round(safe_float(r.get("participacao_capacidade_aneel_pct")), 2),
            "onsEffectiveGenSharePct": round(safe_float(r.get("participacao_geracao_efetiva_ons_pct")), 2),
            "onsEffectiveCfPct": round(safe_float(r.get("cf_eolico_efetivo_ons_pct")), 2),
            "potentialUnconstrainedCfPct": round(safe_float(r.get("cf_eolico_potencial_sem_corte_pct")), 2),
            "annualCurtailmentLossTWh": round(safe_float(r.get("perda_curtailment_anual_twh")), 2),
        }
        for r in read_csv_records_safe(ind_path)
    ]

    report_md = (
        report_md_path.read_text(encoding="utf-8").replace("\r\n", "\n")
        if report_md_path.exists()
        else "# Relatório Técnico Consolidado Final — PTC3567 (Grupo 6)\n"
    )

    simulator_grid = read_simulator_grid_records(sim_grid_target)
    baseline_meta = _inspect_hourly_baseline_metadata(baseline_target)
    lineage = _compute_lineage(
        raw_model_a,
        tracked_inputs,
        baseline_meta=baseline_meta,
        simulator_grid_rows_count=len(simulator_grid),
    )
    scripts_pipeline = _build_scripts_pipeline(
        scripts_catalog=scripts_catalog,
        train_hours=lineage["trainHours"],
        test_hours=lineage["testHours"],
        model_a=model_a_rows,
        model_b=model_b_rows,
        model_c=model_c_rows,
        mc_12=mc_12,
        tx_rows=tx_rows,
        h2v_rows=h2v_rows,
    )

    payload: Dict[str, Any] = {
        "schemaVersion": "2.0.0",
        "config": export_frontend_config_dict(),
        "uiCatalog": ui_catalog,
        "lineage": lineage,
        "dataCentersPipeline": dc_projects,
        "substationLoadConcentration": substations,
        "scenarioAnnualRamp": annual_ramp,
        "anovaTestResults": anova_results,
        "monthlyWindProfiles": monthly_profiles,
        "featureCorrelations": feature_correlations,
        "modelABenchmark2025": model_a_rows,
        "modelBBenchmark2025": model_b_rows,
        "modelCBenchmark2025": model_c_rows,
        "hourlyValidation2025Profile": hourly_2025,
        "monteCarlo12Scenarios2035": mc_12,
        "simulatorMonteCarloGrid": simulator_grid,
        "compensatoryWindCurve2035": comp_curve,
        "annualRiskTimeline2026_2035": annual_timeline,
        "transmissionSensitivity2035": tx_rows,
        "h2vSynergySensitivity2035": h2v_rows,
        "aneelVsOnsWindIndicators2015_2035": ind_rows,
        "passo5FinalExecutiveReportMd": report_md,
        "scriptsPipeline": scripts_pipeline,
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]
    return {"schemaVersion": payload["schemaVersion"], "bundleDigest": digest, **{k: v for k, v in payload.items() if k != "schemaVersion"}}


def sync_frontend_ssot(
    json_out_path: Optional[Path] = None,
    ts_out_path: Optional[Path] = None,
    validate: bool = True,
) -> Dict[str, Any]:
    """Gera public/data/pipeline-ssot.json e src/data/generated/pipelineSsot.ts após validar consistência cruzada."""
    payload = build_ssot_payload()
    if validate:
        violations = validate_ssot_cross_consistency(payload)
        if violations:
            raise ValueError(
                "Bloqueio SSOT — inconsistências cruzadas detectadas antes da emissão:\n- "
                + "\n- ".join(violations)
            )
    json_target = json_out_path or PUBLIC_SSOT_JSON_PATH
    ts_target = ts_out_path or TS_SSOT_PATH

    json_target.parent.mkdir(parents=True, exist_ok=True)
    ts_target.parent.mkdir(parents=True, exist_ok=True)

    serialized_json = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").replace("\r\n", "\n")
    with open(json_target, "w", encoding="utf-8", newline="\n") as jf:
        jf.write(serialized_json)

    ts_header = (
        "// AUTO-GENERATED BY scripts/sync_frontend_ssot.py — DO NOT EDIT MANUALLY.\n"
        "// Single Source of Truth derived from official ONS/ANEEL/EPE/MME pipeline outputs.\n"
        "import type { PipelineSsotBundle } from '../pipelineTypes';\n\n"
        "export const PIPELINE_SSOT: PipelineSsotBundle = "
    )
    with open(ts_target, "w", encoding="utf-8", newline="\n") as tf:
        tf.write(ts_header + serialized_json.rstrip("\n") + ";\n")

    print(
        f"[SSOT] Frontend sincronizado com sucesso:\n"
        f"  - JSON runtime: {json_target}\n"
        f"  - Bundle TS:    {ts_target}\n"
        f"  - Projetos DC:  {len(payload['dataCentersPipeline'])} | "
        f"Subestações: {len(payload['substationLoadConcentration'])} | "
        f"Cenários MC: {len(payload['monteCarlo12Scenarios2035'])} | "
        f"Scripts: {len(payload['scriptsPipeline'])}"
    )
    return payload


if __name__ == "__main__":
    sync_frontend_ssot()
