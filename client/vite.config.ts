import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // I sottopercorsi vanno PRIMA del base per essere risolti correttamente.
      '@shared/model': fileURLToPath(new URL('../shared/model/index.ts', import.meta.url)),
      '@shared/protocol': fileURLToPath(new URL('../shared/protocol/index.ts', import.meta.url)),
      '@hexjourney/shared/model': fileURLToPath(new URL('../shared/model/index.ts', import.meta.url)),
      '@hexjourney/shared/protocol': fileURLToPath(
        new URL('../shared/protocol/index.ts', import.meta.url),
      ),
      '@hexjourney/shared': fileURLToPath(new URL('../shared/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
})
