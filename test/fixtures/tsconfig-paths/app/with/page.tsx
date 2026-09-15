import { useTheme } from '@/lib/theme';
export default function WithPage() {
  return <main>{useTheme()?.mode}</main>;
}
