import { createElement } from 'react';
import { Child, ThemeContext } from '../../src/theme';
export default function CreateElementPage() {
  return createElement(ThemeContext.Provider, { value: { mode: 'light' } }, createElement(Child));
}
