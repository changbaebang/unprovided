import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, analyze } from '../src/index.js';
import { findingsByPage, fixture } from './helpers.js';

const isWindows = process.platform === 'win32';

describe.skipIf(isWindows)('workspace packages symlinked under node_modules', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'unprovided-symlink-'));
    fs.cpSync(fixture('workspace-symlink'), root, { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', '@acme'), { recursive: true });
    fs.symlinkSync(
      path.join('..', '..', 'packages', 'ui'),
      path.join(root, 'node_modules', '@acme', 'ui'),
      'dir',
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('follows @scope/name imports whose real path is inside root', async () => {
    const r = await analyze({ root });
    expect(r.contexts.map((c) => c.location?.file)).toEqual(['packages/ui/src/theme.tsx']);
    expect(findingsByPage(r)).toEqual({ 'app/page.tsx': ['ThemeContext'] });
  });

  it('follows workspace packages outside root when root is an app inside a workspace (boundary = workspace root)', async () => {
    const mono = fs.mkdtempSync(path.join(os.tmpdir(), 'unprovided-mono-'));
    try {
      fs.cpSync(fixture('monorepo'), mono, { recursive: true });
      const web = path.join(mono, 'apps', 'web');
      fs.mkdirSync(path.join(web, 'node_modules', '@acme'), { recursive: true });
      fs.symlinkSync(
        path.join('..', '..', '..', '..', 'packages', 'ui'),
        path.join(web, 'node_modules', '@acme', 'ui'),
        'dir',
      );
      const r = await analyze({ root: web });
      expect(r.boundary).toBe(fs.realpathSync.native(mono));
      expect(r.contexts.map((c) => c.location?.file)).toEqual(['../../packages/ui/src/theme.tsx']);
      expect(findingsByPage(r)).toEqual({ 'app/page.tsx': ['ThemeContext'] });

      // --boundary narrows resolution back to the app: the package becomes external
      const narrow = await analyze({ root: web, boundary: '.' });
      expect(narrow.boundary).toBe(fs.realpathSync.native(web));
      expect(narrow.contexts).toEqual([]);
      expect(narrow.findings).toEqual([]);
      const viaConfig = await analyze({ root: web, config: { boundary: '.' } });
      expect(viaConfig.contexts).toEqual([]);

      // a boundary that does not contain root is a config error
      await expect(analyze({ root: web, boundary: '../../packages' })).rejects.toBeInstanceOf(
        ConfigError,
      );
    } finally {
      fs.rmSync(mono, { recursive: true, force: true });
    }
  });

  it('treats a symlink whose real path is outside root as external', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'unprovided-outside-'));
    try {
      fs.cpSync(path.join(root, 'packages', 'ui'), path.join(outside, 'ui'), { recursive: true });
      fs.rmSync(path.join(root, 'node_modules', '@acme', 'ui'), { recursive: true, force: true });
      fs.symlinkSync(
        path.join(outside, 'ui'),
        path.join(root, 'node_modules', '@acme', 'ui'),
        'dir',
      );
      const r = await analyze({ root });
      expect(r.contexts).toEqual([]);
      expect(r.findings).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
