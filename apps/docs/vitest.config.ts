import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// resolve sibling source packages by path (not via node_modules), so a git
// worktree whose node_modules is linked to another checkout still tests
// against this checkout's edits (same convention as packages/pdf2docx)
const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@hermesoffice/docx-engine': local('../../packages/docx-engine/src/index.ts'),
      '@hermesoffice/font-metrics': local('../../packages/font-metrics/src/index.ts'),
      '@hermesoffice/electron-utils': local('../../packages/electron-utils/src/index.ts'),
      '@hermesoffice/ai-provider': local('../../packages/ai-provider/src/index.ts'),
      '@hermesoffice/i18n': local('../../packages/i18n/src/index.ts'),
      '@hermesoffice/ui': local('../../packages/ui/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    testTimeout: 20000,
  },
})
