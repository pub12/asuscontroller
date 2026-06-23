'use client';
import { ThemeProvider } from '@/lib/theme';
import { HazoContextProvider, HazoUiToaster } from 'hazo_ui';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <HazoContextProvider>
        {children}
        <HazoUiToaster />
      </HazoContextProvider>
    </ThemeProvider>
  );
}
