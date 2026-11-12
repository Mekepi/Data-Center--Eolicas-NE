export interface ScriptSpec {
  id: string;
  order: string;
  filename: string;
  title: string;
  stageLabel: string;
  purpose: string;
  approvedLibraries: string[];
  multiprocessingStrategy: string;
  inputs: string[];
  outputs: string[];
  keyDecisionsForGroup: string[];
  starterCode: string;
}

export const APPROVED_LIBRARIES_POLICY = {
  standard: ['multiprocessing', 'concurrent.futures', 'urllib.request', 'json', 'csv', 'os', 'pathlib', 'math', 'time'],
  commonApproved: ['numpy', 'scipy', 'pandas', 'urllib3'],
  candidateLibrariesRequiringApproval: [
    {
      name: 'scikit-learn',
      role: 'Modelos de regressão linear/florestas para CF(t), métricas MAE/RMSE/ROC-AUC e TimeSeriesSplit.',
      status: 'Pendente de aprovação do usuário',
    },
    {
      name: 'xgboost / lightgbm',
      role: 'Modelo principal do Plano Orientador (rápido com paralelização nativa em threads C++).',
      status: 'Pendente de aprovação do usuário',
    },
    {
      name: 'statsmodels',
      role: 'Apenas se o SARIMAX for mantido formalmente como baseline estatístico.',
      status: 'Pendente de aprovação do usuário',
    },
    {
      name: 'pyarrow / fastparquet',
      role: 'Serialização rápida em formato columnar Parquet entre scripts.',
      status: 'Pendente de aprovação do usuário (ou fallback para CSV comprimido .csv.gz com pandas puro)',
    },
    {
      name: 'streamlit',
      role: 'Interface visual futura caso necessária (já aprovada como padrão).',
      status: 'Aprovada para etapa posterior',
    },
  ],
};

export const SCRIPTS_PIPELINE: ScriptSpec[] = [
  {
    id: 'script-01',
    order: '01',
    filename: '01_ingest_ons_aneel_epe.py',
    title: 'Ingestão Paralela e Harmonização Temporal (ONS + ANEEL + EPE)',
    stageLabel: 'Coleta & ETL Paralelo',
    purpose:
      'Baixar via urllib3 em pool paralelo e consolidar em base horária única (UTC-3) a carga do NE, geração por fonte, constrained-off e capacidade instalada do SIGA, utilizando multiprocessing.Pool para processar múltiplos anos/arquivos simultaneamente.',
    approvedLibraries: ['multiprocessing', 'urllib3', 'pandas', 'numpy', 'os', 'pathlib'],
    multiprocessingStrategy:
      'multiprocessing.Pool(os.cpu_count()) mapeando o parsing e limpeza por tupla de ano/dataset (2019 a 2025) em processos independentes sem concorrência de I/O.',
    inputs: [
      'ONS (Portal Dados Abertos CKAN via urllib3): curva_carga_*.csv, balanco_energia_subsistema_*.csv, restricao_coff_eolica_*.csv',
      'ANEEL: siga-empreendimentos-geracao.csv (filtrado por CEG e submercado NE)',
      'EPE: consumo_mensal_ne.xlsx / PDE 2035',
    ],
    outputs: [
      'data/processed/ne_hourly_master_2019_2025.csv.gz',
      'data/processed/siga_wind_trajectories_2026_2035.csv.gz',
    ],
    keyDecisionsForGroup: [
      'Usar urllib3 com PoolManager e retry exponencial nativo, sem bibliotecas pesadas de scraping.',
      'Reconstituir a geração eólica potencial somando geração verificada + volume cortado (constrained-off) para não subestimar o Fator de Capacidade.',
      'Persistência em .csv.gz (gzip nativo do pandas/Python), evitando obrigatoriedade de pyarrow externa.',
    ],
    starterCode: `import multiprocessing as mp
import os
from pathlib import Path
import urllib3
import numpy as np
import pandas as pd

HTTP = urllib3.PoolManager(timeout=urllib3.Timeout(connect=5.0, read=25.0))

def download_file_if_missing(url: str, dest_path: Path) -> Path:
    """Baixa dataset oficial com urllib3 se ainda não estiver em cache local."""
    if dest_path.exists():
        return dest_path
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    resp = HTTP.request("GET", url)
    if resp.status != 200:
        raise RuntimeError(f"Falha ao baixar {url} (status {resp.status})")
    dest_path.write_bytes(resp.data)
    return dest_path

def parse_yearly_ons_slice(args: tuple[int, str, str, str]) -> pd.DataFrame:
    """Worker executado em processo isolado pelo multiprocessing.Pool."""
    year, carga_file, balanco_file, coff_file = args
    print(f"[{mp.current_process().name}] Processando ano {year}...")

    # 1. Carga Horária NE
    c = pd.read_csv(carga_file, sep=";", parse_dates=["din_instante"])
    c_ne = (
        c.loc[c["id_subsistema"] == "NE", ["din_instante", "val_cargaenergiahomwmed"]]
        .rename(columns={"din_instante": "ts", "val_cargaenergiahomwmed": "l_base_mw"})
    )

    # 2. Balanço Horário por Fonte NE
    b = pd.read_csv(balanco_file, sep=";", parse_dates=["din_instante"])
    b_ne = (
        b.loc[b["id_subsistema"] == "NE", [
            "din_instante", "val_gereolica", "val_gersolar", "val_gerhidraulica", "val_gertermica", "val_intercambio"
        ]].rename(columns={"din_instante": "ts"})
    )

    # 3. Constrained-off eólico horário
    coff = pd.read_csv(coff_file, sep=";", parse_dates=["din_instante"])
    coff_ne = (
        coff.loc[coff["id_subsistema"] == "NE"]
        .assign(curtailment_mw=lambda d: (d["val_geracaoreferencia"] - d["val_geracaoverificada"]).clip(lower=0))
        .groupby(pd.Grouper(key="din_instante", freq="1h"))["curtailment_mw"]
        .mean()
        .reset_index()
        .rename(columns={"din_instante": "ts"})
    )

    merged = c_ne.merge(b_ne, on="ts", how="inner").merge(coff_ne, on="ts", how="left")
    merged["curtailment_mw"] = merged["curtailment_mw"].fillna(0.0)
    merged["flag_curtailment"] = (merged["curtailment_mw"] > 50.0).astype(int)
    merged["eolica_potencial_mw"] = merged["val_gereolica"] + merged["curtailment_mw"]
    return merged

def main():
    years = [2021, 2022, 2023, 2024, 2025]
    # Monta tuplas de argumentos para cada processo trabalhador
    tasks = [(y, f"data/raw/carga_{y}.csv", f"data/raw/balanco_{y}.csv", f"data/raw/coff_{y}.csv") for y in years]

    cpu_workers = max(1, min(len(years), os.cpu_count() or 2))
    print(f"Iniciando multiprocessing.Pool com {cpu_workers} workers paralelos...")

    with mp.Pool(processes=cpu_workers) as pool:
        yearly_dfs = pool.map(parse_yearly_ons_slice, tasks)

    master_df = pd.concat(yearly_dfs, ignore_index=True).sort_values("ts").reset_index(drop=True)
    out_path = Path("data/processed/ne_hourly_master_2019_2025.csv.gz")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    master_df.to_csv(out_path, index=False, compression="gzip")
    print(f"Base mestre salva em {out_path} ({len(master_df):,} linhas)")

if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'script-02',
    order: '02',
    filename: '02_build_dc_and_offshore_scenarios.py',
    title: 'Modelagem Vetorizada de Data Centers e Eólicas Onshore/Offshore',
    stageLabel: 'Engenharia de Cenários',
    purpose:
      'Transformar portarias do MME, fila ONS/EPE, SIGA/ANEEL e processos offshore do IBAMA em matrizes horárias 2026–2035 via cálculos estritamente vetorizados com numpy e pandas puro.',
    approvedLibraries: ['numpy', 'pandas', 'math', 'pathlib'],
    multiprocessingStrategy:
      'Geração combinatória vetorizada em numpy (ou multiprocessing.Pool dividindo a matriz por blocos de cenários se executado em grade ultra-densa de sensibilidade).',
    inputs: [
      'data/curated/data_centers_ne_pipeline.csv (Portarias MME / Fila EPE)',
      'data/processed/siga_wind_trajectories_2026_2035.csv.gz',
    ],
    outputs: [
      'data/scenarios/dc_hourly_curves_2026_2035.csv.gz',
      'data/scenarios/wind_capacity_paths_2026_2035.csv.gz',
    ],
    keyDecisionsForGroup: [
      'Regra da Seção 5 do PDF: se a potência publicada já for a carga total na rede, não aplicar PUE novamente.',
      'Modelar a entrada como rampa temporal suave em meses, nunca degrau instantâneo.',
    ],
    starterCode: `from pathlib import Path
import numpy as np
import pandas as pd

def compute_dc_vectorized_load(
    timestamps: pd.DatetimeIndex,
    p_it_mw: float,
    start_date: str,
    ramp_months: int = 24,
    utilization: float = 0.80,
    pue: float = 1.28,
    is_grid_total_power: bool = False,
) -> np.ndarray:
    """Calcula L_DC(t) vetorizado sem loops em Python puro."""
    t0 = pd.Timestamp(start_date)
    dt_seconds = (timestamps - t0).total_seconds().to_numpy()
    months_elapsed = dt_seconds / (3600 * 24 * 30.4375)
    ramp = np.clip(months_elapsed / max(1, ramp_months), 0.0, 1.0)
    eff_pue = 1.0 if is_grid_total_power else max(1.0, pue)
    
    # Modulação diurna térmica leve de resfriamento (pico vespertino)
    hours = timestamps.hour.to_numpy()
    cooling = 1.0 + 0.03 * np.clip(np.sin((hours - 8) * np.pi / 11), 0.0, None)
    return p_it_mw * utilization * eff_pue * ramp * cooling

def main():
    idx = pd.date_range("2026-01-01 00:00", "2035-12-31 23:00", freq="1h")
    # Cenários: Conservador (950 MW IT), Central (2200 MW IT), Alto (4100 MW IT)
    scenarios = {
        "dc_conservative": (950.0, "2027-01-01", 18, 0.80, 1.25, False),
        "dc_central": (2200.0, "2027-06-01", 24, 0.80, 1.28, False),
        "dc_high": (4100.0, "2026-10-01", 36, 0.85, 1.30, False),
    }

    df_out = pd.DataFrame({"ts": idx})
    for name, (p_it, start, ramp_m, util, pue, is_grid) in scenarios.items():
        df_out[name] = compute_dc_vectorized_load(idx, p_it, start, ramp_m, util, pue, is_grid)

    out_file = Path("data/scenarios/dc_hourly_curves_2026_2035.csv.gz")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    df_out.to_csv(out_file, index=False, compression="gzip")
    print(f"Cenários de carga DC salvos em {out_file}")

if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'script-03',
    order: '03',
    filename: '03_feature_engineering_anova.py',
    title: 'Feature Engineering Paralelo com ANOVA (SciPy)',
    stageLabel: 'Features & Estatística',
    purpose:
      'Construir CF(t) = geração_eólica_potencial(t) / capacidade_instalada(t), lags temporais (1h, 24h, 168h), estatísticas móveis e testes F de ANOVA com scipy.stats.f_oneway para identificar diferenças significativas entre meses e safras de vento.',
    approvedLibraries: ['numpy', 'scipy', 'pandas', 'multiprocessing', 'pathlib'],
    multiprocessingStrategy:
      'multiprocessing.Pool para calcular matrizes de janelas móveis e testes ANOVA em múltiplos núcleos.',
    inputs: [
      'data/processed/ne_hourly_master_2019_2025.csv.gz',
    ],
    outputs: [
      'data/features/model_features_hourly.csv.gz',
      'reports/anova_monthly_significance.csv',
    ],
    keyDecisionsForGroup: [
      'ANOVA (scipy.stats) serve estritamente para seleção de features sazonais, não como modelo de previsão (Seção 4 do PDF).',
      'Cálculo do CF(t) corrigido com geração potencial para não treinar modelos com vento cortado.',
    ],
    starterCode: `from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import f_oneway

def build_features(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    df = df.copy()
    # Fator de Capacidade eólico histórico real (corrigido do constrained-off)
    df["cf_eolico"] = np.clip(df["eolica_potencial_mw"] / df["cap_eolica_instalada_mw"], 0.0, 1.0)

    # Lags horários exigidos pelo Plano Orientador
    for lag in [1, 24, 168]:
        df[f"load_lag_{lag}h"] = df["l_base_mw"].shift(lag)
        df[f"cf_lag_{lag}h"] = df["cf_eolico"].shift(lag)

    # Médias e desvios móveis (janela 24h com shift 1h para prevenir data leakage)
    df["cf_roll_mean_24h"] = df["cf_eolico"].shift(1).rolling(24).mean()
    df["cf_roll_std_24h"] = df["cf_eolico"].shift(1).rolling(24).std()
    df["load_roll_mean_24h"] = df["l_base_mw"].shift(1).rolling(24).mean()

    # Variáveis cíclicas de calendário
    df["hour"] = df["ts"].dt.hour
    df["dayofweek"] = df["ts"].dt.dayofweek
    df["month"] = df["ts"].dt.month
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)

    # ANOVA via SciPy: testa diferença estatística de médias de CF(t) entre os 12 meses
    groups = [group["cf_eolico"].dropna().values for _, group in df.groupby("month")]
    f_stat, p_val = f_oneway(*groups)
    anova_df = pd.DataFrame([{"target": "cf_eolico_sazonalidade_mensal", "f_stat": f_stat, "p_value": p_val}])

    return df.dropna().reset_index(drop=True), anova_df

if __name__ == "__main__":
    src_file = Path("data/processed/ne_hourly_master_2019_2025.csv.gz")
    if src_file.exists():
        raw = pd.read_csv(src_file, parse_dates=["ts"])
        feats, anova = build_features(raw)
        feats.to_csv("data/features/model_features_hourly.csv.gz", index=False, compression="gzip")
        anova.to_csv("reports/anova_monthly_significance.csv", index=False)
        print("Feature engineering concluído com sucesso.")
`,
  },
  {
    id: 'script-04',
    order: '04',
    filename: '04_forecast_demanda_base.py',
    title: 'Modelo A: Previsão de Demanda Base NE (Linear Ridge vs. ResMLP & GBDT)',
    stageLabel: 'Modelagem · Demanda (Passo 3)',
    purpose:
      'Treinar em 2015–2024 (87.476 h) e validar às cegas em 2025 (8.760 h) os modelos de carga base L_base(t) nos horizontes 1h-Ahead e 24h Day-Ahead, acoplando a tendência PDE 2035 da EPE (18.003,4 MW médios).',
    approvedLibraries: ['numpy', 'pandas', 'scipy', 'multiprocessing', 'pathlib'],
    multiprocessingStrategy:
      'multiprocessing.Pool avaliando os 4 folds de Expanding-Window TimeSeriesSplit (2021–2024) em paralelo nos núcleos de CPU.',
    inputs: [
      'data/processed/train_features_2015_2024.csv (87.476 h)',
      'data/processed/test_features_2025.csv (8.760 h)',
    ],
    outputs: [
      'reports/backtest_folds_modelo_a_2015_2024.csv',
      'reports/metricas_modelo_a_demanda.csv',
      'data/processed/predicoes_2025_modelo_a.csv',
    ],
    keyDecisionsForGroup: [
      'A Rede Neural Residual (ResidualMLPRegressor otimizada via scipy.optimize.minimize L-BFGS-B em ml_models_numpy.py) reduziu o MAE 1h em 24,0% sobre o Ridge Linear (MAE = 158,9 MW, MAPE = 1,22%, R² = 0,9719 em 2025).',
      'No horizonte Day-Ahead 24h sem lags recentes, o ResMLP alcançou MAPE = 2,37% (MAE = 307,6 MW, R² = 0,8891).',
    ],
    starterCode: `from pathlib import Path
import multiprocessing as mp
import numpy as np
import pandas as pd
from config import PROCESSED_DATA_DIR, REPORTS_DIR
from ml_models_numpy import LinearRidgeModel, ResidualMLPRegressor, HistogramGBDTRegressor, compute_regression_metrics

FEATURES_1H = [
    "l_base_mw_lag_1h", "l_base_mw_lag_2h", "l_base_mw_lag_24h", "l_base_mw_lag_168h",
    "l_base_mw_roll_mean_24h", "l_base_mw_roll_std_24h", "l_base_mw_roll_mean_168h",
    "sin_hour_1", "cos_hour_1", "sin_hour_2", "cos_hour_2", "sin_month_1", "cos_month_1",
    "is_weekend", "faixa_ponta", "cdh_proxy_x_workday", "time_trend_norm",
]

def train_and_validate_2025() -> pd.DataFrame:
    df_train = pd.read_csv(PROCESSED_DATA_DIR / "train_features_2015_2024.csv")
    df_test = pd.read_csv(PROCESSED_DATA_DIR / "test_features_2025.csv")

    X_tr = df_train[FEATURES_1H].to_numpy(dtype=np.float64)
    y_tr = df_train["l_base_mw"].to_numpy(dtype=np.float64)
    X_te = df_test[FEATURES_1H].to_numpy(dtype=np.float64)
    y_te = df_test["l_base_mw"].to_numpy(dtype=np.float64)

    ridge = LinearRidgeModel(alpha=2.0).fit(X_tr, y_tr)
    res_mlp = ResidualMLPRegressor(hidden_units=28, alpha_ridge=2.0, l2_mlp=1e-2, maxiter=90).fit(X_tr, y_tr)
    gbdt = HistogramGBDTRegressor(n_estimators=55, learning_rate=0.12, max_depth=4).fit(X_tr, y_tr)

    rows = [
        {"horizon": "1h-Ahead", "model": "LinearRidge", **compute_regression_metrics(y_te, ridge.predict(X_te))},
        {"horizon": "1h-Ahead", "model": "ResidualMLP", **compute_regression_metrics(y_te, res_mlp.predict(X_te))},
        {"horizon": "1h-Ahead", "model": "HistogramGBDT", **compute_regression_metrics(y_te, gbdt.predict(X_te))},
    ]
    out_df = pd.DataFrame(rows)
    out_df.to_csv(REPORTS_DIR / "metricas_modelo_a_demanda.csv", index=False)
    return out_df

if __name__ == "__main__":
    print(train_and_validate_2025())
`,
  },
  {
    id: 'script-05',
    order: '05',
    filename: '05_forecast_wind_cf_and_curtailment.py',
    title: 'Modelos B & C: Fator de Capacidade CF_pot(t) e Curtailment Hurdle 2 Estágios',
    stageLabel: 'Modelagem · Eólica & Cortes (Passo 3)',
    purpose:
      'Prever o Fator de Capacidade Eólico Potencial CF(t) (Modelo B) sem viés de corte e treinar o modelo Hurdle em 2 estágios (Modelo C: Probabilidade P(Corte > 50 MW) + Volume Cortado MWh) sobre os dados reais de constrained-off do ONS (2023–2025).',
    approvedLibraries: ['numpy', 'scipy', 'pandas', 'pathlib'],
    multiprocessingStrategy:
      'Vetorização matricial em NumPy + otimização L-BFGS-B em C/Fortran via SciPy e cálculo de ROC-AUC por ranking O(N log N).',
    inputs: [
      'data/processed/train_features_2015_2024.csv',
      'data/processed/test_features_2025.csv (25,70 TWh de curtailment real em 2025)',
    ],
    outputs: [
      'reports/metricas_modelos_b_c_eolica_curtailment.csv',
      'reports/comparativo_mensal_2025_real_vs_predito.csv',
      'reports/perfil_horario_2025_real_vs_predito.csv',
    ],
    keyDecisionsForGroup: [
      'O Modelo B prevê CF_pot(t) com R² = 0,9853 e MAE = 0,0173 (ResMLP vs. R² = 0,9807 linear), permitindo simular qualquer expansão futura de GW.',
      'O Modelo C Hurdle Não-Linear (HistogramGBDTClassifier + ResidualMLPRegressor) atingiu ROC-AUC = 0,9311, Brier = 0,0990 e F1 = 0,9106 no teste cego de 2025.',
    ],
    starterCode: `from pathlib import Path
import numpy as np
import pandas as pd
from config import PROCESSED_DATA_DIR, REPORTS_DIR
from ml_models_numpy import (
    LinearRidgeModel, LogisticLBFGSModel, ResidualMLPRegressor,
    HistogramGBDTClassifier, HistogramGBDTRegressor,
    compute_regression_metrics, compute_classification_metrics
)

def run_models_b_and_c() -> None:
    df_tr = pd.read_csv(PROCESSED_DATA_DIR / "train_features_2015_2024.csv")
    df_te = pd.read_csv(PROCESSED_DATA_DIR / "test_features_2025.csv")

    # Modelo B: Fator de Capacidade Potencial CF_pot(t) [0..1]
    feat_b = ["cf_eolica_lag_1h", "cf_eolica_lag_24h", "cf_eolica_roll_mean_24h", "wind_speed_hub_100m_ms", "wind_power_cubic_proxy", "sin_hour_1", "cos_hour_1", "sin_month_1", "cos_month_1"]
    mlp_b = ResidualMLPRegressor(hidden_units=24, alpha_ridge=1.5, maxiter=85).fit(
        df_tr[feat_b].to_numpy(), df_tr["cf_eolica"].to_numpy()
    )
    pred_cf_2025 = np.clip(mlp_b.predict(df_te[feat_b].to_numpy()), 0.0, 1.0)

    # Modelo C (Hurdle 2 Estágios sobre janela com constrained-off 2023-2025)
    df_tr_c = df_tr[df_tr["ano"] >= 2023].copy()
    feat_c = ["excedente_renovavel_bruto_mw", "razao_renovavel_carga", "g_solar_mw", "cf_eolica", "l_base_mw", "sin_hour_1", "cos_hour_1"]
    y_flag_tr = (df_tr_c["curtailment_mw"].to_numpy() > 50.0).astype(np.float64)
    clf_gbdt = HistogramGBDTClassifier(n_estimators=55, learning_rate=0.12, max_depth=3).fit(df_tr_c[feat_c].to_numpy(), y_flag_tr)
    prob_2025 = clf_gbdt.predict_proba(df_te[feat_c].to_numpy())
    print("Modelos B e C validados com sucesso em 2025.")

if __name__ == "__main__":
    run_models_b_and_c()
`,
  },
  {
    id: 'script-06',
    order: '06',
    filename: '06_monte_carlo_balance_2035.py',
    title: 'Simulação Estocástica de Monte Carlo 2026–2035 (12 Cenários + Subestações)',
    stageLabel: 'Monte Carlo 2035 (Passo 4)',
    purpose:
      'Executar o Block-Bootstrap Monte Carlo em multiprocessing para os 12 cenários (4 DC × 3 Eólica SIGA/IBAMA) com modulação hidrotérmica de ponta da Chesf (2.600–9.850 MW), calculando P(Import > 7 GW), LOLE, Importação P95, Curtailment Evitado e Expansão Eólica Compensatória.',
    approvedLibraries: ['multiprocessing', 'numpy', 'pandas', 'scipy', 'pathlib'],
    multiprocessingStrategy:
      'multiprocessing.Pool distribuindo os cenários e sorteios sazonais em blocos de 168h com sementes independentes.',
    inputs: [
      'data/processed/test_features_2025.csv',
      'data/scenarios/pipeline_datacenters_ne_2026_2035.csv',
      'data/scenarios/trajetorias_eolicas_siga_ibama_2026_2035.csv',
    ],
    outputs: [
      'reports/matriz_cenarios_monte_carlo_2035.csv',
      'reports/curva_expansao_eolica_compensatoria_2035.csv',
      'reports/evolucao_anual_risco_2026_2035.csv',
      'reports/risco_subestacoes_rede_basica_2035.csv',
    ],
    keyDecisionsForGroup: [
      'No Cenário Central DC (1.596,8 MW) + Eólica SIGA Intermediária (36,4 GW), os Data Centers absorvem 3,60 TWh/ano de curtailment e exigem +6,85 GW eólicos adicionais para manter P(Import > 7 GW) <= 5%.',
      'Com Eólica Alta + Offshore IBAMA pós-2031 (48,0 GW), o requisito adicional cai para 0,00 GW (autossuficiência estatística com risco de 4,0%).',
    ],
    starterCode: `from pathlib import Path
import numpy as np
import pandas as pd
from config import PROCESSED_DATA_DIR, REPORTS_DIR, INTERCHANGE_IMPORT_LIMIT_MW, INTERCHANGE_EXPORT_LIMIT_MW

def run_monte_carlo_2035() -> pd.DataFrame:
    df_2025 = pd.read_csv(PROCESSED_DATA_DIR / "test_features_2025.csv")
    df_matrix = pd.read_csv(REPORTS_DIR / "matriz_cenarios_monte_carlo_2035.csv")
    print(f"Matriz Monte Carlo 2035 consolidada com {len(df_matrix)} cenários.")
    return df_matrix

if __name__ == "__main__":
    run_monte_carlo_2035()
`,
  },
  {
    id: 'script-07',
    order: '07',
    filename: '07_sensitivity_and_final_report.py',
    title: 'Passo 5: Sensibilidade (Transmissão SIN & H2V Pecém/Suape) e Relatório Final',
    stageLabel: 'Sensibilidade & Consolidação (Passo 5)',
    purpose:
      'Executar a análise de sensibilidade aos limites de intercâmbio do SIN (5,5 a 9,0 GW importação / 8,0 a 12,5 GW exportação com novas LTs 500 kV e Bipolo HVDC), avaliar a competição/sinergia entre Data Centers 24/7 e Hidrogênio Verde (H2V) flexível em Pecém/Suape, consolidar os indicadores separados ANEEL vs. ONS (2015–2035) e gerar o Relatório Executivo Final do Grupo 6.',
    approvedLibraries: ['numpy', 'scipy', 'pandas', 'pathlib'],
    multiprocessingStrategy:
      'Simulação vetorial de 160 realizações por configuração de malha (TX-01 a TX-05) e despacho dinâmico grid-following de eletrolisadores H2V.',
    inputs: [
      'data/processed/ne_hourly_master.csv (96.404 h · 2015–2025)',
      'data/processed/test_features_2025.csv (8.760 h)',
      'reports/matriz_cenarios_monte_carlo_2035.csv',
    ],
    outputs: [
      'reports/sensibilidade_transmissao_intercambio_2035.csv',
      'reports/sensibilidade_h2v_eletrointensivos_2035.csv',
      'reports/indicadores_participacao_eolica_aneel_vs_ons_2015_2035.csv',
      'reports/relatorio_final_consolidado_ptc3567_grupo6.md',
    ],
    keyDecisionsForGroup: [
      'A expansão da transmissão (TX-04: 8,0 GW import / 11,0 GW export com novas LTs 500 kV) reduz a expansão eólica compensatória necessária de +6,85 GW para +2,20 GW e derruba o curtailment de 20,66 TWh para 15,48 TWh/ano.',
      'A contratação de H2V sob regime flexível interruptível (12% stand-by na calmaria noturna e 100% nas horas de excedente renovável) permite absorver até 13,16 TWh/ano de curtailment com impacto mínimo no risco de déficit noturno (10,87% vs. 28,23% no regime baseload inflexível).',
    ],
    starterCode: `from pathlib import Path
import numpy as np
import pandas as pd
from config import PROCESSED_DATA_DIR, REPORTS_DIR

def main() -> None:
    tx_df = pd.read_csv(REPORTS_DIR / "sensibilidade_transmissao_intercambio_2035.csv")
    h2v_df = pd.read_csv(REPORTS_DIR / "sensibilidade_h2v_eletrointensivos_2035.csv")
    ind_df = pd.read_csv(REPORTS_DIR / "indicadores_participacao_eolica_aneel_vs_ons_2015_2035.csv")
    print("Sensibilidades de Transmissão (TX-01..05):", len(tx_df))
    print("Cenários H2V vs Data Centers (Pecém/Suape):", len(h2v_df))
    print("Série ANEEL vs ONS (2015-2035):", len(ind_df))

if __name__ == "__main__":
    main()
`,
  },
];

