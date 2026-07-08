/**
 * Shaper Origin color encoding constants.
 *
 * These colors are used both in the live preview (SvgCanvas) and in the
 * exported SVG (svgExporter) to ensure the two are always consistent.
 *
 * Reference: https://support.shapertools.com/hc/en-us/articles/115002721473
 */

/** Anchor cut type — red fill and stroke. Registration/alignment mark. */
export const SHAPER_ANCHOR_FILL = '#ff0000'

/** Guide cut type — blue fill. Used for reference/original paths. */
export const SHAPER_GUIDE_FILL = '#0068ff'

/** Online cut type — gray stroke, no fill. Used for engraving/offset paths. */
export const SHAPER_ONLINE_STROKE = '#7f7f7f'

/** Exterior cut type — black fill. Cuts outside the path boundary. */
export const SHAPER_EXTERIOR_FILL = '#000000'

/** Pocket cut type — gray fill. Removes material within the path. */
export const SHAPER_POCKET_FILL = '#7f7f7f'

/** Shaper XML namespace URI. */
export const SHAPER_NS = 'http://www.shapertools.com/namespaces/shaper'

/** Shaper XML namespace attribute name. */
export const SHAPER_NS_PREFIX = 'xmlns:shaper'
