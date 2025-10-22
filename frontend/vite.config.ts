import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  esbuild: false,
  server: {
    port: 3006,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash]-new.[ext]',
        chunkFileNames: 'assets/[name]-[hash]-new.js',
        entryFileNames: 'assets/[name]-[hash]-new.js'
      }
    }
  }
})