import { QueryClientProvider } from '@acme/query';
import type { ReactNode } from 'react';
export default function OkLayout({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={{}}>{children}</QueryClientProvider>;
}
