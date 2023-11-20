import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ['lib/**/*', 'node_modules', 'layers', 'example/**/*']
  }
});
