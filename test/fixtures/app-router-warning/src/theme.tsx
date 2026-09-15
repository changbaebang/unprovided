import { createContext, useContext } from 'react';

export const ThemeContext = createContext<{ mode: string } | null>(null);

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('missing ThemeProvider');
  }
  return ctx;
};
