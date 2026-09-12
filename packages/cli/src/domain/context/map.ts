import { DateTime } from "effect";
import { attachmentOK, normalizedAttachments, nextSteps, unfulfilledSlots } from "@domain/graph";
import type { Slot } from "@domain/identifier";
import type {
  DecodeError,
  DerivedArtifact,
  GoalRecord,
  MapMetadata,
  StepRecord,
} from "@domain/model";
import type { StepCounts } from "@domain/status";
import { capSection, CONTEXT_CAPS, qualifiedStepId } from "@domain/context/shared";
import type { Capped } from "@domain/context/shared";

export interface GoalAttachmentView {
  readonly slot: string | undefined;
  readonly ref: string;
  readonly kind: string | undefined;
}

export interface GoalView {
  readonly name: string;
  readonly description: string;
  readonly satisfied: boolean;
  readonly outputs: {
    readonly recorded: readonly GoalAttachmentView[];
    readonly unfulfilled: readonly Slot[];
  };
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
  readonly kind: "step" | "goal";
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
  readonly ref: string;
  readonly kind: string;
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
  readonly artifacts: readonly DerivedArtifact[];
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
  const sinceDateTime = since === undefined ? undefined : DateTime.fromDateUnsafe(since);
  const mapName = metadata.name;
  const qStep = (id: number) => qualifiedStepId(mapName, id);
  const goalViews: GoalView[] = goals
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((goal) => ({
      name: goal.name,
      description: goal.description,
      satisfied: attachmentOK(goal.required_outputs, goal.outputs),
      outputs: {
        recorded: normalizedAttachments(goal.outputs).map((attachment) => ({
          slot: attachment.slot,
          ref: attachment.ref,
          kind:
            attachment.kind ??
            goal.required_outputs.find((candidate) => candidate.name === attachment.slot)?.kind,
        })),
        unfulfilled: unfulfilledSlots(goal.required_outputs, goal.outputs),
      },
    }));

  const progress: StepCounts = {
    pending: steps.filter((step) => step.status === "pending").length,
    blocked: steps.filter((step) => step.status === "blocked").length,
    complete: steps.filter((step) => step.status === "complete").length,
    cancelled: steps.filter((step) => step.status === "cancelled").length,
  };

  const actionableSteps = nextSteps(steps);
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
      const missingInputs = unfulfilledSlots(step.required_inputs, step.inputs).map(
        (slot) => slot.name,
      );
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
    ...goals.map((goal) => ({
      kind: "goal" as const,
      id: goal.name,
      name: goal.name,
      event: attachmentOK(goal.required_outputs, goal.outputs)
        ? "satisfied"
        : goal.created_at === goal.updated_at
          ? "added"
          : "updated",
      at: goal.updated_at,
    })),
  ];
  // `--since` filters only recent activity and the completed tail below — it
  // must never hide actionable or blocked steps (issue #3, Volume control).
  const filteredActivity = sinceDateTime
    ? activityEntries.filter((entry) =>
        DateTime.isGreaterThanOrEqualTo(DateTime.makeUnsafe(entry.at), sinceDateTime),
      )
    : activityEntries;
  // Sorting by last-modified descending is always on, independent of `--since`.
  const sortedActivity = filteredActivity.toSorted((a, b) =>
    a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1,
  );
  const recentActivity = capSection(sortedActivity, CONTEXT_CAPS.recentActivity);

  const completedSteps = steps.filter((step) => step.status === "complete");
  const completedFiltered = sinceDateTime
    ? completedSteps.filter((step) =>
        DateTime.isGreaterThanOrEqualTo(
          DateTime.makeUnsafe(step.closed_at ?? step.updated_at),
          sinceDateTime,
        ),
      )
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
    .toSorted((a, b) => a.ref.localeCompare(b.ref))
    .map((artifact) => ({ ref: artifact.ref, kind: artifact.kind }));
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
