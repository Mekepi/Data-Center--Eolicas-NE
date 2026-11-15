import React from 'react';
import { usePipelineSsot } from '../data/pipelineSsotContext';
import { downloadTextFile } from '../utils/csvExport';

interface DecisionsAndPdfViewProps {
  decisions: Record<string, string>;
  onSelectDecision: (decisionId: string, value: string) => void;
}

export const DecisionsAndPdfView: React.FC<DecisionsAndPdfViewProps> = ({
  decisions,
  onSelectDecision,
}) => {
  const { ssot } = usePipelineSsot();
  const groupDecisions = ssot.uiCatalog.groupDecisions;
  const pdfPath = ssot.uiCatalog.pdfAssetPath;
  const pdfDownloadFilename = ssot.uiCatalog.pdfDownloadFilename;

  const handleExportDecisionsJson = () => {
    const payload = {
      exportedAtUtc: new Date().toISOString(),
      ssotSchemaVersion: ssot.schemaVersion,
      ssotGeneratedAtUtc: ssot.lineage.generatedAtUtc,
      activeConfigParameters: {
        subsystemId: ssot.config.subsystemId,
        historyWindow: `${ssot.config.historyStartYear}-${ssot.config.historyEndYear}`,
        baselineYear: ssot.config.baselineYear,
        projectionWindow: `${ssot.config.projectionStartYear}-${ssot.config.targetEndYear}`,
        hoursPerYear: ssot.config.hoursPerYear,
        offshoreCommercialStartYear: ssot.config.offshoreCommercialStartYear,
        pecemSubstationName: ssot.config.pecemSubstationName,
        defaultH2vComparisonMW: ssot.config.defaultH2vComparisonMW,
      },
      decisions: groupDecisions.map((item) => {
        const selectedValue = decisions[item.id] ?? item.options[0]?.value ?? '';
        const selectedOption = item.options.find((opt) => opt.value === selectedValue) ?? item.options[0];
        return {
          id: item.id,
          topic: item.topic,
          selectedValue,
          selectedLabel: selectedOption?.label ?? '',
          rationale: selectedOption?.rationale ?? '',
        };
      }),
    };
    downloadTextFile(
      JSON.stringify(payload, null, 2),
      'decisoes_metodologicas_grupo6.json',
      'application/json;charset=utf-8;'
    );
  };

  return (
    <div className="space-y-8">
      {/* Decisões em aberto para o grupo fechar */}
      <section aria-labelledby="heading-decisoes" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="max-w-3xl space-y-1.5">
            <p className="text-xs font-medium text-sky-800">
              Governança do Projeto · Alinhamento com a Esteira Python SSOT
            </p>
            <h1 id="heading-decisoes" className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
              Decisões Metodológicas do Grupo
            </h1>
            <p className="text-sm lg:text-base text-slate-600 leading-relaxed">
              Registre e exporte as escolhas técnicas do grupo. Os resultados exibidos nas abas de modelagem refletem a
              configuração ativa na esteira Python/SSOT (<span className="font-mono">run_pipeline.py</span>); as
              seleções abaixo ficam salvas no navegador (<span className="font-mono">localStorage</span>) para registro e
              comparação entre alternativas.
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportDecisionsJson}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto cursor-pointer"
          >
            Exportar Diretrizes (.json)
          </button>
        </div>

        <div className="divide-y divide-slate-200">
          {groupDecisions.map((item) => {
            const currentVal = decisions[item.id] ?? item.options[0]?.value ?? '';
            return (
              <div key={item.id} className="py-6 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">{item.topic}</h2>
                  <p className="text-sm text-slate-600 mt-0.5">{item.question}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {item.options.map((opt) => {
                    const selected = currentVal === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={`block p-4 rounded-lg border transition-colors cursor-pointer ${
                          selected
                            ? 'bg-sky-50/70 border-sky-700'
                            : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="radio"
                            name={item.id}
                            value={opt.value}
                            checked={selected}
                            onChange={() => onSelectDecision(item.id, opt.value)}
                            className="mt-0.5 text-sky-700 focus:ring-sky-600"
                          />
                          <div className="space-y-1">
                            <span className="text-sm font-semibold text-slate-900 block">{opt.label}</span>
                            <span className="text-xs text-slate-600 leading-relaxed block">{opt.rationale}</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Visualizador e Download do Plano Orientador Original em PDF */}
      <section aria-labelledby="heading-pdf" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <h2 id="heading-pdf" className="text-lg font-bold text-slate-900">
              Documento de Referência: Plano Orientador do Projeto (PDF)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Todas as diretrizes, equações e benchmarks da esteira derivam diretamente das 10 seções deste documento.
            </p>
          </div>
          <a
            href={pdfPath}
            download={pdfDownloadFilename}
            className="px-4 py-2 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            Baixar PDF Completo
          </a>
        </div>

        <div className="mt-5 border border-slate-200 rounded-lg overflow-hidden bg-slate-100 h-[620px]">
          <object data={pdfPath} type="application/pdf" className="w-full h-full">
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-slate-700">
                Seu navegador não suporta visualização embutida de PDF neste painel.
              </p>
              <a
                href={pdfPath}
                download={pdfDownloadFilename}
                className="inline-block px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg"
              >
                Clique aqui para baixar o Plano Orientador (.pdf)
              </a>
            </div>
          </object>
        </div>
      </section>
    </div>
  );
};
