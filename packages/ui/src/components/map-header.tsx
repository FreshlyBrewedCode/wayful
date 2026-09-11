import { ArrowRight, ChevronRight } from "lucide-react";

import { RefChip } from "@/components/ref-chip";
import { StepLink } from "@/components/step-card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BREAKPOINTS, useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { goalOutputViews, goalSatisfied, type MapDetail } from "@/lib/wayful";

/**
 * The map's start and goals presented as the two ends of a journey. On a phone
 * the whole block would fill the first screen, so it collapses behind a
 * one-line summary and the map itself stays visible.
 */
export function MapHeader({ detail }: { detail: MapDetail }) {
  const { map, status, validation } = detail;
  const phone = useMediaQuery(BREAKPOINTS.phone);
  const blockers = status?.blockers ?? [];
  const counts = status?.steps ?? {};
  const totalTracked = (counts.complete ?? 0) + (counts.pending ?? 0) + (counts.blocked ?? 0);

  return (
    <header className="border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <h1 className="truncate font-mono text-lg font-semibold">{map.name}</h1>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="status"
              data-status={validation?.valid ? "complete" : "blocked"}
              className="shrink-0 cursor-default"
            >
              {validation?.valid ? "map valid" : `${validation?.errors.length ?? 0} open findings`}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {validation?.valid ? (
              "wayful map validate reports this map as complete and consistent."
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                {(validation?.errors ?? []).map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
          </TooltipContent>
        </Tooltip>
      </div>

      <details open={!phone} className="group mt-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
          <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open:rotate-90" />
          <span className="text-muted-foreground truncate group-open:hidden">{map.start}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <Badge variant="secondary">
              {status?.goals.satisfied ?? 0}/{status?.goals.total ?? 0} goals
            </Badge>
            <Badge variant="secondary">
              {counts.complete ?? 0}/{totalTracked} steps done
            </Badge>
            {blockers.length > 0 && (
              <Badge variant="status" data-status="blocked">
                {blockers.length} blocked
              </Badge>
            )}
          </span>
        </summary>

        <div className="mt-3 space-y-3">
          <div className="flex flex-col gap-3 min-[760px]:flex-row min-[760px]:items-stretch">
            <Waypoint heading="Start" className="min-[760px]:w-64 min-[760px]:shrink-0">
              <p className="text-muted-foreground text-xs leading-snug">{map.start}</p>
            </Waypoint>
            <div className="text-muted-foreground hidden shrink-0 items-center min-[760px]:flex">
              <ArrowRight className="size-4" />
            </div>
            <Waypoint
              heading={`Goals · ${status?.goals.satisfied ?? 0} of ${status?.goals.total ?? 0} satisfied`}
              className="min-w-0 flex-1"
            >
              <ul className="flex flex-col gap-2">
                {map.goals.map((goal) => {
                  const satisfied = goalSatisfied(goal);
                  const outputs = goalOutputViews(goal);
                  return (
                    <li
                      key={goal.name}
                      className="flex gap-2"
                      title={goal.body ? `${goal.name}\n\n${goal.body}` : goal.name}
                    >
                      <span
                        className={cn(
                          "mt-px shrink-0 font-mono text-xs",
                          satisfied ? "text-status-complete" : "text-muted-foreground",
                        )}
                      >
                        {satisfied ? "✓" : "○"}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs leading-snug">
                          {goal.description}{" "}
                          <span className="text-muted-foreground font-mono">{goal.name}</span>
                        </p>
                        {outputs.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {outputs.map((output) => (
                              <RefChip key={output.ref} reference={output.ref} kind={output.kind} />
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Waypoint>
          </div>

          {blockers.length > 0 && (
            <Waypoint heading={`${blockers.length} blocker${blockers.length > 1 ? "s" : ""}`}>
              <ul className="space-y-1">
                {blockers.map((blocker) => (
                  <li key={blocker.id} className="text-xs">
                    <StepLink
                      id={blocker.id}
                      className="text-primary font-mono underline-offset-2 hover:underline"
                    >
                      {blocker.id} {blocker.name}
                    </StepLink>
                    <span className="text-muted-foreground">
                      {" "}
                      — {blocker.reason ?? "no reason recorded"}
                    </span>
                  </li>
                ))}
              </ul>
            </Waypoint>
          )}

          {map.artifacts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{map.artifacts.length} artifacts</Badge>
              {map.artifacts.map((artifact) => (
                <RefChip key={artifact.ref} reference={artifact.ref} kind={artifact.kind} />
              ))}
            </div>
          )}
        </div>
      </details>
    </header>
  );
}

function Waypoint({
  heading,
  className,
  children,
}: {
  heading: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("bg-muted/40 rounded-lg border p-3", className)}>
      <h3 className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
        {heading}
      </h3>
      {children}
    </section>
  );
}
