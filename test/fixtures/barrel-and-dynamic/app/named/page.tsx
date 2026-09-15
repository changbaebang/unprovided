import { lazy } from 'react';
const Consumer = lazy(() => import('../../src/Consumer'));
export default function NamedPage() {
  return <Consumer />;
}
