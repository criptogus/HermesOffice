import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // @hermesoffice/* workspace packages ship TS source (no build step, no
    // compiled entry point) — externalizing them makes Node's ESM loader try
    // to resolve their relative imports at runtime and fail. Bundle those;
    // externalize everything else (Electron, zod, node builtins).
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@hermesoffice/ai-provider',
          '@hermesoffice/agent-core',
          '@hermesoffice/ai-search',
          '@hermesoffice/docx-engine',
          '@hermesoffice/file-parse',
          '@hermesoffice/electron-utils',
          '@hermesoffice/i18n',
        ],
      }),
    ],
  },
  preload: {
    // Sandboxed preload scripts cannot require arbitrary npm packages at
    // runtime, so the drop-open bridge must be bundled, not externalized.
    plugins: [externalizeDepsPlugin({ exclude: ['@hermesoffice/electron-utils'] })],
  },
  renderer: {
    plugins: [react()],
  },
})
