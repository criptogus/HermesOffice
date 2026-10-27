import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentToolDef } from '@hermesoffice/agent-core'
import {
  activePermissionProfileId,
  startNativeThread,
  buildCodexAppServerPrompt,
  codexAppServerLaunchArgs,
  codexAppServerOutputSchema,
  codexThreadStartParams,
  parseCodexAppServerTurn,
  resolveCodexCliPath,
  requireCodexPermissionProfile,
  waitForTurn,
  type CodexTurnTransport,
  type RpcMessage,
} from '../src/codex-app-server'

function fakeTransport(script: RpcMessage[]): CodexTurnTransport {
  let listener: ((message: RpcMessage) => void) | undefined
  return {
    request: async (method) => {
      if (method === 'turn/start') {
        queueMicrotask(() => script.forEach((message) => listener?.(message)))
        return { turn: { id: 't1' } }
      }
      return {}
    },
    onNotification: (next) => {
      listener = next
      return () => {
        listener = undefined
      }
    },
  }
}

const noopCallbacks = {
  signal: new AbortController().signal,
  onDelta: () => undefined,
  onToolCall: () => undefined,
}

const tools: AgentToolDef[] = [
  {
    name: 'replace_text',
    description: 'Replace document text',
    inputSchema: {
      type: 'object',
      properties: { before: { type: 'string' }, after: { type: 'string' } },
      required: ['before', 'after'],
    },
  },
]

describe('Codex app-server bridge', () => {
  it('automatically selects the newest complete desktop-managed Codex install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'genoffice-codex-discovery-'))
    try {
      const older = join(root, 'old-release')
      const newer = join(root, 'new-release')
      await mkdir(older)
      await mkdir(newer)
      for (const directory of [older, newer]) {
        await writeFile(join(directory, 'codex.exe'), '')
        await writeFile(join(directory, 'codex-code-mode-host.exe'), '')
      }
      await utimes(join(older, 'codex.exe'), new Date(1_000), new Date(1_000))
      await utimes(join(newer, 'codex.exe'), new Date(2_000), new Date(2_000))
      await utimes(older, new Date(1_000), new Date(1_000))
      await utimes(newer, new Date(2_000), new Date(2_000))

      await expect(
        resolveCodexCliPath('', { platform: 'win32', managedInstallRoot: root, env: {} }),
      ).resolves.toBe(join(newer, 'codex.exe'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('migrates a stale saved hash path to the current managed install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'genoffice-codex-migration-'))
    try {
      const current = join(root, 'current-release')
      await mkdir(current)
      await writeFile(join(current, 'codex.exe'), '')
      await writeFile(join(current, 'codex-code-mode-host.exe'), '')

      await expect(
        resolveCodexCliPath(join(root, 'removed-release', 'codex.exe'), {
          platform: 'win32',
          managedInstallRoot: root,
          env: {},
        }),
      ).resolves.toBe(join(current, 'codex.exe'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('starts the official stdio app-server instead of assuming an HTTP endpoint', () => {
    expect(codexAppServerLaunchArgs()).toEqual(['app-server', '--listen', 'stdio://'])
  })

  it('confines Codex tool reads to the temp dir through a permission profile', () => {
    const config = { apiKey: '', model: 'gpt-5.6-terra' }
    const params = codexThreadStartParams(config, '/tmp/genoffice-codex-x')
    expect(params).not.toHaveProperty('sandbox')
    expect(params.approvalPolicy).toBe('never')
    expect(params.config).toEqual({
      default_permissions: 'hermesoffice',
      permissions: {
        hermesoffice: {
          filesystem: { ':minimal': 'read', '/tmp/genoffice-codex-x': 'read' },
        },
      },
    })
    expect(() => requireCodexPermissionProfile({ thread: { id: 'wrong' } })).toThrow(
      'permission profile',
    )
    expect(
      requireCodexPermissionProfile({
        thread: { id: 'safe' },
        activePermissionProfile: { id: 'hermesoffice' },
      }),
    ).toBe('safe')
    expect(activePermissionProfileId({ activePermissionProfile: { id: 'hermesoffice' } })).toBe(
      'hermesoffice',
    )
    expect(activePermissionProfileId({ activePermissionProfile: null })).toBeUndefined()
  })

  it('builds a strict one-turn output schema with only known tool names', () => {
    const schema = codexAppServerOutputSchema(tools) as {
      properties: { toolCalls: { items: { properties: { name: { enum: string[] } } } } }
    }
    expect(schema.properties.toolCalls.items.properties.name.enum).toEqual(['replace_text'])
    expect(codexAppServerOutputSchema([])).toMatchObject({
      properties: { toolCalls: { maxItems: 0 } },
    })
  })

  it('serializes new conversation events, tool results and schemas', () => {
    const prompt = buildCodexAppServerPrompt(
      'Edit only when requested.',
      [
        { role: 'user', text: 'Change A to B.' },
        {
          role: 'assistant',
          text: '',
          toolCalls: [{ id: 'call-1', name: 'replace_text', input: { before: 'A', after: 'B' } }],
        },
        { role: 'tool', results: [{ id: 'call-1', name: 'replace_text', output: 'done' }] },
      ],
      tools,
      8192,
    )
    expect(prompt).toContain('Edit only when requested.')
    expect(prompt).toContain('replace_text')
    expect(prompt).toContain('"output":"done"')
    expect(prompt).toContain('8192 output tokens')
  })

  it('parses text and JSON-encoded GenOffice tool arguments', () => {
    expect(
      parseCodexAppServerTurn(
        JSON.stringify({
          text: 'I will make that change.',
          toolCalls: [
            {
              id: 'call-1',
              name: 'replace_text',
              inputJson: JSON.stringify({ before: 'A', after: 'B' }),
            },
          ],
        }),
        tools,
      ),
    ).toEqual({
      text: 'I will make that change.',
      toolCalls: [{ id: 'call-1', name: 'replace_text', input: { before: 'A', after: 'B' } }],
    })
  })

  it('rejects unknown tools and empty final turns', () => {
    expect(() =>
      parseCodexAppServerTurn(
        JSON.stringify({ text: '', toolCalls: [{ id: 'x', name: 'shell', inputJson: '{}' }] }),
        tools,
      ),
    ).toThrow('unknown tool')
    expect(() =>
      parseCodexAppServerTurn(JSON.stringify({ text: '', toolCalls: [] }), tools),
    ).toThrow('no content')
  })

  it('keeps waiting through transient stream errors Codex retries itself', async () => {
    const transport = fakeTransport([
      {
        method: 'error',
        params: {
          threadId: 'th',
          turnId: 't1',
          willRetry: true,
          error: { message: 'Reconnecting... 2/5' },
        },
      },
      {
        method: 'item/completed',
        params: { threadId: 'th', turnId: 't1', item: { type: 'agentMessage', text: 'done' } },
      },
      {
        method: 'turn/completed',
        params: { threadId: 'th', turnId: 't1', turn: { id: 't1', status: 'completed' } },
      },
    ])
    await expect(
      waitForTurn(
        transport,
        'th',
        () => transport.request('turn/start', {}),
        noopCallbacks.signal,
        noopCallbacks,
      ),
    ).resolves.toBe('done')
  })

  it('fails the turn on a non-retried error notification', async () => {
    const transport = fakeTransport([
      {
        method: 'error',
        params: { threadId: 'th', turnId: 't1', willRetry: false, error: { message: 'boom' } },
      },
    ])
    await expect(
      waitForTurn(
        transport,
        'th',
        () => transport.request('turn/start', {}),
        noopCallbacks.signal,
        noopCallbacks,
      ),
    ).rejects.toThrow('boom')
  })
})

it('discovers the macOS bundled CLI with a Finder-style PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-macos-codex-'))
  try {
    const bin = join(root, 'ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'codex'), '')
    expect(
      await resolveCodexCliPath('', {
        platform: 'darwin',
        env: { PATH: '' },
        bundledAppDirs: [root],
      }),
    ).toBe(join(bin, 'codex'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('does not silently replace a missing explicit CLI path with another runtime', async () => {
  await expect(
    resolveCodexCliPath('/nonexistent/office-codex', { platform: 'darwin', env: {} }),
  ).rejects.toThrow('Configured Codex CLI')
})

describe('Codex model-only thread isolation', () => {
  it('disables inherited integrations before starting a document thread without changing the user configuration', async () => {
    const effective = {
      config: {
        mcp_servers: { slow_external: { command: 'private-local-command', enabled: true } },
        plugins: { 'optional-plugin@store': { enabled: true } },
      },
    }
    const original = JSON.stringify(effective)
    const calls: Array<{ method: string; params: unknown }> = []
    const client = {
      request: async (method: string, params: unknown) => {
        calls.push({ method, params })
        if (method === 'config/read') return effective
        return { thread: { id: 'office-thread' }, activePermissionProfile: { id: 'hermesoffice' } }
      },
    }
    await expect(
      startNativeThread(client, { apiKey: '', model: 'chosen-model' }, '/tmp/office-thread'),
    ).resolves.toBe('office-thread')
    expect(calls.map((c) => c.method)).toEqual(['config/read', 'thread/start'])
    expect(calls[0]!.params).toEqual({ includeLayers: false, cwd: '/tmp/office-thread' })
    expect(calls[1]!.params).toMatchObject({
      model: 'chosen-model',
      ephemeral: true,
      config: {
        mcp_servers: { slow_external: { enabled: false } },
        plugins: { 'optional-plugin@store': { enabled: false } },
        features: {
          apps: false,
          plugins: false,
          remote_plugin: false,
          shell_tool: false,
          image_generation: false,
          browser_use: false,
          computer_use: false,
        },
        web_search: 'disabled',
        default_permissions: 'hermesoffice',
      },
    })
    expect(JSON.stringify(effective)).toBe(original)
    expect(JSON.stringify(calls[1]!.params)).not.toContain('private-local-command')
  })

  it('refuses a thread when effective configuration cannot be read', async () => {
    const methods: string[] = []
    const client = {
      request: async (method: string) => {
        methods.push(method)
        throw Error('config unavailable')
      },
    }
    await expect(
      startNativeThread(client, { apiKey: '', model: '' }, '/tmp/office-thread'),
    ).rejects.toThrow('config unavailable')
    expect(methods).toEqual(['config/read'])
  })

  it('refuses an unsupported integration inventory instead of leaving inherited servers enabled', async () => {
    const methods: string[] = []
    const client = {
      request: async (method: string) => {
        methods.push(method)
        return { config: { mcp_servers: ['unsupported-shape'] } }
      },
    }
    await expect(
      startNativeThread(client, { apiKey: '', model: '' }, '/tmp/office-thread'),
    ).rejects.toThrow('integration configuration')
    expect(methods).toEqual(['config/read'])
  })

  it('refuses an invalid configuration response instead of inheriting unknown tools', async () => {
    const methods: string[] = []
    const client = {
      request: async (method: string) => {
        methods.push(method)
        return {}
      },
    }
    await expect(
      startNativeThread(client, { apiKey: '', model: '' }, '/tmp/office-thread'),
    ).rejects.toThrow('configuration')
    expect(methods).toEqual(['config/read'])
  })
})
