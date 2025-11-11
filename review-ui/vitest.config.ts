import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.ts',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    deps: {
      inline: ['@testing-library/jest-dom']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'lodash/isEqualWith': path.resolve(__dirname, 'node_modules/lodash/isEqualWith.js')
    }
  }
});
