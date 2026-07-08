import type { PassInfo } from '../lib/vcarve'
import { passColor } from '../lib/passColor'

interface InfoPanelProps {
  passes: PassInfo[]
  maxInscribedRadiusPx: number | null
  pxPerUnit: number
  unit: string
  selectedCount: number
}

function fmtUnit(px: number, pxPerUnit: number, unit: string): string {
  const v = px / pxPerUnit
  return `${parseFloat(v.toPrecision(4))} ${unit}`
}

export function InfoPanel({
  passes,
  maxInscribedRadiusPx,
  pxPerUnit,
  unit,
  selectedCount,
}: InfoPanelProps) {
  if (selectedCount === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">
          Pass Info
        </h2>
        <p className="text-sm text-neutral-500">
          Select one or more closed paths on the canvas to see computed pass depths.
        </p>
      </div>
    )
  }

  const totalPasses = passes.length

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">
        Pass Info
      </h2>

      {maxInscribedRadiusPx !== null && passes.length > 0 && (
        <div className="bg-neutral-800 rounded-lg p-3 text-xs text-neutral-400 space-y-1">
          <div className="flex justify-between">
            <span>Max inscribed radius (R)</span>
            <span className="text-neutral-200 font-mono">
              {fmtUnit(maxInscribedRadiusPx, pxPerUnit, unit)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Depth / pass</span>
            <span className="text-neutral-200 font-mono">
              {passes[0].depthLabel}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Inset / pass</span>
            <span className="text-neutral-200 font-mono">
              {fmtUnit(passes[0].insetPx, pxPerUnit, unit)}
            </span>
          </div>
        </div>
      )}

      {passes.length > 0 && (
        <div className="overflow-auto rounded-lg border border-neutral-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-neutral-800 text-neutral-400">
                <th className="text-left px-3 py-2">Pass</th>
                <th className="text-right px-3 py-2">Depth ({unit})</th>
                <th className="text-right px-3 py-2">Inset ({unit})</th>
              </tr>
            </thead>
            <tbody>
              {passes.map(p => {
                const color = passColor(p.passNumber, totalPasses)
                const insetLabel = fmtUnit(p.insetPx, pxPerUnit, unit)
                return (
                  <tr
                    key={p.passNumber}
                    className="border-t border-neutral-700 hover:bg-neutral-800/50"
                  >
                    <td className="px-3 py-1.5 text-neutral-300">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        {p.passNumber}
                      </div>
                    </td>
                    <td
                      className="px-3 py-1.5 text-right font-mono font-semibold"
                      style={{ color }}
                    >
                      {p.depthLabel}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right font-mono"
                      style={{ color }}
                    >
                      {insetLabel}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
