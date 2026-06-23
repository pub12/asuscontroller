/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    'hazo_core', 'hazo_ui', 'hazo_auth', 'hazo_api', 'hazo_connect', 'hazo_jobs',
    'hazo_env', 'hazo_config', 'hazo_logs', 'hazo_secure', 'hazo_state', 'hazo_audit',
  ],
  serverExternalPackages: ['better-sqlite3', 'sql.js', '@napi-rs/canvas'],
  env: { HAZO_ENV_TEST_SQLITE_DRIVER: 'better-sqlite3' },
  turbopack: {
    resolveAlias: {
      hazo_debug: './stubs/hazo-debug-stub.js',
      // next-auth is installed and used for Google OAuth — no longer stubbed.
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('sql.js', 'better-sqlite3', '@napi-rs/canvas');
    }
    return config;
  },
};
nextConfig.headers = async () => [
  {
    // Apply conservative security headers to all routes.
    // No strict CSP — would break the Swagger UI.
    // X-Robots-Tag: noindex reinforces robots.ts and the <meta> tag in layout —
    // covers crawlers that hit a URL directly without first reading robots.txt.
    source: '/(.*)',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ],
  },
];

module.exports = nextConfig;
