import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { classifyConsumer, functionName } from '../src/facts.js';

function firstCall(code: string): {
  call: ts.CallExpression;
  fn: ts.FunctionDeclaration | ts.ArrowFunction | undefined;
} {
  const sf = ts.createSourceFile('x.tsx', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let call: ts.CallExpression | undefined;
  const visit = (n: ts.Node) => {
    if (!call && ts.isCallExpression(n) && n.expression.getText() === 'useContext') call = n;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!call) throw new Error('no useContext call');
  let fn: ts.Node | undefined = call.parent;
  while (fn && !ts.isFunctionDeclaration(fn) && !ts.isArrowFunction(fn)) fn = fn.parent;
  return { call, fn: fn as ts.FunctionDeclaration | ts.ArrowFunction | undefined };
}

const classify = (code: string) => {
  const { call, fn } = firstCall(code);
  return classifyConsumer(call, fn);
};

describe('classifyConsumer', () => {
  it('detects explicit throw guards', () => {
    expect(
      classify('function u(){ const c = useContext(X); if (!c) throw new Error(); return c }'),
    ).toBe('throws');
    expect(
      classify(
        'function u(){ const c = useContext(X); if (c === undefined) { throw new Error() } return c }',
      ),
    ).toBe('throws');
    expect(
      classify(
        'function u(){ const c = useContext(X); if (c == null) throw new Error(); return c }',
      ),
    ).toBe('throws');
    expect(
      classify(
        'function u(){ const c = useContext(X); if (typeof c === "undefined") throw new Error(); return c }',
      ),
    ).toBe('throws');
    expect(
      classify('function u(){ const c = useContext(X)!; invariant(c, "missing"); return c }'),
    ).toBe('throws');
    expect(classify('function u(){ const c = useContext(X); assertDefined(c); return c }')).toBe(
      'throws',
    );
    expect(classify('const u = () => useContext(X) ?? invariant(false, "missing")')).toBe('throws');
    expect(
      classify(
        'function u(){ const c = useContext(X); return c ?? (() => { throw new Error() })() }',
      ),
    ).toBe('throws');
  });

  it('treats everything else as silent', () => {
    expect(classify('function u(){ return useContext(X) }')).toBe('silent');
    expect(classify('function u(){ const c = useContext(X); if (!c) return null; return c }')).toBe(
      'silent',
    );
    expect(
      classify('function u(){ const c = useContext(X); if (c) throw new Error("no"); return c }'),
    ).toBe('silent');
    expect(classify('function u(){ const { a } = useContext(X); return a }')).toBe('silent');
    // a guard inside a nested function does not count
    expect(
      classify(
        'function u(){ const c = useContext(X); const f = () => { if (!c) throw new Error() }; return c }',
      ),
    ).toBe('silent');
  });
});

describe('functionName', () => {
  it('names declarations, variables, memo/forwardRef wrappers, methods and default exports', () => {
    const name = (code: string) => functionName(firstCall(code).fn as ts.FunctionDeclaration);
    expect(name('function useA(){ useContext(X) }')).toBe('useA');
    expect(name('const useB = () => useContext(X)')).toBe('useB');
    expect(name('const C = memo(forwardRef(() => useContext(X)))')).toBe('C');
    expect(name('export default () => useContext(X)')).toBe('default');
    expect(name('const o = { useD: () => useContext(X) }')).toBe('useD');
  });
});
