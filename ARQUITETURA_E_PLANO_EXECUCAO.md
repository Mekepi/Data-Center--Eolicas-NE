# Documento Base de Arquitetura e Plano Sequencial de Execução

**Projeto:** Balanço Eólico & Data Centers NE 2035 (PTC3567 · Grupo 6)  
**Marco de Referência:** Pós-Passo 5 · Passos 1, 2, 3, `3.B` (código + SSOT), **Passo 4** e **Passo 5** concluídos em 2026-11-13  
**Data da Última Atualização:** 2026-11-13  
**Finalidade:** Servir como referência técnica fiel da estrutura final do código, da resolução das fragilidades arquiteturais mapeadas e do registro auditado do roteiro sequencial (Passos 1 a 5 + `3.B`).

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
- `src/data/pipelineSsotContext.tsx`: `PipelineSsotProvider` (inicializa síncrono de `PIPELINE_SSOT` e atualiza via `fetch('/data/pipeline-ssot.json', { cache: 'no-store' })` com `isValidSsotBundle`).
- `src/data/dataCentersPipelineCatalog.ts`, `src/data/featuresAnovaCatalog.ts`, `src/data/scriptsRoadmap.ts`: módulos *facade* tipados sobre `PIPELINE_SSOT`.
- `src/data/databasesCatalog.ts`: catálogo estático das 10 bases oficiais (`OFFICIAL_DATABASES`).
- `src/utils/energyModel.ts` (597 linhas) e `src/utils/energyModel.test.ts` (436 linhas · 15 subtestes via `node:test`): simulador paramétrico horário/Monte Carlo em TypeScript e testes unitários/paridade SSOT/exportadores CSV.
- `src/utils/csvExport.ts` (54 linhas): utilitário unificado `escapeCsvCell`, `buildDelimitedCsvContent` (BOM UTF-8 + delimitador `;`), `downloadDelimitedCsv` e `downloadTextFile`.
- `src/App.tsx` (332 linhas) e `src/components/`:
  - `ObjectiveAndSimulatorView.tsx` (1.091 linhas)
  - `DataCentersPipelineView.tsx` (808 linhas)
  - `FeaturesAndAnovaView.tsx` (436 linhas — container orquestrador e faixa de KPIs) + `featuresAnovaKpis.ts` (72 linhas):
    - `Validation2025Panel.tsx` (439 linhas)
    - `MonteCarlo2035Panel.tsx` (258 linhas)
    - `SensitivityPasso5Panel.tsx` (287 linhas)
    - `AnovaCorrelationsPanel.tsx` (320 linhas)
  - `DatabasesExplorerView.tsx` (341 linhas)
  - `ScriptsPipelineView.tsx` (154 linhas)
  - `DecisionsAndPdfView.tsx` (239 linhas)

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

