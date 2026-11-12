import React, { useState } from 'react';
import { SCRIPTS_PIPELINE, type ScriptSpec } from '../data/scriptsRoadmap';

export const ScriptsPipelineView: React.FC = () => {
  const [selectedScriptId, setSelectedScriptId] = useState<string>(SCRIPTS_PIPELINE[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeScript: ScriptSpec =
    SCRIPTS_PIPELINE.find((s) => s.id === selectedScriptId) ?? SCRIPTS_PIPELINE[0];

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeScript.starterCode);
      setCopiedId(activeScript.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(null);
    }
  };

  const handleDownloadPython = () => {
    const blob = new Blob([activeScript.starterCode], { type: 'text/x-python;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeScript.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="heading-scripts" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="pb-6 border-b border-slate-200">
          <div className="max-w-3xl space-y-2">
            <p className="text-xs font-medium text-sky-800">
              Passos 01 a 05 Concluídos · Arquitetura Modular Executada em Python (numpy, scipy, pandas)
            </p>
            <h1 id="heading-scripts" className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
              Esteira Completa de 7 Scripts Python do Projeto (Etapas 01 a 07)
            </h1>
            <p className="text-sm lg:text-base text-slate-600 leading-relaxed">
              Todos os <strong>7 scripts sequenciais</strong> (incluindo o motor matemático{' '}
              <span className="font-mono">ml_models_numpy.py</span> e a consolidação de sensibilidade do Passo 5{' '}
              <span className="font-mono">07_sensitivity_and_final_report.py</span>) foram executados sobre a série
              histórica oficial 2015–2025 e exportaram seus relatórios em <span className="font-mono">/reports/</span>.
            </p>
          </div>
        </div>

        {/* Seletor das 6 Etapas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 py-6 border-b border-slate-200">
          {SCRIPTS_PIPELINE.map((script) => {
            const isActive = script.id === activeScript.id;
            return (
              <button
                key={script.id}
                type="button"
                onClick={() => setSelectedScriptId(script.id)}
                className={`text-left p-4 rounded-lg border transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div
                  className={`text-xs font-mono mb-1 ${
                    isActive ? 'text-sky-300' : 'text-slate-500'
                  }`}
                >
                  Etapa {script.order} · {script.stageLabel}
                </div>
                <div className="text-sm font-semibold truncate">{script.filename}</div>
              </button>
            );
          })}
        </div>

        {/* Especificação Detalhada do Script Selecionado */}
        <div className="pt-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 space-y-5">
            <div className="space-y-1.5">
              <p className="text-xs font-mono text-sky-800">
                Etapa {activeScript.order} · {activeScript.filename}
              </p>
              <h2 className="text-lg font-bold text-slate-900">{activeScript.title}</h2>
              <p className="text-sm text-slate-600 leading-relaxed">{activeScript.purpose}</p>
            </div>

            <div className="space-y-2 pt-3 border-t border-slate-200">
              <h3 className="text-xs font-semibold text-slate-900">Arquivos de Entrada (Inputs):</h3>
              <ul className="list-disc pl-4 space-y-1 text-xs text-slate-600">
                {activeScript.inputs.map((inp, idx) => (
                  <li key={idx}>{inp}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-2 pt-3 border-t border-slate-200">
              <h3 className="text-xs font-semibold text-slate-900">Artefatos Gerados (Outputs):</h3>
              <ul className="list-disc pl-4 space-y-1 text-xs font-mono text-slate-700">
                {activeScript.outputs.map((out, idx) => (
                  <li key={idx}>{out}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-2 pt-3 border-t border-slate-200">
              <h3 className="text-xs font-semibold text-slate-900">Decisões de Engenharia neste Script:</h3>
              <ul className="list-disc pl-4 space-y-1.5 text-xs text-slate-600 leading-relaxed">
                {activeScript.keyDecisionsForGroup.map((dec, idx) => (
                  <li key={idx}>{dec}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="lg:col-span-7 flex flex-col">
            <div className="flex items-center justify-between gap-3 pb-3">
              <span className="text-xs font-mono font-medium text-slate-700">
                Esqueleto base · {activeScript.filename}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedId === activeScript.id ? 'Código copiado!' : 'Copiar template Python'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPython}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Baixar .py
                </button>
              </div>
            </div>

            <pre className="flex-1 p-4 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
              <code>{activeScript.starterCode}</code>
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
};
