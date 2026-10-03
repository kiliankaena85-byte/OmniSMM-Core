import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const reactPlugin = typeof react === 'function' ? react : react?.default;

export default defineConfig({
  plugins: [reactPlugin ? reactPlugin() : []],
  test: {
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.temp/**',
      '**/.git/**',
      '**/e2e/**',
      '**/.agent/**',
      '**/.agents/**',
      '**/.planning/**',
      '**/.versions/**',
      'scripts/**',
    ],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'packages/**/*.{test,spec}.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    maxWorkers: 1,
    fileParallelism: false,
    retry: 0,
    testTimeout: 60000,
    hookTimeout: 60000,
    setupFiles: ['./test/setup-env.ts', './test/setup.ts'],
    globals: true,
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      include: ['src/services/core/**', 'src/services/financial/**', 'src/actions/order/**']
    },
    sequence: {
      concurrent: false
    }
  }
});
