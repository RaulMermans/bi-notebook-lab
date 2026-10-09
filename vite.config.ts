import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages serves the app from /bi-notebook-lab/; local dev, preview and
  // the Playwright suite keep the root base. Set by .github/workflows/pages.yml.
  base: process.env.BI_LAB_BASE ?? '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Sprint 16 Part E: React Flow and Recharts are already behind
        // React.lazy() at their only usage sites (ModelCanvas/ContextExplorer,
        // BarVisual/LineVisual) — pin them to their own vendor chunks so
        // Rollup never folds their shared runtime back into the eagerly
        // loaded entry chunk (docs/PERFORMANCE.md "Bundle analysis").
        manualChunks(id) {
          if (id.includes('node_modules/@xyflow')) return 'vendor-react-flow'
          if (id.includes('node_modules/recharts')) return 'vendor-recharts'
          if (id.includes('node_modules/xlsx')) return 'vendor-xlsx'
        },
      },
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // tests/e2e is Playwright's own suite (npm run test:e2e), not vitest's — its
    // *.spec.ts files would otherwise match vitest's default include glob.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
})
