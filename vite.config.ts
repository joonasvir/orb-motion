import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/wabi': {
        target: 'https://api.wabi.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/wabi/, '/api/v1'),
      },
    },
  },
})
