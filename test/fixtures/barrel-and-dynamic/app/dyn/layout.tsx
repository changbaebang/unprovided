import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
const Providers = dynamic(() => import('../../src/Providers'));
export default function DynLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
