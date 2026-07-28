import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: false, // /assets is served from the project root as-is
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    cssMinify: true,
    assetsInlineLimit: 2048
  }
});
