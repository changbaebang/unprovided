import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DIST_CLI, fixture } from './helpers.js';

function cli(...args: string[]) {
  const res = spawnSync(process.execPath, [DIST_CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('CLI (dist/cli.js)', () => {
  it('--json prints a stable shape and exits 1 on errors', () => {
    const { code, stdout } = cli('--root', fixture('app-router-missing'), '--json');
    expect(code).toBe(1);
    const json = JSON.parse(stdout);
    expect(Object.keys(json).sort()).toEqual(
      [
        'boundary',
        'contexts',
        'diagnostics',
        'findings',
        'pages',
        'root',
        'summary',
        'tsconfig',
        'version',
      ].sort(),
    );
    expect(json.summary).toMatchObject({
      pages: 2,
      contexts: 1,
      findings: 2,
      errors: 1,
      warnings: 1,
    });
    expect(json.findings[0]).toMatchObject({
      severity: 'error',
      page: 'app/page.tsx',
      context: { name: 'ThemeContext', location: { file: 'src/theme.tsx', line: 4, col: 14 } },
      consumer: { name: 'useTheme', kind: 'silent' },
      suggestedMountPoint: 'app/layout.tsx',
    });
    expect(typeof json.findings[0].message).toBe('string');
    expect(Array.isArray(json.findings[0].consumers)).toBe(true);
  });

  it('exits 0 on a clean project and prints the human summary', () => {
    const { code, stdout } = cli('--root', fixture('app-router-ok'));
    expect(code).toBe(0);
    expect(stdout).toContain('no unprovided contexts');
  });

  it('human output has file:line:col and the mount hint', () => {
    const { code, stdout } = cli('--root', fixture('app-router-missing'), '--no-color');
    expect(code).toBe(1);
    expect(stdout).toContain('app/page.tsx');
    expect(stdout).toContain('ThemeContext src/theme.tsx:4:14');
    expect(stdout).toContain('useTheme() src/theme.tsx:11:10');
    expect(stdout).toContain('mount a Provider in app/layout.tsx');
  });

  it('warnings do not fail unless --fail-on warning', () => {
    expect(cli('--root', fixture('app-router-warning')).code).toBe(0);
    expect(cli('--root', fixture('app-router-warning'), '--fail-on', 'warning').code).toBe(1);
  });

  it('--entry/--always work from the command line', () => {
    const missing = cli('--root', fixture('plain-react'), '--entry', 'src/main.tsx', '--json');
    expect(missing.code).toBe(1);
    const ok = cli(
      '--root',
      fixture('plain-react'),
      '--entry',
      'src/main.tsx',
      '--always',
      'src/shell.tsx',
    );
    expect(ok.code).toBe(0);
  });

  it('exits 2 on usage/config errors', () => {
    expect(cli('--bogus').code).toBe(2);
    expect(cli('some/positional/path').code).toBe(2);
    expect(cli('--root', fixture('nope')).code).toBe(2);
    expect(cli('--root', fixture('app-router-ok'), '--fail-on', 'never').code).toBe(2);
    expect(cli('--root', fixture('app-router-ok'), '--defaulted', 'loud').code).toBe(2);
    expect(cli('--root', fixture('app-router-ok'), '--config', 'missing.json').code).toBe(2);
    expect(cli('--root', fixture('app-router-ok'), '--boundary', 'app').code).toBe(2);
  });

  it('exits 2 when no entry is found unless --allow-empty', () => {
    const empty = cli('--root', fixture('empty'));
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain('no entries found');
    expect(empty.stderr).toContain('--allow-empty');
    const noMatch = cli('--root', fixture('plain-react'), '--entry', 'nothing/**');
    expect(noMatch.code).toBe(2);
    const allowed = cli('--root', fixture('empty'), '--allow-empty');
    expect(allowed.code).toBe(0);
    expect(allowed.stdout).toContain('no entries found');
    expect(allowed.stdout).toContain('no unprovided contexts (0 pages');
  });

  it('--defaulted: info never fails, error does; the human report shows the info tag', () => {
    const info = cli('--root', fixture('defaulted-context'), '--fail-on', 'warning');
    expect(info.code).toBe(1); // FlagContext is a real error; LocaleContext is info
    expect(info.stdout).toContain('info     LocaleContext');
    expect(info.stdout).toContain('1 error, 2 info');
    const onlyDefaulted = cli(
      '--root',
      fixture('defaulted-context'),
      '--json',
      '--defaulted',
      'ignore',
    );
    expect(JSON.parse(onlyDefaulted.stdout).summary).toMatchObject({ errors: 1, infos: 0 });
    expect(cli('--root', fixture('defaulted-context'), '--defaulted', 'error').code).toBe(1);
    const warn = cli('--root', fixture('defaulted-context'), '--defaulted', 'warning', '--json');
    expect(JSON.parse(warn.stdout).summary).toMatchObject({ errors: 1, warnings: 2, infos: 0 });
  });

  it('--env prints the environment and exits 0/2 like the analysis would', () => {
    const ok = cli('--root', fixture('app-router-ok'), '--env');
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/^unprovided \d+\.\d+\.\d+/);
    expect(ok.stdout).toContain('typescript:  5.');
    expect(ok.stdout).toContain('routers:     app router: app; pages router: none');
    expect(ok.stdout).toContain('entries:     1 (app: 1, pages: 0, custom: 0)');
    const mono = cli('--root', fixture('monorepo-root'), '--env');
    expect(mono.code).toBe(2);
    expect(mono.stdout).toContain('nested apps: apps/admin, apps/web');
    expect(mono.stdout).toContain('error:       no entries found under');
    const json = cli('--root', fixture('monorepo-root'), '--env', '--json', '--allow-empty');
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      nestedApps: ['apps/admin', 'apps/web'],
      error: null,
    });
  });

  it('the no-entries error explains what was looked for and how to fix it', () => {
    const mono = cli('--root', fixture('monorepo-root'));
    expect(mono.code).toBe(2);
    expect(mono.stderr).toContain('unprovided: no entries found under');
    expect(mono.stderr).toContain('run once per app: unprovided --root apps/admin');
    const withGlob = cli('--root', fixture('plain-react'), '--entry', 'nothing/**');
    expect(withGlob.code).toBe(2);
    expect(withGlob.stderr).toContain('--entry globs (nothing/** — matched no file)');
  });

  it('tsconfig problems: unknown options are notes (exit unchanged), an unparseable file exits 2', () => {
    const notes = cli('--root', fixture('tsconfig-diagnostics'), '--tsconfig', 'tsconfig.app.json');
    expect(notes.code).toBe(1);
    expect(notes.stdout).toContain(
      "note tsconfig: Unknown compiler option 'optionFromANewerTypeScript'. (TS5023, ignored",
    );
    const broken = cli(
      '--root',
      fixture('tsconfig-diagnostics'),
      '--tsconfig',
      'tsconfig.broken.json',
    );
    expect(broken.code).toBe(2);
    expect(broken.stderr).toContain('unprovided: tsconfig: cannot parse');
  });

  it('--help and --version exit 0', () => {
    const help = cli('--help');
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: unprovided');
    const version = cli('--version');
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
