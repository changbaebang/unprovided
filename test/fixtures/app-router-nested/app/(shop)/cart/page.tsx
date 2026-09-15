import { useCart } from '../../../src/cart';
export default function CartPage() {
  return <ul>{useCart()?.items.map((i) => <li key={i}>{i}</li>)}</ul>;
}
