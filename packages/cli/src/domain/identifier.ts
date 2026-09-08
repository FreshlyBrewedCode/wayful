import { WayfulError } from "./errors";
import { CURRENT_FORMAT_VERSION } from "./model";

export const IDENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Matches exactly the shape `Date.prototype.toISOString()` produces, which is
// the only shape this codebase ever writes: ISO-8601 UTC with millisecond
// precision, so string ordering is chronological ordering.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const fail = (message: string): never => {
  throw new WayfulError({ message });
};

export function nonEmpty(value: unknown, label: string): string {
  return typeof value === "string" && value.trim() ? value : fail(`${label} is required.`);
}

export function identifier(value: unknown, label: string, rejectNumeric = false): string {
  if (typeof value !== "string" || !IDENT.test(value) || (rejectNumeric && /^\d+$/.test(value)))
    fail(`${label} must be a lowercase kebab-case identifier.`);
  return value as string;
}

export interface Slot {
  readonly name: string;
  readonly kind: string;
  readonly description?: string;
}

export function slots(raw: unknown, label: string): Slot[] {
  if (!Array.isArray(raw)) fail(`${label} must be an array.`);
  const list = raw as unknown[];
  const seen = new Set<string>();
  return list.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      fail(`${label} contains an invalid slot.`);
    const slot = candidate as Record<string, unknown>;
    const name = identifier(slot.name, "slot name");
    const kind = nonEmpty(slot.kind, "slot kind");
    if (slot.description !== undefined) nonEmpty(slot.description, "slot description");
    if (seen.has(name)) fail(`${label} repeats slot '${name}'.`);
    seen.add(name);
    return slot.description === undefined
      ? { name, kind }
      : { name, kind, description: slot.description as string };
  });
}

export function formatVersion(
  data: Record<string, unknown>,
  where: string,
  allowMissing = false,
): void {
  if (data.format_version === undefined) {
    if (allowMissing) return;
    fail(`missing format version in ${where}.`);
  }
  if (!Number.isInteger(data.format_version)) fail(`malformed format version in ${where}.`);
  if (data.format_version !== CURRENT_FORMAT_VERSION)
    fail(`unsupported format version in ${where}.`);
}

/** Validates an ISO-8601 UTC timestamp string, the only shape this codebase writes. */
export function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value)))
    fail(`${label} must be an ISO-8601 UTC timestamp.`);
  return value as string;
}
