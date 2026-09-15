import { useTheme } from '../src/theme';

export default function HomePage() {
  const theme = useTheme();
  return <main data-mode={theme?.mode}>home</main>;
}
