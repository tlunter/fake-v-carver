/**
 * Shared color palette for V-carve pass rings.
 * Shallow passes → cyan, deep passes → orange.
 * Used by both SvgCanvas (ring strokes) and InfoPanel (legend dots).
 */
export function passColor(passNumber: number, totalPasses: number): string {
  const t = totalPasses <= 1 ? 1 : (passNumber - 1) / (totalPasses - 1)
  const r = Math.round(t * 255)
  const g = Math.round(210 - t * 150)
  const b = Math.round(255 - t * 255)
  return `rgb(${r},${g},${b})`
}
