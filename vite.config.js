import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  server: {
    port: 8000,
    allowedHosts: ['.coder'],
  },
  plugins: [
    dts({
      include: ['lib/**/*.ts'],
      // Test files are caught by the *.test.ts glob; canvas-recorder.ts
      // is a test-only helper that *.test.ts wildcards don't match, so
      // exclude it explicitly to keep its internal types out of the
      // rolled-up ghostty-web.d.ts shipped to consumers.
      exclude: ['lib/**/*.test.ts', 'lib/canvas-recorder.ts'],
      rollupTypes: true, // Bundle all .d.ts into single file
      copyDtsFiles: false, // Don't copy individual .d.ts files
    }),
  ],
  build: {
    lib: {
      entry: 'lib/index.ts',
      name: 'GhosttyWeb',
      fileName: (format) => {
        return format === 'es' ? 'ghostty-web.js' : 'ghostty-web.umd.cjs';
      },
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: [], // No external dependencies
      output: {
        assetFileNames: 'assets/[name][extname]',
        globals: {},
      },
    },
  },
});
