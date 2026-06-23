import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import 'hazo_ui/styles.css';
import './globals.css';
import { Providers } from './providers';
import { themeInitScript } from '@/lib/theme';
import { GoogleAnalytics } from '@/components/GoogleAnalytics';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'DarylWeb',
  // Instruct search engines not to index or follow links — this is a private app.
  // Reinforced by robots.ts (/robots.txt) and the X-Robots-Tag response header.
  robots: { index: false, follow: false },
};

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
        {/* GA4 — strategy="afterInteractive" fires after hydration.
            next/script must not be placed inside <head>; the body is correct. */}
        <GoogleAnalytics />
      </body>
    </html>
  );
}
