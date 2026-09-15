import { useCart } from '../../../src/cart';
export default function AboutPage() {
  const cart = useCart();
  return <p>{cart?.items.length ?? 0} items</p>;
}
