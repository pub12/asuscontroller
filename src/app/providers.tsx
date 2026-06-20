'use client';
import { HazoContextProvider } from 'hazo_ui';

export function Providers({ children }: { children: React.ReactNode }) {
  return <HazoContextProvider>{children}</HazoContextProvider>;
}
