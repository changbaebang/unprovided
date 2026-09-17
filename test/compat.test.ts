import { describe, expect, it } from 'vitest';
import { ConfigError, inspectEnvironment } from '../src/index.js';
import { findingsByPage, fixture, run } from './helpers.js';

describe('App Router conventions', () => {
  it('parallel @slot, intercepting (.) and route groups are plain directories; boundary files are entries', async () => {
    const r = await run('app-router-conventions');
    expect(r.pages.map((p) => `${p.file} <- ${p.chain.join(',')}`)).toEqual([
      'app/(grp)/x/error.tsx <- app/layout.tsx',
      'app/(grp)/x/loading.tsx <- app/layout.tsx',
      'app/(grp)/x/not-found.tsx <- app/layout.tsx',
      'app/(grp)/x/page.tsx <- app/layout.tsx',
      'app/@modal/(.)photo/page.tsx <- app/layout.tsx,app/@modal/layout.tsx',
      'app/@modal/default.tsx <- app/layout.tsx,app/@modal/layout.tsx',
      'app/global-error.tsx <- ',
      'app/jsx/page.jsx <- app/layout.tsx,app/jsx/template.tsx',
      'app/page.tsx <- app/layout.tsx',
      'app/photo/page.tsx <- app/layout.tsx',
    ]);
    // route.ts handlers are never entries
    expect(r.pages.some((p) => p.file === 'app/route.ts')).toBe(false);
  });

  it('a Client Component Provider mounted from a Server layout covers the page; slots see their own layout', async () => {
    const r = await run('app-router-conventions');
    expect(findingsByPage(r)).toEqual({
      'app/(grp)/x/error.tsx': ['ModalContext'],
      'app/(grp)/x/loading.tsx': ['ModalContext'],
      'app/(grp)/x/not-found.tsx': ['ModalContext'],
      // global-error replaces the root layout, so the Providers mounted there are gone
      'app/global-error.tsx': ['ThemeContext'],
      'app/jsx/page.jsx': ['ModalContext'],
      'app/photo/page.tsx': ['ModalContext'],
    });
    const globalError = r.findings.find((f) => f.page === 'app/global-error.tsx');
    expect(globalError?.suggestedMountPoint).toBe('app/global-error.tsx');
  });
});

describe('Pages Router patterns', () => {
  it('getLayout: Providers mounted by `Page.getLayout = …` are followed (direct and aliased default export)', async () => {
    const r = await run('pages-router-patterns');
    expect(findingsByPage(r)['pages/with-layout.tsx']).toBeUndefined();
    expect(findingsByPage(r)['pages/with-layout-alias.tsx']).toBeUndefined();
    expect(findingsByPage(r)['pages/no-layout.tsx']).toEqual(['AuthContext']);
  });

  it('React 19 `use(C)` and `<C value>` are recognised', async () => {
    const r = await run('pages-router-patterns');
    expect(findingsByPage(r)['pages/r19.tsx']).toBeUndefined();
    expect(findingsByPage(r)['pages/r19-missing.tsx']).toEqual(['R19Context']);
  });

  it('class components: static contextType, `C.contextType = …` and <C.Consumer> are consumers', async () => {
    const r = await run('pages-router-patterns');
    const byPage = Object.fromEntries(
      r.findings.map((f) => [f.page, `${f.consumer.name}:${f.consumer.kind}`]),
    );
    expect(byPage['pages/class-static.tsx']).toBe('StaticField:silent');
    expect(byPage['pages/class-assigned.tsx']).toBe('Assigned:silent');
    expect(byPage['pages/class-consumer.tsx']).toBe('RenderProp.render:silent');
    expect(r.pages.some((p) => p.file.startsWith('pages/api/'))).toBe(false);
    expect(r.pages.some((p) => p.file === 'middleware.ts')).toBe(false);
  });
});

describe('preflight', () => {
  it('a monorepo root lists the nested apps and the per-app command', async () => {
    let message = '';
    try {
      await run('monorepo-root');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      message = (e as Error).message;
    }
    expect(message).toContain('no entries found under');
    expect(message).toContain(
      'looked for: app/**/page.*, src/app/**/page.*, pages/**, src/pages/**',
    );
    expect(message).toContain('Next.js apps found below root: apps/admin, apps/web');
    expect(message).toContain('unprovided --root apps/admin');
    expect(message).toContain("--entry 'src/main.tsx' --always 'src/App.tsx'");
    expect(message).toContain('--allow-empty');
  });

  it('a non-Next.js layout (Remix-style) explains the --entry/--always recipe, which then works', async () => {
    await expect(run('remix-style')).rejects.toThrow(/app exists but contains no entry file/);
    const r = await run('remix-style', {
      entries: ['app/routes/**/*.tsx'],
      always: ['app/root.tsx'],
    });
    expect(r.pages).toEqual([
      { file: 'app/routes/_index.tsx', kind: 'custom', chain: ['app/root.tsx'] },
    ]);
    expect(findingsByPage(r)).toEqual({ 'app/routes/_index.tsx': ['OtherCtx'] });
  });

  it('tsconfig: unknown options and invalid values are diagnostics, not crashes; a references-only root is flagged; unresolved aliases are counted', async () => {
    const r = await run('tsconfig-diagnostics');
    expect(r.diagnostics).toEqual([
      expect.stringMatching(
        /^tsconfig: tsconfig\.json only references other configs \(tsconfig\.app\.json\)/,
      ),
      expect.stringMatching(
        /^unresolved imports: 1 relative or alias import resolved to no file.*'@\/ctx' from app\/page\.tsx/,
      ),
    ]);
    expect(r.findings).toEqual([]); // silent false negative, but no longer silent
    const explicit = await run('tsconfig-diagnostics', { tsconfig: 'tsconfig.app.json' });
    expect(explicit.diagnostics).toEqual([
      expect.stringMatching(
        /^tsconfig: Unknown compiler option 'optionFromANewerTypeScript'\. \(TS5023, ignored/,
      ),
      expect.stringMatching(
        /^tsconfig: Compiler option 'strict' requires a value of type boolean\. \(TS5024, ignored/,
      ),
    ]);
    expect(findingsByPage(explicit)).toEqual({ 'app/page.tsx': ['C'] });
  });

  it('tsconfig: an unparseable file is a ConfigError carrying the TypeScript diagnostic', async () => {
    await expect(run('tsconfig-diagnostics', { tsconfig: 'tsconfig.broken.json' })).rejects.toThrow(
      /^tsconfig: cannot parse .*tsconfig\.broken\.json: /,
    );
  });

  it('jsconfig.json is used when there is no tsconfig.json (JavaScript projects)', async () => {
    const r = await run('jsconfig-js-only');
    expect(r.tsconfig).toBe(fixture('jsconfig-js-only/jsconfig.json'));
    expect(r.diagnostics).toEqual([]);
    expect(findingsByPage(r)).toEqual({
      'app/alias/page.jsx': ['C'],
      'app/page.jsx': ['C'],
    });
  });
});

describe('inspectEnvironment', () => {
  it('reports root, boundary, tsconfig, routers, entries and versions without analysing', async () => {
    const r = await inspectEnvironment({ root: fixture('app-router-conventions') });
    expect(r.root).toBe(fixture('app-router-conventions'));
    expect(r.tsconfig).toBe(fixture('app-router-conventions/tsconfig.json'));
    expect(r.routers).toEqual({ app: ['app'], pages: [] });
    expect(r.entries).toEqual({ app: 10, pages: 0, custom: 0, total: 10 });
    expect(r.typescript).toMatch(/^5\./);
    expect(r.node).toBe(process.version);
    expect(r.error).toBeNull();
  });

  it('carries the no-entries explanation and nested apps for a monorepo root', async () => {
    const r = await inspectEnvironment({ root: fixture('monorepo-root') });
    expect(r.entries.total).toBe(0);
    expect(r.nestedApps).toEqual(['apps/admin', 'apps/web']);
    expect(r.error).toMatch(/no entries found under/);
    const allowed = await inspectEnvironment({ root: fixture('monorepo-root'), allowEmpty: true });
    expect(allowed.error).toBeNull();
    expect(allowed.diagnostics.some((d) => d.startsWith('no entries found'))).toBe(true);
  });

  it('lists --always files and custom entries', async () => {
    const r = await inspectEnvironment({
      root: fixture('remix-style'),
      entries: ['app/routes/**/*.tsx'],
      always: ['app/root.tsx'],
    });
    expect(r.entries).toEqual({ app: 0, pages: 0, custom: 1, total: 1 });
    expect(r.always).toEqual(['app/root.tsx']);
  });
});
