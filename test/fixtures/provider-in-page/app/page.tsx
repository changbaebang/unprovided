import { Child, ThemeContext } from '../src/theme';
export default function Page() {
  return (
    <ThemeContext.Provider value={{ mode: 'light' }}>
      <Child />
    </ThemeContext.Provider>
  );
}
