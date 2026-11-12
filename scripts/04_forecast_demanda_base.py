"""
04_forecast_demanda_base.py
Etapa 04: Modelo A - Previsão da Carga Base Horária do Nordeste L_base(t)
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Modelar e projetar a carga base horária L_base(t) do subsistema Nordeste até 2035.
- Utilizar apenas bibliotecas autorizadas (numpy, scipy, pandas).
- Implementar algoritmo de regressão linear regularizada (Ridge/L2) e decomposição harmônica de Fourier
  como baseline e modelo analítico interpretável sem dependências externas complexas.
- Avaliar desempenho com métricas exigidas no relatório: MAE (MW), RMSE (MW) e MAPE (%).
- Permitir ancoragem da tendência de longo prazo no PDE 2035 da EPE (~3.1% a.a.).
"""

import sys
from pathlib import Path
from typing import Dict, List, Tuple
import numpy as np
import pandas as pd

from config import (
    PROCESSED_DATA_DIR,
    REPORTS_DIR,
)


class LinearRidgeRegression:
    """
    Regressão Linear com regularização L2 (Ridge) implementada puramente via numpy/scipy.
    W = (X^T X + alpha * I)^(-1) X^T y
    Evita necessidade de instalar scikit-learn como dependência extra pesada.
    """
    def __init__(self, alpha: float = 1.0):
        self.alpha = alpha
        self.weights: Optional[np.ndarray] = None
        self.mean_x: Optional[np.ndarray] = None
        self.std_x: Optional[np.ndarray] = None

    def fit(self, X: np.ndarray, y: np.ndarray):
        n_samples, n_features = X.shape
        # Normalização padrão
        self.mean_x = np.mean(X, axis=0)
        self.std_x = np.std(X, axis=0)
        self.std_x[self.std_x == 0] = 1.0

        X_norm = (X - self.mean_x) / self.std_x
        # Adicionar coluna de bias (intercepto)
        X_bias = np.hstack([np.ones((n_samples, 1)), X_norm])

        # Matriz de penalização L2 (sem penalizar o intercepto)
        reg_matrix = self.alpha * np.eye(n_features + 1)
        reg_matrix[0, 0] = 0.0

        # Solução fechada de mínimos quadrados
        a_mat = X_bias.T @ X_bias + reg_matrix
        b_vec = X_bias.T @ y
        self.weights = np.linalg.solve(a_mat, b_vec)
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self.weights is None or self.mean_x is None or self.std_x is None:
            raise ValueError("Modelo ainda não treinado.")
        X_norm = (X - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((X.shape[0], 1)), X_norm])
        return X_bias @ self.weights


def compute_regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """
    Calcula as métricas de validação exigidas no Plano Orientador (Seção 8): MAE, RMSE e MAPE.
    """
    errors = y_true - y_pred
    mae = float(np.mean(np.abs(errors)))
    rmse = float(np.sqrt(np.mean(errors ** 2)))
    mape = float(np.mean(np.abs(errors / np.maximum(1.0, y_true))) * 100.0)
    return {
        "mae_mw": round(mae, 2),
        "rmse_mw": round(rmse, 2),
        "mape_pct": round(mape, 2),
    }


def time_series_backtesting(
    df: pd.DataFrame,
    feature_cols: List[str],
    target_col: str = "l_base_mw",
    n_splits: int = 4,
    test_hours: int = 168,  # Testar em blocos de 1 semana
) -> Tuple[List[Dict[str, float]], LinearRidgeRegression]:
    """
    Backtesting temporal sem vazamento futuro (respeitando a ordem cronológica estrita).
    """
    total_len = len(df)
    results = []
    final_model = LinearRidgeRegression(alpha=10.0)

    for i in range(n_splits, 0, -1):
        test_end = total_len - (i - 1) * test_hours
        test_start = test_end - test_hours
        train_end = test_start

        if train_end < 24 * 14:  # Mínimo de 2 semanas de treino
            continue

        train_data = df.iloc[:train_end]
        test_data = df.iloc[test_start:test_end]

        X_train = train_data[feature_cols].to_numpy(dtype=float)
        y_train = train_data[target_col].to_numpy(dtype=float)

        X_test = test_data[feature_cols].to_numpy(dtype=float)
        y_test = test_data[target_col].to_numpy(dtype=float)

        model = LinearRidgeRegression(alpha=10.0)
        model.fit(X_train, y_train)
        preds = model.predict(X_test)

        metrics = compute_regression_metrics(y_test, preds)
        metrics["split_fold"] = n_splits - i + 1
        metrics["train_samples"] = len(train_data)
        metrics["test_samples"] = len(test_data)
        results.append(metrics)

    # Treinar modelo final com todos os dados
    final_model.fit(df[feature_cols].to_numpy(dtype=float), df[target_col].to_numpy(dtype=float))
    return results, final_model


def project_load_to_2035(
    base_series: pd.Series,
    target_year: int,
    annual_epe_growth_rate: float = 0.031,  # 3.1% a.a. do PDE 2035
) -> pd.Series:
    """
    Ancora a tendência estrutural da demanda no PDE 2035 da EPE (Seção 3 e 4 do Plano Orientador).
    """
    years_ahead = max(0, target_year - 2026)
    factor = (1.0 + annual_epe_growth_rate) ** years_ahead
    return (base_series * factor).round(1)


def main():
    print("=" * 70)
    print("Script 04: Modelo A - Previsão da Carga Base Horária NE")
    print("=" * 70)

    matrix_file = PROCESSED_DATA_DIR / "ne_features_matrix.csv"
    if not matrix_file.exists():
        print(f"[ERRO] Matriz de features não encontrada: {matrix_file}")
        print("Execute primeiro o Script 03 (python3 scripts/03_feature_engineering_anova.py).")
        sys.exit(1)

    df = pd.read_csv(matrix_file)
    target_col = "l_base_mw"

    candidate_features = [
        "hour_sin", "hour_cos", "month_sin", "month_cos", "is_weekend",
        "l_base_mw_lag_1h", "l_base_mw_lag_24h", "l_base_mw_lag_168h",
        "l_base_mw_roll_mean_24h", "l_base_mw_roll_std_24h",
    ]
    features = [c for c in candidate_features if c in df.columns]
    print(f"[MODELO A] Features utilizadas ({len(features)}): {features}")

    # Backtesting Temporal
    metrics_list, model = time_series_backtesting(df, features, target_col=target_col)
    metrics_df = pd.DataFrame(metrics_list)

    report_path = REPORTS_DIR / "metricas_modelo_a_demanda.csv"
    metrics_df.to_csv(report_path, index=False)

    print("\nResultados do Backtesting Temporal do Modelo A (Demanda):")
    print(metrics_df[["split_fold", "mae_mw", "rmse_mw", "mape_pct"]].to_string(index=False))
    print(f"\n[MÉDIA FORA DA AMOSTRA] MAE: {metrics_df['mae_mw'].mean():.1f} MW | MAPE: {metrics_df['mape_pct'].mean():.2f}%")

    # Exemplo de Projeção para 2035 com taxa da EPE
    proj_2035 = project_load_to_2035(df[target_col], target_year=2035)
    print(f"\n[PROJEÇÃO PDE 2035] Carga Base Média NE atual: {df[target_col].mean():.1f} MW -> em 2035: {proj_2035.mean():.1f} MW")


if __name__ == "__main__":
    main()
