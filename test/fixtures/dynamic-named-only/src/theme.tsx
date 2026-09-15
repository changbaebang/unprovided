import { createContext, useContext, type ReactNode } from 'react';
export const ThemeContext = createContext<{ mode: string } | undefined>(undefined);
export const useTheme = () => useContext(ThemeContext);
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={{ mode: 'light' }}>{children}</ThemeContext.Provider>;
}
