import { createContext, useContext, type ReactNode } from 'react';

export interface Theme { mode: 'light' | 'dark' }
export const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={{ mode: 'light' }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
