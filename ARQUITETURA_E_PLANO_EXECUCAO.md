# Documento Base de Arquitetura e Plano Sequencial de Execução (Ciclo 3)

**Projeto:** Balanço Eólico & Data Centers NE 2035 (PTC3567 · Grupo 6)  
**Estado Atual:** Ciclos 1–2 + Saneamento Pré-Ciclo 3 + **Código & SSOT dos Passos C3-1 e C3-2 concluídos** · Aguardando Passo C3-3 (execução científica do Ciclo 3)  
**Data de Referência:** 2026-11-15  
**Finalidade:** Documentar exclusivamente a arquitetura vigente do sistema, o diagnóstico técnico quantitativo de entrada e os próximos passos sequenciais do **Ciclo 3** (engenharia elétrica, ciência de dados e calibração física dos modelos).

---

## 1. Arquitetura Atual do Sistema

### 1.1 Raiz e Toolchain de Build
- `package.json`: SPA React 19 + Vite 8 + Tailwind CSS v4 + TypeScript 7 (`esbuild`, `tsx`), scripts `dev` (porta `3000`), `build`, `lint` (`tsc --noEmit`), `sync:ssot` e `test`.
- `tsconfig.json` / `vite.config.ts` / `metadata.json` / `index.html` / `src/index.css` / `src/main.tsx`: configuração padrão da SPA com Tailwind CSS (`@import "tailwindcss";`) e metadados do runtime.
- `.gitignore`: exclui `node_modules/`, `dist/`, `build/`, `coverage/`, `__pycache__/`, `*.py[cod]`, `.playwright-cli/`, `data/raw/ons_*.csv` e `data/processed/*.csv`.

### 1.2 Esteira Analítica Python (`/scripts`)
Toda a parametrização numérica, física e editorial converge em fonte única (`scripts/config.py` + `scripts/pipeline_metadata.json`), sem valores hardcoded espalhados entre scripts ou UI:
- `scripts/config.py`: fonte única de parâmetros físicos, horizontes (`2015–2025` histórico, `BASELINE_YEAR = 2025`, projeção `2025–2035`, `HOURS_PER_YEAR = 8760`, `BLOCK_SIZE_HOURS = 168`, `OFFSHORE_COMMERCIAL_START_YEAR = 2032`), limites SIN (`BASE_WIND_ONSHORE_2026_MW = 29600`, `INTERCHANGE_IMPORT_LIMIT_MW = 7000`, `INTERCHANGE_EXPORT_LIMIT_MW = 9500`), despacho Chesf, taxas PDE/solar (`3,1% a.a.` / `4,5% a.a.`), parâmetros Monte Carlo (`1000` iterações unificadas em `iterationsMain` e `iterationsTimeline`, `seed = 42`), especificações `TX-01..TX-05` e `H2V-01..H2V-05`, hiperparâmetros `ML_MODEL_PARAMS`, bounds de sliders e `ONS_S3_URL_TEMPLATES`.
- `scripts/pipeline_metadata.json`: catálogo editorial externo (`dcProjectNotes`, `featureMetadata`, `scriptsCatalog` e `uiCatalog` com bases oficiais, decisões de grupo, janelas de observação e regimes sazonais).
- `scripts/ml_models_numpy.py`: modelos implementados em NumPy/SciPy (`LinearRidgeModel`, `LogisticLBFGSModel`, `ResidualMLPRegressor`, `ResidualMLPClassifier`, `HistogramGBDTRegressor`, `HistogramGBDTClassifier` e métricas de regressão/classificação).
- `scripts/01_ingest_ons_aneel_epe.py`: ingestão de dados oficiais ONS/ANEEL (`2015–2025`), download paralelo de `RESTRICAO_COFF_EOLICA` (`2023–2025`), mapeamento unificado (`g_termica_mw`, `g_hidro_mw`) e geração eólica potencial (`verificada + curtailment`).
- `scripts/02_build_dc_and_offshore_scenarios.py`: modelagem bottom-up de 14 projetos (`data/raw/data_centers_pipeline_ne.csv`), rampa anual `2026–2035`, regra de não-duplicação de PUE, concentração por chave composta `(subestacao_conexao, estado, tensao_conexao_kv)` e matriz `DC × Eólica` (com offshore comercial pós-2031 no cenário `high`).
- `scripts/03_feature_engineering_anova.py`: features causais (lags `1h/24h/168h`, janelas móveis deslocadas, harmônicos de Fourier, termos aerodinâmicos), testes ANOVA (`scipy.stats.f_oneway`), perfil mensal e divisão temporal Treino (`2015–2024`, `87.476 h`) vs. Teste Cego (`2025`, `8.760 h`).
- `scripts/04_forecast_demanda_base.py`: Modelo A (`L_base(t)` em `1h` e `24h`), backtest `TimeSeriesSplit` e ancoragem PDE `2035`.
- `scripts/05_forecast_wind_cf_and_curtailment.py`: Modelo B (`cf_eolica(t)` em `1h` e `24h`) e Modelo C Hurdle em 2 estágios treinado em `>= 2023-09-01` (Estágio C1 ocorrência + Estágio C2 volume) com exportação dos perfis comparativos `ResMLP` de 2025.
- `scripts/06_monte_carlo_balance_2035.py`: núcleo estocástico `simulate_block_bootstrap` (`seed = 42`, `Common Random Numbers`, modulação Chesf e suporte H2V), gerador da matriz de 12 cenários, curva compensatória, evolução anual `2025–2035` (com `2035` ancorado exatamente à matriz principal), risco bottom-up por projeto/subestação, exportador da série real de `8.760 h` (`build_and_export_hourly_baseline_8760`) e exportador da grade paramétrica `2025–2035` (`export_simulator_monte_carlo_grid`, incluindo variantes offshore pós-2031).
- `scripts/07_sensitivity_and_final_report.py`: análises de sensibilidade `TX-01..TX-05` e `H2V-01..H2V-05` via `simulate_block_bootstrap`, indicadores ANEEL vs. ONS `2015–2035`, relatório técnico Markdown parametrizado e disparo de `sync_frontend_ssot()`.
- `scripts/run_pipeline.py`: orquestrador único (`01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> ssot`) com `--skip-ingest`, `--only-from` e `--dry-run`.
- `scripts/sync_frontend_ssot.py`: gerador do contrato SSOT dual (`public/data/pipeline-ssot.json` + `src/data/generated/pipelineSsot.ts`), com parsers defensivos PT-BR/EN, checagem cruzada bloqueante `validate_ssot_cross_consistency` e embarque literal de `scripts/*.py` e `config`.
- `scripts/test_sync_frontend_ssot.py`: suíte `unittest` (17 testes) em Python puro (stdlib) validando parsers, orquestrador, chave composta de subestações, consistência cruzada, contratos do simulador, guardrails C3-1/C3-2 e anti-hardcode.

### 1.3 Artefatos de Dados, Relatórios e Contratos SSOT (`/data`, `/reports`, `/public`)
- `data/raw/` e `data/scenarios/`: cadastro de data centers, série de concentração por subestação e matriz anual `matriz_cenarios_dc_eolica_2026_2035.csv`. *(CSVs massivos do ONS e `data/processed/*.csv` são gerados localmente em ambiente Python científico e ignorados no Git.)*
- `reports/`: 18 CSVs analíticos (incluindo `serie_base_horaria_8760h_ons.csv` e `grade_simulador_monte_carlo_2025_2035.csv` com 536+ linhas) + `relatorio_final_consolidado_ptc3567_grupo6.md`.
- `public/data/hourly-baseline-8760.json`: série horária real de `8.760 h` em formato colunar compacto (`annual_blend`, `dry_windy`, `wet_calm`) validada por digest SHA-256 (`hoursCount = 8760`).
- `public/data/pipeline-ssot.json` & `src/data/generated/pipelineSsot.ts`: artefatos SSOT sincronizados (`schemaVersion = 2.0.0`).
- `public/assets/`: documento PDF de referência do Plano Orientador.

### 1.4 Camada Frontend (`/src`)
- `src/data/pipelineTypes.ts` e `src/data/pipelineSsotContext.tsx`: tipagem integral (`PipelineSsotBundle`, `HourlyBaseline8760Bundle`, `SimulatorMonteCarloGridRow`) e `PipelineSsotProvider` com carregamento condicional por digest de `pipeline-ssot.json` e `hourly-baseline-8760.json`.
- `src/data/dataCentersPipelineCatalog.ts`, `src/data/featuresAnovaCatalog.ts`, `src/data/scriptsRoadmap.ts`: fachadas tipadas sobre o SSOT.
- `src/utils/energyModel.ts` e `src/utils/energyModel.test.ts`:
  - Motor determinístico real-time de **ano completo (`8.760 h`)** para qualquer ano em **`2025–2035`** com fatiamento multi-escala (`Dia`, `Semana`, `Mês`, `Trimestre`, `Ano`) e agregador `buildHourlyPlotBuckets`.
  - Resolvedor estocástico `resolveMonteCarloSummary` orientado exclusivamente à **grade paramétrica Python** (`grid_exact`, interpolação IDW 5D para anos intermediários/sliders contínuos e interpolação linear em GW para eólica intermediária/offshore) e âncoras SSOT oficiais (`ssot_anchor`), retornando `'unavailable'` honestamente para fatias sem suporte paramétrico (**zero simulação sintética em JavaScript**).
- `src/utils/csvExport.ts`: exportador unificado CSV (BOM UTF-8 + `;`), `.md`, `.json` e `.py`.
- `src/App.tsx` e `src/components/`:
  - `ObjectiveAndSimulatorView.tsx` (síntese + simulador interativo `8.760 h` `2025–2035`)
  - `DataCentersPipelineView.tsx` (14 projetos + filtro por chave composta `${substation}::${voltageKV}`)
  - `FeaturesAndAnovaView.tsx` + `featuresAnovaKpis.ts` + `Validation2025Panel.tsx`, `MonteCarlo2035Panel.tsx`, `SensitivityPasso5Panel.tsx`, `AnovaCorrelationsPanel.tsx`
  - `DatabasesExplorerView.tsx`, `ScriptsPipelineView.tsx`, `DecisionsAndPdfView.tsx`
  - **Contrato visual:** zero estilos inline (`style={{`) e zero fallbacks numéricos inventados.

---

## 2. Diagnóstico Técnico na Entrada do Ciclo 3

### 2.1 Últimos Resultados Científicos Registrados (Teste Cego `2025`, `8.760 h`)
| Modelo / Horizonte | Família Linear | Challenger ResMLP (Não-Linear) | Challenger Hist-GBDT | Situação |
|---|---|---|---|---|
| **Modelo A · Demanda Base (`1h`)** | Ridge `MAE 222,89 MW` (`R² 0,9479`) | `MAE 158,51 MW` (`MAPE 1,22%`, `R² 0,9721`) | `MAE 187,45 MW` (`R² 0,9594`) | ResMLP vence |
| **Modelo A · Demanda Base (`24h`)** | Ridge `MAE 398,48 MW` (`R² 0,8155`) | `MAE 309,59 MW` (`MAPE 2,37%`, `R² 0,8767`) | `MAE 349,47 MW` (`R² 0,8502`) | ResMLP vence |
| **Modelo B · CF Eólico (`1h`)** | Ridge `MAE 0,0211` (`R² 0,9783`) | `MAE 0,0173` (`517,5 MW`, `R² 0,9853`) | `MAE 0,0203` (`R² 0,9791`) | ResMLP vence |
| **Modelo B · CF Eólico (`24h`)** | Ridge `MAE 0,0810` (`R² 0,6985`) | `MAE 0,0801` (`R² 0,7039`) | `MAE 0,0806` (`R² 0,7011`) | ResMLP vence com margem estreita |
| **Modelo C · Estágio C1 (Ocorrência)** | Logística `ROC-AUC 0,9289` (`Brier 0,1208`, `F1 0,8863`) | `ROC-AUC 0,9051` (`Brier 0,1510`, `F1 0,8616`) | `ROC-AUC 0,9097` (`Brier 0,1419`, `F1 0,8611`) | **Gate aberto (Logística ainda vence C1)** |
| **Modelo C · Estágio C2 (Volume)** | Ridge `R² 0,5790` (`MAE 1.482,2 MW`, `15,21 TWh`) | `R² 0,6561` (`MAE 1.385,1 MW`, `16,43 TWh`) | `R² 0,5746` (`MAE 1.465,6 MW`, `15,38 TWh`) | ResMLP vence em `R²`, subestima total anual (`25,70 TWh` real) |

### 2.2 Saneamento Pré-Ciclo 3 Aplicado e Estado dos Testes
- **Corrigido em código antes do Ciclo 3:**
  1. `scripts/06_monte_carlo_balance_2035.py`: mapeamento `g_hidraulica_mw -> g_hidro_mw` em `build_and_export_hourly_baseline_8760`, inclusão das variantes offshore pós-2031 (`high` sem offshore e `intermediate` com offshore) em `export_simulator_monte_carlo_grid` e ancoragem exata da linha `2035` da evolução anual em `res_12`.
  2. `scripts/config.py`: unificação `iterationsTimeline = 1000` (`== iterationsMain`) eliminando a discrepância estatística em `2035` (`9,6%` vs `9,3%`).
  3. `src/utils/energyModel.ts`: interpolação 5D entre anos-âncora para anos intermediários (`2026`, `2027`, `2029`, `2031`, `2033`, `2034`), retorno `'unavailable'` honesto quando o recorte não possui variação paramétrica no eixo alterado, e interpolação em GW para `windScenario = 'high'` sem offshore sem colisão com `48,0 GW`.
- **Pendência para materialização em disco (executar no ambiente Python científico durante o Ciclo 3):** os CSVs/JSON atuais em `reports/` e `public/data/hourly-baseline-8760.json` ainda refletem a execução pré-saneamento (`gHydroMW = 0` no baseline `8.760 h`, `9,6%` na linha `2035` de `evolucao_anual_risco_2026_2035.csv` e ausência das linhas `44,4 GW` sem offshore na grade). Todos serão regenerados automaticamente ao rodar `run_pipeline.py --skip-ingest` no Ciclo 3.
- **Estado atual das suítes:** `17/17` testes Python (`unittest`) aprovados; `16/17` subtestes TypeScript (`energyModel.test.ts`) aprovados — restando exclusivamente o **Subteste 10** (gate científico do Modelo C Estágio C1 em `2025` out-of-time, cuja materialização nos CSVs depende da reexecução `--only-from 03` no Passo C3-3).

---

## 3. Plano Sequencial de Execução — Ciclo 3 (Engenharia Elétrica, Ciência de Dados e Calibração)

> **Regra de Execução:** Os passos abaixo evoluem rigorosamente a modelagem física e de ML dentro da arquitetura existente (`scripts/config.py` → `03..07` → `sync_frontend_ssot.py`), preservando causalidade estrita (`Treino <= 2024` / `Teste = 2025`), chave composta de subestações e contrato SSOT sem dados sintéticos.

### Passo C3-1 — Engenharia de Features Elétricas e Generalização Out-of-Time do Modelo C (Estágios C1 e C2)
- **Status:** `[x]` **Código e SSOT implementados em 2026-11-15** *(aguarda reexecução `--only-from 03` em ambiente Python científico no Passo C3-3 para materializar os novos CSVs de métricas `2025` e fechar o Subteste 9)*.
- **Objetivo:** Fazer a família não-linear superar a regressão logística também no **Estágio C1** (`ROC-AUC > 0,9289`, `Brier < 0,1208`, `F1 > 0,8863` no teste cego `2025`), fechando o Subteste 9, e reduzir o viés de subestimação volumétrica no **Estágio C2** (`16,43 TWh` vs. `25,70 TWh` reais em `2025`).
- **Arquivos atualizados:** `scripts/config.py`, `scripts/03_feature_engineering_anova.py`, `scripts/ml_models_numpy.py`, `scripts/05_forecast_wind_cf_and_curtailment.py`, `scripts/pipeline_metadata.json`, `scripts/test_sync_frontend_ssot.py` + bundle SSOT.
- **Implementação aplicada (zero data leakage, `< 2025`):**
  1. **`03_feature_engineering_anova.py` & `pipeline_metadata.json`:** adicionadas features causais de saturação do corredor SIN (`folga_escoamento_sin_mw`, hinge `excesso_sobre_escoamento_mw`), coincidência horária solar × eólica (`interacao_solar_eolica_mw`), rampas/médias causais de excedente (`rampa_excedente_1h_mw`, `excedente_renovavel_roll_mean_24h`, `excedente_renovavel_roll_max_24h`) e ocupação hidráulica causal Chesf 24h (`g_hidro_roll_mean_24h` e `despacho_total_est_excesso_mw`).
  2. **`ml_models_numpy.py` & `config.py`:** adicionado suporte uniforme a `sample_weight` nos 6 estimadores; corrigida a sub-regularização de `W1` em `ResidualMLPClassifier`, substituído o split final único (Safra) por validação cruzada em blocos temporais (`cv_folds = 4` em `reg_l2_grid`) + calibração logística monotônica (*Platt scaling* out-of-fold `< 2025`) + *ensemble* multi-seed (`nEnsemble = 3`), além de maior regularização foliar em GBDT (`l2LeafReg = 12.0` / `10.0`).
  3. **`05_forecast_wind_cf_and_curtailment.py`:** substituídos `month_sin`/`month_cos` em `FEATURES_CURTAILMENT` por `cap_eolica_instalada_mw`, folga/hinge de escoamento, estado causal de intercâmbio/CF e ocupação Chesf 24h; adicionada imputação `_impute_with_train_medians` (apenas treino) e ponderação temporal linear simétrica (`modelCRecencyMinWeight = 0.35` até `1.0`) aplicada igualmente às famílias Linear e Não-Lineares nos estágios C1 e C2.
- **Critério de aceite (validado no Passo C3-3):** Reexecução `--only-from 03` em ambiente Python científico produzindo `nonLinear.rocAuc > linear.rocAuc`, `nonLinear.brierScore < linear.brierScore`, `nonLinear.f1Score >= linear.f1Score` e `nonLinear.r2Volume > linear.r2Volume` em `reports/metricas_modelos_b_c_eolica_curtailment.csv`.

### Passo C3-2 — Refinamento de Engenharia Elétrica nos Balanços Horário (`8.760 h`) e Estocástico (`06` & `07`)
- **Status:** `[x]` **Código e SSOT implementados em 2026-11-15** *(aguarda reexecução `--only-from 03` em ambiente Python científico no Passo C3-3 para materializar a grade expandida e as novas séries horárias `8.760 h` com `gHydroMW > 0`)*.
- **Objetivo:** Aprofundar o realismo físico-operativo do despacho no subsistema Nordeste e eliminar simplificações de primeira ordem identificadas nos Ciclos 1–2.
- **Arquivos atualizados:** `scripts/config.py`, `scripts/06_monte_carlo_balance_2035.py`, `scripts/07_sensitivity_and_final_report.py`, `src/data/pipelineTypes.ts`, `src/utils/energyModel.ts`, `scripts/test_sync_frontend_ssot.py`, `src/utils/energyModel.test.ts` + bundle SSOT.
- **Implementação aplicada (paridade estrita Python ↔ TypeScript):**
  1. **Despacho Hidrotérmico Sazonal Chesf (`06`, `07` & `energyModel.ts`):** `_prepare_seasonal_blocks` passa a carregar `month`, `g_hidro_mw`/`g_hidraulica_mw` e `g_termica_mw`; `_compute_chesf_hydro_thermal_dispatch` e `computeChesfDispatchMW` aplicam sazonalidade da bacia do São Francisco (estação úmida Dez–Mai com `wetFloorBonusMW = +650 MW` e `wetSlope = 0.62`, estação seca Ago–Nov com `drySlope = 0.50`, transição intermediária), parcela de inflexibilidade térmica (`thermalInflexWeight = 0.35`) e ancoragem empírica (`hydroObsBlend = 0.25`) quando `g_hidro_mw > 0`. Em `estimateFullYearHourly`, o despacho Chesf passa a responder exclusivamente a `netNeedBaseMW` (disponibilidade hídrica independente da carga adicional de Data Centers), assegurando conservação horária com `06`.
  2. **Corte Solar-Eólico, H2V Flexível e CF Compensatório (`06` & `energyModel.ts`):** garantido piso não-negativo no limiar de escoamento (`export_threshold = max(0, export_limit_mw - EXPORT_SOLAR_CURTAILMENT_COEF * solar)`), acoplado o despacho `h2v_flexible` diretamente ao excedente líquido pré-H2V (`pre_h2v_margin >= export_threshold`), e introduzido `_compute_firm_wind_cf(seasonal_regime, offshore_share)` diferenciando o fator firme na calmaria por regime (`wet_calm = 0.14`, `annual_blend = 0.21`, `dry_windy = 0.34`) e pela participação marginal offshore pós-2031 (`firmWindCfOffshoreMarginal = 0.36`, ponderação até `0.5`).
  3. **Expansão de Cobertura Crítica na Grade Paramétrica (`export_simulator_monte_carlo_grid`):** adicionados pontos críticos para sensibilidade TX em `wet_calm` e `dry_windy` (`>= 2030`), grade `PUE × Utilização` em `wet_calm` para `dc_central` e `dc_high` (`>= 2032`) e sensibilidade TX para `dc_high` em `2035` (`annual_blend` e `wet_calm`), mantendo tempo multiprocessado e payload SSOT enxutos.
- **Critério de aceite:** Paridade física documentada entre `06_monte_carlo_balance_2035.py` e `src/utils/energyModel.ts`, além de consistência numérica `TX-03 == H2V-01 == Central × Intermediária == Evolução Anual 2035` (validado em execução científica no Passo C3-3).

### Passo C3-3 — Execução Científica Completa, Materialização de Artefatos e Validação Cruzada
- **Objetivo:** Executar a esteira completa em ambiente Python científico (`numpy`/`pandas`/`scipy`), materializando todos os CSVs, `.md`, `hourly-baseline-8760.json` e `pipeline-ssot.json`/`pipelineSsot.ts`.
- **Comandos-alvo:** `python scripts/run_pipeline.py --skip-ingest` (ou execução integral desde `01` caso haja atualização de base ONS/ANEEL).
- **Ações técnicas:**
  1. Confirmar `gHydroMW > 0` populado em `public/data/hourly-baseline-8760.json` e `reports/serie_base_horaria_8760h_ons.csv`.
  2. Confirmar paridade absoluta de `2035` entre `evolucao_anual_risco_2026_2035.csv`, `matriz_cenarios_monte_carlo_2035.csv`, `sensibilidade_transmissao_intercambio_2035.csv` (`TX-03`) e `sensibilidade_h2v_eletrointensivos_2035.csv` (`H2V-01`), bem como presença das trajetórias offshore pós-2031 na grade `grade_simulador_monte_carlo_2025_2035.csv`.
  3. Confirmar aprovação de `validate_ssot_cross_consistency` sem warnings ou desvios entre relatório Markdown final e DataFrames.
- **Critério de aceite:** `python -m unittest discover -s scripts -v` **100% verde** e `npx tsx --test src/utils/energyModel.test.ts` **100% verde (incluindo Subteste 10 — gate científico do Modelo C C1)**.

### Passo C3-4 — Fechamento Frontend, Verificação Ponta a Ponta e Congelamento de Entrega
- **Objetivo:** Validar na interface real todos os fluxos impactados pelas calibrações do Ciclo 3 e congelar o código sem dívidas de build ou regressões visuais.
- **Arquivos-alvo:** `src/components/Validation2025Panel.tsx`, `src/components/ObjectiveAndSimulatorView.tsx`, `src/utils/energyModel.test.ts`, `scripts/test_sync_frontend_ssot.py`.
- **Ações técnicas:**
  1. Atualizar tooltips, legendas e diagnósticos de Modelo C / despacho hidrotérmico nos painéis frontend exclusivamente a partir de `ssot`, caso novos campos/métricas entrem no contrato `PipelineSsotBundle`.
  2. Executar bateria completa de qualidade (`unittest`, `tsx --test`, `tsc --noEmit`, `vite build`) e inspeção visual/funcional em navegador real (`http://localhost:3000`) com 0 erros de console e 0 estilos inline.
- **Critério de aceite:** Build de produção limpo, todos os testes Python e TypeScript aprovados sem exceções e interface refletindo integralmente os resultados calibrados do Ciclo 3.
