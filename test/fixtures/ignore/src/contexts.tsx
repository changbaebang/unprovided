import { createContext, useContext } from 'react';

export const ThemeContext = createContext<{ mode: string } | undefined>(undefined);
export const CartContext = createContext<{ items: string[] } | undefined>(undefined);
export const UserContext = createContext<{ id: string } | undefined>(undefined);

export function useTheme() {
  // unprovided-ignore-next-line
  return useContext(ThemeContext);
}
export const useCart = () => useContext(CartContext);
export const useUser = () => useContext(UserContext);
