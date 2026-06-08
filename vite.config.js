import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/choutyousei/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.png', 'icon-512.png'],
      manifest: {
        name: 'SchedSync',
        short_name: 'SchedSync',
        description: '全員の空き時間を自動算出するスケジュール調整アプリ',
        theme_color: '#040d1c',
        background_color: '#040d1c',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/choutyousei/',
        start_url: '/choutyousei/',
        icons: [
          { src: 'icon.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ]
})
