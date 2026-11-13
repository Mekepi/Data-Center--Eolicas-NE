import React, { useMemo, useState } from 'react';
import { usePipelineSsot } from '../data/pipelineSsotContext';
import { downloadDelimitedCsv } from '../utils/csvExport';

export const DataCentersPipelineView: React.FC = () => {
  const { ssot } = usePipelineSsot();
  const pipeline = ssot.dataCentersPipeline;
  const substations = ssot.substationLoadConcentration;
  const annualRamp = ssot.scenarioAnnualRamp;

  const [selectedState, setSelectedState] = useState<string>('all');
  const [selectedScenario, setSelectedScenario] = useState<string>('all');
  const [selectedSubstation, setSelectedSubstation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(pipeline[6]?.id ?? pipeline[0]?.id ?? null);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);

  const pipelineKpis = useMemo(() => {
    const uniqueStates = Array.from(new Set(pipeline.map((p) => p.state)));
    const fullItMW = pipeline.reduce((acc, p) => acc + p.itPowerMW, 0);
    const fullGridMW = pipeline.reduce((acc, p) => acc + p.totalGridPowerMW, 0);
    const pecem = substations.find((s) => s.substation === 'SE Pecém II');
    const suape = substations.find((s) => s.substation === 'SE Suape II');
    const ceSubs = substations.filter((s) => s.state === 'CE');
    const ceEffMW = ceSubs.reduce((acc, s) => acc + s.effectiveDemand2035MW, 0);
    const ceSharePct = ceSubs.reduce((acc, s) => acc + s.sharePct, 0);
    const lastRamp = annualRamp[annualRamp.length - 1];

    const consProjects = pipeline.filter((p) => p.scenario === 'conservative');
    const centralProjects = pipeline.filter((p) => p.scenario === 'conservative' || p.scenario === 'central');
    const consItMW = consProjects.reduce((acc, p) => acc + p.itPowerMW, 0);
    const centralItMW = centralProjects.reduce((acc, p) => acc + p.itPowerMW, 0);

    const stateCounts = uniqueStates.map((st) => ({
      state: st,
      count: pipeline.filter((p) => p.state === st).length,
    }));
    const uniqueSubstations = Array.from(
      new Map(
        substations.map((s) => [
          `${s.substation}::${s.voltageKV}`,
          { key: `${s.substation}::${s.voltageKV}`, substation: s.substation, state: s.state, voltageKV: s.voltageKV },
        ])
      ).values()
    );

    return {
      uniqueStates,
      fullItMW,
      fullGridMW,
      pecem,
      suape,
      ceEffMW,
      ceSharePct,
      lastRamp,
      consCount: consProjects.length,
      centralCount: centralProjects.length,
      highCount: pipeline.length,
      consItMW,
      centralItMW,
      stateCounts,
      uniqueSubstations,
    };
  }, [pipeline, substations, annualRamp]);

  // Filtros combinados
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pipeline.filter((proj) => {
      if (selectedState !== 'all' && proj.state !== selectedState) return false;
      if (selectedScenario !== 'all' && proj.scenario !== selectedScenario) return false;
      if (selectedSubstation !== 'all' && `${proj.substation}::${proj.voltageKV}` !== selectedSubstation) return false;
      if (!q) return true;
      return (
        proj.name.toLowerCase().includes(q) ||
        proj.developer.toLowerCase().includes(q) ||
        proj.municipality.toLowerCase().includes(q) ||
        proj.substation.toLowerCase().includes(q) ||
        proj.id.toLowerCase().includes(q) ||
        proj.officialSource.toLowerCase().includes(q)
      );
    });
  }, [pipeline, selectedState, selectedScenario, selectedSubstation, searchQuery]);

  // Cálculos de métricas do pipeline filtrado
  const totalItMW = useMemo(
    () => filteredProjects.reduce((acc, p) => acc + p.itPowerMW, 0),
    [filteredProjects]
  );
  const totalGridMW = useMemo(
    () => filteredProjects.reduce((acc, p) => acc + p.totalGridPowerMW, 0),
    [filteredProjects]
  );

  const resetFilters = () => {
    setSelectedState('all');
    setSelectedScenario('all');
    setSelectedSubstation('all');
    setSearchQuery('');
  };

  const handleExportCsv = (type: 'pipeline' | 'substations' | 'ramp') => {
    let filename = '';

    if (type === 'pipeline') {
      filename = 'data_centers_pipeline_ne.csv';
      downloadDelimitedCsv(
        filename,
        [
          'id_projeto',
          'nome_projeto',
          'estado',
          'municipio',
          'subestacao_conexao',
          'tensao_conexao_kv',
          'potencia_it_mw',
          'potencia_total_rede_mw',
          'pue_estimado',
          'tipo_publicacao',
          'ano_inicio_previsto',
          'rampa_meses',
          'estagio_maturidade',
          'cenario_enquadramento',
          'probabilidade_concretizacao',
          'atraso_esperado_anos',
          'fonte_oficial',
        ],
        pipeline.map((p) => [
          p.id,
          p.name,
          p.state,
          p.municipality,
          p.substation,
          p.voltageKV,
          p.itPowerMW,
          p.totalGridPowerMW,
          p.estimatedPUE,
          p.publicationType,
          p.expectedStartYear,
          p.rampMonths,
          p.maturityStage,
          p.scenario,
          p.realizationProbability,
          p.expectedDelayYears,
          p.officialSource,
        ])
      );
    } else if (type === 'substations') {
      filename = 'dc_substation_load_concentration.csv';
      downloadDelimitedCsv(
        filename,
        [
          'subestacao',
          'estado',
          'tensao_kv',
          'n_projetos',
          'potencia_it_total_mw',
          'demanda_efetiva_2035_mw',
          'participacao_pct',
          'p95_monte_carlo_mw',
          'risco_congestionamento',
        ],
        substations.map((s) => [
          s.substation,
          s.state,
          s.voltageKV,
          s.projectCount,
          s.itPowerTotalMW,
          s.effectiveDemand2035MW,
          s.sharePct,
          s.p95MonteCarloMW,
          s.congestionRisk,
        ])
      );
    } else {
      filename = 'trajetoria_rampa_anual_2026_2035.csv';
      downloadDelimitedCsv(
        filename,
        ['ano', 'cenario_conservador_mw', 'cenario_central_mw', 'cenario_alto_mw', 'projetos_ativos'],
        annualRamp.map((r) => [r.year, r.conservativeMW, r.centralMW, r.highMW, r.activeProjectsHigh])
      );
    }

    setDownloadFeedback(`Arquivo ${filename} baixado`);
    window.setTimeout(() => setDownloadFeedback(null), 2500);
  };

  return (
    <div className="space-y-10">
      {/* Banner de Contexto Metodológico - Passo 2 */}
      <section aria-labelledby="heading-passo2-intro" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="max-w-4xl space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
            Etapa 02 Concluída · Modelagem Bottom-Up por Projeto e Subestação
          </p>
          <h1 id="heading-passo2-intro" className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
            Pipeline Nominal de Data Centers & Concentração na Rede Básica do SIN
          </h1>
          <p className="text-base text-slate-700 leading-relaxed">
            Em conformidade com a <strong>Seção 5 do Plano Orientador</strong>, os data centers não são modelados como uma
            carga abstrata e instantânea. Mapeamos os <strong>{pipeline.length} projetos nominais</strong> cadastrados em{' '}
            <span className="font-mono text-xs">data/raw/data_centers_pipeline_ne.csv</span> (MME, EPE, licenças estaduais
            e fila ONS), com simulação de rampa progressiva, verificação estrita de não-duplicação de PUE e amostragem
            estocástica de atrasos.
          </p>
        </div>

        {/* 4 Cards de Métricas Chave do Pipeline (calculados dinamicamente via SSOT) */}
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500 block">Projetos Nominais</span>
            <span className="text-2xl font-bold text-slate-900 mt-1 block">{pipeline.length}</span>
            <span className="text-xs text-slate-600 mt-1 block">
              Em {pipelineKpis.uniqueStates.length} estados do NE ({pipelineKpis.uniqueStates.join(', ')})
            </span>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500 block">Potência TI Declarada</span>
            <span className="text-2xl font-bold text-slate-900 mt-1 block">
              {pipelineKpis.fullItMW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW
            </span>
            <span className="text-xs text-slate-600 mt-1 block">
              {pipelineKpis.fullGridMW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW carga total máx. na rede
            </span>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500 block">Concentração em SE Pecém II</span>
            <span className="text-2xl font-bold text-amber-700 mt-1 block">
              {pipelineKpis.pecem ? `${pipelineKpis.pecem.sharePct.toFixed(1)}%` : '—'}
            </span>
            <span className="text-xs text-slate-600 mt-1 block">
              {pipelineKpis.pecem
                ? `${pipelineKpis.pecem.effectiveDemand2035MW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW na barra de ${pipelineKpis.pecem.voltageKV} kV`
                : 'Rede Básica 500 kV'}
            </span>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500 block">Hub Ceará (Pecém + Fortaleza)</span>
            <span className="text-2xl font-bold text-sky-800 mt-1 block">
              {pipelineKpis.ceEffMW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW
            </span>
            <span className="text-xs text-slate-600 mt-1 block">
              {pipelineKpis.ceSharePct.toFixed(1)}% do total por causa dos cabos submarinos
            </span>
          </div>
        </div>

        {/* Regras Metodológicas da Seção 5 do PDF */}
        <div className="mt-6 pt-6 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-600">
          <div className="space-y-1">
            <strong className="text-slate-900 block font-medium">1. Não-duplicação de PUE:</strong>
            <span>
              Se a potência de um projeto for publicada pelo desenvolvedor como carga total na rede elétrica, o PUE não
              é reaplicado. Caso seja potência de TI útil, aplica-se o PUE específico auditado (1.18 a 1.32).
            </span>
          </div>
          <div className="space-y-1">
            <strong className="text-slate-900 block font-medium">2. Rampa temporal de ocupação:</strong>
            <span>
              A carga não entra em degrau instantâneo. A taxa de instalação de servidores segue uma rampa linear/sigmoidal
              de 12 a 36 meses a partir da data de início da operação comercial.
            </span>
          </div>
          <div className="space-y-1">
            <strong className="text-slate-900 block font-medium">3. Amostragem Estocástica Monte Carlo:</strong>
            <span>
              No script 06, cada iteração sorteia a concretização do projeto (<span className="font-mono">Bernoulli(p)</span>)
              e o atraso na conexão (<span className="font-mono">Uniforme(0, atraso × 1.5)</span>), refletindo incertezas de licenciamento.
            </span>
          </div>
        </div>
      </section>

      {/* Seção 2: Concentração Geográfica e Barramentos Críticos da Rede Básica (ONS) */}
      <section aria-labelledby="heading-substations" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <h2 id="heading-substations" className="text-xl font-bold text-slate-900">
              Concentração Espacial por Subestação da Rede Básica (ONS)
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Avaliação do ponto de entrega elétrico onde as cargas de hiperescala e IA se conectarão ao SIN até 2035.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleExportCsv('substations')}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
          >
            Exportar Subestações (.csv)
          </button>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 pr-4">Subestação (Barramento SIN)</th>
                <th className="py-3 px-3">UF</th>
                <th className="py-3 px-3">Tensão (kV)</th>
                <th className="py-3 px-3">Projetos</th>
                <th className="py-3 px-4">Demanda 2035 (MW)</th>
                <th className="py-3 px-4">Participação %</th>
                <th className="py-3 px-4">P95 Monte Carlo (MW)</th>
                <th className="py-3 pl-4">Risco de Congestionamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {substations.map((sub) => {
                const isCritico = sub.congestionRisk === 'Crítico';
                const isElevado = sub.congestionRisk === 'Elevado';

                return (
                  <tr key={`${sub.substation}-${sub.voltageKV}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 pr-4 font-semibold text-slate-900 whitespace-nowrap">
                      {sub.substation}
                    </td>
                    <td className="py-3.5 px-3 font-semibold text-slate-800 whitespace-nowrap">
                      {sub.state}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-xs whitespace-nowrap">
                      {sub.voltageKV} kV
                    </td>
                    <td className="py-3.5 px-3 font-medium text-slate-800 whitespace-nowrap">
                      {sub.projectCount}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {sub.effectiveDemand2035MW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <svg viewBox="0 0 100 8" className="w-16 h-2 rounded-full overflow-hidden shrink-0" aria-hidden="true">
                          <rect width="100" height="8" rx="4" fill="#f1f5f9" />
                          <rect
                            width={Math.max(0, Math.min(100, sub.sharePct * 1.8))}
                            height="8"
                            rx="4"
                            fill={sub.sharePct > 40 ? '#d97706' : sub.sharePct > 15 ? '#0284c7' : '#94a3b8'}
                          />
                        </svg>
                        <span className="font-mono text-xs text-slate-700">{sub.sharePct}%</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-800 whitespace-nowrap">
                      {sub.p95MonteCarloMW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW
                    </td>
                    <td
                      className={`py-3.5 pl-4 font-semibold text-xs whitespace-nowrap ${
                        isCritico ? 'text-rose-800' : isElevado ? 'text-amber-800' : 'text-emerald-800'
                      }`}
                    >
                      {sub.congestionRisk}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Diagnóstico Técnico da Rede Básica */}
        <div className="mt-6 p-4 bg-amber-50/70 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1.5">
          <p className="font-semibold text-amber-950">
            Diagnóstico Elétrico de Concentração Geográfica (Pecém e Suape):
          </p>
          <p className="leading-relaxed">
            A <strong>SE Pecém II (500 kV)</strong> e a <strong>SE Suape II (230 kV)</strong> concentram juntas{' '}
            <strong>
              {((pipelineKpis.pecem?.sharePct ?? 0) + (pipelineKpis.suape?.sharePct ?? 0)).toFixed(1)}% de toda a demanda
              de data centers projetada para o Nordeste
            </strong>
            . Enquanto isso oferece a vantagem de absorver diretamente a energia gerada pelos parques eólicos litorâneos
            adjacentes (reduzindo curtailment local), impõe severo estresse sobre os transformadores 500/230 kV e linhas
            troncais de interconexão em momentos de vento fraco, quando essas cargas precisarão ser alimentadas pelo
            restante do SIN.
          </p>
        </div>
      </section>

      {/* Seção 3: Curva de Rampa Temporal Bottom-Up (2026–2035) */}
      <section aria-labelledby="heading-ramp-evolution" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <h2 id="heading-ramp-evolution" className="text-xl font-bold text-slate-900">
              Trajetória Anual da Carga em Rampa (2026–2035)
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Evolução da demanda efetiva na rede elétrica (MW) simulada ano a ano segundo os 3 cenários do estudo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleExportCsv('ramp')}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
          >
            Exportar Rampa Anual (.csv)
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 tabular-nums">
          {/* Card Resumo 2035 Conservador */}
          <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cenário Conservador</span>
              <span className="text-xs font-semibold font-mono text-emerald-800">{pipelineKpis.consCount} Projetos</span>
            </div>
            <div className="space-y-1">
              <span className="text-3xl font-bold text-slate-900">
                {(pipelineKpis.lastRamp?.conservativeMW ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW
              </span>
              <span className="text-xs text-slate-500 block">
                {pipelineKpis.consItMW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW TI útil · 100% de maturação
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed pt-2 border-t border-slate-200">
              Compreende exclusivamente os projetos com licença de instalação emitida, obras civis iniciadas ou contratos
              firmes (Scala Fase 1, V.tal Praia do Futuro/Maresia, Ascenty Suape I, Elea e HostDime).
            </p>
          </div>

          {/* Card Resumo 2035 Central */}
          <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-800">Cenário Central (Ponderado)</span>
              <span className="text-xs font-semibold font-mono text-sky-800">{pipelineKpis.centralCount} Projetos</span>
            </div>
            <div className="space-y-1">
              <span className="text-3xl font-bold text-sky-900">
                {(pipelineKpis.lastRamp?.centralMW ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW
              </span>
              <span className="text-xs text-slate-500 block">
                {pipelineKpis.centralItMW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW TI útil · Entrada gradual até 2031
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed pt-2 border-t border-slate-200">
              Inclui os projetos do cenário conservador somados a empreendimentos com portaria do MME ou pedidos de acesso
              à Rede Básica no ONS (Scala Fase 2, ODATA Caucaia, Ascenty Suape II, Extremoz-RN e Camaçari-BA).
            </p>
          </div>

          {/* Card Resumo 2035 Stress Test */}
          <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-800">Cenário Stress Test (Alto)</span>
              <span className="text-xs font-semibold font-mono text-purple-800">{pipelineKpis.highCount} Projetos</span>
            </div>
            <div className="space-y-1">
              <span className="text-3xl font-bold text-purple-900">
                {(pipelineKpis.lastRamp?.highMW ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW
              </span>
              <span className="text-xs text-slate-500 block">
                {pipelineKpis.fullItMW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MW TI útil · Megaclusters de IA até 2035
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed pt-2 border-t border-slate-200">
              Adiciona os megaclusters de Inteligência Artificial previstos para a ZPE do Pecém (Fases 1 e 2 de 700 MW e 800 MW IT)
              e a expansão do Pernambuco Digital Park em Suape (400 MW IT).
            </p>
          </div>
        </div>

        {/* Tabela de Rampa Ano a Ano */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 pr-4">Ano</th>
                <th className="py-2.5 px-4 font-mono">Conservador (MW)</th>
                <th className="py-2.5 px-4 font-mono">Central (MW)</th>
                <th className="py-2.5 px-4 font-mono">Alto / Stress Test (MW)</th>
                <th className="py-2.5 pl-4">Projetos Ativos (Total)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700 font-mono text-xs">
              {annualRamp.map((r) => (
                <tr key={r.year} className="hover:bg-slate-50/80">
                  <td className="py-2.5 pr-4 font-bold text-slate-900">{r.year}</td>
                  <td className="py-2.5 px-4 text-emerald-800">{r.conservativeMW.toFixed(1)} MW</td>
                  <td className="py-2.5 px-4 text-sky-800">{r.centralMW.toFixed(1)} MW</td>
                  <td className="py-2.5 px-4 font-semibold text-purple-900">{r.highMW.toFixed(1)} MW</td>
                  <td className="py-2.5 pl-4 font-sans text-slate-600">
                    {r.activeProjectsHigh} de {pipeline.length} projetos
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Seção 4: Catálogo Interativo dos Projetos Nominais */}
      <section aria-labelledby="heading-catalog" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <h2 id="heading-catalog" className="text-xl font-bold text-slate-900">
              Cadastro Completo de Projetos de Data Centers no Nordeste
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {filteredProjects.length} de {pipeline.length} projetos exibidos · Soma de Potência TI filtrada:{' '}
              <strong className="text-slate-900">{totalItMW.toLocaleString('pt-BR')} MW</strong> (
              {totalGridMW.toLocaleString('pt-BR')} MW rede)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Toggle de Visualização: Tabela vs. Cards */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  viewMode === 'table' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tabela Detalhada
              </button>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  viewMode === 'cards' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Cards Técnicos
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleExportCsv('pipeline')}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {downloadFeedback ?? 'Baixar Cadastro CSV'}
            </button>
          </div>
        </div>

        {/* Filtros de Busca */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor="filter-search" className="block text-xs font-medium text-slate-700 mb-1">
              Buscar Projeto ou Localidade
            </label>
            <input
              id="filter-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ex.: Scala, Pecém, Suape, V.tal..."
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div>
            <label htmlFor="filter-state" className="block text-xs font-medium text-slate-700 mb-1">
              Estado (UF)
            </label>
            <select
              id="filter-state"
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="all">Todos os Estados</option>
              {pipelineKpis.stateCounts.map((st) => (
                <option key={st.state} value={st.state}>
                  {st.state} ({st.count} {st.count === 1 ? 'Projeto' : 'Projetos'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-scenario" className="block text-xs font-medium text-slate-700 mb-1">
              Cenário de Enquadramento
            </label>
            <select
              id="filter-scenario"
              value={selectedScenario}
              onChange={(e) => setSelectedScenario(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="all">Todos os Cenários</option>
              <option value="conservative">Conservador (Confirmados)</option>
              <option value="central">Central (MME / Fila ONS)</option>
              <option value="high">Alto / Stress Test (Megaclusters IA)</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-substation" className="block text-xs font-medium text-slate-700 mb-1">
              Subestação de Conexão
            </label>
            <select
              id="filter-substation"
              value={selectedSubstation}
              onChange={(e) => setSelectedSubstation(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="all">Todas as Subestações</option>
              {pipelineKpis.uniqueSubstations.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.substation} ({s.voltageKV} kV) · {s.state}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Feedback caso nenhum filtro retorne */}
        {filteredProjects.length === 0 ? (
          <div className="mt-8 text-center py-12 border border-dashed border-slate-300 rounded-xl">
            <p className="text-sm text-slate-600">Nenhum projeto encontrado com os filtros selecionados.</p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-3 px-4 py-2 text-xs font-medium text-sky-800 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors cursor-pointer"
            >
              Limpar Filtros
            </button>
          </div>
        ) : viewMode === 'table' ? (
          /* Visualização em Tabela */
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 pr-3">ID</th>
                  <th className="py-3 px-3">Projeto / Desenvolvedor</th>
                  <th className="py-3 px-3">UF / Município</th>
                  <th className="py-3 px-3">Subestação</th>
                  <th className="py-3 px-3">Tensão</th>
                  <th className="py-3 px-3">Pot. TI (MW)</th>
                  <th className="py-3 px-3">PUE</th>
                  <th className="py-3 px-3">Carga Rede (MW)</th>
                  <th className="py-3 px-3">Início</th>
                  <th className="py-3 px-3">Cenário</th>
                  <th className="py-3 pl-3">Maturidade / Fonte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700 text-xs">
                {filteredProjects.map((proj) => {
                  const isExpanded = expandedProjectId === proj.id;
                  const scenarioTextColor =
                    proj.scenario === 'conservative'
                      ? 'text-emerald-800'
                      : proj.scenario === 'central'
                        ? 'text-sky-800'
                        : 'text-purple-800';

                  return (
                    <React.Fragment key={proj.id}>
                      <tr
                        onClick={() => setExpandedProjectId(isExpanded ? null : proj.id)}
                        className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${
                          isExpanded ? 'bg-sky-50/50' : ''
                        }`}
                      >
                        <td className="py-3 pr-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {proj.id}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900">{proj.name}</div>
                          <div className="text-[11px] text-slate-500">{proj.developer}</div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="font-semibold text-slate-800">{proj.state}</span> · {proj.municipality}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap font-medium text-slate-800">
                          {proj.substation}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap font-mono">
                          {proj.voltageKV} kV
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                          {proj.itPowerMW} MW
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {proj.estimatedPUE.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-800 whitespace-nowrap">
                          {proj.totalGridPowerMW} MW
                        </td>
                        <td className="py-3 px-3 font-mono whitespace-nowrap">
                          {proj.expectedStartYear} ({proj.rampMonths}m)
                        </td>
                        <td className={`py-3 px-3 whitespace-nowrap font-semibold uppercase text-[11px] ${scenarioTextColor}`}>
                          {proj.scenario}
                        </td>
                        <td className="py-3 pl-3">
                          <span className="truncate max-w-[200px] block text-slate-600">
                            {proj.maturityStage}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/90 text-xs">
                          <td colSpan={11} className="p-4 border-b border-slate-200">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <span className="font-semibold text-slate-900 block">Fonte Oficial e Licenciamento:</span>
                                <p className="text-slate-700 bg-white p-2.5 rounded border border-slate-200">
                                  {proj.officialSource}
                                </p>
                              </div>
                              <div className="space-y-1.5">
                                <span className="font-semibold text-slate-900 block">Parâmetros de Simulação Estocástica:</span>
                                <div className="text-slate-700 bg-white p-2.5 rounded border border-slate-200 space-y-1">
                                  <div>
                                    Probabilidade de concretização (Monte Carlo):{' '}
                                    <strong className="text-slate-900">{(proj.realizationProbability * 100).toFixed(0)}%</strong>
                                  </div>
                                  <div>
                                    Atraso esperado no cronograma:{' '}
                                    <strong className="text-slate-900">{proj.expectedDelayYears} anos</strong>
                                  </div>
                                  <div>
                                    Rampa de ocupação da carga:{' '}
                                    <strong className="text-slate-900">{proj.rampMonths} meses</strong>
                                  </div>
                                  <div>
                                    Observação técnica:{' '}
                                    <span className="text-slate-600">{proj.notes}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Visualização em Cards Técnicos */
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredProjects.map((proj) => {
              const scenarioTextColor =
                proj.scenario === 'conservative'
                  ? 'text-emerald-800'
                  : proj.scenario === 'central'
                    ? 'text-sky-800'
                    : 'text-purple-800';

              return (
                <div
                  key={proj.id}
                  className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-slate-900">{proj.id}</span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className={`font-semibold uppercase ${scenarioTextColor}`}>{proj.scenario}</span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="font-semibold text-slate-700">{proj.state}</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-1">{proj.name}</h3>
                      <p className="text-xs text-slate-500">{proj.developer} · {proj.municipality}</p>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xl font-bold text-slate-900 block font-mono">{proj.itPowerMW} MW</span>
                      <span className="text-[10px] text-slate-500">TI Útil ({proj.totalGridPowerMW} MW rede)</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-3 border-t border-slate-200">
                    <div>
                      <span className="text-slate-500 block text-[11px]">Subestação</span>
                      <span className="font-medium text-slate-900">{proj.substation}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">Tensão</span>
                      <span className="font-mono text-slate-900">{proj.voltageKV} kV</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">PUE</span>
                      <span className="font-mono text-slate-900">{proj.estimatedPUE.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">Entrada</span>
                      <span className="font-medium text-slate-900">{proj.expectedStartYear} ({proj.rampMonths}m)</span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-white rounded border border-slate-200 text-xs space-y-1">
                    <span className="text-slate-500 block text-[10px] uppercase font-semibold">Fonte Oficial / Licença:</span>
                    <p className="text-slate-800 font-medium">{proj.officialSource}</p>
                    <p className="text-slate-500 text-[11px] pt-1 border-t border-slate-100">{proj.notes}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
