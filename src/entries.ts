import fs from 'node:fs';
import path from 'node:path';
import { expandGlobs, toPosix, WALK_BOUNDARY_DIRS, walkFiles } from './glob.js';
import type { EntryKind } from './types.js';

const EXTS = ['tsx', 'jsx', 'ts', 'js'] as const;
const EXT_RE = /\.(tsx|jsx|ts|js)$/;

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

/** Returns the App Router root (`.../app`) for a `page.*` file, if it follows the convention. */
function findAppRoot(file: string): string | undefined {
  if (!/^page\.(tsx|jsx|ts|js)$/.test(path.basename(file))) return undefined;
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

  for (const appDir of ['app', 'src/app']) {
    const appRoot = path.join(root, appDir);
    if (!isDir(appRoot)) continue;
    for (const f of walkFiles(appRoot, WALK_BOUNDARY_DIRS)) {
      if (/^page\.(tsx|jsx|ts|js)$/.test(path.basename(f))) files.add(f);
    }
  }
  for (const pagesDir of ['pages', 'src/pages']) {
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
