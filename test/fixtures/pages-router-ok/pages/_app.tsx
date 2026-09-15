import { ThemeProvider } from '../src/theme';
export default function App({ Component, pageProps }: { Component: any; pageProps: any }) {
  return (
    <ThemeProvider>
      <Component {...pageProps} />
    </ThemeProvider>
  );
}
