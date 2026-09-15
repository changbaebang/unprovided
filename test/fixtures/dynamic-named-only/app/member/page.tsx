import dynamic from 'next/dynamic';
const W = dynamic(() => import('../../src/widgets').then((m) => m.Used));
export default function MemberPage() {
  return <W />;
}
