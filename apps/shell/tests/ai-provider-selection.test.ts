import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import {
  activeProvider,
  defaultAiSettings,
  resolveAiSettings,
} from '../../../packages/ai-provider/src/providers'

// Execute the real settings callbacks without starting Electron or its document engines.
function settingsHandler(module: string, stored: Record<string, unknown>) {
  const file = new URL(`../../${module}`, import.meta.url)
  const source = ts.createSourceFile(
    file.pathname,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  let callback: ts.Node | undefined
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === 'ipcMain' &&
      node.expression.name.text === 'handle'
    ) {
      const channel = node.arguments[0]?.getText(source)
      if (channel === "'ai:get-settings'" || channel === 'IPC_CHANNELS.aiGetSettings')
        callback = node.arguments[1]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!callback) throw new Error(`Missing AI settings handler in ${module}`)
  const writes = vi.fn()
  const code = ts.transpile(`const handler = ${callback.getText(source)}; handler({});`, {
    target: ts.ScriptTarget.ES2022,
  })
  const result = runInNewContext(code, {
    readJson: () => structuredClone(stored),
    writeJson: writes,
    SETTINGS_PATH: () => 'ai-settings.json',
    AI_SETTINGS_PATH: () => 'ai-settings.json',
    sessionFor: vi.fn(),
    activeProvider,
    defaultAiSettings,
    resolveAiSettings,
  })
  return { result, writes }
}

describe.each([
  'docs/src/main/docs-main.ts',
  'sheets/src/main/sheets-main.ts',
  'slides/src/main/ai-ipc.ts',
])('%s provider selection', (module) => {
  it('honors Codex without requiring an API key or explicit model', () => {
    const { result, writes } = settingsHandler(module, {
      provider: 'codex',
      providers: { codex: { apiKey: '', model: '', cliPath: '' } },
    })
    expect(result.provider).toBe('codex')
    expect(writes).not.toHaveBeenCalled()
  })

  it('honors another fully configured provider', () => {
    expect(
      settingsHandler(module, {
        provider: 'anthropic',
        providers: { anthropic: { apiKey: 'test-key', model: 'test-model' } },
      }).result.provider,
    ).toBe('anthropic')
  })

  it('uses Hermes for fresh installations', () => {
    expect(settingsHandler(module, {}).result.provider).toBe('hermes')
  })

  it('falls back without overwriting an incomplete saved selection', () => {
    const { result, writes } = settingsHandler(module, {
      provider: 'anthropic',
      providers: { anthropic: { apiKey: '', model: '' } },
    })
    expect(result.provider).toBe('hermes')
    expect(writes).not.toHaveBeenCalled()
  })
})
