import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";

import { MapRail } from "@/components/map-rail";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { BREAKPOINTS, useMediaQuery } from "@/hooks/use-media-query";
import { overviewQuery } from "@/lib/api";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

/**
 * Three regions: a map rail, the map itself, and a step detail panel. The rail
 * becomes an overlay sheet below 940px; the detail panel is the map route's
 * business, since it belongs to a map.
 */
function RootLayout() {
  const { data: overview } = useQuery(overviewQuery());
  const live = useLiveUpdates();
  const [railOpen, setRailOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const railInline = !useMediaQuery(BREAKPOINTS.railOverlay);
  const activeMap = useActiveMapName();

  const rail = (
    <MapRail
      maps={overview?.maps ?? []}
      types={overview?.types ?? []}
      activeMap={activeMap}
      onNavigate={() => setRailOpen(false)}
    />
  );

  const main = (
    <main id="map" className="flex h-full min-w-0 flex-1 flex-col">
      <Outlet />
    </main>
  );

  return (
    <TooltipProvider>
      <a
        href="#map"
        className="bg-primary text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
      >
        Skip to map
      </a>

      <div className="flex h-full flex-col">
        <TopBar project={overview?.project} live={live} onOpenRail={() => setRailOpen(true)} />

        <div className="flex min-h-0 flex-1">
          {railInline ? (
            railCollapsed ? (
              <div className="relative min-w-0 flex-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-2 left-2 z-10"
                  aria-label="Show maps rail"
                  onClick={() => setRailCollapsed(false)}
                >
                  <PanelLeftOpen />
                </Button>
                {main}
              </div>
            ) : (
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize="20%" minSize="15%" maxSize="35%">
                  <div className="relative h-full border-r">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="absolute top-2 right-2 z-10"
                      aria-label="Collapse maps rail"
                      onClick={() => setRailCollapsed(true)}
                    >
                      <PanelLeftClose />
                    </Button>
                    {rail}
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="80%">{main}</ResizablePanel>
              </ResizablePanelGroup>
            )
          ) : (
            main
          )}
        </div>
      </div>

      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent side="left" title="Maps" className="w-72 p-0">
          {rail}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}

/** The rail highlights the map in the URL without depending on the map route. */
function useActiveMapName(): string | null {
  return useRouterState({
    select: (state) => {
      const match = /^\/maps\/([^/?#]+)/.exec(state.location.pathname);
      return match?.[1] ? decodeURIComponent(match[1]) : null;
    },
  });
}
