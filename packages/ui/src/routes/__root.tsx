import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { MapRail } from "@/components/map-rail";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { BREAKPOINTS, useMediaQuery } from "@/hooks/use-media-query";
import { RailControlsProvider } from "@/hooks/use-rail-controls";
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
  const railPanelRef = useRef<PanelImperativeHandle>(null);
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
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel
                panelRef={railPanelRef}
                collapsible
                defaultSize="20%"
                minSize="15%"
                maxSize="35%"
                onResize={(size) => setRailCollapsed(size.asPercentage === 0)}
              >
                {!railCollapsed && (
                  <div className="flex h-full flex-col border-r">
                    <div className="flex shrink-0 items-center justify-end p-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Collapse maps rail"
                        onClick={() => {
                          railPanelRef.current?.collapse();
                          setRailCollapsed(true);
                        }}
                      >
                        <PanelLeftClose />
                      </Button>
                    </div>
                    <div className="min-h-0 flex-1">{rail}</div>
                  </div>
                )}
              </ResizablePanel>
              <ResizableHandle className={railCollapsed ? "hidden" : undefined} />
              <ResizablePanel defaultSize="80%">
                <RailControlsProvider
                  value={{
                    collapsed: railCollapsed,
                    show: () => {
                      railPanelRef.current?.expand();
                      setRailCollapsed(false);
                    },
                  }}
                >
                  <div className="relative h-full">
                    {railCollapsed && !activeMap && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="absolute top-2 left-2 z-10"
                        aria-label="Show maps rail"
                        onClick={() => {
                          railPanelRef.current?.expand();
                          setRailCollapsed(false);
                        }}
                      >
                        <PanelLeftOpen />
                      </Button>
                    )}
                    {main}
                  </div>
                </RailControlsProvider>
              </ResizablePanel>
            </ResizablePanelGroup>
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
