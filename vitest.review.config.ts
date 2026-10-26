import { defineConfig } from 'vitest/config';

// No platform plugin, context, connector discovery or authentication in synthetic checks.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
