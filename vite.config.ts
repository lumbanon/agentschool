/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 8010, not 8000: 8000 is commonly taken by other local FastAPI projects.
const API_URL = process.env.AGENTSCHOOL_API_URL ?? 'http://127.0.0.1:8010';

export default defineConfig({
  // Relative base so the production build works from any sub-path.
  base: './',
  plugins: [react()],
  // The classroom calls the backend at /api (backend/: `agentschool serve`, default port 8010).
  server: { proxy: { '/api': API_URL } },
  preview: { proxy: { '/api': API_URL } },
  build: {
    // Phaser is ~1.2 MB minified; split it so the app shell loads independently.
    chunkSizeWarningLimit: 1600,
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'], katex: ['katex'] } } },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.tsx'],
    environment: 'node',
    css: false,
  },
});
