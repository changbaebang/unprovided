import { useQuery } from '@acme/query';
export default function Page() {
  const q = useQuery({ queryKey: ['x'] });
  return <main>{String(q)}</main>;
}
