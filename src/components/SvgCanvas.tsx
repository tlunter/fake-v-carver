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
const ZOOM_FACTOR = 1.03

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

  const svgDims = parseSvgDims(svgText)

  const getFitScale = useCallback(() => {
    const el = outerRef.current
    if (!el || !svgDims.w || !svgDims.h) return 1
    return Math.min(el.clientWidth / svgDims.w, el.clientHeight / svgDims.h)
  }, [svgDims.w, svgDims.h])

  // scale: 0 is the sentinel meaning "not yet initialized — compute fit on first inject"
  const [view, setView] = useState<ViewState>({ scale: 0, originX: 0, originY: 0 })
  const [cmdHeld, setCmdHeld] = useState(false)

  const panRef = useRef<{
    active: boolean
    startX: number; startY: number
    startOriginX: number; startOriginY: number
  }>({ active: false, startX: 0, startY: 0, startOriginX: 0, startOriginY: 0 })

  // Always-current ref to view state — lets the injection effect apply the
  // viewBox synchronously without going through setView (which is async).
  const viewRef = useRef(view)
  viewRef.current = view

  /** Apply the correct fill/stroke to a selectable path element. */
  function applyPathStyle(
    el: SVGGraphicsElement,
    isSelected: boolean,
    mode: 'design' | 'shaper'
  ) {
    el.style.vectorEffect = 'non-scaling-stroke'
    el.style.opacity = '1'
    if (mode === 'shaper') {
      if (isSelected) {
        // Selected paths become guide blue — the Shaper encoding for reference paths
        el.style.fill = SHAPER_GUIDE_FILL
        el.style.stroke = 'none'
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
  // Reset to uninitialized when svgText changes so the injection effect
  // recomputes the fit scale for the new file.
  useEffect(() => {
    setView({ scale: 0, originX: 0, originY: 0 })
  }, [svgText])

  // Apply viewBox on every view change (pan/zoom interactions)
  useEffect(() => {
    if (view.scale === 0) return // not yet initialized — injection effect handles first paint
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

  /**
   * Clamp the view origin so the viewport never shows negative SVG coordinates
   * or extends beyond the SVG's width/height. At scales where the SVG is
   * smaller than the viewport (i.e. at fit scale), this centers the SVG.
   */
  function clampOrigin(originX: number, originY: number, scale: number): { originX: number; originY: number } {
    const outer = outerRef.current
    if (!outer || !svgDims.w || !svgDims.h) return { originX, originY }
    const vpW = outer.clientWidth
    const vpH = outer.clientHeight
    // How many SVG units fit in the viewport at this scale
    const visW = vpW / scale
    const visH = vpH / scale
    // If the viewport is wider than the SVG, center horizontally
    const maxOriginX = svgDims.w > visW ? svgDims.w - visW : 0
    const maxOriginY = svgDims.h > visH ? svgDims.h - visH : 0
    const minOriginX = svgDims.w > visW ? 0 : (svgDims.w - visW) / 2
    const minOriginY = svgDims.h > visH ? 0 : (svgDims.h - visH) / 2
    return {
      originX: Math.min(maxOriginX, Math.max(minOriginX, originX)),
      originY: Math.min(maxOriginY, Math.max(minOriginY, originY)),
    }
  }

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
        if (prev.scale === 0) return prev // not yet initialized
        const minScale = Math.min(el.clientWidth / svgDims.w, el.clientHeight / svgDims.h)
        const delta = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
        const newScale = Math.min(MAX_SCALE, Math.max(minScale, prev.scale * delta))
        const svgX = prev.originX + cx / prev.scale
        const svgY = prev.originY + cy / prev.scale
        const rawOriginX = svgX - cx / newScale
        const rawOriginY = svgY - cy / newScale
        const { originX, originY } = clampOrigin(rawOriginX, rawOriginY, newScale)
        return { scale: newScale, originX, originY }
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
      setView(prev => {
        const rawX = panRef.current.startOriginX - dx / prev.scale
        const rawY = panRef.current.startOriginY - dy / prev.scale
        const { originX, originY } = clampOrigin(rawX, rawY, prev.scale)
        return { ...prev, originX, originY }
      })
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
  // SVG injection + path interaction + ring overlay + selection styling.
  // Runs whenever svgText, paths, selectedIds, rings, onTogglePath, or
  // previewMode changes. selectedIds changing always coincides with rings
  // changing (recompute is triggered on selection), so in practice the
  // SVG is not re-injected more often than necessary.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const container = svgWrapRef.current
    const outer = outerRef.current
    if (!container || !outer) return

    // Parse the SVG into a DOM node, apply all attribute adjustments,
    // then assign to innerHTML in a single write — the browser never
    // sees the SVG at the wrong size or without the correct viewBox.
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgText, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')
    if (!svgEl) return

    // Resolve the view to use for this injection.
    // If scale === 0 (sentinel: not yet initialized, or new file loaded),
    // compute the fit scale synchronously now — no rAF needed.
    const vpW = outer.clientWidth
    const vpH = outer.clientHeight
    let v = viewRef.current
    if (v.scale === 0) {
      const fitScale = getFitScale()
      v = { scale: fitScale, originX: 0, originY: 0 }
      // Update both the ref and state so zoom/pan effects see the right value.
      // setView schedules a re-render but viewRef is already correct for this paint.
      viewRef.current = v
      setView(v)
    }

    const vbW = vpW / v.scale
    const vbH = vpH / v.scale
    svgEl.setAttribute('viewBox', `${v.originX} ${v.originY} ${vbW} ${vbH}`)
    svgEl.setAttribute('width', String(vpW))
    svgEl.setAttribute('height', String(vpH))
    svgEl.style.display = 'block'
    svgEl.style.background = previewMode === 'shaper' ? '#ffffff' : ''

    // Single atomic write — browser paints exactly this
    container.innerHTML = new XMLSerializer().serializeToString(svgEl)

    // Re-query the live element from the container for all subsequent DOM work
    const liveSvgEl = container.querySelector('svg')
    if (!liveSvgEl) return

    const byIdx = new Map<number, SvgPathInfo>()
    for (const p of paths) byIdx.set(p.vcarveIdx, p)

    liveSvgEl.querySelectorAll('[data-vcarve-idx]').forEach(node => {
      const el = node as SVGGraphicsElement
      const idx = parseInt(el.getAttribute('data-vcarve-idx') ?? '-1', 10)
      const pathInfo = byIdx.get(idx)
      if (!pathInfo) return

      const isSelectable = pathInfo.isClosed && SELECTABLE_CUT_TYPES.has(pathInfo.cutType)

      if (isSelectable) {
        const isSelected = selectedIds.has(pathInfo.id)
        applyPathStyle(el, isSelected, previewMode)
        el.setAttribute('data-selectable', 'true')
        el.setAttribute('data-vcarve-id', pathInfo.id)
        el.setAttribute('pointer-events', 'all')

        // Fat hit target
        const hitEl = el.cloneNode(false) as SVGGraphicsElement
        hitEl.setAttribute('fill', 'transparent')
        hitEl.setAttribute('stroke', 'transparent')
        hitEl.setAttribute('stroke-width', '12')
        hitEl.setAttribute('pointer-events', 'all')
        hitEl.setAttribute('data-selectable', 'true')
        hitEl.setAttribute('data-vcarve-id', pathInfo.id)
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
        if (previewMode !== 'shaper') {
          el.style.opacity = '0.25'
        }
        el.setAttribute('pointer-events', 'none')
      }
    })

    // Ring overlay
    liveSvgEl.querySelector('#vcarve-rings')?.remove()
    if (rings.length > 0) {
      const totalPasses = Math.max(...rings.map(r => r.passInfo.passNumber))
      const g = document.createElementNS(SVG_NS, 'g')
      g.setAttribute('id', 'vcarve-rings')
      g.setAttribute('pointer-events', 'none')
      for (const ring of rings) {
        const pathEl = document.createElementNS(SVG_NS, 'path')
        pathEl.setAttribute('d', ring.d)
        pathEl.setAttribute('fill', 'none')
        if (previewMode === 'shaper') {
          pathEl.setAttribute('stroke', SHAPER_ONLINE_STROKE)
          pathEl.setAttribute('opacity', '1')
        } else {
          pathEl.setAttribute('stroke', passColor(ring.passInfo.passNumber, totalPasses))
          pathEl.setAttribute('opacity', '0.9')
        }
        pathEl.setAttribute('stroke-width', '1.5')
        pathEl.setAttribute('vector-effect', 'non-scaling-stroke')
        g.appendChild(pathEl)
      }
      liveSvgEl.appendChild(g)
    }
  }, [svgText, paths, selectedIds, rings, onTogglePath, previewMode, getFitScale])

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
