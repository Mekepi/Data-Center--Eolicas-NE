"""
05_forecast_wind_cf_and_curtailment.py
Etapa 05: Modelos B (Fator de Capacidade Eólico) e C (Curtailment / Cortes de Geração)
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Modelo B: Prever o Fator de Capacidade Eólico horário CF(t) = G_pot(t) / Cap(t).
  Permite separar "condições meteorológicas de vento" de "quantos GW estarão instalados no futuro".
- Modelo C: Classificar a probabilidade de corte e estimar o volume cortado (MWmed / MWh).
- Avaliar calibração e discriminação com métricas: Brier Score, ROC-AUC e MAE/RMSE no volume.
- Implementado estritamente com numpy e scipy (sem dependências externas não autorizadas).
"""

import sys
from pathlib import Path
from typing import Dict, List, Tuple
import numpy as np
import pandas as pd
from scipy.special import expit  # Função sigmoide 1 / (1 + e^-z)

from config import (
    PROCESSED_DATA_DIR,
    REPORTS_DIR,
)


class LogisticRegressionClassifier:
    """
    Classificador Logístico implementado com gradiente descendente puro (numpy).
    Usado no Modelo C para estimar a probabilidade de evento de curtailment.
    """
    def __init__(self, lr: float = 0.05, max_iter: int = 500, reg_l2: float = 0.01):
        self.lr = lr
        self.max_iter = max_iter
        self.reg_l2 = reg_l2
        self.weights: Optional[np.ndarray] = None
        self.mean_x: Optional[np.ndarray] = None
        self.std_x: Optional[np.ndarray] = None

    def fit(self, X: np.ndarray, y: np.ndarray):
        n_samples, n_features = X.shape
        self.mean_x = np.mean(X, axis=0)
        self.std_x = np.std(X, axis=0)
        self.std_x[self.std_x == 0] = 1.0

        X_norm = (X - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((n_samples, 1)), X_norm])

        # Inicialização de pesos
        self.weights = np.zeros(n_features + 1)

        for _ in range(self.max_iter):
            z = X_bias @ self.weights
            prob = expit(z)
            # Gradiente da log-loss + regularização L2
            grad = (X_bias.T @ (prob - y)) / n_samples
            grad[1:] += self.reg_l2 * self.weights[1:]
            self.weights -= self.lr * grad

        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        if self.weights is None:
            raise ValueError("Modelo não treinado.")
        X_norm = (X - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((X.shape[0], 1)), X_norm])
        return expit(X_bias @ self.weights)

    def predict(self, X: np.ndarray, threshold: float = 0.5) -> np.ndarray:
        return (self.predict_proba(X) >= threshold).astype(int)


class RidgeRegressor:
    """Regressão Ridge pura via numpy para o Modelo B (CF) e Modelo C (Volume de Corte)."""
    def __init__(self, alpha: float = 5.0):
        self.alpha = alpha
        self.weights: Optional[np.ndarray] = None
        self.mean_x: Optional[np.ndarray] = None
        self.std_x: Optional[np.ndarray] = None

    def fit(self, X: np.ndarray, y: np.ndarray):
        n_samples, n_features = X.shape
        self.mean_x = np.mean(X, axis=0)
        self.std_x = np.std(X, axis=0)
        self.std_x[self.std_x == 0] = 1.0
        X_norm = (X - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((n_samples, 1)), X_norm])
        reg = self.alpha * np.eye(n_features + 1)
        reg[0, 0] = 0.0
        self.weights = np.linalg.solve(X_bias.T @ X_bias + reg, X_bias.T @ y)
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        X_norm = (X - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((X.shape[0], 1)), X_norm])
        return X_bias @ self.weights


def compute_roc_auc_score(y_true: np.ndarray, y_score: np.ndarray) -> float:
    """
    Calcula a área sob a curva ROC (ROC-AUC) analiticamente via estatística de Wilcoxon-Mann-Whitney.
    AUC = P(Score_positivo > Score_negativo)
    """
    pos = y_score[y_true == 1]
    neg = y_score[y_true == 0]
    if len(pos) == 0 or len(neg) == 0:
        return 0.5
    # Contagem de pares concordantes
    matches = np.sum(pos[:, None] > neg[None, :]) + 0.5 * np.sum(pos[:, None] == neg[None, :])
    return float(matches / (len(pos) * len(neg)))


def compute_brier_score(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """
    Brier Score: mede a calibração da probabilidade de curtailment (exigido na Seção 8 do PDF).
    BS = mean((prob - y)^2). Quanto menor, melhor calibrado.
    """
    return float(np.mean((y_prob - y_true) ** 2))


def train_and_eval_wind_model(df: pd.DataFrame) -> Tuple[Dict[str, float], RidgeRegressor]:
    """Treina o Modelo B para estimar o Fator de Capacidade Eólico CF(t)."""
    feat_cols = [
        "hour_sin", "hour_cos", "month_sin", "month_cos",
        "cf_eolica_lag_1h", "cf_eolica_lag_24h", "cf_eolica_lag_168h",
        "cf_eolica_roll_mean_24h", "cf_eolica_roll_std_24h",
    ]
    features = [c for c in feat_cols if c in df.columns]

    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]

    model_cf = RidgeRegressor(alpha=5.0)
    model_cf.fit(train_df[features].to_numpy(dtype=float), train_df["cf_eolica"].to_numpy(dtype=float))

    preds = np.clip(model_cf.predict(test_df[features].to_numpy(dtype=float)), 0.0, 1.0)
    actual = test_df["cf_eolica"].to_numpy(dtype=float)

    mae_cf = float(np.mean(np.abs(actual - preds)))
    rmse_cf = float(np.sqrt(np.mean((actual - preds) ** 2)))

    return {
        "modelo": "Modelo B - Fator de Capacidade CF(t)",
        "mae_cf": round(mae_cf, 4),
        "rmse_cf": round(rmse_cf, 4),
        "r2_score": round(float(1.0 - np.sum((actual - preds) ** 2) / np.sum((actual - np.mean(actual)) ** 2)), 3),
    }, model_cf


def train_and_eval_curtailment_stage(df: pd.DataFrame) -> Dict[str, float]:
    """Treina o Modelo C (Classificador de Probabilidade + Regressão de Volume de Corte)."""
    feat_cols = [
        "hour_sin", "hour_cos", "month_sin", "month_cos", "is_weekend",
        "g_eolica_potencial_mw", "g_solar_mw", "l_base_mw",
        "cf_eolica_roll_mean_24h",
    ]
    features = [c for c in feat_cols if c in df.columns]

    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]

    # 1. Classificação
    clf = LogisticRegressionClassifier(lr=0.1, max_iter=400)
    y_train_flag = train_df["flag_curtailment"].to_numpy(dtype=float)
    y_test_flag = test_df["flag_curtailment"].to_numpy(dtype=float)

    clf.fit(train_df[features].to_numpy(dtype=float), y_train_flag)
    prob_cut = clf.predict_proba(test_df[features].to_numpy(dtype=float))

    roc_auc = compute_roc_auc_score(y_test_flag, prob_cut)
    brier = compute_brier_score(y_test_flag, prob_cut)

    # 2. Volume Cortado em MWmed (apenas para eventos positivos)
    reg_vol = RidgeRegressor(alpha=10.0)
    train_cut = train_df[train_df["flag_curtailment"] == 1]
    if len(train_cut) > 5:
        reg_vol.fit(train_cut[features].to_numpy(dtype=float), train_cut["curtailment_mw"].to_numpy(dtype=float))
        test_cut = test_df[test_df["flag_curtailment"] == 1]
        if len(test_cut) > 0:
            preds_vol = np.clip(reg_vol.predict(test_cut[features].to_numpy(dtype=float)), 0.0, None)
            mae_vol = float(np.mean(np.abs(test_cut["curtailment_mw"] - preds_vol)))
        else:
            mae_vol = 0.0
    else:
        mae_vol = 0.0

    return {
        "modelo": "Modelo C - Curtailment eólico",
        "roc_auc": round(roc_auc, 3),
        "brier_score": round(brier, 4),
        "mae_volume_cortado_mw": round(mae_vol, 1),
    }


def main():
    print("=" * 70)
    print("Script 05: Modelos B (CF Eólico) e C (Curtailment)")
    print("=" * 70)

    matrix_file = PROCESSED_DATA_DIR / "ne_features_matrix.csv"
    if not matrix_file.exists():
        print(f"[ERRO] Matriz de features não encontrada: {matrix_file}")
        sys.exit(1)

    df = pd.read_csv(matrix_file)

    # Avaliar Modelo B
    metrics_b, _ = train_and_eval_wind_model(df)
    print("\nResultados do Modelo B (Fator de Capacidade CF):")
    print(pd.Series(metrics_b).to_string())

    # Avaliar Modelo C
    metrics_c = train_and_eval_curtailment_stage(df)
    print("\nResultados do Modelo C (Classificação e Volume de Curtailment):")
    print(pd.Series(metrics_c).to_string())

    # Salvar relatório combinado
    summary_df = pd.DataFrame([metrics_b, metrics_c])
    report_path = REPORTS_DIR / "metricas_modelos_b_c_eolica_curtailment.csv"
    summary_df.to_csv(report_path, index=False)
    print(f"\n[SUCESSO] Relatório de validação exportado para: {report_path}")


if __name__ == "__main__":
    main()
