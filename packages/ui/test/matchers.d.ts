// `test/setup.ts` mixes jest-dom's matchers into bun:test's `expect`; this
// tells TypeScript the same thing.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  interface Matchers<T> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<unknown, void> {}
}
