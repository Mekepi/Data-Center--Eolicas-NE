import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { PIPELINE_SSOT } from './generated/pipelineSsot';
import type { HourlyBaseline8760Bundle, PipelineSsotBundle } from './pipelineTypes';

export type HourlyBaselineStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

interface PipelineSsotContextValue {
  ssot: PipelineSsotBundle;
  hourlyBaseline: HourlyBaseline8760Bundle | null;
  hourlyBaselineStatus: HourlyBaselineStatus;
  isSyncingRuntime: boolean;
  runtimeSource: 'ts-snapshot' | 'runtime-json';
  refreshSsot: () => Promise<void>;
}

const PipelineSsotContext = createContext<PipelineSsotContextValue>({
  ssot: PIPELINE_SSOT,
  hourlyBaseline: null,
  hourlyBaselineStatus: 'idle',
  isSyncingRuntime: false,
  runtimeSource: 'ts-snapshot',
  refreshSsot: async () => {},
});

function isValidSsotBundle(candidate: unknown): candidate is PipelineSsotBundle {
  if (!candidate || typeof candidate !== 'object') return false;
  const obj = candidate as Partial<PipelineSsotBundle>;
  return (
    typeof obj.schemaVersion === 'string' &&
    Boolean(obj.config) &&
    Boolean(obj.lineage) &&
    Array.isArray(obj.dataCentersPipeline) &&
    Array.isArray(obj.monteCarlo12Scenarios2035) &&
    Array.isArray(obj.simulatorMonteCarloGrid) &&
    Array.isArray(obj.scriptsPipeline)
  );
}

export function isValidHourlyBaseline8760Bundle(
  candidate: unknown,
  expectedDigest?: string,
  expectedHoursCount?: number
): candidate is HourlyBaseline8760Bundle {
  if (!candidate || typeof candidate !== 'object') return false;
  const obj = candidate as Partial<HourlyBaseline8760Bundle>;
  const targetHours = expectedHoursCount && expectedHoursCount > 0 ? expectedHoursCount : 8760;
  if (obj.hoursCount !== targetHours) return false;
  if (!Array.isArray(obj.month) || obj.month.length !== targetHours) return false;
  if (!Array.isArray(obj.day) || obj.day.length !== targetHours) return false;
  if (!Array.isArray(obj.hour) || obj.hour.length !== targetHours) return false;
  if (expectedDigest && obj.digest !== expectedDigest) return false;
  if (!obj.regimes || typeof obj.regimes !== 'object') return false;

  const regimeKeys: Array<'annual_blend' | 'dry_windy' | 'wet_calm'> = [
    'annual_blend',
    'dry_windy',
    'wet_calm',
  ];
  for (const reg of regimeKeys) {
    const data = obj.regimes[reg];
    if (
      !data ||
      !Array.isArray(data.lBaseMW) ||
      data.lBaseMW.length !== targetHours ||
      !Array.isArray(data.cfWind) ||
      data.cfWind.length !== targetHours ||
      !Array.isArray(data.gSolarMW) ||
      data.gSolarMW.length !== targetHours
    ) {
      return false;
    }
  }
  return true;
}

export const PipelineSsotProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ssot, setSsot] = useState<PipelineSsotBundle>(PIPELINE_SSOT);
  const [hourlyBaseline, setHourlyBaseline] = useState<HourlyBaseline8760Bundle | null>(null);
  const [hourlyBaselineStatus, setHourlyBaselineStatus] = useState<HourlyBaselineStatus>(
    PIPELINE_SSOT.lineage.hourlyBaselineAvailable ? 'loading' : 'unavailable'
  );
  const [isSyncingRuntime, setIsSyncingRuntime] = useState<boolean>(false);
  const [runtimeSource, setRuntimeSource] = useState<'ts-snapshot' | 'runtime-json'>('ts-snapshot');

  const refreshSsot = useCallback(async () => {
    setIsSyncingRuntime(true);
    let activeBundle: PipelineSsotBundle = PIPELINE_SSOT;
    try {
      const response = await fetch('/data/pipeline-ssot.json', { cache: 'no-store' });
      if (response.ok) {
        const json: unknown = await response.json();
        if (isValidSsotBundle(json)) {
          activeBundle = json;
          if (json.bundleDigest !== PIPELINE_SSOT.bundleDigest) {
            setSsot(json);
          }
          setRuntimeSource('runtime-json');
        }
      }
    } catch {
      // Mantém o snapshot TypeScript gerado pelo mesmo script Python
    }

    try {
      if (!activeBundle.lineage.hourlyBaselineAvailable) {
        setHourlyBaseline(null);
        setHourlyBaselineStatus('unavailable');
        return;
      }

      setHourlyBaselineStatus('loading');
      const baselineUrl =
        activeBundle.lineage.hourlyBaselineUrl || activeBundle.config.hourlyBaselineJsonUrl;
      const baseResp = await fetch(baselineUrl, { cache: 'no-store' });
      if (!baseResp.ok) {
        setHourlyBaseline(null);
        setHourlyBaselineStatus('unavailable');
        return;
      }
      const baseJson: unknown = await baseResp.json();
      if (
        isValidHourlyBaseline8760Bundle(
          baseJson,
          activeBundle.lineage.hourlyBaselineDigest,
          activeBundle.lineage.hourlyBaselineHoursCount
        )
      ) {
        setHourlyBaseline(baseJson);
        setHourlyBaselineStatus('ready');
      } else {
        setHourlyBaseline(null);
        setHourlyBaselineStatus('unavailable');
      }
    } catch {
      setHourlyBaseline(null);
      setHourlyBaselineStatus('unavailable');
    } finally {
      setIsSyncingRuntime(false);
    }
  }, []);

  useEffect(() => {
    void refreshSsot();
  }, [refreshSsot]);

  return (
    <PipelineSsotContext.Provider
      value={{
        ssot,
        hourlyBaseline,
        hourlyBaselineStatus,
        isSyncingRuntime,
        runtimeSource,
        refreshSsot,
      }}
    >
      {children}
    </PipelineSsotContext.Provider>
  );
};

export function usePipelineSsot(): PipelineSsotContextValue {
  return useContext(PipelineSsotContext);
}
