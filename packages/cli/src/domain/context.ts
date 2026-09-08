import { WayfulError } from "./errors";
import { nextSteps, normalizedAttachments, unfulfilledSlots } from "./graph";
import type { Slot } from "./identifier";
import type { ArtifactRecord, DecodeError, GoalRecord, MapMetadata, StepRecord } from "./model";
import type { StepCounts } from "./status";

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

/** An artifact id, fully qualified with its map, so it survives outside map context. */
export const qualifiedArtifactId = (map: string, id: number): string => `${map}/@${id}`;

export interface Capped<T> {
  readonly items: readonly T[];
  readonly omitted: number;
}

function capSection<T>(items: readonly T[], cap: number): Capped<T> {
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

// ---------------------------------------------------------------------------
// Project scope
// ---------------------------------------------------------------------------

export interface ProjectMapSummary {
  readonly map: string;
  readonly start: string;
  readonly goals: { readonly satisfied: number; readonly total: number };
  readonly steps: StepCounts;
  /** The maximum `updated_at` over the map's steps, artifacts, and goals — never stored, always derived. */
  readonly lastActivity: string | undefined;
}

/** Summarizes one map for project scope: start, goal/step progress, and derived last activity. */
export function summarizeProjectMap(
  metadata: MapMetadata,
  steps: readonly StepRecord[],
  artifacts: readonly ArtifactRecord[],
  goals: readonly GoalRecord[],
): ProjectMapSummary {
  const timestamps = [
    ...steps.map((step) => step.updated_at),
    ...artifacts.map((artifact) => artifact.updated_at),
    ...goals.map((goal) => goal.updated_at),
  ];
  const lastActivity = timestamps.length
    ? timestamps.reduce((max, at) => (at > max ? at : max))
    : undefined;
  return {
    map: metadata.name,
    start: metadata.start,
    goals: {
      satisfied: goals.filter((goal) => goal.evidence.length > 0).length,
      total: goals.length,
    },
    steps: {
      pending: steps.filter((step) => step.status === "pending").length,
      blocked: steps.filter((step) => step.status === "blocked").length,
      complete: steps.filter((step) => step.status === "complete").length,
      cancelled: steps.filter((step) => step.status === "cancelled").length,
    },
    lastActivity,
  };
}

/** Orders maps by last activity descending, ties broken by name, maps with no activity last. */
export function orderProjectMaps(summaries: readonly ProjectMapSummary[]): ProjectMapSummary[] {
  return summaries.toSorted((a, b) => {
    if (a.lastActivity === undefined && b.lastActivity === undefined)
      return a.map.localeCompare(b.map);
    if (a.lastActivity === undefined) return 1;
    if (b.lastActivity === undefined) return -1;
    if (a.lastActivity !== b.lastActivity) return a.lastActivity < b.lastActivity ? 1 : -1;
    return a.map.localeCompare(b.map);
  });
}

export interface ProjectContextView {
  readonly scope: "project";
  readonly project: { readonly description: string; readonly root: string };
  readonly maps: readonly ProjectMapSummary[];
  readonly types: readonly { readonly name: string; readonly description: string }[];
  readonly problems: readonly DecodeError[];
}

// ---------------------------------------------------------------------------
// Map scope
// ---------------------------------------------------------------------------

export interface GoalView {
  readonly name: string;
  readonly description: string;
  readonly satisfied: boolean;
  readonly evidence: readonly string[];
}

export interface ActionableStepView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface BlockedStepView {
  readonly id: string;
  readonly name: string;
  readonly reason: string | undefined;
}

export interface UnmetDependencyView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export interface PendingNotActionableView {
  readonly id: string;
  readonly name: string;
  readonly reason: string;
  readonly unmetDependencies: readonly UnmetDependencyView[];
  readonly missingInputs: readonly string[];
}

export interface ActivityEntryView {
  readonly kind: "step" | "artifact" | "goal";
  readonly id: string;
  readonly name: string;
  readonly event: string;
  readonly at: string;
}

export interface CompletedStepView {
  readonly id: string;
  readonly name: string;
  readonly summary: string | undefined;
  readonly closedAt: string | undefined;
}

export interface ArtifactView {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly ref: string;
}

export interface MapContextView {
  readonly scope: "map";
  readonly map: string;
  readonly start: string;
  readonly goals: readonly GoalView[];
  readonly progress: StepCounts;
  /** Never capped — see issue #3's Volume control. */
  readonly actionable: readonly ActionableStepView[];
  readonly blocked: Capped<BlockedStepView>;
  readonly pendingNotActionable: Capped<PendingNotActionableView>;
  readonly recentActivity: Capped<ActivityEntryView>;
  readonly completed: { readonly total: number; readonly recent: Capped<CompletedStepView> };
  readonly artifacts: Capped<ArtifactView>;
  readonly problems: readonly DecodeError[];
}

function describeStepEvent(step: StepRecord): string {
  if (step.status === "complete") return "completed";
  if (step.status === "cancelled") return "cancelled";
  if (step.status === "blocked") return "blocked";
  return step.created_at === step.updated_at ? "created" : "updated";
}

export interface BuildMapContextOptions {
  readonly metadata: MapMetadata;
  readonly steps: readonly StepRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly goals: readonly GoalRecord[];
  readonly problems: readonly DecodeError[];
  /** The `--since` cutoff, already parsed; `undefined` when the flag is absent. */
  readonly since: Date | undefined;
}

/**
 * Builds map scope's full derived view. This is the one place all of
 * `context <map>`'s sections are assembled, shared verbatim by the Markdown
 * renderer and the `--json` output — the acceptance criterion that `--json`
 * carries the same derived view, not the raw snapshot.
 */
export function buildMapContext(options: BuildMapContextOptions): MapContextView {
  const { metadata, steps, artifacts, goals, problems, since } = options;
  const mapName = metadata.name;
  const qStep = (id: number) => qualifiedStepId(mapName, id);
  const qArtifact = (id: number) => qualifiedArtifactId(mapName, id);
  const artifactByName = new Map(artifacts.map((artifact) => [artifact.name, artifact] as const));

  const goalViews: GoalView[] = goals
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((goal) => ({
      name: goal.name,
      description: goal.description,
      satisfied: goal.evidence.length > 0,
      evidence: goal.evidence.map((name) => {
        const artifact = artifactByName.get(name);
        return artifact ? qArtifact(artifact.id) : name;
      }),
    }));

  const progress: StepCounts = {
    pending: steps.filter((step) => step.status === "pending").length,
    blocked: steps.filter((step) => step.status === "blocked").length,
    complete: steps.filter((step) => step.status === "complete").length,
    cancelled: steps.filter((step) => step.status === "cancelled").length,
  };

  const actionableSteps = nextSteps(steps, artifacts);
  const actionable: ActionableStepView[] = actionableSteps.map((step) => ({
    id: qStep(step.id),
    name: step.name,
    description: step.description,
  }));
  const actionableIds = new Set(actionableSteps.map((step) => step.id));

  const blockedSteps = steps
    .filter((step) => step.status === "blocked")
    .toSorted((a, b) => a.id - b.id);
  const blocked = capSection(
    blockedSteps.map((step) => ({
      id: qStep(step.id),
      name: step.name,
      reason: step.block_reason,
    })),
    CONTEXT_CAPS.blocked,
  );

  const pendingNotActionableSteps = steps
    .filter((step) => step.status === "pending" && !actionableIds.has(step.id))
    .toSorted((a, b) => a.id - b.id);
  const pendingNotActionable = capSection(
    pendingNotActionableSteps.map((step) => {
      const unmetDependencies: UnmetDependencyView[] = step.dependencies
        .map((id) => ({ id, dependency: steps.find((candidate) => candidate.id === id) }))
        .filter(({ dependency }) => !dependency || dependency.status !== "complete")
        .map(({ id, dependency }) => ({
          id: qStep(id),
          name: dependency?.name ?? "(missing)",
          status: dependency?.status ?? "missing",
        }));
      const missingInputs = unfulfilledSlots(step, "inputs", artifacts).map((slot) => slot.name);
      const reasonParts: string[] = [];
      if (unmetDependencies.length)
        reasonParts.push(
          `waiting on ${unmetDependencies.map((dependency) => `${dependency.id} (${dependency.status})`).join(", ")}`,
        );
      if (missingInputs.length)
        reasonParts.push(
          `missing input ${missingInputs.length > 1 ? "slots" : "slot"} ${missingInputs
            .map((name) => `'${name}'`)
            .join(", ")}`,
        );
      return {
        id: qStep(step.id),
        name: step.name,
        reason: reasonParts.length ? reasonParts.join("; ") : "not actionable",
        unmetDependencies,
        missingInputs,
      };
    }),
    CONTEXT_CAPS.pendingNotActionable,
  );

  const activityEntries: ActivityEntryView[] = [
    ...steps.map((step) => ({
      kind: "step" as const,
      id: qStep(step.id),
      name: step.name,
      event: describeStepEvent(step),
      at: step.updated_at,
    })),
    ...artifacts.map((artifact) => ({
      kind: "artifact" as const,
      id: qArtifact(artifact.id),
      name: artifact.name,
      event: artifact.created_at === artifact.updated_at ? "added" : "updated",
      at: artifact.updated_at,
    })),
    ...goals.map((goal) => ({
      kind: "goal" as const,
      id: goal.name,
      name: goal.name,
      event: goal.evidence.length
        ? "satisfied"
        : goal.created_at === goal.updated_at
          ? "added"
          : "updated",
      at: goal.updated_at,
    })),
  ];
  // `--since` filters only recent activity and the completed tail below — it
  // must never hide actionable or blocked steps (issue #3, Volume control).
  const filteredActivity = since
    ? activityEntries.filter((entry) => new Date(entry.at) >= since)
    : activityEntries;
  // Sorting by last-modified descending is always on, independent of `--since`.
  const sortedActivity = filteredActivity.toSorted((a, b) =>
    a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1,
  );
  const recentActivity = capSection(sortedActivity, CONTEXT_CAPS.recentActivity);

  const completedSteps = steps.filter((step) => step.status === "complete");
  const completedFiltered = since
    ? completedSteps.filter((step) => new Date(step.closed_at ?? step.updated_at) >= since)
    : completedSteps;
  const completedSorted = completedFiltered.toSorted((a, b) => {
    const at = a.closed_at ?? a.updated_at;
    const bt = b.closed_at ?? b.updated_at;
    return at === bt ? a.id - b.id : at < bt ? 1 : -1;
  });
  const completedRecent = capSection(
    completedSorted.map((step) => ({
      id: qStep(step.id),
      name: step.name,
      summary: step.completion_summary,
      closedAt: step.closed_at,
    })),
    CONTEXT_CAPS.completedRecent,
  );

  const artifactViews = artifacts
    .toSorted((a, b) => a.id - b.id)
    .map((artifact) => ({
      id: qArtifact(artifact.id),
      name: artifact.name,
      kind: artifact.kind,
      ref: artifact.ref,
    }));
  const artifactSection = capSection(artifactViews, CONTEXT_CAPS.artifacts);

  return {
    scope: "map",
    map: mapName,
    start: metadata.start,
    goals: goalViews,
    progress,
    actionable,
    blocked,
    pendingNotActionable,
    recentActivity,
    completed: { total: completedSteps.length, recent: completedRecent },
    artifacts: artifactSection,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Step scope
// ---------------------------------------------------------------------------

/** A step reference resolved for display: a dependency or a dependent, each carrying the current status that makes readiness visible without a second command. */
export interface StepRelationView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/** A single input/output attachment, resolved against the map's artifacts so presence is knowable without a second command. */
export interface StepAttachmentView {
  readonly slot: string | undefined;
  /** The qualified artifact id when the named artifact resolves; the raw attached name otherwise. */
  readonly artifact: string;
  readonly kind: string | undefined;
  readonly ref: string | undefined;
  readonly present: boolean;
}

export interface StepContextView {
  readonly scope: "step";
  readonly map: string;
  readonly id: string;
  readonly name: string;
  readonly type: { readonly name: string; readonly description: string };
  readonly status: StepRecord["status"];
  readonly description: string;
  /** Upstream: every dependency, complete or not — see issue #8's acceptance criteria. */
  readonly dependencies: readonly StepRelationView[];
  /** Downstream: the steps that depend on this one — no existing command can answer this. */
  readonly dependents: readonly StepRelationView[];
  readonly inputs: readonly StepAttachmentView[];
  readonly outputs: {
    readonly recorded: readonly StepAttachmentView[];
    readonly unfulfilled: readonly Slot[];
  };
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | undefined;
  readonly problems: readonly DecodeError[];
}

export interface BuildStepContextOptions {
  readonly mapName: string;
  readonly step: StepRecord;
  readonly steps: readonly StepRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  /** The step's type, name and description only — step scope omits the full type instructions per the command's governing principle. */
  readonly type: { readonly name: string; readonly description: string };
  readonly problems: readonly DecodeError[];
}

/**
 * Builds step scope's derived view: connections, not contents. The body and
 * the type's full instructions are deliberately never read here — `context`
 * shows how a thing connects, `step show` shows what it says.
 */
export function buildStepContext(options: BuildStepContextOptions): StepContextView {
  const { mapName, step, steps, artifacts, type, problems } = options;
  const qStep = (id: number) => qualifiedStepId(mapName, id);
  const qArtifact = (id: number) => qualifiedArtifactId(mapName, id);

  const relation = (id: number, status?: string): StepRelationView => {
    const found = steps.find((candidate) => candidate.id === id);
    return {
      id: qStep(id),
      name: found?.name ?? "(missing)",
      status: status ?? found?.status ?? "missing",
    };
  };

  const dependencies = step.dependencies.map((id) => relation(id));
  const dependents = steps
    .filter((candidate) => candidate.dependencies.includes(step.id))
    .toSorted((a, b) => a.id - b.id)
    .map((candidate) => relation(candidate.id, candidate.status));

  const artifactByName = new Map(artifacts.map((artifact) => [artifact.name, artifact] as const));
  const toAttachmentView = (attachment: {
    readonly slot: string | undefined;
    readonly artifactName: string;
  }): StepAttachmentView => {
    const artifact = artifactByName.get(attachment.artifactName);
    return {
      slot: attachment.slot,
      artifact: artifact ? qArtifact(artifact.id) : attachment.artifactName,
      kind: artifact?.kind,
      ref: artifact?.ref,
      present: artifact !== undefined,
    };
  };

  return {
    scope: "step",
    map: mapName,
    id: qStep(step.id),
    name: step.name,
    type,
    status: step.status,
    description: step.description,
    dependencies,
    dependents,
    inputs: normalizedAttachments(step.inputs).map(toAttachmentView),
    outputs: {
      recorded: normalizedAttachments(step.outputs).map(toAttachmentView),
      unfulfilled: unfulfilledSlots(step, "outputs", artifacts),
    },
    created_at: step.created_at,
    updated_at: step.updated_at,
    closed_at: step.closed_at,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Artifact scope
// ---------------------------------------------------------------------------

/** A step referencing an artifact, as either a producer or a consumer. */
export interface ArtifactRelationView {
  readonly id: string;
  readonly name: string;
}

export interface ArtifactContextView {
  readonly scope: "artifact";
  readonly map: string;
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly ref: string;
  readonly created_at: string;
  readonly updated_at: string;
  /** The reverse index: today's answer requires reading every step file and correlating by hand. */
  readonly producedBy: readonly ArtifactRelationView[];
  readonly consumedBy: readonly ArtifactRelationView[];
  /** Goal names citing this artifact as evidence — goals carry no sigil, so their bare name is the whole address. */
  readonly citedByGoals: readonly string[];
  readonly problems: readonly DecodeError[];
}

export interface BuildArtifactContextOptions {
  readonly mapName: string;
  readonly artifact: ArtifactRecord;
  readonly steps: readonly StepRecord[];
  readonly goals: readonly GoalRecord[];
  readonly problems: readonly DecodeError[];
}

/** Builds artifact scope's derived view: the reverse index that today requires reading every step file and correlating by hand. */
export function buildArtifactContext(options: BuildArtifactContextOptions): ArtifactContextView {
  const { mapName, artifact, steps, goals, problems } = options;
  const qStep = (id: number) => qualifiedStepId(mapName, id);

  const stepsAttaching = (direction: "inputs" | "outputs"): ArtifactRelationView[] =>
    steps
      .filter((step) =>
        normalizedAttachments(step[direction]).some((a) => a.artifactName === artifact.name),
      )
      .toSorted((a, b) => a.id - b.id)
      .map((step) => ({ id: qStep(step.id), name: step.name }));

  return {
    scope: "artifact",
    map: mapName,
    id: qualifiedArtifactId(mapName, artifact.id),
    name: artifact.name,
    kind: artifact.kind,
    ref: artifact.ref,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
    producedBy: stepsAttaching("outputs"),
    consumedBy: stepsAttaching("inputs"),
    citedByGoals: goals
      .filter((goal) => goal.evidence.includes(artifact.name))
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((goal) => goal.name),
    problems,
  };
}
