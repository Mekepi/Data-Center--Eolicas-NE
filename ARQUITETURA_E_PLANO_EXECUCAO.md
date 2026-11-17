# Documento Base de Arquitetura e Plano Sequencial de Execução (Ciclo 3 & Ciclo 4)

**Projeto:** Balanço Eólico & Data Centers NE 2035 (PTC3567 · Grupo 6)  
**Estado Atual:** **Ciclo 3 Concluído (`C3-1`..`C3-4` `[x]`) · Ciclo 4 em Execução (`C4-1`..`C4-3` `[x]`, `C4-4`..`C4-5` `[ ]`)** · `22/22` testes Python OK · `19/19` subtestes TS OK · `tsc --noEmit` & `vite build` sem warnings  
**Data de Referência:** 2026-11-16  
**Finalidade:** Documentar exclusivamente a arquitetura vigente do sistema, o diagnóstico técnico quantitativo consolidado, o fechamento histórico do **Ciclo 3** e o plano sequencial em andamento do **Ciclo 4** (contratos estruturados, corretude científica sem data leakage, otimização de runtime/UI e reexecução integral).

---

## 1. Arquitetura Atual do Sistema

### 1.1 Raiz e Toolchain de Build
- `package.json`: SPA React 19 + Vite 8 + Tailwind CSS v4 + TypeScript 7 (`esbuild`, `tsx`), scripts `dev` (porta `3000`), `build`, `lint` (`tsc --noEmit`), `sync:ssot` e `test`.
- `tsconfig.json` / `vite.config.ts` / `metadata.json` / `index.html` / `src/index.css` / `src/main.tsx`: configuração padrão da SPA com Tailwind CSS (`@import "tailwindcss";`); `vite.config.ts` usa `import.meta.dirname` para compatibilidade nativa com `configLoader` do Vite 8 (zero warnings de `__dirname`).
- `.gitignore`: exclui `node_modules/`, `dist/`, `build/`, `coverage/`, `__pycache__/`, `*.py[cod]`, `.playwright-cli/`, `data/raw/ons_*.csv` e `data/processed/*.csv`.

### 1.2 Esteira Analítica Python (`/scripts`)
Toda a parametrização numérica, física e editorial converge em fonte única (`scripts/config.py` + `scripts/pipeline_metadata.json`), sem valores hardcoded espalhados entre scripts ou UI:
- `scripts/config.py`: fonte única de parâmetros físicos, horizontes (`2015–2025` histórico, `BASELINE_YEAR = 2025`, projeção `2025–2035`, `HOURS_PER_YEAR = 8760`, `BLOCK_SIZE_HOURS = 168`, `OFFSHORE_COMMERCIAL_START_YEAR = 2032`), limites SIN (`BASE_WIND_ONSHORE_2026_MW = 29600`, `INTERCHANGE_IMPORT_LIMIT_MW = 7000`, `INTERCHANGE_EXPORT_LIMIT_MW = 9500`), derivação dinâmica `compute_dc_scenarios_it_mw()` alinhada ao cadastro real `data_centers_pipeline_ne.csv` (`none: 0, conservative: 465, central: 1595, high: 3495 MW IT`), despacho Chesf, taxas PDE/solar (`3,1% a.a.` / `4,5% a.a.`), parâmetros Monte Carlo (`1000` iterações unificadas em `iterationsMain` e `iterationsTimeline`, `seed = 42`), códigos estruturados em `REFERENCE_SCENARIO_KEYS` (`preferredModelId`, `txReferenceCode`, `txExpansionCode`, `h2vBaselineCode`), especificações `TX-01..TX-05` (`configCode`) e `H2V-01..H2V-05` (`scenarioCode`, `flexMode`), hiperparâmetros `ML_MODEL_PARAMS`, bounds de sliders e `ONS_S3_URL_TEMPLATES`.
- `scripts/pipeline_metadata.json`: catálogo editorial externo (`dcProjectNotes`, `featureMetadata`, `scriptsCatalog`, `uiCatalog` e `approvedLibrariesPolicy`).
- `scripts/ml_models_numpy.py`: modelos implementados em NumPy/SciPy (`LinearRidgeModel`, `LogisticLBFGSModel`, `ResidualMLPRegressor`, `ResidualMLPClassifier`, `HistogramGBDTRegressor`, `HistogramGBDTClassifier`), utilitário compartilhado `impute_with_train_medians` (medianas exclusivas de treino), construtor estritamente cronológico `build_forward_time_series_folds` com embargo temporal (`cvEmbargoHours = 48`), seleção de regularização sem *look-ahead* e calibração Platt OOF desacoplada (*nested forward-OOF* com atributos auditáveis `cv_fold_count_`, `cv_oof_mse_`, `cv_oof_auc_`, `cv_oof_brier_`).
- `scripts/01_ingest_ons_aneel_epe.py`: ingestão de dados oficiais ONS/ANEEL (`2015–2025`), download paralelo de `RESTRICAO_COFF_EOLICA` (`2023–2025`), mapeamento unificado (`g_termica_mw`, `g_hidro_mw`) e geração eólica potencial (`verificada + curtailment`).
- `scripts/02_build_dc_and_offshore_scenarios.py`: modelagem bottom-up de 14 projetos (`data/raw/data_centers_pipeline_ne.csv`), rampa anual `2026–2035`, regra de não-duplicação de PUE, concentração por chave composta `(subestacao_conexao, estado, tensao_conexao_kv)` e matriz `DC × Eólica` (com offshore comercial pós-2031 no cenário `high`).
- `scripts/03_feature_engineering_anova.py`: construção isolada por partição via `split_and_build_causal_features` (separa Treino `< 2025` e Teste `2025` em ordem cronológica ANTES do cálculo de lags `1h/24h/168h` e janelas móveis, eliminando vazamento de dezembro/`2024` nas primeiras `168 h` de `2025`), harmônicos de Fourier, termos aerodinâmicos, testes ANOVA (`scipy.stats.f_oneway`) com `alvo_id` estruturado e perfil mensal.
- `scripts/04_forecast_demanda_base.py`: Modelo A (`L_base(t)` em `1h` e `24h`) com imputação exclusiva pelas medianas de treino (`impute_with_train_medians`), backtest paralelo `TimeSeriesSplit` com embargo (`backtestEmbargoHours = 168`) e registro auditável de `embargo_hours`, `ridge_r2` e `resmlp_r2`.
- `scripts/05_forecast_wind_cf_and_curtailment.py`: Modelo B (`cf_eolica(t)` em `1h` e `24h`) e Modelo C Hurdle em 2 estágios treinado em `>= 2023-09-01`, ambos protegidos por `_impute_with_train_medians` (`impute_with_train_medians`) e sanitização não-negativa de `g_eolica_potencial_mw`, emitindo IDs estruturados e perfis comparativos `ResMLP` de 2025.
- `scripts/06_monte_carlo_balance_2035.py`: motor estocástico vetorizado em chunks matriciais (`_evaluate_bootstrap_batch`, `_MC_VECTOR_CHUNK_SIZE = 2000`, `seed = 42`, `Common Random Numbers`, modulação Chesf e suporte H2V), gerador da matriz de 12 cenários, curva compensatória, evolução anual `2025–2035`, risco bottom-up vetorizado (`proj_demands @ sub_indicator` com paridade `offshore_cf_gain` + `cf_ceiling`), exportador da série real de `8.760 h` e grade paramétrica `2025–2035`.
- `scripts/07_sensitivity_and_final_report.py`: análises de sensibilidade `TX-01..TX-05` e `H2V-01..H2V-05` via `simulate_block_bootstrap` vetorizado, indicadores ANEEL vs. ONS `2015–2035` alinhados ao ganho offshore de `06`, relatório Markdown por IDs estruturados e disparo de `sync_frontend_ssot()`.
- `scripts/run_pipeline.py`: orquestrador único (`01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> ssot`) com `--skip-ingest`, `--only-from` e `--dry-run`.
- `scripts/sync_frontend_ssot.py`: gerador do contrato SSOT dual (`public/data/pipeline-ssot.json` + `src/data/generated/pipelineSsot.ts`, `schemaVersion = 2.1.0`), emitindo IDs estruturados (com backfill determinístico para CSVs legados pré-`C4-4`) e `approvedLibrariesPolicy`, checagem cruzada bloqueante `validate_ssot_cross_consistency` via IDs estruturados e embarque literal de `scripts/*.py` e `config`.
- `scripts/test_sync_frontend_ssot.py`: suíte `unittest` (`22` testes) em Python validando parsers, orquestrador, chave composta de subestações, consistência cruzada, contratos C3/C4-1 e invariantes C4-2 (não-vazamento inter-split, CV cronológica sem *look-ahead* e determinismo Monte Carlo vetorizado).

### 1.3 Artefatos de Dados, Relatórios e Contratos SSOT (`/data`, `/reports`, `/public`)
- `data/raw/` e `data/scenarios/`: cadastro de data centers, série de concentração por subestação e matriz anual `matriz_cenarios_dc_eolica_2026_2035.csv`. *(CSVs massivos do ONS e `data/processed/*.csv` são gerados localmente em ambiente Python científico e ignorados no Git.)*
- `reports/`: 18 CSVs analíticos (incluindo `serie_base_horaria_8760h_ons.csv` e `grade_simulador_monte_carlo_2025_2035.csv` com `696` linhas) + `relatorio_final_consolidado_ptc3567_grupo6.md`.
- `public/data/hourly-baseline-8760.json`: série horária real de `8.760 h` em formato colunar compacto (`annual_blend`, `dry_windy`, `wet_calm`) validada por digest SHA-256 (`hoursCount = 8760`).
- `public/data/pipeline-ssot.json` & `src/data/generated/pipelineSsot.ts`: artefatos SSOT sincronizados (`schemaVersion = 2.1.0`), incluindo `approvedLibrariesPolicy` e contratos tipados estruturados.
- `public/assets/`: documento PDF de referência do Plano Orientador.

### 1.4 Camada Frontend (`/src`)
- `src/data/pipelineTypes.ts` e `src/data/pipelineSsotContext.tsx`: tipagem integral (`PipelineSsotBundle`, `ApprovedLibrariesPolicy`, `HourlyBaseline8760Bundle`, `SimulatorMonteCarloGridRow`, IDs estruturados `AnovaTargetId`, `BenchmarkHorizonId`, `BenchmarkModelId`, `BenchmarkFamilyId`, `H2VFlexMode`) e `PipelineSsotProvider` como fonte única de dados (removidas as fachadas legadas `dataCentersPipelineCatalog.ts`, `featuresAnovaCatalog.ts` e `scriptsRoadmap.ts`).
- `src/utils/energyModel.ts` e `src/utils/energyModel.test.ts`:
  - Motor determinístico real-time de **ano completo (`8.760 h`)** para qualquer ano em **`2025–2035`** com API desacoplada (`estimateAnnualSimulation` + `summarizeHourlyWindow` + `sliceHourlyWindow`), cache `WeakMap` de labels (`getBaselineTimestampLabels`), lookup O(1) em `Float64Array` para sazonalidade Chesf, zero-clone no slice `'year'` via `WeakSet` e agregador `buildHourlyPlotBuckets` pré-alocado (`45,87 ms → 9,44 ms/execução`).
  - Resolvedor estocástico `resolveMonteCarloSummary` orientado exclusivamente à **grade paramétrica Python** (`grid_exact`, interpolação IDW 5D com seleção top-4 sem alocação/ordenação em O(N) e interpolação linear em GW para eólica intermediária/offshore) e âncoras SSOT oficiais (`ssot_anchor`), retornando `'unavailable'` honestamente para fatias sem suporte paramétrico (**zero simulação sintética em JavaScript**).
- `src/utils/csvExport.ts`: exportador unificado CSV (BOM UTF-8 + `;`), `.md`, `.json` e `.py`.
- `src/App.tsx` e `src/components/`:
  - `App.tsx`: persistência em `localStorage` versionada por `ssot.schemaVersion` e sanitizada contra IDs válidos do catálogo SSOT vigente.
  - `ObjectiveAndSimulatorView.tsx` + subcomponentes modulares `StudySynthesisSection.tsx`, `SimulatorControlsPanel.tsx`, `SimulatorHourlyChartSection.tsx` (polyline/envelope SVG cacheados separados do scrubber O(1) `inspectedHour`) e `ExecutiveDeliverySection.tsx`.
  - `DataCentersPipelineView.tsx` (14 projetos + filtro por chave composta `${substation}::${voltageKV}`)
  - `FeaturesAndAnovaView.tsx` + `featuresAnovaKpis.ts` + `Validation2025Panel.tsx` (decomposto em `Validation2025HourlyChart.tsx` e `Validation2025BenchmarkTables.tsx`), `MonteCarlo2035Panel.tsx`, `SensitivityPasso5Panel.tsx` e `AnovaCorrelationsPanel.tsx`, com separação explícita entre **Diagnóstico Histórico Out-of-Time · 2025** e **Projeção Estocástica · 2035**.
  - `DatabasesExplorerView.tsx`, `ScriptsPipelineView.tsx` (exibindo também `approvedLibrariesPolicy`), `DecisionsAndPdfView.tsx`
  - **Contrato visual:** zero estilos inline (`style={{`), zero seletores frágeis por substring e zero fallbacks numéricos inventados.

---

## 2. Diagnóstico Técnico na Entrada do Ciclo 3

### 2.1 Últimos Resultados Científicos Registrados (Teste Cego `2025`, `8.760 h`)
| Modelo / Horizonte | Família Linear | Challenger ResMLP (Não-Linear) | Challenger Hist-GBDT | Situação |
|---|---|---|---|---|
| **Modelo A · Demanda Base (`1h`)** | Ridge `MAE 222,89 MW` (`R² 0,9479`) | `MAE 159,05 MW` (`MAPE 1,22%`, `R² 0,9719`) | `MAE 187,45 MW` (`R² 0,9594`) | ResMLP vence |
| **Modelo A · Demanda Base (`24h`)** | Ridge `MAE 398,48 MW` (`R² 0,8155`) | `MAE 310,20 MW` (`MAPE 2,38%`, `R² 0,8763`) | `MAE 349,47 MW` (`R² 0,8502`) | ResMLP vence |
| **Modelo B · CF Eólico (`1h`)** | Ridge `MAE 0,0211` (`632,1 MW`, `R² 0,9783`) | `MAE 0,0171` (`511,8 MW`, `R² 0,9857`) | `MAE 0,0203` (`607,1 MW`, `R² 0,9791`) | ResMLP vence |
| **Modelo B · CF Eólico (`24h`)** | Ridge `MAE 0,0810` (`2.422,9 MW`, `R² 0,6985`) | `MAE 0,0799` (`2.391,9 MW`, `R² 0,7060`) | `MAE 0,0806` (`2.412,7 MW`, `R² 0,7011`) | ResMLP vence |
| **Modelo C · Estágio C1 (Ocorrência)** | Logística `ROC-AUC 0,9479` (`Brier 0,0853`, `F1 0,9213`) | `ROC-AUC 0,9520` (`Brier 0,0782`, `F1 0,9270`) | `ROC-AUC 0,9293` (`Brier 0,0994`, `F1 0,9086`) | **Gate C1 fechado (ResMLP vence em AUC, Brier e F1)** |
| **Modelo C · Estágio C2 (Volume)** | Ridge `R² 0,9172` (`MAE 710,5 MW`, `22,53 TWh`) | `MAE 634,5 MW` · `RMSE 966,8 MW` · **`R² 0,9340`** (`23,24 TWh`) | `R² 0,7551` (`MAE 1.083,3 MW`, `18,74 TWh`) | **Gate C2 fechado (ResMLP SiLU vence em MAE, RMSE, R² e TWh)** |

### 2.2 Saneamento Materializado em Passo C3-3 (Concluído) e Estado dos Testes
- **Materializado e validado no repositório após execução científica (`log_6bde40b9.txt`):**
  1. `public/data/hourly-baseline-8760.json` (`digest = 077346f9d62b5361`) e `reports/serie_base_horaria_8760h_ons.csv`: **`gHydroMW` populado** (`1.750,4` a `7.395,4 MW`, média `3.228,56 MW`).
  2. Paridade `2035` 100% exata entre `matriz_cenarios_monte_carlo_2035.csv` (`Central × Intermediária`: `10,0%`, `LOLE 62,7 h`, `P95 8.439,5 MW`, `10,91 TWh`, `3.930,8 GWh`, `+6,85 GW`), `evolucao_anual_risco_2026_2035.csv`, `TX-03`, `H2V-01` e `grade_simulador_monte_carlo_2025_2035.csv` (`696` linhas com variantes offshore pós-2031).
  3. **SSOT & Validação Cruzada (`scripts/sync_frontend_ssot.py`):** corrigido `validate_ssot_cross_consistency` (`windCapacityMW` + `dcControl = "none"`) e sincronizado SSOT com `0` violações (ressincronizado em C3-4 após ajuste editorial em `pipeline_metadata.json`).
  4. **Fechamento completo do Modelo C (`ResMLP Hurdle C1+C2`):** após adoção de `activation="silu"` (`z · sigmoid(z)`) no Estágio C2 (`ml_models_numpy.py`, `config.py`, `05_forecast_wind_cf_and_curtailment.py`), o modelo não-linear superou o baseline linear em **todos** os critérios:
     - **Estágio C1:** `ROC-AUC = 0,9520` (vs. `0,9479`), `Brier = 0,0782` (vs. `0,0853`), `F1 = 0,9270` (vs. `0,9213`).
     - **Estágio C2:** `MAE Global = 634,5 MW` (vs. `710,5 MW`), `RMSE Global = 966,8 MW` (vs. `1.082,6 MW`), `R² Volume = 0,9340` (vs. `0,9172`) e energia anual prevista de `23,24 TWh` (vs. `22,53 TWh` linear e `25,70 TWh` reais).
- **Estado final das verificações (pós-C3-4):** `18/18` testes Python (`unittest`) aprovados · `17/17` subtestes TypeScript (`energyModel.test.ts`) aprovados · `tsc --noEmit` e `vite build` aprovados · Inspeção em Chromium (`1440×900` e `390×844`) sem erros de console e com zero overflow horizontal.

---

## 3. Plano Sequencial de Execução — Ciclo 3 (Engenharia Elétrica, Ciência de Dados e Calibração)

> **Regra de Execução:** Os passos abaixo evoluem rigorosamente a modelagem física e de ML dentro da arquitetura existente (`scripts/config.py` → `03..07` → `sync_frontend_ssot.py`), preservando causalidade estrita (`Treino <= 2024` / `Teste = 2025`), chave composta de subestações e contrato SSOT sem dados sintéticos.

### Passo C3-1 — Engenharia de Features Elétricas e Generalização Out-of-Time do Modelo C (Estágios C1 e C2)
- **Status:** `[x]` **Código e SSOT implementados em 2026-11-15** *(Estágio C1 validado em 2025 com AUC `0,9520`; Estágio C2 já vence em MAE `700,2 < 710,5 MW` e recebeu upgrade `activation="silu"` para fechar `r2_volume`)*.
- **Objetivo:** Fazer a família não-linear superar a regressão logística também no **Estágio C1** (`ROC-AUC > 0,9289`, `Brier < 0,1208`, `F1 > 0,8863` no teste cego `2025`), fechando o Subteste 9, e reduzir o viés de subestimação volumétrica no **Estágio C2** (`16,43 TWh` vs. `25,70 TWh` reais em `2025`).
- **Arquivos atualizados:** `scripts/config.py`, `scripts/03_feature_engineering_anova.py`, `scripts/ml_models_numpy.py`, `scripts/05_forecast_wind_cf_and_curtailment.py`, `scripts/pipeline_metadata.json`, `scripts/test_sync_frontend_ssot.py` + bundle SSOT.
- **Implementação aplicada (zero data leakage, `< 2025`):**
  1. **`03_feature_engineering_anova.py` & `pipeline_metadata.json`:** adicionadas features causais de saturação do corredor SIN (`folga_escoamento_sin_mw`, hinge `excesso_sobre_escoamento_mw`), coincidência horária solar × eólica (`interacao_solar_eolica_mw`), rampas/médias causais de excedente (`rampa_excedente_1h_mw`, `excedente_renovavel_roll_mean_24h`, `excedente_renovavel_roll_max_24h`) e ocupação hidráulica causal Chesf 24h (`g_hidro_roll_mean_24h` e `despacho_total_est_excesso_mw`).
  2. **`ml_models_numpy.py` & `config.py`:** adicionado suporte uniforme a `sample_weight` nos 6 estimadores; corrigida a sub-regularização de `W1` em `ResidualMLPClassifier`, validação cruzada em blocos temporais (`cv_folds = 4` em `reg_l2_grid`) + calibração logística monotônica (*Platt scaling* out-of-fold `< 2025`) + *ensemble* multi-seed (`nEnsemble = 3`), além de suporte a `activation="silu"` não-saturante em `ResidualMLPRegressor` para o Estágio C2 (`regL2Skip = 4e-3`, `maxIter = 200`).
  3. **`05_forecast_wind_cf_and_curtailment.py`:** substituídos `month_sin`/`month_cos` em `FEATURES_CURTAILMENT` por `cap_eolica_instalada_mw`, folga/hinge de escoamento, estado causal de intercâmbio/CF e ocupação Chesf 24h; adicionada imputação `_impute_with_train_medians` (apenas treino) e ponderação temporal linear simétrica (`modelCRecencyMinWeight = 0.35` até `1.0`) aplicada igualmente às famílias Linear e Não-Lineares nos estágios C1 e C2.
- **Critério de aceite (validado no Passo C3-3):** Reexecução em ambiente Python científico produzindo `nonLinear.rocAuc > linear.rocAuc`, `nonLinear.brierScore < linear.brierScore`, `nonLinear.f1Score >= linear.f1Score` e `nonLinear.r2Volume > linear.r2Volume` em `reports/metricas_modelos_b_c_eolica_curtailment.csv`.

### Passo C3-2 — Refinamento de Engenharia Elétrica nos Balanços Horário (`8.760 h`) e Estocástico (`06` & `07`)
- **Status:** `[x]` **Código, artefatos e paridade `2035` validados em 2026-11-15**.
- **Objetivo:** Aprofundar o realismo físico-operativo do despacho no subsistema Nordeste e eliminar simplificações de primeira ordem identificadas nos Ciclos 1–2.
- **Arquivos atualizados:** `scripts/config.py`, `scripts/06_monte_carlo_balance_2035.py`, `scripts/07_sensitivity_and_final_report.py`, `src/data/pipelineTypes.ts`, `src/utils/energyModel.ts`, `scripts/test_sync_frontend_ssot.py`, `src/utils/energyModel.test.ts` + bundle SSOT.
- **Implementação aplicada (paridade estrita Python ↔ TypeScript):**
  1. **Despacho Hidrotérmico Sazonal Chesf (`06`, `07` & `energyModel.ts`):** `_prepare_seasonal_blocks` passa a carregar `month`, `g_hidro_mw`/`g_hidraulica_mw` e `g_termica_mw`; `_compute_chesf_hydro_thermal_dispatch` e `computeChesfDispatchMW` aplicam sazonalidade da bacia do São Francisco (estação úmida Dez–Mai com `wetFloorBonusMW = +650 MW` e `wetSlope = 0.62`, estação seca Ago–Nov com `drySlope = 0.50`, transição intermediária), parcela de inflexibilidade térmica (`thermalInflexWeight = 0.35`) e ancoragem empírica (`hydroObsBlend = 0.25`) quando `g_hidro_mw > 0`. Em `estimateFullYearHourly`, o despacho Chesf passa a responder exclusivamente a `netNeedBaseMW` (disponibilidade hídrica independente da carga adicional de Data Centers), assegurando conservação horária com `06`.
  2. **Corte Solar-Eólico, H2V Flexível e CF Compensatório (`06` & `energyModel.ts`):** garantido piso não-negativo no limiar de escoamento (`export_threshold = max(0, export_limit_mw - EXPORT_SOLAR_CURTAILMENT_COEF * solar)`), acoplado o despacho `h2v_flexible` diretamente ao excedente líquido pré-H2V (`pre_h2v_margin >= export_threshold`), e introduzido `_compute_firm_wind_cf(seasonal_regime, offshore_share)` diferenciando o fator firme na calmaria por regime (`wet_calm = 0.14`, `annual_blend = 0.21`, `dry_windy = 0.34`) e pela participação marginal offshore pós-2031 (`firmWindCfOffshoreMarginal = 0.36`, ponderação até `0.5`).
  3. **Expansão de Cobertura Crítica na Grade Paramétrica (`export_simulator_monte_carlo_grid`):** adicionados pontos críticos para sensibilidade TX em `wet_calm` e `dry_windy` (`>= 2030`), grade `PUE × Utilização` em `wet_calm` para `dc_central` e `dc_high` (`>= 2032`) e sensibilidade TX para `dc_high` em `2035` (`annual_blend` e `wet_calm`), mantendo tempo multiprocessado e payload SSOT enxutos.
- **Critério de aceite:** Paridade física documentada entre `06_monte_carlo_balance_2035.py` e `src/utils/energyModel.ts`, além de consistência numérica `TX-03 == H2V-01 == Central × Intermediária == Evolução Anual 2035` (validado).

### Passo C3-3 — Execução Científica Completa, Materialização de Artefatos e Validação Cruzada
- **Status:** `[x]` **Concluído e validado em 2026-11-15 (`log_6bde40b9.txt`, `18/18` Python OK · `17/17` TypeScript OK).**
- **Ações técnicas concluídas:**
  1. `[x]` Confirmado `gHydroMW > 0` populado em `public/data/hourly-baseline-8760.json` e `reports/serie_base_horaria_8760h_ons.csv`.
  2. `[x]` Confirmada paridade absoluta de `2035` entre `evolucao_anual_risco_2026_2035.csv`, `matriz_cenarios_monte_carlo_2035.csv`, `TX-03` e `H2V-01`, bem como 696 cenários com trajetórias offshore pós-2031 na grade `grade_simulador_monte_carlo_2025_2035.csv`.
  3. `[x]` Corrigido `validate_ssot_cross_consistency` (`windCapacityMW` + `dcControl = "none"`) e sincronizado SSOT com `0` violações.
  4. `[x]` Reexecutada Etapa `05 -> 07 -> ssot` com `activation="silu"` no Estágio C2, confirmando `nonLinearHurdle.r2Volume (0,9340) > linearHurdle.r2Volume (0,9172)` e fechando `18/18` em `unittest` e `17/17` em `energyModel.test.ts`.
- **Critério de aceite:** `py -m unittest -v` **100% verde (`18/18`)** e `npm run test` **100% verde (`17/17`)** — **ATENDIDO**.

### Passo C3-4 — Fechamento Frontend, Verificação Ponta a Ponta e Congelamento de Entrega
- **Status:** `[x]` **Concluído e validado em 2026-11-15 (`18/18` Python OK · `17/17` TypeScript OK · Build/Lint OK · Browser Chromium OK).**
- **Objetivo:** Validar na interface real todos os fluxos impactados pelas calibrações do Ciclo 3 e congelar o código sem dívidas de build ou regressões visuais.
- **Arquivos atualizados:** `scripts/pipeline_metadata.json`, `src/components/Validation2025Panel.tsx`, `src/components/FeaturesAndAnovaView.tsx`, `src/components/ObjectiveAndSimulatorView.tsx`, `src/App.tsx` + bundle SSOT ressincronizado.
- **Ações técnicas concluídas:**
  1. `[x]` Atualizados diagnósticos do Modelo C (`ResMLP Hurdle C1+C2` com calibração Platt e ativação `SiLU`), KPI 3 e coluna `Energia 2025 (Pred. / Real)` (`23,24 / 25,70 TWh` vs. `22,53 / 25,70 TWh`) exclusivamente a partir do SSOT, além de legenda clara do toggle offshore pós-2031 e do despacho sazonal Chesf na barra horária.
  2. `[x]` Refinada barra de navegação principal (`App.tsx`) em linha única no desktop (`1440px`) e cabeçalho não fixo no mobile (`390×844`) para preservar área útil de leitura, com zero overflow horizontal e zero `style={{`.
  3. `[x]` Executada bateria completa (`python3 -m unittest`, `npx tsx --test src/utils/energyModel.test.ts`, `tsc --noEmit`, `vite build`) e inspeção visual em Chromium (`http://localhost:3000`) confirmando `hourly-baseline-8760.json` ativo (`8.760 h`), todas as abas/sub-abas funcionais e `0` erros/avisos de console.
- **Critério de aceite:** Build de produção limpo, todos os testes Python e TypeScript aprovados sem exceções e interface refletindo integralmente os resultados calibrados do Ciclo 3 — **ATENDIDO**.

---

## 4. Plano Sequencial de Execução — Ciclo 4 (Corretude Científica, Otimização e Desacoplamento)

> **Regra de Execução:** O Ciclo 4 fortalece os contratos tipados do SSOT, elimina fragilidades científicas residuais (data leakage em lags e seleção/vetorização em Monte Carlo), acelera o motor reativo frontend e promove reexecução integral ponta a ponta mantendo causalidade estrita e 100% de rastreabilidade.

### Passo C4-1 — Contratos Estruturados SSOT, Eliminação de Fachadas Legadas e Alinhamento de Configuração
- **Status:** `[x]` **Concluído e validado em 2026-11-16 (`19/19` Python OK · `17/17` TypeScript OK · `tsc --noEmit` & `vite build` sem warnings).**
- **Objetivo:** Erradicar seletores frágeis por substring, remover fachadas TypeScript órfãs em `src/data/`, alinhar `DC_SCENARIOS_IT_MW` com `data_centers_pipeline_ne.csv`, externalizar `approvedLibrariesPolicy`, versionar `localStorage` e eliminar o aviso de `__dirname` no Vite 8.
- **Arquivos atualizados / removidos:** `scripts/config.py`, `scripts/pipeline_metadata.json`, `scripts/03_feature_engineering_anova.py`, `scripts/04_forecast_demanda_base.py`, `scripts/05_forecast_wind_cf_and_curtailment.py`, `scripts/07_sensitivity_and_final_report.py`, `scripts/sync_frontend_ssot.py`, `scripts/test_sync_frontend_ssot.py`, `vite.config.ts`, `src/data/pipelineTypes.ts`, `src/data/pipelineSsotContext.tsx`, `src/App.tsx`, `src/components/featuresAnovaKpis.ts`, `src/components/ObjectiveAndSimulatorView.tsx`, `src/components/Validation2025Panel.tsx`, `src/components/SensitivityPasso5Panel.tsx`, `src/components/ScriptsPipelineView.tsx`, `src/utils/energyModel.test.ts` + remoção de `dataCentersPipelineCatalog.ts`, `featuresAnovaCatalog.ts` e `scriptsRoadmap.ts`.
- **Ações técnicas concluídas:**
  1. `[x]` Adicionados IDs estruturados (`alvo_id`/`targetId`, `horizonte_id`/`horizonId`, `modelo_id`/`modelId`, `familia_id`/`familyId`, `codigo_config`/`configCode`, `codigo_cenario`/`scenarioCode`, `modo_flex`/`flexMode`) com backfill determinístico no SSOT (`schemaVersion = 2.1.0`) e substituição de todos os seletores `.includes(...)`/`.startsWith(...)`/`.str.contains(...)` em `07`, `sync_frontend_ssot.py`, componentes UI e testes.
  2. `[x]` Alinhado `DC_SCENARIOS_IT_MW` via `compute_dc_scenarios_it_mw()` (`none: 0, conservative: 465, central: 1595, high: 3495 MW IT`).
  3. `[x]` Migrado `APPROVED_LIBRARIES_POLICY` para `scripts/pipeline_metadata.json` (`approvedLibrariesPolicy`), publicado no SSOT e renderizado em `ScriptsPipelineView.tsx`; removidas as 3 fachadas legadas de `src/data/`.
  4. `[x]` Persistência de decisões e checklist em `src/App.tsx` versionada por `ssot.schemaVersion` e sanitizada contra IDs válidos do catálogo; `vite.config.ts` atualizado para `import.meta.dirname`.

### Passo C4-2 — Correções Científicas Críticas nos Modelos Preditivos e Estocásticos
- **Status:** `[x]` **Concluído e validado em 2026-11-16 (`22/22` Python OK · SSOT ressincronizado · `py_compile`, `tsc --noEmit` & `vite build` sem warnings).**
- **Objetivo:** Corrigir vazamento de fronteira temporal na fronteira Treino (`2024`) → Teste (`2025`) nos lags (`1h`/`24h`/`168h`), eliminar *look-ahead bias* em `ml_models_numpy.py` (Platt scaling e seleção de regularização rigorosamente OOF sem ajuste no conjunto completo antes da calibração), vetorizar o motor `simulate_block_bootstrap` e garantir consistência físico-estatística absoluta entre `05`, `06` e `07`.
- **Arquivos atualizados:** `scripts/config.py`, `scripts/03_feature_engineering_anova.py`, `scripts/04_forecast_demanda_base.py`, `scripts/05_forecast_wind_cf_and_curtailment.py`, `scripts/ml_models_numpy.py`, `scripts/06_monte_carlo_balance_2035.py`, `scripts/07_sensitivity_and_final_report.py`, `scripts/test_sync_frontend_ssot.py` + bundle SSOT ressincronizado.
- **Ações técnicas concluídas:**
  1. `[x]` Eliminado vazamento inter-split `2024 -> 2025` em `03_feature_engineering_anova.py` via `split_and_build_causal_features` (split cronológico prévio ao cálculo de lags `1h/24h/168h` e janelas móveis; imputação estritamente pelas medianas do treino em `04` e `05` Modelo B/C via `impute_with_train_medians`).
  2. `[x]` Substituída a CV bidirecional (`tr_mask = ~val_mask`) em `ml_models_numpy.py` (`ResidualMLPRegressor` e `ResidualMLPClassifier`) por `build_forward_time_series_folds` estritamente cronológica em janela expansiva com embargo (`48 h`), calibração Platt desacoplada (*nested forward-OOF*) e métricas auditáveis (`cv_fold_count_`, `cv_oof_mse_`, `cv_oof_auc_`, `cv_oof_brier_`), além de embargo de `168 h` (`backtestEmbargoHours`) e `ridge_r2`/`resmlp_r2` no backtest do Modelo A (`04`).
  3. `[x]` Vetorizados `simulate_block_bootstrap` (`_evaluate_bootstrap_batch` em chunks matriciais `[batch_n, 168]`) e `run_bottom_up_project_monte_carlo` (`proj_demands @ sub_indicator`, sem `iterrows()` no loop) em `06_monte_carlo_balance_2035.py`, garantindo paridade física de `offshore_cf_gain` e `cf_ceiling` entre `06` (`simulate_block_bootstrap`, bottom-up) e `07`.
  4. `[x]` Adicionados 3 testes unitários específicos de C4-2 em `scripts/test_sync_frontend_ssot.py` validando não-vazamento `2024 -> 2025`, CV cronológica sem *look-ahead*, determinismo vetorizado e invariância física.
- **Critério de aceite:** Zero vazamento inter-split (`2024 -> 2025`), métricas auditáveis no backtest `TimeSeriesSplit`, vetorização matricial de `06` e testes unitários de não-vazamento/invariância em `test_sync_frontend_ssot.py` — **ATENDIDO**.

### Passo C4-3 — Otimização do Motor Reativo Frontend & Performance de Interface
- **Status:** `[x]` **Concluído e validado em 2026-11-16 (`19/19` TypeScript OK · `22/22` Python OK · `tsc --noEmit` & `vite build` sem warnings · Browser Chromium OK).**
- **Objetivo:** Otimizar `estimateFullYearHourly` e `buildHourlyPlotBuckets` para responsividade sub-frame nos sliders, decompor `ObjectiveAndSimulatorView.tsx` e `Validation2025Panel.tsx` em subcomponentes coesos, e separar explicitamente a apresentação de diagnóstico histórico `2025` vs. projeções `2035`.
- **Arquivos atualizados / criados:** `src/utils/energyModel.ts`, `src/utils/energyModel.test.ts`, `src/components/ObjectiveAndSimulatorView.tsx`, `src/components/StudySynthesisSection.tsx`, `src/components/SimulatorControlsPanel.tsx`, `src/components/SimulatorHourlyChartSection.tsx`, `src/components/ExecutiveDeliverySection.tsx`, `src/components/Validation2025Panel.tsx`, `src/components/Validation2025HourlyChart.tsx`, `src/components/Validation2025BenchmarkTables.tsx`, `src/components/FeaturesAndAnovaView.tsx`.
- **Ações técnicas concluídas:**
  1. `[x]` Otimizado `src/utils/energyModel.ts`: aritmética `round1`/`round4` (eliminando ~105.120 alocações `.toFixed` por atualização de slider), cache `WeakMap` de labels horários `8.760 h` (`getBaselineTimestampLabels`), lookup `Float64Array` de sazonalidade Chesf fora do loop, zero-clone no slice `'year'` via `WeakSet`, pré-alocação em `buildHourlyPlotBuckets` e varredura IDW O(N) top-4 sem ordenação/objetos temporários em `resolveMonteCarloSummary` (reduzindo execução média de `45,87 ms` para `9,44 ms`, speedup `~4,9×`).
  2. `[x]` Desacoplados `estimateAnnualSimulation` e `summarizeHourlyWindow` em `ObjectiveAndSimulatorView.tsx` via `useMemo` independentes: alternâncias de escala (`Dia`/`Semana`/`Mês`/`Trimestre`/`Ano`) fatiamento-only não recomputam `8.760 h` nem Monte Carlo, e o scrubber horário (`inspectedHour`) atualiza apenas o cursor O(1) e a barra inspetora em `SimulatorHourlyChartSection.tsx` sem reconstruir as polylines/envelopes SVG.
  3. `[x]` Decompostos `ObjectiveAndSimulatorView.tsx` (4 subcomponentes especializados) e `Validation2025Panel.tsx` (`Validation2025HourlyChart.tsx` + `Validation2025BenchmarkTables.tsx`), separando visualmente **Diagnóstico Histórico Out-of-Time · 2025** de **Projeção Estocástica · 2035** em `FeaturesAndAnovaView.tsx`, `StudySynthesisSection.tsx`, `ExecutiveDeliverySection.tsx` e tabelas de validação.
  4. `[x]` Adicionados testes unitários C4-3 em `src/utils/energyModel.test.ts` validando paridade numérica integral entre caminho desacoplado e `evaluateScenario`, não-mutação de `fullYearSeries`, reuso do cache de timestamps e orçamento sub-frame real em `hourly-baseline-8760.json`.
- **Critério de aceite:** Redução mensurável de alocação no loop horário de `8.760 h`, componentes modulares sem regressão visual e suíte TS integralmente aprovada — **ATENDIDO**.

### Passo C4-4 — Reexecução Científica Integral & Materialização da Base Calibrada
- **Status:** `[ ]` **Pendente**.
- **Objetivo:** Reexecutar `python3 scripts/run_pipeline.py --skip-ingest` (ou pipeline completo `01..07 -> ssot` em ambiente científico Python com NumPy/SciPy/Pandas), materializar CSVs com as novas colunas estruturadas (`alvo_id`, `horizonte_id`, `modelo_id`, `familia_id`, `codigo_config`, `codigo_cenario`, `modo_flex`), métricas sem leakage e grade Monte Carlo atualizada, e ressincronizar `public/data/` e `src/data/generated/pipelineSsot.ts`.
- **Critério de aceite:** `validate_ssot_cross_consistency` com `0` violações nos artefatos materializados ao vivo e `test_live_report_cross_consistency_when_regenerated_post_passo_2` ativo sem skip.

### Passo C4-5 — Validação Ponta a Ponta, Acessibilidade, Responsividade e Fechamento Ciclo 4
- **Status:** `[ ]` **Pendente**.
- **Objetivo:** Executar auditoria integral final (Python `unittest`, TS `node:test`, `tsc --noEmit`, `vite build`), validar contraste, acessibilidade (ARIA/teclado) e responsividade em desktop (`1440×900`) e mobile (`390×844`) no Chromium, e congelar a documentação do Ciclo 4.
- **Critério de aceite:** `0` erros/avisos de build/console/layout em todos os viewports e encerramento formal do Ciclo 4.

