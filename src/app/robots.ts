import type { MetadataRoute } from 'next';

/**
 * Instruct all crawlers to stay off — this is a private self-hosted app.
 * The generated /robots.txt is reinforced by a global X-Robots-Tag response
 * header (next.config.js) and a <meta name="robots"> tag (layout metadata).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
