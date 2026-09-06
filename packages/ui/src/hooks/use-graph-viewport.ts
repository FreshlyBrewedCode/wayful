import { useCallback, useEffect, useRef, useState } from "react";

import {
  LEGIBLE_SCALE,
  MIN_SCALE,
  type Rect,
  type Size,
  type Transform,
  constrainPan,
  fitTransform,
  panIntoView,
  zoomAbout,
} from "@/lib/viewport";

type Mode = "auto" | "fit" | "manual";

/**
 * Panning must survive a re-render — selecting a step, a live-reload push, a
 * trip through the board view — but a different map should open fitted. The
 * transform is therefore keyed to what is drawn and cached outside React.
 */
const remembered = new Map<string, { mode: Mode; transform: Transform }>();

export interface GraphViewport {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
  zoomBy: (factor: number) => void;
  zoomTo: (scale: number) => void;
  fit: () => void;
}

/**
 * A transform-based pan/zoom viewport: drag pans, wheel and pinch zoom about
 * the pointer, and keyboard focus pans an off-screen node into view (a
 * transformed canvas cannot be scrolled into view by the browser).
 */
export function useGraphViewport(content: Size, key: string): GraphViewport {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<Mode>("auto");
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  const measure = useCallback((): Size => {
    const wrap = wrapRef.current;
    return { width: wrap?.clientWidth ?? 0, height: wrap?.clientHeight ?? 0 };
  }, []);

  const apply = useCallback(
    (next: Transform) => {
      transformRef.current = next;
      remembered.set(key, { mode: modeRef.current, transform: next });
      if (canvasRef.current) {
        canvasRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
      }
      setScale(next.scale);
    },
    [key],
  );

  /** `auto` is the opening view and stays legible; `fit` shows everything. */
  const reset = useCallback(
    (mode: Mode) => {
      const fitted = fitTransform(content, measure(), mode === "auto" ? LEGIBLE_SCALE : MIN_SCALE);
      if (!fitted) return;
      modeRef.current = mode;
      apply(fitted);
    },
    [apply, content, measure],
  );

  useEffect(() => {
    const saved = remembered.get(key);
    if (saved?.mode === "manual") {
      modeRef.current = "manual";
      apply(saved.transform);
    } else {
      reset(saved?.mode ?? "auto");
    }
  }, [key, apply, reset]);

  const pan = useCallback(
    (dx: number, dy: number) => {
      modeRef.current = "manual";
      const moved = {
        ...transformRef.current,
        x: transformRef.current.x + dx,
        y: transformRef.current.y + dy,
      };
      apply(constrainPan(moved, content, measure()));
    },
    [apply, content, measure],
  );

  const zoom = useCallback(
    (next: number, px: number, py: number) => {
      const zoomed = zoomAbout(transformRef.current, next, px, py);
      if (zoomed === transformRef.current) return;
      modeRef.current = "manual";
      apply(constrainPan(zoomed, content, measure()));
    },
    [apply, content, measure],
  );

  // --- wheel: ctrl/⌘ or a pure vertical wheel zooms; a trackpad swipe pans.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = wrap.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey || event.deltaX === 0) {
        const factor = Math.exp(-event.deltaY * 0.0018);
        zoom(
          transformRef.current.scale * factor,
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      } else {
        pan(-event.deltaX, -event.deltaY);
      }
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [pan, zoom]);

  // --- pointers: one drags, two pinch.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { distance: number; scale: number; px: number; py: number } | null = null;
    let travelled = 0;

    const pinchFrom = () => {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return null;
      const rect = wrap.getBoundingClientRect();
      return {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: transformRef.current.scale,
        px: (a.x + b.x) / 2 - rect.left,
        py: (a.y + b.y) / 2 - rect.top,
      };
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if ((event.target as Element).closest("[data-graph-hud]")) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      travelled = 0;
      if (pointers.size === 2) pinch = pinchFrom();
      wrap.setPointerCapture(event.pointerId);
      wrap.dataset.grabbing = "true";
    };

    const onMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      travelled += Math.abs(dx) + Math.abs(dy);

      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        zoom((distance / pinch.distance) * pinch.scale, pinch.px, pinch.py);
        return;
      }
      pan(dx, dy);
    };

    const onRelease = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size) return;
      delete wrap.dataset.grabbing;
      if (travelled > 6) {
        wrap.dataset.dragged = "true";
        setTimeout(() => delete wrap.dataset.dragged, 0);
      }
    };

    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onRelease);
    wrap.addEventListener("pointercancel", onRelease);
    return () => {
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onRelease);
      wrap.removeEventListener("pointercancel", onRelease);
    };
  }, [pan, zoom]);

  // --- keyboard users tab through nodes; bring the focused one into view.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onFocusIn = (event: FocusEvent) => {
      const node = (event.target as Element | null)?.closest<HTMLElement>("[data-graph-node]");
      if (!node) return;
      const rect: Rect = {
        x: Number.parseFloat(node.style.left),
        y: Number.parseFloat(node.style.top),
        width: node.offsetWidth,
        height: node.offsetHeight,
      };
      const moved = panIntoView(transformRef.current, rect, measure());
      if (moved === transformRef.current) return;
      modeRef.current = "manual";
      apply(moved);
    };
    wrap.addEventListener("focusin", onFocusIn);
    return () => wrap.removeEventListener("focusin", onFocusIn);
  }, [apply, measure]);

  // --- a resized column re-fits an untouched view and re-constrains a panned one.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      if (modeRef.current === "manual") {
        apply(constrainPan(transformRef.current, content, measure()));
      } else {
        reset(modeRef.current);
      }
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [apply, content, measure, reset]);

  const centre = useCallback((): [number, number] => {
    const { width, height } = measure();
    return [width / 2, height / 2];
  }, [measure]);

  return {
    wrapRef,
    canvasRef,
    scale,
    zoomBy: (factor) => zoom(transformRef.current.scale * factor, ...centre()),
    zoomTo: (next) => zoom(next, ...centre()),
    fit: () => reset("fit"),
  };
}
