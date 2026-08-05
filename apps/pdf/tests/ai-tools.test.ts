import { describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { AGENT_TOOLS, executePdfTool, type PdfAiDeps } from '../src/renderer/ai/tools'
import type { SearchIndex } from '../src/renderer/search'
import type { FormValueInput } from '../src/shared/ipc'

/** Two pages: "Hello World" and "foo bar foo" */
const INDEX: SearchIndex = [
  {
    text: 'Hello World',
    lower: 'hello world',
    items: [{ start: 0, end: 11, x: 0, y: 700, w: 110, h: 12 }],
  },
  {
    text: 'foo bar foo',
    lower: 'foo bar foo',
    items: [{ start: 0, end: 11, x: 0, y: 700, w: 110, h: 12 }],
  },
]

interface Widget {
  subtype?: string
  fieldType?: string
  fieldName?: string
  fieldValue?: unknown
  buttonValue?: string
  readOnly?: boolean
  checkBox?: boolean
  radioButton?: boolean
  options?: { exportValue?: unknown; displayValue?: unknown }[]
}

function fakeDoc(pageTexts: string[], annotsByPage: Widget[][] = []): PDFDocumentProxy {
  return {
    numPages: pageTexts.length,
    getPage: async (n: number) => ({
      getTextContent: async () => ({ items: [{ str: pageTexts[n - 1], hasEOL: true }] }),
      getAnnotations: async () => annotsByPage[n - 1] ?? [],
      cleanup: () => {},
    }),
  } as unknown as PDFDocumentProxy
}

function makeDeps(over: Partial<PdfAiDeps> = {}): PdfAiDeps {
  return {
    doc: () => fakeDoc(['Hello World', 'foo bar foo']),
    fileName: () => 'test.pdf',
    pageCount: () => 2,
    currentPage: () => 1,
    readOnly: () => false,
    outline: () => null,
    searchIndex: () => Promise.resolve(INDEX),
    isDeleted: () => false,
    gotoPage: vi.fn(() => true),
    addMarkup: vi.fn(),
    formEdits: () => new Map<string, FormValueInput>(),
    applyFormEdit: vi.fn(),
    rotatePage: vi.fn(),
    deletePage: vi.fn(() => true),
    webSearch: vi.fn(async () => ({
      results: [{ title: 'Result', url: 'https://example.com', snippet: 'Snippet' }],
      method: 'test',
    })),
    captureEditState: vi.fn(() => ({})),
    restoreEditState: vi.fn(),
    ...over,
  }
}

const call = (name: string, input: Record<string, unknown> = {}) => ({ id: 't1', name, input })

describe('AGENT_TOOLS definitions', () => {
  it('declares unique names and object input schemas with required fields present', () => {
    const names = AGENT_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const tool of AGENT_TOOLS) {
      expect(tool.description ?? tool.name).toBeTruthy()
      expect(tool.inputSchema.type).toBe('object')
      const props = tool.inputSchema.properties as Record<string, unknown>
      for (const req of (tool.inputSchema.required as string[] | undefined) ?? []) {
        expect(props).toHaveProperty(req)
      }
    }
  })

  it('every declared tool is handled by executePdfTool', async () => {
    // A tool falling into the default branch would return "Unknown tool"
    const deps = makeDeps({ doc: () => null, searchIndex: () => null })
    for (const tool of AGENT_TOOLS) {
      const result = await executePdfTool(deps, call(tool.name, { page: 1, start: 1 }))
      expect(result.output).not.toContain('Unknown tool')
    }
  })
})

describe('read_pages', () => {
  it('reads a page range with [Page N] markers', async () => {
    const result = await executePdfTool(makeDeps(), call('read_pages', { start: 1, end: 2 }))
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('[Page 1]')
    expect(result.output).toContain('Hello World')
    expect(result.output).toContain('[Page 2]')
    expect(result.output).toContain('foo bar foo')
  })

  it('rejects an out-of-range start page', async () => {
    const result = await executePdfTool(makeDeps(), call('read_pages', { start: 5 }))
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Invalid page range')
  })

  it('errors when the document is not loaded', async () => {
    const result = await executePdfTool(
      makeDeps({ doc: () => null }),
      call('read_pages', { start: 1 }),
    )
    expect(result.isError).toBe(true)
  })
})

describe('search_text', () => {
  it('returns page numbers with context excerpts', async () => {
    const result = await executePdfTool(makeDeps(), call('search_text', { query: 'FOO' }))
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('Page 2')
    expect(result.output).toContain('foo bar foo')
  })

  it('rejects an empty query', async () => {
    const result = await executePdfTool(makeDeps(), call('search_text', { query: '  ' }))
    expect(result.isError).toBe(true)
  })

  it('reports no matches without erroring', async () => {
    const result = await executePdfTool(makeDeps(), call('search_text', { query: 'zzz' }))
    expect(result.output).toBe('No matches found')
  })
})

describe('goto_page', () => {
  it('scrolls to a valid page', async () => {
    const deps = makeDeps()
    const result = await executePdfTool(deps, call('goto_page', { page: 2 }))
    expect(result.isError).toBeUndefined()
    expect(deps.gotoPage).toHaveBeenCalledWith(2)
  })

  it('rejects out-of-range and deleted pages', async () => {
    const bad = await executePdfTool(makeDeps(), call('goto_page', { page: 3 }))
    expect(bad.isError).toBe(true)
    expect(bad.output).toContain('out of range')

    const deleted = await executePdfTool(
      makeDeps({ isDeleted: (i) => i === 0 }),
      call('goto_page', { page: 1 }),
    )
    expect(deleted.isError).toBe(true)
    expect(deleted.output).toContain('deleted')
  })
})

describe('markup_text', () => {
  it('marks the first occurrence and jumps to the page', async () => {
    const deps = makeDeps()
    const result = await executePdfTool(
      deps,
      call('markup_text', { page: 2, text: 'foo', type: 'highlight' }),
    )
    expect(result.mutated).toBe(true)
    expect(deps.addMarkup).toHaveBeenCalledTimes(1)
    expect(deps.addMarkup).toHaveBeenCalledWith('highlight', 1, expect.any(Array))
    expect(deps.gotoPage).toHaveBeenCalledWith(2)
  })

  it('marks every occurrence with all=true', async () => {
    const deps = makeDeps()
    await executePdfTool(
      deps,
      call('markup_text', { page: 2, text: 'foo', type: 'underline', all: true }),
    )
    expect(deps.addMarkup).toHaveBeenCalledTimes(2)
  })

  it('rejects text not present on the target page', async () => {
    const deps = makeDeps()
    const result = await executePdfTool(
      deps,
      call('markup_text', { page: 1, text: 'foo', type: 'highlight' }),
    )
    expect(result.isError).toBe(true)
    expect(deps.addMarkup).not.toHaveBeenCalled()
  })

  it('rejects invalid types and read-only documents', async () => {
    const badType = await executePdfTool(
      makeDeps(),
      call('markup_text', { page: 1, text: 'Hello', type: 'wavy' }),
    )
    expect(badType.isError).toBe(true)

    const ro = await executePdfTool(
      makeDeps({ readOnly: () => true }),
      call('markup_text', { page: 1, text: 'Hello', type: 'highlight' }),
    )
    expect(ro.isError).toBe(true)
    expect(ro.output).toContain('read-only')
  })
})

describe('form tools', () => {
  const widgets: Widget[][] = [
    [
      { subtype: 'Widget', fieldType: 'Tx', fieldName: 'name', fieldValue: 'Bob' },
      {
        subtype: 'Widget',
        fieldType: 'Btn',
        checkBox: true,
        fieldName: 'agree',
        fieldValue: 'Off',
      },
      {
        subtype: 'Widget',
        fieldType: 'Btn',
        radioButton: true,
        fieldName: 'color',
        buttonValue: 'red',
        fieldValue: '',
      },
      {
        subtype: 'Widget',
        fieldType: 'Btn',
        radioButton: true,
        fieldName: 'color',
        buttonValue: 'blue',
        fieldValue: '',
      },
      {
        subtype: 'Widget',
        fieldType: 'Ch',
        fieldName: 'size',
        fieldValue: 'M',
        options: [{ exportValue: 'S' }, { exportValue: 'M' }, { displayValue: 'Large' }],
      },
      { subtype: 'Widget', fieldType: 'Tx', fieldName: 'locked', readOnly: true },
      { subtype: 'Link' },
    ],
  ]
  const withForm = (over: Partial<PdfAiDeps> = {}) =>
    makeDeps({ doc: () => fakeDoc(['form page'], widgets), pageCount: () => 1, ...over })

  it('lists fields with kinds, aggregated radio options, and skips read-only widgets', async () => {
    const result = await executePdfTool(withForm(), call('list_form_fields'))
    expect(result.output).toContain('name (text, page 1)')
    expect(result.output).toContain('agree (checkbox, page 1)')
    expect(result.output).toContain('options[red, blue]')
    expect(result.output).toContain('options[S, M, Large]')
    expect(result.output).not.toContain('locked')
  })

  it('shows pending unsaved edits instead of stored values', async () => {
    const edits = new Map<string, FormValueInput>([
      ['name', { name: 'name', kind: 'text', value: 'Alice' }],
      ['agree', { name: 'agree', kind: 'checkbox', checked: true }],
    ])
    const result = await executePdfTool(
      withForm({ formEdits: () => edits }),
      call('list_form_fields'),
    )
    expect(result.output).toContain('current value: Alice')
    expect(result.output).toContain('current value: true')
  })

  it('fills a text field and jumps to its page', async () => {
    const deps = withForm()
    const result = await executePdfTool(
      deps,
      call('fill_form_field', { name: 'name', value: 'Alice' }),
    )
    expect(result.mutated).toBe(true)
    expect(deps.applyFormEdit).toHaveBeenCalledWith({ name: 'name', kind: 'text', value: 'Alice' })
    expect(deps.gotoPage).toHaveBeenCalledWith(1)
  })

  it('requires checked for checkboxes and validates choice options', async () => {
    const noChecked = await executePdfTool(withForm(), call('fill_form_field', { name: 'agree' }))
    expect(noChecked.isError).toBe(true)

    const badOption = await executePdfTool(
      withForm(),
      call('fill_form_field', { name: 'size', value: 'XXL' }),
    )
    expect(badOption.isError).toBe(true)
    expect(badOption.output).toContain('not among the options')

    const deps = withForm()
    const ok = await executePdfTool(deps, call('fill_form_field', { name: 'color', value: 'blue' }))
    expect(ok.mutated).toBe(true)
    expect(deps.applyFormEdit).toHaveBeenCalledWith({ name: 'color', kind: 'radio', value: 'blue' })
  })

  it('rejects unknown field names', async () => {
    const result = await executePdfTool(
      withForm(),
      call('fill_form_field', { name: 'nope', value: 'x' }),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('No field named')
  })
})

describe('rotate_page / delete_page', () => {
  it('maps direction to a signed 90-degree delta', async () => {
    const deps = makeDeps()
    await executePdfTool(deps, call('rotate_page', { page: 1, direction: 'left' }))
    expect(deps.rotatePage).toHaveBeenCalledWith(0, -90)
    await executePdfTool(deps, call('rotate_page', { page: 2, direction: 'right' }))
    expect(deps.rotatePage).toHaveBeenCalledWith(1, 90)
  })

  it('deletes a page and reports failure when the last page must remain', async () => {
    const deps = makeDeps()
    const ok = await executePdfTool(deps, call('delete_page', { page: 2 }))
    expect(ok.mutated).toBe(true)
    expect(deps.deletePage).toHaveBeenCalledWith(1)

    const blocked = await executePdfTool(
      makeDeps({ deletePage: () => false }),
      call('delete_page', { page: 1 }),
    )
    expect(blocked.isError).toBe(true)
  })

  it('blocks mutations on read-only documents', async () => {
    const deps = makeDeps({ readOnly: () => true })
    for (const c of [
      call('rotate_page', { page: 1, direction: 'left' }),
      call('delete_page', { page: 1 }),
    ]) {
      const result = await executePdfTool(deps, c)
      expect(result.isError).toBe(true)
      expect(deps.rotatePage).not.toHaveBeenCalled()
      expect(deps.deletePage).not.toHaveBeenCalled()
    }
  })
})

describe('get_outline / unknown tools', () => {
  it('renders the outline tree with indentation', async () => {
    const deps = makeDeps({
      outline: () => [
        { title: 'Chapter 1', items: [{ title: 'Section 1.1' }] },
        { title: 'Chapter 2' },
      ],
    })
    const result = await executePdfTool(deps, call('get_outline'))
    expect(result.output).toBe('Chapter 1\n  Section 1.1\nChapter 2')
  })

  it('reports when the document has no outline', async () => {
    const result = await executePdfTool(makeDeps(), call('get_outline'))
    expect(result.output).toContain('no outline')
  })

  it('errors on unknown tool names', async () => {
    const result = await executePdfTool(makeDeps(), call('nope'))
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Unknown tool')
  })
})

describe('web_search', () => {
  it('formats results as numbered title/url/snippet lines', async () => {
    const deps = makeDeps()
    const result = await executePdfTool(deps, call('web_search', { query: 'hermes' }))
    expect(deps.webSearch).toHaveBeenCalledWith('hermes', 6)
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('1. Result')
    expect(result.output).toContain('https://example.com')
  })

  it('passes maxResults through and errors on an empty query', async () => {
    const deps = makeDeps()
    await executePdfTool(deps, call('web_search', { query: 'x', maxResults: 3 }))
    expect(deps.webSearch).toHaveBeenCalledWith('x', 3)
    const bad = await executePdfTool(deps, call('web_search', { query: '  ' }))
    expect(bad.isError).toBe(true)
  })

  it('reports empty result sets', async () => {
    const deps = makeDeps({ webSearch: async () => ({ results: [], method: 'test' }) })
    const result = await executePdfTool(deps, call('web_search', { query: 'nothing' }))
    expect(result.output).toContain('(no results)')
  })
})
