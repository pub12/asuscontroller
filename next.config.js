/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    'hazo_core', 'hazo_ui', 'hazo_auth', 'hazo_api', 'hazo_connect', 'hazo_jobs',
    'hazo_env', 'hazo_config', 'hazo_logs', 'hazo_secure', 'hazo_state', 'hazo_audit',
  ],
  serverExternalPackages: ['better-sqlite3', 'sql.js', '@napi-rs/canvas'],
  env: { HAZO_ENV_TEST_SQLITE_DRIVER: 'better-sqlite3' },
  turbopack: { resolveAlias: { hazo_debug: './stubs/hazo-debug-stub.js' } },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('sql.js', 'better-sqlite3', '@napi-rs/canvas');
    }
    return config;
  },
};
module.exports = nextConfig;
