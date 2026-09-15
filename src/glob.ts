import fs from 'node:fs';
import path from 'node:path';

/** Directories never entered by any walk: package boundaries and VCS/build caches. */
export const WALK_BOUNDARY_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', '.next']);

/**
 * Directories skipped when expanding `--entry` / `--always` globs. Route directories under
 * `app/` or `pages/` are walked with WALK_BOUNDARY_DIRS instead, so a route named `/build`
 * or `/dist` is still analysed.
 */
export const DEFAULT_IGNORED_DIRS: ReadonlySet<string> = new Set([
  ...WALK_BOUNDARY_DIRS,
  'dist',
  'build',
  'out',
  'coverage',
]);

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Converts a glob (`**`, `*`, `?`, `{a,b}`) into an anchored RegExp over posix paths. */
export function globToRegExp(glob: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories; trailing `**` matches anything.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i += 1;
      } else {
        const alts = glob
          .slice(i + 1, end)
          .split(',')
          .map((a) => a.replace(/[.+^$()|[\]\\]/g, '\\$&'));
        re += `(?:${alts.join('|')})`;
        i = end + 1;
      }
    } else if (/[.+^$()|[\]\\]/.test(c)) {
      re += `\\${c}`;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp(`${re}$`);
}

/** Static directory prefix of a glob (everything before the first segment containing a wildcard). */
function staticPrefix(glob: string): string {
  const segments = glob.split('/');
  const out: string[] = [];
  for (const s of segments) {
    if (/[*?{[]/.test(s)) break;
    out.push(s);
  }
  // The last static segment might be a file name; the walker copes with that.
  return out.join('/');
}

/** Recursively lists files under `dir` (absolute paths), skipping common build/vendor dirs. */
export function walkFiles(
  dir: string,
  ignoredDirs: ReadonlySet<string> = DEFAULT_IGNORED_DIRS,
): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (!ignoredDirs.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        out.push(full);
      } else if (e.isSymbolicLink()) {
        try {
          if (fs.statSync(full).isFile()) out.push(full);
        } catch {
          // dangling symlink
        }
      }
    }
  }
  return out;
}

/**
 * Expands globs relative to `root`, returning sorted absolute paths of existing files.
 * `onEmpty` is called with every pattern that matched nothing.
 */
export function expandGlobs(
  root: string,
  patterns: readonly string[],
  onEmpty?: (pattern: string) => void,
): string[] {
  const found = new Set<string>();
  for (const raw of patterns) {
    let matched = false;
    const pattern = toPosix(raw).replace(/^\.\//, '');
    const abs = path.isAbsolute(pattern);
    const base = abs ? '/' : root;
    const rel = abs ? pattern.replace(/^\/+/, '') : pattern;
    const prefix = staticPrefix(rel);
    const startDir = path.join(base, prefix);
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(startDir);
    } catch {
      stat = undefined;
    }
    if (stat?.isFile()) {
      found.add(startDir);
      matched = true;
    } else if (stat) {
      const re = globToRegExp(rel);
      for (const file of walkFiles(startDir)) {
        const relFile = toPosix(path.relative(base, file));
        if (re.test(relFile)) {
          found.add(file);
          matched = true;
        }
      }
    }
    if (!matched) onEmpty?.(raw);
  }
  return [...found].sort();
}
