import React, { useMemo, useState } from 'react';
import type {
  AnovaTestResult,
  FeatureCorrelationItem,
  MonthlyWindProfile,
} from '../data/pipelineTypes';

interface AnovaCorrelationsPanelProps {
  anovaResults: AnovaTestResult[];
  monthlyProfiles: MonthlyWindProfile[];
  featureCorrelations: FeatureCorrelationItem[];
  downloadFeedback: string | null;
  onExportAnova: () => void;
  onExportMonthly: () => void;
  onExportCorrelations: () => void;
}

export const AnovaCorrelationsPanel: React.FC<AnovaCorrelationsPanelProps> = ({
  anovaResults,
  monthlyProfiles,
  featureCorrelations,
  downloadFeedback,
  onExportAnova,
  onExportMonthly,
  onExportCorrelations,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredCorrelations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return featureCorrelations.filter((item) => {
      if (selectedCategory !== 'all' && item.roleInModel !== selectedCategory) return false;
      if (!q) return true;
      return (
        item.featureName.toLowerCase().includes(q) ||
        item.featureDescription.toLowerCase().includes(q) ||
        item.roleInModel.toLowerCase().includes(q)
      );
    });
  }, [featureCorrelations, selectedCategory, searchQuery]);

  return (
    <div className="space-y-8">
      <section aria-labelledby="heading-anova-results" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <h2 id="heading-anova-results" className="text-xl font-bold text-slate-900">
              Diagnóstico de Significância Estatística via ANOVA (SciPy f_oneway)
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Testes de hipótese exatos avaliando a variância explicada (η²) pelos agrupadores sazonais, horários e de calendário (2015–2025).
            </p>
          </div>
          <button
            type="button"
            onClick={onExportAnova}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
          >
            Exportar Resultados ANOVA (.csv)
          </button>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 pr-4">Variável Analisada</th>
                <th className="py-3 px-3">Fator Agrupador</th>
                <th className="py-3 px-3">Estatística F</th>
                <th className="py-3 px-3">p-valor</th>
                <th className="py-3 px-3">Variância Explicada (η²)</th>
                <th className="py-3 px-3">Decisão (α = 0,01)</th>
                <th className="py-3 pl-4">Interpretação e Conclusão Técnica</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700 text-xs">
              {anovaResults.map((r) => (
                <tr key={r.targetVariable} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 pr-4 font-semibold text-slate-900 whitespace-nowrap">
                    {r.targetVariable}
                  </td>
                  <td className="py-3.5 px-3 whitespace-nowrap font-medium text-slate-800">
                    {r.groupingFactor}
                  </td>
                  <td className="py-3.5 px-3 font-mono font-bold text-sky-900 whitespace-nowrap">
                    {r.fStatistic.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3.5 px-3 font-mono text-emerald-800 font-bold whitespace-nowrap">
                    {r.pValue === 0 ? '< 10⁻¹⁵' : r.pValue.toFixed(4)}
                  </td>
                  <td className="py-3.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {r.etaSquaredPct.toFixed(2)}%
                  </td>
                  <td className="py-3.5 px-3 font-semibold text-emerald-800 whitespace-nowrap">
                    Rejeita H₀ (p &lt; 0,01)
                  </td>
                  <td className="py-3.5 pl-4 text-slate-600 leading-relaxed max-w-md">
                    {r.technicalInterpretation}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="heading-monthly-profile" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <h2 id="heading-monthly-profile" className="text-xl font-bold text-slate-900">
              Sazonalidade Mensal do Fator de Capacidade Eólico Potencial e Curtailment Real
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Consolidado dos 11 anos históricos reais (2015–2025) com reconstituição do constrained-off do ONS (2023–2025).
            </p>
          </div>
          <button
            type="button"
            onClick={onExportMonthly}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
          >
            Exportar Perfil Mensal (.csv)
          </button>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 pr-3">Mês</th>
                <th className="py-3 px-3">Regime Sazonal</th>
                <th className="py-3 px-4">Fator de Capacidade Médio (CF)</th>
                <th className="py-3 px-3">CF P10 (Firme)</th>
                <th className="py-3 px-3">Mediana P50</th>
                <th className="py-3 px-3">CF P90</th>
                <th className="py-3 px-3">Curtailment 23–25</th>
                <th className="py-3 pl-3">Demanda Média NE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700 text-xs font-mono">
              {monthlyProfiles.map((m) => {
                const isSafra = m.seasonalRegime === 'Safra dos Ventos';
                const isCalmaria = m.seasonalRegime === 'Estação Chuvosa / Calmaria';
                const cfPctWidth = Math.max(0, Math.min(100, Math.round(m.avgCapacityFactor * 100)));
                const barFill = isSafra ? '#d97706' : isCalmaria ? '#0284c7' : '#64748b';

                return (
                  <tr key={m.month} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 pr-3 font-sans font-bold text-slate-900 whitespace-nowrap">
                      {m.month.toString().padStart(2, '0')} · {m.monthName}
                    </td>
                    <td
                      className={`py-3 px-3 font-sans font-semibold whitespace-nowrap ${
                        isSafra ? 'text-amber-800' : isCalmaria ? 'text-sky-800' : 'text-slate-600'
                      }`}
                    >
                      {m.seasonalRegime}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <svg viewBox="0 0 100 8" className="w-20 h-2 rounded-full overflow-hidden shrink-0" aria-hidden="true">
                          <rect width="100" height="8" rx="4" fill="#f1f5f9" />
                          <rect width={cfPctWidth} height="8" rx="4" fill={barFill} />
                        </svg>
                        <span className="font-bold text-slate-900">
                          {(m.avgCapacityFactor * 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-rose-700 font-semibold whitespace-nowrap">
                      {(m.p10CapacityFactor * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-slate-800 whitespace-nowrap">
                      {(m.p50MedianCapacityFactor * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-emerald-800 font-semibold whitespace-nowrap">
                      {(m.p90CapacityFactor * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 font-semibold text-amber-900 whitespace-nowrap">
                      {m.avgCurtailmentMW.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MWmed
                    </td>
                    <td className="py-3 pl-3 font-sans font-medium text-slate-800 whitespace-nowrap">
                      {m.avgBaseLoadMW.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MW
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="heading-correlations" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <h2 id="heading-correlations" className="text-xl font-bold text-slate-900">
              Matriz de Correlação de Pearson com as Variáveis-Alvo (Incluindo Curtailment Real)
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Avaliação empírica das features para os Modelos A (Carga), B (Vento Potencial) e C (Curtailment 2023–2025).
            </p>
          </div>

          <button
            type="button"
            onClick={onExportCorrelations}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer self-start lg:self-auto"
          >
            {downloadFeedback ?? 'Baixar Correlações (.csv)'}
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="filter-corr-search" className="block text-xs font-medium text-slate-700 mb-1">
              Buscar Feature ou Descrição
            </label>
            <input
              id="filter-corr-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ex.: lag, fourier, excedente, solar..."
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div>
            <label htmlFor="filter-corr-category" className="block text-xs font-medium text-slate-700 mb-1">
              Categoria da Feature
            </label>
            <select
              id="filter-corr-category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="all">Todas as Categorias</option>
              <option value="Autoregressiva (Lag)">Autoregressiva (Lags 1h, 24h, 168h)</option>
              <option value="Balanço Físico Exógeno">Balanço Físico Exógeno (Geração vs. Carga)</option>
              <option value="Harmônica (Fourier)">Harmônica (Fourier Cíclico)</option>
              <option value="Calendário">Calendário e Operativa</option>
              <option value="Não-Linearidade Aerodinâmica">Não-Linearidade Aerodinâmica (v³, P²)</option>
            </select>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 pr-3">Nome da Feature</th>
                <th className="py-3 px-3">Papel Modelar</th>
                <th className="py-3 px-3">Descrição Técnica</th>
                <th className="py-3 px-4 font-mono">Corr(r) Carga Base</th>
                <th className="py-3 px-4 font-mono">Corr(r) CF Eólico</th>
                <th className="py-3 pl-4 font-mono">Corr(r) Curtailment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700 text-xs">
              {filteredCorrelations.map((c) => (
                <tr key={c.featureName} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 pr-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                    {c.featureName}
                  </td>
                  <td className="py-3 px-3 font-medium text-slate-700 whitespace-nowrap">
                    {c.roleInModel}
                  </td>
                  <td className="py-3 px-3 text-slate-600 max-w-xs">
                    {c.featureDescription}
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                    <span
                      className={
                        Math.abs(c.corrBaseLoad) > 0.7
                          ? 'text-sky-800 font-bold'
                          : Math.abs(c.corrBaseLoad) > 0.3
                            ? 'text-slate-900'
                            : 'text-slate-500'
                      }
                    >
                      {c.corrBaseLoad > 0 ? `+${c.corrBaseLoad.toFixed(3)}` : c.corrBaseLoad.toFixed(3)}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                    <span
                      className={
                        Math.abs(c.corrWindCF) > 0.7
                          ? 'text-emerald-800 font-bold'
                          : Math.abs(c.corrWindCF) > 0.3
                            ? 'text-slate-900'
                            : 'text-slate-500'
                      }
                    >
                      {c.corrWindCF > 0 ? `+${c.corrWindCF.toFixed(3)}` : c.corrWindCF.toFixed(3)}
                    </span>
                  </td>
                  <td className="py-3 pl-4 font-mono font-semibold whitespace-nowrap">
                    <span
                      className={
                        Math.abs(c.corrCurtailment) > 0.35
                          ? 'text-amber-800 font-bold'
                          : Math.abs(c.corrCurtailment) > 0.15
                            ? 'text-slate-800'
                            : 'text-slate-400'
                      }
                    >
                      {c.corrCurtailment > 0 ? `+${c.corrCurtailment.toFixed(3)}` : c.corrCurtailment.toFixed(3)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
