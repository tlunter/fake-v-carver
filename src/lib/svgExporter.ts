/**
 * SVG exporter.
 *
 * Takes the original SVG document and a set of generated rings,
 * injects the Shaper namespace, appends the offset paths with
 * shaper:cutDepth attributes, and returns a pretty-printed SVG string
 * with newlines and indent-based nesting.
 */

import type { PassInfo } from './vcarve'
import type { SvgPathInfo } from './svgParser'
import { SHAPER_NS, SHAPER_NS_PREFIX, SHAPER_GUIDE_FILL, SHAPER_ONLINE_STROKE } from './shaperColors'

export interface GeneratedRing {
  /** SVG path `d` string */
  d: string
  passInfo: PassInfo
  /** ID of the original source path this ring was generated from */
  sourceId: string
}

const INDENT = '  ' // two spaces per level

// ---------------------------------------------------------------------------
// Pretty-printing serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a DOM node to a pretty-printed XML string.
 * Handles Element, Text, Comment, and ProcessingInstruction nodes.
 */
function serializeNode(node: Node, depth: number): string {
  const indent = INDENT.repeat(depth)
  const childIndent = INDENT.repeat(depth + 1)

  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      const el = node as Element
      const tag = el.tagName

      // Collect attributes
      const attrs: string[] = []
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i]
        attrs.push(`${attr.name}="${escapeXml(attr.value)}"`)
      }

      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : ''

      const children = Array.from(el.childNodes)
      const hasChildren = children.length > 0

      // Inline text-only elements (no nested elements)
      const onlyText = hasChildren &&
        children.every(c => c.nodeType === Node.TEXT_NODE) &&
        children.length === 1

      if (!hasChildren) {
        return `${indent}<${tag}${attrStr}/>`
      }

      if (onlyText) {
        const text = escapeXml((children[0] as Text).data)
        return `${indent}<${tag}${attrStr}>${text}</${tag}>`
      }

      const childLines: string[] = []
      for (const child of children) {
        const serialized = serializeNode(child, depth + 1)
        if (serialized !== '') childLines.push(serialized)
      }

      if (childLines.length === 0) {
        return `${indent}<${tag}${attrStr}/>`
      }

      return [
        `${indent}<${tag}${attrStr}>`,
        ...childLines,
        `${indent}</${tag}>`,
      ].join('\n')
    }

    case Node.COMMENT_NODE: {
      const data = (node as Comment).data
      return `${indent}<!--${data}-->`
    }

    case Node.TEXT_NODE: {
      const text = ((node as Text).data ?? '').trim()
      // Skip whitespace-only text nodes (they're just formatting from the original)
      return text === '' ? '' : `${childIndent}${escapeXml(text)}`
    }

    case Node.PROCESSING_INSTRUCTION_NODE: {
      const pi = node as ProcessingInstruction
      return `${indent}<?${pi.target} ${pi.data}?>`
    }

    default:
      return ''
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Serialize a full Document to a pretty-printed XML string.
 */
function prettyPrint(doc: Document): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>']
  for (const child of Array.from(doc.childNodes)) {
    // Skip the original XML declaration if DOMParser included one
    if (child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) continue
    // Skip doctype
    if (child.nodeType === Node.DOCUMENT_TYPE_NODE) continue
    const serialized = serializeNode(child, 0)
    if (serialized !== '') lines.push(serialized)
  }
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the output SVG string with pretty-printed formatting.
 *
 * Selected source shapes are recolored to guide-blue so Shaper Origin
 * knows they are reference paths. The generated offset rings are set to
 * online-gray (gray stroke, no fill) so they are treated as engraving paths.
 *
 * @param originalSvgText  Raw stamped SVG text
 * @param rings            Generated offset rings
 * @param selectedPaths    The source paths that were processed — their elements
 *                         in the DOM will be recolored to guide blue
 */
export function buildOutputSvg(
  originalSvgText: string,
  rings: GeneratedRing[],
  selectedPaths: SvgPathInfo[]
): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(originalSvgText, 'image/svg+xml')

  const svgEl = doc.documentElement as unknown as SVGSVGElement

  // Add Shaper namespace declaration if missing
  if (!svgEl.getAttribute(SHAPER_NS_PREFIX)) {
    svgEl.setAttribute(SHAPER_NS_PREFIX, SHAPER_NS)
  }

  // --- Restyle selected source elements to guide blue ---
  for (const pathInfo of selectedPaths) {
    const el = svgEl.querySelector(`[data-vcarve-idx="${pathInfo.vcarveIdx}"]`) as Element | null
    if (!el) continue

    // Remove any existing inline fill/stroke from style attribute
    const existingStyle = el.getAttribute('style') ?? ''
    const cleanedStyle = existingStyle
      .replace(/\bfill\s*:[^;]+;?/gi, '')
      .replace(/\bstroke\s*:[^;]+;?/gi, '')
      .trim()
      .replace(/^;+|;+$/g, '')
      .trim()

    if (cleanedStyle) {
      el.setAttribute('style', cleanedStyle)
    } else {
      el.removeAttribute('style')
    }

    // Set guide color as presentation attributes (overridden by style above if present)
    el.setAttribute('fill', SHAPER_GUIDE_FILL)
    el.removeAttribute('stroke')

    // Remove the data-vcarve-idx stamp — it was only needed during processing
    el.removeAttribute('data-vcarve-idx')
  }

  // Also remove data-vcarve-idx from any other elements that weren't selected
  svgEl.querySelectorAll('[data-vcarve-idx]').forEach(el => {
    el.removeAttribute('data-vcarve-idx')
  })

  // --- Remove any previous vcarve group ---
  const existing = doc.getElementById('shaper-vcarve-passes')
  if (existing) existing.remove()

  if (rings.length > 0) {
    const rootG = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
    rootG.setAttribute('id', 'shaper-vcarve-passes')

    // Group rings by source path, preserving processing order
    const sourceOrder: string[] = []
    const bySource = new Map<string, GeneratedRing[]>()
    for (const ring of rings) {
      if (!bySource.has(ring.sourceId)) {
        bySource.set(ring.sourceId, [])
        sourceOrder.push(ring.sourceId)
      }
      bySource.get(ring.sourceId)!.push(ring)
    }

    for (const sourceId of sourceOrder) {
      const sourceRings = bySource.get(sourceId)!
      const sourceG = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
      const safeId = sourceId.replace(/[^a-zA-Z0-9_-]/g, '_')
      sourceG.setAttribute('id', `vcarve-source-${safeId}`)

      const byPass = new Map<number, GeneratedRing[]>()
      for (const ring of sourceRings) {
        const n = ring.passInfo.passNumber
        if (!byPass.has(n)) byPass.set(n, [])
        byPass.get(n)!.push(ring)
      }

      for (const passNum of [...byPass.keys()].sort((a, b) => a - b)) {
        const passRings = byPass.get(passNum)!
        const passG = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
        passG.setAttribute('id', `vcarve-source-${safeId}-pass-${passNum}`)
        passG.appendChild(
          doc.createComment(` pass ${passNum} — depth ${passRings[0].passInfo.depthLabel} `)
        )

        for (const ring of passRings) {
          const pathEl = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
          pathEl.setAttribute('d', ring.d)
          pathEl.setAttributeNS(SHAPER_NS, 'shaper:cutDepth', ring.passInfo.cutDepthAttr)
          // Online cut type: gray stroke, no fill
          pathEl.setAttribute('fill', 'none')
          pathEl.setAttribute('stroke', SHAPER_ONLINE_STROKE)
          passG.appendChild(pathEl)
        }

        sourceG.appendChild(passG)
      }

      rootG.appendChild(sourceG)
    }

    svgEl.appendChild(rootG)
  }

  return prettyPrint(doc)
}

/**
 * Trigger a browser download of the given text content.
 */
export function downloadSvg(content: string, originalFileName: string): void {
  const base = originalFileName.replace(/\.svg$/i, '')
  const fileName = `${base}-vcarve.svg`

  const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()

  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
