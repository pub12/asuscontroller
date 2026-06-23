import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import 'hazo_ui/styles.css';
import './globals.css';
import { Providers } from './providers';
import { themeInitScript } from '@/lib/theme';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = { title: 'DarylWeb' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* Set the theme class before paint to avoid a flash of the wrong theme.
            Lives in the server-rendered <head>, not a client component, so it runs
            as ordinary HTML and doesn't trip React's client-script warning. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
