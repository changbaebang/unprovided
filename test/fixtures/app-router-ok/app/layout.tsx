import type { ReactNode } from 'react';
import { ThemeProvider } from '../src/theme';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
