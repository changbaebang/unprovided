import ts from 'typescript';
import type { ProjectProgram } from './program.js';

/**
 * Symbol-level reachability. A "declaration" is a walkable AST node (function, variable, class,
 * property assignment, `export default` expression...). Walking a declaration collects every
 * declaration referenced from its body (through the checker, aliases resolved) plus the members
 * of any `import()` target that the call site actually uses (see `importTargets`). The closure of
 * a file is the transitive set starting at its default export.
 */
export class Reachability {
  private readonly refs = new Map<ts.Node, ts.Node[]>();
  private readonly roots = new Map<string, ts.Node[]>();
  private readonly closures = new Map<string, Set<ts.Node>>();

  constructor(private readonly project: ProjectProgram) {}

  /**
   * Declarations that form the entry of `file`: its default export plus any module-level
   * `<DefaultExport>.getLayout = …` assignment (the Next.js Pages Router per-page layout
   * pattern, whose Providers are mounted by that function rather than by `_app`), or the whole
   * file as fallback. The whole-file fallback exists for entry / `--always` files only (a
   * `_app.tsx` without a default export, a shell module); `import()` targets never use it.
   */
  rootsOf(file: string): ts.Node[] {
    const cached = this.roots.get(file);
    if (cached) return cached;
    let out = this.exportDecls(file, (name) => name === 'default');
    if (out.length === 0) {
      const sf = this.project.program.getSourceFile(file);
      out = sf ? [sf] : [];
    } else {
      out = [...out, ...this.getLayoutAssignments(file, out)];
    }
    this.roots.set(file, out);
    return out;
  }

  /**
   * `Page.getLayout = (page) => <Layout>{page}</Layout>` statements at the top level of `file`
   * whose target is one of `defaultDecls`.
   */
  private getLayoutAssignments(file: string, defaultDecls: readonly ts.Node[]): ts.Node[] {
    const { program, checker } = this.project;
    const sf = program.getSourceFile(file);
    if (!sf) return [];
    const out: ts.Node[] = [];
    for (const st of sf.statements) {
      if (!ts.isExpressionStatement(st) || !ts.isBinaryExpression(st.expression)) continue;
      const { left, operatorToken } = st.expression;
      if (operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
      if (!ts.isPropertyAccessExpression(left) || left.name.text !== 'getLayout') continue;
      if (!ts.isIdentifier(left.expression)) continue;
      const sym = checker.getSymbolAtLocation(left.expression);
      if (!sym) continue;
      if (this.declsOf(sym).some((d) => defaultDecls.includes(d))) out.push(st);
    }
    return out;
  }

  /** Declarations behind the exports of `file` whose name passes `accept`. */
  private exportDecls(file: string, accept: (name: string) => boolean): ts.Node[] {
    const { program, checker } = this.project;
    const sf = program.getSourceFile(file);
    if (!sf) return [];
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) return [];
    const out: ts.Node[] = [];
    for (const s of checker.getExportsOfModule(moduleSymbol)) {
      if (accept(s.escapedName as string)) out.push(...this.declsOf(s));
    }
    return out;
  }

  /**
   * Declarations contributed by an `import('x')` call site:
   * - `import('x').then(m => m.A)` / `.then(({ A, B }) => …)` → only the exports named `A`, `B`
   *   (`m.default` counts as the default export);
   * - `.then(m => …)` where `m` escapes (`.then(m => helper(m))`, `.then(m => m)`) and a bare
   *   `import('x')` without member access → every export of `x` (private declarations stay out);
   * - `dynamic(() => import('x'))` / `lazy(() => import('x'))` / any other bare use → the default
   *   export when there is one, else every export.
   */
  importTargets(call: ts.CallExpression, target: string): ts.Node[] {
    const then = thenCallback(call);
    if (!then) {
      const def = this.exportDecls(target, (n) => n === 'default');
      return def.length > 0 ? def : this.exportDecls(target, () => true);
    }
    const members = usedMembers(then);
    if (members === 'all') return this.exportDecls(target, () => true);
    if (members.size === 0) return [];
    return this.exportDecls(target, (n) => members.has(n));
  }

  /** Transitive closure of declarations reachable from the default exports of `files`. */
  closureOf(files: readonly string[]): Set<ts.Node> {
    const result = new Set<ts.Node>();
    for (const file of files) {
      for (const n of this.closureOfFile(file)) result.add(n);
    }
    return result;
  }

  /** True when `node` sits inside a declaration that belongs to `closure`. */
  isReachable(node: ts.Node, closure: ReadonlySet<ts.Node>): boolean {
    for (let cur: ts.Node | undefined = node; cur; cur = cur.parent) {
      if (closure.has(cur)) return true;
    }
    return false;
  }

  private closureOfFile(file: string): Set<ts.Node> {
    const cached = this.closures.get(file);
    if (cached) return cached;
    const closure = new Set<ts.Node>();
    const queue = [...this.rootsOf(file)];
    while (queue.length > 0) {
      const decl = queue.pop() as ts.Node;
      if (closure.has(decl)) continue;
      closure.add(decl);
      for (const ref of this.refsOf(decl)) if (!closure.has(ref)) queue.push(ref);
    }
    this.closures.set(file, closure);
    return closure;
  }

  private declsOf(symbol: ts.Symbol): ts.Node[] {
    const { checker } = this.project;
    let sym = symbol;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const out: ts.Node[] = [];
    for (const d of sym.declarations ?? []) {
      const n = normalizeDecl(d);
      if (n && this.project.isProjectFile(n.getSourceFile())) out.push(n);
    }
    return out;
  }

  private refsOf(decl: ts.Node): ts.Node[] {
    const cached = this.refs.get(decl);
    if (cached) return cached;
    const { checker } = this.project;
    const out = new Set<ts.Node>();
    const sf = decl.getSourceFile();

    const addSymbol = (sym: ts.Symbol | undefined): void => {
      if (!sym) return;
      for (const n of this.declsOf(sym)) if (n !== decl) out.add(n);
    };

    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isImportEqualsDeclaration(n))
        return;
      if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return;
      if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return;

      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = n.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) {
          const target = this.project.resolve(arg.text, sf.fileName);
          if (target) for (const r of this.importTargets(n, target)) out.add(r);
        }
      } else if (ts.isIdentifier(n)) {
        const p = n.parent;
        if (ts.isShorthandPropertyAssignment(p) && p.name === n) {
          addSymbol(checker.getShorthandAssignmentValueSymbol(p));
          return;
        }
        if (!skipIdentifier(n, p)) addSymbol(checker.getSymbolAtLocation(n));
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(decl);
    const list = [...out];
    this.refs.set(decl, list);
    return list;
  }
}

type Callback = ts.ArrowFunction | ts.FunctionExpression;

/** The callback of `import(...).then(cb)` when the import() result is consumed that way. */
function thenCallback(importCall: ts.CallExpression): Callback | undefined {
  let cur: ts.Node = importCall;
  while (ts.isParenthesizedExpression(cur.parent) || ts.isAwaitExpression(cur.parent))
    cur = cur.parent;
  const access = cur.parent;
  if (!ts.isPropertyAccessExpression(access) || access.expression !== cur) return undefined;
  if (access.name.text !== 'then') return undefined;
  const then = access.parent;
  if (!ts.isCallExpression(then) || then.expression !== access) return undefined;
  const cb = then.arguments[0];
  if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) return cb;
  return undefined;
}

/**
 * Names of the module members a `.then` callback reads from its first parameter, or `'all'` when
 * the parameter is used in a way that cannot be reduced to member names.
 */
function usedMembers(cb: Callback): Set<string> | 'all' {
  const param = cb.parameters[0];
  if (!param) return new Set();
  const names = new Set<string>();
  if (ts.isObjectBindingPattern(param.name)) {
    for (const el of param.name.elements) {
      if (el.dotDotDotToken) return 'all';
      const key = el.propertyName ?? el.name;
      if (ts.isIdentifier(key)) names.add(key.text);
      else return 'all';
    }
    return names;
  }
  if (!ts.isIdentifier(param.name)) return 'all';
  const paramName = param.name.text;
  let escapes = false;
  const visit = (n: ts.Node): void => {
    if (escapes) return;
    if (ts.isIdentifier(n) && n.text === paramName) {
      const p = n.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        names.add(p.name.text);
        return;
      }
      if (ts.isElementAccessExpression(p) && p.expression === n) {
        const arg = p.argumentExpression;
        if (ts.isStringLiteralLike(arg)) {
          names.add(arg.text);
          return;
        }
      }
      if (n === param.name) return;
      // shadowed by a nested declaration with the same name: be conservative
      escapes = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(cb.body);
  return escapes ? 'all' : names;
}

function skipIdentifier(id: ts.Identifier, p: ts.Node): boolean {
  if (ts.isJsxAttribute(p) && p.name === id) return true;
  if (ts.isJsxClosingElement(p)) return true;
  if (
    (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) &&
    p.tagName === id &&
    /^[a-z]/.test(id.text)
  ) {
    return true;
  }
  if (
    (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) &&
    p.name === id
  ) {
    return true;
  }
  if (ts.isBindingElement(p) && p.propertyName === id) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  return (
    (ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isBindingElement(p)) &&
    p.name === id
  );
}

/** Maps a checker declaration to the node whose subtree we walk, or undefined to ignore it. */
export function normalizeDecl(d: ts.Declaration): ts.Node | undefined {
  if (ts.isBindingElement(d)) {
    let cur: ts.Node | undefined = d.parent;
    while (cur && !ts.isVariableDeclaration(cur)) {
      if (ts.isParameter(cur)) return undefined;
      cur = cur.parent;
    }
    return cur;
  }
  if (
    ts.isVariableDeclaration(d) ||
    ts.isFunctionDeclaration(d) ||
    ts.isFunctionExpression(d) ||
    ts.isArrowFunction(d) ||
    ts.isClassDeclaration(d) ||
    ts.isClassExpression(d) ||
    ts.isExportAssignment(d) ||
    ts.isPropertyAssignment(d) ||
    ts.isShorthandPropertyAssignment(d) ||
    ts.isMethodDeclaration(d) ||
    ts.isPropertyDeclaration(d) ||
    ts.isGetAccessorDeclaration(d) ||
    ts.isSetAccessorDeclaration(d) ||
    ts.isModuleDeclaration(d)
  ) {
    return d;
  }
  return undefined;
}
