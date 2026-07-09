/**
 * SVG parsing utilities.
 *
 * Extracts all renderable path-like elements from an SVG document,
 * determines whether each is closed, and flattens curved segments
 * to polylines for use with the Clipper.js offset library.
 *
 * Design note: extraction uses DOMParser (image/svg+xml) so we get a real
 * SVG document with proper element interfaces. We stamp data-vcarve-idx on
 * each found element, then XMLSerializer bakes those attributes into the text
 * that SvgCanvas displays — so the canvas can always query by that attribute.
 */


/**
 * Shaper Origin cut types inferred from SVG element color.
 * 'unknown' = no recognized color encoding present.
 */
export type CutType = 'online' | 'exterior' | 'interior' | 'pocket' | 'guide' | 'anchor' | 'unknown'

/**
 * Cut types that are eligible for V-carve ring generation. Pocket and guide
 * are intentionally excluded. 'unknown' is included so paths with unrecognized
 * color encoding are still selectable rather than silently ignored.
 * Guide, and anchor are intentionally excluded.
 */
export const SELECTABLE_CUT_TYPES = new Set<CutType>(['online', 'interior', 'exterior', 'pocket', 'unknown'])

/**
 * Cut types that are auto-selected on file load for V-carve ring generation.
 * Pocket, guide, anchor and unknown are purposefully excluded, but pocket
 * and unknown paths can still be selected manually by the user.
 */
export const AUTO_SELECTED_CUT_TYPES = new Set<CutType>(['online', 'interior', 'exterior'])

export interface SvgPathInfo {
  /** Unique ID within the parsed set */
  id: string
  /** Positional index stamped as data-vcarve-idx on the element */
  vcarveIdx: number
  /** SVG element tag name (path, rect, circle, etc.) */
  tag: string
  /** Whether the path is closed (eligible for offset) */
  isClosed: boolean
  /**
   * The path's `d` string normalized to path syntax.
   * Only populated for closed paths.
   */
  dString: string
  /** Shaper Origin cut type detected from element color */
  cutType: CutType
}

const SHAPE_TAGS = new Set(['path', 'polygon', 'rect', 'circle', 'ellipse', 'polyline'])

/**
 * Parse an SVG string, stamp data-vcarve-idx on every path-like element,
 * and return:
 *   - the updated SVG string (with stamped attributes baked in)
 *   - the array of SvgPathInfo descriptors
 */
export function parseSvg(svgText: string): { stampedSvgText: string; paths: SvgPathInfo[] } {
  // Use DOMParser so we get a real SVG document with proper element interfaces.
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgText, 'image/svg+xml')

  // Check for parse errors
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    console.warn('SVG parse error:', parseError.textContent)
  }

  const svgEl = doc.documentElement as unknown as SVGSVGElement

  const paths: SvgPathInfo[] = []
  let autoIdx = 0

  const walk = (node: Element) => {
    const tag = node.localName
    if (SHAPE_TAGS.has(tag)) {
      const el = node as Element
      const vcarveIdx = autoIdx++
      // Stamp the index onto the element — XMLSerializer will preserve this
      el.setAttribute('data-vcarve-idx', String(vcarveIdx))

      const id = el.getAttribute('id') || `path-${vcarveIdx}`
      const isClosed = isClosedElement(el)
      const dString = isClosed ? toDString(el) : ''
      const cutType = detectCutType(el, isClosed)

      paths.push({ id, vcarveIdx, tag, isClosed, dString, cutType })
    }
    for (const child of Array.from(node.children)) {
      walk(child)
    }
  }

  walk(svgEl)

  // Serialize back — data-vcarve-idx attributes are now in the output.
  // Strip the XML declaration (<?xml ...?>) so the text is safe to set as innerHTML.
  const serializer = new XMLSerializer()
  let stampedSvgText = serializer.serializeToString(doc)
  // Remove XML processing instruction if present
  stampedSvgText = stampedSvgText.replace(/^<\?xml[^?]*\?>\s*/i, '')
  // Remove DOCTYPE if present
  stampedSvgText = stampedSvgText.replace(/<!DOCTYPE[^>]*>\s*/i, '')

  return { stampedSvgText, paths }
}

// ---------------------------------------------------------------------------
// Shaper Origin cut-type color detection
// ---------------------------------------------------------------------------

/**
 * Shaper Origin cut type detection from SVG element colors.
 *
 * Verified from Shaper Studio swatch images:
 *   Exterior  — fill: #000000  black
 *   Anchor    — fill/stroke: #ff0000  red  (registration/alignment mark)
 *   Guide     — fill: #0068ff  blue
 *   Pocket    — fill: #7f7f7f  gray
 *   Online    — fill: white/none + stroke: gray (#7f7f7f)
 *               Can be open OR closed — the stroke color is what matters,
 *               not the path topology.
 *   Interior  — fill: white/none + stroke: black (#000000) — closed path
 *
 * Color can appear in fill/stroke presentation attributes or inline style.
 */
function detectCutType(el: Element, _isClosed: boolean): CutType {
  const style = el.getAttribute('style') ?? ''
  const styleFill   = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]?.trim()
  const styleStroke = style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i)?.[1]?.trim()

  const fill   = styleFill   ?? el.getAttribute('fill')   ?? null
  const stroke = styleStroke ?? el.getAttribute('stroke') ?? null

  const fillHex   = fill   ? normalizeColor(fill)   : null
  const strokeHex = stroke ? normalizeColor(stroke) : null

  // Exterior: black fill
  if (fillHex && isBlack(fillHex)) return 'exterior'

  // Anchor: red fill or stroke (#ff0000 / rgb(255,0,0))
  if (fillHex && isRed(fillHex)) return 'anchor'
  if (!fillHex && strokeHex && isRed(strokeHex)) return 'anchor'

  // Guide: blue fill or stroke (#0068ff or near)
  if ((fillHex && isBlue(fillHex)) || (strokeHex && isBlue(strokeHex))) return 'guide'

  // Pocket: gray fill
  if (fillHex && isGrey(fillHex)) return 'pocket'

  const fillIsWhiteOrNone = !fillHex || isWhite(fillHex) || fill === 'none'

  // Online: white/none fill + gray stroke (open or closed)
  if (fillIsWhiteOrNone && strokeHex && isGrey(strokeHex)) return 'online'

  // Interior: white/none fill + black stroke
  if (fillIsWhiteOrNone && strokeHex && isBlack(strokeHex)) return 'interior'

  // No explicit fill or stroke — SVG default is black fill, treat as exterior
  if (!fill && !stroke) return 'exterior'

  return 'unknown'
}

function isBlack(hex: string): boolean {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return r < 40 && g < 40 && b < 40
}

function isRed(hex: string): boolean {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return r > 200 && g < 40 && b < 40
}

function isWhite(hex: string): boolean {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return r > 215 && g > 215 && b > 215
}

function isBlue(hex: string): boolean {
  // Matches Shaper's guide blue (SHAPER_GUIDE_FILL) and similar blue-dominant colors
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return b > 180 && b > r * 2 && b > g * 1.2
}

function isGrey(hex: string): boolean {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  const avg = (r + g + b) / 3
  return Math.abs(r - avg) < 20 && Math.abs(g - avg) < 20 && Math.abs(b - avg) < 20
    && avg > 40 && avg < 215
}

/** Normalize a CSS/SVG color string to lowercase hex (#rrggbb) or null */
function normalizeColor(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (s === 'none' || s === 'transparent') return null

  // Already hex
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) {
    const [, r, g, b] = s.match(/^#(.)(.)(.)$/)!
    return `#${r}${r}${g}${g}${b}${b}`
  }

  // rgb(r, g, b) or rgb(r g b)
  const rgbMatch = s.match(/^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/)
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch.map(Number)
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`
  }

  // Named colors relevant to Shaper
  const named: Record<string, string> = {
    black: '#000000', red: '#ff0000', blue: '#0000ff',
    green: '#008000', cyan: '#00ffff', orange: '#ff7700',
  }
  return named[s] ?? null
}

/** Returns true if the element forms a closed shape */
function isClosedElement(el: Element): boolean {
  const tag = el.localName
  if (tag === 'rect' || tag === 'circle' || tag === 'ellipse' || tag === 'polygon') {
    return true
  }
  if (tag === 'path') {
    const d = el.getAttribute('d') ?? ''
    return /[Zz]\s*$/.test(d.trim())
  }
  return false
}

/** Convert any shape element to an SVG path `d` string */
function toDString(el: Element): string {
  const tag = el.localName

  if (tag === 'path') {
    return el.getAttribute('d') ?? ''
  }

  if (tag === 'rect') {
    const x = parseFloat(el.getAttribute('x') ?? '0')
    const y = parseFloat(el.getAttribute('y') ?? '0')
    const w = parseFloat(el.getAttribute('width') ?? '0')
    const h = parseFloat(el.getAttribute('height') ?? '0')
    const rx = parseFloat(el.getAttribute('rx') ?? '0')
    const ry = parseFloat(el.getAttribute('ry') ?? '0')
    if (rx === 0 && ry === 0) {
      return `M${x},${y} H${x + w} V${y + h} H${x} Z`
    }
    const r = Math.min(rx || ry, ry || rx)
    return (
      `M${x + r},${y}` +
      ` H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r}` +
      ` V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h}` +
      ` H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r}` +
      ` V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`
    )
  }

  if (tag === 'circle') {
    const cx = parseFloat(el.getAttribute('cx') ?? '0')
    const cy = parseFloat(el.getAttribute('cy') ?? '0')
    const r = parseFloat(el.getAttribute('r') ?? '0')
    return (
      `M${cx - r},${cy}` +
      ` A${r},${r} 0 0 1 ${cx + r},${cy}` +
      ` A${r},${r} 0 0 1 ${cx - r},${cy} Z`
    )
  }

  if (tag === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx') ?? '0')
    const cy = parseFloat(el.getAttribute('cy') ?? '0')
    const rx = parseFloat(el.getAttribute('rx') ?? '0')
    const ry = parseFloat(el.getAttribute('ry') ?? '0')
    return (
      `M${cx - rx},${cy}` +
      ` A${rx},${ry} 0 0 1 ${cx + rx},${cy}` +
      ` A${rx},${ry} 0 0 1 ${cx - rx},${cy} Z`
    )
  }

  if (tag === 'polygon') {
    const pointsAttr = el.getAttribute('points') ?? ''
    const pts = pointsAttr.trim().split(/[\s,]+/).reduce<number[][]>((acc, v, i) => {
      if (i % 2 === 0) acc.push([parseFloat(v)])
      else acc[acc.length - 1].push(parseFloat(v))
      return acc
    }, [])
    if (pts.length === 0) return ''
    return 'M' + pts.map(p => `${p[0]},${p[1]}`).join(' L') + ' Z'
  }

  return ''
}

// ---------------------------------------------------------------------------
// Curve flattening — convert a path `d` string to a polyline.
// Uses a temporary live SVGPathElement for getPointAtLength().
// ---------------------------------------------------------------------------

export interface Point {
  x: number
  y: number
}

const FLATTEN_TOLERANCE = 0.01

/**
 * Split an SVG path `d` string into individual sub-paths at absolute/relative
 * M commands. Each sub-path starts with an M and contains everything up to
 * (but not including) the next M.
 *
 * This is necessary because getPointAtLength() jumps discontinuously across
 * sub-path boundaries — sampling across a boundary produces a chord that
 * short-circuits the adaptive subdivision, leaving curves as straight lines.
 */
function splitSubPaths(dString: string): string[] {
  // Split at every M or m that is preceded by at least one command character.
  // We keep the M as the start of each chunk.
  const chunks = dString.trim().split(/(?=[Mm])/)
  return chunks.map(s => s.trim()).filter(s => s.length > 0)
}

/**
 * Flatten an SVG path d-string into one polyline per sub-path.
 * Applies `transform` to every point.
 *
 * Returns Point[][] — one array per sub-path (M…Z segment).
 * Callers should treat each inner array as a separate closed contour.
 */
export function flattenPath(dString: string, transform: DOMMatrix): Point[][] {
  const svgNs = 'http://www.w3.org/2000/svg'
  const tempSvg = document.createElementNS(svgNs, 'svg') as SVGSVGElement
  tempSvg.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  document.body.appendChild(tempSvg)

  const pathEl = document.createElementNS(svgNs, 'path') as SVGPathElement
  tempSvg.appendChild(pathEl)

  const subPaths = splitSubPaths(dString)
  const result: Point[][] = []

  for (const sub of subPaths) {
    pathEl.setAttribute('d', sub)
    const len = pathEl.getTotalLength()
    if (len <= 0) continue

    const raw = adaptiveSample(pathEl, 0, len, FLATTEN_TOLERANCE)

    const transformed = raw.map(p => {
      const tp = transform.transformPoint(new DOMPoint(p.x, p.y))
      return { x: tp.x, y: tp.y }
    })

    if (transformed.length >= 3) {
      result.push(transformed)
    }
  }

  document.body.removeChild(tempSvg)
  return result
}

function adaptiveSample(
  pathEl: SVGPathElement,
  t0: number,
  t1: number,
  tolerance: number,
  depth = 0
): Point[] {
  const MAX_DEPTH = 12
  const p0 = pathEl.getPointAtLength(t0)
  const p1 = pathEl.getPointAtLength(t1)
  const tMid = (t0 + t1) / 2
  const pMid = pathEl.getPointAtLength(tMid)

  const chordX = (p0.x + p1.x) / 2
  const chordY = (p0.y + p1.y) / 2
  const dx = pMid.x - chordX
  const dy = pMid.y - chordY

  if (Math.sqrt(dx * dx + dy * dy) <= tolerance || depth >= MAX_DEPTH) {
    return [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }]
  }

  const left = adaptiveSample(pathEl, t0, tMid, tolerance, depth + 1)
  const right = adaptiveSample(pathEl, tMid, t1, tolerance, depth + 1)
  return [...left.slice(0, -1), ...right]
}

/**
 * Build a CTM (element-to-SVG-root transform) by walking the element's
 * ancestor chain and multiplying transform attributes.
 * Works on elements from a DOMParser document (no live rendering needed).
 */
export function buildTransformFromAttributes(
  el: Element,
  svgRoot: Element
): DOMMatrix {
  const matrices: DOMMatrix[] = []
  let current: Element | null = el

  while (current && current !== svgRoot) {
    const t = current.getAttribute('transform')
    if (t) {
      matrices.unshift(parseTransformAttribute(t))
    }
    current = current.parentElement
  }

  let result = new DOMMatrix()
  for (const m of matrices) {
    result = result.multiply(m)
  }
  return result
}

/** Parse a transform attribute string into a DOMMatrix */
function parseTransformAttribute(transform: string): DOMMatrix {
  // Handle matrix(a,b,c,d,e,f)
  const matrixMatch = transform.match(/matrix\(\s*([^)]+)\)/)
  if (matrixMatch) {
    const vals = matrixMatch[1].trim().split(/[\s,]+/).map(Number)
    if (vals.length === 6) {
      return new DOMMatrix(vals)
    }
  }

  // Handle translate(x[,y])
  const translateMatch = transform.match(/translate\(\s*([^)]+)\)/)
  if (translateMatch) {
    const vals = translateMatch[1].trim().split(/[\s,]+/).map(Number)
    const tx = vals[0] ?? 0
    const ty = vals[1] ?? 0
    return new DOMMatrix([1, 0, 0, 1, tx, ty])
  }

  // Handle scale(x[,y])
  const scaleMatch = transform.match(/scale\(\s*([^)]+)\)/)
  if (scaleMatch) {
    const vals = scaleMatch[1].trim().split(/[\s,]+/).map(Number)
    const sx = vals[0] ?? 1
    const sy = vals[1] ?? sx
    return new DOMMatrix([sx, 0, 0, sy, 0, 0])
  }

  return new DOMMatrix()
}
