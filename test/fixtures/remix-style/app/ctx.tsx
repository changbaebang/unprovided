import { createContext, useContext } from 'react';
export const UserCtx = createContext<string | undefined>(undefined);
export const OtherCtx = createContext<string | undefined>(undefined);
export const useUser = () => useContext(UserCtx);
export const useOther = () => useContext(OtherCtx);
