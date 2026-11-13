import { PIPELINE_SSOT } from './generated/pipelineSsot';

export type {
  DataCenterProject,
  ScenarioRampPoint,
  SubstationLoadSummary,
} from './pipelineTypes';

export const DATA_CENTER_PIPELINE = PIPELINE_SSOT.dataCentersPipeline;
export const SUBSTATION_LOAD_CONCENTRATION = PIPELINE_SSOT.substationLoadConcentration;
export const SCENARIO_ANNUAL_RAMP = PIPELINE_SSOT.scenarioAnnualRamp;
