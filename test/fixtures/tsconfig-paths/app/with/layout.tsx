import type { ReactNode } from 'react';
import { ThemeProvider } from '@/lib/theme';
export default function WithLayout({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
