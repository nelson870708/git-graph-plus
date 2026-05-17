import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // JUnit output drives Codecov Test Analytics (flaky detection, slow-test
    // ranking, failure history). `default` keeps the local console output.
    reporters: ['default', ['junit', { outputFile: 'test-results.xml' }]],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/types.ts',
        // vscode-bound modules — covered by manual testing of the extension,
        // not unit/integration. Excluded so the % reflects testable code.
        'src/extension.ts',
        'src/panels/**',
        'src/views/**',
        'src/services/file-watcher.ts',
        'src/services/git-content-provider.ts',
        'src/utils/**',
        'src/git/vscode-git-bridge.ts',
      ],
    },
  },
});
