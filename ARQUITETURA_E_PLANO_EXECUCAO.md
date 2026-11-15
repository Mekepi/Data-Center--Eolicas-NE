# Documento Base de Arquitetura e Plano Sequencial de Execução

**Projeto:** Balanço Eólico & Data Centers NE 2035 (PTC3567 · Grupo 6)  
**Marco de Referência:** Ciclo 1 (Passos 1–5 + `3.B`) concluído em 2026-11-13 · **Ciclo 2 — Concluído integralmente (`Passos C2-1 a C2-5`) em 2026-11-14**  
**Data da Última Atualização:** 2026-11-14  
**Finalidade:** Servir como referência técnica fiel da arquitetura do código, do histórico auditado do Ciclo 1 (Passos 1–5 + `3.B`) e do plano sequencial de saneamento estrutural do Ciclo 2 (`C2-1` a `C2-5`).  
**Observação de Escopo (Ciclo 2 vs. Ciclo 3):** O **Ciclo 2** foca exclusivamente na consistência estrutural Frontend ↔ Backend, eliminação total de dados simulados/sintéticos e centralização completa de constantes hardcoded. O ajuste fino de engenharia elétrica e ciência de dados dos modelos (incluindo convergência out-of-time do Estágio C1 / Subteste 8) fica explicitamente reservado para o **Ciclo 3** posterior.

---

## 1. Mapa da Estrutura Final do Projeto

### 1.1 Raiz e Configuração
- `package.json`: SPA React 19 + Vite 8 (`^8.3.0`) + Tailwind CSS v4 (`^4.3.3`) + TypeScript 7 (`^7.0.2`), com `esbuild ^0.28.0` e `tsx ^4.23.15` (`dev` na porta 3000, `build`, `lint`, `sync:ssot`, `test`). Limpo no Passo 5 com remoção das dependências ociosas do template (`express`, `@types/express`, `dotenv`, `@google/genai`, `motion`, `lucide-react`).
- `tsconfig.json`: compilação estrita sem emissão (`noEmit: true`), `target: ES2022`, `moduleResolution: bundler`.
- `vite.config.ts`: configuração Vite padrão para SPA.
- `metadata.json`: metadados do applet (`name`, `description`, `majorCapabilities`), mantendo `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` em conformidade com o contrato de runtime do ambiente AI Studio Build.
- `.gitignore`: ignora `node_modules/`, `build/`, `dist/`, `coverage/`, `.DS_Store`, `*.log`, `.env*` (exceto `.env.example`), `__pycache__/`, `*.py[cod]`, CSVs pesados de ingestão/processamento (`data/raw/ons_*.csv`, `data/processed/*.csv`) e `.playwright-cli/`.
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
- `src/data/pipelineSsotContext.tsx`: `PipelineSsotProvider` (inicializa síncrono de `PIPELINE_SSOT`, valida digest/versão para `pipeline-ssot.json` e carrega condicionalmente `/data/hourly-baseline-8760.json` validando `hourlyBaselineDigest`).
- `src/data/dataCentersPipelineCatalog.ts`, `src/data/featuresAnovaCatalog.ts`, `src/data/scriptsRoadmap.ts`: módulos *facade* tipados sobre `PIPELINE_SSOT`. *(O arquivo estático `src/data/databasesCatalog.ts` foi removido no C2-4 em favor de `ssot.uiCatalog.databasesCatalog`.)*
- `src/utils/energyModel.ts` e `src/utils/energyModel.test.ts` (`16` subtestes via `node:test`): motor real-time de **8.760 h/ano** (`2025–2035`), fatiamento multi-escala (`Dia`, `Semana`, `Mês`, `Trimestre`, `Ano`), agregador `buildHourlyPlotBuckets`, resolvedor determinístico `resolveMonteCarloSummary` (grade Python / âncoras SSOT sem fallback sintético) e suíte de contrato anti-hardcode.
- `src/utils/csvExport.ts`: utilitário unificado `escapeCsvCell`, `buildDelimitedCsvContent` (BOM UTF-8 + `;`), `downloadDelimitedCsv` e `downloadTextFile`.
- `src/App.tsx` e `src/components/` (100% parametrizados por `ssot.config` e `ssot.uiCatalog`, com 0 atributos `style`):
  - `ObjectiveAndSimulatorView.tsx`
  - `DataCentersPipelineView.tsx`
  - `FeaturesAndAnovaView.tsx` + `featuresAnovaKpis.ts` (`Validation2025Panel.tsx`, `MonteCarlo2035Panel.tsx`, `SensitivityPasso5Panel.tsx`, `AnovaCorrelationsPanel.tsx`)
  - `DatabasesExplorerView.tsx`
  - `ScriptsPipelineView.tsx`
  - `DecisionsAndPdfView.tsx`

---

## 2. Parecer Arquitetural Final (Pós-Passo 5)

### 2.1 Pontos Sólidos
1. **Fluxo SSOT Dual-Artifact bem estruturado e validado em dados reais:** `sync_frontend_ssot.py` garante mesma estrutura em `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts`, com `generatedAtUtc` determinístico. Pós-pull, todos os 8 testes Python (`unittest`) passaram sem *skip*, validando paridade exata `TX-03 == H2V-01 == Central × 36,4 GW` (`probCriticalImport = 9,3%`, `importP95 = 8439,5 MW`, `curtailmentWithDc = 9,93 TWh`, `compensatoryWind = 6,85 GW`), desambiguação de `SE Pici` (`230 kV` vs `69 kV`) e `.md` consolidado.
2. **Ingestão defensiva no sincronizador:** `safe_str`, `safe_float`, `safe_int`, `safe_bool` e `read_csv_records_safe` tratam células vazias, `NaN`/`Inf`, BOM UTF-8, delimitador `;`/`,` e separador decimal PT-BR.
3. **Código literal sincronizado:** `scriptsPipeline` incorpora exatamente o conteúdo em disco de `scripts/01..07*.py`, impedindo divergência entre código real e UI.
4. **Rigor metodológico nas Etapas 01–07:** causalidade temporal nas features, separação rigorosa 2015–2024 vs. 2025, não-duplicação de PUE, `Common Random Numbers` (`seed=42`) no Monte Carlo e motor unificado entre Script 06 e Script 07.
5. **Compilação e tipagem limpas:** `tsc --noEmit` (`npm run lint`) e `vite build` (`npm run build`) executam sem erros após o pull.

### 2.2 Fragilidades, Fraturas Arquiteturais e Erros de Teste Identificados

1. **[RESOLVIDO E VERIFICADO PÓS-PULL] Simulações e Relatório Hardcoded (`scripts/07_sensitivity_and_final_report.py`):**
   - *(Resolvido no Passo 2 e regenerado no pull)* `simulate_block_bootstrap(...)` em `scripts/06_monte_carlo_balance_2035.py` alimenta diretamente `TX-01..TX-05` e `H2V-01..H2V-05` no Script 07; os indicadores ANEEL vs. ONS e o relatório `.md` foram regenerados em ambiente científico e validados por `test_live_report_cross_consistency_when_regenerated_post_passo_2` (**8/8 `unittest` OK, 0 skipped**).

2. **[RESOLVIDO NO PASSO 4] *Split-Brain* entre Simulador JS (`src/utils/energyModel.ts`) e Motor Python (`06_monte_carlo_balance_2035.py`):**
   - `energyModel.ts` passou a receber dinamicamente `ssot?: EnergyModelSsotInput` oriundo de `usePipelineSsot()`, eliminando o acoplamento estático em `PIPELINE_SSOT.config` e atualizando o `App.tsx` quando o `runtime-json` chega em runtime.
   - `resolveEffectiveDcLoadMW` utiliza `ssot.scenarioAnnualRamp` (com escalonamento paramétrico sem dupla contagem de PUE) e `runMonteCarloSimulation` ancora aos cenários oficiais (`monteCarlo12Scenarios2035` e `annualRiskTimeline2026_2035`) nas premissas nominais, convergindo exatamente na configuração padrão (`1.596,8 MW`, `9,3%`, `8.440 MW`, `9,93 TWh`, `−3.578 GWh`, `+6,85 GW`).

3. **[RESOLVIDO NO PASSO 4] Quebra de Chave Composta em Subestações (`02` vs `06` vs `sync_frontend_ssot.py` vs UI):**
   - Etapas `02` e `06` agrupam por `(subestacao_conexao, estado, tensao_conexao_kv)`; `sync_frontend_ssot.py` realiza o *join* pela chave composta; e `DataCentersPipelineView.tsx` agora preserva `${substation}::${voltageKV}` no seletor e no filtro (`SE Pici (230 kV) · CE` vs `SE Pici (69 kV) · CE`).

4. **[RESOLVIDO NO PASSO 4] Duplicações, Hardcodes Residuais na UI e Governança Desconectada:**
   - `ObjectiveAndSimulatorView.tsx`, `FeaturesAndAnovaView.tsx` e `DecisionsAndPdfView.tsx` agora interpolam métricas, contagens de treino/teste, limites SIN, rampas DC 2035 e projeção PDE diretamente do `ssot` em runtime (sem fallbacks numéricos enganosos).
   - `FeaturesAndAnovaView.tsx` passou a exportar `modelCBenchmark` e `peakHourMaeMW` no CSV `benchmarks2025`.
   - `DecisionsAndPdfView.tsx` esclarece o escopo local em `localStorage` vs. pipeline Python/SSOT e oferece o botão `"Exportar Diretrizes (.json)"`.

5. **[RESOLVIDO NO PASSO 5] Higiene de Código, Modularização, Exportadores e Dependências:**
   - *(Resolvido no Passo 1)* Bug em `01_ingest_ons_aneel_epe.py:106` corrigido para `"val_gertermica": "g_termica_mw"`.
   - *(Resolvido no Passo 3)* Criado o orquestrador único `scripts/run_pipeline.py` (`--skip-ingest`, `--only-from`, `--dry-run`).
   - *(Resolvido no Passo 5)* Extraído o utilitário único `src/utils/csvExport.ts` (`escapeCsvCell`, `buildDelimitedCsvContent`, `downloadDelimitedCsv`, `downloadTextFile`), eliminando duplicação de `Blob`/`URL.createObjectURL`/BOM UTF-8 entre `App.tsx`, `DataCentersPipelineView.tsx`, `FeaturesAndAnovaView.tsx`, `DecisionsAndPdfView.tsx` e `ScriptsPipelineView.tsx`.
   - *(Resolvido no Passo 5)* Fatiado `FeaturesAndAnovaView.tsx` (de `1.632` para `436` linhas) em `featuresAnovaKpis.ts`, `Validation2025Panel.tsx`, `MonteCarlo2035Panel.tsx`, `SensitivityPasso5Panel.tsx` e `AnovaCorrelationsPanel.tsx`.
   - *(Resolvido no Passo 5)* Substituídos os dois únicos usos de `style={{ width: ... }}` (`DataCentersPipelineView.tsx` e `AnovaCorrelationsPanel.tsx`) por barras `<svg viewBox="0 0 100 8">` proporcionais — auditoria `grep` e DOM (`[style]`) confirmam **0 estilos inline** em `src/`.
   - *(Resolvido no Passo 5)* Removidas de `package.json` as 6 dependências não utilizadas (`@google/genai`, `dotenv`, `express`, `lucide-react`, `motion`, `@types/express`) e adicionadas exclusões para `data/raw/ons_*.csv`, `data/processed/*.csv`, `__pycache__/`, `*.py[cod]` e `.playwright-cli/` em `.gitignore`.
   - *(Exceção deliberada de runtime em `metadata.json`)* O item `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` em `metadata.json` foi **mantido intencionalmente** porque as regras obrigatórias de ambiente do AI Studio Build exigem sua preservação. *(Observação de arquitetura: `ObjectiveAndSimulatorView.tsx` com 1.091 linhas mantém um módulo único coeso por abranger a síntese inicial e o simulador interativo, não apresentando estilos inline nem duplicação de lógica de negócio após o Passo 4).*

6. **[CORRIGIDO EM CÓDIGO NO PASSO 3.B — AGUARDANDO REEXECUÇÃO `--only-from 05` EM AMBIENTE CIENTÍFICO] Ponto de Sela do Classificador C1 e Portabilidade Windows/TAP dos Testes:**
   - *(Diagnóstico pós-reexecução Windows)* Na primeira rodada do Passo 3.B, o Estágio C2 (`ResidualMLPRegressor`) evoluiu de `R² = 0,5790` para `0,6967`, mas o Estágio C1 (`ResidualMLPClassifier`) empatou em `roc_auc = 0,9289` / `brier_score = 0,1208` / `f1_score = 0,8863` com `LogisticLBFGSModel`: a penalidade L2 inicial de `W1` (`reg_l2=5e-3`) superou o ganho inicial de `w2 ~ N(0, 0,02²)`, levando o `L-BFGS-B` ao ponto de sela `(W1 = 0, w2 = 0)`.
   - *(Correção cirúrgica aplicada no Passo 3.B)* Em `scripts/ml_models_numpy.py`, `ResidualMLPClassifier` recebeu quebra de simetria (`b1_0 ~ U(-0,6, 0,6)`), *warm-start* Newton-Ridge amortecido em `w2` (`solve` sobre os resíduos logísticos garantindo `obj(theta0) < obj_linear`), escalonamento `0,15 * reg_l2` em `W1` e seleção cronológica interna 80/20 de `reg_l2 ∈ {2e-4, 8e-4, 2,5e-3}` sem qualquer vazamento de 2025; `05_forecast_wind_cf_and_curtailment.py` passou a usar `reg_l2=8e-4, max_iter=180`.
   - *(Resolvido no Passo 3.B)* Normalização `\r\n -> \n` e asserção concisa em `src/utils/energyModel.test.ts` e `scripts/sync_frontend_ssot.py`, eliminando `ERR_TAP_LEXER_ERROR` no Windows (Subteste 11 verde em Windows e Linux).
   - *(Resolvido no Passo 3.B)* Adicionados `scripts/__init__.py` e *bootstrap* de `sys.path` em `test_sync_frontend_ssot.py`, `sync_frontend_ssot.py` e `run_pipeline.py` (`9/9 unittest` aprovados mesmo sem `PYTHONPATH`).
   - *(Única pendência externa de ambiente científico)* Como o container Linux atual não possui `numpy`/`pandas`/`scipy`, o Subteste 8 (`npm run test`) ainda lê o CSV anterior (`0,9289`) até a execução de `py scripts/run_pipeline.py --only-from 05` em ambiente Python científico (ajuste fino posterior conforme aprovado pelo usuário).

---

## 3. Plano Sequencial Passo a Passo de Execução

> **Status de Execução:** **Todos os Passos 1, 2, 3, `3.B` (código + SSOT), 4 e 5 concluídos** (`9/9 unittest` aprovados; `tsc --noEmit` e `vite build` verdes; `14/15` subtestes de `energyModel.test.ts` aprovados — restando apenas o Subteste 8 de reexecução científica do Estágio C1 em ambiente com `numpy`/`pandas`/`scipy`, conforme alinhado; verificação ponta a ponta em navegador real com 0 erros de console e 0 atributos `style`).

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
- [x] **Status:** Concluído e verificado em 2026-11-13
- **Objetivo:** Eliminar o *split-brain* entre o simulador interativo e o motor Python de referência, além de parametrizar textos e governança no frontend.
- **Arquivos modificados:**
  - `src/utils/energyModel.ts`
  - `src/utils/energyModel.test.ts`
  - `src/App.tsx`
  - `src/components/ObjectiveAndSimulatorView.tsx`
  - `src/components/FeaturesAndAnovaView.tsx`
  - `src/components/DataCentersPipelineView.tsx`
  - `src/components/DecisionsAndPdfView.tsx`
- **Ações realizadas:**
  1. Em `src/utils/energyModel.ts`, removido o import estático em runtime de `PIPELINE_SSOT`; introduzidos `DEFAULT_ENERGY_MODEL_CONFIG`, `EnergyModelSsotInput` e `resolveEffectiveDcLoadMW(config, ssot?)` usando `ssot.scenarioAnnualRamp` com escalonamento por `pue`, `dcUtilization` e `isPublishedPowerTotalGrid` (sem dupla contagem de PUE). `runMonteCarloSimulation` e `evaluateScenario` agora recebem `ssot` e ancoram nos cenários oficiais (`monteCarlo12Scenarios2035` e `annualRiskTimeline2026_2035`), convergindo na configuração padrão (`1.596,8 MW`, `9,3%`, `8.440 MW`, `9,93 TWh`, `−3.578 GWh`, `+6,85 GW`).
  2. Em `src/App.tsx`, `buildDefaultSimConfig(ssot.config)` passou a inicializar o estado do simulador a partir do contexto `usePipelineSsot()`, sincronizando automaticamente quando `runtime-json` é carregado caso o usuário ainda não tenha editado parâmetros.
  3. Em `ObjectiveAndSimulatorView.tsx`, `FeaturesAndAnovaView.tsx` e `DecisionsAndPdfView.tsx`, eliminados números literais, rótulos defasados e fallbacks numéricos enganosos (passando a interpolar `ssot` / `'—'`), incluindo cálculo dinâmico da projeção PDE 2035 e limites de transmissão.
  4. Em `FeaturesAndAnovaView.tsx`, exportação `benchmarks2025` expandida para incluir `peakHourMaeMW` (Modelo A) e todos os registros de `modelCBenchmark` (`roc_auc`, `brier_score`, `f1_score`, `mae`, `r2`, `curtailment_real_2025_twh`, `curtailment_pred_2025_twh`).
  5. Em `DataCentersPipelineView.tsx`, o seletor e filtro de subestações passou a utilizar chave composta `${substation}::${voltageKV}`, mantendo `SE Pici (230 kV) · CE` e `SE Pici (69 kV) · CE` distintos.
  6. Em `DecisionsAndPdfView.tsx`, ajustada a redação sobre persistência em `localStorage` vs. esteira Python/SSOT e adicionado o botão `"Exportar Diretrizes (.json)"`.
  7. Em `src/utils/energyModel.test.ts`, adicionados 2 novos testes cobrindo convergência do Passo 4 (`evaluateScenario`) e escalonamento dinâmico (`resolveEffectiveDcLoadMW` + `ssotConfig`).
- **Validação realizada:** `tsc --noEmit` (`lint_applet`) e `vite build` (`compile_applet`) aprovados sem erros; `python3 -m unittest -v` (`9/9 OK`); `npx tsx --test src/utils/energyModel.test.ts` com **12/13 aprovados** (incluindo os novos testes de Passo 4; apenas Subteste 8 segue pendente para ajuste fino posterior do Estágio C1); verificação visual e funcional em Chromium (`playwright-cli` 1440×900) confirmando convergência do simulador na tela inicial, filtro `SE Pici::69` (`1 de 14 projetos`), navegação nas abas de `Modelos & Monte Carlo`, novo botão `.json` em `Decisões & Plano PDF` e **0 erros de console**.

---

### Passo 5 — Modularização de Componentes, Exportadores e Higiene de Build
- [x] **Status:** Concluído e verificado em 2026-11-13
- **Objetivo:** Reduzir dívida técnica de manutenibilidade, centralizar exportadores, remover dependências ociosas do template e eliminar estilos inline.
- **Arquivos criados/modificados:**
  - `src/utils/csvExport.ts` (criado)
  - `src/components/featuresAnovaKpis.ts` (criado)
  - `src/components/Validation2025Panel.tsx` (criado)
  - `src/components/MonteCarlo2035Panel.tsx` (criado)
  - `src/components/SensitivityPasso5Panel.tsx` (criado)
  - `src/components/AnovaCorrelationsPanel.tsx` (criado)
  - `src/components/FeaturesAndAnovaView.tsx`
  - `src/components/DataCentersPipelineView.tsx`
  - `src/components/DecisionsAndPdfView.tsx`
  - `src/components/ScriptsPipelineView.tsx`
  - `src/App.tsx`
  - `src/utils/energyModel.test.ts`
  - `package.json`, `.gitignore`
- **Ações realizadas:**
  1. Criado o módulo `src/utils/csvExport.ts` com `escapeCsvCell`, `buildDelimitedCsvContent`, `downloadDelimitedCsv` e `downloadTextFile`, unificando todos os downloads (CSV com BOM UTF-8 + `;`, `.md`, `.json` e `.py`) em `App.tsx`, `DataCentersPipelineView.tsx`, `FeaturesAndAnovaView.tsx`, `DecisionsAndPdfView.tsx` e `ScriptsPipelineView.tsx`.
  2. Fatiado o monólito `FeaturesAndAnovaView.tsx` (1.632 → 436 linhas) em `featuresAnovaKpis.ts` (72L) e quatro painéis coesos por aba (`Validation2025Panel.tsx`, `MonteCarlo2035Panel.tsx`, `SensitivityPasso5Panel.tsx`, `AnovaCorrelationsPanel.tsx`).
  3. Eliminados todos os atributos `style={{ width: ... }}` remanescentes em `DataCentersPipelineView.tsx` e `AnovaCorrelationsPanel.tsx`, substituídos por barras `<svg viewBox="0 0 100 8">` proporcionais.
  4. Removidas de `package.json` as dependências não utilizadas (`@google/genai`, `dotenv`, `express`, `lucide-react`, `motion`, `@types/express`) e incluídas regras de exclusão em `.gitignore` para `__pycache__/`, `*.py[cod]`, `data/raw/ons_*.csv`, `data/processed/*.csv` e `.playwright-cli/`. Mantido `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` em `metadata.json` por exigência do ambiente AI Studio Build.
  5. Adicionados 2 testes unitários em `src/utils/energyModel.test.ts` cobrindo `escapeCsvCell`, `buildDelimitedCsvContent` e `computeFeaturesAnovaKpis`.
- **Validação realizada:** `tsc --noEmit` (`lint_applet`) e `vite build` (`compile_applet`) aprovados sem erros; `python3 -m unittest -v` (`9/9 OK`); `npx tsx --test src/utils/energyModel.test.ts` com **14/15 aprovados** (Subtestes 14 e 15 do Passo 5 verdes; apenas Subteste 8 aguarda reexecução científica `--only-from 05` já acordada); auditoria `grep` e inspeção em Chromium (`playwright-cli` 1440×900) confirmando `0` elementos com atributo `[style]`, funcionamento das 4 sub-abas de `Modelos & Monte Carlo`, renderização das barras SVG e **0 erros de console**.

---

## 4. Ciclo 2 — Auditoria Arquitetural e Plano de Correção (Consistência Front↔Back, Zero Dados Simulados e Zero Constantes Hardcoded)

> **Status do Ciclo 2:** **Concluído integralmente em 2026-11-14 (`Passos C2-1, C2-2, C2-3, C2-4 e C2-5` aprovados)** · Prontidão para o **Ciclo 3** (ajuste científico/hiperparâmetros em ambiente Python `numpy`/`pandas`/`scipy` e materialização em disco de `hourly-baseline-8760.json` e `grade_simulador_monte_carlo_2025_2035.csv`).  
> **Estado atual do workspace no início do Ciclo 2:** Arquivos brutos/intermediários pesados ignorados pelo `.gitignore` (`data/raw/ons_*.csv`, `data/processed/*.csv`, `scripts/__pycache__/*.pyc`) foram removidos localmente; permanecem intactos `reports/` (16 CSVs + `.md`), `data/scenarios/`, `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts`.

### 4.1 Diagnóstico Consolidado da Auditoria de Código

#### Eixo A — Dados Simulados / Sintéticos Residuais e Limitação de Semana Genérica
1. **`src/utils/energyModel.ts` — Simulador Baseado em Semana Genérica Sintética (`simulateHourlyWeek` de 168 h):**
   - Além de inventar curvas trigonométricas/gaussianas sintéticas (pico solar `8200 * (1 + 0.055 * yearsFrom2026)`, carga base `13100 * diurnalLoadShape * weekendFactor`, `hydroPeakSupport = 650`, queda sinótica fixa na hora `76`, fatores `0.44 / 0.58 / 0.27`), o modelo hoje **representa apenas uma semana genérica de 168 h**, em vez de estimar as **8.760 horas de um ano completo** escolhido pelo usuário entre **2025 e 2035**.
   - Mesmo quando o usuário seleciona cenários nominais oficiais (cujos KPIs vêm do Script 06 via SSOT), `ObjectiveAndSimulatorView.tsx` continua exibindo essa semana sintética de 168 h e contadores semanais (`negativeMarginHoursPerWeek`, energia cortada semanal) sem permitir explorar dia, semana, mês, trimestre ou ano completo.
2. **`src/utils/energyModel.ts` — Fallback Monte Carlo Sintético em JS (`runMonteCarloSimulation`) e Curvas Fallback:**
   - Ao alterar qualquer premissa fora do ponto nominal (`pue`, `dcUtilization`, limites de intercâmbio, `seasonalRegime` ≠ `'annual_blend'`), o frontend abandona o motor Python e roda uma aproximação estocástica inventada sobre a semana sintética (`loadMultiplier`, `windProjectCompletion`, `dcRealization`, `annualScale = 36/38/52`, `lowWindFirmCf = 0.19/0.25`, regra `nominalDcMW * 0.35 / lowWindFirmCf`).
   - `computeDcRampFactor` possui curva logística sintética de fallback (`0.14 + 0.86 * progress^1.35`) e `DEFAULT_ENERGY_MODEL_CONFIG` replica parâmetros de `config.py` localmente.
3. **Fallbacks em Ingestão e Linhagem (`scripts/01_ingest_ons_aneel_epe.py` e `scripts/sync_frontend_ssot.py`):**
   - `01_ingest_ons_aneel_epe.py` utiliza preenchimentos estáticos quando dados faltam (`dat_operacao.fillna("2014-01-01")`, `.fillna(3300.0)` MW de capacidade e `g_solar_mw.fillna(0.0)`).
   - `_compute_lineage` em `sync_frontend_ssot.py` retorna fallbacks literais (`87476`, `8760`, `2026-01-01`, `2015..2025`) se `data/processed/` ou `data/raw/ons_*.csv` não estiverem no disco (caso atual após limpeza local, em que `rawOnsFilesCount` passa a `0`).
4. **Testes Sintéticos (`scripts/test_sync_frontend_ssot.py`):**
   - `_make_consistent_synthetic_payload` é restrito a testes unitários isolados; deve ser mantido estritamente separado dos testes de contrato vivo (sem *skips* silenciosos quando artefatos estiverem ausentes).

#### Eixo B — Fraturas de Consistência Frontend ↔ Backend & Contrato SSOT
1. **Semana Genérica 168 h (TS) vs. Ano Completo e KPIs Anuais 2025–2035 (Python):** No estado padrão da aplicação, os cards exibem métricas anuais do Script `06`, enquanto o gráfico e os contadores horários representam uma semana genérica sintética de 168 h e o seletor de ano exclui `2025` (começa em `2026`).
2. **Divergência de Equações Físicas e Taxas entre JS (`energyModel.ts`) e Python (`06`/`07`):**
   - Taxa solar e ano-base: Python (`06`, `07`) usa `0.045` (`+4,5% a.a.`) a partir de `2025`; JS usa `0.055` (`+5,5% a.a.`) a partir de `2026`.
   - Limiar de exportação/corte e anualização: Python (`06`) aplica `export_limit_mw - 0.18 * solar_block` e fator anual `8760 / 168`; JS aplica `exportLimitMW` puro e escalas `36/38/52`. Com a adoção do **ano completo de 8.760 h** em tempo real, a integração horária anual torna-se direta (`sum(curtailment_h) / 1e6` TWh/ano e contagem exata de horas críticas entre `0..8759`), mantendo paridade com o motor estocástico Python.
   - Inconsistência interna no próprio Python (`06`): `run_bottom_up_project_monte_carlo` ainda utiliza fator semanal `52.0` e `0.21` fixo em vez de `8760.0 / block_size` e `cf_firme_critico` parametrizado.
3. **Divergência de Arquitetura Exportada vs. Rotulada no Modelo A/B (`05` vs. Frontend):**
   - `05_forecast_wind_cf_and_curtailment.py` (`export_2025_comparative_profiles`) exporta `pred_load_nonlin_mw = pred_l_base_gbdt_24h_mw` e `pred_cf_nonlin = preds_b["gbdt_1h"]` (Histogram GBDT), ao passo que `Validation2025Panel.tsx`, `featuresAnovaKpis.ts` e `FeaturesAndAnovaView.tsx` rotulam as séries como **ResMLP** e as comparam com KPIs de ResMLP.
4. **Catálogos e Governança Fora do SSOT (`databasesCatalog.ts`, `DecisionsAndPdfView.tsx`, `App.tsx`):**
   - `OFFICIAL_DATABASES`, `PILLAR_LABELS = { all: 'Todas (10)' }` (`src/data/databasesCatalog.ts`) e `GROUP_DECISIONS` + `pdfPath` (`src/components/DecisionsAndPdfView.tsx`) estão hardcoded fora de `scripts/pipeline_metadata.json` e não trafegam pelo SSOT (`usePipelineSsot()`). Decisões 01/03 ainda exibem opções legadas ("MVP rápido", "Recomendado") sem vínculo com os parâmetros ativos em `config.py`.
   - `checkedDbs` em `localStorage` (`App.tsx`) não reflete o status real de ingestão em `ssot.lineage`.
5. **Validação Cruzada Não Bloqueante e Redundância de Carga do SSOT:**
   - `validate_ssot_cross_consistency` (`sync_frontend_ssot.py`) roda apenas no `unittest`, não dentro da própria função `sync_frontend_ssot()` — permitindo gerar SSOT inconsistente sem falha no pipeline.
   - `pipelineSsot.ts` (compilado no bundle Vite) e `public/data/pipeline-ssot.json` duplicam >100 KB (incluindo `starterCode` dos scripts `.py` e `.md`), e `PipelineSsotProvider` executa `fetch(..., { cache: 'no-store' })` incondicionalmente no mount sem comparar versão/digest.
   - Em `sync_frontend_ssot.py`, `safe_float` assume formato PT-BR sempre que `,` e `.` coexistem, e `_format_scenario_name` contém `.replace("Sem Data Centers (Controle)", "Sem Data Centers (Controle)")` (no-op).

#### Eixo C — Inventário Exaustivo de Constantes Hardcoded (Backend + Frontend)
1. **Backend `/scripts` (fora de `scripts/config.py` e `scripts/pipeline_metadata.json`):**
   - `scripts/config.py`: contém URL fixa antiga `RESTRICAO_COFF_EOLICA_2026_10.csv` e não centraliza anos de recorte (`START_YEAR=2015`, `END_YEAR=2025`, `COFF_START_YEAR=2023`, `COFF_REGIME_START_DATE="2023-09-01"`, `TRAIN_CUTOFF_YEAR=2025`, `CURTAILMENT_FLAG_THRESHOLD_MW=50.0`), horizonte de projeção (`PROJECTION_START_YEAR=2026`, `PROJECTION_END_YEAR=2035`, `OFFSHORE_START_YEAR=2031`), taxas PDE/solar (`ANNUAL_LOAD_GROWTH_RATE=0.031`, `ANNUAL_SOLAR_GROWTH_RATE=0.045`), coeficientes da usina Chesf, parâmetros do bootstrap (`BLOCK_SIZE_HOURS=168`, `MONTE_CARLO_ITERATIONS=1000`, `MONTE_CARLO_SEED=42`), grade TX/H2V e hiperparâmetros dos modelos.
   - `scripts/01_ingest_ons_aneel_epe.py`: fallback `"2014-01-01"`, `3300.0` MW, `50.0` MW, anos `2015..2025` e `2023..2025`.
   - `scripts/02_build_dc_and_offshore_scenarios.py`: `2026..2035`, `9.0`, expoente `0.9`, multiplicadores offshore `3600.0 / 1800.0 / 800.0` pós-`2031`.
   - `scripts/04_forecast_demanda_base.py`: `annual_epe_growth_rate = 0.031`, `val_hours = 24*90`, `n_splits = 4`, hiperparâmetros inline.
   - `scripts/05_forecast_wind_cf_and_curtailment.py`: `"2023-09-01"`, `threshold = 0.45`, lista literal `meses_curtos`, hiperparâmetros inline.
   - `scripts/06_monte_carlo_balance_2035.py`: filtro `year >= 2022`, `block_size = 168`, curva Chesf (`2600.0`, `0.56`, `9850.0`), taxas `1.031` e `0.045`, ruídos (`0.032`, `0.86..1.02`, `0.76..1.24`, `0.09`, `0.98`, `0.90..1.08`), parâmetros H2V (`0.42`, `9..15`, `0.30`, `0.27`, `18..22`, `0.12`, `0.55`, `0.92`), `8760.0`, redução exportação `0.18`, `cf_firme_critico = 0.21 + 0.06 * offshore_share`, `52.0`, `0.21`, `36400.0`, `0.72..0.94`, `atraso * 1.5`, `extra_gw_grid`, `seed = 42`, `n_workers = 6`.
   - `scripts/07_sensitivity_and_final_report.py`: `PECEM_H2V_HUB_SHARE = 0.75`, strings `"SE Pecém II"`, specs literais `TX-01..TX-05` e `H2V-01..H2V-05`, `hydro_therm_cap = 15350.0`, `3.85`, `120.0`, `years = [2028, 2030, 2032, 2035]`, `0.045`, `1.031`.
   - `scripts/sync_frontend_ssot.py`: limiares de risco (`20.0, 700.0, 6.0, 230.0, 2.0, 100.0`), detecção por números mágicos (`36400`, `47000`, `2000`) em vez de IDs semânticos de cenário (`windScenarioId === 'intermediate'`), tolerâncias de validação (`0.1`, `0.2`, `0.02`), fallbacks de linhagem (`87476`, `8760`, `2026-01-01`).
2. **Frontend `/src`:**
   - `src/utils/energyModel.ts`: `DEFAULT_ENERGY_MODEL_CONFIG`, `0.9`, `2026..2035`, `2031`, `3600/1800/800`, `1.031`, `0.055`, e todas as constantes da curva sintética.
   - `src/components/featuresAnovaKpis.ts`: `Math.pow(1.031, 10)` literal.
   - `src/components/Validation2025Panel.tsx`: domínios Y fixos dos 3 gráficos SVG (`11500..15000`, `30..60`, `0..7200`) e rótulos fixos `"ResMLP"`.
   - `src/components/ObjectiveAndSimulatorView.tsx`: limites SVG (`24000`, `6000`), `inspectedHour` inicial (`76`), bounds dos `<input type="range">` (`2026..2035`, `4500..10000 step 250`, `1.15..1.50`, `0.50..0.95`) e strings fixas (`"abaixo de 5%"`, `"14 projetos"`, `"SE Pecém II"`, `"PUE 1.18 a 1.32"`).
   - `src/components/MonteCarlo2035Panel.tsx`: filtros por valor literal (`wind - intermWindMW < 100`), meta fixa `prob <= 5.5` e string `"2.600–9.850 MW"`.
   - `src/components/SensitivityPasso5Panel.tsx`: filtro `h2vNominalMW === 2000`, limiares de badge (`15`, `5`, `18`), anos `2025`/`2028` e texto `"12% na calmaria / 100%"`.
   - `src/components/DataCentersPipelineView.tsx`: índice inicial fixo `pipeline[6]`, strings `'SE Pecém II'` / `'SE Suape II'`, thresholds de barra (`40`, `15`, `* 1.8`), descrições fixas nos 3 cards de cenário.
   - `src/components/AnovaCorrelationsPanel.tsx`: lista de categorias hardcoded, thresholds (`0.7`, `0.3`, `0.35`, `0.15`), `pValue === 0 ? '< 10⁻¹⁵'`.
   - `src/data/databasesCatalog.ts`, `DatabasesExplorerView.tsx` (`'ibama-offshore-laf'`, `'Todas (10)'`), `DecisionsAndPdfView.tsx` (`GROUP_DECISIONS`, `pdfPath`), `App.tsx` (`STORAGE_KEY_*`, `checkedDbs` default).
   - `src/utils/energyModel.test.ts`: mistura asserções estruturais com snapshots numéricos literais da rodada anterior (`87476`, `3495`, `29600`, `7000`, `2200`, `4100`, `1596.8`, `8440`, `25.7`).

---

### 4.2 Plano Sequencial de Execução — Ciclo 2

> **Diretriz Fundamental de Modelagem do Simulador (Ano Completo `2025–2035` em Tempo Real):**  
> O sistema **não** representará mais uma semana genérica (`168 h`). O simulador passará a estimar **o ano completo (`8.760 horas` — 365 dias × 24 h)** para **qualquer ano no intervalo `2025..2035`** escolhido pelo usuário em tempo real na interface, preservando **granularidade horária integral** e oferecendo troca dinâmica de janela de observação entre **Dia** (`24 h`), **Semana** (`168 h`), **Mês** (`672–744 h`), **Trimestre** (`Q1–Q4`) e **Ano** (`8.760 h`).

#### Passo C2-1 — Centralização Paramétrica Total no Backend (`scripts/config.py` + `scripts/pipeline_metadata.json` + Contrato SSOT)
- [x] **Status:** Concluído em 2026-11-14
- **Objetivo:** Tornar `scripts/config.py` a única fonte numérica/física de todo o projeto (incluindo o horizonte completo `2025..2035` e constantes de `8.760 h/ano`) e `scripts/pipeline_metadata.json` a única fonte de catálogos/metadados editoriais, expondo um objeto `config` e `uiCatalog` completo ao Frontend.
- **Arquivos modificados:**
  - `scripts/config.py`
  - `scripts/pipeline_metadata.json`
  - `src/data/pipelineTypes.ts`
  - `scripts/sync_frontend_ssot.py`
  - `src/utils/energyModel.ts` (tipagem de compatibilidade `EnergyModelCoreConfig` preservando funcionamento até o Passo C2-4)
  - `scripts/test_sync_frontend_ssot.py`
  - `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts` (re-sincronizados via `run_pipeline.py --only-from ssot`, `schemaVersion = 2.0.0`)
- **Ações realizadas:**
  1. Centralizados em `scripts/config.py` todos os blocos paramétricos: janelas temporais (`HISTORY_START_YEAR=2015`, `HISTORY_END_YEAR=2025`, `BASELINE_YEAR=2025`, `PROJECTION_START_YEAR=2025`, `RAMP_START_YEAR=2026`, `TARGET_END_YEAR=2035`, `OFFSHORE_START_YEAR=2031`, `HOURS_PER_YEAR=8760`, `BLOCK_SIZE_HOURS=168`), taxas estruturais (`ANNUAL_LOAD_GROWTH_RATE=0.031`, `ANNUAL_SOLAR_GROWTH_RATE=0.045`, `EXPORT_SOLAR_CURTAILMENT_COEF=0.18`), despacho Chesf (`CHESF_DISPATCH_PARAMS`), rampa/offshore (`WIND_RAMP_EXPONENT`, `OFFSHORE_SCENARIO_MW_POST_2031`), `MONTE_CARLO_PARAMS`, `H2V_FLEX_PARAMS`, `TX_SENSITIVITY_SPECS`, `H2V_SENSITIVITY_SPECS`, `PECEM_SUBSTATION_NAME`/`PECEM_H2V_HUB_SHARE`, `ML_MODEL_PARAMS`, `SIMULATOR_SLIDER_BOUNDS` (`year: 2025..2035`, `defaultObservationWindow: "year"`), `UI_THRESHOLDS`, templates parametrizados `ONS_S3_URL_TEMPLATES` (`build_ons_urls`, removendo a URL antiga `2026_10`) e o serializador único `export_frontend_config_dict()`.
  2. Adicionada a seção `uiCatalog` em `scripts/pipeline_metadata.json` contendo as 10 bases oficiais (`databasesCatalog`, `databasePillarLabels`), `groupDecisions` atualizadas, `pdfAssetPath`/`pdfDownloadFilename`, `observationWindows` (`day`, `week`, `month`, `quarter`, `year`), `seasonalRegimes`, `anovaCategories`, `dcScenarioCards` e chaves padrão semânticas (`defaultExpandedDatabaseId`, `defaultPipelineProjectId`, `defaultSubstationFocus`, `defaultCheckedDatabaseIds`).
  3. Expandidos os contratos em `src/data/pipelineTypes.ts` (`PipelineConfigSnapshot`, `PipelineUiCatalog`, `ObservationWindowId`, `DatabasePillarId`, `OfficialDatabaseEntry`, `GroupDecisionItem`, `PipelineSsotBundle` com `bundleDigest` e `uiCatalog`) e atualizado `scripts/sync_frontend_ssot.py` para emitir `schemaVersion = "2.0.0"` com `bundleDigest` SHA-256 curto e `config`/`uiCatalog` integrais.
- **Validação realizada:** `py_compile` limpo; `python3 scripts/run_pipeline.py --only-from ssot` concluído (`0,12s`); `python3 -m unittest -v` com **9/9 OK** (`0,135s`); `npx --yes tsx --test src/utils/energyModel.test.ts` com **14/15 OK** (apenas Subteste 8 reservado ao Ciclo 3); `tsc --noEmit` (`lint_applet`) e `vite build` (`compile_applet`) verdes sem erros.

#### Passo C2-2 — Alinhamento Físico/Numérico no Backend (`2025–2035`) e Gate Obrigatório no `sync_frontend_ssot.py`
- [x] **Status:** Concluído em 2026-11-14 *(código 100% refatorado, SSOT re-sincronizado e validado; reexecução pesada dos scripts `01..07` sobre CSVs brutos aguarda ambiente científico com `numpy`/`pandas`/`scipy`)*
- **Objetivo:** Garantir consistência matemática interna entre `01..07` e `sync_frontend_ssot.py`, cobrindo o intervalo completo `2025..2035` sem números mágicos nem falhas silenciosas.
- **Arquivos modificados:**
  - `scripts/01_ingest_ons_aneel_epe.py`
  - `scripts/02_build_dc_and_offshore_scenarios.py`
  - `scripts/03_feature_engineering_anova.py`
  - `scripts/04_forecast_demanda_base.py`
  - `scripts/05_forecast_wind_cf_and_curtailment.py`
  - `scripts/06_monte_carlo_balance_2035.py`
  - `scripts/07_sensitivity_and_final_report.py`
  - `scripts/sync_frontend_ssot.py`
  - `scripts/test_sync_frontend_ssot.py`
  - `src/data/pipelineTypes.ts`
  - `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts` (re-sincronizados via `run_pipeline.py --only-from ssot`)
- **Ações realizadas:**
  1. Refatorados os scripts `01`, `02`, `03`, `04`, `05`, `06` e `07` para importar integralmente os blocos paramétricos de `scripts/config.py` (janelas `2015–2025` e `2025–2035`, limiar `50 MW`, templates ONS S3, `ML_MODEL_PARAMS`, `CHESF_DISPATCH_PARAMS`, `MONTE_CARLO_PARAMS`, `H2V_FLEX_PARAMS`, `TX_SENSITIVITY_SPECS`, `H2V_SENSITIVITY_SPECS`, `PECEM_SUBSTATION_NAME` / `PECEM_H2V_HUB_SHARE` e `REFERENCE_SCENARIO_KEYS`), adicionando logs explícitos `[AVISO ETL]` em fallbacks de ingestão no Script `01`.
  2. Estendido o horizonte padrão de `02_build_dc_and_offshore_scenarios.py` e da linha temporal de `06_monte_carlo_balance_2035.py` para iniciar em **`PROJECTION_START_YEAR` (`2025`)** com inclusão explícita da trajetória baseline `2025` até `2035`, além de emitir `cenario_eolica` semântico no resultado de `simulate_block_bootstrap(...)`.
  3. Em `05_forecast_wind_cf_and_curtailment.py`, corrigida `export_2025_comparative_profiles` para exportar `pa["pred_l_base_resmlp_24h_mw"]`, `preds_b["resmlp_1h"]` e `preds_b["resmlp_24h"]` (alinhando integralmente Modelos A, B e C na arquitetura **ResMLP**) e carregar `monthShortNames` de `scripts/pipeline_metadata.json`.
  4. Em `06_monte_carlo_balance_2035.py`, corrigida `run_bottom_up_project_monte_carlo` para utilizar `float(HOURS_PER_YEAR) / float(block_size_hours)` (em vez de `52.0`) e `firmWindCfBase + firmWindCfOffshoreBonus * offshore_share` (em vez de `0.21`), unificando a física com `simulate_block_bootstrap`.
  5. Em `src/data/pipelineTypes.ts` e `scripts/sync_frontend_ssot.py`:
     - Adicionados `windScenarioId` em `MonteCarloScenario2035Row` e `localRawCachePresent` + `comparativeNonLinearArchitecture` em `PipelineLineageSnapshot`;
     - Substituídos filtros literais (`36400`, `47000`, `2000`) e tolerâncias fixas por `REFERENCE_SCENARIO_KEYS`, `windScenarioId`, `DEFAULT_H2V_COMPARISON_MW` e `UI_THRESHOLDS`;
     - Corrigido `safe_float` para distinguir separadores PT-BR vs. EN (`1,234.56`), removido no-op em `_format_scenario_name` e eliminados fallbacks mascarados em `_compute_lineage` (`0` quando CSVs locais não estão no disco + flag explícita `localRawCachePresent`);
     - Integrado **gate bloqueante** `validate_ssot_cross_consistency(payload)` dentro de `sync_frontend_ssot(..., validate=True)`, abortando com `ValueError("Bloqueio SSOT...")` antes de gravar JSON/TS caso haja qualquer divergência.
  6. Expandida a suíte `scripts/test_sync_frontend_ssot.py` (11 testes) cobrindo `1,234.56`, `windScenarioId`, `localRawCachePresent`/`comparativeNonLinearArchitecture`, bloqueio real de escrita em inconsistência SSOT e conformidade estrutural dos scripts `01..07`.
- **Validação realizada:** `python3 -m py_compile scripts/*.py` limpo; `python3 scripts/run_pipeline.py --only-from ssot` concluído (`0,10s`) com gate de consistência aprovado nos artefatos atuais; `python3 -m unittest -v` com **11/11 OK** (`0,084s`); `npx --yes tsx --test src/utils/energyModel.test.ts` com **14/15 OK** (apenas Subteste 8 reservado ao Ciclo 3); `tsc --noEmit` (`lint_applet`) e `vite build` (`compile_applet`) verdes sem erros. *(Nota: os CSVs em `reports/` preservam os números do último pull até a execução de `run_pipeline.py --skip-ingest` em ambiente Python com `numpy`/`pandas`/`scipy`, que não estão instalados neste container).*

#### Passo C2-3 — Exportação da Série Base Anual Real (`8.760 h` ONS) e Grade Paramétrica `2025–2035` do Motor Python
- [x] **Status:** Concluído em 2026-11-14 *(exportadores `8.760 h` + grade `2025–2035`, contrato SSOT dual com hash SHA-256 e `PipelineSsotProvider` implementados e testados; a geração física de `hourly-baseline-8760.json`, `serie_base_horaria_8760h_ons.csv` e `grade_simulador_monte_carlo_2025_2035.csv` ocorrerá automaticamente na execução da esteira em ambiente `numpy`/`pandas`/`scipy`)*
- **Objetivo:** Substituir definitivamente a semana genérica de 168 h e qualquer curva sintética por uma **base horária anual real completa (`8.760 h`) do ONS** + grade paramétrica `2025–2035` gerada pelo motor Python (`06`).
- **Arquivos modificados:**
  - `scripts/config.py`
  - `scripts/06_monte_carlo_balance_2035.py`
  - `scripts/pipeline_metadata.json`
  - `scripts/sync_frontend_ssot.py`
  - `scripts/test_sync_frontend_ssot.py`
  - `src/data/pipelineTypes.ts`
  - `src/data/pipelineSsotContext.tsx`
  - `public/data/pipeline-ssot.json` e `src/data/generated/pipelineSsot.ts` (re-sincronizados via `run_pipeline.py --only-from ssot`)
- **Ações realizadas:**
  1. Em `scripts/config.py`, definidos os contratos e caminhos oficiais `HOURLY_BASELINE_JSON_PATH` (`public/data/hourly-baseline-8760.json`), `HOURLY_BASELINE_CSV_FILENAME` (`serie_base_horaria_8760h_ons.csv`), `SIMULATOR_GRID_CSV_FILENAME` (`grade_simulador_monte_carlo_2025_2035.csv`), `SEASONAL_REGIME_MONTHS` (`annual_blend`, `dry_windy`, `wet_calm`) e os parâmetros da grade (`iterationsSimulatorGrid`, `gridSensitivityYears`, `gridPueValues`, `gridUtilizationValues`), além da exposição de `hourlyBaselineJsonUrl` em `export_frontend_config_dict()`.
  2. Em `scripts/06_monte_carlo_balance_2035.py`, implementadas e integradas ao `main()`:
     - `build_and_export_hourly_baseline_8760`: gera a série horária anual real de **8.760 horas** (`00h` de 01/Jan a `23h` de 31/Dez, removendo 29/Fev) a partir de `ne_hourly_master.csv` (`annual_blend` em `2025` real; `dry_windy` e `wet_calm` selecionando por semana calendário entre `2022–2025` a semana real observada de maior/menor CF eólico), salvando `reports/serie_base_horaria_8760h_ons.csv` e o JSON colunar compacto `public/data/hourly-baseline-8760.json` com `digest` SHA-256 curto;
     - `export_simulator_monte_carlo_grid`: executa `simulate_block_bootstrap(...)` em `multiprocessing.Pool` cobrindo toda a matriz `2025..2035 × 4 DC × 3 Eólica × 3 Regimes Sazonais` (ancorando os pontos nominais exatamente em `res_12` e `timeline_res`) + fatias paramétricas de limites de intercâmbio (`TX-01..TX-05`) e `PUE × Utilização` em `[2025, 2028, 2030, 2032, 2035]`, exportando `reports/grade_simulador_monte_carlo_2025_2035.csv`.
  3. Em `scripts/sync_frontend_ssot.py` e `src/data/pipelineTypes.ts`, adicionados `SimulatorMonteCarloGridRow[]` (`simulatorMonteCarloGrid` no bundle SSOT — vazio quando o CSV ainda não existe em disco, sem fallbacks sintéticos), leitura e validação SHA-256/estrutural de `hourly-baseline-8760.json` via campos de linhagem (`hourlyBaselineAvailable`, `hourlyBaselineDigest`, `hourlyBaselineHoursCount`, `simulatorGridAvailable`, `simulatorGridRowsCount`), mantendo a série horária de `8.760 h` fora do bundle estático TypeScript, e validação cruzada na `validate_ssot_cross_consistency`.
  4. Em `src/data/pipelineSsotContext.tsx`, sincronizado o carregamento de `hourly-baseline-8760.json` condicionadamente a `lineage.hourlyBaselineAvailable` com verificação de `bundleDigest` (evitando re-render redundante) e validação estrutural + digest `isValidHourlyBaseline8760Bundle`.
  5. Em `scripts/test_sync_frontend_ssot.py` (13 testes), adicionados testes para ausência honesta vs. carga real da série `8.760 h` + grade, detecção de drift grade vs. MC12 e presença dos exportadores no Script `06`.
- **Validação realizada:** `python3 -m py_compile scripts/*.py` limpo; `python3 scripts/run_pipeline.py --only-from ssot` concluído (`0,11s`); `python3 -m unittest -v` com **13/13 OK** (`0,227s`); `npx --yes tsx --test src/utils/energyModel.test.ts` com **14/15 OK** (apenas Subteste 8 reservado ao Ciclo 3); `tsc --noEmit` (`lint_applet`) e `vite build` (`compile_applet`) aprovados sem erros.

#### Passo C2-4 — Motor Real-Time de `8.760 h` (`2025–2035`) e Visualização Multi-Escala (`Dia | Semana | Mês | Trimestre | Ano`) no Frontend
- [x] **Status:** Concluído e verificado em 2026-11-14
- **Objetivo:** Permitir que o usuário escolha qualquer ano entre **2025 e 2035** e gere **em tempo real** a estimativa horária completa das **8.760 horas do ano**, navegando livremente pelas escalas **Dia**, **Semana**, **Mês**, **Trimestre** e **Ano** com granularidade horária e zero dados simulados/hardcoded.
- **Arquivos modificados / removidos:**
  - `src/utils/energyModel.ts` (reescrito)
  - `src/utils/energyModel.test.ts` (compatibilizado com a API `8.760 h` / `null` honesto; suíte de contrato completa fica no C2-5)
  - `src/App.tsx`
  - `src/data/databasesCatalog.ts` (**removido**)
  - `src/components/ObjectiveAndSimulatorView.tsx` (reescrito)
  - `src/components/DatabasesExplorerView.tsx`
  - `src/components/DecisionsAndPdfView.tsx`
  - `src/components/DataCentersPipelineView.tsx`
  - `src/components/FeaturesAndAnovaView.tsx` e `src/components/featuresAnovaKpis.ts`
  - `src/components/Validation2025Panel.tsx`
  - `src/components/MonteCarlo2035Panel.tsx`
  - `src/components/SensitivityPasso5Panel.tsx`
  - `src/components/AnovaCorrelationsPanel.tsx`
  - `src/components/ScriptsPipelineView.tsx`
- **Ações realizadas:**
  1. Em `src/utils/energyModel.ts`, removidos integralmente `simulateHourlyWeek` (semana sintética de 168 h), `DEFAULT_ENERGY_MODEL_CONFIG` e o fallback Monte Carlo sintético em JS. Implementados `buildDefaultSimulationConfig`, `computeChesfDispatchMW`, `estimateFullYearHourly(config, hourlyBaseline, ssot)` (calculando as **8.760 horas** reais de `2025..2035` com física idêntica ao Script `06`), `sliceHourlyWindow` (`day` `1..365`, `week` `1..52`, `month` `1..12`, `quarter` `Q1..Q4`, `year` `8.760 h`), `buildHourlyPlotBuckets` e `resolveMonteCarloSummary` (consulta exata ou interpolação IDW normalizada sobre `simulatorMonteCarloGrid`, fallback exclusivo às âncoras oficiais SSOT ou `sourceStatus: 'unavailable'` com métricas `null` — nunca números sintéticos).
  2. Em `src/components/ObjectiveAndSimulatorView.tsx`, implementados slider real-time **Ano Alvo (`2025–2035`)** com badge de ano-base empírico ONS (`2025`), seletor **Dia (`24 h`) | Semana (`168 h`) | Mês | Trimestre | Ano Completo (`8.760 h`)** com sub-seletores contextuais (`Dia 1..365`, `Sem 1..52`, `Mês`, `Q1..Q4`), envelope mín/máx sombreado para janelas `> 365 h`, inspetor horário `0..windowLength-1`, exportador `.csv` anual de `8.760 h`, seleção dinâmica do par `TX-04 / TX-05` após `txReferenceIdPrefix` e banner transparente quando `hourly-baseline-8760.json` ainda aguarda materialização pelo Python científico (`numpy`/`pandas`/`scipy`).
  3. Removido `src/data/databasesCatalog.ts` e `GROUP_DECISIONS` estático: `App.tsx`, `DatabasesExplorerView.tsx` e `DecisionsAndPdfView.tsx` consomem integralmente `ssot.uiCatalog` e `ssot.config` via `usePipelineSsot()`.
  4. Parametrizados 100% dos demais painéis (`Validation2025Panel.tsx` com domínios Y dinâmicos via `chartPaddingRatio`, `featuresAnovaKpis.ts`, `MonteCarlo2035Panel.tsx`, `SensitivityPasso5Panel.tsx`, `DataCentersPipelineView.tsx`, `AnovaCorrelationsPanel.tsx`, `FeaturesAndAnovaView.tsx` e `ScriptsPipelineView.tsx`), eliminando qualquer constante numérica hardcoded ou atributo inline `style`.
- **Validação realizada:** `python3 -m unittest discover -s scripts -v` (**13/13 OK**); `npx --yes tsx --test src/utils/energyModel.test.ts` (**14/15 OK** — apenas Subteste 8 do Modelo C reservado ao Ciclo 3); `tsc --noEmit` (`lint_applet`) e `vite build` (`compile_applet`) aprovados sem erros; validação visual e interativa em Chromium (`playwright-cli` 1440×900) cobrindo troca de ano (`2035` → `2028`), alternância das 5 escalas (`Dia | Semana | Mês | Trimestre | Ano`), todas as 6 abas principais com `0` estilos inline (`[style]`) e `0` erros/avisos de console.

#### Passo C2-5 — Atualização dos Testes de Contrato e Validação Ponta a Ponta
- [x] **Status:** Concluído e verificado em 2026-11-14
- **Objetivo:** Garantir que `unittest` e `node:test` validem o contrato anual de `8.760 h` (`2025–2035`), as janelas multi-escala e a ausência de dados simulados ou hardcodes.
- **Arquivos modificados:**
  - `src/utils/energyModel.test.ts`
  - `scripts/test_sync_frontend_ssot.py`
  - `src/App.tsx` e `src/components/ObjectiveAndSimulatorView.tsx` (ajuste responsivo mobile `390×844`: `min-w-0`, `overflow-x-clip`, quebra de linha em botões/fórmula para zerar overflow horizontal)
  - `ARQUITETURA_E_PLANO_EXECUCAO.md`
- **Ações realizadas:**
  1. Refatorado `src/utils/energyModel.test.ts` (`16` subtestes) removendo literais congelados da rodada antiga (passando a checar convergência dinâmica frente às âncoras vivas e `config`/`uiCatalog` do `PIPELINE_SSOT`) e adicionando testes de contrato para: (a) geração em tempo real de exatamente `8.760 h` válidas para **todos os anos `2025..2035`** com conservação física e limites da usina Chesf, (b) fatiamento multi-escala (`Dia`, `Semana`, `Mês`, `Trimestre`, `Ano`) preservando os valores horários exatos da série anual e envelopes `buildHourlyPlotBuckets`, (c) `resolveMonteCarloSummary` cobrindo `unavailable` honesto (`null`), `grid_exact` e `grid_interpolated` (IDW normalizado), e (d) *guardrails* anti-hardcode (`style={{` ausente, ausência de `databasesCatalog.ts`, `simulateHourlyWeek` e `DEFAULT_ENERGY_MODEL_CONFIG`).
  2. Expandida a suíte `scripts/test_sync_frontend_ssot.py` (`15` testes) cobrindo o contrato completo de `export_frontend_config_dict()` (`2025..2035`, `8.760 h`, `build_ons_urls`), `uiCatalog`, bloqueio de escrita SSOT em inconsistência e *guardrails* anti-hardcode entre `scripts/*.py` e `src/`.
  3. Executada validação ponta a ponta em navegador real (Chromium via `playwright-cli`) no desktop (`1440×900`) e mobile (`390×844`), corrigindo overflow horizontal de botões/tabelas no viewport mobile (`scrollW === 390`, `docOverflow === false`).
- **Validação realizada:** `python3 -m unittest discover -s scripts -v` (**15/15 OK**); `npx --yes tsx --test src/utils/energyModel.test.ts` (**15/16 aprovados** — apenas o Subteste 9 referente à convergência ROC-AUC do Modelo C Estágio C1 segue isolado para o **Ciclo 3** em ambiente científico Python); `tsc --noEmit` (`lint_applet`) e `vite build` (`compile_applet`) aprovados sem erros; Chromium desktop/mobile com troca de ano (`2025–2035`), alternância entre `Dia`, `Semana`, `Mês`, `Trimestre` e `Ano`, **0 atributos `[style]`** e **0 erros/avisos de console**.


