/**
 * GoogleAnalytics — GA4 via next/script, env-gated.
 *
 * Renders nothing unless NEXT_PUBLIC_GA_ID is set (format: G-XXXXXXXXXX).
 * Add it to .env.local to activate tracking:
 *
 *   NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
 *
 * Placed in the root <head> via layout.tsx so it fires on every page.
 * strategy="afterInteractive" defers loading until hydration to avoid
 * blocking the initial paint.
 */
import Script from 'next/script';

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export function GoogleAnalytics() {
  if (!GA_ID) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}
