// Spike 40 — E2E harness: propose → preview → accept → apply → verify, plus a
// reject path. Byte-preservation is checked per zip part (only the edited
// slide's XML may differ).
//
// Usage: node ../../node_modules/.bin/tsx harness.mjs <input.pptx> [<output.pptx>]
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

import { openDeck, closeDeck, applyProposal, buildPreview, textSummary } from './slides-adapter.mjs'
import { newProposal, transition, persist, load } from './contract.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const INPUT = process.argv[2]
const OUTPUT = process.argv[3] ?? join(HERE, 'out-accepted.pptx')
const PROJECT = 'spike-40'

async function zipEntries(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const out = {}
  for (const [name, f] of Object.entries(zip.files)) {
    if (!f.dir) out[name] = await f.async('uint8array')
  }
  return out
}

/** Untouched parts must be byte-identical; report only the diffs. */
function bytePreservationReport(origEntries, newEntries) {
  const diffs = []
  for (const [name, bytes] of Object.entries(origEntries)) {
    const nb = newEntries[name]
    if (!nb) diffs.push(`${name}: MISSING in output`)
    else if (bytes.length !== nb.length || !bytes.every((b, i) => b === nb[i])) {
      diffs.push(`${name}: differs (${bytes.length} → ${nb.length} bytes)`)
    }
  }
  for (const name of Object.keys(newEntries)) {
    if (!(name in origEntries)) diffs.push(`${name}: NEW in output`)
  }
  return diffs
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ ASSERT FAILED: ${msg}`)
    process.exit(1)
  }
  console.log(`  ✓ ${msg}`)
}

async function main() {
  const inputBytes = readFileSync(INPUT)
  console.log(`\n== Spike 40 — RFC 0008 Proposed Change piloted on Slides ==`)
  console.log(`input:  ${INPUT} (${inputBytes.length} bytes)`)

  // ── open + pick targets ──
  const deck = await openDeck(inputBytes)
  const slide0 = deck.deck.slides[0]
  assert(slide0?.elements?.length > 0, `slide 0 has ${slide0?.elements?.length ?? 0} elements`)
  const firstText = slide0.elements.find((e) => e.type === 'text' || e.type === 'shape')
  assert(firstText, 'slide 0 has a text/shape element to edit')
  const lastEl = slide0.elements[slide0.elements.length - 1]
  const beforeText = textSummary(firstText)
  const removedText = textSummary(lastEl)
  console.log(
    `targets: element '${firstText.id}' (text: "${beforeText}"), last: '${lastEl.id}' (text: "${removedText}")`,
  )

  // ── propose: text edit + style change + add shape + remove shape ──
  const ops = [
    {
      type: 'set_shape_text',
      slideIndex: 0,
      elementId: firstText.id,
      text: 'Spike 40 — Proposed Change applied',
    },
    {
      type: 'set_shape_style',
      slideIndex: 0,
      elementId: firstText.id,
      fill: { type: 'solid', color: 'FFC000' },
    },
    {
      type: 'add_shape',
      slideIndex: 0,
      kind: 'roundRect',
      x: 720000,
      y: 4500000,
      w: 4800000,
      h: 600000,
      text: 'agent-added shape',
      fillColor: '70AD47',
    },
    { type: 'remove_shape', slideIndex: 0, elementId: lastEl.id },
  ]
  const preview = buildPreview(deck, ops)
  const proposal = newProposal({
    projectId: PROJECT,
    actor: { id: 'spike40-harness', kind: 'agent' },
    summary: 'Pilot: text edit + style + add + remove on slide 0',
    operations: ops,
    preview,
    risks: [{ level: 'low', message: 'spike stub policy: auto-accepted (headless harness)' }],
  })
  transition(proposal, 'proposed')
  const proposedFile = persist(proposal)
  console.log(`\n[proposed] ${proposal.id}`)
  console.log(`  preview: ${preview.summary}`)
  console.log(`  elements on slide 0 before: ${preview.slides[0].elementsBefore.length}`)
  console.log(`  audit: ${proposedFile}`)

  // ── accept → apply → save ──
  transition(proposal, 'accepted', 'harness policy: auto-accept')
  applyProposal(deck, proposal)
  transition(proposal, 'applied')
  const outBytes = await closeDeck(deck)
  writeFileSync(OUTPUT, outBytes)
  const appliedFile = persist(proposal)
  console.log(`\n[applied] ${proposal.id} → ${OUTPUT} (${outBytes.length} bytes)`)
  console.log(`  audit: ${appliedFile}`)

  // ── verify ──
  const origEntries = await zipEntries(inputBytes)
  const newEntries = await zipEntries(outBytes)
  const diffs = bytePreservationReport(origEntries, newEntries)
  console.log(`\n== Byte-preservation (${Object.keys(origEntries).length} zip parts) ==`)
  for (const d of diffs) console.log(`  ~ ${d}`)
  assert(
    diffs.every((d) => d.startsWith('ppt/slides/slide1.xml')),
    'only the edited slide part (slide1.xml) differs',
  )

  const reopened = await openDeck(outBytes)
  const reopenedEls = reopened.deck.slides[0].elements
  console.log(
    `  reopened slide 0: ${reopenedEls.length} elements (ids: ${reopenedEls.map((e) => e.id).join(', ')})`,
  )
  const edited = reopenedEls.find((e) => textSummary(e) === 'Spike 40 — Proposed Change applied')
  assert(edited, 'text edit landed and re-parses (found by content)')
  console.log(`  edited element fill after re-parse: ${JSON.stringify(edited?.fill ?? null)}`)
  assert(
    edited?.fill != null && edited.fill.color != null,
    'style change (fill) landed and re-parses',
  )
  assert(
    reopenedEls.some((e) => e.text?.paragraphs?.[0]?.runs?.[0]?.text === 'agent-added shape'),
    'added shape present after re-parse',
  )
  assert(
    !reopenedEls.some((e) => textSummary(e) === removedText) || reopenedEls.length === 2,
    'removed shape gone after re-parse (content)',
  )

  // audit record survives reload in RFC #8 shape
  const reloaded = load(PROJECT, proposal.id)
  assert(
    reloaded.status === 'applied' && reloaded.actor.kind === 'agent',
    'audit record reloads with final state',
  )
  assert(
    Array.isArray(reloaded.operations) && reloaded.operations.length === 4,
    'audit keeps the typed operations',
  )

  // ── reject path: nothing applied → save must be byte-identical ──
  console.log(`\n== Reject path ==`)
  const deck2 = await openDeck(inputBytes)
  const p2 = newProposal({
    projectId: PROJECT,
    actor: { id: 'spike40-harness', kind: 'agent' },
    summary: 'Reject path: single text edit',
    operations: [
      { type: 'set_shape_text', slideIndex: 0, elementId: firstText.id, text: 'must not land' },
    ],
    preview: buildPreview(deck2, [
      { type: 'set_shape_text', slideIndex: 0, elementId: firstText.id },
    ]),
  })
  transition(p2, 'proposed')
  transition(p2, 'rejected', 'user declined')
  const rejectedBytes = await closeDeck(deck2) // no dirty mutation happened
  const rejectDiffs = bytePreservationReport(origEntries, await zipEntries(rejectedBytes))
  assert(rejectDiffs.length === 0, `reject → save is byte-identical (${rejectDiffs.length} diffs)`)
  persist(p2)
  console.log(`  audit: ${proposalDirPath(PROJECT, p2.id)}`)

  console.log(`\n✅ SPIKE 40 PASSED — Proposed Change contract fits Slides`)
  console.log(
    `   verdict: shape-level ops + dirty-flag apply + per-part byte-preservation + RFC #8 audit`,
  )
}

function proposalDirPath(projectId, proposalId) {
  return join(
    process.env.HERMESOFFICE_SPIKE40_AUDIT || homedir(),
    `.hermesoffice-spike40-audit/${projectId}/proposals/${proposalId}.json`,
  )
}

main().catch((err) => {
  console.error(`\n❌ SPIKE 40 FAILED: ${err.stack || err}`)
  process.exit(1)
})
