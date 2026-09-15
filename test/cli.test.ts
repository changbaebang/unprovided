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

  it('--help and --version exit 0', () => {
    const help = cli('--help');
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: unprovided');
    const version = cli('--version');
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
