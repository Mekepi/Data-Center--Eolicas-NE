import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { PIPELINE_SSOT } from './generated/pipelineSsot';
import type { PipelineSsotBundle } from './pipelineTypes';

interface PipelineSsotContextValue {
  ssot: PipelineSsotBundle;
  isSyncingRuntime: boolean;
  runtimeSource: 'ts-snapshot' | 'runtime-json';
  refreshSsot: () => Promise<void>;
}

const PipelineSsotContext = createContext<PipelineSsotContextValue>({
  ssot: PIPELINE_SSOT,
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
    Array.isArray(obj.scriptsPipeline)
  );
}

export const PipelineSsotProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ssot, setSsot] = useState<PipelineSsotBundle>(PIPELINE_SSOT);
  const [isSyncingRuntime, setIsSyncingRuntime] = useState<boolean>(false);
  const [runtimeSource, setRuntimeSource] = useState<'ts-snapshot' | 'runtime-json'>('ts-snapshot');

  const refreshSsot = useCallback(async () => {
    setIsSyncingRuntime(true);
    try {
      const response = await fetch('/data/pipeline-ssot.json', { cache: 'no-store' });
      if (!response.ok) return;
      const json: unknown = await response.json();
      if (isValidSsotBundle(json)) {
        setSsot(json);
        setRuntimeSource('runtime-json');
      }
    } catch {
      // Mantém o snapshot TypeScript gerado pelo mesmo script Python
    } finally {
      setIsSyncingRuntime(false);
    }
  }, []);

  useEffect(() => {
    void refreshSsot();
  }, [refreshSsot]);

  return (
    <PipelineSsotContext.Provider value={{ ssot, isSyncingRuntime, runtimeSource, refreshSsot }}>
      {children}
    </PipelineSsotContext.Provider>
  );
};

export function usePipelineSsot(): PipelineSsotContextValue {
  return useContext(PipelineSsotContext);
}
