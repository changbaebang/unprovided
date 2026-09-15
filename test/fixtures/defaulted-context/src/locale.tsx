import { createContext, useContext } from 'react';
export const LocaleContext = createContext<string>('en');
export const useLocale = () => useContext(LocaleContext);
export const FlagContext = createContext<boolean | undefined>(undefined);
export const useFlag = () => useContext(FlagContext);
