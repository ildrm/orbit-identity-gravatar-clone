import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/policy.ts', 'packages/core/src/avatar.ts'],
    },
  },
});
