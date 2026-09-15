import { createContext, useContext, type ReactNode } from 'react';

export const CartContext = createContext<{ items: string[] } | undefined>(undefined);

export const CartProvider = ({ children }: { children: ReactNode }) => (
  <CartContext.Provider value={{ items: [] }}>{children}</CartContext.Provider>
);

export const useCart = () => useContext(CartContext);
