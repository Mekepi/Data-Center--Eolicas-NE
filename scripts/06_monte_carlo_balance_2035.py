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
    REPORTS_DIR,
    INTERCHANGE_IMPORT_LIMIT_MW,
    INTERCHANGE_EXPORT_LIMIT_MW,
    BASE_HYDRO_THERMAL_MW,
)


def _prepare_seasonal_blocks(base_df: pd.DataFrame) -> Dict[str, np.ndarray]:
    """
    Extrai os vetores históricos reais (2022-2025, refletindo a estrutura moderna da matriz solar/eólica NE)
    para reamostragem em blocos semanais (168h) preservando autocorrelação horária e sinóptica.
    """
    df_rec = base_df.copy()
    ts = pd.to_datetime(df_rec["ts"])
    df_rec["year"] = ts.dt.year
    modern = df_rec[df_rec["year"] >= 2022].reset_index(drop=True)
    if len(modern) < 8760:
        modern = df_rec.reset_index(drop=True)

    return {
        "cf": modern["cf_eolica"].to_numpy(dtype=float),
        "load": modern["l_base_mw"].to_numpy(dtype=float),
        "solar": modern["g_solar_mw"].fillna(0.0).to_numpy(dtype=float),
    }


def _compute_chesf_hydro_thermal_dispatch(
    base_load_mw: np.ndarray,
    wind_gen_mw: np.ndarray,
    solar_gen_mw: np.ndarray,
) -> np.ndarray:
    """
    Modela a resposta operativa real das hidrelétricas da Chesf (Rio São Francisco ~10,5 GW instalados)
    e térmicas/biomassa no Nordeste:
    - Piso operativo de vazão mínima / inflexibilidade: ~2.600 MW
    - Em horas de déficit líquido renovável (noite/calmaria), modula até o teto disponível de ponta (~9.850 MW).
    """
    net_thermal_hydro_need = np.maximum(0.0, base_load_mw - (wind_gen_mw + solar_gen_mw))
    modulated = 2600.0 + 0.56 * net_thermal_hydro_need
    return np.clip(modulated, 2600.0, 9850.0)


def _simulate_scenario_worker(
    args: Tuple[str, str, int, float, float, float, int, int, Dict[str, np.ndarray]]
) -> Dict[str, Any]:
    """
    Worker executado em multiprocessing.Pool para simular N blocos semanais estocásticos (168h)
    escalados para base anual (8.760h).
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
    ) = args

    rng = np.random.default_rng(seed)
    cf_arr = arrays["cf"]
    load_arr = arrays["load"]
    solar_arr = arrays["solar"]

    block_size = 168
    n_blocks = max(1, len(cf_arr) // block_size)

    years_from_2025 = max(0, target_year - 2025)
    structural_load_growth = (1.031 ** years_from_2025)
    solar_growth = 1.0 + 0.045 * years_from_2025
    wind_capacity_mw = wind_onshore_mw + wind_offshore_mw
    offshore_share = wind_offshore_mw / max(1.0, wind_capacity_mw)

    peak_imports = np.empty(n_iterations, dtype=float)
    peak_imports_no_dc = np.empty(n_iterations, dtype=float)
    exceed_hours_annual = np.empty(n_iterations, dtype=float)
    curt_with_dc_twh = np.empty(n_iterations, dtype=float)
    curt_without_dc_twh = np.empty(n_iterations, dtype=float)
    min_margins_mw = np.empty(n_iterations, dtype=float)

    for i in range(n_iterations):
        # 1. Sorteio de bloco semanal contíguo (168h) preservando autocorrelação de vento, sol e carga
        b_idx = int(rng.integers(0, n_blocks))
        s = b_idx * block_size
        e = s + block_size

        cf_block = cf_arr[s:e]
        load_block = load_arr[s:e] * structural_load_growth
        solar_block = solar_arr[s:e] * solar_growth

        # 2. Incerteza da demanda base (resíduo Modelo A + anomalia de temperatura)
        sim_base_load = load_block * rng.normal(1.0, 0.032)

        # 3. Incerteza de execução de obras SIGA/IBAMA e regime de vento interanual
        sim_wind_completion = rng.uniform(0.86, 1.02)
        sim_wind_regime = rng.uniform(0.76, 1.24)
        effective_cf = np.clip(
            cf_block * sim_wind_regime + offshore_share * 0.09 * (1.0 - cf_block),
            0.0,
            0.98,
        )
        sim_wind_gen = effective_cf * (wind_capacity_mw * sim_wind_completion)

        # 4. Incerteza de utilização e PUE térmico dos Data Centers
        sim_dc_load = dc_load_mw * rng.uniform(0.90, 1.08) if dc_load_mw > 0 else 0.0

        # 5. Despacho hidrotérmico modulado (Chesf + térmicas flexíveis) e Margem M(t)
        hydro_thermal_mw = _compute_chesf_hydro_thermal_dispatch(sim_base_load, sim_wind_gen, solar_block)
        total_gen = sim_wind_gen + solar_block + hydro_thermal_mw

        margin_no_dc = total_gen - sim_base_load
        margin_with_dc = total_gen - (sim_base_load + sim_dc_load)

        import_no_dc = np.maximum(0.0, -margin_no_dc)
        import_with_dc = np.maximum(0.0, -margin_with_dc)

        peak_imports_no_dc[i] = float(np.max(import_no_dc))
        peak_imports[i] = float(np.max(import_with_dc))
        min_margins_mw[i] = float(np.min(margin_with_dc))

        scale_to_year = 8760.0 / block_size
        exceed_hours_annual[i] = float(np.sum(import_with_dc > INTERCHANGE_IMPORT_LIMIT_MW) * scale_to_year)

        # 6. Curtailment Horário (Modelo C: limite de exportação SIN 9.500 MW + restrição elétrica solar diurna)
        export_threshold = INTERCHANGE_EXPORT_LIMIT_MW - 0.18 * solar_block
        curt_no_dc_mw = np.maximum(0.0, margin_no_dc - export_threshold)
        curt_dc_mw = np.maximum(0.0, margin_with_dc - export_threshold)

        curt_without_dc_twh[i] = float(np.sum(curt_no_dc_mw) * scale_to_year / 1e6)
        curt_with_dc_twh[i] = float(np.sum(curt_dc_mw) * scale_to_year / 1e6)

    p50_import = float(np.percentile(peak_imports, 50))
    p90_import = float(np.percentile(peak_imports, 90))
    p95_import = float(np.percentile(peak_imports, 95))
    prob_critical = float(np.mean(peak_imports > INTERCHANGE_IMPORT_LIMIT_MW) * 100.0)
    lole_hours = float(np.mean(exceed_hours_annual))

    avg_curt_no_dc = float(np.mean(curt_without_dc_twh))
    avg_curt_dc = float(np.mean(curt_with_dc_twh))
    avoided_gwh = float(max(0.0, (avg_curt_no_dc - avg_curt_dc) * 1000.0))
    avoided_pct = float((avoided_gwh / max(1.0, avg_curt_no_dc * 1000.0)) * 100.0)

    # Expansão eólica compensatória necessária (Seção 8 do PDF):
    # Quantos GW eólicos adicionais são necessários para neutralizar a violação do limite de 7.000 MW no P95
    # considerando o Fator de Capacidade firme P10 em horas críticas de baixa geração (CF_firme ~ 0.21)
    cf_firme_critico = 0.21 + 0.06 * offshore_share
    excess_import_p95 = max(0.0, p95_import - INTERCHANGE_IMPORT_LIMIT_MW)
    req_extra_wind_gw = (excess_import_p95 / cf_firme_critico) / 1000.0

    return {
        "cenario_nome": cenario_nome,
        "cenario_dc": cenario_dc_id,
        "target_year": target_year,
        "dc_load_mw": round(dc_load_mw, 1),
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
    target_year: int = 2035,
    wind_capacity_mw: float = 36400.0,
    n_iterations: int = 800,
    block_size_hours: int = 168,
    seed: int = 42,
) -> Tuple[Dict[str, Any], pd.DataFrame, pd.DataFrame]:
    """
    Executa a amostragem estocástica bottom-up individual dos 14 projetos nominais:
    Bernoulli(p) de concretização + Uniforme(0, 1.5*atraso) + agregação por Subestação da Rede Básica.
    """
    rng = np.random.default_rng(seed)
    arrays = _prepare_seasonal_blocks(base_df)
    cf_array = arrays["cf"]
    base_load_array = arrays["load"]
    solar_array = arrays["solar"]
    total_hours = len(cf_array)
    n_blocks = max(1, total_hours // block_size_hours)

    years_from_2025 = max(0, target_year - 2025)
    structural_growth = (1.031 ** years_from_2025)

    total_dc_loads: List[float] = []
    peak_imports: List[float] = []
    critical_import_count = 0
    curtailment_dc_mwh: List[float] = []
    active_projects_counts: List[int] = []

    substations = pipeline_df["subestacao_conexao"].unique()
    substation_loads: Dict[str, List[float]] = {sub: [] for sub in substations}

    for _ in range(n_iterations):
        iter_dc_load = 0.0
        iter_active_count = 0
        iter_sub_load = {sub: 0.0 for sub in substations}

        for _, proj in pipeline_df.iterrows():
            prob_ok = float(proj["probabilidade_concretizacao"])
            if rng.random() > prob_ok:
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

            sim_util = rng.uniform(0.72, 0.94)
            p_demanda = p_rede * sim_util * ramp

            iter_dc_load += p_demanda
            iter_active_count += 1
            iter_sub_load[proj["subestacao_conexao"]] += p_demanda

        total_dc_loads.append(iter_dc_load)
        active_projects_counts.append(iter_active_count)
        for sub in substations:
            substation_loads[sub].append(iter_sub_load[sub])

        block_idx = int(rng.integers(0, n_blocks))
        start_h = block_idx * block_size_hours
        end_h = start_h + block_size_hours

        cf_block = cf_array[start_h:end_h]
        load_block = base_load_array[start_h:end_h] * structural_growth
        solar_block = solar_array[start_h:end_h] * (1.0 + 0.045 * years_from_2025)

        sim_base_load = load_block * rng.normal(1.0, 0.032)
        sim_wind_completion = rng.uniform(0.86, 1.02)
        sim_wind_regime = rng.uniform(0.76, 1.24)
        sim_wind_gen = np.clip(cf_block * sim_wind_regime, 0.0, 1.0) * (wind_capacity_mw * sim_wind_completion)

        hydro_thermal_mw = _compute_chesf_hydro_thermal_dispatch(sim_base_load, sim_wind_gen, solar_block)
        total_gen = sim_wind_gen + solar_block + hydro_thermal_mw
        margin_with_dc = total_gen - (sim_base_load + iter_dc_load)

        import_needed = np.maximum(0.0, -margin_with_dc)
        max_import = float(np.max(import_needed))
        peak_imports.append(max_import)

        if max_import > INTERCHANGE_IMPORT_LIMIT_MW:
            critical_import_count += 1

        export_threshold = INTERCHANGE_EXPORT_LIMIT_MW - 0.18 * solar_block
        curt_dc = np.sum(np.maximum(0.0, margin_with_dc - export_threshold))
        curtailment_dc_mwh.append(curt_dc * 52.0)

    p50_dc = float(np.percentile(total_dc_loads, 50))
    p90_dc = float(np.percentile(total_dc_loads, 90))
    p95_dc = float(np.percentile(total_dc_loads, 95))
    p50_import = float(np.percentile(peak_imports, 50))
    p95_import = float(np.percentile(peak_imports, 95))
    prob_critical = float((critical_import_count / n_iterations) * 100.0)

    excess_import = max(0.0, p95_import - INTERCHANGE_IMPORT_LIMIT_MW)
    req_extra_wind_mw = excess_import / 0.21

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
    print("=" * 72)
    print("Script 06 (Passo 4): Simulação Estocástica de Monte Carlo 2026-2035 (Multiprocessing)")
    print("=" * 72)

    input_master = PROCESSED_DATA_DIR / "ne_hourly_master.csv"
    if not input_master.exists():
        print(f"[ERRO] Base mestre não encontrada: {input_master}")
        sys.exit(1)

    df_base = pd.read_csv(input_master)
    arrays = _prepare_seasonal_blocks(df_base)
    n_workers = max(1, min(6, os.cpu_count() or 2))

    # 1. Matriz Completa dos 12 Cenários Cruzados em 2035 (4 DCs x 3 Eólicas)
    dc_configs = [
        ("none", "Sem Data Centers (Controle)", 0.0),
        ("conservative", "DC Conservador (469 MW rede)", 469.0),
        ("central", "DC Central Ponderado (1.597 MW rede)", 1596.8),
        ("high", "DC Stress Test / IA (3.414 MW rede)", 3414.4),
    ]
    wind_configs = [
        ("base", "Eólica Base (29,6 GW Onshore)", 29600.0, 0.0),
        ("intermediate", "Eólica Intermediária SIGA (36,4 GW)", 36400.0, 0.0),
        ("high_offshore", "Eólica Alta + Offshore IBAMA (48,0 GW)", 44400.0, 3600.0),
    ]

    tasks_12 = []
    for dc_id, dc_label, dc_mw in dc_configs:
        for w_id, w_label, w_on, w_off in wind_configs:
            # Usar mesma semente base (42) para emparelhar os sorteios climáticos (Common Random Numbers)
            tasks_12.append((
                f"{dc_label} × {w_label}",
                dc_id,
                2035,
                dc_mw,
                w_on,
                w_off,
                1000,
                42,
                arrays,
            ))

    print(f"[MONTE CARLO 2035] Executando 12 cenários cruzados (12.000 simulações) em {n_workers} processos...")
    with mp.Pool(processes=n_workers) as pool:
        res_12 = pool.map(_simulate_scenario_worker, tasks_12)

    df_12 = pd.DataFrame(res_12)
    report_12_path = REPORTS_DIR / "matriz_cenarios_monte_carlo_2035.csv"
    df_12.to_csv(report_12_path, index=False)

    print("\nMatriz Completa de Risco e Curtailment em 2035 (12 Cenários):")
    print(
        df_12[[
            "cenario_nome", "dc_load_mw", "wind_capacity_mw",
            "prob_exceder_intercambio_pct", "importacao_p95_mw",
            "curtailment_com_dc_twh_ano", "curtailment_evitado_gwh_ano",
            "expansao_eolica_compensatoria_gw",
        ]].to_string(index=False)
    )

    # 2. Curva de Trade-Off de Expansão Eólica Compensatória em 2035 (Cenário Central DC = 1.596,8 MW)
    extra_gw_grid = [0.0, 2.0, 4.0, 6.8, 10.0, 14.8, 18.4]
    comp_tasks = []
    for extra_gw in extra_gw_grid:
        w_on = 29600.0 + min(14800.0, extra_gw * 1000.0)
        w_off = max(0.0, (extra_gw - 14.8) * 1000.0)
        comp_tasks.append((
            f"+{extra_gw:.1f} GW Eólicos Extras",
            "central",
            2035,
            1596.8,
            w_on,
            w_off,
            1000,
            42,
            arrays,
        ))

    with mp.Pool(processes=n_workers) as pool:
        comp_res = pool.map(_simulate_scenario_worker, comp_tasks)
    df_comp = pd.DataFrame(comp_res)
    df_comp["expansao_adicional_gw"] = extra_gw_grid
    df_comp.to_csv(REPORTS_DIR / "curva_expansao_eolica_compensatoria_2035.csv", index=False)

    # 3. Evolução Temporal Anual do Risco 2026 a 2035 (Trajetória Rampa DC Central vs Eólica Intermediária)
    dc_ramp_by_year = {
        2026: 185.0, 2027: 492.0, 2028: 948.0, 2029: 1345.0, 2030: 1522.0,
        2031: 1596.8, 2032: 1596.8, 2033: 1596.8, 2034: 1596.8, 2035: 1596.8,
    }
    timeline_tasks = []
    for y in range(2026, 2036):
        frac = (y - 2026) / 9.0
        w_on = 29600.0 + 6800.0 * (frac ** 0.9)
        timeline_tasks.append((
            f"Trajetória Central {y}",
            "central",
            y,
            dc_ramp_by_year[y],
            w_on,
            0.0,
            800,
            42,
            arrays,
        ))

    with mp.Pool(processes=n_workers) as pool:
        timeline_res = pool.map(_simulate_scenario_worker, timeline_tasks)
    df_timeline = pd.DataFrame(timeline_res)
    df_timeline.to_csv(REPORTS_DIR / "evolucao_anual_risco_2026_2035.csv", index=False)

    # 4. Simulação Bottom-Up Projeto a Projeto e Risco por Subestação (14 Projetos Nominais)
    pipeline_file = RAW_DATA_DIR / "data_centers_pipeline_ne.csv"
    if pipeline_file.exists():
        df_pipeline = pd.read_csv(pipeline_file)
        _, bu_summary_df, bu_subs_df = run_bottom_up_project_monte_carlo(
            base_df=df_base,
            pipeline_df=df_pipeline,
            target_year=2035,
            wind_capacity_mw=36400.0,
            n_iterations=1000,
            seed=42,
        )
        bu_summary_df.to_csv(REPORTS_DIR / "relatorio_monte_carlo_bottom_up_projetos_2035.csv", index=False)
        bu_subs_df.to_csv(REPORTS_DIR / "risco_subestacoes_rede_basica_2035.csv", index=False)
        print("\nResumo Monte Carlo Bottom-Up (14 Projetos Nominais em 2035):")
        print(bu_summary_df.to_string(index=False))

    print(f"\n[SUCESSO] Passo 4 concluído! Todos os 5 relatórios de Monte Carlo exportados em: {REPORTS_DIR}")


if __name__ == "__main__":
    main()
