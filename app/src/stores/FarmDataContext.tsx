import { createContext, ReactNode, useContext } from 'react';

import { useFarmData } from '@/hooks/useFarmData';

type FarmDataContextValue = ReturnType<typeof useFarmData>;

const FarmDataContext = createContext<FarmDataContextValue | null>(null);

export function FarmDataProvider({ children }: { children: ReactNode }) {
  const value = useFarmData();
  return <FarmDataContext.Provider value={value}>{children}</FarmDataContext.Provider>;
}

export function useFarm() {
  const ctx = useContext(FarmDataContext);
  if (!ctx) throw new Error('useFarm must be used within FarmDataProvider');
  return ctx;
}
