import { defineConfig } from 'tsup';

// Bundles the server (and the @ais/shared source it imports) into a single ESM file
// so production runs with plain `node dist/index.js` — no path-alias resolver needed.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Native/CJS deps stay external and are resolved from node_modules at runtime.
  external: ['better-sqlite3'],
  noExternal: [/@ais\/shared/],
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});
