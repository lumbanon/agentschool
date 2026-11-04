/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the production build works from any sub-path.
  base: './',
  plugins: [react()],
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
