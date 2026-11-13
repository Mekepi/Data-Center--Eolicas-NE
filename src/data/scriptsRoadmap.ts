import { PIPELINE_SSOT } from './generated/pipelineSsot';

export type { ScriptSpec } from './pipelineTypes';

export const APPROVED_LIBRARIES_POLICY = {
  standard: ['multiprocessing', 'concurrent.futures', 'urllib.request', 'json', 'csv', 'os', 'pathlib', 'math', 'time'],
  commonApproved: ['numpy', 'scipy', 'pandas', 'urllib3'],
  candidateLibrariesRequiringApproval: [
    {
      name: 'scikit-learn',
      role: 'Substituída no projeto pelo motor próprio em NumPy + SciPy (scripts/ml_models_numpy.py).',
      status: 'Não necessária (implementação aprovada em NumPy/SciPy)',
    },
    {
      name: 'xgboost / lightgbm',
      role: 'Substituída por HistogramGBDTRegressor/Classifier em NumPy puro (scripts/ml_models_numpy.py).',
      status: 'Não necessária (implementação aprovada em NumPy)',
    },
    {
      name: 'statsmodels',
      role: 'Substituída por testes ANOVA em scipy.stats.f_oneway (scripts/03_feature_engineering_anova.py).',
      status: 'Não necessária',
    },
    {
      name: 'pyarrow / fastparquet',
      role: 'Fallback oficial adotado para CSV UTF-8 em data/processed e reports/.',
      status: 'Não necessária (CSV nativo pandas)',
    },
  ],
};

export const SCRIPTS_PIPELINE = PIPELINE_SSOT.scriptsPipeline;
