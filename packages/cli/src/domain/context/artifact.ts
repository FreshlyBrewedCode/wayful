import { normalizedAttachments } from "../graph";
import type { DecodeError, DerivedArtifact, GoalRecord, StepRecord } from "../model";
import { qualifiedStepId } from "./shared";

/** A step referencing an artifact, as either a producer or a consumer. */
export interface ArtifactRelationView {
  readonly id: string;
  readonly name: string;
}

export interface ArtifactContextView {
  readonly scope: "artifact";
  readonly map: string;
  readonly ref: string;
  readonly kind: string;
  /** The reverse index: today's answer requires reading every step file and correlating by hand. */
  readonly producedBy: readonly ArtifactRelationView[];
  readonly consumedBy: readonly ArtifactRelationView[];
  /** Goal names citing this ref as an output — goals carry no sigil, so their bare name is the whole address. */
  readonly citedByGoals: readonly string[];
  readonly problems: readonly DecodeError[];
}

export interface BuildArtifactContextOptions {
  readonly mapName: string;
  readonly artifact: DerivedArtifact;
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
      .filter((step) => normalizedAttachments(step[direction]).some((a) => a.ref === artifact.ref))
      .toSorted((a, b) => a.id - b.id)
      .map((step) => ({ id: qStep(step.id), name: step.name }));

  return {
    scope: "artifact",
    map: mapName,
    ref: artifact.ref,
    kind: artifact.kind,
    producedBy: stepsAttaching("outputs"),
    consumedBy: stepsAttaching("inputs"),
    citedByGoals: goals
      .filter((goal) => normalizedAttachments(goal.outputs).some((a) => a.ref === artifact.ref))
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((goal) => goal.name),
    problems,
  };
}
