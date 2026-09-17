import { Providers } from '@/theme';
// Server Component layout mounting a Client Component wrapper: the Provider is still reachable.
export default function RootLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return <html><body><Providers>{children}{modal}</Providers></body></html>;
}
