# unprovided

> Find React hooks that read a Context whose Provider is never mounted on that page.

[한국어](./README.ko.md)

`unprovided` is a static, whole-project check for Next.js apps (App Router and Pages Router) and plain React apps with explicit entries. It is meant to run as a CI gate: **exit 1 when a page can reach `useContext(X)` but can never reach `<X.Provider>`**.

## The problem

A hook that calls `useContext(X)` inside a route whose tree never renders `<X.Provider>` does not throw. It silently receives the `createContext` default value, the UI renders wrong, and nothing in the console tells you why.

**Before** — the provider lives in one route group, a sibling page uses the hook:

```tsx
// src/cart.tsx
export const CartContext = createContext<Cart | undefined>(undefined);
export const CartProvider = ({ children }) => (
  <CartContext.Provider value={useCartState()}>{children}</CartContext.Provider>
);
export const useCart = () => useContext(CartContext);

// app/(shop)/layout.tsx            ← mounts CartProvider
// app/(shop)/cart/page.tsx         ← useCart() works
// app/(marketing)/about/page.tsx   ← useCart() returns undefined, "0 items" forever
```

**After** — `unprovided` fails CI with the exact page, context, consumer and the file where the provider belongs:

```
app/(marketing)/about/page.tsx
  error    CartContext src/cart.tsx:3:14
           read by useCart() src/cart.tsx:9:30  (silent: gets the createContext default)
           mount a Provider in app/layout.tsx

✖ 1 error (3 pages, 5 files, 1 context, 187ms)
```

## What it does / does not do

**Does**

- Discovers every Next.js page and the layouts/templates/`_app` that are always mounted around it.
- Follows imports, re-exports/barrels, `import()`, `next/dynamic(() => import(...))` and `React.lazy`, using the TypeScript compiler API and your `tsconfig.json` (`paths`, `baseUrl`).
- Computes **symbol-level** reachability from each page's default export, not file-level: a helper exported from a module you import does not count unless the page actually references it.
- Reports one finding per (page, context) with severity `error` (consumer silently gets a nullish default), `warning` (consumer throws — it crashes instead of misrendering) or `info` (the context was created with a meaningful default, so consuming it without a Provider may be intentional; never fails).
- Supports third-party context pairs (e.g. `QueryClientProvider` / `useQuery`) through config.

**Does not**

- Check **ordering** inside the tree. If a provider is reachable anywhere in the page's closure — even below the consumer — it is treated as provided. This keeps precision high; tree-order bugs are out of scope.
- Execute code, so conditional rendering is not evaluated: a consumer reached only through a dead branch is still reported, and a provider rendered only conditionally still counts.
- Look inside `node_modules`. Contexts created by libraries are invisible unless declared as `externalContexts`. Workspace packages symlinked into `node_modules` **are** analysed when their real path is inside the resolution boundary — by default the nearest workspace root above `--root` (see `--boundary`).
- Replace an ESLint rule. `eslint-plugin-react` / `@eslint-react` check context value memoization and React 19 syntax; the React Compiler checks hook rules. None of them know which Provider a page mounts — that needs a whole-project view, which is what this tool adds.

## Install & usage

```sh
npx unprovided                 # analyse the Next.js app in the current directory
npx unprovided --root apps/web # another root; the nearest tsconfig.json is used
npx unprovided --json          # machine-readable output
```

Non-Next.js projects and custom wrappers:

```sh
npx unprovided --entry 'src/main.tsx' --always 'src/AppShell.tsx'
```

Monorepo where the page tree lives under a workspace app but providers live in sibling packages: point `--root` at the app. The resolution boundary defaults to the nearest workspace root above it (`pnpm-workspace.yaml`, `package.json` `workspaces`, `lerna.json` or `.git`), so `@acme/ui` symlinked into `apps/web/node_modules` is followed to `packages/ui`:

```sh
npx unprovided --root apps/web                  # boundary auto-detected: the workspace root
npx unprovided --root apps/web --boundary .     # stop at the app itself: workspace packages become external
```

Entries that follow the `app/**/page.*` or `pages/**` convention get their layout / `_app` chain automatically, wherever they are.

An empty input set (no page found, an `--entry` glob that matches nothing) exits 2 so a mistyped `--root` cannot pass CI silently; pass `--allow-empty` to opt back into exit 0.

Requires Node.js 20+. `typescript` is a regular dependency, so nothing else needs to be installed.

## CLI options

All paths and globs given to options are resolved **relative to `--root`**, not to the current directory.

| Option | Description |
| --- | --- |
| `--root <dir>` | Project root (default: current directory). `app/`, `src/app/`, `pages/`, `src/pages/` are discovered here. |
| `--entry <glob>` | Extra entry files (repeatable). Relative to root; a glob that matches nothing is reported as a `note`. |
| `--always <glob>` | Files considered always mounted for every entry (repeatable). Relative to root. |
| `--tsconfig <path>` | `tsconfig.json` to use for `paths` / `baseUrl`. Relative to root (default: nearest one from root upwards). |
| `--config <path>` | Config file. Relative to root (default: `unprovided.config.{json,mjs,js}` in root). |
| `--boundary <dir>` | Directory that bounds module resolution; files outside it are external. Relative to root (default: nearest workspace root at or above root — `pnpm-workspace.yaml`, `package.json` `workspaces`, `lerna.json` or `.git` — else root itself). |
| `--defaulted <level>` | Severity for contexts created with a non-nullish default (`createContext('en')`): `info` (default), `warning`, `error` or `ignore`. |
| `--fail-on <level>` | Exit 1 on `error` (default) or on `warning` too. `info` findings never fail. |
| `--allow-empty` | Exit 0 instead of 2 when no entry is found. |
| `--json` | Print the machine-readable result. |
| `--no-color` | Disable colors (also honours `NO_COLOR`). |
| `-h, --help` / `-v, --version` | Help / version. |

### Config file

`unprovided.config.json` (or `.mjs` with a default export):

```json
{
  "entries": ["src/main.tsx"],
  "always": ["src/AppShell.tsx"],
  "tsconfig": "tsconfig.app.json",
  "boundary": "../..",
  "defaultedContexts": "info",
  "ignore": ["LegacyThemeContext"],
  "externalContexts": [
    {
      "name": "QueryClient",
      "providers": [{ "module": "@tanstack/react-query", "export": "QueryClientProvider" }],
      "consumers": [
        { "module": "@tanstack/react-query", "export": "useQuery" },
        { "module": "@tanstack/react-query", "export": "useMutation", "throws": false }
      ]
    }
  ]
}
```

- `ignore`: context names that are never reported.
- `boundary`: same as `--boundary` (relative to root).
- `defaultedContexts`: same as `--defaulted`; the CLI flag wins.
- `externalContexts`: for contexts created inside `node_modules`, reachability of the listed imported symbols is used instead of `createContext` analysis. `throws` defaults to **`true`** because library hooks typically throw without their provider (severity `warning`); set `throws: false` for a consumer that silently misbehaves (severity `error`). Re-exports through your own barrels (`export { useQuery } from '@tanstack/react-query'`) and namespace imports (`import * as Q`) are followed.
- CLI flags are merged with the config (`--entry` / `--always` add to the config lists; `--tsconfig`, `--boundary`, `--defaulted` win).

### Suppression

```tsx
export function useTheme() {
  // unprovided-ignore-next-line
  return useContext(ThemeContext);
}
```

The comment must be on the line directly above the `useContext` / `use` call (or the `<X.Consumer>` element).

## Output example

Human:

```
app/page.tsx
  error    ThemeContext src/theme.tsx:4:14
           read by useTheme() src/theme.tsx:11:10  (silent: gets the createContext default)
           mount a Provider in app/layout.tsx

app/strict/page.tsx
  warning  ThemeContext src/theme.tsx:4:14
           read by useStrictTheme() src/theme.tsx:15:15  (throws: crashes at render time)
           mount a Provider in app/layout.tsx

app/i18n/page.tsx
  info     LocaleContext src/locale.tsx:2:14
           read by useLocale() src/locale.tsx:3:32  (gets the non-nullish createContext default)
           mount a Provider in app/layout.tsx

✖ 1 error, 1 warning, 1 info (3 pages, 5 files, 2 contexts, 174ms)
```

`--json` (shape is stable across patch releases; paths are relative to `root` with `/` separators — files outside root but inside the boundary start with `../` — positions are 1-based):

```json
{
  "version": "0.1.0",
  "root": "/home/me/acme-shop",
  "boundary": "/home/me/acme-shop",
  "tsconfig": "/home/me/acme-shop/tsconfig.json",
  "pages": [
    { "file": "app/page.tsx", "kind": "app", "chain": ["app/layout.tsx"] },
    { "file": "app/strict/page.tsx", "kind": "app", "chain": ["app/layout.tsx"] }
  ],
  "contexts": [
    {
      "name": "ThemeContext",
      "location": { "file": "src/theme.tsx", "line": 4, "col": 14 },
      "defaultValue": "undefined",
      "external": false
    }
  ],
  "findings": [
    {
      "severity": "error",
      "page": "app/page.tsx",
      "context": {
        "name": "ThemeContext",
        "location": { "file": "src/theme.tsx", "line": 4, "col": 14 },
        "defaultValue": "undefined",
        "external": false
      },
      "consumer": {
        "name": "useTheme",
        "location": { "file": "src/theme.tsx", "line": 11, "col": 10 },
        "kind": "silent"
      },
      "consumers": [
        { "name": "useTheme", "location": { "file": "src/theme.tsx", "line": 11, "col": 10 }, "kind": "silent" }
      ],
      "suggestedMountPoint": "app/layout.tsx",
      "message": "useTheme() reads ThemeContext but no <ThemeContext.Provider> is mounted for this page; it silently gets the createContext default"
    }
  ],
  "diagnostics": [],
  "summary": { "pages": 2, "files": 4, "contexts": 1, "findings": 2, "errors": 1, "warnings": 1, "infos": 0, "durationMs": 174 }
}
```

`kind` of a page is `app` (App Router), `pages` (Pages Router) or `custom` (`--entry`). `suggestedMountPoint` is the nearest layout / `_app` in the page's chain and may not exist yet (then it is where Next.js would pick it up).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No findings at or above `--fail-on` (warnings alone do not fail by default; `info` never fails). |
| `1` | Findings at or above `--fail-on`. |
| `2` | Usage or config error (unknown flag, positional argument, missing root/tsconfig/config, invalid config shape, boundary that does not contain root), or **no entry found** (zero pages and no `--entry` match) unless `--allow-empty`. |

## Programmatic API

```ts
import { analyze, formatHuman, type AnalysisResult } from 'unprovided';

const result: AnalysisResult = await analyze({
  root: 'apps/web',
  entries: ['src/main.tsx'],   // optional
  always: ['src/Shell.tsx'],   // optional
  tsconfig: 'tsconfig.json',   // optional
  boundary: '../..',           // optional (default: nearest workspace root above root)
  defaultedContexts: 'info',   // optional: 'info' | 'warning' | 'error' | 'ignore'
  allowEmpty: false,           // optional: resolve instead of rejecting when no entry is found
  config: { ignore: ['DebugContext'] }, // path | object | false (skip discovery) | undefined (auto)
});

console.log(formatHuman(result, { color: false }));
process.exitCode = result.summary.errors > 0 ? 1 : 0;
```

`analyze` rejects with `ConfigError` for the same situations that make the CLI exit 2 (an empty input set included, unless `allowEmpty`). `loadConfig(root, path?)` and `validateConfig(raw)` are exported too. The CLI is a thin wrapper around this API. Both ESM and CommonJS builds are shipped, each with its own type declarations (`dist/index.d.ts` for `import`, `dist/index.d.cts` for `require`), so TypeScript consumers under `module: node16` / `nodenext` type-check either way.

## How it works

1. **Entries.** App Router: every `app/**/page.{tsx,jsx,ts,js}` and `src/app/**/page.*`; its always-mounted chain is every `layout.*` and `template.*` in the ancestor directories up to the `app` root (route groups `(name)`, parallel `@slot` and intercepting segments are plain directories). Pages Router: `pages/**/*.{tsx,jsx,ts,js}` and `src/pages/**` minus `_app`, `_document`, `_error` and `api/**`; chain = `pages/_app.*`. The route trees are walked skipping only `node_modules`, `.git` and `.next`, so a route segment named `build`, `dist`, `out` or `coverage` is a page like any other (those names are skipped only while expanding `--entry` / `--always` globs). `--entry` files following either convention are classified the same way; anything else is `custom` with `--always` as its chain.
2. **Program.** One TypeScript `Program` is built from the entries and chains. Imports are resolved with `ts.resolveModuleName` using the nearest (or `--tsconfig`) `tsconfig.json`, so `paths` / `baseUrl` work. Resolution stops at the **boundary**: a module whose real path is outside it, or anywhere under a real `node_modules` directory, is dropped. The boundary defaults to the nearest workspace root at or above `--root` (`pnpm-workspace.yaml`, `package.json` `workspaces`, `lerna.json`, `.git`), so workspace packages symlinked into an app's `node_modules` resolve to their real path inside the workspace and are analysed; `--boundary` overrides it. `@types/*` and type reference directives are never loaded.
3. **Facts** are extracted from every project file:
   - contexts: variables initialised by `createContext(...)` / `React.createContext(...)`, with the default value classified as `undefined`, `null` or `other`;
   - consumers: `useContext(C)`, `React.useContext(C)`, `use(C)`, `<C.Consumer>`, plus `createElement(C.Consumer)`; classified `throws` when the enclosing function guards the value with a throw (`if (!x) throw`, `if (x === undefined) throw`, `if (x == null) throw`, `typeof x === 'undefined'`, `invariant(x)` / `assert*(x)`, `x ?? invariant(...)`, `x ?? (() => { throw })()`), otherwise `silent`;
   - providers: JSX `<C.Provider>`, `<C>` (React 19), a variable alias such as `const P = C.Provider`, and `createElement(C.Provider, …)` / `jsx(C.Provider, …)`.
4. **Reachability** is symbol-level. Starting from a file's default export, the body of each reachable declaration is walked; every identifier is resolved through the checker (import aliases and re-exports resolved), and the resulting declarations (functions, variables, classes, object properties, `export default` expressions) are added to the closure. An `import('./x')` call site contributes only what it uses: `import('./x').then(m => m.A)` and `.then(({ A }) => …)` add the export `A` alone (`m.default` is the default export); `dynamic(() => import('./x'))`, `lazy(() => import('./x'))` and any other bare `import('./x')` add the default export when there is one, otherwise **every export** of `x`; the same "every export" fallback applies when the `.then` callback lets the module object escape (`.then(m => helper(m))`, `.then(m => m)`). Non-exported declarations of `x` never enter through an `import()`. Only entry and `--always` files without a default export use the whole file as their root.
5. **Verdict** per (page, context): some consumer reachable from the page ∪ its chain, and no provider reachable from the same closure → finding. Severity is `error` when any reachable consumer is `silent`, `warning` when every reachable consumer throws — unless the context was created with a non-nullish default (`createContext('en')`, `createContext(false)`, `createContext(defaults)`), which is reported at the `defaultedContexts` level (`info` by default, so it is shown but never fails; `warning`, `error` or `ignore` on request).

### Design choices (precision over recall)

Each of these is deliberate; the reasoning is in plain words so you can decide whether it fits your codebase.

- **Route directories are never treated as build output.** `app/build/page.tsx` is the page for `/build`. The `build` / `dist` / `out` / `coverage` skip list only applies while expanding `--entry` / `--always` globs; the App Router and Pages Router trees are walked with only `node_modules`, `.git` and `.next` skipped.
- **`import()` contributes the members it uses, never the whole file.** `import('./x').then(m => m.X)` reaches `X` only, so an exported sibling component in `x` that happens to mount the Provider does not make the page "provided". A bare `import('./x')` on a module without a default export falls back to every *exported* declaration, never to private ones.
- **A meaningful default is a signal, not a bug.** `createContext('en')` or `createContext(false)` says "consuming without a Provider is fine". Those contexts are reported as `info`: visible in the report and in `--json`, never failing the exit code. Raise them with `--defaulted warning|error` or drop them with `--defaulted ignore`. `error` stays reserved for a nullish default (`undefined` / `null` / no argument) read by a silent consumer, `warning` for a throwing consumer.
- **The resolution boundary is the workspace, not `--root`.** When `--root` is an app inside a monorepo, sibling workspace packages symlinked into `node_modules` are followed to their real path, because that is where most Providers live. Anything under a real `node_modules` directory is still external. `--boundary` narrows or widens this; a boundary that does not contain root is a config error.
- **Library consumers are assumed to throw.** `externalContexts` consumers default to `throws: true` (severity `warning`) because `useQuery`, `useTheme`-style library hooks almost always throw without their provider. Set `throws: false` to get `error` for a library hook that silently misbehaves.
- **Pages Router entries include `.ts` / `.js`.** A `pages/foo.ts` file is a route in Next.js, so it is an entry here too (`api/**`, `_app`, `_document`, `_error` excluded).
- **An empty input set is an error.** Zero pages and no `--entry` match exit 2, so a mistyped `--root` or glob cannot pass CI silently. `--allow-empty` restores exit 0; a glob that matches nothing is always reported as a `note`.
- **Paths in options are root-relative.** `--config`, `--tsconfig`, `--boundary`, `--entry` and `--always` are resolved against `--root`, not the current directory, so the same command works from any cwd.
- A provider reachable **anywhere** in the closure counts, even if it is rendered below the consumer or only conditionally.
- Destructuring a nullish default (`const { a } = useContext(C)`) crashes with a `TypeError`, but that is an accident rather than a guard, so it is reported as `error`, not `warning`.
- Only `const P = C.Provider` style aliases are recognised; `const { Provider } = C` is not.
- Class components using `static contextType` / `this.context` are not treated as consumers.
- External contexts re-exported through `export * from 'lib'` barrels are not traced (named re-exports are).

### Known false positives

- Consumers reachable only through code that never runs on that page (feature-flagged branches, props that are never passed, platform-specific helpers).
- **Optional-context hooks**: a hook that reads a nullish-default context and deliberately returns `undefined` so a component can work with or without its parent (`RadioGroup` / `Radio`, `Accordion` / `AccordionItem`) is indistinguishable from a bug. Use `// unprovided-ignore-next-line` on the call or list the context in `ignore`.
- Providers mounted outside the analysed tree: a host application, a micro-frontend shell, a test harness, or a `--boundary` that excludes the package mounting the provider. Use `--always`, a wider `--boundary`, or `ignore`.
- Providers created through a factory (`createSafeContext()`-style helpers) are invisible to the `createContext` scan; declare them as `externalContexts` if the factory lives in a package, or ignore the context.
- A provider selected by a runtime `switch` / lookup table counts as mounted on every branch (conditional rendering is not evaluated).

### Known false negatives

- Contexts consumed via `static contextType`, `this.context`, `const { Provider } = C`, or a custom `createContext` wrapper.
- Providers or consumers reached only through `require()`, string-built dynamic imports, or `export * from` barrels of third-party modules.
- `import()` approximations: a bare `import('./x')` of a module without a default export, or a `.then` callback where the module object escapes (`.then(m => helper(m))`), adds **every export** of `x`; a Provider in an unrelated export of that module then suppresses a real finding. `.then(m => m[name])` with a computed name is treated the same way.
- Contexts created with a non-nullish default are `info` by default, so with `--fail-on error` a genuinely missing Provider for such a context does not fail CI. Use `--defaulted error` if your codebase never relies on context defaults.
- Tree-order mistakes (consumer above its provider) are never reported.

## Roadmap

- App Router `loading.*`, `error.*`, `not-found.*` and `default.*` files as additional entries.
- `static contextType` / `this.context` consumers.
- Optional tree-order check (consumer rendered above its provider) behind a flag.
- Watch mode and an ESLint-formatter-compatible reporter.
- Incremental analysis for large monorepos.
- Run `@arethetypeswrong/cli` against the packed tarball in CI.

## Development & Release

```sh
pnpm install
pnpm lint        # biome
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup: dist/index.{js,cjs,d.ts}, dist/cli.js
pnpm test        # builds, then vitest (fixtures under test/fixtures, one e2e spawns dist/cli.js)
npm pack --dry-run
```

Release: bump `version` in `package.json`, update `CHANGELOG.md`, commit, then

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The `Release` GitHub Action builds, tests and publishes to npm with provenance using npm **trusted publishing**: the workflow authenticates through its GitHub OIDC identity, so no npm token is stored anywhere. **Publish only through this tag → GitHub Actions flow; never run `npm publish` locally.** `publishConfig.registry` is pinned to `https://registry.npmjs.org/` so a machine whose `.npmrc` points at a private registry cannot publish there by accident. `v*` tags are protected by a repository ruleset: only the repository admin can create them, so a collaborator's write access cannot trigger a release.

## License

MIT
