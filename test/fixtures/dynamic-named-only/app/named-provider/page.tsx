import dynamic from 'next/dynamic';
const W = dynamic(() => import('../../src/widgets').then((m) => m.NeverRendered));
export default function NamedProviderPage() {
  return <W />;
}
