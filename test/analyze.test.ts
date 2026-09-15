import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/index.js';
import { findingsByPage, fixture, run } from './helpers.js';

describe('App Router', () => {
  it('app-router-ok: provider in root layout covers the page', async () => {
    const r = await run('app-router-ok');
    expect(r.summary.pages).toBe(1);
    expect(r.pages[0]).toEqual({ file: 'app/page.tsx', kind: 'app', chain: ['app/layout.tsx'] });
    expect(r.contexts.map((c) => c.name)).toEqual(['ThemeContext']);
    expect(r.findings).toEqual([]);
  });

  it('app-router-missing: silent consumer is an error, throw-guarded consumer is a warning', async () => {
    const r = await run('app-router-missing');
    expect(r.summary).toMatchObject({ pages: 2, contexts: 1, findings: 2, errors: 1, warnings: 1 });
    const [home, strict] = r.findings;
    expect(home).toMatchObject({
      severity: 'error',
      page: 'app/page.tsx',
      context: {
        name: 'ThemeContext',
        location: { file: 'src/theme.tsx', line: 4, col: 14 },
        defaultValue: 'undefined',
      },
      consumer: { name: 'useTheme', kind: 'silent', location: { file: 'src/theme.tsx', line: 11 } },
      suggestedMountPoint: 'app/layout.tsx',
    });
    expect(strict).toMatchObject({
      severity: 'warning',
      page: 'app/strict/page.tsx',
      consumer: { name: 'useStrictTheme', kind: 'throws' },
    });
  });

  it('app-router-nested: provider in a (group) layout covers its pages but not siblings', async () => {
    const r = await run('app-router-nested');
    expect(r.pages.map((p) => p.file)).toEqual([
      'app/(marketing)/about/page.tsx',
      'app/(marketing)/plain/page.tsx',
      'app/(shop)/cart/page.tsx',
    ]);
    expect(r.pages.find((p) => p.file === 'app/(shop)/cart/page.tsx')?.chain).toEqual([
      'app/layout.tsx',
      'app/(shop)/layout.tsx',
    ]);
    expect(findingsByPage(r)).toEqual({ 'app/(marketing)/about/page.tsx': ['CartContext'] });
    expect(r.findings[0]?.suggestedMountPoint).toBe('app/layout.tsx');
  });

  it('app-router-build-dirs: route segments named build/dist/out/coverage are pages, not build output', async () => {
    const r = await run('app-router-build-dirs');
    expect(r.pages.map((p) => p.file)).toEqual([
      'app/build/page.tsx',
      'app/coverage/page.tsx',
      'app/dist/page.tsx',
      'app/out/page.tsx',
    ]);
    expect(Object.keys(findingsByPage(r)).sort()).toEqual([
      'app/build/page.tsx',
      'app/coverage/page.tsx',
      'app/dist/page.tsx',
      'app/out/page.tsx',
    ]);
  });

  it('provider-in-page: Provider rendered by the page itself (JSX, React 19 tag, createElement, `const P = Ctx.Provider` alias) is fine; a bare Consumer is not', async () => {
    const r = await run('provider-in-page');
    expect(r.summary.pages).toBe(5);
    expect(findingsByPage(r)).toEqual({ 'app/consumer-only/page.tsx': ['ThemeContext'] });
    expect(r.findings[0]?.consumer.name).toBe('ConsumerOnlyPage');
  });
});

describe('Pages Router', () => {
  it('pages-router-ok: _app mounts the provider; .ts/.js pages are entries; _document and api/ are not', async () => {
    const r = await run('pages-router-ok');
    expect(r.pages.map((p) => p.file)).toEqual([
      'pages/index.tsx',
      'pages/legacy.ts',
      'pages/old.js',
      'pages/products/[id].tsx',
    ]);
    expect(r.pages.every((p) => p.kind === 'pages' && p.chain[0] === 'pages/_app.tsx')).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it('pages-router-missing: _app without the provider yields a finding pointing at _app, for .ts pages too', async () => {
    const r = await run('pages-router-missing');
    expect(findingsByPage(r)).toEqual({
      'pages/index.tsx': ['ThemeContext'],
      'pages/legacy.ts': ['ThemeContext'],
    });
    expect(r.findings.every((f) => f.suggestedMountPoint === 'pages/_app.tsx')).toBe(true);
  });
});

describe('module graph', () => {
  it('barrel-and-dynamic: consumer via `export *` barrel + next/dynamic is found; provider via dynamic import counts', async () => {
    const r = await run('barrel-and-dynamic');
    expect(r.summary.pages).toBe(3);
    expect(findingsByPage(r)).toEqual({ 'app/page.tsx': ['ThemeContext'] });
    expect(r.findings[0]?.consumer.location.file).toBe('src/lib/theme.tsx');
  });

  it('dynamic-named-only: import() of a module without a default export contributes only the members used', async () => {
    const r = await run('dynamic-named-only');
    expect(r.summary.pages).toBe(5);
    // `.then(m => m.Used)` and `.then(({ Used }) => …)` reach Used only: the unrendered sibling
    // export that mounts the Provider does not count, and neither does the private helper.
    expect(findingsByPage(r)).toEqual({
      'app/destructure/page.tsx': ['ThemeContext'],
      'app/member/page.tsx': ['ThemeContext'],
    });
    // `.then(m => m.NeverRendered)` reaches the provider; `await import()` (bare) and a callback
    // where the module object escapes (`pick(m)`) fall back to every export — documented
    // approximations that stay on the "no finding" side.
    for (const page of [
      'app/named-provider/page.tsx',
      'app/bare/page.tsx',
      'app/escape/page.tsx',
    ]) {
      expect(r.pages.some((p) => p.file === page)).toBe(true);
      expect(findingsByPage(r)[page]).toBeUndefined();
    }
  });

  it('tsconfig-paths: `@/lib/*` resolves for both consumers and providers', async () => {
    const r = await run('tsconfig-paths');
    expect(r.tsconfig).toBe(fixture('tsconfig-paths/tsconfig.json'));
    expect(findingsByPage(r)).toEqual({ 'app/page.tsx': ['ThemeContext'] });
  });

  it('plain-react: --entry and --always drive non-Next projects', async () => {
    const missing = await run('plain-react', { entries: ['src/main.tsx'] });
    expect(missing.pages).toEqual([{ file: 'src/main.tsx', kind: 'custom', chain: [] }]);
    expect(findingsByPage(missing)).toEqual({ 'src/main.tsx': ['ThemeContext'] });
    expect(missing.findings[0]?.suggestedMountPoint).toBe('src/main.tsx');

    const ok = await run('plain-react', { entries: ['src/main.tsx'], always: ['src/shell.tsx'] });
    expect(ok.pages[0]?.chain).toEqual(['src/shell.tsx']);
    expect(ok.findings).toEqual([]);
  });

  it('reports --entry/--always globs that match nothing as diagnostics', async () => {
    const r = await run('plain-react', {
      entries: ['src/main.tsx', 'nothing/**/*.tsx'],
      always: ['missing.tsx'],
    });
    expect(r.diagnostics).toEqual([
      '--always glob matched no file: missing.tsx',
      '--entry glob matched no file: nothing/**/*.tsx',
    ]);
    expect(r.summary.pages).toBe(1);
  });

  it('rejects an empty input set unless allowEmpty is set', async () => {
    await expect(run('empty')).rejects.toThrow(/no entries found/);
    await expect(run('plain-react', { entries: ['nothing/**'] })).rejects.toBeInstanceOf(
      ConfigError,
    );
    const r = await run('empty', { allowEmpty: true });
    expect(r.summary.pages).toBe(0);
    expect(r.diagnostics[0]).toMatch(/no entries found/);
  });
});

describe('defaulted contexts', () => {
  it('a non-nullish createContext default is reported as info by default and never fails', async () => {
    const r = await run('defaulted-context');
    expect(r.contexts.map((c) => [c.name, c.defaultValue])).toEqual([
      ['LocaleContext', 'other'],
      ['FlagContext', 'undefined'],
    ]);
    expect(r.findings.map((f) => [f.page, f.context.name, f.severity])).toEqual([
      ['app/page.tsx', 'LocaleContext', 'info'],
      ['app/strict/page.tsx', 'FlagContext', 'error'],
      ['app/strict/page.tsx', 'LocaleContext', 'info'],
    ]);
    expect(r.summary).toMatchObject({ findings: 3, errors: 1, warnings: 0, infos: 2 });
    expect(r.findings[0]?.message).toContain('non-nullish createContext default');
  });

  it('defaultedContexts can be raised to warning/error or ignored (option wins over config)', async () => {
    const asError = await run('defaulted-context', { defaultedContexts: 'error' });
    expect(asError.summary).toMatchObject({ errors: 3, warnings: 0, infos: 0 });
    const asWarning = await run('defaulted-context', { config: { defaultedContexts: 'warning' } });
    expect(asWarning.summary).toMatchObject({ errors: 1, warnings: 2, infos: 0 });
    const ignored = await run('defaulted-context', {
      config: { defaultedContexts: 'error' },
      defaultedContexts: 'ignore',
    });
    expect(findingsByPage(ignored)).toEqual({ 'app/strict/page.tsx': ['FlagContext'] });
    await expect(
      run('defaulted-context', { config: { defaultedContexts: 'loud' } as never }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('config', () => {
  it('external-contexts: config-driven provider/consumer pairs, including namespace imports and barrels', async () => {
    const r = await run('external-contexts');
    expect(r.contexts).toEqual([
      { name: 'QueryClient', location: null, defaultValue: 'unknown', external: true },
    ]);
    expect(findingsByPage(r)).toEqual({
      'app/barrel/page.tsx': ['QueryClient'],
      'app/page.tsx': ['QueryClient'],
    });
    // library hooks are assumed to throw without their provider: `throws` defaults to true
    expect(r.findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('external-contexts: `throws: false` in config raises the consumer to an error', async () => {
    const r = await run('external-contexts', {
      config: {
        externalContexts: [
          {
            name: 'QueryClient',
            providers: [{ module: '@acme/query', export: 'QueryClientProvider' }],
            consumers: [{ module: '@acme/query', export: 'useQuery', throws: false }],
          },
        ],
      },
    });
    expect(r.findings.map((f) => f.severity)).toEqual(['error', 'error']);
  });

  it('ignore: comment suppresses one call site, config "ignore" suppresses a context, the rest still reports', async () => {
    const r = await run('ignore');
    expect(r.contexts.map((c) => c.name).sort()).toEqual([
      'CartContext',
      'ThemeContext',
      'UserContext',
    ]);
    expect(findingsByPage(r)).toEqual({ 'app/page.tsx': ['UserContext'] });
  });

  it('ignore: without the config file both non-commented contexts report', async () => {
    const r = await run('ignore', { config: false });
    expect(findingsByPage(r)).toEqual({ 'app/page.tsx': ['CartContext', 'UserContext'] });
  });

  it('rejects an invalid config and a missing root', async () => {
    await expect(
      run('ignore', { config: { ignore: 'ThemeContext' } as never }),
    ).rejects.toBeInstanceOf(ConfigError);
    await expect(run('does-not-exist')).rejects.toBeInstanceOf(ConfigError);
    await expect(run('ignore', { tsconfig: 'nope.json' })).rejects.toBeInstanceOf(ConfigError);
  });
});
