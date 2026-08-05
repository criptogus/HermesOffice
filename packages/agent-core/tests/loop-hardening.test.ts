import { describe, expect, it, vi } from 'vitest'
import {
  AgentLoop,
  type AgentMessage,
  type AgentSkill,
  type AgentStreamCallbacks,
  type AgentStreamRequest,
  type AgentToolCall,
  type AgentTransport,
  type ToolExecution,
} from '../src'

/**
 * Like the scripted transport in loop.test.ts, but records full requests so
 * tests can assert on system prompts, session ids, and message contents.
 */
function recordingTransport(script: Array<(cb: AgentStreamCallbacks) => void>): AgentTransport & {
  requests: AgentStreamRequest[]
  callbacks: AgentStreamCallbacks[]
  cancels: number
} {
  let turn = 0
  const transport = {
    requests: [] as AgentStreamRequest[],
    callbacks: [] as AgentStreamCallbacks[],
    cancels: 0,
    stream(request: AgentStreamRequest, cb: AgentStreamCallbacks) {
      transport.requests.push(request)
      transport.callbacks.push(cb)
      const step = script[turn++]
      if (step) queueMicrotask(() => step(cb))
      return {
        cancel: () => {
          transport.cancels++
          queueMicrotask(() => cb.onDone())
        },
      }
    },
  }
  return transport
}

function makeSkill(execute?: (call: AgentToolCall) => ToolExecution): AgentSkill {
  return {
    id: 'test',
    systemPrompt: 'SYSTEM',
    tools: [{ name: 'do_thing', description: 'd', inputSchema: { type: 'object' } }],
    executeTool: execute ?? (() => ({ output: 'ok', summary: 'done', mutated: true })),
  }
}

const answer = (text: string) => (cb: AgentStreamCallbacks) => {
  cb.onDelta(text)
  cb.onDone()
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('AgentLoop reset and generation invalidation', () => {
  it('reset clears history, cancels the in-flight stream, and leaves the loop reusable', async () => {
    const transport = recordingTransport([
      (cb) => cb.onDelta('partial'), // never completes
      answer('fresh answer'),
    ])
    const onDone = vi.fn()
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: { onDone } })
    loop.run('first')
    await flush()
    loop.reset()
    expect(loop.busy).toBe(false)
    expect(loop.messages).toHaveLength(0)
    expect(transport.cancels).toBe(1)

    loop.run('second')
    await flush()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith({
      text: 'fresh answer',
      cancelled: false,
      turnLimit: false,
    })
    expect(loop.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('stale stream callbacks after reset are ignored (no events, no history writes)', async () => {
    const transport = recordingTransport([
      () => {
        /* held open: the test fires the callbacks manually after reset */
      },
    ])
    const onText = vi.fn()
    const onDone = vi.fn()
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: { onText, onDone } })
    loop.run('x')
    await flush()
    const stale = transport.callbacks[0]!
    loop.reset()
    stale.onDelta('late delta')
    stale.onToolCall({ id: 't1', name: 'do_thing', input: {} })
    stale.onDone()
    await flush()
    expect(onText).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(loop.messages).toHaveLength(0)
  })

  it('reset while a tool is executing discards the run: no results pushed, no next turn', async () => {
    const transport = recordingTransport([
      (cb) => {
        cb.onToolCall({ id: 't1', name: 'do_thing', input: {} })
        cb.onDone()
      },
      answer('should never be requested'),
    ])
    let loop: AgentLoop | null = null
    const skill = makeSkill()
    skill.executeTool = () => {
      loop!.reset()
      return { output: 'ok', summary: 's', mutated: true }
    }
    const onDone = vi.fn()
    loop = new AgentLoop({ transport, skill, events: { onDone } })
    loop.run('x')
    await flush()
    await flush()
    expect(transport.requests).toHaveLength(1)
    expect(onDone).not.toHaveBeenCalled()
    expect(loop.messages).toHaveLength(0)
  })
})

describe('AgentLoop request shaping', () => {
  it('forwards a static sessionId on every turn and omits it when unset', async () => {
    const withSession = recordingTransport([answer('a')])
    const loop = new AgentLoop({
      transport: withSession,
      skill: makeSkill(),
      sessionId: 'doc-123',
    })
    loop.run('x')
    await flush()
    expect(withSession.requests[0]!.sessionId).toBe('doc-123')

    const withoutSession = recordingTransport([answer('a')])
    const plain = new AgentLoop({ transport: withoutSession, skill: makeSkill() })
    plain.run('x')
    await flush()
    expect('sessionId' in withoutSession.requests[0]!).toBe(false)
  })

  it('re-evaluates a sessionId function on each turn', async () => {
    const transport = recordingTransport([
      (cb) => {
        cb.onToolCall({ id: 't1', name: 'do_thing', input: {} })
        cb.onDone()
      },
      answer('done'),
    ])
    const sessionId = vi.fn(() => 'live-session')
    const loop = new AgentLoop({ transport, skill: makeSkill(), sessionId })
    loop.run('x')
    await flush()
    await flush()
    expect(transport.requests).toHaveLength(2)
    expect(sessionId).toHaveBeenCalledTimes(2)
    expect(transport.requests.every((r) => r.sessionId === 'live-session')).toBe(true)
  })

  it('appends systemSuffix to the skill prompt on every turn', async () => {
    const transport = recordingTransport([answer('a')])
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(),
      systemSuffix: () => '\nSUFFIX',
    })
    loop.run('x')
    await flush()
    expect(transport.requests[0]!.system).toBe('SYSTEM\nSUFFIX')
  })

  it('uses formatUserMessage to combine instruction and skill context', async () => {
    const transport = recordingTransport([answer('a')])
    const skill = makeSkill()
    skill.buildContext = () => 'CTX'
    const loop = new AgentLoop({
      transport,
      skill,
      formatUserMessage: (instr, ctx) => `<${instr}|${ctx}>`,
    })
    loop.run('do it')
    await flush()
    expect(loop.messages[0]).toEqual({ role: 'user', text: '<do it|CTX>' })
  })

  it('ignores run() while busy and run() with an empty instruction', async () => {
    const transport = recordingTransport([answer('a')])
    const loop = new AgentLoop({ transport, skill: makeSkill() })
    loop.run('')
    expect(loop.busy).toBe(false)
    loop.run('real')
    loop.run('ignored while busy')
    await flush()
    expect(transport.requests).toHaveLength(1)
    expect(loop.messages.some((m) => 'text' in m && m.text.includes('ignored while busy'))).toBe(
      false,
    )
  })
})

describe('AgentLoop compaction internals', () => {
  it('cancel during the compaction summary finishes the run as cancelled without a model turn', async () => {
    const transport = recordingTransport([
      answer('x'.repeat(800)),
      // 2nd stream call is the summary request for run 2; cancelling the loop
      // aborts it (the handle emits onDone after cancel)
    ])
    const onDone = vi.fn()
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(),
      compaction: { maxBytes: 500, keepRecentBytes: 100 },
      events: { onDone },
    })
    loop.run('first')
    await flush()
    loop.run('second')
    await flush() // summary request is now in flight
    loop.cancel()
    for (let i = 0; i < 4; i++) await flush()
    expect(onDone).toHaveBeenLastCalledWith({ text: '', cancelled: true, turnLimit: false })
    // Only the first real turn and the summary request — never a model turn for run 2
    expect(transport.requests).toHaveLength(2)
    expect(loop.busy).toBe(false)
  })

  it('the summary request truncates stale tool outputs and strips images', async () => {
    const hugeOutput = 'T'.repeat(5_000)
    const transport = recordingTransport([
      // run 1: one tool round-trip with a huge output, then a reply
      (cb) => {
        cb.onToolCall({ id: 't1', name: 'do_thing', input: {} })
        cb.onDone()
      },
      answer('first done'),
      // run 2: a small turn so a fold boundary exists between the two runs
      answer('second reply'),
      // run 3 triggers compaction; the 4th stream call is the summary request
      answer('SUMMARY'),
      answer('third done'),
    ])
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(() => ({ output: hugeOutput, summary: 's', mutated: false })),
      compaction: { maxBytes: 4_000, keepRecentBytes: 100 },
    })
    loop.run('with image', [{ base64: 'A'.repeat(2_000), mime: 'image/png' }])
    await flush()
    await flush()
    loop.run('small question')
    await flush()
    loop.run('follow-up')
    for (let i = 0; i < 4; i++) await flush()

    const summaryRequest = transport.requests[3]!
    expect(summaryRequest.tools).toHaveLength(0)
    for (const m of summaryRequest.messages) {
      if (m.role === 'tool') {
        for (const r of m.results) expect(r.output.length).toBeLessThanOrEqual(2_000)
      }
      if (m.role === 'user') expect('images' in m).toBe(false)
    }
    // The compacted history is summary + ack + recent
    const msgs = loop.messages as Array<Extract<AgentMessage, { role: 'user' | 'assistant' }>>
    expect(msgs[0]!.text).toContain('[Summary of earlier conversation')
    expect(msgs[0]!.text).toContain('SUMMARY')
    expect(msgs[1]!.role).toBe('assistant')
  })
})
