import dynamic from 'next/dynamic';
const W = dynamic(() => import('../../src/widgets').then(({ Used }) => ({ default: Used })));
export default function DestructurePage() {
  return <W />;
}
