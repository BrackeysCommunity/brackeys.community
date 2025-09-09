import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isDev = command === 'serve';
  const isProd = command === 'build' && mode === 'production';

  const baseConfig = {
    plugins: [react()],
    optimizeDeps: {
      exclude: ['lucide-react', '@uidotdev/usehooks'],
    },
  };

  if (isDev) return baseConfig;

  if (isProd) {
    return {
      ...baseConfig,
      build: {
        minify: 'terser',
        terserOptions: {
          compress: {
            passes: 2,
          },
          mangle: true,
          format: {
            comments: false,
          },
        },
      },
    };
  }

  return baseConfig;
});
