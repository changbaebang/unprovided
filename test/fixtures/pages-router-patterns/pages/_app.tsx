import type { AppProps } from 'next/app';
type WithLayout = AppProps['Component'] & { getLayout?: (page: React.ReactNode) => React.ReactNode };
export default function App({ Component, pageProps }: AppProps) {
  const getLayout = (Component as WithLayout).getLayout ?? ((p: React.ReactNode) => p);
  return getLayout(<Component {...pageProps} />);
}
