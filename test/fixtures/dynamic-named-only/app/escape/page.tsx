import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
function pick(m: Record<string, unknown>): ComponentType {
  return m.Used as ComponentType;
}
const W = dynamic(() => import('../../src/widgets').then((m) => pick(m)));
export default function EscapePage() {
  return <W />;
}
