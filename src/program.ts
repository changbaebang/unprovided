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
  /** Path of the tsconfig that was used, if any. */
  tsconfigPath: string | null;
  /** Resolves a module specifier from `containingFile` to an absolute file inside the project. */
  resolve(specifier: string, containingFile: string): string | undefined;
  /** True for files that belong to the analysed project (not lib, not node_modules). */
  isProjectFile(sf: ts.SourceFile): boolean;
  /** Source files that belong to the project. */
  projectFiles(): ts.SourceFile[];
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

function loadCompilerOptions(
  root: string,
  tsconfig: string | undefined,
): { options: ts.CompilerOptions; tsconfigPath: string | null } {
  let configPath: string | undefined;
  if (tsconfig) {
    configPath = path.resolve(root, tsconfig);
    if (!fs.existsSync(configPath)) throw new ConfigError(`tsconfig not found: ${configPath}`);
  } else {
    configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  }

  let base: ts.CompilerOptions = {};
  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) {
      throw new ConfigError(
        `failed to read ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`,
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
  return { options, tsconfigPath: configPath ?? null };
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
  const { options, tsconfigPath } = loadCompilerOptions(root, opts.tsconfig);
  const host = ts.createCompilerHost(options, true);
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
    if (!resolved) return undefined;
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
    resolve: (specifier, containingFile) =>
      resolveModule(specifier, containingFile)?.resolvedFileName,
    isProjectFile,
    projectFiles: () => program.getSourceFiles().filter(isProjectFile),
  };
}
