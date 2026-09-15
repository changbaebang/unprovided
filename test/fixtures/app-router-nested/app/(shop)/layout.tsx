import type { ReactNode } from 'react';
import { CartProvider } from '../../src/cart';
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}
