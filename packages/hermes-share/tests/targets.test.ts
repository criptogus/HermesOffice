import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

import { listShareTargets, parseSendList } from '../src/targets'

describe('parseSendList', () => {
  it('normalizes the directory into a flat channel list', () => {
    const targets = parseSendList(
      JSON.stringify({
        platforms: {
          telegram: [{ id: '1088196041', name: 'Gustavo', type: 'dm', thread_id: null }],
          whatsapp: [{ id: '5511999999999@s.whatsapp.net', name: 'Contato', type: 'dm' }],
        },
      }),
    )
    expect(targets.platforms).toEqual(['telegram', 'whatsapp'])
    expect(targets.channels).toHaveLength(2)
    expect(targets.channels[0]).toMatchObject({
      platform: 'telegram',
      id: '1088196041',
      name: 'Gustavo',
      type: 'dm',
      threadId: null,
    })
    expect(targets.channels[1]).toMatchObject({
      platform: 'whatsapp',
      id: '5511999999999@s.whatsapp.net',
      name: 'Contato',
    })
  })

  it('drops internal platforms from the picker', () => {
    const targets = parseSendList(
      JSON.stringify({ platforms: { local: [], api_server: [], telegram: [] } }),
    )
    expect(targets.platforms).toEqual(['telegram'])
  })

  it('sorts platforms and tolerates missing names', () => {
    const targets = parseSendList(
      JSON.stringify({ platforms: { discord: [{ id: 'C123' }], telegram: [] } }),
    )
    expect(targets.platforms).toEqual(['discord', 'telegram'])
    expect(targets.channels[0]).toMatchObject({ platform: 'discord', name: 'discord' })
  })

  it('returns empty lists for malformed JSON', () => {
    expect(parseSendList('not json at all')).toEqual({ channels: [], platforms: [] })
    expect(parseSendList('{"unexpected": true}')).toEqual({ channels: [], platforms: [] })
  })
})

describe('execSendList / listShareTargets', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('parses the CLI JSON output end to end', async () => {
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (e: Error | null, out: string) => void) =>
        cb(null, JSON.stringify({ platforms: { telegram: [{ id: '1', name: 'A' }] } })),
    )
    const targets = await listShareTargets('/fake/hermes')
    expect(targets.channels).toHaveLength(1)
    expect(execFileMock).toHaveBeenCalledWith(
      '/fake/hermes',
      ['send', '--list', '--json'],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    )
  })

  it('rejects with a readable error on non-zero exit', async () => {
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (e: Error) => void) =>
        cb(new Error('spawn /fake/hermes ENOENT')),
    )
    await expect(listShareTargets('/fake/hermes')).rejects.toThrow(/hermes send --list failed/)
  })
})
