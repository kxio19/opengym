import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

function preloadSpanishStartupChunks() {
  const startupModules = ['/src/locales/es.js']
  let base = './'

  return {
    name: 'preload-spanish-startup-chunks',
    apply: 'build',
    configResolved(config) { base = config.base },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.bundle) return html

        const chunks = Object.values(context.bundle).filter(output => output.type === 'chunk')
        const hrefs = startupModules.map(modulePath => {
          const chunk = chunks.find(output =>
            output.moduleIds.some(id => id.replaceAll('\\', '/').endsWith(modulePath))
          )
          if (!chunk) throw new Error(`Could not find startup chunk for ${modulePath}`)
          return `${base}${chunk.fileName}`
        })

        return {
          html,
          tags: hrefs.map(href => ({
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: true, href },
            injectTo: 'head'
          }))
        }
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), preloadSpanishStartupChunks()],
  base: './',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
