import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server port and the API it proxies to are both configurable, so the
// app can run alongside another service that has already taken the defaults.
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_PORT,
    strictPort: true,
    // The dev server proxies the API so the browser sees one origin. That keeps
    // the httpOnly session cookie first-party in development without needing a
    // CORS exception or `sameSite: none`.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/socket.io': { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
  preview: { port: Number(process.env.WEB_PREVIEW_PORT ?? 4173), strictPort: true },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries out of the app bundle so a
        // code change does not invalidate the whole download.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          graph: ['@xyflow/react'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    css: false,
  },
});
