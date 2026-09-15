import React, { createContext, useContext, type ReactNode } from 'react';

export interface Theme { mode: 'light' | 'dark' }
export const ThemeContext = React.createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={{ mode: 'light' }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function useStrictTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useStrictTheme must be used within ThemeProvider');
  return ctx;
}
