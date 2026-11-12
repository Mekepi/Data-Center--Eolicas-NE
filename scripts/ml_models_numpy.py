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

    def fit(self, X: np.ndarray, y: np.ndarray) -> "LinearRidgeModel":
        X_arr = np.asarray(X, dtype=float)
        y_arr = np.asarray(y, dtype=float)
        n_samples, n_features = X_arr.shape

        self.mean_x = np.mean(X_arr, axis=0)
        self.std_x = np.std(X_arr, axis=0)
        self.std_x[self.std_x < 1e-9] = 1.0

        X_norm = (X_arr - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((n_samples, 1)), X_norm])

        reg = self.alpha * np.eye(n_features + 1)
        reg[0, 0] = 0.0
        self.weights = solve(X_bias.T @ X_bias + reg, X_bias.T @ y_arr, assume_a="pos")
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

    def fit(self, X: np.ndarray, y: np.ndarray) -> "LogisticLBFGSModel":
        X_arr = np.asarray(X, dtype=float)
        y_arr = np.asarray(y, dtype=float)
        n_samples, n_features = X_arr.shape

        self.mean_x = np.mean(X_arr, axis=0)
        self.std_x = np.std(X_arr, axis=0)
        self.std_x[self.std_x < 1e-9] = 1.0

        X_norm = (X_arr - self.mean_x) / self.std_x
        X_bias = np.hstack([np.ones((n_samples, 1)), X_norm])

        def loss_and_grad(w: np.ndarray) -> Tuple[float, np.ndarray]:
            z = X_bias @ w
            prob = expit(z)
            # Log-loss numericamente estável: log(1 + exp(z)) - y*z
            log_loss = np.mean(np.logaddexp(0.0, z) - y_arr * z)
            l2_pen = 0.5 * self.reg_l2 * float(np.sum(w[1:] ** 2))
            grad = (X_bias.T @ (prob - y_arr)) / n_samples
            grad[1:] += self.reg_l2 * w[1:]
            return float(log_loss + l2_pen), grad

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
        y_hat = b_out + X_norm @ w_skip + tanh(X_norm @ W1 + b1) @ w2
    Treinada via backpropagation analítico vetorizado + quasi-Newton L-BFGS-B (SciPy).
    Combina estabilidade de extrapolação linear com captura de não-linearidades suaves.
    """

    def __init__(
        self,
        hidden_units: int = 20,
        reg_l2: float = 1e-3,
        max_iter: int = 120,
        subsample_max: int = 35000,
        seed: int = 42,
    ):
        self.hidden_units = hidden_units
        self.reg_l2 = reg_l2
        self.max_iter = max_iter
        self.subsample_max = subsample_max
        self.seed = seed
        self.mean_x: Optional[np.ndarray] = None
        self.std_x: Optional[np.ndarray] = None
        self.mean_y: float = 0.0
        self.std_y: float = 1.0
        self.params_: Optional[Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]] = None

    def _unpack(self, theta: np.ndarray, d: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]:
        h = self.hidden_units
        idx1 = d * h
        W1 = theta[:idx1].reshape(d, h)
        b1 = theta[idx1:idx1 + h]
        w2 = theta[idx1 + h:idx1 + 2 * h]
        w_skip = theta[idx1 + 2 * h:idx1 + 2 * h + d]
        b_out = float(theta[-1])
        return W1, b1, w2, w_skip, b_out

    def fit(self, X: np.ndarray, y: np.ndarray) -> "ResidualMLPRegressor":
        rng = np.random.default_rng(self.seed)
        X_arr = np.asarray(X, dtype=float)
        y_arr = np.asarray(y, dtype=float)

        if len(X_arr) > self.subsample_max:
            # Usa os registros mais recentes + amostra estratificada histórica para rapidez no L-BFGS
            recent = int(self.subsample_max * 0.6)
            older_idx = rng.choice(len(X_arr) - recent, size=self.subsample_max - recent, replace=False)
            sel = np.concatenate([np.sort(older_idx), np.arange(len(X_arr) - recent, len(X_arr))])
            X_arr = X_arr[sel]
            y_arr = y_arr[sel]

        n, d = X_arr.shape
        h = self.hidden_units

        self.mean_x = np.mean(X_arr, axis=0)
        self.std_x = np.std(X_arr, axis=0)
        self.std_x[self.std_x < 1e-9] = 1.0
        X_norm = (X_arr - self.mean_x) / self.std_x

        self.mean_y = float(np.mean(y_arr))
        self.std_y = float(np.std(y_arr))
        if self.std_y < 1e-9:
            self.std_y = 1.0
        y_norm = (y_arr - self.mean_y) / self.std_y

        # Inicializar w_skip com solução Ridge rápida para partir de ótimo local excelente
        ridge_init = solve(X_norm.T @ X_norm + 5.0 * np.eye(d), X_norm.T @ y_norm, assume_a="pos")
        W1_0 = rng.normal(0.0, 1.0 / np.sqrt(d), size=(d, h))
        b1_0 = np.zeros(h)
        w2_0 = rng.normal(0.0, 0.05, size=h)
        theta0 = np.concatenate([W1_0.ravel(), b1_0, w2_0, ridge_init, [0.0]])

        def obj_and_grad(theta: np.ndarray) -> Tuple[float, np.ndarray]:
            W1, b1, w2, w_skip, b_out = self._unpack(theta, d)
            Z1 = X_norm @ W1 + b1
            A1 = np.tanh(Z1)
            pred = b_out + X_norm @ w_skip + A1 @ w2
            diff = pred - y_norm

            mse = 0.5 * float(np.mean(diff ** 2))
            pen = 0.5 * self.reg_l2 * float(np.sum(W1 ** 2) + np.sum(w2 ** 2) + 0.2 * np.sum(w_skip ** 2))

            d_pred = diff / n
            grad_b_out = float(np.sum(d_pred))
            grad_w_skip = X_norm.T @ d_pred + 0.2 * self.reg_l2 * w_skip
            grad_w2 = A1.T @ d_pred + self.reg_l2 * w2
            dA1 = np.outer(d_pred, w2) * (1.0 - A1 ** 2)
            grad_W1 = X_norm.T @ dA1 + self.reg_l2 * W1
            grad_b1 = np.sum(dA1, axis=0)

            grad = np.concatenate([grad_W1.ravel(), grad_b1, grad_w2, grad_w_skip, [grad_b_out]])
            return mse + pen, grad

        res = minimize(
            obj_and_grad,
            theta0,
            method="L-BFGS-B",
            jac=True,
            options={"maxiter": self.max_iter},
        )
        self.params_ = self._unpack(res.x, d)
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self.params_ is None or self.mean_x is None or self.std_x is None:
            raise ValueError("ResidualMLPRegressor não treinado.")
        W1, b1, w2, w_skip, b_out = self.params_
        X_norm = (np.asarray(X, dtype=float) - self.mean_x) / self.std_x
        y_norm = b_out + X_norm @ w_skip + np.tanh(X_norm @ W1 + b1) @ w2
        return y_norm * self.std_y + self.mean_y


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

    def fit(self, X: np.ndarray, y: np.ndarray) -> "HistogramGBDTRegressor":
        X_arr = np.asarray(X, dtype=float)
        y_arr = np.asarray(y, dtype=float)

        if len(X_arr) > self.subsample_max:
            rng = np.random.default_rng(self.seed)
            recent = int(self.subsample_max * 0.65)
            older_idx = rng.choice(len(X_arr) - recent, size=self.subsample_max - recent, replace=False)
            sel = np.concatenate([np.sort(older_idx), np.arange(len(X_arr) - recent, len(X_arr))])
            X_arr = X_arr[sel]
            y_arr = y_arr[sel]

        X_bin = self._fit_bins(X_arr)

        self.base_value_ = float(np.mean(y_arr))
        pred = np.full(len(y_arr), self.base_value_, dtype=float)
        hess = np.ones(len(y_arr), dtype=float)
        self.trees_ = []

        for _ in range(self.n_estimators):
            grad = pred - y_arr
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

    def fit(self, X: np.ndarray, y: np.ndarray) -> "HistogramGBDTClassifier":
        X_arr = np.asarray(X, dtype=float)
        y_arr = (np.asarray(y) > 0.5).astype(float)

        if len(X_arr) > self.subsample_max:
            rng = np.random.default_rng(self.seed)
            recent = int(self.subsample_max * 0.65)
            older_idx = rng.choice(len(X_arr) - recent, size=self.subsample_max - recent, replace=False)
            sel = np.concatenate([np.sort(older_idx), np.arange(len(X_arr) - recent, len(X_arr))])
            X_arr = X_arr[sel]
            y_arr = y_arr[sel]

        X_bin = self._fit_bins(X_arr)

        pos_rate = float(np.clip(np.mean(y_arr), 1e-4, 1.0 - 1e-4))
        self.base_logit_ = float(np.log(pos_rate / (1.0 - pos_rate)))
        raw_logits = np.full(len(y_arr), self.base_logit_, dtype=float)
        self.trees_ = []

        for _ in range(self.n_estimators):
            prob = expit(raw_logits)
            grad = prob - y_arr
            hess = np.maximum(1e-4, prob * (1.0 - prob))
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
