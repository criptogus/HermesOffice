import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  // @hermesoffice/i18n and @hermesoffice/electron-utils ship as TS source — must be bundled
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@hermesoffice/i18n', '@hermesoffice/electron-utils'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@hermesoffice/i18n', '@hermesoffice/electron-utils'] })],
  },
  renderer: {
    plugins: [react()],
    server: {
      port: Number(process.env.HTML_DEV_PORT) || 5178,
      strictPort: Boolean(process.env.HTML_DEV_PORT),
    },
  },
})
