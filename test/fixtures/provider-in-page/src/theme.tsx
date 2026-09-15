import { createContext, useContext } from 'react';
export const ThemeContext = createContext<{ mode: string } | undefined>(undefined);
export const useTheme = () => useContext(ThemeContext);
export function Child() {
  return <span>{useTheme()?.mode}</span>;
}
export const ThemeProviderAlias = ThemeContext.Provider;
