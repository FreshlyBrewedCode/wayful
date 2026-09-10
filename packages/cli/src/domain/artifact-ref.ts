import { WayfulError } from "./errors";

const SCHEME = /^[a-z][a-z0-9+.-]*:/;

const fail = (message: string): never => {
  throw new WayfulError({ message });
};

/** An artifact ref classified per ADR-0001: `file:` is project-relative and interpreted; every other scheme is opaque. */
export type Ref =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "opaque"; readonly scheme: string; readonly opaque: string };

/**
 * Classifies a raw ref string per ADR-0001's grammar, without normalizing
 * it. `file:` paths are returned exactly as written; use `normalizeRef` for
 * the canonical identity form.
 */
export function classifyRef(raw: string): Ref {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const match = SCHEME.exec(trimmed);
  if (!match)
    return fail(
      `ref '${raw}' is not valid; a ref must begin with a scheme matching '^[a-z][a-z0-9+.-]*:' (e.g. 'file:docs/research/summary.md').`,
    );
  const scheme = match[0].slice(0, -1);
  const rest = trimmed.slice(match[0].length);
  if (scheme === "file") {
    if (rest.startsWith("/"))
      fail(
        `ref '${raw}' is not valid; wayful's file: refs are project-relative (e.g. 'file:docs/research/summary.md').`,
      );
    return { kind: "file", path: rest };
  }
  return { kind: "opaque", scheme, opaque: rest };
}

/** Strips a leading `./` and collapses `//` runs, per ADR-0004's `file:` normalization. */
function normalizeFilePath(path: string): string {
  let normalized = path.replace(/\/{2,}/g, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized;
}

/**
 * Classifies and normalizes a raw ref into ADR-0004's canonical identity
 * form: a `file:` ref has `./` stripped and `//` collapsed; every other
 * scheme is trimmed and returned byte-exact, never parsed. Two refs that
 * normalize to the same string are the same artifact identity.
 */
export function normalizeRef(raw: string): string {
  const ref = classifyRef(raw);
  return ref.kind === "file"
    ? `file:${normalizeFilePath(ref.path)}`
    : `${ref.scheme}:${ref.opaque}`;
}
