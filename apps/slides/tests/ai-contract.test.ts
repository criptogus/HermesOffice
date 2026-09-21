/**
 * Contract tests for the slides agent toolset: schemas, handlers, and
 * slideIndex validation on tools that still exist after the apply_ops
 * consolidation (granular set_element_* tools moved into apply_ops / execute_slide_script).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PlacedBox, RenderNode, RenderSlide, ShapeRenderNode } from '@hermesoffice/pptx-render'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'
import type { AgentToolCall } from '../src/shared/ipc'

const box = (x: number, y: number, w: number, h: number): PlacedBox => ({
  x,
  y,
  w,
  h,
  rotationDeg: 0,
  flipH: false,
  flipV: false,
  centerX: x + w / 2,
  centerY: y + h / 2,
})

const textNode = (id: string, b: PlacedBox, text: string): ShapeRenderNode => ({
  id,
  sourceId: id,
  type: 'shape',
  box: b,
  fill: { kind: 'none' },
  text: {
    lines: [
      {
        runs: [
          {
            text,
            x: 8,
            baselineY: 20,
            fontFamily: 'Arial',
            fontSizePx: 24,
            color: '#000000',
            bold: false,
            italic: false,
            underline: false,
            widthPx: text.length * 12,
          },
        ],
        top: 0,
        height: 28,
      },
    ],
    insets: { l: 8, t: 4, r: 8, b: 4 },
    anchor: 'top',
    fontScale: 1,
    wrap: true,
    contentHeight: 28,
  },
})

const slideOf = (nodes: RenderNode[]): RenderSlide =>
  ({
    widthPx: 1280,
    heightPx: 720,
    scale: 1,
    background: { kind: 'solid', color: '#FFFFFF' },
    nodes,
  }) as RenderSlide

function makeAccess(slides: RenderSlide[]) {
  const applied: number[] = []
  const access: DeckAccess = {
    getSlides: () => slides,
    getCurrent: () => 0,
    getSelectedIds: () => [],
    applySlide: (idx, slide) => {
      applied.push(idx)
      slides[idx] = slide
    },
    applyDeck: (all) => {
      slides.length = 0
      slides.push(...all)
    },
    fitWidthPx: 1280,
    retryBackoffMs: 0,
  }
  return { access, applied }
}

const freshSlides = () => [
  slideOf([
    textNode('el1', box(100, 100, 400, 200), 'Hello'),
    textNode('el2', box(100, 320, 400, 200), 'Subtitle'),
    textNode('el3', box(100, 400, 400, 200), 'Body'),
  ]),
  slideOf([]),
]

const call = (name: string, input: Record<string, unknown> = {}): AgentToolCall => ({
  id: 't',
  name,
  input,
})

beforeEach(() => {
  ;(window as unknown as { slidesApi: unknown }).slidesApi = {}
})

const api = () =>
  (window as unknown as { slidesApi: Record<string, ReturnType<typeof vi.fn>> }).slidesApi

describe('TOOLS schema contract', () => {
  const skill = createSlidesSkill(makeAccess(freshSlides()).access)

  it('declares the consolidated toolset with unique names', () => {
    const names = skill.tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThanOrEqual(18)
    expect(names).toContain('apply_ops')
    expect(names).toContain('execute_slide_script')
    expect(names).not.toContain('set_element_text')
  })

  it('every tool has a description and an object schema whose required fields exist', () => {
    for (const tool of skill.tools) {
      expect(tool.description, tool.name).toBeTruthy()
      expect(tool.inputSchema.type, tool.name).toBe('object')
      const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>
      for (const req of (tool.inputSchema.required as string[] | undefined) ?? []) {
        expect(props, `${tool.name}.${req}`).toHaveProperty(req)
      }
    }
  })

  it('every declared tool reaches a handler (no silent unknown-tool fallthrough)', async () => {
    for (const tool of skill.tools) {
      const r = await skill.executeTool!(call(tool.name, {}), undefined)
      expect(r.output, tool.name).not.toContain('Unknown tool')
    }
  })
})

describe('input validation precedes IPC', () => {
  const SLIDE_INDEX_TOOLS = [
    ['read_slide', {}],
    ['execute_slide_script', { code: 'log(els.length)' }],
    ['insert_web_image', { url: 'https://example.com/x.png', x: 0, y: 0, w: 10, h: 10 }],
    [
      'replace_image',
      { sourceId: 'el1', url: 'https://example.com/x.png' },
    ],
    ['edit_chart', { sourceId: 'c1' }],
    ['regenerate_slide', { marker: 'm1' }],
  ] as const

  it.each(SLIDE_INDEX_TOOLS)('%s rejects an out-of-range slideIndex', async (name, extra) => {
    const skill = createSlidesSkill(makeAccess(freshSlides()).access)
    const r = await skill.executeTool!(call(name, { slideIndex: 99, ...extra }), undefined)
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/out of range|Invalid slideIndex/)
  })

  it('set_speaker_notes rejects an out-of-range slideIndex when notes are supported', async () => {
    const { access } = makeAccess(freshSlides())
    const skill = createSlidesSkill({
      ...access,
      setSpeakerNotes: vi.fn(async () => true),
    })
    const r = await skill.executeTool!(
      call('set_speaker_notes', { slideIndex: 99, text: 'x' }),
      undefined,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/Invalid slideIndex/)
  })

  it('apply_ops rejects an empty ops array before IPC', async () => {
    const skill = createSlidesSkill(makeAccess(freshSlides()).access)
    const r = await skill.executeTool!(call('apply_ops', { ops: [] }), undefined)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('non-empty')
  })
})

describe('read tools', () => {
  it('read_slide is a pure read (no IPC, mutated=false)', async () => {
    const { access, applied } = makeAccess(freshSlides())
    const skill = createSlidesSkill(access)
    const dump = await skill.executeTool!(call('read_slide', { slideIndex: 0 }), undefined)
    expect(dump.mutated).toBe(false)
    expect(dump.output).toContain('el1')
    expect(applied).toHaveLength(0)
  })
})

describe('apply_ops surface', () => {
  it('dry_run validates through applyTxn without mutating the deck', async () => {
    api().applyTxn = vi.fn(async () => ({
      applied: false,
      dryRun: true,
      plan: ['[0] setFill s0/e_1'],
      failures: [],
      slides: freshSlides(),
    }))
    const skill = createSlidesSkill(makeAccess(freshSlides()).access)
    const r = await skill.executeTool!(
      call('apply_ops', {
        dry_run: true,
        ops: [{ op: 'setFill', slideIndex: 0, sourceId: 'el1', fill: '#ff0000' }],
      }),
      undefined,
    )
    expect(r.isError).toBeUndefined()
    expect(r.mutated).toBe(false)
    expect(api().applyTxn).toHaveBeenCalled()
  })
})

describe('ask_clarification', () => {
  it('fails gracefully without the questionnaire capability', async () => {
    const { access } = makeAccess(freshSlides())
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool!(
      call('ask_clarification', { questions: [{ label: 'Style?', options: ['a', 'b'] }] }),
      undefined,
    )
    expect(r.isError).toBe(true)
  })

  it('forwards questions and reports skips', async () => {
    const { access } = makeAccess(freshSlides())
    const askClarification = vi.fn(async () => ({ cancelled: true, answers: '' }))
    const skill = createSlidesSkill({ ...access, askClarification })
    const r = await skill.executeTool!(
      call('ask_clarification', { questions: [{ label: 'Style?', options: ['a', 'b'] }] }),
      undefined,
    )
    expect(r.isError).toBeUndefined()
    expect(askClarification).toHaveBeenCalledWith([
      expect.objectContaining({ label: 'Style?', options: ['a', 'b'] }),
    ])
    expect(r.output).toContain('skipped')
  })
})
