import { createContext, useContext } from 'react';
export const C = createContext(undefined);
export const useC = () => useContext(C);
