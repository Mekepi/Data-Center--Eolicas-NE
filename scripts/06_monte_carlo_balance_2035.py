"""
06_monte_carlo_balance_2035.py
Etapa 06: Cruzamento de Cenários, Simulação de Monte Carlo e Expansão Eólica Compensatória
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Simulação estocástica de Monte Carlo integrando:
  * Erro e crescimento vegetativo da demanda normal (Modelo A).
  * Incerteza climática do Fator de Capacidade eólico CF(t) (Modelo B) via amostragem em blocos (block bootstrap).
  * Atraso ou cancelamento de projetos de geração (SIGA / IBAMA).
  * Data de entrada e fator de utilização dos data centers (0.70 a 0.95).
  * Limites físicos de intercâmbio do SIN e curtailment (Modelo C).
- Entrega Final Esperada (Seção 8 e 10 do Plano Orientador):
  * Probabilidade de superar o limiar crítico de importação.
  * Importação de pico no percentil 95 (P95) e mediana (P50).
  * Curtailment evitado pelos data centers.
  * Quantos GW de expansão eólica seriam necessários para compensar o aumento estrutural de carga.
"""

import sys
from pathlib import Path
from typing import Dict, List, Any, Tuple
import numpy as np
import pandas as pd

from config import (
    RAW_DATA_DIR,
    PROCESSED_DATA_DIR,
    SCENARIOS_DATA_DIR,
    REPORTS_DIR,
    INTERCHANGE_IMPORT_LIMIT_MW,
    INTERCHANGE_EXPORT_LIMIT_MW,
    BASE_HYDRO_THERMAL_MW,
)


def run_monte_carlo_block_simulation(
    base_df: pd.DataFrame,
    target_year: int = 2035,
    dc_load_mw: float = 2200.0,
    wind_capacity_mw: float = 36400.0,
    solar_peak_mw: float = 9500.0,
    n_iterations: int = 500,
    block_size_hours: int = 168,  # Amostrar blocos semanais inteiros (preserva autocorrelação)
    seed: int = 42,
) -> Dict[str, Any]:
    """
    Executa Monte Carlo com amostragem em blocos temporais (Boa prática da Seção 7 do PDF).
    """
    rng = np.random.default_rng(seed)
    total_hours = len(base_df)
    n_blocks = max(1, total_hours // block_size_hours)

    peak_imports: List[float] = []
    critical_import_count = 0
    curtailment_with_dc_mwh: List[float] = []
    curtailment_without_dc_mwh: List[float] = []

    cf_array = base_df["cf_eolica"].to_numpy(dtype=float)
    base_load_array = base_df["l_base_mw"].to_numpy(dtype=float)
    solar_array = base_df["g_solar_mw"].to_numpy(dtype=float) if "g_solar_mw" in base_df.columns else np.zeros(total_hours)

    years_from_now = max(0, target_year - 2026)
    structural_growth = (1.031 ** years_from_now)

    for _ in range(n_iterations):
        # 1. Sorteio de bloco temporal semanal meteorológico
        block_idx = rng.integers(0, n_blocks)
        start_h = block_idx * block_size_hours
        end_h = start_h + block_size_hours

        cf_block = cf_array[start_h:end_h]
        load_block = base_load_array[start_h:end_h] * structural_growth
        solar_block = solar_array[start_h:end_h] * (1.0 + 0.05 * years_from_now)

        # 2. Incerteza da demanda (+/- 5%)
        sim_load_mult = rng.normal(1.0, 0.035)
        sim_base_load = load_block * sim_load_mult

        # 3. Incerteza e atraso de parques eólicos do SIGA (80% a 105% do cronograma)
        sim_wind_completion = rng.uniform(0.82, 1.03)
        sim_wind_regime = rng.uniform(0.75, 1.25)
        sim_wind_gen = np.clip(cf_block * sim_wind_regime, 0.0, 1.0) * (wind_capacity_mw * sim_wind_completion)

        # 4. Incerteza da utilização dos Data Centers (0.70 a 0.95)
        sim_dc_util = rng.uniform(0.70, 0.95)
        sim_dc_load = dc_load_mw * (sim_dc_util / 0.80)

        # 5. Balanço elétrico M(t)
        total_gen = sim_wind_gen + solar_block + BASE_HYDRO_THERMAL_MW
        margin_without_dc = total_gen - sim_base_load
        margin_with_dc = total_gen - (sim_base_load + sim_dc_load)

        # Importação necessária (-M(t))
        import_needed = np.maximum(0.0, -margin_with_dc)
        max_import = float(np.max(import_needed))
        peak_imports.append(max_import)

        if max_import > INTERCHANGE_IMPORT_LIMIT_MW:
            critical_import_count += 1

        # Curtailment (excedente além do escoamento máximo)
        curt_no_dc = np.sum(np.maximum(0.0, margin_without_dc - INTERCHANGE_EXPORT_LIMIT_MW))
        curt_dc = np.sum(np.maximum(0.0, margin_with_dc - INTERCHANGE_EXPORT_LIMIT_MW))

        # Escalonar para base anual (~52 semanas)
        curtailment_without_dc_mwh.append(curt_no_dc * 52.0)
        curtailment_with_dc_mwh.append(curt_dc * 52.0)

    peak_imports.sort()
    p50_import = float(np.percentile(peak_imports, 50))
    p95_import = float(np.percentile(peak_imports, 95))
    prob_critical = float((critical_import_count / n_iterations) * 100.0)

    avg_curt_without_dc_twh = float(np.mean(curtailment_without_dc_mwh) / 1e6)
    avg_curt_with_dc_twh = float(np.mean(curtailment_with_dc_mwh) / 1e6)
    avoided_curtailment_gwh = float(max(0.0, (avg_curt_without_dc_twh - avg_curt_with_dc_twh) * 1000.0))

    # Expansão Eólica Necessária para compensar a carga em horas críticas de vento calmo (CF P10 ~ 0.20)
    cf_firme = 0.20
    excess_import = max(0.0, p95_import - INTERCHANGE_IMPORT_LIMIT_MW)
    req_extra_wind_mw = (excess_import / cf_firme) if excess_import > 0 else (dc_load_mw * 0.35 / cf_firme)

    return {
        "target_year": target_year,
        "dc_load_mw": dc_load_mw,
        "wind_capacity_mw": wind_capacity_mw,
        "n_iterations": n_iterations,
        "prob_exceder_intercambio_pct": round(prob_critical, 2),
        "importacao_p50_mw": round(p50_import, 1),
        "importacao_p95_mw": round(p95_import, 1),
        "curtailment_com_dc_twh_ano": round(avg_curt_with_dc_twh, 2),
        "curtailment_sem_dc_twh_ano": round(avg_curt_without_dc_twh, 2),
        "curtailment_evitado_gwh_ano": round(avoided_curtailment_gwh, 1),
        "expansao_eolica_compensatoria_gw": round(req_extra_wind_mw / 1000.0, 2),
    }


def compute_project_ramp_for_year(
    ano_alvo: int,
    ano_inicio: int,
    rampa_meses: int,
    atraso_anos: float = 0.0,
) -> float:
    """
    Calcula a fração de rampa (0.0 a 1.0) de um projeto individual para um determinado ano.
    """
    data_efetiva = ano_inicio + atraso_anos
    if ano_alvo < data_efetiva:
        return 0.0
    meses_decorridos = (ano_alvo - data_efetiva) * 12.0 + 6.0
    fator = meses_decorridos / max(1.0, float(rampa_meses))
    return float(np.clip(fator, 0.0, 1.0))


def run_bottom_up_project_monte_carlo(
    base_df: pd.DataFrame,
    pipeline_df: pd.DataFrame,
    target_year: int = 2035,
    wind_capacity_mw: float = 36400.0,
    n_iterations: int = 500,
    block_size_hours: int = 168,
    seed: int = 42,
) -> Tuple[Dict[str, Any], pd.DataFrame, pd.DataFrame]:
    """
    Executa a amostragem estocástica bottom-up individual de cada projeto nominal:
    - Sorteio Bernoulli de realização (probabilidade_concretizacao)
    - Sorteio de atraso estocástico Uniforme(0, atraso_esperado_anos * 1.5)
    - Sorteio de fator de utilização Uniforme(0.70, 0.95)
    - Rampa progressiva individual
    - Agregação por Subestação de conexão à Rede Básica
    - Avaliação do balanço horário M(t) com amostragem em blocos temporais do ONS
    """
    rng = np.random.default_rng(seed)
    total_hours = len(base_df)
    n_blocks = max(1, total_hours // block_size_hours)

    cf_array = base_df["cf_eolica"].to_numpy(dtype=float)
    base_load_array = base_df["l_base_mw"].to_numpy(dtype=float)
    solar_array = base_df["g_solar_mw"].to_numpy(dtype=float) if "g_solar_mw" in base_df.columns else np.zeros(total_hours)

    years_from_now = max(0, target_year - 2026)
    structural_growth = (1.031 ** years_from_now)

    total_dc_loads: List[float] = []
    peak_imports: List[float] = []
    critical_import_count = 0
    curtailment_dc_mwh: List[float] = []
    active_projects_counts: List[int] = []

    # Dicionário para acumular demandas por subestação em cada iteração
    substations = pipeline_df["subestacao_conexao"].unique()
    substation_loads: Dict[str, List[float]] = {sub: [] for sub in substations}

    for _ in range(n_iterations):
        # 1. Simulação estocástica individual de cada projeto
        iter_dc_load = 0.0
        iter_active_count = 0
        iter_sub_load = {sub: 0.0 for sub in substations}

        for _, proj in pipeline_df.iterrows():
            prob_ok = float(proj["probabilidade_concretizacao"])
            is_realized = (rng.random() <= prob_ok)

            if not is_realized:
                continue

            atraso_max = float(proj["atraso_esperado_anos"]) * 1.5
            stochastic_delay = rng.uniform(0.0, max(0.1, atraso_max))
            ramp = compute_project_ramp_for_year(
                ano_alvo=target_year,
                ano_inicio=int(proj["ano_inicio_previsto"]),
                rampa_meses=int(proj["rampa_meses"]),
                atraso_anos=stochastic_delay,
            )

            if ramp <= 0.0:
                continue

            if proj["tipo_publicacao"] == "potencia_total_rede":
                p_rede = float(proj["potencia_total_rede_mw"])
            else:
                p_rede = float(proj["potencia_it_mw"]) * float(proj["pue_estimado"])

            sim_util = rng.uniform(0.70, 0.95)
            p_demanda = p_rede * sim_util * ramp

            iter_dc_load += p_demanda
            iter_active_count += 1
            iter_sub_load[proj["subestacao_conexao"]] += p_demanda

        total_dc_loads.append(iter_dc_load)
        active_projects_counts.append(iter_active_count)
        for sub in substations:
            substation_loads[sub].append(iter_sub_load[sub])

        # 2. Amostragem em bloco meteorológico
        block_idx = rng.integers(0, n_blocks)
        start_h = block_idx * block_size_hours
        end_h = start_h + block_size_hours

        cf_block = cf_array[start_h:end_h]
        load_block = base_load_array[start_h:end_h] * structural_growth
        solar_block = solar_array[start_h:end_h] * (1.0 + 0.05 * years_from_now)

        sim_load_mult = rng.normal(1.0, 0.035)
        sim_base_load = load_block * sim_load_mult

        sim_wind_completion = rng.uniform(0.85, 1.02)
        sim_wind_regime = rng.uniform(0.75, 1.25)
        sim_wind_gen = np.clip(cf_block * sim_wind_regime, 0.0, 1.0) * (wind_capacity_mw * sim_wind_completion)

        total_gen = sim_wind_gen + solar_block + BASE_HYDRO_THERMAL_MW
        margin_with_dc = total_gen - (sim_base_load + iter_dc_load)

        import_needed = np.maximum(0.0, -margin_with_dc)
        max_import = float(np.max(import_needed))
        peak_imports.append(max_import)

        if max_import > INTERCHANGE_IMPORT_LIMIT_MW:
            critical_import_count += 1

        curt_dc = np.sum(np.maximum(0.0, margin_with_dc - INTERCHANGE_EXPORT_LIMIT_MW))
        curtailment_dc_mwh.append(curt_dc * 52.0)

    # Estatísticas globais do Monte Carlo Bottom-Up
    p50_dc = float(np.percentile(total_dc_loads, 50))
    p90_dc = float(np.percentile(total_dc_loads, 90))
    p95_dc = float(np.percentile(total_dc_loads, 95))
    p50_import = float(np.percentile(peak_imports, 50))
    p95_import = float(np.percentile(peak_imports, 95))
    prob_critical = float((critical_import_count / n_iterations) * 100.0)

    excess_import = max(0.0, p95_import - INTERCHANGE_IMPORT_LIMIT_MW)
    req_extra_wind_mw = (excess_import / 0.20) if excess_import > 0 else (p50_dc * 0.35 / 0.20)

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

    # Estatísticas de concentração por Subestação
    sub_records = []
    for sub, loads in substation_loads.items():
        arr = np.array(loads)
        sub_info = pipeline_df[pipeline_df["subestacao_conexao"] == sub].iloc[0]
        n_proj_sub = len(pipeline_df[pipeline_df["subestacao_conexao"] == sub])
        sub_records.append({
            "subestacao": sub,
            "estado": sub_info["estado"],
            "tensao_kv": sub_info["tensao_conexao_kv"],
            "n_projetos": n_proj_sub,
            "carga_media_mw": round(float(np.mean(arr)), 1),
            "carga_p50_mw": round(float(np.percentile(arr, 50)), 1),
            "carga_p95_mw": round(float(np.percentile(arr, 95)), 1),
            "fracao_carga_total_pct": round(float(np.mean(arr) / max(1.0, np.mean(total_dc_loads)) * 100.0), 1),
        })

    df_substations_risk = pd.DataFrame(sub_records).sort_values("carga_p95_mw", ascending=False)

    df_summary = pd.DataFrame([bottom_up_summary])
    return bottom_up_summary, df_summary, df_substations_risk


def main():
    print("=" * 70)
    print("Script 06: Cruzamento de Cenários e Monte Carlo 2035")
    print("=" * 70)

    input_master = PROCESSED_DATA_DIR / "ne_hourly_master.csv"
    if not input_master.exists():
        print(f"[ERRO] Base mestre não encontrada: {input_master}")
        sys.exit(1)

    df_base = pd.read_csv(input_master)
    print(f"[INPUT] Amostrando sobre {len(df_base)} horas históricas do NE.")

    # 1. Cruzamento comparativo principal dos cenários canônicos (Seção 8 do PDF)
    casos = [
        {"nome": "Sem Data Centers (Base SIGA)", "dc_mw": 0.0, "wind_mw": 29600.0},
        {"nome": "DC Conservador + Eólica Base", "dc_mw": 950.0, "wind_mw": 29600.0},
        {"nome": "DC Central + Eólica Intermediária", "dc_mw": 2200.0, "wind_mw": 36400.0},
        {"nome": "DC Stress Test + Eólica Alta", "dc_mw": 4100.0, "wind_mw": 44400.0},
    ]

    results = []
    for caso in casos:
        print(f"\n[SIMULAÇÃO CENÁRIO] {caso['nome']}...")
        res = run_monte_carlo_block_simulation(
            df_base,
            target_year=2035,
            dc_load_mw=caso["dc_mw"],
            wind_capacity_mw=caso["wind_mw"],
            n_iterations=500,
            seed=42,
        )
        res["cenario_nome"] = caso["nome"]
        results.append(res)

    results_df = pd.DataFrame(results)
    cols_order = [
        "cenario_nome", "dc_load_mw", "wind_capacity_mw",
        "prob_exceder_intercambio_pct", "importacao_p95_mw",
        "curtailment_com_dc_twh_ano", "curtailment_evitado_gwh_ano",
        "expansao_eolica_compensatoria_gw"
    ]
    summary_table = results_df[cols_order]
    report_path = REPORTS_DIR / "matriz_cenarios_monte_carlo_2035.csv"
    summary_table.to_csv(report_path, index=False)

    print("\n" + "=" * 70)
    print("Entrega Final: Matriz Canônica de Risco e Expansão Eólica até 2035:")
    print("=" * 70)
    print(summary_table.to_string(index=False))

    # 2. Simulação Estocástica Bottom-Up Projeto a Projeto (Passo 2 Concluído)
    pipeline_file = RAW_DATA_DIR / "data_centers_pipeline_ne.csv"
    if pipeline_file.exists():
        print("\n" + "=" * 70)
        print("Etapa 2: Simulação Monte Carlo Bottom-Up com 14 Projetos Nominais e Subestações")
        print("=" * 70)
        df_pipeline = pd.read_csv(pipeline_file)

        bu_dict, bu_summary_df, bu_subs_df = run_bottom_up_project_monte_carlo(
            base_df=df_base,
            pipeline_df=df_pipeline,
            target_year=2035,
            wind_capacity_mw=36400.0,  # Eólica intermediária
            n_iterations=500,
            seed=42,
        )

        bu_report_path = REPORTS_DIR / "relatorio_monte_carlo_bottom_up_projetos_2035.csv"
        bu_summary_df.to_csv(bu_report_path, index=False)
        print(f"[BOTTOM-UP] Resumo geral gravado em: {bu_report_path}")
        print(bu_summary_df.to_string(index=False))

        subs_risk_path = REPORTS_DIR / "risco_subestacoes_rede_basica_2035.csv"
        bu_subs_df.to_csv(subs_risk_path, index=False)
        print(f"\n[SUBESTAÇÕES] Risco de Demanda por Barramento em 2035 gravado em: {subs_risk_path}")
        print(bu_subs_df.to_string(index=False))

    print(f"\n[SUCESSO] Todos os relatórios de Monte Carlo exportados em: {REPORTS_DIR}")


if __name__ == "__main__":
    main()

