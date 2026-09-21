import { describe, expect, it } from 'vitest'
import type { PictureRenderNode, RenderSlide, ShapeRenderNode } from '@hermesoffice/pptx-render'
import { auditSlideFindings, auditSlideLayout, formatAudit } from '../src/slides/layout-audit'

const W = 1280
const H = 720

function placedBox(x: number, y: number, w: number, h: number) {
  return {
    x,
    y,
    w,
    h,
    rotationDeg: 0,
    flipH: false,
    flipV: false,
    centerX: x + w / 2,
    centerY: y + h / 2,
  }
}

function textNode(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { text?: string; contentHeight?: number; runWidth?: number; wrap?: boolean } = {},
): ShapeRenderNode {
  const text = opts.text ?? 'Quarterly wins across regions'
  const contentHeight = opts.contentHeight ?? h
  const runWidth = opts.runWidth ?? Math.min(120, w)
  return {
    id,
    type: 'text',
    box: placedBox(x, y, w, h),
    sourceId: id,
    fill: { kind: 'none' },
    text: {
      lines: [
        {
          runs: [
            {
              text,
              x: 0,
              baselineY: 20,
              fontFamily: 'Arial',
              fontSizePx: 16,
              color: '#111111',
              bold: false,
              italic: false,
              underline: false,
              widthPx: runWidth,
            },
          ],
          top: 0,
          height: 20,
        },
      ],
      insets: { l: 0, t: 0, r: 0, b: 0 },
      anchor: 'top',
      fontScale: 1,
      contentHeight,
      wrap: opts.wrap ?? true,
    },
  }
}

function pictureNode(id: string, x: number, y: number, w: number, h: number): PictureRenderNode {
  return { id, type: 'picture', box: placedBox(x, y, w, h), sourceId: id }
}

function slide(nodes: RenderSlide['nodes']): RenderSlide {
  return {
    widthPx: W,
    heightPx: H,
    scale: 1,
    background: { kind: 'solid', color: '#FFFFFF' },
    nodes,
  }
}

describe('auditSlideLayout clean pass', () => {
  it('passes widely separated text boxes', () => {
    const s = slide([textNode('a', 80, 80, 400, 100), textNode('b', 700, 400, 400, 100)])
    expect(auditSlideFindings(s)).toEqual([])
    expect(auditSlideLayout(s)).toEqual([])
    expect(formatAudit([])).toContain('Passed')
  })

  it('tolerates edge and overflow noise below the thresholds', () => {
    const s = slide([
      textNode('a', -4, 80, 400, 100, { contentHeight: 102 }),
      textNode('b', 700, 400, 300, 100, { runWidth: 303 }),
    ])
    expect(auditSlideFindings(s)).toEqual([])
  })
})

describe('auditSlideLayout out of bounds', () => {
  it('flags boxes past each canvas edge', () => {
    const s = slide([
      textNode('left', -30, 100, 200, 80),
      textNode('top', 100, -25, 200, 80),
      textNode('right', W - 100, 100, 200, 80),
      textNode('bottom', 100, H - 40, 200, 80),
    ])
    const findings = auditSlideFindings(s)
    expect(findings.map((f) => f.code)).toEqual([
      'out_of_bounds',
      'out_of_bounds',
      'out_of_bounds',
      'out_of_bounds',
    ])
    const messages = findings.map((f) => f.message)
    expect(messages[0]).toContain('past the left edge')
    expect(messages[1]).toContain('past the top edge')
    expect(messages[2]).toContain('past the right edge')
    expect(messages[3]).toContain('past the bottom edge')
    for (const f of findings) {
      expect(f.level).toBe('error')
      expect(f.suggest?.op).toBe('setTransform')
    }
  })
})

describe('auditSlideLayout text overflow', () => {
  it('flags content taller than the box with a taller suggestion', () => {
    const s = slide([textNode('tall', 100, 100, 400, 40, { contentHeight: 100 })])
    const findings = auditSlideFindings(s)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ code: 'text_overflow', level: 'error', el: 'tall' })
    expect(findings[0]!.message).toContain('exceeds the box height by 60px')
    expect(findings[0]!.overflowPx).toBe(60)
    expect(findings[0]!.suggest?.op).toBe('setTransform')
  })

  it('flags a line wider than the box as a width warning', () => {
    const s = slide([textNode('wide', 100, 100, 200, 80, { runWidth: 300 })])
    const findings = auditSlideFindings(s)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ code: 'text_overflow_width', level: 'warning' })
    expect(findings[0]!.message).toContain('exceeds the box width by 100px')
    expect(findings[0]!.suggest?.op).toBe('setTransform')
  })
})

describe('auditSlideLayout overlap', () => {
  it('flags two intersecting text boxes', () => {
    const s = slide([textNode('a', 100, 100, 200, 100), textNode('b', 150, 120, 200, 100)])
    const findings = auditSlideFindings(s)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ code: 'overlap', level: 'warning', el: 'a' })
    expect(findings[0]!.els).toEqual(['a', 'b'])
    expect(findings[0]!.message).toContain('intersect by 150')
    expect(auditSlideLayout(s)).toHaveLength(1)
    expect(formatAudit(auditSlideLayout(s))).toContain('Found 1 issue')
  })

  it('flags text on image but ignores image on image', () => {
    const textOnImage = slide([
      textNode('caption', 100, 100, 200, 100),
      pictureNode('photo', 150, 120, 200, 100),
    ])
    expect(auditSlideFindings(textOnImage).map((f) => f.code)).toEqual(['overlap'])

    const imageOnImage = slide([
      pictureNode('one', 100, 100, 200, 100),
      pictureNode('two', 150, 120, 200, 100),
    ])
    expect(auditSlideFindings(imageOnImage)).toEqual([])
  })

  it('ignores decoration nodes and full-canvas background blocks', () => {
    const decorated = textNode('deco', 150, 120, 200, 100)
    const s = slide([textNode('main', 100, 100, 200, 100), { ...decorated, decoration: true }])
    expect(auditSlideFindings(s)).toEqual([])

    const backdrop = textNode('backdrop', 0, 0, 1200, 650, { text: 'Backdrop block' })
    const small = textNode('small', 100, 100, 200, 100)
    expect(auditSlideFindings(slide([backdrop, small]))).toEqual([])
  })
})
