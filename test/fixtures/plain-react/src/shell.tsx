import type { ReactNode } from 'react';
import { ThemeProvider } from './theme';
export default function Shell({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
