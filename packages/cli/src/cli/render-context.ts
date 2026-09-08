import type { Capped, MapContextView, ProjectContextView } from "../domain/context";
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
