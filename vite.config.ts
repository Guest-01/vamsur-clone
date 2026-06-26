import { defineConfig } from 'vite';

// Base './' keeps the built bundle portable (works from sub-paths / file://-ish hosting).
// PNG/JSON game assets live in /public/assets and are served from the web root as-is.
export default defineConfig({
  base: './',
  server: {
    // localhost-only (no LAN exposure → only the `Local` URL is printed)
    // and do NOT auto-open a browser. Both are Vite defaults; set explicitly
    // here for clarity.
    host: false,
    open: false,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    target: 'es2021',
  },
});
