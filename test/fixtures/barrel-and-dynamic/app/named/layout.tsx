import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
const Providers = dynamic(() => import('../../src/Providers').then((m) => m.NamedProviders));
export default function NamedLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
