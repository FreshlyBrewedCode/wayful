import { useSyncExternalStore } from "react";

/** Breakpoints the layout actually changes behaviour at, not just style at. */
export const BREAKPOINTS = {
  /** Below this the detail panel is an overlay rather than a column. */
  detailOverlay: "(max-width: 1200px)",
  /** Below this the map rail is a sheet rather than a column. */
  railOverlay: "(max-width: 940px)",
  /** Below this a dependency graph is not readable, so the board leads. */
  phone: "(max-width: 720px)",
} as const;

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    // Rendered on the client only; assume the roomy layout if that ever changes.
    () => false,
  );
}
