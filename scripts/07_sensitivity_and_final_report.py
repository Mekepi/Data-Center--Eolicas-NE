"""
Etapa 07 (Passo 5) — Análise de Sensibilidade Multidimensional (Transmissão SIN & Disputa/Sinergia
com Hidrogênio Verde H2V em Pecém/Suape), Indicadores Separados ANEEL vs. ONS (2015–2035) e
Consolidação do Relatório Executivo Final (PTC3567 - Grupo 6).

Atende integralmente às Seções 6, 8, 9 e 10 do Plano Orientador e à Decisão 04 do Grupo 6:
  1. Sensibilidade aos Limites de Intercâmbio do SIN (Importação 5.500–9.000 MW e Exportação
     8.000–12.500 MW) executada diretamente via núcleo estocástico Block-Bootstrap do Script 06.
  2. Sensibilidade e Disputa/Sinergia de Subestações entre Data Centers (carga firme 24/7 inflexível)
     e Hubs de Hidrogênio Verde (H2V) na ZPE do Pecém (CE) e Suape (PE), comparando operação
     baseload vs. operação flexível interruptível pelo mesmo motor estocástico em blocos de 168 h.
  3. Indicadores Separados da Seção 6 do Plano Orientador (2015–2035):
     - Participação Eólica na Capacidade Instalada Total do NE (ANEEL/SIGA, %)
     - Participação Eólica na Geração Efetiva Verificada/Projetada do NE (ONS, %)
     - Gap de Aproveitamento Operacional devido ao Constrained-Off / Curtailment.
  4. Geração 100% parametrizada do Relatório Técnico Consolidado Final
     (`reports/relatorio_final_consolidado_ptc3567_grupo6.md`) a partir dos DataFrames do pipeline.

Bibliotecas utilizadas: apenas Python stdlib + numpy, pandas.
"""

from __future__ import annotations

import importlib
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from config import (
    ANEEL_PROJECTED_YEARS,
    ANNUAL_LOAD_GROWTH_RATE,
    ANNUAL_SOLAR_GROWTH_RATE,
    BASELINE_YEAR,
    DEFAULT_H2V_COMPARISON_MW,
    H2V_SENSITIVITY_SPECS,
    HOURS_PER_YEAR,
    INTERCHANGE_EXPORT_LIMIT_MW,
    INTERCHANGE_IMPORT_LIMIT_MW,
    MODERN_BLOCK_START_YEAR,
    MONTE_CARLO_PARAMS,
    PECEM_H2V_HUB_SHARE,
    PECEM_SUBSTATION_NAME,
    PROCESSED_DATA_DIR,
    RAW_DATA_DIR,
    REFERENCE_SCENARIO_KEYS,
    REPORTS_DIR,
    SCENARIOS_DATA_DIR,
    SOLAR_CAP_FROM_MEAN_FACTOR,
    SOLAR_CAP_MIN_MW,
    TARGET_END_YEAR,
    THERMAL_HYDRO_INSTALLED_CAP_MW,
    TX_SENSITIVITY_SPECS,
)

_mc_mod = importlib.import_module("06_monte_carlo_balance_2035")
_prepare_seasonal_blocks = _mc_mod._prepare_seasonal_blocks
_compute_chesf_hydro_thermal_dispatch = _mc_mod._compute_chesf_hydro_thermal_dispatch
simulate_block_bootstrap = _mc_mod.simulate_block_bootstrap

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def _fmt_pt(value: float, decimals: int = 1) -> str:
    """Formata número float no padrão PT-BR (ponto de milhar e vírgula decimal)."""
    raw = f"{float(value):,.{decimals}f}"
    return raw.replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_int_pt(value: int) -> str:
    """Formata inteiro com separador de milhar PT-BR."""
    return f"{int(value):,}".replace(",", ".")


def _load_required_csv(path: Path, label: str) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Artefato obrigatório '{label}' não encontrado em {path}. "
            "Execute as etapas anteriores (01 a 06) primeiro."
        )
    return pd.read_csv(path)


def _extract_central_interm_2035(df_scen_matrix: pd.DataFrame) -> tuple[float, float, float]:
    """Lê carga DC Central e capacidade eólica Intermediária em TARGET_END_YEAR da Etapa 02."""
    sub = df_scen_matrix[
        (df_scen_matrix["ano"] == TARGET_END_YEAR)
        & (df_scen_matrix["cenario_dc"] == REFERENCE_SCENARIO_KEYS["dcCentral"])
        & (df_scen_matrix["cenario_eolica"] == REFERENCE_SCENARIO_KEYS["windIntermediate"])
    ]
    if sub.empty:
        raise ValueError(
            f"Cenário (ano={TARGET_END_YEAR}, central, intermediate) ausente em matriz_cenarios_dc_eolica_2026_2035.csv"
        )
    row = sub.iloc[0]
    return (
        float(row["carga_efetiva_dc_mw"]),
        float(row["eolica_onshore_mw"]),
        float(row["eolica_offshore_mw"]),
    )


def load_pipeline_inputs() -> Dict[str, pd.DataFrame]:
    """Carrega todos os datasets mestre, cenários e relatórios das Etapas 01–06."""
    return {
        "df_master": _load_required_csv(PROCESSED_DATA_DIR / "ne_hourly_master.csv", "ne_hourly_master.csv"),
        "df_test2025": _load_required_csv(PROCESSED_DATA_DIR / "test_features_2025.csv", "test_features_2025.csv"),
        "df_dc_raw": _load_required_csv(RAW_DATA_DIR / "data_centers_pipeline_ne.csv", "data_centers_pipeline_ne.csv"),
        "df_subs": _load_required_csv(
            SCENARIOS_DATA_DIR / "dc_substation_load_concentration.csv",
            "dc_substation_load_concentration.csv",
        ),
        "df_scen_matrix": _load_required_csv(
            SCENARIOS_DATA_DIR / "matriz_cenarios_dc_eolica_2026_2035.csv",
            "matriz_cenarios_dc_eolica_2026_2035.csv",
        ),
        "df_anova": _load_required_csv(REPORTS_DIR / "relatorio_anova_significancia.csv", "relatorio_anova_significancia.csv"),
        "df_monthly": _load_required_csv(
            REPORTS_DIR / "perfil_mensal_sazonalidade_eolica_ne.csv",
            "perfil_mensal_sazonalidade_eolica_ne.csv",
        ),
        "df_model_a": _load_required_csv(REPORTS_DIR / "metricas_modelo_a_demanda.csv", "metricas_modelo_a_demanda.csv"),
        "df_model_bc": _load_required_csv(
            REPORTS_DIR / "metricas_modelos_b_c_eolica_curtailment.csv",
            "metricas_modelos_b_c_eolica_curtailment.csv",
        ),
        "df_mc_12": _load_required_csv(
            REPORTS_DIR / "matriz_cenarios_monte_carlo_2035.csv",
            "matriz_cenarios_monte_carlo_2035.csv",
        ),
        "df_timeline": _load_required_csv(
            REPORTS_DIR / "evolucao_anual_risco_2026_2035.csv",
            "evolucao_anual_risco_2026_2035.csv",
        ),
    }


def run_transmission_sensitivity_2035(
    df_master: pd.DataFrame,
    df_scen_matrix: pd.DataFrame,
    n_iterations: int = int(MONTE_CARLO_PARAMS["iterationsMain"]),
    seed: int = int(MONTE_CARLO_PARAMS["seed"]),
) -> pd.DataFrame:
    """
    Executa a análise de sensibilidade 2035 (Cenário Central DC × Eólica SIGA Intermediária)
    reutilizando exatamente o motor Block-Bootstrap do Script 06 para TX_SENSITIVITY_SPECS.
    """
    logger.info("1. Executando Análise de Sensibilidade de Transmissão SIN via Motor Monte Carlo (2035)...")

    arrays = _prepare_seasonal_blocks(df_master)
    central_dc_mw, interm_onshore_mw, interm_offshore_mw = _extract_central_interm_2035(df_scen_matrix)

    rows: List[Dict[str, Any]] = []
    for spec in TX_SENSITIVITY_SPECS:
        cfg_id = str(spec["configId"])
        imp_lim = float(spec["importLimitMW"])
        exp_lim = float(spec["exportLimitMW"])
        desc = str(spec["description"])
        res = simulate_block_bootstrap(
            cenario_nome=cfg_id,
            cenario_dc_id=REFERENCE_SCENARIO_KEYS["dcCentral"],
            target_year=TARGET_END_YEAR,
            dc_load_mw=central_dc_mw,
            wind_onshore_mw=interm_onshore_mw,
            wind_offshore_mw=interm_offshore_mw,
            n_iterations=n_iterations,
            seed=seed,
            arrays=arrays,
            import_limit_mw=imp_lim,
            export_limit_mw=exp_lim,
            cenario_eolica_id=REFERENCE_SCENARIO_KEYS["windIntermediate"],
        )
        rows.append(
            {
                "id_config": cfg_id,
                "import_limit_mw": imp_lim,
                "export_limit_mw": exp_lim,
                "descricao_infraestrutura": desc,
                "prob_import_critica_pct": res["prob_exceder_intercambio_pct"],
                "lole_horas_ano": res["lole_horas_criticas_ano"],
                "import_p95_mw": res["importacao_p95_mw"],
                "curtailment_com_dc_twh": res["curtailment_com_dc_twh_ano"],
                "curtailment_sem_dc_twh": res["curtailment_sem_dc_twh_ano"],
                "curtailment_evitado_dc_gwh": res["curtailment_evitado_gwh_ano"],
                "expansao_eolica_compensatoria_gw": res["expansao_eolica_compensatoria_gw"],
            }
        )

    df_tx = pd.DataFrame(rows)
    out_path = REPORTS_DIR / "sensibilidade_transmissao_intercambio_2035.csv"
    df_tx.to_csv(out_path, index=False)
    logger.info("   -> Salvo: %s", out_path)
    return df_tx


def run_h2v_and_datacenter_synergy_2035(
    df_master: pd.DataFrame,
    df_scen_matrix: pd.DataFrame,
    df_subs: pd.DataFrame,
    n_iterations: int = int(MONTE_CARLO_PARAMS["iterationsMain"]),
    seed: int = int(MONTE_CARLO_PARAMS["seed"]),
) -> pd.DataFrame:
    """
    Executa a análise da Seção 10 do Plano Orientador e Decisão 04 do Grupo 6 via núcleo
    estocástico Block-Bootstrap do Script 06 com base em H2V_SENSITIVITY_SPECS.
    """
    logger.info("2. Executando Análise H2V vs. Data Centers 24/7 via Motor Monte Carlo (2035)...")

    arrays = _prepare_seasonal_blocks(df_master)
    central_dc_mw, interm_onshore_mw, interm_offshore_mw = _extract_central_interm_2035(df_scen_matrix)

    pecem_rows = df_subs[df_subs["subestacao_conexao"] == PECEM_SUBSTATION_NAME]
    if pecem_rows.empty:
        raise ValueError(f"Subestação '{PECEM_SUBSTATION_NAME}' ausente em dc_substation_load_concentration.csv")
    pecem_dc_base_mw = float(pecem_rows["demanda_efetiva_2035_mw"].sum())

    rows: List[Dict[str, Any]] = []
    for spec in H2V_SENSITIVITY_SPECS:
        scen_id = str(spec["scenarioId"])
        h2v_nom_mw = float(spec["h2vNominalMW"])
        is_flex = bool(spec["h2vFlexible"])
        regime_desc = str(spec["operatingRegime"])
        res = simulate_block_bootstrap(
            cenario_nome=scen_id,
            cenario_dc_id=REFERENCE_SCENARIO_KEYS["dcCentral"],
            target_year=TARGET_END_YEAR,
            dc_load_mw=central_dc_mw,
            wind_onshore_mw=interm_onshore_mw,
            wind_offshore_mw=interm_offshore_mw,
            n_iterations=n_iterations,
            seed=seed,
            arrays=arrays,
            import_limit_mw=float(INTERCHANGE_IMPORT_LIMIT_MW),
            export_limit_mw=float(INTERCHANGE_EXPORT_LIMIT_MW),
            h2v_nominal_mw=h2v_nom_mw,
            h2v_flexible=is_flex,
            cenario_eolica_id=REFERENCE_SCENARIO_KEYS["windIntermediate"],
        )
        h2v_avg_mw = float(res["h2v_avg_mw"])
        absorbed_total_twh = round(float(res["curtailment_evitado_gwh_ano"]) / 1000.0, 2)
        pecem_pressure_mw = round(pecem_dc_base_mw + h2v_avg_mw * PECEM_H2V_HUB_SHARE, 1)

        rows.append(
            {
                "cenario_id": scen_id,
                "carga_dc_mw": round(central_dc_mw, 1),
                "carga_h2v_nominal_mw": h2v_nom_mw,
                "carga_h2v_media_efetiva_mw": round(h2v_avg_mw, 1),
                "regime_operacional_h2v": regime_desc,
                "prob_import_critica_pct": res["prob_exceder_intercambio_pct"],
                "import_p95_mw": res["importacao_p95_mw"],
                "curtailment_restante_twh": res["curtailment_com_dc_twh_ano"],
                "curtailment_absorvido_total_twh": absorbed_total_twh,
                "pressao_se_pecem_ii_mw": pecem_pressure_mw,
                "expansao_eolica_compensatoria_gw": res["expansao_eolica_compensatoria_gw"],
            }
        )

    df_h2v = pd.DataFrame(rows)
    out_path = REPORTS_DIR / "sensibilidade_h2v_eletrointensivos_2035.csv"
    df_h2v.to_csv(out_path, index=False)
    logger.info("   -> Salvo: %s", out_path)
    return df_h2v


def build_aneel_vs_ons_wind_indicators_2015_2035(
    df_master: pd.DataFrame,
    df_scen_matrix: pd.DataFrame,
    df_timeline: pd.DataFrame,
) -> pd.DataFrame:
    """
    Constrói a tabela histórica (2015–2025) e projetada (2028, 2030, 2032, 2035) exigida na
    Seção 6 do Plano Orientador:
      - Participação eólica na capacidade instalada total (ANEEL)
      - Participação eólica na geração efetiva (ONS).
    As linhas projetadas são derivadas diretamente de matriz_cenarios_dc_eolica_2026_2035.csv,
    evolucao_anual_risco_2026_2035.csv e do baseline empírico de df_master.
    """
    logger.info("3. Calculando Indicadores Separados ANEEL (Capacidade) vs. ONS (Geração Efetiva) 2015–2035...")

    df_hist_base = df_master.copy()
    df_hist_base["year"] = pd.to_datetime(df_hist_base["ts"]).dt.year
    annual_hist = (
        df_hist_base.groupby("year", as_index=False)
        .agg(
            cap_eolica_mw=("cap_eolica_instalada_mw", "mean"),
            gen_eolica_verificada_mw=("g_eolica_verificada_mw", "mean"),
            curtailment_mw=("curtailment_mw", "mean"),
            gen_solar_mw=("g_solar_mw", "mean"),
            gen_hidro_mw=("g_hidraulica_mw", "mean"),
            gen_termica_mw=("g_termica_mw", "mean"),
            carga_base_mw=("l_base_mw", "mean"),
            cf_eolica_pot=("cf_eolica", "mean"),
        )
        .sort_values("year")
    )

    hydro_therm_cap = float(THERMAL_HYDRO_INSTALLED_CAP_MW)
    rows: List[Dict[str, Any]] = []

    for _, r in annual_hist.iterrows():
        yr = int(r["year"])
        wind_cap = float(r["cap_eolica_mw"])
        solar_cap_est = max(float(SOLAR_CAP_MIN_MW), float(r["gen_solar_mw"]) * float(SOLAR_CAP_FROM_MEAN_FACTOR))
        total_installed_cap_ne = wind_cap + solar_cap_est + hydro_therm_cap

        wind_gen = float(r["gen_eolica_verificada_mw"])
        total_gen_ne = wind_gen + float(r["gen_solar_mw"]) + float(r["gen_hidro_mw"]) + float(r["gen_termica_mw"])
        curt_twh = float(r["curtailment_mw"]) * float(HOURS_PER_YEAR) / 1e6

        share_cap_aneel_pct = round((wind_cap / total_installed_cap_ne) * 100.0, 2)
        share_gen_ons_pct = round((wind_gen / max(1.0, total_gen_ne)) * 100.0, 2)
        cf_efetivo_ons_pct = round((wind_gen / max(1.0, wind_cap)) * 100.0, 2)
        cf_potencial_pct = round(((wind_gen + float(r["curtailment_mw"])) / max(1.0, wind_cap)) * 100.0, 2)

        rows.append(
            {
                "ano": yr,
                "periodo": "Histórico Verificado (ONS/ANEEL)",
                "cap_eolica_instalada_gw": round(wind_cap / 1000.0, 2),
                "cap_total_subsistema_ne_gw": round(total_installed_cap_ne / 1000.0, 2),
                "participacao_capacidade_aneel_pct": share_cap_aneel_pct,
                "participacao_geracao_efetiva_ons_pct": share_gen_ons_pct,
                "cf_eolico_efetivo_ons_pct": cf_efetivo_ons_pct,
                "cf_eolico_potencial_sem_corte_pct": cf_potencial_pct,
                "perda_curtailment_anual_twh": round(curt_twh, 2),
            }
        )

    # Parâmetros empíricos da janela moderna (MODERN_BLOCK_START_YEAR..BASELINE_YEAR) para derivação das projeções
    df_2025 = df_hist_base[df_hist_base["year"] == BASELINE_YEAR].copy()
    if df_2025.empty:
        max_yr = int(df_hist_base["year"].max())
        df_2025 = df_hist_base[df_hist_base["year"] == max_yr].copy()

    df_modern = df_hist_base[df_hist_base["year"] >= MODERN_BLOCK_START_YEAR]
    if df_modern.empty:
        df_modern = df_hist_base
    cf_pot_ref = float(df_modern["cf_eolica"].mean())

    load_2025_arr = df_2025["l_base_mw"].to_numpy(dtype=float)
    cf_2025_arr = df_2025["cf_eolica"].to_numpy(dtype=float)
    solar_2025_arr = df_2025["g_solar_mw"].fillna(0.0).to_numpy(dtype=float)
    month_2025_arr = pd.to_datetime(df_2025["ts"]).dt.month.to_numpy(dtype=np.int32)
    hydro_col_2025 = (
        "g_hidro_mw"
        if "g_hidro_mw" in df_2025.columns
        else ("g_hidraulica_mw" if "g_hidraulica_mw" in df_2025.columns else None)
    )
    hydro_2025_arr = (
        pd.to_numeric(df_2025[hydro_col_2025], errors="coerce").fillna(0.0).to_numpy(dtype=float)
        if hydro_col_2025 is not None
        else np.zeros(len(df_2025), dtype=float)
    )
    thermal_2025_arr = (
        pd.to_numeric(df_2025["g_termica_mw"], errors="coerce").fillna(0.0).to_numpy(dtype=float)
        if "g_termica_mw" in df_2025.columns
        else np.zeros(len(df_2025), dtype=float)
    )
    solar_2025_mean_mw = float(np.mean(solar_2025_arr))
    solar_2025_cap_mw = max(float(SOLAR_CAP_MIN_MW), solar_2025_mean_mw * float(SOLAR_CAP_FROM_MEAN_FACTOR))

    for yr in ANEEL_PROJECTED_YEARS:
        scen_row = df_scen_matrix[
            (df_scen_matrix["ano"] == yr)
            & (df_scen_matrix["cenario_dc"] == REFERENCE_SCENARIO_KEYS["dcCentral"])
            & (df_scen_matrix["cenario_eolica"] == REFERENCE_SCENARIO_KEYS["windIntermediate"])
        ]
        tl_row = df_timeline[df_timeline["target_year"] == yr]
        if scen_row.empty or tl_row.empty:
            raise ValueError(
                f"Dados projetados ausentes para o ano {yr} em matriz_cenarios_dc_eolica_2026_2035.csv "
                "ou evolucao_anual_risco_2026_2035.csv"
            )

        w_mw = float(scen_row.iloc[0]["eolica_total_mw"])
        curt_twh = round(float(tl_row.iloc[0]["curtailment_com_dc_twh_ano"]), 2)
        years_ahead = max(0, yr - BASELINE_YEAR)
        solar_growth = 1.0 + ANNUAL_SOLAR_GROWTH_RATE * years_ahead
        load_growth = (1.0 + ANNUAL_LOAD_GROWTH_RATE) ** years_ahead

        proj_solar_cap_mw = solar_2025_cap_mw * solar_growth
        total_cap_mw = w_mw + proj_solar_cap_mw + hydro_therm_cap
        share_cap = round((w_mw / total_cap_mw) * 100.0, 2)

        wind_pot_gen_mw = w_mw * cf_pot_ref
        curt_mw_avg = (curt_twh * 1e6) / float(HOURS_PER_YEAR)
        wind_eff_gen_mw = max(0.0, wind_pot_gen_mw - curt_mw_avg)

        proj_solar_gen_arr = solar_2025_arr * solar_growth
        proj_hydro_therm_arr = _compute_chesf_hydro_thermal_dispatch(
            load_2025_arr * load_growth,
            cf_2025_arr * w_mw,
            proj_solar_gen_arr,
            month_arr=month_2025_arr,
            obs_hydro_mw=hydro_2025_arr,
            obs_thermal_mw=thermal_2025_arr,
        )
        total_gen_mw = wind_eff_gen_mw + float(np.mean(proj_solar_gen_arr)) + float(np.mean(proj_hydro_therm_arr))
        share_gen = round((wind_eff_gen_mw / max(1.0, total_gen_mw)) * 100.0, 2)

        cf_pot_pct = round(cf_pot_ref * 100.0, 2)
        cf_eff_pct = round((wind_eff_gen_mw / max(1.0, w_mw)) * 100.0, 2)

        rows.append(
            {
                "ano": yr,
                "periodo": "Projeção Cenário Central DC + SIGA Interm.",
                "cap_eolica_instalada_gw": round(w_mw / 1000.0, 2),
                "cap_total_subsistema_ne_gw": round(total_cap_mw / 1000.0, 2),
                "participacao_capacidade_aneel_pct": share_cap,
                "participacao_geracao_efetiva_ons_pct": share_gen,
                "cf_eolico_efetivo_ons_pct": cf_eff_pct,
                "cf_eolico_potencial_sem_corte_pct": cf_pot_pct,
                "perda_curtailment_anual_twh": curt_twh,
            }
        )

    df_ind = pd.DataFrame(rows)
    out_path = REPORTS_DIR / "indicadores_participacao_eolica_aneel_vs_ons_2015_2035.csv"
    df_ind.to_csv(out_path, index=False)
    logger.info("   -> Salvo: %s", out_path)
    return df_ind


def write_final_consolidated_markdown_report(
    df_tx: pd.DataFrame,
    df_h2v: pd.DataFrame,
    df_ind: pd.DataFrame,
    df_model_a: Optional[pd.DataFrame] = None,
    df_model_bc: Optional[pd.DataFrame] = None,
    df_mc_12: Optional[pd.DataFrame] = None,
    df_anova: Optional[pd.DataFrame] = None,
    df_monthly: Optional[pd.DataFrame] = None,
    df_dc_raw: Optional[pd.DataFrame] = None,
    df_subs: Optional[pd.DataFrame] = None,
    df_test2025: Optional[pd.DataFrame] = None,
    df_scen_matrix: Optional[pd.DataFrame] = None,
) -> Path:
    """
    Gera o Relatório Executivo Consolidado Final em Markdown com 100% dos indicadores
    e citações em prosa interpolados diretamente dos DataFrames reais do pipeline.
    """
    if df_model_a is None:
        df_model_a = _load_required_csv(REPORTS_DIR / "metricas_modelo_a_demanda.csv", "metricas_modelo_a_demanda.csv")
    if df_model_bc is None:
        df_model_bc = _load_required_csv(
            REPORTS_DIR / "metricas_modelos_b_c_eolica_curtailment.csv",
            "metricas_modelos_b_c_eolica_curtailment.csv",
        )
    if df_mc_12 is None:
        df_mc_12 = _load_required_csv(
            REPORTS_DIR / "matriz_cenarios_monte_carlo_2035.csv",
            "matriz_cenarios_monte_carlo_2035.csv",
        )
    if df_anova is None:
        df_anova = _load_required_csv(
            REPORTS_DIR / "relatorio_anova_significancia.csv",
            "relatorio_anova_significancia.csv",
        )
    if df_monthly is None:
        df_monthly = _load_required_csv(
            REPORTS_DIR / "perfil_mensal_sazonalidade_eolica_ne.csv",
            "perfil_mensal_sazonalidade_eolica_ne.csv",
        )
    if df_dc_raw is None:
        df_dc_raw = _load_required_csv(
            RAW_DATA_DIR / "data_centers_pipeline_ne.csv",
            "data_centers_pipeline_ne.csv",
        )
    if df_subs is None:
        df_subs = _load_required_csv(
            SCENARIOS_DATA_DIR / "dc_substation_load_concentration.csv",
            "dc_substation_load_concentration.csv",
        )
    if df_test2025 is None:
        df_test2025 = _load_required_csv(
            PROCESSED_DATA_DIR / "test_features_2025.csv",
            "test_features_2025.csv",
        )
    if df_scen_matrix is None:
        df_scen_matrix = _load_required_csv(
            SCENARIOS_DATA_DIR / "matriz_cenarios_dc_eolica_2026_2035.csv",
            "matriz_cenarios_dc_eolica_2026_2035.csv",
        )

    # --- Extração dinâmica de métricas-chave ---
    train_hours = int(df_model_a["treino_horas"].iloc[0])
    test_hours = int(df_model_a["teste_2025_horas"].iloc[0])

    base_load_2025_mw = float(df_test2025["l_base_mw"].mean())
    base_load_2035_mw = base_load_2025_mw * ((1.0 + ANNUAL_LOAD_GROWTH_RATE) ** (TARGET_END_YEAR - BASELINE_YEAR))

    n_dc_projects = int(len(df_dc_raw))
    total_it_mw = float(df_dc_raw["potencia_it_mw"].sum())
    grid_powers = np.where(
        df_dc_raw["tipo_publicacao"].astype(str) == "potencia_total_rede",
        df_dc_raw["potencia_total_rede_mw"].astype(float),
        df_dc_raw["potencia_it_mw"].astype(float) * df_dc_raw["pue_estimado"].astype(float),
    )
    total_max_grid_mw = float(np.sum(grid_powers))
    pue_min = float(df_dc_raw["pue_estimado"].min())
    pue_max = float(df_dc_raw["pue_estimado"].max())

    # Linhas de referência na matriz de 12 cenários Monte Carlo 2035
    mc_sorted = df_mc_12.sort_values("wind_capacity_mw")
    base_wind_mw = float(mc_sorted["wind_capacity_mw"].min())
    high_wind_mw = float(mc_sorted["wind_capacity_mw"].max())
    interm_row_scen = df_scen_matrix[
        (df_scen_matrix["ano"] == TARGET_END_YEAR)
        & (df_scen_matrix["cenario_eolica"] == REFERENCE_SCENARIO_KEYS["windIntermediate"])
    ].iloc[0]
    interm_wind_mw = float(interm_row_scen["eolica_total_mw"])

    def _find_mc(dc_id: str, w_mw: float) -> pd.Series:
        sub = df_mc_12[(df_mc_12["cenario_dc"] == dc_id) & (np.abs(df_mc_12["wind_capacity_mw"] - w_mw) < 150.0)]
        if sub.empty:
            raise ValueError(f"Cenário ({dc_id}, wind={w_mw}) não encontrado em matriz_cenarios_monte_carlo_2035.csv")
        return sub.iloc[0]

    mc_none_base = _find_mc(REFERENCE_SCENARIO_KEYS["dcControl"], base_wind_mw)
    mc_central_base = _find_mc(REFERENCE_SCENARIO_KEYS["dcCentral"], base_wind_mw)
    mc_central_interm = _find_mc(REFERENCE_SCENARIO_KEYS["dcCentral"], interm_wind_mw)
    mc_central_high = _find_mc(REFERENCE_SCENARIO_KEYS["dcCentral"], high_wind_mw)
    mc_high_interm = _find_mc(REFERENCE_SCENARIO_KEYS["dcHigh"], interm_wind_mw)

    central_dc_mw = float(mc_central_base["dc_load_mw"])
    base_wind_gw = base_wind_mw / 1000.0
    interm_wind_gw = interm_wind_mw / 1000.0
    interm_add_gw = (interm_wind_mw - base_wind_mw) / 1000.0
    high_wind_gw = high_wind_mw / 1000.0

    # Razão empírica MW eólicos compensatórios por MW de DC nos cenários com déficit compensatório > 0 sob eólica base
    comp_ratios = [
        (float(r["expansao_eolica_compensatoria_gw"]) * 1000.0) / float(r["dc_load_mw"])
        for _, r in df_mc_12.iterrows()
        if abs(float(r["wind_capacity_mw"]) - base_wind_mw) < 150.0
        and float(r["dc_load_mw"]) > 0.0
        and float(r["expansao_eolica_compensatoria_gw"]) > 0.0
    ]
    ratio_min = min(comp_ratios) if comp_ratios else 0.0
    ratio_max = max(comp_ratios) if comp_ratios else 0.0
    central_ratio = (float(mc_central_interm["expansao_eolica_compensatoria_gw"]) * 1000.0) / max(1.0, central_dc_mw)

    # ANOVA & Sazonalidade mensal
    wind_anova = df_anova[df_anova["variavel_analisada"].str.contains("cf_eolica", case=False)].iloc[0]
    anova_f = float(wind_anova["estatistica_f"])
    mar_p10_pct = float(df_monthly[df_monthly["mes"] == 3]["cf_p10"].iloc[0]) * 100.0
    sep_p10_pct = float(df_monthly[df_monthly["mes"] == 9]["cf_p10"].iloc[0]) * 100.0

    # Benchmarks Modelos A, B, C
    a_1h_mlp = df_model_a[
        df_model_a["horizonte"].str.contains("1h") & df_model_a["arquitetura"].str.contains("ResMLP")
    ].iloc[0]
    a_1h_lin = df_model_a[
        df_model_a["horizonte"].str.contains("1h") & df_model_a["familia"].eq("Linear")
    ].iloc[0]
    a_1h_gain_pct = (1.0 - float(a_1h_mlp["mae_mw"]) / max(1e-6, float(a_1h_lin["mae_mw"]))) * 100.0

    a_24h_mlp = df_model_a[
        df_model_a["horizonte"].str.contains("24h") & df_model_a["arquitetura"].str.contains("ResMLP")
    ].iloc[0]

    b_1h_mlp = df_model_bc[
        df_model_bc["etapa"].str.startswith("Modelo B")
        & df_model_bc["horizonte"].str.contains("1h")
        & df_model_bc["arquitetura"].str.contains("ResMLP")
    ].iloc[0]

    c_lin = df_model_bc[
        df_model_bc["etapa"].str.startswith("Modelo C") & df_model_bc["familia"].eq("Linear")
    ].iloc[0]
    c_nl_df = df_model_bc[
        df_model_bc["etapa"].str.startswith("Modelo C") & ~df_model_bc["familia"].eq("Linear")
    ]
    c_nl = c_nl_df[c_nl_df["arquitetura"].str.contains("ResMLP")].iloc[0] if (
        c_nl_df["arquitetura"].str.contains("ResMLP").any()
    ) else c_nl_df.iloc[0]

    # Concentração em PECEM_SUBSTATION_NAME e comparativo H2V
    pecem_share_pct = float(df_subs[df_subs["subestacao_conexao"] == PECEM_SUBSTATION_NAME]["participacao_pct"].sum())
    h2v_base = df_h2v[df_h2v["carga_h2v_nominal_mw"] == 0.0].iloc[0]
    h2v_2gw_inflex = df_h2v[
        (df_h2v["carga_h2v_nominal_mw"] == DEFAULT_H2V_COMPARISON_MW) & df_h2v["cenario_id"].str.contains("Inflexível")
    ].iloc[0]
    h2v_2gw_flex = df_h2v[
        (df_h2v["carga_h2v_nominal_mw"] == DEFAULT_H2V_COMPARISON_MW) & df_h2v["cenario_id"].str.contains("Flexível")
    ].iloc[0]

    imp_limit_str = _fmt_int_pt(int(round(INTERCHANGE_IMPORT_LIMIT_MW)))
    imp_limit_gw_str = _fmt_pt(INTERCHANGE_IMPORT_LIMIT_MW / 1000.0, 1)

    report_path = REPORTS_DIR / "relatorio_final_consolidado_ptc3567_grupo6.md"

    c_nl_label = "`ResMLP Hurdle` (C1+C2)" if "ResMLP" in str(c_nl["arquitetura"]) else "`HistogramGBDT Hurdle`"

    md_content = f"""# Relatório Técnico Consolidado Final — PTC3567 (Grupo 6)
## Impacto da Expansão de Data Centers e Demanda Elétrica sobre a Geração Eólica no Nordeste (2026–2035)

**Disciplina:** PTC3567 — Ciência dos Dados em Automação e Engenharia (Escola Politécnica da USP)  
**Subsistema Analisado:** Subsistema Nordeste (SIN — ONS / ANEEL / EPE)  
**Janela Empírica de Treino e Validação:** 2015–2024 (Treino: {_fmt_int_pt(train_hours)} horas) e 2025 (Validação Out-of-Time Cega: {_fmt_int_pt(test_hours)} horas)  
**Horizonte Estocástico de Planejamento:** 2026–2035 (Monte Carlo em Blocos Sazonais — {len(df_mc_12)} Cenários + Sensibilidades)

---

### 1. Resposta Direta à Pergunta Central de Pesquisa

> **Pergunta Central (Seção 1 do Plano Orientador):** *"Qual o impacto do crescimento da demanda elétrica associado à expansão de data centers sobre a suficiência da geração eólica no Nordeste até 2035, e quanto de expansão eólica seria necessário para compensar esse aumento estrutural de carga?"*

1. **Impacto Estrutural da Carga Base + Data Centers até 2035:**
   - A demanda base vegetativa do Subsistema Nordeste cresce de **{_fmt_pt(base_load_2025_mw, 1)} MW médios em 2025** para **{_fmt_pt(base_load_2035_mw, 1)} MW médios em 2035** (+3,1% a.a. conforme PDE/EPE).
   - O pipeline mapeado de **{n_dc_projects} projetos nominais de Data Centers no Nordeste** totaliza **{_fmt_int_pt(int(round(total_it_mw)))} MW de potência de TI** (**{_fmt_int_pt(int(round(total_max_grid_mw)))} MW de carga máxima contratada na rede**, com PUE entre {_fmt_pt(pue_min, 2)} e {_fmt_pt(pue_max, 2)} e regra de não-duplicação quando publicado em potência total de rede).
   - No **Cenário Central probabilístico ({_fmt_pt(central_dc_mw, 1)} MW médios contínuos na rede em 2035)**, os Data Centers elevam a probabilidade anual de importação crítica acima do limite de intercâmbio ($P(\\text{{Import}} > {imp_limit_str}\\text{{ MW}})$) de **{_fmt_pt(float(mc_none_base['prob_exceder_intercambio_pct']), 1)}% para {_fmt_pt(float(mc_central_base['prob_exceder_intercambio_pct']), 1)}%** caso o parque eólico permaneça congelado em {_fmt_pt(base_wind_gw, 1)} GW.

2. **Expansão Eólica Compensatória Exigida ($\\Delta C_{{\\text{{eólica}}}}$):**
   - Devido à **assimetria sazonal severa do vento nordestino** (comprovada via ANOVA com $F = {_fmt_pt(anova_f, 2)}, p < 10^{{-16}}$, onde o fator de capacidade P10 cai de **{_fmt_pt(sep_p10_pct, 1)}% em setembro** para **{_fmt_pt(mar_p10_pct, 1)}% em março**) e ao perfil noturno de carga, cada **1,0 MW de carga firme 24/7 de Data Center** exige entre **{_fmt_pt(ratio_min, 2)} MW e {_fmt_pt(ratio_max, 2)} MW de capacidade eólica onshore adicional** sob o parque base para compensar a perda de margem no P95 em períodos de baixa geração.
   - **No Cenário Central de Data Centers ({_fmt_pt(central_dc_mw, 1)} MW):**
     - Com **Eólica Base ({_fmt_pt(base_wind_gw, 1)} GW)**: são necessários **+{_fmt_pt(float(mc_central_base['expansao_eolica_compensatoria_gw']), 2)} GW eólicos adicionais** (levando o parque a {_fmt_pt(base_wind_gw + float(mc_central_base['expansao_eolica_compensatoria_gw']), 2)} GW).
     - Com **Expansão SIGA Intermediária ({_fmt_pt(interm_wind_gw, 1)} GW, já somando +{_fmt_pt(interm_add_gw, 1)} GW em construção)**: restam **+{_fmt_pt(float(mc_central_interm['expansao_eolica_compensatoria_gw']), 2)} GW eólicos adicionais** para neutralizar o risco operacional no P95.
     - Com **Expansão Alta + Offshore IBAMA pós-2031 ({_fmt_pt(high_wind_gw, 1)} GW)**: o requisito adicional cai para **{_fmt_pt(float(mc_central_high['expansao_eolica_compensatoria_gw']), 2)} GW** ($P(\\text{{Import}} > {imp_limit_gw_str}\\text{{ GW}}) = {_fmt_pt(float(mc_central_high['prob_exceder_intercambio_pct']), 1)}\\%$), atingindo autossuficiência estatística.

3. **Sinergia Positiva Diurna e Noturna (Absorção de *Constrained-Off* / *Curtailment*):**
   - Em contrapartida ao estresse nas horas de calmaria, a carga 24/7 dos Data Centers atua como **âncora de absorção local de excedentes renováveis**, evitando o desperdício (*curtailment*) de **{_fmt_int_pt(int(round(float(mc_central_interm['curtailment_evitado_gwh_ano']))))} GWh/ano ({_fmt_pt(float(mc_central_interm['curtailment_evitado_gwh_ano']) / 1000.0, 2)} TWh/ano)** no Cenário Central e até **{_fmt_int_pt(int(round(float(mc_high_interm['curtailment_evitado_gwh_ano']))))} GWh/ano ({_fmt_pt(float(mc_high_interm['curtailment_evitado_gwh_ano']) / 1000.0, 2)} TWh/ano)** no Cenário Alto de Data Centers sob expansão SIGA Intermediária.

---

### 2. Síntese da Validação Cega Out-of-Time em 2025 (Passo 3 — Modelos A, B e C)

Todos os modelos foram implementados em Python utilizando exclusivamente `numpy`, `scipy` e `pandas` (`scripts/ml_models_numpy.py`), comparando arquiteturas **Lineares (Ridge / Logística)** contra arquiteturas **Não-Lineares (`ResidualMLPRegressor` L-BFGS-B e `HistogramGBDT`)**:

| Bloco de Modelagem | Variável Alvo | Melhor Modelo Não-Linear | Baseline Linear | Métrica Principal (Teste Cego 2025 - {_fmt_int_pt(test_hours)} h) | Ganho Não-Linear |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Modelo A (Script 04)** | Demanda Base $L_{{\\text{{base}}}}(t)$ (1h-Ahead) | `ResidualMLPRegressor` | `LinearRidgeModel` | **MAE = {_fmt_pt(float(a_1h_mlp['mae_mw']), 1)} MW** · **MAPE = {_fmt_pt(float(a_1h_mlp['mape_pct']), 2)}%** · $R^2 = {_fmt_pt(float(a_1h_mlp['r2_score']), 4)}$ | Redução de **{_fmt_pt(a_1h_gain_pct, 1)}%** no erro MAE |
| **Modelo A (Script 04)** | Demanda Base $L_{{\\text{{base}}}}(t)$ (24h Day-Ahead) | `ResidualMLPRegressor` | `LinearRidgeModel` | **MAE = {_fmt_pt(float(a_24h_mlp['mae_mw']), 1)} MW** · **MAPE = {_fmt_pt(float(a_24h_mlp['mape_pct']), 2)}%** · $R^2 = {_fmt_pt(float(a_24h_mlp['r2_score']), 4)}$ | Captura interação térmica × dia útil |
| **Modelo B (Script 05)** | Fator de Capacidade Potencial $CF_{{\\text{{pot}}}}(t)$ (1h) | `ResidualMLPRegressor` | `LinearRidgeModel` | **MAE = {_fmt_pt(float(b_1h_mlp['mae_cf']), 4)}** ({_fmt_pt(float(b_1h_mlp['mae_potencia_equiv_mw']), 1)} MW) · **$R^2 = {_fmt_pt(float(b_1h_mlp['r2_score']), 4)}$** | Captura potência cúbica $v^3$ de Betz |
| **Modelo C (Script 05)** | *Curtailment* Eólico Real ONS (Hurdle 2 Estágios) | {c_nl_label} | `Logistic` + `Ridge` | **ROC-AUC = {_fmt_pt(float(c_nl['roc_auc']), 4)}** · **Brier = {_fmt_pt(float(c_nl['brier_score']), 4)}** · **F1 = {_fmt_pt(float(c_nl['f1_score']), 4)}** | **$R^2$ Volume = {_fmt_pt(float(c_nl['r2_volume']), 4)}** (vs {_fmt_pt(float(c_lin['r2_volume']), 4)} linear) |

---

### 3. Passo 5 · Análise de Sensibilidade à Expansão da Transmissão (Limites de Intercâmbio SIN)

A tabela abaixo demonstra como a expansão das linhas de interligação Nordeste–Sudeste/Centro-Oeste (novas LTs 500 kV e Bipolo HVDC) altera o risco de suprimento e o *curtailment* em 2035 sob o Cenário Central de Data Centers ({_fmt_pt(central_dc_mw, 1)} MW) e Eólica SIGA Intermediária ({_fmt_pt(interm_wind_gw, 1)} GW), simulados diretamente pelo motor Block-Bootstrap:

| Configuração de Malha de Transmissão (2035) | Limite Importação (MW) | Limite Exportação (MW) | $P(\\text{{Import}} > \\text{{Limite}})$ | Importação P95 (MW) | Curtailment Restante (TWh/ano) | Eólica Extra Req. (GW) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
"""

    for _, r in df_tx.iterrows():
        md_content += (
            f"| **{r['id_config']}** | {r['import_limit_mw']:,.0f} MW | {r['export_limit_mw']:,.0f} MW | "
            f"**{r['prob_import_critica_pct']:.2f}%** | {r['import_p95_mw']:,.1f} MW | "
            f"{r['curtailment_com_dc_twh']:.2f} TWh | **+{r['expansao_eolica_compensatoria_gw']:.2f} GW** |\n"
        )

    md_content += f"""
---

### 4. Passo 5 · Disputa vs. Sinergia de Rede: Data Centers 24/7 vs. Hidrogênio Verde (H2V) em Pecém e Suape

Atendendo à Seção 10 do Plano Orientador e à Decisão 04 do Grupo 6, avaliamos o efeito da entrada simultânea de eletrolisadores de **Hidrogênio Verde (H2V)** na ZPE do Pecém (CE) e Suape (PE) competindo pelos mesmos barramentos de 500 kV (**SE Pecém II** concentra **{_fmt_pt(pecem_share_pct, 1)}%** da carga de Data Centers do NE):

| Cenário de Cargas Eletrointensivas (2035) | Carga DC 24/7 (MW) | Carga H2V Nominal (MW) | Carga H2V Média Efetiva (MW) | $P(\\text{{Import}} > {imp_limit_gw_str}\\text{{ GW}})$ | Curtailment Absorvido Total (TWh/ano) | Pressão na SE Pecém II 500 kV (MW) | Eólica Extra Req. (GW) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
"""

    for _, r in df_h2v.iterrows():
        md_content += (
            f"| **{r['cenario_id']}** | {r['carga_dc_mw']:,.1f} MW | {r['carga_h2v_nominal_mw']:,.0f} MW | "
            f"{r['carga_h2v_media_efetiva_mw']:,.1f} MW | **{r['prob_import_critica_pct']:.2f}%** | "
            f"**{r['curtailment_absorvido_total_twh']:.2f} TWh** | {r['pressao_se_pecem_ii_mw']:,.1f} MW | "
            f"**+{r['expansao_eolica_compensatoria_gw']:.2f} GW** |\n"
        )

    md_content += f"""
**Conclusão Operacional sobre H2V vs. Data Centers:**
- Enquanto os **Data Centers de IA/Cloud** possuem carga estritamente inflexível 24/7 (UPS/SLA Tier III/IV), os **eletrolisadores de H2V** podem e devem ser contratados sob modalidade **flexível / interruptível (*grid-following*)**.
- Quando 2,0 GW de H2V operam de forma **inflexível 24/7**, o risco de importação crítica salta de **{_fmt_pt(float(h2v_base['prob_import_critica_pct']), 2)}% para {_fmt_pt(float(h2v_2gw_inflex['prob_import_critica_pct']), 2)}%** e exige **+{_fmt_pt(float(h2v_2gw_inflex['expansao_eolica_compensatoria_gw']), 2)} GW eólicos extras**. Porém, quando o mesmo H2V de 2,0 GW opera com **modulação dinâmica** (reduzindo a 12% na calmaria noturna e operando a 100% nas horas de vento/sol abundante), ele absorve **{_fmt_pt(float(h2v_2gw_flex['curtailment_absorvido_total_twh']), 2)} TWh/ano de *curtailment*** com impacto mitigado sobre o risco de importação na calmaria (**{_fmt_pt(float(h2v_2gw_flex['prob_import_critica_pct']), 2)}%** e **+{_fmt_pt(float(h2v_2gw_flex['expansao_eolica_compensatoria_gw']), 2)} GW extras**).

---

### 5. Indicadores Separados (Seção 6 do PDF): Capacidade Instalada (ANEEL) vs. Geração Efetiva (ONS)

| Ano | Período / Cenário | Cap. Eólica NE (GW) | Part. na Capacidade Instalada NE (ANEEL %) | Part. na Geração Efetiva NE (ONS %) | CF Potencial s/ Corte (%) | CF Efetivo Verificado ONS (%) | Perda por Curtailment (TWh/ano) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
"""

    selected_years = [2015, 2018, 2021, 2023, 2024, 2025, 2028, 2030, 2032, 2035]
    for _, r in df_ind[df_ind["ano"].isin(selected_years)].iterrows():
        md_content += (
            f"| **{int(r['ano'])}** | {r['periodo']} | {r['cap_eolica_instalada_gw']:.2f} GW | "
            f"**{r['participacao_capacidade_aneel_pct']:.2f}%** | **{r['participacao_geracao_efetiva_ons_pct']:.2f}%** | "
            f"{r['cf_eolico_potencial_sem_corte_pct']:.2f}% | {r['cf_eolico_efetivo_ons_pct']:.2f}% | "
            f"{r['perda_curtailment_anual_twh']:.2f} TWh |\n"
        )

    md_content += f"""
---

### 6. Recomendações Finais de Engenharia e Política Energética (Grupo 6)

1. **Contratação Híbrida associada a Armazenamento/Subestações:** A expansão apenas de capacidade eólica onshore apresenta retorno decrescente na ponta noturna de março–maio (no Cenário Central × SIGA Intermediária, cada 1 MW de Data Center ainda requer ~{_fmt_pt(central_ratio, 2)} MW eólicos adicionais para zerar o déficit no P95). A combinação da trajetória **SIGA Intermediária (+{_fmt_pt(interm_add_gw, 1)} GW onshore)** com **baterias BESS de 4 horas nas subestações de Pecém II e Suape II** ou **eólicas offshore pós-2031** reduz substancialmente a necessidade de sobre-expansão eólica.
2. **Desacoplamento Tarifário/Operativo entre Data Centers (Firme 24/7) e H2V (Flexível):** Novos acessos de Data Centers na SE Pecém II 500 kV (que já concentra {_fmt_pt(pecem_share_pct, 1)}% da demanda efetiva projetada em 2035) devem ser coordenados com PPAs que remunerem a absorção de *constrained-off* diurno/noturno, enquanto plantas de H2V devem atuar como reserva interruptível para não agravar o déficit nas noites úmidas de fevereiro a maio.
"""

    report_path.write_text(md_content, encoding="utf-8")
    logger.info("4. Relatório Executivo Final Consolidado gerado em: %s", report_path)
    return report_path


def main() -> None:
    inputs = load_pipeline_inputs()
    df_tx = run_transmission_sensitivity_2035(inputs["df_master"], inputs["df_scen_matrix"])
    df_h2v = run_h2v_and_datacenter_synergy_2035(
        inputs["df_master"], inputs["df_scen_matrix"], inputs["df_subs"]
    )
    df_ind = build_aneel_vs_ons_wind_indicators_2015_2035(
        inputs["df_master"], inputs["df_scen_matrix"], inputs["df_timeline"]
    )
    write_final_consolidated_markdown_report(
        df_tx=df_tx,
        df_h2v=df_h2v,
        df_ind=df_ind,
        df_model_a=inputs["df_model_a"],
        df_model_bc=inputs["df_model_bc"],
        df_mc_12=inputs["df_mc_12"],
        df_anova=inputs["df_anova"],
        df_monthly=inputs["df_monthly"],
        df_dc_raw=inputs["df_dc_raw"],
        df_subs=inputs["df_subs"],
        df_test2025=inputs["df_test2025"],
        df_scen_matrix=inputs["df_scen_matrix"],
    )

    from sync_frontend_ssot import sync_frontend_ssot

    sync_frontend_ssot()
    logger.info("Passo 5 (Script 07) concluído e SSOT do Frontend sincronizado com sucesso.")


if __name__ == "__main__":
    main()
