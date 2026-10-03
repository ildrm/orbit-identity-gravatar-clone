import { resolve } from 'node:path';
export default {
  output: 'standalone',
  outputFileTracingRoot: resolve('../..'),
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: (process.env.API_INTERNAL_URL ?? 'http://localhost:4000') + '/api/:path*',
      },
    ];
  },
};
