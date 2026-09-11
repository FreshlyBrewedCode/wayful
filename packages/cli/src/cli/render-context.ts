import type {
  ArtifactContextView,
  Capped,
  MapContextView,
  ProjectContextView,
  StepAttachmentView,
  StepContextView,
} from "../domain/context";
import type { DecodeError } from "../domain/model";

/** Appends an omitted-count line — but only when something was actually omitted, so an uncapped section never claims otherwise. */
function withOmitted(lines: string[], omitted: number): string[] {
  return omitted > 0 ? [...lines, `  (${omitted} more omitted)`] : lines;
}

/** Renders decode/read errors as an explicit "Problems" section — omitted entirely when there are none, so degraded output is never confused with the ordinary case. `context` names this "problems" (not "errors") per issue #3. */
function problemLines(problems: readonly DecodeError[]): string[] {
  return problems.length ? ["Problems:", ...problems.map((p) => `- ${p.file}: ${p.message}`)] : [];
}

export function renderProjectContext(view: ProjectContextView): string {
  return [
    "Scope: project",
    `Project: ${view.project.description}`,
    `Root: ${view.project.root}`,
    "Maps:",
    ...(view.maps.length
      ? view.maps.map(
          (m) =>
            `- ${m.map}: ${m.start} (goals ${m.goals.satisfied}/${m.goals.total}, steps ${m.steps.pending} pending/${m.steps.blocked} blocked/${m.steps.complete} complete/${m.steps.cancelled} cancelled, last activity ${m.lastActivity ?? "none"})`,
        )
      : ["- none"]),
    "Types:",
    ...(view.types.length ? view.types.map((t) => `- ${t.name}: ${t.description}`) : ["- none"]),
    ...problemLines(view.problems),
  ].join("\n");
}

function cappedLines<T>(
  header: string,
  capped: Capped<T>,
  render: (item: T) => string,
  emptyLabel = "- none",
): string[] {
  const lines = capped.items.length ? capped.items.map(render) : [emptyLabel];
  return [header, ...withOmitted(lines, capped.omitted)];
}

export function renderMapContext(view: MapContextView): string {
  return [
    "Scope: map",
    `Map: ${view.map}`,
    `Start: ${view.start}`,
    "Goals:",
    ...(view.goals.length
      ? view.goals.map(
          (g) =>
            `- ${g.name}: ${g.description} [${g.satisfied ? "satisfied" : "not satisfied"}]${
              g.evidence.length ? ` (evidence: ${g.evidence.join(", ")})` : ""
            }`,
        )
      : ["- none"]),
    `Progress: ${view.progress.pending} pending, ${view.progress.blocked} blocked, ${view.progress.complete} complete, ${view.progress.cancelled} cancelled`,
    "Actionable steps:",
    ...(view.actionable.length
      ? view.actionable.map((s) => `- ${s.id} ${s.name}: ${s.description}`)
      : ["- none"]),
    ...cappedLines(
      "Blocked steps:",
      view.blocked,
      (s) => `- ${s.id} ${s.name}: ${s.reason ?? "no reason recorded"}`,
    ),
    ...cappedLines(
      "Pending, not actionable:",
      view.pendingNotActionable,
      (s) => `- ${s.id} ${s.name}: ${s.reason}`,
    ),
    ...cappedLines(
      "Recent activity:",
      view.recentActivity,
      (e) => `- ${e.at} ${e.kind} ${e.id} ${e.name}: ${e.event}`,
    ),
    `Completed steps: ${view.completed.total} total`,
    ...withOmitted(
      view.completed.recent.items.length
        ? view.completed.recent.items.map(
            (s) =>
              `- ${s.id} ${s.name}: ${s.summary ?? "no summary recorded"} (closed ${s.closedAt ?? "unknown"})`,
          )
        : ["- none"],
      view.completed.recent.omitted,
    ),
    ...cappedLines(
      "Artifacts:",
      view.artifacts,
      (a) => `- ${a.id} ${a.name} (${a.kind}): ${a.ref}`,
    ),
    ...problemLines(view.problems),
  ].join("\n");
}

function attachmentLine(attachment: StepAttachmentView): string {
  const slotPart = attachment.slot ? `[${attachment.slot}] ` : "";
  const kindPart = attachment.kind ? ` (${attachment.kind})` : "";
  return `- ${slotPart}${attachment.ref}${kindPart}`;
}

export function renderStepContext(view: StepContextView): string {
  return [
    "Scope: step",
    `Step: ${view.id} ${view.name}`,
    `Type: ${view.type.name}: ${view.type.description}`,
    `Status: ${view.status}`,
    `Description: ${view.description}`,
    "Dependencies:",
    ...(view.dependencies.length
      ? view.dependencies.map((d) => `- ${d.id} ${d.name} [${d.status}]`)
      : ["- none"]),
    "Dependents:",
    ...(view.dependents.length
      ? view.dependents.map((d) => `- ${d.id} ${d.name} [${d.status}]`)
      : ["- none"]),
    "Inputs:",
    ...(view.inputs.length ? view.inputs.map(attachmentLine) : ["- none"]),
    "Outputs:",
    ...(view.outputs.recorded.length ? view.outputs.recorded.map(attachmentLine) : ["- none"]),
    "Unfulfilled output slots:",
    ...(view.outputs.unfulfilled.length
      ? view.outputs.unfulfilled.map((slot) => `- ${slot.name} (${slot.kind})`)
      : ["- none"]),
    `Created: ${view.created_at}`,
    `Updated: ${view.updated_at}`,
    ...(view.closed_at ? [`Closed: ${view.closed_at}`] : []),
    ...problemLines(view.problems),
  ].join("\n");
}

export function renderArtifactContext(view: ArtifactContextView): string {
  return [
    "Scope: artifact",
    `Artifact: ${view.id} ${view.name} (${view.kind}): ${view.ref}`,
    `Created: ${view.created_at}`,
    `Updated: ${view.updated_at}`,
    "Produced by:",
    ...(view.producedBy.length ? view.producedBy.map((s) => `- ${s.id} ${s.name}`) : ["- none"]),
    "Consumed by:",
    ...(view.consumedBy.length ? view.consumedBy.map((s) => `- ${s.id} ${s.name}`) : ["- none"]),
    "Cited by goals:",
    ...(view.citedByGoals.length ? view.citedByGoals.map((name) => `- ${name}`) : ["- none"]),
    ...problemLines(view.problems),
  ].join("\n");
}
