"""
02_build_dc_and_offshore_scenarios.py
Etapa 02: Modelagem Bottom-Up de Projetos Nominais de Data Centers (MME/EPE)
e Trajetórias de Expansão Eólica Onshore/Offshore 2026-2035
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Carregar o cadastro nominal de projetos de Data Centers no Nordeste (data/raw/data_centers_pipeline_ne.csv).
- Modelar bottom-up a rampa progressiva individual por projeto (data de entrada, rampa em meses, PUE e MUST).
- Agregar cargas por cenário (Conservador, Central, Stress Test), por Estado (CE, PE, RN, BA, PB)
  e por Subestação de conexão à Rede Básica do SIN (SE Pecém II, SE Caucaia, SE Suape II, etc.).
- Construir trajetórias de capacidade eólica onshore (SIGA/ANEEL) e offshore pós-2031 (IBAMA/MME).
"""

import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

from config import (
    RAW_DATA_DIR,
    SCENARIOS_DATA_DIR,
    REPORTS_DIR,
    BASE_WIND_ONSHORE_2026_MW,
    WIND_EXPANSION_ONSHORE_MW,
    DEFAULT_PUE,
    DEFAULT_UTILIZATION,
)


def load_data_center_pipeline(filepath: Optional[Path] = None) -> pd.DataFrame:
    """
    Carrega o cadastro oficial de projetos de Data Centers no Nordeste.
    """
    if filepath is None:
        filepath = RAW_DATA_DIR / "data_centers_pipeline_ne.csv"

    if not filepath.exists():
        raise FileNotFoundError(f"Arquivo cadastral de Data Centers não encontrado em: {filepath}")

    df = pd.read_csv(filepath)
    print(f"[PIPELINE DC] {len(df)} projetos carregados com sucesso de {filepath.name}.")
    return df


def compute_project_ramp_for_year(
    ano_alvo: int,
    ano_inicio: int,
    rampa_meses: int,
    atraso_anos: float = 0.0,
) -> float:
    """
    Calcula a fração de rampa (0.0 a 1.0) de um projeto individual para um determinado ano.
    Considera o início da operação no meio do ano base mais eventuais atrasos.
    """
    data_efetiva_inicio = ano_inicio + atraso_anos
    if ano_alvo < data_efetiva_inicio:
        return 0.0

    anos_decorridos = ano_alvo - data_efetiva_inicio
    meses_decorridos = anos_decorridos * 12.0 + 6.0  # Ponto médio anual
    fator = meses_decorridos / max(1.0, float(rampa_meses))
    return float(np.clip(fator, 0.0, 1.0))


def compute_bottom_up_dc_loads_by_year(
    df_pipeline: pd.DataFrame,
    anos: List[int] = list(range(2026, 2036)),
    utilization: float = DEFAULT_UTILIZATION,
    aplicar_atrasos: bool = False,
) -> pd.DataFrame:
    """
    Simula ano a ano a demanda ativa de cada projeto individual na rede básica.
    Respeita a regra da Seção 5: se a potência publicada já for a carga total na rede, omite o PUE.
    """
    records = []

    for ano in anos:
        for _, row in df_pipeline.iterrows():
            atraso = row["atraso_esperado_anos"] if aplicar_atrasos else 0.0
            ramp = compute_project_ramp_for_year(
                ano_alvo=ano,
                ano_inicio=int(row["ano_inicio_previsto"]),
                rampa_meses=int(row["rampa_meses"]),
                atraso_anos=atraso,
            )

            # Carga máxima contratada na rede
            if row["tipo_publicacao"] == "potencia_total_rede":
                p_rede_total = float(row["potencia_total_rede_mw"])
            else:
                p_it = float(row["potencia_it_mw"])
                pue = float(row["pue_estimado"])
                p_rede_total = p_it * pue

            demanda_efetiva_mw = p_rede_total * utilization * ramp

            records.append({
                "ano": ano,
                "id_projeto": row["id_projeto"],
                "nome_projeto": row["nome_projeto"],
                "estado": row["estado"],
                "municipio": row["municipio"],
                "subestacao_conexao": row["subestacao_conexao"],
                "tensao_conexao_kv": row["tensao_conexao_kv"],
                "cenario_enquadramento": row["cenario_enquadramento"],
                "probabilidade_concretizacao": row["probabilidade_concretizacao"],
                "fator_rampa": round(ramp, 3),
                "potencia_it_mw": row["potencia_it_mw"],
                "potencia_rede_total_mw": round(p_rede_total, 1),
                "demanda_efetiva_mw": round(demanda_efetiva_mw, 1),
            })

    return pd.DataFrame(records)


def compute_scenario_aggregate_loads(df_annual_projects: pd.DataFrame) -> pd.DataFrame:
    """
    Agrega os projetos nos 3 cenários canônicos do Plano Orientador:
    - Conservador: apenas projetos com cenario_enquadramento == 'conservative'
    - Central: conservative + central
    - High (Stress Test): conservative + central + high
    - None: 0.0 MW
    """
    cenarios = ["none", "conservative", "central", "high"]
    years = sorted(df_annual_projects["ano"].unique())
    records = []

    for y in years:
        df_y = df_annual_projects[df_annual_projects["ano"] == y]

        for sc in cenarios:
            if sc == "none":
                carga_mw = 0.0
                it_mw = 0.0
                n_proj = 0
            elif sc == "conservative":
                sub = df_y[df_y["cenario_enquadramento"] == "conservative"]
                carga_mw = sub["demanda_efetiva_mw"].sum()
                it_mw = sub["potencia_it_mw"].sum()
                n_proj = len(sub[sub["demanda_efetiva_mw"] > 0])
            elif sc == "central":
                sub = df_y[df_y["cenario_enquadramento"].isin(["conservative", "central"])]
                carga_mw = sub["demanda_efetiva_mw"].sum()
                it_mw = sub["potencia_it_mw"].sum()
                n_proj = len(sub[sub["demanda_efetiva_mw"] > 0])
            else:  # high
                sub = df_y
                carga_mw = sub["demanda_efetiva_mw"].sum()
                it_mw = sub["potencia_it_mw"].sum()
                n_proj = len(sub[sub["demanda_efetiva_mw"] > 0])

            records.append({
                "ano": y,
                "cenario_dc": sc,
                "carga_efetiva_dc_mw": round(carga_mw, 1),
                "potencia_it_dc_mw": round(it_mw, 1),
                "projetos_ativos": n_proj,
            })

    return pd.DataFrame(records)


def compute_wind_installed_trajectory(
    target_year: int,
    scenario_id: str = "intermediate",
    include_offshore_post_2031: bool = False,
) -> Dict[str, float]:
    """
    Calcula a capacidade eólica total dividida entre Onshore (SIGA/ANEEL) e Offshore (IBAMA/MME).
    Eólicas Offshore possuem lead time ambiental/portuário extenso e entram gradualmente após 2031.
    """
    year_frac = max(0.0, min(1.0, (target_year - 2026) / 9.0))
    onshore_add = WIND_EXPANSION_ONSHORE_MW.get(scenario_id, 0.0) * (year_frac ** 0.9)
    onshore_mw = BASE_WIND_ONSHORE_2026_MW + onshore_add

    offshore_mw = 0.0
    if include_offshore_post_2031 and target_year >= 2032:
        offshore_progress = (target_year - 2031) / 4.0  # 2032..2035
        mult = 3600.0 if scenario_id == "high" else 1800.0 if scenario_id == "intermediate" else 800.0
        offshore_mw = mult * offshore_progress

    return {
        "target_year": target_year,
        "onshore_mw": round(onshore_mw, 1),
        "offshore_mw": round(offshore_mw, 1),
        "total_wind_mw": round(onshore_mw + offshore_mw, 1),
    }


def compute_substation_load_concentration(df_annual_projects: pd.DataFrame, target_year: int = 2035) -> pd.DataFrame:
    """
    Identifica os barramentos mais impactados na Rede Básica do Nordeste (SE Pecém II, SE Caucaia, SE Suape II, etc.).
    """
    df_target = df_annual_projects[df_annual_projects["ano"] == target_year]
    grouped = df_target.groupby(["subestacao_conexao", "estado", "tensao_conexao_kv"]).agg(
        n_projetos=("id_projeto", "count"),
        potencia_it_total_mw=("potencia_it_mw", "sum"),
        demanda_efetiva_2035_mw=("demanda_efetiva_mw", "sum"),
    ).reset_index().sort_values("demanda_efetiva_2035_mw", ascending=False)

    total_ne = grouped["demanda_efetiva_2035_mw"].sum()
    grouped["participacao_pct"] = (grouped["demanda_efetiva_2035_mw"] / max(1.0, total_ne) * 100.0).round(1)
    return grouped


def generate_full_scenario_matrix(df_dc_scenarios: pd.DataFrame) -> pd.DataFrame:
    """
    Cruza cada cenário de Data Center com as trajetórias de expansão eólica (Base, Intermediário, Alto).
    """
    wind_scenarios = ["base", "intermediate", "high"]
    records = []

    for _, row in df_dc_scenarios.iterrows():
        ano = int(row["ano"])
        dc_scen = row["cenario_dc"]
        dc_carga_mw = float(row["carga_efetiva_dc_mw"])
        dc_it_mw = float(row["potencia_it_dc_mw"])
        n_proj = int(row["projetos_ativos"])

        for w_scen in wind_scenarios:
            w_cap = compute_wind_installed_trajectory(
                ano, w_scen, include_offshore_post_2031=(w_scen == "high")
            )
            records.append({
                "ano": ano,
                "cenario_dc": dc_scen,
                "potencia_it_dc_mw": dc_it_mw,
                "carga_efetiva_dc_mw": dc_carga_mw,
                "projetos_ativos": n_proj,
                "cenario_eolica": w_scen,
                "eolica_onshore_mw": w_cap["onshore_mw"],
                "eolica_offshore_mw": w_cap["offshore_mw"],
                "eolica_total_mw": w_cap["total_wind_mw"],
            })

    return pd.DataFrame(records)


def main():
    print("=" * 70)
    print("Script 02: Modelagem Bottom-Up do Pipeline de Data Centers e Eólica")
    print("=" * 70)

    # 1. Carregar pipeline nominal
    pipeline_df = load_data_center_pipeline()

    # 2. Simular demanda individual ano a ano (2026-2035)
    df_annual_projects = compute_bottom_up_dc_loads_by_year(pipeline_df)
    proj_summary_path = SCENARIOS_DATA_DIR / "dc_pipeline_project_summary.csv"
    df_annual_projects.to_csv(proj_summary_path, index=False)
    print(f"[PROJETOS] Resumo anual individual gravado em: {proj_summary_path}")

    # 3. Concentração espacial por subestação da Rede Básica
    substations_df = compute_substation_load_concentration(df_annual_projects, target_year=2035)
    substations_path = SCENARIOS_DATA_DIR / "dc_substation_load_concentration.csv"
    substations_df.to_csv(substations_path, index=False)
    print(f"\nConcentração Geográfica por Subestação em 2035 (Total: {substations_df['demanda_efetiva_2035_mw'].sum():.1f} MW):")
    print(substations_df.to_string(index=False))

    # 4. Agregar por cenários e cruzar com eólica
    df_dc_scen = compute_scenario_aggregate_loads(df_annual_projects)
    df_full_matrix = generate_full_scenario_matrix(df_dc_scen)
    matrix_path = SCENARIOS_DATA_DIR / "matriz_cenarios_dc_eolica_2026_2035.csv"
    df_full_matrix.to_csv(matrix_path, index=False)
    print(f"\n[SUCESSO] Matriz de cenários cruzados gerada com {len(df_full_matrix)} linhas em: {matrix_path}")

    # 5. Exibir Projeções para 2035
    df_2035 = df_full_matrix[df_full_matrix["ano"] == 2035]
    print("\nResumo das Projeções Bottom-Up para 2035:")
    print(df_2035[["cenario_dc", "carga_efetiva_dc_mw", "projetos_ativos", "cenario_eolica", "eolica_total_mw"]].drop_duplicates().to_string(index=False))


if __name__ == "__main__":
    main()
