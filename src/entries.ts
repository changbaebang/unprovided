import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_IGNORED_DIRS,
  expandGlobs,
  toPosix,
  WALK_BOUNDARY_DIRS,
  walkFiles,
} from './glob.js';
import type { EntryKind } from './types.js';

const EXTS = ['tsx', 'jsx', 'ts', 'js'] as const;
const EXT_RE = /\.(tsx|jsx|ts|js)$/;
/**
 * App Router files that render inside the layout chain of their directory and therefore are
 * entries: `page`, plus the boundary files `loading`, `error`, `not-found` and the parallel-route
 * fallback `default`. `global-error` replaces the root layout, so it is an entry with an empty
 * chain. `layout` / `template` form the chain; `route` (handlers) and metadata files are ignored.
 */
const APP_ENTRY_RE = /^(page|loading|error|not-found|default|global-error)\.(tsx|jsx|ts|js)$/;
const APP_DIRS = ['app', 'src/app'] as const;
const PAGES_DIRS = ['pages', 'src/pages'] as const;

export interface Entry {
  /** Absolute path of the entry file. */
  file: string;
  kind: EntryKind;
  /** Absolute paths of always-mounted files (root first). */
  chain: string[];
  /** Absolute path (may not exist) where a Provider is best mounted for this entry. */
  suggestedMountPoint: string;
}

export interface DiscoverOptions {
  entries?: readonly string[];
  always?: readonly string[];
  /** Called with every `entries` / `always` glob that matched no file. */
  onEmptyGlob?: (kind: 'entry' | 'always', pattern: string) => void;
}

function firstExisting(dir: string, base: string): string | undefined {
  for (const ext of EXTS) {
    const candidate = path.join(dir, `${base}.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Builds the layout/template chain for an App Router page under `appRoot`. */
function appRouterChain(appRoot: string, pageFile: string): { chain: string[]; mount: string } {
  const chain: string[] = [];
  let mount: string | undefined;
  const rel = path.relative(appRoot, path.dirname(pageFile));
  const segments = rel === '' ? [] : rel.split(path.sep);
  for (let i = 0; i <= segments.length; i++) {
    const dir = path.join(appRoot, ...segments.slice(0, i));
    const layout = firstExisting(dir, 'layout');
    const template = firstExisting(dir, 'template');
    if (layout) {
      chain.push(layout);
      mount = layout;
    }
    if (template) chain.push(template);
  }
  return { chain, mount: mount ?? path.join(appRoot, 'layout.tsx') };
}

/** Returns the App Router root (`.../app`) for an App Router entry file, if it follows the convention. */
function findAppRoot(file: string): string | undefined {
  if (!APP_ENTRY_RE.test(path.basename(file))) return undefined;
  let dir = path.dirname(file);
  while (true) {
    if (path.basename(dir) === 'app') return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Returns the Pages Router root (`.../pages`) for a file under it, if it follows the convention. */
function findPagesRoot(file: string): string | undefined {
  let dir = path.dirname(file);
  while (true) {
    if (path.basename(dir) === 'pages') return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function isPagesRouterPage(pagesRoot: string, file: string): boolean {
  if (!EXT_RE.test(file) || file.endsWith('.d.ts')) return false;
  const rel = toPosix(path.relative(pagesRoot, file));
  if (rel.startsWith('api/')) return false;
  const base = path.basename(file).replace(EXT_RE, '');
  return !['_app', '_document', '_error'].includes(base);
}

function pagesRouterChain(pagesRoot: string): { chain: string[]; mount: string } {
  const app = firstExisting(pagesRoot, '_app');
  return { chain: app ? [app] : [], mount: app ?? path.join(pagesRoot, '_app.tsx') };
}

function classify(file: string, alwaysFiles: readonly string[]): Entry {
  const appRoot = findAppRoot(file);
  if (appRoot) {
    // `global-error.*` renders its own <html>/<body> instead of the root layout: nothing above it.
    if (/^global-error\./.test(path.basename(file))) {
      return { file, kind: 'app', chain: [], suggestedMountPoint: file };
    }
    const { chain, mount } = appRouterChain(appRoot, file);
    return { file, kind: 'app', chain, suggestedMountPoint: mount };
  }
  const pagesRoot = findPagesRoot(file);
  if (pagesRoot && isPagesRouterPage(pagesRoot, file)) {
    const { chain, mount } = pagesRouterChain(pagesRoot);
    return { file, kind: 'pages', chain, suggestedMountPoint: mount };
  }
  return { file, kind: 'custom', chain: [], suggestedMountPoint: alwaysFiles[0] ?? file };
}

/**
 * Discovers entries: Next.js App Router pages (`app/**` and `src/app/**`), Pages Router pages
 * (`pages/**` and `src/pages/**`), plus explicit `--entry` globs. `--always` files are appended
 * to every entry's chain.
 *
 * Route trees are walked with only `node_modules` / `.git` / `.next` skipped: a route segment
 * named `build`, `dist`, `out` or `coverage` is a page like any other. The wider ignore list only
 * applies to `--entry` / `--always` glob expansion.
 */
export function discoverEntries(root: string, opts: DiscoverOptions = {}): Entry[] {
  const alwaysFiles = expandGlobs(root, opts.always ?? [], (p) => opts.onEmptyGlob?.('always', p));
  const files = new Set<string>();

  for (const appDir of APP_DIRS) {
    const appRoot = path.join(root, appDir);
    if (!isDir(appRoot)) continue;
    for (const f of walkFiles(appRoot, WALK_BOUNDARY_DIRS)) {
      if (APP_ENTRY_RE.test(path.basename(f))) files.add(f);
    }
  }
  for (const pagesDir of PAGES_DIRS) {
    const pagesRoot = path.join(root, pagesDir);
    if (!isDir(pagesRoot)) continue;
    for (const f of walkFiles(pagesRoot, WALK_BOUNDARY_DIRS)) {
      if (isPagesRouterPage(pagesRoot, f)) files.add(f);
    }
  }
  for (const f of expandGlobs(root, opts.entries ?? [], (p) => opts.onEmptyGlob?.('entry', p))) {
    if (EXT_RE.test(f)) files.add(f);
  }

  const entries: Entry[] = [];
  for (const file of [...files].sort()) {
    const entry = classify(file, alwaysFiles);
    for (const a of alwaysFiles) if (!entry.chain.includes(a) && a !== file) entry.chain.push(a);
    entries.push(entry);
  }
  return entries;
}

export interface RouterDetection {
  /** Existing App Router directories, relative to root (`app`, `src/app`). */
  app: string[];
  /** Existing Pages Router directories, relative to root (`pages`, `src/pages`). */
  pages: string[];
}

/** Which Next.js router directories exist directly under `root`. */
export function detectRouters(root: string): RouterDetection {
  return {
    app: APP_DIRS.filter((d) => isDir(path.join(root, d))),
    pages: PAGES_DIRS.filter((d) => isDir(path.join(root, d))),
  };
}

const CANDIDATE_SKIP = new Set([...DEFAULT_IGNORED_DIRS, 'app', 'pages', 'src', 'public']);
const CANDIDATE_DEPTH = 4;

/**
 * Directories below `root` (not root itself) that look like Next.js apps, i.e. contain an App
 * Router entry under `app` / `src/app` or a Pages Router page under `pages` / `src/pages`. Used
 * to explain a monorepo root passed as `--root`. Results are relative to root, sorted, at most
 * `limit`.
 */
export function findNestedNextApps(root: string, limit = 8): string[] {
  const found: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0 && found.length < limit) {
    const { dir, depth } = stack.pop() as { dir: string; depth: number };
    if (dir !== root && hasNextEntries(dir)) {
      found.push(toPosix(path.relative(root, dir)));
      continue;
    }
    if (depth >= CANDIDATE_DEPTH) continue;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const c of children.sort((a, b) => b.name.localeCompare(a.name))) {
      if (c.isDirectory() && !CANDIDATE_SKIP.has(c.name) && !c.name.startsWith('.')) {
        stack.push({ dir: path.join(dir, c.name), depth: depth + 1 });
      }
    }
  }
  return found.sort();
}

function hasNextEntries(dir: string): boolean {
  for (const appDir of APP_DIRS) {
    const appRoot = path.join(dir, appDir);
    if (
      isDir(appRoot) &&
      walkFiles(appRoot, WALK_BOUNDARY_DIRS).some((f) => APP_ENTRY_RE.test(path.basename(f)))
    )
      return true;
  }
  for (const pagesDir of PAGES_DIRS) {
    const pagesRoot = path.join(dir, pagesDir);
    if (
      isDir(pagesRoot) &&
      walkFiles(pagesRoot, WALK_BOUNDARY_DIRS).some((f) => isPagesRouterPage(pagesRoot, f))
    )
      return true;
  }
  return false;
}

/**
 * Multi-line explanation for an empty entry set: what was looked for, what was found instead,
 * and the flags that fix it. Used for the exit-2 message and the `--allow-empty` diagnostic.
 */
export function explainNoEntries(
  root: string,
  opts: { entries?: readonly string[]; always?: readonly string[] } = {},
): string {
  const routers = detectRouters(root);
  const present = [...routers.app, ...routers.pages];
  const entryGlobs = opts.entries ?? [];
  const lines = [
    `no entries found under ${root}`,
    `  looked for: app/**/page.*, src/app/**/page.*, pages/**, src/pages/** and --entry globs (${
      entryGlobs.length > 0 ? `${entryGlobs.join(', ')} — matched no file` : 'none given'
    })`,
  ];
  if (present.length > 0) {
    lines.push(
      `  ${present.join(', ')} ${present.length === 1 ? 'exists but contains' : 'exist but contain'} no entry file (App Router: page/loading/error/not-found/default.*; Pages Router: any .tsx/.jsx/.ts/.js outside api/)`,
    );
  }
  const nested = findNestedNextApps(root);
  if (nested.length > 0) {
    lines.push(
      `  Next.js apps found below root: ${nested.join(', ')} — run once per app: unprovided --root ${nested[0]}`,
    );
  }
  lines.push(
    "  not a Next.js project? pass the entries explicitly: unprovided --entry 'src/main.tsx' --always 'src/App.tsx'",
  );
  lines.push('  (pass --allow-empty to exit 0 instead)');
  return lines.join('\n');
}
