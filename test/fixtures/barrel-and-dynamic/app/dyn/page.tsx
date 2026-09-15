import dynamic from 'next/dynamic';
const Consumer = dynamic(() => import('../../src/Consumer'));
export default function DynPage() {
  return <Consumer />;
}
