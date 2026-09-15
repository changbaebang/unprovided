import { describe, expect, it } from 'vitest';
import { expandGlobs, globToRegExp } from '../src/glob.js';
import { fixture } from './helpers.js';

describe('globToRegExp', () => {
  it('handles **, *, ?, {a,b} and dots', () => {
    const re = globToRegExp('app/**/page.{tsx,jsx}');
    expect(re.test('app/page.tsx')).toBe(true);
    expect(re.test('app/(shop)/cart/page.jsx')).toBe(true);
    expect(re.test('app/page.ts')).toBe(false);
    expect(re.test('src/app/page.tsx')).toBe(false);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('src/?.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });
});

describe('expandGlobs', () => {
  it('expands relative to root and returns sorted absolute paths', () => {
    const root = fixture('app-router-nested');
    const files = expandGlobs(root, ['app/**/page.tsx']);
    expect(files.map((f) => f.slice(root.length + 1))).toEqual([
      'app/(marketing)/about/page.tsx',
      'app/(marketing)/plain/page.tsx',
      'app/(shop)/cart/page.tsx',
    ]);
    expect(expandGlobs(root, ['nothing/**'])).toEqual([]);
  });
});
