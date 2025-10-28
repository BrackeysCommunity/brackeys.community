import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Only include plugins needed for testing
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    viteReact(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
    css: true,
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '.output/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/',
        '**/*.stories.*',
        '**/storybook-static/',
      ],
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
