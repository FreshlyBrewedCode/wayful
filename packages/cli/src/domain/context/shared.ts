import { WayfulError } from "@domain/errors";

/**
 * Fixed, in-code caps for every section `context` map scope can truncate.
 * There is deliberately no `--limit` flag and no token-budget trimming — see
 * issue #3's "Volume control" — so these are the only knobs, and every
 * section built with `capSection` reports how many entries it omitted.
 * `actionable` is exempt: it is never capped.
 */
export const CONTEXT_CAPS = {
  blocked: 20,
  pendingNotActionable: 20,
  recentActivity: 10,
  completedRecent: 5,
  artifacts: 20,
} as const;

/** A step id, fully qualified with its map, so it survives outside map context. */
export const qualifiedStepId = (map: string, id: number): string => `${map}/#${id}`;

export interface Capped<T> {
  readonly items: readonly T[];
  readonly omitted: number;
}

export function capSection<T>(items: readonly T[], cap: number): Capped<T> {
  return { items: items.slice(0, cap), omitted: Math.max(0, items.length - cap) };
}

const DURATION_PATTERN = /^(\d+)(d|h)$/;
const ABSOLUTE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses `--since` into an absolute cutoff. Accepts a duration (`7d`, `24h`,
 * relative to `now`) or an absolute date (`2026-09-01`, midnight UTC).
 * Computed from wall-clock `now` rather than the injected Effect `Clock`:
 * per issue #3's Testing Decisions, clock injection exists to make *written*
 * timestamps deterministic at the backend seam, not to control a read-only
 * filter's notion of "now".
 */
export function parseSince(raw: string, now: Date): Date {
  const duration = DURATION_PATTERN.exec(raw);
  if (duration) {
    const amount = Number(duration[1]);
    const unitMs = duration[2] === "d" ? 86_400_000 : 3_600_000;
    return new Date(now.getTime() - amount * unitMs);
  }
  if (ABSOLUTE_DATE_PATTERN.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new WayfulError({
    message: `--since must be a duration (e.g. '7d', '24h') or an absolute date (e.g. '2026-09-01'); got '${raw}'.`,
  });
}
