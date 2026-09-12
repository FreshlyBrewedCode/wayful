import { WayfulError } from "@domain/errors";
import { IDENT } from "@domain/identifier";

const fail = (message: string): never => {
  throw new WayfulError({ message });
};

/** A step addressed by its per-map integer id or by its name. */
export type ReferenceToken =
  | { readonly kind: "id"; readonly id: number }
  | { readonly kind: "name"; readonly name: string };

/**
 * The shared wayful reference grammar, parsed without any backend lookup:
 *
 * | Form | Resolves to |
 * | --- | --- |
 * | `redesign` | Map, by name (at a polymorphic slot); a step name (at a slot that already knows its own kind) |
 * | `1` | Step, by id |
 * | `#1` / `#research-users` | Step, by id or name |
 * | `redesign/#1`, `redesign/1`, `redesign/other` | Any of the above, map-qualified |
 *
 * The grammar is additive: a bare, unsigiled, non-numeric token is
 * inherently ambiguous outside a sigil — it could name a map or a step — so
 * the parser does not decide that for the caller. It is returned as
 * `{kind: "bare", ...}` and left for the call site to interpret according to
 * what that slot already knows it holds (see `expectStep`). A future
 * polymorphic slot (a bare, unqualified `bare` token with no other
 * information) is free to read it as a map name.
 *
 * Artifacts are addressed separately, by the ref itself (a scheme-prefixed
 * string like `file:docs/spec.md`, per `domain/artifact-ref.ts`): a step's
 * `inputs`/`outputs` name a ref directly rather than a registered artifact
 * (ADR-0004), so only maps and steps stay addressable through this grammar.
 */
export type Reference =
  | { readonly kind: "bare"; readonly map?: string; readonly name: string }
  | { readonly kind: "step"; readonly map?: string; readonly token: ReferenceToken };

function parseToken(raw: string, label: string): ReferenceToken {
  if (/^\d+$/.test(raw)) return { kind: "id", id: Number(raw) };
  if (IDENT.test(raw)) return { kind: "name", name: raw };
  return fail(`${label} must be a numeric id or a lowercase kebab-case name.`);
}

/**
 * Parses a single reference string into its syntactic shape, without
 * committing an unsigiled bare name to any one primitive kind.
 *
 * Bare integers resolve to steps: `#` begins a comment in `bash -c` and
 * shell scripts, so `wayful context #1` unquoted would otherwise reach the
 * CLI as zero arguments — wrong output, exit zero, no signal. This is
 * decidable without a backend lookup because numeric names are already
 * rejected for every named primitive (maps, steps by name, goals, types) —
 * a purely-numeric bare token can therefore only ever be a step id.
 *
 * A bare non-numeric name — with or without a map prefix — is genuinely
 * ambiguous at this layer and is returned as `kind: "bare"` for the caller
 * to resolve against the kind its slot already expects.
 */
export function parseReference(raw: string): Reference {
  if (typeof raw !== "string" || raw.trim() === "") fail("reference must not be empty.");

  let rest = raw;
  let map: string | undefined;
  const slash = rest.indexOf("/");
  if (slash !== -1) {
    map = rest.slice(0, slash);
    if (!IDENT.test(map) || /^\d+$/.test(map))
      fail(`'${raw}' has an invalid map prefix; a map prefix must be a lowercase kebab-case name.`);
    rest = rest.slice(slash + 1);
    if (rest === "") fail(`'${raw}' is missing a step reference after the map prefix.`);
  }

  if (rest.startsWith("#"))
    return { kind: "step", map, token: parseToken(rest.slice(1), "step reference") };
  if (/^\d+$/.test(rest)) return { kind: "step", map, token: { kind: "id", id: Number(rest) } };
  if (IDENT.test(rest)) return { kind: "bare", map, name: rest };

  const sigil = rest[0];
  if (sigil !== undefined && !/[a-z0-9]/.test(sigil))
    fail(`'${sigil}' is not a recognized reference sigil; use '#' for a step.`);
  return fail(`'${raw}' is not a valid reference.`);
}

/**
 * Parses `raw` and asserts it names a step, map-qualified or not. A bare
 * name resolves to a step name here, because the `step` slot already knows
 * it holds a step.
 */
export function expectStep(raw: string): Extract<Reference, { readonly kind: "step" }> {
  const ref = parseReference(raw);
  if (ref.kind === "bare")
    return { kind: "step", map: ref.map, token: { kind: "name", name: ref.name } };
  return ref;
}

/** Finds the record a token addresses, by id or by name, in `records`. */
export function resolveToken<T extends { readonly id: number; readonly name: string }>(
  token: ReferenceToken,
  records: readonly T[],
): T | undefined {
  return token.kind === "id"
    ? records.find((record) => record.id === token.id)
    : records.find((record) => record.name === token.name);
}

/** Renders a token back to the text a user would recognize, for error messages. */
export function describeToken(token: ReferenceToken): string {
  return token.kind === "id" ? String(token.id) : token.name;
}

/**
 * A map prefix is addressing only: it must name the map the reference is
 * already being resolved within. This is what keeps the reference grammar
 * from quietly growing into cross-map dependencies, inputs, outputs, or
 * evidence — relationships stay rejected explicitly, at the point a
 * qualified reference is used to build one.
 */
export function assertSameMap(refMap: string | undefined, mapName: string, what: string): void {
  if (refMap !== undefined && refMap !== mapName)
    fail(`${what} cannot cross maps; '${refMap}' is not map '${mapName}'.`);
}
