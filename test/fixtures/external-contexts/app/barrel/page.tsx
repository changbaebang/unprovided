import { useAcmeQuery } from '../../src/query';
export default function BarrelPage() {
  const q = useAcmeQuery({ queryKey: ['x'] });
  return <main>{String(q)}</main>;
}
