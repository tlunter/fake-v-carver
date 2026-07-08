/**
 * Core V-carve math.
 *
 * All lengths are in SVG user units (px) unless noted.
 * "depth" values are in the user's chosen real-world unit (mm or in),
 * converted from SVG units via pxPerUnit.
 *
 * Shaper Origin SVGs use 72 DPI by default (no viewBox, width/height in px).
 * 1 SVG px = 1/72 inch at 72 DPI.
 */

export type Unit = 'mm' | 'in'

export const DEFAULT_DPI = 72

export interface PassInfo {
  passNumber: number
  /** Cumulative lateral inset from the original path edge, in SVG px */
  insetPx: number
  /** Cumulative cut depth in real-world units */
  depth: number
  /** Depth formatted for display, e.g. "4.33 mm" */
  depthLabel: string
  /** Depth formatted for the shaper:cutDepth SVG attribute, e.g. "4.33mm" (no space) */
  cutDepthAttr: string
}

/**
 * Given a path's inscribed radius R (in SVG px), the number of passes N,
 * the V-bit half-angle, the SVG scale, and an optional per-pass inset cap
 * (bitRadiusPx — the physical bit radius), compute the pass table.
 *
 * The per-pass lateral inset is: min(R/N, bitRadiusPx).
 * This means each pass steps inward by at most one bit-radius worth of
 * material, so the bit never tries to remove more than its own width in
 * a single pass.
 */
export function computePassTable(
  R: number,
  N: number,
  halfAngleRad: number,
  pxPerUnit: number,
  unit: Unit,
  bitRadiusPx?: number
): PassInfo[] {
  // The lateral offset per pass: normally R/N, but capped at bitRadiusPx if provided
  const offsetStep = bitRadiusPx !== undefined
    ? Math.min(R / N, bitRadiusPx)
    : R / N

  // Depth per pass follows the V-bit geometry: depth = offset / tan(halfAngle)
  const depthStepPx = offsetStep / Math.tan(halfAngleRad)

  const passes: PassInfo[] = []
  for (let i = 1; i <= N; i++) {
    const insetPx = offsetStep * i
    const depthPx = depthStepPx * i
    const depthRealWorld = depthPx / pxPerUnit
    passes.push({
      passNumber: i,
      insetPx,
      depth: depthRealWorld,
      depthLabel: `${depthRealWorld.toPrecision(4)} ${unit}`,
      cutDepthAttr: `${depthRealWorld.toPrecision(4)}${unit}`,
    })
  }
  return passes
}

/**
 * Convert degrees to radians (uses half-angle for V-bit geometry).
 */
export function degToRad(deg: number): number {
  return (deg / 2) * (Math.PI / 180)
}

/**
 * Compute px-per-mm from the SVG's width/height attributes and a DPI assumption.
 *
 * Shaper SVGs have no viewBox — they just use px units. The DPI tells us how
 * many SVG px equal one physical inch.
 *
 * If the width attribute has an explicit physical unit (mm, cm, in, pt) we use
 * that directly and ignore DPI. Otherwise we use the provided DPI.
 *
 * @param svgText   Raw SVG text (used to read attributes without a live DOM)
 * @param dpi       DPI assumption for unitless px values (default: 72)
 */
export function computePxPerMm(svgText: string, dpi: number = DEFAULT_DPI): number {
  // Try to read width attribute
  const wAttr = svgText.match(/\bwidth=["']([^"']+)["']/)?.[1] ?? ''

  const m = wAttr.match(/^([0-9.]+)(mm|cm|in|pt|px)?$/)
  if (m) {
    const unit = m[2] ?? 'px'

    // If the attribute has a physical unit, compute px/mm directly
    // by also reading the viewBox or treating the value as the physical size
    if (unit === 'mm') return 1        // 1 SVG px = 1 mm (unusual but valid)
    if (unit === 'cm') return 0.1      // 1 SVG px = 10 mm
    if (unit === 'in') return 1 / 25.4 // 1 SVG px = 25.4 mm
    if (unit === 'pt') return 1 / (25.4 / 72) // 1 pt = 1/72 in

    // px — use the DPI assumption
    // value px * (1 in / dpi px) * (25.4 mm / 1 in) = value * 25.4 / dpi mm
    // So: 1 px = 25.4/dpi mm  →  pxPerMm = dpi/25.4
    return dpi / 25.4
  }

  // No recognisable width attribute — fall back to DPI assumption
  return dpi / 25.4
}

/**
 * Legacy helper kept for compatibility — delegates to computePxPerMm with a
 * live SVGSVGElement. Reads the width attribute directly.
 */
export function estimatePxPerMm(svgEl: SVGSVGElement, dpi: number = DEFAULT_DPI): number {
  const wAttr = svgEl.getAttribute('width') ?? ''
  const m = wAttr.match(/^([0-9.]+)(mm|cm|in|pt|px)?$/)
  if (m) {
    const unit = m[2] ?? 'px'
    if (unit === 'mm') return 1
    if (unit === 'cm') return 0.1
    if (unit === 'in') return 1 / 25.4
    if (unit === 'pt') return 1 / (25.4 / 72)
  }
  return dpi / 25.4
}
