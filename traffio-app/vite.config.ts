import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

import { cloudflare } from "@cloudflare/vite-plugin";

const buildTime = new Date().toISOString()
const buildSource = process.env.CF_PAGES_COMMIT_SHA
  ?? process.env.GITHUB_SHA
  ?? process.env.COMMIT_SHA
  ?? 'local'
const buildRunId = process.env.CF_PAGES_DEPLOYMENT_ID
  ?? process.env.GITHUB_RUN_ID
  ?? process.env.BUILD_ID
  ?? buildTime
const appVersion = `${buildSource.slice(0, 12)}-${buildRunId}`

function appVersionPlugin(): Plugin {
  return {
    name: 'traffio-app-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'app-version.json',
        source: JSON.stringify({
          version: appVersion,
          buildTime,
        }, null, 2),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [react(), tailwindcss(), appVersionPlugin(), VitePWA({
    injectRegister: null,
    registerType: 'prompt',
    workbox: {
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
      cleanupOutdatedCaches: true,
      globIgnores: ['**/app-version.json'],
    },
    includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
    manifest: {
      name: 'Portal do Paciente',
      short_name: 'Portal',
      description: 'Gerencie suas consultas e acompanhe a fila de atendimento em tempo real.',
      theme_color: '#ffffff',
      background_color: '#ffffff',
      display: 'standalone',
      icons: [
        {
          src: 'vite.svg',
          sizes: '192x192',
          type: 'image/svg+xml'
        },
        {
          src: 'vite.svg',
          sizes: '512x512',
          type: 'image/svg+xml'
        }
      ]
    }
  }), cloudflare()],
})
