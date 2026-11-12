import React from 'react';

export interface GroupDecisionItem {
  id: string;
  topic: string;
  question: string;
  options: { value: string; label: string; rationale: string }[];
}

export const GROUP_DECISIONS: GroupDecisionItem[] = [
  {
    id: 'dec-window',
    topic: '01. Janela Histórica de Treino e Backtesting (ONS)',
    question: 'Qual recorte temporal usar para treinar Carga Base, CF(t) e Curtailment?',
    options: [
      {
        value: '2019_2025',
        label: '2019–2024 (Treino) e 2025 (Teste Out-of-Time) — Recomendado',
        rationale:
          'Captura a maturação recente dos complexos eólicos/solares do NE e o aumento de constrained-off pós-2023 sem excesso de dados defasados.',
      },
      {
        value: '2015_2025',
        label: '2015–2023 (Treino) e 2024–2025 (Teste)',
        rationale:
          'Aumenta a amostra climática de El Niño/La Niña, mas exige cuidado maior com mudança estrutural da MMGD solar.',
      },
    ],
  },
  {
    id: 'dec-offshore',
    topic: '02. Tratamento das Eólicas Offshore (IBAMA) até 2035',
    question: 'Como incorporar os projetos offshore em licenciamento no IBAMA?',
    options: [
      {
        value: 'stress_post_2031',
        label: 'Apenas no Cenário Alto pós-2031 com probabilidade reduzida — Recomendado',
        rationale:
          'Respeita o lead time real de leilão de prismas (PUG-Offshore), licenciamento EIA/RIMA e obras marítimas/portuárias no CE e RN.',
      },
      {
        value: 'onshore_only',
        label: 'Restringir escopo base apenas a Eólicas Onshore (SIGA/ANEEL)',
        rationale:
          'Mais conservador e simples para o escopo mínimo da disciplina, citando offshore apenas como análise de sensibilidade.',
      },
    ],
  },
  {
    id: 'dec-era5',
    topic: '03. Variáveis Meteorológicas Externas (ERA5 / INMET)',
    question: 'Incluir reanálise de vento/temperatura no Feature Engineering?',
    options: [
      {
        value: 'era5_centroids',
        label: 'Extrair 4 centróides ERA5 (BA, RN, CE, PI) p/ vento 100m e temp 2m — Recomendado',
        rationale:
          'Leve para baixar via CDS API (apenas 4 pontos de grade horários) e melhora substancialmente a explicação física de CF(t) e carga.',
      },
      {
        value: 'lags_only',
        label: 'Usar inicialmente apenas lags horários ONS + calendário (MVP rápido)',
        rationale:
          'Garante entrega rápida do pipeline de ponta a ponta na primeira sprint antes de plugar dados climáticos.',
      },
    ],
  },
  {
    id: 'dec-dc-h2v',
    topic: '04. Fronteira entre Data Centers e Hidrogênio Verde (Pecém/Suape)',
    question: 'Como filtrar as Portarias do MME e a fila de acesso do ONS?',
    options: [
      {
        value: 'dc_isolated_h2v_sensitivity',
        label: 'Isolar Data Centers no modelo principal e testar H2V como disputa de rede — Recomendado',
        rationale:
          'Mantém foco estrito na pergunta de pesquisa do Grupo 6, mas reconhece que plantas de H2V competem pela mesma margem de subestações.',
      },
      {
        value: 'dc_strict_only',
        label: 'Considerar exclusivamente projetos declarados de Data Centers / TI',
        rationale: 'Recorte direto sem sensibilidade cruzada com outras cargas eletrointensivas.',
      },
    ],
  },
];

interface DecisionsAndPdfViewProps {
  selectedDecisions: Record<string, string>;
  onSelectDecision: (decisionId: string, optionValue: string) => void;
}

export const DecisionsAndPdfView: React.FC<DecisionsAndPdfViewProps> = ({
  selectedDecisions,
  onSelectDecision,
}) => {
  const pdfPath = '/assets/aistudio/Plano_Orientador_Projeto_Data_Centers_Eolica_NE_5d71e355.pdf';

  return (
    <div className="space-y-8">
      {/* Pauta de Tomada de Decisão do Grupo 6 */}
      <section aria-labelledby="heading-decisoes" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="pb-6 border-b border-slate-200">
          <div className="max-w-3xl space-y-2">
            <p className="text-xs font-medium text-sky-800">
              Alinhamento de Escopo · Governança Técnica antes da Codificação
            </p>
            <h1 id="heading-decisoes" className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
              Matriz de Tomadas de Decisão do Grupo 6
            </h1>
            <p className="text-sm lg:text-base text-slate-600 leading-relaxed">
              Selecione abaixo as diretrizes preferidas pela equipe. Essas escolhas parametrizam diretamente os filtros
              dos scripts <span className="font-mono text-xs">01_ingest</span> e{' '}
              <span className="font-mono text-xs">02_scenarios</span>.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {GROUP_DECISIONS.map((item) => {
            const currentVal = selectedDecisions[item.id] ?? item.options[0].value;
            return (
              <div key={item.id} className="py-6 space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{item.topic}</h2>
                  <p className="text-xs text-slate-600">{item.question}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  {item.options.map((opt) => {
                    const checked = currentVal === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                          checked
                            ? 'border-sky-700 bg-sky-50/50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name={item.id}
                          value={opt.value}
                          checked={checked}
                          onChange={() => onSelectDecision(item.id, opt.value)}
                          className="mt-1 text-sky-700 focus:ring-sky-600"
                        />
                        <span className="space-y-1">
                          <span className="block text-sm font-medium text-slate-900">{opt.label}</span>
                          <span className="block text-xs text-slate-600 leading-relaxed">{opt.rationale}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Documento Anexo Original: Plano Orientador do Projeto */}
      <section aria-labelledby="heading-pdf" className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 id="heading-pdf" className="text-lg font-bold text-slate-900">
              Documento de Referência: Plano Orientador do Projeto (Grupo 6)
            </h2>
            <p className="text-xs text-slate-500">
              PTC3567 · Ciência dos Dados em Automação e Engenharia · Impacto da expansão de data centers no balanço
              elétrico do Nordeste
            </p>
          </div>
          <a
            href={pdfPath}
            download="Plano_Orientador_Projeto_Data_Centers_Eolica_NE.pdf"
            className="px-4 py-2 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Baixar PDF Original
          </a>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-100">
          <object
            data={pdfPath}
            type="application/pdf"
            aria-label="Visualizador do Plano Orientador do Projeto em PDF"
            className="w-full h-[560px]"
          >
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-slate-700">
                O visualizador embutido de PDF não está disponível neste navegador.
              </p>
              <a
                href={pdfPath}
                download="Plano_Orientador_Projeto_Data_Centers_Eolica_NE.pdf"
                className="inline-block px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg"
              >
                Baixar PDF do Plano Orientador
              </a>
            </div>
          </object>
        </div>
      </section>
    </div>
  );
};
