// Component tests drive a real DOM. Pure-logic tests ignore it; registering it
// globally keeps a single test command for both.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!("document" in globalThis)) {
  // Wide enough for the roomy layout: rail, map and detail panel all inline.
  // Tests that care about a narrower one resize the window themselves.
  GlobalRegistrator.register({ url: "http://localhost/", width: 1440, height: 900 });
}

const { expect } = await import("bun:test");
const matchers = await import("@testing-library/jest-dom/matchers");
expect.extend({ ...matchers } as never);

// Radix and the graph canvas both reach for APIs happy-dom does not ship.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.EventSource ??= class extends EventTarget {
  close() {}
} as never;
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}
