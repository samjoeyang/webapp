import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const r = p => fileURLToPath(new URL(p, import.meta.url))

// 多页应用（MPA）：门户 + 三个独立工具各自一个 HTML 入口。
// base 用相对路径，保证部署到任意子路径都能正常工作。
export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: r('./index.html'),
        travel: r('./travel-planner/index.html'),
        checkin: r('./meeting-checkin/index.html'),
        network: r('./home-network-diagnosis/index.html')
      }
    }
  }
})
