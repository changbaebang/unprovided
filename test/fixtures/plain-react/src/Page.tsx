import { useTheme } from './theme';
export function Page() {
  return <main>{useTheme()?.mode}</main>;
}
