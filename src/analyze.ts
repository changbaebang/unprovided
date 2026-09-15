import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type ts from 'typescript';
import pkg from '../package.json';
import { loadConfig, validateConfig } from './config.js';
import { discoverEntries } from './entries.js';
import { ConfigError } from './errors.js';
import { type ContextFact, type UsageFact, extractFacts } from './facts.js';
import { toPosix } from './glob.js';
import { createProjectProgram } from './program.js';
import { Reachability } from './reach.js';
import type {
  AnalysisResult,
  AnalyzeOptions,
  ConsumerInfo,
  ContextInfo,
  Finding,
  Location,
  PageInfo,
  UnprovidedConfig,
} from './types.js';

function realpathOr(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

/** Runs the whole analysis. Throws ConfigError for usage/config problems. */
export async function analyze(options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const start = performance.now();
  const root = realpathOr(path.resolve(options.root ?? process.cwd()));
  let isDir = false;
  try {
    isDir = fs.statSync(root).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new ConfigError(`root is not a directory: ${root}`);

  let config: UnprovidedConfig;
  if (options.config === false) config = {};
  else if (typeof options.config === 'object') config = validateConfig(options.config);
  else config = (await loadConfig(root, options.config)).config;

  const diagnostics: string[] = [];
  const entries = discoverEntries(root, {
    entries: [...(config.entries ?? []), ...(options.entries ?? [])],
    always: [...(config.always ?? []), ...(options.always ?? [])],
    onEmptyGlob: (kind, pattern) => diagnostics.push(`--${kind} glob matched no file: ${pattern}`),
  });
  if (entries.length === 0) {
    const msg =
      'no entries found: expected app/**/page.*, src/app/**/page.*, pages/** or src/pages/** under root, or --entry globs';
    if (!options.allowEmpty) throw new ConfigError(`${msg} (pass --allow-empty to exit 0)`);
    diagnostics.push(msg);
  }

  const rootNames = [...new Set(entries.flatMap((e) => [e.file, ...e.chain]))];
  const tsconfig = options.tsconfig ?? config.tsconfig;
  const boundary = options.boundary ?? config.boundary;
  const defaulted = options.defaultedContexts ?? config.defaultedContexts ?? 'info';
  const project = createProjectProgram({ root, rootNames, tsconfig, boundary });
  if (!project.tsconfigPath)
    diagnostics.push('no tsconfig.json found; using default compiler options');

  const rel = (file: string): string => toPosix(path.relative(root, file));
  const loc = (node: ts.Node, sf: ts.SourceFile): Location => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { file: rel(sf.fileName), line: line + 1, col: character + 1 };
  };

  const facts = extractFacts(project, config.externalContexts ?? []);
  const ignore = new Set(config.ignore ?? []);
  const reach = new Reachability(project);

  const contextInfo = (c: ContextFact): ContextInfo => ({
    name: c.name,
    location: c.decl ? loc(c.decl.name, c.decl.getSourceFile()) : null,
    defaultValue: c.defaultValue,
    external: c.external,
  });
  const consumerInfo = (u: UsageFact): ConsumerInfo => ({
    name: u.fnName,
    location: loc(u.node, u.sf),
    kind: u.kind,
  });

  const consumersByCtx = new Map<string, UsageFact[]>();
  for (const c of facts.consumers) {
    if (c.ignored) continue;
    const list = consumersByCtx.get(c.contextKey) ?? [];
    list.push(c);
    consumersByCtx.set(c.contextKey, list);
  }
  const providersByCtx = new Map<string, UsageFact[]>();
  for (const p of facts.providers) {
    const list = providersByCtx.get(p.contextKey) ?? [];
    list.push(p);
    providersByCtx.set(p.contextKey, list);
  }

  const pages: PageInfo[] = [];
  const findings: Finding[] = [];
  for (const entry of entries) {
    pages.push({ file: rel(entry.file), kind: entry.kind, chain: entry.chain.map(rel) });
    const closure = reach.closureOf([entry.file, ...entry.chain]);
    for (const [key, consumers] of consumersByCtx) {
      const ctx = facts.contexts.get(key);
      if (!ctx || ignore.has(ctx.name)) continue;
      const reachable = consumers.filter((c) => reach.isReachable(c.node, closure));
      if (reachable.length === 0) continue;
      const provided = (providersByCtx.get(key) ?? []).some((p) =>
        reach.isReachable(p.node, closure),
      );
      if (provided) continue;

      const infos = reachable
        .map(consumerInfo)
        .sort(
          (a, b) =>
            a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line,
        );
      const first = infos[0] as ConsumerInfo;
      const silent = infos.some((c) => c.kind === 'silent');
      const providerNames = ctx.external
        ? (config.externalContexts ?? [])
            .find((e) => e.name === ctx.name)
            ?.providers.map((p) => p.export)
            .join('/')
        : `${ctx.name}.Provider`;
      const head = `${first.name}() reads ${ctx.name} but no <${providerNames}> is mounted for this page`;
      // A context created with a meaningful (non-nullish) default is often consumed on purpose
      // without a Provider, so those are reported at the configured `defaultedContexts` level.
      if (ctx.defaultValue === 'other') {
        if (defaulted === 'ignore') continue;
        findings.push({
          severity: defaulted,
          page: rel(entry.file),
          context: contextInfo(ctx),
          consumer: first,
          consumers: infos,
          suggestedMountPoint: rel(entry.suggestedMountPoint),
          message: `${head}; it gets the non-nullish createContext default (reported as ${defaulted} via defaultedContexts)`,
        });
        continue;
      }
      findings.push({
        severity: silent ? 'error' : 'warning',
        page: rel(entry.file),
        context: contextInfo(ctx),
        consumer: first,
        consumers: infos,
        suggestedMountPoint: rel(entry.suggestedMountPoint),
        message: silent
          ? `${head}; it silently gets the createContext default`
          : `${head}; it throws at render time`,
      });
    }
  }
  findings.sort(
    (a, b) => a.page.localeCompare(b.page) || a.context.name.localeCompare(b.context.name),
  );

  const contexts = [...facts.contexts.values()].map(contextInfo);
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  return {
    version: pkg.version,
    root,
    boundary: project.boundary,
    tsconfig: project.tsconfigPath,
    pages,
    contexts,
    findings,
    diagnostics,
    summary: {
      pages: pages.length,
      files: project.projectFiles().length,
      contexts: contexts.length,
      findings: findings.length,
      errors,
      warnings,
      infos: findings.length - errors - warnings,
      durationMs: Math.round(performance.now() - start),
    },
  };
}
