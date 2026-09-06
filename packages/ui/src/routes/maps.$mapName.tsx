import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PanelRight, X } from "lucide-react";
import { useMemo, useState } from "react";

import { BoardView } from "@/components/board-view";
import { EmptyState } from "@/components/empty-state";
import { GraphView } from "@/components/graph-view";
import { ListView } from "@/components/list-view";
import { MapHeader } from "@/components/map-header";
import { MapOverviewPanel } from "@/components/map-overview-panel";
import { StepDetailPanel } from "@/components/step-detail-panel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BREAKPOINTS, useMediaQuery } from "@/hooks/use-media-query";
import { mapQuery } from "@/lib/api";
import { type MapDetail, isError } from "@/lib/wayful";

const VIEWS = ["graph", "board", "list"] as const;
type View = (typeof VIEWS)[number];

interface MapSearch {
  view?: View;
  cancelled?: boolean;
  step?: number;
}

/**
 * View, cancelled-steps and selection live in the URL, so any state a person
 * can reach is a state they can share or reload back into.
 */
export const Route = createFileRoute("/maps/$mapName")({
  validateSearch: (search: Record<string, unknown>): MapSearch => ({
    view: VIEWS.includes(search.view as View) ? (search.view as View) : undefined,
    cancelled: typeof search.cancelled === "boolean" ? search.cancelled : undefined,
    step: Number.isInteger(search.step) ? (search.step as number) : undefined,
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(mapQuery(params.mapName)),
  component: MapRoute,
});

function MapRoute() {
  const { mapName } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useQuery(mapQuery(mapName));

  // A dependency graph is not readable on a phone; the board is the honest
  // default there, and Graph is still one tap away.
  const phone = useMediaQuery(BREAKPOINTS.phone);
  const detailInline = !useMediaQuery(BREAKPOINTS.detailOverlay);
  // When the panel is an overlay there is nowhere for the map overview to live,
  // so it gets an explicit control.
  const [overviewOpen, setOverviewOpen] = useState(false);
  const view: View = search.view ?? (phone ? "board" : "graph");
  const showCancelled = search.cancelled ?? true;

  const detail = query.data && !isError(query.data) ? query.data : null;
  const steps = useMemo(
    () => (detail?.map.steps ?? []).filter((step) => showCancelled || step.status !== "cancelled"),
    [detail, showCancelled],
  );

  if (query.isError) {
    return <EmptyState title="Cannot reach the viewer server">{query.error.message}</EmptyState>;
  }
  if (query.data && isError(query.data)) {
    // A malformed or unreadable map reports the CLI's own error.
    return <EmptyState title="Cannot read this map">{query.data.error}</EmptyState>;
  }
  if (!detail) return null;

  const selected = search.step ?? null;
  const setSearch = (next: Partial<MapSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });
  const closeDetail = () => setSearch({ step: undefined });

  const panel = (
    <ScrollArea className="h-full">
      {selected === null ? (
        <MapOverviewPanel detail={detail} />
      ) : (
        <StepDetailPanel detail={detail} stepId={selected} />
      )}
    </ScrollArea>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <MapHeader detail={detail} />

        <section aria-label="Steps" className="relative min-h-0 flex-1">
          <div className="bg-card/90 absolute top-3 right-3 z-20 flex items-center gap-3 rounded-lg border p-1 pr-3 shadow-sm backdrop-blur">
            <Tabs value={view} onValueChange={(value) => setSearch({ view: value as View })}>
              <TabsList aria-label="Map view">
                {VIEWS.map((option) => (
                  <TabsTrigger key={option} value={option} className="capitalize">
                    {option}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Switch
                checked={showCancelled}
                onCheckedChange={(checked) => setSearch({ cancelled: checked })}
              />
              <span className="hidden sm:inline">Cancelled</span>
            </label>
            {!detailInline && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show map overview"
                onClick={() => {
                  setSearch({ step: undefined });
                  setOverviewOpen(true);
                }}
              >
                <PanelRight />
              </Button>
            )}
          </div>

          <MapBody
            detail={detail}
            steps={steps}
            view={view}
            selected={selected}
            viewportKey={`${mapName}:${showCancelled}`}
          />
        </section>
      </div>

      {detailInline ? (
        <aside aria-label="Step detail" className="w-96 shrink-0 border-l">
          <div className="relative h-full">
            {selected !== null && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-2 right-2 z-10"
                aria-label="Close step detail"
                onClick={closeDetail}
              >
                <X />
              </Button>
            )}
            {panel}
          </div>
        </aside>
      ) : (
        <Sheet
          open={selected !== null || overviewOpen}
          onOpenChange={(open) => {
            if (open) return;
            setOverviewOpen(false);
            closeDetail();
          }}
        >
          <SheetContent
            side={phone ? "bottom" : "right"}
            title="Step detail"
            className={phone ? "h-[80vh] p-0" : "w-96 p-0 sm:max-w-96"}
          >
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function MapBody({
  detail,
  steps,
  view,
  selected,
  viewportKey,
}: {
  detail: MapDetail;
  steps: MapDetail["map"]["steps"];
  view: View;
  selected: number | null;
  /** Changing this returns the graph canvas to its opening view. */
  viewportKey: string;
}) {
  if (steps.length === 0) {
    return (
      <EmptyState title="Nothing charted yet">
        {detail.map.steps.length > 0
          ? "Every step on this map is cancelled. Turn cancelled steps back on to see them."
          : "This map has a start and a destination but no steps. That is a legitimate state — the path is still fog."}
      </EmptyState>
    );
  }
  if (view === "board") {
    return <BoardView steps={steps} next={detail.next} selected={selected} />;
  }
  if (view === "list") {
    return <ListView steps={steps} next={detail.next} selected={selected} />;
  }
  return (
    <GraphView
      steps={steps}
      next={detail.next}
      start={detail.map.start}
      goals={detail.map.goals}
      selected={selected}
      viewportKey={viewportKey}
    />
  );
}
