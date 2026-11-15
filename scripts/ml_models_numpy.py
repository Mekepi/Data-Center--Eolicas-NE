"""
ml_models_numpy.py
Módulo Compartilhado de Aprendizado de Máquina Linear e Não-Linear (NumPy & SciPy Puros)
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Objetivo:
- Fornecer estimadores estatísticos e de Machine Learning sem nenhuma dependência além de
  numpy e scipy (respeitando estritamente a política de bibliotecas aprovadas do projeto):
  1. LinearRidgeModel: Regressão Linear regularizada L2 exata (baseline interpretável).
  2. LogisticLBFGSModel: Regressão Logística regularizada L2 otimizada via L-BFGS-B (baseline).
  3. ResidualMLPRegressor: Rede Neural Perceptron Multicamadas com conexão residual linear
     e ativação não-linear tanh otimizada via quasi-Newton L-BFGS-B (scipy.optimize.minimize).
  4. ResidualMLPClassifier: Classificador Neural não-linear calibrado por entropia cruzada (L-BFGS-B).
  5. HistogramGBDTRegressor: Ensemble Não-Linear de Árvores de Decisão por Gradiente (Gradient Boosting)
     com discretização em histogramas de quantis (32 bins) implementado 100% em NumPy vetorizado.
  6. HistogramGBDTClassifier: Ensemble Não-Linear de Árvores por Gradiente para classificação probabilística.
- Fornecer métricas exatas e rápidas (MAE, RMSE, MAPE, R², ROC-AUC O(N log N) via rankdata, Brier Score, F1).
"""

from typing import Dict, List, Optional, Tuple
import numpy as np
from scipy.linalg import solve
from scipy.optimize import minimize
from scipy.special import expit
from scipy.stats import rankdata


# ============================================================================
# 1. MÉTRICAS DE VALIDAÇÃO (SEÇÃO 8 DO PLANO ORIENTADOR)
# ============================================================================

def compute_regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Calcula MAE, RMSE, MAPE (%) e coeficiente de determinação R²."""
    y_t = np.asarray(y_true, dtype=float)
    y_p = np.asarray(y_pred, dtype=float)
    err = y_t - y_p
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    denom = np.maximum(1.0, np.abs(y_t))
    mape = float(np.mean(np.abs(err) / denom) * 100.0)
    ss_res = float(np.sum(err ** 2))
    ss_tot = float(np.sum((y_t - np.mean(y_t)) ** 2))
    r2 = float(1.0 - ss_res / max(1e-12, ss_tot))
    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "mape_pct": round(mape, 3),
        "r2": round(r2, 4),
    }


def compute_roc_auc_fast(y_true: np.ndarray, y_score: np.ndarray) -> float:
    """
    Calcula ROC-AUC exato em O(N log N) usando postos médios de Wilcoxon-Mann-Whitney
    (scipy.stats.rankdata), evitando matrizes quadráticas O(N²) em séries de 8.760+ horas.
    """
    y_t = (np.asarray(y_true) > 0.5).astype(int)
    n_pos = int(np.sum(y_t == 1))
    n_neg = int(np.sum(y_t == 0))
    if n_pos == 0 or n_neg == 0:
        return 0.5
    ranks = rankdata(np.asarray(y_score, dtype=float), method="average")
    sum_pos_ranks = float(np.sum(ranks[y_t == 1]))
    auc = (sum_pos_ranks - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)
    return float(np.clip(auc, 0.0, 1.0))


def compute_classification_metrics(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    threshold: float = 0.5,
) -> Dict[str, float]:
    """Calcula ROC-AUC, Brier Score, Precisão, Recall e F1-Score."""
    y_t = (np.asarray(y_true) > 0.5).astype(int)
    prob = np.clip(np.asarray(y_prob, dtype=float), 0.0, 1.0)
    pred = (prob >= threshold).astype(int)

    roc_auc = compute_roc_auc_fast(y_t, prob)
    brier = float(np.mean((prob - y_t) ** 2))

    tp = int(np.sum((pred == 1) & (y_t == 1)))
    fp = int(np.sum((pred == 1) & (y_t == 0)))
    fn = int(np.sum((pred == 0) & (y_t == 1)))

    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    f1 = 2.0 * precision * recall / max(1e-9, precision + recall)
    acc = float(np.mean(pred == y_t))

    return {
        "roc_auc": round(roc_auc, 4),
        "brier_score": round(brier, 4),
        "f1_score": round(float(f1), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "accuracy": round(acc, 4),
    }


def _prepare_sample_weights(sample_weight: Optional[np.ndarray], n_samples: int) -> Tuple[np.ndarray, np.ndarray]:
    """Valida pesos amostrais e devolve (w_norm com soma 1.0, w_eff com média 1.0)."""
    if sample_weight is None:
        w_eff = np.ones(n_samples, dtype=float)
        return w_eff / float(max(1, n_samples)), w_eff
    w_arr = np.asarray(sample_weight, dtype=float)
    if w_arr.shape[0] != n_samples:
        raise ValueError(f"sample_weight deve ter comprimento {n_samples}, recebido {w_arr.shape[0]}.")
    w_arr = np.clip(np.nan_to_num(w_arr, nan=1.0, posinf=1.0, neginf=1e-6), 1e-6, None)
    w_sum = float(np.sum(w_arr))
    w_norm = w_arr / max(1e-12, w_sum)
    w_eff = w_norm * float(n_samples)
    return w_norm, w_eff


# ============================================================================
# 2. MODELOS LINEARES BASELINE (RIDGE & LOGÍSTICA L-BFGS-B)
# ============================================================================

class LinearRidgeModel:
    """Regressão Linear Regularizada L2 (Ridge) com solução analítica via scipy.linalg.solve."""

    def __init__(self, alpha: float = 10.0):
        self.alpha = alpha
        self.weights: Optional[np.ndarray] = None
        self.mean_x: Optional[np.ndarray] = None
        self.std_x: Optional[np.ndarray] = None

    def fit(self, X: np.ndarray, y: np.ndarray, sample_weight: Optional[np.ndarray] = None) -> "LinearRidgeModel":
        X_arr = np.asarray(X, dtype=float)
        y_arr = np.asarray(y, dtype=float)
        n_samples, n_features = X_arr.shape
        _, w_eff = _prepare_sample_weights(sample_weight, n_samples)

        self.mean_x = np.average(X_arr, axis=0, weights=w_eff)
        var_x = np.average((X_arr - self.mean_x) ** 2, axis=0, weights=w_eff)
        self.std_x = np.sqrt(var_x)
        self.std_x[self.std_x < 1e-9] = 1.0

        X_norm = (X_arr - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((n_samples, 1)), X_norm])

        sqrt_w = np.sqrt(w_eff)
        Xw = X_bias * sqrt_w[:, None]
        yw = y_arr * sqrt_w

        reg = self.alpha * np.eye(n_features + 1)
        reg[0, 0] = 0.0
        self.weights = solve(Xw.T @ Xw + reg, Xw.T @ yw, assume_a="pos")
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self.weights is None or self.mean_x is None or self.std_x is None:
            raise ValueError("LinearRidgeModel não treinado.")
        X_norm = (np.asarray(X, dtype=float) - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((X_norm.shape[0], 1)), X_norm])
        return X_bias @ self.weights


class LogisticLBFGSModel:
    """Classificador Logístico L2 otimizado com quasi-Newton L-BFGS-B (scipy.optimize.minimize)."""

    def __init__(self, reg_l2: float = 1e-3, max_iter: int = 200):
        self.reg_l2 = reg_l2
        self.max_iter = max_iter
        self.weights: Optional[np.ndarray] = None
        self.mean_x: Optional[np.ndarray] = None
        self.std_x: Optional[np.ndarray] = None

    def fit(self, X: np.ndarray, y: np.ndarray, sample_weight: Optional[np.ndarray] = None) -> "LogisticLBFGSModel":
        X_arr = np.asarray(X, dtype=float)
        y_arr = np.asarray(y, dtype=float)
        n_samples, n_features = X_arr.shape
        w_norm, w_eff = _prepare_sample_weights(sample_weight, n_samples)

        self.mean_x = np.average(X_arr, axis=0, weights=w_eff)
        var_x = np.average((X_arr - self.mean_x) ** 2, axis=0, weights=w_eff)
        self.std_x = np.sqrt(var_x)
        self.std_x[self.std_x < 1e-9] = 1.0

        X_norm = (X_arr - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((n_samples, 1)), X_norm])

        def loss_and_grad(w: np.ndarray) -> Tuple[float, np.ndarray]:
            z = X_bias @ w
            prob = expit(z)
            # Log-loss numericamente estável: log(1 + exp(z)) - y*z
            log_loss = float(np.sum(w_norm * (np.logaddexp(0.0, z) - y_arr * z)))
            l2_pen = 0.5 * self.reg_l2 * float(np.sum(w[1:] ** 2))
            grad = X_bias.T @ (w_norm * (prob - y_arr))
            grad[1:] += self.reg_l2 * w[1:]
            return log_loss + l2_pen, grad

        w0 = np.zeros(n_features + 1)
        res = minimize(
            loss_and_grad,
            w0,
            method="L-BFGS-B",
            jac=True,
            options={"maxiter": self.max_iter},
        )
        self.weights = res.x
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        if self.weights is None or self.mean_x is None or self.std_x is None:
            raise ValueError("LogisticLBFGSModel não treinado.")
        X_norm = (np.asarray(X, dtype=float) - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((X_norm.shape[0], 1)), X_norm])
        return expit(X_bias @ self.weights)


# ============================================================================
# 3. CHALLENGER NÃO-LINEAR 1: REDE NEURAL RESIDUAL MLP (SCIPY L-BFGS-B)
# ============================================================================

class ResidualMLPRegressor:
    """
    Rede Neural Perceptron Multicamadas com Conexão Residual Linear (ResMLP):
        y_hat = b_out + X_norm @ w_skip + act(X_norm @ W1 + b1) @ w2
    Suporta ativação 'tanh' (padrão, Modelos A/B) ou 'silu' (Swish suave não-saturante
    para regimes de cauda/excedente sem teto como o Estágio C2 de curtailment).
    Treinada via backpropagation analítico vetorizado + quasi-Newton L-BFGS-B (SciPy).
    Opcionalmente executa validação cruzada em blocos temporais (cv_folds >= 2) para
    calibrar reg_l2 sem vazamento futuro e média de ensemble multi-seed.
    """

    def __init__(
        self,
        hidden_units: int = 20,
        reg_l2: float = 1e-3,
        max_iter: int = 120,
        subsample_max: int = 35000,
        seed: int = 42,
        reg_l2_skip: Optional[float] = None,
        reg_l2_grid: Optional[Tuple[float, ...]] = None,
        cv_folds: int = 1,
        n_ensemble: int = 1,
        activation: str = "tanh",
    ):
        if activation not in ("tanh", "silu"):
            raise ValueError(f"Ativação não suportada em ResidualMLPRegressor: {activation}")
        self.hidden_units = hidden_units
        self.reg_l2 = reg_l2
        self.reg_l2_skip = reg_l2_skip
        self.reg_l2_grid: Optional[Tuple[float, ...]] = (
            tuple(float(v) for v in reg_l2_grid) if reg_l2_grid is not None else None
        )
        self.cv_folds = max(1, int(cv_folds))
        self.n_ensemble = max(1, int(n_ensemble))
        self.activation = activation
        self.max_iter = max_iter
        self.subsample_max = subsample_max
        self.seed = seed
        self.mean_x: Optional[np.ndarray] = None
        self.std_x: Optional[np.ndarray] = None
        self.mean_y: float = 0.0
        self.std_y: float = 1.0
        self.reg_l2_selected_: Optional[float] = None
        self.params_: Optional[Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]] = None
        self.ensemble_params_: List[Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]] = []

    def _unpack(self, theta: np.ndarray, d: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]:
        h = self.hidden_units
        idx1 = d * h
        W1 = theta[:idx1].reshape(d, h)
        b1 = theta[idx1:idx1 + h]
        w2 = theta[idx1 + h:idx1 + 2 * h]
        w_skip = theta[idx1 + 2 * h:idx1 + 2 * h + d]
        b_out = float(theta[-1])
        return W1, b1, w2, w_skip, b_out

    @staticmethod
    def _activate(Z1: np.ndarray, activation: str) -> np.ndarray:
        if activation == "silu":
            return Z1 * expit(Z1)
        return np.tanh(Z1)

    @staticmethod
    def _activate_with_grad(Z1: np.ndarray, activation: str) -> Tuple[np.ndarray, np.ndarray]:
        if activation == "silu":
            sig = expit(Z1)
            A1 = Z1 * sig
            dA1_dz = sig * (1.0 + Z1 * (1.0 - sig))
            return A1, dA1_dz
        A1 = np.tanh(Z1)
        return A1, 1.0 - A1 ** 2

    def _eval_norm(
        self,
        params: Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float],
        X_norm: np.ndarray,
    ) -> np.ndarray:
        W1, b1, w2, w_skip, b_out = params
        return b_out + X_norm @ w_skip + self._activate(X_norm @ W1 + b1, self.activation) @ w2

    def _fit_with_reg(
        self,
        X_norm: np.ndarray,
        y_norm: np.ndarray,
        w_norm: np.ndarray,
        reg_l2_val: float,
        max_iter: int,
        seed_offset: int = 0,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]:
        rng = np.random.default_rng(self.seed + seed_offset)
        n, d = X_norm.shape
        h = self.hidden_units
        skip_reg = float(self.reg_l2_skip) if self.reg_l2_skip is not None else 0.2 * float(reg_l2_val)
        activation = self.activation

        # 1. Warm-start exato do ramo residual linear (Ridge ponderado na escala normalizada)
        X_bias = np.hstack([np.ones((n, 1)), X_norm])
        reg_mat = skip_reg * np.eye(d + 1)
        reg_mat[0, 0] = 0.0
        lin_w = solve(X_bias.T @ (X_bias * w_norm[:, None]) + reg_mat, X_bias.T @ (w_norm * y_norm), assume_a="pos")
        b_out_0 = float(lin_w[0])
        w_skip_0 = lin_w[1:].copy()
        resid = y_norm - (b_out_0 + X_norm @ w_skip_0)
        obj_lin_pure = 0.5 * float(np.sum(w_norm * (resid ** 2))) + 0.5 * skip_reg * float(np.sum(w_skip_0 ** 2))

        # 2. Quebra de simetria + passo Ridge amortecido sobre os resíduos lineares
        W1_0 = rng.normal(0.0, 1.0 / np.sqrt(d), size=(d, h))
        b1_0 = rng.uniform(-0.5, 0.5, size=h) if self.reg_l2_skip is not None else np.zeros(h)
        H_0 = self._activate(X_norm @ W1_0 + b1_0, activation)
        gram_h = H_0.T @ (H_0 * w_norm[:, None]) + max(5e-3, float(reg_l2_val)) * np.eye(h)
        rhs_h = H_0.T @ (w_norm * resid)
        w2_base = solve(gram_h, rhs_h, assume_a="pos")

        def eval_obj(theta: np.ndarray) -> float:
            W1, b1, w2, w_skip, b_out = self._unpack(theta, d)
            A1 = self._activate(X_norm @ W1 + b1, activation)
            pred = b_out + X_norm @ w_skip + A1 @ w2
            diff = pred - y_norm
            mse = 0.5 * float(np.sum(w_norm * (diff ** 2)))
            pen = 0.5 * float(reg_l2_val) * float(np.sum(W1 ** 2) + np.sum(w2 ** 2)) + 0.5 * skip_reg * float(np.sum(w_skip ** 2))
            return mse + pen

        theta0 = None
        best_theta = None
        best_obj = float("inf")
        for damp in (0.6, 0.3, 0.15, 0.05):
            cand = np.concatenate([W1_0.ravel(), b1_0, damp * w2_base, w_skip_0, [b_out_0]])
            cand_obj = eval_obj(cand)
            if cand_obj < best_obj:
                best_obj = cand_obj
                best_theta = cand
            if cand_obj < obj_lin_pure:
                theta0 = cand
                break
        if theta0 is None:
            theta0 = best_theta if best_theta is not None else np.concatenate(
                [W1_0.ravel(), b1_0, 0.15 * w2_base, w_skip_0, [b_out_0]]
            )

        def obj_and_grad(theta: np.ndarray) -> Tuple[float, np.ndarray]:
            W1, b1, w2, w_skip, b_out = self._unpack(theta, d)
            Z1 = X_norm @ W1 + b1
            A1, dA1_dz = self._activate_with_grad(Z1, activation)
            pred = b_out + X_norm @ w_skip + A1 @ w2
            diff = pred - y_norm

            mse = 0.5 * float(np.sum(w_norm * (diff ** 2)))
            pen = 0.5 * float(reg_l2_val) * float(np.sum(W1 ** 2) + np.sum(w2 ** 2)) + 0.5 * skip_reg * float(np.sum(w_skip ** 2))

            d_pred = w_norm * diff
            grad_b_out = float(np.sum(d_pred))
            grad_w_skip = X_norm.T @ d_pred + skip_reg * w_skip
            grad_w2 = A1.T @ d_pred + float(reg_l2_val) * w2
            dA1 = np.outer(d_pred, w2) * dA1_dz
            grad_W1 = X_norm.T @ dA1 + float(reg_l2_val) * W1
            grad_b1 = np.sum(dA1, axis=0)

            grad = np.concatenate([grad_W1.ravel(), grad_b1, grad_w2, grad_w_skip, [grad_b_out]])
            return mse + pen, grad

        res = minimize(
            obj_and_grad,
            theta0,
            method="L-BFGS-B",
            jac=True,
            options={"maxiter": max_iter},
        )
        return self._unpack(res.x, d)

    def fit(self, X: np.ndarray, y: np.ndarray, sample_weight: Optional[np.ndarray] = None) -> "ResidualMLPRegressor":
        rng = np.random.default_rng(self.seed)
        X_arr = np.asarray(X, dtype=float)
        y_arr = np.asarray(y, dtype=float)
        w_in = np.ones(len(X_arr), dtype=float) if sample_weight is None else np.asarray(sample_weight, dtype=float)

        if len(X_arr) > self.subsample_max:
            recent = int(self.subsample_max * 0.6)
            older_idx = rng.choice(len(X_arr) - recent, size=self.subsample_max - recent, replace=False)
            sel = np.concatenate([np.sort(older_idx), np.arange(len(X_arr) - recent, len(X_arr))])
            X_arr = X_arr[sel]
            y_arr = y_arr[sel]
            w_in = w_in[sel]

        n, _ = X_arr.shape
        w_norm, w_eff = _prepare_sample_weights(w_in, n)

        selected_reg = float(self.reg_l2)
        if self.cv_folds >= 2 and self.reg_l2_grid and len(self.reg_l2_grid) > 1 and n >= 400:
            k_folds = min(self.cv_folds, max(2, n // 150))
            fold_bounds = np.linspace(0, n, k_folds + 1, dtype=int)
            best_mse = float("inf")
            for cand_reg in self.reg_l2_grid:
                oof_sq_err: List[np.ndarray] = []
                oof_w: List[np.ndarray] = []
                for f_idx in range(k_folds):
                    val_start, val_end = int(fold_bounds[f_idx]), int(fold_bounds[f_idx + 1])
                    val_mask = np.zeros(n, dtype=bool)
                    val_mask[val_start:val_end] = True
                    tr_mask = ~val_mask
                    if np.sum(tr_mask) < 50 or np.sum(val_mask) < 20:
                        continue

                    X_sub_tr, X_sub_val = X_arr[tr_mask], X_arr[val_mask]
                    y_sub_tr, y_sub_val = y_arr[tr_mask], y_arr[val_mask]
                    w_sub_tr_norm, w_sub_tr_eff = _prepare_sample_weights(w_eff[tr_mask], len(X_sub_tr))

                    sub_mean_x = np.average(X_sub_tr, axis=0, weights=w_sub_tr_eff)
                    sub_std_x = np.sqrt(np.average((X_sub_tr - sub_mean_x) ** 2, axis=0, weights=w_sub_tr_eff))
                    sub_std_x[sub_std_x < 1e-9] = 1.0
                    sub_mean_y = float(np.average(y_sub_tr, weights=w_sub_tr_eff))
                    sub_std_y = float(np.sqrt(np.average((y_sub_tr - sub_mean_y) ** 2, weights=w_sub_tr_eff)))
                    if sub_std_y < 1e-9:
                        sub_std_y = 1.0

                    X_sub_tr_n = (X_sub_tr - sub_mean_x) / sub_std_x
                    X_sub_val_n = (X_sub_val - sub_mean_x) / sub_std_x
                    y_sub_tr_n = (y_sub_tr - sub_mean_y) / sub_std_y

                    params_c = self._fit_with_reg(
                        X_sub_tr_n,
                        y_sub_tr_n,
                        w_sub_tr_norm,
                        reg_l2_val=cand_reg,
                        max_iter=min(110, self.max_iter),
                    )
                    pred_val = self._eval_norm(params_c, X_sub_val_n) * sub_std_y + sub_mean_y
                    oof_sq_err.append((pred_val - y_sub_val) ** 2)
                    oof_w.append(w_eff[val_mask])

                if oof_sq_err:
                    w_all = np.concatenate(oof_w)
                    mse_val = float(np.average(np.concatenate(oof_sq_err), weights=w_all))
                    if mse_val < best_mse:
                        best_mse = mse_val
                        selected_reg = cand_reg

        self.reg_l2_selected_ = selected_reg
        self.mean_x = np.average(X_arr, axis=0, weights=w_eff)
        var_x = np.average((X_arr - self.mean_x) ** 2, axis=0, weights=w_eff)
        self.std_x = np.sqrt(var_x)
        self.std_x[self.std_x < 1e-9] = 1.0
        X_norm = (X_arr - self.mean_x) / self.std_x

        self.mean_y = float(np.average(y_arr, weights=w_eff))
        self.std_y = float(np.sqrt(np.average((y_arr - self.mean_y) ** 2, weights=w_eff)))
        if self.std_y < 1e-9:
            self.std_y = 1.0
        y_norm = (y_arr - self.mean_y) / self.std_y

        self.ensemble_params_ = [
            self._fit_with_reg(
                X_norm,
                y_norm,
                w_norm,
                reg_l2_val=selected_reg,
                max_iter=self.max_iter,
                seed_offset=idx,
            )
            for idx in range(self.n_ensemble)
        ]
        self.params_ = self.ensemble_params_[0]
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if (not self.ensemble_params_ and self.params_ is None) or self.mean_x is None or self.std_x is None:
            raise ValueError("ResidualMLPRegressor não treinado.")
        X_norm = (np.asarray(X, dtype=float) - self.mean_x) / self.std_x
        models = self.ensemble_params_ if self.ensemble_params_ else [self.params_]  # type: ignore[list-item]
        y_norm = np.mean([self._eval_norm(p, X_norm) for p in models], axis=0)
        return y_norm * self.std_y + self.mean_y


class ResidualMLPClassifier:
    """
    Classificador Neural com Conexão Residual Linear (ResMLP):
        logit(x) = b_out + X_norm @ w_skip + tanh(X_norm @ W1 + b1) @ w2
        P(y=1|x) = sigmoid(calib_a * mean_logit(x) + calib_b)
    Inicializa (w_skip, b_out) a partir da solução L2 da Regressão Logística,
    calcula warm-start Newton-Ridge amortecido em w2 para escapar do ponto de sela
    (W1=0, w2=0), seleciona regularização via validação cruzada temporal em blocos
    estritamente dentro da amostra de treino e aplica calibração logística out-of-fold.
    """

    def __init__(
        self,
        hidden_units: int = 16,
        reg_l2: float = 4e-3,
        reg_l2_skip: float = 1e-3,
        max_iter: int = 180,
        subsample_max: int = 35000,
        seed: int = 42,
        reg_l2_grid: Optional[Tuple[float, ...]] = None,
        cv_folds: int = 4,
        n_ensemble: int = 1,
    ):
        self.hidden_units = hidden_units
        self.reg_l2 = reg_l2
        self.reg_l2_skip = reg_l2_skip
        self.max_iter = max_iter
        self.subsample_max = subsample_max
        self.seed = seed
        self.reg_l2_grid: Tuple[float, ...] = (
            tuple(float(v) for v in reg_l2_grid)
            if reg_l2_grid is not None
            else (5e-4, 2e-3, 8e-3, 3e-2)
        )
        self.cv_folds = max(2, int(cv_folds))
        self.n_ensemble = max(1, int(n_ensemble))
        self.mean_x: Optional[np.ndarray] = None
        self.std_x: Optional[np.ndarray] = None
        self.reg_l2_selected_: Optional[float] = None
        self.calib_a_: float = 1.0
        self.calib_b_: float = 0.0
        self.params_: Optional[Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]] = None
        self.ensemble_params_: List[Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]] = []

    def _unpack(self, theta: np.ndarray, d: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]:
        h = self.hidden_units
        idx1 = d * h
        W1 = theta[:idx1].reshape(d, h)
        b1 = theta[idx1:idx1 + h]
        w2 = theta[idx1 + h:idx1 + 2 * h]
        w_skip = theta[idx1 + 2 * h:idx1 + 2 * h + d]
        b_out = float(theta[-1])
        return W1, b1, w2, w_skip, b_out

    @staticmethod
    def _eval_logits(
        params: Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float],
        X_norm: np.ndarray,
    ) -> np.ndarray:
        W1, b1, w2, w_skip, b_out = params
        return b_out + X_norm @ w_skip + np.tanh(X_norm @ W1 + b1) @ w2

    def _fit_with_reg(
        self,
        X_norm: np.ndarray,
        y_arr: np.ndarray,
        w_norm: np.ndarray,
        reg_l2_val: float,
        max_iter: int,
        seed_offset: int = 0,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]:
        rng = np.random.default_rng(self.seed + seed_offset)
        n, d = X_norm.shape
        h = self.hidden_units
        w1_reg = float(reg_l2_val)
        X_bias = np.hstack([np.ones((n, 1)), X_norm])

        # 1. Warm-start do ramo residual linear com a solução logística L2 ponderada
        def lin_loss_and_grad(w: np.ndarray) -> Tuple[float, np.ndarray]:
            z = X_bias @ w
            prob = expit(z)
            log_loss = float(np.sum(w_norm * (np.logaddexp(0.0, z) - y_arr * z)))
            l2_pen = 0.5 * self.reg_l2_skip * float(np.sum(w[1:] ** 2))
            grad = X_bias.T @ (w_norm * (prob - y_arr))
            grad[1:] += self.reg_l2_skip * w[1:]
            return log_loss + l2_pen, grad

        lin_res = minimize(
            lin_loss_and_grad,
            np.zeros(d + 1),
            method="L-BFGS-B",
            jac=True,
            options={"maxiter": 150},
        )
        b_out_0 = float(lin_res.x[0])
        w_skip_0 = lin_res.x[1:].copy()

        logits_lin = b_out_0 + X_norm @ w_skip_0
        prob_lin = expit(logits_lin)
        obj_lin_pure = (
            float(np.sum(w_norm * (np.logaddexp(0.0, logits_lin) - y_arr * logits_lin)))
            + 0.5 * self.reg_l2_skip * float(np.sum(w_skip_0 ** 2))
        )

        # 2. Quebra de simetria + passo Newton-Ridge amortecido sobre os resíduos logísticos
        W1_0 = rng.normal(0.0, 1.0 / np.sqrt(d), size=(d, h))
        b1_0 = rng.uniform(-0.6, 0.6, size=h)
        H_0 = np.tanh(X_norm @ W1_0 + b1_0)
        hess_0 = w_norm * np.maximum(1e-3, prob_lin * (1.0 - prob_lin))
        gram_h = H_0.T @ (H_0 * hess_0[:, None]) + max(5e-3, 2.0 * reg_l2_val) * np.eye(h)
        rhs_h = H_0.T @ (w_norm * (y_arr - prob_lin))
        w2_base = solve(gram_h, rhs_h, assume_a="pos")

        def eval_obj(theta: np.ndarray) -> float:
            W1, b1, w2, w_skip, b_out = self._unpack(theta, d)
            A1 = np.tanh(X_norm @ W1 + b1)
            logits = b_out + X_norm @ w_skip + A1 @ w2
            log_loss = float(np.sum(w_norm * (np.logaddexp(0.0, logits) - y_arr * logits)))
            pen = (
                0.5 * w1_reg * float(np.sum(W1 ** 2))
                + 0.5 * reg_l2_val * float(np.sum(w2 ** 2))
                + 0.5 * self.reg_l2_skip * float(np.sum(w_skip ** 2))
            )
            return log_loss + pen

        theta0 = None
        best_theta = None
        best_obj = float("inf")
        for damp in (0.6, 0.3, 0.15, 0.05):
            cand = np.concatenate([W1_0.ravel(), b1_0, damp * w2_base, w_skip_0, [b_out_0]])
            cand_obj = eval_obj(cand)
            if cand_obj < best_obj:
                best_obj = cand_obj
                best_theta = cand
            if cand_obj < obj_lin_pure:
                theta0 = cand
                break
        if theta0 is None:
            theta0 = best_theta if best_theta is not None else np.concatenate(
                [W1_0.ravel(), b1_0, 0.15 * w2_base, w_skip_0, [b_out_0]]
            )

        def obj_and_grad(theta: np.ndarray) -> Tuple[float, np.ndarray]:
            W1, b1, w2, w_skip, b_out = self._unpack(theta, d)
            Z1 = X_norm @ W1 + b1
            A1 = np.tanh(Z1)
            logits = b_out + X_norm @ w_skip + A1 @ w2
            prob = expit(logits)

            log_loss = float(np.sum(w_norm * (np.logaddexp(0.0, logits) - y_arr * logits)))
            pen = (
                0.5 * w1_reg * float(np.sum(W1 ** 2))
                + 0.5 * reg_l2_val * float(np.sum(w2 ** 2))
                + 0.5 * self.reg_l2_skip * float(np.sum(w_skip ** 2))
            )

            d_logit = w_norm * (prob - y_arr)
            grad_b_out = float(np.sum(d_logit))
            grad_w_skip = X_norm.T @ d_logit + self.reg_l2_skip * w_skip
            grad_w2 = A1.T @ d_logit + reg_l2_val * w2
            dA1 = np.outer(d_logit, w2) * (1.0 - A1 ** 2)
            grad_W1 = X_norm.T @ dA1 + w1_reg * W1
            grad_b1 = np.sum(dA1, axis=0)

            grad = np.concatenate([grad_W1.ravel(), grad_b1, grad_w2, grad_w_skip, [grad_b_out]])
            return log_loss + pen, grad

        res = minimize(
            obj_and_grad,
            theta0,
            method="L-BFGS-B",
            jac=True,
            options={"maxiter": max_iter},
        )
        return self._unpack(res.x, d)

    def fit(self, X: np.ndarray, y: np.ndarray, sample_weight: Optional[np.ndarray] = None) -> "ResidualMLPClassifier":
        rng = np.random.default_rng(self.seed)
        X_arr = np.asarray(X, dtype=float)
        y_arr = (np.asarray(y) > 0.5).astype(float)
        w_in = np.ones(len(X_arr), dtype=float) if sample_weight is None else np.asarray(sample_weight, dtype=float)

        if len(X_arr) > self.subsample_max:
            recent = int(self.subsample_max * 0.65)
            older_idx = rng.choice(len(X_arr) - recent, size=self.subsample_max - recent, replace=False)
            sel = np.concatenate([np.sort(older_idx), np.arange(len(X_arr) - recent, len(X_arr))])
            X_arr = X_arr[sel]
            y_arr = y_arr[sel]
            w_in = w_in[sel]

        selected_reg = float(self.reg_l2)
        self.calib_a_ = 1.0
        self.calib_b_ = 0.0
        n = len(X_arr)
        w_norm, w_eff = _prepare_sample_weights(w_in, n)

        # Validação cruzada em blocos temporais contíguos dentro do treino (< 2025, zero vazamento de 2025)
        best_oof: Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]] = None
        if n >= 500:
            k_folds = min(self.cv_folds, max(2, n // 150))
            fold_bounds = np.linspace(0, n, k_folds + 1, dtype=int)
            best_score = (-1.0, float("-inf"), float("-inf"))

            for cand_reg in self.reg_l2_grid:
                oof_logits_parts: List[np.ndarray] = []
                oof_y_parts: List[np.ndarray] = []
                oof_w_parts: List[np.ndarray] = []

                for f_idx in range(k_folds):
                    val_start, val_end = int(fold_bounds[f_idx]), int(fold_bounds[f_idx + 1])
                    val_mask = np.zeros(n, dtype=bool)
                    val_mask[val_start:val_end] = True
                    tr_mask = ~val_mask

                    y_sub_tr, y_sub_val = y_arr[tr_mask], y_arr[val_mask]
                    if (
                        np.sum(y_sub_tr == 1) < 15
                        or np.sum(y_sub_tr == 0) < 15
                        or np.sum(y_sub_val == 1) < 15
                        or np.sum(y_sub_val == 0) < 15
                    ):
                        continue

                    X_sub_tr, X_sub_val = X_arr[tr_mask], X_arr[val_mask]
                    w_sub_tr_norm, w_sub_tr_eff = _prepare_sample_weights(w_eff[tr_mask], len(X_sub_tr))
                    sub_mean = np.average(X_sub_tr, axis=0, weights=w_sub_tr_eff)
                    sub_var = np.average((X_sub_tr - sub_mean) ** 2, axis=0, weights=w_sub_tr_eff)
                    sub_std = np.sqrt(sub_var)
                    sub_std[sub_std < 1e-9] = 1.0
                    X_sub_tr_n = (X_sub_tr - sub_mean) / sub_std
                    X_sub_val_n = (X_sub_val - sub_mean) / sub_std

                    params_c = self._fit_with_reg(
                        X_sub_tr_n,
                        y_sub_tr,
                        w_sub_tr_norm,
                        reg_l2_val=cand_reg,
                        max_iter=min(110, self.max_iter),
                    )
                    oof_logits_parts.append(self._eval_logits(params_c, X_sub_val_n))
                    oof_y_parts.append(y_sub_val)
                    oof_w_parts.append(w_eff[val_mask])

                if oof_logits_parts:
                    oof_logits = np.concatenate(oof_logits_parts)
                    oof_y = np.concatenate(oof_y_parts)
                    oof_w_norm, _ = _prepare_sample_weights(np.concatenate(oof_w_parts), len(oof_y))
                    oof_prob = expit(oof_logits)
                    auc_val = compute_roc_auc_fast(oof_y, oof_prob)
                    bce_val = float(np.sum(oof_w_norm * (np.logaddexp(0.0, oof_logits) - oof_y * oof_logits)))
                    brier_val = float(np.sum(oof_w_norm * ((oof_prob - oof_y) ** 2)))
                    score = (round(auc_val, 5), -bce_val, -brier_val)
                    if score > best_score:
                        best_score = score
                        selected_reg = cand_reg
                        best_oof = (oof_logits, oof_y, oof_w_norm)

        # Calibração logística monotônica (Platt scaling) nos logits out-of-fold (< 2025)
        if best_oof is not None:
            oof_logits, oof_y, oof_w_norm = best_oof

            def platt_obj(ab: np.ndarray) -> Tuple[float, np.ndarray]:
                a_val, b_val = float(ab[0]), float(ab[1])
                z_cal = a_val * oof_logits + b_val
                p_cal = expit(z_cal)
                loss = float(np.sum(oof_w_norm * (np.logaddexp(0.0, z_cal) - oof_y * z_cal)))
                loss += 1e-3 * ((a_val - 1.0) ** 2) + 1e-4 * (b_val ** 2)
                diff = oof_w_norm * (p_cal - oof_y)
                g_a = float(np.sum(diff * oof_logits)) + 2e-3 * (a_val - 1.0)
                g_b = float(np.sum(diff)) + 2e-4 * b_val
                return loss, np.array([g_a, g_b])

            cal_res = minimize(
                platt_obj,
                np.array([1.0, 0.0]),
                method="L-BFGS-B",
                jac=True,
                bounds=[(0.4, 2.5), (-1.5, 1.5)],
                options={"maxiter": 60},
            )
            self.calib_a_ = float(cal_res.x[0])
            self.calib_b_ = float(cal_res.x[1])

        self.reg_l2_selected_ = selected_reg
        self.mean_x = np.average(X_arr, axis=0, weights=w_eff)
        var_x = np.average((X_arr - self.mean_x) ** 2, axis=0, weights=w_eff)
        self.std_x = np.sqrt(var_x)
        self.std_x[self.std_x < 1e-9] = 1.0
        X_norm = (X_arr - self.mean_x) / self.std_x

        self.ensemble_params_ = [
            self._fit_with_reg(
                X_norm,
                y_arr,
                w_norm,
                reg_l2_val=selected_reg,
                max_iter=self.max_iter,
                seed_offset=idx,
            )
            for idx in range(self.n_ensemble)
        ]
        self.params_ = self.ensemble_params_[0]
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        if (not self.ensemble_params_ and self.params_ is None) or self.mean_x is None or self.std_x is None:
            raise ValueError("ResidualMLPClassifier não treinado.")
        X_norm = (np.asarray(X, dtype=float) - self.mean_x) / self.std_x
        models = self.ensemble_params_ if self.ensemble_params_ else [self.params_]  # type: ignore[list-item]
        logits = np.mean([self._eval_logits(p, X_norm) for p in models], axis=0)
        return expit(self.calib_a_ * logits + self.calib_b_)


# ============================================================================
# 4. CHALLENGER NÃO-LINEAR 2: HISTOGRAM GRADIENT BOOSTED TREES (NUMPY PURO)
# ============================================================================

class _BinnedDecisionTree:
    """Árvore de regressão binária rápida sobre matriz de inteiros discretizados (0..n_bins-1)."""

    def __init__(self, max_depth: int = 4, min_samples_leaf: int = 40, l2_leaf_reg: float = 5.0):
        self.max_depth = max_depth
        self.min_samples_leaf = min_samples_leaf
        self.l2_leaf_reg = l2_leaf_reg
        self.tree_: dict = {}

    def _build(
        self,
        X_bin: np.ndarray,
        grad: np.ndarray,
        hess: np.ndarray,
        indices: np.ndarray,
        depth: int,
        n_bins: int,
    ) -> dict:
        g_node = grad[indices]
        h_node = hess[indices]
        sum_g = float(np.sum(g_node))
        sum_h = float(np.sum(h_node))
        leaf_val = -sum_g / (sum_h + self.l2_leaf_reg)

        if depth >= self.max_depth or len(indices) < 2 * self.min_samples_leaf:
            return {"leaf": True, "val": leaf_val}

        parent_score = (sum_g ** 2) / (sum_h + self.l2_leaf_reg)
        best_gain = 1e-7
        best_feat = -1
        best_bin = -1

        X_sub = X_bin[indices]
        n_features = X_sub.shape[1]

        for f in range(n_features):
            col = X_sub[:, f]
            g_hist = np.bincount(col, weights=g_node, minlength=n_bins)
            h_hist = np.bincount(col, weights=h_node, minlength=n_bins)
            cnt_hist = np.bincount(col, minlength=n_bins)

            g_left = np.cumsum(g_hist)[:-1]
            h_left = np.cumsum(h_hist)[:-1]
            c_left = np.cumsum(cnt_hist)[:-1]
            c_right = len(indices) - c_left

            valid = (c_left >= self.min_samples_leaf) & (c_right >= self.min_samples_leaf)
            if not np.any(valid):
                continue

            g_right = sum_g - g_left
            h_right = sum_h - h_left

            gains = np.where(
                valid,
                (g_left ** 2) / (h_left + self.l2_leaf_reg)
                + (g_right ** 2) / (h_right + self.l2_leaf_reg)
                - parent_score,
                -1.0,
            )
            max_b = int(np.argmax(gains))
            if gains[max_b] > best_gain:
                best_gain = float(gains[max_b])
                best_feat = f
                best_bin = max_b

        if best_feat == -1:
            return {"leaf": True, "val": leaf_val}

        mask_left = X_sub[:, best_feat] <= best_bin
        left_idx = indices[mask_left]
        right_idx = indices[~mask_left]

        return {
            "leaf": False,
            "feat": best_feat,
            "bin": best_bin,
            "left": self._build(X_bin, grad, hess, left_idx, depth + 1, n_bins),
            "right": self._build(X_bin, grad, hess, right_idx, depth + 1, n_bins),
        }

    def fit(self, X_bin: np.ndarray, grad: np.ndarray, hess: np.ndarray, n_bins: int) -> "_BinnedDecisionTree":
        indices = np.arange(X_bin.shape[0], dtype=np.int32)
        self.tree_ = self._build(X_bin, grad, hess, indices, 0, n_bins)
        return self

    def _predict_node(self, node: dict, X_bin: np.ndarray, indices: np.ndarray, out: np.ndarray) -> None:
        if node["leaf"]:
            out[indices] = node["val"]
            return
        mask_left = X_bin[indices, node["feat"]] <= node["bin"]
        if np.any(mask_left):
            self._predict_node(node["left"], X_bin, indices[mask_left], out)
        if np.any(~mask_left):
            self._predict_node(node["right"], X_bin, indices[~mask_left], out)

    def predict_binned(self, X_bin: np.ndarray) -> np.ndarray:
        out = np.empty(X_bin.shape[0], dtype=float)
        self._predict_node(self.tree_, X_bin, np.arange(X_bin.shape[0], dtype=np.int32), out)
        return out


class HistogramGBDTRegressor:
    """
    Gradient Boosted Decision Trees com Histogramas de Quantis implementado 100% em NumPy.
    Equivalente algorítmico direto ao LightGBM/HistGradientBoosting sem dependências externas.
    """

    def __init__(
        self,
        n_estimators: int = 65,
        learning_rate: float = 0.08,
        max_depth: int = 4,
        n_bins: int = 32,
        min_samples_leaf: int = 50,
        l2_leaf_reg: float = 5.0,
        subsample_max: int = 30000,
        seed: int = 42,
    ):
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.max_depth = max_depth
        self.n_bins = n_bins
        self.min_samples_leaf = min_samples_leaf
        self.l2_leaf_reg = l2_leaf_reg
        self.subsample_max = subsample_max
        self.seed = seed
        self.bin_edges_: List[np.ndarray] = []
        self.trees_: List[_BinnedDecisionTree] = []
        self.base_value_: float = 0.0

    def _fit_bins(self, X: np.ndarray) -> np.ndarray:
        self.bin_edges_ = []
        n_samples, n_features = X.shape
        X_bin = np.empty((n_samples, n_features), dtype=np.int32)
        quantiles = np.linspace(0.0, 100.0, self.n_bins + 1)[1:-1]
        for f in range(n_features):
            edges = np.unique(np.percentile(X[:, f], quantiles))
            self.bin_edges_.append(edges)
            X_bin[:, f] = np.searchsorted(edges, X[:, f], side="right")
        return X_bin

    def _transform_bins(self, X: np.ndarray) -> np.ndarray:
        n_samples, n_features = X.shape
        X_bin = np.empty((n_samples, n_features), dtype=np.int32)
        for f in range(n_features):
            X_bin[:, f] = np.searchsorted(self.bin_edges_[f], X[:, f], side="right")
        return X_bin

    def fit(self, X: np.ndarray, y: np.ndarray, sample_weight: Optional[np.ndarray] = None) -> "HistogramGBDTRegressor":
        X_arr = np.asarray(X, dtype=float)
        y_arr = np.asarray(y, dtype=float)
        w_in = np.ones(len(X_arr), dtype=float) if sample_weight is None else np.asarray(sample_weight, dtype=float)

        if len(X_arr) > self.subsample_max:
            rng = np.random.default_rng(self.seed)
            recent = int(self.subsample_max * 0.65)
            older_idx = rng.choice(len(X_arr) - recent, size=self.subsample_max - recent, replace=False)
            sel = np.concatenate([np.sort(older_idx), np.arange(len(X_arr) - recent, len(X_arr))])
            X_arr = X_arr[sel]
            y_arr = y_arr[sel]
            w_in = w_in[sel]

        _, w_eff = _prepare_sample_weights(w_in, len(X_arr))
        X_bin = self._fit_bins(X_arr)

        self.base_value_ = float(np.average(y_arr, weights=w_eff))
        pred = np.full(len(y_arr), self.base_value_, dtype=float)
        hess = w_eff.copy()
        self.trees_ = []

        for _ in range(self.n_estimators):
            grad = w_eff * (pred - y_arr)
            tree = _BinnedDecisionTree(
                max_depth=self.max_depth,
                min_samples_leaf=self.min_samples_leaf,
                l2_leaf_reg=self.l2_leaf_reg,
            ).fit(X_bin, grad, hess, self.n_bins)
            pred += self.learning_rate * tree.predict_binned(X_bin)
            self.trees_.append(tree)

        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        X_bin = self._transform_bins(np.asarray(X, dtype=float))
        pred = np.full(X_bin.shape[0], self.base_value_, dtype=float)
        for tree in self.trees_:
            pred += self.learning_rate * tree.predict_binned(X_bin)
        return pred


class HistogramGBDTClassifier:
    """
    Gradient Boosted Decision Trees para Classificação Binária (Log-Loss Newton Boosting)
    implementado 100% em NumPy/SciPy puro para o Modelo C (Probabilidade de Curtailment).
    """

    def __init__(
        self,
        n_estimators: int = 65,
        learning_rate: float = 0.08,
        max_depth: int = 4,
        n_bins: int = 32,
        min_samples_leaf: int = 40,
        l2_leaf_reg: float = 5.0,
        subsample_max: int = 30000,
        seed: int = 42,
    ):
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.max_depth = max_depth
        self.n_bins = n_bins
        self.min_samples_leaf = min_samples_leaf
        self.l2_leaf_reg = l2_leaf_reg
        self.subsample_max = subsample_max
        self.seed = seed
        self.bin_edges_: List[np.ndarray] = []
        self.trees_: List[_BinnedDecisionTree] = []
        self.base_logit_: float = 0.0

    def _fit_bins(self, X: np.ndarray) -> np.ndarray:
        self.bin_edges_ = []
        n_samples, n_features = X.shape
        X_bin = np.empty((n_samples, n_features), dtype=np.int32)
        quantiles = np.linspace(0.0, 100.0, self.n_bins + 1)[1:-1]
        for f in range(n_features):
            edges = np.unique(np.percentile(X[:, f], quantiles))
            self.bin_edges_.append(edges)
            X_bin[:, f] = np.searchsorted(edges, X[:, f], side="right")
        return X_bin

    def _transform_bins(self, X: np.ndarray) -> np.ndarray:
        n_samples, n_features = X.shape
        X_bin = np.empty((n_samples, n_features), dtype=np.int32)
        for f in range(n_features):
            X_bin[:, f] = np.searchsorted(self.bin_edges_[f], X[:, f], side="right")
        return X_bin

    def fit(self, X: np.ndarray, y: np.ndarray, sample_weight: Optional[np.ndarray] = None) -> "HistogramGBDTClassifier":
        X_arr = np.asarray(X, dtype=float)
        y_arr = (np.asarray(y) > 0.5).astype(float)
        w_in = np.ones(len(X_arr), dtype=float) if sample_weight is None else np.asarray(sample_weight, dtype=float)

        if len(X_arr) > self.subsample_max:
            rng = np.random.default_rng(self.seed)
            recent = int(self.subsample_max * 0.65)
            older_idx = rng.choice(len(X_arr) - recent, size=self.subsample_max - recent, replace=False)
            sel = np.concatenate([np.sort(older_idx), np.arange(len(X_arr) - recent, len(X_arr))])
            X_arr = X_arr[sel]
            y_arr = y_arr[sel]
            w_in = w_in[sel]

        _, w_eff = _prepare_sample_weights(w_in, len(X_arr))
        X_bin = self._fit_bins(X_arr)

        pos_rate = float(np.clip(np.average(y_arr, weights=w_eff), 1e-4, 1.0 - 1e-4))
        self.base_logit_ = float(np.log(pos_rate / (1.0 - pos_rate)))
        raw_logits = np.full(len(y_arr), self.base_logit_, dtype=float)
        self.trees_ = []

        for _ in range(self.n_estimators):
            prob = expit(raw_logits)
            grad = w_eff * (prob - y_arr)
            hess = w_eff * np.maximum(1e-4, prob * (1.0 - prob))
            tree = _BinnedDecisionTree(
                max_depth=self.max_depth,
                min_samples_leaf=self.min_samples_leaf,
                l2_leaf_reg=self.l2_leaf_reg,
            ).fit(X_bin, grad, hess, self.n_bins)
            raw_logits += self.learning_rate * tree.predict_binned(X_bin)
            self.trees_.append(tree)

        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        X_bin = self._transform_bins(np.asarray(X, dtype=float))
        raw_logits = np.full(X_bin.shape[0], self.base_logit_, dtype=float)
        for tree in self.trees_:
            raw_logits += self.learning_rate * tree.predict_binned(X_bin)
        return expit(raw_logits)
