import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import pkg from '../package.json';
import { loadConfig, validateConfig } from './config.js';
import { detectRouters, discoverEntries, explainNoEntries, findNestedNextApps } from './entries.js';
import { ConfigError } from './errors.js';
import { toPosix } from './glob.js';
import { findWorkspaceRoot, loadCompilerOptions } from './program.js';
import type { AnalyzeOptions, EntryKind, UnprovidedConfig } from './types.js';

/** What `unprovided --env` reports: everything a bug report needs, without running the analysis. */
export interface EnvironmentReport {
  version: string;
  node: string;
  typescript: string;
  platform: string;
  root: string;
  boundary: string;
  /** Config file that was loaded, or `null`. */
  config: string | null;
  /** tsconfig / jsconfig that will be used, or `null`. */
  tsconfig: string | null;
  /** Existing router directories under root, relative (`app`, `src/app`, `pages`, `src/pages`). */
  routers: { app: string[]; pages: string[] };
  /** Nested Next.js apps below root (relative), when root itself has no entries. */
  nestedApps: string[];
  entries: Record<EntryKind, number> & { total: number };
  /** `--always` / config `always` files that exist, relative to root. */
  always: string[];
  /** Same non-fatal notes the analysis would print (glob mismatches, tsconfig problems). */
  diagnostics: string[];
  /** Set when the analysis would exit 2 (no entries); `--allow-empty` turns it into a diagnostic. */
  error: string | null;
}

/** Collects the environment report. Throws ConfigError for the same config problems as `analyze`. */
export async function inspectEnvironment(options: AnalyzeOptions = {}): Promise<EnvironmentReport> {
  const root = realpathOr(path.resolve(options.root ?? process.cwd()));
  let isDir = false;
  try {
    isDir = fs.statSync(root).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new ConfigError(`root is not a directory: ${root}`);

  let config: UnprovidedConfig;
  let configPath: string | null = null;
  if (options.config === false) config = {};
  else if (typeof options.config === 'object') config = validateConfig(options.config);
  else {
    const loaded = await loadConfig(root, options.config);
    config = loaded.config;
    configPath = loaded.path;
  }

  const diagnostics: string[] = [];
  const entryGlobs = [...(config.entries ?? []), ...(options.entries ?? [])];
  const alwaysGlobs = [...(config.always ?? []), ...(options.always ?? [])];
  const entries = discoverEntries(root, {
    entries: entryGlobs,
    always: alwaysGlobs,
    onEmptyGlob: (kind, pattern) => diagnostics.push(`--${kind} glob matched no file: ${pattern}`),
  });
  const counts: Record<EntryKind, number> & { total: number } = {
    app: 0,
    pages: 0,
    custom: 0,
    total: entries.length,
  };
  for (const e of entries) counts[e.kind] += 1;
  const always = new Set<string>();
  for (const e of entries) {
    for (const f of e.chain) {
      const relFile = toPosix(path.relative(root, f));
      // Chain files that are not layouts/templates/_app come from --always.
      if (!/(^|\/)(layout|template|_app)\.[cm]?[jt]sx?$/.test(relFile)) always.add(relFile);
    }
  }

  const boundaryOpt = options.boundary ?? config.boundary;
  const boundary = realpathOr(
    boundaryOpt === undefined ? findWorkspaceRoot(root) : path.resolve(root, boundaryOpt),
  );
  const boundaryWithSep = boundary.endsWith(path.sep) ? boundary : boundary + path.sep;
  if (root !== boundary && !root.startsWith(boundaryWithSep)) {
    throw new ConfigError(`boundary must contain root: boundary=${boundary}, root=${root}`);
  }

  const compiler = loadCompilerOptions(root, options.tsconfig ?? config.tsconfig);
  if (!compiler.tsconfigPath)
    diagnostics.push(
      'no tsconfig.json or jsconfig.json found; using default compiler options (path aliases will not resolve)',
    );
  diagnostics.push(...compiler.diagnostics);

  let error: string | null = null;
  if (entries.length === 0) {
    const msg = explainNoEntries(root, { entries: entryGlobs, always: alwaysGlobs });
    if (options.allowEmpty) diagnostics.push(msg);
    else error = msg;
  }

  return {
    version: pkg.version,
    node: process.version,
    typescript: ts.version,
    platform: `${process.platform}-${process.arch}`,
    root,
    boundary,
    config: configPath,
    tsconfig: compiler.tsconfigPath,
    routers: detectRouters(root),
    nestedApps: entries.length === 0 ? findNestedNextApps(root) : [],
    entries: counts,
    always: [...always].sort(),
    diagnostics,
    error,
  };
}

/** Renders the report as `key: value` lines for humans. No trailing newline. */
export function formatEnvironment(r: EnvironmentReport): string {
  const lines = [
    `unprovided ${r.version}`,
    `node:        ${r.node} (${r.platform})`,
    `typescript:  ${r.typescript} (bundled dependency; your project's TypeScript is not used)`,
    `root:        ${r.root}`,
    `boundary:    ${r.boundary}`,
    `config:      ${r.config ?? '(none)'}`,
    `tsconfig:    ${r.tsconfig ?? '(none — default compiler options)'}`,
    `routers:     app router: ${r.routers.app.length > 0 ? r.routers.app.join(', ') : 'none'}; pages router: ${r.routers.pages.length > 0 ? r.routers.pages.join(', ') : 'none'}`,
    `entries:     ${r.entries.total} (app: ${r.entries.app}, pages: ${r.entries.pages}, custom: ${r.entries.custom})`,
    `always:      ${r.always.length > 0 ? r.always.join(', ') : '(none)'}`,
  ];
  if (r.nestedApps.length > 0) lines.push(`nested apps: ${r.nestedApps.join(', ')}`);
  for (const d of r.diagnostics)
    lines.push(`note:        ${d.split('\n').join('\n             ')}`);
  if (r.error) lines.push(`error:       ${r.error.split('\n').join('\n             ')}`);
  return lines.join('\n');
}

function realpathOr(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}
