import { useStrictTheme } from '../../src/theme';

export default function StrictPage() {
  const theme = useStrictTheme();
  return <main data-mode={theme.mode}>strict</main>;
}
