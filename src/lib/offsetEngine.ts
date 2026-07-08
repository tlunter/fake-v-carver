/**
 * Clipper.js-based polygon offset engine.
 *
 * Pipeline:
 *  1. Union all contours (resolves self-touching outlines like the S shape)
 *  2. Offset inward with Clipper (topologically correct, handles any shape)
 *  3. Emit the Clipper output directly as SVG polylines (L commands)
 *
 * Clipper with jtRound and arcTolerance=0.25px already produces smooth,
 * arc-approximated curves that are guaranteed equidistant from the input.
 * Curve fitting (Schneider) was discarded because it introduced positional
 * errors that made rings appear non-equidistant.
 */

import ClipperLib from 'clipper-lib'
import type { Point } from './svgParser'

const SCALE = 1000
type ClipperPath = { X: number; Y: number }[]
type ClipperPaths = ClipperPath[]

function toClipperPath(points: Point[]): ClipperPath {
  return points.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }))
}

function fromClipperPath(path: ClipperPath): Point[] {
  return path.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }))
}

/**
 * Union all contours — resolves self-touching outlines (e.g. the S path where
 * outer/inner edges share a thin cap) into clean filled polygons before offsetting.
 */
function unionContours(contours: Point[][]): Point[][] {
  const valid = contours.filter(c => c.length >= 3)
  if (valid.length === 0) return []
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(valid.map(toClipperPath), ClipperLib.PolyType.ptSubject, true)
  const solution: ClipperPaths = []
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd
  )
  return solution.filter(p => p.length >= 3).map(fromClipperPath)
}

/**
 * Offset unified contours inward by delta px using Clipper.
 * arcTolerance=0.25 means round-join arcs are approximated to within
 * 0.25px — imperceptible at any display or cutting resolution.
 */
function offsetWithClipper(contours: Point[][], delta: number): Point[][] {
  const unified = unionContours(contours)
  if (unified.length === 0) return []
  const co = new ClipperLib.ClipperOffset(2, 0.25)
  for (const c of unified) {
    const cp = toClipperPath(c)
    if (cp.length >= 3) {
      co.AddPath(cp, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
    }
  }
  const solution: ClipperPaths = []
  co.Execute(solution, -delta * SCALE)
  return solution.filter(p => p.length >= 3).map(fromClipperPath)
}

/**
 * Convert a closed polygon to an SVG path `d` string (L commands).
 * Clipper's jtRound output is already smooth — no additional curve fitting needed.
 */
function polygonToPath(pts: Point[]): string {
  if (pts.length < 3) return ''
  const f = (n: number) => parseFloat(n.toFixed(3)).toString()
  const parts = [`M${f(pts[0].x)},${f(pts[0].y)}`]
  for (let i = 1; i < pts.length; i++) {
    parts.push(`L${f(pts[i].x)},${f(pts[i].y)}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function offsetContours(contours: Point[][], delta: number): Point[][] {
  return offsetWithClipper(contours, delta)
}

/**
 * Offset contours inward and return SVG path strings.
 * The paths use L commands (Clipper polyline output) which are equidistant
 * from the input by construction.
 */
export function offsetContoursToCurves(contours: Point[][], delta: number): string[] {
  const raw = offsetWithClipper(contours, delta)
  return raw
    .map(pts => polygonToPath(pts))
    .filter(d => d.length > 0)
}

export function findMaxInscribedRadius(contours: Point[][]): number {
  const valid = contours.filter(c => c.length >= 3)
  if (valid.length === 0) return 0
  const all = valid.flat()
  let lo = 0
  let hi = Math.sqrt(
    (Math.max(...all.map(p => p.x)) - Math.min(...all.map(p => p.x))) ** 2 +
    (Math.max(...all.map(p => p.y)) - Math.min(...all.map(p => p.y))) ** 2
  ) / 2
  for (let i = 0; i < 20; i++) {
    if (hi - lo < 0.01) break
    const mid = (lo + hi) / 2
    offsetWithClipper(valid, mid).length > 0 ? (lo = mid) : (hi = mid)
  }
  return lo
}

export function polygonToSvgD(points: Point[]): string {
  return polygonToPath(points)
}
