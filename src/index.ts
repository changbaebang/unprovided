export { analyze } from './analyze.js';
export { loadConfig, validateConfig } from './config.js';
export { type EnvironmentReport, formatEnvironment, inspectEnvironment } from './env.js';
export { ConfigError } from './errors.js';
export { type FormatOptions, formatHuman } from './format.js';
export type {
  AnalysisResult,
  AnalysisSummary,
  AnalyzeOptions,
  ConsumerInfo,
  ConsumerKind,
  ContextInfo,
  DefaultedLevel,
  DefaultValueKind,
  EntryKind,
  ExternalConsumerRef,
  ExternalContextConfig,
  Finding,
  Location,
  ModuleExportRef,
  PageInfo,
  Severity,
  UnprovidedConfig,
} from './types.js';
