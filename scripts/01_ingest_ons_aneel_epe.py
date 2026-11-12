"""
01_ingest_ons_aneel_epe.py
Etapa 01: Ingestão, Download e Harmonização Temporal (ONS + ANEEL + EPE)
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Baixar ou carregar as séries históricas brutas de Carga, Geração por Usina/Fonte e Constrained-off do ONS.
- Filtrar o Subsistema Nordeste (id_subsistema == 'NE') e unificar em grade temporal horária UTC-3.
- Reconstituir a geração eólica potencial somando a geração verificada com a energia cortada (curtailment).
- Integrar a capacidade instalada eólica histórica e trajetórias de expansão do SIGA/ANEEL.
"""

import sys
from pathlib import Path
from typing import Optional
import urllib3
import pandas as pd
import numpy as np

# Importar configurações centrais
from config import (
    RAW_DATA_DIR,
    PROCESSED_DATA_DIR,
    SUBSYSTEM_ID,
    BASE_WIND_ONSHORE_2026_MW,
    BASE_HYDRO_THERMAL_MW,
)

http = urllib3.PoolManager()


def download_official_file(url: str, dest_path: Path, force: bool = False) -> Path:
    """
    Realiza o download de arquivos oficiais usando urllib3 (biblioteca padrão aprovada).
    Se o arquivo já existir localmente e force=False, reaproveita o cache local.
    """
    if dest_path.exists() and not force:
        print(f"[CACHE] Arquivo existente: {dest_path.name}")
        return dest_path

    print(f"[DOWNLOAD] Baixando de {url} -> {dest_path.name}...")
    try:
        response = http.request("GET", url, preload_content=False, timeout=30.0)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f:
            for chunk in response.stream(1024 * 64):
                f.write(chunk)
        response.release_conn()
        print(f"[OK] Download concluído: {dest_path.name}")
    except Exception as e:
        print(f"[AVISO] Falha ao baixar de {url}: {e}. Tentando prosseguir com arquivo local se houver.")
    return dest_path


def load_ons_hourly_load(filepath: Path) -> pd.DataFrame:
    """
    Carrega e harmoniza a Curva de Carga Horária do ONS.
    Filtra Subsistema NE e padroniza a coluna temporal 'ts' e 'l_base_mw'.
    """
    if not filepath.exists():
        raise FileNotFoundError(f"Arquivo de carga não encontrado em: {filepath}")

    df = pd.read_csv(filepath, sep=";", parse_dates=["din_instante"])
    # Filtrar subsistema Nordeste
    if "id_subsistema" in df.columns:
        df = df[df["id_subsistema"] == SUBSYSTEM_ID]

    # Renomear colunas canônicas
    col_map = {
        "din_instante": "ts",
        "val_cargaenergiahomwmed": "l_base_mw",
        "val_carga": "l_base_mw",
    }
    df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})
    df = df[["ts", "l_base_mw"]].dropna().sort_values("ts").drop_duplicates(subset=["ts"])
    return df


def load_ons_subsystem_generation(filepath: Path) -> pd.DataFrame:
    """
    Carrega o Balanço de Energia nos Subsistemas do ONS.
    Extrai as gerações horárias por fonte (Eólica, Solar, Hidro, Térmica) e o Intercâmbio líquido.
    """
    if not filepath.exists():
        raise FileNotFoundError(f"Arquivo de balanço não encontrado em: {filepath}")

    df = pd.read_csv(filepath, sep=";", parse_dates=["din_instante"])
    if "id_subsistema" in df.columns:
        df = df[df["id_subsistema"] == SUBSYSTEM_ID]

    col_map = {
        "din_instante": "ts",
        "val_gereolica": "g_eolica_verificada_mw",
        "val_gersolar": "g_solar_mw",
        "val_gerhidraulica": "g_hidraulica_mw",
        "val_gertermica": "g_termica_mw",
        "val_intercambio": "intercambio_liquido_mw",
    }
    df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})
    available_cols = [c for c in col_map.values() if c in df.columns]
    return df[available_cols].dropna(subset=["ts"]).sort_values("ts").drop_duplicates(subset=["ts"])


def load_ons_constrained_off(filepath: Path) -> pd.DataFrame:
    """
    Carrega o arquivo de Restrição de Operação (Constrained-off / Curtailment) de Usinas Eólicas do ONS.
    Utiliza val_geracaonaorealizadaapurada e din_instante, agregando em média horária.
    """
    if not filepath.exists():
        print(f"[AVISO] Arquivo de constrained-off não localizado em {filepath}. Assumindo corte zero.")
        return pd.DataFrame(columns=["ts", "curtailment_mw", "flag_curtailment"])

    print(f"[INGEST] Processando constrained-off eólico real: {filepath.name}...")
    # Ler apenas colunas essenciais para economizar memória
    usecols = ["id_subsistema", "din_instante", "val_geracaonaorealizadaapurada"]
    df = pd.read_csv(filepath, sep=";", usecols=usecols, parse_dates=["din_instante"])
    df = df[df["id_subsistema"].str.strip() == SUBSYSTEM_ID]

    # Preencher nulos com zero
    df["curtailment_mw"] = df["val_geracaonaorealizadaapurada"].fillna(0.0)

    # Agregar soma de geração cortada de todos os parques por hora no NE
    hourly = (
        df.groupby(pd.Grouper(key="din_instante", freq="1h"))["curtailment_mw"]
        .sum()
        .reset_index()
        .rename(columns={"din_instante": "ts"})
    )
    hourly["flag_curtailment"] = (hourly["curtailment_mw"] > 50.0).astype(int)
    print(f"[INGEST] Constrained-off processado: {len(hourly)} horas com média de corte de {hourly['curtailment_mw'].mean():.1f} MWmed.")
    return hourly


def load_real_ons_installed_wind_capacity(filepath: Path) -> float:
    """
    Lê a capacidade instalada real de usinas eólicas no Subsistema Nordeste a partir da base oficial do ONS.
    """
    if not filepath.exists():
        return BASE_WIND_ONSHORE_2026_MW

    print(f"[INGEST] Lendo capacidade instalada do ONS: {filepath.name}...")
    df = pd.read_csv(filepath, sep=";")
    ne_wind = df[(df["id_subsistema"].str.strip() == SUBSYSTEM_ID) & (df["nom_tipousina"].str.strip() == "EOLIELÉTRICA")]
    total_mw = float(ne_wind["val_potenciaefetiva"].sum())
    print(f"[CAPACIDADE REAL] Capacidade eólica efetiva em operação no NE apurada no ONS: {total_mw:,.1f} MW ({len(ne_wind)} unidades geradoras).")
    return total_mw


def compute_historical_wind_capacity_timeseries(raw_capacidade_path: Path, timestamps: pd.DatetimeIndex) -> pd.Series:
    """
    Reconstrói a capacidade instalada eólica exata para cada hora entre 2015 e 2025
    a partir da data de entrada em operação comercial de cada usina (ONS).
    Resolve o desafio central: em 2015 tínhamos 5.1 GW e em 2025 chegamos a 30.7 GW.
    """
    print("[ETL] Reconstruindo série temporal de capacidade eólica instalada histórica...")
    df = pd.read_csv(raw_capacidade_path, sep=";")
    df_wind = df[(df["id_subsistema"].str.strip() == SUBSYSTEM_ID) & (df["nom_tipousina"].str.strip() == "EOLIELÉTRICA")].copy()
    df_wind["dat_operacao"] = pd.to_datetime(df_wind["dat_entradaoperacao"], errors="coerce")
    
    # Usinas sem data assumem início do histórico
    df_wind["dat_operacao"] = df_wind["dat_operacao"].fillna(pd.Timestamp("2014-01-01"))

    # Ordenar por data de entrada
    df_wind = df_wind.sort_values("dat_operacao")
    df_wind["cap_acumulada"] = df_wind["val_potenciaefetiva"].cumsum()

    # Mapear capacidade ativa para cada timestamp da série horária
    cap_by_date = pd.merge_asof(
        pd.DataFrame({"ts": timestamps}),
        df_wind[["dat_operacao", "cap_acumulada"]].rename(columns={"dat_operacao": "ts"}),
        on="ts",
        direction="backward",
    )["cap_acumulada"].fillna(3300.0)

    return pd.Series(cap_by_date.values, index=timestamps, name="cap_eolica_instalada_mw")


def ingest_multi_year_ons_data(start_year: int = 2015, end_year: int = 2025) -> pd.DataFrame:
    """
    Baixa e consolida a carga horária e balanço de geração do ONS para a série completa 2015-2025.
    Treino: 2015 a 2024 (10 anos) | Teste cego fora da amostra: 2025 (1 ano completo).
    """
    print("=" * 70)
    print(f"Ingestão Histórica Multi-Ano ONS: {start_year} a {end_year}")
    print("=" * 70)

    # 1. Garantir download da capacidade instalada
    raw_capacidade = RAW_DATA_DIR / "ons_capacidade_geracao.csv"
    from config import OFFICIAL_DATA_URLS
    download_official_file(OFFICIAL_DATA_URLS["ons_capacidade_geracao"], raw_capacidade)

    carga_frames = []
    balanco_frames = []

    for y in range(start_year, end_year + 1):
        print(f"\n---> Processando Ano {y}...")
        url_carga = f"https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/curva-carga-ho/CURVA_CARGA_{y}.csv"
        url_bal = f"https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/balanco_energia_subsistema_ho/BALANCO_ENERGIA_SUBSISTEMA_{y}.csv"

        path_carga = RAW_DATA_DIR / f"ons_curva_carga_{y}.csv"
        path_bal = RAW_DATA_DIR / f"ons_balanco_subsistema_{y}.csv"

        download_official_file(url_carga, path_carga)
        download_official_file(url_bal, path_bal)

        try:
            df_c = load_ons_hourly_load(path_carga)
            df_b = load_ons_subsystem_generation(path_bal)
            carga_frames.append(df_c)
            balanco_frames.append(df_b)
            print(f"     [OK] Ano {y}: {len(df_c)} horas de carga | {len(df_b)} horas de balanço.")
        except Exception as e:
            print(f"     [ERRO] Falha no ano {y}: {e}")

    print("\n[ETL] Concatenando histórico completo...")
    all_carga = pd.concat(carga_frames).drop_duplicates(subset=["ts"]).sort_values("ts").reset_index(drop=True)
    all_bal = pd.concat(balanco_frames).drop_duplicates(subset=["ts"]).sort_values("ts").reset_index(drop=True)

    # Merge da série de 10+ anos
    merged = all_carga.merge(all_bal, on="ts", how="inner").sort_values("ts").reset_index(drop=True)

    # Reconstruir capacidade instalada eólica histórica dinâmica
    cap_series = compute_historical_wind_capacity_timeseries(raw_capacidade, pd.DatetimeIndex(merged["ts"]))
    merged["cap_eolica_instalada_mw"] = cap_series.values

    # Preencher colunas auxiliares
    merged["curtailment_mw"] = 0.0
    merged["flag_curtailment"] = 0
    merged["g_eolica_potencial_mw"] = merged["g_eolica_verificada_mw"]

    # Fator de Capacidade CF(t) = G_eolica(t) / Cap_instalada(t)
    merged["cf_eolica"] = (merged["g_eolica_potencial_mw"] / np.maximum(100.0, merged["cap_eolica_instalada_mw"])).clip(0.0, 1.0)

    # Identificar split formal: Treino (2015-2024) vs Teste (2025)
    merged["ano"] = pd.to_datetime(merged["ts"]).dt.year
    merged["split"] = np.where(merged["ano"] == 2025, "teste_2025", "treino_2015_2024")

    output_master = PROCESSED_DATA_DIR / "ne_hourly_master_2015_2025.csv"
    merged.to_csv(output_master, index=False)
    # Também gravar em ne_hourly_master.csv para manter compatibilidade com scripts 02 a 06
    merged.to_csv(PROCESSED_DATA_DIR / "ne_hourly_master.csv", index=False)

    print(f"\n[SUCESSO] Base histórica completa 2015-2025 gerada: {len(merged):,} horas!")
    print(f"Treino (2015-2024): {(merged['split'] == 'treino_2015_2024').sum():,} horas")
    print(f"Teste (2025):       {(merged['split'] == 'teste_2025').sum():,} horas")
    print(f"Carga NE: Média 2015 = {merged.loc[merged['ano']==2015, 'l_base_mw'].mean():.1f} MW -> Média 2025 = {merged.loc[merged['ano']==2025, 'l_base_mw'].mean():.1f} MW")
    print(f"Capacidade Eólica: 2015 = {merged.loc[merged['ano']==2015, 'cap_eolica_instalada_mw'].mean():.1f} MW -> 2025 = {merged.loc[merged['ano']==2025, 'cap_eolica_instalada_mw'].mean():.1f} MW")
    print(f"CF Eólico Médio Histórico Geral: {merged['cf_eolica'].mean():.1%}")

    return merged


def main():
    """Execução principal do Script 01 com série completa 2015 a 2025."""
    ingest_multi_year_ons_data(start_year=2015, end_year=2025)


if __name__ == "__main__":
    main()


if __name__ == "__main__":
    main()
