import dynamic from 'next/dynamic';
const Consumer = dynamic(() => import('../src/Consumer'), { ssr: false });
export default function Page() {
  return <Consumer />;
}
