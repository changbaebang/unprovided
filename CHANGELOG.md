# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- App Router `loading.*`, `error.*`, `not-found.*` and `default.*` files are entries with the same
  layout/template chain as a page in their directory; `global-error.*` is an entry with an empty
  chain. Parallel `@slot` and intercepting `(.)`/`(..)`/`(...)` segments stay plain directories
  (documented and covered by the `app-router-conventions` fixture).
- Pages Router `Page.getLayout = (page) => <Layout>{page}</Layout>`: the module-level `getLayout`
  assignment on the default export is part of the page's root, so Providers mounted there count.
- Class-component consumers: `static contextType = C` and `Class.contextType = C` are `silent`
  consumers named after the class (`<C.Consumer>` was already detected).
- `jsconfig.json` is used when no `tsconfig.json` is found (walking up from root, a `jsconfig.json`
  next to root wins over a `tsconfig.json` above it), so JavaScript projects get their `paths`.
- Preflight diagnostics, so a wrong setup can no longer produce a silent "0 findings" run:
  - the no-entries error (exit 2) now says where it looked, what exists instead, lists nested
    Next.js apps when `--root` is a monorepo root (`run once per app: unprovided --root apps/web`)
    and shows the `--entry`/`--always` recipe;
  - tsconfig problems the TypeScript parser reports (unknown compiler option from a newer
    TypeScript, invalid value, missing `extends` target) are `note tsconfig: … (TSxxxx, ignored)`
    diagnostics and the run continues; an unparseable tsconfig exits 2 with
    `tsconfig: cannot parse <file>: <message>`;
  - a root tsconfig that only holds `references` and no `paths`/`baseUrl` (Vite template) gets a
    `note tsconfig: … only references other configs` pointing at `--tsconfig`;
  - relative / alias imports (`./x`, `@/x`, `~/x`, `#x`) that resolve to no file are counted and
    reported as `note unresolved imports: N … (examples)`.
- `unprovided --env` (also `--env --json`) prints versions, root, boundary, config, tsconfig,
  router directories, entry counts, `--always` files and the notes above, exiting 2 under the same
  no-entries condition as a run; `inspectEnvironment()` / `formatEnvironment()` are exported.
- README: "Requirements & compatibility" section with the support matrix (Next.js App Router and
  Pages Router file kinds, React 18/19 syntax, class components, non-Next.js recipes for
  Vite/CRA/Remix/Expo Router, tsconfig features, monorepo boundary, Node versions, Windows
  untested), "What is detected / not detected", "How it fails" with every exit-2 message and note
  prefix, and the `--env` example. Known false negatives updated to match.
- CI matrix now includes Node 24.

### Changed

- `summary.pages` and `pages[]` include the new App Router entry kinds, so counts grow on projects
  that have `loading`/`error`/`not-found`/`default` files.
- The "no tsconfig found" note now reads `no tsconfig.json or jsconfig.json found; using default
  compiler options (path aliases will not resolve)`.

## [0.1.0] - 2026-09-15

### Added

- Static whole-project check for React Contexts consumed on a page whose tree never mounts the
  matching Provider.
- Entry discovery for Next.js App Router (`app/**/page.*`, `src/app/**/page.*` with their
  `layout.*` / `template.*` chain, route groups included) and Pages Router (`pages/**`,
  `src/pages/**` with `_app.*`; `_document`, `_error` and `api/**` excluded). Pages Router entries
  include `.ts` / `.js` files, since Next.js routes them too.
- Route trees are walked skipping only `node_modules`, `.git` and `.next`: a route segment named
  `build`, `dist`, `out` or `coverage` (`app/build/page.tsx`) is analysed like any other page. The
  wider skip list only applies while expanding `--entry` / `--always` globs.
- `--entry` / `--always` globs for non-Next.js projects and custom wrappers; entries that follow
  the Next.js conventions get their chain automatically. A glob that matches nothing is reported
  as a `note` diagnostic.
- Symbol-level reachability through the TypeScript compiler API: imports, re-exports/barrels,
  `import()`, `next/dynamic(() => import(...))`, `React.lazy`, `tsconfig.json` `paths` / `baseUrl`.
- `import()` contributes only the members the call site uses: `import('./x').then(m => m.X)` and
  `.then(({ X }) => …)` reach `X` alone; a bare `import('./x')` reaches the default export, or
  every *exported* declaration when there is none. Private declarations of `x` never enter through
  an `import()`; the whole-file root is reserved for entry / `--always` files without a default
  export.
- Monorepo resolution boundary: workspace packages symlinked into an app's `node_modules` are
  followed to their real path when `--root` is an app inside a workspace. The boundary defaults to
  the nearest workspace root at or above root (`pnpm-workspace.yaml`, `package.json` `workspaces`,
  `lerna.json`, `.git`); `--boundary <dir>` / config `boundary` override it, and a boundary that
  does not contain root is a config error. The JSON result carries `boundary`.
- Consumer detection for `useContext`, `React.useContext`, `use`, `<C.Consumer>`; provider
  detection for `<C.Provider>`, React 19 `<C>`, `const P = C.Provider` aliases and
  `createElement` / `jsx` calls.
- Severity: `error` for silent consumers of a nullish-default context, `warning` for consumers
  guarded by a throw, and `info` for contexts created with a meaningful non-nullish default
  (`createContext('en')`, `createContext(false)`). `info` findings are shown but never fail; the
  level is configurable with `--defaulted <info|warning|error|ignore>` / config
  `defaultedContexts`. The summary carries `infos`.
- `externalContexts` config for library provider/consumer pairs (`throws` defaults to `true`,
  severity `warning`; `throws: false` yields `error`), `ignore` config, and
  `// unprovided-ignore-next-line` suppression.
- CLI with `--json`, `--fail-on`, `--no-color`, `--allow-empty`, exit codes 0/1/2; an empty input
  set (no page found, no `--entry` match, or a positional path) exits 2 unless `--allow-empty`.
  `--config`, `--tsconfig`, `--boundary`, `--entry` and `--always` are resolved relative to
  `--root`.
- Programmatic `analyze()` and `formatHuman()` API (ESM + CommonJS), each build with its own type
  declarations (`dist/index.d.ts` for `import`, `dist/index.d.cts` for `require`) so CommonJS
  TypeScript consumers under `module: node16` / `nodenext` type-check.
- `package.json`: `bin` without a leading `./`, and `publishConfig.registry` pinned to
  `https://registry.npmjs.org/` so a machine whose `.npmrc` points at a private registry cannot
  publish there by accident. Releases go only through the tag → GitHub Actions flow.
