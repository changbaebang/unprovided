import * as Q from '@acme/query';
export default function OkPage() {
  const q = Q.useQuery({ queryKey: ['x'] });
  return <main>{String(q)}</main>;
}
