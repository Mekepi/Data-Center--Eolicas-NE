"""
01_ingest_ons_aneel_epe.py
Etapa 01: Ingestão, Download e Harmonização Temporal (ONS + ANEEL + EPE)
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Baixar ou carregar as séries históricas brutas de Carga, Geração por Fonte e Constrained-off do ONS (2015 a 2025).
- Filtrar o Subsistema Nordeste (id_subsistema == 'NE') e unificar em grade temporal horária UTC-3 (MWmed).
- Baixar em paralelo (multiprocessing + urllib3) os relatórios mensais reais de Constrained-Off Eólico do ONS
  (2023 a 2025, cobrindo o regime pós-agosto/2023 no treino e o ano completo de 2025 no teste cego),
  convertendo registros semi-horários (30 min) por conjunto eólico em energia média horária cortada (MWmed).
- Reconstituir a geração eólica potencial somando geração verificada + energia cortada (curtailment).
- Reconstruir a capacidade instalada eólica histórica dinâmica (5,1 GW em 2015 -> 30,7 GW em 2025).
"""

import io
import os
import sys
import multiprocessing as mp
from pathlib import Path
from typing import Optional, Tuple
import urllib3
import pandas as pd
import numpy as np

from config import (
    RAW_DATA_DIR,
    PROCESSED_DATA_DIR,
    SUBSYSTEM_ID,
    BASE_WIND_ONSHORE_2026_MW,
    OFFICIAL_DATA_URLS,
    ONS_S3_URL_TEMPLATES,
    HISTORY_START_YEAR,
    HISTORY_END_YEAR,
    COFF_START_YEAR,
    TRAIN_CUTOFF_YEAR,
    FALLBACK_OPERATION_START_DATE,
    WIND_POTENTIAL_FALLBACK_CAPACITY_MW,
    CURTAILMENT_FLAG_THRESHOLD_MW,
    MONTE_CARLO_PARAMS,
)

http = urllib3.PoolManager(
    num_pools=8,
    maxsize=8,
    retries=urllib3.Retry(total=3, backoff_factor=0.5),
)


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
        if response.status == 200:
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            with open(dest_path, "wb") as f:
                for chunk in response.stream(1024 * 64):
                    f.write(chunk)
            print(f"[OK] Download concluído: {dest_path.name}")
        else:
            print(f"[AVISO] HTTP {response.status} ao acessar {url}")
        response.release_conn()
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
    if "id_subsistema" in df.columns:
        df = df[df["id_subsistema"].astype(str).str.strip() == SUBSYSTEM_ID]

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
        df = df[df["id_subsistema"].astype(str).str.strip() == SUBSYSTEM_ID]

    col_map = {
        "din_instante": "ts",
        "val_gereolica": "g_eolica_verificada_mw",
        "val_gersolar": "g_solar_mw",
        "val_gerhidraulica": "g_hidraulica_mw",
        "val_gertermica": "g_termica_mw",
        "val_intercambio": "intercambio_liquido_mw",
    }
    df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})
    available_cols = [c for c in ["ts", "g_eolica_verificada_mw", "g_solar_mw", "g_hidraulica_mw", "g_termica_mw", "intercambio_liquido_mw"] if c in df.columns]
    return df[available_cols].dropna(subset=["ts"]).sort_values("ts").drop_duplicates(subset=["ts"])


def _fetch_and_aggregate_single_coff_month(ym: Tuple[int, int]) -> pd.DataFrame:
    """
    Worker executado em paralelo (multiprocessing.Pool):
    Baixa um mês de RESTRICAO_COFF_EOLICA_{YYYY}_{MM}.csv do S3 do ONS em memória,
    filtra o Subsistema Nordeste (NE), soma a potência cortada entre todos os parques
    em cada instante semi-horário (30 min) e calcula a média horária (MWmed).
    """
    year, month = ym
    url = ONS_S3_URL_TEMPLATES["restricao_coff_eolica_mes"].format(year=year, month=month)
    worker_http = urllib3.PoolManager(retries=urllib3.Retry(total=3, backoff_factor=0.4))
    try:
        resp = worker_http.request("GET", url, timeout=45.0)
        if resp.status != 200:
            return pd.DataFrame()

        usecols = [
            "id_subsistema",
            "din_instante",
            "cod_razaorestricao",
            "val_geracao",
            "val_geracaoreferencia",
            "val_geracaonaorealizadaapurada",
        ]
        df = pd.read_csv(io.BytesIO(resp.data), sep=";", usecols=usecols)
        df = df[df["id_subsistema"].astype(str).str.strip() == SUBSYSTEM_ID].copy()
        if df.empty:
            return pd.DataFrame()

        # Quando val_geracaonaorealizadaapurada estiver ausente em registros antigos com restrição ativa,
        # usa (val_geracaoreferencia - val_geracao) limitado a >= 0 como fallback físico auditável.
        razao = df["cod_razaorestricao"].astype(str).str.strip()
        has_restriction = df["cod_razaorestricao"].notna() & (razao != "") & (razao != "nan")
        fallback_mw = (
            (pd.to_numeric(df["val_geracaoreferencia"], errors="coerce") - pd.to_numeric(df["val_geracao"], errors="coerce"))
            .where(has_restriction, 0.0)
            .fillna(0.0)
            .clip(lower=0.0)
        )
        apurada_mw = pd.to_numeric(df["val_geracaonaorealizadaapurada"], errors="coerce")
        df["curtailment_mw"] = apurada_mw.fillna(fallback_mw).clip(lower=0.0)

        # Decomposição opcional por razão operativa ONS (ENE: energética, CNF: confiabilidade, REL: elétrica local)
        df["curt_ene_mw"] = np.where(razao == "ENE", df["curtailment_mw"], 0.0)
        df["curt_cnf_mw"] = np.where(razao == "CNF", df["curtailment_mw"], 0.0)
        df["curt_rel_mw"] = np.where(razao == "REL", df["curtailment_mw"], 0.0)

        # Passo A: Somar potência simultânea cortada de todos os conjuntos eólicos do NE em cada semi-hora (30 min)
        semi_hourly = df.groupby("din_instante", as_index=False)[
            ["curtailment_mw", "curt_ene_mw", "curt_cnf_mw", "curt_rel_mw"]
        ].sum()

        # Passo B: Converter potência semi-horária (30 min) em energia média horária (MWmed = média das 2 semi-horas)
        semi_hourly["ts"] = pd.to_datetime(semi_hourly["din_instante"]).dt.floor("1h")
        hourly = (
            semi_hourly.groupby("ts", as_index=False)[
                ["curtailment_mw", "curt_ene_mw", "curt_cnf_mw", "curt_rel_mw"]
            ]
            .mean()
            .sort_values("ts")
        )
        print(
            f"     [COFF {year}-{month:02d}] {len(hourly)} h | "
            f"Corte médio: {hourly['curtailment_mw'].mean():6.1f} MWmed | "
            f"Pico: {hourly['curtailment_mw'].max():7.1f} MW"
        )
        return hourly
    except Exception as exc:
        print(f"     [AVISO COFF {year}-{month:02d}] Falha no processamento: {exc}")
        return pd.DataFrame()


def ingest_ons_constrained_off_multi_month(
    start_year: int = COFF_START_YEAR,
    end_year: int = HISTORY_END_YEAR,
    force_refresh: bool = False,
) -> pd.DataFrame:
    """
    Consolida a série horária real de Constrained-Off Eólico do Nordeste ({COFF_START_YEAR} a {HISTORY_END_YEAR})
    usando multiprocessing.Pool e faz cache compacto em disco (~1.2 MB).
    """
    cache_path = RAW_DATA_DIR / f"ons_constrained_off_ne_hourly_{start_year}_{end_year}.csv"
    if cache_path.exists() and not force_refresh:
        print(f"[CACHE] Carregando série horária real de constrained-off: {cache_path.name}")
        cached = pd.read_csv(cache_path, parse_dates=["ts"])
        return cached

    ym_tasks = [(y, m) for y in range(start_year, end_year + 1) for m in range(1, 13)]
    n_workers = max(1, min(int(MONTE_CARLO_PARAMS["maxWorkers"]), os.cpu_count() or 4))
    print(
        f"\n[COFF ONS] Baixando e agregando {len(ym_tasks)} competências mensais ({start_year}-01 a {end_year}-12) "
        f"em {n_workers} processos paralelos..."
    )

    with mp.Pool(processes=n_workers) as pool:
        monthly_dfs = pool.map(_fetch_and_aggregate_single_coff_month, ym_tasks)

    valid_dfs = [d for d in monthly_dfs if not d.empty]
    if not valid_dfs:
        print("[AVISO] Nenhum arquivo mensal de constrained-off pôde ser baixado.")
        return pd.DataFrame(columns=["ts", "curtailment_mw", "curt_ene_mw", "curt_cnf_mw", "curt_rel_mw"])

    coff_all = (
        pd.concat(valid_dfs, ignore_index=True)
        .drop_duplicates(subset=["ts"])
        .sort_values("ts")
        .reset_index(drop=True)
    )
    coff_all.to_csv(cache_path, index=False)
    print(
        f"[OK] Série real de Constrained-Off NE salva em {cache_path.name} "
        f"({len(coff_all):,} horas | média {coff_all['curtailment_mw'].mean():.1f} MWmed)"
    )
    return coff_all


def load_real_ons_installed_wind_capacity(filepath: Path) -> float:
    """
    Lê a capacidade instalada real de usinas eólicas no Subsistema Nordeste a partir da base oficial do ONS.
    """
    if not filepath.exists():
        return BASE_WIND_ONSHORE_2026_MW

    df = pd.read_csv(filepath, sep=";")
    ne_wind = df[
        (df["id_subsistema"].astype(str).str.strip() == SUBSYSTEM_ID)
        & (df["nom_tipousina"].astype(str).str.strip() == "EOLIELÉTRICA")
    ]
    total_mw = float(ne_wind["val_potenciaefetiva"].sum())
    print(f"[CAPACIDADE REAL] Capacidade eólica efetiva no NE apurada no ONS: {total_mw:,.1f} MW ({len(ne_wind)} registros).")
    return total_mw


def compute_historical_wind_capacity_timeseries(raw_capacidade_path: Path, timestamps: pd.DatetimeIndex) -> pd.Series:
    """
    Reconstrói a capacidade instalada eólica exata para cada hora entre 2015 e 2025
    a partir da data de entrada em operação comercial de cada usina (ONS).
    """
    print("[ETL] Reconstruindo série temporal de capacidade eólica instalada histórica...")
    df = pd.read_csv(raw_capacidade_path, sep=";")
    df_wind = df[
        (df["id_subsistema"].astype(str).str.strip() == SUBSYSTEM_ID)
        & (df["nom_tipousina"].astype(str).str.strip() == "EOLIELÉTRICA")
    ].copy()
    df_wind["dat_operacao"] = pd.to_datetime(df_wind["dat_entradaoperacao"], errors="coerce")
    missing_dates = int(df_wind["dat_operacao"].isna().sum())
    if missing_dates > 0:
        print(
            f"[AVISO ETL] {missing_dates} usinas sem dat_entradaoperacao; "
            f"aplicado fallback auditável {FALLBACK_OPERATION_START_DATE}."
        )
    df_wind["dat_operacao"] = df_wind["dat_operacao"].fillna(pd.Timestamp(FALLBACK_OPERATION_START_DATE))

    df_wind = df_wind.sort_values("dat_operacao")
    df_wind["cap_acumulada"] = df_wind["val_potenciaefetiva"].cumsum()

    merged_cap = pd.merge_asof(
        pd.DataFrame({"ts": timestamps}),
        df_wind[["dat_operacao", "cap_acumulada"]].rename(columns={"dat_operacao": "ts"}),
        on="ts",
        direction="backward",
    )["cap_acumulada"]
    missing_cap = int(merged_cap.isna().sum())
    if missing_cap > 0:
        print(
            f"[AVISO ETL] {missing_cap} horas pré-cadastro receberam capacidade mínima de fallback "
            f"({WIND_POTENTIAL_FALLBACK_CAPACITY_MW:.1f} MW)."
        )
    cap_by_date = merged_cap.fillna(WIND_POTENTIAL_FALLBACK_CAPACITY_MW)

    return pd.Series(cap_by_date.values, index=timestamps, name="cap_eolica_instalada_mw")


def ingest_multi_year_ons_data(
    start_year: int = HISTORY_START_YEAR,
    end_year: int = HISTORY_END_YEAR,
) -> pd.DataFrame:
    """
    Baixa e consolida carga horária, balanço de geração e constrained-off eólico real do ONS.
    Treino: {HISTORY_START_YEAR} a {TRAIN_CUTOFF_YEAR - 1} | Teste cego fora da amostra: {TRAIN_CUTOFF_YEAR}.
    """
    print("=" * 70)
    print(f"Ingestão Histórica Multi-Ano ONS: {start_year} a {end_year}")
    print("=" * 70)

    raw_capacidade = RAW_DATA_DIR / "ons_capacidade_geracao.csv"
    download_official_file(OFFICIAL_DATA_URLS["ons_capacidade_geracao"], raw_capacidade)

    carga_frames = []
    balanco_frames = []

    for y in range(start_year, end_year + 1):
        url_carga = ONS_S3_URL_TEMPLATES["curva_carga_ano"].format(year=y)
        url_bal = ONS_S3_URL_TEMPLATES["balanco_energia_ano"].format(year=y)

        path_carga = RAW_DATA_DIR / f"ons_curva_carga_{y}.csv"
        path_bal = RAW_DATA_DIR / f"ons_balanco_subsistema_{y}.csv"

        download_official_file(url_carga, path_carga)
        download_official_file(url_bal, path_bal)

        try:
            df_c = load_ons_hourly_load(path_carga)
            df_b = load_ons_subsystem_generation(path_bal)
            carga_frames.append(df_c)
            balanco_frames.append(df_b)
        except Exception as e:
            print(f"     [ERRO] Falha no ano {y}: {e}")

    print("\n[ETL] Concatenando histórico completo de Carga e Balanço...")
    all_carga = pd.concat(carga_frames).drop_duplicates(subset=["ts"]).sort_values("ts").reset_index(drop=True)
    all_bal = pd.concat(balanco_frames).drop_duplicates(subset=["ts"]).sort_values("ts").reset_index(drop=True)

    merged = all_carga.merge(all_bal, on="ts", how="inner").sort_values("ts").reset_index(drop=True)
    merged["g_solar_mw"] = merged["g_solar_mw"].fillna(0.0)

    # Reconstruir capacidade instalada eólica histórica dinâmica
    cap_series = compute_historical_wind_capacity_timeseries(raw_capacidade, pd.DatetimeIndex(merged["ts"]))
    merged["cap_eolica_instalada_mw"] = cap_series.values

    # Integrar Constrained-Off Eólico Real do ONS (COFF_START_YEAR..end_year)
    coff_df = ingest_ons_constrained_off_multi_month(start_year=COFF_START_YEAR, end_year=end_year)
    if not coff_df.empty:
        merged = merged.merge(
            coff_df[["ts", "curtailment_mw", "curt_ene_mw", "curt_cnf_mw", "curt_rel_mw"]],
            on="ts",
            how="left",
        )
        for c in ["curtailment_mw", "curt_ene_mw", "curt_cnf_mw", "curt_rel_mw"]:
            merged[c] = merged[c].fillna(0.0).round(2)
    else:
        merged["curtailment_mw"] = 0.0
        merged["curt_ene_mw"] = 0.0
        merged["curt_cnf_mw"] = 0.0
        merged["curt_rel_mw"] = 0.0

    # Flag operativa de curtailment relevante (> CURTAILMENT_FLAG_THRESHOLD_MW no subsistema NE)
    merged["flag_curtailment"] = (merged["curtailment_mw"] > CURTAILMENT_FLAG_THRESHOLD_MW).astype(int)

    # Reconstituir geração eólica potencial disponível (Seção 4 do Plano Orientador):
    # Evita ensinar o Modelo B como se o recurso eólico tivesse caído quando houve despacho de corte pelo ONS
    merged["g_eolica_potencial_mw"] = (merged["g_eolica_verificada_mw"] + merged["curtailment_mw"]).round(2)

    # Fator de Capacidade CF(t) = G_eolica_potencial(t) / Cap_instalada(t) limitado fisicamente a [0, 1]
    merged["cf_eolica"] = (
        merged["g_eolica_potencial_mw"] / np.maximum(100.0, merged["cap_eolica_instalada_mw"])
    ).clip(0.0, 1.0)

    # Identificar split formal: Treino vs Teste Out-of-Time
    merged["ano"] = pd.to_datetime(merged["ts"]).dt.year
    train_tag = f"treino_{start_year}_{TRAIN_CUTOFF_YEAR - 1}"
    test_tag = f"teste_{TRAIN_CUTOFF_YEAR}"
    merged["split"] = np.where(merged["ano"] == TRAIN_CUTOFF_YEAR, test_tag, train_tag)

    output_master = PROCESSED_DATA_DIR / f"ne_hourly_master_{start_year}_{end_year}.csv"
    merged.to_csv(output_master, index=False)
    merged.to_csv(PROCESSED_DATA_DIR / "ne_hourly_master.csv", index=False)

    prev_year = TRAIN_CUTOFF_YEAR - 1
    curt_prev_twh = merged.loc[merged["ano"] == prev_year, "curtailment_mw"].sum() / 1e6
    curt_test_twh = merged.loc[merged["ano"] == TRAIN_CUTOFF_YEAR, "curtailment_mw"].sum() / 1e6
    pct_flag_prev = merged.loc[merged["ano"] == prev_year, "flag_curtailment"].mean() * 100
    pct_flag_test = merged.loc[merged["ano"] == TRAIN_CUTOFF_YEAR, "flag_curtailment"].mean() * 100

    print(f"\n[SUCESSO] Base histórica completa {start_year}-{end_year} gerada: {len(merged):,} horas!")
    print(f"Treino ({start_year}-{prev_year}): {(merged['split'] == train_tag).sum():,} horas")
    print(f"Teste ({TRAIN_CUTOFF_YEAR}):       {(merged['split'] == test_tag).sum():,} horas")
    print(f"Curtailment Eólico Real NE {prev_year}: {curt_prev_twh:.2f} TWh ({pct_flag_prev:.1f}% das horas > {CURTAILMENT_FLAG_THRESHOLD_MW:.0f} MW)")
    print(f"Curtailment Eólico Real NE {TRAIN_CUTOFF_YEAR}: {curt_test_twh:.2f} TWh ({pct_flag_test:.1f}% das horas > {CURTAILMENT_FLAG_THRESHOLD_MW:.0f} MW)")
    print(f"CF Eólico Potencial Médio Geral: {merged['cf_eolica'].mean():.2%}")

    return merged


def main():
    """Execução principal do Script 01 com série completa configurada em scripts/config.py."""
    ingest_multi_year_ons_data(start_year=HISTORY_START_YEAR, end_year=HISTORY_END_YEAR)


if __name__ == "__main__":
    main()
