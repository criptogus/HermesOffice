import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseDocx, saveDocx, type SaveBlock } from '../src/index'
import { buildDocx } from './helpers/build-docx'

/**
 * Control characters (tab / break) live in the model as '\t', '\n', '\f', '\v'. Every
 * writer that turns model text back into OOXML must emit the element (<w:tab/>, <w:br/>):
 * a literal control character inside w:t renders as nothing in Word, and it makes an
 * untouched paragraph differ from the original bytes on the next save (the editor then
 * swaps content, resets undo and jumps the scroll position).
 */

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** a w:t whose content holds a literal tab (never valid: must be <w:tab/> instead) */
const LITERAL_TAB_IN_W_T = /<w:t(?:\s[^>]*)?>[^<]*\t[^<]*<\/w:t>/

/** bullet + <w:tab/> + text inside a table cell, with per-run formatting (the shape a
 *  pasted list takes in a cover-page table) */
const CELL_WITH_TAB =
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
  '<w:p><w:pPr><w:tabs><w:tab w:pos="238" w:val="left"/></w:tabs>' +
  '<w:ind w:left="238" w:hanging="238"/></w:pPr>' +
  '<w:r><w:rPr><w:color w:val="E8792B"/><w:sz w:val="14"/></w:rPr><w:t>■</w:t><w:tab/></w:r>' +
  '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">2 reuniões de alinhamento</w:t></w:r>' +
  '</w:p></w:tc></w:tr></w:tbl>'

async function part(bytes: Uint8Array, name: string): Promise<string | null> {
  const file = (await JSZip.loadAsync(bytes)).file(name)
  return file ? file.async('string') : null
}

async function headerPartName(bytes: Uint8Array): Promise<string | null> {
  const zip = await JSZip.loadAsync(bytes)
  return Object.keys(zip.files).find((n) => /^word\/header\d*\.xml$/.test(n)) ?? null
}

async function footerPartName(bytes: Uint8Array): Promise<string | null> {
  const zip = await JSZip.loadAsync(bytes)
  return Object.keys(zip.files).find((n) => /^word\/footer\d*\.xml$/.test(n)) ?? null
}

describe('control characters round-trip', () => {
  it('no edits: a table cell holding <w:tab/> saves byte-identically', async () => {
    const bytes = await buildDocx({ bodyXml: CELL_WITH_TAB })
    const doc = await parseDocx(bytes)
    const blocks: SaveBlock[] = doc.blocks
      .filter((b) => !b.hidden)
      .map((b) => ({ kind: 'original', docxIndex: b.docxIndex! }))
    const saved = await saveDocx(doc, blocks)

    expect(await part(saved, 'word/document.xml')).toBe(await part(bytes, 'word/document.xml'))
    expect(await part(saved, 'word/document.xml')).toContain('<w:tab/>')
  })

  it('plain header text with a tab keeps a real <w:tab/>', async () => {
    const doc = await parseDocx(
      await buildDocx({ bodyXml: '<w:p><w:r><w:t>corpo</w:t></w:r></w:p>' }),
    )
    const blocks: SaveBlock[] = [{ kind: 'original', docxIndex: doc.blocks[0].docxIndex! }]
    const saved = await saveDocx(doc, blocks, {
      header: { text: 'Confidencial\tProposta NRF 2027' },
    })

    const name = await headerPartName(saved)
    expect(name).not.toBeNull()
    const xml = await part(saved, name!)
    expect(xml).toContain('<w:tab/>')
    expect(xml).not.toMatch(LITERAL_TAB_IN_W_T)
    // the text survives the round trip through the parser (tab back as '\t')
    const reparsed = await parseDocx(saved)
    const text = (reparsed.headerParas ?? []).flatMap((p) => p.runs.map((r) => r.text)).join('')
    expect(text).toBe('Confidencial\tProposta NRF 2027')
  })

  it('plain footer text with a tab keeps a real <w:tab/>', async () => {
    const doc = await parseDocx(
      await buildDocx({ bodyXml: '<w:p><w:r><w:t>corpo</w:t></w:r></w:p>' }),
    )
    const blocks: SaveBlock[] = [{ kind: 'original', docxIndex: doc.blocks[0].docxIndex! }]
    const saved = await saveDocx(doc, blocks, {
      footer: { text: 'Página\t1/12' },
    })

    const name = await footerPartName(saved)
    expect(name).not.toBeNull()
    const xml = await part(saved, name!)
    expect(xml).toContain('<w:tab/>')
    expect(xml).not.toMatch(LITERAL_TAB_IN_W_T)
  })

  it('comment text with a tab keeps a real <w:tab/> (rebuild path)', async () => {
    const bytes = await buildDocx({
      bodyXml:
        '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>alvo</w:t></w:r>' +
        '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>',
      extraRels:
        '<Relationship Id="rId40" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
      extraParts: [
        {
          path: 'word/comments.xml',
          xml:
            XML_DECL +
            `<w:comments xmlns:w="${W_NS}">` +
            '<w:comment w:id="1" w:author="Alice"><w:p><w:r><w:t>texto antigo</w:t></w:r></w:p></w:comment>' +
            '</w:comments>',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
        },
      ],
    })
    const doc = await parseDocx(bytes)
    const blocks: SaveBlock[] = doc.blocks
      .filter((b) => !b.hidden)
      .map((b) => ({ kind: 'original', docxIndex: b.docxIndex! }))
    const saved = await saveDocx(doc, blocks, {
      comments: [
        {
          id: '1',
          author: 'Alice',
          text: 'Fase 1\tKickoff com o cliente e a PromoEventos',
        },
      ],
    })

    const xml = await part(saved, 'word/comments.xml')
    expect(xml).toContain('Fase 1')
    expect(xml).toContain('<w:tab/>')
    expect(xml).not.toMatch(LITERAL_TAB_IN_W_T)
  })
})
