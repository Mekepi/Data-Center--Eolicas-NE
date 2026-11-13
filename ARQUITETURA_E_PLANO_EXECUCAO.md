# Documento Base de Arquitetura e Plano Sequencial de Execução

**Projeto:** Balanço Eólico & Data Centers NE 2035 (PTC3567 · Grupo 6)  
**Marco de Referência:** Pós-alteração `3.B` · Passos 1, 2, 3 e `3.B` (código + SSOT) concluídos em 2026-11-13  
**Data da Última Atualização:** 2026-11-13  
**Finalidade:** Servir como referência técnica fiel da estrutura atual do código, das fragilidades arquiteturais mapeadas e do roteiro sequencial (Passos 1 a 5 + `3.B`) para execução ordenada das correções.

---

## 1. Mapa da Estrutura Atual do Projeto

### 1.1 Raiz e Configuração
- `package.json`: SPA React 19 + Vite 8 (`^8.3.0`) + Tailwind CSS v4 (`^4.3.3`) + TypeScript 7 (`^7.0.2`), com `esbuild ^0.28.0` e `tsx ^4.23.15` atualizados no pull (`dev` na porta 3000, `build`, `lint`, `sync:ssot`, `test`). Mantém dependências herdadas de template (`express`, `@types/express`, `dotenv`, `@google/genai`, `motion`) ainda não utilizadas.
- `tsconfig.json`: compilação estrita sem emissão (`noEmit: true`), `target: ES2022`, `moduleResolution: bundler`.
- `vite.config.ts`: configuração Vite padrão para SPA.
- `metadata.json`: metadados do applet (`name`, `description`, `majorCapabilities`).
- `.gitignore`: ignora `node_modules/`, `build/`, `dist/`, `coverage/`, `.DS_Store`, `*.log`, `.env*`.
- `index.html` / `src/index.css` / `src/main.tsx`: ponto de entrada React com Tailwind (`@import "tailwindcss";`).

### 1.2 Esteira Analítica Python (`/scripts`)
- `scripts/config.py`: diretórios do projeto (`RAW_DATA_DIR`, `PROCESSED_DATA_DIR`, `SCENARIOS_DATA_DIR`, `REPORTS_DIR`), limites físicos do subsistema NE (`BASE_WIND_ONSHORE_2026_MW = 29600.0`, `BASE_HYDRO_THERMAL_MW = 4150.0`, `INTERCHANGE_IMPORT_LIMIT_MW = 7000.0`, `INTERCHANGE_EXPORT_LIMIT_MW = 9500.0`), cenários (`DC_SCENARIOS_IT_MW`, `WIND_EXPANSION_ONSHORE_MW`), parâmetros `DEFAULT_PUE = 1.28`, `DEFAULT_UTILIZATION = 0.80` e `OFFICIAL_DATA_URLS`.
- `scripts/__init__.py`: inicializador leve para habilitar descoberta direta via `python -m unittest -v` / `py -m unittest -v` na raiz do repositório.
- `scripts/ml_models_numpy.py`: implementações puras em NumPy/SciPy (`LinearRidgeModel`, `LogisticLBFGSModel`, `ResidualMLPRegressor`, `ResidualMLPClassifier` com *warm-start* Newton-Ridge amortecido e seleção cronológica interna 80/20 de `reg_l2`, `HistogramGBDTRegressor`, `HistogramGBDTClassifier`, `compute_regression_metrics`, `compute_roc_auc_fast`, `compute_classification_metrics`).
- `scripts/01_ingest_ons_aneel_epe.py`: ingestão ONS (2015–2025, totalizando 24 arquivos / `69,35 MB` brutos no último pull), download paralelo de `RESTRICAO_COFF_EOLICA` (2023–2025) em `multiprocessing.Pool`, cálculo de capacidade histórica e geração eólica potencial (`g_eolica_verificada_mw + curtailment_mw`).
- `scripts/02_build_dc_and_offshore_scenarios.py`: modelagem bottom-up dos 14 projetos (`data/raw/data_centers_pipeline_ne.csv`), rampa anual (2026–2035), regra de não-duplicação de PUE, concentração espacial por `(subestacao_conexao, estado, tensao_conexao_kv)` e matriz de cenários DC × Eólica (`onshore + offshore pós-2031`).
- `scripts/03_feature_engineering_anova.py`: features causais (lags 1h/24h/168h, janelas móveis deslocadas, harmônicos de Fourier, termos cúbicos aerodinâmicos), testes ANOVA (`scipy.stats.f_oneway`), perfil mensal, matriz de correlações e partição formal Treino (`2015–2024`, 87.476 h) vs. Teste Cego (`2025`, 8.760 h).
- `scripts/04_forecast_demanda_base.py`: Modelo A (`L_base(t)` em 1h-Ahead e 24h Day-Ahead), TimeSeriesSplit paralelo e ancoragem PDE 2035 (`3,1% a.a.`).
- `scripts/05_forecast_wind_cf_and_curtailment.py`: Modelo B (`cf_eolica` 1h/24h) e Modelo C Hurdle em 2 estágios treinado em `>= 2023-09-01` (sem vazamento de 2025): Estágio C1 (`LogisticLBFGSModel` vs. `ResidualMLPClassifier` vs. `HistogramGBDTClassifier`) e Estágio C2 (`LinearRidgeModel` vs. `ResidualMLPRegressor` vs. `HistogramGBDTRegressor`), além de perfis comparativos 2025 exportados com o challenger `ResMLP`.
- `scripts/06_monte_carlo_balance_2035.py`: núcleo estocástico reutilizável `simulate_block_bootstrap(...)` (blocos de 168h, `Common Random Numbers` com `seed=42`, modulação hidrotérmica Chesf e suporte opcional a carga H2V fixa/flexível), matriz de 12 cenários, curva compensatória, evolução anual 2026–2035 e Monte Carlo bottom-up dos 14 projetos e subestações por chave composta.
- `scripts/07_sensitivity_and_final_report.py`: análises do Passo 5 executadas sobre `simulate_block_bootstrap(...)` do Script 06 (transmissão `TX-01..TX-05`, sinergia/disputa `H2V-01..H2V-05`), indicadores ANEEL vs. ONS `2015–2035` derivados de `matriz_cenarios_dc_eolica_2026_2035.csv` e `evolucao_anual_risco_2026_2035.csv`, relatório consolidado `.md` 100% parametrizado via DataFrames + chamada final a `sync_frontend_ssot()`.
- `scripts/run_pipeline.py`: orquestrador único da esteira completa (`01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> sync_frontend_ssot`) com flags `--skip-ingest`, `--only-from` e `--dry-run`, e *bootstrap* automático de `sys.path`.
- `scripts/pipeline_metadata.json`: repositório externo dos metadados descritivos (`dcProjectNotes`, `featureMetadata` e `scriptsCatalog`).
- `scripts/sync_frontend_ssot.py`: gerador SSOT dual (`public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts`) com leitura de `pipeline_metadata.json`, *join* espacial por chave composta `(subestacao, estado, tensao_kv)`, parsers defensivos, normalização consistente de LF (`\n`), auditoria cruzada `validate_ssot_cross_consistency` e leitura literal de `scripts/*.py`.
- `scripts/test_sync_frontend_ssot.py`: suíte `unittest` com **9 testes** (parsers, CSV defensivo, metadados externos, orquestração, *join* por chave composta, consistência cruzada real, vínculo `ResidualMLPClassifier` no Estágio C1 e paridade JSON/TS), com *bootstrap* de `sys.path` para execução nativa no Windows sem `PYTHONPATH`.

### 1.3 Artefatos de Dados e Relatórios (`/data`, `/reports`, `/public`)
- `data/raw/`, `data/processed/`, `data/scenarios/`: bases oficiais, séries harmonizadas/features e cenários bottom-up.
- `reports/`: 16 relatórios `.csv` + `relatorio_final_consolidado_ptc3567_grupo6.md`, já regenerados no pull após execução real de `run_pipeline.py --skip-ingest` em ambiente `numpy`/`pandas`/`scipy`.
- `public/data/pipeline-ssot.json`: artefato JSON servido em runtime para o frontend (sincronizado com `lineage.generatedAtUtc = 2026-11-13T13:56:46Z`).
- `public/assets/`: ativos estáticos (incluindo PDF do Plano Orientador).

### 1.4 Camada Frontend (`/src`)
- `src/data/pipelineTypes.ts`: contratos TypeScript completos do bundle SSOT (`PipelineSsotBundle`).
- `src/data/generated/pipelineSsot.ts`: snapshot TypeScript auto-gerado por `sync_frontend_ssot.py`.
- `src/data/pipelineSsotContext.tsx`: `PipelineSsotProvider` (inicializa síncrono de `PIPELINE_SSOT` e atualiza via `fetch('/data/pipeline-ssot.json', { cache: 'no-store' })` com `isValidSsotBundle`).
- `src/data/dataCentersPipelineCatalog.ts`, `src/data/featuresAnovaCatalog.ts`, `src/data/scriptsRoadmap.ts`: módulos *facade* tipados sobre `PIPELINE_SSOT`.
- `src/data/databasesCatalog.ts`: catálogo estático das 10 bases oficiais (`OFFICIAL_DATABASES`).
- `src/utils/energyModel.ts` e `src/utils/energyModel.test.ts`: simulador paramétrico horário/Monte Carlo em TypeScript e testes unitários/paridade SSOT via `node:test`.
- `src/App.tsx` e `src/components/`:
  - `ObjectiveAndSimulatorView.tsx` (1.007 linhas)
  - `DataCentersPipelineView.tsx` (814 linhas)
  - `FeaturesAndAnovaView.tsx` (1.512 linhas)
  - `DatabasesExplorerView.tsx`
  - `ScriptsPipelineView.tsx` (162 linhas)
  - `DecisionsAndPdfView.tsx` (209 linhas)

---

## 2. Parecer Arquitetural Atual (Pós-Pull GitHub · Passos 1–3 Executados)

### 2.1 Pontos Sólidos
1. **Fluxo SSOT Dual-Artifact bem estruturado e validado em dados reais:** `sync_frontend_ssot.py` garante mesma estrutura em `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts`, com `generatedAtUtc` determinístico. Pós-pull, todos os 8 testes Python (`unittest`) passaram sem *skip*, validando paridade exata `TX-03 == H2V-01 == Central × 36,4 GW` (`probCriticalImport = 9,3%`, `importP95 = 8439,5 MW`, `curtailmentWithDc = 9,93 TWh`, `compensatoryWind = 6,85 GW`), desambiguação de `SE Pici` (`230 kV` vs `69 kV`) e `.md` consolidado.
2. **Ingestão defensiva no sincronizador:** `safe_str`, `safe_float`, `safe_int`, `safe_bool` e `read_csv_records_safe` tratam células vazias, `NaN`/`Inf`, BOM UTF-8, delimitador `;`/`,` e separador decimal PT-BR.
3. **Código literal sincronizado:** `scriptsPipeline` incorpora exatamente o conteúdo em disco de `scripts/01..07*.py`, impedindo divergência entre código real e UI.
4. **Rigor metodológico nas Etapas 01–07:** causalidade temporal nas features, separação rigorosa 2015–2024 vs. 2025, não-duplicação de PUE, `Common Random Numbers` (`seed=42`) no Monte Carlo e motor unificado entre Script 06 e Script 07.
5. **Compilação e tipagem limpas:** `tsc --noEmit` (`npm run lint`) e `vite build` (`npm run build`) executam sem erros após o pull.

### 2.2 Fragilidades, Fraturas Arquiteturais e Erros de Teste Identificados

1. **[RESOLVIDO E VERIFICADO PÓS-PULL] Simulações e Relatório Hardcoded (`scripts/07_sensitivity_and_final_report.py`):**
   - *(Resolvido no Passo 2 e regenerado no pull)* `simulate_block_bootstrap(...)` em `scripts/06_monte_carlo_balance_2035.py` alimenta diretamente `TX-01..TX-05` e `H2V-01..H2V-05` no Script 07; os indicadores ANEEL vs. ONS e o relatório `.md` foram regenerados em ambiente científico e validados por `test_live_report_cross_consistency_when_regenerated_post_passo_2` (**8/8 `unittest` OK, 0 skipped**).

2. **[CRÍTICO] *Split-Brain* entre Simulador JS (`src/utils/energyModel.ts`) e Motor Python (`06_monte_carlo_balance_2035.py`):**
   - `simulateHourlyWeek` e `runMonteCarloSimulation` operam com série sintética senoidal de 168h e usam `DC_IT_PIPELINE_MW_2035.central = 2200` com rampa própria (`0.14 + 0.86 * progress^1.35`), gerando em 2035 valores distintos dos resultados oficiais do Passo 4 exibidos na mesma página (`ObjectiveAndSimulatorView.tsx`), onde a carga efetiva central bottom-up é `1.596,8 MW`.
   - `energyModel.ts` (linhas 1 e 76–84) lê `PIPELINE_SSOT.config` estaticamente na carga do módulo, ignorando atualizações em runtime fornecidas por `PipelineSsotProvider`.

3. **[PARCIALMENTE RESOLVIDO NOS PASSOS 1 E 3] Quebra de Chave Composta em Subestações (`02` vs `06` vs `sync_frontend_ssot.py` vs UI):**
   - `02_build_dc_and_offshore_scenarios.py:197` agrupa por `["subestacao_conexao", "estado", "tensao_conexao_kv"]` (9 registros; ex. `SE Pici` em `230 kV` e `69 kV`).
   - *(Resolvido no Passo 1)* `06_monte_carlo_balance_2035.py` passou a agrupar por chave composta `(subestacao_conexao, estado, tensao_conexao_kv)` e a exportar `n_projetos` por barramento/tensão.
   - *(Resolvido no Passo 3)* `sync_frontend_ssot.py` (`resolve_substations_with_p95`) passou a realizar o *join* de `p95MonteCarloMW` pela chave composta `(subestacao, estado, tensao_kv)` (com fallback seguro apenas se a coluna não existir).
   - *(Pendente para Passo 4)* `DataCentersPipelineView.tsx:38-40,610-614` ainda deduplica o dropdown via `new Map(substations.map(s => [s.substation, ...]))`.

4. **[PARCIALMENTE RESOLVIDO NOS PASSOS 1 E 3] Duplicações, Hardcodes Residuais na UI e Governança Desconectada:**
   - *(Resolvido no Passo 1)* `06_monte_carlo_balance_2035.py` lê cenários, rampas anuais 2026–2035 e expansão eólica diretamente de `data/scenarios/matriz_cenarios_dc_eolica_2026_2035.csv`.
   - *(Resolvido no Passo 3)* Metadados editoriais (`DC_PROJECT_NOTES`, `FEATURE_METADATA` e catálogo textual de scripts) movidos de `sync_frontend_ssot.py` para `scripts/pipeline_metadata.json`.
   - *(Pendente para Passo 4)* `ObjectiveAndSimulatorView.tsx` e `FeaturesAndAnovaView.tsx` mantêm literais numéricos hardcoded em prosa e fallbacks; `FeaturesAndAnovaView.tsx:122-131` omite `modelCBenchmark` e `peakHourMaeMW` na exportação `benchmarks2025`; e `DecisionsAndPdfView.tsx:112-114` declara parametrização que ocorre apenas em `localStorage`.

5. **[PARCIALMENTE RESOLVIDO NOS PASSOS 1 E 3] Higiene de Código, Orquestração e Dependências:**
   - *(Resolvido no Passo 1)* Bug em `01_ingest_ons_aneel_epe.py:106` corrigido para `"val_gertermica": "g_termica_mw"`.
   - *(Resolvido no Passo 3)* Criado o orquestrador único `scripts/run_pipeline.py` (`--skip-ingest`, `--only-from`, `--dry-run`).
   - *(Pendente para Passo 5)* Monolitos na UI (`FeaturesAndAnovaView.tsx`, `ObjectiveAndSimulatorView.tsx`, `DataCentersPipelineView.tsx`), estilos inline (`style={{ width: ... }}`), dependências ociosas em `package.json`, `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` em `metadata.json` e `.gitignore` sem exclusão de CSVs pesados.

6. **[CORRIGIDO EM CÓDIGO NO PASSO 3.B — AGUARDANDO REEXECUÇÃO `--only-from 05` EM AMBIENTE CIENTÍFICO] Ponto de Sela do Classificador C1 e Portabilidade Windows/TAP dos Testes:**
   - *(Diagnóstico pós-reexecução Windows)* Na primeira rodada do Passo 3.B, o Estágio C2 (`ResidualMLPRegressor`) evoluiu de `R² = 0,5790` para `0,6967`, mas o Estágio C1 (`ResidualMLPClassifier`) empatou em `roc_auc = 0,9289` / `brier_score = 0,1208` / `f1_score = 0,8863` com `LogisticLBFGSModel`: a penalidade L2 inicial de `W1` (`reg_l2=5e-3`) superou o ganho inicial de `w2 ~ N(0, 0,02²)`, levando o `L-BFGS-B` ao ponto de sela `(W1 = 0, w2 = 0)`.
   - *(Correção cirúrgica aplicada no Passo 3.B)* Em `scripts/ml_models_numpy.py`, `ResidualMLPClassifier` recebeu quebra de simetria (`b1_0 ~ U(-0,6, 0,6)`), *warm-start* Newton-Ridge amortecido em `w2` (`solve` sobre os resíduos logísticos garantindo `obj(theta0) < obj_linear`), escalonamento `0,15 * reg_l2` em `W1` e seleção cronológica interna 80/20 de `reg_l2 ∈ {2e-4, 8e-4, 2,5e-3}` sem qualquer vazamento de 2025; `05_forecast_wind_cf_and_curtailment.py` passou a usar `reg_l2=8e-4, max_iter=180`.
   - *(Resolvido no Passo 3.B)* Normalização `\r\n -> \n` e asserção concisa em `src/utils/energyModel.test.ts` e `scripts/sync_frontend_ssot.py`, eliminando `ERR_TAP_LEXER_ERROR` no Windows (Subteste 11 verde em Windows e Linux).
   - *(Resolvido no Passo 3.B)* Adicionados `scripts/__init__.py` e *bootstrap* de `sys.path` em `test_sync_frontend_ssot.py`, `sync_frontend_ssot.py` e `run_pipeline.py` (`9/9 unittest` aprovados mesmo sem `PYTHONPATH`).
   - *(Pendência de ambiente)* Como o container atual não possui `numpy`/`pandas`/`scipy`, o Subteste 8 (`npm run test`) ainda lê o CSV anterior (`0,9289`) até a execução de `py scripts/run_pipeline.py --only-from 05` em ambiente científico.

---

## 3. Plano Sequencial Passo a Passo de Execução

> **Status de Execução:** Passos 1, 2, 3 e **3.B (código + SSOT)** concluídos (`9/9 unittest` passando sem `PYTHONPATH`; `tsc --noEmit` e `vite build` verdes; `10/11` `npm run test` verdes, restando apenas rodar `--only-from 05` em ambiente com `numpy`/`pandas`/`scipy` para atualizar os CSVs do Modelo C). **Próximo passo de código:** **Passo 4** (mediante aprovação).

### Passo 1 — Unificar Fonte de Cenários e Chave Composta entre Etapa 02 e Etapa 06
- [x] **Status:** Concluído em 2026-11-13
- **Objetivo:** Eliminar duplicação de cargas/rampas e corrigir a divergência de granularidade nas subestações multi-tensão.
- **Arquivos modificados:**
  - `scripts/01_ingest_ons_aneel_epe.py`
  - `scripts/02_build_dc_and_offshore_scenarios.py`
  - `scripts/06_monte_carlo_balance_2035.py`
  - `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts` (re-sincronizados via `sync_frontend_ssot.py`)
- **Ações realizadas:**
  1. Em `06_monte_carlo_balance_2035.py`, substituídos `dc_configs`, `wind_configs` e `dc_ramp_by_year` hardcoded pela leitura direta de `data/scenarios/matriz_cenarios_dc_eolica_2026_2035.csv` (Etapa 02).
  2. Em `02_build_dc_and_offshore_scenarios.py`, restringida a ativação de eólica offshore pós-2031 em `generate_full_scenario_matrix` ao cenário `high` (`include_offshore_post_2031=(w_scen == "high")`), alinhando os totais de `base` (29,6 GW) e `intermediate` (36,4 GW) à Decisão 02 e ao Passo 4.
  3. Em `run_bottom_up_project_monte_carlo` (`06_monte_carlo_balance_2035.py`), alterada a chave de agregação para a chave composta `(subestacao_conexao, estado, tensao_conexao_kv)`.
  4. Em `01_ingest_ons_aneel_epe.py:106`, simplificado e corrigido o mapeamento para `"val_gertermica": "g_termica_mw"`.
- **Validação realizada:** `py_compile` sem erros nos scripts `01`, `02` e `06`; `sync_frontend_ssot.py` re-executado; `unittest`, `npm run test`, `lint_applet` e `compile_applet` verdes. *(Nota de ambiente: o container atual não possui `numpy`/`pandas` instalados, portanto a regeneração física dos CSVs em `data/scenarios/` e `reports/risco_subestacoes_rede_basica_2035.csv` deverá ser executada em ambiente Python com dependências científicas ou junto ao Passo 2/3).*

---

### Passo 2 — Tornar `scripts/07_sensitivity_and_final_report.py` 100% Calculado e Parametrizado
- [x] **Status:** Concluído em 2026-11-13
- **Objetivo:** Eliminar todas as tabelas simuladas manualmente e números estáticos do Script 07 e do relatório `.md`.
- **Arquivos modificados:**
  - `scripts/06_monte_carlo_balance_2035.py`
  - `scripts/07_sensitivity_and_final_report.py`
  - `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts` (re-sincronizados via `sync_frontend_ssot.py`)
- **Ações realizadas:**
  1. Em `06_monte_carlo_balance_2035.py`, extraído `simulate_block_bootstrap(...)` com suporte a limites customizados de intercâmbio (`import_limit_mw`, `export_limit_mw`) e carga H2V opcional (`h2v_nominal_mw`, `h2v_flexible`) usando o campo `"hour"` em `_prepare_seasonal_blocks`, mantendo sorteios idênticos para `h2v_nominal_mw == 0.0`.
  2. Em `07_sensitivity_and_final_report.py`, reescrito `run_transmission_sensitivity_2035` para executar `simulate_block_bootstrap` (`n_iterations=1000`, `seed=42`) em `TX-01..TX-05` lendo o cenário Central × Intermediária de `matriz_cenarios_dc_eolica_2026_2035.csv`.
  3. Reescrito `run_h2v_and_datacenter_synergy_2035` para simular `H2V-01..H2V-05` pelo mesmo motor estocástico em blocos de 168 h e ler a carga base de `SE Pecém II` de `dc_substation_load_concentration.csv`, sem constantes literais antigas.
  4. Reescrito `build_aneel_vs_ons_wind_indicators_2015_2035` para derivar os anos projetados (`2028..2035`) diretamente de `matriz_cenarios_dc_eolica_2026_2035.csv`, `evolucao_anual_risco_2026_2035.csv` e `_compute_chesf_hydro_thermal_dispatch` sobre o baseline empírico de `ne_hourly_master.csv`.
  5. Reescrito `write_final_consolidated_markdown_report` para receber e interpolar 100% das estatísticas e citações em prosa diretamente dos DataFrames reais das Etapas 01–07.
- **Validação realizada:** `py_compile` limpo nos scripts `06` e `07`; `sync_frontend_ssot.py` re-executado; `unittest`, `npm run test`, `lint_applet` e `compile_applet` verdes. *(Nota de ambiente: a regeneração numérica dos CSVs `reports/sensibilidade_*.csv`, `reports/indicadores_*.csv` e `reports/relatorio_final_*.md` aguarda execução em ambiente Python com `numpy`/`pandas`).*

---

### Passo 3 — Orquestrador Único, Externalização de Metadados e Testes de Consistência SSOT
- [x] **Status:** Concluído em 2026-11-13
- **Objetivo:** Garantir reprodutibilidade ponta a ponta e manter `sync_frontend_ssot.py` focado em transformação e validação.
- **Arquivos modificados/criados:**
  - `scripts/run_pipeline.py` (criado)
  - `scripts/pipeline_metadata.json` (criado)
  - `scripts/sync_frontend_ssot.py`
  - `scripts/test_sync_frontend_ssot.py`
  - `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts` (re-sincronizados via `run_pipeline.py --only-from ssot`)
- **Ações realizadas:**
  1. Criado `scripts/run_pipeline.py` com flags `--skip-ingest`, `--only-from` e `--dry-run`, executando sequencialmente `01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> sync_frontend_ssot`.
  2. Externalizados `dcProjectNotes`, `featureMetadata` e `scriptsCatalog` de `sync_frontend_ssot.py` para `scripts/pipeline_metadata.json`.
  3. Atualizado o *join* de subestações em `sync_frontend_ssot.py` (`resolve_substations_with_p95`) para usar chave composta `(subestacao, estado, tensao_kv)` e adicionada a função `validate_ssot_cross_consistency`.
  4. Expandida a suíte `scripts/test_sync_frontend_ssot.py` com testes para metadados externos, resolução de estágios do orquestrador, *join* por chave composta sem colisão de tensão (`SE Pici` 230 kV vs. 69 kV), validação cruzada (`TX-03`/`H2V-01`/`mc_12` e `.md`) e checagem do bundle vivo pós-Passos 1–2.
- **Validação realizada:** `py_compile`, `run_pipeline.py --skip-ingest --dry-run`, `run_pipeline.py --only-from ssot`, `unittest` (`7 ok` + `1 skipped` referente à checagem numérica dos CSVs em `reports/` que aguardam reexecução de `run_pipeline.py --skip-ingest` em ambiente com `numpy`/`pandas`), `npm run test`, `lint_applet` e `compile_applet` aprovados.

---

### Passo 3.B (Adicional Pós-Pull) — Corrigir Generalização Out-of-Time do Estágio C1 (Modelo C) e Portabilidade dos Testes (Windows/CRLF)
- [x] **Status:** Código implementado e SSOT sincronizado em 2026-11-13 *(aguarda apenas execução numérica de `--only-from 05` em ambiente `numpy`/`pandas`)*
- **Objetivo:** Corrigir a falha do Subteste 8 (`npm run test`), eliminar os erros de portabilidade Windows (`ERR_TAP_LEXER_ERROR` e `ModuleNotFoundError: config`) e garantir que a família não-linear com conexão residual supere o baseline linear em todas as métricas out-of-time 2025 do Modelo C.
- **Arquivos modificados/criados:**
  - `scripts/__init__.py` (criado)
  - `scripts/ml_models_numpy.py`
  - `scripts/05_forecast_wind_cf_and_curtailment.py`
  - `scripts/run_pipeline.py`
  - `scripts/sync_frontend_ssot.py`
  - `scripts/test_sync_frontend_ssot.py`
  - `src/utils/energyModel.test.ts`
  - `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts` (re-sincronizados via `run_pipeline.py --only-from ssot`)
- **Ações realizadas:**
  1. Implementada e refinada a classe `ResidualMLPClassifier` em `scripts/ml_models_numpy.py` com conexão residual linear inicializada via `LogisticLBFGSModel` (`L-BFGS-B`), *warm-start* Newton-Ridge amortecido em `w2` (`solve`), quebra de simetria `b1_0 ~ U(-0,6, 0,6)`, regularização `0,15 * reg_l2` em `W1` e seleção cronológica interna 80/20 de `reg_l2 ∈ {2e-4, 8e-4, 2,5e-3}` para evitar o ponto de sela `(W1 = 0, w2 = 0)`.
  2. Integrado `ResidualMLPClassifier(hidden_units=16, reg_l2=8e-4, reg_l2_skip=1e-3, max_iter=180, seed=42)` ao Estágio C1 de `scripts/05_forecast_wind_cf_and_curtailment.py` na arquitetura `"Challenger Não-Linear · Rede Neural ResMLP Hurdle (C1+C2)"`, mantendo `"Histogram GBDT Hurdle Completo"` como terceiro candidato e atualizando `export_2025_comparative_profiles` para `preds_c["vol_mlp"]` e `preds_c["prob_mlp"]`.
  3. Normalizadas quebras de linha `\r\n -> \n` e substituído `assert.equal` por asserção concisa no Subteste 11 de `src/utils/energyModel.test.ts`, além de gravação com `newline="\n"` em `scripts/sync_frontend_ssot.py`.
  4. Adicionados `scripts/__init__.py` e *bootstrap* de `sys.path` em `test_sync_frontend_ssot.py`, `sync_frontend_ssot.py` e `run_pipeline.py`, além do teste anti-colapso `test_model_c_stage_c1_wires_residual_mlp_classifier` verificando `||w2||_∞ > 1e-4` e `auc_mlp > auc_lin`.
- **Validação realizada:** `py_compile` limpo em `scripts/*.py`; `python3 scripts/run_pipeline.py --only-from ssot` concluído (`0,09s`); `python3 -m unittest -v` sem `PYTHONPATH` com **9/9 testes OK** (`0,060s`); `npm run test` com **10/11 aprovados** (Subteste 11 verde; Subteste 8 aguarda reexecução de `py scripts/run_pipeline.py --only-from 05` em ambiente com `numpy`/`pandas`/`scipy` para regenerar `reports/metricas_modelos_b_c_eolica_curtailment.csv` e SSOT).

---

### Passo 4 — Alinhar `src/utils/energyModel.ts` ao SSOT Dinâmico e Remover Hardcodes na UI
- [ ] **Status:** Pendente
- **Objetivo:** Eliminar o *split-brain* entre o simulador interativo e o motor Python de referência, além de parametrizar textos e governança no frontend.
- **Arquivos afetados:**
  - `src/utils/energyModel.ts`
  - `src/utils/energyModel.test.ts`
  - `src/App.tsx`
  - `src/components/ObjectiveAndSimulatorView.tsx`
  - `src/components/FeaturesAndAnovaView.tsx`
  - `src/components/DataCentersPipelineView.tsx`
  - `src/components/DecisionsAndPdfView.tsx`
- **Ações:**
  1. Em `energyModel.ts`, substituir o import estático de `PIPELINE_SSOT` por parâmetro `ssotConfig: PipelineConfigSnapshot` e incorporar a rampa real `scenarioAnnualRamp` / pesos de realização de `ssot` no cálculo de `dcLoadMW` (ou ancorar diretamente ao resultado oficial SSOT quando os parâmetros coincidirem com um dos 12 cenários oficiais e recalcular deltas a partir dele).
  2. Em `ObjectiveAndSimulatorView.tsx` e `FeaturesAndAnovaView.tsx`, substituir os números literais em textos e legendas (`7.000 MW`, `25,70 TWh`, `+6,85 GW`, `MAPE 1,22%`, `R² = 0,9853`, `87.476 h`, `18.003,4 MW`, `1.596,8 MW`) por interpolação direta de `ssot`, removendo fallbacks numéricos enganosos.
  3. Em `FeaturesAndAnovaView.tsx:122-131`, incluir `modelCBenchmark` e `peakHourMaeMW` na exportação `benchmarks2025`.
  4. Em `DataCentersPipelineView.tsx:38-40,610-614`, preservar a chave composta `(substation, voltageKV)` no seletor e no filtro de subestações.
  5. Em `DecisionsAndPdfView.tsx:112-114`, ajustar a cópia para refletir que se trata de um registro local de governança (ou disponibilizar exportação JSON de parâmetros para o pipeline Python), removendo a afirmação de que os rádios alteram automaticamente os scripts `.py`.
- **Critério de validação:** Na tela inicial com configuração padrão (`2035`, `central`, `intermediate`), a carga efetiva DC e os indicadores do simulador devem convergir com a tabela do Passo 4 exibida na mesma página; `npm run test` e `npm run lint` devem passar sem erros.

---

### Passo 5 — Modularização de Componentes, Exportadores e Higiene de Build
- [ ] **Status:** Pendente
- **Objetivo:** Reduzir dívida técnica de manutenibilidade, remover dependências ociosas do template e padronizar estilos.
- **Arquivos afetados:**
  - `src/components/FeaturesAndAnovaView.tsx` → dividir em `Validation2025Panel.tsx`, `MonteCarlo2035Panel.tsx`, `SensitivityPasso5Panel.tsx`, `AnovaCorrelationsPanel.tsx`
  - `src/utils/csvExport.ts` (novo)
  - `src/App.tsx`, `src/components/DataCentersPipelineView.tsx`
  - `package.json`, `metadata.json`, `.gitignore`
- **Ações:**
  1. Extrair helper único `downloadDelimitedCsv` / `downloadTextFile` para `src/utils/csvExport.ts`, eliminando duplicação entre `App.tsx`, `DataCentersPipelineView.tsx` e `FeaturesAndAnovaView.tsx`.
  2. Fatiar `FeaturesAndAnovaView.tsx` (1.512 linhas) em subcomponentes coesos por aba.
  3. Substituir `style={{ width: ... }}` inline em `DataCentersPipelineView.tsx:347` e `FeaturesAndAnovaView.tsx:1352` por elementos sem estilo inline (ex.: barra SVG proporcional).
  4. Remover de `package.json` as dependências não utilizadas (`express`, `@types/express`, `dotenv`, `@google/genai`, `motion`), atualizar `metadata.json` removendo `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` e adicionar regras de exclusão para CSVs pesados (`data/raw/ons_*.csv`, `data/processed/*.csv`) e `__pycache__/` no `.gitignore`.
- **Critério de validação:** `npm run lint`, `npm run build`, `npm run test` e `python3 -m unittest scripts/test_sync_frontend_ssot.py` executando limpos com bundle final enxuto.
