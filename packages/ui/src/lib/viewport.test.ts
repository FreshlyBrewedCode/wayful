import { describe, expect, test } from "bun:test";

import {
  LEGIBLE_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  constrainPan,
  fitTransform,
  panIntoView,
  zoomAbout,
} from "@/lib/viewport";

const viewport = { width: 1000, height: 600 };

describe("fitTransform", () => {
  test("centres content that already fits without magnifying it", () => {
    const t = fitTransform({ width: 400, height: 200 }, viewport)!;

    expect(t.scale).toBe(1);
    expect(t.x).toBe((1000 - 400) / 2);
    expect(t.y).toBe((600 - 200) / 2);
  });

  test("scales oversized content down to fit", () => {
    const t = fitTransform({ width: 4000, height: 600 }, viewport)!;

    expect(t.scale).toBeLessThan(1);
    expect(4000 * t.scale).toBeLessThanOrEqual(1000);
  });

  test("the opening view is floored at a legible zoom even when that overflows", () => {
    const t = fitTransform({ width: 40_000, height: 600 }, viewport, LEGIBLE_SCALE)!;

    expect(t.scale).toBe(LEGIBLE_SCALE);
  });

  test("an explicit fit has no legibility floor and is honest about the whole map", () => {
    const t = fitTransform({ width: 40_000, height: 600 }, viewport)!;

    expect(t.scale).toBeLessThan(LEGIBLE_SCALE);
    expect(t.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });

  test("a zero-sized viewport is not laid out at all", () => {
    expect(fitTransform({ width: 100, height: 100 }, { width: 0, height: 0 })).toBeNull();
  });
});

describe("zoomAbout", () => {
  test("whatever sits under the pointer stays under the pointer", () => {
    const before = { scale: 1, x: -100, y: -50 };
    // The content point currently beneath viewport (400, 300).
    const contentX = (400 - before.x) / before.scale;
    const contentY = (300 - before.y) / before.scale;

    const after = zoomAbout(before, 2, 400, 300);

    expect(contentX * after.scale + after.x).toBeCloseTo(400);
    expect(contentY * after.scale + after.y).toBeCloseTo(300);
  });

  test("scale is clamped to the supported range", () => {
    expect(zoomAbout({ scale: 1, x: 0, y: 0 }, 99, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAbout({ scale: 1, x: 0, y: 0 }, 0.001, 0, 0).scale).toBe(MIN_SCALE);
  });

  test("zooming to the current scale changes nothing", () => {
    const t = { scale: 1, x: 12, y: 34 };
    expect(zoomAbout(t, 1, 400, 300)).toEqual(t);
  });
});

describe("constrainPan", () => {
  test("leaves a transform that keeps the map on screen alone", () => {
    const t = { scale: 1, x: 10, y: 10 };
    expect(constrainPan(t, { width: 500, height: 400 }, viewport)).toEqual(t);
  });

  test("stops the map being dragged entirely off the right edge", () => {
    const t = constrainPan({ scale: 1, x: 5000, y: 0 }, { width: 500, height: 400 }, viewport);
    expect(t.x).toBeLessThan(viewport.width);
  });

  test("stops the map being dragged entirely off the left edge", () => {
    const content = { width: 500, height: 400 };
    const t = constrainPan({ scale: 1, x: -5000, y: 0 }, content, viewport);
    expect(t.x + content.width).toBeGreaterThan(0);
  });
});

describe("panIntoView", () => {
  test("an already-visible node is left where it is", () => {
    const t = { scale: 1, x: 0, y: 0 };
    expect(panIntoView(t, { x: 100, y: 100, width: 200, height: 100 }, viewport)).toEqual(t);
  });

  test("a node off the right edge is pulled back in", () => {
    const after = panIntoView(
      { scale: 1, x: 0, y: 0 },
      { x: 1500, y: 100, width: 200, height: 100 },
      viewport,
    );
    expect(1500 + 200 + after.x).toBeLessThanOrEqual(viewport.width);
  });

  test("a node above the top edge is pulled back in", () => {
    const after = panIntoView(
      { scale: 1, x: 0, y: -800 },
      { x: 100, y: 100, width: 200, height: 100 },
      viewport,
    );
    expect(100 + after.y).toBeGreaterThanOrEqual(0);
  });

  test("the node's own scale is respected", () => {
    const after = panIntoView(
      { scale: 0.5, x: 0, y: 0 },
      { x: 1900, y: 0, width: 200, height: 100 },
      viewport,
    );
    expect(1900 * 0.5 + 200 * 0.5 + after.x).toBeLessThanOrEqual(viewport.width);
  });
});
