import { useCallback, useEffect, useRef, useState } from 'react'
import { DropZone } from './components/DropZone'
import { SvgCanvas } from './components/SvgCanvas'
import { SettingsPanel, DEFAULT_MAX_BIT_DIAMETER_IN } from './components/SettingsPanel'
import { InfoPanel } from './components/InfoPanel'
import { parseSvg, flattenPath, buildTransformFromAttributes, AUTO_SELECTED_CUT_TYPES } from './lib/svgParser'
import type { SvgPathInfo } from './lib/svgParser'
import { findMaxInscribedRadius, offsetContoursToCurves } from './lib/offsetEngine'
import { computePassTable, degToRad, computePxPerMm, DEFAULT_DPI } from './lib/vcarve'
import type { Unit, PassInfo } from './lib/vcarve'
import { buildOutputSvg, downloadSvg } from './lib/svgExporter'
import type { GeneratedRing } from './lib/svgExporter'
import { SHAPER_GUIDE_FILL } from './lib/shaperColors'

/**
 * Yield control back to the browser event loop so rendering and user
 * interactions can proceed between heavy computation steps.
 *
 * Uses MessageChannel instead of setTimeout(fn, 0) because browsers clamp
 * setTimeout to a minimum of ~4ms after nesting. MessageChannel posts a
 * macrotask with no artificial delay — the same approach React's own
 * scheduler uses internally.
 */
const yieldFrame = (() => {
  const channel = new MessageChannel()
  const callbacks: Array<() => void> = []
  channel.port1.onmessage = () => callbacks.shift()?.()
  return () => new Promise<void>(resolve => {
    callbacks.push(resolve)
    channel.port2.postMessage(null)
  })
})()

export default function App() {
  // --- File state ---
  const [svgText, setSvgText] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('design.svg')

  // --- Parsed paths ---
  const [paths, setPaths] = useState<SvgPathInfo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // --- Settings ---
  const [bitAngle, setBitAngle] = useState(60)
  const [passes, setPasses] = useState(4)
  const [unit, setUnit] = useState<Unit>('in')
  const [dpi, setDpi] = useState(DEFAULT_DPI)
  // Max bit diameter in inches — caps how far inward offset rings can extend
  const [maxBitDiameter, setMaxBitDiameter] = useState(DEFAULT_MAX_BIT_DIAMETER_IN)

  // --- Computed results ---
  const [rings, setRings] = useState<GeneratedRing[]>([])
  const [passTable, setPassTable] = useState<PassInfo[]>([])
  const [maxR, setMaxR] = useState<number | null>(null)
  const [pxPerUnit, setPxPerUnit] = useState(DEFAULT_DPI / 25.4)
  const [isComputing, setIsComputing] = useState(false)
  const [previewMode, setPreviewMode] = useState<'design' | 'shaper'>('design')

  // Cancellation token: each computation run increments this; a stale run
  // checks its snapshot against the current value and aborts if they differ.
  const computeGenRef = useRef(0)

  // Store the stamped SVG text for DPI recalculation when dpi/unit changes
  const stampedSvgTextRef = useRef<string | null>(null)

  // Store the parsed SVG document for transform lookups during ring computation
  const parsedDocRef = useRef<Document | null>(null)

  // Per-path geometry cache: keyed by vcarveIdx.
  // Stores the expensive flattenPath + findMaxInscribedRadius results so
  // re-selecting a previously computed path skips those steps entirely.
  // Cleared when a new file is loaded.
  const pathGeoCacheRef = useRef<Map<number, {
    contours: { x: number; y: number }[][]
    inscribedRadius: number
  }>>(new Map())

  /** Recompute pxPerUnit from the current stamped SVG text, dpi, and unit */
  const recalcPxPerUnit = useCallback((svgTxt: string, currentDpi: number, currentUnit: Unit) => {
    const pxMm = computePxPerMm(svgTxt, currentDpi)
    setPxPerUnit(currentUnit === 'mm' ? pxMm : pxMm * 25.4)
  }, [])

  // --- Load file ---
  const handleFile = useCallback((text: string, name: string) => {
    setFileName(name)
    setRings([])
    setPassTable([])
    setMaxR(null)
    pathGeoCacheRef.current.clear()

    const { stampedSvgText, paths: extractedPaths } = parseSvg(text)
    setSvgText(stampedSvgText)
    setPaths(extractedPaths)
    stampedSvgTextRef.current = stampedSvgText

    // Auto-select all closed paths whose cut type is selectable (online, interior,
    // exterior, or unknown). Pocket and guide are excluded.
    const autoSelected = new Set(
      extractedPaths
        .filter(p => p.isClosed && AUTO_SELECTED_CUT_TYPES.has(p.cutType))
        .map(p => p.id)
    )
    setSelectedIds(autoSelected)

    // Keep a parsed copy for transform lookups
    const parser = new DOMParser()
    const doc = parser.parseFromString(stampedSvgText, 'image/svg+xml')
    parsedDocRef.current = doc

    recalcPxPerUnit(stampedSvgText, dpi, unit)
  }, [dpi, unit, recalcPxPerUnit])

  // Recalculate pxPerUnit whenever unit or DPI changes
  useEffect(() => {
    if (stampedSvgTextRef.current) {
      recalcPxPerUnit(stampedSvgTextRef.current, dpi, unit)
    }
  }, [unit, dpi, recalcPxPerUnit])

  // --- Toggle path selection ---
  const handleTogglePath = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // --- Recompute rings whenever selection or settings change ---
  useEffect(() => {
    // Increment generation — any in-flight run from a previous generation will abort
    const gen = ++computeGenRef.current

    if (!svgText || selectedIds.size === 0 || !parsedDocRef.current) {
      setRings([])
      setPassTable([])
      setMaxR(null)
      setIsComputing(false)
      return
    }

    setIsComputing(true)

    const doc = parsedDocRef.current
    const svgRoot = doc.documentElement
    const selectedPaths = paths.filter(p => selectedIds.has(p.id))

    if (selectedPaths.length === 0) {
      setRings([])
      setPassTable([])
      setMaxR(null)
      setIsComputing(false)
      return
    }

    const halfAngleRad = degToRad(bitAngle)

    // Run the heavy computation asynchronously, yielding between each path
    // so the browser can handle interactions and render updates.
    ;(async () => {
    // --- Phase 1: flatten paths (cache hit skips DOM work) ---
    const pathData: { id: string; contours: { x: number; y: number }[][] }[] = []

    for (const pathInfo of selectedPaths) {
      if (gen !== computeGenRef.current) return

      const cached = pathGeoCacheRef.current.get(pathInfo.vcarveIdx)
      if (cached) {
        pathData.push({ id: pathInfo.id, contours: cached.contours })
        continue
      }

      const el = svgRoot.querySelector(`[data-vcarve-idx="${pathInfo.vcarveIdx}"]`)
      if (!el) continue
      const transform = buildTransformFromAttributes(el, svgRoot)
      const contours = flattenPath(pathInfo.dString, transform)
      if (contours.length > 0 && contours.some(c => c.length >= 3)) {
        // Store partial cache entry — inscribedRadius filled in Phase 2
        pathGeoCacheRef.current.set(pathInfo.vcarveIdx, { contours, inscribedRadius: -1 })
        pathData.push({ id: pathInfo.id, contours })
      }
      await yieldFrame()
    }

      if (gen !== computeGenRef.current) return
      if (pathData.length === 0) {
        setRings([])
        setPassTable([])
        setMaxR(null)
        setIsComputing(false)
        return
      }

    // --- Phase 2: find inscribed radii per path (cache hit skips Clipper binary search) ---
    const bitRadiusPx = (maxBitDiameter / 2) * dpi

    const pathRadii: number[] = []
    for (const { id, contours } of pathData) {
      if (gen !== computeGenRef.current) return

      // Find the vcarveIdx for this path to check the cache
      const pathInfo = selectedPaths.find(p => p.id === id)!
      const cached = pathGeoCacheRef.current.get(pathInfo.vcarveIdx)

      let radius: number
      if (cached && cached.inscribedRadius >= 0) {
        radius = cached.inscribedRadius
      } else {
        radius = findMaxInscribedRadius(contours)
        if (cached) cached.inscribedRadius = radius
        await yieldFrame()
      }
      pathRadii.push(radius)
    }

      if (gen !== computeGenRef.current) return

      const displayMaxR = Math.max(...pathRadii)
      if (displayMaxR <= 0) {
        setRings([])
        setPassTable([])
        setMaxR(null)
        setIsComputing(false)
        return
      }

      setMaxR(displayMaxR)
      // Info panel uses the widest path's table for display
      const displayTable = computePassTable(displayMaxR, passes, halfAngleRad, pxPerUnit, unit, bitRadiusPx)
      setPassTable(displayTable)

      // --- Phase 3: generate rings per path using that path's own R and capped step ---
      const allRings: GeneratedRing[] = []

      for (let i = 0; i < pathData.length; i++) {
        if (gen !== computeGenRef.current) return

        const { id, contours } = pathData[i]
        const pathR = pathRadii[i]
        if (pathR <= 0) continue

        // Each path's step = min(pathR/N, bitRadiusPx)
        const pathTable = computePassTable(pathR, passes, halfAngleRad, pxPerUnit, unit, bitRadiusPx)

        for (const passInfo of pathTable) {
          if (gen !== computeGenRef.current) return

          const curveDs = offsetContoursToCurves(contours, passInfo.insetPx)
          // Empty result means the offset collapsed — no more passes fit for this path
          if (curveDs.length === 0) break
          for (const d of curveDs) {
            allRings.push({ d, passInfo, sourceId: id })
          }
          await yieldFrame()
        }
      }

      if (gen !== computeGenRef.current) return
      setRings(allRings)
      setIsComputing(false)
    })()
  }, [svgText, paths, selectedIds, bitAngle, passes, unit, pxPerUnit, maxBitDiameter, dpi])

  // --- Export ---
  const handleDownload = () => {
    if (!svgText) return
    const selectedPathInfos = paths.filter(p => selectedIds.has(p.id))
    const outputSvg = buildOutputSvg(svgText, rings, selectedPathInfos)
    downloadSvg(outputSvg, fileName)
  }

  const canDownload = rings.length > 0

  // ---- Render ----
  if (!svgText) {
    return (
      <div className="flex flex-col min-h-screen">
        <header className="px-6 py-4 border-b border-neutral-800 flex items-center gap-3">
          <span className="text-lg font-semibold text-neutral-100">Fake V-Carver</span>
          <span className="text-xs text-neutral-500">SVG depth encoder for Shaper Origin</span>
        </header>
        <DropZone onFile={handleFile} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex-shrink-0 px-6 py-3 border-b border-neutral-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-neutral-100">Fake V-Carver</span>
          <span className="text-xs text-neutral-500">{fileName}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPreviewMode(m => m === 'design' ? 'shaper' : 'design')}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              previewMode === 'shaper'
                ? 'bg-neutral-100 text-neutral-900 border-neutral-300'
                : 'bg-neutral-800 text-neutral-400 border-neutral-600 hover:border-neutral-400 hover:text-neutral-200',
            ].join(' ')}
            title="Toggle between design preview and Shaper Origin color encoding preview"
          >
            {previewMode === 'shaper' ? (
              <>
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: SHAPER_GUIDE_FILL }} />
                Shaper preview
              </>
            ) : (
              <>
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
                Design preview
              </>
            )}
          </button>
          <button
            onClick={() => {
              setSvgText(null)
              setPaths([])
              setSelectedIds(new Set())
              setRings([])
              setPassTable([])
              setMaxR(null)
              parsedDocRef.current = null
              stampedSvgTextRef.current = null
              pathGeoCacheRef.current.clear()
            }}
            className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Load new file
          </button>
          <button
            onClick={handleDownload}
            disabled={!canDownload}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              canDownload
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-neutral-700 text-neutral-500 cursor-not-allowed',
            ].join(' ')}
          >
            Download SVG
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 p-4 overflow-auto">
          <SvgCanvas
            svgText={svgText}
            paths={paths}
            selectedIds={selectedIds}
            rings={rings}
            isComputing={isComputing}
            previewMode={previewMode}
            onTogglePath={handleTogglePath}
          />
        </div>

        <div className="flex-shrink-0 w-72 border-l border-neutral-800 overflow-y-auto p-5 flex flex-col gap-8">
          <SettingsPanel
            bitAngle={bitAngle}
            onBitAngle={setBitAngle}
            passes={passes}
            onPasses={setPasses}
            unit={unit}
            onUnit={setUnit}
            dpi={dpi}
            onDpi={setDpi}
            maxBitDiameter={maxBitDiameter}
            onMaxBitDiameter={setMaxBitDiameter}
          />
          <div className="border-t border-neutral-800" />
          {isComputing ? (
            <p className="text-xs text-neutral-500">Computing…</p>
          ) : (
            <InfoPanel
              passes={passTable}
              maxInscribedRadiusPx={maxR}
              pxPerUnit={pxPerUnit}
              unit={unit}
              selectedCount={selectedIds.size}
            />
          )}
        </div>
      </div>
    </div>
  )
}
