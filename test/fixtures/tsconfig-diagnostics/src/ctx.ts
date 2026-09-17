import { createContext, useContext } from 'react';
export const C = createContext<string | undefined>(undefined);
export const useC = () => useContext(C);
