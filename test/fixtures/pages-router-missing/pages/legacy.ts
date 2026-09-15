import { useTheme } from '../src/theme';
// No JSX: a `.ts` page is still analysed, so the missing provider is reported for it too.
export default function Legacy() {
  return useTheme()?.mode ?? null;
}
