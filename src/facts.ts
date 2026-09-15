import ts from 'typescript';
import type { ProjectProgram } from './program.js';
import type { ConsumerKind, DefaultValueKind, ExternalContextConfig } from './types.js';

export interface ContextFact {
  key: string;
  name: string;
  external: boolean;
  /** The `createContext` variable declaration (null for external contexts). */
  decl: ts.VariableDeclaration | null;
  defaultValue: DefaultValueKind;
}

export interface UsageFact {
  contextKey: string;
  /** The call, JSX tag or identifier where the usage happens. */
  node: ts.Node;
  sf: ts.SourceFile;
  /** Name of the enclosing function (component/hook), or `<module>`. */
  fnName: string;
  /** Consumers only. */
  kind: ConsumerKind;
  /** Consumers only: suppressed with `// unprovided-ignore-next-line`. */
  ignored: boolean;
}

export interface Facts {
  contexts: Map<string, ContextFact>;
  consumers: UsageFact[];
  providers: UsageFact[];
}

const IGNORE_RE = /unprovided-ignore-next-line/;
const ASSERT_CALLEE_RE = /^(invariant|assert)/i;
const THROWING_CALLEE_RE = /^(invariant|assert|throw|fail|panic|raise|missing)/i;

type Fn =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.ConstructorDeclaration;

function isFn(n: ts.Node): n is Fn {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isConstructorDeclaration(n)
  );
}

export function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isTypeAssertionExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

function enclosingFunction(node: ts.Node): Fn | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (isFn(cur)) return cur;
    cur = cur.parent;
  }
  return undefined;
}

/** Best-effort display name for a function: declaration name, owning variable, property or `default`. */
export function functionName(fn: Fn): string {
  if (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) {
    if (fn.name) return fn.name.text;
  }
  if (
    ts.isMethodDeclaration(fn) ||
    ts.isGetAccessorDeclaration(fn) ||
    ts.isConstructorDeclaration(fn)
  ) {
    const own = ts.isConstructorDeclaration(fn) ? 'constructor' : fn.name.getText();
    const cls = fn.parent;
    const clsName =
      (ts.isClassDeclaration(cls) || ts.isClassExpression(cls)) && cls.name
        ? cls.name.text
        : undefined;
    return clsName ? `${clsName}.${own}` : own;
  }
  let cur: ts.Node | undefined = fn.parent;
  while (cur) {
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isPropertyAssignment(cur)) return cur.name.getText();
    if (ts.isPropertyDeclaration(cur)) return cur.name.getText();
    if (ts.isExportAssignment(cur)) return 'default';
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (
      ts.isCallExpression(cur) ||
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isSatisfiesExpression(cur)
    ) {
      cur = cur.parent;
      continue;
    }
    break;
  }
  return '<anonymous>';
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name))
    return callee.name.text;
  return undefined;
}

function isCreateContextCall(init: ts.Expression): init is ts.CallExpression {
  const e = unwrap(init);
  return ts.isCallExpression(e) && calleeName(e) === 'createContext';
}

function defaultValueKind(call: ts.CallExpression): DefaultValueKind {
  const arg = call.arguments[0];
  if (!arg) return 'undefined';
  const e = unwrap(arg);
  if (ts.isIdentifier(e) && e.text === 'undefined') return 'undefined';
  if (e.kind === ts.SyntaxKind.NullKeyword) return 'null';
  if (ts.isVoidExpression(e)) return 'undefined';
  return 'other';
}

/** True when the line right above `node` carries `unprovided-ignore-next-line`. */
export function hasIgnoreComment(node: ts.Node, sf: ts.SourceFile): boolean {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  if (line === 0) return false;
  const starts = sf.getLineStarts();
  const prev = sf.text.slice(starts[line - 1], starts[line]);
  return IGNORE_RE.test(prev);
}

/**
 * Classifies a `useContext(C)` / `use(C)` call as "throws" when the enclosing function guards the
 * result against undefined/null with a throw (`if (!x) throw`, `if (x === undefined) throw`,
 * `invariant(x)`, `x ?? invariant(...)`). Everything else is "silent".
 */
export function classifyConsumer(call: ts.CallExpression, fn: Fn | undefined): ConsumerKind {
  let varName: string | undefined;
  let holder: ts.Node = call;
  while (
    holder.parent &&
    (ts.isParenthesizedExpression(holder.parent) ||
      ts.isAsExpression(holder.parent) ||
      ts.isNonNullExpression(holder.parent) ||
      ts.isSatisfiesExpression(holder.parent))
  ) {
    holder = holder.parent;
  }
  if (
    holder.parent &&
    ts.isVariableDeclaration(holder.parent) &&
    ts.isIdentifier(holder.parent.name)
  ) {
    varName = holder.parent.name.text;
  }

  const refersTo = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    if (u === call) return true;
    return varName !== undefined && ts.isIdentifier(u) && u.text === varName;
  };
  const mentions = (e: ts.Node): boolean => {
    if (ts.isExpression(e) && refersTo(e)) return true;
    let found = false;
    e.forEachChild((c) => {
      if (!found && mentions(c)) found = true;
    });
    return found;
  };
  const isUndefinedLike = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    return (
      (ts.isIdentifier(u) && u.text === 'undefined') ||
      u.kind === ts.SyntaxKind.NullKeyword ||
      ts.isVoidExpression(u)
    );
  };
  const isNullishCheck = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    if (ts.isPrefixUnaryExpression(u) && u.operator === ts.SyntaxKind.ExclamationToken)
      return refersTo(u.operand);
    if (ts.isBinaryExpression(u)) {
      const op = u.operatorToken.kind;
      if (op === ts.SyntaxKind.BarBarToken)
        return isNullishCheck(u.left) || isNullishCheck(u.right);
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) {
        if (refersTo(u.left) && isUndefinedLike(u.right)) return true;
        if (refersTo(u.right) && isUndefinedLike(u.left)) return true;
        const typeofSide = [u.left, u.right].map(unwrap).find(ts.isTypeOfExpression);
        const strSide = [u.left, u.right].map(unwrap).find(ts.isStringLiteral);
        if (
          typeofSide &&
          strSide &&
          strSide.text === 'undefined' &&
          refersTo(typeofSide.expression)
        )
          return true;
      }
    }
    return false;
  };
  const containsThrow = (s: ts.Statement): boolean => {
    if (ts.isThrowStatement(s)) return true;
    if (ts.isBlock(s)) return s.statements.some((st) => ts.isThrowStatement(st));
    return false;
  };
  const isThrowingExpr = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    if (ts.isCallExpression(u)) {
      const name = calleeName(u);
      if (name && THROWING_CALLEE_RE.test(name)) return true;
      // IIFE that throws: (() => { throw ... })()
      const callee = unwrap(u.expression);
      if ((ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) && callee.body) {
        return ts.isBlock(callee.body) && callee.body.statements.some(ts.isThrowStatement);
      }
    }
    return false;
  };

  let throws = false;
  const scope: ts.Node = fn ?? call.getSourceFile();
  const visit = (n: ts.Node): void => {
    if (throws) return;
    if (n !== scope && isFn(n)) return; // nested functions are separate consumers/guards
    if (ts.isIfStatement(n) && isNullishCheck(n.expression) && containsThrow(n.thenStatement)) {
      throws = true;
      return;
    }
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      const first = n.arguments[0];
      if (name && ASSERT_CALLEE_RE.test(name) && first && mentions(first)) {
        throws = true;
        return;
      }
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      refersTo(n.left) &&
      isThrowingExpr(n.right)
    ) {
      throws = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return throws ? 'throws' : 'silent';
}

interface ExternalRole {
  ctxKey: string;
  role: 'provider' | 'consumer';
  throws: boolean;
}

function moduleSpecifierOf(decl: ts.Declaration): { module: string; imported: string } | undefined {
  if (ts.isImportSpecifier(decl)) {
    const spec = decl.parent.parent.parent.moduleSpecifier;
    return ts.isStringLiteral(spec)
      ? { module: spec.text, imported: (decl.propertyName ?? decl.name).text }
      : undefined;
  }
  if (ts.isImportClause(decl)) {
    const spec = decl.parent.moduleSpecifier;
    return ts.isStringLiteral(spec) ? { module: spec.text, imported: 'default' } : undefined;
  }
  if (ts.isNamespaceImport(decl)) {
    const spec = decl.parent.parent.moduleSpecifier;
    return ts.isStringLiteral(spec) ? { module: spec.text, imported: '*' } : undefined;
  }
  if (ts.isExportSpecifier(decl)) {
    const spec = decl.parent.parent.moduleSpecifier;
    if (spec && ts.isStringLiteral(spec)) {
      return { module: spec.text, imported: (decl.propertyName ?? decl.name).text };
    }
  }
  return undefined;
}

export function extractFacts(
  project: ProjectProgram,
  external: readonly ExternalContextConfig[],
): Facts {
  const { checker } = project;
  const files = project.projectFiles();
  const contexts = new Map<string, ContextFact>();
  const byDecl = new Map<ts.Node, ContextFact>();
  /** `const P = Ctx.Provider` / `const C = Ctx.Consumer` aliases, keyed by their declaration. */
  const aliasByDecl = new Map<ts.Node, { fact: ContextFact; role: 'provider' | 'consumer' }>();
  const consumers: UsageFact[] = [];
  const providers: UsageFact[] = [];

  // --- pass A: createContext declarations --------------------------------------------------
  for (const sf of files) {
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.initializer && isCreateContextCall(n.initializer)) {
        const call = unwrap(n.initializer) as ts.CallExpression;
        const name = ts.isIdentifier(n.name) ? n.name.text : '<anonymous>';
        const key = `${sf.fileName}:${n.getStart(sf)}:${name}`;
        const fact: ContextFact = {
          key,
          name,
          external: false,
          decl: n,
          defaultValue: defaultValueKind(call),
        };
        contexts.set(key, fact);
        byDecl.set(n, fact);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // --- external contexts (config driven) ---------------------------------------------------
  const extModules = new Map<string, Map<string, ExternalRole>>();
  for (const ext of external) {
    const key = `external:${ext.name}`;
    contexts.set(key, { key, name: ext.name, external: true, decl: null, defaultValue: 'unknown' });
    const add = (
      ref: { module: string; export: string; throws?: boolean },
      role: 'provider' | 'consumer',
    ) => {
      let m = extModules.get(ref.module);
      if (!m) {
        m = new Map();
        extModules.set(ref.module, m);
      }
      m.set(ref.export, { ctxKey: key, role, throws: ref.throws !== false });
    };
    for (const p of ext.providers) add(p, 'provider');
    for (const c of ext.consumers) add(c, 'consumer');
  }

  // Candidate local names that may (transitively) alias a configured external export.
  const candidates = new Set<string>();
  const nsCandidates = new Set<string>();
  if (extModules.size > 0) {
    const renames: Array<[string, string]> = [];
    for (const sf of files) {
      for (const st of sf.statements) {
        if (
          ts.isImportDeclaration(st) &&
          ts.isStringLiteral(st.moduleSpecifier) &&
          st.importClause
        ) {
          const mod = st.moduleSpecifier.text;
          const ext = extModules.get(mod);
          const clause = st.importClause;
          if (clause.name) {
            if (ext?.has('default')) candidates.add(clause.name.text);
            else renames.push(['default', clause.name.text]);
          }
          if (clause.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) {
              if (ext) nsCandidates.add(clause.namedBindings.name.text);
            } else {
              for (const el of clause.namedBindings.elements) {
                const imported = (el.propertyName ?? el.name).text;
                if (ext?.has(imported)) candidates.add(el.name.text);
                else renames.push([imported, el.name.text]);
              }
            }
          }
        } else if (
          ts.isExportDeclaration(st) &&
          st.exportClause &&
          ts.isNamedExports(st.exportClause)
        ) {
          const mod =
            st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
              ? st.moduleSpecifier.text
              : undefined;
          const ext = mod ? extModules.get(mod) : undefined;
          for (const el of st.exportClause.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (ext?.has(imported)) candidates.add(el.name.text);
            else renames.push([imported, el.name.text]);
          }
        }
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [from, to] of renames) {
        if (candidates.has(from) && !candidates.has(to)) {
          candidates.add(to);
          changed = true;
        }
      }
    }
  }

  const traceExternal = (sym: ts.Symbol | undefined): ExternalRole | undefined => {
    let cur = sym;
    for (let i = 0; cur && i < 32; i++) {
      if (!(cur.flags & ts.SymbolFlags.Alias)) return undefined;
      const decl = cur.declarations?.[0];
      if (decl) {
        const ref = moduleSpecifierOf(decl);
        if (ref) {
          const role = extModules.get(ref.module)?.get(ref.imported);
          if (role) return role;
        }
      }
      const next = checker.getImmediateAliasedSymbol(cur);
      if (!next || next === cur) return undefined;
      cur = next;
    }
    return undefined;
  };

  // --- helpers ------------------------------------------------------------------------------
  const resolveContext = (expr: ts.Expression): ContextFact | undefined => {
    const e = unwrap(expr);
    let id: ts.Node | undefined;
    if (ts.isIdentifier(e)) id = e;
    else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) id = e.name;
    else if (ts.isJsxNamespacedName(e)) return undefined;
    if (!id) return undefined;
    let sym = checker.getSymbolAtLocation(id);
    if (!sym) return undefined;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    for (const d of sym.declarations ?? []) {
      const fact = byDecl.get(d);
      if (fact) return fact;
    }
    return undefined;
  };

  /** Resolves `Ctx.Provider`/`Ctx.Consumer`, an alias variable of either, or `Ctx` itself (React 19). */
  const resolveRole = (
    expr: ts.Expression,
  ): { fact: ContextFact; role: 'provider' | 'consumer' } | undefined => {
    const e = unwrap(expr);
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
      if (e.name.text === 'Provider' || e.name.text === 'Consumer') {
        const fact = resolveContext(e.expression);
        return fact
          ? { fact, role: e.name.text === 'Provider' ? 'provider' : 'consumer' }
          : undefined;
      }
    }
    let id: ts.Node | undefined;
    if (ts.isIdentifier(e)) id = e;
    else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) id = e.name;
    if (!id) return undefined;
    let sym = checker.getSymbolAtLocation(id);
    if (!sym) return undefined;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    for (const d of sym.declarations ?? []) {
      const alias = aliasByDecl.get(d);
      if (alias) return alias;
      const fact = byDecl.get(d);
      if (fact) return { fact, role: 'provider' };
    }
    return undefined;
  };

  // --- pass A2: `const P = Ctx.Provider` aliases (may live in another file than the context) --
  for (const sf of files) {
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const init = unwrap(n.initializer);
        if (
          ts.isPropertyAccessExpression(init) &&
          ts.isIdentifier(init.name) &&
          (init.name.text === 'Provider' || init.name.text === 'Consumer')
        ) {
          const fact = resolveContext(init.expression);
          if (fact)
            aliasByDecl.set(n, {
              fact,
              role: init.name.text === 'Provider' ? 'provider' : 'consumer',
            });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const record = (
    list: UsageFact[],
    fact: ContextFact,
    node: ts.Node,
    sf: ts.SourceFile,
    kind: ConsumerKind,
    ignorable: boolean,
  ): void => {
    const fn = enclosingFunction(node);
    list.push({
      contextKey: fact.key,
      node,
      sf,
      fnName: fn ? functionName(fn) : '<module>',
      kind,
      ignored: ignorable && hasIgnoreComment(node, sf),
    });
  };

  const recordExternal = (role: ExternalRole, node: ts.Node, sf: ts.SourceFile): void => {
    const fact = contexts.get(role.ctxKey);
    if (!fact) return;
    if (role.role === 'provider') record(providers, fact, node, sf, 'silent', false);
    else record(consumers, fact, node, sf, role.throws ? 'throws' : 'silent', true);
  };

  /** `C.Provider` / alias / `C` (React 19) → provider; `C.Consumer` / alias → consumer. */
  const classifyTag = (
    tag: ts.JsxTagNameExpression | ts.Expression,
  ): { fact: ContextFact; role: 'provider' | 'consumer' } | undefined => {
    if (ts.isJsxNamespacedName(tag)) return undefined;
    if (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) return undefined; // intrinsic element
    return resolveRole(tag);
  };

  // --- pass B: usages -----------------------------------------------------------------------
  for (const sf of files) {
    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isImportEqualsDeclaration(n))
        return;
      if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return;
      if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return;

      if (ts.isCallExpression(n)) {
        const name = calleeName(n);
        const first = n.arguments[0];
        if ((name === 'useContext' || name === 'use') && n.arguments.length === 1 && first) {
          const fact = resolveContext(first);
          if (fact) record(consumers, fact, n, sf, classifyConsumer(n, enclosingFunction(n)), true);
        } else if (
          (name === 'createElement' || name === 'jsx' || name === 'jsxs' || name === 'jsxDEV') &&
          first
        ) {
          const hit = classifyTag(first);
          if (hit) {
            if (hit.role === 'provider') record(providers, hit.fact, n, sf, 'silent', false);
            else record(consumers, hit.fact, n, sf, 'silent', true);
          }
        }
      } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const hit = classifyTag(n.tagName);
        if (hit) {
          if (hit.role === 'provider') record(providers, hit.fact, n, sf, 'silent', false);
          else record(consumers, hit.fact, n, sf, 'silent', true);
        }
      }

      if (extModules.size > 0) {
        if (ts.isIdentifier(n) && candidates.has(n.text) && !isDeclarationName(n)) {
          const role = traceExternal(checker.getSymbolAtLocation(n));
          if (role) recordExternal(role, n, sf);
        } else if (
          ts.isPropertyAccessExpression(n) &&
          ts.isIdentifier(n.expression) &&
          nsCandidates.has(n.expression.text) &&
          ts.isIdentifier(n.name)
        ) {
          const nsSym = checker.getSymbolAtLocation(n.expression);
          const nsDecl = nsSym?.declarations?.[0];
          const ref = nsDecl ? moduleSpecifierOf(nsDecl) : undefined;
          const role =
            ref && ref.imported === '*' ? extModules.get(ref.module)?.get(n.name.text) : undefined;
          if (role) recordExternal(role, n, sf);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  return { contexts, consumers, providers };
}

function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (ts.isJsxAttribute(p) && p.name === id) return true;
  if (ts.isJsxClosingElement(p)) return true;
  if (
    (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) &&
    p.name === id
  )
    return true;
  if (ts.isBindingElement(p) && p.propertyName === id) return true;
  return (
    (ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isClassDeclaration(p) ||
      ts.isImportSpecifier(p) ||
      ts.isExportSpecifier(p) ||
      ts.isImportClause(p) ||
      ts.isNamespaceImport(p)) &&
    p.name === id
  );
}
