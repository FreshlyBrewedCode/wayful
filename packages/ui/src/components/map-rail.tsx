import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MapSummary, StepType } from "@/lib/wayful";

/** Every map with its progress, so a newcomer can choose one without a command. */
export function MapRail({
  maps,
  types,
  activeMap,
  onNavigate,
}: {
  maps: MapSummary[];
  types: StepType[];
  activeMap: string | null;
  onNavigate?: () => void;
}) {
  return (
    <ScrollArea className="h-full">
      <nav aria-label="Maps" className="py-3">
        <h2 className="text-muted-foreground mb-2 px-3 text-[11px] font-semibold tracking-wide uppercase">
          Maps
        </h2>
        {maps.length === 0 ? (
          <p className="text-muted-foreground px-3 text-xs">
            No maps yet. Create one with <code className="font-mono">wayful map create</code>.
          </p>
        ) : (
          <ul>
            {maps.map((map) => (
              <li key={map.name}>
                <MapCard map={map} active={map.name === activeMap} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        )}

        {types.length > 0 && (
          <>
            <h3 className="text-muted-foreground mt-5 mb-2 px-3 text-[11px] font-semibold tracking-wide uppercase">
              Step types
            </h3>
            <ul className="flex flex-wrap gap-1 px-3">
              {types.map((type) => (
                <Tooltip key={type.name}>
                  <TooltipTrigger asChild>
                    <li>
                      <Badge variant="outline" className="cursor-default font-mono">
                        {type.name}
                      </Badge>
                    </li>
                  </TooltipTrigger>
                  <TooltipContent>{type.description}</TooltipContent>
                </Tooltip>
              ))}
            </ul>
          </>
        )}
      </nav>
    </ScrollArea>
  );
}

function MapCard({
  map,
  active,
  onNavigate,
}: {
  map: MapSummary;
  active: boolean;
  onNavigate?: () => void;
}) {
  const counts = map.status?.steps ?? {};
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const blocked = counts.blocked ?? 0;

  return (
    <Link
      to="/maps/$mapName"
      params={{ mapName: map.name }}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "bg-background hover:bg-accent focus-visible:ring-ring block border p-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none",
        active && "bg-accent",
      )}
    >
      <span className="block truncate font-mono text-[13px] font-medium">{map.name}</span>
      <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs leading-snug">
        {map.start}
      </span>

      {total > 0 && (
        <span className="bg-muted mt-2 flex h-1.5 overflow-hidden rounded-full">
          {(["complete", "blocked", "pending"] as const).map((status) =>
            counts[status] ? (
              <span
                key={status}
                data-status={status}
                className="bg-[var(--status)]"
                style={{ width: `${(counts[status]! / total) * 100}%` }}
              />
            ) : null,
          )}
        </span>
      )}

      <span className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 text-[11px]">
        <span>
          <b className="text-foreground font-mono">
            {map.status?.goals.satisfied ?? 0}/{map.status?.goals.total ?? 0}
          </b>{" "}
          goals
        </span>
        <span>
          <b className="text-foreground font-mono">{total}</b> steps
        </span>
        {blocked > 0 && (
          <span data-status="blocked" className="text-[var(--status)]">
            <b className="font-mono">{blocked}</b> blocked
          </span>
        )}
      </span>
    </Link>
  );
}
