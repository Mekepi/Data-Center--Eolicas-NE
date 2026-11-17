"""
04_forecast_demanda_base.py
Etapa 04: Modelo A - Previsão da Carga Base Horária do Nordeste L_base(t)
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Treinar o Modelo A estritamente no histórico 2015–2024 (87.476 horas) e validar de forma cega
  out-of-time em todas as 8.760 horas de 2025 (conforme protocolo aprovado).
- Comparar modelos lineares e não-lineares implementados puramente em numpy/scipy:
  1. Baseline Linear: Regressão Ridge L2 (solução fechada analítica).
  2. Challenger Não-Linear 1: Rede Neural Residual MLP (ativação tanh + skip linear via L-BFGS-B).
  3. Challenger Não-Linear 2: Histogram GBDT (Gradient Boosted Decision Trees 100% NumPy).
- Avaliar tanto o horizonte Operativo 1h-Ahead quanto Programação Diária 24h Day-Ahead (sem lag_1h),
  além de Backtesting Temporal em múltiplos folds paralelos (multiprocessing.Pool).
- Ancorar a tendência estrutural de longo prazo até 2035 na taxa oficial do PDE/EPE (~3,1% a.a.).
"""

import os
import sys
import multiprocessing as mp
from typing import Dict, List, Tuple
import numpy as np
import pandas as pd

from config import (
    PROCESSED_DATA_DIR,
    REPORTS_DIR,
    ANNUAL_LOAD_GROWTH_RATE,
    BASELINE_YEAR,
    TARGET_END_YEAR,
    ML_MODEL_PARAMS,
)
from ml_models_numpy import (
    LinearRidgeModel,
    ResidualMLPRegressor,
    HistogramGBDTRegressor,
    compute_regression_metrics,
    impute_with_train_medians,
)


FEATURES_1H_AHEAD = [
    "year_trend",
    "hour_sin",
    "hour_cos",
    "hour_sin_2",
    "hour_cos_2",
    "dow_sin",
    "dow_cos",
    "month_sin",
    "month_cos",
    "is_weekend",
    "faixa_ponta",
    "interaction_hour_month",
    "interaction_weekend_hour",
    "l_base_mw_lag_1h",
    "l_base_mw_lag_24h",
    "l_base_mw_lag_168h",
    "l_base_mw_roll_mean_24h",
    "l_base_mw_roll_std_24h",
]

FEATURES_24H_DAY_AHEAD = [
    "year_trend",
    "hour_sin",
    "hour_cos",
    "hour_sin_2",
    "hour_cos_2",
    "dow_sin",
    "dow_cos",
    "month_sin",
    "month_cos",
    "is_weekend",
    "faixa_ponta",
    "interaction_hour_month",
    "interaction_weekend_hour",
    "l_base_mw_lag_24h",
    "l_base_mw_lag_168h",
    "l_base_mw_roll_mean_d1",
    "l_base_mw_roll_std_d1",
]


def _eval_backtest_fold_worker(args: Tuple[int, np.ndarray, np.ndarray, np.ndarray, np.ndarray, int]) -> Dict[str, float]:
    """Worker paralelo para validação cruzada em janela expansiva (TimeSeriesSplit + embargo) no conjunto 2015-2024."""
    fold_idx, X_tr_raw, y_tr, X_val_raw, y_val, embargo_hours = args
    bt_mlp_cfg = ML_MODEL_PARAMS["modelABacktestResMlp"]
    seed = int(ML_MODEL_PARAMS["seed"])

    X_tr, X_val = impute_with_train_medians(X_tr_raw, X_val_raw)
    assert X_val is not None

    ridge = LinearRidgeModel(alpha=float(ML_MODEL_PARAMS["ridgeAlpha"])).fit(X_tr, y_tr)
    m_ridge = compute_regression_metrics(y_val, ridge.predict(X_val))

    mlp = ResidualMLPRegressor(
        hidden_units=int(bt_mlp_cfg["hiddenUnits"]),
        reg_l2=float(bt_mlp_cfg["regL2"]),
        max_iter=int(bt_mlp_cfg["maxIter"]),
        seed=seed + fold_idx,
    ).fit(X_tr, y_tr)
    m_mlp = compute_regression_metrics(y_val, mlp.predict(X_val))

    return {
        "fold": fold_idx,
        "train_hours": int(len(X_tr)),
        "embargo_hours": int(embargo_hours),
        "val_hours": int(len(X_val)),
        "ridge_mae_mw": round(m_ridge["mae"], 2),
        "ridge_mape_pct": round(m_ridge["mape_pct"], 2),
        "ridge_r2": round(m_ridge["r2"], 4),
        "resmlp_mae_mw": round(m_mlp["mae"], 2),
        "resmlp_mape_pct": round(m_mlp["mape_pct"], 2),
        "resmlp_r2": round(m_mlp["r2"], 4),
    }


def run_expanding_window_backtest(
    train_df: pd.DataFrame,
    feature_cols: List[str],
    target_col: str = "l_base_mw",
    n_splits: int = int(ML_MODEL_PARAMS["backtestSplits"]),
    val_hours: int = int(ML_MODEL_PARAMS["backtestValHours"]),  # Janelas trimestrais (2.160 h) por fold
    embargo_hours: int = int(ML_MODEL_PARAMS.get("backtestEmbargoHours", 168)),
) -> pd.DataFrame:
    """Executa TimeSeriesSplit estritamente dentro da base de treino (2015-2024) com embargo temporal."""
    X_all = train_df[feature_cols].to_numpy(dtype=float)
    y_all = train_df[target_col].to_numpy(dtype=float)
    total = len(train_df)
    min_train_hours = int(ML_MODEL_PARAMS["backtestMinTrainHours"])
    eff_embargo = max(0, int(embargo_hours))

    tasks = []
    for i in range(n_splits, 0, -1):
        val_end = total - (i - 1) * val_hours
        val_start = val_end - val_hours
        tr_end = val_start - eff_embargo
        if tr_end < min_train_hours:
            continue
        fold_num = n_splits - i + 1
        tasks.append((fold_num, X_all[:tr_end], y_all[:tr_end], X_all[val_start:val_end], y_all[val_start:val_end], eff_embargo))

    if not tasks:
        return pd.DataFrame()
    n_workers = max(1, min(len(tasks), os.cpu_count() or 2))
    with mp.Pool(processes=n_workers) as pool:
        rows = pool.map(_eval_backtest_fold_worker, tasks)
    return pd.DataFrame(rows)


def evaluate_models_out_of_time_2025(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Treina os 3 modelos em 2015-2024 e avalia de forma cega em todas as 8.760 horas de 2025,
    tanto em 1h-Ahead quanto em 24h Day-Ahead.
    """
    y_train = train_df["l_base_mw"].to_numpy(dtype=float)
    y_test = test_df["l_base_mw"].to_numpy(dtype=float)
    ponta_mask = test_df["faixa_ponta"].to_numpy(dtype=int) == 1

    benchmark_rows = []
    preds_2025 = test_df[["ts", "month", "hour", "faixa_ponta", "l_base_mw"]].copy()

    for horizon_id, horizon_name, cand_cols in [
        ("1h", "Operativo Curto Prazo (1h-Ahead)", FEATURES_1H_AHEAD),
        ("24h", "Programação Diária (24h Day-Ahead)", FEATURES_24H_DAY_AHEAD),
    ]:
        feats = [c for c in cand_cols if c in train_df.columns]
        X_tr_raw = train_df[feats].to_numpy(dtype=float)
        X_te_raw = test_df[feats].to_numpy(dtype=float)
        X_tr, X_te = impute_with_train_medians(X_tr_raw, X_te_raw)
        assert X_te is not None

        mlp_cfg = ML_MODEL_PARAMS["modelAResMlp"]
        gbdt_cfg = ML_MODEL_PARAMS["modelAGbdt"]
        models = [
            ("ridge", "linear", "Baseline Linear · Ridge L2", "Linear", LinearRidgeModel(alpha=float(ML_MODEL_PARAMS["ridgeAlpha"]))),
            (
                "resmlp",
                "nonlinear",
                "Challenger Não-Linear · Rede Neural ResMLP (L-BFGS-B)",
                "Não-Linear (SciPy L-BFGS-B)",
                ResidualMLPRegressor(
                    hidden_units=int(mlp_cfg["hiddenUnits"]),
                    reg_l2=float(mlp_cfg["regL2"]),
                    max_iter=int(mlp_cfg["maxIter"]),
                    seed=int(ML_MODEL_PARAMS["seed"]),
                ),
            ),
            (
                "gbdt",
                "nonlinear",
                "Challenger Não-Linear · Histogram GBDT (Árvores)",
                "Não-Linear (NumPy GBDT)",
                HistogramGBDTRegressor(
                    n_estimators=int(gbdt_cfg["nEstimators"]),
                    learning_rate=float(gbdt_cfg["learningRate"]),
                    max_depth=int(gbdt_cfg["maxDepth"]),
                    min_samples_leaf=int(gbdt_cfg["minSamplesLeaf"]),
                ),
            ),
        ]

        for model_id, family_id, model_name, family, est in models:
            est.fit(X_tr, y_train)
            y_hat = est.predict(X_te)
            m = compute_regression_metrics(y_test, y_hat)
            ponta_mae = float(np.mean(np.abs(y_test[ponta_mask] - y_hat[ponta_mask])))

            benchmark_rows.append({
                "etapa": "Modelo A - Carga Base NE",
                "horizonte_id": horizon_id,
                "modelo_id": model_id,
                "familia_id": family_id,
                "horizonte": horizon_name,
                "arquitetura": model_name,
                "familia": family,
                "mae_mw": round(m["mae"], 2),
                "rmse_mw": round(m["rmse"], 2),
                "mape_pct": round(m["mape_pct"], 2),
                "r2_score": round(m["r2"], 4),
                "mae_ponta_18h_21h_mw": round(ponta_mae, 2),
                "treino_horas": len(train_df),
                "teste_2025_horas": len(test_df),
            })

            preds_2025[f"pred_l_base_{model_id}_{horizon_id}_mw"] = np.round(y_hat, 2)

    return pd.DataFrame(benchmark_rows), preds_2025


def project_load_to_2035(
    base_series_2025: pd.Series,
    target_year: int = TARGET_END_YEAR,
    annual_epe_growth_rate: float = ANNUAL_LOAD_GROWTH_RATE,
) -> pd.Series:
    """Ancora a tendência estrutural da demanda base no PDE 2035 da EPE (~3,1% a.a.)."""
    years_ahead = max(0, target_year - BASELINE_YEAR)
    factor = (1.0 + annual_epe_growth_rate) ** years_ahead
    return (base_series_2025 * factor).round(1)


def main():
    print("=" * 72)
    print("Script 04: Modelo A - Previsão da Carga Base Horária NE (Treino 2015-2024 -> Teste 2025)")
    print("=" * 72)

    train_file = PROCESSED_DATA_DIR / "train_features_2015_2024.csv"
    test_file = PROCESSED_DATA_DIR / "test_features_2025.csv"
    if not train_file.exists() or not test_file.exists():
        print("[ERRO] Arquivos de treino/teste não encontrados. Execute primeiro o Script 03.")
        sys.exit(1)

    train_df = pd.read_csv(train_file)
    test_df = pd.read_csv(test_file)

    feats_1h = [c for c in FEATURES_1H_AHEAD if c in train_df.columns]
    print(f"[BACKTEST] Executando TimeSeriesSplit paralelo em 2015-2024 ({len(train_df):,} h)...")
    bt_df = run_expanding_window_backtest(train_df, feats_1h)
    bt_df.to_csv(REPORTS_DIR / "backtest_folds_modelo_a_2015_2024.csv", index=False)
    print(bt_df.to_string(index=False))

    print(f"\n[TESTE OUT-OF-TIME 2025] Avaliando Baseline Linear vs. Challengers Não-Lineares em {len(test_df):,} h...")
    bench_a_df, preds_2025 = evaluate_models_out_of_time_2025(train_df, test_df)

    report_path = REPORTS_DIR / "metricas_modelo_a_demanda.csv"
    bench_a_df.to_csv(report_path, index=False)
    preds_2025.to_csv(PROCESSED_DATA_DIR / "predicoes_2025_modelo_a.csv", index=False)

    print("\nBenchmark Cego Out-of-Time em 2025 — Modelo A (Carga Base NE):")
    print(
        bench_a_df[["horizonte", "arquitetura", "mae_mw", "rmse_mw", "mape_pct", "r2_score", "mae_ponta_18h_21h_mw"]]
        .to_string(index=False)
    )

    proj_2035 = project_load_to_2035(test_df["l_base_mw"], target_year=TARGET_END_YEAR)
    print(
        f"\n[ANCORAGEM EPE PDE {TARGET_END_YEAR}] Carga Base Média NE Real {BASELINE_YEAR}: {test_df['l_base_mw'].mean():,.1f} MW -> "
        f"Projeção Estrutural {TARGET_END_YEAR} (sem DCs): {proj_2035.mean():,.1f} MW (Pico: {proj_2035.max():,.1f} MW)"
    )


if __name__ == "__main__":
    main()
