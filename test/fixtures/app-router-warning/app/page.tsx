import { useTheme } from '../src/theme';

export default function Page() {
  return <main>{useTheme().mode}</main>;
}
