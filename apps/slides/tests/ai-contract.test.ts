/**
 * Contract tests for the slides agent toolset (issue #9): every declared tool
 * has a well-formed schema and a handler; element-editing and page tools
 * validate input before any IPC, and their happy paths orchestrate
 * window.slidesApi with the expected arguments. Engine behavior itself is
 * covered by pptx-engine tests; here the contract is the boundary
 * (input → validation → IPC op → applySlide/applyDeck → output shape).
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
  const deckApplied: number[] = []
  const access: DeckAccess = {
    getSlides: () => slides,
    getCurrent: () => 0,
    getSelectedIds: () => [],
    applySlide: (idx, slide) => {
      applied.push(idx)
      slides[idx] = slide
    },
    applyDeck: (next) => {
      deckApplied.push(next.length)
    },
    fitWidthPx: 1280,
  }
  return { access, applied, deckApplied }
}

const call = (name: string, input: Record<string, unknown> = {}): AgentToolCall => ({
  id: 't',
  name,
  input,
})

/** Three content elements: enough to pass the from-scratch guard on the native add tools */
const freshSlides = () => [
  slideOf([
    textNode('el1', box(100, 100, 400, 200), 'Hello'),
    textNode('el2', box(600, 100, 400, 200), 'World'),
    textNode('el3', box(100, 400, 400, 200), 'Body'),
  ]),
  slideOf([]),
]

beforeEach(() => {
  ;(window as unknown as { slidesApi: unknown }).slidesApi = {}
})

const api = () =>
  (window as unknown as { slidesApi: Record<string, ReturnType<typeof vi.fn>> }).slidesApi

// ── Schema contract for the whole toolset ────────────────────────────

describe('TOOLS schema contract', () => {
  const skill = createSlidesSkill(makeAccess(freshSlides()).access)

  it('declares a full toolset with unique names', () => {
    const names = skill.tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThanOrEqual(30)
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
      const r = await skill.executeTool(call(tool.name, {}), undefined)
      expect(r.output, tool.name).not.toContain('Unknown tool')
    }
  })
})

// ── Validation happens before any IPC ────────────────────────────────

describe('input validation precedes IPC', () => {
  // slidesApi is an empty object in these tests: any IPC attempt would throw,
  // so a clean isError result proves validation ran first.
  const SLIDE_INDEX_TOOLS = [
    ['read_slide', {}],
    ['set_element_text', { sourceId: 'el1', paragraphs: [{ runs: [{ text: 'x' }] }] }],
    ['set_element_style', { sourceId: 'el1', bold: true }],
    ['set_element_transform', { sourceId: 'el1', x: 1 }],
    ['set_element_fill', { sourceId: 'el1', fill: '#fff' }],
    ['set_element_stroke', { sourceId: 'el1' }],
    ['execute_slide_script', { code: 'els' }],
    ['add_text_box', { paragraphs: [{ runs: [{ text: 'x' }] }], x: 0, y: 0, w: 10, h: 10 }],
    ['add_shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }],
    ['add_chart', { kind: 'bar', categories: ['a'], series: [{ name: 's', values: [1] }] }],
    ['add_smartart', {}],
    ['add_table', { rows: 2, cols: 2 }],
    ['edit_table_cell', { sourceId: 'tbl', row: 0, col: 0 }],
    ['edit_table_structure', { sourceId: 'tbl', op: 'addRow' }],
    ['edit_table_style', { sourceId: 'tbl' }],
    ['edit_chart', { sourceId: 'c1' }],
    ['delete_element', { sourceId: 'el1' }],
    ['ungroup_element', { sourceId: 'g1' }],
    ['delete_slide', {}],
  ] as const

  it.each(SLIDE_INDEX_TOOLS)('%s rejects an out-of-range slideIndex', async (name, extra) => {
    const skill = createSlidesSkill(makeAccess(freshSlides()).access)
    const r = await skill.executeTool(call(name, { slideIndex: 99, ...extra }), undefined)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('out of range')
  })

  it('element tools report a not-found sourceId without calling IPC', async () => {
    const skill = createSlidesSkill(makeAccess(freshSlides()).access)
    for (const name of [
      'set_element_text',
      'set_element_style',
      'set_element_transform',
      'set_element_fill',
      'set_element_stroke',
    ]) {
      const r = await skill.executeTool(
        call(name, {
          slideIndex: 0,
          sourceId: 'nope',
          fill: '#fff',
          paragraphs: [{ runs: [{ text: 'x' }] }],
        }),
        undefined,
      )
      expect(r.isError, name).toBe(true)
      expect(r.output, name).toContain('not found')
    }
  })
})

// ── Element editing happy paths ──────────────────────────────────────

describe('element editing tools', () => {
  it('set_element_text resolves the target and applies the returned slide', async () => {
    const slides = freshSlides()
    const { access, applied } = makeAccess(slides)
    api().editText = vi.fn(async () => slideOf([]))
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool(
      call('set_element_text', {
        slideIndex: 0,
        sourceId: 'el1',
        paragraphs: [{ runs: [{ text: 'New text' }] }],
      }),
      undefined,
    )
    expect(r.isError).toBeUndefined()
    expect(r.mutated).toBe(true)
    expect(api().editText).toHaveBeenCalledWith(
      expect.objectContaining({ slideIndex: 0, sourceId: 'el1' }),
    )
    expect(applied).toEqual([0])
  })

  it('set_element_style merges formatting over the existing paragraphs', async () => {
    const { access } = makeAccess(freshSlides())
    api().editText = vi.fn(async () => slideOf([]))
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool(
      call('set_element_style', { slideIndex: 0, sourceId: 'el1', bold: true }),
      undefined,
    )
    expect(r.isError).toBeUndefined()
    const op = api().editText.mock.calls[0]![0] as {
      paragraphs: Array<{ runs: Array<{ text: string }> }>
    }
    // the existing text survives the style merge
    expect(op.paragraphs.flatMap((p) => p.runs.map((r2) => r2.text)).join('')).toContain('Hello')
  })

  it('set_element_transform fills unspecified fields from the current box', async () => {
    const { access } = makeAccess(freshSlides())
    api().editTransform = vi.fn(async () =>
      slideOf([textNode('el1', box(500, 100, 400, 200), 'Hello')]),
    )
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool(
      call('set_element_transform', { slideIndex: 0, sourceId: 'el1', x: 500 }),
      undefined,
    )
    expect(r.isError).toBeUndefined()
    expect(api().editTransform).toHaveBeenCalledWith(
      expect.objectContaining({ xPx: 500, yPx: 100, wPx: 400, hPx: 200, fitWidthPx: 1280 }),
    )
  })

  it('set_element_fill and set_element_stroke forward the op (stroke remove sends null)', async () => {
    const { access } = makeAccess(freshSlides())
    // keep el1 present after applySlide so the follow-up stroke edit can still resolve it
    api().editFill = vi.fn(async () => freshSlides()[0]!)
    api().editStroke = vi.fn(async () => slideOf([]))
    const skill = createSlidesSkill(access)
    await skill.executeTool(
      call('set_element_fill', { slideIndex: 0, sourceId: 'el1', fill: '#ff0000' }),
      undefined,
    )
    expect(api().editFill).toHaveBeenCalledWith(expect.objectContaining({ fill: '#ff0000' }))
    await skill.executeTool(
      call('set_element_stroke', { slideIndex: 0, sourceId: 'el1', remove: true }),
      undefined,
    )
    expect(api().editStroke).toHaveBeenCalledWith(expect.objectContaining({ stroke: null }))
  })

  it('delete_element deletes top-level elements and refuses group members', async () => {
    const group = {
      id: 'g1',
      sourceId: 'g1',
      type: 'group',
      box: box(0, 0, 500, 300),
      children: [textNode('child1', box(10, 10, 100, 50), 'In group')],
    } as unknown as RenderNode
    const slides = [slideOf([textNode('el1', box(100, 100, 400, 200), 'Hello'), group])]
    const { access } = makeAccess(slides)
    api().deleteElement = vi.fn(async () => slideOf([]))
    const skill = createSlidesSkill(access)

    const grouped = await skill.executeTool(
      call('delete_element', { slideIndex: 0, sourceId: 'child1' }),
      undefined,
    )
    expect(grouped.isError).toBe(true)
    expect(grouped.output).toContain('ungroup_element')
    expect(api().deleteElement).not.toHaveBeenCalled()

    const ok = await skill.executeTool(
      call('delete_element', { slideIndex: 0, sourceId: 'el1' }),
      undefined,
    )
    expect(ok.mutated).toBe(true)
    expect(api().deleteElement).toHaveBeenCalledWith({ slideIndex: 0, sourceId: 'el1' })
  })

  it('ungroup_element validates the target is a group and echoes the fresh element list', async () => {
    const group = {
      id: 'g1',
      sourceId: 'g1',
      type: 'group',
      box: box(0, 0, 500, 300),
      children: [textNode('child1', box(10, 10, 100, 50), 'In group')],
    } as unknown as RenderNode
    const slides = [slideOf([textNode('el1', box(100, 100, 400, 200), 'Hello'), group])]
    const { access } = makeAccess(slides)
    api().ungroupElement = vi.fn(async () =>
      slideOf([textNode('new1', box(10, 10, 100, 50), 'In group')]),
    )
    const skill = createSlidesSkill(access)

    const notGroup = await skill.executeTool(
      call('ungroup_element', { slideIndex: 0, sourceId: 'el1' }),
      undefined,
    )
    expect(notGroup.isError).toBe(true)
    expect(notGroup.output).toContain('not a group')

    const ok = await skill.executeTool(
      call('ungroup_element', { slideIndex: 0, sourceId: 'g1' }),
      undefined,
    )
    expect(ok.mutated).toBe(true)
    expect(ok.output).toContain('new1')
  })
})

// ── Page-level tools ─────────────────────────────────────────────────

describe('page tools', () => {
  it('add_slide duplicates from sourceIndex and reports the new index', async () => {
    const { access, deckApplied } = makeAccess(freshSlides())
    api().addSlide = vi.fn(async () => ({
      slides: [slideOf([]), slideOf([]), slideOf([])],
      index: 2,
    }))
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool(call('add_slide', { sourceIndex: 1 }), undefined)
    expect(r.mutated).toBe(true)
    expect(r.output).toContain('slideIndex=2')
    expect(api().addSlide).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIndex: 1, clearText: true }),
    )
    expect(deckApplied).toEqual([3])
  })

  it('delete_slide refuses to delete the last remaining page', async () => {
    const { access } = makeAccess([slideOf([])])
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool(call('delete_slide', { slideIndex: 0 }), undefined)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('Only one page remains')
  })

  it('set_slide_background validates the color and supports slideIndex -1 for all pages', async () => {
    const { access } = makeAccess(freshSlides())
    api().editBackground = vi.fn(async () => [slideOf([]), slideOf([])])
    const skill = createSlidesSkill(access)

    const bad = await skill.executeTool(
      call('set_slide_background', { slideIndex: 0, color: 'red' }),
      undefined,
    )
    expect(bad.isError).toBe(true)

    const all = await skill.executeTool(
      call('set_slide_background', { slideIndex: -1, color: '1A2B3C' }),
      undefined,
    )
    expect(all.mutated).toBe(true)
    expect(api().editBackground).toHaveBeenCalledWith(
      expect.objectContaining({ slideIndex: -1, color: '#1A2B3C' }),
    )
  })

  it('add_shape rejects invalid preset names before IPC', async () => {
    const { access } = makeAccess(freshSlides())
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool(
      call('add_shape', { slideIndex: 0, kind: 'not a shape!', x: 0, y: 0, w: 10, h: 10 }),
      undefined,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('Invalid shape name')
  })

  it('add_text_box inserts via addElement and returns the new element id', async () => {
    const { access, applied } = makeAccess(freshSlides())
    api().addElement = vi.fn(async () => ({ slide: slideOf([]), sourceId: 'tb_9' }))
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool(
      call('add_text_box', {
        slideIndex: 1,
        paragraphs: [{ runs: [{ text: 'Title' }] }],
        x: 10,
        y: 20,
        w: 300,
        h: 80,
      }),
      undefined,
    )
    expect(r.mutated).toBe(true)
    expect(r.output).toContain('tb_9')
    expect(api().addElement).toHaveBeenCalledWith(
      expect.objectContaining({ slideIndex: 1, kind: 'textbox', xPx: 10, yPx: 20 }),
    )
    expect(applied).toEqual([1])
  })
})

// ── Data-source gate on chart figures ────────────────────────────────

describe('chart data-source gate', () => {
  it('add_chart requires a dataSource declaration for concrete figures', async () => {
    const { access } = makeAccess(freshSlides())
    api().addChart = vi.fn(async () => ({ slide: slideOf([]), sourceId: 'ch_1' }))
    const skill = createSlidesSkill(access)
    const input = {
      slideIndex: 0,
      kind: 'bar',
      categories: ['Q1', 'Q2'],
      series: [{ name: 'Revenue', values: [10, 20] }],
    }
    const noSource = await skill.executeTool(call('add_chart', input), undefined)
    expect(noSource.isError).toBe(true)
    expect(noSource.output).toContain('dataSource')

    const withSource = await skill.executeTool(
      call('add_chart', { ...input, dataSource: 'user' }),
      undefined,
    )
    expect(withSource.mutated).toBe(true)
    expect(api().addChart).toHaveBeenCalledTimes(1)
  })

  it('sample data appends the not-real-data note to the output', async () => {
    const { access } = makeAccess(freshSlides())
    api().addChart = vi.fn(async () => ({ slide: slideOf([]), sourceId: 'ch_1' }))
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool(
      call('add_chart', {
        slideIndex: 0,
        kind: 'pie',
        categories: ['A'],
        series: [{ name: 'S', values: [1] }],
        dataSource: 'sample',
      }),
      undefined,
    )
    expect(r.mutated).toBe(true)
    expect(r.output.length).toBeGreaterThan('Inserted a pie chart on page 1.'.length)
  })
})

// ── Read tools and clarification ─────────────────────────────────────

describe('read tools and clarification', () => {
  it('get_deck_context and read_slide are pure reads (no IPC, mutated=false)', async () => {
    const { access, applied } = makeAccess(freshSlides())
    const skill = createSlidesSkill(access)
    const ctx = await skill.executeTool(call('get_deck_context'), undefined)
    expect(ctx.mutated).toBe(false)
    expect(ctx.output.length).toBeGreaterThan(0)
    const dump = await skill.executeTool(call('read_slide', { slideIndex: 0 }), undefined)
    expect(dump.mutated).toBe(false)
    expect(dump.output).toContain('el1')
    expect(applied).toHaveLength(0)
  })

  it('ask_clarification fails gracefully without the questionnaire capability', async () => {
    const { access } = makeAccess(freshSlides())
    const skill = createSlidesSkill(access)
    const r = await skill.executeTool(
      call('ask_clarification', { questions: [{ label: 'Style?', options: ['a', 'b'] }] }),
      undefined,
    )
    expect(r.isError).toBe(true)
  })

  it('ask_clarification forwards questions and reports skips', async () => {
    const { access } = makeAccess(freshSlides())
    const askClarification = vi.fn(async () => ({ cancelled: true, answers: '' }))
    const skill = createSlidesSkill({ ...access, askClarification })
    const r = await skill.executeTool(
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
