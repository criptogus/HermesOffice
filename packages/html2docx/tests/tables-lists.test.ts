import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { test } from 'vitest'
import { generateDocx } from '../src/generate'

function cell(text: string) {
  return { runs: [{ text }] }
}

function item(text: string, level = 0) {
  return { runs: [{ text }], level }
}

// Pure generation-layer coverage: hand-built intent trees straight into
// generateDocx, so these cases run without a browser.
async function documentParts(ir: unknown[]) {
  const buffer = await generateDocx(ir, {})
  const zip = await JSZip.loadAsync(buffer)
  const read = async (name: string) => (await zip.file(name)?.async('string')) ?? ''
  return {
    documentXml: await read('word/document.xml'),
    numberingXml: await read('word/numbering.xml'),
  }
}

test('converts a table with a header row', async () => {
  const { documentXml } = await documentParts([
    {
      type: 'table',
      colWidths: [300, 300],
      rows: [
        { header: true, cells: [cell('Name'), cell('Value')] },
        { cells: [cell('Revenue'), cell('100')] },
      ],
    },
  ])
  assert.match(documentXml, /<w:tbl>/)
  assert.match(documentXml, /Name/)
  assert.match(documentXml, /Value/)
  assert.match(documentXml, /Revenue/)
  assert.match(documentXml, /100/)
  assert.equal((documentXml.match(/<w:tr>/g) || []).length, 2)
  assert.equal((documentXml.match(/<w:tc>/g) || []).length, 4)
  // only the header row repeats at the top of each page
  assert.equal((documentXml.match(/w:tblHeader/g) || []).length, 1)
  assert.ok(documentXml.indexOf('Name') < documentXml.indexOf('Revenue'))
})

test('converts a bullet list with a nested level', async () => {
  const { documentXml, numberingXml } = await documentParts([
    {
      type: 'list',
      ordered: false,
      items: [item('Parent', 0), item('Child', 1), item('Sibling', 0)],
    },
  ])
  assert.match(documentXml, /Parent/)
  assert.match(documentXml, /Child/)
  assert.match(documentXml, /Sibling/)
  assert.match(numberingXml, /w:numFmt w:val="bullet"/)
  const levels = [...documentXml.matchAll(/w:ilvl w:val="(\d+)"/g)].map((match) => match[1])
  assert.deepEqual(levels, ['0', '1', '0'])
})

test('converts an ordered list with decimal numbering', async () => {
  const { documentXml, numberingXml } = await documentParts([
    {
      type: 'list',
      ordered: true,
      items: [item('First'), item('Second')],
    },
  ])
  assert.match(documentXml, /First/)
  assert.match(documentXml, /Second/)
  assert.match(numberingXml, /w:numFmt w:val="decimal"/)
  assert.equal((documentXml.match(/w:numPr/g) || []).length, 4)
})
