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
    title: 'Modelo A: Previsão de Carga Base (SARIMAX / ML com Backtesting Temporal)',
    stageLabel: 'Modelagem · Demanda',
    purpose:
      'Treinar e avaliar o modelo de carga base L_base(t) com TimeSeriesSplit. Decompõe a tendência estrutural de longo prazo (EPE/PDE 2035) do perfil horário modulado.',
    approvedLibraries: ['numpy', 'pandas', 'scipy', 'multiprocessing', 'pathlib'],
    multiprocessingStrategy:
      'multiprocessing.Pool avaliando os múltiplos folds de TimeSeriesSplit em paralelo nos núcleos de CPU.',
    inputs: ['data/features/model_features_hourly.csv.gz', 'Taxa anual PDE 2035 (EPE)'],
    outputs: ['reports/backtest_demanda_metrics.csv'],
    keyDecisionsForGroup: [
      'Priorizar modelo eficiente e paralelizado. Caso scikit-learn/xgboost sejam aprovados pelo usuário, usar XGBoost/Random Forest; caso contrário, usar modelo linear autorregressivo em numpy/scipy com solução de mínimos quadrados via scipy.linalg.lstsq.',
    ],
    starterCode: `import multiprocessing as mp
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.linalg import lstsq

def run_fold_eval(args: tuple[int, np.ndarray, np.ndarray, np.ndarray, np.ndarray]) -> dict:
    """Treina e avalia modelo linear multivariado regularizado em paralelo sem bibliotecas pesadas."""
    fold_idx, X_train, y_train, X_test, y_test = args
    # Solução por mínimos quadrados mínimos (scipy.linalg.lstsq - sem dependência externa)
    beta, _, _, _ = lstsq(X_train, y_train)
    preds = X_test @ beta
    mae = float(np.mean(np.abs(y_test - preds)))
    rmse = float(np.sqrt(np.mean((y_test - preds) ** 2)))
    return {"fold": fold_idx, "mae_mw": mae, "rmse_mw": rmse}

def evaluate_timeseries_splits_parallel(df: pd.DataFrame, feature_cols: list[str], target_col: str, n_splits=5):
    X = np.column_stack([np.ones(len(df)), df[feature_cols].to_numpy()])
    y = df[target_col].to_numpy()
    test_size = 24 * 60  # 60 dias por fold
    tasks = []

    for fold in range(n_splits):
        split_point = len(df) - (n_splits - fold) * test_size
        X_train, y_train = X[:split_point], y[:split_point]
        X_test, y_test = X[split_point:split_point + test_size], y[split_point:split_point + test_size]
        tasks.append((fold, X_train, y_train, X_test, y_test))

    with mp.Pool(processes=min(n_splits, mp.cpu_count())) as pool:
        results = pool.map(run_fold_eval, tasks)
    return pd.DataFrame(results)

if __name__ == "__main__":
    print("Script 04 pronto para execução de backtesting temporal.")
`,
  },
  {
    id: 'script-05',
    order: '05',
    filename: '05_forecast_wind_cf_and_curtailment.py',
    title: 'Modelos B & C: Fator de Capacidade CF(t) e Curtailment',
    stageLabel: 'Modelagem · Eólica & Cortes',
    purpose:
      'Prever o Fator de Capacidade CF(t) (Modelo B) para separar regime de vento da capacidade futura de GW e treinar o classificador/regressor de curtailment (Modelo C) sobre horas com excedente local de geração.',
    approvedLibraries: ['numpy', 'scipy', 'pandas', 'multiprocessing', 'pathlib'],
    multiprocessingStrategy:
      'multiprocessing.Pool para busca de hiperparâmetros e validação cruzada out-of-sample dos modelos B e C.',
    inputs: ['data/features/model_features_hourly.csv.gz'],
    outputs: ['reports/curtailment_metrics_brier_roc.csv'],
    keyDecisionsForGroup: [
      'O Modelo B prevê estritamente o Fator de Capacidade [0..1] e não MW brutos.',
      'O Modelo C quantifica a probabilidade e magnitude de constrained-off (Brier Score e volume cortado).',
    ],
    starterCode: `from pathlib import Path
import numpy as np
import pandas as pd

def compute_curtailment_brier_score(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Calcula Brier Score com numpy puro (sem scikit-learn)."""
    return float(np.mean((y_prob - y_true) ** 2))

def evaluate_models_b_and_c(df: pd.DataFrame) -> dict:
    # Exemplo com regressão logística / linear pura via scipy
    cf_target = df["cf_eolico"].to_numpy()
    flag_curtailment = df["flag_curtailment"].to_numpy()
    print("Modelos B e C prontos para avaliação de CF e detecção de corte.")
    return {"status": "ok"}

if __name__ == "__main__":
    print("Script 05 inicializado.")
`,
  },
  {
    id: 'script-06',
    order: '06',
    filename: '06_monte_carlo_balance_2035.py',
    title: 'Simulação Estocástica de Monte Carlo em Multiprocessing até 2035',
    stageLabel: 'Risco & Monte Carlo Paralelo',
    purpose:
      'Cruzar cenários sem/com Data Centers × expansão eólica (Base, Intermediário, Alto + Offshore pós-2031) com reamostragem em blocos temporais (block bootstrap), paralelizando milhares de simulações estocásticas no multiprocessing.Pool.',
    approvedLibraries: ['multiprocessing', 'numpy', 'pandas', 'os', 'pathlib', 'time'],
    multiprocessingStrategy:
      'multiprocessing.Pool dividindo as iterações (ex.: 5.000 iterações em lotes de 1.000) por worker com sementes de números aleatórios isoladas via np.random.SeedSequence.',
    inputs: [
      'data/features/model_features_hourly.csv.gz (Série meteorológica e resíduos)',
      'data/scenarios/dc_hourly_curves_2026_2035.csv.gz',
      'Limites de intercâmbio SIN (7.000 MW importação / 9.500 MW exportação)',
    ],
    outputs: [
      'reports/matriz_risco_monte_carlo_2035.csv',
      'reports/expansao_eolica_compensatoria_gw.csv',
    ],
    keyDecisionsForGroup: [
      'Amostragem em blocos de dias/semanas ou anos meteorológicos inteiros (boa prática da Seção 7 do PDF) para preservar autocorrelação de calmarias.',
      'Cálculo do P95 de importação e dos GW eólicos adicionais necessários para manter o risco de déficit dentro da capacidade das linhas.',
    ],
    starterCode: `import multiprocessing as mp
import os
import time
from pathlib import Path
import numpy as np
import pandas as pd

def simulate_monte_carlo_chunk(args: tuple[int, int, int, np.ndarray, np.ndarray, np.ndarray, float, float]) -> dict:
    """Worker que roda um lote de simulações Monte Carlo em processo independente."""
    chunk_id, n_sims, base_seed, cf_series, base_load, dc_load, cap_wind_mw, import_limit_mw = args
    rng = np.random.default_rng(base_seed + chunk_id * 10007)

    n_hours = len(cf_series)
    critical_runs = 0
    p95_imports = []
    annual_curtailment_twh = []

    for _ in range(n_sims):
        # 1. Incerteza climática: seleciona bloco sazonal com escala estocástica
        wind_factor = rng.uniform(0.75, 1.25)
        # 2. Atraso ou adiantamento das usinas eólicas (SIGA/IBAMA)
        wind_delay = rng.uniform(0.80, 1.02)
        # 3. Rampa e utilização dos Data Centers
        dc_factor = rng.uniform(0.70, 1.15)
        # 4. Incerteza do crescimento vegetativo da demanda normal
        load_factor = rng.uniform(0.96, 1.04)

        sim_wind_gen = (cf_series * wind_factor).clip(0.0, 1.0) * (cap_wind_mw * wind_delay)
        sim_load = (base_load * load_factor) + (dc_load * dc_factor)
        # Despacho hidrotérmico e solar médio complementar no NE (~11.000 MW médio diurno/noturno)
        sim_margin = sim_wind_gen + 9500.0 - sim_load

        needed_import = np.clip(-sim_margin, 0.0, None)
        p95_imports.append(float(np.percentile(needed_import, 95)))

        if np.any(needed_import > import_limit_mw):
            critical_runs += 1

        curt_mwh = np.sum(np.clip(sim_margin - 9500.0, 0.0, None))
        annual_curtailment_twh.append(float(curt_mwh * (8760 / n_hours) / 1e6))

    return {
        "chunk_id": chunk_id,
        "n_sims": n_sims,
        "critical_runs": critical_runs,
        "p95_imports": p95_imports,
        "annual_curtailment_twh": annual_curtailment_twh,
    }

def main():
    total_simulations = 4000
    num_cpus = max(1, os.cpu_count() or 2)
    sims_per_worker = total_simulations // num_cpus

    print(f"Iniciando Monte Carlo de {total_simulations:,} simulações em {num_cpus} processos paralelos...")
    t0 = time.time()

    # Dados sintéticos de demonstração (no pipeline real lê de data/features/)
    n_hours = 168
    cf_series = np.clip(0.42 + 0.18 * np.sin(np.linspace(0, 14 * np.pi, n_hours)), 0.08, 0.85)
    base_load = 15000.0 + 2500.0 * np.sin(np.linspace(0, 14 * np.pi, n_hours))
    dc_load = np.full(n_hours, 2200.0 * 0.80 * 1.28)  # Cenário Central 2035

    tasks = [
        (i, sims_per_worker, 42, cf_series, base_load, dc_load, 36400.0, 7000.0)
        for i in range(num_cpus)
    ]

    with mp.Pool(processes=num_cpus) as pool:
        chunk_results = pool.map(simulate_monte_carlo_chunk, tasks)

    total_critical = sum(r["critical_runs"] for r in chunk_results)
    all_p95 = [val for r in chunk_results for val in r["p95_imports"]]
    all_curt = [val for r in chunk_results for val in r["annual_curtailment_twh"]]

    prob_critical = (total_critical / (sims_per_worker * num_cpus)) * 100
    p95_global = float(np.percentile(all_p95, 95))
    curt_mean = float(np.mean(all_curt))
    elapsed = time.time() - t0

    print(f"Concluído em {elapsed:.2f}s!")
    print(f"Probabilidade anual de violar intercâmbio: {prob_critical:.1f}%")
    print(f"Importação P95 máxima: {p95_global:,.0f} MW")
    print(f"Curtailment eólico médio estimado: {curt_mean:.2f} TWh/ano")

if __name__ == "__main__":
    main()
`,
  },
];
