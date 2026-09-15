import { createContext, useContext, type ReactNode } from 'react';
export const ThemeContext = createContext<{ mode: string } | undefined>(undefined);
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={{ mode: 'dark' }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
