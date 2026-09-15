import { useLocale } from '../src/locale';
export default function Page() {
  return <main lang={useLocale()} />;
}
