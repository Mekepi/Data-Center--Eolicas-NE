# Relatório Técnico Consolidado Final — PTC3567 (Grupo 6)
## Impacto da Expansão de Data Centers e Demanda Elétrica sobre a Geração Eólica no Nordeste (2026–2035)

**Disciplina:** PTC3567 — Ciência dos Dados em Automação e Engenharia (Escola Politécnica da USP)  
**Subsistema Analisado:** Subsistema Nordeste (SIN — ONS / ANEEL / EPE)  
**Janela Empírica de Treino e Validação:** 2015–2024 (Treino: 87.476 horas) e 2025 (Validação Out-of-Time Cega: 8.760 horas)  
**Horizonte Estocástico de Planejamento:** 2026–2035 (Monte Carlo em Blocos Sazonais — 12 Cenários + Sensibilidades)

---

### 1. Resposta Direta à Pergunta Central de Pesquisa

> **Pergunta Central (Seção 1 do Plano Orientador):** *"Qual o impacto do crescimento da demanda elétrica associado à expansão de data centers sobre a suficiência da geração eólica no Nordeste até 2035, e quanto de expansão eólica seria necessário para compensar esse aumento estrutural de carga?"*

1. **Impacto Estrutural da Carga Base + Data Centers até 2035:**
   - A demanda base vegetativa do Subsistema Nordeste cresce de **13.266,9 MW médios em 2025** para **18.003,4 MW médios em 2035** (+3,1% a.a. conforme PDE/EPE).
   - O pipeline mapeado de **14 projetos nominais de Data Centers no Nordeste** totaliza **3.495 MW de potência de TI** (**4.268 MW de carga máxima contratada na rede**, com PUE entre 1,18 e 1,32 e regra de não-duplicação quando publicado em potência total de rede).
   - No **Cenário Central probabilístico (1.596,8 MW médios contínuos na rede em 2035)**, os Data Centers elevam a probabilidade anual de importação crítica acima do limite de intercâmbio ($P(\text{Import} > 7.000\text{ MW})$) de **5,8% para 13,4%** caso o parque eólico permaneça congelado em 29,6 GW.

2. **Expansão Eólica Compensatória Exigida ($\Delta C_{\text{eólica}}$):**
   - Devido à **assimetria sazonal severa do vento nordestino** (comprovada via ANOVA com $F = 5.176,56, p < 10^{-16}$, onde o fator de capacidade P10 cai de **44,5% em setembro** para **10,7% em março**) e ao perfil noturno de carga, cada **1,0 MW de carga firme 24/7 de Data Center** exige entre **5,35 MW e 9,38 MW de capacidade eólica onshore adicional** sob o parque base para compensar a perda de margem no P95 em períodos de baixa geração.
   - **No Cenário Central de Data Centers (1.596,8 MW):**
     - Com **Eólica Base (29,6 GW)**: são necessários **+9,67 GW eólicos adicionais** (levando o parque a 39,27 GW).
     - Com **Expansão SIGA Intermediária (36,4 GW, já somando +6,8 GW em construção)**: restam **+6,85 GW eólicos adicionais** para neutralizar o risco operacional no P95.
     - Com **Expansão Alta + Offshore IBAMA pós-2031 (48,0 GW)**: o requisito adicional cai para **0,66 GW** ($P(\text{Import} > 7,0\text{ GW}) = 5,6\%$), atingindo autossuficiência estatística.

3. **Sinergia Positiva Diurna e Noturna (Absorção de *Constrained-Off* / *Curtailment*):**
   - Em contrapartida ao estresse nas horas de calmaria, a carga 24/7 dos Data Centers atua como **âncora de absorção local de excedentes renováveis**, evitando o desperdício (*curtailment*) de **3.931 GWh/ano (3,93 TWh/ano)** no Cenário Central e até **7.374 GWh/ano (7,37 TWh/ano)** no Cenário Alto de Data Centers sob expansão SIGA Intermediária.

---

### 2. Síntese da Validação Cega Out-of-Time em 2025 (Passo 3 — Modelos A, B e C)

Todos os modelos foram implementados em Python utilizando exclusivamente `numpy`, `scipy` e `pandas` (`scripts/ml_models_numpy.py`), comparando arquiteturas **Lineares (Ridge / Logística)** contra arquiteturas **Não-Lineares (`ResidualMLPRegressor` L-BFGS-B e `HistogramGBDT`)**:

| Bloco de Modelagem | Variável Alvo | Melhor Modelo Não-Linear | Baseline Linear | Métrica Principal (Teste Cego 2025 - 8.760 h) | Ganho Não-Linear |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Modelo A (Script 04)** | Demanda Base $L_{\text{base}}(t)$ (1h-Ahead) | `ResidualMLPRegressor` | `LinearRidgeModel` | **MAE = 159,1 MW** · **MAPE = 1,22%** · $R^2 = 0,9719$ | Redução de **28,6%** no erro MAE |
| **Modelo A (Script 04)** | Demanda Base $L_{\text{base}}(t)$ (24h Day-Ahead) | `ResidualMLPRegressor` | `LinearRidgeModel` | **MAE = 310,2 MW** · **MAPE = 2,38%** · $R^2 = 0,8763$ | Captura interação térmica × dia útil |
| **Modelo B (Script 05)** | Fator de Capacidade Potencial $CF_{\text{pot}}(t)$ (1h) | `ResidualMLPRegressor` | `LinearRidgeModel` | **MAE = 0,0173** (516,5 MW) · **$R^2 = 0,9854$** | Captura potência cúbica $v^3$ de Betz |
| **Modelo C (Script 05)** | *Curtailment* Eólico Real ONS (Hurdle 2 Estágios) | `HistogramGBDT` + `ResMLP` | `Logistic` + `Ridge` | **ROC-AUC = 0,9520** · **Brier = 0,0782** · **F1 = 0,9270** | **$R^2$ Volume = 0,9143** (vs 0,9172 linear) |

---

### 3. Passo 5 · Análise de Sensibilidade à Expansão da Transmissão (Limites de Intercâmbio SIN)

A tabela abaixo demonstra como a expansão das linhas de interligação Nordeste–Sudeste/Centro-Oeste (novas LTs 500 kV e Bipolo HVDC) altera o risco de suprimento e o *curtailment* em 2035 sob o Cenário Central de Data Centers (1.596,8 MW) e Eólica SIGA Intermediária (36,4 GW), simulados diretamente pelo motor Block-Bootstrap:

| Configuração de Malha de Transmissão (2035) | Limite Importação (MW) | Limite Exportação (MW) | $P(\text{Import} > \text{Limite})$ | Importação P95 (MW) | Curtailment Restante (TWh/ano) | Eólica Extra Req. (GW) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **TX-01 (Restrição Severa / Atraso de Obras)** | 5,500 MW | 8,000 MW | **19.10%** | 8,439.5 MW | 14.61 TWh | **+14.00 GW** |
| **TX-02 (Limite Conservador Operativo)** | 6,250 MW | 8,750 MW | **13.40%** | 8,439.5 MW | 12.66 TWh | **+10.43 GW** |
| **TX-03 (Referência Base PDE / ONS 2035)** | 7,000 MW | 9,500 MW | **10.00%** | 8,439.5 MW | 10.91 TWh | **+6.85 GW** |
| **TX-04 (Expansão 500 kV NE–SE/CO Planejada)** | 8,000 MW | 11,000 MW | **6.70%** | 8,439.5 MW | 7.97 TWh | **+2.09 GW** |
| **TX-05 (Bipolo HVDC + Malha 500 kV Completa)** | 9,000 MW | 12,500 MW | **3.50%** | 8,439.5 MW | 5.70 TWh | **+0.00 GW** |

---

### 4. Passo 5 · Disputa vs. Sinergia de Rede: Data Centers 24/7 vs. Hidrogênio Verde (H2V) em Pecém e Suape

Atendendo à Seção 10 do Plano Orientador e à Decisão 04 do Grupo 6, avaliamos o efeito da entrada simultânea de eletrolisadores de **Hidrogênio Verde (H2V)** na ZPE do Pecém (CE) e Suape (PE) competindo pelos mesmos barramentos de 500 kV (**SE Pecém II** concentra **51,8%** da carga de Data Centers do NE):

| Cenário de Cargas Eletrointensivas (2035) | Carga DC 24/7 (MW) | Carga H2V Nominal (MW) | Carga H2V Média Efetiva (MW) | $P(\text{Import} > 7,0\text{ GW})$ | Curtailment Absorvido Total (TWh/ano) | Pressão na SE Pecém II 500 kV (MW) | Eólica Extra Req. (GW) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **H2V-01 · Somente Data Centers 24/7 (Escopo Puro Grupo 6)** | 1,596.8 MW | 0 MW | 0.0 MW | **10.00%** | **3.93 TWh** | 1,768.8 MW | **+6.85 GW** |
| **H2V-02 · DC Central + H2V Pecém/Suape 1,0 GW (Inflexível 24/7)** | 1,596.8 MW | 1,000 MW | 920.0 MW | **14.00%** | **5.82 TWh** | 2,458.8 MW | **+11.24 GW** |
| **H2V-03 · DC Central + H2V Pecém/Suape 1,0 GW (Flexível / Demand-Response)** | 1,596.8 MW | 1,000 MW | 730.7 MW | **10.50%** | **5.97 TWh** | 2,316.8 MW | **+7.43 GW** |
| **H2V-04 · DC Central + H2V Pecém/Suape 2,0 GW (Inflexível 24/7)** | 1,596.8 MW | 2,000 MW | 1,840.0 MW | **21.60%** | **7.44 TWh** | 3,148.8 MW | **+15.62 GW** |
| **H2V-05 · DC Central + H2V Pecém/Suape 2,0 GW (Flexível / Sinergia Eólica)** | 1,596.8 MW | 2,000 MW | 1,461.3 MW | **10.90%** | **7.69 TWh** | 2,864.8 MW | **+8.00 GW** |

**Conclusão Operacional sobre H2V vs. Data Centers:**
- Enquanto os **Data Centers de IA/Cloud** possuem carga estritamente inflexível 24/7 (UPS/SLA Tier III/IV), os **eletrolisadores de H2V** podem e devem ser contratados sob modalidade **flexível / interruptível (*grid-following*)**.
- Quando 2,0 GW de H2V operam de forma **inflexível 24/7**, o risco de importação crítica salta de **10,00% para 21,60%** e exige **+15,62 GW eólicos extras**. Porém, quando o mesmo H2V de 2,0 GW opera com **modulação dinâmica** (reduzindo a 12% na calmaria noturna e operando a 100% nas horas de vento/sol abundante), ele absorve **7,69 TWh/ano de *curtailment*** com impacto mitigado sobre o risco de importação na calmaria (**10,90%** e **+8,00 GW extras**).

---

### 5. Indicadores Separados (Seção 6 do PDF): Capacidade Instalada (ANEEL) vs. Geração Efetiva (ONS)

| Ano | Período / Cenário | Cap. Eólica NE (GW) | Part. na Capacidade Instalada NE (ANEEL %) | Part. na Geração Efetiva NE (ONS %) | CF Potencial s/ Corte (%) | CF Efetivo Verificado ONS (%) | Perda por Curtailment (TWh/ano) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **2015** | Histórico Verificado (ONS/ANEEL) | 4.06 GW | **20.78%** | **22.06%** | 45.05% | 45.05% | 0.00 TWh |
| **2018** | Histórico Verificado (ONS/ANEEL) | 9.84 GW | **37.89%** | **51.28%** | 45.39% | 45.39% | 0.00 TWh |
| **2021** | Histórico Verificado (ONS/ANEEL) | 15.25 GW | **46.34%** | **51.76%** | 48.07% | 48.07% | 0.00 TWh |
| **2023** | Histórico Verificado (ONS/ANEEL) | 22.75 GW | **50.43%** | **61.07%** | 45.69% | 44.00% | 3.36 TWh |
| **2024** | Histórico Verificado (ONS/ANEEL) | 27.52 GW | **51.22%** | **61.54%** | 44.81% | 41.07% | 9.01 TWh |
| **2025** | Histórico Verificado (ONS/ANEEL) | 29.91 GW | **51.46%** | **62.41%** | 50.55% | 40.75% | 25.70 TWh |
| **2028** | Projeção Cenário Central DC + SIGA Interm. | 31.36 GW | **51.15%** | **63.99%** | 46.25% | 42.65% | 9.89 TWh |
| **2030** | Projeção Cenário Central DC + SIGA Interm. | 32.88 GW | **51.38%** | **64.32%** | 46.25% | 43.12% | 9.03 TWh |
| **2032** | Projeção Cenário Central DC + SIGA Interm. | 34.32 GW | **51.54%** | **64.24%** | 46.25% | 43.00% | 9.79 TWh |
| **2035** | Projeção Cenário Central DC + SIGA Interm. | 36.40 GW | **51.70%** | **64.04%** | 46.25% | 42.83% | 10.91 TWh |

---

### 6. Recomendações Finais de Engenharia e Política Energética (Grupo 6)

1. **Contratação Híbrida associada a Armazenamento/Subestações:** A expansão apenas de capacidade eólica onshore apresenta retorno decrescente na ponta noturna de março–maio (no Cenário Central × SIGA Intermediária, cada 1 MW de Data Center ainda requer ~4,29 MW eólicos adicionais para zerar o déficit no P95). A combinação da trajetória **SIGA Intermediária (+6,8 GW onshore)** com **baterias BESS de 4 horas nas subestações de Pecém II e Suape II** ou **eólicas offshore pós-2031** reduz substancialmente a necessidade de sobre-expansão eólica.
2. **Desacoplamento Tarifário/Operativo entre Data Centers (Firme 24/7) e H2V (Flexível):** Novos acessos de Data Centers na SE Pecém II 500 kV (que já concentra 51,8% da demanda efetiva projetada em 2035) devem ser coordenados com PPAs que remunerem a absorção de *constrained-off* diurno/noturno, enquanto plantas de H2V devem atuar como reserva interruptível para não agravar o déficit nas noites úmidas de fevereiro a maio.
