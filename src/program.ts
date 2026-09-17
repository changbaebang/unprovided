import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ConfigError } from './errors.js';

export interface ProjectProgram {
  program: ts.Program;
  checker: ts.TypeChecker;
  /** Real path of the analysis root (trailing separator stripped). */
  root: string;
  /** Real path of the resolution boundary; `root` is inside it. */
  boundary: string;
  /** Path of the tsconfig (or jsconfig) that was used, if any. */
  tsconfigPath: string | null;
  /** Non-fatal problems found while loading the tsconfig (unknown options, missing `extends`…). */
  diagnostics: string[];
  /**
   * Relative / alias-looking import specifiers that resolved to nothing, in first-seen order.
   * Bare package names are not tracked (they are expected to be external).
   */
  unresolvedImports(): UnresolvedImport[];
  /** Resolves a module specifier from `containingFile` to an absolute file inside the project. */
  resolve(specifier: string, containingFile: string): string | undefined;
  /** True for files that belong to the analysed project (not lib, not node_modules). */
  isProjectFile(sf: ts.SourceFile): boolean;
  /** Source files that belong to the project. */
  projectFiles(): ts.SourceFile[];
}

export interface UnresolvedImport {
  specifier: string;
  /** Absolute path of the importing file. */
  from: string;
}

export interface CreateProgramOptions {
  root: string;
  rootNames: readonly string[];
  tsconfig?: string | undefined;
  /** Resolution boundary, relative to root. Default: `findWorkspaceRoot(root)`. */
  boundary?: string | undefined;
}

const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', 'pnpm-workspace.yml', 'lerna.json', '.git'];

function hasWorkspacesField(dir: string): boolean {
  const pkg = path.join(dir, 'package.json');
  if (!fs.existsSync(pkg)) return false;
  try {
    const json = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
    return json.workspaces !== undefined && json.workspaces !== null;
  } catch {
    return false;
  }
}

/**
 * Nearest directory at or above `root` that looks like a workspace root: it has
 * `pnpm-workspace.yaml`, `lerna.json`, a `package.json` with `workspaces`, or `.git`.
 * Falls back to `root` itself.
 */
export function findWorkspaceRoot(root: string): string {
  let dir = root;
  while (true) {
    if (WORKSPACE_MARKERS.some((m) => fs.existsSync(path.join(dir, m))) || hasWorkspacesField(dir))
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return root;
    dir = parent;
  }
}

const realpathCache = new Map<string, string>();
function realpath(p: string): string {
  const cached = realpathCache.get(p);
  if (cached !== undefined) return cached;
  let real: string;
  try {
    real = fs.realpathSync.native(p);
  } catch {
    real = p;
  }
  realpathCache.set(p, real);
  return real;
}

/** TS diagnostic codes that are noise for this tool: "No inputs were found in config file". */
const IGNORED_TSCONFIG_CODES = new Set([18003]);

/**
 * Locates the tsconfig for `root`: the explicit `--tsconfig`, else walking from root upwards the
 * first directory holding a `tsconfig.json` or, failing that, a `jsconfig.json` (JavaScript
 * projects keep `paths` there). A `jsconfig.json` next to root wins over a `tsconfig.json` above.
 */
export function resolveTsconfigPath(root: string, tsconfig: string | undefined): string | null {
  if (tsconfig) {
    const configPath = path.resolve(root, tsconfig);
    if (!fs.existsSync(configPath)) throw new ConfigError(`tsconfig not found: ${configPath}`);
    return configPath;
  }
  let dir = root;
  while (true) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface LoadedCompilerOptions {
  options: ts.CompilerOptions;
  tsconfigPath: string | null;
  /** Human-readable, non-fatal problems with the config file (each prefixed with `tsconfig:`). */
  diagnostics: string[];
}

/**
 * Reads the tsconfig and derives the compiler options used for analysis. An unparseable file is a
 * ConfigError (exit 2). Everything the TypeScript config parser merely complains about — an
 * unknown compiler option written for a newer TypeScript, an invalid value, a missing `extends`
 * target — is reported as a diagnostic and the option is ignored, so the run continues.
 */
export function loadCompilerOptions(
  root: string,
  tsconfig: string | undefined,
): LoadedCompilerOptions {
  const configPath = resolveTsconfigPath(root, tsconfig);
  const diagnostics: string[] = [];

  let base: ts.CompilerOptions = {};
  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) {
      throw new ConfigError(
        `tsconfig: cannot parse ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`,
      );
    }
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    base = parsed.options;
    for (const d of parsed.errors) {
      if (IGNORED_TSCONFIG_CODES.has(d.code)) continue;
      const text = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      diagnostics.push(`tsconfig: ${text} (TS${d.code}, ignored; from ${configPath})`);
    }
    if (
      (parsed.projectReferences?.length ?? 0) > 0 &&
      base.paths === undefined &&
      base.baseUrl === undefined
    ) {
      const refs = (parsed.projectReferences ?? []).map((r) => path.relative(root, r.path) || '.');
      diagnostics.push(
        `tsconfig: ${path.relative(root, configPath) || configPath} only references other configs (${refs.join(', ')}) and defines no paths/baseUrl; referenced configs are not read — pass --tsconfig <the one with your paths> if aliases stay unresolved`,
      );
    }
  }

  const moduleKind = base.module ?? ts.ModuleKind.ESNext;
  const options: ts.CompilerOptions = {
    ...base,
    module: moduleKind,
    moduleResolution:
      base.moduleResolution ??
      (moduleKind === ts.ModuleKind.CommonJS
        ? ts.ModuleResolutionKind.Node10
        : ts.ModuleResolutionKind.Bundler),
    target: base.target ?? ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.Preserve,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    declaration: false,
    declarationMap: false,
    composite: false,
    incremental: false,
    skipLibCheck: true,
    resolveJsonModule: true,
    allowImportingTsExtensions: true,
    isolatedModules: false,
    noResolve: false,
    // Never auto-include @types/* — nothing from node_modules is analysed.
    types: [],
  };
  // Keys that only make sense for emit/project references and can trip createProgram.
  for (const key of [
    'plugins',
    'tsBuildInfoFile',
    'outDir',
    'outFile',
    'rootDir',
    'declarationDir',
  ] as const) {
    delete options[key];
  }
  return { options, tsconfigPath: configPath, diagnostics };
}

/** Extensions TypeScript can resolve; anything else (`.css`, `.svg`, …) is never "unresolved". */
const RESOLVABLE_EXT_RE = /(^[^.]*$|\.(?:[cm]?[jt]sx?|json|d\.[cm]?ts))$/;

/**
 * True for specifiers the project is expected to resolve itself: relative paths and the common
 * alias prefixes `@/`, `~/`, `#` (package.json `imports`) — but not bare package names.
 */
export function looksLocal(specifier: string): boolean {
  if (
    !(
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      /^[@~]\//.test(specifier) ||
      specifier.startsWith('#')
    )
  )
    return false;
  const last = specifier.split('/').pop() ?? specifier;
  return last === '.' || last === '..' || RESOLVABLE_EXT_RE.test(last);
}

/**
 * Builds a TypeScript Program starting from `rootNames`, following imports (static, dynamic and
 * re-exports) but stopping at package boundaries: anything resolved into `node_modules` whose real
 * path is outside the boundary (the workspace root by default) is treated as external and not
 * loaded. Workspace packages symlinked under `node_modules` resolve to their real path, which is
 * inside the boundary, so they are analysed.
 */
export function createProjectProgram(opts: CreateProgramOptions): ProjectProgram {
  const root = realpath(path.resolve(opts.root));
  const boundary = realpath(
    opts.boundary === undefined ? findWorkspaceRoot(root) : path.resolve(root, opts.boundary),
  );
  const boundaryWithSep = boundary.endsWith(path.sep) ? boundary : boundary + path.sep;
  if (root !== boundary && !root.startsWith(boundaryWithSep)) {
    throw new ConfigError(`boundary must contain root: boundary=${boundary}, root=${root}`);
  }
  const { options, tsconfigPath, diagnostics } = loadCompilerOptions(root, opts.tsconfig);
  const host = ts.createCompilerHost(options, true);
  const unresolved = new Map<string, UnresolvedImport>();
  const cache = ts.createModuleResolutionCache(root, (f) => host.getCanonicalFileName(f), options);

  const isInsideProject = (file: string): boolean => {
    const real = realpath(file);
    if (!real.startsWith(boundaryWithSep)) return false;
    return !/[\\/]node_modules[\\/]/.test(real);
  };

  const resolveModule = (
    specifier: string,
    containingFile: string,
  ): ts.ResolvedModuleFull | undefined => {
    const result = ts.resolveModuleName(specifier, containingFile, options, host, cache);
    const resolved = result.resolvedModule;
    if (!resolved) {
      const key = `${containingFile}\0${specifier}`;
      if (looksLocal(specifier) && !unresolved.has(key) && isInsideProject(containingFile)) {
        unresolved.set(key, { specifier, from: containingFile });
      }
      return undefined;
    }
    const real = realpath(resolved.resolvedFileName);
    if (!isInsideProject(real)) return undefined;
    return { ...resolved, resolvedFileName: real, isExternalLibraryImport: false };
  };

  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((l) => ({ resolvedModule: resolveModule(l.text, containingFile) }));
  // Type reference directives would pull @types/* in; we never need them.
  host.resolveTypeReferenceDirectiveReferences = (refs) =>
    refs.map(() => ({ resolvedTypeReferenceDirective: undefined }));

  const program = ts.createProgram({ rootNames: [...opts.rootNames], options, host });
  const checker = program.getTypeChecker();

  const isProjectFile = (sf: ts.SourceFile): boolean =>
    !sf.isDeclarationFile &&
    !program.isSourceFileDefaultLibrary(sf) &&
    !program.isSourceFileFromExternalLibrary(sf) &&
    isInsideProject(sf.fileName);

  return {
    program,
    checker,
    root,
    boundary,
    tsconfigPath,
    diagnostics,
    unresolvedImports: () => [...unresolved.values()],
    resolve: (specifier, containingFile) =>
      resolveModule(specifier, containingFile)?.resolvedFileName,
    isProjectFile,
    projectFiles: () => program.getSourceFiles().filter(isProjectFile),
  };
}
