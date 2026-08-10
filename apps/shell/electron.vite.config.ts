import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

/**
 * OAuth client for the embedded Google Drive sync: values are NOT committed —
 * they live in packages/hermes-cloud/src/oauth-credentials.ts (gitignored,
 * created locally from the Google Cloud console). They are inlined into the
 * main bundle here; CI/fresh clones build with empty values (Drive connect
 * then shows a clear configuration error instead of a broken consent URL).
 */
function loadOAuthDefine(): Record<string, string> {
  const credsPath = resolve(__dirname, '../../packages/hermes-cloud/src/oauth-credentials.ts')
  let clientId = ''
  let clientSecret = ''
  if (existsSync(credsPath)) {
    const src = readFileSync(credsPath, 'utf8')
    clientId = src.match(/GOOGLE_CLIENT_ID\s*=\s*'([^']+)'/)?.[1] ?? ''
    clientSecret = src.match(/GOOGLE_CLIENT_SECRET\s*=\s*'([^']+)'/)?.[1] ?? ''
  }
  return {
    'globalThis.__HERMESOFFICE_OAUTH_CLIENT_ID__': JSON.stringify(clientId),
    'globalThis.__HERMESOFFICE_OAUTH_CLIENT_SECRET__': JSON.stringify(clientSecret),
  }
}

export default defineConfig({
  // Bundle everything into the shell main (same policy as apps/docs): the
  // imported docs/sheets main modules are TS source with no build artifacts,
  // so externalizing them would break Node ESM resolution at runtime.
  main: {
    build: {
      rollupOptions: {
        // native module (napi) — never bundled; resolved from node_modules in
        // dev and from resources/anydoc in the packaged app (docs-main loader)
        external: ['@firecrawl/anydoc'],
      },
    },
    define: loadOAuthDefine(),
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // dedicated preload for the auto-update window
          update: resolve(__dirname, 'src/preload/update.ts'),
          // dedicated preload for the share window
          share: resolve(__dirname, 'src/preload/share.ts'),
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // strong-guidance update window (see src/main/update-window.ts)
          update: resolve(__dirname, 'src/renderer/update.html'),
          // share window (see packages/hermes-share/src/share-window.ts)
          share: resolve(__dirname, 'src/renderer/share.html'),
        },
      },
    },
    server: {
      port: Number(process.env.SHELL_DEV_PORT) || 5199,
      strictPort: Boolean(process.env.SHELL_DEV_PORT),
    },
  },
})
