import { useTheme } from '../../src/theme';
export default function Product() {
  return <main>{useTheme()?.mode}</main>;
}
