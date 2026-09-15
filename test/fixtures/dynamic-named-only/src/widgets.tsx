import { ThemeContext, useTheme } from './theme';

export function Used() {
  return <span>{useTheme()?.mode}</span>;
}

// Exported but never rendered by the pages that import `Used`.
export function NeverRendered() {
  return (
    <ThemeContext.Provider value={{ mode: 'dark' }}>
      <Used />
    </ThemeContext.Provider>
  );
}

// Not exported and referenced by nothing: must never count, even for a bare import().
// biome-ignore lint/correctness/noUnusedVariables: intentionally dead
function PrivateProvider() {
  return (
    <ThemeContext.Provider value={{ mode: 'dark' }}>
      <Used />
    </ThemeContext.Provider>
  );
}
