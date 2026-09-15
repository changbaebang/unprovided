import { ThemeProvider } from '@acme/ui';
import type { ReactNode } from 'react';
export default function OkLayout({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
