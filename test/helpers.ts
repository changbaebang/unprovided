import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AnalysisResult, type AnalyzeOptions, analyze } from '../src/index.js';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const DIST_CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'cli.js',
);

export function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

export function run(
  name: string,
  opts: Omit<AnalyzeOptions, 'root'> = {},
): Promise<AnalysisResult> {
  return analyze({ root: fixture(name), ...opts });
}

/** `page -> [context names]` for quick assertions. */
export function findingsByPage(result: AnalysisResult): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of result.findings) {
    const list = out[f.page] ?? [];
    list.push(f.context.name);
    out[f.page] = list;
  }
  return out;
}
