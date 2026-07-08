import type { Unit } from '../lib/vcarve'
import { DEFAULT_DPI } from '../lib/vcarve'

export const DEFAULT_MAX_BIT_DIAMETER_IN = 0.25 // 1/4 inch

interface SettingsPanelProps {
  bitAngle: number
  onBitAngle: (v: number) => void
  passes: number
  onPasses: (v: number) => void
  unit: Unit
  onUnit: (u: Unit) => void
  /** DPI is always stored in inches internally */
  dpi: number
  onDpi: (v: number) => void
  /** maxBitDiameter is always stored in inches internally */
  maxBitDiameter: number
  onMaxBitDiameter: (v: number) => void
}

const DEFAULT_DPMM = DEFAULT_DPI / 25.4

export function SettingsPanel({
  bitAngle,
  onBitAngle,
  passes,
  onPasses,
  unit,
  onUnit,
  dpi,
  onDpi,
  maxBitDiameter,
  onMaxBitDiameter,
}: SettingsPanelProps) {
  const isIn = unit === 'in'

  const labelClass = 'block text-xs font-medium text-neutral-400 mb-1'
  const inputClass =
    'w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-100 ' +
    'focus:outline-none focus:border-blue-500 transition-colors'

  // Derived display values in the selected unit
  const bitDiameterDisplay = isIn ? maxBitDiameter : parseFloat((maxBitDiameter * 25.4).toFixed(4))
  const dpmDisplay = isIn ? dpi : parseFloat((dpi / 25.4).toFixed(4))
  const defaultDpmDisplay = isIn ? DEFAULT_DPI : parseFloat(DEFAULT_DPMM.toFixed(4))
  const defaultBitDisplay = isIn ? DEFAULT_MAX_BIT_DIAMETER_IN : parseFloat((DEFAULT_MAX_BIT_DIAMETER_IN * 25.4).toFixed(4))

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">
        Settings
      </h2>

      {/* Unit toggle — at top, controls how all other inputs are displayed */}
      <div>
        <label className={labelClass}>Units</label>
        <div className="flex rounded-lg overflow-hidden border border-neutral-600">
          {(['in', 'mm'] as Unit[]).map(u => (
            <button
              key={u}
              onClick={() => onUnit(u)}
              className={[
                'flex-1 py-2 text-sm font-medium transition-colors',
                unit === u
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700',
              ].join(' ')}
            >
              {u === 'in' ? 'Inches (in)' : 'Millimeters (mm)'}
            </button>
          ))}
        </div>
      </div>

      {/* Max bit diameter — displayed in selected unit */}
      <div>
        <label className={labelClass}>
          Max bit diameter ({isIn ? 'in' : 'mm'})
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            min={isIn ? 0.01 : 0.25}
            max={isIn ? 2 : 50}
            step={isIn ? 0.0625 : 0.5}
            value={bitDiameterDisplay}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (isNaN(v) || v <= 0) return
              onMaxBitDiameter(isIn ? v : v / 25.4)
            }}
            className={inputClass}
          />
          {Math.abs(maxBitDiameter - DEFAULT_MAX_BIT_DIAMETER_IN) > 0.0001 && (
            <button
              onClick={() => onMaxBitDiameter(DEFAULT_MAX_BIT_DIAMETER_IN)}
              className="text-xs text-neutral-400 hover:text-neutral-200 whitespace-nowrap transition-colors"
            >
              Reset
            </button>
          )}
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          {isIn
            ? 'Caps how far rings extend inward per pass. Common: 1/4" (0.25), 1/2" (0.5).'
            : `Caps how far rings extend inward per pass. Default: ${defaultBitDisplay} mm (1/4").`}
        </p>
      </div>

      {/* SVG resolution — DPI when in inches, DPMM when in mm */}
      <div>
        <label className={labelClass}>
          SVG resolution ({isIn ? 'DPI' : 'dots/mm'})
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            min={isIn ? 1 : 0.04}
            max={isIn ? 600 : 24}
            step={isIn ? 1 : 0.01}
            value={dpmDisplay}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (isNaN(v) || v <= 0) return
              onDpi(isIn ? v : v * 25.4)
            }}
            className={inputClass}
          />
          {Math.abs(dpi - DEFAULT_DPI) > 0.001 && (
            <button
              onClick={() => onDpi(DEFAULT_DPI)}
              className="text-xs text-neutral-400 hover:text-neutral-200 whitespace-nowrap transition-colors"
            >
              Reset
            </button>
          )}
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          {isIn
            ? `Shaper SVGs default to ${DEFAULT_DPI} DPI. Change if your design tool differs.`
            : `Shaper SVGs default to ${defaultDpmDisplay.toFixed(2)} dots/mm (72 DPI).`}
        </p>
      </div>

      {/* V-bit angle */}
      <div>
        <label className={labelClass}>V-bit angle (degrees)</label>
        <input
          type="number"
          min={1}
          max={179}
          step={1}
          value={bitAngle}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v) && v > 0 && v < 180) onBitAngle(v)
          }}
          className={inputClass}
        />
        <p className="text-xs text-neutral-500 mt-1">
          Full included angle. Common: 30°, 45°, 60°, 90°.
        </p>
      </div>

      {/* Number of passes */}
      <div>
        <label className={labelClass}>Number of passes</label>
        <input
          type="number"
          min={1}
          max={50}
          step={1}
          value={passes}
          onChange={e => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v) && v >= 1) onPasses(v)
          }}
          className={inputClass}
        />
        <p className="text-xs text-neutral-500 mt-1">
          How many concentric offset rings to generate per shape.
        </p>
      </div>
    </div>
  )
}
