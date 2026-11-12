"""
03_feature_engineering_anova.py
Etapa 03: Feature Engineering Horário e Seleção Estatística via ANOVA
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Criar a matriz de features para os Modelos A (Demanda), B (CF Eólico) e C (Curtailment).
- Criar lags temporais (1h, 24h, 168h), médias móveis e desvios padrão.
- Codificar variáveis cíclicas de tempo (seno e cosseno de hora e mês).
- Aplicar ANOVA (scipy.stats.f_oneway) para verificar significância estatística de regimes mensais/sazonais.
  (Diretriz explícita da Seção 4: ANOVA como ferramenta de análise de features, e não modelo preditivo final).
"""

import sys
from pathlib import Path
from typing import Tuple, List, Dict
import numpy as np
import pandas as pd
from scipy.stats import f_oneway

from config import (
    PROCESSED_DATA_DIR,
    REPORTS_DIR,
)


def create_temporal_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Constrói variáveis de calendário e codificação harmônica/cíclica.
    """
    out = df.copy()
    ts = pd.to_datetime(out["ts"])

    out["hour"] = ts.dt.hour
    out["dayofweek"] = ts.dt.dayofweek
    out["month"] = ts.dt.month
    out["is_weekend"] = (ts.dt.dayofweek >= 5).astype(int)

    # Codificação cíclica de hora (período 24h)
    out["hour_sin"] = np.sin(2.0 * np.pi * out["hour"] / 24.0)
    out["hour_cos"] = np.cos(2.0 * np.pi * out["hour"] / 24.0)

    # Codificação cíclica de mês (período 12 meses)
    out["month_sin"] = np.sin(2.0 * np.pi * out["month"] / 12.0)
    out["month_cos"] = np.cos(2.0 * np.pi * out["month"] / 12.0)

    return out


def create_lags_and_rolling_features(
    df: pd.DataFrame,
    target_columns: List[str] = ["l_base_mw", "cf_eolica"],
    lags: List[int] = [1, 24, 168],
) -> pd.DataFrame:
    """
    Gera defasagens temporais (lags) e estatísticas móveis sem vazamento de dados futuros.
    """
    out = df.copy()

    for col in target_columns:
        if col not in out.columns:
            continue
        # Lags diretos
        for lag in lags:
            out[f"{col}_lag_{lag}h"] = out[col].shift(lag)

        # Média móvel e volatilidade de 24 horas (deslocada em 1h para evitar data leakage)
        out[f"{col}_roll_mean_24h"] = out[col].shift(1).rolling(24).mean()
        out[f"{col}_roll_std_24h"] = out[col].shift(1).rolling(24).std()

    return out


def run_seasonal_anova_analysis(df: pd.DataFrame) -> pd.DataFrame:
    """
    Executa testes ANOVA (F-test unidirecional) para avaliar se as médias de CF eólico
    e Carga Base diferem com significância estatística entre os meses do ano e dias da semana.
    """
    results = []

    # 1. CF Eólico por Mês
    if "cf_eolica" in df.columns:
        month_groups_cf = [group["cf_eolica"].dropna().values for _, group in df.groupby("month")]
        if len(month_groups_cf) > 1:
            f_stat, p_val = f_oneway(*month_groups_cf)
            results.append({
                "variavel_analisada": "CF Eólico (cf_eolica)",
                "fator_agrupador": "Mês do Ano (Sazonalidade)",
                "estatistica_f": round(float(f_stat), 3),
                "p_valor": float(p_val),
                "significativo_alpha_01": bool(p_val < 0.01),
                "interpretacao": "Sazonalidade do vento nordestino estatisticamente muito forte (safra Ago-Nov vs calmaria Mar-Mai)"
            })

    # 2. Carga Base por Dia da Semana
    if "l_base_mw" in df.columns:
        dow_groups_load = [group["l_base_mw"].dropna().values for _, group in df.groupby("dayofweek")]
        if len(dow_groups_load) > 1:
            f_stat, p_val = f_oneway(*dow_groups_load)
            results.append({
                "variavel_analisada": "Carga Base (l_base_mw)",
                "fator_agrupador": "Dia da Semana (Útil vs Fim de Semana)",
                "estatistica_f": round(float(f_stat), 3),
                "p_valor": float(p_val),
                "significativo_alpha_01": bool(p_val < 0.01),
                "interpretacao": "Diferença altamente significativa entre dias úteis comerciais e fins de semana"
            })

    # 3. Curtailment por Mês
    if "curtailment_mw" in df.columns and df["curtailment_mw"].sum() > 0:
        month_groups_curt = [group["curtailment_mw"].dropna().values for _, group in df.groupby("month")]
        if len(month_groups_curt) > 1:
            f_stat, p_val = f_oneway(*month_groups_curt)
            results.append({
                "variavel_analisada": "Volume Curtailment (curtailment_mw)",
                "fator_agrupador": "Mês do Ano",
                "estatistica_f": round(float(f_stat), 3),
                "p_valor": float(p_val),
                "significativo_alpha_01": bool(p_val < 0.01),
                "interpretacao": "Curtailment concentrado nas estações de forte geração simultânea de eólica e solar"
            })

    return pd.DataFrame(results)


def main():
    print("=" * 70)
    print("Script 03: Feature Engineering e Análise ANOVA")
    print("=" * 70)

    input_master = PROCESSED_DATA_DIR / "ne_hourly_master.csv"
    if not input_master.exists():
        print(f"[ERRO] Base mestre não encontrada em: {input_master}")
        print("Execute primeiro o Script 01 (python3 scripts/01_ingest_ons_aneel_epe.py).")
        sys.exit(1)

    df_raw = pd.read_csv(input_master)
    print(f"[INPUT] Carregando {len(df_raw)} registros de {input_master.name}...")

    # 1. Adicionar features temporais
    df_feat = create_temporal_features(df_raw)

    # 2. Adicionar Lags e Médias Móveis
    df_feat = create_lags_and_rolling_features(df_feat)

    # 3. Executar ANOVA
    anova_df = run_seasonal_anova_analysis(df_feat)
    anova_report_path = REPORTS_DIR / "relatorio_anova_significancia.csv"
    anova_df.to_csv(anova_report_path, index=False)

    print("\nResultados da Análise ANOVA (Seção 4 do Plano Orientador):")
    print(anova_df[["variavel_analisada", "fator_agrupador", "estatistica_f", "p_valor", "significativo_alpha_01"]].to_string(index=False))

    # 4. Gravar Matriz Final de Modelagem (removendo linhas iniciais com NaN decorrentes dos lags)
    matrix_output = PROCESSED_DATA_DIR / "ne_features_matrix.csv"
    df_clean = df_feat.dropna().reset_index(drop=True)
    df_clean.to_csv(matrix_output, index=False)

    print(f"\n[SUCESSO] Matriz de features salva em: {matrix_output}")
    print(f"Colunas geradas ({len(df_clean.columns)}): {list(df_clean.columns)}")
    print(f"Relatório ANOVA exportado para: {anova_report_path}")


if __name__ == "__main__":
    main()
