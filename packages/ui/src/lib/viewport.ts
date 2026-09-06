// Pan/zoom arithmetic for the graph canvas, kept free of the DOM so it can be
// reasoned about — and tested — without a browser.

export const MIN_SCALE = 0.15;
export const MAX_SCALE = 2.5;

/** Below this, node labels stop being words. The opening view never goes under it. */
export const LEGIBLE_SCALE = 0.55;

/** How much of the canvas must stay on screen, in viewport pixels. */
export const PAN_MARGIN = 90;

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/**
 * Centres `content` in `viewport` at the largest scale that fits, never
 * magnifying past 1. `floor` is what separates the two flavours of reset: the
 * opening view floors at {@link LEGIBLE_SCALE} and expects panning to cover the
 * rest, while an explicit fit passes no floor and shows everything.
 *
 * Returns `null` for a viewport that has not been measured yet.
 */
export function fitTransform(
  content: Size,
  viewport: Size,
  floor: number = MIN_SCALE,
): Transform | null {
  if (!viewport.width || !viewport.height) return null;
  const scale = clamp(
    Math.min(viewport.width / (content.width + 24), viewport.height / (content.height + 24), 1),
    floor,
    MAX_SCALE,
  );
  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
}

/** Zoom about a viewport point, so whatever is under it stays under it. */
export function zoomAbout(t: Transform, nextScale: number, px: number, py: number): Transform {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  if (scale === t.scale) return t;
  return {
    scale,
    x: px - (px - t.x) * (scale / t.scale),
    y: py - (py - t.y) * (scale / t.scale),
  };
}

/** Keep at least a corner of the canvas on screen, whatever the user drags. */
export function constrainPan(
  t: Transform,
  content: Size,
  viewport: Size,
  margin: number = PAN_MARGIN,
): Transform {
  const x = clamp(t.x, -(content.width * t.scale) + margin, viewport.width - margin);
  const y = clamp(t.y, -(content.height * t.scale) + margin, viewport.height - margin);
  return x === t.x && y === t.y ? t : { ...t, x, y };
}

/**
 * Nudge the canvas so `node` (in content coordinates) is fully visible. A
 * transformed canvas cannot be scrolled into view by the browser, so keyboard
 * focus has to move the viewport itself.
 */
export function panIntoView(t: Transform, node: Rect, viewport: Size, pad: number = 24): Transform {
  const left = node.x * t.scale + t.x;
  const top = node.y * t.scale + t.y;
  const right = left + node.width * t.scale;
  const bottom = top + node.height * t.scale;

  const dx = Math.max(0, pad - left) - Math.max(0, right + pad - viewport.width);
  const dy = Math.max(0, pad - top) - Math.max(0, bottom + pad - viewport.height);
  return dx === 0 && dy === 0 ? t : { ...t, x: t.x + dx, y: t.y + dy };
}
