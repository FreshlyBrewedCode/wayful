import { StepCard } from "@/components/step-card";
import { DISPLAY_STATUSES, groupByDisplayStatus, statusLabel } from "@/lib/status";
import type { Step } from "@/lib/wayful";

/** Steps grouped by display status. The phone default, because a graph is not. */
export function BoardView({
  steps,
  next,
  selected,
}: {
  steps: Step[];
  next: number[];
  selected: number | null;
}) {
  const groups = groupByDisplayStatus(steps, next);
  // An empty cancelled column is noise; every other column earns its place by
  // saying "none".
  const columns = DISPLAY_STATUSES.filter(
    (status) => status !== "cancelled" || groups.get(status)!.length > 0,
  );

  return (
    <div className="h-full overflow-auto p-4 pt-16">
      <div className="grid min-h-full grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
        {columns.map((status) => {
          const group = groups.get(status)!;
          return (
            <section key={status} data-status={status} className="flex flex-col gap-2">
              <h3 className="flex items-baseline gap-2 border-b pb-1.5 text-xs font-semibold tracking-wide uppercase">
                <span className="text-[var(--status)]">{statusLabel(status)}</span>
                <span className="text-muted-foreground font-mono">{group.length}</span>
              </h3>
              {group.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs italic">none</p>
              ) : (
                group.map((step) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    status={status}
                    selected={selected === step.id}
                    compact
                  />
                ))
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
