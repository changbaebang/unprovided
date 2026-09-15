import { Child, ThemeContext } from '../../src/theme';
export default function React19Page() {
  return (
    <ThemeContext value={{ mode: 'light' }}>
      <Child />
    </ThemeContext>
  );
}
