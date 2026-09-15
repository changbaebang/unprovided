import { useTheme } from '../src/theme';
export default function Home() {
  return <main>{useTheme()?.mode}</main>;
}
