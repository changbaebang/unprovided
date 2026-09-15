# unprovided

> 해당 페이지에서 Provider 가 한 번도 마운트되지 않는 Context 를 읽는 React 훅을 찾아냅니다.

[English](./README.md)

`unprovided` 는 Next.js 앱(App Router · Pages Router)과 엔트리를 명시한 일반 React 앱을 대상으로 하는 **정적 · 프로젝트 전체** 검사 도구입니다. CI 게이트로 쓰도록 만들었습니다: **페이지가 `useContext(X)` 에는 도달하는데 `<X.Provider>` 에는 절대 도달할 수 없으면 exit 1**.

## 문제

`<X.Provider>` 를 렌더하지 않는 라우트 트리 안에서 `useContext(X)` 를 호출하는 훅은 예외를 던지지 않습니다. `createContext` 기본값을 조용히 받아 UI 가 잘못 렌더되고, 콘솔에는 아무 단서도 남지 않습니다.

**Before** — Provider 는 한 라우트 그룹에만 있고, 형제 페이지가 훅을 씁니다:

```tsx
// src/cart.tsx
export const CartContext = createContext<Cart | undefined>(undefined);
export const CartProvider = ({ children }) => (
  <CartContext.Provider value={useCartState()}>{children}</CartContext.Provider>
);
export const useCart = () => useContext(CartContext);

// app/(shop)/layout.tsx            ← CartProvider 마운트
// app/(shop)/cart/page.tsx         ← useCart() 정상 동작
// app/(marketing)/about/page.tsx   ← useCart() 가 undefined, 영원히 "0 items"
```

**After** — `unprovided` 가 페이지 · 컨텍스트 · 소비자 · Provider 를 둘 파일까지 짚어 CI 를 실패시킵니다:

```
app/(marketing)/about/page.tsx
  error    CartContext src/cart.tsx:3:14
           read by useCart() src/cart.tsx:9:30  (silent: gets the createContext default)
           mount a Provider in app/layout.tsx

✖ 1 error (3 pages, 5 files, 1 context, 187ms)
```

## 하는 일 / 하지 않는 일

**하는 일**

- 모든 Next.js 페이지와, 그 페이지를 항상 감싸는 layout / template / `_app` 을 찾아냅니다.
- TypeScript 컴파일러 API 와 `tsconfig.json`(`paths`, `baseUrl`)을 사용해 import, 재수출(barrel), `import()`, `next/dynamic(() => import(...))`, `React.lazy` 를 따라갑니다.
- 파일 단위가 아니라 **심볼 단위** 도달성을 계산합니다: import 한 모듈이 export 하는 헬퍼라도 페이지가 실제로 참조하지 않으면 도달한 것으로 치지 않습니다.
- (페이지, 컨텍스트) 쌍마다 하나의 결과를 보고합니다. 심각도는 `error`(소비자가 nullish 기본값을 조용히 받음), `warning`(소비자가 throw — 잘못 렌더되는 대신 크래시), `info`(의미 있는 기본값으로 만든 컨텍스트라 Provider 없이 쓰는 것이 의도일 수 있음. 절대 실패시키지 않음) 중 하나입니다.
- 서드파티 컨텍스트 쌍(예: `QueryClientProvider` / `useQuery`)을 설정으로 지원합니다.

**하지 않는 일**

- 트리 안의 **순서** 는 검사하지 않습니다. 페이지 클로저 어딘가에 Provider 가 도달 가능하면 — 소비자보다 아래에 있어도 — 제공된 것으로 봅니다. 정밀도를 높이기 위한 선택이며, 트리 순서 버그는 범위 밖입니다.
- 코드를 실행하지 않으므로 조건부 렌더링을 평가하지 않습니다. 죽은 분기로만 도달하는 소비자도 보고되고, 조건부로만 렌더되는 Provider 도 인정됩니다.
- `node_modules` 안을 보지 않습니다. 라이브러리가 만든 컨텍스트는 `externalContexts` 로 선언하지 않는 한 보이지 않습니다. `node_modules` 에 심볼릭 링크된 워크스페이스 패키지는 실제 경로가 해석 경계 안에 있으면 **분석합니다** — 경계는 기본적으로 `--root` 위의 가장 가까운 워크스페이스 루트입니다(`--boundary` 참고).
- ESLint 규칙을 대체하지 않습니다. `eslint-plugin-react` / `@eslint-react` 는 컨텍스트 값 메모이제이션과 React 19 문법을, React Compiler 는 훅 규칙을 검사합니다. 어느 것도 어떤 페이지가 어떤 Provider 를 마운트하는지는 모릅니다 — 그건 프로젝트 전체 시야가 필요하고, 이 도구가 더하는 부분이 그것입니다.

## 설치 & 사용

```sh
npx unprovided                 # 현재 디렉터리의 Next.js 앱 분석
npx unprovided --root apps/web # 다른 루트; 가장 가까운 tsconfig.json 사용
npx unprovided --json          # 기계가 읽는 출력
```

Next.js 가 아닌 프로젝트와 커스텀 래퍼:

```sh
npx unprovided --entry 'src/main.tsx' --always 'src/AppShell.tsx'
```

페이지 트리는 워크스페이스 앱 아래에 있고 Provider 는 형제 패키지에 있는 모노레포: `--root` 를 앱으로 지정하세요. 해석 경계는 그 위의 가장 가까운 워크스페이스 루트(`pnpm-workspace.yaml`, `package.json` `workspaces`, `lerna.json`, `.git`)가 기본이라, `apps/web/node_modules` 에 심볼릭 링크된 `@acme/ui` 는 `packages/ui` 까지 따라갑니다:

```sh
npx unprovided --root apps/web                  # 경계 자동 감지: 워크스페이스 루트
npx unprovided --root apps/web --boundary .     # 앱에서 멈춤: 워크스페이스 패키지는 외부로 취급
```

`app/**/page.*` 또는 `pages/**` 규약을 따르는 엔트리는 어디에 있든 layout / `_app` 체인을 자동으로 얻습니다.

입력 집합이 비어 있으면(페이지 0개, 아무것도 매칭하지 않는 `--entry` glob) exit 2 로 끝나서, 잘못 적은 `--root` 가 CI 를 조용히 통과할 수 없습니다. `--allow-empty` 를 주면 다시 exit 0 입니다.

Node.js 20 이상이 필요합니다. `typescript` 는 일반 의존성이라 따로 설치할 것이 없습니다.

## CLI 옵션

옵션에 넘기는 모든 경로와 glob 은 현재 디렉터리가 아니라 **`--root` 기준** 으로 해석됩니다.

| 옵션 | 설명 |
| --- | --- |
| `--root <dir>` | 프로젝트 루트(기본: 현재 디렉터리). 여기서 `app/`, `src/app/`, `pages/`, `src/pages/` 를 찾습니다. |
| `--entry <glob>` | 추가 엔트리 파일(반복 가능). 루트 기준 상대 경로. 아무것도 매칭하지 않는 glob 은 `note` 로 보고됩니다. |
| `--always <glob>` | 모든 엔트리에 항상 마운트된 것으로 간주할 파일(반복 가능). 루트 기준 상대 경로. |
| `--tsconfig <path>` | `paths` / `baseUrl` 에 쓸 `tsconfig.json`. 루트 기준 상대 경로(기본: 루트에서 위로 올라가며 가장 가까운 것). |
| `--config <path>` | 설정 파일. 루트 기준 상대 경로(기본: 루트의 `unprovided.config.{json,mjs,js}`). |
| `--boundary <dir>` | 모듈 해석을 가두는 디렉터리. 밖의 파일은 외부로 취급합니다. 루트 기준 상대 경로(기본: 루트 또는 그 위의 가장 가까운 워크스페이스 루트 — `pnpm-workspace.yaml`, `package.json` `workspaces`, `lerna.json`, `.git` — 없으면 루트 자신). |
| `--defaulted <level>` | nullish 가 아닌 기본값으로 만든 컨텍스트(`createContext('en')`)의 심각도: `info`(기본), `warning`, `error`, `ignore`. |
| `--fail-on <level>` | `error`(기본) 또는 `warning` 까지 exit 1. `info` 결과는 절대 실패시키지 않습니다. |
| `--allow-empty` | 엔트리를 하나도 찾지 못했을 때 exit 2 대신 exit 0. |
| `--json` | 기계가 읽는 결과 출력. |
| `--no-color` | 색상 비활성화(`NO_COLOR` 도 존중). |
| `-h, --help` / `-v, --version` | 도움말 / 버전. |

### 설정 파일

`unprovided.config.json`(또는 default export 를 가진 `.mjs`):

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

- `ignore`: 절대 보고하지 않을 컨텍스트 이름.
- `boundary`: `--boundary` 와 같음(루트 기준 상대 경로).
- `defaultedContexts`: `--defaulted` 와 같음. CLI 플래그가 우선합니다.
- `externalContexts`: `node_modules` 안에서 만들어진 컨텍스트는 `createContext` 분석 대신 나열한 import 심볼의 도달성을 사용합니다. 라이브러리 훅은 보통 Provider 없이 throw 하므로 `throws` 의 기본값은 **`true`** 입니다(심각도 `warning`). 조용히 잘못 동작하는 소비자에는 `throws: false` 를 주세요(심각도 `error`). 자체 barrel 을 통한 재수출(`export { useQuery } from '@tanstack/react-query'`)과 네임스페이스 import(`import * as Q`)도 따라갑니다.
- CLI 플래그는 설정과 병합됩니다(`--entry` / `--always` 는 설정 목록에 추가, `--tsconfig`, `--boundary`, `--defaulted` 는 CLI 가 우선).

### 억제

```tsx
export function useTheme() {
  // unprovided-ignore-next-line
  return useContext(ThemeContext);
}
```

주석은 `useContext` / `use` 호출(또는 `<X.Consumer>` 요소) 바로 윗줄에 있어야 합니다.

## 출력 예시

사람용:

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

`--json`(형태는 패치 릴리스 사이에 안정적입니다. 경로는 `root` 기준 상대 경로에 `/` 구분자 — 루트 밖이지만 경계 안에 있는 파일은 `../` 로 시작 — 위치는 1부터 셉니다):

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

페이지의 `kind` 는 `app`(App Router), `pages`(Pages Router), `custom`(`--entry`) 중 하나입니다. `suggestedMountPoint` 는 페이지 체인에서 가장 가까운 layout / `_app` 이며 아직 없는 파일일 수 있습니다(그 경우 Next.js 가 인식할 위치입니다).

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| `0` | `--fail-on` 이상의 결과 없음(기본적으로 warning 만으로는 실패하지 않음. `info` 는 절대 실패시키지 않음). |
| `1` | `--fail-on` 이상의 결과 있음. |
| `2` | 사용법 또는 설정 오류(알 수 없는 플래그, 위치 인자, 루트/tsconfig/설정 파일 없음, 설정 형태 오류, 루트를 포함하지 않는 boundary), 또는 **엔트리를 하나도 찾지 못함**(페이지 0개이고 `--entry` 매칭도 없음). `--allow-empty` 를 주면 후자는 exit 0. |

## 프로그래밍 API

```ts
import { analyze, formatHuman, type AnalysisResult } from 'unprovided';

const result: AnalysisResult = await analyze({
  root: 'apps/web',
  entries: ['src/main.tsx'],   // 선택
  always: ['src/Shell.tsx'],   // 선택
  tsconfig: 'tsconfig.json',   // 선택
  boundary: '../..',           // 선택(기본: 루트 위의 가장 가까운 워크스페이스 루트)
  defaultedContexts: 'info',   // 선택: 'info' | 'warning' | 'error' | 'ignore'
  allowEmpty: false,           // 선택: 엔트리가 없을 때 reject 대신 resolve
  config: { ignore: ['DebugContext'] }, // 경로 | 객체 | false(탐색 생략) | undefined(자동)
});

console.log(formatHuman(result, { color: false }));
process.exitCode = result.summary.errors > 0 ? 1 : 0;
```

`analyze` 는 CLI 가 exit 2 로 끝나는 상황과 같은 경우에 `ConfigError` 로 reject 합니다(`allowEmpty` 가 아니면 빈 입력 집합 포함). `loadConfig(root, path?)` 와 `validateConfig(raw)` 도 export 됩니다. CLI 는 이 API 의 얇은 래퍼입니다. ESM 과 CommonJS 빌드를 모두 제공하며 각각 자체 타입 선언을 갖습니다(`import` 는 `dist/index.d.ts`, `require` 는 `dist/index.d.cts`). 따라서 `module: node16` / `nodenext` 의 TypeScript 소비자는 어느 쪽으로도 타입 검사가 통과합니다.

## 동작 원리

1. **엔트리.** App Router: 모든 `app/**/page.{tsx,jsx,ts,js}` 와 `src/app/**/page.*`. 항상 마운트되는 체인은 `app` 루트까지의 조상 디렉터리에 있는 모든 `layout.*` 과 `template.*` 입니다(라우트 그룹 `(name)`, 병렬 `@slot`, 인터셉팅 세그먼트는 일반 디렉터리로 취급). Pages Router: `pages/**/*.{tsx,jsx,ts,js}` 와 `src/pages/**` 에서 `_app`, `_document`, `_error`, `api/**` 를 제외. 체인 = `pages/_app.*`. 라우트 트리는 `node_modules`, `.git`, `.next` 만 건너뛰고 순회하므로 `build`, `dist`, `out`, `coverage` 라는 이름의 라우트 세그먼트도 다른 페이지와 똑같이 페이지입니다(그 이름들은 `--entry` / `--always` glob 을 펼칠 때만 건너뜁니다). 두 규약 중 하나를 따르는 `--entry` 파일은 같은 방식으로 분류되고, 그 외는 `--always` 를 체인으로 갖는 `custom` 입니다.
2. **Program.** 엔트리와 체인에서 출발해 TypeScript `Program` 하나를 만듭니다. import 는 가장 가까운(또는 `--tsconfig`) `tsconfig.json` 을 써서 `ts.resolveModuleName` 으로 해석하므로 `paths` / `baseUrl` 이 동작합니다. 해석은 **경계(boundary)** 에서 멈춥니다: 실제 경로가 경계 밖이거나 실제 `node_modules` 디렉터리 아래에 있는 모듈은 버립니다. 경계는 `--root` 또는 그 위의 가장 가까운 워크스페이스 루트(`pnpm-workspace.yaml`, `package.json` `workspaces`, `lerna.json`, `.git`)가 기본이라, 앱의 `node_modules` 에 심볼릭 링크된 워크스페이스 패키지는 워크스페이스 안의 실제 경로로 해석되어 분석됩니다. `--boundary` 로 바꿀 수 있습니다. `@types/*` 와 type reference directive 는 절대 로드하지 않습니다.
3. **사실 추출** — 모든 프로젝트 파일에서:
   - 컨텍스트: `createContext(...)` / `React.createContext(...)` 로 초기화된 변수. 기본값은 `undefined`, `null`, `other` 로 분류;
   - 소비자: `useContext(C)`, `React.useContext(C)`, `use(C)`, `<C.Consumer>`, `createElement(C.Consumer)`. 감싸는 함수가 값을 throw 로 가드하면(`if (!x) throw`, `if (x === undefined) throw`, `if (x == null) throw`, `typeof x === 'undefined'`, `invariant(x)` / `assert*(x)`, `x ?? invariant(...)`, `x ?? (() => { throw })()`) `throws`, 아니면 `silent`;
   - 제공자: JSX `<C.Provider>`, `<C>`(React 19), `const P = C.Provider` 같은 변수 별칭, `createElement(C.Provider, …)` / `jsx(C.Provider, …)`.
4. **도달성** 은 심볼 단위입니다. 파일의 default export 에서 출발해 도달 가능한 각 선언의 본문을 순회하고, 모든 식별자를 checker 로 해석(import 별칭과 재수출 해소)해 얻은 선언(함수, 변수, 클래스, 객체 프로퍼티, `export default` 식)을 클로저에 추가합니다. `import('./x')` 호출 지점은 실제로 쓰는 것만 기여합니다: `import('./x').then(m => m.A)` 와 `.then(({ A }) => …)` 는 export `A` 만 추가하고(`m.default` 는 default export), `dynamic(() => import('./x'))`, `lazy(() => import('./x'))` 와 그 밖의 bare `import('./x')` 는 default export 가 있으면 그것을, 없으면 `x` 의 **모든 export** 를 추가합니다. `.then` 콜백이 모듈 객체를 밖으로 흘리는 경우(`.then(m => helper(m))`, `.then(m => m)`)에도 같은 "모든 export" 폴백이 적용됩니다. `x` 의 export 되지 않은 선언은 `import()` 를 통해서는 절대 들어오지 않습니다. default export 가 없는 엔트리 / `--always` 파일만 파일 전체를 루트로 씁니다.
5. **판정** — (페이지, 컨텍스트)마다: 페이지 ∪ 체인에서 도달 가능한 소비자가 있고 같은 클로저에서 도달 가능한 제공자가 없으면 → 결과. 도달 가능한 소비자 중 하나라도 `silent` 면 `error`, 모두 throw 하면 `warning` — 단, nullish 가 아닌 기본값(`createContext('en')`, `createContext(false)`, `createContext(defaults)`)으로 만든 컨텍스트는 `defaultedContexts` 레벨로 보고합니다(기본 `info`: 보이지만 절대 실패시키지 않음. 요청에 따라 `warning`, `error`, `ignore`).

### 설계 선택(재현율보다 정밀도)

각 항목은 의도한 것입니다. 자신의 코드베이스에 맞는지 판단할 수 있도록 이유를 쉬운 말로 적었습니다.

- **라우트 디렉터리는 절대 빌드 산출물로 취급하지 않습니다.** `app/build/page.tsx` 는 `/build` 페이지입니다. `build` / `dist` / `out` / `coverage` 건너뛰기 목록은 `--entry` / `--always` glob 을 펼칠 때만 적용되고, App Router · Pages Router 트리는 `node_modules`, `.git`, `.next` 만 건너뛰고 순회합니다.
- **`import()` 는 쓰는 멤버만 기여하고, 파일 전체를 기여하지 않습니다.** `import('./x').then(m => m.X)` 는 `X` 에만 도달하므로, `x` 안에 우연히 Provider 를 마운트하는 형제 export 컴포넌트가 있어도 페이지가 "제공됨" 이 되지 않습니다. default export 가 없는 모듈에 대한 bare `import('./x')` 는 *export 된* 선언 전체로 폴백하며, 비공개 선언으로는 절대 폴백하지 않습니다.
- **의미 있는 기본값은 버그가 아니라 신호입니다.** `createContext('en')` 이나 `createContext(false)` 는 "Provider 없이 소비해도 괜찮다" 는 뜻입니다. 이런 컨텍스트는 `info` 로 보고합니다: 리포트와 `--json` 에는 보이지만 종료 코드를 실패시키지 않습니다. `--defaulted warning|error` 로 올리거나 `--defaulted ignore` 로 뺄 수 있습니다. `error` 는 nullish 기본값(`undefined` / `null` / 인자 없음)을 silent 소비자가 읽는 경우, `warning` 은 throw 하는 소비자의 경우로 남겨둡니다.
- **해석 경계는 `--root` 가 아니라 워크스페이스입니다.** `--root` 가 모노레포 안의 앱이면 `node_modules` 에 심볼릭 링크된 형제 워크스페이스 패키지를 실제 경로까지 따라갑니다. 대부분의 Provider 가 거기 살기 때문입니다. 실제 `node_modules` 디렉터리 아래의 것은 여전히 외부입니다. `--boundary` 로 좁히거나 넓힐 수 있고, 루트를 포함하지 않는 경계는 설정 오류입니다.
- **라이브러리 소비자는 throw 한다고 가정합니다.** `externalContexts` 의 소비자는 `throws: true` 가 기본(심각도 `warning`)입니다. `useQuery`, `useTheme` 류의 라이브러리 훅은 Provider 없이 거의 항상 throw 하기 때문입니다. 조용히 잘못 동작하는 라이브러리 훅에는 `throws: false` 를 주면 `error` 가 됩니다.
- **Pages Router 엔트리는 `.ts` / `.js` 를 포함합니다.** `pages/foo.ts` 파일은 Next.js 에서 라우트이므로 여기서도 엔트리입니다(`api/**`, `_app`, `_document`, `_error` 제외).
- **빈 입력 집합은 오류입니다.** 페이지 0개이고 `--entry` 매칭도 없으면 exit 2 라서, 잘못 적은 `--root` 나 glob 이 CI 를 조용히 통과할 수 없습니다. `--allow-empty` 는 exit 0 을 되돌리고, 아무것도 매칭하지 않는 glob 은 항상 `note` 로 보고됩니다.
- **옵션의 경로는 루트 기준입니다.** `--config`, `--tsconfig`, `--boundary`, `--entry`, `--always` 는 현재 디렉터리가 아니라 `--root` 기준으로 해석되므로, 같은 명령이 어느 cwd 에서든 동작합니다.
- 클로저 **어디에든** 도달 가능한 Provider 는 인정합니다. 소비자보다 아래에서 렌더되거나 조건부로만 렌더되어도 마찬가지입니다.
- nullish 기본값을 구조 분해하면(`const { a } = useContext(C)`) `TypeError` 로 크래시하지만, 이는 가드가 아니라 사고이므로 `warning` 이 아닌 `error` 로 보고합니다.
- `const P = C.Provider` 형태의 별칭만 인식합니다. `const { Provider } = C` 는 인식하지 않습니다.
- `static contextType` / `this.context` 를 쓰는 클래스 컴포넌트는 소비자로 취급하지 않습니다.
- 서드파티 모듈을 `export * from 'lib'` 로 재수출하는 barrel 을 통한 외부 컨텍스트는 추적하지 않습니다(이름을 지정한 재수출은 추적).

### 알려진 거짓 양성

- 그 페이지에서 절대 실행되지 않는 코드로만 도달하는 소비자(기능 플래그 분기, 절대 전달되지 않는 props, 플랫폼 전용 헬퍼).
- **선택적 컨텍스트 훅**: nullish 기본값 컨텍스트를 읽고 일부러 `undefined` 를 반환해 부모가 있든 없든 동작하게 만든 훅(`RadioGroup` / `Radio`, `Accordion` / `AccordionItem`)은 버그와 구분할 수 없습니다. 호출에 `// unprovided-ignore-next-line` 을 달거나 컨텍스트를 `ignore` 에 넣으세요.
- 분석 트리 밖에서 마운트되는 Provider: 호스트 애플리케이션, 마이크로 프론트엔드 셸, 테스트 하네스, 혹은 Provider 를 마운트하는 패키지를 제외하는 `--boundary`. `--always`, 더 넓은 `--boundary`, 또는 `ignore` 를 사용하세요.
- 팩토리(`createSafeContext()` 류 헬퍼)로 만든 Provider 는 `createContext` 스캔에 보이지 않습니다. 팩토리가 패키지에 있으면 `externalContexts` 로 선언하거나 해당 컨텍스트를 ignore 하세요.
- 런타임 `switch` / 조회 테이블로 선택되는 Provider 는 모든 분기에서 마운트된 것으로 칩니다(조건부 렌더링을 평가하지 않음).

### 알려진 거짓 음성

- `static contextType`, `this.context`, `const { Provider } = C`, 커스텀 `createContext` 래퍼로 소비되는 컨텍스트.
- `require()`, 문자열로 조립한 동적 import, 서드파티 모듈의 `export * from` barrel 로만 도달하는 Provider 나 소비자.
- `import()` 근사: default export 가 없는 모듈에 대한 bare `import('./x')`, 또는 모듈 객체를 밖으로 흘리는 `.then` 콜백(`.then(m => helper(m))`)은 `x` 의 **모든 export** 를 추가하므로, 그 모듈의 무관한 export 에 있는 Provider 가 진짜 결과를 가릴 수 있습니다. 계산된 이름의 `.then(m => m[name])` 도 같은 방식으로 처리됩니다.
- nullish 가 아닌 기본값으로 만든 컨텍스트는 기본이 `info` 라, `--fail-on error` 로는 그런 컨텍스트의 Provider 가 정말 빠져 있어도 CI 가 실패하지 않습니다. 코드베이스가 컨텍스트 기본값에 의존하지 않는다면 `--defaulted error` 를 쓰세요.
- 트리 순서 실수(소비자가 Provider 위에 있는 경우)는 절대 보고되지 않습니다.

## 로드맵

- App Router 의 `loading.*`, `error.*`, `not-found.*`, `default.*` 파일을 추가 엔트리로.
- `static contextType` / `this.context` 소비자.
- 플래그 뒤에 숨긴 선택적 트리 순서 검사(소비자가 Provider 위에 렌더되는 경우).
- watch 모드와 ESLint 포매터 호환 리포터.
- 대형 모노레포를 위한 증분 분석.
- CI 에서 패킹된 tarball 에 `@arethetypeswrong/cli` 실행.

## 개발 & 릴리스

```sh
pnpm install
pnpm lint        # biome
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup: dist/index.{js,cjs,d.ts}, dist/cli.js
pnpm test        # 빌드 후 vitest (test/fixtures 의 픽스처, e2e 하나는 dist/cli.js 를 spawn)
npm pack --dry-run
```

릴리스: `package.json` 의 `version` 을 올리고 `CHANGELOG.md` 를 갱신해 커밋한 뒤

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

`Release` GitHub Action 이 빌드 · 테스트 후 `NPM_TOKEN` 저장소 시크릿을 사용해 provenance 와 함께 npm 에 게시합니다. **게시는 오직 이 태그 → GitHub Actions 흐름으로만 합니다. 로컬에서 `npm publish` 를 실행하지 마세요.** `publishConfig.registry` 가 `https://registry.npmjs.org/` 로 고정되어 있어, `.npmrc` 가 사설 레지스트리를 가리키는 머신에서도 실수로 거기에 게시할 수 없습니다.

## 라이선스

MIT
