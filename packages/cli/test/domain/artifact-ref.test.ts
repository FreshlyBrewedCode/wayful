import { describe, expect, test } from "bun:test";

import { WayfulError } from "../../src/domain/errors";
import { classifyRef, normalizeRef } from "../../src/domain/artifact-ref";

describe("classifyRef", () => {
  test("rejects a ref with no scheme", () => {
    expect(() => classifyRef("docs/research/summary.md")).toThrow(WayfulError);
    expect(() => classifyRef("docs/research/summary.md")).toThrow(/not valid/);
  });

  test("rejects a ref whose scheme doesn't match the grammar", () => {
    // Uppercase and a leading digit both violate `^[a-z][a-z0-9+.-]*:`.
    expect(() => classifyRef("HTTPS://example.com")).toThrow(/not valid/);
    expect(() => classifyRef("9https://example.com")).toThrow(/not valid/);
  });

  test("classifies a valid non-file scheme as opaque", () => {
    expect(classifyRef("https://example.com/a")).toEqual({
      kind: "opaque",
      scheme: "https",
      opaque: "//example.com/a",
    });
    expect(classifyRef("git:refs/heads/main")).toEqual({
      kind: "opaque",
      scheme: "git",
      opaque: "refs/heads/main",
    });
  });

  test("rejects an absolute file: ref with the ADR's exact error text", () => {
    // file:/path (single slash, no authority)
    expect(() => classifyRef("file:/etc/passwd")).toThrow(
      "ref 'file:/etc/passwd' is not valid; wayful's file: refs are project-relative (e.g. 'file:docs/research/summary.md').",
    );
    // file:///path (absolute, triple slash)
    expect(() => classifyRef("file:///home/me/notes.md")).toThrow(
      "ref 'file:///home/me/notes.md' is not valid; wayful's file: refs are project-relative (e.g. 'file:docs/research/summary.md').",
    );
    // file://host/path (authority form)
    expect(() => classifyRef("file://host/path")).toThrow(
      "ref 'file://host/path' is not valid; wayful's file: refs are project-relative (e.g. 'file:docs/research/summary.md').",
    );
  });

  test("classifies a valid project-relative file: ref", () => {
    expect(classifyRef("file:docs/research/summary.md")).toEqual({
      kind: "file",
      path: "docs/research/summary.md",
    });
  });
});

describe("normalizeRef", () => {
  test("strips a leading './' and collapses '//' in a file: ref", () => {
    expect(normalizeRef("file:./a//b.md")).toBe(normalizeRef("file:a/b.md"));
    expect(normalizeRef("file:./a//b.md")).toBe("file:a/b.md");
  });

  test("two refs differing only in normalization resolve to one identity", () => {
    expect(normalizeRef("file:./docs//research/summary.md")).toBe(
      normalizeRef("file:docs/research/summary.md"),
    );
  });

  test("trims but never otherwise parses a non-file scheme, comparing byte-exact", () => {
    expect(normalizeRef("https://example.com/a  ")).toBe("https://example.com/a");
    // Case and internal structure of an opaque scheme are never normalized.
    expect(normalizeRef("https://Example.com/a")).not.toBe(normalizeRef("https://example.com/a"));
  });

  test("rejects an invalid ref, same as classifyRef", () => {
    expect(() => normalizeRef("file:///home/me/notes.md")).toThrow(WayfulError);
  });
});
