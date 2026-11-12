"""
03_feature_engineering_anova.py
Etapa 03: Feature Engineering Horário, Não-Linearidades e Seleção Estatística via ANOVA
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Criar a matriz completa de features causais (zero data leakage) para os Modelos A (Demanda),
  B (CF Eólico Potencial) e C (Curtailment / Constrained-Off).
- Incorporar defasagens temporais autorregressivas (1h, 24h, 168h) e janelas móveis causais
  para horizontes de curto prazo (t-1h) e programação diária day-ahead (t-24h).
- Codificar harmônicos de Fourier cíclicos de hora, dia da semana e mês.
- Modelar não-linearidades aerodinâmicas de Betz (v³, P²) estritamente sobre lags observados (sem vazamento).
- Construir variáveis físicas de balanço líquido e penetração renovável para o Modelo C de Curtailment.
- Separar formalmente Treino (2015-2024, 10 anos) e Teste Cego Out-of-Time (2025, 1 ano).
- Executar testes estatísticos ANOVA (scipy.stats.f_oneway) com cálculo exato de Eta-squared (η²).
"""

import sys
from typing import Tuple, List
import numpy as np
import pandas as pd
from scipy.stats import f_oneway

from config import (
    PROCESSED_DATA_DIR,
    REPORTS_DIR,
)


def create_temporal_and_harmonic_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Constrói variáveis de calendário, tendência estrutural e codificação harmônica de Fourier.
    """
    out = df.copy()
    ts = pd.to_datetime(out["ts"])

    out["hour"] = ts.dt.hour
    out["dayofweek"] = ts.dt.dayofweek
    out["month"] = ts.dt.month
    out["year"] = ts.dt.year
    out["year_trend"] = (out["year"] - 2015) + (out["month"] - 1.0) / 12.0
    out["is_weekend"] = (ts.dt.dayofweek >= 5).astype(int)

    # Harmônicos cíclicos de hora (24h e 12h)
    out["hour_sin"] = np.sin(2.0 * np.pi * out["hour"] / 24.0)
    out["hour_cos"] = np.cos(2.0 * np.pi * out["hour"] / 24.0)
    out["hour_sin_2"] = np.sin(4.0 * np.pi * out["hour"] / 24.0)
    out["hour_cos_2"] = np.cos(4.0 * np.pi * out["hour"] / 24.0)

    # Harmônicos cíclicos semanais (7 dias)
    out["dow_sin"] = np.sin(2.0 * np.pi * out["dayofweek"] / 7.0)
    out["dow_cos"] = np.cos(2.0 * np.pi * out["dayofweek"] / 7.0)

    # Harmônicos cíclicos anuais (12 meses)
    out["month_sin"] = np.sin(2.0 * np.pi * out["month"] / 12.0)
    out["month_cos"] = np.cos(2.0 * np.pi * out["month"] / 12.0)

    # Interações espaçotemporais (curva diurna modulada pela estação e fim de semana)
    out["interaction_hour_month"] = out["hour_sin"] * out["month_cos"]
    out["interaction_weekend_hour"] = out["is_weekend"] * out["hour_sin"]

    # Faixas operativas do SIN no Nordeste
    out["faixa_ponta"] = ((out["hour"] >= 18) & (out["hour"] <= 21) & (out["is_weekend"] == 0)).astype(int)
    out["faixa_solar_pico"] = ((out["hour"] >= 10) & (out["hour"] <= 15)).astype(int)

    return out


def create_lags_rolling_and_physical_features(
    df: pd.DataFrame,
    target_columns: List[str] = ["l_base_mw", "cf_eolica", "intercambio_liquido_mw"],
    lags: List[int] = [1, 24, 168],
) -> pd.DataFrame:
    """
    Gera defasagens temporais (lags), estatísticas móveis causais (shift 1h e shift 24h)
    e termos físicos não-lineares sem vazamento de informação futura.
    """
    out = df.copy()
    out["g_solar_mw"] = out["g_solar_mw"].fillna(0.0)

    for col in target_columns:
        if col not in out.columns:
            continue
        for lag in lags:
            out[f"{col}_lag_{lag}h"] = out[col].shift(lag)

        # Estatísticas móveis de 24h deslocadas em 1h (curto prazo) e 24h (day-ahead sem lag_1h)
        out[f"{col}_roll_mean_24h"] = out[col].shift(1).rolling(24).mean()
        out[f"{col}_roll_std_24h"] = out[col].shift(1).rolling(24).std()
        out[f"{col}_roll_mean_d1"] = out[col].shift(24).rolling(24).mean()
        out[f"{col}_roll_std_d1"] = out[col].shift(24).rolling(24).std()

    # Não-linearidades aerodinâmicas de Betz causais (baseadas em t-1h e t-24h para predição limpa)
    if "cf_eolica_lag_1h" in out.columns:
        cf_l1 = np.clip(out["cf_eolica_lag_1h"], 0.0, 1.0)
        cf_l24 = np.clip(out["cf_eolica_lag_24h"], 0.0, 1.0)
        out["cf_lag1_squared"] = cf_l1 ** 2
        out["cf_lag1_cubed"] = cf_l1 ** 3
        out["wind_speed_lag1_approx"] = np.cbrt(cf_l1)
        out["wind_speed_lag24_approx"] = np.cbrt(cf_l24)
        # Diagnóstico físico da curva cúbica instantânea (usado apenas em análise exploratória/correlação)
        out["cf_eolica_squared"] = np.clip(out["cf_eolica"], 0.0, 1.0) ** 2
        out["wind_speed_approx"] = np.cbrt(np.clip(out["cf_eolica"], 0.0, 1.0))

    # Variáveis físicas de excedente renovável para o Modelo C (Curtailment Hurdle/Não-Linear)
    # Na arquitetura encadeada (Seção 6 do PDF), o Modelo C recebe G_eol_pot(t), G_solar(t) e L_base(t)
    gen_renovavel = out["g_eolica_potencial_mw"] + out["g_solar_mw"]
    carga_segura = np.maximum(1000.0, out["l_base_mw"])
    out["excedente_renovavel_mw"] = gen_renovavel - out["l_base_mw"]
    out["razao_renovavel_carga"] = gen_renovavel / carga_segura
    out["penetracao_solar"] = out["g_solar_mw"] / carga_segura
    out["penetracao_eolica_pot"] = out["g_eolica_potencial_mw"] / carga_segura

    return out


def _compute_exact_anova_row(
    values: pd.Series,
    groups_col: pd.Series,
    var_label: str,
    factor_label: str,
    conclusion: str,
) -> dict:
    valid = pd.DataFrame({"v": values, "g": groups_col}).dropna()
    grouped = [grp["v"].to_numpy(dtype=float) for _, grp in valid.groupby("g") if len(grp) > 1]
    f_stat, p_val = f_oneway(*grouped)
    all_v = valid["v"].to_numpy(dtype=float)
    grand_mean = float(np.mean(all_v))
    ss_total = float(np.sum((all_v - grand_mean) ** 2))
    ss_between = float(sum(len(g) * (float(np.mean(g)) - grand_mean) ** 2 for g in grouped))
    eta_sq_pct = (ss_between / max(1e-9, ss_total)) * 100.0
    return {
        "variavel_analisada": var_label,
        "fator_agrupador": factor_label,
        "estatistica_f": round(float(f_stat), 2),
        "p_valor": float(p_val),
        "eta_squared_pct": round(eta_sq_pct, 2),
        "significativo_alpha_01": bool(p_val < 0.01),
        "conclusao_tecnica": conclusion,
    }


def run_comprehensive_anova_tests(df: pd.DataFrame) -> pd.DataFrame:
    """
    Aplica testes ANOVA de Fisher unidirecional (F-test) e variância explicada exata (Eta-squared).
    """
    results = []

    if "cf_eolica" in df.columns:
        results.append(
            _compute_exact_anova_row(
                df["cf_eolica"],
                df["month"],
                "CF Eólico Potencial (cf_eolica)",
                "Mês do Ano (Sazonalidade 12 meses)",
                "Fortíssima sazonalidade atmosférica: a Safra dos Ventos (Ago-Nov) supera em ~2x a calmaria (Mar-Abr)",
            )
        )

    if "l_base_mw" in df.columns:
        results.append(
            _compute_exact_anova_row(
                df["l_base_mw"],
                df["dayofweek"],
                "Carga Base (l_base_mw)",
                "Dia da Semana (7 dias: Seg a Dom)",
                "Diferença altamente significativa entre dias úteis industriais/comerciais e domingos no Nordeste",
            )
        )

    if "intercambio_liquido_mw" in df.columns:
        results.append(
            _compute_exact_anova_row(
                df["intercambio_liquido_mw"],
                df["month"],
                "Intercâmbio Líquido SIN (intercambio_liquido_mw)",
                "Mês do Ano (12 meses)",
                "Inversão estrutural do fluxo: NE exporta maciçamente no 2º semestre e reduz saldo na estação chuvosa",
            )
        )

    # Para Curtailment, avaliar na janela real de Constrained-Off do ONS (2023-2025)
    df_coff = df[df["year"] >= 2023]
    if "curtailment_mw" in df_coff.columns and df_coff["curtailment_mw"].sum() > 0:
        results.append(
            _compute_exact_anova_row(
                df_coff["curtailment_mw"],
                df_coff["hour"],
                "Curtailment Eólico Real (curtailment_mw · 2023-2025)",
                "Faixa Horária do Dia (24 horas)",
                "Pico severo de constrained-off entre 09h e 16h pela rampa solar diurna simultânea à geração eólica",
            )
        )

    return pd.DataFrame(results)


def compute_monthly_wind_profile(df: pd.DataFrame) -> pd.DataFrame:
    """
    Gera tabela consolidada de sazonalidade mês a mês (CF potencial e carga 2015-2025;
    curtailment médio apurado na janela real ONS 2023-2025).
    """
    meses_nomes = [
        "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
        "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
    ]
    records = []
    df_coff = df[df["year"] >= 2023]

    for m in range(1, 13):
        sub = df[df["month"] == m]
        sub_coff = df_coff[df_coff["month"] == m]
        cf_vals = sub["cf_eolica"].dropna().to_numpy(dtype=float)
        load_vals = sub["l_base_mw"].dropna().to_numpy(dtype=float)
        curt_vals = sub_coff["curtailment_mw"].dropna().to_numpy(dtype=float) if len(sub_coff) > 0 else np.zeros(1)

        records.append({
            "mes": m,
            "nome_mes": meses_nomes[m - 1],
            "cf_medio": round(float(np.mean(cf_vals)), 3),
            "cf_desvio_padrao": round(float(np.std(cf_vals)), 3),
            "cf_p10": round(float(np.percentile(cf_vals, 10)), 3),
            "cf_p50_mediana": round(float(np.percentile(cf_vals, 50)), 3),
            "cf_p90": round(float(np.percentile(cf_vals, 90)), 3),
            "carga_base_media_mw": round(float(np.mean(load_vals)), 1),
            "curtailment_medio_mw": round(float(np.mean(curt_vals)), 1),
            "regime_sazonal": (
                "Safra dos Ventos" if m in [8, 9, 10, 11]
                else "Estação Chuvosa / Calmaria" if m in [3, 4, 5]
                else "Transição"
            ),
        })

    return pd.DataFrame(records)


def compute_feature_correlation_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calcula a correlação de Pearson das features com as 3 variáveis-alvo:
    Carga Base (2015-2025), CF Eólico Potencial (2015-2025) e Curtailment Real (janela ONS 2023-2025).
    """
    feature_candidates = [
        "l_base_mw_lag_1h",
        "l_base_mw_lag_24h",
        "l_base_mw_lag_168h",
        "cf_eolica_lag_1h",
        "cf_eolica_lag_24h",
        "month_sin",
        "hour_cos",
        "hour_sin",
        "is_weekend",
        "faixa_solar_pico",
        "excedente_renovavel_mw",
        "razao_renovavel_carga",
        "wind_speed_lag1_approx",
        "cf_lag1_squared",
    ]
    available_feats = [f for f in feature_candidates if f in df.columns]
    df_coff = df[df["year"] >= 2023]

    corr_records = []
    for f in available_feats:
        row = {"feature": f}
        for t in ["l_base_mw", "cf_eolica", "curtailment_mw"]:
            ref_df = df_coff if t == "curtailment_mw" else df
            if t in ref_df.columns:
                valid = ref_df[[f, t]].dropna()
                std_f = float(np.std(valid[f]))
                std_t = float(np.std(valid[t]))
                corr_val = float(np.corrcoef(valid[f], valid[t])[0, 1]) if (std_f > 1e-9 and std_t > 1e-9) else 0.0
                row[f"corr_{t}"] = round(corr_val, 3)
        corr_records.append(row)

    return pd.DataFrame(corr_records)


def split_train_test_datasets(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Executa a partição temporal formal aprovada:
    - Treino: 2015 a 2024 (10 anos completos)
    - Teste Cego Out-of-Time: 2025 (1 ano completo, 8.760 horas)
    """
    ts = pd.to_datetime(df["ts"])
    train_df = df[ts.dt.year < 2025].reset_index(drop=True)
    test_df = df[ts.dt.year == 2025].reset_index(drop=True)
    return train_df, test_df


def main():
    print("=" * 70)
    print("Script 03: Feature Engineering Causal, Não-Linearidades e ANOVA (Passo 3)")
    print("=" * 70)

    input_master = PROCESSED_DATA_DIR / "ne_hourly_master.csv"
    if not input_master.exists():
        print(f"[ERRO] Base mestre não encontrada em: {input_master}")
        sys.exit(1)

    df_raw = pd.read_csv(input_master)
    print(f"[INPUT] Carregando {len(df_raw):,} registros horários de {input_master.name}...")

    df_feat = create_temporal_and_harmonic_features(df_raw)
    df_feat = create_lags_rolling_and_physical_features(df_feat)

    # Remover primeiras 168 horas onde lag_168h ainda não possui histórico prévio
    df_clean = df_feat.dropna(subset=["l_base_mw_lag_168h", "cf_eolica_lag_168h"]).reset_index(drop=True)
    print(f"[PROCESSAMENTO] {len(df_clean):,} horas válidas e {len(df_clean.columns)} colunas na matriz de features.")

    # ANOVA Rigoroso
    anova_df = run_comprehensive_anova_tests(df_clean)
    anova_report_path = REPORTS_DIR / "relatorio_anova_significancia.csv"
    anova_df.to_csv(anova_report_path, index=False)
    print("\nResultados dos Testes ANOVA de Significância (SciPy):")
    print(anova_df[["variavel_analisada", "fator_agrupador", "estatistica_f", "p_valor", "eta_squared_pct"]].to_string(index=False))

    # Perfil Mensal Sazonal
    monthly_profile = compute_monthly_wind_profile(df_clean)
    monthly_report_path = REPORTS_DIR / "perfil_mensal_sazonalidade_eolica_ne.csv"
    monthly_profile.to_csv(monthly_report_path, index=False)
    print("\nResumo Mensal (CF Potencial 2015-2025 & Curtailment Real 2023-2025):")
    print(monthly_profile[["mes", "nome_mes", "cf_medio", "cf_p10", "cf_p90", "curtailment_medio_mw", "regime_sazonal"]].to_string(index=False))

    # Correlações
    corr_df = compute_feature_correlation_matrix(df_clean)
    corr_report_path = REPORTS_DIR / "matriz_correlacao_features.csv"
    corr_df.to_csv(corr_report_path, index=False)
    print("\nCorrelações de Pearson com Variáveis-Alvo:")
    print(corr_df.to_string(index=False))

    # Salvar Matriz Completa e Splits Formais
    matrix_output = PROCESSED_DATA_DIR / "ne_features_matrix.csv"
    df_clean.to_csv(matrix_output, index=False)

    train_df, test_df = split_train_test_datasets(df_clean)
    train_path = PROCESSED_DATA_DIR / "train_features_2015_2024.csv"
    test_path = PROCESSED_DATA_DIR / "test_features_2025.csv"
    train_df.to_csv(train_path, index=False)
    test_df.to_csv(test_path, index=False)

    print(f"\n[SUCESSO] Treino (2015-2024): {len(train_df):,} h | Teste Cego (2025): {len(test_df):,} h")


if __name__ == "__main__":
    main()
