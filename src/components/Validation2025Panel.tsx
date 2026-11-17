import React from 'react';
import { usePipelineSsot } from '../data/pipelineSsotContext';
import type {
  HourlyValidation2025Point,
  ModelABenchmarkRow,
  ModelBBenchmarkRow,
  ModelCBenchmarkRow,
} from '../data/pipelineTypes';
import type { FeaturesAnovaKpis } from './featuresAnovaKpis';
import { Validation2025HourlyChart } from './Validation2025HourlyChart';
import { Validation2025BenchmarkTables } from './Validation2025BenchmarkTables';

interface Validation2025PanelProps {
  trainHours: number;
  testHours: number;
  hourly2025: HourlyValidation2025Point[];
  modelABenchmark: ModelABenchmarkRow[];
  modelBBenchmark: ModelBBenchmarkRow[];
  modelCBenchmark: ModelCBenchmarkRow[];
  kpis: FeaturesAnovaKpis;
  downloadFeedback: string | null;
  onExportBenchmarks: () => void;
}

export const Validation2025Panel: React.FC<Validation2025PanelProps> = ({
  trainHours,
  testHours,
  hourly2025,
  modelABenchmark,
  modelBBenchmark,
  modelCBenchmark,
  kpis,
  downloadFeedback,
  onExportBenchmarks,
}) => {
  const { ssot } = usePipelineSsot();
  const cfg = ssot.config;

  return (
    <div className="space-y-6">
      <Validation2025HourlyChart
        cfg={cfg}
        testHours={testHours}
        hourly2025={hourly2025}
        kpis={kpis}
        downloadFeedback={downloadFeedback}
        onExportBenchmarks={onExportBenchmarks}
      />

      <Validation2025BenchmarkTables
        cfg={cfg}
        trainHours={trainHours}
        testHours={testHours}
        modelABenchmark={modelABenchmark}
        modelBBenchmark={modelBBenchmark}
        modelCBenchmark={modelCBenchmark}
        kpis={kpis}
      />
    </div>
  );
};
