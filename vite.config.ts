import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [react()],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      proxy:
        devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : undefined,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('katex') || id.includes('rehype-katex') || id.includes('remark-math') || id.includes('micromark-extension-math') || id.includes('mdast-util-math')) return 'math-katex'
              if (id.includes('@streamdown/math')) return 'markdown-math'
              if (id.includes('streamdown')) return 'markdown-streamdown'
              if (
                id.includes('react-markdown') ||
                id.includes('remark-gfm') ||
                id.includes('remark-parse') ||
                id.includes('remark-rehype') ||
                id.includes('unified') ||
                id.includes('micromark') ||
                id.includes('mdast-util') ||
                id.includes('hast-util') ||
                id.includes('unist-util') ||
                id.includes('vfile')
              ) return 'markdown-legacy'
              if (id.includes('fflate')) return 'compression'
              if (id.includes('@fal-ai')) return 'fal'
              if (id.includes('react') || id.includes('react-dom') || id.includes('zustand')) return 'vendor'
            }
            if (id.includes('/src/components/SettingsModal')) return 'settings'
            if (id.includes('/src/components/FavoriteCollections')) return 'favorites'
            if (id.includes('/src/components/MaskEditorModal')) return 'mask-editor'
            if (id.includes('/src/components/DetailModal') || id.includes('/src/components/Lightbox')) return 'image-viewers'
          },
        },
      },
    },
  }
})
