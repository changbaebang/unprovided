import { useCart, useTheme, useUser } from '../src/contexts';
export default function Page() {
  return <main>{useTheme()?.mode}{useCart()?.items.length}{useUser()?.id}</main>;
}
