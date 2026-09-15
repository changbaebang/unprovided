import { useTheme } from '@acme/ui';
export default function Page() {
  return <main>{useTheme()?.mode}</main>;
}
