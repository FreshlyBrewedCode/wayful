import { StepCard } from "@/components/step-card";
import type { MapDetail, StepStatus } from "@/lib/wayful";

const PERSISTED_STATUSES = [
  "complete",
  "pending",
  "blocked",
  "cancelled",
] as const satisfies readonly StepStatus[];

/**
 * With no step selected the detail pane earns its width by showing the map's
 * health: counts, what is actionable now, and the `map validate` findings in
 * full — the only place they are readable rather than a tooltip.
 */
export function MapOverviewPanel({ detail }: { detail: MapDetail }) {
  const { map, status, next, validation } = detail;
  const counts = status?.steps ?? {};
  const actionable = map.steps.filter((step) => next.includes(step.id));

  return (
    <div className="space-y-5 p-4">
      <div>
        <h2 className="text-base font-semibold">Map overview</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Select a step for its body, contract and type instructions.
        </p>
      </div>

      <Section heading="Steps">
        <div className="flex flex-wrap gap-1.5">
          {/* Counts come from `map status`, which knows only the four persisted
              statuses — `ready` is the viewer's own reading of `map next`. */}
          {PERSISTED_STATUSES.map((persisted) => (
            <span
              key={persisted}
              data-status={persisted}
              className="bg-muted inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs"
            >
              <span className="size-1.5 rounded-full bg-[var(--status)]" />
              <span className="font-mono">{counts[persisted] ?? 0}</span> {persisted}
            </span>
          ))}
        </div>
      </Section>

      <Section heading={`Actionable now · ${actionable.length}`}>
        {actionable.length === 0 ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Nothing is actionable — every pending step is waiting on a dependency, an input
            artifact, or a blocker.
          </p>
        ) : (
          <div className="space-y-2">
            {actionable.map((step) => (
              <StepCard key={step.id} step={step} status="ready" selected={false} compact />
            ))}
          </div>
        )}
      </Section>

      <Section
        heading={
          validation?.valid ? "Validation" : `Open findings · ${validation?.errors.length ?? 0}`
        }
      >
        {validation?.valid ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            <code className="font-mono">wayful map validate</code> reports this map as complete and
            consistent.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {(validation?.errors ?? []).map((error) => (
              <li
                key={error}
                className="text-muted-foreground border-l-2 pl-2 text-xs leading-snug"
              >
                {error}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wide uppercase">
        {heading}
      </h3>
      {children}
    </section>
  );
}
