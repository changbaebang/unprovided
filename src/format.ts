import pc from 'picocolors';
import type { AnalysisResult, Finding, Location } from './types.js';

export interface FormatOptions {
  color?: boolean;
}

function fmtLoc(l: Location): string {
  return `${l.file}:${l.line}:${l.col}`;
}

/** Renders an analysis result for humans. Returns the text without a trailing newline. */
export function formatHuman(result: AnalysisResult, opts: FormatOptions = {}): string {
  const c = pc.createColors(opts.color ?? true);
  const lines: string[] = [];

  for (const d of result.diagnostics) lines.push(`${c.yellow('note')} ${d}`);

  const byPage = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const list = byPage.get(f.page) ?? [];
    list.push(f);
    byPage.set(f.page, list);
  }
  for (const [page, findings] of byPage) {
    if (lines.length > 0) lines.push('');
    lines.push(c.underline(page));
    for (const f of findings) {
      const tag =
        f.severity === 'error'
          ? c.red('error  ')
          : f.severity === 'warning'
            ? c.yellow('warning')
            : c.blue('info   ');
      const ctxLoc = f.context.location
        ? c.dim(` ${fmtLoc(f.context.location)}`)
        : c.dim(' (external)');
      lines.push(`  ${tag}  ${c.bold(f.context.name)}${ctxLoc}`);
      const kind =
        f.context.defaultValue === 'other'
          ? 'gets the non-nullish createContext default'
          : f.consumer.kind === 'throws'
            ? 'throws: crashes at render time'
            : f.context.external
              ? 'silent per config'
              : 'silent: gets the createContext default';
      lines.push(
        `           read by ${c.cyan(`${f.consumer.name}()`)} ${c.dim(fmtLoc(f.consumer.location))}  ${c.dim(`(${kind})`)}`,
      );
      const others = f.consumers.length - 1;
      if (others > 0) {
        const shown = f.consumers
          .slice(1, 4)
          .map((x) => `${x.name}()`)
          .join(', ');
        const more = others > 3 ? `, +${others - 3} more` : '';
        lines.push(`           also ${c.dim(shown + more)}`);
      }
      lines.push(`           mount a Provider in ${c.green(f.suggestedMountPoint)}`);
    }
  }

  const s = result.summary;
  const stats = `${s.pages} page${s.pages === 1 ? '' : 's'}, ${s.files} file${s.files === 1 ? '' : 's'}, ${s.contexts} context${s.contexts === 1 ? '' : 's'}, ${s.durationMs}ms`;
  if (lines.length > 0) lines.push('');
  const info = s.infos > 0 ? `, ${c.blue(`${s.infos} info`)}` : '';
  if (s.errors + s.warnings === 0) {
    lines.push(`${c.green('✔')} no unprovided contexts${info} ${c.dim(`(${stats})`)}`);
  } else {
    const parts: string[] = [];
    if (s.errors > 0) parts.push(c.red(`${s.errors} error${s.errors === 1 ? '' : 's'}`));
    if (s.warnings > 0) parts.push(c.yellow(`${s.warnings} warning${s.warnings === 1 ? '' : 's'}`));
    lines.push(`${c.red('✖')} ${parts.join(', ')}${info} ${c.dim(`(${stats})`)}`);
  }
  return lines.join('\n');
}
