import { Child, ThemeProviderAlias } from '../../src/theme';
export default function AliasPage() {
  return (
    <ThemeProviderAlias value={{ mode: 'light' }}>
      <Child />
    </ThemeProviderAlias>
  );
}
