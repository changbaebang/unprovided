export type Severity = 'error' | 'warning' | 'info';
/** How consumers of a context created with a meaningful (non-nullish) default are reported. */
export type DefaultedLevel = 'info' | 'warning' | 'error' | 'ignore';
export type ConsumerKind = 'silent' | 'throws';
export type EntryKind = 'app' | 'pages' | 'custom';
export type DefaultValueKind = 'undefined' | 'null' | 'other' | 'unknown';

/** A source position. `file` is relative to the analysis root and uses `/` separators. */
export interface Location {
  file: string;
  line: number;
  col: number;
}

export interface PageInfo {
  file: string;
  kind: EntryKind;
  /** Always-mounted files for this page (layouts/templates/_app/--always), root first. */
  chain: string[];
}

export interface ContextInfo {
  name: string;
  /** `null` for config-driven external contexts. */
  location: Location | null;
  defaultValue: DefaultValueKind;
  external: boolean;
}

export interface ConsumerInfo {
  /** Name of the enclosing function/component/hook, or `<module>`. */
  name: string;
  location: Location;
  kind: ConsumerKind;
}

export interface Finding {
  severity: Severity;
  page: string;
  context: ContextInfo;
  /** The first reachable consumer (by file/line). */
  consumer: ConsumerInfo;
  /** Every reachable consumer for this (page, context) pair, including `consumer`. */
  consumers: ConsumerInfo[];
  /** Nearest layout/_app file (may not exist yet) where a Provider could be mounted. */
  suggestedMountPoint: string;
  message: string;
}

export interface AnalysisSummary {
  pages: number;
  /** Project source files loaded into the Program (reachable from entries and chains). */
  files: number;
  contexts: number;
  findings: number;
  errors: number;
  warnings: number;
  /** Findings with severity `info` (never fail the CLI). */
  infos: number;
  durationMs: number;
}

export interface AnalysisResult {
  version: string;
  root: string;
  /** Directory that bounds module resolution (workspace root); files outside it are external. */
  boundary: string;
  tsconfig: string | null;
  pages: PageInfo[];
  contexts: ContextInfo[];
  findings: Finding[];
  /** Non-fatal diagnostics from the tool itself (not findings). */
  diagnostics: string[];
  summary: AnalysisSummary;
}

export interface ModuleExportRef {
  module: string;
  export: string;
}

export interface ExternalConsumerRef extends ModuleExportRef {
  /**
   * `true` (default) when the consumer throws without its provider (severity `warning`);
   * `false` when it silently misbehaves (severity `error`).
   */
  throws?: boolean;
}

export interface ExternalContextConfig {
  name: string;
  providers: ModuleExportRef[];
  consumers: ExternalConsumerRef[];
}

export interface UnprovidedConfig {
  entries?: string[];
  always?: string[];
  tsconfig?: string;
  /** Resolution boundary (relative to root). Default: nearest workspace root above root. */
  boundary?: string;
  externalContexts?: ExternalContextConfig[];
  ignore?: string[];
  /** Severity for contexts with a non-nullish `createContext` default. Default: `info`. */
  defaultedContexts?: DefaultedLevel;
}

export interface AnalyzeOptions {
  /** Project root. Defaults to `process.cwd()`. */
  root?: string;
  /** Extra entry globs (relative to root). */
  entries?: string[];
  /** Globs (relative to root) of files considered always mounted for every entry. */
  always?: string[];
  /** Path to tsconfig.json. Defaults to the nearest tsconfig.json from root upwards. */
  tsconfig?: string;
  /**
   * Config: a path to `unprovided.config.{json,mjs}`, an inline config object,
   * `false` to skip config discovery, or undefined to auto-discover in root.
   */
  config?: string | false | UnprovidedConfig;
  /**
   * Directory (relative to root) that bounds module resolution. Defaults to the nearest
   * workspace root above root (pnpm-workspace.yaml, package.json "workspaces", lerna.json, .git),
   * so symlinked workspace packages are followed when root is an app inside a monorepo.
   */
  boundary?: string;
  /** Severity for contexts with a non-nullish default. Overrides the config. Default: `info`. */
  defaultedContexts?: DefaultedLevel;
  /** Resolve instead of rejecting with ConfigError when no entries are found. */
  allowEmpty?: boolean;
}
