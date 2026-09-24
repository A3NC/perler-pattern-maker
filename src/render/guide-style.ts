// Guide colours shared by the on-screen view and the PNG export, so a gridline
// in the file reads exactly as it does on screen (D22).
//
// Lifted out of canvas-view.ts rather than imported from it: that module looks
// up its DOM elements at load time, and the export has no business depending on
// the view's markup existing.

// A gridline crosses many cells, so contrast.ts's per-cell choice cannot apply:
// there is no single bead colour to contrast against. Drawn instead as a
// dark/light pair one pixel apart, so one half of the rule always reads.
export const GRID_RULE_DARK = 'rgba(0, 0, 0, 0.55)';
export const GRID_RULE_LIGHT = 'rgba(255, 255, 255, 0.6)';

/** Row and column numbers, on screen and in the export's margin. */
export const RULER_TEXT = '#1F2937';
