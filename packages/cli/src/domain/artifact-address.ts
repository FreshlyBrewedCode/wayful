import { WayfulError } from "./errors";
import { IDENT } from "./identifier";
import type { ReferenceToken } from "./reference";

const fail = (message: string): never => {
  throw new WayfulError({ message });
};

/** An artifact addressed by `@id`/`@name`, optionally map-qualified. */
export interface ArtifactAddress {
  readonly map?: string;
  readonly token: ReferenceToken;
}

/**
 * Parses an artifact address: `@id`/`@name`, optionally map-qualified
 * (`map/@id`, `map/@name`). Artifacts keep the `@` sigil here rather than in
 * `domain/reference.ts`'s shared grammar: looking up a registered
 * `ArtifactRecord` (the `artifact` command, goal evidence, `context`'s
 * artifact scope) is a separate address space from the ref a step attachment
 * carries directly (ADR-0004), which never names a registry entry.
 */
export function parseArtifactAddress(raw: string): ArtifactAddress {
  if (typeof raw !== "string" || raw.trim() === "") fail("artifact reference must not be empty.");

  let rest = raw;
  let map: string | undefined;
  const slash = rest.indexOf("/");
  if (slash !== -1) {
    map = rest.slice(0, slash);
    if (!IDENT.test(map) || /^\d+$/.test(map))
      fail(`'${raw}' has an invalid map prefix; a map prefix must be a lowercase kebab-case name.`);
    rest = rest.slice(slash + 1);
    if (rest === "") fail(`'${raw}' is missing an artifact reference after the map prefix.`);
  }

  if (!rest.startsWith("@"))
    fail(`'${raw}' is not a valid artifact reference; use '@id' or '@name'.`);
  const token = rest.slice(1);
  if (/^\d+$/.test(token)) return { map, token: { kind: "id", id: Number(token) } };
  if (IDENT.test(token)) return { map, token: { kind: "name", name: token } };
  return fail(`'${raw}' is not a valid artifact reference; use '@id' or '@name'.`);
}

/** Whether `raw` (after an optional map prefix) begins with the artifact sigil. */
export function looksLikeArtifactAddress(raw: string): boolean {
  const slash = raw.indexOf("/");
  const rest = slash === -1 ? raw : raw.slice(slash + 1);
  return rest.startsWith("@");
}
