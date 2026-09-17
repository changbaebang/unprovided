'use client';
import { createContext, useContext } from 'react';
export const ModalContext = createContext<string | undefined>(undefined);
export const useModal = () => useContext(ModalContext);
export const ModalProvider = ({ children }: { children: React.ReactNode }) => (
  <ModalContext.Provider value="m">{children}</ModalContext.Provider>
);
