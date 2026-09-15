import { useTheme } from './lib';
export default function Consumer() {
  return <span>{useTheme()?.mode}</span>;
}
