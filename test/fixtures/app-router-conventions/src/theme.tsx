'use client';
import { createContext, useContext } from 'react';
export const ThemeContext = createContext<string | undefined>(undefined);
export const useTheme = () => useContext(ThemeContext);
export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value="dark">{children}</ThemeContext.Provider>;
}
