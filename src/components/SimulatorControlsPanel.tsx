import React from 'react';
import {
  buildDefaultSimulationConfig,
  type DataCenterScenarioId,
  type ObservationWindowId,
  type SeasonalRegimeId,
  type SimulationConfig,
  type WindExpansionScenarioId,
} from '../utils/energyModel';
import type { PipelineConfigSnapshot, PipelineUiCatalog } from '../data/pipelineTypes';

interface SimulatorControlsPanelProps {
  config: SimulationConfig;
  cfg: PipelineConfigSnapshot;
  ui: PipelineUiCatalog;
  effectiveDcLoadMW: number;
  installedWindGW: number;
  offshoreWindGW: number;
  potentialOffshoreGW: number;
  avgWindCfPct: number | null;
  hourlyBaselineAvailable: boolean;
  exportFeedback: string | null;
  onChangeConfig: (next: SimulationConfig) => void;
  onExportAnnualCsv: () => void;
}

export const SimulatorControlsPanel: React.FC<SimulatorControlsPanelProps> = ({
  config,
  cfg,
  ui,
  effectiveDcLoadMW,
  installedWindGW,
  offshoreWindGW,
  potentialOffshoreGW,
  avgWindCfPct,
  hourlyBaselineAvailable,
  exportFeedback,
  onChangeConfig,
  onExportAnnualCsv,
}) => {
  const bounds = cfg.simulatorSliderBounds;
  const refs = cfg.referenceScenarioKeys;
  const activeWindowMeta = ui.observationWindows.find((w) => w.id === config.observationWindow);

  return (
    <>
      {/* Painel de Controles de Cenário */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 py-6 border-b border-slate-200">
        <div className="space-y-2">
          <label htmlFor="select-dc-scenario" className="block text-xs font-medium text-slate-700">
            Cenário de Expansão de Data Centers
          </label>
          <select
            id="select-dc-scenario"
            value={config.dcScenario}
            onChange={(e) => onChangeConfig({ ...config, dcScenario: e.target.value as DataCenterScenarioId })}
            className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
          >
            <option value={refs.dcControl}>Sem Data Centers (Baseline Controle)</option>
            <option value={refs.dcConservative}>
              Conservador (~{(cfg.dcScenariosItMW.conservative / 1000).toFixed(2)} GW TI · Confirmados)
            </option>
            <option value={refs.dcCentral}>
              Central (~{(cfg.dcScenariosItMW.central / 1000).toFixed(2)} GW TI · Ponderado)
            </option>
            <option value={refs.dcHigh}>
              Alto / Stress Test (~{(cfg.dcScenariosItMW.high / 1000).toFixed(2)} GW TI · Pipeline)
            </option>
          </select>
          <p className="text-xs text-slate-500 tabular-nums">
            Carga DC efetiva em {config.targetYear}:{' '}
            <strong className="text-slate-800">
              {effectiveDcLoadMW.toLocaleString('pt-BR', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}{' '}
              MW
            </strong>
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="select-wind-scenario" className="block text-xs font-medium text-slate-700">
            Trajetória de Expansão Eólica (SIGA)
          </label>
          <select
            id="select-wind-scenario"
            value={config.windScenario}
            onChange={(e) => onChangeConfig({ ...config, windScenario: e.target.value as WindExpansionScenarioId })}
            className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
          >
            <option value={refs.windBase}>
              Base (Apenas Operação ~{(cfg.baseWindOnshore2026MW / 1000).toFixed(1)} GW)
            </option>
            <option value={refs.windIntermediate}>
              Intermediário (+{(cfg.windExpansionOnshoreMW.intermediate / 1000).toFixed(1)} GW Construção SIGA)
            </option>
            <option value={refs.windHigh}>
              Alto (+{(cfg.windExpansionOnshoreMW.high / 1000).toFixed(1)} GW Construção e Outorgados)
            </option>
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-700 pt-0.5 cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeOffshorePost2031}
              onChange={(e) => onChangeConfig({ ...config, includeOffshorePost2031: e.target.checked })}
              className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
            />
            <span>
              Somar Eólica Offshore pós-{cfg.offshoreStartYear} (
              {config.includeOffshorePost2031
                ? `${offshoreWindGW.toFixed(1)} GW ativos`
                : config.targetYear < cfg.offshoreCommercialStartYear
                  ? `inicia em ${cfg.offshoreCommercialStartYear}`
                  : `+${potentialOffshoreGW.toFixed(1)} GW em ${config.targetYear}`}
              )
            </span>
          </label>
        </div>

        <div className="space-y-2">
          <label htmlFor="select-regime" className="block text-xs font-medium text-slate-700">
            Ênfase Sazonal na Base Real ONS ({cfg.hoursPerYear.toLocaleString('pt-BR')} h)
          </label>
          <select
            id="select-regime"
            value={config.seasonalRegime}
            onChange={(e) => onChangeConfig({ ...config, seasonalRegime: e.target.value as SeasonalRegimeId })}
            className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
          >
            {ui.seasonalRegimes.map((reg) => (
              <option key={reg.id} value={reg.id}>
                {reg.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 tabular-nums">
            Eólica total: <strong className="text-slate-800">{installedWindGW} GW</strong> · CF médio:{' '}
            <strong className="text-slate-800">{avgWindCfPct !== null ? `${avgWindCfPct}%` : '—'}</strong>
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1">
              <label htmlFor="range-target-year">
                Ano Alvo ({bounds.year.min}–{bounds.year.max})
              </label>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">{config.targetYear}</span>
            </div>
            <input
              id="range-target-year"
              type="range"
              min={bounds.year.min}
              max={bounds.year.max}
              step={bounds.year.step}
              value={config.targetYear}
              onChange={(e) => onChangeConfig({ ...config, targetYear: Number(e.target.value) })}
              className="w-full accent-sky-700 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1">
              <label htmlFor="range-import-limit">Limite Importação SIN</label>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {config.interchangeImportLimitMW.toLocaleString('pt-BR')} MW
              </span>
            </div>
            <input
              id="range-import-limit"
              type="range"
              min={bounds.interchangeImportLimitMW.min}
              max={bounds.interchangeImportLimitMW.max}
              step={bounds.interchangeImportLimitMW.step}
              value={config.interchangeImportLimitMW}
              onChange={(e) => onChangeConfig({ ...config, interchangeImportLimitMW: Number(e.target.value) })}
              className="w-full accent-sky-700 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Barra de Escala de Observação Multi-Escala (Dia | Semana | Mês | Trimestre | Ano) */}
      <div className="py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Escala de Observação (Granularidade Horária):</span>
            <div
              role="tablist"
              aria-label="Escala temporal da estimativa anual"
              className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
            >
              {ui.observationWindows.map((win) => {
                const active = config.observationWindow === win.id;
                return (
                  <button
                    key={win.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onChangeConfig({ ...config, observationWindow: win.id as ObservationWindowId })}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {win.label}
                  </button>
                );
              })}
            </div>
          </div>
          {activeWindowMeta && <p className="text-xs text-slate-500">{activeWindowMeta.description}</p>}
        </div>

        {/* Sub-seletor contextual da janela */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {config.observationWindow === 'day' && (
            <div className="flex items-center gap-2">
              <label htmlFor="range-select-day" className="font-medium text-slate-700 whitespace-nowrap">
                Dia do ano (1–{cfg.daysPerYear}):
              </label>
              <input
                id="range-select-day"
                type="range"
                min={1}
                max={cfg.daysPerYear}
                step={1}
                value={config.selectedDay}
                onChange={(e) => onChangeConfig({ ...config, selectedDay: Number(e.target.value) })}
                className="w-32 accent-sky-700 cursor-pointer"
              />
              <span className="font-mono font-semibold text-slate-900 tabular-nums">Dia {config.selectedDay}</span>
            </div>
          )}

          {config.observationWindow === 'week' && (
            <div className="flex items-center gap-2">
              <label htmlFor="range-select-week" className="font-medium text-slate-700 whitespace-nowrap">
                Semana do ano (1–{cfg.weeksPerYear}):
              </label>
              <input
                id="range-select-week"
                type="range"
                min={1}
                max={cfg.weeksPerYear}
                step={1}
                value={config.selectedWeek}
                onChange={(e) => onChangeConfig({ ...config, selectedWeek: Number(e.target.value) })}
                className="w-32 accent-sky-700 cursor-pointer"
              />
              <span className="font-mono font-semibold text-slate-900 tabular-nums">Sem {config.selectedWeek}</span>
            </div>
          )}

          {config.observationWindow === 'month' && (
            <div className="flex items-center gap-2">
              <label htmlFor="select-month-window" className="font-medium text-slate-700">
                Mês do ano:
              </label>
              <select
                id="select-month-window"
                value={config.selectedMonth}
                onChange={(e) => onChangeConfig({ ...config, selectedMonth: Number(e.target.value) })}
                className="h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
              >
                {ui.monthShortNames.map((mName, idx) => (
                  <option key={mName} value={idx + 1}>
                    {String(idx + 1).padStart(2, '0')} · {mName}/{config.targetYear}
                  </option>
                ))}
              </select>
            </div>
          )}

          {config.observationWindow === 'quarter' && (
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onChangeConfig({ ...config, selectedQuarter: q })}
                  className={`px-2.5 py-1 text-xs font-mono font-semibold rounded border cursor-pointer whitespace-nowrap shrink-0 ${
                    config.selectedQuarter === q
                      ? 'bg-sky-700 text-white border-sky-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Q{q}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={!hourlyBaselineAvailable}
            onClick={onExportAnnualCsv}
            className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {exportFeedback ?? `Exportar ${cfg.hoursPerYear.toLocaleString('pt-BR')}h (.csv)`}
          </button>
        </div>
      </div>

      {/* Barra secundária de parâmetros de Data Center */}
      <div className="py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-6 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <label htmlFor="range-pue" className="font-medium text-slate-700">
              PUE médio:
            </label>
            <input
              id="range-pue"
              type="range"
              min={bounds.pue.min}
              max={bounds.pue.max}
              step={bounds.pue.step}
              disabled={config.isPublishedPowerTotalGrid}
              value={config.pue}
              onChange={(e) => onChangeConfig({ ...config, pue: Number(e.target.value) })}
              className="w-24 accent-sky-700 cursor-pointer disabled:opacity-40"
            />
            <span className="font-mono font-semibold text-slate-900 tabular-nums">{config.pue.toFixed(2)}</span>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="range-util" className="font-medium text-slate-700">
              Utilização TI:
            </label>
            <input
              id="range-util"
              type="range"
              min={bounds.dcUtilization.min}
              max={bounds.dcUtilization.max}
              step={bounds.dcUtilization.step}
              value={config.dcUtilization}
              onChange={(e) => onChangeConfig({ ...config, dcUtilization: Number(e.target.value) })}
              className="w-24 accent-sky-700 cursor-pointer"
            />
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {Math.round(config.dcUtilization * 100)}%
            </span>
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-slate-700">
            <input
              type="checkbox"
              checked={config.isPublishedPowerTotalGrid}
              onChange={(e) => onChangeConfig({ ...config, isPublishedPowerTotalGrid: e.target.checked })}
              className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
            />
            <span>Potência publicada já é carga total na rede (omissão de PUE · Seção 5)</span>
          </label>
        </div>

        <button
          type="button"
          onClick={() => onChangeConfig(buildDefaultSimulationConfig(cfg))}
          className="text-xs font-medium text-slate-600 hover:text-slate-900 underline whitespace-nowrap shrink-0 cursor-pointer"
        >
          Restaurar parâmetros padrão
        </button>
      </div>
    </>
  );
};
