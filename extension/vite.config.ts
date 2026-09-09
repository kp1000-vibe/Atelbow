import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * MV3 needs each entry point emitted as its own top-level file with a predictable name
 * (the manifest references them by path), so hashing and code-splitting are both disabled.
 * The content script in particular must be a single self-contained file — Chrome does not
 * resolve dynamic chunk imports for content scripts.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  /**
   * Replaced with a literal at build time so Rollup can prove the hot-reload branch is dead
   * in production and drop the module. A dev-only network client must not merely be inert in
   * a shipped build — it must not be in the file at all.
   */
  define: { __DEV__: JSON.stringify(mode === 'development') },
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        sidepanel: resolve(__dirname, 'sidepanel.html')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: '[name].[ext]',
        inlineDynamicImports: false,
        manualChunks: undefined
      }
    }
  }
}))
