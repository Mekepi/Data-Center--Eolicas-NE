"""
Módulo de Configuração Central e Parâmetros do Projeto
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6
Impacto da expansão de data centers no balanço elétrico do Nordeste
"""

from pathlib import Path
from typing import Dict, Any

# Diretórios base do projeto
ROOT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT_DIR / "scripts"
DATA_DIR = ROOT_DIR / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
SCENARIOS_DATA_DIR = DATA_DIR / "scenarios"
REPORTS_DIR = ROOT_DIR / "reports"

# Garantir existência das pastas de trabalho
for _dir in [DATA_DIR, RAW_DATA_DIR, PROCESSED_DATA_DIR, SCENARIOS_DATA_DIR, REPORTS_DIR]:
    _dir.mkdir(parents=True, exist_ok=True)

# Parâmetros Elétricos e Limites Físicos do Subsistema Nordeste
SUBSYSTEM_ID = "NE"
BASE_WIND_ONSHORE_2026_MW = 29600.0   # Capacidade eólica onshore em operação comercial (SIGA/ONS)
BASE_HYDRO_THERMAL_MW = 4150.0        # Despacho médio hidrotérmico firme no NE (Chesf/São Francisco + biomassa)
INTERCHANGE_IMPORT_LIMIT_MW = 7000.0  # Limite crítico de importação líquida pelo SIN (linhas SE/CO -> NE e N -> NE)
INTERCHANGE_EXPORT_LIMIT_MW = 9500.0  # Limite máximo de exportação líquida (acima disso, há constrained-off forçado)

# Cenários de Potência de TI para Data Centers no NE até 2035 (MW)
DC_SCENARIOS_IT_MW: Dict[str, float] = {
    "none": 0.0,
    "conservative": 950.0,   # Projetos maduros/contratados (ex.: Pecém/Fortaleza Fase 1)
    "central": 2200.0,       # Pipeline ponderado por probabilidade de concretização e atraso
    "high": 4100.0,          # Stress test: pipeline anunciado + novos polos de IA
}

# Trajetórias de Expansão Eólica Onshore até 2035 adicionais a 2026 (MW - SIGA/ANEEL)
WIND_EXPANSION_ONSHORE_MW: Dict[str, float] = {
    "base": 0.0,             # Apenas usinas em operação
    "intermediate": 6800.0,  # Operação + Em Construção no SIGA
    "high": 14800.0,         # Operação + Construção + Parcela outorgada viável
}

# Parâmetros de Data Centers (Seção 5 do Plano Orientador)
DEFAULT_PUE = 1.28
DEFAULT_UTILIZATION = 0.80

# URLs Oficiais e Repositórios Abertos (ONS AWS Open Data S3)
OFFICIAL_DATA_URLS: Dict[str, str] = {
    "ons_curva_carga_2025": "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/curva-carga-ho/CURVA_CARGA_2025.csv",
    "ons_balanco_2025": "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/balanco_energia_subsistema_ho/BALANCO_ENERGIA_SUBSISTEMA_2025.csv",
    "ons_capacidade_geracao": "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/capacidade-geracao/CAPACIDADE_GERACAO.csv",
    "ons_constrained_off_eolica": "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/restricao_coff_eolica_tm/RESTRICAO_COFF_EOLICA_2026_10.csv",
}
