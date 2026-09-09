import { normalizedAttachments, unfulfilledSlots } from "../graph";
import type { Slot } from "../identifier";
import type { ArtifactRecord, DecodeError, StepRecord } from "../model";
import { qualifiedArtifactId, qualifiedStepId } from "./shared";

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
