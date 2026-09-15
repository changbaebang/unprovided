import { useFlag, useLocale } from '../../src/locale';
export default function StrictPage() {
  return <main lang={useLocale()}>{String(useFlag())}</main>;
}
