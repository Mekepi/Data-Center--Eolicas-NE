export type DatabasePillarId =
  | 'all'
  | 'offshore'
  | 'datacenters'
  | 'capacidade_atual'
  | 'consumo_atual'
  | 'curtailment_clima';

export interface OfficialDatabaseEntry {
  id: string;
  pillar: Exclude<DatabasePillarId, 'all'>;
  pillarLabel: string;
  institution: string;
  datasetName: string;
  portalOrEndpoint: string;
  granularity: 'Horária' | 'Mensal / Anual' | 'Cadastral / Projetos';
  priority: 'Escopo Mínimo (Obrigatório)' | 'Cenário Estendido / Stress Test';
  targetModelRole: string;
  keyColumnsAndFilters: string[];
  methodologicalNotes: string;
  accessUrlLabel: string;
}

export const PILLAR_LABELS: Record<DatabasePillarId, string> = {
  all: 'Todas (10)',
  offshore: '1. Offshore (IBAMA)',
  datacenters: '2. Data Centers NE',
  capacidade_atual: '3. Capacidade Atual NE',
  consumo_atual: '4. Consumo Atual NE',
  curtailment_clima: '5. Curtailment & Clima',
};

export const OFFICIAL_DATABASES: OfficialDatabaseEntry[] = [
  {
    id: 'ibama-offshore-laf',
    pillar: 'offshore',
    pillarLabel: 'Eólicas Offshore em Aprovação',
    institution: 'IBAMA (Licenciamento Ambiental Federal)',
    datasetName: 'Mapa de Complexos Eólicos Offshore & Processos SEI/LAF',
    portalOrEndpoint: 'ibama.gov.br/laf · Painel de Complexos Eólicos Offshore Abertos',
    granularity: 'Cadastral / Projetos',
    priority: 'Cenário Estendido / Stress Test',
    targetModelRole: 'Expansão de Geração Pós-2031 (Cenário Alto / Monte Carlo)',
    keyColumnsAndFilters: [
      'UF / Costa: CE, RN, PI, MA (Subsistema Nordeste)',
      'Potência Total Prevista (MW) e Nº de Aerogeradores',
      'Fase do Licenciamento: Ficha de Caracterização (FCA), Termo de Referência (TR), EIA/RIMA em análise',
      'Sobreposição de áreas marítimas (filtrar duplicidades de mesmo polígono)',
    ],
    methodologicalNotes:
      'Atenção crítica até 2035: há mais de 60 GW protocolados na costa do NE (CE e RN lideram), mas projetos em fase inicial de EIA/RIMA têm lead time de 6 a 9 anos. Não somar MW brutos! Atribuir probabilidade baixa de entrada plena até 2035 no Monte Carlo (janela 2032–2035) e separar dos parques onshore do SIGA.',
    accessUrlLabel: 'Portal IBAMA – Complexos Eólicos Offshore (Mapas/Shapefiles & Planilha de Processos)',
  },
  {
    id: 'mme-aneel-pug-offshore',
    pillar: 'offshore',
    pillarLabel: 'Eólicas Offshore em Aprovação',
    institution: 'MME / ANEEL / EPE',
    datasetName: 'Portal PUG-Offshore (Cessão de Uso de Águas da União – Lei nº 15.097/2025) & Roadmap EPE',
    portalOrEndpoint: 'gov.br/mme · Sistema de Gestão de Prismas Energéticos Offshore / EPE Roadmap Offshore',
    granularity: 'Cadastral / Projetos',
    priority: 'Cenário Estendido / Stress Test',
    targetModelRole: 'Filtro de Maturidade Regulatória e Fator de Capacidade Marítimo (~55%–65%)',
    keyColumnsAndFilters: [
      'Declarações de Interferência Prévia (DIP) emitidas',
      'Prismas energéticos sem conflito portuário/ambiental na margem equatorial (CE/RN)',
      'Curvas típicas de vento offshore a 150m (EPE Roadmap Eólica Offshore Brasil)',
    ],
    methodologicalNotes:
      'Enquanto as eólicas onshore já possuem outorga direta no SIGA/ANEEL, as offshore dependem de leilão de cessão de prismas regulamentado pelo Marco Legal (Lei 15.097/2025). Usar apenas como camada incremental no Cenário Alto pós-2031.',
    accessUrlLabel: 'MME / EPE – Estudos de Planejamento Eólica Offshore & PUG',
  },
  {
    id: 'mme-portarias-acesso-dc',
    pillar: 'datacenters',
    pillarLabel: 'Projetos de Data Centers NE',
    institution: 'MME (Ministério de Minas e Energia)',
    datasetName: 'Portarias de Acesso à Rede Básica para Consumidores Livres (Art. Decreto nº 5.597/2005)',
    portalOrEndpoint: 'gov.br/mme · Portarias da Secretaria Nacional de Transição Energética e Planejamento (SNTEP)',
    granularity: 'Cadastral / Projetos',
    priority: 'Escopo Mínimo (Obrigatório)',
    targetModelRole: 'Construção de L_DC(t) – Cenários Conservador e Central',
    keyColumnsAndFilters: [
      'Subestação de conexão no NE (ex.: SE Pecém II, SE Fortaleza II, SE Caucaia, SE Suape II, SE Extremoz II)',
      'Montante de Uso do Sistema de Transmissão (MUST em MW) por ano de escalonamento',
      'Cronograma oficial de entrada em operação (rampa contratada 2026–2035)',
      'Razão social / SPE do empreendimento de Data Center (separar de projetos de Hidrogênio Verde)',
    ],
    methodologicalNotes:
      'Esta é a fonte pública mais sólida de maturidade física: todo grande data center (> 50 MW) conectado em alta tensão (230 kV / 500 kV) exige Portaria do MME baseada em estudo de viabilidade da EPE/ONS. Verificar se o MW publicado já é demanda total na rede (não aplicar PUE em duplicidade).',
    accessUrlLabel: 'MME – Portarias Autorizativas de Acesso de Consumidores Livres à Rede Básica',
  },
  {
    id: 'epe-cargas-eletrointensivas-ne',
    pillar: 'datacenters',
    pillarLabel: 'Projetos de Data Centers NE',
    institution: 'EPE & ONS',
    datasetName: 'Estudo Prospectivo para Inserção de Cargas Eletrointensivas no NE + PAR/PEL ONS',
    portalOrEndpoint: 'epe.gov.br / ons.org.br · Cadernos de Planejamento da Transmissão & Fila de Acesso',
    granularity: 'Mensal / Anual',
    priority: 'Escopo Mínimo (Obrigatório)',
    targetModelRole: 'Âncora Metodológica (Seção 10 do PDF), Cenário Alto (Stress Test) e Limites de Intercâmbio',
    keyColumnsAndFilters: [
      'Volume agregado de solicitações de parecer/informação de acesso por estado (CE, PE, RN, BA)',
      'Separação entre cargas de Data Centers (fator de carga ~0.80–0.90) e plantas de H2V',
      'Capacidade remanescente de barramentos e limites de intercâmbio NE ↔ SE/CO e NE ↔ N',
    ],
    methodologicalNotes:
      'Referência direta da Seção 10 do Plano Orientador! O ONS e a EPE consolidam os pedidos em fila (muitos gigawatts solicitados no Ceará e Pernambuco). Ideal para calibrar a taxa de concretização e atraso no Monte Carlo.',
    accessUrlLabel: 'EPE – Estudos de Inserção de Grandes Cargas Eletrointensivas no Nordeste & PAR/PEL ONS',
  },
  {
    id: 'estados-zpe-pecem-fortaleza-suape',
    pillar: 'datacenters',
    pillarLabel: 'Projetos de Data Centers NE',
    institution: 'ZPE Ceará / Complexo do Pecém, ADECE-CE, Suape-PE e SEDEC-RN',
    datasetName: 'Protocolos de Intenção, Licenciamento Estadual (SEMACE/CPRH) e Hub Praia do Futuro',
    portalOrEndpoint: 'complexodopecem.com.br · semace.ce.gov.br · suape.pe.gov.br',
    granularity: 'Cadastral / Projetos',
    priority: 'Cenário Estendido / Stress Test',
    targetModelRole: 'Mapeamento Nominal de Campi Hyperscale (Potência de TI, Fases de Rampa e Localização)',
    keyColumnsAndFilters: [
      'Campi de hiperescala em Fortaleza (Praia do Futuro – hub de cabos submarinos) e ZPE Pecém (Caucaia/São Gonçalo do Amarante)',
      'Licenças Prévia (LP) e de Instalação (LI) estaduais emitidas para data centers',
      'Potência de TI anunciada vs. subestação dedicada construída',
    ],
    methodologicalNotes:
      'Complementa MME/EPE identificando quais projetos já possuem licença de instalação/obras civis (Cenário Conservador) versus anúncios em Memorando de Entendimento – MoU (Cenário Alto).',
    accessUrlLabel: 'Licenciamentos Estaduais (SEMACE-CE / CPRH-PE) & Relatórios ZPE Pecém',
  },
  {
    id: 'aneel-siga-capacidade',
    pillar: 'capacidade_atual',
    pillarLabel: 'Capacidade & Geração Atual NE',
    institution: 'ANEEL – Dados Abertos',
    datasetName: 'SIGA – Sistema de Informações de Geração da ANEEL (siga-empreendimentos-geracao)',
    portalOrEndpoint: 'dadosabertos.aneel.gov.br/dataset/siga-sistema-de-informacoes-de-geracao-da-aneel',
    granularity: 'Cadastral / Projetos',
    priority: 'Escopo Mínimo (Obrigatório)',
    targetModelRole: 'Capacidade Atual Instalada no NE + Trajetórias Onshore (Base, Intermediário, Alto) e denominador de CF(t)',
    keyColumnsAndFilters: [
      'Filtrar UFs do Subsistema NE: AL, BA, CE, MA (parcial ONS, validar submercado), PB, PE, PI, RN, SE',
      'Colunas: dscOrigemCombustivel / sigTipoGeracao (EOL, UFV, UHE, UTE), mdaPotenciaOutorgadaKw, mdaPotenciaFiscalizadaKw',
      'Coluna dscFaseUsina: "Operação" (Cenário Base), "Construção" (Intermediário), "Construção não iniciada" (Alto)',
      'Datas de entrada em operação comercial histórica (para reconstruir capacidade mensal/horária passada)',
    ],
    methodologicalNotes:
      'Atenção técnica: o estado do Maranhão possui grande parte no Subsistema Norte no critério elétrico do ONS, enquanto o oeste da Bahia pertence ao NE. Ao cruzar SIGA com ONS, validar o submercado da usina pelo código CEG!',
    accessUrlLabel: 'Portal Dados Abertos ANEEL – CSV/API CKAN siga-empreendimentos-geracao',
  },
  {
    id: 'ons-geracao-usina-subsistema',
    pillar: 'capacidade_atual',
    pillarLabel: 'Capacidade & Geração Atual NE',
    institution: 'ONS – Portal de Dados Abertos',
    datasetName: 'Geração por Usina em Base Horária & Balanço de Energia nos Subsistemas',
    portalOrEndpoint: 'dados.ons.org.br · datasets: geracao_usina_2 / balanco_energia_subsistema',
    granularity: 'Horária',
    priority: 'Escopo Mínimo (Obrigatório)',
    targetModelRole: 'Modelo B (Alvo CF(t) = Geração Eólica(t) / Capacidade(t)) e Oferta Total G_NE(t)',
    keyColumnsAndFilters: [
      'id_subsistema == "NE" (Subsistema Nordeste)',
      'din_instante (timestamp horário UTC-3)',
      'val_geracao (MWmed) por fonte: Eólica, Solar, Hidráulica, Térmica',
      'Código CEG para cruzar geração efetiva (ONS) com potência instalada (ANEEL)',
    ],
    methodologicalNotes:
      'Permite calcular os dois indicadores exigidos na Seção 6 do PDF: participação eólica na capacidade instalada (ANEEL) vs. participação eólica na geração efetiva horária (ONS).',
    accessUrlLabel: 'Portal Dados Abertos ONS – Geração por Usina e Balanço Horário',
  },
  {
    id: 'ons-curva-carga-intercambio',
    pillar: 'consumo_atual',
    pillarLabel: 'Consumo & Carga Atual NE',
    institution: 'ONS – Portal de Dados Abertos',
    datasetName: 'Curva de Carga Horária & Intercâmbio entre Subsistemas',
    portalOrEndpoint: 'dados.ons.org.br · datasets: curva_carga / intercambio_nacional',
    granularity: 'Horária',
    priority: 'Escopo Mínimo (Obrigatório)',
    targetModelRole: 'Modelo A (Previsão de Carga Base L_base(t)) e Limites Históricos de Intercâmbio SIN',
    keyColumnsAndFilters: [
      'id_subsistema == "NE", coluna val_cargaenergiahomwmed (MW médios horários)',
      'Séries históricas recomendadas: 2018 a 2025/2026 (captura sazonalidade, feriados e crescimento pós-MMGD)',
      'Fluxo líquido de intercâmbio horário NE ↔ SE/CO e NE ↔ N para validar margem M(t)',
    ],
    methodologicalNotes:
      'A "Carga Global ONS" reflete a demanda medida na rede básica + distribuição (líquida da micro/minigeração distribuída não simulada, ou reconstituída). É a variável exata para treinar SARIMAX, XGBoost e LSTM.',
    accessUrlLabel: 'Portal Dados Abertos ONS – Curva de Carga Horária (CSV Anual)',
  },
  {
    id: 'epe-consumo-mensal-pde2035',
    pillar: 'consumo_atual',
    pillarLabel: 'Consumo & Carga Atual NE',
    institution: 'EPE (Empresa de Pesquisa Energética)',
    datasetName: 'Consumo Mensal de Energia Elétrica por Classe/Região & Cadernos PDE 2034/2035',
    portalOrEndpoint: 'epe.gov.br/pt/publicacoes-dados-abertos/publicacoes/consumo-de-energia-eletrica',
    granularity: 'Mensal / Anual',
    priority: 'Escopo Mínimo (Obrigatório)',
    targetModelRole: 'Ancorar a tendência estrutural de longo prazo até 2035 no Modelo A (evitar deriva de extrapolação)',
    keyColumnsAndFilters: [
      'Planilha XLS/CSV "Consumo Mensal por Região e Classe" (Industrial, Comercial, Residencial, Outros no NE)',
      'Taxas anuais projetadas de crescimento da carga no Subsistema NE no PDE 2035',
      'Atenção para descontar no PDE eventual carga de data centers já embutida para não contar duas vezes L_DC(t)',
    ],
    methodologicalNotes:
      'Modelos puramente autorregressivos horários (lags 1/24/168h) perdem referência em horizontes de 10 anos (2035). Usar a taxa anual do PDE/EPE como tendência exógena e deixar o ML prever a modulação horária/sazonal.',
    accessUrlLabel: 'EPE – Dados Abertos de Consumo Mensal & Plano Decenal de Expansão (PDE)',
  },
  {
    id: 'ons-curtailment-era5',
    pillar: 'curtailment_clima',
    pillarLabel: 'Curtailment & Meteorologia',
    institution: 'ONS + Copernicus ERA5 / INMET',
    datasetName: 'Restrição de Operação Constrained-Off de Usinas Eólicas (ONS) + Reanálise ERA5',
    portalOrEndpoint: 'dados.ons.org.br (restricao_coff_eolica_detail) · cds.climate.copernicus.eu',
    granularity: 'Horária',
    priority: 'Escopo Mínimo (Obrigatório)',
    targetModelRole: 'Modelo C (Classificação/Volume de Curtailment) e correção do CF potencial sem corte',
    keyColumnsAndFilters: [
      'ONS Constrained-off: val_geracaoreferencia, val_geracaolimitada, cod_razaorestricao (REL, CNF, ENE)',
      'ERA5 (Opcional recomendado): vento a 100m (u100, v100) e temperatura 2m (t2m) nos centróides eólicos BA/RN/CE/PI',
    ],
    methodologicalNotes:
      'Crucial para o Modelo B e C: em horas de constrained-off, a geração verificada no ONS é MENOR que o vento real disponível! Somar energia cortada à geração verificada para estimar o CF(t) meteorológico real antes de treinar o modelo eólico.',
    accessUrlLabel: 'ONS – Restrição de Operação Constrained-Off Eólicas (Horário/Semi-horário)',
  },
];
