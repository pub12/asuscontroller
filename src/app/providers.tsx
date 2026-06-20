'use client';
import { HazoContextProvider, HazoUiToaster } from 'hazo_ui';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <HazoContextProvider>
      {children}
      <HazoUiToaster />
    </HazoContextProvider>
  );
}
