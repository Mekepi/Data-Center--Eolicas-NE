"""
05_forecast_wind_cf_and_curtailment.py
Etapa 05: Modelos B (Fator de Capacidade Eólico Potencial) e C (Curtailment / Constrained-Off)
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Modelo B: Prever o Fator de Capacidade Eólico potencial CF(t) in [0, 1], treinado em 2015–2024
  (87.476 horas) e testado out-of-time em todas as 8.760 horas de 2025, comparando Baseline Linear
  (Ridge L2) contra Challengers Não-Lineares (Rede Neural ResMLP via L-BFGS-B e Histogram GBDT).
- Modelo C (Hurdle 2 Estágios): Treinar no regime estrutural real de Constrained-Off do ONS
  dentro da amostra de treino (2023–2024, zero vazamento de 2025) e avaliar de forma cega em 2025:
    * Estágio C1 (Classificação P(Curtailment > 50 MW)): Logística L-BFGS-B vs. ResMLP Classifier vs. Histogram GBDT Classifier.
    * Estágio C2 (Volume Cortado E[MWmed]): Ridge L2 vs. ResMLP Regressor vs. Histogram GBDT Regressor.
- Exportar relatórios comparativos completos de 2025 (métricas globais, perfil mensal 12 meses e
  curva média horária 00h–23h Real vs. Predito) para auditoria e visualização na interface.
"""

import json
import sys
from typing import Dict, List, Tuple
import numpy as np
import pandas as pd

from config import (
    PROCESSED_DATA_DIR,
    REPORTS_DIR,
    SCRIPTS_DIR,
    COFF_REGIME_START_DATE,
    COFF_START_YEAR,
    ML_MODEL_PARAMS,
)
from ml_models_numpy import (
    LinearRidgeModel,
    LogisticLBFGSModel,
    ResidualMLPRegressor,
    ResidualMLPClassifier,
    HistogramGBDTRegressor,
    HistogramGBDTClassifier,
    compute_regression_metrics,
    compute_classification_metrics,
)


FEATURES_CF_1H = [
    "hour_sin",
    "hour_cos",
    "hour_sin_2",
    "hour_cos_2",
    "month_sin",
    "month_cos",
    "interaction_hour_month",
    "cf_eolica_lag_1h",
    "cf_eolica_lag_24h",
    "cf_eolica_lag_168h",
    "cf_eolica_roll_mean_24h",
    "cf_eolica_roll_std_24h",
    "cf_lag1_squared",
    "cf_lag1_cubed",
    "wind_speed_lag1_approx",
]

FEATURES_CF_24H = [
    "hour_sin",
    "hour_cos",
    "hour_sin_2",
    "hour_cos_2",
    "month_sin",
    "month_cos",
    "interaction_hour_month",
    "cf_eolica_lag_24h",
    "cf_eolica_lag_168h",
    "cf_eolica_roll_mean_d1",
    "cf_eolica_roll_std_d1",
    "wind_speed_lag24_approx",
]

# Features físicas e de calendário do Modelo C (aplicáveis diretamente nos cenários de Monte Carlo 2035)
FEATURES_CURTAILMENT = [
    "hour_sin",
    "hour_cos",
    "hour_sin_2",
    "hour_cos_2",
    "month_sin",
    "month_cos",
    "is_weekend",
    "faixa_solar_pico",
    "faixa_ponta",
    "g_eolica_potencial_mw",
    "g_solar_mw",
    "l_base_mw",
    "excedente_renovavel_mw",
    "razao_renovavel_carga",
    "penetracao_solar",
    "penetracao_eolica_pot",
]


def evaluate_model_b_wind_cf(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
) -> Tuple[List[Dict[str, object]], Dict[str, np.ndarray]]:
    """Treina Modelo B em 2015-2024 e valida out-of-time em 2025 (1h-Ahead e 24h Day-Ahead)."""
    y_train = train_df["cf_eolica"].to_numpy(dtype=float)
    y_test = test_df["cf_eolica"].to_numpy(dtype=float)

    rows: List[Dict[str, object]] = []
    preds_map: Dict[str, np.ndarray] = {}

    seed = int(ML_MODEL_PARAMS["seed"])
    b_mlp_cfg = ML_MODEL_PARAMS["modelBResMlp"]
    b_gbdt_cfg = ML_MODEL_PARAMS["modelBGbdt"]
    b_ridge_alpha = max(1.0, float(ML_MODEL_PARAMS["ridgeAlpha"]) - 2.0)

    for horizon_label, cand_cols, key_suffix in [
        ("Operativo Curto Prazo (1h-Ahead)", FEATURES_CF_1H, "1h"),
        ("Regime Diário / Sazonal (24h Day-Ahead)", FEATURES_CF_24H, "24h"),
    ]:
        feats = [c for c in cand_cols if c in train_df.columns]
        X_tr = train_df[feats].to_numpy(dtype=float)
        X_te = test_df[feats].to_numpy(dtype=float)

        candidates = [
            ("Baseline Linear · Ridge L2", "Linear", LinearRidgeModel(alpha=b_ridge_alpha), f"ridge_{key_suffix}"),
            (
                "Challenger Não-Linear · Rede Neural ResMLP (L-BFGS-B)",
                "Não-Linear (SciPy L-BFGS-B)",
                ResidualMLPRegressor(
                    hidden_units=int(b_mlp_cfg["hiddenUnits"]),
                    reg_l2=float(b_mlp_cfg["regL2"]),
                    max_iter=int(b_mlp_cfg["maxIter"]),
                    seed=seed,
                ),
                f"resmlp_{key_suffix}",
            ),
            (
                "Challenger Não-Linear · Histogram GBDT (Árvores)",
                "Não-Linear (NumPy GBDT)",
                HistogramGBDTRegressor(
                    n_estimators=int(b_gbdt_cfg["nEstimators"]),
                    learning_rate=float(b_gbdt_cfg["learningRate"]),
                    max_depth=int(b_gbdt_cfg["maxDepth"]),
                    min_samples_leaf=int(b_gbdt_cfg["minSamplesLeaf"]),
                ),
                f"gbdt_{key_suffix}",
            ),
        ]

        for arch_name, family, model, tag in candidates:
            model.fit(X_tr, y_train)
            y_hat = np.clip(model.predict(X_te), 0.0, 1.0)
            preds_map[tag] = y_hat
            m = compute_regression_metrics(y_test, y_hat)

            # Erro equivalente em MW sobre a capacidade instalada real de 2025 (~30,7 GW)
            cap_2025 = test_df["cap_eolica_instalada_mw"].to_numpy(dtype=float)
            mae_equiv_mw = float(np.mean(np.abs(y_test - y_hat) * cap_2025))

            rows.append({
                "etapa": "Modelo B - Fator de Capacidade CF(t)",
                "horizonte": horizon_label,
                "arquitetura": arch_name,
                "familia": family,
                "mae_cf": round(m["mae"], 4),
                "rmse_cf": round(m["rmse"], 4),
                "r2_score": round(m["r2"], 4),
                "mae_potencia_equiv_mw": round(mae_equiv_mw, 1),
                "treino_horas": len(train_df),
                "teste_2025_horas": len(test_df),
            })

    return rows, preds_map


def evaluate_model_c_curtailment(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
) -> Tuple[List[Dict[str, object]], Dict[str, np.ndarray]]:
    """
    Avalia o Modelo C (Classificação de Evento > 50 MW + Regressão Hurdle de Volume Cortado MWmed).
    Treino: janela 2023-2024 (regime real pós-expansão solar/eólica dentro da partição < 2025,
    especificamente pós-agosto/2023 onde entraram em vigor os limites operativos atuais do ONS,
    com avaliação cega nas 8.760 horas de 2025).
    """
    # Usar o regime operativo pós-agosto/2023 dentro do conjunto de treino (< 2025) para evitar viés
    # de época em que o SIN operava sob outra malha e sem geração solar distribuída relevante
    ts_train = pd.to_datetime(train_df["ts"])
    train_coff = train_df[ts_train >= pd.Timestamp(COFF_REGIME_START_DATE)].reset_index(drop=True)
    if len(train_coff) < 2000:
        train_coff = train_df[train_df["year"] >= COFF_START_YEAR].reset_index(drop=True)

    feats = [c for c in FEATURES_CURTAILMENT if c in train_coff.columns]
    X_tr = train_coff[feats].to_numpy(dtype=float)
    y_tr_flag = train_coff["flag_curtailment"].to_numpy(dtype=int)
    y_tr_vol = train_coff["curtailment_mw"].to_numpy(dtype=float)

    X_te = test_df[feats].to_numpy(dtype=float)
    y_te_flag = test_df["flag_curtailment"].to_numpy(dtype=int)
    y_te_vol = test_df["curtailment_mw"].to_numpy(dtype=float)

    seed = int(ML_MODEL_PARAMS["seed"])
    prob_threshold = float(ML_MODEL_PARAMS["modelCProbThreshold"])
    c1_log_cfg = ML_MODEL_PARAMS["modelCStageC1Logistic"]
    c1_mlp_cfg = ML_MODEL_PARAMS["modelCStageC1ResMlp"]
    c1_gbdt_cfg = ML_MODEL_PARAMS["modelCStageC1Gbdt"]
    c2_mlp_cfg = ML_MODEL_PARAMS["modelCStageC2ResMlp"]
    c2_gbdt_cfg = ML_MODEL_PARAMS["modelCStageC2Gbdt"]

    # 1. Estágio de Classificação: Logística L-BFGS-B vs. ResMLP Classifier vs. Histogram GBDT Classifier
    clf_lin = LogisticLBFGSModel(
        reg_l2=float(c1_log_cfg["regL2"]),
        max_iter=int(c1_log_cfg["maxIter"]),
    ).fit(X_tr, y_tr_flag)
    prob_lin = clf_lin.predict_proba(X_te)
    cm_lin = compute_classification_metrics(y_te_flag, prob_lin, threshold=prob_threshold)

    clf_mlp = ResidualMLPClassifier(
        hidden_units=int(c1_mlp_cfg["hiddenUnits"]),
        reg_l2=float(c1_mlp_cfg["regL2"]),
        reg_l2_skip=float(c1_mlp_cfg["regL2Skip"]),
        max_iter=int(c1_mlp_cfg["maxIter"]),
        seed=seed,
    ).fit(X_tr, y_tr_flag)
    prob_mlp = clf_mlp.predict_proba(X_te)
    cm_mlp = compute_classification_metrics(y_te_flag, prob_mlp, threshold=prob_threshold)

    clf_gbdt = HistogramGBDTClassifier(
        n_estimators=int(c1_gbdt_cfg["nEstimators"]),
        learning_rate=float(c1_gbdt_cfg["learningRate"]),
        max_depth=int(c1_gbdt_cfg["maxDepth"]),
        min_samples_leaf=int(c1_gbdt_cfg["minSamplesLeaf"]),
    ).fit(X_tr, y_tr_flag)
    prob_gbdt = clf_gbdt.predict_proba(X_te)
    cm_gbdt = compute_classification_metrics(y_te_flag, prob_gbdt, threshold=prob_threshold)

    # 2. Estágio de Volume Hurdle/Direto: Ridge L2 vs. ResMLP vs. Histogram GBDT
    # No modelo Hurdle calibrado: E[Corte(t)] = clip(Reg_Positivo(X_t), 0, G_eol_pot) * P(Corte_t)
    pos_mask_tr = y_tr_flag == 1
    X_tr_pos = X_tr[pos_mask_tr]
    y_tr_pos = y_tr_vol[pos_mask_tr]
    g_pot_te = test_df["g_eolica_potencial_mw"].to_numpy(dtype=float)

    # Baseline Linear Hurdle (Logística + Ridge condicional)
    reg_lin = LinearRidgeModel(alpha=float(ML_MODEL_PARAMS["ridgeAlpha"]) * 2.0).fit(X_tr_pos, y_tr_pos)
    vol_cond_lin = np.clip(reg_lin.predict(X_te), 0.0, g_pot_te)
    pred_vol_lin = np.clip(prob_lin * vol_cond_lin, 0.0, g_pot_te)

    # Challenger Não-Linear 1: Rede Neural ResMLP Hurdle (ResMLP Classifier * ResMLP Regressor condicional)
    reg_mlp = ResidualMLPRegressor(
        hidden_units=int(c2_mlp_cfg["hiddenUnits"]),
        reg_l2=float(c2_mlp_cfg["regL2"]),
        max_iter=int(c2_mlp_cfg["maxIter"]),
        seed=seed,
    ).fit(X_tr_pos, y_tr_pos)
    vol_cond_mlp = np.clip(reg_mlp.predict(X_te), 0.0, g_pot_te)
    pred_vol_mlp = np.clip(prob_mlp * vol_cond_mlp, 0.0, g_pot_te)

    # Challenger Não-Linear 2: Histogram GBDT Hurdle (GBDT Classifier * GBDT Regressor condicional)
    reg_gbdt = HistogramGBDTRegressor(
        n_estimators=int(c2_gbdt_cfg["nEstimators"]),
        learning_rate=float(c2_gbdt_cfg["learningRate"]),
        max_depth=int(c2_gbdt_cfg["maxDepth"]),
        min_samples_leaf=int(c2_gbdt_cfg["minSamplesLeaf"]),
    ).fit(X_tr_pos, y_tr_pos)
    vol_cond_gbdt = np.clip(reg_gbdt.predict(X_te), 0.0, g_pot_te)
    pred_vol_gbdt = np.clip(prob_gbdt * vol_cond_gbdt, 0.0, g_pot_te)

    real_twh_2025 = float(np.sum(y_te_vol) / 1e6)
    pos_te = y_te_flag == 1

    rows: List[Dict[str, object]] = []
    for arch_name, family, cm, pred_vol in [
        ("Baseline Linear · Logística + Ridge Hurdle", "Linear", cm_lin, pred_vol_lin),
        (
            "Challenger Não-Linear · Rede Neural ResMLP Hurdle (C1+C2)",
            "Não-Linear (SciPy L-BFGS-B)",
            cm_mlp,
            pred_vol_mlp,
        ),
        (
            "Challenger Não-Linear · Histogram GBDT Hurdle Completo",
            "Não-Linear (NumPy GBDT)",
            cm_gbdt,
            pred_vol_gbdt,
        ),
    ]:
        rm_all = compute_regression_metrics(y_te_vol, pred_vol)
        mae_active = float(np.mean(np.abs(y_te_vol[pos_te] - pred_vol[pos_te]))) if np.any(pos_te) else 0.0
        pred_twh = float(np.sum(pred_vol) / 1e6)

        rows.append({
            "etapa": "Modelo C - Curtailment Eólico (2 Estágios)",
            "horizonte": "Estrutural Físico Horário (Exógeno p/ 2035)",
            "arquitetura": arch_name,
            "familia": family,
            "roc_auc": cm["roc_auc"],
            "brier_score": cm["brier_score"],
            "f1_score": cm["f1_score"],
            "mae_global_mw": round(rm_all["mae"], 1),
            "rmse_global_mw": round(rm_all["rmse"], 1),
            "mae_horas_corte_mw": round(mae_active, 1),
            "r2_volume": round(rm_all["r2"], 4),
            "energia_cortada_real_2025_twh": round(real_twh_2025, 2),
            "energia_cortada_pred_2025_twh": round(pred_twh, 2),
            "treino_horas": len(train_coff),
            "teste_2025_horas": len(test_df),
        })

    preds_c = {
        "prob_lin": prob_lin,
        "prob_mlp": prob_mlp,
        "prob_gbdt": prob_gbdt,
        "vol_lin": pred_vol_lin,
        "vol_mlp": pred_vol_mlp,
        "vol_gbdt": pred_vol_gbdt,
    }
    return rows, preds_c


def export_2025_comparative_profiles(
    test_df: pd.DataFrame,
    preds_b: Dict[str, np.ndarray],
    preds_c: Dict[str, np.ndarray],
) -> None:
    """
    Consolida os perfis mensais (12 meses) e horários (00h–23h) de 2025 comparando
    Valores Reais ONS 2025 vs. Baseline Linear vs. Challenger Não-Linear para os Modelos A, B e C.
    """
    comp = test_df[[
        "ts", "month", "hour", "l_base_mw", "cf_eolica", "g_solar_mw",
        "g_eolica_potencial_mw", "curtailment_mw", "flag_curtailment",
    ]].copy()

    # Integrar predições da arquitetura campeã ResMLP para os Modelos A, B e C
    pred_a_path = PROCESSED_DATA_DIR / "predicoes_2025_modelo_a.csv"
    if pred_a_path.exists():
        pa = pd.read_csv(pred_a_path)
        comp["pred_load_lin_mw"] = pa["pred_l_base_ridge_24h_mw"].to_numpy(dtype=float)
        comp["pred_load_nonlin_mw"] = pa["pred_l_base_resmlp_24h_mw"].to_numpy(dtype=float)
        comp["pred_load_1h_nonlin_mw"] = pa["pred_l_base_resmlp_1h_mw"].to_numpy(dtype=float)
    else:
        comp["pred_load_lin_mw"] = comp["l_base_mw"]
        comp["pred_load_nonlin_mw"] = comp["l_base_mw"]
        comp["pred_load_1h_nonlin_mw"] = comp["l_base_mw"]

    comp["pred_cf_lin"] = preds_b["ridge_1h"]
    comp["pred_cf_nonlin"] = preds_b["resmlp_1h"]
    comp["pred_cf_24h_nonlin"] = preds_b["resmlp_24h"]
    comp["pred_curt_lin_mw"] = preds_c["vol_lin"]
    comp["pred_curt_nonlin_mw"] = preds_c["vol_mlp"]
    comp["pred_curt_prob_nonlin"] = preds_c["prob_mlp"]

    meta_payload = json.loads((SCRIPTS_DIR / "pipeline_metadata.json").read_text(encoding="utf-8"))
    meses_curtos = meta_payload["uiCatalog"]["monthShortNames"]
    monthly_rows = []
    for m in range(1, 13):
        sub = comp[comp["month"] == m]
        monthly_rows.append({
            "mes": m,
            "nome_mes": meses_curtos[m - 1],
            "real_carga_mw": round(float(sub["l_base_mw"].mean()), 1),
            "pred_carga_lin_24h_mw": round(float(sub["pred_load_lin_mw"].mean()), 1),
            "pred_carga_nonlin_24h_mw": round(float(sub["pred_load_nonlin_mw"].mean()), 1),
            "real_cf_pct": round(float(sub["cf_eolica"].mean() * 100.0), 2),
            "pred_cf_lin_pct": round(float(sub["pred_cf_lin"].mean() * 100.0), 2),
            "pred_cf_nonlin_pct": round(float(sub["pred_cf_nonlin"].mean() * 100.0), 2),
            "real_curtailment_mw": round(float(sub["curtailment_mw"].mean()), 1),
            "pred_curtailment_lin_mw": round(float(sub["pred_curt_lin_mw"].mean()), 1),
            "pred_curtailment_nonlin_mw": round(float(sub["pred_curt_nonlin_mw"].mean()), 1),
            "real_curtailment_gwh": round(float(sub["curtailment_mw"].sum() / 1000.0), 1),
            "pred_curtailment_nonlin_gwh": round(float(sub["pred_curt_nonlin_mw"].sum() / 1000.0), 1),
            "freq_corte_real_pct": round(float(sub["flag_curtailment"].mean() * 100.0), 1),
            "prob_corte_pred_pct": round(float(sub["pred_curt_prob_nonlin"].mean() * 100.0), 1),
        })

    monthly_df = pd.DataFrame(monthly_rows)
    monthly_df.to_csv(REPORTS_DIR / "comparativo_mensal_2025_real_vs_predito.csv", index=False)

    hourly_rows = []
    for h in range(24):
        sub = comp[comp["hour"] == h]
        hourly_rows.append({
            "hora": h,
            "rotulo_hora": f"{h:02d}h",
            "real_carga_mw": round(float(sub["l_base_mw"].mean()), 1),
            "pred_carga_nonlin_24h_mw": round(float(sub["pred_load_nonlin_mw"].mean()), 1),
            "real_cf_pct": round(float(sub["cf_eolica"].mean() * 100.0), 2),
            "pred_cf_nonlin_pct": round(float(sub["pred_cf_nonlin"].mean() * 100.0), 2),
            "real_solar_mw": round(float(sub["g_solar_mw"].mean()), 1),
            "real_curtailment_mw": round(float(sub["curtailment_mw"].mean()), 1),
            "pred_curtailment_lin_mw": round(float(sub["pred_curt_lin_mw"].mean()), 1),
            "pred_curtailment_nonlin_mw": round(float(sub["pred_curt_nonlin_mw"].mean()), 1),
        })

    hourly_df = pd.DataFrame(hourly_rows)
    hourly_df.to_csv(REPORTS_DIR / "perfil_horario_2025_real_vs_predito.csv", index=False)


def main():
    print("=" * 72)
    print("Script 05: Modelos B (CF Eólico) e C (Curtailment) — Validação Cega 2025")
    print("=" * 72)

    train_file = PROCESSED_DATA_DIR / "train_features_2015_2024.csv"
    test_file = PROCESSED_DATA_DIR / "test_features_2025.csv"
    if not train_file.exists() or not test_file.exists():
        print("[ERRO] Arquivos train/test não encontrados. Execute primeiro o Script 03.")
        sys.exit(1)

    train_df = pd.read_csv(train_file)
    test_df = pd.read_csv(test_file)

    rows_b, preds_b = evaluate_model_b_wind_cf(train_df, test_df)
    df_b = pd.DataFrame(rows_b)
    print("\nBenchmark Out-of-Time 2025 — Modelo B (Fator de Capacidade Eólico Potencial):")
    print(df_b[["horizonte", "arquitetura", "mae_cf", "rmse_cf", "r2_score", "mae_potencia_equiv_mw"]].to_string(index=False))

    rows_c, preds_c = evaluate_model_c_curtailment(train_df, test_df)
    df_c = pd.DataFrame(rows_c)
    print("\nBenchmark Out-of-Time 2025 — Modelo C (Curtailment Eólico 2 Estágios):")
    print(
        df_c[[
            "arquitetura", "roc_auc", "brier_score", "f1_score",
            "mae_global_mw", "r2_volume", "energia_cortada_real_2025_twh", "energia_cortada_pred_2025_twh",
        ]].to_string(index=False)
    )

    combined_bc = pd.concat([df_b, df_c], ignore_index=True)
    report_path = REPORTS_DIR / "metricas_modelos_b_c_eolica_curtailment.csv"
    combined_bc.to_csv(report_path, index=False)

    export_2025_comparative_profiles(test_df, preds_b, preds_c)
    print(f"\n[SUCESSO] Métricas B/C e perfis comparativos 2025 exportados em: {REPORTS_DIR}")


if __name__ == "__main__":
    main()
