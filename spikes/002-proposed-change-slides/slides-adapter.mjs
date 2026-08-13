// Spike 40 — Slides adapter for the RFC 0008 Proposed Change contract.
// Ops are typed and applied ONLY through applyProposal (atomic: validate all
// before mutating any). Mutations follow the engine's dirty-flag model so
// savePptx regenerates only the edited slide and passes everything else
// through byte-for-byte.
import { openPptx, savePptx, addElement, deleteElement } from '@hermesoffice/pptx-engine'

export async function openDeck(bytes) {
  return openPptx(bytes)
}

export async function closeDeck(deck) {
  return savePptx(deck)
}

export function slideOf(deck, slideIndex) {
  const slide = deck.deck.slides[slideIndex]
  if (!slide) {
    throw new Error(`slide ${slideIndex} out of range (deck has ${deck.deck.slides.length})`)
  }
  return slide
}

export function elementOf(deck, slideIndex, elementId) {
  const slide = slideOf(deck, slideIndex)
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el) throw new Error(`element '${elementId}' not found on slide ${slideIndex}`)
  return el
}

export function textSummary(el) {
  if (el.type !== 'text' && el.type !== 'shape') return null
  const paras = el.text?.paragraphs ?? []
  return paras.map((p) => (p.runs ?? []).map((r) => r.text ?? '').join('')).join(' / ') || '(empty)'
}

/** Shape-level index of a slide — the semantic preview surface. */
export function shapeIndex(deck, slideIndex) {
  return slideOf(deck, slideIndex).elements.map((el) => ({
    id: el.id,
    type: el.type,
    text: textSummary(el),
    transform: el.transform
      ? { x: el.transform.x, y: el.transform.y, w: el.transform.w, h: el.transform.h }
      : null,
    fill: el.fill ?? null,
  }))
}

// --- typed operations (RFC #8 app-scoped payloads) ---

const OPS = {
  set_shape_text(deck, op) {
    const el = elementOf(deck, op.slideIndex, op.elementId)
    if (el.type !== 'text' && el.type !== 'shape') {
      throw new Error(`set_shape_text: element '${op.elementId}' is ${el.type}, not text/shape`)
    }
    el.text = { ...(el.text ?? {}), paragraphs: [{ runs: [{ text: op.text }] }] }
    el.dirty = true
  },

  add_shape(deck, op) {
    const slide = slideOf(deck, op.slideIndex)
    addElement(slide, {
      kind: op.kind,
      offset: { x: op.x, y: op.y, w: op.w, h: op.h },
      paragraphs: op.text ? [{ runs: [{ text: op.text }] }] : undefined,
      fillColor: op.fillColor,
    })
  },

  remove_shape(deck, op) {
    const slide = slideOf(deck, op.slideIndex)
    const removed = deleteElement(slide, op.elementId)
    if (!removed) throw new Error(`remove_shape: element '${op.elementId}' not found`)
  },

  set_shape_style(deck, op) {
    const el = elementOf(deck, op.slideIndex, op.elementId)
    if (op.fill) {
      el.fill = op.fill
      el.dirtyFill = true
    }
    if (op.transform) {
      el.transform = { ...el.transform, ...op.transform }
      el.dirtyTransform = true
    }
  },
}

/** Apply an accepted proposal atomically: validate every op first, then mutate. */
export function applyProposal(deck, proposal) {
  for (const op of proposal.operations) {
    if (!OPS[op.type]) throw new Error(`unknown op type: '${op.type}'`)
    if (
      typeof op.slideIndex !== 'number' ||
      op.slideIndex < 0 ||
      op.slideIndex >= deck.deck.slides.length
    ) {
      throw new Error(`slide ${op.slideIndex} out of range`)
    }
    if (op.elementId) elementOf(deck, op.slideIndex, op.elementId)
  }
  for (const op of proposal.operations) OPS[op.type](deck, op)
  return proposal
}

/** Semantic preview: shape-level before-state per affected slide + the ops. */
export function buildPreview(deck, operations) {
  const slides = []
  for (const op of operations) {
    if (!slides.some((s) => s.slideIndex === op.slideIndex)) {
      slides.push({ slideIndex: op.slideIndex, elementsBefore: shapeIndex(deck, op.slideIndex) })
    }
  }
  return {
    summary: `${operations.length} operation(s) across ${slides.length} slide(s)`,
    slides,
  }
}
