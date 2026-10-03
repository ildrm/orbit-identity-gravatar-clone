import { resolve } from 'node:path';
const config = {
  output: 'standalone',
  outputFileTracingRoot: resolve('../..'),
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: (process.env.API_INTERNAL_URL ?? 'http://localhost:4000') + '/api/:path*',
      },
      {
        source: '/avatar/:path*',
        destination:
          (process.env.DELIVERY_INTERNAL_URL ?? 'http://localhost:4001') + '/avatar/:path*',
      },
      {
        source: '/assets/:path*',
        destination:
          (process.env.DELIVERY_INTERNAL_URL ?? 'http://localhost:4001') + '/assets/:path*',
      },
    ];
  },
};
export default config;
