import { useTheme } from '@/lib/theme';
export default function Page() {
  return <main>{useTheme()?.mode}</main>;
}
