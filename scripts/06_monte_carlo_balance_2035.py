"""
06_monte_carlo_balance_2035.py
Etapa 06 (Passo 4): Simulação Estocástica de Monte Carlo Encadeada (2026–2035),
Matriz Completa de 12 Cenários e Curva de Expansão Eólica Compensatória (GW)
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo (Seções 7, 8 e 10 do Plano Orientador):
- Encadear os Modelos A (Demanda Base + PDE 2035), B (CF Eólico Potencial via Block Bootstrap)
  e C (Curtailment Hurdle Não-Linear + Limites de Intercâmbio SIN) com o Pipeline Nominal de
  14 Projetos de Data Centers e as trajetórias de expansão eólica (SIGA Onshore + IBAMA Offshore pós-2031).
- Modelar fielmente a modulação hidrotérmica flexível do Nordeste (reservatórios do Rio São Francisco / Chesf:
  Xingó, Paulo Afonso, Sobradinho e Itaparica, que reduzem despacho ao mínimo operativo durante pico solar/eólico
  e modulam até ~9.800 MW nas rampas noturnas e calmarias).
- Executar em paralelo (multiprocessing.Pool) milhares de realizações horárias estocásticas preservando
  a sazonalidade e a autocorrelação de eventos extremos de calmaria (Mar-Mai) e vendaval (Ago-Nov).
- Gerar os 5 relatórios analíticos finais em reports/:
  1. matriz_cenarios_monte_carlo_2035.csv (Matriz completa dos 12 cenários cruzados em 2035)
  2. evolucao_anual_risco_2026_2035.csv (Trajetória ano a ano 2026 a 2035 para os cenários principais)
  3. curva_expansao_eolica_compensatoria_2035.csv (Sensibilidade: +0 a +18,4 GW eólicos extras vs. Risco e Curtailment)
  4. relatorio_monte_carlo_bottom_up_projetos_2035.csv (Amostragem Bernoulli + atraso nos 14 projetos nominais)
  5. risco_subestacoes_rede_basica_2035.csv (Concentração espacial P50/P95 nas subestações da Rede Básica)
"""

import datetime as dt
import hashlib
import json
import os
import sys
import multiprocessing as mp
from pathlib import Path
from typing import Dict, List, Any, Tuple
import numpy as np
import pandas as pd

from config import (
    RAW_DATA_DIR,
    PROCESSED_DATA_DIR,
    SCENARIOS_DATA_DIR,
    REPORTS_DIR,
    HOURLY_BASELINE_JSON_PATH,
    HOURLY_BASELINE_CSV_FILENAME,
    SIMULATOR_GRID_CSV_FILENAME,
    BASELINE_YEAR,
    PROJECTION_START_YEAR,
    TARGET_END_YEAR,
    MODERN_BLOCK_START_YEAR,
    BLOCK_SIZE_HOURS,
    HOURS_PER_YEAR,
    HOURS_PER_DAY,
    ANNUAL_LOAD_GROWTH_RATE,
    ANNUAL_SOLAR_GROWTH_RATE,
    EXPORT_SOLAR_CURTAILMENT_COEF,
    CHESF_DISPATCH_PARAMS,
    MONTE_CARLO_PARAMS,
    H2V_FLEX_PARAMS,
    SEASONAL_REGIME_MONTHS,
    TX_SENSITIVITY_SPECS,
    BASE_WIND_ONSHORE_2026_MW,
    WIND_EXPANSION_ONSHORE_MW,
    INTERCHANGE_IMPORT_LIMIT_MW,
    INTERCHANGE_EXPORT_LIMIT_MW,
    BASE_HYDRO_THERMAL_MW,
    DEFAULT_PUE,
    DEFAULT_UTILIZATION,
    REFERENCE_SCENARIO_KEYS,
)


def _prepare_seasonal_blocks(
    base_df: pd.DataFrame,
    seasonal_regime: str = "annual_blend",
) -> Dict[str, np.ndarray]:
    """
    Extrai os vetores históricos reais (MODERN_BLOCK_START_YEAR..BASELINE_YEAR, refletindo a matriz solar/eólica atual)
    para reamostragem em blocos semanais preservando autocorrelação horária e sinóptica.
    Quando seasonal_regime != 'annual_blend', filtra os meses reais definidos em SEASONAL_REGIME_MONTHS.
    """
    df_rec = base_df.copy()
    ts = pd.to_datetime(df_rec["ts"])
    df_rec["year"] = ts.dt.year
    df_rec["month"] = ts.dt.month
    modern = df_rec[df_rec["year"] >= MODERN_BLOCK_START_YEAR].reset_index(drop=True)
    if len(modern) < HOURS_PER_YEAR:
        modern = df_rec.reset_index(drop=True)

    target_months = SEASONAL_REGIME_MONTHS.get(seasonal_regime)
    if target_months and len(target_months) < 12:
        filtered = modern[modern["month"].isin(target_months)].reset_index(drop=True)
        if len(filtered) >= BLOCK_SIZE_HOURS:
            modern = filtered

    if "hour" in modern.columns:
        hour_arr = modern["hour"].to_numpy(dtype=np.int32)
    else:
        hour_arr = pd.to_datetime(modern["ts"]).dt.hour.to_numpy(dtype=np.int32)

    hydro_col = (
        "g_hidro_mw"
        if "g_hidro_mw" in modern.columns
        else ("g_hidraulica_mw" if "g_hidraulica_mw" in modern.columns else None)
    )
    hydro_arr = (
        pd.to_numeric(modern[hydro_col], errors="coerce").fillna(0.0).to_numpy(dtype=float)
        if hydro_col is not None
        else np.zeros(len(modern), dtype=float)
    )
    thermal_arr = (
        pd.to_numeric(modern["g_termica_mw"], errors="coerce").fillna(0.0).to_numpy(dtype=float)
        if "g_termica_mw" in modern.columns
        else np.zeros(len(modern), dtype=float)
    )

    return {
        "cf": modern["cf_eolica"].to_numpy(dtype=float),
        "load": modern["l_base_mw"].to_numpy(dtype=float),
        "solar": modern["g_solar_mw"].fillna(0.0).to_numpy(dtype=float),
        "hour": hour_arr,
        "month": modern["month"].to_numpy(dtype=np.int32),
        "hydro": hydro_arr,
        "thermal": thermal_arr,
    }


def _compute_chesf_hydro_thermal_dispatch(
    base_load_mw: np.ndarray,
    wind_gen_mw: np.ndarray,
    solar_gen_mw: np.ndarray,
    month_arr: np.ndarray | None = None,
    obs_hydro_mw: np.ndarray | None = None,
    obs_thermal_mw: np.ndarray | None = None,
) -> np.ndarray:
    """
    Modela a resposta operativa sazonal das hidrelétricas da Chesf (Rio São Francisco) e a
    inflexibilidade térmica/biomassa no NE a partir de CHESF_DISPATCH_PARAMS:
      - Estação úmida (Dez–Mai): defluência mínima mais alta e maior modulação nas pontas.
      - Estação seca (Ago–Nov): conservação hídrica compensada por parcela da base térmica ONS.
      - Ancoragem parcial (hydroObsBlend) na geração hidráulica observada g_hidro_mw quando > 0.
    """
    floor_mw = float(CHESF_DISPATCH_PARAMS["floorMW"])
    slope_base = float(CHESF_DISPATCH_PARAMS["netNeedSlope"])
    ceiling_mw = float(CHESF_DISPATCH_PARAMS["ceilingMW"])
    net_thermal_hydro_need = np.maximum(0.0, base_load_mw - (wind_gen_mw + solar_gen_mw))

    if month_arr is None and obs_hydro_mw is None and obs_thermal_mw is None:
        return np.clip(floor_mw + slope_base * net_thermal_hydro_need, floor_mw, ceiling_mw)

    wet_months = tuple(int(m) for m in CHESF_DISPATCH_PARAMS["wetMonths"])
    dry_months = tuple(int(m) for m in CHESF_DISPATCH_PARAMS["dryMonths"])
    wet_bonus = float(CHESF_DISPATCH_PARAMS["wetFloorBonusMW"])
    wet_slope = float(CHESF_DISPATCH_PARAMS["wetSlope"])
    dry_slope = float(CHESF_DISPATCH_PARAMS["drySlope"])
    therm_weight = float(CHESF_DISPATCH_PARAMS["thermalInflexWeight"])
    hydro_blend = float(CHESF_DISPATCH_PARAMS["hydroObsBlend"])

    if month_arr is not None:
        is_wet = np.isin(month_arr, wet_months)
        is_dry = np.isin(month_arr, dry_months)
        seasonal_floor = np.where(
            is_wet,
            floor_mw + wet_bonus,
            np.where(is_dry, floor_mw, floor_mw + 0.5 * wet_bonus),
        )
        seasonal_slope = np.where(is_wet, wet_slope, np.where(is_dry, dry_slope, slope_base))
    else:
        seasonal_floor = np.full_like(net_thermal_hydro_need, floor_mw, dtype=float)
        seasonal_slope = np.full_like(net_thermal_hydro_need, slope_base, dtype=float)

    thermal_inflex = therm_weight * np.maximum(0.0, obs_thermal_mw) if obs_thermal_mw is not None else 0.0
    model_curve = seasonal_floor + seasonal_slope * net_thermal_hydro_need + thermal_inflex

    if obs_hydro_mw is not None and np.any(obs_hydro_mw > 0.0):
        has_obs = obs_hydro_mw > 0.0
        obs_anchor = obs_hydro_mw + thermal_inflex
        modulated = np.where(has_obs, (1.0 - hydro_blend) * model_curve + hydro_blend * obs_anchor, model_curve)
    else:
        modulated = model_curve

    return np.clip(modulated, floor_mw, ceiling_mw)


def _compute_firm_wind_cf(seasonal_regime: str, offshore_share: float) -> float:
    """
    Retorna o fator de capacidade firme crítico na calmaria diferenciando regime sazonal
    (Safra vs. Calmaria Úmida vs. Anual) e participação marginal de eólica offshore pós-2031.
    """
    if seasonal_regime == "wet_calm":
        cf_onshore = float(MONTE_CARLO_PARAMS["firmWindCfWetCalm"])
    elif seasonal_regime == "dry_windy":
        cf_onshore = float(MONTE_CARLO_PARAMS["firmWindCfDryWindy"])
    else:
        cf_onshore = float(MONTE_CARLO_PARAMS["firmWindCfBase"])

    if offshore_share <= 0.0:
        return cf_onshore

    offshore_marg_cf = float(MONTE_CARLO_PARAMS["firmWindCfOffshoreMarginal"])
    blend_mult = float(MONTE_CARLO_PARAMS["offshoreMarginalBlendMult"])
    offshore_weight = min(0.5, max(0.0, offshore_share * blend_mult))
    return (1.0 - offshore_weight) * cf_onshore + offshore_weight * offshore_marg_cf


_MC_VECTOR_CHUNK_SIZE = 2000


def _evaluate_bootstrap_batch(
    b_idx: np.ndarray,
    load_noise: np.ndarray,
    sim_wind_completion: np.ndarray,
    sim_wind_regime: np.ndarray,
    dc_jitter: np.ndarray,
    arrays: Dict[str, np.ndarray],
    dc_load_mw: float,
    wind_capacity_mw: float,
    offshore_share: float,
    structural_load_growth: float,
    solar_growth: float,
    import_limit_mw: float,
    export_limit_mw: float,
    h2v_nominal_mw: float,
    h2v_flexible: bool,
    block_size: int,
    offshore_cf_gain: float,
    cf_ceiling: float,
    h2v_cfg: Tuple[float, float, int, int, float, float, int, int, float, float, float],
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Núcleo matricial vetorizado (shape: [batch_n, block_size]) do Balanço Horário NE.
    Substitui o loop Python iteração-a-iteração preservando exatamente as equações físicas.
    """
    cf_arr = arrays["cf"]
    load_arr = arrays["load"]
    solar_arr = arrays["solar"]
    hour_arr = arrays.get("hour")
    month_arr = arrays.get("month")
    hydro_arr = arrays.get("hydro")
    thermal_arr = arrays.get("thermal")

    batch_n = int(len(b_idx))
    block_offsets = np.arange(block_size, dtype=np.intp)[None, :]
    idx_mat = b_idx[:, None].astype(np.intp) * block_size + block_offsets

    cf_block = cf_arr[idx_mat]
    load_block = load_arr[idx_mat] * structural_load_growth
    solar_block = solar_arr[idx_mat] * solar_growth
    month_block = month_arr[idx_mat] if month_arr is not None else None
    hydro_block = hydro_arr[idx_mat] if hydro_arr is not None else None
    thermal_block = thermal_arr[idx_mat] if thermal_arr is not None else None

    sim_base_load = load_block * load_noise[:, None]
    effective_cf = np.clip(
        cf_block * sim_wind_regime[:, None] + offshore_share * offshore_cf_gain * (1.0 - cf_block),
        0.0,
        cf_ceiling,
    )
    sim_wind_gen = effective_cf * (wind_capacity_mw * sim_wind_completion[:, None])
    sim_dc_load = dc_load_mw * dc_jitter[:, None] if dc_load_mw > 0.0 else 0.0

    hydro_thermal_mw = _compute_chesf_hydro_thermal_dispatch(
        sim_base_load,
        sim_wind_gen,
        solar_block,
        month_arr=month_block,
        obs_hydro_mw=hydro_block,
        obs_thermal_mw=thermal_block,
    )
    total_gen = sim_wind_gen + solar_block + hydro_thermal_mw
    export_threshold = np.maximum(0.0, export_limit_mw - EXPORT_SOLAR_CURTAILMENT_COEF * solar_block)

    (
        inflex_factor,
        h2v_high_cf,
        h2v_sol_hmin,
        h2v_sol_hmax,
        h2v_sol_cf,
        h2v_low_cf,
        h2v_pk_hmin,
        h2v_pk_hmax,
        h2v_high_f,
        h2v_mid_f,
        h2v_low_f,
    ) = h2v_cfg

    if h2v_nominal_mw > 0.0:
        if h2v_flexible:
            if hour_arr is not None:
                hr_block = hour_arr[idx_mat]
            else:
                hr_block = np.broadcast_to(
                    np.arange(block_size, dtype=np.int32) % HOURS_PER_DAY,
                    (batch_n, block_size),
                )
            pre_h2v_margin = total_gen - (sim_base_load + sim_dc_load)
            curtail_surplus_active = pre_h2v_margin >= export_threshold
            flex_factor = np.where(
                (effective_cf >= h2v_high_cf)
                | curtail_surplus_active
                | ((hr_block >= h2v_sol_hmin) & (hr_block <= h2v_sol_hmax) & (effective_cf >= h2v_sol_cf)),
                h2v_high_f,
                np.where(
                    (effective_cf < h2v_low_cf) | ((hr_block >= h2v_pk_hmin) & (hr_block <= h2v_pk_hmax)),
                    h2v_low_f,
                    h2v_mid_f,
                ),
            )
            sim_h2v_block = h2v_nominal_mw * flex_factor
        else:
            sim_h2v_block = np.full((batch_n, block_size), h2v_nominal_mw * inflex_factor, dtype=float)
        h2v_means = np.mean(sim_h2v_block, axis=1)
    else:
        sim_h2v_block = 0.0
        h2v_means = np.zeros(batch_n, dtype=float)

    margin_no_dc = total_gen - sim_base_load
    margin_with_dc = total_gen - (sim_base_load + sim_dc_load + sim_h2v_block)

    import_no_dc = np.maximum(0.0, -margin_no_dc)
    import_with_dc = np.maximum(0.0, -margin_with_dc)

    peak_imp_no_dc = np.max(import_no_dc, axis=1)
    peak_imp = np.max(import_with_dc, axis=1)
    min_margin = np.min(margin_with_dc, axis=1)

    scale_to_year = float(HOURS_PER_YEAR) / float(block_size)
    exceed_hrs = np.sum(import_with_dc > import_limit_mw, axis=1) * scale_to_year

    curt_no_dc_mw = np.maximum(0.0, margin_no_dc - export_threshold)
    curt_dc_mw = np.maximum(0.0, margin_with_dc - export_threshold)
    curt_no_dc_twh = np.sum(curt_no_dc_mw, axis=1) * scale_to_year / 1e6
    curt_dc_twh = np.sum(curt_dc_mw, axis=1) * scale_to_year / 1e6

    return (
        peak_imp_no_dc,
        peak_imp,
        min_margin,
        exceed_hrs,
        curt_no_dc_twh,
        curt_dc_twh,
        h2v_means,
    )


def simulate_block_bootstrap(
    cenario_nome: str,
    cenario_dc_id: str,
    target_year: int,
    dc_load_mw: float,
    wind_onshore_mw: float,
    wind_offshore_mw: float,
    n_iterations: int,
    seed: int,
    arrays: Dict[str, np.ndarray],
    import_limit_mw: float = INTERCHANGE_IMPORT_LIMIT_MW,
    export_limit_mw: float = INTERCHANGE_EXPORT_LIMIT_MW,
    h2v_nominal_mw: float = 0.0,
    h2v_flexible: bool = False,
    cenario_eolica_id: str = "",
    seasonal_regime: str = "annual_blend",
) -> Dict[str, Any]:
    """
    Núcleo estocástico Block-Bootstrap vetorizado em chunks matriciais (blocos semanais escalados para
    base anual de HOURS_PER_YEAR) compartilhado entre os Passos 4 (Script 06) e 5 (Script 07).
    """
    if n_iterations < 1:
        raise ValueError(f"n_iterations deve ser >= 1, recebido {n_iterations}.")

    rng = np.random.default_rng(seed)
    cf_arr = arrays["cf"]
    block_size = int(BLOCK_SIZE_HOURS)
    n_blocks = max(1, len(cf_arr) // block_size)

    years_from_baseline = max(0, target_year - BASELINE_YEAR)
    structural_load_growth = (1.0 + ANNUAL_LOAD_GROWTH_RATE) ** years_from_baseline
    solar_growth = 1.0 + ANNUAL_SOLAR_GROWTH_RATE * years_from_baseline
    wind_capacity_mw = wind_onshore_mw + wind_offshore_mw
    offshore_share = wind_offshore_mw / max(1.0, wind_capacity_mw)

    load_noise_std = float(MONTE_CARLO_PARAMS["loadNoiseStd"])
    wind_comp_min = float(MONTE_CARLO_PARAMS["windCompletionMin"])
    wind_comp_max = float(MONTE_CARLO_PARAMS["windCompletionMax"])
    wind_reg_min = float(MONTE_CARLO_PARAMS["windRegimeMin"])
    wind_reg_max = float(MONTE_CARLO_PARAMS["windRegimeMax"])
    offshore_cf_gain = float(MONTE_CARLO_PARAMS["offshoreCfGain"])
    cf_ceiling = float(MONTE_CARLO_PARAMS["cfCeiling"])
    dc_jit_min = float(MONTE_CARLO_PARAMS["dcLoadJitterMin"])
    dc_jit_max = float(MONTE_CARLO_PARAMS["dcLoadJitterMax"])

    h2v_cfg = (
        float(H2V_FLEX_PARAMS["inflexibleLoadFactor"]),
        float(H2V_FLEX_PARAMS["flexHighCfThreshold"]),
        int(H2V_FLEX_PARAMS["flexSolarHourMin"]),
        int(H2V_FLEX_PARAMS["flexSolarHourMax"]),
        float(H2V_FLEX_PARAMS["flexSolarCfThreshold"]),
        float(H2V_FLEX_PARAMS["flexLowCfThreshold"]),
        int(H2V_FLEX_PARAMS["flexPeakHourMin"]),
        int(H2V_FLEX_PARAMS["flexPeakHourMax"]),
        float(H2V_FLEX_PARAMS["flexHighFactor"]),
        float(H2V_FLEX_PARAMS["flexMidFactor"]),
        float(H2V_FLEX_PARAMS["flexLowFactor"]),
    )

    peak_imports = np.empty(n_iterations, dtype=float)
    peak_imports_no_dc = np.empty(n_iterations, dtype=float)
    exceed_hours_annual = np.empty(n_iterations, dtype=float)
    curt_with_dc_twh = np.empty(n_iterations, dtype=float)
    curt_without_dc_twh = np.empty(n_iterations, dtype=float)
    min_margins_mw = np.empty(n_iterations, dtype=float)
    h2v_means_mw = np.empty(n_iterations, dtype=float)

    chunk_size = int(_MC_VECTOR_CHUNK_SIZE)
    for start_i in range(0, n_iterations, chunk_size):
        end_i = min(n_iterations, start_i + chunk_size)
        cur_n = end_i - start_i

        b_idx = rng.integers(0, n_blocks, size=cur_n)
        load_noise = rng.normal(1.0, load_noise_std, size=cur_n)
        sim_wind_completion = rng.uniform(wind_comp_min, wind_comp_max, size=cur_n)
        sim_wind_regime = rng.uniform(wind_reg_min, wind_reg_max, size=cur_n)
        dc_jitter = rng.uniform(dc_jit_min, dc_jit_max, size=cur_n)

        (
            peak_imports_no_dc[start_i:end_i],
            peak_imports[start_i:end_i],
            min_margins_mw[start_i:end_i],
            exceed_hours_annual[start_i:end_i],
            curt_without_dc_twh[start_i:end_i],
            curt_with_dc_twh[start_i:end_i],
            h2v_means_mw[start_i:end_i],
        ) = _evaluate_bootstrap_batch(
            b_idx=b_idx,
            load_noise=load_noise,
            sim_wind_completion=sim_wind_completion,
            sim_wind_regime=sim_wind_regime,
            dc_jitter=dc_jitter,
            arrays=arrays,
            dc_load_mw=dc_load_mw,
            wind_capacity_mw=wind_capacity_mw,
            offshore_share=offshore_share,
            structural_load_growth=structural_load_growth,
            solar_growth=solar_growth,
            import_limit_mw=import_limit_mw,
            export_limit_mw=export_limit_mw,
            h2v_nominal_mw=h2v_nominal_mw,
            h2v_flexible=h2v_flexible,
            block_size=block_size,
            offshore_cf_gain=offshore_cf_gain,
            cf_ceiling=cf_ceiling,
            h2v_cfg=h2v_cfg,
        )

    p50_import = float(np.percentile(peak_imports, 50))
    p90_import = float(np.percentile(peak_imports, 90))
    p95_import = float(np.percentile(peak_imports, 95))
    prob_critical = float(np.mean(peak_imports > import_limit_mw) * 100.0)
    lole_hours = float(np.mean(exceed_hours_annual))

    avg_curt_no_dc = float(np.mean(curt_without_dc_twh))
    avg_curt_dc = float(np.mean(curt_with_dc_twh))
    avoided_gwh = float(max(0.0, (avg_curt_no_dc - avg_curt_dc) * 1000.0))
    avoided_pct = float((avoided_gwh / max(1.0, avg_curt_no_dc * 1000.0)) * 100.0)

    # Expansão eólica compensatória necessária diferenciada por regime e offshore (Seção 8 do PDF)
    cf_firme_critico = _compute_firm_wind_cf(seasonal_regime, offshore_share)
    excess_import_p95 = max(0.0, p95_import - import_limit_mw)
    req_extra_wind_gw = (excess_import_p95 / cf_firme_critico) / 1000.0

    result: Dict[str, Any] = {
        "cenario_nome": cenario_nome,
        "cenario_dc": cenario_dc_id,
        "target_year": target_year,
        "dc_load_mw": round(dc_load_mw, 1),
        "h2v_avg_mw": round(float(np.mean(h2v_means_mw)), 1),
        "wind_onshore_mw": round(wind_onshore_mw, 1),
        "wind_offshore_mw": round(wind_offshore_mw, 1),
        "wind_capacity_mw": round(wind_capacity_mw, 1),
        "prob_exceder_intercambio_pct": round(prob_critical, 1),
        "lole_horas_criticas_ano": round(lole_hours, 1),
        "importacao_p50_mw": round(p50_import, 1),
        "importacao_p90_mw": round(p90_import, 1),
        "importacao_p95_mw": round(p95_import, 1),
        "margem_minima_p5_mw": round(float(np.percentile(min_margins_mw, 5)), 1),
        "curtailment_sem_dc_twh_ano": round(avg_curt_no_dc, 2),
        "curtailment_com_dc_twh_ano": round(avg_curt_dc, 2),
        "curtailment_evitado_gwh_ano": round(avoided_gwh, 1),
        "reducao_curtailment_pct": round(avoided_pct, 1),
        "expansao_eolica_compensatoria_gw": round(req_extra_wind_gw, 2),
    }
    if cenario_eolica_id:
        result["cenario_eolica"] = cenario_eolica_id
    if seasonal_regime:
        result["regime_sazonal"] = seasonal_regime
    return result


def _simulate_scenario_worker(
    args: Tuple[str, str, int, float, float, float, int, int, Dict[str, np.ndarray], str]
) -> Dict[str, Any]:
    """
    Worker executado em multiprocessing.Pool para simular N blocos semanais estocásticos
    escalados para base anual (HOURS_PER_YEAR).
    """
    (
        cenario_nome,
        cenario_dc_id,
        target_year,
        dc_load_mw,
        wind_onshore_mw,
        wind_offshore_mw,
        n_iterations,
        seed,
        arrays,
        cenario_eolica_id,
    ) = args
    result = simulate_block_bootstrap(
        cenario_nome=cenario_nome,
        cenario_dc_id=cenario_dc_id,
        target_year=target_year,
        dc_load_mw=dc_load_mw,
        wind_onshore_mw=wind_onshore_mw,
        wind_offshore_mw=wind_offshore_mw,
        n_iterations=n_iterations,
        seed=seed,
        arrays=arrays,
        cenario_eolica_id=cenario_eolica_id,
    )
    result.pop("h2v_avg_mw", None)
    return result


def compute_project_ramp_for_year(
    ano_alvo: int,
    ano_inicio: int,
    rampa_meses: int,
    atraso_anos: float = 0.0,
) -> float:
    """Calcula a fração de rampa (0.0 a 1.0) de um projeto individual para um determinado ano."""
    data_efetiva = ano_inicio + atraso_anos
    if ano_alvo < data_efetiva:
        return 0.0
    meses_decorridos = (ano_alvo - data_efetiva) * 12.0 + 6.0
    fator = meses_decorridos / max(1.0, float(rampa_meses))
    return float(np.clip(fator, 0.0, 1.0))


def run_bottom_up_project_monte_carlo(
    base_df: pd.DataFrame,
    pipeline_df: pd.DataFrame,
    target_year: int = TARGET_END_YEAR,
    wind_capacity_mw: float = BASE_WIND_ONSHORE_2026_MW + WIND_EXPANSION_ONSHORE_MW["intermediate"],
    n_iterations: int = int(MONTE_CARLO_PARAMS["iterationsBottomUp"]),
    block_size_hours: int = BLOCK_SIZE_HOURS,
    seed: int = int(MONTE_CARLO_PARAMS["seed"]),
    wind_offshore_mw: float = 0.0,
) -> Tuple[Dict[str, Any], pd.DataFrame, pd.DataFrame]:
    """
    Executa a amostragem estocástica bottom-up vetorizada dos projetos nominais:
    Bernoulli(p) de concretização + Uniforme(0, delay_mult*atraso) + agregação matricial por Subestação.
    """
    if n_iterations < 1:
        raise ValueError(f"n_iterations deve ser >= 1, recebido {n_iterations}.")

    rng = np.random.default_rng(seed)
    arrays = _prepare_seasonal_blocks(base_df)
    cf_array = arrays["cf"]
    base_load_array = arrays["load"]
    solar_array = arrays["solar"]
    month_array = arrays.get("month")
    hydro_array = arrays.get("hydro")
    thermal_array = arrays.get("thermal")
    total_hours = len(cf_array)
    n_blocks = max(1, total_hours // block_size_hours)
    scale_to_year = float(HOURS_PER_YEAR) / float(block_size_hours)

    years_from_baseline = max(0, target_year - BASELINE_YEAR)
    structural_growth = (1.0 + ANNUAL_LOAD_GROWTH_RATE) ** years_from_baseline
    solar_growth = 1.0 + ANNUAL_SOLAR_GROWTH_RATE * years_from_baseline

    delay_mult = float(MONTE_CARLO_PARAMS["projectDelayMultiplier"])
    util_min = float(MONTE_CARLO_PARAMS["projectUtilMin"])
    util_max = float(MONTE_CARLO_PARAMS["projectUtilMax"])
    load_noise_std = float(MONTE_CARLO_PARAMS["loadNoiseStd"])
    wind_comp_min = float(MONTE_CARLO_PARAMS["windCompletionMin"])
    wind_comp_max = float(MONTE_CARLO_PARAMS["windCompletionMax"])
    wind_reg_min = float(MONTE_CARLO_PARAMS["windRegimeMin"])
    wind_reg_max = float(MONTE_CARLO_PARAMS["windRegimeMax"])
    offshore_cf_gain = float(MONTE_CARLO_PARAMS["offshoreCfGain"])
    cf_ceiling = float(MONTE_CARLO_PARAMS["cfCeiling"])
    offshore_share = wind_offshore_mw / max(1.0, wind_capacity_mw)

    sub_keys: List[Tuple[str, str, int]] = [
        (str(sub), str(est), int(kv))
        for (sub, est, kv), _ in pipeline_df.groupby(
            ["subestacao_conexao", "estado", "tensao_conexao_kv"], sort=False
        )
    ]
    sub_idx_map = {k: idx for idx, k in enumerate(sub_keys)}

    n_proj = len(pipeline_df)
    prob_ok_vec = pipeline_df["probabilidade_concretizacao"].to_numpy(dtype=float)
    atraso_max_vec = np.maximum(0.1, pipeline_df["atraso_esperado_anos"].to_numpy(dtype=float) * delay_mult)
    ano_inicio_vec = pipeline_df["ano_inicio_previsto"].to_numpy(dtype=float)
    rampa_meses_vec = np.maximum(1.0, pipeline_df["rampa_meses"].to_numpy(dtype=float))
    is_total_rede = pipeline_df["tipo_publicacao"].astype(str).to_numpy() == "potencia_total_rede"
    p_rede_vec = np.where(
        is_total_rede,
        pd.to_numeric(pipeline_df["potencia_total_rede_mw"], errors="coerce").fillna(0.0).to_numpy(dtype=float),
        pd.to_numeric(pipeline_df["potencia_it_mw"], errors="coerce").fillna(0.0).to_numpy(dtype=float)
        * pd.to_numeric(pipeline_df["pue_estimado"], errors="coerce").fillna(DEFAULT_PUE).to_numpy(dtype=float),
    )

    sub_indicator = np.zeros((n_proj, len(sub_keys)), dtype=float)
    for p_idx, (_, proj) in enumerate(pipeline_df.iterrows()):
        s_key = (str(proj["subestacao_conexao"]), str(proj["estado"]), int(proj["tensao_conexao_kv"]))
        sub_indicator[p_idx, sub_idx_map[s_key]] = 1.0

    # Amostragem matricial vetorizada dos N projetos (n_iterations x n_proj)
    is_realized = rng.random((n_iterations, n_proj)) <= prob_ok_vec[None, :]
    stochastic_delay = rng.uniform(0.0, 1.0, size=(n_iterations, n_proj)) * atraso_max_vec[None, :]
    data_efetiva = ano_inicio_vec[None, :] + stochastic_delay
    meses_decorridos = (float(target_year) - data_efetiva) * 12.0 + 6.0
    ramps = np.where(
        float(target_year) >= data_efetiva,
        np.clip(meses_decorridos / rampa_meses_vec[None, :], 0.0, 1.0),
        0.0,
    )
    sim_util = rng.uniform(util_min, util_max, size=(n_iterations, n_proj))
    active_mask = is_realized & (ramps > 0.0)
    proj_demands = np.where(active_mask, p_rede_vec[None, :] * sim_util * ramps, 0.0)

    total_dc_loads = np.sum(proj_demands, axis=1)
    active_projects_counts = np.sum(active_mask, axis=1)
    sub_loads_mat = proj_demands @ sub_indicator

    peak_imports = np.empty(n_iterations, dtype=float)
    curtailment_dc_mwh = np.empty(n_iterations, dtype=float)
    block_offsets = np.arange(block_size_hours, dtype=np.intp)[None, :]
    chunk_size = int(_MC_VECTOR_CHUNK_SIZE)

    for start_i in range(0, n_iterations, chunk_size):
        end_i = min(n_iterations, start_i + chunk_size)
        cur_n = end_i - start_i

        b_idx = rng.integers(0, n_blocks, size=cur_n)
        idx_mat = b_idx[:, None].astype(np.intp) * block_size_hours + block_offsets

        cf_block = cf_array[idx_mat]
        load_block = base_load_array[idx_mat] * structural_growth
        solar_block = solar_array[idx_mat] * solar_growth
        month_block = month_array[idx_mat] if month_array is not None else None
        hydro_block = hydro_array[idx_mat] if hydro_array is not None else None
        thermal_block = thermal_array[idx_mat] if thermal_array is not None else None

        load_noise = rng.normal(1.0, load_noise_std, size=(cur_n, 1))
        sim_base_load = load_block * load_noise
        sim_wind_completion = rng.uniform(wind_comp_min, wind_comp_max, size=(cur_n, 1))
        sim_wind_regime = rng.uniform(wind_reg_min, wind_reg_max, size=(cur_n, 1))
        effective_cf = np.clip(
            cf_block * sim_wind_regime + offshore_share * offshore_cf_gain * (1.0 - cf_block),
            0.0,
            cf_ceiling,
        )
        sim_wind_gen = effective_cf * (wind_capacity_mw * sim_wind_completion)

        hydro_thermal_mw = _compute_chesf_hydro_thermal_dispatch(
            sim_base_load,
            sim_wind_gen,
            solar_block,
            month_arr=month_block,
            obs_hydro_mw=hydro_block,
            obs_thermal_mw=thermal_block,
        )
        total_gen = sim_wind_gen + solar_block + hydro_thermal_mw
        margin_with_dc = total_gen - (sim_base_load + total_dc_loads[start_i:end_i, None])

        import_needed = np.maximum(0.0, -margin_with_dc)
        peak_imports[start_i:end_i] = np.max(import_needed, axis=1)

        export_threshold = np.maximum(0.0, INTERCHANGE_EXPORT_LIMIT_MW - EXPORT_SOLAR_CURTAILMENT_COEF * solar_block)
        curtailment_dc_mwh[start_i:end_i] = np.sum(np.maximum(0.0, margin_with_dc - export_threshold), axis=1) * scale_to_year

    p50_dc = float(np.percentile(total_dc_loads, 50))
    p90_dc = float(np.percentile(total_dc_loads, 90))
    p95_dc = float(np.percentile(total_dc_loads, 95))
    p50_import = float(np.percentile(peak_imports, 50))
    p95_import = float(np.percentile(peak_imports, 95))
    prob_critical = float(np.mean(peak_imports > INTERCHANGE_IMPORT_LIMIT_MW) * 100.0)

    cf_firme_critico = _compute_firm_wind_cf("annual_blend", offshore_share)
    excess_import = max(0.0, p95_import - INTERCHANGE_IMPORT_LIMIT_MW)
    req_extra_wind_mw = excess_import / cf_firme_critico

    bottom_up_summary = {
        "target_year": target_year,
        "n_iterations": n_iterations,
        "projetos_ativos_media": round(float(np.mean(active_projects_counts)), 1),
        "dc_load_p50_mw": round(p50_dc, 1),
        "dc_load_p90_mw": round(p90_dc, 1),
        "dc_load_p95_mw": round(p95_dc, 1),
        "prob_exceder_intercambio_pct": round(prob_critical, 2),
        "importacao_p50_mw": round(p50_import, 1),
        "importacao_p95_mw": round(p95_import, 1),
        "curtailment_com_dc_twh_ano": round(float(np.mean(curtailment_dc_mwh) / 1e6), 2),
        "expansao_eolica_compensatoria_gw": round(req_extra_wind_mw / 1000.0, 2),
    }

    grouped_meta = pipeline_df.groupby(
        ["subestacao_conexao", "estado", "tensao_conexao_kv"], as_index=False
    ).agg(n_projetos=("id_projeto", "count"))
    n_proj_map: Dict[Tuple[str, str, int], int] = {
        (str(r["subestacao_conexao"]), str(r["estado"]), int(r["tensao_conexao_kv"])): int(r["n_projetos"])
        for _, r in grouped_meta.iterrows()
    }

    mean_total_dc = max(1.0, float(np.mean(total_dc_loads)))
    sub_records = []
    for k_idx, (sub, estado, tensao_kv) in enumerate(sub_keys):
        arr = sub_loads_mat[:, k_idx]
        sub_records.append({
            "subestacao": sub,
            "estado": estado,
            "tensao_kv": tensao_kv,
            "n_projetos": n_proj_map[(sub, estado, tensao_kv)],
            "carga_media_mw": round(float(np.mean(arr)), 1),
            "carga_p50_mw": round(float(np.percentile(arr, 50)), 1),
            "carga_p95_mw": round(float(np.percentile(arr, 95)), 1),
            "fracao_carga_total_pct": round(float(np.mean(arr) / mean_total_dc * 100.0), 1),
        })

    df_substations_risk = pd.DataFrame(sub_records).sort_values("carga_p95_mw", ascending=False)
    df_summary = pd.DataFrame([bottom_up_summary])
    return bottom_up_summary, df_summary, df_substations_risk


def build_and_export_hourly_baseline_8760(
    base_df: pd.DataFrame,
    csv_out_path: Path | None = None,
    json_out_path: Path | None = None,
) -> Dict[str, Any]:
    """
    Constrói a série horária anual real completa de 8.760 horas (00h de 01/Jan a 23h de 31/Dez)
    a partir da base histórica observada do ONS em ne_hourly_master.csv (2022–2025):
      - annual_blend: ano empírico baseline (BASELINE_YEAR = 2025) real completo
      - dry_windy: para cada semana do calendário (0..52), semana observada (2022–2025) de maior CF eólico médio
      - wet_calm: para cada semana do calendário (0..52), semana observada (2022–2025) de menor CF eólico médio
    Exporta reports/serie_base_horaria_8760h_ons.csv e public/data/hourly-baseline-8760.json (formato colunar compacto).
    """
    df = base_df.copy()
    ts = pd.to_datetime(df["ts"])
    df["ts"] = ts
    df["year"] = ts.dt.year
    df["month"] = ts.dt.month
    df["day"] = ts.dt.day
    df["hour"] = df["hour"].astype(int) if "hour" in df.columns else ts.dt.hour.astype(int)

    # Normaliza para calendário padrão de 365 dias (8.760 h), removendo 29/Fev em anos bissextos
    df = df[~((df["month"] == 2) & (df["day"] == 29))].copy()
    modern = df[df["year"] >= MODERN_BLOCK_START_YEAR].copy()
    if modern["year"].nunique() == 0:
        modern = df.copy()

    if "g_hidro_mw" not in modern.columns and "g_hidraulica_mw" in modern.columns:
        modern["g_hidro_mw"] = modern["g_hidraulica_mw"]

    value_cols = ["l_base_mw", "cf_eolica", "g_solar_mw", "g_hidro_mw", "g_termica_mw", "curtailment_mw"]
    for col in value_cols:
        if col not in modern.columns:
            modern[col] = 0.0
        modern[col] = pd.to_numeric(modern[col], errors="coerce").fillna(0.0)

    # Grade canônica de 8.760 timestamps do ano-base não-bissexto (BASELINE_YEAR)
    cal_ts = pd.date_range(f"{BASELINE_YEAR}-01-01 00:00:00", periods=HOURS_PER_YEAR, freq="h")
    cal_df = pd.DataFrame({
        "hour_index": np.arange(HOURS_PER_YEAR, dtype=int),
        "ts": cal_ts.strftime("%Y-%m-%d %H:%M:%S"),
        "month": cal_ts.month.astype(int),
        "day": cal_ts.day.astype(int),
        "hour": cal_ts.hour.astype(int),
        "week_slot": np.arange(HOURS_PER_YEAR, dtype=int) // BLOCK_SIZE_HOURS,
    })

    # Índice auxiliar por (year, month, day, hour) e médias reais por (month, day, hour) caso falte hora isolada
    slot_lookup: Dict[Tuple[int, int, int, int], Dict[str, float]] = {}
    for _, row in modern.iterrows():
        key = (int(row["year"]), int(row["month"]), int(row["day"]), int(row["hour"]))
        slot_lookup[key] = {c: float(row[c]) for c in value_cols}

    modern_slot_means = (
        modern.groupby(["month", "day", "hour"], as_index=False)[value_cols]
        .mean()
        .set_index(["month", "day", "hour"])
    )

    available_years = sorted(int(y) for y in modern["year"].unique())
    modern_with_cal = modern.merge(
        cal_df[["month", "day", "hour", "week_slot"]],
        on=["month", "day", "hour"],
        how="inner",
    )
    week_year_cf = modern_with_cal.groupby(["week_slot", "year"])["cf_eolica"].mean()

    regime_year_by_week: Dict[str, Dict[int, int]] = {"annual_blend": {}, "dry_windy": {}, "wet_calm": {}}
    for w_slot in range(int(cal_df["week_slot"].max()) + 1):
        regime_year_by_week["annual_blend"][w_slot] = (
            BASELINE_YEAR if BASELINE_YEAR in available_years else available_years[-1]
        )
        if w_slot in week_year_cf.index.get_level_values(0):
            sub = week_year_cf.loc[w_slot]
            regime_year_by_week["dry_windy"][w_slot] = int(sub.idxmax())
            regime_year_by_week["wet_calm"][w_slot] = int(sub.idxmin())
        else:
            regime_year_by_week["dry_windy"][w_slot] = regime_year_by_week["annual_blend"][w_slot]
            regime_year_by_week["wet_calm"][w_slot] = regime_year_by_week["annual_blend"][w_slot]

    regimes_columnar: Dict[str, Dict[str, List[float]]] = {}
    csv_regime_frames: Dict[str, pd.DataFrame] = {}

    for regime_id in ("annual_blend", "dry_windy", "wet_calm"):
        rows_dict: Dict[str, List[float]] = {c: [] for c in value_cols}
        for _, cal_row in cal_df.iterrows():
            m = int(cal_row["month"])
            d = int(cal_row["day"])
            h = int(cal_row["hour"])
            w_slot = int(cal_row["week_slot"])
            pref_year = regime_year_by_week[regime_id][w_slot]
            rec = slot_lookup.get((pref_year, m, d, h))
            if rec is None:
                for fallback_yr in reversed(available_years):
                    rec = slot_lookup.get((fallback_yr, m, d, h))
                    if rec is not None:
                        break
            if rec is None and (m, d, h) in modern_slot_means.index:
                mean_row = modern_slot_means.loc[(m, d, h)]
                rec = {c: float(mean_row[c]) for c in value_cols}
            if rec is None:
                rec = {c: 0.0 for c in value_cols}
            for c in value_cols:
                rows_dict[c].append(rec[c])

        csv_regime_frames[regime_id] = pd.DataFrame(rows_dict)
        regimes_columnar[regime_id] = {
            "lBaseMW": [round(float(v), 1) for v in rows_dict["l_base_mw"]],
            "cfWind": [round(float(v), 4) for v in rows_dict["cf_eolica"]],
            "gSolarMW": [round(float(v), 1) for v in rows_dict["g_solar_mw"]],
            "gHydroMW": [round(float(v), 1) for v in rows_dict["g_hidro_mw"]],
            "gThermalMW": [round(float(v), 1) for v in rows_dict["g_termica_mw"]],
            "curtailmentMW": [round(float(v), 1) for v in rows_dict["curtailment_mw"]],
        }

    csv_df = cal_df[["hour_index", "ts", "month", "day", "hour"]].copy()
    for c in value_cols:
        csv_df[c] = csv_regime_frames["annual_blend"][c].round(4 if c == "cf_eolica" else 1)
    csv_df["l_base_dry_windy_mw"] = csv_regime_frames["dry_windy"]["l_base_mw"].round(1)
    csv_df["cf_eolica_dry_windy"] = csv_regime_frames["dry_windy"]["cf_eolica"].round(4)
    csv_df["g_solar_dry_windy_mw"] = csv_regime_frames["dry_windy"]["g_solar_mw"].round(1)
    csv_df["l_base_wet_calm_mw"] = csv_regime_frames["wet_calm"]["l_base_mw"].round(1)
    csv_df["cf_eolica_wet_calm"] = csv_regime_frames["wet_calm"]["cf_eolica"].round(4)
    csv_df["g_solar_wet_calm_mw"] = csv_regime_frames["wet_calm"]["g_solar_mw"].round(1)

    target_csv = csv_out_path or (REPORTS_DIR / HOURLY_BASELINE_CSV_FILENAME)
    target_csv.parent.mkdir(parents=True, exist_ok=True)
    csv_df.to_csv(target_csv, index=False, lineterminator="\n")

    digest_input = {
        "baselineYear": BASELINE_YEAR,
        "month": cal_df["month"].tolist(),
        "day": cal_df["day"].tolist(),
        "hour": cal_df["hour"].tolist(),
        "regimes": regimes_columnar,
    }
    digest = hashlib.sha256(
        json.dumps(digest_input, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]

    json_payload = {
        "schemaVersion": "1.0.0",
        "hoursCount": HOURS_PER_YEAR,
        "baselineYear": BASELINE_YEAR,
        "sourceWindow": f"{min(available_years)}–{max(available_years)} (ONS Real)",
        "generatedAtUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "digest": digest,
        "month": digest_input["month"],
        "day": digest_input["day"],
        "hour": digest_input["hour"],
        "regimes": regimes_columnar,
    }

    target_json = json_out_path or HOURLY_BASELINE_JSON_PATH
    target_json.parent.mkdir(parents=True, exist_ok=True)
    with open(target_json, "w", encoding="utf-8", newline="\n") as jf:
        jf.write(json.dumps(json_payload, ensure_ascii=False, separators=(",", ":")) + "\n")

    print(
        f"[BASELINE 8760h] Série real exportada ({len(csv_df)} h): "
        f"{target_csv.name} e {target_json.name} (digest={digest})"
    )
    return json_payload


def _simulate_grid_worker(
    args: Tuple[str, str, int, float, float, float, int, int, Dict[str, np.ndarray], str, str, float, float, float, float]
) -> Dict[str, Any]:
    (
        cenario_nome,
        dc_id,
        target_year,
        dc_load_mw,
        wind_onshore_mw,
        wind_offshore_mw,
        n_iter,
        seed,
        arrays,
        wind_id,
        seasonal_regime,
        pue_val,
        util_val,
        import_limit_mw,
        export_limit_mw,
    ) = args
    res = simulate_block_bootstrap(
        cenario_nome=cenario_nome,
        cenario_dc_id=dc_id,
        target_year=target_year,
        dc_load_mw=dc_load_mw,
        wind_onshore_mw=wind_onshore_mw,
        wind_offshore_mw=wind_offshore_mw,
        n_iterations=n_iter,
        seed=seed,
        arrays=arrays,
        import_limit_mw=import_limit_mw,
        export_limit_mw=export_limit_mw,
        cenario_eolica_id=wind_id,
        seasonal_regime=seasonal_regime,
    )
    return {
        "year": int(target_year),
        "dc_scenario": dc_id,
        "wind_scenario": wind_id,
        "seasonal_regime": seasonal_regime,
        "pue": round(float(pue_val), 2),
        "dc_utilization": round(float(util_val), 2),
        "import_limit_mw": round(float(import_limit_mw), 1),
        "export_limit_mw": round(float(export_limit_mw), 1),
        "dc_load_mw": res["dc_load_mw"],
        "wind_capacity_mw": res["wind_capacity_mw"],
        "prob_exceder_intercambio_pct": res["prob_exceder_intercambio_pct"],
        "lole_horas_criticas_ano": res["lole_horas_criticas_ano"],
        "importacao_p50_mw": res["importacao_p50_mw"],
        "importacao_p95_mw": res["importacao_p95_mw"],
        "curtailment_sem_dc_twh_ano": res["curtailment_sem_dc_twh_ano"],
        "curtailment_com_dc_twh_ano": res["curtailment_com_dc_twh_ano"],
        "curtailment_evitado_gwh_ano": res["curtailment_evitado_gwh_ano"],
        "expansao_eolica_compensatoria_gw": res["expansao_eolica_compensatoria_gw"],
    }


def export_simulator_monte_carlo_grid(
    base_df: pd.DataFrame,
    df_scen_matrix: pd.DataFrame,
    res_12: List[Dict[str, Any]],
    timeline_res: List[Dict[str, Any]],
    csv_out_path: Path | None = None,
) -> pd.DataFrame:
    """
    Gera a grade paramétrica pré-computada de Monte Carlo 2025–2035 (reports/grade_simulador_monte_carlo_2025_2035.csv)
    usando exclusivamente simulate_block_bootstrap(...) e ancorando exatamente os pontos nominais oficiais.
    """
    max_workers = int(MONTE_CARLO_PARAMS["maxWorkers"])
    n_workers = max(1, min(max_workers, os.cpu_count() or 2))
    n_iter_grid = int(MONTE_CARLO_PARAMS["iterationsSimulatorGrid"])
    mc_seed = int(MONTE_CARLO_PARAMS["seed"])

    regime_arrays = {
        reg: _prepare_seasonal_blocks(base_df, seasonal_regime=reg)
        for reg in ("annual_blend", "dry_windy", "wet_calm")
    }

    dc_order = [
        REFERENCE_SCENARIO_KEYS["dcControl"],
        REFERENCE_SCENARIO_KEYS["dcConservative"],
        REFERENCE_SCENARIO_KEYS["dcCentral"],
        REFERENCE_SCENARIO_KEYS["dcHigh"],
    ]
    wind_order = [
        REFERENCE_SCENARIO_KEYS["windBase"],
        REFERENCE_SCENARIO_KEYS["windIntermediate"],
        REFERENCE_SCENARIO_KEYS["windHigh"],
    ]

    scen_lookup: Dict[Tuple[int, str, str], Tuple[float, float, float]] = {}
    for _, r in df_scen_matrix.iterrows():
        scen_lookup[(int(r["ano"]), str(r["cenario_dc"]), str(r["cenario_eolica"]))] = (
            float(r["carga_efetiva_dc_mw"]),
            float(r["eolica_onshore_mw"]),
            float(r["eolica_offshore_mw"]),
        )
    for dc_id in dc_order:
        for w_id in wind_order:
            scen_lookup.setdefault(
                (BASELINE_YEAR, dc_id, w_id),
                (0.0, float(BASE_WIND_ONSHORE_2026_MW), 0.0),
            )

    anchor_12 = {
        (TARGET_END_YEAR, r["cenario_dc"], r.get("cenario_eolica", "")): r
        for r in res_12
    }
    anchor_tl = {
        (int(r["target_year"]), r["cenario_dc"], REFERENCE_SCENARIO_KEYS["windIntermediate"]): r
        for r in timeline_res
    }

    grid_rows: List[Dict[str, Any]] = []
    seen_keys: set[Tuple[int, str, str, str, float, float, float, float, float]] = set()
    tasks: List[Tuple[Any, ...]] = []

    def _enqueue(
        yr: int,
        dc_id: str,
        w_id: str,
        reg: str,
        pue_v: float,
        util_v: float,
        imp_lim: float,
        exp_lim: float,
        override_wind: Tuple[float, float] | None = None,
    ) -> None:
        base_dc_mw, scen_w_on, scen_w_off = scen_lookup[(yr, dc_id, w_id)]
        w_on, w_off = override_wind if override_wind is not None else (scen_w_on, scen_w_off)
        wind_total_mw = round(w_on + w_off, 1)
        key = (
            yr,
            dc_id,
            w_id,
            reg,
            round(pue_v, 2),
            round(util_v, 2),
            round(imp_lim, 1),
            round(exp_lim, 1),
            wind_total_mw,
        )
        if key in seen_keys:
            return
        seen_keys.add(key)

        is_nominal_params = (
            override_wind is None
            and reg == "annual_blend"
            and abs(pue_v - DEFAULT_PUE) < 1e-6
            and abs(util_v - DEFAULT_UTILIZATION) < 1e-6
            and abs(imp_lim - INTERCHANGE_IMPORT_LIMIT_MW) < 1e-6
            and abs(exp_lim - INTERCHANGE_EXPORT_LIMIT_MW) < 1e-6
        )
        if is_nominal_params:
            anchored = anchor_12.get((yr, dc_id, w_id)) or anchor_tl.get((yr, dc_id, w_id))
            if anchored is not None:
                grid_rows.append({
                    "year": yr,
                    "dc_scenario": dc_id,
                    "wind_scenario": w_id,
                    "seasonal_regime": reg,
                    "pue": round(pue_v, 2),
                    "dc_utilization": round(util_v, 2),
                    "import_limit_mw": round(imp_lim, 1),
                    "export_limit_mw": round(exp_lim, 1),
                    "dc_load_mw": anchored["dc_load_mw"],
                    "wind_capacity_mw": anchored["wind_capacity_mw"],
                    "prob_exceder_intercambio_pct": anchored["prob_exceder_intercambio_pct"],
                    "lole_horas_criticas_ano": anchored["lole_horas_criticas_ano"],
                    "importacao_p50_mw": anchored["importacao_p50_mw"],
                    "importacao_p95_mw": anchored["importacao_p95_mw"],
                    "curtailment_sem_dc_twh_ano": anchored["curtailment_sem_dc_twh_ano"],
                    "curtailment_com_dc_twh_ano": anchored["curtailment_com_dc_twh_ano"],
                    "curtailment_evitado_gwh_ano": anchored["curtailment_evitado_gwh_ano"],
                    "expansao_eolica_compensatoria_gw": anchored["expansao_eolica_compensatoria_gw"],
                })
                return

        scaled_dc_mw = (
            base_dc_mw * (pue_v / DEFAULT_PUE) * (util_v / DEFAULT_UTILIZATION)
            if base_dc_mw > 0.0
            else 0.0
        )
        tasks.append((
            f"Grid {yr} {dc_id}/{w_id} {reg}",
            dc_id,
            yr,
            scaled_dc_mw,
            w_on,
            w_off,
            n_iter_grid,
            mc_seed,
            regime_arrays[reg],
            w_id,
            reg,
            pue_v,
            util_v,
            imp_lim,
            exp_lim,
        ))

    # 1. Malha nominal completa 2025..2035 × 4 DC × 3 Eólica × 3 Regimes Sazonais
    from config import OFFSHORE_COMMERCIAL_START_YEAR, OFFSHORE_SCENARIO_MW_POST_2031, OFFSHORE_START_YEAR

    for yr in range(PROJECTION_START_YEAR, TARGET_END_YEAR + 1):
        for dc_id in dc_order:
            for w_id in wind_order:
                for reg in ("annual_blend", "dry_windy", "wet_calm"):
                    _enqueue(
                        yr,
                        dc_id,
                        w_id,
                        reg,
                        DEFAULT_PUE,
                        DEFAULT_UTILIZATION,
                        INTERCHANGE_IMPORT_LIMIT_MW,
                        INTERCHANGE_EXPORT_LIMIT_MW,
                    )
                    # Variante toggle Offshore pós-2031 para Alto (sem offshore) e Intermediário (com offshore)
                    if yr >= OFFSHORE_COMMERCIAL_START_YEAR:
                        _, base_on, base_off = scen_lookup[(yr, dc_id, w_id)]
                        if w_id == REFERENCE_SCENARIO_KEYS["windHigh"] and base_off > 0.0:
                            _enqueue(
                                yr,
                                dc_id,
                                w_id,
                                reg,
                                DEFAULT_PUE,
                                DEFAULT_UTILIZATION,
                                INTERCHANGE_IMPORT_LIMIT_MW,
                                INTERCHANGE_EXPORT_LIMIT_MW,
                                override_wind=(base_on, 0.0),
                            )
                        elif w_id == REFERENCE_SCENARIO_KEYS["windIntermediate"] and base_off == 0.0:
                            off_span = max(1.0, float(TARGET_END_YEAR - OFFSHORE_START_YEAR))
                            off_mw = round(
                                float(OFFSHORE_SCENARIO_MW_POST_2031[w_id])
                                * ((yr - OFFSHORE_START_YEAR) / off_span),
                                1,
                            )
                            _enqueue(
                                yr,
                                dc_id,
                                w_id,
                                reg,
                                DEFAULT_PUE,
                                DEFAULT_UTILIZATION,
                                INTERCHANGE_IMPORT_LIMIT_MW,
                                INTERCHANGE_EXPORT_LIMIT_MW,
                                override_wind=(base_on, off_mw),
                            )

    # 2. Fatias de sensibilidade paramétrica em anos-âncora (Intercâmbio TX e PUE × Utilização)
    sens_years = [int(y) for y in MONTE_CARLO_PARAMS["gridSensitivityYears"]]
    pue_values = [float(x) for x in MONTE_CARLO_PARAMS["gridPueValues"]]
    util_values = [float(x) for x in MONTE_CARLO_PARAMS["gridUtilizationValues"]]
    dc_central = REFERENCE_SCENARIO_KEYS["dcCentral"]
    wind_interm = REFERENCE_SCENARIO_KEYS["windIntermediate"]

    for yr in sens_years:
        for tx_spec in TX_SENSITIVITY_SPECS:
            _enqueue(
                yr,
                dc_central,
                wind_interm,
                "annual_blend",
                DEFAULT_PUE,
                DEFAULT_UTILIZATION,
                float(tx_spec["importLimitMW"]),
                float(tx_spec["exportLimitMW"]),
            )
        for dc_id in (
            REFERENCE_SCENARIO_KEYS["dcConservative"],
            dc_central,
            REFERENCE_SCENARIO_KEYS["dcHigh"],
        ):
            for pue_v in pue_values:
                for util_v in util_values:
                    _enqueue(
                        yr,
                        dc_id,
                        wind_interm,
                        "annual_blend",
                        pue_v,
                        util_v,
                        INTERCHANGE_IMPORT_LIMIT_MW,
                        INTERCHANGE_EXPORT_LIMIT_MW,
                    )

    # 3. Cobertura expandida para regimes de alto risco (Calmaria Úmida wet_calm & Stress Test high)
    for yr in [y for y in sens_years if y >= 2030]:
        for reg in ("wet_calm", "dry_windy"):
            for tx_spec in TX_SENSITIVITY_SPECS:
                _enqueue(
                    yr,
                    dc_central,
                    wind_interm,
                    reg,
                    DEFAULT_PUE,
                    DEFAULT_UTILIZATION,
                    float(tx_spec["importLimitMW"]),
                    float(tx_spec["exportLimitMW"]),
                )
    for yr in [y for y in sens_years if y >= 2032]:
        for dc_id in (dc_central, REFERENCE_SCENARIO_KEYS["dcHigh"]):
            for pue_v in pue_values:
                for util_v in util_values:
                    _enqueue(
                        yr,
                        dc_id,
                        wind_interm,
                        "wet_calm",
                        pue_v,
                        util_v,
                        INTERCHANGE_IMPORT_LIMIT_MW,
                        INTERCHANGE_EXPORT_LIMIT_MW,
                    )
    for reg in ("annual_blend", "wet_calm"):
        for tx_spec in TX_SENSITIVITY_SPECS:
            _enqueue(
                TARGET_END_YEAR,
                REFERENCE_SCENARIO_KEYS["dcHigh"],
                wind_interm,
                reg,
                DEFAULT_PUE,
                DEFAULT_UTILIZATION,
                float(tx_spec["importLimitMW"]),
                float(tx_spec["exportLimitMW"]),
            )

    print(
        f"[GRADE SIMULADOR 2025-2035] Executando {len(tasks)} pontos paramétricos "
        f"(+ {len(grid_rows)} âncoras oficiais) em {n_workers} processos..."
    )
    if tasks:
        with mp.Pool(processes=n_workers) as pool:
            grid_rows.extend(pool.map(_simulate_grid_worker, tasks))

    df_grid = pd.DataFrame(grid_rows).sort_values(
        ["year", "dc_scenario", "wind_scenario", "seasonal_regime", "pue", "dc_utilization", "import_limit_mw"]
    ).reset_index(drop=True)

    target_csv = csv_out_path or (REPORTS_DIR / SIMULATOR_GRID_CSV_FILENAME)
    target_csv.parent.mkdir(parents=True, exist_ok=True)
    df_grid.to_csv(target_csv, index=False, lineterminator="\n")
    print(f"[GRADE SIMULADOR 2025-2035] Exportados {len(df_grid)} cenários em {target_csv.name}")
    return df_grid


def main():
    print("=" * 72)
    print("Script 06 (Passo 4): Simulação Estocástica de Monte Carlo 2025-2035 (Multiprocessing)")
    print("=" * 72)

    input_master = PROCESSED_DATA_DIR / "ne_hourly_master.csv"
    if not input_master.exists():
        print(f"[ERRO] Base mestre não encontrada: {input_master}")
        sys.exit(1)

    df_base = pd.read_csv(input_master)
    build_and_export_hourly_baseline_8760(df_base)
    arrays = _prepare_seasonal_blocks(df_base)
    max_workers = int(MONTE_CARLO_PARAMS["maxWorkers"])
    n_workers = max(1, min(max_workers, os.cpu_count() or 2))
    n_iter_main = int(MONTE_CARLO_PARAMS["iterationsMain"])
    n_iter_timeline = int(MONTE_CARLO_PARAMS["iterationsTimeline"])
    n_iter_bottom_up = int(MONTE_CARLO_PARAMS["iterationsBottomUp"])
    mc_seed = int(MONTE_CARLO_PARAMS["seed"])

    scenario_matrix_path = SCENARIOS_DATA_DIR / "matriz_cenarios_dc_eolica_2026_2035.csv"
    if not scenario_matrix_path.exists():
        print(f"[ERRO] Matriz de cenários da Etapa 02 não encontrada: {scenario_matrix_path}")
        sys.exit(1)

    df_scen_matrix = pd.read_csv(scenario_matrix_path)
    df_scen_2035 = df_scen_matrix[df_scen_matrix["ano"] == TARGET_END_YEAR].copy()

    def _format_dc_label(dc_id: str, dc_mw: float) -> str:
        mw_str = f"{round(dc_mw):,.0f}".replace(",", ".")
        if dc_id == REFERENCE_SCENARIO_KEYS["dcControl"]:
            return "Sem Data Centers (Controle)"
        if dc_id == REFERENCE_SCENARIO_KEYS["dcConservative"]:
            return f"DC Conservador ({mw_str} MW rede)"
        if dc_id == REFERENCE_SCENARIO_KEYS["dcCentral"]:
            return f"DC Central Ponderado ({mw_str} MW rede)"
        return f"DC Stress Test / IA ({mw_str} MW rede)"

    def _format_wind_label(w_id: str, w_tot_mw: float) -> str:
        gw_str = f"{w_tot_mw / 1000.0:.1f}".replace(".", ",")
        if w_id == REFERENCE_SCENARIO_KEYS["windBase"]:
            return f"Eólica Base ({gw_str} GW Onshore)"
        if w_id == REFERENCE_SCENARIO_KEYS["windIntermediate"]:
            return f"Eólica Intermediária SIGA ({gw_str} GW)"
        return f"Eólica Alta + Offshore IBAMA ({gw_str} GW)"

    # 1. Matriz Completa dos 12 Cenários Cruzados em TARGET_END_YEAR
    dc_order = [
        REFERENCE_SCENARIO_KEYS["dcControl"],
        REFERENCE_SCENARIO_KEYS["dcConservative"],
        REFERENCE_SCENARIO_KEYS["dcCentral"],
        REFERENCE_SCENARIO_KEYS["dcHigh"],
    ]
    wind_order = [
        REFERENCE_SCENARIO_KEYS["windBase"],
        REFERENCE_SCENARIO_KEYS["windIntermediate"],
        REFERENCE_SCENARIO_KEYS["windHigh"],
    ]
    tasks_12 = []
    for dc_id in dc_order:
        for w_id in wind_order:
            match = df_scen_2035[
                (df_scen_2035["cenario_dc"] == dc_id) & (df_scen_2035["cenario_eolica"] == w_id)
            ]
            if match.empty:
                raise ValueError(f"Cenário ({dc_id}, {w_id}) ausente em {scenario_matrix_path.name}")
            row = match.iloc[0]
            dc_mw = float(row["carga_efetiva_dc_mw"])
            w_on = float(row["eolica_onshore_mw"])
            w_off = float(row["eolica_offshore_mw"])
            w_tot = float(row["eolica_total_mw"])
            tasks_12.append((
                f"{_format_dc_label(dc_id, dc_mw)} × {_format_wind_label(w_id, w_tot)}",
                dc_id,
                TARGET_END_YEAR,
                dc_mw,
                w_on,
                w_off,
                n_iter_main,
                mc_seed,
                arrays,
                w_id,
            ))

    print(f"[MONTE CARLO {TARGET_END_YEAR}] Executando 12 cenários cruzados ({12 * n_iter_main:,} simulações) em {n_workers} processos...")
    with mp.Pool(processes=n_workers) as pool:
        res_12 = pool.map(_simulate_scenario_worker, tasks_12)

    df_12 = pd.DataFrame(res_12)
    report_12_path = REPORTS_DIR / "matriz_cenarios_monte_carlo_2035.csv"
    df_12.to_csv(report_12_path, index=False)

    print(f"\nMatriz Completa de Risco e Curtailment em {TARGET_END_YEAR} (12 Cenários):")
    print(
        df_12[[
            "cenario_nome", "dc_load_mw", "wind_capacity_mw",
            "prob_exceder_intercambio_pct", "importacao_p95_mw",
            "curtailment_com_dc_twh_ano", "curtailment_evitado_gwh_ano",
            "expansao_eolica_compensatoria_gw",
        ]].to_string(index=False)
    )

    # 2. Curva de Trade-Off de Expansão Eólica Compensatória em TARGET_END_YEAR (Cenário Central DC da Etapa 02)
    dc_central_key = REFERENCE_SCENARIO_KEYS["dcCentral"]
    w_base_key = REFERENCE_SCENARIO_KEYS["windBase"]
    w_interm_key = REFERENCE_SCENARIO_KEYS["windIntermediate"]
    w_high_key = REFERENCE_SCENARIO_KEYS["windHigh"]

    central_dc_2035_mw = float(df_scen_2035.loc[df_scen_2035["cenario_dc"] == dc_central_key, "carga_efetiva_dc_mw"].iloc[0])
    base_onshore_2035_mw = float(df_scen_2035.loc[df_scen_2035["cenario_eolica"] == w_base_key, "eolica_onshore_mw"].iloc[0])
    high_onshore_2035_mw = float(df_scen_2035.loc[df_scen_2035["cenario_eolica"] == w_high_key, "eolica_onshore_mw"].iloc[0])
    max_onshore_add_mw = max(0.0, high_onshore_2035_mw - base_onshore_2035_mw)
    interm_wind_2035_mw = float(df_scen_2035.loc[df_scen_2035["cenario_eolica"] == w_interm_key, "eolica_total_mw"].iloc[0])

    extra_gw_grid = [float(x) for x in MONTE_CARLO_PARAMS["extraWindGwGrid"]]
    comp_tasks = []
    for extra_gw in extra_gw_grid:
        extra_mw = extra_gw * 1000.0
        w_on = base_onshore_2035_mw + min(max_onshore_add_mw, extra_mw)
        w_off = max(0.0, extra_mw - max_onshore_add_mw)
        comp_tasks.append((
            f"+{extra_gw:.1f} GW Eólicos Extras",
            dc_central_key,
            TARGET_END_YEAR,
            central_dc_2035_mw,
            w_on,
            w_off,
            n_iter_main,
            mc_seed,
            arrays,
            "",
        ))

    with mp.Pool(processes=n_workers) as pool:
        comp_res = pool.map(_simulate_scenario_worker, comp_tasks)
    df_comp = pd.DataFrame(comp_res)
    df_comp["expansao_adicional_gw"] = extra_gw_grid
    df_comp.to_csv(REPORTS_DIR / "curva_expansao_eolica_compensatoria_2035.csv", index=False)

    # 3. Evolução Temporal Anual do Risco (PROJECTION_START_YEAR..TARGET_END_YEAR)
    df_scen_timeline = df_scen_matrix[
        (df_scen_matrix["cenario_dc"] == dc_central_key) & (df_scen_matrix["cenario_eolica"] == w_interm_key)
    ].sort_values("ano")
    timeline_tasks = []
    existing_years = set(int(r["ano"]) for _, r in df_scen_timeline.iterrows())
    if PROJECTION_START_YEAR not in existing_years:
        timeline_tasks.append((
            f"Trajetória Central {PROJECTION_START_YEAR}",
            dc_central_key,
            PROJECTION_START_YEAR,
            0.0,
            float(BASE_WIND_ONSHORE_2026_MW),
            0.0,
            n_iter_timeline,
            mc_seed,
            arrays,
            w_interm_key,
        ))
    for _, r in df_scen_timeline.iterrows():
        y = int(r["ano"])
        timeline_tasks.append((
            f"Trajetória Central {y}",
            dc_central_key,
            y,
            float(r["carga_efetiva_dc_mw"]),
            float(r["eolica_onshore_mw"]),
            float(r["eolica_offshore_mw"]),
            n_iter_timeline,
            mc_seed,
            arrays,
            w_interm_key,
        ))

    with mp.Pool(processes=n_workers) as pool:
        timeline_res = pool.map(_simulate_scenario_worker, timeline_tasks)

    # Garante paridade exata de 2035 entre evolução anual e matriz principal (12 cenários)
    anchor_2035 = next(
        (r for r in res_12 if r.get("cenario_dc") == dc_central_key and r.get("cenario_eolica") == w_interm_key),
        None,
    )
    if anchor_2035 is not None:
        for idx, row in enumerate(timeline_res):
            if int(row.get("target_year", 0)) == TARGET_END_YEAR:
                synced_row = dict(anchor_2035)
                synced_row["cenario_nome"] = row["cenario_nome"]
                timeline_res[idx] = synced_row

    df_timeline = pd.DataFrame(timeline_res)
    df_timeline.to_csv(REPORTS_DIR / "evolucao_anual_risco_2026_2035.csv", index=False)

    # 4. Simulação Bottom-Up Projeto a Projeto e Risco por Subestação
    pipeline_file = RAW_DATA_DIR / "data_centers_pipeline_ne.csv"
    if pipeline_file.exists():
        df_pipeline = pd.read_csv(pipeline_file)
        _, bu_summary_df, bu_subs_df = run_bottom_up_project_monte_carlo(
            base_df=df_base,
            pipeline_df=df_pipeline,
            target_year=TARGET_END_YEAR,
            wind_capacity_mw=interm_wind_2035_mw,
            n_iterations=n_iter_bottom_up,
            seed=mc_seed,
        )
        bu_summary_df.to_csv(REPORTS_DIR / "relatorio_monte_carlo_bottom_up_projetos_2035.csv", index=False)
        bu_subs_df.to_csv(REPORTS_DIR / "risco_subestacoes_rede_basica_2035.csv", index=False)
        print(f"\nResumo Monte Carlo Bottom-Up (Projetos Nominais em {TARGET_END_YEAR}):")
        print(bu_summary_df.to_string(index=False))

    # 5. Exportação da Grade Paramétrica 2025–2035 para o Simulador Frontend
    export_simulator_monte_carlo_grid(
        base_df=df_base,
        df_scen_matrix=df_scen_matrix,
        res_12=res_12,
        timeline_res=timeline_res,
    )

    print(f"\n[SUCESSO] Passo 4 concluído! Todos os relatórios de Monte Carlo, série 8760h e grade 2025–2035 exportados em: {REPORTS_DIR}")


if __name__ == "__main__":
    main()
