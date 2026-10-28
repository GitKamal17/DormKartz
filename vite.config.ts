import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    // `npm run dev` + `npm run server`: online play goes through the game server.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 180000,
  },
});
