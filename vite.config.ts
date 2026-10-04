/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// 版本標記：登入頁與設定頁顯示，用來確認手機載入的是不是最新部署（PWA 快取很頑固）
const buildId = `${(process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: '交易日誌',
        short_name: '交易日誌',
        lang: 'zh-TW',
        display: 'standalone',
        start_url: '/',
        background_color: '#09090b',
        theme_color: '#09090b',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
