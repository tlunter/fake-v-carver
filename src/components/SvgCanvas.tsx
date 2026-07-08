import { useEffect, useRef, useState, useCallback } from 'react'
import type { SvgPathInfo } from '../lib/svgParser'
import { SELECTABLE_CUT_TYPES } from '../lib/svgParser'
import type { GeneratedRing } from '../lib/svgExporter'
import { passColor } from '../lib/passColor'
import { SHAPER_GUIDE_FILL, SHAPER_ONLINE_STROKE } from '../lib/shaperColors'

interface SvgCanvasProps {
  svgText: string
  paths: SvgPathInfo[]
  selectedIds: Set<string>
  rings: GeneratedRing[]
  isComputing: boolean
  previewMode: 'design' | 'shaper'
  onTogglePath: (id: string) => void
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_SCALE = 40
const ZOOM_FACTOR = 1.12

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const SELECT_KEY_LABEL = IS_MAC ? '⌘-click' : 'Ctrl-click'

interface ViewState {
  scale: number
  originX: number
  originY: number
}

function parseSvgDims(svgText: string): { w: number; h: number } {
  const w = parseFloat(svgText.match(/\bwidth=["']([0-9.]+)(?:px)?["']/)?.[1] ?? '0')
  const h = parseFloat(svgText.match(/\bheight=["']([0-9.]+)(?:px)?["']/)?.[1] ?? '0')
  return { w, h }
}

export function SvgCanvas({
  svgText,
  paths,
  selectedIds,
  rings,
  isComputing,
  previewMode,
  onTogglePath,
}: SvgCanvasProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const svgWrapRef = useRef<HTMLDivElement>(null)

  // Refs that are always current — used inside Effect 1 so it can read the
  // latest selectedIds and previewMode without them being in its dependency array.
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const previewModeRef = useRef(previewMode)
  previewModeRef.current = previewMode

  const svgDims = parseSvgDims(svgText)

  const getFitScale = useCallback(() => {
    const el = outerRef.current
    if (!el || !svgDims.w || !svgDims.h) return 1
    return Math.min(el.clientWidth / svgDims.w, el.clientHeight / svgDims.h)
  }, [svgDims.w, svgDims.h])

  const [view, setView] = useState<ViewState>({ scale: 1, originX: 0, originY: 0 })
  const [cmdHeld, setCmdHeld] = useState(false)

  const panRef = useRef<{
    active: boolean
    startX: number; startY: number
    startOriginX: number; startOriginY: number
  }>({ active: false, startX: 0, startY: 0, startOriginX: 0, startOriginY: 0 })

  /** Apply the correct fill/stroke to a selectable path element. */
  function applyPathStyle(
    el: SVGGraphicsElement,
    isSelected: boolean,
    mode: 'design' | 'shaper',
    cutType: string
  ) {
    el.style.vectorEffect = 'non-scaling-stroke'
    el.style.opacity = '1'
    if (mode === 'shaper') {
      if (isSelected) {
        // Selected paths become guide blue — the Shaper encoding for reference paths
        el.style.fill = SHAPER_GUIDE_FILL
        el.style.stroke = 'none'
        el.style.strokeWidth = ''
      } else if (cutType === 'unknown') {
        // Unknown-encoded paths have no meaningful Shaper color — hide them
        el.style.fill = 'none'
        el.style.stroke = 'none'
        el.style.strokeWidth = ''
      } else {
        // Paths with a known Shaper encoding (exterior=black, online=grey stroke,
        // interior=white+black stroke, pocket=grey) keep their original colors —
        // they already look correct per the Shaper spec.
        el.style.fill = ''
        el.style.stroke = ''
        el.style.strokeWidth = ''
      }
    } else {
      if (isSelected) {
        el.style.fill = 'rgba(59,130,246,0.35)'
        el.style.stroke = '#3b82f6'
        el.style.strokeWidth = '2px'
      } else {
        el.style.fill = 'rgba(255,255,255,0.08)'
        el.style.stroke = 'rgba(255,255,255,0.55)'
        el.style.strokeWidth = '1.5px'
      }
    }
  }

  // Fit to viewport when SVG changes
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setView({ scale: getFitScale(), originX: 0, originY: 0 })
    })
    return () => cancelAnimationFrame(id)
  }, [svgText, getFitScale])

  // Apply viewBox on every view change
  useEffect(() => {
    const svgEl = svgWrapRef.current?.querySelector('svg')
    if (!svgEl || !svgDims.w || !svgDims.h) return
    const outer = outerRef.current
    if (!outer) return
    const vpW = outer.clientWidth
    const vpH = outer.clientHeight
    const vbW = vpW / view.scale
    const vbH = vpH / view.scale
    svgEl.setAttribute('viewBox', `${view.originX} ${view.originY} ${vbW} ${vbH}`)
    svgEl.setAttribute('width', String(vpW))
    svgEl.setAttribute('height', String(vpH))
  }, [view, svgDims.w, svgDims.h])

  // Cmd/ctrl tracking
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.metaKey || e.ctrlKey) setCmdHeld(true) }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Meta' || e.key === 'Control') setCmdHeld(false) }
    const onBlur = () => setCmdHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Wheel zoom
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      setView(prev => {
        const minScale = Math.min(el.clientWidth / svgDims.w, el.clientHeight / svgDims.h)
        const delta = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
        const newScale = Math.min(MAX_SCALE, Math.max(minScale, prev.scale * delta))
        const svgX = prev.originX + cx / prev.scale
        const svgY = prev.originY + cy / prev.scale
        return { scale: newScale, originX: svgX - cx / newScale, originY: svgY - cy / newScale }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [svgDims.w, svgDims.h])

  // Pan
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const onDown = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.button !== 0) return
      panRef.current = { active: true, startX: e.clientX, startY: e.clientY, startOriginX: view.originX, startOriginY: view.originY }
      el.style.cursor = 'grabbing'
    }
    const onMove = (e: MouseEvent) => {
      if (!panRef.current.active) return
      const dx = e.clientX - panRef.current.startX
      const dy = e.clientY - panRef.current.startY
      setView(prev => ({ ...prev, originX: panRef.current.startOriginX - dx / prev.scale, originY: panRef.current.startOriginY - dy / prev.scale }))
    }
    const onUp = () => { panRef.current.active = false; el.style.cursor = '' }
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { el.removeEventListener('mousedown', onDown); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [view.originX, view.originY, view.scale])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) return
    setView({ scale: getFitScale(), originX: 0, originY: 0 })
  }, [getFitScale])

  // -----------------------------------------------------------------------
  // Effect 1: SVG injection — runs only when svgText, paths, rings change.
  // Does NOT depend on selectedIds — selection styling is handled separately.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const container = svgWrapRef.current
    if (!container) return

    container.innerHTML = svgText

    const svgEl = container.querySelector('svg')
    if (!svgEl) return

    const outer = outerRef.current
    if (outer) {
      svgEl.setAttribute('width', String(outer.clientWidth))
      svgEl.setAttribute('height', String(outer.clientHeight))
    }
    svgEl.style.display = 'block'
    svgEl.style.width = ''
    svgEl.style.height = ''
    // Background color follows preview mode
    svgEl.style.background = previewModeRef.current === 'shaper' ? '#ffffff' : ''

    const byIdx = new Map<number, SvgPathInfo>()
    for (const p of paths) byIdx.set(p.vcarveIdx, p)

    svgEl.querySelectorAll('[data-vcarve-idx]').forEach(node => {
      const el = node as SVGGraphicsElement
      const idx = parseInt(el.getAttribute('data-vcarve-idx') ?? '-1', 10)
      const pathInfo = byIdx.get(idx)
      if (!pathInfo) return

      const isSelectable = pathInfo.isClosed && SELECTABLE_CUT_TYPES.has(pathInfo.cutType)

      if (isSelectable) {
        const isSelected = selectedIdsRef.current.has(pathInfo.id)
        const mode = previewModeRef.current
        applyPathStyle(el, isSelected, mode, pathInfo.cutType)
        el.setAttribute('data-selectable', 'true')
        el.setAttribute('data-vcarve-id', pathInfo.id)
        el.setAttribute('data-vcarve-cuttype', pathInfo.cutType)
        el.setAttribute('pointer-events', 'all')

        // Fat hit target
        const hitEl = el.cloneNode(false) as SVGGraphicsElement
        hitEl.setAttribute('fill', 'transparent')
        hitEl.setAttribute('stroke', 'transparent')
        hitEl.setAttribute('stroke-width', '12')
        hitEl.setAttribute('pointer-events', 'all')
        hitEl.setAttribute('data-selectable', 'true')
        hitEl.setAttribute('data-vcarve-id', pathInfo.id)
        hitEl.setAttribute('data-vcarve-cuttype', pathInfo.cutType)
        hitEl.removeAttribute('data-vcarve-idx')
        hitEl.style.vectorEffect = 'non-scaling-stroke'

        const id = pathInfo.id
        const handler = (e: MouseEvent) => {
          if (!e.metaKey && !e.ctrlKey) return
          e.stopPropagation()
          onTogglePath(id)
        }
        el.addEventListener('click', handler)
        hitEl.addEventListener('click', handler)
        el.after(hitEl)
      } else {
        // Non-selectable paths (guide, anchor, pocket, open paths).
        // Their original colors are already correct per Shaper encoding —
        // don't touch fill/stroke. In design mode, dim with opacity only.
        if (previewModeRef.current !== 'shaper') {
          el.style.opacity = '0.25'
        }
        el.setAttribute('pointer-events', 'none')
      }
    })

    // Ring overlay
    svgEl.querySelector('#vcarve-rings')?.remove()
    if (rings.length > 0) {
      const totalPasses = Math.max(...rings.map(r => r.passInfo.passNumber))
      const g = document.createElementNS(SVG_NS, 'g')
      g.setAttribute('id', 'vcarve-rings')
      g.setAttribute('pointer-events', 'none')
      for (const ring of rings) {
        const pathEl = document.createElementNS(SVG_NS, 'path')
        pathEl.setAttribute('d', ring.d)
        pathEl.setAttribute('fill', 'none')
        if (previewModeRef.current === 'shaper') {
          // Online encoding: gray stroke, no color gradient
          pathEl.setAttribute('stroke', SHAPER_ONLINE_STROKE)
          pathEl.setAttribute('opacity', '1')
        } else {
          // Design mode: pass color gradient
          pathEl.setAttribute('stroke', passColor(ring.passInfo.passNumber, totalPasses))
          pathEl.setAttribute('opacity', '0.9')
        }
        pathEl.setAttribute('stroke-width', '1.5')
        pathEl.setAttribute('vector-effect', 'non-scaling-stroke')
        g.appendChild(pathEl)
      }
      svgEl.appendChild(g)
    }

    // Re-apply the current viewBox immediately after DOM rebuild
    // (avoids the one-frame gap that caused the flash)
    if (outer) {
      const vpW = outer.clientWidth
      const vpH = outer.clientHeight
      setView(prev => {
        const vbW = vpW / prev.scale
        const vbH = vpH / prev.scale
        svgEl.setAttribute('viewBox', `${prev.originX} ${prev.originY} ${vbW} ${vbH}`)
        svgEl.setAttribute('width', String(vpW))
        svgEl.setAttribute('height', String(vpH))
        return prev // no state change — just apply attrs synchronously
      })
    }
  }, [svgText, paths, rings, onTogglePath, previewMode]) // ← selectedIds intentionally excluded

  // -----------------------------------------------------------------------
  // Effect 2: Selection styling — runs when selectedIds or previewMode changes.
  // Updates styles on existing elements; never touches the DOM structure.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const svgEl = svgWrapRef.current?.querySelector('svg')
    if (!svgEl) return

    svgEl.style.background = previewMode === 'shaper' ? '#ffffff' : ''

    svgEl.querySelectorAll('[data-vcarve-id]').forEach(node => {
      const el = node as SVGGraphicsElement
      const id = el.getAttribute('data-vcarve-id') ?? ''
      const cutType = el.getAttribute('data-vcarve-cuttype') ?? 'unknown'

      // Skip hit targets (transparent overlay clones)
      if (!el.getAttribute('data-vcarve-idx') && el.getAttribute('fill') === 'transparent') return

      applyPathStyle(el, selectedIds.has(id), previewMode, cutType)
    })
  }, [selectedIds, previewMode])

  return (
    <div
      ref={outerRef}
      className="relative w-full h-full rounded-lg overflow-hidden transition-colors"
      style={{
        background: previewMode === 'shaper' ? '#e5e5e5' : '#0a0a0a',
        cursor: cmdHeld ? 'default' : 'grab',
      }}
      onDoubleClick={handleDoubleClick}
    >
      {cmdHeld && (
        <style>{`[data-selectable="true"] { cursor: pointer !important; }`}</style>
      )}

      <div ref={svgWrapRef} className="absolute inset-0" />

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
        <span className="text-xs text-neutral-600 bg-neutral-950/70 px-2 py-1 rounded">
          Scroll to zoom · Drag to pan · {SELECT_KEY_LABEL} to select · Double-click to reset
        </span>
      </div>

      {isComputing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-3 bg-neutral-900/85 backdrop-blur-sm border border-neutral-700 rounded-xl px-5 py-3 shadow-lg">
            <svg className="w-5 h-5 text-blue-400 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm text-neutral-200 font-medium">Computing passes…</span>
          </div>
        </div>
      )}
    </div>
  )
}
