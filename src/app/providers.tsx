'use client';
import { ThemeProvider } from 'next-themes';
import { HazoContextProvider, HazoUiToaster } from 'hazo_ui';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <HazoContextProvider>
        {children}
        <HazoUiToaster />
      </HazoContextProvider>
    </ThemeProvider>
  );
}
