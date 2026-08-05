import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AgentToolCall, AgentToolDef, ToolExecution } from '@hermesoffice/agent-core'
import type { OutlineNode } from '../OutlinePanel'
import type { SearchIndex } from '../search'
import { searchInIndex } from '../search'
import type { FormValueInput, MarkupType } from '../../shared/ipc'
import { t } from '../i18n/locale'

/** Text cap per read_pages fed back to the model (the payload is resent in full each turn, so volume must be limited) */
const READ_CHUNK_CHARS = 24_000

/** Capability surface App provides to AI tools; all getters, since the loop outlives render closures */
export interface PdfAiDeps {
  doc(): PDFDocumentProxy | null
  fileName(): string
  /** Fork: caminho absoluto do arquivo aberto (p/ leitura via engine/MCP) */
  filePath(): string
  pageCount(): number
  /** Original page number of the currently visible page (1-based) */
  currentPage(): number
  readOnly(): boolean
  outline(): OutlineNode[] | null
  searchIndex(): Promise<SearchIndex> | null
  isDeleted(origIdx: number): boolean
  /** Original page number → scroll to that page; returns false if the page was deleted */
  gotoPage(origPage: number): boolean
  addMarkup(type: MarkupType, origIdx: number, rects: [number, number, number, number][]): void
  formEdits(): ReadonlyMap<string, FormValueInput>
  applyFormEdit(v: FormValueInput): void
  rotatePage(origIdx: number, dir: 90 | -90): void
  deletePage(origIdx: number): boolean
  webSearch(
    query: string,
    maxResults?: number,
  ): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>
    answer?: string
    method: string
  }>
  /** Full copy of the unsaved-edit state (markups/forms/rotations/deletions/…) for AI rollback */
  captureEditState(): unknown
  /** Restore a state captured by captureEditState (pushes the current state onto the undo stack) */
  restoreEditState(state: unknown): void
  /** Sticky-note annotation at PDF user-space coords; the app picks a default position when at is omitted */
  addNote(origIdx: number, text: string, at?: [number, number]): void
  /** Set (merge over defaults) or clear (null) the document watermark */
  setWatermark(cfg: { text: string; angle?: number; opacity?: number; color?: string } | null): void
  /** Set (merge over defaults) or clear (null) headers/footers; pageNumber enables auto page numbers in the footer center */
  setHeaderFooter(
    cfg: {
      headerLeft?: string
      headerCenter?: string
      headerRight?: string
      footerLeft?: string
      footerCenter?: string
      footerRight?: string
      pageNumber?: boolean
    } | null,
  ): void
  /** Reorder among visible pages (0-based positions); false when out of range or read-only */
  movePage(fromPos: number, toPos: number): boolean
  /** Number of visible (non-deleted) pages, for move_page bounds */
  visiblePageCount(): number
}

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: 'read_pages',
    description:
      'Read the text content of a page range (with [Page N] markers). Read the relevant pages before answering questions; at most 10 pages per call, over-long output is truncated.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'integer', description: 'Start page number (1-based)' },
        end: {
          type: 'integer',
          description: 'End page number (inclusive); if omitted, only the start page is read',
        },
      },
      required: ['start'],
    },
  },
  {
    name: 'search_text',
    description:
      'Search the full text for a string; returns the page number and a context excerpt for each hit. Prefer this when locating which page something is on.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for (case-insensitive)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'goto_page',
    description: 'Scroll the reading view to the given page so the user can see it.',
    inputSchema: {
      type: 'object',
      properties: { page: { type: 'integer', description: 'Page number (1-based)' } },
      required: ['page'],
    },
  },
  {
    name: 'markup_text',
    description:
      'Add a markup (highlight/underline/strikeout) to a text passage on the given page. text must be a verbatim fragment that actually exists on that page (confirm with read_pages or search_text first); by default only the first occurrence is marked, all=true marks every occurrence on that page.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Page number (1-based)' },
        text: { type: 'string', description: 'Verbatim text fragment from the page' },
        type: {
          type: 'string',
          enum: ['highlight', 'underline', 'strikeout'],
          description: 'Markup type',
        },
        all: {
          type: 'boolean',
          description: 'Whether to mark every occurrence on the page; defaults to false',
        },
      },
      required: ['page', 'text', 'type'],
    },
  },
  {
    name: 'list_form_fields',
    description:
      'List all form fields in the document (name/type/current value/options/page). Must be called before filling forms to learn the fields.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'fill_form_field',
    description:
      'Fill in one form field. For text/choice/radio fields pass value (radio: the exportValue; choice: an option exportValue); for checkboxes pass checked.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Field name (from list_form_fields)' },
        value: { type: 'string', description: 'Value for text/choice/radio fields' },
        checked: { type: 'boolean', description: 'Checked state for checkboxes' },
      },
      required: ['name'],
    },
  },
  {
    name: 'rotate_page',
    description: 'Rotate the given page 90 degrees clockwise or counterclockwise.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Page number (1-based)' },
        direction: {
          type: 'string',
          enum: ['left', 'right'],
          description: 'left = counterclockwise, right = clockwise',
        },
      },
      required: ['page', 'direction'],
    },
  },
  {
    name: 'delete_page',
    description: 'Delete the given page (takes effect on save; the user can undo before saving).',
    inputSchema: {
      type: 'object',
      properties: { page: { type: 'integer', description: 'Page number (1-based)' } },
      required: ['page'],
    },
  },
  {
    name: 'add_note',
    description:
      'Add a sticky-note annotation to a page. Use for comments/observations anchored to a page rather than to a text passage (for text passages use markup_text). Coordinates are optional PDF points from the bottom-left corner; omit them to place the note near the top-left of the page.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Page number (1-based)' },
        text: { type: 'string', description: 'Note content' },
        x: { type: 'number', description: 'Optional x position in PDF points' },
        y: { type: 'number', description: 'Optional y position in PDF points' },
      },
      required: ['page', 'text'],
    },
  },
  {
    name: 'set_watermark',
    description:
      'Set or remove the document watermark (applies to every page on save). Pass an empty text to remove it.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Watermark text; empty string removes the watermark' },
        angle: { type: 'number', description: 'Counterclockwise angle in degrees, default 35' },
        opacity: { type: 'number', description: '0–1, default 0.18' },
        color: { type: 'string', description: 'CSS hex color, default #d0342c' },
      },
      required: ['text'],
    },
  },
  {
    name: 'set_header_footer',
    description:
      'Set or remove page headers/footers (left/center/right slots; applied to every page on save). pageNumber=true prints automatic page numbers in the footer center. remove=true clears all headers/footers.',
    inputSchema: {
      type: 'object',
      properties: {
        headerLeft: { type: 'string' },
        headerCenter: { type: 'string' },
        headerRight: { type: 'string' },
        footerLeft: { type: 'string' },
        footerCenter: { type: 'string' },
        footerRight: { type: 'string' },
        pageNumber: {
          type: 'boolean',
          description: 'Automatic page number in the footer center (overrides footerCenter)',
        },
        remove: { type: 'boolean', description: 'true removes all headers/footers' },
      },
    },
  },
  {
    name: 'move_page',
    description:
      'Move a page to a different position in the document (page assembly; takes effect on save). Both values are 1-based positions among the currently visible pages.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Current position of the page to move (1-based)' },
        to: { type: 'integer', description: 'Target position (1-based)' },
      },
      required: ['page', 'to'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the web for textual information (references/data/facts). Use when you need up-to-date information or are unsure about a fact. Returns titles/links/snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'search keywords' },
        maxResults: { type: 'integer', description: 'maximum number of results, default 6' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_outline',
    description:
      'Read the document outline (bookmarks) tree, including entry titles. Returns empty if the document has no outline.',
    inputSchema: { type: 'object', properties: {} },
  },
]

const READONLY_OUTPUT =
  'The document is encrypted and read-only; it cannot be modified. Inform the user.'

function err(output: string, summary: string): ToolExecution {
  return { output, isError: true, summary }
}

/** Validate a 1-based page number; returns the original page index or an error */
function resolvePage(deps: PdfAiDeps, raw: unknown): { origIdx: number } | { bad: string } {
  const page = Number(raw)
  if (!Number.isInteger(page) || page < 1 || page > deps.pageCount()) {
    return {
      bad: `Page number ${String(raw)} is out of range (document has ${deps.pageCount()} pages)`,
    }
  }
  if (deps.isDeleted(page - 1)) return { bad: `Page ${page} has been deleted (unsaved)` }
  return { origIdx: page - 1 }
}

async function readPages(deps: PdfAiDeps, input: Record<string, unknown>): Promise<ToolExecution> {
  const doc = deps.doc()
  if (!doc) return err('Document not ready', t('aiToolReadPages', { start: '?', end: '?' }))
  const start = Number(input.start)
  const end = Math.min(Number(input.end ?? start), start + 9)
  const summary = t('aiToolReadPages', { start, end })
  if (!Number.isInteger(start) || start < 1 || end < start || start > doc.numPages) {
    return err(`Invalid page range (document has ${doc.numPages} pages)`, summary)
  }
  let out = ''
  for (let n = start; n <= Math.min(end, doc.numPages); n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      if ('str' in item) {
        text += item.str
        if (item.hasEOL) text += '\n'
      }
    }
    page.cleanup()
    out += `[Page ${n}]\n${text.trim()}\n\n`
    if (out.length > READ_CHUNK_CHARS) {
      out = `${out.slice(0, READ_CHUNK_CHARS)}\n… (truncated; read the rest in further calls)`
      break
    }
  }
  return {
    output: out.trim() || '(No extractable text in this range; the pages may be scanned images)',
    summary,
  }
}

async function searchText(deps: PdfAiDeps, input: Record<string, unknown>): Promise<ToolExecution> {
  const query = String(input.query ?? '').trim()
  if (!query) return err('query must not be empty', t('aiToolSearch', { query: '', count: 0 }))
  const indexPromise = deps.searchIndex()
  if (!indexPromise) return err('Document not ready', t('aiToolSearch', { query, count: 0 }))
  const index = await indexPromise
  const matches = searchInIndex(index, query)
  const lines: string[] = []
  for (const m of matches.slice(0, 40)) {
    const entry = index[m.pageIndex]!
    const pos = entry.lower.indexOf(query.toLowerCase())
    const from = Math.max(0, pos - 40)
    const snippet = entry.text.slice(from, pos + query.length + 40).replace(/\s+/g, ' ')
    lines.push(`Page ${m.pageIndex + 1}: …${snippet}…`)
  }
  if (matches.length > 40) lines.push(`(${matches.length} matches total; only the first 40 listed)`)
  return {
    output: lines.join('\n') || 'No matches found',
    summary: t('aiToolSearch', { query, count: matches.length }),
  }
}

async function markupText(deps: PdfAiDeps, input: Record<string, unknown>): Promise<ToolExecution> {
  const type = String(input.type) as MarkupType
  const summary = t('aiToolMarkup', { page: Number(input.page) })
  if (deps.readOnly()) return err(READONLY_OUTPUT, summary)
  if (!['highlight', 'underline', 'strikeout'].includes(type))
    return err(`Invalid type: ${type}`, summary)
  const r = resolvePage(deps, input.page)
  if ('bad' in r) return err(r.bad, summary)
  const text = String(input.text ?? '').trim()
  if (!text) return err('text must not be empty', summary)
  const indexPromise = deps.searchIndex()
  if (!indexPromise) return err('Document not ready', summary)
  const index = await indexPromise
  const onPage = searchInIndex(index, text).filter((m) => m.pageIndex === r.origIdx)
  if (onPage.length === 0) {
    return err(
      `"${text}" not found on page ${r.origIdx + 1}; use read_pages to verify the exact text`,
      summary,
    )
  }
  const targets = input.all === true ? onPage : onPage.slice(0, 1)
  for (const m of targets) deps.addMarkup(type, r.origIdx, m.rects)
  deps.gotoPage(r.origIdx + 1)
  return {
    output: `Marked ${targets.length} occurrence(s) on page ${r.origIdx + 1} (unsaved; the user saves with ⌘S)`,
    mutated: true,
    summary,
  }
}

interface RawWidget {
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

/** Whole-document form field inventory (radios aggregate exportValue lists by field name) */
async function collectFields(
  doc: PDFDocumentProxy,
): Promise<Map<string, { kind: string; page: number; value: string; options: string[] }>> {
  const fields = new Map<string, { kind: string; page: number; value: string; options: string[] }>()
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const annots = (await page.getAnnotations()) as RawWidget[]
    for (const a of annots) {
      if (a.subtype !== 'Widget' || !a.fieldName || a.readOnly) continue
      const value = Array.isArray(a.fieldValue)
        ? String(a.fieldValue[0] ?? '')
        : String(a.fieldValue ?? '')
      if (a.fieldType === 'Tx') {
        fields.set(a.fieldName, { kind: 'text', page: n, value, options: [] })
      } else if (a.fieldType === 'Btn' && a.checkBox) {
        fields.set(a.fieldName, { kind: 'checkbox', page: n, value, options: [] })
      } else if (a.fieldType === 'Btn' && a.radioButton) {
        const cur = fields.get(a.fieldName) ?? { kind: 'radio', page: n, value, options: [] }
        if (typeof a.buttonValue === 'string' && !cur.options.includes(a.buttonValue))
          cur.options.push(a.buttonValue)
        fields.set(a.fieldName, cur)
      } else if (a.fieldType === 'Ch') {
        fields.set(a.fieldName, {
          kind: 'choice',
          page: n,
          value,
          options: (a.options ?? [])
            .map((o) => String(o.exportValue ?? o.displayValue ?? ''))
            .filter(Boolean),
        })
      }
    }
  }
  return fields
}

async function listFormFields(deps: PdfAiDeps): Promise<ToolExecution> {
  const doc = deps.doc()
  if (!doc) return err('Document not ready', t('aiToolFields', { count: 0 }))
  const fields = await collectFields(doc)
  const edits = deps.formEdits()
  const lines = [...fields].map(([name, f]) => {
    const edit = edits.get(name)
    const value = edit
      ? edit.kind === 'checkbox'
        ? String(!!edit.checked)
        : (edit.value ?? '')
      : f.value
    const opts = f.options.length > 0 ? ` options[${f.options.join(', ')}]` : ''
    return `${name} (${f.kind}, page ${f.page})${opts} current value: ${value || '(empty)'}`
  })
  return {
    output: lines.join('\n') || 'The document has no form fields',
    summary: t('aiToolFields', { count: fields.size }),
  }
}

async function fillFormField(
  deps: PdfAiDeps,
  input: Record<string, unknown>,
): Promise<ToolExecution> {
  const name = String(input.name ?? '')
  const summary = t('aiToolFill', { name })
  if (deps.readOnly()) return err(READONLY_OUTPUT, summary)
  const doc = deps.doc()
  if (!doc || !name) return err('Document not ready or name is empty', summary)
  const fields = await collectFields(doc)
  const field = fields.get(name)
  if (!field)
    return err(`No field named "${name}"; use list_form_fields to see the fields`, summary)
  let edit: FormValueInput
  if (field.kind === 'checkbox') {
    if (typeof input.checked !== 'boolean')
      return err('Checkbox requires the checked parameter', summary)
    edit = { name, kind: 'checkbox', checked: input.checked }
  } else {
    const value = String(input.value ?? '')
    if (field.kind !== 'text' && value && !field.options.includes(value)) {
      return err(
        `Value "${value}" is not among the options: [${field.options.join(', ')}]`,
        summary,
      )
    }
    edit = { name, kind: field.kind as 'text' | 'radio' | 'choice', value }
  }
  deps.applyFormEdit(edit)
  deps.gotoPage(field.page)
  return { output: `Filled ${name} (unsaved; the user saves with ⌘S)`, mutated: true, summary }
}

export async function executePdfTool(deps: PdfAiDeps, call: AgentToolCall): Promise<ToolExecution> {
  const input = call.input
  switch (call.name) {
    case 'read_pages':
      return readPages(deps, input)
    case 'search_text':
      return searchText(deps, input)
    case 'goto_page': {
      const summary = t('aiToolGoto', { page: Number(input.page) })
      const r = resolvePage(deps, input.page)
      if ('bad' in r) return err(r.bad, summary)
      deps.gotoPage(r.origIdx + 1)
      return { output: `Jumped to page ${r.origIdx + 1}`, summary }
    }
    case 'markup_text':
      return markupText(deps, input)
    case 'list_form_fields':
      return listFormFields(deps)
    case 'fill_form_field':
      return fillFormField(deps, input)
    case 'rotate_page': {
      const summary = t('aiToolRotate', { page: Number(input.page) })
      if (deps.readOnly()) return err(READONLY_OUTPUT, summary)
      const r = resolvePage(deps, input.page)
      if ('bad' in r) return err(r.bad, summary)
      deps.rotatePage(r.origIdx, input.direction === 'left' ? -90 : 90)
      deps.gotoPage(r.origIdx + 1)
      return { output: `Rotated page ${r.origIdx + 1} (unsaved)`, mutated: true, summary }
    }
    case 'delete_page': {
      const summary = t('aiToolDelete', { page: Number(input.page) })
      if (deps.readOnly()) return err(READONLY_OUTPUT, summary)
      const r = resolvePage(deps, input.page)
      if ('bad' in r) return err(r.bad, summary)
      if (!deps.deletePage(r.origIdx)) return err('At least one page must remain', summary)
      return {
        output: `Deleted page ${r.origIdx + 1} (unsaved; can be undone)`,
        mutated: true,
        summary,
      }
    }
    case 'add_note': {
      const summary = t('aiToolNote', { page: Number(input.page) })
      if (deps.readOnly()) return err(READONLY_OUTPUT, summary)
      const r = resolvePage(deps, input.page)
      if ('bad' in r) return err(r.bad, summary)
      const text = String(input.text ?? '').trim()
      if (!text) return err('text must not be empty', summary)
      const x = Number(input.x)
      const y = Number(input.y)
      const at: [number, number] | undefined =
        Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined
      deps.addNote(r.origIdx, text, at)
      deps.gotoPage(r.origIdx + 1)
      return {
        output: `Added a note to page ${r.origIdx + 1} (unsaved; the user saves with ⌘S)`,
        mutated: true,
        summary,
      }
    }
    case 'set_watermark': {
      const text = String(input.text ?? '').trim()
      const summary = t(text ? 'aiToolWatermark' : 'aiToolWatermarkRemove')
      if (deps.readOnly()) return err(READONLY_OUTPUT, summary)
      if (!text) {
        deps.setWatermark(null)
        return { output: 'Watermark removed (unsaved)', mutated: true, summary }
      }
      const opacity = Number(input.opacity)
      const angle = Number(input.angle)
      deps.setWatermark({
        text,
        ...(Number.isFinite(angle) ? { angle } : {}),
        ...(Number.isFinite(opacity) ? { opacity: Math.min(1, Math.max(0, opacity)) } : {}),
        ...(typeof input.color === 'string' && input.color ? { color: input.color } : {}),
      })
      return {
        output: `Watermark "${text}" set on every page (unsaved; the user saves with ⌘S)`,
        mutated: true,
        summary,
      }
    }
    case 'set_header_footer': {
      const remove = input.remove === true
      const summary = t(remove ? 'aiToolHeaderFooterRemove' : 'aiToolHeaderFooter')
      if (deps.readOnly()) return err(READONLY_OUTPUT, summary)
      if (remove) {
        deps.setHeaderFooter(null)
        return { output: 'Headers/footers removed (unsaved)', mutated: true, summary }
      }
      const str = (v: unknown) => (typeof v === 'string' ? { defined: true, value: v } : null)
      const cfg: Parameters<PdfAiDeps['setHeaderFooter']>[0] = {}
      for (const key of [
        'headerLeft',
        'headerCenter',
        'headerRight',
        'footerLeft',
        'footerCenter',
        'footerRight',
      ] as const) {
        const s = str(input[key])
        if (s) cfg[key] = s.value
      }
      if (typeof input.pageNumber === 'boolean') cfg.pageNumber = input.pageNumber
      if (Object.keys(cfg).length === 0)
        return err('Provide at least one header/footer field, pageNumber, or remove=true', summary)
      deps.setHeaderFooter(cfg)
      return {
        output: 'Headers/footers set (unsaved; the user saves with ⌘S)',
        mutated: true,
        summary,
      }
    }
    case 'move_page': {
      const from = Number(input.page)
      const to = Number(input.to)
      const summary = t('aiToolMovePage', { page: from, to })
      if (deps.readOnly()) return err(READONLY_OUTPUT, summary)
      const count = deps.visiblePageCount()
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 1 ||
        to < 1 ||
        from > count ||
        to > count
      ) {
        return err(`Positions must be between 1 and ${count}`, summary)
      }
      if (from === to) return err('page and to are the same position', summary)
      if (!deps.movePage(from - 1, to - 1)) return err('The page could not be moved', summary)
      return {
        output: `Moved the page from position ${from} to position ${to} (unsaved; the user saves with ⌘S)`,
        mutated: true,
        summary,
      }
    }
    case 'web_search': {
      const query = String(input.query ?? '').trim()
      const summary = t('aiToolWebSearch', { query })
      if (!query) return err('query must not be empty', summary)
      const r = await deps.webSearch(query, Number(input.maxResults) || 6)
      const lines: string[] = []
      if (r.answer) lines.push(`Direct answer: ${r.answer}\n`)
      r.results.forEach((it, i) =>
        lines.push(`${i + 1}. ${it.title}\n   ${it.url}\n   ${it.snippet}`),
      )
      return { output: lines.join('\n') || '(no results)', summary }
    }
    case 'get_outline': {
      const outline = deps.outline()
      const lines: string[] = []
      const walk = (nodes: OutlineNode[], depth: number) => {
        for (const n of nodes) {
          lines.push(`${'  '.repeat(depth)}${n.title}`)
          if (n.items) walk(n.items, depth + 1)
        }
      }
      if (outline) walk(outline, 0)
      return {
        output: lines.join('\n') || 'The document has no outline',
        summary: t('aiToolOutline'),
      }
    }
    default:
      return err(`Unknown tool: ${call.name}`, call.name)
  }
}
