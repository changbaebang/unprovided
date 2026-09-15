import { useTheme } from '@acme/ui';
export default function OkPage() {
  return <main>{useTheme()?.mode}</main>;
}
