/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath, URL } from 'node:url'
import * as path from 'node:path'
import type { Plugin } from 'vite'
import { createDataHandler } from './scripts/serveCore.mjs'

/** `EMBODISCOPE_DATA=/data/a;/data/b npm run dev` exposes local folders to the dev server (same API as scripts/serve.mjs). */
function localData(): Plugin {
  const roots = (process.env.EMBODISCOPE_DATA ?? '').split(path.delimiter).filter(Boolean)
  return {
    name: 'embodiscope-local-data',
    configureServer(server) {
      if (!roots.length) return
      const handle = createDataHandler(roots)
      server.middlewares.use(async (req, res, next) => {
        if (!(await handle(req, res))) next()
      })
    },
  }
}

// `vite build`               -> dist/        (multi-file, for GitHub Pages / any static server)
// `vite build --mode single` -> dist-single/ (one self-contained HTML, works from file://)
export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  return {
    base: './',
    plugins: [react(), localData(), ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    resolve: {
      alias: {
        '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
        '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
        '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
      },
    },
    worker: { format: 'es' },
    server: { watch: { ignored: ['**/dist/**', '**/dist-single/**', '**/LICENSE', '**/docs/**'] } },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 4000,
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      testTimeout: 120_000,
    },
  }
})
