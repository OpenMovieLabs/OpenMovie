import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'apps/cli/src/**/*.ts',
        'apps/core/src/**/*.ts',
        'apps/desktop/src/main/**/*.ts',
        'apps/mcp-server/src/**/*.ts',
        'packages/*/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        'apps/core/src/main.ts',
        'apps/desktop/src/main/index.ts',
        'apps/mcp-server/src/main.ts',
      ],
      thresholds: {
        statements: 75,
        branches: 55,
        functions: 80,
        lines: 80,
      },
    },
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    passWithNoTests: false,
  },
});
