import { wrapVinxiConfigWithSentry } from '@sentry/tanstackstart-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';
import viteTsConfigPaths from 'vite-tsconfig-paths';

const config = defineConfig({
  server: {
    allowedHosts: ['localhost', '8c0834fd6e0b.ngrok.app', 'brackeys.dev'],
  },
  plugins: [
    nitro({
      config: {
        preset: 'vercel',
        externals: {
          // Inline these to avoid import issues
          inline: [
            /^@clerk\//,
            /^@sentry\//,
            /^@opentelemetry\//,
            /^@tanstack\//,
          ],
          // Explicitly exclude build-time dependencies and configs
          external: [
            'rollup-plugin-dts',
            /rollup\.config\.(js|ts|mjs)/,
            /@edge-runtime\/primitives\/dist\/.*\.js\.text\.js$/,
          ],
        },
      },
    }),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  optimizeDeps: {
    exclude: ['lucide-react', '@uidotdev/usehooks'],
  },
  build: {
    rollupOptions: {
      external: [
        // Exclude rollup config files from dependencies
        /rollup\.config\.(js|ts|mjs)/,
        // Exclude build-time dependencies
        'rollup-plugin-dts',
        // Exclude problematic edge runtime files
        /@edge-runtime\/primitives\/dist\/.*\.js\.text\.js$/,
      ],
      output: {
        manualChunks: (id) => {
          // Clerk gets its own chunk
          if (id.includes('@clerk')) {
            return 'clerk';
          }
          //     // Motion/Framer Motion gets its own chunk
          //     if (id.includes('motion') || id.includes('framer-motion')) {
          //       return 'motion';
          //     }
          //     // TanStack packages get their own chunk
          //     if (
          //       id.includes('@tanstack/react-query') ||
          //       id.includes('@tanstack/query')
          //     ) {
          //       return 'tanstack-query';
          //     }
          //     if (id.includes('@tanstack/react-router')) {
          //       return 'tanstack-router';
          //     }
          //     // Lucide icons get their own chunk
          //     if (id.includes('lucide-react')) {
          //       return 'lucide';
          //     }
          //     // GraphQL/Hasura get their own chunk
          //     if (id.includes('graphql') || id.includes('urql')) {
          //       return 'graphql';
          //     }
          //     // Sentry gets its own chunk
          //     if (id.includes('@sentry')) {
          //       return 'sentry';
          //     }
          //     // SpacetimeDB bindings get their own chunk
          //     if (id.includes('spacetime-bindings')) {
          //       return 'spacetime';
          //     }
          //     // All other node_modules go into vendor
          //     if (id.includes('node_modules')) {
          //       return 'vendor';
          //     }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});

export default wrapVinxiConfigWithSentry(config, {
  org: process.env.VITE_SENTRY_ORG,
  project: process.env.VITE_SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Only print logs for uploading source maps in CI
  // Set to `true` to suppress logs
  silent: !process.env.CI,
});
