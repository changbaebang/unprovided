import { ThemeContext } from '../../src/theme';
export default function ConsumerOnlyPage() {
  return <ThemeContext.Consumer>{(t) => <span>{t?.mode}</span>}</ThemeContext.Consumer>;
}
