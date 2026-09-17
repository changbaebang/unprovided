import { parseArgs } from 'node:util';
import pkg from '../package.json';
import { analyze } from './analyze.js';
import { DEFAULTED_LEVELS, isDefaultedLevel } from './config.js';
import { formatEnvironment, inspectEnvironment } from './env.js';
import { ConfigError } from './errors.js';
import { formatHuman } from './format.js';

const HELP = `unprovided ${pkg.version}
Find React hooks that read a Context whose Provider is never mounted on that page.

Usage: unprovided [options]

Options:
  --root <dir>        Project root (default: cwd). Next.js app/, src/app/, pages/, src/pages/ are discovered here.
  --entry <glob>      Extra entry files (repeatable, relative to root). Files following app/**/page.* or pages/** get their chain automatically.
  --always <glob>     Files considered always mounted for every entry (repeatable, relative to root), e.g. custom root wrappers.
  --tsconfig <path>   tsconfig.json to use for paths/baseUrl (relative to root; default: nearest from root upwards).
  --config <path>     Config file (relative to root; default: unprovided.config.{json,mjs,js} in root).
  --boundary <dir>    Directory that bounds module resolution (relative to root; default: nearest workspace root above root).
  --defaulted <level> Severity for contexts with a non-nullish createContext default: info (default), warning, error or ignore.
  --fail-on <level>   Exit 1 on "error" (default) or "warning". "info" findings never fail.
  --allow-empty       Exit 0 instead of 2 when no entry is found.
  --env               Print the environment (root, boundary, tsconfig, routers, entries, versions) and exit; for bug reports.
  --json              Print the machine-readable result instead of the human report.
  --no-color          Disable colors.
  -h, --help          Show this help.
  -v, --version       Print the version.

Exit codes: 0 clean, 1 findings at or above --fail-on, 2 usage/config error or no entries found.
Non-fatal problems (tsconfig options ignored, unresolved alias imports, empty globs) are printed as
"note ..." lines and returned in "diagnostics" with --json; they never change the exit code.`;

export async function main(argv: readonly string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<typeof spec>>;
  const spec = {
    options: {
      root: { type: 'string' },
      entry: { type: 'string', multiple: true },
      always: { type: 'string', multiple: true },
      tsconfig: { type: 'string' },
      config: { type: 'string' },
      boundary: { type: 'string' },
      defaulted: { type: 'string' },
      'fail-on': { type: 'string' },
      'allow-empty': { type: 'boolean' },
      env: { type: 'boolean' },
      json: { type: 'boolean' },
      'no-color': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: false,
    strict: true,
  } as const;
  try {
    parsed = parseArgs({ args: [...argv], ...spec });
  } catch (e) {
    process.stderr.write(`unprovided: ${(e as Error).message}\n\n${HELP}\n`);
    return 2;
  }
  const v = parsed.values;
  if (v.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (v.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  const failOn = v['fail-on'] ?? 'error';
  if (failOn !== 'error' && failOn !== 'warning') {
    process.stderr.write(`unprovided: --fail-on must be "error" or "warning", got "${failOn}"\n`);
    return 2;
  }
  const defaulted = v.defaulted;
  if (defaulted !== undefined && !isDefaultedLevel(defaulted)) {
    process.stderr.write(
      `unprovided: --defaulted must be one of ${DEFAULTED_LEVELS.join(', ')}, got "${defaulted}"\n`,
    );
    return 2;
  }

  const common = {
    ...(v.root !== undefined ? { root: v.root } : {}),
    ...(v.entry !== undefined ? { entries: v.entry } : {}),
    ...(v.always !== undefined ? { always: v.always } : {}),
    ...(v.tsconfig !== undefined ? { tsconfig: v.tsconfig } : {}),
    ...(v.config !== undefined ? { config: v.config } : {}),
    ...(v.boundary !== undefined ? { boundary: v.boundary } : {}),
    ...(v['allow-empty'] ? { allowEmpty: true } : {}),
  };
  try {
    if (v.env) {
      const report = await inspectEnvironment(common);
      process.stdout.write(
        v.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatEnvironment(report)}\n`,
      );
      return report.error ? 2 : 0;
    }
    const result = await analyze({
      ...common,
      ...(defaulted !== undefined ? { defaultedContexts: defaulted } : {}),
    });
    if (v.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const color = !v['no-color'] && process.stdout.isTTY === true && !process.env.NO_COLOR;
      process.stdout.write(`${formatHuman(result, { color })}\n`);
    }
    const { errors, warnings } = result.summary;
    const failing = failOn === 'warning' ? errors + warnings : errors;
    return failing > 0 ? 1 : 0;
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`unprovided: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(
      `unprovided: unexpected error\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
    );
    process.exitCode = 2;
  },
);
