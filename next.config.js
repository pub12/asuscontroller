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
      // next-auth is not installed; hazo_auth bundles OAuth buttons that reference it.
      // Stub them out — we use email-only auth.
      'next-auth/react': './stubs/next-auth-react-stub.js',
      'next-auth': './stubs/next-auth-react-stub.js',
      'next-auth/providers/google': './stubs/next-auth-provider-stub.js',
      'next-auth/providers/facebook': './stubs/next-auth-provider-stub.js',
      'next-auth/providers/credentials': './stubs/next-auth-provider-stub.js',
      'next-auth/jwt': './stubs/next-auth-react-stub.js',
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('sql.js', 'better-sqlite3', '@napi-rs/canvas');
    }
    // Stub next-auth (not installed; we use email-only auth, no OAuth)
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    const p = require('path');
    const nextAuthStub = p.resolve('./stubs/next-auth-react-stub.js');
    const nextAuthProviderStub = p.resolve('./stubs/next-auth-provider-stub.js');
    config.resolve.alias['next-auth/react'] = nextAuthStub;
    config.resolve.alias['next-auth'] = nextAuthStub;
    config.resolve.alias['next-auth/jwt'] = nextAuthStub;
    config.resolve.alias['next-auth/providers/google'] = nextAuthProviderStub;
    config.resolve.alias['next-auth/providers/facebook'] = nextAuthProviderStub;
    config.resolve.alias['next-auth/providers/credentials'] = nextAuthProviderStub;
    return config;
  },
};
module.exports = nextConfig;
